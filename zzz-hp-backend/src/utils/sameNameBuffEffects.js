/**
 * 同名环境 Buff 的结构化效果（effect_blocks）跨危局 / 防卫 / 临界保持一致。
 * - 读：本地无结构时按名回退
 * - 写：有权威结构时补齐（或覆盖）同名 buff 行与临界节点 buffs_json
 */
import pool from '../config/db.js'
import { parseEffectBlocksJson, serializeEffectBlocks } from './environmentBuffSchema.js'

export function hasStructuredEffectBlocks(value) {
  const blocks = parseEffectBlocksJson(value)
  return Boolean(blocks?.length)
}

/**
 * 全库同名 → 一份非空 effect_blocks（buff 表优先，再扫临界节点 JSON）
 */
export async function loadGlobalBuffEffectMap() {
  const map = new Map()

  const [rows] = await pool.execute(
    `SELECT buff_name, effect_blocks
     FROM buff
     WHERE buff_name IS NOT NULL AND TRIM(buff_name) <> ''
       AND effect_blocks IS NOT NULL AND JSON_LENGTH(effect_blocks) > 0
     ORDER BY id DESC`,
  )
  for (const row of rows) {
    const name = String(row.buff_name ?? '').trim()
    if (!name || map.has(name)) continue
    const blocks = parseEffectBlocksJson(row.effect_blocks)
    if (blocks?.length) map.set(name, blocks)
  }

  try {
    const [nodeRows] = await pool.execute(
      `SELECT buffs_json FROM deduction_node WHERE buffs_json IS NOT NULL`,
    )
    for (const row of nodeRows) {
      let buffs = row.buffs_json
      if (typeof buffs === 'string') {
        try {
          buffs = JSON.parse(buffs)
        } catch {
          continue
        }
      }
      if (!Array.isArray(buffs)) continue
      for (const buff of buffs) {
        const name = String(buff?.title ?? '').trim()
        if (!name || map.has(name)) continue
        const blocks = parseEffectBlocksJson(buff?.effect_blocks)
        if (blocks?.length) map.set(name, blocks)
      }
    }
  } catch {
    // deduction_node 尚未建表时忽略
  }

  return map
}

/** 本地无有效结构时，用同名 map 补齐 */
export function resolveEffectBlocksForName(localBlocks, name, globalMap) {
  const local = parseEffectBlocksJson(localBlocks)
  if (local?.length) return local
  const key = String(name ?? '').trim()
  if (!key || !globalMap) return local?.length ? local : null
  const fromMap = globalMap.get(key)
  return fromMap?.length ? fromMap : local?.length ? local : null
}

/**
 * 将同名结构化效果写到所有 buff 行与临界节点 JSON。
 * @param {boolean} overwrite false=仅补空；true=同名全部改为同一份（保存权威结构时）
 */
export async function propagateSameNameEffectBlocks(
  buffName,
  effectBlocks,
  { overwrite = false } = {},
) {
  const name = String(buffName ?? '').trim()
  const blocks = parseEffectBlocksJson(effectBlocks)
  if (!name || !blocks?.length) return { buffRows: 0, nodes: 0 }

  const json = serializeEffectBlocks(blocks)
  if (!json) return { buffRows: 0, nodes: 0 }

  let buffRows = 0
  if (overwrite) {
    const [res] = await pool.execute(
      `UPDATE buff SET effect_blocks = CAST(? AS JSON) WHERE TRIM(buff_name) = ?`,
      [json, name],
    )
    buffRows = Number(res.affectedRows) || 0
  } else {
    const [res] = await pool.execute(
      `UPDATE buff
       SET effect_blocks = CAST(? AS JSON)
       WHERE TRIM(buff_name) = ?
         AND (effect_blocks IS NULL OR JSON_LENGTH(effect_blocks) = 0)`,
      [json, name],
    )
    buffRows = Number(res.affectedRows) || 0
  }

  let nodes = 0
  try {
    const [nodeRows] = await pool.execute(
      `SELECT id, buffs_json FROM deduction_node WHERE buffs_json IS NOT NULL`,
    )
    for (const row of nodeRows) {
      let buffs = row.buffs_json
      if (typeof buffs === 'string') {
        try {
          buffs = JSON.parse(buffs)
        } catch {
          continue
        }
      }
      if (!Array.isArray(buffs)) continue

      let changed = false
      const next = buffs.map((buff) => {
        const title = String(buff?.title ?? '').trim()
        if (title !== name) return buff
        const existing = parseEffectBlocksJson(buff?.effect_blocks)
        if (existing?.length && !overwrite) return buff
        changed = true
        return { ...buff, effect_blocks: blocks }
      })
      if (!changed) continue

      await pool.execute(`UPDATE deduction_node SET buffs_json = CAST(? AS JSON) WHERE id = ?`, [
        JSON.stringify(next),
        row.id,
      ])
      nodes += 1
    }
  } catch {
    // deduction_node 尚未建表时忽略
  }

  return { buffRows, nodes }
}

/** 存量：同名统一为同一份结构化效果（以 map 中权威副本为准） */
export async function backfillAllSameNameBuffEffects() {
  const map = await loadGlobalBuffEffectMap()
  let names = 0
  let buffRows = 0
  let nodes = 0
  for (const [name, blocks] of map) {
    const result = await propagateSameNameEffectBlocks(name, blocks, { overwrite: true })
    names += 1
    buffRows += result.buffRows
    nodes += result.nodes
  }
  return { names, buffRows, nodes }
}

let sameNameBackfillDone = false

/** 进程内只跑一次，补齐跨期同名空结构 */
export async function ensureSameNameBuffEffectConsistency() {
  if (sameNameBackfillDone) return
  sameNameBackfillDone = true
  try {
    const result = await backfillAllSameNameBuffEffects()
    if (result.buffRows || result.nodes) {
      console.info(
        `[buff] 同名结构化增益已补齐：${result.names} 个名称，buff 行 ${result.buffRows}，节点 ${result.nodes}`,
      )
    }
  } catch (err) {
    sameNameBackfillDone = false
    console.warn('[buff] 同名结构化增益补齐失败:', err?.message || err)
  }
}
