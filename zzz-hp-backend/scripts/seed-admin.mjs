/**
 * Create admin table and seed hashed password on first run only.
 *
 * Requires ADMIN_PASSWORD in .env (never commit plaintext passwords to Git).
 *
 * Usage:
 *   node scripts/seed-admin.mjs
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mysql from 'mysql2/promise'
import { hashAdminPassword } from '../src/utils/adminPasswordHash.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CREATE_SQL = fs.readFileSync(path.join(__dirname, '..', 'create_admin_table.sql'), 'utf8')

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
  multipleStatements: true,
})

try {
  await conn.query(CREATE_SQL)
  console.log('Ensured admin table exists')

  const [rows] = await conn.query('SELECT id FROM `admin` ORDER BY id ASC LIMIT 1')
  if (!rows.length) {
    const hash = await hashAdminPassword(plainPassword)
    await conn.execute('INSERT INTO `admin` (`password`) VALUES (?)', [hash])
    console.log('Inserted admin with bcrypt password hash')
  } else {
    console.log(`Admin already exists (id=${rows[0].id}); skipped password update`)
    console.log(
      'To change password, stop the backend first; run node scripts/set-admin-password.mjs, then restart only after it succeeds.',
    )
  }

  console.log('Done.')
} finally {
  await conn.end()
}
