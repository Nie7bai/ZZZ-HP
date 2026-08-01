import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mysql from 'mysql2/promise'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.join(__dirname, '..')

function resolveFile(url) {
  if (!url) return null
  const rel = String(url).replace(/^\//, '')
  return path.join(backendRoot, rel.replace(/\//g, path.sep))
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'zzz',
})

const version = process.argv[2] || '3.1'
const phase = process.argv[3] || '1'

const [bosses] = await conn.query(
  `SELECT id, boss_name, boss_image, room FROM boss WHERE version = ? AND phase = ?`,
  [version, phase],
)
const [buffs] = await conn.query(
  `SELECT id, buff_name, buff_image FROM buff WHERE version = ? AND phase = ?`,
  [version, phase],
)

function report(label, rows, field) {
  console.log(`\n=== ${label} ${version} 第${phase}期 ===`)
  for (const row of rows) {
    const url = row[field]
    const file = resolveFile(url)
    const ok = file && fs.existsSync(file)
    console.log(`${ok ? 'OK' : 'MISSING'} | id=${row.id} | ${row.boss_name || row.buff_name} | ${url || '(null)'}`)
  }
}

report('Boss', bosses, 'boss_image')
report('Buff', buffs, 'buff_image')

await conn.end()
