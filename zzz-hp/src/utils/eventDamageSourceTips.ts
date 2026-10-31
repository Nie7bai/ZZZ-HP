import { buildSkillCalcZoneRows, type SkillCalcZoneRow } from '@/utils/skillCalcZones'
import type { SkillFlowCalculationDetail } from '@/utils/skillFlowCalculation'
import type { EventDamageInputUsage, BuffModSource } from '@/utils/panelBuffCalc'
import { createEmptyBuffStatModifiers } from '@/utils/calculatorUi'
import { createEmptyExternalPanel, type PanelStats } from '@/types/calculatorPanel'
import { buildSkillBaseMultNote } from '@/utils/skillTalentLevels'
import { buildAtkPanelProcessItems, buildDefPanelProcessItems, buildEnemyCombatProcessItems, buildStatSourceGroups, type StatSourceGroup } from '@/utils/statSourceTips'
import { buildDefenseZoneFormulaItems, buildDefenseZoneSourceGroups, buildMutationZoneTipGroups, buildPierceDmgZoneProcessItems, buildRemielSelfAtkTipGroups, buildRemielSelfMasteryTipGroups, buildRemielSpecialLevelZoneGroups, buildRemielStandardLevelZoneGroups, buildResistanceZoneProcessItems, buildSharpenDmgZoneProcessItems } from '@/utils/zoneSourceTips'
import { formatCalcDecimal } from '@/utils/calcNumberFormat'
import { resolveAnomalyBaseWithMutation } from '@/utils/anomalyFormulaDisplay'
import { buildDirectDamageExpectedProcessItems, buildSharpenCritZoneLines, formatDirectDmgMultZoneFormula, formatSettlementDmgMultZoneFormula } from '@/utils/directDamageDisplay'
import { normalizeDamageEnemyInput, resolveEnemyResistanceForElement } from '@/utils/enemyResistance'

export type ValueTipsKey =
  | 'baseDamage'
  | 'dmgMultiplier'
  | 'defenseMultiplier'
  | 'resistanceMultiplier'
  | 'vulnerableMultiplier'
  | 'directVulnerableMultiplier'
  | 'anomalyVulnerableMultiplier'
  | 'staggerMultiplier'
  | 'generalMultiplier'
  | 'critRateRatio'
  | 'critMultiplier'
  | 'specialMultiplier'
  | 'specialMultZone'
  | 'directDmgMultZone'
  | 'settlementDmgMultZone'
  | 'penRateRatio'
  | 'effectiveDefense'
  | 'piercePower'
  | 'directDamageExpected'
  | 'masteryZone'
  | 'levelZone'
  | 'anomalyBaseExpected'
  | 'attributeAnomalyDmgBonusZone'
  | 'attributeAnomalyMultZone'
  | 'attributeAnomalyCritZone'
  | 'anomalyReleaseDmgBonusZone'
  | 'anomalyReleaseMultZone'
  // 「异常综合暴击区」已删除 → 异放用自己的暴击区（用户 2026-10-16）
  | 'anomalyReleaseCritZone'
  | 'disorderBaseMult'
  | 'anomalyDuration'
  | 'disorderCompMult'
  | 'disorderDmgBonusZone'
  | 'disorderZone'
  // 紊乱只吃自己的暴击字段（紊乱暴击率/爆伤），与乱流同构
  | 'disorderCritZone'
  | 'disorderExpected'
  | 'turbulenceBaseMult'
  | 'turbulenceCompMult'
  | 'turbulenceDmgBonusZone'
  | 'turbulenceZone'
  | 'turbulenceDmgBonusZone'
  // 乱流只吃自己的暴击字段（用户 2026-10-16）；此前这里错用了异常暴击区
  | 'turbulenceCritZone'
  | 'turbulenceExpected'
  | 'attributeAnomalyExpected'
  | 'anomalyReleaseExpected'
  | 'radianceExpected'
  | 'radianceMutation'
  | 'radianceDmgBonusZone'
  | 'radianceMultZone'
  // 耀变只吃自己的暴击字段（耀变暴击率/爆伤）
  | 'radianceCritZone'
  | 'mutationZone'
  | 'pierceDmgMultiplier'
  | 'sharpenDmgMultiplier'
  | 'remielSelfInCombatAtk'
  | 'remielSelfInCombatMasteryZone'
  | 'remielSelfSpecialLevelZone'
  | 'remielSelfStandardLevelZone'
  | 'remielSelfDefenseMultiplier'
  | 'remielSelfResistanceMultiplier'

function formatNumber(v: number) {
  return Math.round(v).toLocaleString('en-US')
}

function formatFormulaNumber(v: number, precision = 4) {
  // 乘区统一按指定精度展示；大数不再压成 2 位，避免手算与结果对不上
  if (!Number.isFinite(v)) return String(v)
  if (Number.isInteger(v) && Math.abs(v) < 1000) {
    return v.toLocaleString('en-US')
  }
  return formatCalcDecimal(v, precision)
}


function withTotal(groups: StatSourceGroup[], totalText: string, processItems?: string[]): StatSourceGroup[] {
  const result = [...groups]
  if (processItems?.length) {
    result.push({ label: '加减过程', items: processItems, fullWidth: true })
  }
  if (!result.length) {
    return [{ label: '合计', items: [totalText] }]
  }
  return [...result, { label: '合计', items: [totalText], fullWidth: true }]
}

/** 只投影本次正式采用、视图快照和逐效果增量；不重算或重新匹配 Buff。 */
export function buildEventValueTips(calculation: SkillFlowCalculationDetail): Record<ValueTipsKey, StatSourceGroup[]> {
  const d = calculation.evaluation
  /** 异常类伤害：防御区的穿透与减防分别来自两个固定身份，不再用面板名标注 */
  const anomalyLine = d.kind !== 'direct' && d.kind !== 'sharpen'
  if (!d.damageInputUsages || !d.effectRecords || !d.viewSnapshots) throw new Error('Incomplete event source contract')
  // 间接来源记录解释转模基数，不作为伤害公式直接读取的面板字段。
  const usages = d.damageInputUsages.filter(usage => usage.usedView !== 'convertSourcePanel')
  const records = d.effectRecords
  const views = d.viewSnapshots
  for (const usage of d.damageInputUsages) if (!views[usage.viewKey]) throw new Error('Missing event view: ' + usage.viewKey)
  for (const record of records) if (record.convertBase?.sourceViewKey && !views[record.convertBase.sourceViewKey]) throw new Error('Missing conversion source view')
  const identity = (u: EventDamageInputUsage) => [u.viewKey,u.inputKey,u.field,u.resultKey].join('|')
  function project(selected: EventDamageInputUsage[]) {
    const selectedKeys = new Set(selected.map(identity))
    let panel = createEmptyExternalPanel(), external = createEmptyExternalPanel()
    let first = true
    for (const usage of selected) {
      const view = views[usage.viewKey]!
      if (first) { panel = { ...view.panel }; external = { ...view.externalPanel }; first = false }
      const field = usage.field === 'inCombatAtk' ? 'atk' : usage.field === 'inCombatMastery' ? 'mastery' : usage.field
      if (field in view.panel) {
        panel = { ...panel, [field]: view.panel[field as keyof PanelStats] }
        external = { ...external, [field]: view.externalPanel[field as keyof PanelStats] }
      }
    }
    const sources: BuffModSource[] = records.filter(record => record.usedInputs.some(u => selectedKeys.has(identity(u)))).map(record => {
      const mods = createEmptyBuffStatModifiers()
      mods[record.stat] = record.amount
      const original = views[record.viewKey]?.sources.find(source => source.effects?.some(effect => effect.id === record.effectId))
      return { key: record.viewKey+'|'+record.effectId, label: original?.label ?? record.providerName,
        mods, note: original?.note, effects: original?.effects?.filter(effect => effect.id === record.effectId) }
    })
    return { panel, external, sources }
  }
  const specialMult = project(usages.filter(u => u.field === 'specialMult' || u.field === 'specialMultFactor'))
  const owner = project(usages.filter(u => u.inputKey === 'finalPanel' || String(u.inputKey).startsWith('combat') || u.inputKey === 'piercePower'))
  // 展示字段按实际使用记录投影；同一角色可复用输入身份，不能把输入键当作独立角色存在的证明。
  const baseUsages = usages.filter(u => (u.field === 'atk' || u.field === 'hp' || u.field === 'def') &&
    (u.resultKey === 'baseDamage' || u.resultKey === 'anomalyBaseExpected'))
  const base = project(usages.filter(u => u.inputKey !== 'remielSelfRadianceCalc' && u.inputKey !== 'mutationZone'))
  const bonus = project(usages.filter(u => /^(attributeAnomaly|anomalyRelease|disorder|turbulence|radiance)(DmgBonus|CritRate|CritDmg|Mult|MultFactor)$/.test(String(u.field))))
  const multUsages = usages.filter(u => /^(disorder|turbulence)(BaseMult|CompMult|BaseMultFactor)$/.test(String(u.field)) || u.field === 'anomalyDuration')
  const mult = project(multUsages)
  const defenseUsages = usages.filter(u => u.field === 'ignoreDefense' || u.field === 'reduceDefense')
  const penUsages = usages.filter(u => u.field === 'penRate' || u.field === 'pen')
  const defense = project(defenseUsages)
  const viewLabels: Record<string, string> = { ownerPanel:'持有者面板',powerProviderPanel:'异常强度提供者',anomalyTriggerPanel:'异常类触发者',radianceSelfPanel:'本人耀变面板',mutationPanel:'异化面板',releaseMult:'异放倍率',convertSourcePanel:'转模来源面板' }
  const actualViewLabel = (selected: EventDamageInputUsage[]) => [...new Set(selected.map(u => viewLabels[u.usedView] ?? '正式采用面板'))].join('、') || '正式采用面板'
  const splitDefenseSources = new Set([...penUsages,...defenseUsages].map(u => u.viewKey)).size > 1
  const resistance = project(usages.filter(u => u.field === 'resPen' && u.resultKey === 'resistanceMultiplier'))
  const self = project(usages.filter(u => u.inputKey === 'remielSelfRadianceCalc'))
  const mutation = project(usages.filter(u => u.inputKey === 'mutationZone'))
  const props = {
    calcParts: d.result, enemyInput: calculation.enemyInput, isMb: calculation.isMb,
    show: d.kind === 'direct' || d.kind === 'sharpen' ? 'direct' : 'anomaly',
    piercePower: d.piercePower, producerAgentLabel: d.producerAgentLabel,
    mutationAgentLabel: d.mutationAgentLabel, mutationExternalPanel: mutation.external,
    mutationFinalPanel: mutation.panel, mutationSources: mutation.sources,
    remielSelfAtkSourceItems: self.sources.filter(source => source.mods.atk).map(source => source.label+' 攻击力 '+source.mods.atk),
    remielSelfMasterySourceItems: self.sources.filter(source => source.mods.mastery).map(source => source.label+' 精通 '+source.mods.mastery),
    remielIsMb: d.remielIsMb, skillMultLevelNote: buildSkillBaseMultNote(d.hit.skill,d.hit.skillTalentLevel),
  }
  const p = d.result
  const sub = d.anomalySubKind
  const ownerPanel = owner.panel, ownerExternal = owner.external, ownerSources = owner.sources
  const panel = base.panel, external = base.external, sources = base.sources
  const pierceMod = d.breakdown.totalMods.pierce
  const enemy = calculation.enemyInput
  const resistanceView = resistance
  const multPanel = mult.panel, multExternal = mult.external, multSources = mult.sources
  const usesProducerBase = baseUsages.some(u => u.usedView === 'powerProviderPanel')
  const usesProducerMult = multUsages.some(u => u.usedView === 'powerProviderPanel')
  const producerExtraGroup = usesProducerBase ? [{ label: d.producerAgentLabel ?? '正式采用面板', items: ['本条来源按正式采用的字段及视图列出。'] }] : []
  const bonusPanel = bonus.panel, bonusExternal = bonus.external, bonusSources = bonus.sources
  const defTrigPanel = defense.panel, defTrigExternal = defense.external, defTrigSources = defense.sources
  const defTrigLabel = actualViewLabel(defenseUsages)
  const remielSelfActive = usages.some(u => u.inputKey === 'remielSelfRadianceCalc')
  const remielExt = self.external, remielPanelForSelf = self.panel, remielSourcesForSelf = self.sources
  const remielResPenTotal = resistance.panel.resPen + self.panel.radianceResPen
  const remielEnemyRes = remielSelfActive && p.remielSelfResistanceElement
    ? resolveEnemyResistanceForElement(normalizeDamageEnemyInput(calculation.enemyInput),p.remielSelfResistanceElement) : 0
  const displayVulnerableMultiplier = props.show === 'anomaly' ? p.anomalyVulnerableMultiplier : p.directVulnerableMultiplier
const generalFormulaParts = (() => {
  const p = props.calcParts
  return [
    formatFormulaNumber(p.baseDamage, 2),
    formatFormulaNumber(p.dmgMultiplier),
    formatFormulaNumber(p.defenseMultiplier),
    formatFormulaNumber(p.resistanceMultiplier),
    formatFormulaNumber(p.staggerMultiplier),
  ]
})()


const directFormulaParts = (() => {
  const p = props.calcParts
  const parts = [
    formatFormulaNumber(p.generalMultiplier, 2),
    formatFormulaNumber(p.directVulnerableMultiplier),
    formatFormulaNumber(p.critMultiplier),
    formatFormulaNumber(p.specialMultiplier),
  ]
  if (p.baseDamageSource === 'pierce') {
    parts.push(formatFormulaNumber(p.pierceDmgMultiplier))
  }
  parts.push(formatFormulaNumber(p.directDmgMultZone))
  return parts
})()

const anomalyFormulaParts = (() => {
  const p = props.calcParts
  if (p.remielSelfRadianceActive) {
    return [
      formatFormulaNumber(p.remielSelfInCombatAtk ?? 0, 4),
      formatFormulaNumber(p.remielSelfInCombatMasteryZone ?? 0),
      formatFormulaNumber(p.remielSelfSpecialLevelZone ?? 1),
      formatFormulaNumber(p.remielSelfMutationZone ?? p.mutationZone),
      formatFormulaNumber(p.remielSelfStandardLevelZone ?? 1),
    ]
  }
  return [
    formatFormulaNumber(p.generalMultiplier, 2),
    formatFormulaNumber(p.anomalyVulnerableMultiplier),
    formatFormulaNumber(p.masteryZone),
    formatFormulaNumber(p.levelZone),
    formatFormulaNumber(p.specialMultiplier),
  ]
})()

const anomalyBaseWithMutation = resolveAnomalyBaseWithMutation(props.calcParts)

const anomalyExpectedFormulaParts = (() => {
  const p = props.calcParts
  return [
    formatNumber(anomalyBaseWithMutation),
    formatFormulaNumber(p.attributeAnomalyDmgBonusZone),
    formatFormulaNumber(p.attributeAnomalyMultZone),
    formatFormulaNumber(p.attributeAnomalyCritZone),
  ]
})()

const disorderFormulaParts = (() => {
  const p = props.calcParts
  return [
    formatNumber(anomalyBaseWithMutation),
    formatFormulaNumber(p.disorderZone),
    formatFormulaNumber(p.disorderDmgBonusZone),
    // 紊乱补暴击区后，加减过程必须把暴击区乘进去，否则乘式不等于期望值
    formatFormulaNumber(p.disorderCritZone),
  ]
})()

  const atkGroups = buildStatSourceGroups({
    keys: ['inCombatAtkPercent', 'atk'],
    externalPanel: external,
    sources,
    externalKeyMap: { inCombatAtkPercent: null, atk: null },
    extraGroups: external.atk
      ? [{ label: '局外面板', items: [`攻击力 ${formatFormulaNumber(external.atk, 2)}`] }]
      : [],
  })

  const hpGroups = buildStatSourceGroups({
    keys: ['inCombatHpPercent'],
    externalPanel: external,
    sources,
    externalKeyMap: { inCombatHpPercent: null },
    extraGroups: external.hp
      ? [{ label: '局外面板', items: [`生命值 ${formatFormulaNumber(external.hp, 2)}`] }]
      : [],
  })

  const pierceGroups = buildStatSourceGroups({
    keys: ['pierce'],
    externalPanel: external,
    sources,
    externalKeyMap: { pierce: null },
  })

  const defGroups = buildStatSourceGroups({
    keys: ['inCombatDefPercent', 'def'],
    externalPanel: external,
    sources,
    externalKeyMap: { inCombatDefPercent: null, def: null },
    extraGroups: external.def
      ? [{ label: '局外面板', items: [`防御力 ${formatFormulaNumber(external.def, 2)}`] }]
      : [],
  })

  const atkProcessItems = buildAtkPanelProcessItems({
    externalAtk: external.atk,
    finalAtk: panel.atk,
    sources,
  })

  const defProcessItems = buildDefPanelProcessItems({
    externalDef: external.def,
    finalDef: panel.def,
    sources,
  })

  const pierceBaseDamageTips = withTotal(
    [
      ...hpGroups.map((group) => ({
        ...group,
        items: group.items.map((item) => `生命：${item}`),
      })),
      ...atkGroups.map((group) => ({
        ...group,
        items: group.items.map((item) => `攻击：${item}`),
      })),
      ...pierceGroups,
    ],
    `贯穿力 ${formatFormulaNumber(props.piercePower, 2)} = 0.1×${formatFormulaNumber(panel.hp, 2)} + 0.3×${formatFormulaNumber(panel.atk, 2)} + ${formatFormulaNumber(pierceMod, 2)}`,
    [
      ...(atkProcessItems.length ? ['攻击力：', ...atkProcessItems] : []),
      `贯穿力 = 0.1 × ${formatFormulaNumber(panel.hp, 2)} + 0.3 × ${formatFormulaNumber(panel.atk, 2)} + ${formatFormulaNumber(pierceMod, 2)} = ${formatFormulaNumber(props.piercePower, 2)}`,
    ],
  )

  return {
    baseDamage:
      p.baseDamageSource === 'atk'
        ? withTotal(
            atkGroups,
            `局内攻击力 ${formatFormulaNumber(panel.atk, 2)}`,
            atkProcessItems,
          )
        : p.baseDamageSource === 'def'
          ? withTotal(
              defGroups,
              `局内防御力 ${formatFormulaNumber(panel.def, 2)}`,
              defProcessItems,
            )
          : pierceBaseDamageTips,
    dmgMultiplier: (() => {
      const skillBonus = sources.reduce((sum, s) => sum + (s.mods.skillDmgBonus ?? 0), 0)
      const generalBonus = panel.dmgBonus - skillBonus
      const generalGroups = buildStatSourceGroups({
        keys: ['dmgBonus'],
        externalPanel: external,
        sources,
        finalValues: { dmgBonus: generalBonus },
      }).map((group) => ({
        ...group,
        label: skillBonus ? `通用 · ${group.label}` : group.label,
      }))
      const skillGroups = skillBonus
        ? buildStatSourceGroups({
            keys: ['skillDmgBonus'],
            externalPanel: external,
            sources,
            finalValues: { skillDmgBonus: skillBonus },
          }).map((group) => ({
            ...group,
            label: `招式 · ${group.label}`,
          }))
        : []
      return withTotal(
        [...generalGroups, ...skillGroups],
        skillBonus
          ? `增伤区 1 + ${formatFormulaNumber(generalBonus, 2)}% + ${formatFormulaNumber(skillBonus, 2)}% = ${formatFormulaNumber(p.dmgMultiplier)}`
          : `局内增伤 ${formatFormulaNumber(panel.dmgBonus, 2)}% → 增伤区 1 + ${formatFormulaNumber(panel.dmgBonus, 2)}% = ${formatFormulaNumber(p.dmgMultiplier)}`,
      )
    })(),
    defenseMultiplier: buildDefenseZoneSourceGroups({
      enemyDefense: enemy.defense,
      penRatePanel: panel,
      penRateExternal: external,
      penRateSources: sources,
      defCutPanel: defTrigPanel,
      defCutExternal: defTrigExternal,
      defCutSources: defTrigSources,
      // 异常类：穿透率/穿透值取异常强度提供者，减防/无视防御取异常类触发者；
      // 直伤没有这两个身份，仍按实际采用的面板标注。
      defCutLabel: anomalyLine ? '异常类触发者' : defTrigLabel,
      splitDefCut: splitDefenseSources,
      isMb: props.isMb,
      mbLabel: '命破招式持有者',
      penRateRole: anomalyLine ? '异常强度提供者' : actualViewLabel(penUsages),
      defCutRole: anomalyLine ? '异常类触发者' : actualViewLabel(defenseUsages),
    }),
    resistanceMultiplier: withTotal(
      [
        {
          label: '敌方与环境',
          items: [`敌方抗性 ${formatFormulaNumber(p.enemyResistance)}`],
        },
        ...buildStatSourceGroups({
          keys: ['resPen'],
          externalPanel: resistanceView.external,
          sources: resistanceView.sources,
          finalValues: { resPen: resistanceView.panel.resPen },
        }),
      ],
      `抗性区 1 - ${formatFormulaNumber(p.enemyResistance)} + ${formatFormulaNumber(resistanceView.panel.resPen, 2)}% = ${formatFormulaNumber(p.resistanceMultiplier)}`,
      buildResistanceZoneProcessItems({
        enemyResistance: p.enemyResistance,
        resPen: resistanceView.panel.resPen,
        zone: p.resistanceMultiplier,
      }),
    ),
    vulnerableMultiplier: withTotal(
      [
        {
          label: '敌方与环境',
          items: [`易伤基础 ${formatFormulaNumber(enemy.vulnerableMultiplier)}`],
        },
        ...buildStatSourceGroups({
          keys:
            props.show === 'anomaly'
              ? ['vulnerable', 'anomalyVulnerable', 'dmgReduction', 'anomalyDmgReduction']
              : ['vulnerable', 'directVulnerable', 'dmgReduction', 'directDmgReduction'],
          externalPanel: ownerExternal,
          sources: ownerSources,
          externalKeyMap: {
            vulnerable: null,
            directVulnerable: null,
            anomalyVulnerable: null,
            dmgReduction: null,
            directDmgReduction: null,
            anomalyDmgReduction: null,
          },
          showAdditiveProcess: false,
        }),
      ],
      `易伤区 ${formatFormulaNumber(displayVulnerableMultiplier)}`,
      buildEnemyCombatProcessItems({
        baseLabel: '易伤基础',
        baseValue: enemy.vulnerableMultiplier,
        sources: ownerSources,
        buffKeys:
          props.show === 'anomaly'
            ? ['vulnerable', 'anomalyVulnerable']
            : ['vulnerable', 'directVulnerable'],
        subtractKeys:
          props.show === 'anomaly'
            ? ['dmgReduction', 'anomalyDmgReduction']
            : ['dmgReduction', 'directDmgReduction'],
        finalValue: displayVulnerableMultiplier,
        resultLabel: props.show === 'anomaly' ? '非直伤易伤区' : '直伤易伤区',
      }),
    ),
    directVulnerableMultiplier: withTotal(
      [
        {
          label: '敌方与环境',
          items: [`易伤基础 ${formatFormulaNumber(enemy.vulnerableMultiplier)}`],
        },
        ...buildStatSourceGroups({
          keys: ['vulnerable', 'directVulnerable', 'dmgReduction', 'directDmgReduction'],
          externalPanel: ownerExternal,
          sources: ownerSources,
          externalKeyMap: {
            vulnerable: null,
            directVulnerable: null,
            dmgReduction: null,
            directDmgReduction: null,
          },
          showAdditiveProcess: false,
        }),
      ],
      `直伤易伤区 ${formatFormulaNumber(p.directVulnerableMultiplier)}`,
      buildEnemyCombatProcessItems({
        baseLabel: '易伤基础',
        baseValue: enemy.vulnerableMultiplier,
        sources: ownerSources,
        buffKeys: ['vulnerable', 'directVulnerable'],
        subtractKeys: ['dmgReduction', 'directDmgReduction'],
        finalValue: p.directVulnerableMultiplier,
        resultLabel: '直伤易伤区',
      }),
    ),
    anomalyVulnerableMultiplier: withTotal(
      [
        {
          label: '敌方与环境',
          items: [`易伤基础 ${formatFormulaNumber(enemy.vulnerableMultiplier)}`],
        },
        ...buildStatSourceGroups({
          keys: ['vulnerable', 'anomalyVulnerable', 'dmgReduction', 'anomalyDmgReduction'],
          externalPanel: ownerExternal,
          sources: ownerSources,
          externalKeyMap: {
            vulnerable: null,
            anomalyVulnerable: null,
            dmgReduction: null,
            anomalyDmgReduction: null,
          },
          showAdditiveProcess: false,
        }),
      ],
      `非直伤易伤区 ${formatFormulaNumber(p.anomalyVulnerableMultiplier)}`,
      buildEnemyCombatProcessItems({
        baseLabel: '易伤基础',
        baseValue: enemy.vulnerableMultiplier,
        sources: ownerSources,
        buffKeys: ['vulnerable', 'anomalyVulnerable'],
        subtractKeys: ['dmgReduction', 'anomalyDmgReduction'],
        finalValue: p.anomalyVulnerableMultiplier,
        resultLabel: '非直伤易伤区',
      }),
    ),
    staggerMultiplier: withTotal(
      [
        {
          label: '敌方与环境',
          items: [`失衡易伤基础 ${formatFormulaNumber(enemy.staggerMultiplier)}`],
        },
        ...buildStatSourceGroups({
          keys: ['globalStaggerVulnerable', 'staggerVulnerable', 'staggerVulnerableOnly'],
          externalPanel: ownerExternal,
          sources: ownerSources,
          externalKeyMap: {
            globalStaggerVulnerable: null,
            staggerVulnerable: null,
            staggerVulnerableOnly: null,
          },
          showAdditiveProcess: false,
        }),
      ],
      `失衡易伤区 ${formatFormulaNumber(p.staggerMultiplier)}`,
      buildEnemyCombatProcessItems({
        baseLabel: '失衡易伤基础',
        baseValue: enemy.staggerMultiplier,
        sources: ownerSources,
        buffKeys: ['globalStaggerVulnerable', 'staggerVulnerable', 'staggerVulnerableOnly'],
        finalValue: p.staggerMultiplier,
        resultLabel: '失衡易伤区',
      }),
    ),
    generalMultiplier: [
      {
        label: '乘区组成',
        items: [
          `基础伤害 ${generalFormulaParts[0]}`,
          `增伤区 ${generalFormulaParts[1]}`,
          `防御区 ${generalFormulaParts[2]}`,
          `抗性区 ${generalFormulaParts[3]}`,
          `失衡易伤区 ${generalFormulaParts[4]}`,
          `合计 ${formatFormulaNumber(p.generalMultiplier, 2)}（不含易伤区）`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `${generalFormulaParts[0]} × ${generalFormulaParts[1]} × ${generalFormulaParts[2]} × ${generalFormulaParts[3]} × ${generalFormulaParts[4]}`,
          `= ${formatFormulaNumber(p.generalMultiplier, 2)}`,
        ],
      },
    ],
    critRateRatio: withTotal(
      buildStatSourceGroups({
        keys: ['critRate'],
        externalPanel: external,
        sources,
        finalValues: { critRate: panel.critRate },
      }),
      `局内暴击 ${formatFormulaNumber(panel.critRate, 2)}% = ${formatFormulaNumber(p.critRateRatio)}（计入上限）`,
    ),
    critMultiplier: withTotal(
      p.useSharpenFormula
        ? [
            // 锐爆区口径与常规暴击区不同：不用常规暴伤，改用锐爆伤害加成
            ...buildStatSourceGroups({
              keys: ['critRate'],
              externalPanel: external,
              sources,
              finalValues: { critRate: panel.critRate },
            }),
            ...buildStatSourceGroups({
              keys: ['sharpenCritDmgBonus'],
              externalPanel: external,
              sources,
              externalKeyMap: { sharpenCritDmgBonus: null },
            }),
            {
              label: '锐爆区计算过程',
              items: buildSharpenCritZoneLines(p, formatFormulaNumber),
            },
          ]
        : buildStatSourceGroups({
            keys: ['critRate', 'critDmg'],
            externalPanel: external,
            sources,
            finalValues: { critRate: panel.critRate, critDmg: panel.critDmg },
          }),
      p.useSharpenFormula
        ? `锐爆区 = ${formatFormulaNumber(p.critMultiplier)}（B = ${formatFormulaNumber(p.sharpenCritDmgRatio, 4)}，暴击率上限 200%，不乘常规暴伤）`
        : `暴击区 1 + ${formatFormulaNumber(p.critRateRatio)} × ${formatFormulaNumber(p.critDmgRatio)} = ${formatFormulaNumber(p.critMultiplier)}`,
    ),
    specialMultZone: withTotal(
      buildStatSourceGroups({keys:['specialMult','specialMultFactor'],externalPanel:specialMult.external,sources:specialMult.sources,
        finalValues:{specialMult:specialMult.panel.specialMult,specialMultFactor:specialMult.panel.specialMultFactor}}),
      '特殊倍率乘区 '+formatFormulaNumber(p.specialMultZone),
    ),
    specialMultiplier: withTotal(
      [
        {
          label: '敌方与环境',
          items: [`特殊乘区基础 ${formatFormulaNumber(enemy.specialMultiplier)}`],
        },
        ...buildStatSourceGroups({
          keys: ['special'],
          externalPanel: ownerExternal,
          sources: ownerSources,
          externalKeyMap: { special: null },
          showAdditiveProcess: false,
        }),
      ],
      `特殊乘区 ${formatFormulaNumber(p.specialMultiplier)}`,
      buildEnemyCombatProcessItems({
        baseLabel: '特殊乘区基础',
        baseValue: enemy.specialMultiplier,
        sources: ownerSources,
        buffKey: 'special',
        finalValue: p.specialMultiplier,
        resultLabel: '特殊乘区',
      }),
    ),
    pierceDmgMultiplier: withTotal(
      [
        {
          label: '乘区说明',
          items:
            p.baseDamageSource === 'pierce'
              ? ['基础伤害来源为贯穿力，贯穿增伤作为独立乘区生效']
              : ['基础伤害来源非贯穿力，贯穿增伤区固定为 1'],
        },
        ...buildStatSourceGroups({
          keys: ['pierceDmgBonus'],
          externalPanel: external,
          sources,
          externalKeyMap: { pierceDmgBonus: null },
        }),
      ],
      `贯穿增伤区 ${formatFormulaNumber(p.pierceDmgMultiplier)}`,
      buildPierceDmgZoneProcessItems({
        active: p.baseDamageSource === 'pierce',
        bonusPercent: Math.max(0, (p.pierceDmgMultiplier - 1) * 100),
        zone: p.pierceDmgMultiplier,
      }),
    ),
    sharpenDmgMultiplier: withTotal(
      [
        {
          label: '乘区说明',
          items: p.useSharpenFormula
            ? ['锐化路径（锋御职业或招式伤害类型为锐化），锐化伤害提升作为独立乘区生效']
            : ['非锐化路径，锐化伤害提升区固定为 1'],
        },
        ...buildStatSourceGroups({
          keys: ['sharpenDmgBonus'],
          externalPanel: external,
          sources,
          externalKeyMap: { sharpenDmgBonus: null },
        }),
      ],
      `锐化伤害提升区 ${formatFormulaNumber(p.sharpenDmgMultiplier)}`,
      buildSharpenDmgZoneProcessItems({
        active: p.useSharpenFormula,
        bonusPercent: Math.max(0, (p.sharpenDmgMultiplier - 1) * 100),
        zone: p.sharpenDmgMultiplier,
      }),
    ),
    directDmgMultZone: withTotal(
      buildStatSourceGroups({
        keys: ['directDmgMult', 'directDmgMultFactor'],
        externalPanel: external,
        sources,
        finalValues: {
          directDmgMult: panel.directDmgMult,
          directDmgMultFactor: panel.directDmgMultFactor,
        },
      }),
      formatDirectDmgMultZoneFormula(panel, p.directDmgMultZone),
    ),
    settlementDmgMultZone: withTotal(
      buildStatSourceGroups({
        keys: ['settlementDmgMult', 'directDmgMultFactor'],
        externalPanel: external,
        sources,
        finalValues: {
          settlementDmgMult: panel.settlementDmgMult,
          directDmgMultFactor: panel.directDmgMultFactor,
        },
      }),
      formatSettlementDmgMultZoneFormula(panel, p.settlementDmgMultZone),
    ),
    penRateRatio: withTotal(
      buildStatSourceGroups({
        keys: ['penRate'],
        externalPanel: external,
        sources,
        finalValues: { penRate: panel.penRate },
      }),
      `局内穿透率 ${formatFormulaNumber(panel.penRate, 2)}% = ${formatFormulaNumber(p.penRateRatio)}（计入上限）`,
    ),
    effectiveDefense: withTotal(
      buildStatSourceGroups({
        keys: splitDefenseSources ? ['penRate'] : ['reduceDefense', 'penRate'],
        externalPanel: external,
        sources,
        finalValues: splitDefenseSources
          ? { penRate: panel.penRate }
          : { reduceDefense: panel.reduceDefense, penRate: panel.penRate },
        extraGroups: [
          ...(splitDefenseSources
            ? buildStatSourceGroups({
                keys: ['reduceDefense'],
                externalPanel: defTrigExternal,
                sources: defTrigSources,
                finalValues: { reduceDefense: defTrigPanel.reduceDefense },
              })
            : []),
          {
            label: '敌方与环境 / 局外面板',
            items: [
              `敌方防御 ${formatFormulaNumber(enemy.defense, 2)}`,
              `无视防御 ${formatFormulaNumber(defTrigExternal.ignoreDefense, 2)}%（局外，不受增益）`,
              `穿透值 ${formatFormulaNumber(external.pen, 2)}（局外，不受增益）`,
            ],
          },
        ],
      }),
      `有效防御 ${formatFormulaNumber(p.effectiveDefense, 2)}`,
      buildDefenseZoneFormulaItems({
        enemyDefense: enemy.defense,
        ignoreDefense: defTrigPanel.ignoreDefense,
        reduceDefense: defTrigPanel.reduceDefense,
        penRate: panel.penRate,
        pen: external.pen,
        isMb: props.isMb,
        penRateRole: anomalyLine ? '异常强度提供者' : actualViewLabel(penUsages),
        defCutRole: anomalyLine ? '异常类触发者' : actualViewLabel(defenseUsages),
      }),
    ),
    piercePower: withTotal(
      [
        ...hpGroups.map((group) => ({
          ...group,
          items: group.items.map((item) => `生命：${item}`),
        })),
        ...atkGroups.map((group) => ({
          ...group,
          items: group.items.map((item) => `攻击：${item}`),
        })),
        ...pierceGroups,
      ],
      `贯穿力 ${formatFormulaNumber(props.piercePower, 2)} = 0.1×${formatFormulaNumber(panel.hp, 2)} + 0.3×${formatFormulaNumber(panel.atk, 2)} + ${formatFormulaNumber(pierceMod, 2)}`,
      [
        ...(atkProcessItems.length ? ['攻击力：', ...atkProcessItems] : []),
        `贯穿力 = 0.1 × ${formatFormulaNumber(panel.hp, 2)} + 0.3 × ${formatFormulaNumber(panel.atk, 2)} + ${formatFormulaNumber(pierceMod, 2)} = ${formatFormulaNumber(props.piercePower, 2)}`,
      ],
    ),
    directDamageExpected: [
      {
        label: '乘区组成',
        items: [
          `通用乘区 ${directFormulaParts[0]}`,
          `${p.useSharpenFormula ? '锐爆区' : '暴击区'} ${directFormulaParts[1]}`,
          `特殊乘区 ${directFormulaParts[2]}`,
          ...(p.useSharpenFormula
            ? [`锐化伤害提升区 ${formatFormulaNumber(p.sharpenDmgMultiplier)}`]
            : p.baseDamageSource === 'pierce'
              ? [`贯穿增伤区 ${formatFormulaNumber(p.pierceDmgMultiplier)}`]
              : []),
          `直伤倍率区 ${formatFormulaNumber(p.directDmgMultZone)} → 直伤分量 ${formatNumber(p.directDamageFromDirectMult)}`,
          ...(p.settlementDmgMultZone > 0
            ? [
                `决算倍率区 ${formatFormulaNumber(p.settlementDmgMultZone)} → 决算分量 ${formatNumber(p.settlementDamageExpected)}`,
              ]
            : []),
          `合计 ${formatNumber(p.directDamageExpected)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: buildDirectDamageExpectedProcessItems(p, formatFormulaNumber, formatNumber),
      },
    ],
    masteryZone: withTotal(
      buildStatSourceGroups({
        keys: ['mastery'],
        externalPanel: external,
        sources,
        finalValues: { mastery: panel.mastery },
      }),
      `精通区 ${formatFormulaNumber(panel.mastery, 2)} → ${formatFormulaNumber(p.masteryZone)}`,
    ),
    levelZone: [
      {
        // 异常类的等级区与异常基础同属异常强度提供者；直伤仍按实际采用的面板
        label: anomalyLine ? '异常强度提供者' : actualViewLabel(baseUsages),
        items: [
          `角色等级 ${Math.round(p.levelZoneAgentLevel)}`,
          `等级区 ${formatFormulaNumber(p.levelZone)} = 1 + (${Math.round(p.levelZoneAgentLevel)} - 1) / 59`,
        ],
      },
    ],
    attributeAnomalyDmgBonusZone: withTotal(
      buildStatSourceGroups({
        keys: ['attributeAnomalyDmgBonus'],
        externalPanel: bonusExternal,
        sources: bonusSources,
        finalValues: { attributeAnomalyDmgBonus: bonusPanel.attributeAnomalyDmgBonus },
      }),
      `属性异常增伤区 1 + ${formatFormulaNumber(bonusPanel.attributeAnomalyDmgBonus, 2)}% = ${formatFormulaNumber(p.attributeAnomalyDmgBonusZone)}`,
    ),
    attributeAnomalyMultZone: withTotal(
      buildStatSourceGroups({
        keys: ['attributeAnomalyMult', 'attributeAnomalyMultFactor'],
        externalPanel: bonusExternal,
        sources: bonusSources,
        finalValues: {
          attributeAnomalyMult: bonusPanel.attributeAnomalyMult,
          attributeAnomalyMultFactor: bonusPanel.attributeAnomalyMultFactor,
        },
      }),
      `属性异常倍率区 max(0, ${formatFormulaNumber(bonusPanel.attributeAnomalyMult, 2)}%) × 修正 ${formatFormulaNumber(bonusPanel.attributeAnomalyMultFactor ?? 100, 2)}% = ${formatFormulaNumber(p.attributeAnomalyMultZone)}`,
      [
        `加算 ${formatFormulaNumber(bonusPanel.attributeAnomalyMult, 2)}% → ${formatFormulaNumber(Math.max(0, bonusPanel.attributeAnomalyMult / 100))}`,
        `倍率修正 ${formatFormulaNumber(bonusPanel.attributeAnomalyMultFactor ?? 100, 2)}% → ×${formatFormulaNumber((bonusPanel.attributeAnomalyMultFactor ?? 100) / 100)}`,
        `= ${formatFormulaNumber(p.attributeAnomalyMultZone)}`,
      ],
    ),
    anomalyReleaseDmgBonusZone: [
      {
        label: '乘区组成',
        items: [
          `异放增伤区 1 + ${formatFormulaNumber(bonusPanel.anomalyReleaseDmgBonus, 2)}% = ${formatFormulaNumber(p.anomalyReleaseDmgBonusZone)}`,
        ],
      },
      ...buildStatSourceGroups({
        keys: ['anomalyReleaseDmgBonus'],
        externalPanel: bonusExternal,
        sources: bonusSources,
        finalValues: {
          anomalyReleaseDmgBonus: bonusPanel.anomalyReleaseDmgBonus,
        },
      }),
    ],
    anomalyReleaseMultZone: withTotal(
      buildStatSourceGroups({
        keys: ['anomalyReleaseMult', 'anomalyReleaseMultFactor'],
        externalPanel: bonusExternal,
        sources: bonusSources,
        finalValues: {
          anomalyReleaseMult: bonusPanel.anomalyReleaseMult,
          anomalyReleaseMultFactor: bonusPanel.anomalyReleaseMultFactor,
        },
      }),
      `异放倍率区 max(0, ${formatFormulaNumber(bonusPanel.anomalyReleaseMult, 2)}%) × 修正 ${formatFormulaNumber(bonusPanel.anomalyReleaseMultFactor ?? 100, 2)}% = ${formatFormulaNumber(p.anomalyReleaseMultZone)}`,
      [
        `加算 ${formatFormulaNumber(bonusPanel.anomalyReleaseMult, 2)}% → ${formatFormulaNumber(Math.max(0, bonusPanel.anomalyReleaseMult / 100))}`,
        `倍率修正 ${formatFormulaNumber(bonusPanel.anomalyReleaseMultFactor ?? 100, 2)}% → ×${formatFormulaNumber((bonusPanel.anomalyReleaseMultFactor ?? 100) / 100)}`,
        `= ${formatFormulaNumber(p.anomalyReleaseMultZone)}`,
      ],
    ),
    // 「异常综合暴击区」已删除（用户 2026-10-16：暴击按子类拆开，异放只吃自己的暴击字段）
    anomalyReleaseCritZone: withTotal(
      buildStatSourceGroups({
        keys: ['anomalyReleaseCritRate', 'anomalyReleaseCritDmg'],
        externalPanel: bonusExternal,
        sources: bonusSources,
        finalValues: {
          anomalyReleaseCritRate: bonusPanel.anomalyReleaseCritRate,
          anomalyReleaseCritDmg: bonusPanel.anomalyReleaseCritDmg,
        },
      }),
      [
        `暴击率=0：异放暴击区 = 1`,
        `暴击率=1：异放暴击区 = 1 + ${formatFormulaNumber(p.anomalyReleaseCritDmgRatio ?? 0)} = ${formatFormulaNumber(p.anomalyReleaseFullCritZone)}`,
        `实际期望：1 + ${formatFormulaNumber(p.anomalyReleaseCritRateRatio ?? 0)} × ${formatFormulaNumber(p.anomalyReleaseCritDmgRatio ?? 0)} = ${formatFormulaNumber(p.anomalyReleaseCritZone)}`,
      ].join('；'),
    ),
    attributeAnomalyCritZone: withTotal(
      buildStatSourceGroups({
        keys: ['attributeAnomalyCritRate', 'attributeAnomalyCritDmg'],
        externalPanel: bonusExternal,
        sources: bonusSources,
        finalValues: {
          attributeAnomalyCritRate: bonusPanel.attributeAnomalyCritRate,
          attributeAnomalyCritDmg: bonusPanel.attributeAnomalyCritDmg,
        },
      }),
      [
        `暴击率=0：属性异常暴击区 = 1`,
        `暴击率=1：属性异常暴击区 = 1 + ${formatFormulaNumber(p.attributeAnomalyCritDmgRatio)} = ${formatFormulaNumber(p.attributeAnomalyFullCritZone)}`,
        `实际期望：1 + ${formatFormulaNumber(p.attributeAnomalyCritRateRatio)} × ${formatFormulaNumber(p.attributeAnomalyCritDmgRatio)} = ${formatFormulaNumber(p.attributeAnomalyCritZone)}`,
      ].join('；'),
    ),
    anomalyBaseExpected: p.remielSelfRadianceActive
      ? [
          {
            label: '乘区组成（蕾米埃尔异常基础；已含异化系数与双等级区）',
            items: [
              `局内攻击力 ${anomalyFormulaParts[0]}`,
              `局内精通区 ${anomalyFormulaParts[1]}`,
              `特殊等级区 ${anomalyFormulaParts[2]}`,
              `异化系数区 ${anomalyFormulaParts[3]}`,
              `等级区 ${anomalyFormulaParts[4]}`,
              `合计 ${formatNumber(anomalyBaseWithMutation)}`,
            ],
          },
          {
            label: '加减过程',
            fullWidth: true,
            items: [
              anomalyFormulaParts.join(' × '),
              `= ${formatNumber(anomalyBaseWithMutation)}`,
            ],
          },
        ]
      : [
          {
            label: p.mutationZone > 1 ? '乘区组成（含异化系数；不含子类增伤/倍率/暴击）' : '乘区组成（不含子类增伤/倍率/暴击）',
            items: [
              `通用乘区 ${anomalyFormulaParts[0]}`,
              `精通区 ${anomalyFormulaParts[1]}`,
              `等级区 ${anomalyFormulaParts[2]}`,
              ...(p.mutationZone > 1
                ? [`异化系数区 ${formatFormulaNumber(p.mutationZone)}`]
                : []),
              `合计 ${formatNumber(anomalyBaseWithMutation)}`,
            ],
          },
          {
            label: '加减过程',
            fullWidth: true,
            items: [
              [
                ...anomalyFormulaParts,
                ...(p.mutationZone > 1 ? [formatFormulaNumber(p.mutationZone)] : []),
              ].join(' × '),
              `= ${formatNumber(anomalyBaseWithMutation)}`,
            ],
          },
        ],
    remielSelfInCombatAtk: p.remielSelfRadianceActive
      ? buildRemielSelfAtkTipGroups({
          externalAtk: remielExt.atk,
          inCombatAtk: p.remielSelfInCombatAtk ?? 0,
          sourceItems: props.remielSelfAtkSourceItems ?? [],
          fullPanelAtk: remielPanelForSelf.atk,
        })
      : [],
    remielSelfInCombatMasteryZone: p.remielSelfRadianceActive
      ? buildRemielSelfMasteryTipGroups({
          externalMastery: remielExt.mastery,
          inCombatMasteryZone: p.remielSelfInCombatMasteryZone ?? 0,
          sourceItems: props.remielSelfMasterySourceItems ?? [],
          fullPanelMastery: remielPanelForSelf.mastery,
        })
      : [],
    remielSelfSpecialLevelZone: p.remielSelfRadianceActive
      ? buildRemielSpecialLevelZoneGroups(p.levelZoneAgentLevel, p.remielSelfSpecialLevelZone)
      : [],
    remielSelfStandardLevelZone: p.remielSelfRadianceActive
      ? buildRemielStandardLevelZoneGroups(p.levelZoneAgentLevel, p.remielSelfStandardLevelZone)
      : [],
    attributeAnomalyExpected: [
      {
        label: '乘区组成（含属性异常增伤/倍率/暴击）',
        items: [
          `异常基础期望 ${anomalyExpectedFormulaParts[0]}`,
          `属性异常增伤区 ${anomalyExpectedFormulaParts[1]}`,
          `属性异常倍率区 ${anomalyExpectedFormulaParts[2]}`,
          `属性异常暴击区（暴击率=0）1 → ${formatNumber(p.attributeAnomalyExpectedNoCrit)}`,
          `属性异常暴击区（暴击率=1）${formatFormulaNumber(p.attributeAnomalyFullCritZone)} → ${formatNumber(p.attributeAnomalyExpectedFullCrit)}`,
        ],
      },
    ],
    disorderBaseMult: withTotal(
      [
        ...producerExtraGroup,
        ...buildStatSourceGroups({
          keys: ['disorderBaseMult'],
          externalPanel: multExternal,
          sources: multSources,
          finalValues: { disorderBaseMult: multPanel.disorderBaseMult },
        }),
      ],
      `紊乱基础倍率 ${formatFormulaNumber(multPanel.disorderBaseMult, 2)}% = ${formatFormulaNumber(p.disorderBaseMultRatio)}`,
    ),
    anomalyDuration: withTotal(
      [
        ...producerExtraGroup,
        ...buildStatSourceGroups({
          keys: ['anomalyDuration'],
          externalPanel: multExternal,
          sources: multSources,
          finalValues: { anomalyDuration: multPanel.anomalyDuration },
        }),
      ],
      `异常持续时间 ${formatFormulaNumber(multPanel.anomalyDuration, 2)}s → 有效 ${formatFormulaNumber(p.effectiveAnomalyDuration)}s`,
      [
        `面板持续时间 ${formatFormulaNumber(multPanel.anomalyDuration, 2)}s（${actualViewLabel(multUsages.filter(u => u.field === 'anomalyDuration'))}）`,
        Math.abs(p.effectiveAnomalyDuration - multPanel.anomalyDuration) > 1e-6
          ? `火/以太：有效时间 = 面板 / 0.5（×2）→ ${formatFormulaNumber(p.effectiveAnomalyDuration)}s`
          : `有效时间 = 面板 → ${formatFormulaNumber(p.effectiveAnomalyDuration)}s`,
      ],
    ),
    disorderCompMult: withTotal(
      [
        ...producerExtraGroup,
        ...buildStatSourceGroups({
          keys: ['disorderCompMult'],
          externalPanel: multExternal,
          sources: multSources,
          finalValues: { disorderCompMult: multPanel.disorderCompMult },
        }),
      ],
      `紊乱补偿倍率 ${formatFormulaNumber(multPanel.disorderCompMult, 2)}% = ${formatFormulaNumber(p.disorderCompMultRatio)}`,
    ),
    disorderDmgBonusZone: withTotal(
      buildStatSourceGroups({
        keys: ['disorderDmgBonus'],
        externalPanel: bonusExternal,
        sources: bonusSources,
        finalValues: { disorderDmgBonus: bonusPanel.disorderDmgBonus },
      }),
      `紊乱增伤区 1 + ${formatFormulaNumber(bonusPanel.disorderDmgBonus, 2)}% = ${formatFormulaNumber(p.disorderDmgBonusZone)}`,
    ),
    disorderZone: [
      ...(producerExtraGroup.length ? producerExtraGroup : []),
      {
        label: '乘区组成',
        items: [
          `紊乱基础倍率 ${formatFormulaNumber(p.disorderBaseMultRatio)}`,
          `有效异常持续时间 ${formatFormulaNumber(p.effectiveAnomalyDuration)}`,
          `紊乱补偿倍率 ${formatFormulaNumber(p.disorderCompMultRatio)}`,
          `倍率修正 ${formatFormulaNumber(p.disorderMultFactor * 100, 2)}% → ×${formatFormulaNumber(p.disorderMultFactor)}`,
          `紊乱倍率区 = (基础 + 时间 × 补偿) × 修正 = ${formatFormulaNumber(p.disorderZone)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `基础 ${formatFormulaNumber(p.disorderBaseMultRatio)}`,
          `时间项 ${formatFormulaNumber(p.effectiveAnomalyDuration)} × ${formatFormulaNumber(p.disorderCompMultRatio)} = ${formatFormulaNumber(p.effectiveAnomalyDuration * p.disorderCompMultRatio)}`,
          `(${formatFormulaNumber(p.disorderBaseMultRatio)} + ${formatFormulaNumber(p.effectiveAnomalyDuration * p.disorderCompMultRatio)}) × ${formatFormulaNumber(p.disorderMultFactor)} = ${formatFormulaNumber(p.disorderZone)}`,
        ],
      },
    ],
    // 紊乱只吃自己的暴击字段（紊乱暴击率/爆伤），与乱流同构
    disorderCritZone: withTotal(
      buildStatSourceGroups({
        keys: ['disorderCritRate', 'disorderCritDmg'],
        externalPanel: bonusExternal,
        sources: bonusSources,
        finalValues: {
          disorderCritRate: bonusPanel.disorderCritRate,
          disorderCritDmg: bonusPanel.disorderCritDmg,
        },
      }),
      [
        `暴击率=0：紊乱暴击区 = 1`,
        `暴击率=1：紊乱暴击区 = 1 + ${formatFormulaNumber(bonusPanel.disorderCritDmg / 100)} = ${formatFormulaNumber(p.disorderFullCritZone)}`,
        `实际期望：1 + ${formatFormulaNumber(bonusPanel.disorderCritRate / 100)} × ${formatFormulaNumber(bonusPanel.disorderCritDmg / 100)} = ${formatFormulaNumber(p.disorderCritZone)}`,
      ].join('；'),
    ),
    disorderExpected: [
      {
        label: '乘区组成',
        items: [
          `异常基础期望 ${formatNumber(anomalyBaseWithMutation)}`,
          `紊乱倍率区 ${formatFormulaNumber(p.disorderZone)}`,
          `紊乱增伤区 ${formatFormulaNumber(p.disorderDmgBonusZone)}`,
          // 紊乱只吃自己的暴击字段（紊乱暴击率/爆伤），与乱流同构
          `紊乱暴击区（暴击率=0）1 → ${formatNumber(p.disorderExpectedNoCrit)}`,
          `紊乱暴击区（暴击率=1）${formatFormulaNumber(p.disorderFullCritZone)} → ${formatNumber(p.disorderExpectedFullCrit)}`,
          `合计 ${formatNumber(p.disorderExpected)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `${disorderFormulaParts.join(' × ')}`,
          `= ${formatNumber(p.disorderExpected)}`,
        ],
      },
    ],
    turbulenceBaseMult: withTotal(
      [
        ...producerExtraGroup,
        ...buildStatSourceGroups({
          keys: ['turbulenceBaseMult'],
          externalPanel: multExternal,
          sources: multSources,
          finalValues: { turbulenceBaseMult: multPanel.turbulenceBaseMult },
        }),
      ],
      `乱流基础倍率 ${formatFormulaNumber(multPanel.turbulenceBaseMult, 2)}% = ${formatFormulaNumber(p.turbulenceBaseMultRatio)}`,
    ),
    turbulenceCompMult: withTotal(
      [
        ...producerExtraGroup,
        ...buildStatSourceGroups({
          keys: ['turbulenceCompMult'],
          externalPanel: multExternal,
          sources: multSources,
          finalValues: { turbulenceCompMult: multPanel.turbulenceCompMult },
        }),
      ],
      `乱流补偿倍率 ${formatFormulaNumber(multPanel.turbulenceCompMult, 2)}% = ${formatFormulaNumber(p.turbulenceCompMultRatio)}`,
    ),
    turbulenceDmgBonusZone: withTotal(
      buildStatSourceGroups({
        keys: ['turbulenceDmgBonus'],
        externalPanel: bonusExternal,
        sources: bonusSources,
        finalValues: { turbulenceDmgBonus: bonusPanel.turbulenceDmgBonus },
      }),
      `乱流增伤区 1 + ${formatFormulaNumber(bonusPanel.turbulenceDmgBonus, 2)}% = ${formatFormulaNumber(p.turbulenceDmgBonusZone)}`,
    ),
    turbulenceZone: [
      ...(producerExtraGroup.length ? producerExtraGroup : []),
      {
        label: '乘区组成',
        items: [
          `乱流基础倍率 ${formatFormulaNumber(p.turbulenceBaseMultRatio)}`,
          `有效异常持续时间 ${formatFormulaNumber(p.effectiveAnomalyDuration)}`,
          `乱流补偿倍率 ${formatFormulaNumber(p.turbulenceCompMultRatio)}`,
          `倍率修正 ${formatFormulaNumber(p.turbulenceMultFactor * 100, 2)}% → ×${formatFormulaNumber(p.turbulenceMultFactor)}`,
          `乱流倍率区 = (基础 + 时间 × 补偿) × 修正 = ${formatFormulaNumber(p.turbulenceZone)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `基础 ${formatFormulaNumber(p.turbulenceBaseMultRatio)}`,
          `时间项 ${formatFormulaNumber(p.effectiveAnomalyDuration)} × ${formatFormulaNumber(p.turbulenceCompMultRatio)} = ${formatFormulaNumber(p.effectiveAnomalyDuration * p.turbulenceCompMultRatio)}`,
          `(${formatFormulaNumber(p.turbulenceBaseMultRatio)} + ${formatFormulaNumber(p.effectiveAnomalyDuration * p.turbulenceCompMultRatio)}) × ${formatFormulaNumber(p.turbulenceMultFactor)} = ${formatFormulaNumber(p.turbulenceZone)}`,
        ],
      },
    ],
    // 乱流只吃自己的暴击字段（用户 2026-10-16）。此前这里错用异常暴击区 → 配了乱流暴击也显示 1
    turbulenceCritZone: withTotal(
      buildStatSourceGroups({
        keys: ['turbulenceCritRate', 'turbulenceCritDmg'],
        externalPanel: bonusExternal,
        sources: bonusSources,
        finalValues: {
          turbulenceCritRate: bonusPanel.turbulenceCritRate,
          turbulenceCritDmg: bonusPanel.turbulenceCritDmg,
        },
      }),
      [
        `暴击率=0：乱流暴击区 = 1`,
        `暴击率=1：乱流暴击区 = 1 + ${formatFormulaNumber(bonusPanel.turbulenceCritDmg / 100)} = ${formatFormulaNumber(p.turbulenceFullCritZone)}`,
        `实际期望：1 + ${formatFormulaNumber(bonusPanel.turbulenceCritRate / 100)} × ${formatFormulaNumber(bonusPanel.turbulenceCritDmg / 100)} = ${formatFormulaNumber(p.turbulenceCritZone)}`,
      ].join('；'),
    ),
    turbulenceExpected: [
      {
        label: '乘区组成',
        items: [
          `异常基础期望 ${formatNumber(anomalyBaseWithMutation)}`,
          `乱流倍率区 ${formatFormulaNumber(p.turbulenceZone)}`,
          `乱流增伤区 ${formatFormulaNumber(p.turbulenceDmgBonusZone)}`,
          `乱流暴击区（暴击率=0）1 → ${formatNumber(p.turbulenceExpectedNoCrit)}`,
          `乱流暴击区（暴击率=1）${formatFormulaNumber(p.turbulenceFullCritZone)} → ${formatNumber(p.turbulenceExpectedFullCrit)}`,
        ],
      },
    ],
    anomalyReleaseExpected: [
      {
        label: '乘区组成',
        items: [
          `异常基础期望 ${formatNumber(anomalyBaseWithMutation)}`,
          `异放增伤区 ${formatFormulaNumber(p.anomalyReleaseDmgBonusZone)}`,
          `异放倍率区 ${formatFormulaNumber(p.anomalyReleaseMultZone)}`,
          // 异放只吃自己的暴击字段（用户 2026-10-16；「异常综合暴击区」已删）
          `异放暴击区 = 1 + (${formatFormulaNumber(p.anomalyReleaseCritRateRatio ?? 0)} × ${formatFormulaNumber(p.anomalyReleaseCritDmgRatio ?? 0)})`,
          `暴击率=0 → ${formatNumber(p.anomalyReleaseExpectedNoCrit)}`,
          `暴击率=1（区 ${formatFormulaNumber(p.anomalyReleaseFullCritZone)}）→ ${formatNumber(p.anomalyReleaseExpectedFullCrit)}`,
        ],
      },
    ],
    radianceExpected: [
      {
        label: '乘区组成',
        items: [
          ...(props.calcParts.remielSelfRadianceActive
            ? [
                `蕾米埃尔异常基础 ${formatNumber(anomalyBaseWithMutation)}`,
                `防御区 ${formatFormulaNumber(p.remielSelfDefenseMultiplier ?? 1)}`,
                `抗性区 ${formatFormulaNumber(p.remielSelfResistanceMultiplier ?? 1)}`,
                `易伤区 ${formatFormulaNumber(p.anomalyVulnerableMultiplier)}`,
                `失衡易伤区 ${formatFormulaNumber(p.staggerMultiplier)}`,
                `耀变增伤区 ${formatFormulaNumber(p.radianceDmgBonusZone)}`,
                `耀变倍率区 ${formatFormulaNumber(p.radianceMultZone)}`,
                `特殊倍率乘区 ${formatFormulaNumber(p.specialMultZone)}`,
                `特殊乘区 ${formatFormulaNumber(p.specialMultiplier)}`,
              ]
            : [
                `异常基础期望 ${formatNumber(anomalyBaseWithMutation)}`,
                `耀变增伤区 ${formatFormulaNumber(p.radianceDmgBonusZone)}`,
                `耀变倍率区 ${formatFormulaNumber(p.radianceMultZone)}`,
              ]),
          // 耀变触发者无论是蕾米还是其他人都允许暴击（游戏规则）；两条链路同乘一个暴击区
          `耀变暴击区（暴击率=0）1 → ${formatNumber(p.radianceExpectedNoCrit)}`,
          `耀变暴击区（暴击率=1）${formatFormulaNumber(p.radianceFullCritZone)} → ${formatNumber(p.radianceExpectedFullCrit)}`,
        ],
      },
    ],
    radianceMutation: [
      {
        label: '乘区组成',
        items: [
          `异化系数区 ${formatFormulaNumber(p.mutationZone)}`,
          `耀变期望 ${formatNumber(p.radianceExpected)}`,
        ],
      },
    ],
    radianceDmgBonusZone: (() => {
      const radianceBonus = bonusPanel.radianceDmgBonus
      return [
        {
          label: '乘区组成',
          items: [
            `耀变增伤区 1 + ${formatFormulaNumber(radianceBonus, 2)}% = ${formatFormulaNumber(p.radianceDmgBonusZone)}`,
          ],
        },
        ...buildStatSourceGroups({
          keys: ['radianceDmgBonus'],
          externalPanel: bonusExternal,
          sources: bonusSources,
          finalValues: { radianceDmgBonus: radianceBonus },
        }),
      ]
    })(),
    radianceMultZone: withTotal(
      [
        // 招式倍率来源（等级公式）：让「360% 怎么来的」在数值组成里可追溯（用户口径 2026-09-16）
        ...(props.skillMultLevelNote
          ? [{ label: '招式倍率来源', items: [props.skillMultLevelNote] }]
          : []),
        ...buildStatSourceGroups({
          keys: ['radianceMult', 'radianceMultFactor'],
          externalPanel: bonusExternal,
          sources: bonusSources,
          externalKeyMap: { radianceMult: null, radianceMultFactor: null },
          finalValues: {
            radianceMult: bonusPanel.radianceMult,
            radianceMultFactor: bonusPanel.radianceMultFactor,
          },
        }),
      ],
      `耀变倍率区 max(0, ${formatFormulaNumber(bonusPanel.radianceMult, 2)}%) × 修正 ${formatFormulaNumber(bonusPanel.radianceMultFactor ?? 100, 2)}% = ${formatFormulaNumber(p.radianceMultZone)}`,
      [
        `加算 ${formatFormulaNumber(bonusPanel.radianceMult, 2)}% → ${formatFormulaNumber(Math.max(0, bonusPanel.radianceMult / 100))}`,
        `倍率修正 ${formatFormulaNumber(bonusPanel.radianceMultFactor ?? 100, 2)}% → ×${formatFormulaNumber((bonusPanel.radianceMultFactor ?? 100) / 100)}`,
        `= ${formatFormulaNumber(p.radianceMultZone)}`,
      ],
    ),
    // 耀变只吃自己的暴击字段（耀变暴击率/爆伤）；触发者无论是蕾米还是其他人都允许暴击
    radianceCritZone: withTotal(
      buildStatSourceGroups({
        keys: ['radianceCritRate', 'radianceCritDmg'],
        externalPanel: bonusExternal,
        sources: bonusSources,
        finalValues: {
          radianceCritRate: bonusPanel.radianceCritRate,
          radianceCritDmg: bonusPanel.radianceCritDmg,
        },
      }),
      [
        `暴击率=0：耀变暴击区 = 1`,
        `暴击率=1：耀变暴击区 = 1 + ${formatFormulaNumber(bonusPanel.radianceCritDmg / 100)} = ${formatFormulaNumber(p.radianceFullCritZone)}`,
        `实际期望：1 + ${formatFormulaNumber(bonusPanel.radianceCritRate / 100)} × ${formatFormulaNumber(bonusPanel.radianceCritDmg / 100)} = ${formatFormulaNumber(p.radianceCritZone)}`,
      ].join('；'),
    ),
    mutationZone: buildMutationZoneTipGroups({
      zone: p.remielSelfRadianceActive
        ? (p.remielSelfMutationZone ?? p.mutationZone)
        : p.mutationZone,
      title: p.remielSelfRadianceActive ? '异化系数（本人耀变）' : '异化系数',
      noteItems: [
        p.remielSelfRadianceActive
          ? '取蕾米埃尔最终局内面板的异化系数与修正（含队友/邦布）'
          : props.mutationAgentLabel
            ? `由 ${props.mutationAgentLabel} 提供（取该角色局内最终面板的异化系数与修正）`
            : '取队伍中蕾米埃尔局内最终面板的异化系数与修正',
      ],
      externalPanel: props.mutationExternalPanel,
      sources: props.mutationSources,
      finalPanel: props.mutationFinalPanel,
    }),
    remielSelfDefenseMultiplier: p.remielSelfRadianceActive
      ? buildDefenseZoneSourceGroups({
          enemyDefense: enemy.defense,
          penRatePanel: remielPanelForSelf,
          penRateExternal: remielExt,
          penRateSources: remielSourcesForSelf,
          defCutPanel: defTrigPanel,
          defCutExternal: defTrigExternal,
          defCutSources: defTrigSources,
          defCutLabel: '异常类触发者',
          splitDefCut: true,
          isMb: Boolean(props.remielIsMb),
          mbLabel: '蕾米埃尔',
          penRateRole: '蕾米埃尔',
          defCutRole: '异常类触发者',
        })
      : [],
    remielSelfResistanceMultiplier: p.remielSelfRadianceActive
      ? withTotal(
          [
            {
              label: '敌方与环境',
              items: [
                p.remielSelfResistanceElement
                  ? `${p.remielSelfResistanceElement} 抗性 ${formatFormulaNumber(remielEnemyRes)}`
                  : '无后续非流明队友，敌方抗性按无弱点无抗性（0）',
              ],
            },
            ...buildStatSourceGroups({
              keys: ['resPen'],
              externalPanel: resistanceView.external,
              sources: resistanceView.sources,
              finalValues: { resPen: resistanceView.panel.resPen },
            }),
            ...buildStatSourceGroups({
              keys: ['radianceResPen'],
              externalPanel: remielExt,
              sources: remielSourcesForSelf,
              finalValues: {
                radianceResPen: remielPanelForSelf.radianceResPen,
              },
            }),
          ],
          `抗性区 1 - ${formatFormulaNumber(remielEnemyRes)} + ${formatFormulaNumber(remielResPenTotal, 2)}% = ${formatFormulaNumber(p.remielSelfResistanceMultiplier ?? 1)}`,
          buildResistanceZoneProcessItems({
            enemyResistance: remielEnemyRes,
            resPen: remielResPenTotal,
            zone: p.remielSelfResistanceMultiplier ?? 1,
          }),
        )
      : [],
  }
}

export interface EventZoneDisplayRow extends SkillCalcZoneRow {
  sourceSlots: readonly number[]
  sourceLabel: string
  groups: StatSourceGroup[]
}

const zoneTipKeys: Record<string, ValueTipsKey> = {
  面板攻击力:'baseDamage',面板防御力:'baseDamage',面板贯穿力:'baseDamage',基础伤害:'baseDamage',
  增伤:'dmgMultiplier',增伤区:'dmgMultiplier',防御区:'defenseMultiplier',抗性区:'resistanceMultiplier',
  易伤区:'vulnerableMultiplier',非直伤易伤区:'anomalyVulnerableMultiplier',直伤易伤区:'directVulnerableMultiplier',
  失衡易伤区:'staggerMultiplier',特殊乘区:'specialMultiplier',特殊倍率乘区:'specialMultZone',
  暴击区:'critMultiplier',锐爆区:'critMultiplier',贯穿增伤区:'pierceDmgMultiplier',
  技能倍率区:'directDmgMultZone',直伤倍率区:'directDmgMultZone',决算倍率区:'settlementDmgMultZone',
  精通区:'masteryZone',等级区:'levelZone',异化系数:'mutationZone',异化系数区:'mutationZone',
  属性异常增伤区:'attributeAnomalyDmgBonusZone',属性异常倍率区:'attributeAnomalyMultZone',属性异常暴击区:'attributeAnomalyCritZone',
  紊乱基础倍率:'disorderBaseMult',异常持续时间:'anomalyDuration',紊乱补偿倍率:'disorderCompMult',
  紊乱倍率修正:'disorderZone',紊乱倍率区:'disorderZone',紊乱增伤区:'disorderDmgBonusZone',紊乱暴击区:'disorderCritZone',
  乱流基础倍率:'turbulenceBaseMult',乱流补偿倍率:'turbulenceCompMult',乱流倍率修正:'turbulenceZone',
  乱流倍率区:'turbulenceZone',乱流增伤区:'turbulenceDmgBonusZone',乱流暴击区:'turbulenceCritZone',
  异放增伤区:'anomalyReleaseDmgBonusZone',异放倍率区:'anomalyReleaseMultZone',异放暴击区:'anomalyReleaseCritZone',
  耀变增伤区:'radianceDmgBonusZone',耀变倍率区:'radianceMultZone',耀变暴击区:'radianceCritZone',
  局内攻击力:'remielSelfInCombatAtk',局内精通区:'remielSelfInCombatMasteryZone',特殊等级区:'remielSelfSpecialLevelZone',
}

/** 招式详情格子只适配布局和格式，来源及公式复用正式详情投影。 */
export function buildEventZoneDisplay(calculation: SkillFlowCalculationDetail): EventZoneDisplayRow[] {
  const d=calculation.evaluation, tips=buildEventValueTips(calculation)
  const usages=d.damageInputUsages!.filter(usage=>usage.usedView!=='convertSourcePanel')
  return buildSkillCalcZoneRows(d.result,d.hit.skill.damageType).filter(row=>row.label!=='通用乘区').map(row=>{
    const finalResult=['期望伤害','暴击伤害','不暴击伤害'].includes(row.label)
    let key=zoneTipKeys[row.label]
    if(finalResult) key=d.kind==='direct'||d.kind==='sharpen'?'directDamageExpected'
      :d.anomalySubKind==='attributeAnomaly'?'attributeAnomalyExpected':d.anomalySubKind==='anomalyRelease'?'anomalyReleaseExpected'
        :d.anomalySubKind==='disorder'?'disorderExpected':d.anomalySubKind==='turbulence'?'turbulenceExpected':'radianceExpected'
    if(d.result.remielSelfRadianceActive){
      if(row.label==='防御区')key='remielSelfDefenseMultiplier'
      if(row.label==='抗性区')key='remielSelfResistanceMultiplier'
      if(row.label==='等级区')key='remielSelfStandardLevelZone'
    }
    if(!key)throw new Error('Unmapped event zone: '+row.label)
    const selected=finalResult?usages:usages.filter(usage=>usage.resultKey===key||
      key==='baseDamage'&&usage.resultKey==='anomalyBaseExpected'||
      key==='defenseMultiplier'&&['defenseFactor','effectiveDefense'].includes(usage.resultKey)||
      key==='remielSelfDefenseMultiplier'&&['defenseFactor','effectiveDefense'].includes(usage.resultKey)||
      key==='remielSelfResistanceMultiplier'&&usage.resultKey==='resistanceMultiplier'||
      ['directVulnerableMultiplier','anomalyVulnerableMultiplier'].includes(key)&&usage.resultKey==='vulnerableMultiplier'||
      key==='critMultiplier'&&usage.resultKey==='sharpenCritZone'||
      key==='remielSelfInCombatAtk'&&usage.field==='inCombatAtk'||
      key==='remielSelfInCombatMasteryZone'&&usage.field==='inCombatMastery'||
      key==='mutationZone'&&usage.field==='mutationZone'||
      key==='specialMultZone'&&['specialMult','specialMultFactor'].includes(usage.field))
    // 等级区没有独立的输入字段，它跟「异常基础」同一组面板（异常类 = 异常强度提供者），
    // 不属于「多个面板 / 事件参数」，所以显式复用基础字段的来源
    const levelSelected = key==='levelZone'
      ? usages.filter(usage=>(usage.field==='atk'||usage.field==='hp'||usage.field==='def') &&
          (usage.resultKey==='baseDamage'||usage.resultKey==='anomalyBaseExpected'))
      : selected
    const sourceSlots=[...new Set(levelSelected.map(usage=>d.viewSnapshots![usage.viewKey]!.slotIndex))]
    const names=[...new Set(levelSelected.map(usage=>d.viewSnapshots![usage.viewKey]!.agentName))]
    return {...row,sourceSlots,sourceLabel:finalResult?'最终伤害':names.length?'正式采用 · '+names.join('、'):'事件参数',groups:tips[key]}
  })
}
