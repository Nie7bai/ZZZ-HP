/**
 * 导出 buff 表 → JSON（危局 / 防卫 / 临界环境 Buff）
 *
 * 用法：
 *   node scripts/export-buff.mjs
 *   node scripts/export-buff.mjs --mode crisis
 *   node scripts/export-buff.mjs --file path/to/buff.json
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pool from '../src/config/db.js'
import { exportBuffTableSnapshot } from '../src/utils/buffTableSnapshot.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

const modeFilter = readArg('--mode')
const outPath = readArg('--file') || path.join(__dirname, 'data', 'buff.json')

const doc = await exportBuffTableSnapshot(modeFilter)
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
console.log(`Wrote ${outPath}`)
console.log(`rows: ${doc.count}`, doc.byMode)
await pool.end()
process.exit(0)
