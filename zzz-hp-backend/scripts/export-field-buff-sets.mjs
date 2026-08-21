/**
 * 导出危局场地 Buff 多套 + 期数绑定 → JSON
 * 用法：node scripts/export-field-buff-sets.mjs
 * 产出：scripts/data/field-buff-sets.json
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pool from '../src/config/db.js'
import { ensureEnvironmentBuffSchema } from '../src/utils/environmentBuffSchema.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outPath = path.join(__dirname, 'data', 'field-buff-sets.json')

function asArray(value) {
  if (value == null) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

await ensureEnvironmentBuffSchema()

const [infoRows] = await pool.query(`
  SELECT boss_name, field_buff_sets,
         field_buff_name, field_buff_text, field_buff_image, field_buff_effect_blocks
  FROM boss_info
  WHERE field_buff_sets IS NOT NULL AND JSON_LENGTH(field_buff_sets) > 0
  ORDER BY boss_name
`)

const [bossRows] = await pool.query(`
  SELECT version, phase, boss_name, field_buff_set_id
  FROM boss
  WHERE field_buff_set_id IS NOT NULL AND TRIM(field_buff_set_id) <> ''
  ORDER BY version, phase, boss_name
`)

const doc = {
  version: 1,
  exportedAt: new Date().toISOString(),
  bossInfo: infoRows.map((row) => ({
    bossName: row.boss_name,
    fieldBuffSets: asArray(row.field_buff_sets),
    // 旧列镜像，便于兼容只读旧接口
    fieldBuffName: row.field_buff_name ?? null,
    fieldBuffText: row.field_buff_text ?? null,
    fieldBuffImage: row.field_buff_image ?? null,
    fieldBuffEffectBlocks: asArray(row.field_buff_effect_blocks),
  })),
  bossBindings: bossRows.map((row) => ({
    version: String(row.version ?? ''),
    phase: String(row.phase ?? ''),
    bossName: row.boss_name,
    fieldBuffSetId: row.field_buff_set_id,
  })),
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
console.log(`Wrote ${outPath}`)
console.log(`bossInfo: ${doc.bossInfo.length}, bossBindings: ${doc.bossBindings.length}`)
process.exit(0)
