import pool from '../config/db.js'
import { getCrisisBaseHpByName } from '../utils/crisisHpCoeff.js'
import { resolveAnomalyBarCoefficient } from '../utils/anomalyBarCoefficient.js'
import {
  DEFAULT_BOSS_STAGGER_MULTIPLIER,
  ensureBossAnomalySchema,
  ensureBossResistanceSchema,
  ensureBossScoringNoteSchema,
  ensureBossStaggerSchema,
  normalizeAnomalyBarCoefficient,
  normalizeStaggerMultiplier,
  normalizeStaggerTime,
} from '../utils/bossSchema.js'
import { ensureContentModeColumns } from './contentModeService.js'
import { preferExistingImage, pickBestImagePath } from '../utils/localImagePath.js'
import {
  ensureEnvironmentBuffSchema,
  parseEffectBlocksJson,
  parseFieldBuffSetsJson,
  serializeFieldBuffSets,
  mirrorFieldBuffLegacyColumns,
  normalizeFieldBuffSet,
} from '../utils/environmentBuffSchema.js'
import {
  mirrorScoringNoteLegacy,
  parseScoringNoteSetsJson,
  scoringNoteSetsFromLegacy,
  serializeScoringNoteSets,
} from '../utils/bossScoringNoteSets.js'
import {
  mirrorWeaknessLegacyColumns,
  parseWeaknessSetsJson,
  serializeWeaknessSets,
  weaknessSetsFromLegacy,
} from '../utils/bossWeaknessSets.js'

const BOSS_INFO_CATALOGS = new Set(['crisis', 'defense', 'deduction'])

const BOSS_INFO_COLUMNS = `id, boss_name, defense, level, boss_image, weakness, resistance, resistance_high, scoring_note, scoring_note_sets, crisis_base_hp, stagger_multiplier, stagger_time, anomaly_bar_coefficient,
  field_buff_name, field_buff_text, field_buff_image, field_buff_effect_blocks, field_buff_sets, weakness_sets`

function resolveIncomingFieldBuffSets(payload) {
  if ('field_buff_sets' in payload) {
    return parseFieldBuffSetsJson(payload.field_buff_sets)
  }
  // 仅传旧四列时合成一套，便于兼容旧管理端/导入
  if (
    'field_buff_name' in payload ||
    'field_buff_text' in payload ||
    'field_buff_image' in payload ||
    'field_buff_effect_blocks' in payload
  ) {
    const one = normalizeFieldBuffSet(
      {
        id: 'legacy',
        name: payload.field_buff_name,
        text: payload.field_buff_text,
        image: payload.field_buff_image,
        effectBlocks: payload.field_buff_effect_blocks,
      },
      'legacy',
    )
    return one ? [one] : []
  }
  return null
}

function normalizeBossInfo(payload) {
  const crisisBaseHpRaw = payload.crisis_base_hp
  let crisis_base_hp = null
  if (crisisBaseHpRaw != null && crisisBaseHpRaw !== '') {
    const n = Number(crisisBaseHpRaw)
    if (Number.isFinite(n) && n > 0) crisis_base_hp = n
  } else {
    const fromMap = getCrisisBaseHpByName(payload.boss_name)
    if (fromMap != null) crisis_base_hp = fromMap
  }

  const asText = (value) => {
    if (value == null) return null
    const text = String(value).trim()
    return text || null
  }

  const setsOrNull = resolveIncomingFieldBuffSets(payload)
  const sets = setsOrNull ?? []
  const legacy = mirrorFieldBuffLegacyColumns(sets)
  const weaknessSetsProvided = Object.prototype.hasOwnProperty.call(payload, 'weakness_sets')
  const weaknessSets = weaknessSetsProvided ? parseWeaknessSetsJson(payload.weakness_sets) : []
  // 多套是权威来源：第一套同时镜像回基础三列，旧读路径继续可用
  const mirroredWeakness = mirrorWeaknessLegacyColumns(weaknessSets)

  return {
    boss_name: String(payload.boss_name ?? '').trim(),
    defense: Number(payload.defense ?? 0),
    level: Number(payload.level ?? 1),
    weakness: weaknessSets.length ? mirroredWeakness.weakness : asText(payload.weakness),
    resistance: weaknessSets.length ? mirroredWeakness.resistance : asText(payload.resistance),
    resistance_high: weaknessSets.length
      ? mirroredWeakness.resistance_high
      : asText(payload.resistance_high),
    // 得分机制：多套（与场地 Buff 同构）；只传旧单列时合成一套；都没传 → undefined（保留库中原值）
    scoring_note_sets: (() => {
      if (Object.prototype.hasOwnProperty.call(payload, 'scoring_note_sets')) {
        return serializeScoringNoteSets(parseScoringNoteSetsJson(payload.scoring_note_sets))
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'scoring_note')) {
        return serializeScoringNoteSets(scoringNoteSetsFromLegacy(payload.scoring_note))
      }
      return undefined
    })(),
    boss_image: asText(payload.boss_image),
    crisis_base_hp,
    stagger_multiplier: normalizeStaggerMultiplier(
      payload.stagger_multiplier,
      DEFAULT_BOSS_STAGGER_MULTIPLIER,
    ),
    stagger_time: normalizeStaggerTime(payload.stagger_time),
    anomaly_bar_coefficient: normalizeAnomalyBarCoefficient(payload.anomaly_bar_coefficient),
    field_buff_sets: serializeFieldBuffSets(sets),
    weakness_sets: serializeWeaknessSets(weaknessSets),
    _weaknessSetsProvided: weaknessSetsProvided,
    field_buff_name: legacy.field_buff_name,
    field_buff_text: legacy.field_buff_text,
    field_buff_image: legacy.field_buff_image,
    field_buff_effect_blocks: legacy.field_buff_effect_blocks,
    _setsProvided: setsOrNull != null,
  }
}

function bossInfoDiffers(existing, incoming) {
  const existingBase =
    existing.crisis_base_hp == null ? null : Number(existing.crisis_base_hp)
  const incomingBase =
    incoming.crisis_base_hp == null ? null : Number(incoming.crisis_base_hp)
  return (
    Number(existing.defense) !== incoming.defense ||
    Number(existing.level) !== incoming.level ||
    (existing.weakness ?? '') !== (incoming.weakness ?? '') ||
    (existing.resistance ?? '') !== (incoming.resistance ?? '') ||
    (existing.resistance_high ?? '') !== (incoming.resistance_high ?? '') ||
    JSON.stringify(existing.scoring_note_sets ?? []) !==
      JSON.stringify(
        parseScoringNoteSetsJson(incoming.scoring_note_sets ?? existing.scoring_note_sets),
      ) ||
    (existing.boss_image ?? '') !== (incoming.boss_image ?? '') ||
    existingBase !== incomingBase ||
    normalizeStaggerMultiplier(existing.stagger_multiplier) !==
      normalizeStaggerMultiplier(incoming.stagger_multiplier) ||
    normalizeStaggerTime(existing.stagger_time) !== normalizeStaggerTime(incoming.stagger_time) ||
    normalizeAnomalyBarCoefficient(existing.anomaly_bar_coefficient) !==
      normalizeAnomalyBarCoefficient(incoming.anomaly_bar_coefficient) ||
    JSON.stringify(existing.field_buff_sets ?? []) !==
      JSON.stringify(parseFieldBuffSetsJson(incoming.field_buff_sets)) ||
    JSON.stringify(existing.weakness_sets ?? []) !==
      JSON.stringify(parseWeaknessSetsJson(incoming.weakness_sets))
  )
}

/**
 * 读路径映射：异常条系数按「boss_info 覆盖值 > 内置默认表」物化（见 utils/anomalyBarCoefficient.js）。
 * 写路径回读原行时传 `resolveAnomalyBarDefault: false`：库里存什么就是什么，不把默认值写进库。
 */
function mapBossInfoRow(row, { resolveAnomalyBarDefault = true } = {}) {
  if (!row) return null
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
  const mirrored = mirrorFieldBuffLegacyColumns(sets)
  return {
    ...row,
    stagger_multiplier: normalizeStaggerMultiplier(row.stagger_multiplier),
    stagger_time: normalizeStaggerTime(row.stagger_time),
    anomaly_bar_coefficient: resolveAnomalyBarDefault
      ? resolveAnomalyBarCoefficient(
          row.boss_name,
          // DECIMAL 列经 mysql2 返回字符串，先归一化成数字再作为「显式覆盖值」传入
          normalizeAnomalyBarCoefficient(row.anomaly_bar_coefficient),
        )
      : normalizeAnomalyBarCoefficient(row.anomaly_bar_coefficient),
    crisis_base_hp:
      row.crisis_base_hp == null ? getCrisisBaseHpByName(row.boss_name) : Number(row.crisis_base_hp),
    field_buff_sets: sets,
    field_buff_name: mirrored.field_buff_name,
    field_buff_text: mirrored.field_buff_text,
    field_buff_image: mirrored.field_buff_image,
    field_buff_effect_blocks: parseEffectBlocksJson(mirrored.field_buff_effect_blocks),
    /** 得分机制多套：新列为准，缺省时把旧单列合成一套 */
    scoring_note_sets: parseScoringNoteSetsJson(row.scoring_note_sets).length
      ? parseScoringNoteSetsJson(row.scoring_note_sets)
      : scoringNoteSetsFromLegacy(row.scoring_note),
    weakness_sets: parseWeaknessSetsJson(row.weakness_sets).length
      ? parseWeaknessSetsJson(row.weakness_sets)
      : weaknessSetsFromLegacy(row),
  }
}

function preferFieldBuffSetImages(nextSetsSerialized, existingSets) {
  const next = parseFieldBuffSetsJson(nextSetsSerialized)
  const prevById = new Map((existingSets || []).map((item) => [item.id, item]))
  return next.map((set) => ({
    ...set,
    image: preferExistingImage(set.image, prevById.get(set.id)?.image ?? null),
  }))
}

function mapBossInfoWriteResult(info) {
  const sets = parseFieldBuffSetsJson(info.field_buff_sets)
  const weaknessSets = parseWeaknessSetsJson(info.weakness_sets)
  return {
    ...info,
    field_buff_sets: sets,
    field_buff_effect_blocks: parseEffectBlocksJson(info.field_buff_effect_blocks),
    weakness_sets: weaknessSets.length ? weaknessSets : weaknessSetsFromLegacy(info),
    _setsProvided: undefined,
    _weaknessSetsProvided: undefined,
  }
}

/**
 * 按名称取单个基础库记录。
 * @param {string} bossName
 * @param {{ resolveAnomalyBarDefault?: boolean }} [options] 写路径回读原值用 false（见 mapBossInfoRow）
 */
export async function findBossInfoByName(bossName, { resolveAnomalyBarDefault = true } = {}) {
  await ensureBossStaggerSchema()
  await ensureBossAnomalySchema()
  await ensureBossScoringNoteSchema()
  await ensureBossResistanceSchema()
  await ensureEnvironmentBuffSchema()
  const name = String(bossName ?? '').trim()
  if (!name) return null

  const [rows] = await pool.execute(
    `SELECT ${BOSS_INFO_COLUMNS}
     FROM boss_info
     WHERE boss_name = ?
     LIMIT 1`,
    [name],
  )

  return mapBossInfoRow(rows[0], { resolveAnomalyBarDefault })
}

export async function listBossInfoByNames(names) {
  await ensureBossStaggerSchema()
  await ensureBossAnomalySchema()
  await ensureBossScoringNoteSchema()
  await ensureBossResistanceSchema()
  await ensureEnvironmentBuffSchema()
  const unique = [...new Set((names || []).map((name) => String(name ?? '').trim()).filter(Boolean))]
  if (!unique.length) return []

  const items = []
  for (let i = 0; i < unique.length; i += 80) {
    const chunk = unique.slice(i, i + 80)
    const placeholders = chunk.map(() => '?').join(',')
    const [rows] = await pool.execute(
      `SELECT ${BOSS_INFO_COLUMNS}
       FROM boss_info
       WHERE boss_name IN (${placeholders})`,
      chunk,
    )
    items.push(...rows.map((row) => mapBossInfoRow(row)))
  }
  return items
}

export async function searchBossInfoNames(keyword, limit = 20) {
  await ensureBossStaggerSchema()
  await ensureBossAnomalySchema()
  await ensureBossScoringNoteSchema()
  await ensureBossResistanceSchema()
  const query = String(keyword ?? '').trim()
  if (!query) return []

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50)

  const [rows] = await pool.execute(
    `SELECT boss_name
     FROM boss_info
     WHERE boss_name LIKE ?
     ORDER BY boss_name
     LIMIT ${safeLimit}`,
    [`%${query}%`],
  )

  return rows.map((row) => row.boss_name)
}

export async function listBossInfoRecords({
  keyword = '',
  limit = 100,
  offset = 0,
  catalog = 'all',
} = {}) {
  await ensureBossStaggerSchema()
  await ensureBossAnomalySchema()
  await ensureBossScoringNoteSchema()
  await ensureBossResistanceSchema()
  await ensureEnvironmentBuffSchema()
  await ensureContentModeColumns(pool)

  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500)
  const safeOffset = Math.max(Number(offset) || 0, 0)
  const conditions = []
  const params = []

  if (String(keyword ?? '').trim()) {
    conditions.push('boss_name LIKE ?')
    params.push(`%${String(keyword).trim()}%`)
  }

  const catalogKey = String(catalog || 'all').trim().toLowerCase()
  // 按 boss.mode 归属：危局 / 防卫战 / 临界推演（不再仅靠 ID 位数，避免推演混入危局）
  if (BOSS_INFO_CATALOGS.has(catalogKey)) {
    conditions.push(`boss_name IN (
      SELECT DISTINCT boss_name FROM boss
      WHERE boss_name IS NOT NULL AND boss_name <> ''
        AND mode = ?
    )`)
    params.push(catalogKey)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const [rows] = await pool.execute(
    `SELECT ${BOSS_INFO_COLUMNS}
     FROM boss_info
     ${where}
     ORDER BY boss_name
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params,
  )

  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM boss_info ${where}`,
    params,
  )

  return {
    items: rows.map((row) => mapBossInfoRow(row)),
    total: Number(countRows[0]?.total ?? 0),
    limit: safeLimit,
    offset: safeOffset,
    catalog: BOSS_INFO_CATALOGS.has(catalogKey) ? catalogKey : 'all',
  }
}

export async function updateBossInfoById(id, payload) {
  await ensureBossStaggerSchema()
  await ensureBossAnomalySchema()
  await ensureBossScoringNoteSchema()
  await ensureBossResistanceSchema()
  await ensureEnvironmentBuffSchema()
  const bossId = Number(id)
  if (!Number.isInteger(bossId) || bossId <= 0) {
    throw new Error('无效的 boss_info ID')
  }

  const info = normalizeBossInfo({ ...payload, boss_name: payload.boss_name })
  if (!info.boss_name) {
    throw new Error('boss_name 不能为空')
  }

  const [existingRows] = await pool.execute(
    `SELECT ${BOSS_INFO_COLUMNS}
     FROM boss_info WHERE id = ? LIMIT 1`,
    [bossId],
  )
  // 写路径回读：异常条系数取库中原值，不物化内置默认（否则「未填」会被写成默认值落库）
  const existing = mapBossInfoRow(existingRows[0], { resolveAnomalyBarDefault: false })
  if (!existing) {
    throw new Error('boss_info 不存在')
  }

  if (info.boss_name !== existing.boss_name) {
    const duplicate = await findBossInfoByName(info.boss_name)
    if (duplicate && duplicate.id !== bossId) {
      throw new Error('怪物名称已被其他基础库记录占用')
    }
  }

  if (info.crisis_base_hp == null && existing.crisis_base_hp != null) {
    info.crisis_base_hp = Number(existing.crisis_base_hp)
  }
  if (info.stagger_time == null && existing.stagger_time != null) {
    info.stagger_time = normalizeStaggerTime(existing.stagger_time)
  }
  if (info.anomaly_bar_coefficient == null && existing.anomaly_bar_coefficient != null) {
    info.anomaly_bar_coefficient = normalizeAnomalyBarCoefficient(existing.anomaly_bar_coefficient)
  }

  // 未传场地 Buff（多套或旧四列）时保留原多套
  if (!info._setsProvided) {
    info.field_buff_sets = serializeFieldBuffSets(existing.field_buff_sets)
    const legacy = mirrorFieldBuffLegacyColumns(existing.field_buff_sets)
    info.field_buff_name = legacy.field_buff_name
    info.field_buff_text = legacy.field_buff_text
    info.field_buff_image = legacy.field_buff_image
    info.field_buff_effect_blocks = legacy.field_buff_effect_blocks
  } else {
    const mergedSets = preferFieldBuffSetImages(info.field_buff_sets, existing.field_buff_sets)
    info.field_buff_sets = serializeFieldBuffSets(mergedSets)
    const legacy = mirrorFieldBuffLegacyColumns(mergedSets)
    info.field_buff_name = legacy.field_buff_name
    info.field_buff_text = legacy.field_buff_text
    info.field_buff_image = legacy.field_buff_image
    info.field_buff_effect_blocks = legacy.field_buff_effect_blocks
  }

  // 未传弱点/抗性多套时保留库中原值（期数同步 / 导入通常不带）
  if (!info._weaknessSetsProvided) {
    info.weakness_sets = serializeWeaknessSets(existing.weakness_sets)
    if (info.weakness == null) info.weakness = existing.weakness
    if (info.resistance == null) info.resistance = existing.resistance
    if (info.resistance_high == null) info.resistance_high = existing.resistance_high
  }

  // 得分机制多套：未传时沿用库中原值；旧单列镜像第一套文本
  if (info.scoring_note_sets === undefined) {
    info.scoring_note_sets = existing.scoring_note_sets ?? null
  }
  const scoringSets = parseScoringNoteSetsJson(info.scoring_note_sets)
  info.scoring_note_sets = serializeScoringNoteSets(scoringSets)
  info.scoring_note = mirrorScoringNoteLegacy(scoringSets)

  info.boss_image = preferExistingImage(info.boss_image, existing.boss_image)

  await pool.execute(
    `UPDATE boss_info
     SET boss_name = ?, defense = ?, level = ?, boss_image = ?, weakness = ?, resistance = ?, resistance_high = ?, scoring_note = ?, scoring_note_sets = ?,
         crisis_base_hp = ?, stagger_multiplier = ?, stagger_time = ?, anomaly_bar_coefficient = ?,
         field_buff_name = ?, field_buff_text = ?, field_buff_image = ?, field_buff_effect_blocks = ?,
         field_buff_sets = ?, weakness_sets = ?
     WHERE id = ?`,
    [
      info.boss_name,
      info.defense,
      info.level,
      info.boss_image,
      info.weakness,
      info.resistance,
      info.resistance_high,
      info.scoring_note,
      info.scoring_note_sets,
      info.crisis_base_hp,
      info.stagger_multiplier,
      info.stagger_time,
      info.anomaly_bar_coefficient,
      info.field_buff_name,
      info.field_buff_text,
      info.field_buff_image,
      info.field_buff_effect_blocks,
      info.field_buff_sets,
      info.weakness_sets,
      bossId,
    ],
  )

  // 改名同步：名称是跨表业务键，各期（boss 表）仍挂旧名时基础数据会「对不上」
  let renamedPeriods = 0
  let updatedPeriodImages = 0
  if (payload.rename_periods === true && existing.boss_name !== info.boss_name) {
    const [renamed] = await pool.execute(
      `UPDATE boss SET boss_name = ? WHERE boss_name = ?`,
      [info.boss_name, existing.boss_name],
    )
    renamedPeriods = Number(renamed.affectedRows) || 0
    if (existing.boss_image && info.boss_image && existing.boss_image !== info.boss_image) {
      const [images] = await pool.execute(
        `UPDATE boss SET boss_image = ? WHERE boss_name = ? AND boss_image = ?`,
        [info.boss_image, info.boss_name, existing.boss_image],
      )
      updatedPeriodImages = Number(images.affectedRows) || 0
    }
  }

  return {
    action: 'updated',
    id: bossId,
    renamedPeriods,
    updatedPeriodImages,
    ...mapBossInfoWriteResult(info),
  }
}

export async function upsertBossInfo(payload) {
  await ensureBossStaggerSchema()
  await ensureBossAnomalySchema()
  await ensureBossScoringNoteSchema()
  await ensureBossResistanceSchema()
  await ensureEnvironmentBuffSchema()
  const info = normalizeBossInfo(payload)
  if (!info.boss_name) {
    throw new Error('boss_name 不能为空')
  }

  // 写路径回读：异常条系数取库中原值，不物化内置默认（同步类 upsert 只做「原值保留」）
  const existing = await findBossInfoByName(info.boss_name, { resolveAnomalyBarDefault: false })

  if (!existing) {
    const [result] = await pool.execute(
      `INSERT INTO boss_info (
         boss_name, defense, level, boss_image, weakness, resistance, resistance_high, scoring_note, scoring_note_sets, crisis_base_hp, stagger_multiplier, stagger_time, anomaly_bar_coefficient,
         field_buff_name, field_buff_text, field_buff_image, field_buff_effect_blocks, field_buff_sets, weakness_sets
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        info.boss_name,
        info.defense,
        info.level,
        info.boss_image,
        info.weakness,
        info.resistance,
        info.resistance_high,
        info.scoring_note,
        info.scoring_note_sets,
        info.crisis_base_hp,
        info.stagger_multiplier,
        info.stagger_time,
        info.anomaly_bar_coefficient,
        info.field_buff_name,
        info.field_buff_text,
        info.field_buff_image,
        info.field_buff_effect_blocks,
        info.field_buff_sets,
        info.weakness_sets,
      ].map((value) => (value === undefined ? null : value)),
    )

    return {
      action: 'created',
      id: result.insertId,
      ...mapBossInfoWriteResult(info),
    }
  }

  // Keep existing base HP if incoming didn't provide one
  if (info.crisis_base_hp == null && existing.crisis_base_hp != null) {
    info.crisis_base_hp = Number(existing.crisis_base_hp)
  }
  if (info.stagger_time == null && existing.stagger_time != null) {
    info.stagger_time = normalizeStaggerTime(existing.stagger_time)
  }
  // 同步类 upsert（各期录入 / 快照导入）通常不带异常条系数：保留已存值
  if (info.anomaly_bar_coefficient == null && existing.anomaly_bar_coefficient != null) {
    info.anomaly_bar_coefficient = normalizeAnomalyBarCoefficient(existing.anomaly_bar_coefficient)
  }

  // 期数同步 upsert 通常不带场地 Buff：保留已有多套
  if (!info._setsProvided) {
    info.field_buff_sets = serializeFieldBuffSets(existing.field_buff_sets)
    const legacy = mirrorFieldBuffLegacyColumns(existing.field_buff_sets)
    info.field_buff_name = legacy.field_buff_name
    info.field_buff_text = legacy.field_buff_text
    info.field_buff_image = legacy.field_buff_image
    info.field_buff_effect_blocks = legacy.field_buff_effect_blocks
  } else {
    const mergedSets = preferFieldBuffSetImages(info.field_buff_sets, existing.field_buff_sets)
    info.field_buff_sets = serializeFieldBuffSets(mergedSets)
    const legacy = mirrorFieldBuffLegacyColumns(mergedSets)
    info.field_buff_name = legacy.field_buff_name
    info.field_buff_text = legacy.field_buff_text
    info.field_buff_image = legacy.field_buff_image
    info.field_buff_effect_blocks = legacy.field_buff_effect_blocks
  }

  // 未传弱点/抗性多套时保留库中原值（期数同步 / 导入通常不带）
  if (!info._weaknessSetsProvided) {
    info.weakness_sets = serializeWeaknessSets(existing.weakness_sets)
    if (info.weakness == null) info.weakness = existing.weakness
    if (info.resistance == null) info.resistance = existing.resistance
    if (info.resistance_high == null) info.resistance_high = existing.resistance_high
  }

  // 得分机制多套：未传时沿用库中原值；旧单列镜像第一套文本
  if (info.scoring_note_sets === undefined) {
    info.scoring_note_sets = existing.scoring_note_sets ?? null
  }
  const scoringSets = parseScoringNoteSetsJson(info.scoring_note_sets)
  info.scoring_note_sets = serializeScoringNoteSets(scoringSets)
  info.scoring_note = mirrorScoringNoteLegacy(scoringSets)

  // JSON 导入只带路径不带文件：缺文件时保留已有图，避免再次裂图
  info.boss_image = preferExistingImage(info.boss_image, existing.boss_image)

  if (!bossInfoDiffers(existing, info)) {
    return {
      action: 'unchanged',
      id: existing.id,
      ...mapBossInfoRow({
        ...existing,
        ...info,
        field_buff_sets: info.field_buff_sets,
        field_buff_effect_blocks: info.field_buff_effect_blocks,
      }),
    }
  }

  await pool.execute(
    `UPDATE boss_info
     SET defense = ?, level = ?, boss_image = ?, weakness = ?, resistance = ?, resistance_high = ?, scoring_note = ?, scoring_note_sets = ?, crisis_base_hp = ?, stagger_multiplier = ?, stagger_time = ?, anomaly_bar_coefficient = ?,
         field_buff_name = ?, field_buff_text = ?, field_buff_image = ?, field_buff_effect_blocks = ?,
         field_buff_sets = ?, weakness_sets = ?
     WHERE id = ?`,
    [
      info.defense,
      info.level,
      info.boss_image,
      info.weakness,
      info.resistance,
      info.resistance_high,
      info.scoring_note,
      info.scoring_note_sets,
      info.crisis_base_hp,
      info.stagger_multiplier,
      info.stagger_time,
      info.anomaly_bar_coefficient,
      info.field_buff_name,
      info.field_buff_text,
      info.field_buff_image,
      info.field_buff_effect_blocks,
      info.field_buff_sets,
      info.weakness_sets,
      existing.id,
    ].map((value) => (value === undefined ? null : value)),
  )

  return {
    action: 'updated',
    id: existing.id,
    ...mapBossInfoWriteResult(info),
  }
}

export async function deleteBossInfoById(id) {
  await ensureBossStaggerSchema()
  await ensureBossAnomalySchema()
  await ensureBossScoringNoteSchema()
  await ensureBossResistanceSchema()
  await ensureEnvironmentBuffSchema()
  const bossId = Number(id)
  if (!Number.isInteger(bossId) || bossId <= 0) {
    throw new Error('无效的 boss_info ID')
  }

  const [existingRows] = await pool.execute(
    `SELECT ${BOSS_INFO_COLUMNS}
     FROM boss_info WHERE id = ? LIMIT 1`,
    [bossId],
  )
  const existing = mapBossInfoRow(existingRows[0])
  if (!existing) {
    throw new Error('boss_info 不存在')
  }

  const [refRows] = await pool.execute(
    `SELECT COUNT(*) AS c FROM boss WHERE boss_name = ?`,
    [existing.boss_name],
  )
  const referencedCount = Number(refRows[0]?.c ?? 0)

  await pool.execute(`DELETE FROM boss_info WHERE id = ?`, [bossId])

  return {
    action: 'deleted',
    id: bossId,
    boss_name: existing.boss_name,
    referenced_count: referencedCount,
  }
}

/**
 * 从 boss 表回填 / 修正 boss_info：
 * - 临界等模式里有、基础库没有的名字 → 新建
 * - 基础库仍是游戏包 /UI/ 路径、boss 表已有本地 /boss_image/ → 改成可用路径
 *
 * @param {{ mode?: string|null }} [options]
 */
export async function syncBossInfoFromBoss({ mode = null } = {}) {
  await ensureBossStaggerSchema()
  await ensureBossAnomalySchema()
  await ensureBossScoringNoteSchema()
  await ensureBossResistanceSchema()
  await ensureEnvironmentBuffSchema()
  await ensureContentModeColumns(pool)

  const modeKey = String(mode || '').trim().toLowerCase()
  const modeFilter =
    modeKey === 'crisis' || modeKey === 'defense' || modeKey === 'deduction' ? modeKey : null

  const params = []
  let sql = `
    SELECT boss_name,
           MAX(hp) AS hp,
           MAX(defense) AS defense,
           MAX(level) AS level,
           MAX(weakness) AS weakness,
           MAX(resistance) AS resistance,
           MAX(resistance_high) AS resistance_high,
           GROUP_CONCAT(DISTINCT NULLIF(TRIM(boss_image), '') ORDER BY boss_image SEPARATOR '\\n') AS images
    FROM boss
    WHERE boss_name IS NOT NULL AND TRIM(boss_name) <> ''
  `
  if (modeFilter) {
    sql += ` AND mode = ?`
    params.push(modeFilter)
  }
  sql += ` GROUP BY boss_name ORDER BY boss_name`

  const [rows] = await pool.execute(sql, params)
  let created = 0
  let updatedImage = 0
  let unchanged = 0

  for (const row of rows) {
    const name = String(row.boss_name).trim()
    if (!name) continue
    const imageCandidates = String(row.images || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)

    const existing = await findBossInfoByName(name)
    const bestImage = pickBestImagePath(...imageCandidates, existing?.boss_image)

    if (!existing) {
      await upsertBossInfo({
        boss_name: name,
        defense: Number(row.defense) || 0,
        level: Number(row.level) || 1,
        weakness: row.weakness ?? null,
        resistance: row.resistance ?? null,
        resistance_high: row.resistance_high ?? null,
        boss_image: bestImage,
      })
      created += 1
      continue
    }

    const prevImage = existing.boss_image ?? null
    const nextImage = pickBestImagePath(...imageCandidates, prevImage)
    if (nextImage && nextImage !== prevImage) {
      await pool.execute(`UPDATE boss_info SET boss_image = ? WHERE id = ?`, [
        nextImage,
        existing.id,
      ])
      updatedImage += 1
      continue
    }

    unchanged += 1
  }

  return {
    mode: modeFilter,
    scanned: rows.length,
    created,
    updatedImage,
    unchanged,
  }
}
