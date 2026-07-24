import mysql from 'mysql2/promise'
import dotenv from 'dotenv'

dotenv.config()

const DEFENSE_SEASON_DATES = {
  '2.4-1': { startDate: '2025-12-05', endDate: '2025-12-19' },
  '2.4-2': { startDate: '2025-12-19', endDate: '2025-12-29' },
  '2.5-1': { startDate: '2025-12-30', endDate: '2026-01-09' },
  '2.5-2': { startDate: '2026-01-09', endDate: '2026-01-23' },
  '2.5-3': { startDate: '2026-01-23', endDate: '2026-02-06' },
  '2.6-1': { startDate: '2026-02-06', endDate: '2026-02-20' },
  '2.6-2': { startDate: '2026-02-20', endDate: '2026-03-06' },
  '2.6-3': { startDate: '2026-03-06', endDate: '2026-03-20' },
  '2.6-4': { startDate: '2026-03-20', endDate: '2026-04-03' },
  '2.7-1': { startDate: '2026-04-03', endDate: '2026-04-17' },
  '2.7-2': { startDate: '2026-04-17', endDate: '2026-05-01' },
  '2.7-3': { startDate: '2026-05-01', endDate: '2026-05-15' },
  '2.8-1': { startDate: '2026-05-15', endDate: '2026-05-29' },
  '2.8-2': { startDate: '2026-05-29', endDate: '2026-06-12' },
  '2.8-3': { startDate: '2026-06-12', endDate: '2026-06-26' },
  '3.0-1': { startDate: '2026-06-26', endDate: '2026-07-10' },
  '3.0-2': { startDate: '2026-07-10', endDate: '2026-07-24' },
  '3.0-3': { startDate: '2026-07-24', endDate: '2026-08-07' },
  '3.0-4': { startDate: '2026-07-29', endDate: '2026-08-12' },
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'zzz',
  charset: 'utf8mb4',
})

let n = 0
for (const [key, dates] of Object.entries(DEFENSE_SEASON_DATES)) {
  const [version, phase] = key.split('-')
  await conn.query(
    `INSERT INTO \`date\` (mode, version, phase, start_date, end_date)
     VALUES ('defense', ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE start_date = VALUES(start_date), end_date = VALUES(end_date)`,
    [version, phase, dates.startDate, dates.endDate],
  )
  n += 1
}

console.log(`Seeded ${n} defense season dates`)
await conn.end()
