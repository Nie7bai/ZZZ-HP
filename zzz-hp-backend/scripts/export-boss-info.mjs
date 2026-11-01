/**
 * 导出怪物基础库 → JSON 快照
 *
 * 用法：
 *   node scripts/export-boss-info.mjs
 *   node scripts/export-boss-info.mjs --file scripts/data/snapshots/2026-11-01/zzz-hp-boss-info.json
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pool from '../src/config/db.js'
import { exportBossInfoSnapshot } from '../src/utils/bossInfoSnapshot.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

const outPath = readArg('--file') || path.join(__dirname, 'data', 'boss-info.json')

const doc = await exportBossInfoSnapshot()
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
console.log(`Wrote ${outPath}`)
console.log(`kind: ${doc.kind}  count: ${doc.count}`)
await pool.end()
process.exit(0)
