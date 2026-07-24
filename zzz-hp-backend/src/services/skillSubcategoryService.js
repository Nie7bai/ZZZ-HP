import pool from '../config/db.js'

const TABLE = '`calculator_skill_subcategories`'

let ensured = false

async function ensureTable() {
  if (ensured) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS calculator_skill_subcategories (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      agent_id VARCHAR(64) NOT NULL DEFAULT '',
      category_id VARCHAR(32) NOT NULL,
      name VARCHAR(128) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  try {
    await pool.query(
      `ALTER TABLE calculator_skill_subcategories ADD COLUMN agent_id VARCHAR(64) NOT NULL DEFAULT '' AFTER id`,
    )
  } catch {
    // column may already exist
  }
  ensured = true
}

function rowToDoc(row) {
  return {
    id: String(row.id),
    agentId: String(row.agent_id ?? ''),
    categoryId: String(row.category_id),
    name: String(row.name ?? ''),
  }
}

export async function listSkillSubcategories() {
  await ensureTable()
  const [rows] = await pool.query(
    `SELECT * FROM ${TABLE} ORDER BY agent_id ASC, category_id ASC, name ASC, id ASC`,
  )
  return rows.map(rowToDoc)
}

export async function upsertSkillSubcategory(doc) {
  await ensureTable()
  let id = String(doc.id ?? '').trim()
  const agentId = String(doc.agentId ?? '').trim()
  const categoryId = String(doc.categoryId ?? '').trim()
  const name = String(doc.name ?? '').trim()
  if (!categoryId || !name) {
    throw new Error('招式小类大类与名称为必填项')
  }
  if (!agentId) {
    throw new Error('请选择所属角色')
  }
  if (!id) {
    const stamp = Date.now().toString(36)
    id = `${agentId}-${categoryId}-${stamp}`.slice(0, 64)
  }

  await pool.query(
    `INSERT INTO calculator_skill_subcategories (id, agent_id, category_id, name, sort_order)
     VALUES (?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       agent_id = VALUES(agent_id),
       category_id = VALUES(category_id),
       name = VALUES(name)`,
    [id, agentId, categoryId, name],
  )

  const [rows] = await pool.query(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [id])
  return rowToDoc(rows[0])
}

export async function deleteSkillSubcategory(id) {
  await ensureTable()
  const safeId = String(id ?? '').trim()
  if (!safeId) throw new Error('缺少小类 ID')
  await pool.query(`DELETE FROM ${TABLE} WHERE id = ?`, [safeId])
  return { id: safeId }
}
