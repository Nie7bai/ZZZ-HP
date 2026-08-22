import pool from '../config/db.js'
import {
  ensureEnvironmentBuffSchema,
  normalizeFieldBuffSet,
  parseEffectBlocksJson,
  parseFieldBuffSetsJson,
  resolveFieldBuffFromSets,
} from '../utils/environmentBuffSchema.js'

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

function mapNode(row) {
  return {
    nodeId: String(row.node_id),
    name: String(row.node_name ?? ''),
    type: Number(row.node_type) || 0,
    prevNode: row.prev_node || null,
    storyText: row.story_text || null,
    layers: parseJson(row.layers_json) ?? [],
    buffs: parseJson(row.buffs_json) ?? [],
  }
}

/** 怪物名 → boss_info 场地 Buff 套（与危局同源：危局 Boss 的场地逻辑在推演终局同样生效） */
async function loadFieldBuffMap() {
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
      // 名字规范化：去「」/空格，兼容推演数据与怪物库的符号差异（如 太初梦魇·「始主」）
      map.set(normalizeBossName(row.boss_name), sets)
    }
  } catch (err) {
    console.warn('[deduction] loadFieldBuffMap fallback:', err.message)
  }
  return map
}

function normalizeBossName(name) {
  return String(name ?? '').replace(/[「」\s]/g, '')
}

export async function getDeductionPhases() {
  await ensureDeductionSchema()
  const [rows] = await pool.execute(
    `SELECT version, phase, node_id, node_name, node_type, prev_node, story_text, layers_json, buffs_json, period_name
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
    const key = `${row.version}::${row.boss_name}`
    if (!imageMap.has(key)) imageMap.set(key, row.boss_image)
  }

  // 怪物基础库名 → 图片（兜底：新增/手输怪物未回填 boss 表时按名取图）
  const [bossInfoImgRows] = await pool.execute(
    `SELECT DISTINCT boss_name, boss_image
     FROM boss_info
     WHERE boss_image IS NOT NULL AND boss_image <> ''`,
  )
  const bossInfoImgMap = new Map()
  for (const row of bossInfoImgRows) {
    if (!bossInfoImgMap.has(row.boss_name)) bossInfoImgMap.set(row.boss_name, row.boss_image)
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
    // 层怪物挂图片：优先节点内已存的 boss_image（管理端选中时写入），
    // 其次按当期同名匹配 boss 表，最后回退 boss_info 基础库
    for (const layer of node.layers) {
      for (const monster of layer.monsters) {
        monster.boss_image =
          monster.boss_image ||
          imageMap.get(`${key}::${monster.name}`) ||
          bossInfoImgMap.get(monster.name) ||
          null
      }
      // 区域增益：层内首个命中 boss_info 场地 Buff 的怪物（与危局同款解析）
      if (!layer.fieldBuff) {
        for (const monster of layer.monsters) {
          const sets = fieldBuffMap.get(normalizeBossName(monster.name))
          if (!sets?.length) continue
          const resolved = resolveFieldBuffFromSets(sets, null)
          if (resolved) {
            // 场地 Buff 正文通常在效果块 note 里（field_buff_text 常为空），兜底拼接
            let text = String(resolved.text ?? '').trim()
            if (!text && Array.isArray(resolved.effectBlocks) && resolved.effectBlocks.length) {
              text = resolved.effectBlocks
                .map((block) => String(block?.note ?? '').trim())
                .filter(Boolean)
                .join('\n\n')
            }
            layer.fieldBuff = {
              name: resolved.name,
              text,
              image: resolved.image ?? null,
              effectBlocks: resolved.effectBlocks ?? null,
            }
            break
          }
        }
      }
    }
    // Buff 挂图片：优先节点内已存的 buff_image（管理端选中时写入），其次按名匹配 buff 表
    for (const buff of node.buffs) {
      buff.buff_image = buff.buff_image || buffImgMap.get(buff.title) || null
    }
    periodMap.get(key).nodes.push(node)
  }

  return [...periodMap.values()].map((period) => ({
    ...period,
    nodes: period.nodes.map((node, index) => ({ ...node, sortOrder: index })),
  }))
}
