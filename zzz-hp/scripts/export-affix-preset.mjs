/**
 * 导出当前代码里的官方预设（构造器）为 JSON —— 用作灌库种子，也用作「代码版 vs 库里版」对拍。
 *
 * 运行：npx vite-node scripts/export-affix-preset.mjs
 * 产物：zzz-hp-backend/scripts/data/affix-preset.seed.json
 *
 * 背景：官方预设正在从「写死在代码里」迁到「数据库」（见 `dev-docs/affix-optimizer-impl-log.md`
 * 步骤 33）。构造器暂时保留当兜底；这份导出是**入库那一次的初始内容**，
 * 也是对拍基准 —— 库里改坏了可以据此还原。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  AFFIX_PRESET_GROUPS,
  createPresetAffixLibraryEntries,
} from '../src/utils/affixLibrary.ts'

const outDir = path.resolve('../zzz-hp-backend/scripts/data')
const outFile = path.join(outDir, 'affix-preset.seed.json')

const entries = createPresetAffixLibraryEntries().map((entry) => ({
  id: entry.id,
  label: entry.label,
  target: entry.target,
  perRoll: entry.perRoll,
  cap: entry.cap,
  group: entry.group,
  rollCost: entry.rollCost,
  enabledByDefault: entry.enabledByDefault,
}))

const groups = AFFIX_PRESET_GROUPS.map((group) => ({ name: group.name, cap: group.cap }))

// 按分组落位顺序写 sort_order，让库里的展示顺序与代码里一致
entries.forEach((entry, index) => {
  entry.sortOrder = index
})
groups.forEach((group, index) => {
  group.sortOrder = index
})

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(
  outFile,
  JSON.stringify({ exportedAt: new Date().toISOString(), entries, groups }, null, 2),
  'utf8',
)

const byGroup = new Map()
for (const entry of entries) byGroup.set(entry.group, (byGroup.get(entry.group) ?? 0) + 1)
console.log(`已导出 ${entries.length} 条 / ${groups.length} 组 → ${outFile}`)
for (const [name, count] of byGroup) console.log(`  ${name}: ${count} 条`)
