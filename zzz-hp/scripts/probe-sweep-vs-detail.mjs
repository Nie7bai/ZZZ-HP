/**
 * 复现「扫掠柱图总伤」与「计算过程详情总伤」不一致的问题。
 *
 * 三条路径在代码上应当同源，本脚本把它们摆在一起逐项对比：
 *   A. 柱体本身：sweepDirectDamage() 产出的 point.grandTotal / point.eventLines
 *   B. 选中柱后重新评估：evaluateAffixCounts(ctx, point.affixCounts)
 *   C. 详情面板逐事件：evaluateOptimalEventDetail(ctx, external, hit)
 *
 * 用法：
 *   npx vite-node scripts/probe-sweep-vs-detail.mjs [方案JSON路径] [方案名关键词] [总词条数] [选中档 outPercent]
 */
import fs from 'node:fs'

import { resolveFlow } from '../src/utils/resolvedHit.ts'
import {
  buildOptimalEvalContext,
  evaluateAffixCounts,
  evaluateOptimalEventDetail,
  sweepDirectDamage,
  clearAffixEvalCache,
  getAffixRollCaps,
} from '../src/utils/optimalAffixAlloc.ts'

const BUFFS = 'D:/WB_agent_out/applications/ZZZ-HP/zzz-hp-backend/scripts/data/zzz-hp-calculator-buffs.json'
const DEFAULT_SCHEME = 'D:/WB_agent_out/applications/ZZZ-HP/artifacts/profiles/zzz-hp-schemes-2026-09-10.json'

const schemeFile = process.argv[2] ?? DEFAULT_SCHEME
const nameFilter = process.argv[3] ?? ''
const totalRolls = Number(process.argv[4] ?? 30)
const pickOutPercent = Number(process.argv[5] ?? 9)

const out = []
const log = (...args) => {
  const line = args.join(' ')
  out.push(line)
  console.log(line)
}

const buffs = JSON.parse(fs.readFileSync(BUFFS, 'utf8'))
const pack = JSON.parse(fs.readFileSync(schemeFile, 'utf8'))
const skillById = new Map(
  [...(buffs.skills ?? []), ...(pack.customSkills ?? [])].map((s) => [s.id, s]),
)

const n = (v) => (Number.isFinite(v) ? v.toFixed(0) : String(v))
const sumLines = (lines) => (lines ?? []).reduce((sum, line) => sum + (line?.total ?? 0), 0)

const schemes = Object.values(pack.schemes).filter(
  (s) => !nameFilter || String(s.name ?? '').includes(nameFilter),
)

for (const scheme of schemes) {
  const activeSlot = Number(scheme.activeSlot ?? 0)
  const mainSlot = scheme.teamSlots[activeSlot]
  const agents = buffs.agents
  const mainAgent = agents.find((a) => a.id === mainSlot?.agentId)
  if (!mainAgent) continue

  log('='.repeat(78))
  log(`方案: ${scheme.name}   主C=${mainSlot.agentId}(${mainAgent.name})  职业=${mainAgent.profession}`)

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
    driveDiscMainStats: mainSlot.affixDriveDiscMainStats ?? {
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
    anomalySlotPanels: scheme.anomalySlotPanels ?? undefined,
    convertSlotPanels: scheme.convertSlotPanels ?? undefined,
    hits: flow.hits,
    resolveSubcategory: (id) => buffs.skillSubcategories.find((x) => x.id === id) ?? null,
    skillSubcategories: buffs.skillSubcategories,
    followUpSkillRules: buffs.followUpSkillRules,
  })

  const caps = getAffixRollCaps(ctx.driveDiscMainStats)
  log(`[主词条上限] ${JSON.stringify(caps)}   总词条数=${totalRolls}`)
  log(`[招式] 事件数=${flow.hits.length}`)

  const state = {
    flatStat: 0,
    hpFlat: 0,
    atkPercent: 0,
    pen: 0,
    mastery: 0,
    critRate: 0,
    totalRolls,
  }

  clearAffixEvalCache()
  const points = sweepDirectDamage(ctx, state)
  log('')
  log(`[A] 柱体（sweepDirectDamage 产出 ${points.length} 根）`)
  for (const p of points) {
    log(
      `   ${String(p.label).padEnd(16)} grandTotal=${n(p.grandTotal)}  事件行合计=${n(sumLines(p.eventLines))}  行数=${(p.eventLines ?? []).length}  有快照=${Boolean(p.evalSnapshot)}`,
    )
  }

  const picked = points.find((p) => p.outPercent === pickOutPercent) ?? points[0]
  if (!picked) continue

  log('')
  log(`[对比目标] ${picked.label}`)

  // A：柱体自身
  const aTotal = picked.grandTotal
  const aLines = sumLines(picked.eventLines)

  // B：用柱体的词条重新评估（组件 selectedEval 的路径；缓存温热，模拟 UI 顺序）
  const bEval = evaluateAffixCounts(ctx, picked.affixCounts)
  const bLines = sumLines(bEval.eventLines)

  // B2：清缓存后重新评估（缓存若在捣乱，这里会给出「真值」）
  clearAffixEvalCache()
  const b2Eval = evaluateAffixCounts(ctx, picked.affixCounts)
  const b2Lines = sumLines(b2Eval.eventLines)

  // C：详情面板逐事件（组件 useDamageProcessEvents 的路径）
  let cSum = 0
  const perHit = []
  for (const hit of flow.hits) {
    const detail = evaluateOptimalEventDetail(ctx, b2Eval.external, hit)
    if (!detail) {
      perHit.push({ id: hit.id, name: hit.skill.name, total: null })
      continue
    }
    cSum += detail.total
    perHit.push({ id: hit.id, name: hit.skill.name, total: detail.total })
  }

  log('')
  log(`   A 柱体 grandTotal            = ${n(aTotal)}`)
  log(`   A 柱体 eventLines 合计       = ${n(aLines)}`)
  log(`   B 温热缓存 evaluateAffixCounts= ${n(bEval.grandTotal)}  eventLines 合计=${n(bLines)}`)
  log(`   B2 清缓存 evaluateAffixCounts= ${n(b2Eval.grandTotal)}  eventLines 合计=${n(b2Lines)}`)
  log(`   C 详情逐事件 evaluateOptimalEventDetail 合计 = ${n(cSum)}`)
  log('')
  log(`   差异：A-B=${n(aTotal - bEval.grandTotal)}   A-B2=${n(aTotal - b2Eval.grandTotal)}   B2-C=${n(b2Lines - cSum)}`)
  log(`   counts=${JSON.stringify(picked.affixCounts)}`)
  log(`   外部面板: ${JSON.stringify(b2Eval.external)}`)
  log('')
  log('   [逐事件：柱体行 vs 详情]')
  const lineById = new Map((picked.eventLines ?? []).map((l) => [l.eventId, l]))
  for (const row of perHit) {
    const line = lineById.get(row.id)
    const lineTotal = line?.total ?? 0
    const diff = row.total == null ? NaN : lineTotal - row.total
    log(
      `     ${String(row.id).padEnd(22)} ${String(row.name).slice(0, 18).padEnd(20)} 柱体=${String(n(lineTotal)).padStart(12)}  详情=${String(n(row.total)).padStart(12)}  差=${n(diff)}`,
    )
  }
}

fs.writeFileSync(
  'D:/WB_agent_out/applications/ZZZ-HP/artifacts/probe-sweep-vs-detail.txt',
  out.join('\n') + '\n',
  'utf8',
)
