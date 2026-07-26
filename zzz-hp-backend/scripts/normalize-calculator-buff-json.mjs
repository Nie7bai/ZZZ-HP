/**
 * 把计算器四张表的 JSON 列按当前字段清单重新归一化，补齐历史行缺失的键。
 * 只补键、不改已有数值，可重复执行。
 *
 * 用法：
 *   node scripts/normalize-calculator-buff-json.mjs           # 预演，只打印将要变更的行
 *   node scripts/normalize-calculator-buff-json.mjs --apply   # 实际写库
 */
import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import {
  normalizeAgentBasePanel,
  normalizeBuffStatModifiers,
  normalizeTwoPieceMods,
  normalizeWengineAdvancedStats,
} from '../src/utils/calculatorBuffFields.js'

dotenv.config()

const apply = process.argv.includes('--apply')

function parseJson(value, fallback) {
  if (value == null) return fallback
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return fallback
    }
  }
  return fallback
}

function asJson(value) {
  return JSON.stringify(value ?? null)
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'zzz',
})

let changed = 0

async function run(sql, params) {
  if (apply) await conn.execute(sql, params)
}

try {
  if (apply) await conn.beginTransaction()

  const [agents] = await conn.query('SELECT id, name, base_panel, raw_json FROM `character`')
  for (const row of agents) {
    const current = parseJson(row.base_panel, {})
    const next = normalizeAgentBasePanel(current)
    const raw = parseJson(row.raw_json, {})
    if (asJson(current) === asJson(next) && asJson(raw.basePanel ?? null) === asJson(next)) continue
    await run(
      'UPDATE `character` SET base_panel = CAST(? AS JSON), raw_json = CAST(? AS JSON) WHERE id = ?',
      [asJson(next), asJson({ ...raw, basePanel: next }), row.id],
    )
    changed += 1
    console.log(`character/${row.id} (${row.name}) base_panel`)
  }

  const [wengines] = await conn.query('SELECT id, name, advanced_stats, raw_json FROM `W-Engine`')
  for (const row of wengines) {
    const current = parseJson(row.advanced_stats, {})
    const next = normalizeWengineAdvancedStats(current)
    const raw = parseJson(row.raw_json, {})
    if (asJson(current) === asJson(next) && asJson(raw.advancedStats ?? null) === asJson(next)) {
      continue
    }
    await run(
      'UPDATE `W-Engine` SET advanced_stats = CAST(? AS JSON), raw_json = CAST(? AS JSON) WHERE id = ?',
      [asJson(next), asJson({ ...raw, advancedStats: next }), row.id],
    )
    changed += 1
    console.log(`W-Engine/${row.id} (${row.name}) advanced_stats`)
  }

  const [discs] = await conn.query('SELECT id, name, two_piece_mods, raw_json FROM `drive_disc`')
  for (const row of discs) {
    const current = parseJson(row.two_piece_mods, {})
    const next = normalizeTwoPieceMods(current)
    const raw = parseJson(row.raw_json, {})
    if (asJson(current) === asJson(next) && asJson(raw.twoPieceMods ?? null) === asJson(next)) {
      continue
    }
    await run(
      'UPDATE `drive_disc` SET two_piece_mods = CAST(? AS JSON), raw_json = CAST(? AS JSON) WHERE id = ?',
      [asJson(next), asJson({ ...raw, twoPieceMods: next }), row.id],
    )
    changed += 1
    console.log(`drive_disc/${row.id} (${row.name}) two_piece_mods`)
  }

  const [bangboos] = await conn.query(
    'SELECT id, name, fixed_mods, refinement_mods, raw_json FROM `bangboo`',
  )
  for (const row of bangboos) {
    const currentFixed = parseJson(row.fixed_mods, {})
    const nextFixed = normalizeBuffStatModifiers(currentFixed)
    const currentRefs = parseJson(row.refinement_mods, [])
    const nextRefs = (Array.isArray(currentRefs) ? currentRefs : []).map((item) =>
      normalizeBuffStatModifiers(item),
    )
    const raw = parseJson(row.raw_json, {})
    const same =
      asJson(currentFixed) === asJson(nextFixed) &&
      asJson(currentRefs) === asJson(nextRefs) &&
      asJson(raw.fixedMods ?? null) === asJson(nextFixed)
    if (same) continue
    await run(
      `UPDATE \`bangboo\`
       SET fixed_mods = CAST(? AS JSON), refinement_mods = CAST(? AS JSON), raw_json = CAST(? AS JSON)
       WHERE id = ?`,
      [
        asJson(nextFixed),
        asJson(nextRefs),
        asJson({ ...raw, fixedMods: nextFixed, refinementMods: nextRefs }),
        row.id,
      ],
    )
    changed += 1
    console.log(`bangboo/${row.id} (${row.name}) fixed_mods/refinement_mods`)
  }

  if (apply) await conn.commit()
  console.log(
    apply ? `\n已写入 ${changed} 行。` : `\n预演：共 ${changed} 行需要补键，加 --apply 才会写库。`,
  )
} catch (err) {
  if (apply) await conn.rollback()
  throw err
} finally {
  await conn.end()
}
