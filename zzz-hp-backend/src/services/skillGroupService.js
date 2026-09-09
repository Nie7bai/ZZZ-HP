import pool from '../config/db.js'

const TABLE = '`calculator_skill_groups`'

let ensured = false

async function ensureTable() {
  if (ensured) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS calculator_skill_groups (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      agent_id VARCHAR(64) NOT NULL DEFAULT '',
      name VARCHAR(128) NOT NULL,
      note TEXT NULL,
      members TEXT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  ensured = true
}

function readNumber(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function parseMembers(raw) {
  if (!raw) return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item, index) => {
        const skillId = String(item?.skillId ?? '').trim()
        if (!skillId) return null
        return {
          skillId,
          order: readNumber(item?.order, index),
          count: Math.max(0, readNumber(item?.count, 1)),
          includeInFlow: item?.includeInFlow !== false,
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.order - b.order || a.skillId.localeCompare(b.skillId))
  } catch {
    return []
  }
}

function rowToDoc(row) {
  return {
    id: String(row.id),
    agentId: String(row.agent_id ?? ''),
    name: String(row.name ?? ''),
    note: row.note == null ? '' : String(row.note),
    members: parseMembers(row.members),
  }
}

export async function listSkillGroups() {
  await ensureTable()
  const [rows] = await pool.query(
    `SELECT * FROM ${TABLE} ORDER BY agent_id ASC, sort_order ASC, name ASC, id ASC`,
  )
  return rows.map(rowToDoc)
}

export async function upsertSkillGroup(doc) {
  await ensureTable()
  let id = String(doc.id ?? '').trim()
  const agentId = String(doc.agentId ?? '').trim()
  const name = String(doc.name ?? '').trim()
  const note = String(doc.note ?? '').trim()
  const members = parseMembers(doc.members ?? [])

  if (!name) throw new Error('技能组名称为必填项')
  if (!id) {
    const stamp = Date.now().toString(36)
    const prefix = agentId || 'all'
    id = `sg-${prefix}-${stamp}`.slice(0, 64)
  }

  await pool.query(
    `INSERT INTO calculator_skill_groups
      (id, agent_id, name, note, members, sort_order)
     VALUES (?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       agent_id = VALUES(agent_id),
       name = VALUES(name),
       note = VALUES(note),
       members = VALUES(members)`,
    [id, agentId, name, note || null, JSON.stringify(members)],
  )

  const [rows] = await pool.query(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [id])
  return rowToDoc(rows[0])
}

export async function deleteSkillGroup(id) {
  await ensureTable()
  const safeId = String(id ?? '').trim()
  if (!safeId) throw new Error('缺少技能组 ID')
  // 级联删除组私有招式（列不存在时忽略）
  try {
    await pool.query(`DELETE FROM calculator_skills WHERE owner_group_id = ?`, [safeId])
  } catch {
    /* owner_group_id 尚未迁移时忽略 */
  }
  await pool.query(`DELETE FROM ${TABLE} WHERE id = ?`, [safeId])
  return { id: safeId }
}
