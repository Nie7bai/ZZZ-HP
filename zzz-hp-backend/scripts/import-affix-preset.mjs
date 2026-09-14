/**
 * 把 JSON 里的官方预设词条库灌进数据库（**覆盖式**）。
 *
 * 用法：
 *   node scripts/import-affix-preset.mjs                    # 用 scripts/data/affix-preset.seed.json
 *   node scripts/import-affix-preset.mjs <path/to.json>      # 用指定文件
 *   node scripts/import-affix-preset.mjs --dry             # 只校验与打印，不写库
 *
 * 口径（用户 2026-09-12 拍板）：官方预设的唯一来源＝数据库，用户侧只读。
 * 见 `dev-docs/affix-optimizer-impl-log.md` 步骤 33。
 *
 * ⚠️ 覆盖式：表里现有的条目与分组会被清掉换成这份。**id 一旦发布不可改名**
 *（前端用户本地的 enabledOverride / overrides / removedEntryIds 都按 id 索引）。
 * 故脚本在写入前会把现有内容备份到 scripts/data/backups/。
 */
import fs from 'node:fs'
import path from 'node:path'
import pool from '../src/config/db.js'
import { listAffixPreset, replaceAffixPreset } from '../src/services/affixPresetService.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry')
const fileArg = args.find((item) => !item.startsWith('--'))
const sourceFile = fileArg
  ? path.resolve(fileArg)
  : path.resolve('scripts/data/affix-preset.seed.json')

if (!fs.existsSync(sourceFile)) {
  console.error(`找不到文件：${sourceFile}`)
  process.exit(1)
}

const payload = JSON.parse(fs.readFileSync(sourceFile, 'utf8'))
const entries = Array.isArray(payload.entries) ? payload.entries : []
const groups = Array.isArray(payload.groups) ? payload.groups : []

/** 与后端控制器同一套最小校验：id/label/target 必填，target 前缀合法 */
function validate() {
  const errors = []
  const seen = new Set()
  for (const [index, entry] of entries.entries()) {
    const id = String(entry.id ?? '').trim()
    const target = String(entry.target ?? '').trim()
    if (!id) errors.push(`第 ${index + 1} 条：缺 id`)
    else if (seen.has(id)) errors.push(`第 ${index + 1} 条：id 重复 ${id}`)
    else seen.add(id)
    if (!String(entry.label ?? '').trim()) errors.push(`第 ${index + 1} 条（${id}）：缺 label`)
    if (
      !target.startsWith('stat:') &&
      !target.startsWith('panel:') &&
      !target.startsWith('gain:')
    ) {
      errors.push(`第 ${index + 1} 条（${id}）：target 前缀非法 ${target}`)
    }
    if (!Number.isFinite(Number(entry.perRoll)) || Number(entry.perRoll) <= 0) {
      errors.push(`第 ${index + 1} 条（${id}）：perRoll 非正数`)
    }
  }
  const groupNames = new Set(groups.map((item) => String(item.name ?? '').trim()))
  for (const entry of entries) {
    const group = String(entry.group ?? '').trim()
    if (group && !groupNames.has(group)) {
      errors.push(`${entry.id}：分组「${group}」不在 groups 列表里`)
    }
  }
  return errors
}

const errors = validate()
if (errors.length) {
  console.error(`校验失败（${errors.length} 项）：`)
  for (const err of errors) console.error('  - ' + err)
  process.exit(1)
}

const byGroup = new Map()
for (const entry of entries) {
  const key = String(entry.group ?? '').trim() || '(未分组)'
  byGroup.set(key, (byGroup.get(key) ?? 0) + 1)
}
console.log(`来源：${sourceFile}`)
console.log(`待写入：${entries.length} 条 / ${groups.length} 组`)
for (const [name, count] of byGroup) console.log(`  ${name}: ${count} 条`)
console.log(`默认启用：${entries.filter((e) => e.enabledByDefault).length} 条`)

if (dryRun) {
  console.log('\n--dry：未写库。')
  await pool.end()
  process.exit(0)
}

// 写入前备份现有内容（表可能还不存在 —— 首次灌库时 listAffixPreset 会先建表）
const before = await listAffixPreset()
if (before.entries.length || before.groups.length) {
  const backupDir = path.resolve('scripts/data/backups')
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const backupFile = path.join(backupDir, `affix-preset.before-import-${stamp}.json`)
  fs.writeFileSync(backupFile, JSON.stringify(before, null, 2), 'utf8')
  console.log(`\n已备份现有内容 → ${backupFile}`)
}

const after = await replaceAffixPreset({ entries, groups })
console.log(`\n完成：库里现有 ${after.entries.length} 条 / ${after.groups.length} 组`)
await pool.end()
process.exit(0)
