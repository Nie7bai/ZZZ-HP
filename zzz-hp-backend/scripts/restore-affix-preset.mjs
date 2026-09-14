/**
 * 用 export-affix-preset.mjs 的 JSON 灌回官方预设（多方案）。
 *
 * 用法：
 *   node scripts/restore-affix-preset.mjs <backup.json> --dry
 *   node scripts/restore-affix-preset.mjs <backup.json>
 *
 * 语义：备份里的每一套方案整份替换写库；备份里没有的方案不删。
 * 迁移失败时先用备份灌回，再查。见方案 §5.1。
 */
import fs from 'node:fs'
import path from 'node:path'
import { replaceAffixPreset } from '../src/services/affixPresetService.js'
import pool from '../src/config/db.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry')
const fileArg = args.find((item) => !item.startsWith('--'))

if (!fileArg) {
  console.error('用法：node scripts/restore-affix-preset.mjs <backup.json> [--dry]')
  process.exit(1)
}

const sourceFile = path.resolve(fileArg)
if (!fs.existsSync(sourceFile)) {
  console.error(`找不到文件：${sourceFile}`)
  process.exit(1)
}

const payload = JSON.parse(fs.readFileSync(sourceFile, 'utf8'))
const schemes = Array.isArray(payload.schemes) ? payload.schemes : []
if (!schemes.length) {
  console.error('备份里没有 schemes')
  process.exit(1)
}

console.log(`来源：${sourceFile}`)
console.log(`方案 ${schemes.length} 套`)
for (const scheme of schemes) {
  const name = String(scheme.name ?? '')
  const entries = Array.isArray(scheme.entries) ? scheme.entries : []
  const groups = Array.isArray(scheme.groups) ? scheme.groups : []
  console.log(`  ${scheme.isDefault ? '[默认] ' : '       '}${name} — 条目 ${entries.length} / 分组 ${groups.length}`)
}

if (dryRun) {
  console.log('\n--dry：未写库。')
  await pool.end()
  process.exit(0)
}

for (const scheme of schemes) {
  const name = String(scheme.name ?? '').trim()
  const entries = Array.isArray(scheme.entries) ? scheme.entries : []
  const groups = Array.isArray(scheme.groups) ? scheme.groups : []
  const after = await replaceAffixPreset({ scheme: name, entries, groups })
  console.log(`已恢复「${after.scheme}」：${after.entries.length} 条 / ${after.groups.length} 组`)
}

await pool.end()
process.exit(0)
