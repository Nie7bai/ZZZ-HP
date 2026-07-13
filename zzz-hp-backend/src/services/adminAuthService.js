import pool from '../config/db.js'

export async function verifyAdminPassword(password) {
  const input = typeof password === 'string' ? password : ''
  if (!input) return false

  const [rows] = await pool.query(
    'SELECT `password` FROM `admin` ORDER BY `id` ASC LIMIT 1',
  )
  if (!rows.length) return false
  return rows[0].password === input
}
