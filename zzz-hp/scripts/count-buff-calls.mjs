/**
 * 统计一次完整求解里 collectPanelBuffMods / 缓存键构建的调用次数。
 * 做法：临时在 panelBuffCalc.ts 插入计数器（跑完自动还原原文件）。
 * 注意：必须先 patch 再动态导入，且所有模块用普通说明符导入，才能共用同一实例。
 *
 * 用法：npx vite-node scripts/count-buff-calls.mjs
 */
import fs from 'node:fs'
import { schemeActivePanels, schemeAffixInputs } from '../src/utils/agentPanelSources.ts'

const SRC = 'src/utils/panelBuffCalc.ts'
const original = fs.readFileSync(SRC, 'utf8')

function patch() {
  let s = original
  s = s.replace(
    'export function collectPanelBuffMods(ctx: PanelCalcContext): BuffStatModifiers {',
    `export const __counts = { collect: 0, key: 0 }
export function collectPanelBuffMods(ctx: PanelCalcContext): BuffStatModifiers {
  __counts.collect += 1`,
  )
  s = s.replace(
    'function buildBuffCatalogKey(ctx: PanelCalcContext): string {',
    `function buildBuffCatalogKey(ctx: PanelCalcContext): string {
  __counts.key += 1`,
  )
  if (!s.includes('__counts.collect') || !s.includes('__counts.key')) {
    throw new Error('插入计数器失败：未匹配到目标函数')
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

  const DIRECT_EVALS = 200 // 求解大致的评估次数，仅用于换算每次评估的平均调用数

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

  const counts = mod.__counts
  counts.collect = 0
  counts.key = 0
  const t0 = performance.now()
  const result = await solveOptimalAffixAllocationAsync({
    ctx, entries, maxTotalRolls: 30, candidateWidthMode: 'auto', manualCandidateWidth: 8,
  })
  const ms = performance.now() - t0

  console.log(JSON.stringify({
    求解ms: +ms.toFixed(0),
    招式数: flowResult.hits.length,
    'collectPanelBuffMods 调用次数': counts.collect,
    'buildBuffCatalogKey 调用次数': counts.key,
    '按 200 次评估换算的每次调用数': {
      collect: +(counts.collect / DIRECT_EVALS).toFixed(1),
      key: +(counts.key / DIRECT_EVALS).toFixed(1),
    },
    总伤害: Math.round(result.totalDamage),
  }, null, 1))
}

try {
  await main()
} finally {
  fs.writeFileSync(SRC, original)
  console.log('已还原 panelBuffCalc.ts')
}
