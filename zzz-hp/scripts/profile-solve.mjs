/**
 * 完整求解（30 词条）的 CPU 剖析基线。
 *
 * 与 probe-affix-perf.mjs 用同一套场景数据（真实方案 scheme-dan.json + 后台 buffs 库），
 * 但剖析窗口覆盖**一次真实求解 + 一次热求解**，而不是 25 次零散评估 —— 采样量足够时
 * 才能区分「单次调用贵」与「调用次数多」。
 *
 * 用法：npx vite-node scripts/profile-solve.mjs [方案JSON] [词条数]
 * 产出：artifacts/profile-solve-<时间>.cpuprofile（用 artifacts/analyze-cpuprofile.mjs 查看）
 */
import fs from 'node:fs'
import inspector from 'node:inspector'

import { resolveFlow } from '../src/utils/resolvedHit.ts'
import { buildOptimalEvalContext, clearAffixEvalCache } from '../src/utils/optimalAffixAlloc.ts'
import { solveOptimalAffixAllocationAsync } from '../src/utils/affixOptimizer.ts'
import { createDefaultAffixLibrary } from '../src/utils/affixLibrary.ts'
import { schemeActivePanels, schemeAffixInputs } from '../src/utils/agentPanelSources.ts'

const BUFFS = 'D:/WB_agent_out/applications/ZZZ-HP/zzz-hp-backend/scripts/data/zzz-hp-calculator-buffs.json'
const ARTIFACTS = 'D:/WB_agent_out/ZZZ-HP/artifacts'
const SCHEME = process.argv[2] ?? `${ARTIFACTS}/profiles/scheme-dan.json`
const ROLLS = Number(process.argv[3] ?? 30)

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
const agents = buffs.agents
const mainAgent = agents.find((a) => a.id === mainSlot.agentId)

const ctx = buildOptimalEvalContext({
  isMb: mainAgent?.profession === '命破',
  isFengYu: mainAgent?.profession === '锋御',
  teamSlots: scheme.teamSlots,
  agents,
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

// ---------- 计时（先做，保证剖析窗口只覆盖求解）----------
clearAffixEvalCache()
const t0 = performance.now()
const result = await solveOptimalAffixAllocationAsync({
  ctx, entries, maxTotalRolls: ROLLS, candidateWidthMode: 'auto', manualCandidateWidth: 8,
})
const coldMs = performance.now() - t0

const t1 = performance.now()
const warm = await solveOptimalAffixAllocationAsync({
  ctx, entries, maxTotalRolls: ROLLS, candidateWidthMode: 'auto', manualCandidateWidth: 8,
})
const warmMs = performance.now() - t1

// ---------- 剖析：求解 3 次（第 1 次冷、后 2 次热）----------
const session = new inspector.Session()
session.connect()
const post = (m, p) => new Promise((res, rej) => session.post(m, p, (e, x) => (e ? rej(e) : res(x))))

const ROUNDS = 3
await post('Profiler.enable')
await post('Profiler.setSamplingInterval', { interval: 150 })
await post('Profiler.start')
for (let i = 0; i < ROUNDS; i += 1) {
  clearAffixEvalCache()
  await solveOptimalAffixAllocationAsync({
    ctx, entries, maxTotalRolls: ROLLS, candidateWidthMode: 'auto', manualCandidateWidth: 8,
  })
}
const { profile } = await post('Profiler.stop')
session.disconnect()

const profPath = `${ARTIFACTS}/profile-solve-${Date.now()}.cpuprofile`
fs.writeFileSync(profPath, JSON.stringify(profile))

console.log(JSON.stringify({
  招式数: flowResult.hits.length,
  库条目数: entries.length,
  冷求解ms: +coldMs.toFixed(0),
  热求解ms: +warmMs.toFixed(0),
  已用词条: result.usedRolls,
  总伤害: Math.round(result.totalDamage),
  提升: +result.improvementPercent.toFixed(2),
  二次结果一致: Math.abs(warm.totalDamage - result.totalDamage) < 1e-6,
  剖析轮数: ROUNDS,
  剖析文件: profPath,
}, null, 1))
