import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

dotenv.config()

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'zzz',
})

const [rows] = await conn.query(
  `SELECT name, note, mindscape_notes
   FROM \`character\`
   WHERE JSON_LENGTH(mindscape_notes) > 0
     AND mindscape_notes != JSON_ARRAY('', '', '', '', '', '', '')
   ORDER BY name
   LIMIT 8`,
)

for (const row of rows) {
  const notes = typeof row.mindscape_notes === 'string'
    ? JSON.parse(row.mindscape_notes)
    : row.mindscape_notes
  const filled = notes
    .map((n, i) => (String(n).trim() ? `${i}:${String(n).slice(0, 40)}…` : null))
    .filter(Boolean)
  console.log(`\n=== ${row.name} ===`)
  console.log('note:', row.note || '(empty)')
  console.log('mindscape:', filled.join('\n  '))
}

await conn.end()
