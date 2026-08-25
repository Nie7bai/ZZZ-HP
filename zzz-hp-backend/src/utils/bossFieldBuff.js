/**
 * Boss 场地 Buff 套：按怪物名加载，供危局 / 临界层解析。
 */
import pool from '../config/db.js'
import {
  ensureEnvironmentBuffSchema,
  normalizeFieldBuffSet,
  parseEffectBlocksJson,
  parseFieldBuffSetsJson,
  resolveFieldBuffFromSets,
} from './environmentBuffSchema.js'

export function normalizeBossNameKey(name) {
  return String(name ?? '')
    .replace(/[「」『』\s]/g, '')
    .replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]/g, (ch) => {
      const map = {
        Ⅰ: 'I',
        Ⅱ: 'II',
        Ⅲ: 'III',
        Ⅳ: 'IV',
        Ⅴ: 'V',
        Ⅵ: 'VI',
        Ⅶ: 'VII',
        Ⅷ: 'VIII',
        Ⅸ: 'IX',
        Ⅹ: 'X',
      }
      return map[ch] || ch
    })
}

/** @returns {Promise<Map<string, import('./environmentBuffSchema.js').any[]>>} */
export async function loadBossFieldBuffSetsMap() {
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
      const raw = String(row.boss_name ?? '').trim()
      if (!raw) continue
      map.set(raw, sets)
      const norm = normalizeBossNameKey(raw)
      if (norm && !map.has(norm)) map.set(norm, sets)
    }
  } catch (err) {
    console.warn('[bossFieldBuff] loadBossFieldBuffSetsMap fallback:', err.message)
  }
  return map
}

export function getFieldBuffSetsForBossName(map, bossName) {
  if (!map) return null
  const raw = String(bossName ?? '').trim()
  if (!raw) return null
  return map.get(raw) || map.get(normalizeBossNameKey(raw)) || null
}

function buildFieldBuffPayload(resolved) {
  if (!resolved) return null
  let text = String(resolved.text ?? '').trim()
  if (!text && Array.isArray(resolved.effectBlocks) && resolved.effectBlocks.length) {
    text = resolved.effectBlocks
      .map((block) => String(block?.note ?? '').trim())
      .filter(Boolean)
      .join('\n\n')
  }
  return {
    name: resolved.name,
    text,
    image: resolved.image ?? null,
    effectBlocks: resolved.effectBlocks ?? null,
  }
}

/**
 * 为临界层挂载场地 Buff（仅 isBoss 层）。
 * 使用 layer.fieldBuffSetId；空则取默认/第一套。
 * 同时写入 fieldBuffSets 供管理端选择器，避免前端再查 boss-info。
 */
export function attachFieldBuffToDeductionLayers(layers, fieldBuffMap) {
  if (!Array.isArray(layers)) return layers
  for (const layer of layers) {
    if (!layer || layer.isBoss !== true) {
      if (layer) {
        layer.fieldBuffSets = []
      }
      continue
    }
    const setId = layer.fieldBuffSetId == null || layer.fieldBuffSetId === ''
      ? null
      : String(layer.fieldBuffSetId)
    let attached = false
    for (const monster of layer.monsters || []) {
      const sets = getFieldBuffSetsForBossName(fieldBuffMap, monster?.name)
      if (!sets?.length) continue
      const resolved = resolveFieldBuffFromSets(sets, setId)
      const payload = buildFieldBuffPayload(resolved)
      if (!payload) continue
      layer.fieldBuff = payload
      layer.fieldBuffSets = sets.map((set) => ({
        id: set.id,
        label: set.label ?? null,
        name: set.name,
      }))
      // 保留原 fieldBuffSetId（空=自动）；不在读路径强行写入默认 id
      attached = true
      break
    }
    if (!attached) {
      layer.fieldBuff = null
      layer.fieldBuffSets = []
    }
  }
  return layers
}
