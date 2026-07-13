import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

dotenv.config()

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'zzz',
})

const [rows] = await conn.query(
  "SELECT id, name, note, mindscape_notes FROM `character` WHERE TRIM(note) <> ''",
)

for (const row of rows) {
  console.log('---', row.id, row.name, '---')
  console.log(row.note)
  console.log('')
}

console.log('count', rows.length)
await conn.end()
