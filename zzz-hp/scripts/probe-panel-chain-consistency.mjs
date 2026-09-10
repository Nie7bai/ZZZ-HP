/**
 * 一致性探针：同一个面板数字，两条链路是否等价。
 *
 * 背景：最优词条区有两套「算面板」的入口：
 *   - `PANEL_NUMBERS_ONLY`（扫掠总伤、详情总伤）→ `collectPanelBuffMods()`
 *   - 带明细（计算过程逐事件展示）→ `mergeModsFromSources(collectPanelBuffModSources())`
 * 若两者不等价，就会出现「详情里显示的数字 ≠ 参与结算的数字」——
 * 用户反馈的「伤害显示和真实的伤害计算不同」正是这种形态。
 *
 * 本脚本对每份方案跑三组对照：
 *   [1] 面板：includeDetails true vs false 的 finalPanel 是否逐字段一致
 *   [2] 总伤：evaluateAffixCountsForSweep（数字口径）vs 逐事件 evaluateOptimalEventDetail（明细口径）
 *   [3] 全部柱子：每一根柱的 grandTotal 与「详情口径重算」是否一致
 *
 * 用法：npx vite-node scripts/probe-panel-chain-consistency.mjs [方案JSON] [方案名关键词]
 */
import fs from 'node:fs'

import { resolveFlow } from '../src/utils/resolvedHit.ts'
import {
  buildOptimalEvalContext,
  evaluateAffixCounts,
  evaluateAffixCountsForSweep,
  evaluateOptimalEventDetail,
  sweepDirectDamage,
  sweepAnomalyDamage,
  clearAffixEvalCache,
} from '../src/utils/optimalAffixAlloc.ts'
import { createDefaultAffixDriveDiscMainStats } from '../src/utils/affixDriveDiscConfig.ts'

const BUFFS = 'D:/WB_agent_out/applications/ZZZ-HP/zzz-hp-backend/scripts/data/zzz-hp-calculator-buffs.json'
const DEFAULT_SCHEME = 'D:/WB_agent_out/applications/ZZZ-HP/artifacts/profiles/zzz-hp-schemes-2026-09-10.json'

const schemeFile = process.argv[2] ?? DEFAULT_SCHEME
const nameFilter = process.argv[3] ?? ''

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
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1
  log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function makeCtx(scheme, flow) {
  const activeSlot = Number(scheme.activeSlot ?? 0)
  const mainSlot = scheme.teamSlots[activeSlot]
  const agents = buffs.agents
  const mainAgent = agents.find((a) => a.id === mainSlot?.agentId)
  if (!mainAgent) return null
  return {
    mainAgent,
    activeSlot,
    ctx: buildOptimalEvalContext({
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
      driveDiscMainStats:
        mainSlot.affixDriveDiscMainStats ?? createDefaultAffixDriveDiscMainStats(),
      enemyInput: {
        level: 60,
        defense: 953,
        resistanceType: 'normal',
        vulnerableMultiplier: 1,
        staggerMultiplier: 1.5,
        specialMultiplier: 1,
      },
      baseDamageSource:
        mainAgent.profession === '命破'
          ? 'pierce'
          : mainAgent.profession === '锋御'
            ? 'def'
            : 'atk',
      buffSelection: null,
      slotBuffSelections: scheme.multiSlotBuffSelection ?? null,
      anomalySlotPanels: scheme.anomalySlotPanels ?? undefined,
      convertSlotPanels: scheme.convertSlotPanels ?? undefined,
      hits: flow.hits,
      resolveSubcategory: (id) => buffs.skillSubcategories.find((x) => x.id === id) ?? null,
      skillSubcategories: buffs.skillSubcategories,
      followUpSkillRules: buffs.followUpSkillRules,
    }),
  }
}

/** 用明细口径（includeDetails: true）逐事件重算总伤 */
function detailsTotal(ctx, external) {
  let sum = 0
  for (const hit of ctx.hits ?? []) {
    const detail = evaluateOptimalEventDetail(ctx, external, hit)
    if (detail) sum += detail.total
  }
  return sum
}

for (const scheme of Object.values(pack.schemes)) {
  if (nameFilter && !String(scheme.name ?? '').includes(nameFilter)) continue

  const flow = resolveFlow({
    slots: scheme.slots,
    teamSlots: scheme.teamSlots.map((s) => ({ agentId: s.agentId })),
    findSkill: (id) => skillById.get(id) ?? null,
    skillSubcategories: buffs.skillSubcategories,
  })
  const made = makeCtx(scheme, flow)
  if (!made) continue
  const { ctx, mainAgent, activeSlot } = made

  log('='.repeat(78))
  log(`方案: ${scheme.name}   主C=${mainAgent.id}(${mainAgent.name})  职业=${mainAgent.profession}`)

  const isAnomaly = mainAgent.profession === '异常'
  const state = isAnomaly
    ? { flatStat: 0, pen: 0, totalRolls: 12 }
    : { flatStat: 0, hpFlat: 0, atkPercent: 0, pen: 0, mastery: 0, critRate: 0, totalRolls: 12 }

  clearAffixEvalCache()
  const points = isAnomaly ? sweepAnomalyDamage(ctx, state) : sweepDirectDamage(ctx, state)
  log(`   [柱] ${points.length} 根${isAnomaly ? '（异常）' : '（直伤）'}`)

  // [1] 同一事件、两种口径：明细（includeDetails=true）vs 数字（false）
  const sampleCounts = points[Math.floor(points.length / 2)]?.affixCounts
  if (sampleCounts) {
    clearAffixEvalCache()
    const numbersOnly = evaluateAffixCounts(ctx, sampleCounts)
    log('')
    log('  [1] 同一事件：明细口径 vs 数字口径（面板/单次/合计）')
    let hitMismatch = 0
    const mismatches = []
    for (const hit of ctx.hits ?? []) {
      const withDetails = evaluateOptimalEventDetail(ctx, numbersOnly.external, hit)
      const numbers = evaluateOptimalEventDetail(ctx, numbersOnly.external, hit, {
        includeDetails: false,
      })
      if (!withDetails || !numbers) {
        if (Boolean(withDetails) !== Boolean(numbers)) {
          hitMismatch += 1
          mismatches.push(`${hit.id}: 一个有一无`)
        }
        continue
      }
      const panelDiff = Math.abs(withDetails.finalPanel.atk - numbers.finalPanel.atk) +
        Math.abs(withDetails.finalPanel.def - numbers.finalPanel.def) +
        Math.abs(withDetails.finalPanel.critRate - numbers.finalPanel.critRate) +
        Math.abs(withDetails.finalPanel.critDmg - numbers.finalPanel.critDmg) +
        Math.abs(withDetails.finalPanel.mastery - numbers.finalPanel.mastery) +
        Math.abs(withDetails.finalPanel.pen - numbers.finalPanel.pen) +
        Math.abs(withDetails.finalPanel.dmgBonus - numbers.finalPanel.dmgBonus)
      const totalDiff = Math.abs(withDetails.total - numbers.total)
      if (panelDiff > 1e-6 || totalDiff > 0.5) {
        hitMismatch += 1
        mismatches.push(
          `${hit.skill.name}: 合计 ${n(withDetails.total)} vs ${n(numbers.total)}` +
            `；atk ${withDetails.finalPanel.atk.toFixed(1)} vs ${numbers.finalPanel.atk.toFixed(1)}` +
            `；dmgBonus ${withDetails.finalPanel.dmgBonus} vs ${numbers.finalPanel.dmgBonus}`,
        )
      }
    }
    for (const m of mismatches.slice(0, 5)) log(`      ${m}`)
    check(
      '同一事件在两种口径下结果一致',
      hitMismatch === 0,
      `${hitMismatch}/${(ctx.hits ?? []).length} 条不一致`,
    )
  }

  if (sampleCounts) {
    // [2] 总伤两口径
    log('')
    log('  [2] 总伤两口径')
    clearAffixEvalCache()
    const sweepEval = evaluateAffixCountsForSweep(ctx, sampleCounts)
    clearAffixEvalCache()
    const baseEval = evaluateAffixCounts(ctx, sampleCounts)
    const detTotal = detailsTotal(ctx, baseEval.external)
    check(
      '数字口径总伤 = 明细口径逐事件合计',
      Math.abs(sweepEval.grandTotal - detTotal) < 1,
      `${n(sweepEval.grandTotal)} vs ${n(detTotal)}`,
    )
  }

  // [3] 每根柱：柱上总伤 vs 明细口径重算
  log('')
  log('  [3] 每根柱：柱体数值 vs 明细口径重算')
  let barMismatch = 0
  const rows = []
  for (const p of points) {
    clearAffixEvalCache()
    const e = evaluateAffixCounts(ctx, p.affixCounts)
    const det = detailsTotal(ctx, e.external)
    const diff = p.grandTotal - det
    if (Math.abs(diff) > 1) barMismatch += 1
    rows.push({ label: p.label, bar: p.grandTotal, detail: det, diff })
  }
  for (const r of rows.slice(0, 4)) {
    log(`     ${String(r.label).padEnd(18)} 柱=${n(r.bar).padStart(12)}  明细=${n(r.detail).padStart(12)}  差=${n(r.diff)}`)
  }
  if (rows.length > 4) log(`     … 共 ${rows.length} 根`)
  check('全部柱体与明细口径一致', barMismatch === 0, `${barMismatch}/${rows.length} 根不一致`)

  // [4] 缓存污染：组合试算（null 基准）不得影响后续柱图/明细
  log('')
  log('  [4] 组合试算（null 基准）之后的柱图/明细')
  const sample = points[Math.floor(points.length / 2)]
  if (sample) {
    clearAffixEvalCache()
    const before = evaluateAffixCounts(ctx, sample.affixCounts).grandTotal
    const comboCtx = {
      ...ctx,
      mainBaseExternalPanel: null,
      driveDiscMainStats: { ...ctx.driveDiscMainStats },
      driveDiscSelection: { ...ctx.driveDiscSelection },
    }
    evaluateAffixCounts(comboCtx, sample.affixCounts)
    const after = evaluateAffixCounts(ctx, sample.affixCounts).grandTotal
    check('组合试算后柱图数值不串（缓存按上下文隔离）', after === before, `${n(before)} → ${n(after)}`)
  }
  log(`   activeSlot=${activeSlot}`)
}

log('')
log(`结果：${failures === 0 ? '全部通过' : `${failures} 项失败`}`)

fs.writeFileSync(
  'D:/WB_agent_out/applications/ZZZ-HP/artifacts/probe-panel-chain-consistency.txt',
  out.join('\n') + '\n',
  'utf8',
)
process.exitCode = failures === 0 ? 0 : 1
