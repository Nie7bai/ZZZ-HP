/**
 * 临界推演管理端（deduction_node CRUD）
 * - 期数：列表 / 新建 / 改名 / 删除（含该期 boss/buff 平铺行）
 * - 节点：列表 / 新建 / 编辑（剧情、层、增益 JSON）/ 删除
 * 推演不用危局 ID 编码：节点自增 id，期数用 version + phase 定位。
 */
import pool from '../config/db.js'
import {
  fetchSeasonDetail,
  fetchShiyuIndex,
  resolveNanokaBuildTag,
} from './nanoka/nanokaClient.js'
import { ensureDeductionStoryOptionsColumn } from './deductionSchemaService.js'
import { upsertBossInfo } from './bossInfoService.js'

const SHIYU_MINIONS_TTL_MS = 10 * 60 * 1000
let shiyuMinionsCache = null
let shiyuMinionsCachedAt = 0

const SHIYU_ELEMENT_ZH = {
  ice: '冰',
  fire: '火',
  electric: '电',
  ether: '以太',
  physical: '物理',
  wind: '风',
}

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
      story_options_json JSON NULL,
      layers_json JSON NULL,
      buffs_json JSON NULL,
      sort_order INT NOT NULL DEFAULT 0,
      period_name VARCHAR(100) NOT NULL DEFAULT '' COMMENT '期数显示名，如 临界推演：歧路回响',
      PRIMARY KEY (id),
      UNIQUE KEY uk_dd_node (version, phase, node_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='临界推演节点（剧情/战斗）'
  `)
  await ensureDeductionStoryOptionsColumn(pool)
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

/**
 * shiyu（防卫战）数据源怪物候选：供推演「小怪层」（层名不含 STAGE）编辑使用。
 * 数据源：nanoka shiyu JSON 的 layer_room[].monster_list[]（游戏 id → 中文名），
 * 按名字去重聚合，取首次出现的 HP / 防御 / 等级 / 弱点 / 抗性；内存缓存 10 分钟。
 */
export async function listShiyuMinions() {
  const now = Date.now()
  if (shiyuMinionsCache && now - shiyuMinionsCachedAt < SHIYU_MINIONS_TTL_MS) {
    return shiyuMinionsCache
  }
  const buildTag = await resolveNanokaBuildTag()
  const index = await fetchShiyuIndex(buildTag)
  const byName = new Map()
  for (const seasonId of Object.keys(index)) {
    const detail = await fetchSeasonDetail(buildTag, seasonId, 'zh')
    const walk = (obj, level) => {
      if (!obj || typeof obj !== 'object') return
      if (obj.monster_list && typeof obj.monster_list === 'object') {
        const roomLevel = Number(obj.monster_level) || Number(level) || 0
        const weaknessNames = Object.values(obj.monster_weakness ?? {}).map((v) =>
          String(v).trim(),
        )
        for (const monster of Object.values(obj.monster_list)) {
          if (!monster || !monster.name) continue
          const name = String(monster.name).trim()
          if (!name) continue
          const stats = monster.stats ?? {}
          const element = monster.element ?? {}
          const resistanceNames = Object.entries(element)
            .filter(([, value]) => Number(value) === -1)
            .map(([k]) => SHIYU_ELEMENT_ZH[k] ?? k)
          const existing = byName.get(name)
          if (existing) {
            if (!existing.hp) existing.hp = Math.round(Number(stats.hp) || 0)
            if (!existing.defense) existing.defense = Math.round(Number(stats.defence) || 0)
            if (!existing.level) existing.level = roomLevel
            if (!existing.weakness) existing.weakness = [...new Set(weaknessNames)].join('、') || null
            if (!existing.resistance) existing.resistance = [...new Set(resistanceNames)].join('、') || null
          } else {
            byName.set(name, {
              name,
              hp: Math.round(Number(stats.hp) || 0),
              defense: Math.round(Number(stats.defence) || 0),
              level: roomLevel,
              weakness: [...new Set(weaknessNames)].join('、') || null,
              resistance: [...new Set(resistanceNames)].join('、') || null,
              boss_image: null,
            })
          }
        }
        return
      }
      for (const value of Object.values(obj)) walk(value, level ?? obj.monster_level)
    }
    walk(detail, null)
  }
  // 按名挂怪物基础库图片：shiyu 小怪与 Boss 同名时复用本地图，供管理端选中后写回节点
  await ensureTable()
  const [infoRows] = await pool.execute(
    `SELECT DISTINCT boss_name, boss_image
     FROM boss_info
     WHERE boss_image IS NOT NULL AND boss_image <> ''`,
  )
  for (const row of infoRows) {
    const target = byName.get(row.boss_name)
    if (target && !target.boss_image) target.boss_image = row.boss_image
  }
  const [bossRows] = await pool.execute(
    `SELECT boss_name, MAX(boss_image) AS boss_image
     FROM boss
     WHERE boss_image IS NOT NULL AND boss_image <> ''
     GROUP BY boss_name`,
  )
  for (const row of bossRows) {
    const target = byName.get(row.boss_name)
    if (target && !target.boss_image) target.boss_image = row.boss_image
  }
  shiyuMinionsCache = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  shiyuMinionsCachedAt = Date.now()
  return shiyuMinionsCache
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
    `SELECT id, version, phase, node_id, node_name, node_type, prev_node, story_text, story_options_json, layers_json, buffs_json, sort_order, period_name
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
    storyOptions: parseJson(row.story_options_json) ?? [],
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
     SET node_name = ?, node_type = ?, story_text = ?, story_options_json = CAST(? AS JSON),
         layers_json = CAST(? AS JSON), buffs_json = CAST(? AS JSON), sort_order = ?
     WHERE id = ?`,
    [
      String(payload.name ?? '').trim(),
      Number(payload.type) || 0,
      payload.storyText ?? '',
      toJson(payload.storyOptions ?? []),
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

/** 整期节点重排：按 nodeIds 顺序重写 sort_order（nodeIds 为管理端自增 id） */
export async function reorderDeductionNodes(version, orderedIds) {
  const versionValue = String(version ?? '').trim()
  if (!versionValue) throw new Error('期数编号（version）必填')
  if (!Array.isArray(orderedIds) || !orderedIds.length) throw new Error('排序列表不能为空')
  const ids = orderedIds.map((v) => Number(v))
  if (ids.some((v) => !Number.isInteger(v) || v <= 0)) throw new Error('无效的节点 ID')

  await pool.query('START TRANSACTION')
  try {
    for (let i = 0; i < ids.length; i++) {
      const [res] = await pool.execute(
        'UPDATE deduction_node SET sort_order = ? WHERE id = ? AND version = ?',
        [i, ids[i], versionValue],
      )
      if (!res.affectedRows) throw new Error(`节点 ${ids[i]} 不存在或不属于该期数`)
    }
    await pool.query('COMMIT')
  } catch (err) {
    await pool.query('ROLLBACK')
    throw err
  }
  return { version: versionValue, count: ids.length }
}

/**
 * 前战(小怪)怪物：仅登记到 boss_info 基础库（按名 upsert），不写 boss 表。
 * 与危局（boss）走 createBoss（写 boss 表）区分。
 */
export async function createDeductionBossInfo(payload) {
  const name = String(payload?.boss_name ?? '').trim()
  if (!name) throw new Error('怪物名称不能为空')
  return upsertBossInfo({
    boss_name: name,
    defense: Number(payload.defense) || 0,
    level: Number(payload.level) || 1,
    weakness: payload.weakness ?? null,
    resistance: payload.resistance ?? null,
    boss_image: payload.boss_image ?? null,
  })
}
