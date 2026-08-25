/**
 * 从 nanoka 拉取临界推演（simul）并写入本地库（mode=deduction）。
 * 每期：DELETE 该期 deduction_node / boss / buff → INSERT
 * （保留 period_name、boss/buff 图片、以及 Buff 结构化 effect_blocks）。
 */
import pool from '../config/db.js'
import {
  fetchSimulDetail,
  fetchSimulIndex,
  resolveSimulBuildTag,
} from './nanoka/nanokaSimulClient.js'
import { parseSimulPeriod } from './nanoka/nanokaSimulParser.js'
import { ensureDeductionStoryOptionsColumn } from './deductionSchemaService.js'
import { resolveLayerIsBoss } from '../utils/deductionLayerFallback.js'
import { parseEffectBlocksJson, serializeEffectBlocks } from '../utils/environmentBuffSchema.js'

function normalizeSimulIds(simulIds, simulIndex) {
  if (simulIds == null || simulIds === 'all') {
    return Object.keys(simulIndex).sort()
  }
  const list = Array.isArray(simulIds)
    ? simulIds
    : String(simulIds)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
  if (!list.length) throw new Error('请指定要更新的期数 id（simulIds）')
  for (const id of list) {
    if (!simulIndex[id]) throw new Error(`nanoka simul 中不存在期数 ${id}`)
  }
  return list
}

async function importParsedPeriod(item) {
  const [existingPeriods] = await pool.execute(
    'SELECT period_name FROM deduction_node WHERE version = ? AND phase = ? LIMIT 1',
    [item.version, item.phase],
  )
  const preservedPeriodName = String(existingPeriods[0]?.period_name ?? '').trim()

  const [imgRows] = await pool.execute(
    `SELECT boss_name, boss_image FROM boss
     WHERE mode = 'deduction' AND version = ? AND phase = ?
       AND boss_image IS NOT NULL AND boss_image <> ''`,
    [item.version, item.phase],
  )
  const preservedBossImages = new Map(
    imgRows.map((row) => [String(row.boss_name).trim(), row.boss_image]),
  )
  const [buffPreserveRows] = await pool.execute(
    `SELECT buff_name, buff_image, effect_blocks FROM buff
     WHERE mode = 'deduction' AND version = ? AND phase = ?`,
    [item.version, item.phase],
  )
  const preservedBuffImages = new Map()
  const preservedBuffBlocks = new Map()
  for (const row of buffPreserveRows) {
    const name = String(row.buff_name ?? '').trim()
    if (!name) continue
    if (row.buff_image != null && String(row.buff_image).trim() !== '') {
      preservedBuffImages.set(name, row.buff_image)
    }
    const blocks = parseEffectBlocksJson(row.effect_blocks)
    if (blocks?.length) preservedBuffBlocks.set(name, blocks)
  }

  // 节点 buffs_json 里已模块化的结构也保留（按名）
  const [nodeBuffRows] = await pool.execute(
    `SELECT buffs_json FROM deduction_node
     WHERE version = ? AND phase = ? AND buffs_json IS NOT NULL`,
    [item.version, item.phase],
  )
  for (const row of nodeBuffRows) {
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
      if (!name || preservedBuffBlocks.has(name)) continue
      const blocks = parseEffectBlocksJson(buff.effect_blocks)
      if (blocks?.length) preservedBuffBlocks.set(name, blocks)
      if (!preservedBuffImages.has(name) && buff.buff_image) {
        preservedBuffImages.set(name, buff.buff_image)
      }
    }
  }

  const [delBoss] = await pool.execute(
    "DELETE FROM boss WHERE mode = 'deduction' AND version = ? AND phase = ?",
    [item.version, item.phase],
  )
  const [delBuff] = await pool.execute(
    "DELETE FROM buff WHERE mode = 'deduction' AND version = ? AND phase = ?",
    [item.version, item.phase],
  )
  const [delNode] = await pool.execute(
    'DELETE FROM deduction_node WHERE version = ? AND phase = ?',
    [item.version, item.phase],
  )

  let bossInserted = 0
  for (const boss of item.bosses) {
    const preservedImage = preservedBossImages.get(String(boss.boss_name).trim()) ?? null
    await pool.execute(
      `INSERT INTO boss (version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image, mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'deduction')`,
      [
        boss.version,
        boss.phase,
        boss.boss_name,
        boss.hp,
        boss.defense,
        boss.level,
        boss.room,
        boss.weakness,
        boss.resistance,
        preservedImage,
      ],
    )
    bossInserted += 1
  }

  let buffInserted = 0
  for (const buff of item.buffs) {
    const name = String(buff.buff_name).trim()
    const preservedImage = preservedBuffImages.get(name) ?? null
    const preservedBlocks = preservedBuffBlocks.get(name) ?? null
    const effectBlocksJson = serializeEffectBlocks(preservedBlocks)
    await pool.execute(
      `INSERT INTO buff (version, phase, buff_name, buff, buff_image, effect_blocks, mode)
       VALUES (?, ?, ?, ?, ?, ?, 'deduction')`,
      [buff.version, buff.phase, buff.buff_name, buff.buff, preservedImage, effectBlocksJson],
    )
    buffInserted += 1
  }

  let nodeInserted = 0
  for (const [index, node] of item.nodes.entries()) {
    const nodeBuffs = (node.buffs ?? []).map((buff) => {
      const title = String(buff?.title ?? '').trim()
      const blocks = preservedBuffBlocks.get(title) ?? parseEffectBlocksJson(buff?.effect_blocks)
      return {
        title,
        desc: buff?.desc ?? null,
        buff_image: preservedBuffImages.get(title) ?? buff?.buff_image ?? null,
        effect_blocks: blocks?.length ? blocks : null,
      }
    })
    await pool.execute(
      `INSERT INTO deduction_node
         (version, phase, node_id, node_name, node_type, prev_node, story_text, story_options_json, layers_json, buffs_json, sort_order, period_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?, ?)`,
      [
        item.version,
        item.phase,
        node.nodeId,
        node.name,
        node.type,
        node.prevNode,
        node.storyText,
        JSON.stringify(node.storyOptions ?? []),
        JSON.stringify(
          node.layers.map((l) => ({
            name: l.name,
            isBoss: resolveLayerIsBoss(l),
            ending: l.ending ?? null,
            monsters: l.monsters ?? [],
          })),
        ),
        JSON.stringify(nodeBuffs),
        index,
        preservedPeriodName,
      ],
    )
    nodeInserted += 1
  }

  return {
    periodId: item.periodId,
    bosses: { deleted: delBoss.affectedRows, inserted: bossInserted },
    buffs: { deleted: delBuff.affectedRows, inserted: buffInserted },
    nodes: { deleted: delNode.affectedRows, inserted: nodeInserted },
  }
}

/**
 * @param {object} options
 * @param {string[]|string|null} [options.simulIds] 期数 id 列表，或 'all' 导入全部
 * @param {string} [options.locale]
 * @param {string} [options.phase]
 * @param {boolean} [options.dryRun]
 * @param {string|null} [options.buildTag]
 */
export async function importNanokaSimulPeriods(options = {}) {
  const {
    simulIds = 'all',
    locale = 'zh',
    phase = '1',
    dryRun = false,
    buildTag: providedBuildTag = null,
  } = options

  const buildTag = providedBuildTag ?? await resolveSimulBuildTag()
  const simulIndex = await fetchSimulIndex(buildTag)
  const ids = normalizeSimulIds(simulIds, simulIndex)

  const parsedPeriods = []
  for (const simulId of ids) {
    const detail = await fetchSimulDetail(buildTag, simulId, locale)
    parsedPeriods.push(parseSimulPeriod(detail, { phase }))
  }

  if (dryRun) {
    return {
      dryRun: true,
      buildTag,
      locale,
      periods: parsedPeriods.map((item) => ({
        periodId: item.periodId,
        bosses: item.bosses.length,
        buffs: item.buffs.length,
        nodes: item.nodes.length,
        nodeSamples: item.nodes.slice(0, 3).map((n) => ({
          nodeId: n.nodeId,
          name: n.name,
          type: n.type,
          layers: n.layers.length,
          buffs: n.buffs.length,
        })),
      })),
    }
  }

  await ensureDeductionStoryOptionsColumn(pool)

  const summary = []
  for (const item of parsedPeriods) {
    await pool.query('START TRANSACTION')
    try {
      summary.push(await importParsedPeriod(item))
      await pool.query('COMMIT')
    } catch (err) {
      await pool.query('ROLLBACK')
      throw err
    }
  }

  return { buildTag, locale, summary }
}
