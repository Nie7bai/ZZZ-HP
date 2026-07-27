import pool from '../config/db.js'

const TABLE = '`calculator_damage_event_modes`'

let ensured = false

async function ensureTable() {
  if (ensured) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS calculator_damage_event_modes (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      agent_id VARCHAR(64) NOT NULL DEFAULT '',
      name VARCHAR(128) NOT NULL,
      mode_type VARCHAR(16) NOT NULL DEFAULT 'direct',
      events_json JSON NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  try {
    await pool.query(
      `ALTER TABLE calculator_damage_event_modes
       ADD COLUMN mode_type VARCHAR(16) NOT NULL DEFAULT 'direct' AFTER name`,
    )
  } catch {
    // column already exists
  }
  ensured = true
}

function normalizeEvent(raw, index = 0) {
  const entry = raw && typeof raw === 'object' ? raw : {}
  const kind = String(entry.kind ?? 'direct')
  const allowedKinds = ['direct', 'anomaly', 'disorder', 'anomalyRelease', 'turbulence']
  const safeKind = allowedKinds.includes(kind) ? kind : 'direct'
  const critMode = String(entry.critMode ?? 'expected')
  const safeCrit =
    critMode === 'noCrit' || critMode === 'fullCrit' ? critMode : 'expected'
  const stagger = String(entry.staggerPhase ?? 'stagger')
  const safeStagger = stagger === 'normal' ? 'normal' : 'stagger'
  let id = String(entry.id ?? '').trim()
  if (!id) id = `evt-${Date.now().toString(36)}-${index}`
  return {
    id,
    kind: safeKind,
    categoryId: String(entry.categoryId ?? 'basic'),
    skillSubcategoryId:
      entry.skillSubcategoryId == null || entry.skillSubcategoryId === ''
        ? null
        : String(entry.skillSubcategoryId),
    count: Math.max(0, Number(entry.count) || 1),
    staggerPhase: safeStagger,
    critMode: safeCrit,
    triggerAgentId:
      entry.triggerAgentId == null || entry.triggerAgentId === ''
        ? null
        : String(entry.triggerAgentId),
    skillBound: entry.skillBound === false ? false : entry.skillBound === true ? true : undefined,
    multOverrides:
      entry.multOverrides && typeof entry.multOverrides === 'object'
        ? entry.multOverrides
        : null,
  }
}

function rowToDoc(row) {
  let events = []
  try {
    const parsed = row.events_json
    const list = typeof parsed === 'string' ? JSON.parse(parsed) : parsed
    if (Array.isArray(list)) events = list.map((item, index) => normalizeEvent(item, index))
  } catch {
    events = []
  }
  return {
    id: String(row.id),
    agentId: String(row.agent_id ?? ''),
    name: String(row.name ?? ''),
    modeType: String(row.mode_type ?? '') === 'anomaly' ? 'anomaly' : 'direct',
    events,
  }
}

export async function listDamageEventModes() {
  await ensureTable()
  const [rows] = await pool.query(
    `SELECT * FROM ${TABLE} ORDER BY agent_id ASC, sort_order ASC, name ASC, id ASC`,
  )
  return rows.map(rowToDoc)
}

export async function upsertDamageEventMode(doc) {
  await ensureTable()
  let id = String(doc.id ?? '').trim()
  const agentId = String(doc.agentId ?? '').trim()
  const name = String(doc.name ?? '').trim()
  const modeType = String(doc.modeType ?? '') === 'anomaly' ? 'anomaly' : 'direct'
  const events = Array.isArray(doc.events)
    ? doc.events.map((item, index) => normalizeEvent(item, index))
    : []
  if (!name) throw new Error('模式名称为必填项')
  if (!id) {
    const stamp = Date.now().toString(36)
    const prefix = agentId || 'all'
    id = `${prefix}-mode-${stamp}`.slice(0, 64)
  }

  await pool.query(
    `INSERT INTO calculator_damage_event_modes
      (id, agent_id, name, mode_type, events_json, sort_order)
     VALUES (?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       agent_id = VALUES(agent_id),
       name = VALUES(name),
       mode_type = VALUES(mode_type),
       events_json = VALUES(events_json)`,
    [id, agentId, name, modeType, JSON.stringify(events)],
  )

  const [rows] = await pool.query(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [id])
  return rowToDoc(rows[0])
}

export async function deleteDamageEventMode(id) {
  await ensureTable()
  const safeId = String(id ?? '').trim()
  if (!safeId) throw new Error('缺少模式 ID')
  await pool.query(`DELETE FROM ${TABLE} WHERE id = ?`, [safeId])
  return { id: safeId }
}
