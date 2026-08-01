import pool from '../config/db.js'
import {
  hashAdminPassword,
  isBcryptHash,
  verifyAdminPasswordHash,
} from '../utils/adminPasswordHash.js'

export async function verifyAdminPassword(password) {
  const input = typeof password === 'string' ? password.trim() : ''
  if (!input) return false

  const [rows] = await pool.query(
    'SELECT `id`, `password` FROM `admin` ORDER BY `id` ASC LIMIT 1',
  )
  if (!rows.length) return false

  const { id, password: stored } = rows[0]
  const ok = await verifyAdminPasswordHash(input, stored)
  if (!ok) return false

  if (!isBcryptHash(stored)) {
    const hash = await hashAdminPassword(input)
    await pool.query('UPDATE `admin` SET `password` = ? WHERE `id` = ?', [hash, id])
  }

  return true
}
