import pool from '../config/db.js'

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
    // 层怪物挂图片（按当期同名匹配）
    for (const layer of node.layers) {
      for (const monster of layer.monsters) {
        monster.boss_image = imageMap.get(`${key}::${monster.name}`) ?? null
      }
    }
    // Buff 挂图片（按名匹配 buff 表）
    for (const buff of node.buffs) {
      buff.buff_image = buffImgMap.get(buff.title) ?? null
    }
    periodMap.get(key).nodes.push(node)
  }

  return [...periodMap.values()].map((period) => ({
    ...period,
    nodes: period.nodes.map((node, index) => ({ ...node, sortOrder: index })),
  }))
}
