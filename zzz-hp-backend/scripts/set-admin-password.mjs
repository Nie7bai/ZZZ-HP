/**
 * Set or rotate admin password hash from ADMIN_PASSWORD in .env.
 *
 * Usage:
 *   node scripts/set-admin-password.mjs
 */
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import { hashAdminPassword } from '../src/utils/adminPasswordHash.js'

dotenv.config()

const plainPassword = process.env.ADMIN_PASSWORD?.trim()
if (!plainPassword) {
  console.error('请先在 .env 中设置 ADMIN_PASSWORD，再运行本脚本。')
  process.exit(1)
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'zzz',
})

try {
  const hash = await hashAdminPassword(plainPassword)
  const [rows] = await conn.query('SELECT id FROM `admin` ORDER BY id ASC LIMIT 1')

  if (!rows.length) {
    await conn.execute('INSERT INTO `admin` (`password`) VALUES (?)', [hash])
    console.log('Created admin with bcrypt password hash')
  } else {
    await conn.execute('UPDATE `admin` SET `password` = ? WHERE `id` = ?', [
      hash,
      rows[0].id,
    ])
    console.log(`Updated admin #${rows[0].id} password hash`)
  }

  console.log('Done.')
} finally {
  await conn.end()
}
