import pool from '../config/db.js'

/**
 * 官方预设词条库（服务端唯一来源）
 *
 * 口径（用户 2026-09-12 拍板）：
 * - 官方预设由**管理员在管理端维护**，用户侧只读、只能「复制一份」到自己浏览器里改；
 * - 用户自己的词条库仍在 localStorage，**不上服务器**，管理员侧看不到也不管理；
 * - 不做离线兜底（离线了就别用）。
 *
 * ⚠️ `id` 一旦发布不可改名：前端用户本地的 `enabledOverride` / `overrides` /
 *    `removedEntryIds` 都按 id 索引，改名会让这些记录全部失配。
 */

const ENTRY_TABLE = 'affix_preset_entry'
const GROUP_TABLE = 'affix_preset_group'

let ensured = false

/** 建表幂等（与 skillGroupService 同一套做法：不依赖手工跑 SQL） */
async function ensureTables() {
  if (ensured) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${ENTRY_TABLE} (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      label VARCHAR(255) NOT NULL,
      target VARCHAR(64) NOT NULL,
      per_roll DECIMAL(12, 2) NOT NULL DEFAULT 0,
      cap INT NOT NULL DEFAULT 0,
      group_name VARCHAR(64) NOT NULL DEFAULT '',
      roll_cost INT NOT NULL DEFAULT 1,
      enabled_by_default TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      raw_json JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_group_sort (group_name, sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${GROUP_TABLE} (
      name VARCHAR(64) NOT NULL PRIMARY KEY,
      cap INT NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      raw_json JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  ensured = true
}

function readNumber(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function readInt(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.trunc(num) : fallback
}

function parseRawJson(raw) {
  if (raw == null) return null
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return null
  }
}

function rowToEntry(row) {
  const raw = parseRawJson(row.raw_json)
  return {
    id: String(row.id),
    label: String(row.label ?? ''),
    target: String(row.target ?? ''),
    perRoll: Number(row.per_roll) || 0,
    cap: readInt(row.cap, 0),
    group: String(row.group_name ?? ''),
    rollCost: readInt(row.roll_cost, 1),
    enabledByDefault: Boolean(Number(row.enabled_by_default)),
    sortOrder: readInt(row.sort_order, 0),
    // 原始文档里可能有本表没有的字段，读出来让前端决定用不用（防丢字段）
    raw: raw && typeof raw === 'object' ? raw : null,
  }
}

function rowToGroup(row) {
  const raw = parseRawJson(row.raw_json)
  return {
    name: String(row.name ?? ''),
    cap: readInt(row.cap, 0),
    sortOrder: readInt(row.sort_order, 0),
    raw: raw && typeof raw === 'object' ? raw : null,
  }
}

/** 全量预设（条目 + 分组），按分组与排序号返回 */
export async function listAffixPreset() {
  await ensureTables()
  const [entryRows] = await pool.query(
    `SELECT * FROM ${ENTRY_TABLE} ORDER BY sort_order ASC, id ASC`,
  )
  const [groupRows] = await pool.query(
    `SELECT * FROM ${GROUP_TABLE} ORDER BY sort_order ASC, name ASC`,
  )
  return {
    entries: entryRows.map(rowToEntry),
    groups: groupRows.map(rowToGroup),
  }
}

export async function upsertAffixPresetEntry(doc) {
  await ensureTables()
  const id = String(doc.id ?? '').trim()
  if (!id) throw new Error('条目 ID 为必填项')
  const payload = {
    id,
    label: String(doc.label ?? '').trim(),
    target: String(doc.target ?? '').trim(),
    perRoll: readNumber(doc.perRoll, 0),
    cap: Math.max(0, readInt(doc.cap, 0)),
    group: String(doc.group ?? '').trim(),
    rollCost: Math.max(0, readInt(doc.rollCost, 1)),
    enabledByDefault: doc.enabledByDefault ? 1 : 0,
    sortOrder: readInt(doc.sortOrder, 0),
  }
  const raw = doc.raw && typeof doc.raw === 'object' ? doc.raw : doc
  await pool.query(
    `INSERT INTO ${ENTRY_TABLE}
      (id, label, target, per_roll, cap, group_name, roll_cost, enabled_by_default, sort_order, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       label = VALUES(label),
       target = VALUES(target),
       per_roll = VALUES(per_roll),
       cap = VALUES(cap),
       group_name = VALUES(group_name),
       roll_cost = VALUES(roll_cost),
       enabled_by_default = VALUES(enabled_by_default),
       sort_order = VALUES(sort_order),
       raw_json = VALUES(raw_json)`,
    [
      payload.id,
      payload.label,
      payload.target,
      payload.perRoll,
      payload.cap,
      payload.group,
      payload.rollCost,
      payload.enabledByDefault,
      payload.sortOrder,
      JSON.stringify(raw),
    ],
  )
  const [rows] = await pool.query(`SELECT * FROM ${ENTRY_TABLE} WHERE id = ? LIMIT 1`, [id])
  return rowToEntry(rows[0])
}

export async function deleteAffixPresetEntry(id) {
  await ensureTables()
  const safeId = String(id ?? '').trim()
  if (!safeId) throw new Error('缺少条目 ID')
  const [result] = await pool.query(`DELETE FROM ${ENTRY_TABLE} WHERE id = ?`, [safeId])
  return { id: safeId, deleted: result.affectedRows > 0 }
}

export async function upsertAffixPresetGroup(doc) {
  await ensureTables()
  const name = String(doc.name ?? '').trim()
  if (!name) throw new Error('分组名为必填项')
  const cap = Math.max(0, readInt(doc.cap, 0))
  const sortOrder = readInt(doc.sortOrder, 0)
  const raw = doc.raw && typeof doc.raw === 'object' ? doc.raw : doc
  await pool.query(
    `INSERT INTO ${GROUP_TABLE} (name, cap, sort_order, raw_json)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       cap = VALUES(cap),
       sort_order = VALUES(sort_order),
       raw_json = VALUES(raw_json)`,
    [name, cap, sortOrder, JSON.stringify(raw)],
  )
  const [rows] = await pool.query(`SELECT * FROM ${GROUP_TABLE} WHERE name = ? LIMIT 1`, [name])
  return rowToGroup(rows[0])
}

export async function deleteAffixPresetGroup(name) {
  await ensureTables()
  const safeName = String(name ?? '').trim()
  if (!safeName) throw new Error('缺少分组名')
  const [result] = await pool.query(`DELETE FROM ${GROUP_TABLE} WHERE name = ?`, [safeName])
  return { name: safeName, deleted: result.affectedRows > 0 }
}

/**
 * 整份替换（灌种子 / 管理端「导入」用）。
 *
 * 语义是**覆盖**：表里现有的条目与分组全部清掉，换成传入的那份。
 * 用事务保证「清空 + 写入」要么都成、要么都不成 —— 中途失败留下半份数据
 * 会让前端拿到残缺预设，比整体失败更难排查。
 */
export async function replaceAffixPreset({ entries, groups }) {
  await ensureTables()
  const entryList = Array.isArray(entries) ? entries : []
  const groupList = Array.isArray(groups) ? groups : []
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(`DELETE FROM ${ENTRY_TABLE}`)
    await conn.query(`DELETE FROM ${GROUP_TABLE}`)
    for (const [index, doc] of entryList.entries()) {
      const raw = doc.raw && typeof doc.raw === 'object' ? doc.raw : doc
      await conn.query(
        `INSERT INTO ${ENTRY_TABLE}
          (id, label, target, per_roll, cap, group_name, roll_cost, enabled_by_default, sort_order, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(doc.id ?? '').trim(),
          String(doc.label ?? '').trim(),
          String(doc.target ?? '').trim(),
          readNumber(doc.perRoll, 0),
          Math.max(0, readInt(doc.cap, 0)),
          String(doc.group ?? '').trim(),
          Math.max(0, readInt(doc.rollCost, 1)),
          doc.enabledByDefault ? 1 : 0,
          readInt(doc.sortOrder, index),
          JSON.stringify(raw),
        ],
      )
    }
    for (const [index, doc] of groupList.entries()) {
      const raw = doc.raw && typeof doc.raw === 'object' ? doc.raw : doc
      await conn.query(
        `INSERT INTO ${GROUP_TABLE} (name, cap, sort_order, raw_json) VALUES (?, ?, ?, ?)`,
        [
          String(doc.name ?? '').trim(),
          Math.max(0, readInt(doc.cap, 0)),
          readInt(doc.sortOrder, index),
          JSON.stringify(raw),
        ],
      )
    }
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
  return listAffixPreset()
}
