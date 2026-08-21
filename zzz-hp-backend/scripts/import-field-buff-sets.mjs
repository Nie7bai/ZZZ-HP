/**
 * 从 JSON 导入危局场地 Buff 多套 + 期数绑定
 * 源文件：scripts/data/field-buff-sets.json
 *
 * Usage:
 *   node scripts/import-field-buff-sets.mjs
 *   node scripts/import-field-buff-sets.mjs --file path/to/field-buff-sets.json
 *
 * 匹配规则：
 *   - boss_info：按 boss_name
 *   - boss 绑定：按 version + phase + boss_name
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pool from '../src/config/db.js'
import { ensureEnvironmentBuffSchema } from '../src/utils/environmentBuffSchema.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

const filePath =
  readArg('--file') || path.join(__dirname, 'data', 'field-buff-sets.json')

function asJsonColumn(value) {
  if (value == null) return null
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

if (!fs.existsSync(filePath)) {
  console.error(`文件不存在: ${filePath}`)
  process.exit(1)
}

const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
const bossInfo = Array.isArray(raw.bossInfo) ? raw.bossInfo : []
const bossBindings = Array.isArray(raw.bossBindings) ? raw.bossBindings : []

await ensureEnvironmentBuffSchema()

let infoUpdated = 0
let infoMissing = 0
for (const item of bossInfo) {
  const bossName = String(item.bossName || '').trim()
  if (!bossName) continue
  const sets = Array.isArray(item.fieldBuffSets) ? item.fieldBuffSets : []
  const [result] = await pool.execute(
    `UPDATE boss_info
     SET field_buff_sets = ?,
         field_buff_name = ?,
         field_buff_text = ?,
         field_buff_image = ?,
         field_buff_effect_blocks = ?
     WHERE boss_name = ?`,
    [
      asJsonColumn(sets),
      item.fieldBuffName ?? null,
      item.fieldBuffText ?? null,
      item.fieldBuffImage ?? null,
      asJsonColumn(item.fieldBuffEffectBlocks ?? null),
      bossName,
    ],
  )
  if (result.affectedRows > 0) infoUpdated += 1
  else {
    infoMissing += 1
    console.warn(`[skip] boss_info 无此怪物: ${bossName}`)
  }
}

let bindUpdated = 0
let bindMissing = 0
for (const item of bossBindings) {
  const bossName = String(item.bossName || '').trim()
  const version = String(item.version ?? '').trim()
  const phase = String(item.phase ?? '').trim()
  const setId = String(item.fieldBuffSetId || '').trim()
  if (!bossName || !version || !phase || !setId) continue
  const [result] = await pool.execute(
    `UPDATE boss
     SET field_buff_set_id = ?
     WHERE boss_name = ? AND version = ? AND phase = ?`,
    [setId, bossName, version, phase],
  )
  if (result.affectedRows > 0) bindUpdated += 1
  else {
    bindMissing += 1
    console.warn(`[skip] boss 无匹配行: ${version}/${phase} ${bossName}`)
  }
}

console.log(
  `导入完成: bossInfo 更新 ${infoUpdated}/${bossInfo.length}（缺失 ${infoMissing}）, ` +
    `绑定更新 ${bindUpdated}/${bossBindings.length}（缺失 ${bindMissing}）`,
)
process.exit(0)
