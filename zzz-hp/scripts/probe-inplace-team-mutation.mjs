/**
 * 严格判定：真实 UI 形态（同一个 teamSlots 数组就地修改）下，
 * 「按数组身份记忆化的槽位键」是否会让结果读到旧值。
 *
 * 关键：`clearAffixEvalCache()` **不清理** buff 目录缓存（见其实现），
 * 因此原来的「清 affix 缓存」不能作为真值基准。这里的真值一律用
 * `invalidateBuffCatalogCache()` —— 它会清 buffCatalogCache 并重置按键身份记忆化的部件。
 *
 * 对每个候选改动：
 *   1. 用真值路径确认该改动**确实会改变结果**（否则用例无效，跳过）；
 *   2. 再测就地修改路径是否与真值一致。
 *
 * 用法：npx vite-node scripts/probe-inplace-team-mutation.mjs
 */
import fs from 'node:fs'

import { resolveFlow } from '../src/utils/resolvedHit.ts'
import { buildOptimalEvalContext, evaluateAffixCounts, clearAffixEvalCache } from '../src/utils/optimalAffixAlloc.ts'
import { invalidateBuffCatalogCache } from '../src/utils/panelBuffCalc.ts'
import { createEmptyAffixCounts } from '../src/types/calculatorPanel.ts'

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

const teamSlots = scheme.teamSlots.map((s) => ({ ...s }))

function makeCtx() {
  return buildOptimalEvalContext({
    isMb: mainAgent?.profession === '命破',
    isFengYu: mainAgent?.profession === '锋御',
    teamSlots,
    agents: buffs.agents,
    wengines: buffs.wengines,
    bangboo: {
      id: 'none', name: 'none', avatar_image: null, effects: [],
      refinementEffects: [], fixedMods: {}, refinementMods: {},
    },
    bangbooRefine: 1,
    driveDiscs: buffs.driveDiscs,
    mainSlotIndex,
    driveDiscMainStats: mainSlot.affixDriveDiscMainStats ?? {
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
    anomalySlotPanels: scheme.anomalySlotPanels ?? undefined,
    convertSlotPanels: scheme.convertSlotPanels ?? undefined,
    hits: flowResult.hits,
    resolveSubcategory: (id) => buffs.skillSubcategories.find((x) => x.id === id) ?? null,
    skillSubcategories: buffs.skillSubcategories,
    followUpSkillRules: buffs.followUpSkillRules,
  })
}

const counts = { ...createEmptyAffixCounts(), atkPercent: 30 }
const allyIndex = mainSlotIndex === 0 ? 1 : 0

/** 真值：清空全部缓存后重新评估 */
function evaluateTruth() {
  invalidateBuffCatalogCache()
  clearAffixEvalCache()
  return evaluateAffixCounts(makeCtx(), counts).grandTotal
}

/** 就地路径：完全不清缓存，模拟「用户改完直接看结果」 */
function evaluateInPlace() {
  return evaluateAffixCounts(makeCtx(), counts).grandTotal
}

const allyAgent = buffs.agents.find((a) => a.id === teamSlots[allyIndex]?.agentId)
const someDisc = buffs.driveDiscs.find((d) => d.id && d.id !== 'none')?.id
const wengineIds = buffs.wengines.filter((w) => w.id && w.id !== 'none').map((w) => w.id)
const otherWengine = wengineIds.find((id) => id !== teamSlots[allyIndex]?.wengineId)

const candidates = [
  { label: '队友影画 0→6', apply: () => { teamSlots[allyIndex].rank = 6 }, revert: () => { teamSlots[allyIndex].rank = 0 } },
  { label: '队友影画 6→0', apply: () => { teamSlots[allyIndex].rank = 0 }, revert: () => { teamSlots[allyIndex].rank = 6 } },
  { label: '队友 2 件套设为第一套驱动盘', apply: () => { teamSlots[allyIndex].twoPieceDriveDiscId = someDisc }, revert: () => { teamSlots[allyIndex].twoPieceDriveDiscId = 'none' } },
  { label: '队友 4 件套设为第一套驱动盘', apply: () => { teamSlots[allyIndex].fourPieceDriveDiscId = someDisc }, revert: () => { teamSlots[allyIndex].fourPieceDriveDiscId = 'none' } },
  { label: '队友换音擎', apply: () => { teamSlots[allyIndex].wengineId = otherWengine }, revert: () => { teamSlots[allyIndex].wengineId = wengineIds[0] } },
]

const rows = []
for (const candidate of candidates) {
  // 先归零到一个已知状态
  candidate.revert()
  const base = evaluateTruth()

  candidate.apply()
  const truth = evaluateTruth()
  if (Math.abs(truth - base) < 1e-6) {
    rows.push({ 改动: candidate.label, 结论: '用例无效（该改动不影响结果，跳过）' })
    continue
  }

  // 重新回到改前状态，然后用「就地路径」再走一遍
  candidate.revert()
  evaluateTruth()          // 预热缓存（此时键已按数组身份写死）
  const inPlaceBefore = evaluateInPlace()
  candidate.apply()
  const inPlaceAfter = evaluateInPlace()

  rows.push({
    改动: candidate.label,
    真值_改前: Math.round(base),
    真值_改后: Math.round(truth),
    就地_改前: Math.round(inPlaceBefore),
    就地_改后: Math.round(inPlaceAfter),
    就地路径跟随变化: Math.abs(inPlaceAfter - inPlaceBefore) > 1e-6,
    就地路径与真值一致: Math.abs(inPlaceAfter - truth) < 1e-6,
  })
}

const broken = rows.filter((r) => r.就地路径与真值一致 === false)

console.log(JSON.stringify({
  队友槽位: allyIndex,
  队友角色: allyAgent?.id ?? '(空)',
  步骤: rows,
  结论: broken.length
    ? `★ 确认缺陷：${broken.length} 项改动的「就地路径」没跟上真值（${broken.map((b) => b.改动).join('、')}）`
    : '未能复现（所有有效用例的就地路径都与真值一致）',
}, null, 1))
