/**
 * 复现「主属性组合试算污染词条评估缓存」：
 *
 * 组合试算故意用 mainBaseExternalPanel=null 评估（换主属性必须重新推导面板），
 * 但 affixEvalCache 的键只有词条数，而上下文签名不含 mainBaseExternalPanel。
 * 于是同一套词条在「有基准」「无基准」两种 ctx 下共用一条缓存：
 * 谁先算谁写进去，后算的拿到别人的结果。
 *
 * 预期（修复后）：B 应等于 A，C 应等于 A。
 * 复现（修复前）：B 有值后，C == B ≠ A。
 *
 * 用法：npx vite-node scripts/probe-cache-poison.mjs [方案JSON] [方案名] [总词条数] [outPercent]
 */
import fs from 'node:fs'

import { resolveFlow } from '../src/utils/resolvedHit.ts'
import {
  buildOptimalEvalContext,
  evaluateAffixCounts,
  evaluateAffixCountsForSweep,
  clearAffixEvalCache,
} from '../src/utils/optimalAffixAlloc.ts'
import { createDefaultAffixDriveDiscMainStats } from '../src/utils/affixDriveDiscConfig.ts'

const BUFFS = 'D:/WB_agent_out/applications/ZZZ-HP/zzz-hp-backend/scripts/data/zzz-hp-calculator-buffs.json'
const DEFAULT_SCHEME = 'D:/WB_agent_out/applications/ZZZ-HP/artifacts/profiles/zzz-hp-schemes-2026-09-10.json'

const schemeFile = process.argv[2] ?? DEFAULT_SCHEME
const nameFilter = process.argv[3] ?? ''
const totalRolls = Number(process.argv[4] ?? 30)
const pickOutPercent = Number(process.argv[5] ?? 9)

const out = []
const log = (...a) => {
  const line = a.join(' ')
  out.push(line)
  console.log(line)
}
const n = (v) => (Number.isFinite(v) ? v.toFixed(0) : String(v))

const buffs = JSON.parse(fs.readFileSync(BUFFS, 'utf8'))
const pack = JSON.parse(fs.readFileSync(schemeFile, 'utf8'))
const skillById = new Map(
  [...(buffs.skills ?? []), ...(pack.customSkills ?? [])].map((s) => [s.id, s]),
)

let failures = 0
const check = (name, actual, expected) => {
  const ok = actual === expected
  if (!ok) failures += 1
  log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `（期望 ${n(expected)}，实际 ${n(actual)}）`}`)
}

for (const scheme of Object.values(pack.schemes)) {
  if (nameFilter && !String(scheme.name ?? '').includes(nameFilter)) continue
  const activeSlot = Number(scheme.activeSlot ?? 0)
  const mainSlot = scheme.teamSlots[activeSlot]
  const agents = buffs.agents
  const mainAgent = agents.find((a) => a.id === mainSlot?.agentId)
  if (!mainAgent) continue

  const flow = resolveFlow({
    slots: scheme.slots,
    teamSlots: scheme.teamSlots.map((s) => ({ agentId: s.agentId })),
    findSkill: (id) => skillById.get(id) ?? null,
    skillSubcategories: buffs.skillSubcategories,
  })

  const ctx = buildOptimalEvalContext({
    isMb: mainAgent.profession === '命破',
    isFengYu: mainAgent.profession === '锋御',
    teamSlots: scheme.teamSlots,
    agents,
    wengines: buffs.wengines,
    bangboo: {
      id: 'none',
      name: 'none',
      avatar_image: null,
      effects: [],
      refinementEffects: [],
      fixedMods: {},
      refinementMods: {},
    },
    bangbooRefine: 1,
    driveDiscs: buffs.driveDiscs,
    mainSlotIndex: activeSlot,
    driveDiscMainStats: mainSlot.affixDriveDiscMainStats ?? createDefaultAffixDriveDiscMainStats(),
    enemyInput: {
      level: 60,
      defense: 953,
      resistanceType: 'normal',
      vulnerableMultiplier: 1,
      staggerMultiplier: 1.5,
      specialMultiplier: 1,
    },
    baseDamageSource:
      mainAgent.profession === '命破' ? 'pierce' : mainAgent.profession === '锋御' ? 'def' : 'atk',
    buffSelection: null,
    slotBuffSelections: scheme.multiSlotBuffSelection ?? null,
    anomalySlotPanels: scheme.anomalySlotPanels ?? undefined,
    convertSlotPanels: scheme.convertSlotPanels ?? undefined,
    hits: flow.hits,
    resolveSubcategory: (id) => buffs.skillSubcategories.find((x) => x.id === id) ?? null,
    skillSubcategories: buffs.skillSubcategories,
    followUpSkillRules: buffs.followUpSkillRules,
  })

  const counts = {
    hpFlat: 0,
    hpPercent: 0,
    atkFlat: 0,
    atkPercent: 0,
    defFlat: 0,
    defPercent: pickOutPercent,
    pen: 0,
    critRate: 0,
    critDmg: totalRolls - pickOutPercent,
    mastery: 0,
  }

  log('='.repeat(78))
  log(`方案: ${scheme.name}   词条=${JSON.stringify(counts)}`)

  // A：柱图口径（基准=外部面板）
  clearAffixEvalCache()
  const a = evaluateAffixCountsForSweep(ctx, counts)
  log('')
  log(`A 柱图口径（基准=外部面板）      = ${n(a.grandTotal)}`)

  // B：组合试算口径（基准=null，主属性/套装与当前一致 → 上下文签名与 A 相同）
  const comboCtx = {
    ...ctx,
    mainBaseExternalPanel: null,
    driveDiscMainStats: { ...ctx.driveDiscMainStats },
    driveDiscSelection: { ...ctx.driveDiscSelection },
  }
  const b = evaluateAffixCounts(comboCtx, counts)
  log(`B 组合试算口径（基准=null）      = ${n(b.grandTotal)}`)

  // C：详情再次评估同一套词条（基准=外部面板）——修复前会命中 B 写下的缓存
  const c = evaluateAffixCounts(ctx, counts)
  log(`C 详情再评估（基准=外部面板）    = ${n(c.grandTotal)}`)
  log('')
  log('断言：')
  check('A 与 B 本就应当不同（两种基准）', a.grandTotal !== b.grandTotal, true)
  check('C 必须等于 A（详情与柱图同源）', c.grandTotal, a.grandTotal)
}

log('')
log(`结果：${failures === 0 ? '全部通过' : `${failures} 项失败`}`)

fs.writeFileSync(
  'D:/WB_agent_out/applications/ZZZ-HP/artifacts/probe-cache-poison.txt',
  out.join('\n') + '\n',
  'utf8',
)
process.exitCode = failures === 0 ? 0 : 1
