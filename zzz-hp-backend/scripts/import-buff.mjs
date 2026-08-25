/**
 * 从 JSON 导入 buff 表
 *
 * Usage:
 *   node scripts/import-buff.mjs
 *   node scripts/import-buff.mjs --file path/to/buff.json
 *   node scripts/import-buff.mjs --mode crisis
 *   node scripts/import-buff.mjs --replace
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pool from '../src/config/db.js'
import { importBuffTableSnapshot } from '../src/utils/buffTableSnapshot.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

const replaceAll = process.argv.includes('--replace')
const modeFilter = readArg('--mode')
const filePath = readArg('--file') || path.join(__dirname, 'data', 'buff.json')

if (!fs.existsSync(filePath)) {
  console.error(`文件不存在: ${filePath}`)
  process.exit(1)
}

const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
const summary = await importBuffTableSnapshot(raw, {
  replace: replaceAll,
  mode: modeFilter,
})

console.log(
  `导入完成: 写入源 ${summary.total} 条 → 新增 ${summary.inserted} · 更新 ${summary.updated} · 跳过 ${summary.skipped}` +
    (summary.replaced ? '（--replace）' : '') +
    (summary.modeFilter ? ` · mode=${summary.modeFilter}` : ''),
)
await pool.end()
process.exit(0)
