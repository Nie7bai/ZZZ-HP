/**
 * 多次冷启动求解的耗时基线（每次先清空词条评估缓存），取中位数，避免单次抖动。
 * 同时校验每次结果一致（数值回归检查）。
 *
 * 用法：npx vite-node scripts/bench-solve.mjs [方案JSON] [词条数] [轮数]
 */
import fs from 'node:fs'

import { resolveFlow } from '../src/utils/resolvedHit.ts'
import { buildOptimalEvalContext, clearAffixEvalCache } from '../src/utils/optimalAffixAlloc.ts'
import { solveOptimalAffixAllocationAsync } from '../src/utils/affixOptimizer.ts'
import { createDefaultAffixLibrary } from '../src/utils/affixLibrary.ts'
import { schemeActivePanels, schemeAffixInputs } from '../src/utils/agentPanelSources.ts'

const BUFFS = 'D:/WB_agent_out/applications/ZZZ-HP/zzz-hp-backend/scripts/data/zzz-hp-calculator-buffs.json'
const SCHEME = process.argv[2] ?? 'D:/WB_agent_out/ZZZ-HP/artifacts/profiles/scheme-dan.json'
const ROLLS = Number(process.argv[3] ?? 30)
const ROUNDS = Number(process.argv[4] ?? 5)

const buffs = JSON.parse(fs.readFileSync(BUFFS, 'utf8'))
const schemePack = JSON.parse(fs.readFileSync(SCHEME, 'utf8'))
const scheme = Object.values(schemePack.schemes)[0]
const skillById = new Map(
  [...(buffs.skills ?? []), ...(schemePack.customSkills ?? [])].map((s) => [s.id, s]),
)
const flowResult = resolveFlow({
  slots: scheme.slots,
  teamSlots: scheme.teamSlots.map((s) => ({ agentId: s.agentId, rank: s.rank })),
  findSkill: (id) => skillById.get(id) ?? null,
  skillSubcategories: buffs.skillSubcategories,
})
const mainSlotIndex = Number(scheme.activeSlot ?? 0)
const mainSlot = scheme.teamSlots[mainSlotIndex]
const mainAgent = buffs.agents.find((a) => a.id === mainSlot.agentId)

function makeCtx() {
  return buildOptimalEvalContext({
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
}

const entries = createDefaultAffixLibrary()
const times = []
const damages = []
const rollSets = []

for (let i = 0; i < ROUNDS; i += 1) {
  const ctx = makeCtx()
  clearAffixEvalCache()
  const t0 = performance.now()
  const result = await solveOptimalAffixAllocationAsync({
    ctx, entries, maxTotalRolls: ROLLS, candidateWidthMode: 'auto', manualCandidateWidth: 8,
  })
  times.push(+(performance.now() - t0).toFixed(0))
  damages.push(Math.round(result.totalDamage))
  rollSets.push(JSON.stringify(result.rollsByEntryId) + '|deltas:' + JSON.stringify(result.panelDeltas))
}

const sorted = [...times].sort((a, b) => a - b)
const median = sorted[Math.floor(sorted.length / 2)]
const allSame = new Set(damages).size === 1 && new Set(rollSets).size === 1

console.log(JSON.stringify({
  轮数: ROUNDS,
  词条数: ROLLS,
  各轮ms: times,
  中位数ms: median,
  最小ms: sorted[0],
  最大ms: sorted[sorted.length - 1],
  总伤害: damages[0],
  每轮结果一致: allSame,
  结果: allSame ? 'OK：耗时已记录，结果稳定' : '★ 警告：各轮结果不一致',
}, null, 1))
if (!allSame) process.exit(1)
