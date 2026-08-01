import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mysql from 'mysql2/promise'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.join(__dirname, '..')

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'zzz',
})

const [rows] = await conn.query(
  `SELECT boss_name, boss_image FROM boss WHERE boss_image IS NOT NULL AND boss_image <> '' LIMIT 500`,
)

const missing = []
const seen = new Set()
for (const row of rows) {
  const url = String(row.boss_image)
  if (seen.has(url)) continue
  seen.add(url)
  const rel = url.replace(/^\//, '')
  const file = path.join(backendRoot, rel.replace(/\//g, path.sep))
  if (!fs.existsSync(file)) {
    missing.push({ boss_name: row.boss_name, boss_image: url })
  }
}

console.log(`checked ${seen.size} unique boss_image paths, missing ${missing.length}`)
console.log(missing.slice(0, 20))

await conn.end()
