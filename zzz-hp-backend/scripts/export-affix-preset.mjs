/**
 * 把「官方预设词条库」导出成 JSON（多方案：每套方案含条目 + 分组）。
 *
 * 用法：
 *   node scripts/export-affix-preset.mjs                  # 全方案 → scripts/data/affix-preset.export.json
 *   node scripts/export-affix-preset.mjs --file out.json   # 指定输出
 *   node scripts/export-affix-preset.mjs --scheme 默认      # 只导一套
 *
 * 为什么直接读表、不走 `services/affixPresetService.js`：
 * 这是个**数据**导出工具，要能在任意分支上跑 —— 方案维度（步骤 44）是后加的，
 * 老分支的服务只有单方案版本，import 上就报错。SQL 读表与分支无关。
 *
 * 与 `import-affix-preset.mjs` 的关系：那个脚本吃**单方案**旧格式（`{entries, groups}`，
 * 灌进默认方案）。要把本文件灌回去，目前得 `--scheme` 逐套导、或给 import 侧补多方案支持。
 *
 * 口径：只读；`raw` 带上 raw_json 的内容（入库时的原样副本，保真）。
 */
import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pool from '../src/config/db.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

function parseRaw(raw) {
  if (raw == null) return null
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return null
  }
}

const onlyScheme = readArg('--scheme')
const outPath =
  readArg('--file') || path.resolve(__dirname, 'data', 'affix-preset.export.json')

try {
  const [schemeRows] = await pool.query(
    'SELECT name, is_default, sort_order FROM affix_preset_scheme ORDER BY is_default DESC, sort_order ASC, name ASC',
  )
  const schemes = onlyScheme
    ? schemeRows.filter((row) => String(row.name) === onlyScheme)
    : schemeRows
  if (onlyScheme && !schemes.length) {
    console.error(`没有这套方案：${onlyScheme}`)
    process.exit(1)
  }

  const [entryRows] = await pool.query(
    'SELECT * FROM affix_preset_entry ORDER BY scheme, sort_order, id',
  )
  const [groupRows] = await pool.query(
    'SELECT * FROM affix_preset_group ORDER BY scheme, sort_order, name',
  )

  const toEntry = (row) => ({
    id: String(row.id),
    label: String(row.label ?? ''),
    target: String(row.target ?? ''),
    perRoll: Number(row.per_roll) || 0,
    cap: Number(row.cap) || 0,
    group: String(row.group_name ?? ''),
    rollCost: Number(row.roll_cost ?? 1),
    enabledByDefault: Boolean(Number(row.enabled_by_default)),
    sortOrder: Number(row.sort_order) || 0,
    effectJson: parseRaw(row.effect_json),
    raw: parseRaw(row.raw_json),
  })
  const toGroup = (row) => ({
    name: String(row.name ?? ''),
    cap: Number(row.cap) || 0,
    sortOrder: Number(row.sort_order) || 0,
    raw: parseRaw(row.raw_json),
  })

  const out = {
    kind: 'zzz-hp-affix-preset',
    exportedAt: new Date().toISOString(),
    defaultScheme: String(schemeRows.find((row) => Number(row.is_default))?.name ?? ''),
    schemes: schemes.map((row) => {
      const name = String(row.name)
      const entries = entryRows.filter((entry) => String(entry.scheme) === name).map(toEntry)
      const groups = groupRows.filter((group) => String(group.scheme) === name).map(toGroup)
      console.log(
        `  ${Number(row.is_default) ? '[默认] ' : '       '}${name} — 条目 ${entries.length} / 分组 ${groups.length}`,
      )
      return {
        name,
        isDefault: Boolean(Number(row.is_default)),
        sortOrder: Number(row.sort_order) || 0,
        entries,
        groups,
      }
    }),
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
  console.log(`\n已导出 ${out.schemes.length} 套方案 → ${outPath}`)
} finally {
  await pool.end()
}
