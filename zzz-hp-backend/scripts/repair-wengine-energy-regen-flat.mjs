/**
 * 修复音擎精炼中被错误写成 dmgBonus 的能量回复效率（数值）。
 * 判定：同一效果位（同 effect.id，或同 block/effect 下标）在其他精炼阶是 energyRegenFlat，
 * 而本阶是 dmgBonus → 改回 energyRegenFlat。
 *
 * 用法：
 *   node scripts/repair-wengine-energy-regen-flat.mjs           # 预演
 *   node scripts/repair-wengine-energy-regen-flat.mjs --apply   # 写库
 */
import mysql from 'mysql2/promise'
import dotenv from 'dotenv'

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

function effectSlotKeys(effect, blockIndex, effectIndex) {
  const keys = [`pos:${blockIndex}:${effectIndex}`]
  if (typeof effect?.id === 'string' && effect.id) keys.push(`id:${effect.id}`)
  return keys
}

function collectFlatSlots(ranks) {
  const slots = new Set()
  for (const pack of ranks) {
    const blocks = Array.isArray(pack?.effectBlocks) ? pack.effectBlocks : []
    if (blocks.length) {
      blocks.forEach((block, bi) => {
        ;(block?.effects ?? []).forEach((effect, ei) => {
          if (effect?.stat === 'energyRegenFlat') {
            for (const key of effectSlotKeys(effect, bi, ei)) slots.add(key)
          }
        })
      })
      continue
    }
    ;(pack?.effects ?? []).forEach((effect, ei) => {
      if (effect?.stat === 'energyRegenFlat') {
        for (const key of effectSlotKeys(effect, 0, ei)) slots.add(key)
      }
    })
  }
  return slots
}

function repairPack(pack, flatSlots) {
  let changed = 0
  const repairEffect = (effect, bi, ei) => {
    if (!effect || typeof effect !== 'object') return effect
    if (effect.stat !== 'dmgBonus') return effect
    const hit = effectSlotKeys(effect, bi, ei).some((key) => flatSlots.has(key))
    if (!hit) return effect
    changed += 1
    return { ...effect, stat: 'energyRegenFlat' }
  }

  const blocks = Array.isArray(pack?.effectBlocks) ? pack.effectBlocks : []
  if (blocks.length) {
    const effectBlocks = blocks.map((block, bi) => ({
      ...block,
      effects: (block?.effects ?? []).map((effect, ei) => repairEffect(effect, bi, ei)),
    }))
    const effects = effectBlocks.flatMap((block) => block.effects ?? [])
    return {
      pack: { ...pack, effectBlocks, effects },
      changed,
    }
  }

  const effects = (pack?.effects ?? []).map((effect, ei) => repairEffect(effect, 0, ei))
  return {
    pack: { ...pack, effects },
    changed,
  }
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'zzz',
})

try {
  if (apply) await conn.beginTransaction()

  const [rows] = await conn.query('SELECT id, name, refinement_buffs, raw_json FROM `W-Engine`')
  let totalEffects = 0
  let totalWengines = 0

  for (const row of rows) {
    const ranks = parseJson(row.refinement_buffs, [])
    if (!Array.isArray(ranks) || !ranks.length) continue
    const flatSlots = collectFlatSlots(ranks)
    if (!flatSlots.size) continue

    let changedHere = 0
    const nextRanks = ranks.map((pack) => {
      const { pack: next, changed } = repairPack(pack, flatSlots)
      changedHere += changed
      return next
    })
    if (!changedHere) continue

    const raw = parseJson(row.raw_json, {})
    await (apply
      ? conn.execute(
          'UPDATE `W-Engine` SET refinement_buffs = CAST(? AS JSON), raw_json = CAST(? AS JSON) WHERE id = ?',
          [asJson(nextRanks), asJson({ ...raw, refinementBuffs: nextRanks }), row.id],
        )
      : Promise.resolve())

    totalEffects += changedHere
    totalWengines += 1
    console.log(`${row.id} (${row.name}): 修复 ${changedHere} 条 dmgBonus → energyRegenFlat`)
  }

  if (apply) await conn.commit()
  console.log(
    apply
      ? `\n已写入：${totalWengines} 个音擎，${totalEffects} 条效果。`
      : `\n预演：${totalWengines} 个音擎，${totalEffects} 条效果；加 --apply 才会写库。`,
  )
} catch (err) {
  if (apply) await conn.rollback()
  throw err
} finally {
  await conn.end()
}
