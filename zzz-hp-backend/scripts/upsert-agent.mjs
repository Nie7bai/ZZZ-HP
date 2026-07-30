/**
 * 将单个角色 JSON 写入 MySQL（INSERT … ON DUPLICATE KEY UPDATE）。
 * 便于增量补全占位角色或后续更新影画/Buff，无需全量 import。
 *
 * Usage:
 *   node scripts/upsert-agent.mjs scripts/data/agents/remiel.json
 *   node scripts/upsert-agent.mjs --file path/to/agent.json
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pool from '../src/config/db.js'
import { upsertAgent } from '../src/services/calculatorBuffService.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

const positional = process.argv.slice(2).find((arg) => !arg.startsWith('-'))
const filePath =
  readArg('--file') ||
  (positional ? path.resolve(process.cwd(), positional) : null)

if (!filePath) {
  console.error('用法: node scripts/upsert-agent.mjs <agent.json>')
  process.exit(1)
}

if (!fs.existsSync(filePath)) {
  console.error(`找不到文件: ${filePath}`)
  process.exit(1)
}

try {
  const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const saved = await upsertAgent(doc)
  console.log(`已写入角色 ${saved.id}（${saved.name}）· ${saved.element || '未设属性'}`)
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await pool.end()
}
