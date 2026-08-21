import pool from '../config/db.js'

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

function makeFieldBuffSetId() {
  return `set_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 将单套或旧四列规范成 field_buff_sets 元素 */
export function normalizeFieldBuffSet(raw, fallbackId = 'legacy') {
  if (!raw || typeof raw !== 'object') return null
  const name = String(raw.name ?? raw.field_buff_name ?? '').trim()
  const text = String(raw.text ?? raw.field_buff_text ?? '').trim()
  const image = String(raw.image ?? raw.imageUrl ?? raw.field_buff_image ?? '').trim() || null
  const effectBlocks = parseEffectBlocksJson(
    raw.effectBlocks ?? raw.effect_blocks ?? raw.field_buff_effect_blocks,
  )
  const hasBlocks = Array.isArray(effectBlocks) && effectBlocks.length > 0
  if (!name && !text && !image && !hasBlocks) return null
  const id = String(raw.id ?? '').trim() || fallbackId
  const label = String(raw.label ?? '').trim() || null
  return {
    id,
    label,
    name: name || '场地 Buff',
    text,
    image,
    effectBlocks: hasBlocks ? effectBlocks : null,
  }
}

export function parseFieldBuffSetsJson(value) {
  if (value == null || value === '') return []
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []
  const out = []
  const seen = new Set()
  for (let i = 0; i < parsed.length; i += 1) {
    const set = normalizeFieldBuffSet(parsed[i], `set_${i + 1}`)
    if (!set) continue
    let id = set.id
    if (seen.has(id)) id = makeFieldBuffSetId()
    seen.add(id)
    out.push({ ...set, id })
  }
  return out
}

export function serializeFieldBuffSets(value) {
  const sets = parseFieldBuffSetsJson(value)
  if (!sets.length) return null
  try {
    return JSON.stringify(JSON.parse(JSON.stringify(sets)))
  } catch {
    return null
  }
}

/** 从多套 + 可选绑定 id 解析出对外展示的单套 field_buff */
export function resolveFieldBuffFromSets(sets, setId) {
  const list = Array.isArray(sets) ? sets : parseFieldBuffSetsJson(sets)
  if (!list.length) return null
  const wanted = String(setId ?? '').trim()
  const hit = wanted ? list.find((item) => item.id === wanted) : null
  const picked = hit || list.find((item) => item.id === 'legacy') || list[0]
  if (!picked) return null
  return {
    name: picked.name,
    text: picked.text ?? '',
    image: picked.image ?? null,
    effectBlocks: picked.effectBlocks ?? null,
  }
}

/** 用第一套回写旧四列镜像 */
export function mirrorFieldBuffLegacyColumns(sets) {
  const list = Array.isArray(sets) ? sets : parseFieldBuffSetsJson(sets)
  const first = list[0]
  if (!first) {
    return {
      field_buff_name: null,
      field_buff_text: null,
      field_buff_image: null,
      field_buff_effect_blocks: null,
    }
  }
  return {
    field_buff_name: first.name || null,
    field_buff_text: first.text || null,
    field_buff_image: first.image || null,
    field_buff_effect_blocks: serializeEffectBlocks(first.effectBlocks),
  }
}

/** 危局/防卫 Buff 结构化效果 + Boss 场地 Buff（挂 boss_info） */
export async function ensureEnvironmentBuffSchema() {
  if (schemaEnsured) return

  if (!(await columnExists('buff', 'effect_blocks'))) {
    await pool.query(
      `ALTER TABLE buff
       ADD COLUMN effect_blocks JSON NULL COMMENT '计算器结构化效果块（BuffEffectBlock[]）'`,
    )
  }

  if (!(await columnExists('boss_info', 'field_buff_name'))) {
    await pool.query(
      `ALTER TABLE boss_info
       ADD COLUMN field_buff_name VARCHAR(100) NULL COMMENT 'Boss 场地 Buff 名称'`,
    )
  }
  if (!(await columnExists('boss_info', 'field_buff_text'))) {
    await pool.query(
      `ALTER TABLE boss_info
       ADD COLUMN field_buff_text TEXT NULL COMMENT 'Boss 场地 Buff 文本说明'`,
    )
  }
  if (!(await columnExists('boss_info', 'field_buff_image'))) {
    await pool.query(
      `ALTER TABLE boss_info
       ADD COLUMN field_buff_image VARCHAR(500) NULL COMMENT 'Boss 场地 Buff 图片'`,
    )
  }
  if (!(await columnExists('boss_info', 'field_buff_effect_blocks'))) {
    await pool.query(
      `ALTER TABLE boss_info
       ADD COLUMN field_buff_effect_blocks JSON NULL COMMENT 'Boss 场地 Buff 结构化效果块'`,
    )
  }
  if (!(await columnExists('boss_info', 'field_buff_sets'))) {
    await pool.query(
      `ALTER TABLE boss_info
       ADD COLUMN field_buff_sets JSON NULL COMMENT '危局 Boss 场地 Buff 多套（id/name/text/image/effectBlocks）'`,
    )
  }
  if (!(await columnExists('boss', 'field_buff_set_id'))) {
    await pool.query(
      `ALTER TABLE boss
       ADD COLUMN field_buff_set_id VARCHAR(64) NULL COMMENT '危局当期绑定的场地 Buff 套 id（boss_info.field_buff_sets）'`,
    )
  }

  // 旧单套 → field_buff_sets（仅当 sets 为空且旧列有内容）
  try {
    const [legacyRows] = await pool.execute(
      `SELECT id, field_buff_name, field_buff_text, field_buff_image, field_buff_effect_blocks, field_buff_sets
       FROM boss_info
       WHERE field_buff_sets IS NULL`,
    )
    for (const row of legacyRows) {
      const set = normalizeFieldBuffSet(
        {
          id: 'legacy',
          name: row.field_buff_name,
          text: row.field_buff_text,
          image: row.field_buff_image,
          effectBlocks: parseEffectBlocksJson(row.field_buff_effect_blocks),
        },
        'legacy',
      )
      if (!set) continue
      try {
        await pool.execute(`UPDATE boss_info SET field_buff_sets = ? WHERE id = ?`, [
          JSON.stringify([set]),
          row.id,
        ])
      } catch (err) {
        console.warn('[environmentBuff] migrate field_buff_sets skip id=', row.id, err.message)
      }
    }
  } catch (err) {
    console.warn('[environmentBuff] migrate field_buff_sets failed:', err.message)
  }

  schemaEnsured = true
}

export function parseEffectBlocksJson(value) {
  if (value == null || value === '') return null
  if (Array.isArray(value)) return value
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function serializeEffectBlocks(value) {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    try {
      const parsed = JSON.parse(trimmed)
      return Array.isArray(parsed) && parsed.length ? JSON.stringify(parsed) : null
    } catch {
      return null
    }
  }
  if (Array.isArray(value)) {
    if (!value.length) return null
    try {
      // 去掉 undefined / 不可序列化字段，避免写入 JSON 列失败
      return JSON.stringify(JSON.parse(JSON.stringify(value)))
    } catch {
      return null
    }
  }
  return null
}
