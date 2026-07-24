import pool from '../config/db.js'
import { isCrisisBossId, isCrisisBuffId } from '../utils/defenseId.js'
import {
  CRISIS_BASE_HP_BY_NAME,
  formatCrisisHpCoeffPercent,
  getCrisisBaseHpByName,
  resolveCrisisHpCoeff,
} from '../utils/crisisHpCoeff.js'
import { convertHpToDefense953, roundConvertedHp } from '../utils/defenseHpConvert.js'
import { isCrisisHardRoom, isSeasonPubliclyVisible, isSeasonUnreleased, isCrisisPhaseReadyForEarlyRelease, SEASON_EARLY_RELEASE_DAYS } from '../utils/crisisRoom.js'
import { getSeasonDateMap } from './seasonDateService.js'

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
  return `${String(version).trim()}-${String(phase).replace(/\D/g, '') || String(phase).trim()}`
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

function enrichBoss(boss, baseHpByName) {
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
  return {
    id: boss.id,
    boss_name: boss.boss_name,
    hp,
    hp_converted_953: hpConverted,
    defense,
    level: Number(boss.level),
    room: boss.room,
    weakness: boss.weakness,
    resistance: boss.resistance,
    boss_image: boss.boss_image,
    crisis_base_hp: baseHp == null ? null : Number(baseHp),
    hp_coeff_percent: resolved.percent,
    hp_coeff_manual: resolved.manual,
    hp_coeff_label: formatCrisisHpCoeffPercent(resolved.percent),
    is_hard_room: isCrisisHardRoom(boss.room),
  }
}

function sumHp(bosses, key = 'hp') {
  return bosses.reduce((sum, boss) => sum + Number(boss[key] || 0), 0)
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

function normalizeRoomType(roomType) {
  const value = String(roomType || 'all').trim().toLowerCase()
  if (value === 'normal' || value === 'hard') return value
  return 'all'
}

export async function getCrisisAssaultPhases({ includeHidden = false } = {}) {
  await ensureCrisisSchema()
  const [bossRowsRaw] = await pool.execute(
    'SELECT * FROM boss ORDER BY version, phase, CAST(room AS UNSIGNED)',
  )
  const [buffRowsRaw] = await pool.execute('SELECT * FROM buff ORDER BY version, phase, id')
  const bossRows = bossRowsRaw.filter((boss) => isCrisisBossId(boss.id))
  const buffRows = buffRowsRaw.filter((buff) => isCrisisBuffId(buff.id))
  const dateMap = await getSeasonDateMap('crisis')
  const [idRows] = await pool.execute('SELECT id, tid FROM id_table')
  const baseHpByName = await loadCrisisBaseHpMap()

  const tidMap = new Map(idRows.map((row) => [Number(row.id), Number(row.tid)]))

  const phaseMap = new Map()

  for (const boss of bossRows) {
    const key = `${boss.version}-${boss.phase}`
    if (!phaseMap.has(key)) {
      phaseMap.set(key, {
        version: boss.version,
        phase: String(boss.phase),
        bosses: [],
        buffs: [],
      })
    }
    phaseMap.get(key).bosses.push(boss)
  }

  for (const buff of buffRows) {
    const key = `${buff.version}-${buff.phase}`
    if (!phaseMap.has(key)) {
      phaseMap.set(key, {
        version: buff.version,
        phase: String(buff.phase),
        bosses: [],
        buffs: [],
      })
    }
    phaseMap.get(key).buffs.push(buff)
  }

  const phases = [...phaseMap.values()]
    .filter((item) => item.bosses.length > 0)
    .sort(comparePhase)
    .map((item) => {
      const bosses = item.bosses.map((boss) => enrichBoss(boss, baseHpByName))
      const normalBosses = bosses.filter((boss) => !boss.is_hard_room)
      const hardBosses = bosses.filter((boss) => boss.is_hard_room)
      const dateInfo = dateMap.get(seasonDateKey(item.version, item.phase))
      const phaseId = Number(`${String(item.version).replace('.', '')}${item.phase}`)
      const tid = tidMap.get(phaseId) ?? null
      const startDate = formatDateValue(dateInfo?.start_date)
      const allowEarly = isCrisisPhaseReadyForEarlyRelease(item.bosses, item.buffs)
      const listed = isSeasonPubliclyVisible(startDate, {
        allowEarly,
        earlyReleaseDays: SEASON_EARLY_RELEASE_DAYS,
      })
      // 未到开始日一律标未公开；提前进列表也不当作「当前期」
      const isHidden = isSeasonUnreleased(startDate)

      return {
        id: `ca-${item.version}-${item.phase}`,
        version: item.version,
        phase: item.phase,
        phaseLabel: `第 ${item.phase} 期`,
        startDate,
        endDate: formatDateValue(dateInfo?.end_date),
        isHidden,
        listed,
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
        })),
      }
    })
    .filter((item) => includeHidden || item.listed)
    .map(({ listed: _listed, ...item }) => item)

  return phases
}

export async function getBossNames({ roomType = 'all' } = {}) {
  const type = normalizeRoomType(roomType)
  const [rows] = await pool.execute(
    'SELECT boss_name, boss_image, id, room FROM boss ORDER BY boss_name',
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
  const type = normalizeRoomType(roomType)
  const [bossRows] = await pool.execute(
    `SELECT *
     FROM boss
     WHERE boss_name = ?
     ORDER BY version, CAST(phase AS UNSIGNED)`,
    [bossName],
  )

  if (!bossRows.length) return []

  const dateMap = await getSeasonDateMap('crisis')
  const baseHpByName = await loadCrisisBaseHpMap()

  const [allBossRows] = await pool.execute(
    'SELECT id, version, phase, room, boss_name, hp FROM boss',
  )
  const [allBuffRows] = await pool.execute(
    'SELECT id, version, phase, buff_name, buff FROM buff',
  )
  const bossesByPhase = new Map()
  for (const row of allBossRows) {
    if (!isCrisisBossId(row.id)) continue
    const key = seasonDateKey(row.version, row.phase)
    if (!bossesByPhase.has(key)) bossesByPhase.set(key, [])
    bossesByPhase.get(key).push(row)
  }
  const buffsByPhase = new Map()
  for (const row of allBuffRows) {
    if (!isCrisisBuffId(row.id)) continue
    const key = seasonDateKey(row.version, row.phase)
    if (!buffsByPhase.has(key)) buffsByPhase.set(key, [])
    buffsByPhase.get(key).push(row)
  }

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
      const enriched = enrichBoss(boss, baseHpByName)
      const startDate = formatDateValue(dateInfo?.start_date)
      const phaseKey = seasonDateKey(boss.version, boss.phase)
      const allowEarly = isCrisisPhaseReadyForEarlyRelease(
        bossesByPhase.get(phaseKey) || [],
        buffsByPhase.get(phaseKey) || [],
      )
      const listed = isSeasonPubliclyVisible(startDate, {
        allowEarly,
        earlyReleaseDays: SEASON_EARLY_RELEASE_DAYS,
      })
      const isHidden = isSeasonUnreleased(startDate)
      return {
        label: `${boss.version}第${boss.phase}期`,
        dateRange: formatDateRangeValue(dateInfo?.start_date, dateInfo?.end_date),
        totalHp: Number(boss.hp),
        totalHpConverted953: enriched.hp_converted_953,
        hpCoeffPercent: enriched.hp_coeff_percent,
        crisisBaseHp: enriched.crisis_base_hp,
        version: boss.version,
        phase: String(boss.phase),
        boss_image: boss.boss_image,
        startDate,
        isHidden,
        listed,
        roomType: enriched.is_hard_room ? 'hard' : 'normal',
      }
    })
    .filter((item) => includeHidden || item.listed)
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
