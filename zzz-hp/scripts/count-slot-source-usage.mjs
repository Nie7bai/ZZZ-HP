/**
 * 统计「按槽位算转模源值」的开销构成：一次求解里
 *   1. 为哪些槽位算过源值（次数）；
 *   2. 这些源值地图实际被哪些槽位读过（次数）。
 * 若某槽位只算不读，就是可跳过的浪费（前提：读取点全都走这个 Map）。
 *
 * 做法：临时给 panelBuffCalc.ts 打桩（跑完自动还原）。
 * 用法：npx vite-node scripts/count-slot-source-usage.mjs
 */
import fs from 'node:fs'
import { schemeActivePanels, schemeAffixInputs } from '../src/utils/agentPanelSources.ts'

const SRC = 'src/utils/panelBuffCalc.ts'
const original = fs.readFileSync(SRC, 'utf8')

function patch() {
  let s = original
  s = s.replace(
    'function buildAllPanelSourceValuesBySlot(',
    `export const __slotUsage = {
  built: new Map(),
  reads: new Map(),
  buildCalls: 0,
}
class __TrackedSourceMap extends Map {
  get(k) {
    __slotUsage.reads.set('get:' + k, (__slotUsage.reads.get('get:' + k) ?? 0) + 1)
    return super.get(k)
  }
  has(k) {
    __slotUsage.reads.set('has:' + k, (__slotUsage.reads.get('has:' + k) ?? 0) + 1)
    return super.has(k)
  }
}
function buildAllPanelSourceValuesBySlot(`,
  )
  s = s.replace(
    `  const map = new Map<number, PanelSourceValues>()
  ctx.teamSlots.forEach((slot, index) => {
    if (!slot.agentId) return
    map.set(index, buildPanelSourceValuesForSlot(index, ctx, currentSlotExternalPanel))
  })
  return map
}`,
    `  const map = new __TrackedSourceMap()
  __slotUsage.buildCalls += 1
  ctx.teamSlots.forEach((slot, index) => {
    if (!slot.agentId) return
    __slotUsage.built.set(index, (__slotUsage.built.get(index) ?? 0) + 1)
    map.set(index, buildPanelSourceValuesForSlot(index, ctx, currentSlotExternalPanel))
  })
  return map
}`,
  )
  if (!s.includes('__slotUsage.buildCalls') || !s.includes('__TrackedSourceMap()')) {
    throw new Error('打桩失败：未匹配到目标代码')
  }
  fs.writeFileSync(SRC, s)
}

async function main() {
  patch()

  const { resolveFlow } = await import('../src/utils/resolvedHit.ts')
  const { buildOptimalEvalContext, clearAffixEvalCache } = await import('../src/utils/optimalAffixAlloc.ts')
  const { solveOptimalAffixAllocationAsync } = await import('../src/utils/affixOptimizer.ts')
  const { createDefaultAffixLibrary } = await import('../src/utils/affixLibrary.ts')
  const mod = await import('../src/utils/panelBuffCalc.ts')

  const BUFFS = 'D:/WB_agent_out/applications/ZZZ-HP/zzz-hp-backend/scripts/data/zzz-hp-calculator-buffs.json'
  const SCHEME = process.argv[2] ?? 'D:/WB_agent_out/ZZZ-HP/artifacts/profiles/scheme-dan.json'

  const buffs = JSON.parse(fs.readFileSync(BUFFS, 'utf8'))
  const schemePack = JSON.parse(fs.readFileSync(SCHEME, 'utf8'))
  const scheme = Object.values(schemePack.schemes)[0]
  const skillById = new Map(
    [...(buffs.skills ?? []), ...(schemePack.customSkills ?? [])].map((s) => [s.id, s]),
  )
  const flowResult = resolveFlow({
    slots: scheme.slots,
    teamSlots: scheme.teamSlots.map((s) => ({ agentId: s.agentId })),
    findSkill: (id) => skillById.get(id) ?? null,
    skillSubcategories: buffs.skillSubcategories,
  })
  const mainSlotIndex = Number(scheme.activeSlot ?? 0)
  const mainSlot = scheme.teamSlots[mainSlotIndex]
  const mainAgent = buffs.agents.find((a) => a.id === mainSlot.agentId)

  const ctx = buildOptimalEvalContext({
    isMb: mainAgent?.profession === '命破',
    isFengYu: mainAgent?.profession === '锋御',
    teamSlots: scheme.teamSlots,
    agents: buffs.agents,
    wengines: buffs.wengines,
    bangboo: {
      id: 'none', name: 'none', avatar_image: null, effects: [],
      refinementEffects: [], fixedMods: {}, refinementMods: {},
    },
    bangbooRefine: 1,
    driveDiscs: buffs.driveDiscs,
    mainSlotIndex,
    driveDiscMainStats: schemeAffixInputs(scheme, mainSlot.agentId).affixDriveDiscMainStats ?? {
      slot4MainStat: 'mastery', slot5MainStat: 'dmgBonus', slot6MainStat: 'energyRegen',
    },
    enemyInput: {
      level: 60, defense: 953, resistanceType: 'normal',
      vulnerableMultiplier: 1, staggerMultiplier: 1.5, specialMultiplier: 1,
    },
    baseDamageSource:
      mainAgent?.profession === '命破' ? 'pierce' : mainAgent?.profession === '锋御' ? 'def' : 'atk',
    buffSelection: null,
    slotBuffSelections: scheme.multiSlotBuffSelection ?? null,
    activeSlotPanels: schemeActivePanels(scheme),
    convertSlotPanels: scheme.convertSlotPanels ?? undefined,
    hits: flowResult.hits,
    resolveSubcategory: (id) => buffs.skillSubcategories.find((x) => x.id === id) ?? null,
    skillSubcategories: buffs.skillSubcategories,
    followUpSkillRules: buffs.followUpSkillRules,
  })

  const entries = createDefaultAffixLibrary()
  clearAffixEvalCache()

  const p = mod.__slotUsage
  p.built.clear()
  p.reads.clear()
  p.buildCalls = 0

  const t0 = performance.now()
  const result = await solveOptimalAffixAllocationAsync({
    ctx, entries, maxTotalRolls: 30, candidateWidthMode: 'auto', manualCandidateWidth: 8,
  })
  const ms = performance.now() - t0

  console.log(JSON.stringify({
    求解ms: +ms.toFixed(0),
    源值地图构建次数: p.buildCalls,
    '各槽位【构建】次数': Object.fromEntries([...p.built.entries()].sort()),
    '各槽位【读取】次数（get/has）': Object.fromEntries([...p.reads.entries()].sort()),
    总伤害: Math.round(result.totalDamage),
  }, null, 1))
}

try {
  await main()
} finally {
  fs.writeFileSync(SRC, original)
  console.log('已还原 panelBuffCalc.ts')
}
