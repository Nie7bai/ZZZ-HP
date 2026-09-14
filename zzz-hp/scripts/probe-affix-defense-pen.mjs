/**
 * 排查：高减防下词条最优/收益表是否仍把穿透率排太高。
 *
 * 用法：
 *   npx vite-node scripts/probe-affix-defense-pen.mjs [方案JSON] [方案名关键词]
 */
import fs from 'node:fs'

import { computeDefenseZone } from '../src/utils/damageCalc.ts'
import { resolveFlow, buildGenericPanelSkillContext } from '../src/utils/resolvedHit.ts'
import {
  buildOptimalEvalContext,
  evaluateAffixCounts,
  clearAffixEvalCache,
} from '../src/utils/optimalAffixAlloc.ts'
import {
  createDefaultAffixLibraryState,
  resolveAffixLibraryAll,
} from '../src/utils/affixLibrary.ts'
import { computeAffixBenefitTable } from '../src/utils/affixBenefitAnalysis.ts'
import { createEmptyAffixCounts } from '../src/types/calculatorPanel.ts'
import { schemeActivePanels, schemeAffixInputs } from '../src/utils/agentPanelSources.ts'
import { BUFFS_JSON, artifactPath, resolveSchemePath } from './_paths.mjs'

const DEFAULT_SCHEME_FILE = 'zzz-hp-schemes-2026-09-14叶琉千.json'
const schemeFile = resolveSchemePath(process.argv[2], DEFAULT_SCHEME_FILE)
const nameFilter = process.argv[3] ?? '叶琉千'

const out = []
const log = (...args) => {
  const line = args.join(' ')
  out.push(line)
  console.log(line)
}

const buffs = JSON.parse(fs.readFileSync(BUFFS_JSON, 'utf8'))
const pack = JSON.parse(fs.readFileSync(schemeFile, 'utf8'))
const skillById = new Map(
  [...(buffs.skills ?? []), ...(pack.customSkills ?? [])].map((s) => [s.id, s]),
)
const groupById = new Map((buffs.skillGroups ?? []).map((g) => [g.id, g]))

const schemes = Object.values(pack.schemes).filter(
  (s) => !nameFilter || String(s.name ?? '').includes(nameFilter),
)

function zoneRow(enemyDef, reduceDefense, penRate, pen = 0) {
  const z = computeDefenseZone({
    defensePanel: { penRate, pen, ignoreDefense: 0, reduceDefense },
    isMb: false,
    enemyDefense: enemyDef,
  })
  return z
}

function pct(n) {
  return `${n.toFixed(3)}%`
}

log('方案文件', schemeFile)
log('')
log('[手算防御区] 敌防 953、固穿 0')
log('减防%   穿透0区    穿透24区   区增益%')
for (const shred of [0, 21, 41, 61, 81]) {
  const a = zoneRow(953, shred, 0)
  const b = zoneRow(953, shred, 24)
  const gain = ((b.defenseMultiplier / a.defenseMultiplier) - 1) * 100
  log(
    `${String(shred).padStart(4)}   ${a.defenseMultiplier.toFixed(4)}    ${b.defenseMultiplier.toFixed(4)}    ${pct(gain)}`,
  )
}

for (const scheme of schemes) {
  const activeSlot = Number(scheme.activeSlot ?? 0)
  const mainSlot = scheme.teamSlots[activeSlot]
  const mainAgent = buffs.agents.find((a) => a.id === mainSlot?.agentId)
  if (!mainAgent) continue

  log('')
  log('='.repeat(78))
  log(`方案 ${scheme.name}  主C=${mainAgent.name}(${mainAgent.id}) 职业=${mainAgent.profession}`)

  const flow = resolveFlow({
    slots: scheme.slots,
    teamSlots: scheme.teamSlots.map((s) => ({ agentId: s.agentId })),
    findSkill: (id) => skillById.get(id) ?? null,
    findSkillGroup: (id) => groupById.get(id) ?? null,
    skillSubcategories: buffs.skillSubcategories,
  })
  log(`[流程] hits=${flow.hits.length} 缺失=${flow.missingSkillIds.join(',') || '无'}`)
  for (const hit of flow.hits) {
    log(
      `  hit ${hit.id} type=${hit.skill.damageType} coords=${JSON.stringify(hit.coords)}`,
    )
  }

  const affixInputs = schemeAffixInputs(scheme, mainSlot.agentId)
  const enemyInput = scheme.panelState?.enemyInput ?? {
    level: 60,
    defense: 953,
    resistanceType: 'normal',
    vulnerableMultiplier: 1,
    staggerMultiplier: 1.5,
    specialMultiplier: 1,
  }

  const makeCtx = (hits) =>
    buildOptimalEvalContext({
      isMb: mainAgent.profession === '命破',
      isFengYu: mainAgent.profession === '锋御',
      teamSlots: scheme.teamSlots,
      agents: buffs.agents,
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
      driveDiscMainStats: affixInputs.affixDriveDiscMainStats ?? {
        slot4MainStat: 'critDmg',
        slot5MainStat: 'externalAtkPercent',
        slot6MainStat: 'externalHpPercent',
      },
      enemyInput,
      baseDamageSource: 'atk',
      skillContext: buildGenericPanelSkillContext({
        element: mainAgent.element,
        staggerPhase: scheme.staggerPhase ?? 'stagger',
        damageKind: 'direct',
      }),
      buffSelection: null,
      slotBuffSelections: scheme.multiSlotBuffSelection ?? null,
      activeSlotPanels: schemeActivePanels(scheme),
      convertSlotPanels: scheme.convertSlotPanels ?? undefined,
      hits,
      resolveSubcategory: (id) =>
        (buffs.skillSubcategories ?? []).find((x) => x.id === id) ?? null,
      skillSubcategories: buffs.skillSubcategories,
      followUpSkillRules: buffs.followUpSkillRules,
    })

  const library = resolveAffixLibraryAll(createDefaultAffixLibraryState())
  const slot5 = library.filter(
    (e) => e.id === 'main:slot5:penRate' || e.id === 'main:slot5:dmgBonus' || e.id === 'main:slot5:externalAtkPercent',
  )
  const atkSub = library.find((e) => e.id === 'substat:atkPercent')
  const entries = [...slot5, ...(atkSub ? [atkSub] : [])]

  function report(label, hits) {
    clearAffixEvalCache()
    const ctx = makeCtx(hits)
    const zero = createEmptyAffixCounts()
    const base = evaluateAffixCounts(ctx, zero)
    const panel = base.finalPanel
    const defZone = computeDefenseZone({
      defensePanel: {
        penRate: panel.penRate,
        pen: panel.pen,
        ignoreDefense: panel.ignoreDefense,
        reduceDefense: panel.reduceDefense,
      },
      isMb: ctx.isMb,
      enemyDefense: enemyInput.defense,
    })
    log('')
    log(`--- ${label} ---`)
    log(
      `局内 减防=${panel.reduceDefense} 无视=${panel.ignoreDefense} 穿透率=${panel.penRate} 固穿=${panel.pen} 增伤=${panel.dmgBonus} 攻=${panel.atk}`,
    )
    log(
      `防御区=${defZone.defenseMultiplier.toFixed(4)} 有效防御=${defZone.effectiveDefense.toFixed(2)} 总伤=${base.grandTotal.toFixed(1)}`,
    )

    const penEval = evaluateAffixCounts(ctx, zero, { penRate: 24 })
    const dmgEval = evaluateAffixCounts(ctx, zero, { dmgBonus: 30 })
    const atkEval = evaluateAffixCounts(ctx, { ...zero, atkPercent: 1 })
    const rel = (ev) =>
      base.grandTotal > 0 ? ((ev.grandTotal - base.grandTotal) / base.grandTotal) * 100 : 0
    log(`+24 穿透率  总伤=${penEval.grandTotal.toFixed(1)}  收益=${pct(rel(penEval))}  局内穿透=${penEval.finalPanel.penRate} 减防=${penEval.finalPanel.reduceDefense}`)
    log(`+30 增伤    总伤=${dmgEval.grandTotal.toFixed(1)}  收益=${pct(rel(dmgEval))}  局内增伤=${dmgEval.finalPanel.dmgBonus}`)
    log(`+1 攻击%    总伤=${atkEval.grandTotal.toFixed(1)}  收益=${pct(rel(atkEval))}`)

    const table = computeAffixBenefitTable({
      ctx,
      baseCounts: zero,
      entries,
      includeSeries: false,
    })
    log('收益表（+1 档）:')
    for (const row of [...table.rows].sort((a, b) => b.percentDelta - a.percentDelta)) {
      log(`  ${row.label.padEnd(16)} Δ=${row.damageDelta.toFixed(1)}  ${pct(row.percentDelta)}  w=${row.weight.toFixed(3)}`)
    }
  }

  report('有流程 hits（缺失技能组后剩下的）', flow.hits)
  report('无 hits（面板口径，通用 skillContext，招式限定 40% 减防不应生效）', undefined)
}

fs.writeFileSync(artifactPath('probe-affix-defense-pen.txt'), `${out.join('\n')}\n`, 'utf8')
log('')
log('已写入', artifactPath('probe-affix-defense-pen.txt'))
