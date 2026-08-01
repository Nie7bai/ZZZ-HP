/**
 * 将 export JSON 中的计算器头像统一为 public 固定路径（/{folder}/{id}.ext），
 * 并从 calculator_image / character 等已有目录复制文件。
 *
 * Usage:
 *   node scripts/sync-calculator-public-avatars.mjs
 *   node scripts/sync-calculator-public-avatars.mjs --file path/to/export.json
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { syncCalculatorExportAvatars } from '../src/utils/calculatorPublicAsset.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

const jsonPath =
  readArg('--file') || path.join(__dirname, 'data', 'zzz-hp-calculator-buffs.json')

if (!fs.existsSync(jsonPath)) {
  console.error(`找不到 export 文件: ${jsonPath}`)
  console.error('请先运行: npm run export:calculator-buffs')
  process.exit(1)
}

const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
const { stats, missing } = syncCalculatorExportAvatars(doc)

fs.writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')

console.log(
  `头像同步完成 → ${jsonPath}\n` +
    `  已统一 ${stats.ok} · 已迁移 ${stats.updated} · 缺源文件 ${stats.missing} · 跳过 ${stats.skip}`,
)

if (missing.length) {
  console.warn('\n以下条目找不到源图片，请在管理后台重传或手动放入 public/：')
  for (const item of missing.slice(0, 20)) {
    console.warn(`  [${item.kind}] ${item.id} (${item.name}): ${item.avatar}`)
  }
  if (missing.length > 20) {
    console.warn(`  … 另有 ${missing.length - 20} 条`)
  }
}
