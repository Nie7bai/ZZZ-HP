import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import { spawnSync } from 'child_process'
import { createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import { createGzip } from 'zlib'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const packagesDir = path.resolve(root, '..', 'packages')

const TABLES = [
  'guestbook_user',
  'guestbook',
  'guestbook_comment',
  'guestbook_like',
  'guestbook_favorite',
  'guestbook_comment_mute',
  'guestbook_post_view',
  'guestbook_follow',
  'guestbook_block',
  'guestbook_moderator',
  'guestbook_notification',
  'guestbook_dm_conversation',
  'guestbook_dm_message',
  'site_info_section',
  'changelog',
]

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL'
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0')
    const y = value.getFullYear()
    const m = pad(value.getMonth() + 1)
    const d = pad(value.getDate())
    const hh = pad(value.getHours())
    const mm = pad(value.getMinutes())
    const ss = pad(value.getSeconds())
    return `'${y}-${m}-${d} ${hh}:${mm}:${ss}'`
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'NULL'
    return String(value)
  }
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

async function exportTable(conn, table, out) {
  const [exists] = await conn.query(
    `SELECT COUNT(*) AS cnt
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  )
  if (!Number(exists[0]?.cnt)) {
    out.push(`-- skip missing table: ${table}`)
    out.push('')
    return { table, rows: 0, missing: true }
  }

  const [rows] = await conn.query(`SELECT * FROM \`${table}\``)
  out.push(`-- table: ${table} (${rows.length} rows)`)
  out.push(`DELETE FROM \`${table}\`;`)

  if (!rows.length) {
    out.push('')
    return { table, rows: 0 }
  }

  const cols = Object.keys(rows[0])
  const colList = cols.map((c) => `\`${c}\``).join(', ')
  const chunkSize = 50
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const values = chunk
      .map((row) => `(${cols.map((c) => sqlLiteral(row[c])).join(', ')})`)
      .join(',\n')
    out.push(`INSERT INTO \`${table}\` (${colList}) VALUES\n${values};`)
  }
  out.push('')
  return { table, rows: rows.length }
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return 0
  fs.mkdirSync(dest, { recursive: true })
  let count = 0
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      count += copyDir(from, to)
    } else {
      fs.copyFileSync(from, to)
      count += 1
    }
  }
  return count
}

function tryZip(stageDir, zipPath) {
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  '${stageDir.replace(/'/g, "''")}',
  '${zipPath.replace(/'/g, "''")}',
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)
`
  const result = spawnSync('powershell', ['-NoProfile', '-Command', ps], {
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'zip failed')
  }
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'zzz',
  charset: 'utf8mb4',
  dateStrings: false,
})

const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\.\d+Z$/, '')
  .replace('T', '-')

fs.mkdirSync(packagesDir, { recursive: true })
const stageDir = path.join(packagesDir, `guestbook-export-${stamp}`)
const sqlPath = path.join(stageDir, 'guestbook-data.sql')
const imagesDest = path.join(stageDir, 'guestbook_image')
const zipPath = path.join(packagesDir, `guestbook-export-${stamp}.zip`)

fs.rmSync(stageDir, { recursive: true, force: true })
fs.mkdirSync(stageDir, { recursive: true })

const dbName = process.env.DB_NAME || 'zzz'
const lines = [
  '-- ZZZ-HP guestbook export',
  `-- Generated: ${new Date().toISOString()}`,
  `-- Database: ${dbName}`,
  'SET NAMES utf8mb4;',
  `CREATE DATABASE IF NOT EXISTS \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
  `USE \`${dbName}\`;`,
  'SET FOREIGN_KEY_CHECKS=0;',
  '',
]

const summary = []
for (const table of TABLES) {
  summary.push(await exportTable(conn, table, lines))
}
lines.push('SET FOREIGN_KEY_CHECKS=1;')
lines.push('')

fs.writeFileSync(sqlPath, lines.join('\n'), 'utf8')

const imageSrc = path.join(root, 'guestbook_image')
const imageCount = copyDir(imageSrc, imagesDest)

const readme = [
  'ZZZ-HP guestbook export',
  '',
  '[Files]',
  '- guestbook-data.sql  : posts / comments / users / knock / follows / site_info / changelog',
  '- guestbook_image/    : uploaded images',
  '',
  '[Import on cloud]',
  '1. Backup cloud DB first',
  '2. cd zzz-hp-backend',
  '3. mysql -u USER -p DB_NAME < guestbook-data.sql',
  '   or: Get-Content .\\guestbook-data.sql -Raw -Encoding UTF8 | mysql -u USER -p DB_NAME',
  '4. Copy guestbook_image/* into cloud zzz-hp-backend/guestbook_image/',
  '5. Restart backend',
  '',
  '[Summary]',
  ...summary.map((s) =>
    s.missing ? `- ${s.table}: missing` : `- ${s.table}: ${s.rows} rows`,
  ),
  `- guestbook_image files: ${imageCount}`,
  '',
]
fs.writeFileSync(path.join(stageDir, 'IMPORT-README.txt'), readme.join('\n'), 'utf8')

await conn.end()

tryZip(stageDir, zipPath)

const zipSize = fs.statSync(zipPath).size
console.log('Export done.')
console.log(`Folder: ${stageDir}`)
console.log(`Zip:    ${zipPath}`)
console.log(`Size:   ${(zipSize / 1024 / 1024).toFixed(2)} MB`)
console.log('Tables:')
for (const s of summary) {
  console.log(s.missing ? `  - ${s.table}: missing` : `  - ${s.table}: ${s.rows} rows`)
}
console.log(`Images: ${imageCount} files`)

try {
  spawnSync('explorer', [`/select,${zipPath}`], { shell: true })
} catch {
  /* ignore */
}
