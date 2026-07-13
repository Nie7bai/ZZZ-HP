/**
 * Add note column to W-Engine and backfill empty notes.
 *
 * Usage:
 *   node scripts/migrate-wengine-note.mjs
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mysql from 'mysql2/promise'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ALTER_SQL = fs.readFileSync(path.join(__dirname, '..', 'alter_wengine_note.sql'), 'utf8')

function parseJson(value, fallback) {
  if (value == null) return fallback
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return fallback
    }
  }
  return fallback
}

function asJson(value) {
  return JSON.stringify(value ?? null)
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
  const [columns] = await conn.query("SHOW COLUMNS FROM `W-Engine` LIKE 'note'")
  if (!columns.length) {
    await conn.query(
      "ALTER TABLE `W-Engine` ADD COLUMN `note` TEXT NOT NULL COMMENT '音擎注释' AFTER `avatar_image`",
    )
    console.log('Added W-Engine.note column')
  } else {
    console.log('W-Engine.note already exists')
  }

  const [rows] = await conn.query('SELECT id, name, note, raw_json FROM `W-Engine`')
  let updated = 0

  await conn.beginTransaction()

  for (const row of rows) {
    const raw = parseJson(row.raw_json, {})
    const note = typeof row.note === 'string' ? row.note : typeof raw.note === 'string' ? raw.note : ''
    const nextRaw = { ...raw, note }

    if (note === (raw.note ?? '') && typeof row.note === 'string') {
      continue
    }

    await conn.execute(
      `UPDATE \`W-Engine\`
       SET note = ?, raw_json = CAST(? AS JSON)
       WHERE id = ?`,
      [note, asJson(nextRaw), row.id],
    )
    updated += 1
    console.log(`Updated ${row.id} (${row.name})`)
  }

  await conn.commit()
  console.log(`Done. Synced ${updated} / ${rows.length} wengines.`)
} catch (err) {
  await conn.rollback()
  throw err
} finally {
  await conn.end()
}
