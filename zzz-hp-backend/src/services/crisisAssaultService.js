import pool from '../config/db.js'
import { isCrisisBossId, isCrisisBuffId } from '../utils/defenseId.js'
import {
  CRISIS_BASE_HP_BY_NAME,
  formatCrisisHpCoeffPercent,
  getCrisisBaseHpByName,
  resolveCrisisHpCoeff,
} from '../utils/crisisHpCoeff.js'
import { convertHpToDefense953, roundConvertedHp } from '../utils/defenseHpConvert.js'
import { isCrisisHardRoom, isSeasonPubliclyVisible, isSeasonUnreleased } from '../utils/crisisRoom.js'
import { getSeasonDateMap } from './seasonDateService.js'
import {
  getSeasonContentTrashMap,
  seasonTrashKey,
} from './seasonContentTrashService.js'
import {
  ensureEnvironmentBuffSchema,
  parseFieldBuffSetsJson,
  resolveFieldBuffFromSets,
  normalizeFieldBuffSet,
  parseEffectBlocksJson,
} from '../utils/environmentBuffSchema.js'
import { parseWeaknessSetsJson, weaknessSetsFromLegacy } from '../utils/bossWeaknessSets.js'
import {
  loadGlobalBuffEffectMap,
  resolveEffectBlocksForName,
} from '../utils/sameNameBuffEffects.js'
import { ensureContentModeColumns } from './contentModeService.js'
import {
  ensureBossAnomalySchema,
  ensureBossResistanceSchema,
  ensureBossStaggerSchema,
  normalizeAnomalyBarCoefficient,
  normalizeStaggerMultiplier,
  normalizeStaggerTime,
} from '../utils/bossSchema.js'
import { resolveAnomalyBarCoefficient } from '../utils/anomalyBarCoefficient.js'
import { crisisPhaseNumericId, resolveCrisisTidMap } from './crisisTidService.js'

let schemaEnsured = false

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column],
  )
  return Number(rows[0]?.c) > 0
}

/** 危局相关列缺失时自动补齐（兼容旧库未跑 migrate-crisis-hp-coeff） */
async function ensureCrisisSchema() {
  if (schemaEnsured) return
  if (!(await columnExists('boss_info', 'crisis_base_hp'))) {
    await pool.query(
      `ALTER TABLE boss_info
       ADD COLUMN crisis_base_hp DOUBLE NULL COMMENT '怪物危局基础血量'`,
    )
  }
  if (!(await columnExists('boss', 'hp_coeff_percent'))) {
    await pool.query(
      `ALTER TABLE boss
       ADD COLUMN hp_coeff_percent INT NULL COMMENT '危局血量系数%（手动覆盖，空则自动计算）'`,
    )
  }
  if (!(await columnExists('date', 'mode'))) {
    await pool.query(
      `ALTER TABLE \`date\`
       ADD COLUMN mode VARCHAR(20) NOT NULL DEFAULT 'crisis' COMMENT 'crisis|defense'`,
    )
    await pool.query(`UPDATE \`date\` SET mode = 'crisis' WHERE mode IS NULL OR mode = ''`)
  }
  schemaEnsured = true
}

function comparePhase(a, b) {
  const versionDiff = Number(a.version) - Number(b.version)
  if (versionDiff !== 0) return versionDiff
  return Number(a.phase) - Number(b.phase)
}

function seasonDateKey(version, phase) {
  const phaseNum = String(phase).replace(/\D/g, '')
  const normalized = phaseNum ? String(Number(phaseNum)) : String(phase).trim()
  return `${String(version).trim()}-${normalized}`
}

function formatDateValue(value) {
  if (!value) return null
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  const text = String(value).slice(0, 10)
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!match) return text || null
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

function enrichBoss(boss, context = {}) {
  const {
    baseHpByName = new Map(),
    fieldBuffSetsByName = new Map(),
    staggerTimeByName = new Map(),
    staggerMultiplierByName = new Map(),
    resistanceHighByName = new Map(),
    anomalyBarCoefficientByName = new Map(),
    weaknessSetsByName = new Map(),
  } = context
  const baseHp =
    baseHpByName.get(boss.boss_name) ??
    getCrisisBaseHpByName(boss.boss_name)
  const resolved = resolveCrisisHpCoeff({
    bossHp: boss.hp,
    baseHp,
    manualPercent: boss.hp_coeff_percent,
  })
  const defense = Number(boss.defense)
  const hp = Number(boss.hp)
  const hpConverted = roundConvertedHp(convertHpToDefense953(hp, defense))
  const sets = fieldBuffSetsByName.get(boss.boss_name) ?? []
  const resolvedBuff = resolveFieldBuffFromSets(sets, boss.field_buff_set_id)
  const weaknessSets = weaknessSetsByName.get(boss.boss_name) ?? []
  const resolvedWeakness = resolveWeaknessSetFromSets(weaknessSets, boss.weakness_set_id)
  const fieldBuff = resolvedBuff
    ? {
        name: resolvedBuff.name,
        text: resolvedBuff.text ?? '',
        image: resolvedBuff.image ?? null,
        effectBlocks: resolvedBuff.effectBlocks ?? null,
        set_id: String(boss.field_buff_set_id ?? '').trim() || null,
      }
    : null
  const rowStaggerTime = normalizeStaggerTime(boss.stagger_time)
  const stagger_time =
    rowStaggerTime ?? staggerTimeByName.get(boss.boss_name) ?? null
  // 失衡易伤以怪物库为准（2026-11-09 所有者口径）：boss_info > 期数行快照；都缺省时回落默认 1.5
  const stagger_multiplier = normalizeStaggerMultiplier(
    staggerMultiplierByName.get(boss.boss_name) ?? boss.stagger_multiplier,
  )
  const resistance_high =
    boss.resistance_high ?? resistanceHighByName.get(boss.boss_name) ?? null
  // 异常条系数只在读路径物化：boss_info 覆盖值 > 内置默认表（文案见 utils/anomalyBarCoefficient.js）
  const anomaly_bar_coefficient = resolveAnomalyBarCoefficient(
    boss.boss_name,
    anomalyBarCoefficientByName.get(boss.boss_name),
  )
  return {
    id: boss.id,
    boss_name: boss.boss_name,
    hp,
    hp_converted_953: hpConverted,
    defense,
    level: Number(boss.level),
    room: boss.room,
    weakness: resolvedWeakness ? (resolvedWeakness.weakness ?? null) : boss.weakness,
    resistance: resolvedWeakness ? (resolvedWeakness.resistance ?? null) : boss.resistance,
    resistance_high: resolvedWeakness
      ? (resolvedWeakness.resistanceHigh ?? null)
      : resistance_high,
    /** 当期绑定的弱点/抗性套（怪物库多套配置）；未配置多套时为 null */
    weakness_set_id: resolvedWeakness?.id ?? null,
    weakness_set_label: resolvedWeakness?.label ?? null,
    weakness_sets: weaknessSets,
    anomaly_bar_coefficient,
    stagger_time,
    stagger_multiplier,
    boss_image: boss.boss_image,
    crisis_base_hp: baseHp == null ? null : Number(baseHp),
    hp_coeff_percent: resolved.percent,
    hp_coeff_manual: resolved.manual,
    hp_coeff_label: formatCrisisHpCoeffPercent(resolved.percent),
    is_hard_room: isCrisisHardRoom(boss.room),
    field_buff_set_id: String(boss.field_buff_set_id ?? '').trim() || null,
    field_buff: fieldBuff,
  }
}

function sumHp(bosses, key = 'hp') {
  return bosses.reduce((sum, boss) => sum + Number(boss[key] || 0), 0)
}

async function loadBossResistanceHighMap() {
  await ensureBossResistanceSchema()
  const map = new Map()
  try {
    const [rows] = await pool.execute(
      'SELECT boss_name, resistance_high FROM boss_info WHERE resistance_high IS NOT NULL AND resistance_high <> \'\'',
    )
    for (const row of rows) {
      map.set(row.boss_name, row.resistance_high)
    }
  } catch (err) {
    console.warn('[crisis] loadBossResistanceHighMap fallback:', err.message)
  }
  return map
}

async function loadBossStaggerTimeMap() {
  await ensureBossStaggerSchema()
  const map = new Map()
  try {
    const [rows] = await pool.execute(
      'SELECT boss_name, stagger_time FROM boss_info WHERE stagger_time IS NOT NULL',
    )
    for (const row of rows) {
      const value = normalizeStaggerTime(row.stagger_time)
      if (value != null) map.set(row.boss_name, value)
    }
  } catch (err) {
    console.warn('[crisis] loadBossStaggerTimeMap fallback:', err.message)
  }
  return map
}

async function loadBossStaggerMultiplierMap() {
  await ensureBossStaggerSchema()
  const map = new Map()
  try {
    const [rows] = await pool.execute(
      'SELECT boss_name, stagger_multiplier FROM boss_info WHERE stagger_multiplier IS NOT NULL',
    )
    for (const row of rows) {
      map.set(row.boss_name, normalizeStaggerMultiplier(row.stagger_multiplier))
    }
  } catch (err) {
    console.warn('[crisis] loadBossStaggerMultiplierMap fallback:', err.message)
  }
  return map
}

async function loadBossAnomalyCoefficientMap() {
  await ensureBossAnomalySchema()
  const map = new Map()
  try {
    const [rows] = await pool.execute(
      'SELECT boss_name, anomaly_bar_coefficient FROM boss_info WHERE anomaly_bar_coefficient IS NOT NULL',
    )
    for (const row of rows) {
      // DECIMAL 列经 mysql2 返回字符串：先归一化成数字，供 resolveAnomalyBarCoefficient 当显式值用
      map.set(row.boss_name, normalizeAnomalyBarCoefficient(row.anomaly_bar_coefficient))
    }
  } catch (err) {
    console.warn('[crisis] loadBossAnomalyCoefficientMap fallback:', err.message)
  }
  return map
}

async function loadCrisisBaseHpMap() {
  await ensureCrisisSchema()
  const map = new Map()
  try {
    const [rows] = await pool.execute(
      'SELECT boss_name, crisis_base_hp FROM boss_info WHERE crisis_base_hp IS NOT NULL',
    )
    for (const row of rows) {
      map.set(row.boss_name, Number(row.crisis_base_hp))
    }
  } catch (err) {
    console.warn('[crisis] loadCrisisBaseHpMap fallback:', err.message)
  }
  for (const [name, hp] of Object.entries(CRISIS_BASE_HP_BY_NAME)) {
    if (!map.has(name)) map.set(name, hp)
  }
  return map
}

async function loadBossFieldBuffMap() {
  await ensureEnvironmentBuffSchema()
  const map = new Map()
  try {
    const [rows] = await pool.execute(
      `SELECT boss_name, field_buff_name, field_buff_text, field_buff_image, field_buff_effect_blocks, field_buff_sets
       FROM boss_info`,
    )
    for (const row of rows) {
      let sets = parseFieldBuffSetsJson(row.field_buff_sets)
      if (!sets.length) {
        const legacy = normalizeFieldBuffSet(
          {
            id: 'legacy',
            name: row.field_buff_name,
            text: row.field_buff_text,
            image: row.field_buff_image,
            effectBlocks: parseEffectBlocksJson(row.field_buff_effect_blocks),
          },
          'legacy',
        )
        if (legacy) sets = [legacy]
      }
      if (!sets.length) continue
      map.set(row.boss_name, sets)
    }
  } catch (err) {
    console.warn('[crisis] loadBossFieldBuffMap fallback:', err.message)
  }
  return map
}

/** boss_info 的多套弱点/抗性（危局特殊机制）；没有多套的 boss 不下发 */
async function loadBossWeaknessSetsMap() {
  await ensureEnvironmentBuffSchema()
  const map = new Map()
  try {
    const [rows] = await pool.execute(
      `SELECT boss_name, weakness, resistance, resistance_high, weakness_sets FROM boss_info`,
    )
    for (const row of rows) {
      let sets = parseWeaknessSetsJson(row.weakness_sets)
      if (!sets.length) sets = weaknessSetsFromLegacy(row)
      if (!sets.length) continue
      map.set(row.boss_name, sets)
    }
  } catch (err) {
    console.warn('[crisis] loadBossWeaknessSetsMap fallback:', err.message)
  }
  return map
}

/** 从怪物库多套里选一套：指定 id 优先，未指定/找不到时用第一套（与场地 Buff 自动口径一致） */
function resolveWeaknessSetFromSets(sets, setId) {
  if (!Array.isArray(sets) || !sets.length) return null
  const id = String(setId ?? '').trim()
  if (id) {
    const match = sets.find((set) => String(set.id) === id)
    if (match) return match
  }
  return sets[0]
}

function normalizeRoomType(roomType) {
  const value = String(roomType || 'all').trim().toLowerCase()
  if (value === 'normal' || value === 'hard') return value
  return 'all'
}

function seasonPhaseKey(version, phase) {
  const phaseNum = String(phase ?? '').replace(/\D/g, '')
  const normalized = phaseNum ? String(Number(phaseNum)) : String(phase ?? '').trim()
  return `${String(version).trim()}-${normalized}`
}

export async function getCrisisAssaultPhases({ includeHidden = false } = {}) {
  await ensureCrisisSchema()
  await ensureEnvironmentBuffSchema()
  await ensureContentModeColumns(pool)
  const [bossRowsRaw] = await pool.execute(
    "SELECT * FROM boss WHERE mode = 'crisis' ORDER BY version, phase, CAST(room AS UNSIGNED)",
  )
  const [buffRowsRaw] = await pool.execute(
    "SELECT * FROM buff WHERE mode = 'crisis' ORDER BY version, phase, id",
  )
  const bossRows = bossRowsRaw.filter((boss) => isCrisisBossId(boss.id))
  const buffRows = buffRowsRaw.filter((buff) => isCrisisBuffId(buff.id))
  const dateMap = await getSeasonDateMap('crisis')
  const trashMap = await getSeasonContentTrashMap('crisis')
  const baseHpByName = await loadCrisisBaseHpMap()
  const fieldBuffByName = await loadBossFieldBuffMap()
  const staggerTimeByName = await loadBossStaggerTimeMap()
  const staggerMultiplierByName = await loadBossStaggerMultiplierMap()
  const resistanceHighByName = await loadBossResistanceHighMap()
  const weaknessSetsByName = await loadBossWeaknessSetsMap()
  const anomalyBarCoefficientByName = await loadBossAnomalyCoefficientMap()
  const globalBuffEffectMap = await loadGlobalBuffEffectMap()

  const phaseMap = new Map()

  for (const boss of bossRows) {
    const key = seasonPhaseKey(boss.version, boss.phase)
    if (!phaseMap.has(key)) {
      phaseMap.set(key, {
        version: String(boss.version).trim(),
        phase: String(Number(String(boss.phase).replace(/\D/g, '') || boss.phase)),
        bosses: [],
        buffs: [],
      })
    }
    phaseMap.get(key).bosses.push(boss)
  }

  for (const buff of buffRows) {
    const key = seasonPhaseKey(buff.version, buff.phase)
    if (!phaseMap.has(key)) {
      phaseMap.set(key, {
        version: String(buff.version).trim(),
        phase: String(Number(String(buff.phase).replace(/\D/g, '') || buff.phase)),
        bosses: [],
        buffs: [],
      })
    }
    phaseMap.get(key).buffs.push(buff)
  }

  for (const [key, dateInfo] of dateMap.entries()) {
    if (phaseMap.has(key)) continue
    phaseMap.set(key, {
      version: String(dateInfo.version).trim(),
      phase: String(dateInfo.phase).replace(/\D/g, '')
        ? String(Number(String(dateInfo.phase).replace(/\D/g, '')))
        : String(dateInfo.phase),
      bosses: [],
      buffs: [],
    })
  }

  const sortedPhaseItems = [...phaseMap.values()].sort(comparePhase)
  const tidMap = await resolveCrisisTidMap(sortedPhaseItems)

  const phases = sortedPhaseItems
    .filter((item) => item.bosses.length > 0 || includeHidden)
    .map((item) => {
      const bosses = item.bosses.map((boss) =>
        enrichBoss(boss, {
          baseHpByName,
          fieldBuffSetsByName: fieldBuffByName,
          staggerTimeByName,
          staggerMultiplierByName,
          resistanceHighByName,
          anomalyBarCoefficientByName,
          weaknessSetsByName,
        }),
      )
      const normalBosses = bosses.filter((boss) => !boss.is_hard_room)
      const hardBosses = bosses.filter((boss) => boss.is_hard_room)
      const dateInfo = dateMap.get(seasonDateKey(item.version, item.phase))
      const phaseId = crisisPhaseNumericId(item.version, item.phase)
      const tid = phaseId != null ? (tidMap.get(phaseId) ?? null) : null
      const startDate = formatDateValue(dateInfo?.start_date)
      const listed = isSeasonPubliclyVisible(startDate)
      const isHidden = isSeasonUnreleased(startDate)
      const trash = trashMap.get(seasonTrashKey('crisis', item.version, item.phase))

      return {
        id: `ca-${item.version}-${item.phase}`,
        version: item.version,
        phase: item.phase,
        phaseLabel: `第 ${item.phase} 期`,
        startDate,
        endDate: formatDateValue(dateInfo?.end_date),
        isHidden,
        listed,
        pendingCleanup: Boolean(trash),
        deletedAt: trash?.deletedAt ?? null,
        totalHp: sumHp(normalBosses, 'hp'),
        totalHpConverted953: sumHp(normalBosses, 'hp_converted_953'),
        hardTotalHp: sumHp(hardBosses, 'hp'),
        hardTotalHpConverted953: sumHp(hardBosses, 'hp_converted_953'),
        tid,
        bosses,
        buffs: item.buffs.map((buff) => ({
          id: buff.id,
          buff_name: buff.buff_name,
          buff: buff.buff,
          buff_image: buff.buff_image,
          effect_blocks: resolveEffectBlocksForName(
            buff.effect_blocks,
            buff.buff_name,
            globalBuffEffectMap,
          ),
        })),
      }
    })
    .filter((item) => {
      if (item.pendingCleanup && !includeHidden) return false
      if (item.bosses.length > 0) return includeHidden || item.listed
      return includeHidden
    })
    .map(({ listed: _listed, ...item }) => item)

  return phases
}

export async function getBossNames({ roomType = 'all' } = {}) {
  await ensureContentModeColumns(pool)
  const type = normalizeRoomType(roomType)
  const [rows] = await pool.execute(
    "SELECT boss_name, boss_image, id, room FROM boss WHERE mode = 'crisis' ORDER BY boss_name",
  )

  const seen = new Map()
  for (const row of rows) {
    if (!isCrisisBossId(row.id)) continue
    const hard = isCrisisHardRoom(row.room)
    if (type === 'normal' && hard) continue
    if (type === 'hard' && !hard) continue
    if (!seen.has(row.boss_name)) {
      seen.set(row.boss_name, {
        boss_name: row.boss_name,
        boss_image: row.boss_image,
        roomType: hard ? 'hard' : 'normal',
      })
    }
  }

  return [...seen.values()]
}

export async function getBossChartHistory(
  bossName,
  { roomType = 'all', includeHidden = false } = {},
) {
  await ensureCrisisSchema()
  await ensureContentModeColumns(pool)
  const type = normalizeRoomType(roomType)
  const [bossRows] = await pool.execute(
    `SELECT *
     FROM boss
     WHERE boss_name = ? AND mode = 'crisis'
     ORDER BY version, CAST(phase AS UNSIGNED)`,
    [bossName],
  )

  if (!bossRows.length) return []

  const dateMap = await getSeasonDateMap('crisis')
  const trashMap = await getSeasonContentTrashMap('crisis')
  const baseHpByName = await loadCrisisBaseHpMap()
  const resistanceHighByName = await loadBossResistanceHighMap()
  const weaknessSetsByName = await loadBossWeaknessSetsMap()

  return bossRows
    .filter((boss) => isCrisisBossId(boss.id))
    .filter((boss) => {
      const hard = isCrisisHardRoom(boss.room)
      if (type === 'normal') return !hard
      if (type === 'hard') return hard
      return true
    })
    .sort((a, b) =>
      comparePhase(
        { version: a.version, phase: a.phase },
        { version: b.version, phase: b.phase },
      ),
    )
    .map((boss) => {
      const dateInfo = dateMap.get(seasonDateKey(boss.version, boss.phase))
      const enriched = enrichBoss(boss, {
        baseHpByName,
        resistanceHighByName,
        weaknessSetsByName,
      })
      const startDate = formatDateValue(dateInfo?.start_date)
      const listed = isSeasonPubliclyVisible(startDate)
      const isHidden = isSeasonUnreleased(startDate)
      const trash = trashMap.get(seasonTrashKey('crisis', boss.version, boss.phase))
      return {
        label: `${boss.version}第${boss.phase}期`,
        dateRange: formatDateRangeValue(dateInfo?.start_date, dateInfo?.end_date),
        totalHp: Number(boss.hp),
        totalHpConverted953: enriched.hp_converted_953,
        hpCoeffPercent: enriched.hp_coeff_percent,
        crisisBaseHp: enriched.crisis_base_hp,
        /** 该期实际使用的弱点/抗性（怪物库多套已解析成一套），供数据库图表标记对应期数 */
        weakness: enriched.weakness,
        resistance: enriched.resistance,
        resistance_high: enriched.resistance_high,
        weakness_set_id: enriched.weakness_set_id,
        weakness_set_label: enriched.weakness_set_label,
        version: boss.version,
        phase: String(boss.phase),
        boss_image: boss.boss_image,
        startDate,
        isHidden,
        listed,
        pendingCleanup: Boolean(trash),
        roomType: enriched.is_hard_room ? 'hard' : 'normal',
      }
    })
    .filter((item) => {
      if (item.pendingCleanup && !includeHidden) return false
      return includeHidden || item.listed
    })
    .map(({ listed: _listed, ...item }) => item)
}

function formatDateRangeValue(startDate, endDate) {
  const start = formatDateValue(startDate)
  const end = formatDateValue(endDate)
  if (!start || !end) return '日期待更新'

  const formatDot = (value) => {
    const [year, month, day] = value.split('-')
    return `${year}.${Number(month)}.${Number(day)}`
  }

  return `${formatDot(start)} - ${formatDot(end)}`
}
