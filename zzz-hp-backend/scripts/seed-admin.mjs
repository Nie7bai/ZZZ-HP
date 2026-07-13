/**
 * Create admin table and seed default password.
 *
 * Usage:
 *   node scripts/seed-admin.mjs
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mysql from 'mysql2/promise'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CREATE_SQL = fs.readFileSync(path.join(__dirname, '..', 'create_admin_table.sql'), 'utf8')
const DEFAULT_PASSWORD = 'zzzhp_nie7bai'

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

  const [rows] = await conn.query('SELECT id, password FROM `admin` ORDER BY id ASC LIMIT 1')
  if (!rows.length) {
    await conn.execute('INSERT INTO `admin` (`password`) VALUES (?)', [DEFAULT_PASSWORD])
    console.log('Inserted default admin password')
  } else if (rows[0].password !== DEFAULT_PASSWORD) {
    await conn.execute('UPDATE `admin` SET `password` = ? WHERE `id` = ?', [
      DEFAULT_PASSWORD,
      rows[0].id,
    ])
    console.log(`Updated admin #${rows[0].id} password`)
  } else {
    console.log(`Admin password already set (id=${rows[0].id})`)
  }

  console.log('Done.')
} finally {
  await conn.end()
}
