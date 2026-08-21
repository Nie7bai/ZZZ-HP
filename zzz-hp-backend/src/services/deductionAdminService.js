/**
 * 临界推演管理端（deduction_node CRUD）
 * - 期数：列表 / 新建 / 改名 / 删除（含该期 boss/buff 平铺行）
 * - 节点：列表 / 新建 / 编辑（剧情、层、增益 JSON）/ 删除
 * 推演不用危局 ID 编码：节点自增 id，期数用 version + phase 定位。
 */
import pool from '../config/db.js'

function normalizePhase(phase) {
  const digits = String(phase ?? '').replace(/\D/g, '')
  return digits || String(phase ?? '').trim() || '1'
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

function toJson(value) {
  return value == null ? null : JSON.stringify(value)
}

async function ensureTable() {
  await pool.query(`
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='临界推演节点（剧情/战斗）'
  `)
}

// ── 下拉数据源（全局去重，不按期数挂钩） ──────────────────

/** 全部 Boss 去重（与危局一致：boss_info 怪物基础库为规范身份，boss 表补充缺失名字与 HP） */
export async function listPickBosses() {
  await ensureTable()
  const [infoRows] = await pool.execute(
    `SELECT boss_name, defense, level, boss_image, weakness, resistance
     FROM boss_info
     WHERE boss_name IS NOT NULL AND boss_name <> ''
     ORDER BY boss_name`,
  )
  const [bossRows] = await pool.execute(
    `SELECT boss_name,
            MAX(hp) AS hp,
            MAX(defense) AS defense,
            MAX(level) AS level,
            MAX(weakness) AS weakness,
            MAX(resistance) AS resistance,
            MAX(boss_image) AS boss_image
     FROM boss
     WHERE boss_name IS NOT NULL AND boss_name <> ''
     GROUP BY boss_name`,
  )

  const byName = new Map()
  for (const info of infoRows) {
    byName.set(info.boss_name, {
      name: info.boss_name,
      defense: Number(info.defense) || 0,
      level: Number(info.level) || 0,
      weakness: info.weakness ?? null,
      resistance: info.resistance ?? null,
      boss_image: info.boss_image ?? null,
      hp: 0,
    })
  }
  for (const b of bossRows) {
    const existing = byName.get(b.boss_name)
    if (existing) {
      // 基础库无 HP，从 boss 表补；其余字段基础库优先，缺失才回退
      existing.hp = Number(b.hp) || existing.hp
      if (!existing.defense) existing.defense = Number(b.defense) || 0
      if (!existing.level) existing.level = Number(b.level) || 0
      if (!existing.weakness) existing.weakness = b.weakness
      if (!existing.resistance) existing.resistance = b.resistance
      if (!existing.boss_image) existing.boss_image = b.boss_image
    } else {
      byName.set(b.boss_name, {
        name: b.boss_name,
        defense: Number(b.defense) || 0,
        level: Number(b.level) || 0,
        weakness: b.weakness ?? null,
        resistance: b.resistance ?? null,
        boss_image: b.boss_image ?? null,
        hp: Number(b.hp) || 0,
      })
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

/** 全部 Buff 去重（所有版块，供推演增益选择） */
export async function listPickBuffs() {
  await ensureTable()
  const [rows] = await pool.execute(
    `SELECT buff_name, MAX(buff) AS buff, MAX(buff_image) AS buff_image
     FROM buff
     WHERE buff_name IS NOT NULL AND buff_name <> ''
     GROUP BY buff_name
     ORDER BY buff_name`,
  )
  return rows.map((row) => ({
    name: String(row.buff_name),
    desc: row.buff ?? null,
    buff_image: row.buff_image ?? null,
  }))
}

// ── 期数 ──────────────────────────────────────────────

export async function listDeductionPeriods() {
  await ensureTable()
  const [rows] = await pool.execute(
    `SELECT version, phase, MAX(period_name) AS period_name, COUNT(*) AS node_count
     FROM deduction_node
     GROUP BY version, phase
     ORDER BY CAST(version AS UNSIGNED), CAST(phase AS UNSIGNED)`,
  )
  return rows.map((row) => ({
    version: String(row.version),
    phase: String(row.phase),
    periodName: String(row.period_name ?? '').trim() || null,
    nodeCount: Number(row.node_count) || 0,
  }))
}

export async function createDeductionPeriod({ version, phase, periodName = '' }) {
  await ensureTable()
  const versionValue = String(version ?? '').trim()
  if (!versionValue) throw new Error('期数编号（version）必填')
  const phaseValue = normalizePhase(phase)
  const name = String(periodName ?? '').trim()

  const [existing] = await pool.execute(
    'SELECT id FROM deduction_node WHERE version = ? AND phase = ? LIMIT 1',
    [versionValue, phaseValue],
  )
  if (existing.length) throw new Error(`期数 ${versionValue} 已存在`)

  // 期数由节点行定义：建一个占位 INTRO 节点让期数存在
  const nodeId = `${versionValue}${phaseValue}0001`
  await pool.execute(
    `INSERT INTO deduction_node
       (version, phase, node_id, node_name, node_type, prev_node, story_text, layers_json, buffs_json, sort_order, period_name)
     VALUES (?, ?, ?, 'INTRO', 4, '0', '', '[]', '[]', 0, ?)`,
    [versionValue, phaseValue, nodeId, name],
  )
  return { version: versionValue, phase: phaseValue, periodName: name || null, nodeCount: 1 }
}

export async function renameDeductionPeriod(version, periodName) {
  const versionValue = String(version ?? '').trim()
  if (!versionValue) throw new Error('期数编号（version）必填')
  const name = String(periodName ?? '').trim()
  const [res] = await pool.execute(
    'UPDATE deduction_node SET period_name = ? WHERE version = ?',
    [name, versionValue],
  )
  if (!res.affectedRows) throw new Error(`期数 ${versionValue} 不存在`)
  return { version: versionValue, periodName: name || null }
}

export async function deleteDeductionPeriod(version) {
  const versionValue = String(version ?? '').trim()
  if (!versionValue) throw new Error('期数编号（version）必填')
  await pool.query('START TRANSACTION')
  try {
    await pool.execute('DELETE FROM deduction_node WHERE version = ?', [versionValue])
    await pool.execute(
      "DELETE FROM boss WHERE mode = 'deduction' AND version = ?",
      [versionValue],
    )
    await pool.execute(
      "DELETE FROM buff WHERE mode = 'deduction' AND version = ?",
      [versionValue],
    )
    await pool.query('COMMIT')
  } catch (err) {
    await pool.query('ROLLBACK')
    throw err
  }
  return { version: versionValue }
}

// ── 节点 ──────────────────────────────────────────────

export async function listDeductionNodes(version) {
  await ensureTable()
  const [rows] = await pool.execute(
    `SELECT id, version, phase, node_id, node_name, node_type, prev_node, story_text, layers_json, buffs_json, sort_order, period_name
     FROM deduction_node
     WHERE version = ?
     ORDER BY sort_order, id`,
    [String(version ?? '').trim()],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    version: String(row.version),
    phase: String(row.phase),
    nodeId: String(row.node_id),
    name: String(row.node_name ?? ''),
    type: Number(row.node_type) || 0,
    prevNode: row.prev_node || null,
    storyText: row.story_text || null,
    layers: parseJson(row.layers_json) ?? [],
    buffs: parseJson(row.buffs_json) ?? [],
    sortOrder: Number(row.sort_order) || 0,
    periodName: String(row.period_name ?? '').trim() || null,
  }))
}

export async function createDeductionNode(version, payload) {
  await ensureTable()
  const versionValue = String(version ?? '').trim()
  const phaseValue = normalizePhase(payload.phase)
  if (!versionValue) throw new Error('期数编号（version）必填')

  // 期数名跟随该期已有节点
  const [[period]] = await pool.execute(
    'SELECT period_name FROM deduction_node WHERE version = ? LIMIT 1',
    [versionValue],
  )
  const periodName = String(period?.period_name ?? '').trim()

  // node_id：期内的数字 id 递增（避开与导入的 nanoka 节点冲突前缀）
  const [[maxRow]] = await pool.execute(
    'SELECT COALESCE(MAX(CAST(node_id AS UNSIGNED)), 0) AS m FROM deduction_node WHERE version = ?',
    [versionValue],
  )
  const base = Math.max(Number(maxRow?.m) || 0, 900000)
  const nodeId = String(base + 1)

  const [[maxSort]] = await pool.execute(
    'SELECT COALESCE(MAX(sort_order), -1) AS m FROM deduction_node WHERE version = ?',
    [versionValue],
  )
  const sortOrder = Number(maxSort?.m) + 1

  const [res] = await pool.execute(
    `INSERT INTO deduction_node
       (version, phase, node_id, node_name, node_type, prev_node, story_text, layers_json, buffs_json, sort_order, period_name)
     VALUES (?, ?, ?, ?, ?, '0', ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?)`,
    [
      versionValue,
      phaseValue,
      nodeId,
      String(payload.name ?? '').trim() || '未命名节点',
      Number(payload.type) || 0,
      payload.storyText ?? '',
      toJson(payload.layers),
      toJson(payload.buffs),
      sortOrder,
      periodName,
    ],
  )
  return { id: Number(res.insertId), nodeId, sortOrder }
}

export async function updateDeductionNode(id, payload) {
  const nodeId = Number(id)
  if (!Number.isInteger(nodeId) || nodeId <= 0) throw new Error('无效的节点 ID')
  const [res] = await pool.execute(
    `UPDATE deduction_node
     SET node_name = ?, node_type = ?, story_text = ?, layers_json = CAST(? AS JSON),
         buffs_json = CAST(? AS JSON), sort_order = ?
     WHERE id = ?`,
    [
      String(payload.name ?? '').trim(),
      Number(payload.type) || 0,
      payload.storyText ?? '',
      toJson(payload.layers),
      toJson(payload.buffs),
      Number(payload.sortOrder) ?? 0,
      nodeId,
    ],
  )
  if (!res.affectedRows) throw new Error(`节点 ${nodeId} 不存在`)
  return { id: nodeId }
}

export async function deleteDeductionNode(id) {
  const nodeId = Number(id)
  if (!Number.isInteger(nodeId) || nodeId <= 0) throw new Error('无效的节点 ID')
  const [res] = await pool.execute('DELETE FROM deduction_node WHERE id = ?', [nodeId])
  if (!res.affectedRows) throw new Error(`节点 ${nodeId} 不存在`)
  return { id: nodeId }
}
