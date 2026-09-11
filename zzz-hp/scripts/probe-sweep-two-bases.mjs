/**
 * 把「基准=外部面板」与「基准=null（旧口径）」两条扫掠曲线并排打印，
 * 用于判断截图里的柱状图到底是哪一条，以及详情数字来自哪一条。
 *
 * 用法：npx vite-node scripts/probe-sweep-two-bases.mjs [方案JSON] [方案名] [总词条数]
 */
import fs from 'node:fs'

import { resolveFlow } from '../src/utils/resolvedHit.ts'
import { schemeActivePanels, schemeAffixInputs } from '../src/utils/agentPanelSources.ts'
import {
  buildOptimalEvalContext,
  sweepDirectDamage,
  clearAffixEvalCache,
} from '../src/utils/optimalAffixAlloc.ts'

const BUFFS = 'D:/WB_agent_out/applications/ZZZ-HP/zzz-hp-backend/scripts/data/zzz-hp-calculator-buffs.json'
const DEFAULT_SCHEME = 'D:/WB_agent_out/applications/ZZZ-HP/artifacts/profiles/zzz-hp-schemes-2026-09-10.json'

const schemeFile = process.argv[2] ?? DEFAULT_SCHEME
const nameFilter = process.argv[3] ?? ''
const totalRolls = Number(process.argv[4] ?? 30)

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

  const state = {
    flatStat: 0,
    hpFlat: 0,
    atkPercent: 0,
    pen: 0,
    mastery: 0,
    critRate: 0,
    totalRolls,
  }

  log('='.repeat(84))
  log(`方案: ${scheme.name}   总词条数=${totalRolls}`)
  log(`截图参考：柱图最矮 63.14M、最高约 78.48M、最后一根(30/0) 74.64M、tooltip(9/21) 74,222,437；详情 56,758,629`)

  const curves = []
  for (const [label, mutate] of [
    ['基准=外部面板', () => ({})],
    ['基准=null 旧口径', () => ({ mainBaseExternalPanel: null })],
  ]) {
    clearAffixEvalCache()
    const c = { ...ctx, ...mutate() }
    const points = sweepDirectDamage(c, state)
    const totals = points.map((p) => p.grandTotal)
    curves.push({ label, totals, points })
  }

  const head = '  outPercent | ' + curves.map((c) => c.label.padStart(16)).join(' | ')
  log('')
  log(head)
  log('  ' + '-'.repeat(head.length))
  const count = Math.max(...curves.map((c) => c.totals.length))
  for (let i = 0; i < count; i++) {
    const cells = curves.map((c) => (c.totals[i] == null ? '-' : n(c.totals[i]).padStart(16)))
    log(`  ${String(i).padStart(10)} | ${cells.join(' | ')}`)
  }

  log('')
  for (const c of curves) {
    const t = c.totals
    const max = Math.max(...t)
    const maxIdx = t.indexOf(max)
    const i9 = t[9]
    log(
      `[${c.label}] 最矮=${n(Math.min(...t))}  最高=${n(max)}（第 ${maxIdx} 根）  9/21=${n(i9)}  ${n(i9 / max * 100 - 100)}% vs 最高`,
    )
  }
}

fs.writeFileSync(
  'D:/WB_agent_out/applications/ZZZ-HP/artifacts/probe-sweep-two-bases.txt',
  out.join('\n') + '\n',
  'utf8',
)
