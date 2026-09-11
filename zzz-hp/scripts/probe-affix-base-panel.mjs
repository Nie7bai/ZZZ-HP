/**
 * 用真实导出方案复现「词条分析」的基准面板与分配结果。
 *
 * 用途：排查「角色配置面板 → 词条分析」这条链路的数值是否符合预期。
 * 数据：增益库 + 用户导出的方案库 JSON（默认 artifacts/profiles/zzz-hp-schemes-2026-09-10.json）
 *
 * 用法：
 *   npx vite-node scripts/probe-affix-base-panel.mjs [方案JSON路径] [方案名关键词]
 */
import fs from 'node:fs'

import { resolveFlow } from '../src/utils/resolvedHit.ts'
import {
  buildOptimalEvalContext,
  evaluateAffixCounts,
  clearAffixEvalCache,
} from '../src/utils/optimalAffixAlloc.ts'
import { solveOptimalAffixAllocation } from '../src/utils/affixOptimizer.ts'
import {
  createDefaultAffixLibraryState,
  resolveAffixLibrary,
  resolveAffixLibraryAll,
} from '../src/utils/affixLibrary.ts'
import { createEmptyAffixCounts } from '../src/types/calculatorPanel.ts'
import { computeExternalPanelFromTeamSlot } from '../src/utils/affixPanelCalc.ts'
import { AFFIX_VALUE_PER_COUNT } from '../src/utils/affixPanelCalc.ts'
import { schemeActivePanels, schemeAffixInputs } from '../src/utils/agentPanelSources.ts'
import {
  slotParticipatesInConvertBuff,
  teamHasConvertSupportSlots,
} from '../src/utils/panelBuffCalc.ts'

const BUFFS = 'D:/WB_agent_out/applications/ZZZ-HP/zzz-hp-backend/scripts/data/zzz-hp-calculator-buffs.json'
const DEFAULT_SCHEME = 'D:/WB_agent_out/applications/ZZZ-HP/artifacts/profiles/zzz-hp-schemes-2026-09-10.json'

const schemeFile = process.argv[2] ?? DEFAULT_SCHEME
const nameFilter = process.argv[3] ?? ''
const totalRolls = Number(process.argv[4] ?? 30)

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
  log(`方案: ${scheme.name}   activeSlot=${activeSlot}   主C=${mainSlot.agentId}(${mainAgent.name})   职业=${mainAgent.profession}`)
  const bp = mainAgent.basePanel
  log(`角色基础面板: hp=${bp.hp} atk=${bp.atk} def=${bp.def} crit=${bp.critRate} critDmg=${bp.critDmg} 锐爆=${bp.sharpenCritDmgBonus ?? 0}`)

  const saved = scheme.anomalySlotPanels?.[mainSlot.agentId]
  log('')
  log(`[外部面板/面板导入] anomalySlotPanels[${mainSlot.agentId}]:`)
  log(`   ${saved ? `hp=${saved.hp} atk=${saved.atk} def=${saved.def} crit=${saved.critRate} critDmg=${saved.critDmg} pen=${saved.pen} penRate=${saved.penRate} mastery=${saved.mastery}` : '(无)'}`)

  log(`[槽位词条/词条导入] affixCounts = ${JSON.stringify(mainSlot.affixCounts)}`)
  log(`[槽位主属性]        affixMains  = ${JSON.stringify(mainSlot.affixDriveDiscMainStats)}`)

  const derived = computeExternalPanelFromTeamSlot({
    slot: mainSlot,
    agents,
    wengines: buffs.wengines,
    driveDiscs: buffs.driveDiscs,
  })
  log(`[词条导入推导面板] hp=${derived.hp} atk=${derived.atk} def=${derived.def} crit=${derived.critRate} critDmg=${derived.critDmg} pen=${derived.pen} mastery=${derived.mastery}`)

  const flow = resolveFlow({
    slots: scheme.slots,
    teamSlots: scheme.teamSlots.map((s) => ({ agentId: s.agentId })),
    findSkill: (id) => skillById.get(id) ?? null,
    skillSubcategories: buffs.skillSubcategories,
  })
  log(`[流程] 招式数=${flow.hits.length} 缺失=${flow.missingSkillIds.length}`)

  const makeCtx = (anomalySlotPanels) =>
    buildOptimalEvalContext({
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
      anomalySlotPanels,
      convertSlotPanels: scheme.convertSlotPanels ?? undefined,
      hits: flow.hits,
      resolveSubcategory: (id) => buffs.skillSubcategories.find((x) => x.id === id) ?? null,
      skillSubcategories: buffs.skillSubcategories,
      followUpSkillRules: buffs.followUpSkillRules,
    })

  // 复刻组件的 effectiveAnomalySlotPanels：主 C 在转模链里时会不会被剔除（剔除则基准失效）
  const producerIds = new Set()
  for (const hit of flow.hits) {
    for (const id of [hit.ownerAgentId, hit.anomalyPowerAgentId, hit.triggerAgentId]) {
      if (id && id !== mainSlot.agentId) producerIds.add(id)
    }
  }
  const convertCtx = {
    teamSlots: scheme.teamSlots,
    agents,
    wengines: buffs.wengines,
    driveDiscs: buffs.driveDiscs,
    bangboo: { id: 'none', name: 'none', avatar_image: null, effects: [], refinementEffects: [], fixedMods: {}, refinementMods: {} },
    bangbooRefine: 1,
    mainSlotIndex: activeSlot,
    driveDiscsRef: undefined,
  }
  const inConvertChain = slotParticipatesInConvertBuff(convertCtx, activeSlot)
  const teamHasConvert = teamHasConvertSupportSlots(convertCtx, {
    excludeAnomalyAgentIds: producerIds,
  })
  const convertModeActive = inConvertChain || teamHasConvert
  log('')
  log('[转模链检测（仅信息展示：组件已不再据此剔除主 C 面板）]')
  log(`   slotParticipatesInConvertBuff=${inConvertChain}  teamHasConvertSupportSlots=${teamHasConvert}  → ${convertModeActive ? '该主 C 在转模链上（旧逻辑会剔除其面板，已移除）' : '不在转模链'}`)

  const ctx = makeCtx(schemeActivePanels(scheme))
  const zero = createEmptyAffixCounts()

  // 第 5 个参数为 'nobase' 时：模拟改造前的行为（无基准面板，走按槽位配置推导）
  const simulateOld = process.argv[5] === 'nobase'
  if (simulateOld) {
    ctx.mainBaseExternalPanel = null
    log('')
    log('### 模拟改造前路径：mainBaseExternalPanel = null（回退到按槽位配置推导）')
  }

  clearAffixEvalCache()
  const evalZero = evaluateAffixCounts(ctx, zero)
  log('')
  log('[本次改造后：基准 = 外部面板]')
  log(`   基准面板(crit=${ctx.mainBaseExternalPanel?.critRate ?? 'null'}, def=${ctx.mainBaseExternalPanel?.def ?? '-'})`)
  log(`   零额外词条 → 局内 crit=${evalZero.finalPanel.critRate} critDmg=${evalZero.finalPanel.critDmg} def=${evalZero.finalPanel.def}`)
  log(`   总伤=${evalZero.grandTotal.toFixed(0)}   锐爆加成B=${evalZero.breakdown.combatMods.sharpenCritDmgBonus ?? 0}`)

  // 用户当前配置（槽位里已有的词条）
  const cur = { ...zero, ...(mainSlot.affixCounts ?? {}) }
  clearAffixEvalCache()
  const evalCur = evaluateAffixCounts(ctx, cur)
  log('')
  log(`[用户当前配置] 词条 ${JSON.stringify(cur)}`)
  log(`   → 局内 crit=${evalCur.finalPanel.critRate} def=${evalCur.finalPanel.def}`)
  log(`   → 总伤=${evalCur.grandTotal.toFixed(0)}`)

  // 求解
  const state = createDefaultAffixLibraryState()
  const entries = resolveAffixLibrary(state)
  const allEntries = resolveAffixLibraryAll(state)
  log('')
  log(`[词条库] 启用 ${entries.length} / 全部 ${allEntries.length} 条`)

  clearAffixEvalCache()
  const t0 = performance.now()
  const solved = solveOptimalAffixAllocation({
    ctx,
    entries,
    maxTotalRolls: totalRolls,
    candidateWidthMode: 'auto',
  })
  const ms = performance.now() - t0
  log('')
  log(`[求解 ${totalRolls} 词条] 用时 ${(ms / 1000).toFixed(2)}s`)
  log(`   基线总伤=${solved.baselineDamage.toFixed(0)}  结果总伤=${solved.totalDamage.toFixed(0)}  提升=${solved.improvementPercent.toFixed(2)}%`)
  log(`   已用档数=${solved.usedRolls}`)
  const rows = Object.entries(solved.rollsByEntryId ?? {}).filter(([, v]) => v > 0)
  for (const [id, v] of rows) log(`     ${id} × ${v}`)
  log(`   counts=${JSON.stringify(solved.counts)}`)

  // 求解结果下、以及「当前配置 + 求解增量」下的局内面板
  clearAffixEvalCache()
  const evalSolved = evaluateAffixCounts(ctx, solved.counts, solved.panelDeltas)
  log(`   求解结果局内: crit=${evalSolved.finalPanel.critRate} def=${evalSolved.finalPanel.def}`)
  clearAffixEvalCache()
  const evalCurPlus = evaluateAffixCounts(
    ctx,
    { ...cur, ...Object.fromEntries(Object.entries(solved.counts).map(([k, v]) => [k, (cur[k] ?? 0) + v])) },
    solved.panelDeltas,
  )
  log(`   当前配置+求解增量 → 局内 crit=${evalCurPlus.finalPanel.critRate} def=${evalCurPlus.finalPanel.def} 总伤=${evalCurPlus.grandTotal.toFixed(0)}`)

  // 边际：从零词条出发，逐项 +1 档
  log('')
  log('[边际收益（零词条基线，+1 档）]')
  const candKeys = ['critRate', 'critDmg', 'atkPercent', 'defPercent', 'defFlat', 'pen', 'mastery', 'hpPercent', 'hpFlat', 'atkFlat']
  const marg = []
  for (const k of candKeys) {
    clearAffixEvalCache()
    const bumped = { ...zero, [k]: (zero[k] ?? 0) + 1 }
    const e = evaluateAffixCounts(ctx, bumped)
    marg.push({ k, delta: e.grandTotal - evalZero.grandTotal })
  }
  marg.sort((a, b) => b.delta - a.delta)
  for (const m of marg) {
    log(`   ${m.k.padEnd(11)} +${AFFIX_VALUE_PER_COUNT[m.k] ?? '?'} → ${m.delta.toFixed(0)} (${evalZero.grandTotal > 0 ? ((m.delta / evalZero.grandTotal) * 100).toFixed(3) : '0'}%)`)
  }

  // 从「零 + 19 暴击」看暴击是否已经废掉
  clearAffixEvalCache()
  const e19 = evaluateAffixCounts(ctx, { ...zero, critRate: 19 })
  log('')
  log(`[假设加 19 条暴击] 局内 crit=${e19.finalPanel.critRate}  总伤=${e19.grandTotal.toFixed(0)}（相对零词条 ${(e19.grandTotal - evalZero.grandTotal >= 0 ? '+' : '')}${(e19.grandTotal - evalZero.grandTotal).toFixed(0)}）`)
  clearAffixEvalCache()
  const e20 = evaluateAffixCounts(ctx, { ...zero, critRate: 20 })
  log(`[再加到 20 条]      局内 crit=${e20.finalPanel.critRate}  总伤=${e20.grandTotal.toFixed(0)}`)
}

fs.writeFileSync('D:/WB_agent_out/applications/ZZZ-HP/artifacts/probe-affix-base-panel.txt', out.join('\n') + '\n', 'utf8')
