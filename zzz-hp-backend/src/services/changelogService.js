import pool from '../config/db.js'

function mapRow(row) {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    content: row.content,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listChangelogs() {
  const [rows] = await pool.query(
    `SELECT id, version, title, content, published_at, created_at, updated_at
     FROM changelog
     ORDER BY published_at DESC, id DESC`,
  )
  return rows.map(mapRow)
}

export async function getChangelogById(id) {
  const [rows] = await pool.query(
    `SELECT id, version, title, content, published_at, created_at, updated_at
     FROM changelog WHERE id = ? LIMIT 1`,
    [id],
  )
  return rows[0] ? mapRow(rows[0]) : null
}

export async function createChangelog({ version, title, content, publishedAt }) {
  const published = publishedAt ? new Date(publishedAt) : new Date()
  const [result] = await pool.query(
    `INSERT INTO changelog (version, title, content, published_at)
     VALUES (?, ?, ?, ?)`,
    [version, title, content, published],
  )
  return getChangelogById(result.insertId)
}

export async function updateChangelog(id, { version, title, content, publishedAt }) {
  const existing = await getChangelogById(id)
  if (!existing) return null

  const published = publishedAt ? new Date(publishedAt) : new Date(existing.publishedAt)
  await pool.query(
    `UPDATE changelog
     SET version = ?, title = ?, content = ?, published_at = ?
     WHERE id = ?`,
    [version, title, content, published, id],
  )
  return getChangelogById(id)
}

export async function deleteChangelog(id) {
  const [result] = await pool.query(`DELETE FROM changelog WHERE id = ?`, [id])
  return result.affectedRows > 0
}
