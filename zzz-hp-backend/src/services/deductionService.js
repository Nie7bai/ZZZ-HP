import pool from '../config/db.js'
import {
  loadGlobalBuffEffectMap,
  resolveEffectBlocksForName,
} from '../utils/sameNameBuffEffects.js'
import {
  attachFieldBuffToDeductionLayers,
  loadBossFieldBuffSetsMap,
  normalizeBossNameKey,
} from '../utils/bossFieldBuff.js'
import { ensureDeductionStoryOptionsColumn } from './deductionSchemaService.js'
import { applyBossFallbackToPeriodNodes } from '../utils/deductionLayerFallback.js'
import { ensureBossStaggerSchema, normalizeStaggerTime } from '../utils/bossSchema.js'

let schemaEnsured = false

const CREATE_NODE_SQL = `
CREATE TABLE IF NOT EXISTS deduction_node (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  version VARCHAR(50) NOT NULL,
  phase VARCHAR(50) NOT NULL DEFAULT '1',
  node_id VARCHAR(20) NOT NULL,
  node_name VARCHAR(100) NOT NULL DEFAULT '',
  node_type INT NOT NULL DEFAULT 0,
  prev_node VARCHAR(20) NOT NULL DEFAULT '',
  story_text TEXT NULL,
  story_options_json JSON NULL,
  layers_json JSON NULL,
  buffs_json JSON NULL,
  sort_order INT NOT NULL DEFAULT 0,
  period_name VARCHAR(100) NOT NULL DEFAULT '' COMMENT '期数显示名，如 临界推演：歧路回响',
  PRIMARY KEY (id),
  UNIQUE KEY uk_dd_node (version, phase, node_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='临界推演节点（剧情/战斗）';
`

async function ensureDeductionSchema() {
  if (schemaEnsured) return
  await pool.query(CREATE_NODE_SQL)
  await ensureDeductionStoryOptionsColumn(pool)
  schemaEnsured = true
}

function parseJson(value) {
  if (value == null) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }
  return value
}

function parseJsonArray(value) {
  const parsed = parseJson(value)
  return Array.isArray(parsed) ? parsed : []
}

function mapNode(row) {
  return {
    nodeId: String(row.node_id),
    name: String(row.node_name ?? ''),
    type: Number(row.node_type) || 0,
    prevNode: row.prev_node || null,
    storyText: row.story_text || null,
    storyOptions: parseJsonArray(row.story_options_json),
    layers: parseJsonArray(row.layers_json),
    buffs: parseJsonArray(row.buffs_json),
  }
}

/** 怪物名 → boss_info 场地 Buff 套（与危局同源：危局 Boss 的场地逻辑在推演终局同样生效） */
async function loadFieldBuffMap() {
  return loadBossFieldBuffSetsMap()
}

function normalizeBossName(name) {
  return normalizeBossNameKey(name)
}

function putImageAlias(map, key, value) {
  if (!key || !value || map.has(key)) return
  // 跳过游戏包内路径，本地静态站只托管 /boss_image/
  if (String(value).startsWith('/UI/')) return
  map.set(key, value)
}

export async function getDeductionPhases() {
  await ensureDeductionSchema()
  await ensureBossStaggerSchema()
  const [rows] = await pool.execute(
    `SELECT version, phase, node_id, node_name, node_type, prev_node, story_text, story_options_json, layers_json, buffs_json, period_name
     FROM deduction_node
     ORDER BY CAST(version AS UNSIGNED), sort_order, id`,
  )

  // 每期怪物名 → 图片（boss 表已回填 boss_image）
  const [bossRows] = await pool.execute(
    `SELECT version, boss_name, boss_image
     FROM boss
     WHERE mode = 'deduction' AND boss_image IS NOT NULL AND boss_image <> ''`,
  )
  const imageMap = new Map()
  for (const row of bossRows) {
    const img = row.boss_image
    putImageAlias(imageMap, `${row.version}::${row.boss_name}`, img)
    putImageAlias(imageMap, `${row.version}::${normalizeBossName(row.boss_name)}`, img)
  }

  // 怪物基础库名 → 图片（兜底：新增/手输怪物未回填 boss 表时按名取图）
  const [bossInfoImgRows] = await pool.execute(
    `SELECT DISTINCT boss_name, boss_image
     FROM boss_info
     WHERE boss_image IS NOT NULL AND boss_image <> ''`,
  )
  const bossInfoImgMap = new Map()
  for (const row of bossInfoImgRows) {
    putImageAlias(bossInfoImgMap, row.boss_name, row.boss_image)
    putImageAlias(bossInfoImgMap, normalizeBossName(row.boss_name), row.boss_image)
  }

  const staggerTimeByName = new Map()
  try {
    const [staggerRows] = await pool.execute(
      'SELECT boss_name, stagger_time FROM boss_info WHERE stagger_time IS NOT NULL',
    )
    for (const row of staggerRows) {
      const value = normalizeStaggerTime(row.stagger_time)
      if (value == null) continue
      if (!staggerTimeByName.has(row.boss_name)) staggerTimeByName.set(row.boss_name, value)
      const key = normalizeBossName(row.boss_name)
      if (key && !staggerTimeByName.has(key)) staggerTimeByName.set(key, value)
    }
  } catch (err) {
    console.warn('[deduction] loadBossStaggerTimeMap fallback:', err.message)
  }

  // Buff 名 → 图片（匹配 buff 表，推演可选增益与危局/防卫战同名 Buff 共用图）
  const [buffImgRows] = await pool.execute(
    `SELECT DISTINCT buff_name, buff_image
     FROM buff
     WHERE buff_image IS NOT NULL AND buff_image <> ''`,
  )
  const buffImgMap = new Map()
  for (const row of buffImgRows) {
    if (!buffImgMap.has(row.buff_name)) buffImgMap.set(row.buff_name, row.buff_image)
  }

  const buffEffectMap = await loadGlobalBuffEffectMap()

  // layers_json 损坏/为空时，从 boss 表按 room 回退重建（与 nanoka 导入的平铺 boss 行一致）
  const [bossStatRows] = await pool.execute(
    `SELECT version, room, boss_name, hp, defense, level, weakness, resistance, boss_image, stagger_time
     FROM boss
     WHERE mode = 'deduction'`,
  )
  const bossStatsByVersion = new Map()
  for (const row of bossStatRows) {
    const v = String(row.version)
    if (!bossStatsByVersion.has(v)) bossStatsByVersion.set(v, [])
    bossStatsByVersion.get(v).push(row)
  }

  const periodMap = new Map()
  const fieldBuffMap = await loadFieldBuffMap()
  for (const row of rows) {
    const key = String(row.version)
    if (!periodMap.has(key)) {
      periodMap.set(key, {
        periodId: key,
        phase: String(row.phase),
        periodName: String(row.period_name ?? '').trim() || null,
        nodes: [],
      })
    }
    const node = mapNode(row)
    periodMap.get(key).nodes.push(node)
  }

  const periods = [...periodMap.values()]
  for (const period of periods) {
    applyBossFallbackToPeriodNodes(
      period.nodes,
      bossStatsByVersion.get(period.periodId) ?? [],
    )
    for (const node of period.nodes) {
      for (const layer of node.layers) {
        if (!Array.isArray(layer.monsters)) layer.monsters = []
        for (const monster of layer.monsters) {
          // 优先 boss / boss_info 权威路径，避免 layers_json 里过期的「按中文名.webp」404
          const fromTable =
            imageMap.get(`${period.periodId}::${monster.name}`) ||
            imageMap.get(`${period.periodId}::${normalizeBossName(monster.name)}`) ||
            bossInfoImgMap.get(monster.name) ||
            bossInfoImgMap.get(normalizeBossName(monster.name)) ||
            null
          monster.boss_image = fromTable || monster.boss_image || null
          const ownStagger = normalizeStaggerTime(monster.stagger_time)
          monster.stagger_time =
            ownStagger ??
            staggerTimeByName.get(monster.name) ??
            staggerTimeByName.get(normalizeBossName(monster.name)) ??
            null
        }
      }
      attachFieldBuffToDeductionLayers(node.layers, fieldBuffMap)
      for (const buff of node.buffs) {
        buff.buff_image = buff.buff_image || buffImgMap.get(buff.title) || null
        const mergedBlocks = resolveEffectBlocksForName(
          buff.effect_blocks,
          buff.title,
          buffEffectMap,
        )
        if (mergedBlocks?.length) buff.effect_blocks = mergedBlocks
      }
    }
  }

  return periods.map((period) => ({
    ...period,
    nodes: period.nodes.map((node, index) => ({ ...node, sortOrder: index })),
  }))
}
