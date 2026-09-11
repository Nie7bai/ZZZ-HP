/**
 * 反查：截图里「计算过程 总伤期望 56,758,629」是哪一种口径算出来的。
 *
 * 候选口径（都用同一份真实方案、同一柱：局外大防御 9 / 爆伤 21）：
 *   S1 基准=外部面板（新架构）            —— 柱图 tooltip 的口径
 *   S2 基准=null，回退按槽位配置推导（旧架构）
 *   S3 S1 但外部面板不含锐化/暴伤折算
 *   S4 按「面板单次伤害」而非事件总伤
 *
 * 用法：npx vite-node scripts/probe-detail-candidate.mjs [方案JSON] [方案名] [总词条数] [outPercent]
 */
import fs from 'node:fs'

import { resolveFlow } from '../src/utils/resolvedHit.ts'
import { schemeActivePanels, schemeAffixInputs } from '../src/utils/agentPanelSources.ts'
import {
  buildOptimalEvalContext,
  evaluateAffixCounts,
  clearAffixEvalCache,
} from '../src/utils/optimalAffixAlloc.ts'

const BUFFS = 'D:/WB_agent_out/applications/ZZZ-HP/zzz-hp-backend/scripts/data/zzz-hp-calculator-buffs.json'
const DEFAULT_SCHEME = 'D:/WB_agent_out/applications/ZZZ-HP/artifacts/profiles/zzz-hp-schemes-2026-09-10.json'

const schemeFile = process.argv[2] ?? DEFAULT_SCHEME
const nameFilter = process.argv[3] ?? ''
const totalRolls = Number(process.argv[4] ?? 30)
const pickOutPercent = Number(process.argv[5] ?? 9)
const TARGET = Number(process.argv[6] ?? 56758629)

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
    driveDiscMainStats: schemeAffixInputs(scheme, mainSlot.agentId).affixDriveDiscMainStats ?? {
      slot4MainStat: 'critRate',
      slot5MainStat: 'penRate',
      slot6MainStat: 'externalDefPercent',
    },
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
    activeSlotPanels: schemeActivePanels(scheme),
    convertSlotPanels: scheme.convertSlotPanels ?? undefined,
    hits: flow.hits,
    resolveSubcategory: (id) => buffs.skillSubcategories.find((x) => x.id === id) ?? null,
    skillSubcategories: buffs.skillSubcategories,
    followUpSkillRules: buffs.followUpSkillRules,
  })

  log('='.repeat(78))
  log(`方案: ${scheme.name}  目标值(截图详情)=${TARGET}`)
  const counts = { defPercent: pickOutPercent, critDmg: totalRolls - pickOutPercent }
  const full = {
    hpFlat: 0,
    hpPercent: 0,
    atkFlat: 0,
    atkPercent: 0,
    defFlat: 0,
    defPercent: 0,
    pen: 0,
    critRate: 0,
    critDmg: 0,
    mastery: 0,
    ...counts,
  }
  log(`词条: ${JSON.stringify(full)}`)

  const runs = []
  const run = (label, mutate, useHits = true) => {
    clearAffixEvalCache()
    const c = { ...ctx, ...mutate() }
    if (!useHits) c.hits = undefined
    const e = evaluateAffixCounts(c, full)
    runs.push({ label, total: e.grandTotal, external: e.external })
    log('')
    log(`[${label}]`)
    log(`   总伤=${n(e.grandTotal)}   差值(对目标)=${n(e.grandTotal - TARGET)}`)
    log(`   局内: crit=${e.finalPanel.critRate} critDmg=${e.finalPanel.critDmg} def=${e.finalPanel.def} atk=${e.finalPanel.atk}`)
    log(`   锐爆加成B=${e.breakdown?.combatMods?.sharpenCritDmgBonus ?? 0}`)
  }

  run('S1 基准=外部面板（柱图口径，新架构）', () => ({}))
  run('S2 基准=null（旧架构：按槽位配置推导）', () => ({ mainBaseExternalPanel: null }))
  run('S3 基准=null 且 无外部面板可读', () => ({
    mainBaseExternalPanel: null,
    panelContext: { ...ctx.panelContext, activeSlotPanels: {} },
  }))
  run('S4 基准=外部面板，但只算面板（无事件）', () => ({}), false)

  log('')
  log('[汇总]')
  for (const r of runs) {
    log(`   ${r.label.padEnd(42)} = ${n(r.total).padStart(12)}  (差 ${n(r.total - TARGET)})`)
  }
}

fs.writeFileSync(
  'D:/WB_agent_out/applications/ZZZ-HP/artifacts/probe-detail-candidate.txt',
  out.join('\n') + '\n',
  'utf8',
)
