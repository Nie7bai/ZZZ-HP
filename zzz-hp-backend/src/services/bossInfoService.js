import pool from '../config/db.js'
import { getCrisisBaseHpByName } from '../utils/crisisHpCoeff.js'
import {
  DEFAULT_BOSS_STAGGER_MULTIPLIER,
  ensureBossStaggerSchema,
  normalizeStaggerMultiplier,
} from '../utils/bossSchema.js'
import {
  ensureEnvironmentBuffSchema,
  parseEffectBlocksJson,
  serializeEffectBlocks,
} from '../utils/environmentBuffSchema.js'

const BOSS_INFO_COLUMNS = `id, boss_name, defense, level, boss_image, weakness, resistance, crisis_base_hp, stagger_multiplier,
  field_buff_name, field_buff_text, field_buff_image, field_buff_effect_blocks`

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

  return {
    boss_name: String(payload.boss_name ?? '').trim(),
    defense: Number(payload.defense ?? 0),
    level: Number(payload.level ?? 1),
    weakness: asText(payload.weakness),
    resistance: asText(payload.resistance),
    boss_image: asText(payload.boss_image),
    crisis_base_hp,
    stagger_multiplier: normalizeStaggerMultiplier(
      payload.stagger_multiplier,
      DEFAULT_BOSS_STAGGER_MULTIPLIER,
    ),
    field_buff_name: asText(payload.field_buff_name),
    field_buff_text: asText(payload.field_buff_text),
    field_buff_image: asText(payload.field_buff_image),
    field_buff_effect_blocks: serializeEffectBlocks(payload.field_buff_effect_blocks),
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
    (existing.boss_image ?? '') !== (incoming.boss_image ?? '') ||
    existingBase !== incomingBase ||
    normalizeStaggerMultiplier(existing.stagger_multiplier) !==
      normalizeStaggerMultiplier(incoming.stagger_multiplier) ||
    (existing.field_buff_name ?? '') !== (incoming.field_buff_name ?? '') ||
    (existing.field_buff_text ?? '') !== (incoming.field_buff_text ?? '') ||
    (existing.field_buff_image ?? '') !== (incoming.field_buff_image ?? '') ||
    JSON.stringify(existing.field_buff_effect_blocks ?? null) !==
      JSON.stringify(parseEffectBlocksJson(incoming.field_buff_effect_blocks))
  )
}

function mapBossInfoRow(row) {
  if (!row) return null
  return {
    ...row,
    stagger_multiplier: normalizeStaggerMultiplier(row.stagger_multiplier),
    crisis_base_hp:
      row.crisis_base_hp == null ? getCrisisBaseHpByName(row.boss_name) : Number(row.crisis_base_hp),
    field_buff_name: row.field_buff_name ?? null,
    field_buff_text: row.field_buff_text ?? null,
    field_buff_image: row.field_buff_image ?? null,
    field_buff_effect_blocks: parseEffectBlocksJson(row.field_buff_effect_blocks),
  }
}

export async function findBossInfoByName(bossName) {
  await ensureBossStaggerSchema()
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

  return mapBossInfoRow(rows[0])
}

export async function listBossInfoByNames(names) {
  await ensureBossStaggerSchema()
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
  await ensureEnvironmentBuffSchema()
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500)
  const safeOffset = Math.max(Number(offset) || 0, 0)
  const conditions = []
  const params = []

  if (String(keyword ?? '').trim()) {
    conditions.push('boss_name LIKE ?')
    params.push(`%${String(keyword).trim()}%`)
  }

  const catalogKey = String(catalog || 'all').trim().toLowerCase()
  // 防卫战 boss.id 为 9 位；危局为其它数字 ID
  if (catalogKey === 'crisis') {
    conditions.push(`boss_name IN (
      SELECT DISTINCT boss_name FROM boss
      WHERE boss_name IS NOT NULL AND boss_name <> ''
        AND (id < 100000000 OR id >= 1000000000)
    )`)
  } else if (catalogKey === 'defense') {
    conditions.push(`boss_name IN (
      SELECT DISTINCT boss_name FROM boss
      WHERE boss_name IS NOT NULL AND boss_name <> ''
        AND id >= 100000000 AND id < 1000000000
    )`)
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
    catalog: catalogKey === 'crisis' || catalogKey === 'defense' ? catalogKey : 'all',
  }
}

export async function updateBossInfoById(id, payload) {
  await ensureBossStaggerSchema()
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
  const existing = mapBossInfoRow(existingRows[0])
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

  // 未传场地 Buff 字段时保留原值
  if (!('field_buff_name' in payload) && existing.field_buff_name != null) {
    info.field_buff_name = existing.field_buff_name
  }
  if (!('field_buff_text' in payload) && existing.field_buff_text != null) {
    info.field_buff_text = existing.field_buff_text
  }
  if (!('field_buff_image' in payload) && existing.field_buff_image != null) {
    info.field_buff_image = existing.field_buff_image
  }
  if (!('field_buff_effect_blocks' in payload) && existing.field_buff_effect_blocks != null) {
    info.field_buff_effect_blocks = serializeEffectBlocks(existing.field_buff_effect_blocks)
  }

  await pool.execute(
    `UPDATE boss_info
     SET boss_name = ?, defense = ?, level = ?, boss_image = ?, weakness = ?, resistance = ?,
         crisis_base_hp = ?, stagger_multiplier = ?,
         field_buff_name = ?, field_buff_text = ?, field_buff_image = ?, field_buff_effect_blocks = ?
     WHERE id = ?`,
    [
      info.boss_name,
      info.defense,
      info.level,
      info.boss_image,
      info.weakness,
      info.resistance,
      info.crisis_base_hp,
      info.stagger_multiplier,
      info.field_buff_name,
      info.field_buff_text,
      info.field_buff_image,
      info.field_buff_effect_blocks,
      bossId,
    ],
  )

  return {
    action: 'updated',
    id: bossId,
    ...info,
    field_buff_effect_blocks: parseEffectBlocksJson(info.field_buff_effect_blocks),
  }
}

export async function upsertBossInfo(payload) {
  await ensureBossStaggerSchema()
  await ensureEnvironmentBuffSchema()
  const info = normalizeBossInfo(payload)
  if (!info.boss_name) {
    throw new Error('boss_name 不能为空')
  }

  const existing = await findBossInfoByName(info.boss_name)

  if (!existing) {
    const [result] = await pool.execute(
      `INSERT INTO boss_info (
         boss_name, defense, level, boss_image, weakness, resistance, crisis_base_hp, stagger_multiplier,
         field_buff_name, field_buff_text, field_buff_image, field_buff_effect_blocks
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        info.boss_name,
        info.defense,
        info.level,
        info.boss_image,
        info.weakness,
        info.resistance,
        info.crisis_base_hp,
        info.stagger_multiplier,
        info.field_buff_name,
        info.field_buff_text,
        info.field_buff_image,
        info.field_buff_effect_blocks,
      ],
    )

    return {
      action: 'created',
      id: result.insertId,
      ...info,
      field_buff_effect_blocks: parseEffectBlocksJson(info.field_buff_effect_blocks),
    }
  }

  // Keep existing base HP if incoming didn't provide one
  if (info.crisis_base_hp == null && existing.crisis_base_hp != null) {
    info.crisis_base_hp = Number(existing.crisis_base_hp)
  }

  // 期数同步 upsert 通常不带场地 Buff：保留已有场地 Buff
  if (!('field_buff_name' in payload)) {
    info.field_buff_name = existing.field_buff_name
    info.field_buff_text = existing.field_buff_text
    info.field_buff_image = existing.field_buff_image
    info.field_buff_effect_blocks = serializeEffectBlocks(existing.field_buff_effect_blocks)
  }

  if (!bossInfoDiffers(existing, info)) {
    return {
      action: 'unchanged',
      id: existing.id,
      ...mapBossInfoRow({ ...existing, ...info, field_buff_effect_blocks: info.field_buff_effect_blocks }),
    }
  }

  await pool.execute(
    `UPDATE boss_info
     SET defense = ?, level = ?, boss_image = ?, weakness = ?, resistance = ?, crisis_base_hp = ?, stagger_multiplier = ?,
         field_buff_name = ?, field_buff_text = ?, field_buff_image = ?, field_buff_effect_blocks = ?
     WHERE id = ?`,
    [
      info.defense,
      info.level,
      info.boss_image,
      info.weakness,
      info.resistance,
      info.crisis_base_hp,
      info.stagger_multiplier,
      info.field_buff_name,
      info.field_buff_text,
      info.field_buff_image,
      info.field_buff_effect_blocks,
      existing.id,
    ],
  )

  return {
    action: 'updated',
    id: existing.id,
    ...info,
    field_buff_effect_blocks: parseEffectBlocksJson(info.field_buff_effect_blocks),
  }
}
