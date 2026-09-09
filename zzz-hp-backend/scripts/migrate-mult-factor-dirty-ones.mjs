/**
 * 清理增益倍率修正脏数据（增量 1 → 0），并把招式小类倍率修正旧乘数 1 写成百分点 100。
 * 只改 *MultFactor 相关字段，不展开空 mods 全键。
 *
 * 用法：
 *   node scripts/migrate-mult-factor-dirty-ones.mjs           # 预演
 *   node scripts/migrate-mult-factor-dirty-ones.mjs --apply   # 写库
 */
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import { BUFF_MULT_FACTOR_KEYS, normalizeBuffMultFactorDelta } from '../src/utils/calculatorBuffFields.js'

dotenv.config()

const apply = process.argv.includes('--apply')
const FACTORS = new Set(BUFF_MULT_FACTOR_KEYS)

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

function scrubEffect(effect) {
  if (!effect || typeof effect !== 'object') return null
  if (!FACTORS.has(effect.stat)) return effect
  const next = {
    ...effect,
    value: normalizeBuffMultFactorDelta(effect.value),
    valuePerStack: normalizeBuffMultFactorDelta(effect.valuePerStack),
  }
  // 转模（convert）的数值在运行时由来源属性折算，value 本就为 0，
  // 不能按脏条目丢弃（否则会删掉蕾米埃尔「精通 → 耀变倍率修正」等核心被动）
  if (
    next.kind !== 'convert' &&
    Math.abs(Number(next.value) || 0) < 1e-12 &&
    (next.kind !== 'stacked' || Math.abs(Number(next.valuePerStack) || 0) < 1e-12)
  ) {
    return null
  }
  return next
}

function scrubEffects(list) {
  if (!Array.isArray(list)) return list
  return list.map(scrubEffect).filter(Boolean)
}

function scrubMods(mods) {
  if (!mods || typeof mods !== 'object' || Array.isArray(mods)) return mods
  const next = { ...mods }
  let changed = false
  for (const key of FACTORS) {
    if (!(key in next)) continue
    const cleaned = normalizeBuffMultFactorDelta(next[key])
    if (cleaned !== Number(next[key])) {
      next[key] = cleaned
      changed = true
    }
  }
  return changed ? next : mods
}

function scrubPack(pack) {
  if (!pack || typeof pack !== 'object') return pack
  const effectBlocks = Array.isArray(pack.effectBlocks)
    ? pack.effectBlocks.map((block) =>
        block && typeof block === 'object'
          ? { ...block, effects: scrubEffects(block.effects) }
          : block,
      )
    : pack.effectBlocks
  return {
    ...pack,
    effectBlocks,
    effects: scrubEffects(pack.effects),
    selfMods: scrubMods(pack.selfMods),
    teamMods: scrubMods(pack.teamMods),
    fixedMods: scrubMods(pack.fixedMods),
  }
}

function scrubMindscape(value) {
  if (!Array.isArray(value)) return value
  return value.map(scrubPack)
}

function skillFactorPercent(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return 100
  if (num <= 10) return num * 100
  return num
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'zzz',
})

let changed = 0

try {
  if (apply) await conn.beginTransaction()

  const [chars] = await conn.query(
    'SELECT id, name, mindscape_buffs, raw_json FROM `character`',
  )
  for (const row of chars) {
    const current = parseJson(row.mindscape_buffs, [])
    const next = scrubMindscape(current)
    const raw = parseJson(row.raw_json, {})
    const nextRaw = { ...raw, mindscapeBuffs: next }
    if (asJson(current) === asJson(next)) continue
    changed += 1
    console.log(`character/${row.id} (${row.name})`)
    if (apply) {
      await conn.execute(
        'UPDATE `character` SET mindscape_buffs = CAST(? AS JSON), raw_json = CAST(? AS JSON) WHERE id = ?',
        [asJson(next), asJson(nextRaw), row.id],
      )
    }
  }

  const [discs] = await conn.query(
    'SELECT id, name, two_piece_mods, four_piece_buffs, raw_json FROM drive_disc',
  )
  for (const row of discs) {
    const two = scrubMods(parseJson(row.two_piece_mods, {}))
    const four = scrubPack(parseJson(row.four_piece_buffs, {}))
    const raw = parseJson(row.raw_json, {})
    const curTwo = parseJson(row.two_piece_mods, {})
    const curFour = parseJson(row.four_piece_buffs, {})
    if (asJson(curTwo) === asJson(two) && asJson(curFour) === asJson(four)) continue
    changed += 1
    console.log(`drive_disc/${row.id} (${row.name})`)
    if (apply) {
      await conn.execute(
        'UPDATE drive_disc SET two_piece_mods = CAST(? AS JSON), four_piece_buffs = CAST(? AS JSON), raw_json = CAST(? AS JSON) WHERE id = ?',
        [
          asJson(two),
          asJson(four),
          asJson({ ...raw, twoPieceMods: two, fourPieceBuffs: four }),
          row.id,
        ],
      )
    }
  }

  try {
    const [wengines] = await conn.query(
      'SELECT id, name, refinement_buffs, raw_json FROM `W-Engine`',
    )
    for (const row of wengines) {
      const current = parseJson(row.refinement_buffs, [])
      const next = Array.isArray(current) ? current.map(scrubPack) : current
      if (asJson(current) === asJson(next)) continue
      changed += 1
      console.log(`W-Engine/${row.id} (${row.name})`)
      if (apply) {
        const raw = parseJson(row.raw_json, {})
        await conn.execute(
          'UPDATE `W-Engine` SET refinement_buffs = CAST(? AS JSON), raw_json = CAST(? AS JSON) WHERE id = ?',
          [asJson(next), asJson({ ...raw, refinementBuffs: next }), row.id],
        )
      }
    }
  } catch (e) {
    console.warn('skip W-Engine', e.message)
  }

  const [skillRows] = await conn.query(
    `SELECT id, name, direct_dmg_mult_factor, anomaly_release_mult_factor, disorder_mult_factor
     FROM calculator_skill_subcategories`,
  )
  for (const row of skillRows) {
    const d = skillFactorPercent(row.direct_dmg_mult_factor)
    const a = skillFactorPercent(row.anomaly_release_mult_factor)
    const o = skillFactorPercent(row.disorder_mult_factor)
    if (
      d === Number(row.direct_dmg_mult_factor) &&
      a === Number(row.anomaly_release_mult_factor) &&
      o === Number(row.disorder_mult_factor)
    ) {
      continue
    }
    changed += 1
    console.log(`skill_sub/${row.id} (${row.name}) → ${d}/${a}/${o}`)
    if (apply) {
      await conn.execute(
        `UPDATE calculator_skill_subcategories
         SET direct_dmg_mult_factor = ?, anomaly_release_mult_factor = ?, disorder_mult_factor = ?
         WHERE id = ?`,
        [d, a, o, row.id],
      )
    }
  }

  if (apply) {
    for (const col of [
      'direct_dmg_mult_factor',
      'anomaly_release_mult_factor',
      'disorder_mult_factor',
    ]) {
      try {
        await conn.query(
          `ALTER TABLE calculator_skill_subcategories MODIFY COLUMN ${col} DOUBLE NOT NULL DEFAULT 100`,
        )
      } catch {
        // ignore
      }
    }
    await conn.commit()
  }

  console.log(apply ? `applied, changed=${changed}` : `dry-run, would change=${changed}`)
} catch (err) {
  if (apply) await conn.rollback()
  throw err
} finally {
  await conn.end()
}
