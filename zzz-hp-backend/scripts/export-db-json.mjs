/**
 * 把整库内容导出成一份 JSON（数据库内容快照）。
 *
 * 用法：
 *   node scripts/export-db-json.mjs                       # 全表 → json备份/zzz-hp-db-full-<时间戳>.json
 *   node scripts/export-db-json.mjs --file out.json       # 指定输出
 *   node scripts/export-db-json.mjs --tables boss,buff    # 只导指定表
 *   node scripts/export-db-json.mjs --exclude guestbook_* # 排除某些表（支持 * 通配）
 *
 * 为什么要有它：库里的内容（词条预设、buff、怪物、赛季……）不进 git，
 * 换机器 / 合并分支 / 大改之前需要一份**完整可读**的快照。逐表导出的脚本
 * （export-calculator-buffs 之类）解决的是「把某块内容同步出去」，
 * 这里解决的是「整库留档」——两者互补。
 *
 * 口径：
 * - 只读，不写库；
 * - 行按主键顺序取（`SELECT *` 不保证顺序，为了 diff 友好这里显式排序）；
 * - DECIMAL 保持 mysql2 默认的字符串形态（不转 number，避免精度陷阱）；
 * - BLOB/Buffer 转成 `{ "$base64": "..." }`，JSON 里不留 `{type:"Buffer"}` 这种噪声；
 * - ⚠️ 产物含账号类数据（admin / guestbook_user 的密码哈希）。**不要提交进 git**，
 *   默认输出目录 `json备份/` 里的文件默认未跟踪，但也别 `git add` 它。
 */
import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pool from '../src/config/db.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

/** `--tables a,b` / `--exclude x*`：逗号分隔的简单通配（只支持 `*` 前缀/后缀） */
function matches(name, patterns) {
  return patterns.some((pattern) => {
    if (pattern.endsWith('*')) return name.startsWith(pattern.slice(0, -1))
    if (pattern.startsWith('*')) return name.endsWith(pattern.slice(1))
    return name === pattern
  })
}

function stamp() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
}

/** JSON 里不留 Buffer 噪声：二进制走 base64，带显式标记便于将来还原 */
function toJsonSafe(value) {
  if (Buffer.isBuffer(value)) return { $base64: value.toString('base64') }
  if (value instanceof Date) return value.toISOString()
  return value
}

function rowToJson(row) {
  const out = {}
  for (const [key, value] of Object.entries(row)) out[key] = toJsonSafe(value)
  return out
}

const onlyTables = readArg('--tables')
  ?.split(',')
  .map((item) => item.trim())
  .filter(Boolean)
const excluded = readArg('--exclude')
  ?.split(',')
  .map((item) => item.trim())
  .filter(Boolean)

const outPath =
  readArg('--file') ||
  path.resolve(__dirname, '..', '..', 'json备份', `zzz-hp-db-full-${stamp()}.json`)

const [tableRows] = await pool.query(`
  SELECT TABLE_NAME AS name
    FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
   ORDER BY TABLE_NAME
`)

let tables = tableRows.map((row) => String(row.name))
if (onlyTables?.length) tables = tables.filter((name) => matches(name, onlyTables))
if (excluded?.length) tables = tables.filter((name) => !matches(name, excluded))

/** 每张表的排序键：有 id 用 id，其次 name，再不行按行序（保证两次导出可 diff） */
async function orderByFor(table) {
  const [columns] = await pool.query(
    `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [table],
  )
  const names = columns.map((column) => String(column.name))
  if (names.includes('id')) return 'ORDER BY `id`'
  if (names.includes('name')) return 'ORDER BY `name`'
  return ''
}

const dump = {
  kind: 'zzz-hp-db-dump',
  database: (await pool.query('SELECT DATABASE() AS d'))[0][0].d,
  exportedAt: new Date().toISOString(),
  host: process.env.DB_HOST || 'localhost',
  tables: {},
}

console.log(`导出整库 → ${outPath}`)
let totalRows = 0
try {
  for (const table of tables) {
    const orderBy = await orderByFor(table)
    const [rows] = await pool.query(`SELECT * FROM \`${table}\` ${orderBy}`)
    dump.tables[table] = { rowCount: rows.length, rows: rows.map(rowToJson) }
    totalRows += rows.length
    console.log(`  ${table.padEnd(34)} ${String(rows.length).padStart(6)} 行`)
  }
} finally {
  await pool.end()
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(dump, null, 2)}\n`, 'utf8')
const sizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2)
console.log(`\n完成：${Object.keys(dump.tables).length} 张表 / ${totalRows} 行 / ${sizeMb} MB`)
console.log(`kind=${dump.kind}`)
