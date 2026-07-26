/**
 * 只读审计：检查数据库中计算器增益相关 JSON 是否缺少当前代码支持的字段，
 * 以及是否存在无法识别的 stat（会被后端回落成 dmgBonus）。
 * 用法：node scripts/audit-calculator-buff-fields.mjs
 */
import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import {
  AGENT_BASE_PANEL_KEYS,
  BUFF_STAT_KEYS,
  WENGINE_ADVANCED_STAT_KEYS,
} from '../src/utils/calculatorBuffFields.js'

dotenv.config()

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

function missingKeys(obj, keys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return keys.slice()
  return keys.filter((key) => !(key in obj))
}

function collectEffects(pack) {
  if (!pack || typeof pack !== 'object') return []
  const blocks = Array.isArray(pack.effectBlocks) ? pack.effectBlocks : []
  if (blocks.length) return blocks.flatMap((block) => (Array.isArray(block?.effects) ? block.effects : []))
  return Array.isArray(pack.effects) ? pack.effects : []
}

const unknownStats = new Map()
const usedStats = new Set()
const missingReport = []

function trackEffects(label, effects) {
  for (const effect of effects) {
    const stat = effect?.stat
    if (typeof stat !== 'string') continue
    if (BUFF_STAT_KEYS.includes(stat)) {
      usedStats.add(stat)
      continue
    }
    if (!unknownStats.has(stat)) unknownStats.set(stat, [])
    unknownStats.get(stat).push(label)
  }
}

function trackMods(label, mods, keys = BUFF_STAT_KEYS) {
  const missing = missingKeys(mods, keys)
  if (missing.length) missingReport.push({ label, missing })
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'zzz',
})

try {
  const [agents] = await conn.query('SELECT * FROM `character`')
  for (const row of agents) {
    const raw = parseJson(row.raw_json, {})
    const label = `character/${row.id}(${row.name})`
    trackMods(`${label}.basePanel`, parseJson(row.base_panel, raw.basePanel), AGENT_BASE_PANEL_KEYS)
    const packs = parseJson(row.mindscape_buffs, raw.mindscapeBuffs) ?? []
    ;(Array.isArray(packs) ? packs : []).forEach((pack, idx) => {
      trackEffects(`${label}.mindscape[${idx}]`, collectEffects(pack))
    })
  }

  const [wengines] = await conn.query('SELECT * FROM `W-Engine`')
  for (const row of wengines) {
    const raw = parseJson(row.raw_json, {})
    const label = `W-Engine/${row.id}(${row.name})`
    trackMods(
      `${label}.advancedStats`,
      parseJson(row.advanced_stats, raw.advancedStats),
      WENGINE_ADVANCED_STAT_KEYS,
    )
    trackEffects(`${label}.fixed`, collectEffects(parseJson(row.fixed_buffs, raw.fixedBuffs)))
    const refs = parseJson(row.refinement_buffs, raw.refinementBuffs) ?? []
    ;(Array.isArray(refs) ? refs : []).forEach((pack, idx) => {
      trackEffects(`${label}.refinement[${idx}]`, collectEffects(pack))
    })
  }

  const [bangboos] = await conn.query('SELECT * FROM `bangboo`')
  for (const row of bangboos) {
    const raw = parseJson(row.raw_json, {})
    const label = `bangboo/${row.id}(${row.name})`
    trackMods(`${label}.fixedMods`, parseJson(row.fixed_mods, raw.fixedMods))
    trackEffects(
      `${label}.effects`,
      collectEffects({
        effectBlocks: parseJson(row.effect_blocks, raw.effectBlocks),
        effects: parseJson(row.effects, raw.effects),
      }),
    )
    const refBlocks = parseJson(row.refinement_effect_blocks, raw.refinementEffectBlocks) ?? []
    const refEffects = parseJson(row.refinement_effects, raw.refinementEffects) ?? []
    for (let idx = 0; idx < 5; idx += 1) {
      trackEffects(
        `${label}.refinement[${idx}]`,
        collectEffects({
          effectBlocks: Array.isArray(refBlocks) ? refBlocks[idx] : undefined,
          effects: Array.isArray(refEffects) ? refEffects[idx] : undefined,
        }),
      )
    }
  }

  const [discs] = await conn.query('SELECT * FROM `drive_disc`')
  for (const row of discs) {
    const raw = parseJson(row.raw_json, {})
    const label = `drive_disc/${row.id}(${row.name})`
    trackMods(`${label}.twoPieceMods`, parseJson(row.two_piece_mods, raw.twoPieceMods))
    trackEffects(
      `${label}.fourPiece`,
      collectEffects(parseJson(row.four_piece_buffs, raw.fourPieceBuffs)),
    )
    trackEffects(`${label}.twoPiece`, collectEffects(raw.twoPieceBuffs))
  }

  console.log('=== 缺失字段的 JSON（读取时会补 0，保存后即修复） ===')
  if (!missingReport.length) {
    console.log('（无）')
  } else {
    for (const item of missingReport) {
      console.log(`${item.label}: 缺 ${item.missing.join(', ')}`)
    }
  }

  console.log('\n=== 无法识别的 stat（后端会回落成 dmgBonus，数据会被改写） ===')
  if (!unknownStats.size) {
    console.log('（无）')
  } else {
    for (const [stat, labels] of unknownStats) {
      console.log(`${stat}: ${labels.length} 处，例如 ${labels.slice(0, 3).join(' / ')}`)
    }
  }

  const unused = BUFF_STAT_KEYS.filter((key) => !usedStats.has(key))
  console.log('\n=== 已支持但库中暂无任何效果使用的 stat ===')
  console.log(unused.length ? unused.join(', ') : '（无）')
} finally {
  await conn.end()
}
