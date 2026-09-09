/**
 * 最小清理种子 JSON：增益 *MultFactor 的 1 → 0，并删掉增量为 0/1 的倍率修正效果。
 * 不展开空 mods 全键。
 */
import fs from 'fs'
import path from 'path'

const FACTORS = new Set([
  'directDmgMultFactor',
  'anomalyMultFactor',
  'anomalyReleaseMultFactor',
  'disorderBaseMultFactor',
  'turbulenceBaseMultFactor',
  'radianceMultFactor',
  'specialMultFactor',
  'mutationCoeffFactor',
])

const mainFile = path.resolve('scripts/data/zzz-hp-calculator-buffs.json')

function scrubEffect(effect) {
  if (!effect || typeof effect !== 'object') return null
  if (!FACTORS.has(effect.stat)) return effect
  // 转模 value 本就为 0，运行时折算；不能当脏数据丢掉
  if (effect.kind === 'convert') return effect
  const value = Number(effect.value)
  const per = Number(effect.valuePerStack)
  const nextValue = value === 1 ? 0 : value
  const nextPer = per === 1 ? 0 : per
  if (
    (!Number.isFinite(nextValue) || nextValue === 0) &&
    (effect.kind !== 'stacked' || !Number.isFinite(nextPer) || nextPer === 0)
  ) {
    return null
  }
  return { ...effect, value: nextValue, valuePerStack: nextPer }
}

function scrubMods(mods) {
  if (!mods || typeof mods !== 'object') return mods
  const next = { ...mods }
  let changed = false
  for (const key of FACTORS) {
    if (Number(next[key]) === 1) {
      next[key] = 0
      changed = true
    }
  }
  return changed ? next : mods
}

function scrubPack(pack) {
  if (!pack || typeof pack !== 'object') return pack
  const effectBlocks = Array.isArray(pack.effectBlocks)
    ? pack.effectBlocks.map((block) => ({
        ...block,
        effects: (block.effects || []).map(scrubEffect).filter(Boolean),
      }))
    : pack.effectBlocks
  const effects = Array.isArray(pack.effects)
    ? pack.effects.map(scrubEffect).filter(Boolean)
    : pack.effects
  return {
    ...pack,
    effectBlocks,
    effects,
    selfMods: scrubMods(pack.selfMods),
    teamMods: scrubMods(pack.teamMods),
    fixedMods: scrubMods(pack.fixedMods),
  }
}

function walkAgent(agent) {
  return {
    ...agent,
    mindscapeBuffs: Array.isArray(agent.mindscapeBuffs)
      ? agent.mindscapeBuffs.map(scrubPack)
      : agent.mindscapeBuffs,
  }
}

function walkDisc(disc) {
  return {
    ...disc,
    twoPieceMods: scrubMods(disc.twoPieceMods),
    fourPieceBuffs: scrubPack(disc.fourPieceBuffs || {}),
  }
}

function walkWengine(w) {
  return {
    ...w,
    refinementBuffs: Array.isArray(w.refinementBuffs)
      ? w.refinementBuffs.map(scrubPack)
      : w.refinementBuffs,
  }
}

const data = JSON.parse(fs.readFileSync(mainFile, 'utf8'))
if (Array.isArray(data.agents)) data.agents = data.agents.map(walkAgent)
if (Array.isArray(data.driveDiscs)) data.driveDiscs = data.driveDiscs.map(walkDisc)
if (Array.isArray(data.wengines)) data.wengines = data.wengines.map(walkWengine)
if (Array.isArray(data.bangboos)) {
  data.bangboos = data.bangboos.map((b) => ({
    ...b,
    effectBlocks: Array.isArray(b.effectBlocks)
      ? b.effectBlocks.map((block) => ({
          ...block,
          effects: (block.effects || []).map(scrubEffect).filter(Boolean),
        }))
      : b.effectBlocks,
    effects: Array.isArray(b.effects) ? b.effects.map(scrubEffect).filter(Boolean) : b.effects,
    fixedMods: scrubMods(b.fixedMods),
  }))
}
if (Array.isArray(data.skillSubcategories)) {
  const skillFactorKeys = [
    'directDmgMultFactor',
    'anomalyReleaseMultFactor',
    'disorderMultFactor',
  ]
  data.skillSubcategories = data.skillSubcategories.map((s) => {
    const next = { ...s }
    for (const key of skillFactorKeys) {
      if (next[key] == null) continue
      const num = Number(next[key])
      if (!Number.isFinite(num) || num <= 0) next[key] = 100
      else if (num <= 10) next[key] = num * 100
    }
    return next
  })
}

fs.writeFileSync(mainFile, JSON.stringify(data, null, 2) + '\n', 'utf8')
console.log('seed scrubbed (minimal):', mainFile)
