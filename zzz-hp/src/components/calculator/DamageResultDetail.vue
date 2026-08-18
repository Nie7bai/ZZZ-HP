<script setup lang="ts">
import { computed } from 'vue'
import StatValueWithSources from '@/components/calculator/StatValueWithSources.vue'
import DirectDamageFormulaAligned from '@/components/calculator/DirectDamageFormulaAligned.vue'
import type { PanelStats } from '@/types/calculatorPanel'
import type { DamageCalcResult } from '@/utils/damageCalc'
import type { BuffModSource } from '@/utils/panelBuffCalc'
import {
  buildAtkPanelProcessItems,
  buildDefPanelProcessItems,
  buildEnemyCombatProcessItems,
  buildStatSourceGroups,
  type StatSourceGroup,
} from '@/utils/statSourceTips'
import {
  buildDefenseZoneFormulaItems,
  buildDefenseZoneSourceGroups,
  buildMutationZoneTipGroups,
  buildPierceDmgZoneProcessItems,
  buildRemielSelfAtkTipGroups,
  buildRemielSelfMasteryTipGroups,
  buildRemielSpecialLevelZoneGroups,
  buildRemielStandardLevelZoneGroups,
  buildResistanceZoneProcessItems,
} from '@/utils/zoneSourceTips'
import { formatCalcDecimal } from '@/utils/calcNumberFormat'
import {
  buildAlignedAnomalyFormulaGroups,
  resolveAnomalyBaseWithMutation,
  type AnomalyFormulaAgentLabels,
} from '@/utils/anomalyFormulaDisplay'
import {
  buildAlignedDirectFormulaGroup,
  buildDirectDamageExpectedProcessItems,
  formatDirectDmgMultZoneFormula,
  formatSettlementDmgMultZoneFormula,
} from '@/utils/directDamageDisplay'
import { normalizeDamageEnemyInput, resolveEnemyResistanceForElement } from '@/utils/enemyResistance'

const props = defineProps<{
  calcParts: DamageCalcResult
  finalPanel: PanelStats
  externalPanel: PanelStats
  sources: BuffModSource[]
  pierceMod: number
  piercePower: number
  enemyInput: {
    defense: number
    vulnerableMultiplier: number
    staggerMultiplier: number
    specialMultiplier: number
    level: number
    resistanceType?: import('@/utils/enemyResistance').EnemyResistanceType
    elementResistance?: import('@/utils/enemyResistance').ElementResistanceMap
  }
  isMb: boolean
  /** direct=通用乘区+直伤；anomaly=通用乘区+异常子类 */
  show: 'direct' | 'anomaly'
  anomalySubKind?: import('@/types/calculator').AnomalyDamageSubKind
  /** 紊乱/乱流：产生角色面板（用于倍率区来源提示） */
  producerFinalPanel?: PanelStats
  producerExternalPanel?: PanelStats
  producerSources?: BuffModSource[]
  producerAgentLabel?: string
  /** 异常基础乘区角色名 */
  baseAgentLabel?: string
  /** 增伤/倍率乘区角色名（招式持有者或异常类触发者） */
  bonusAgentLabel?: string
  /** 异化系数区角色名（蕾米埃尔） */
  mutationAgentLabel?: string
  /** 蕾米埃尔局内最终面板（异化系数来源） */
  mutationFinalPanel?: PanelStats
  mutationExternalPanel?: PanelStats
  mutationSources?: BuffModSource[]
  /** 本人耀变局内攻/精逐条来源 */
  remielSelfAtkSourceItems?: string[]
  remielSelfMasterySourceItems?: string[]
  remielSelfExternalPanel?: PanelStats
  remielSelfSources?: BuffModSource[]
  remielSelfFinalPanel?: PanelStats
  remielIsMb?: boolean
  /** 类型增伤/倍率面板（异放/耀变=异常类触发者；缺省回落 finalPanel） */
  bonusFinalPanel?: PanelStats
  bonusExternalPanel?: PanelStats
  bonusSources?: BuffModSource[]
}>()

const anomalySubKind = computed(() => props.anomalySubKind ?? 'anomaly')

function round(v: number, p = 2) {
  const f = 10 ** p
  return Math.round(v * f) / f
}

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

const generalFormulaParts = computed(() => {
  const p = props.calcParts
  return [
    formatFormulaNumber(p.baseDamage, 2),
    formatFormulaNumber(p.dmgMultiplier),
    formatFormulaNumber(p.defenseMultiplier),
    formatFormulaNumber(p.resistanceMultiplier),
    formatFormulaNumber(p.vulnerableMultiplier),
    formatFormulaNumber(p.staggerMultiplier),
  ]
})

const directFormulaParts = computed(() => {
  const p = props.calcParts
  const parts = [
    formatFormulaNumber(p.generalMultiplier, 2),
    formatFormulaNumber(p.critMultiplier),
    formatFormulaNumber(p.specialMultiplier),
  ]
  if (p.baseDamageSource === 'pierce') {
    parts.push(formatFormulaNumber(p.pierceDmgMultiplier))
  }
  parts.push(formatFormulaNumber(p.directDmgMultZone))
  return parts
})

const anomalyFormulaParts = computed(() => {
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
    formatFormulaNumber(p.masteryZone),
    formatFormulaNumber(p.levelZone),
  ]
})

const anomalyBaseWithMutation = computed(() => resolveAnomalyBaseWithMutation(props.calcParts))

const anomalyExpectedFormulaParts = computed(() => {
  const p = props.calcParts
  return [
    formatNumber(anomalyBaseWithMutation.value),
    formatFormulaNumber(p.anomalyDmgBonusZone),
    formatFormulaNumber(p.anomalyMultZone),
    formatFormulaNumber(p.anomalyCritZone),
  ]
})

const disorderFormulaParts = computed(() => {
  const p = props.calcParts
  return [
    formatNumber(anomalyBaseWithMutation.value),
    formatFormulaNumber(p.disorderZone),
    formatFormulaNumber(p.disorderDmgBonusZone),
  ]
})

const turbulenceFormulaParts = computed(() => {
  const p = props.calcParts
  const parts = [
    formatNumber(anomalyBaseWithMutation.value),
    formatFormulaNumber(p.turbulenceZone),
    formatFormulaNumber(p.turbulenceCombinedDmgBonusZone),
  ]
  if (p.turbulenceUsesAnomalyCrit) {
    parts.push(formatFormulaNumber(p.anomalyCritZone))
  }
  return parts
})

type ValueTipsKey =
  | 'baseDamage'
  | 'dmgMultiplier'
  | 'defenseMultiplier'
  | 'resistanceMultiplier'
  | 'vulnerableMultiplier'
  | 'staggerMultiplier'
  | 'generalMultiplier'
  | 'critRateRatio'
  | 'critMultiplier'
  | 'specialMultiplier'
  | 'directDmgMultZone'
  | 'settlementDmgMultZone'
  | 'penRateRatio'
  | 'effectiveDefense'
  | 'piercePower'
  | 'directDamageExpected'
  | 'masteryZone'
  | 'levelZone'
  | 'anomalyBaseExpected'
  | 'anomalyDmgBonusZone'
  | 'anomalyMultZone'
  | 'anomalyCritZone'
  | 'anomalyReleaseCombinedDmgBonusZone'
  | 'anomalyReleaseMultZone'
  | 'anomalyCombinedCritZone'
  | 'disorderBaseMult'
  | 'anomalyDuration'
  | 'disorderCompMult'
  | 'disorderDmgBonusZone'
  | 'disorderZone'
  | 'disorderExpected'
  | 'turbulenceBaseMult'
  | 'turbulenceCompMult'
  | 'turbulenceDmgBonusZone'
  | 'turbulenceZone'
  | 'turbulenceCombinedDmgBonusZone'
  | 'turbulenceExpected'
  | 'anomalyExpected'
  | 'anomalyReleaseExpected'
  | 'radianceExpected'
  | 'radianceMutation'
  | 'radianceCombinedDmgBonusZone'
  | 'radianceMultZone'
  | 'mutationZone'
  | 'pierceDmgMultiplier'
  | 'remielSelfInCombatAtk'
  | 'remielSelfInCombatMasteryZone'
  | 'remielSelfSpecialLevelZone'
  | 'remielSelfStandardLevelZone'
  | 'remielSelfDefenseMultiplier'
  | 'remielSelfResistanceMultiplier'

interface AlignedFormulaTerm {
  label: string
  value: string
  tipsKey: ValueTipsKey
}

type AlignedFormulaResultKey =
  | 'generalMultiplier'
  | 'directDamageExpected'
  | 'anomalyBaseExpected'
  | 'anomalyExpected'
  | 'anomalyReleaseExpected'
  | 'disorderExpected'
  | 'turbulenceExpected'
  | 'radianceExpected'

interface AlignedFormulaGroup {
  key: AlignedFormulaResultKey
  title: string
  hint?: string
  agentLabel?: string
  terms: AlignedFormulaTerm[]
  result: string
  dualResults?: { label: string; value: string }[]
}

const alignedGeneralFormula = computed((): AlignedFormulaGroup => {
  const p = props.calcParts
  return {
    key: 'generalMultiplier',
    title: '公式',
    terms: [
      { label: '基础伤害', value: formatFormulaNumber(p.baseDamage, 2), tipsKey: 'baseDamage' },
      { label: '增伤区', value: formatFormulaNumber(p.dmgMultiplier), tipsKey: 'dmgMultiplier' },
      { label: '防御区', value: formatFormulaNumber(p.defenseMultiplier), tipsKey: 'defenseMultiplier' },
      { label: '抗性区', value: formatFormulaNumber(p.resistanceMultiplier), tipsKey: 'resistanceMultiplier' },
      { label: '易伤区', value: formatFormulaNumber(p.vulnerableMultiplier), tipsKey: 'vulnerableMultiplier' },
      { label: '失衡易伤区', value: formatFormulaNumber(p.staggerMultiplier), tipsKey: 'staggerMultiplier' },
    ],
    result: formatFormulaNumber(p.generalMultiplier, 2),
  }
})

const alignedDirectFormula = computed(() =>
  buildAlignedDirectFormulaGroup(props.calcParts, formatFormulaNumber, formatNumber),
)

const anomalyFormulaLabels = computed((): AnomalyFormulaAgentLabels => ({
  baseAgent: props.baseAgentLabel ?? props.producerAgentLabel,
  bonusAgent: props.bonusAgentLabel,
  mutationAgent: props.mutationAgentLabel,
}))

const alignedAnomalyFormulas = computed((): AlignedFormulaGroup[] =>
  buildAlignedAnomalyFormulaGroups(
    props.calcParts,
    anomalySubKind.value,
    props.calcParts.hasPolarDisorder ? '极性紊乱' : '紊乱伤害',
    formatFormulaNumber,
    formatNumber,
    anomalyFormulaLabels.value,
  ) as AlignedFormulaGroup[],
)

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

const valueTips = computed<Record<ValueTipsKey, StatSourceGroup[]>>(() => {
  const p = props.calcParts
  const ownerPanel = props.finalPanel
  const ownerExternal = props.externalPanel
  const ownerSources = props.sources
  const enemy = props.enemyInput
  const pierceMod = props.pierceMod

  const sub = anomalySubKind.value
  const usesProducerBase =
    (sub === 'anomaly' ||
      sub === 'turbulence' ||
      sub === 'disorder' ||
      sub === 'anomalyRelease' ||
      sub === 'radiance') &&
    Boolean(props.producerFinalPanel && props.producerExternalPanel && props.producerSources)
  // 通用乘区（含增伤区）在异常基础链上取异常强度提供者
  const panel = usesProducerBase ? props.producerFinalPanel! : ownerPanel
  const external = usesProducerBase ? props.producerExternalPanel! : ownerExternal
  const sources = usesProducerBase ? props.producerSources! : ownerSources

  const usesProducerMult =
    (sub === 'turbulence' || sub === 'disorder') &&
    Boolean(props.producerFinalPanel && props.producerExternalPanel && props.producerSources)
  const multPanel = usesProducerMult ? props.producerFinalPanel! : ownerPanel
  const multExternal = usesProducerMult ? props.producerExternalPanel! : ownerExternal
  const multSources = usesProducerMult ? props.producerSources! : ownerSources
  const producerExtraGroup = usesProducerBase
    ? [
        {
          label: props.producerAgentLabel ?? '异常强度提供者',
          items: usesProducerMult
            ? [
                '异常基础、紊乱/乱流倍率与持续时间取异常强度提供者；增伤/异常暴击取招式持有者；减防/无视取异常类触发者',
              ]
            : [
                '异常基础乘区（含通用增伤区）取异常强度提供者；类型增伤/倍率取异常类触发者；减防/无视取异常类触发者',
              ],
        },
      ]
    : []

  // 类型增伤/倍率/暴击：属性异常/异放/耀变→触发者；紊乱/乱流→持有者
  const bonusPanel = props.bonusFinalPanel ?? ownerPanel
  const bonusExternal = props.bonusExternalPanel ?? ownerExternal
  const bonusSources = props.bonusSources ?? ownerSources
  // Detail 暂无独立触发者面板 props：属性异常/异放/耀变时 bonus 即为触发者；紊乱/乱流减防 tip 回落持有者并注明
  const defTrigPanel =
    sub === 'anomaly' || sub === 'anomalyRelease' || sub === 'radiance'
      ? bonusPanel
      : ownerPanel
  const defTrigExternal =
    sub === 'anomaly' || sub === 'anomalyRelease' || sub === 'radiance'
      ? bonusExternal
      : ownerExternal
  const defTrigSources =
    sub === 'anomaly' || sub === 'anomalyRelease' || sub === 'radiance'
      ? bonusSources
      : ownerSources
  const defTrigLabel =
    sub === 'anomaly' || sub === 'anomalyRelease' || sub === 'radiance'
      ? (props.bonusAgentLabel ?? '异常类触发者')
      : (props.bonusAgentLabel ?? '招式持有者')
  const remielExt = props.remielSelfExternalPanel ?? (p.remielSelfRadianceActive ? props.producerExternalPanel ?? external : external)
  const remielPanelForSelf = props.remielSelfFinalPanel ?? (p.remielSelfRadianceActive ? props.producerFinalPanel ?? panel : panel)
  const remielSourcesForSelf = props.remielSelfSources ?? []
  const remielResPenTotal =
    (remielPanelForSelf.resPen ?? 0) + (remielPanelForSelf.radianceResPen ?? 0)
  const remielEnemyRes =
    p.remielSelfRadianceActive && p.remielSelfResistanceElement
      ? resolveEnemyResistanceForElement(
          normalizeDamageEnemyInput(props.enemyInput),
          p.remielSelfResistanceElement,
        )
      : 0
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
    dmgMultiplier: withTotal(
      buildStatSourceGroups({
        keys: ['dmgBonus'],
        externalPanel: external,
        sources,
        finalValues: { dmgBonus: panel.dmgBonus },
      }),
      `局内增伤 ${formatFormulaNumber(panel.dmgBonus, 2)}% → 增伤区 1 + ${formatFormulaNumber(panel.dmgBonus, 2)}% = ${formatFormulaNumber(p.dmgMultiplier)}`,
    ),
    defenseMultiplier: buildDefenseZoneSourceGroups({
      enemyDefense: enemy.defense,
      penRatePanel: panel,
      penRateExternal: external,
      penRateSources: sources,
      defCutPanel: defTrigPanel,
      defCutExternal: defTrigExternal,
      defCutSources: defTrigSources,
      defCutLabel: defTrigLabel,
      splitDefCut: usesProducerBase,
      isMb: props.isMb,
      mbLabel: '命破招式持有者',
      penRateRole: usesProducerBase ? '强度提供者' : '持有者',
      defCutRole: usesProducerBase ? '触发者' : '持有者',
    }),
    resistanceMultiplier: withTotal(
      [
        {
          label: '敌方与环境',
          items: [`敌方抗性 ${formatFormulaNumber(p.enemyResistance)}`],
        },
        ...buildStatSourceGroups({
          keys: ['resPen'],
          externalPanel: external,
          sources,
          finalValues: { resPen: panel.resPen },
        }),
      ],
      `抗性区 1 - ${formatFormulaNumber(p.enemyResistance)} + ${formatFormulaNumber(panel.resPen, 2)}% = ${formatFormulaNumber(p.resistanceMultiplier)}`,
      buildResistanceZoneProcessItems({
        enemyResistance: p.enemyResistance,
        resPen: panel.resPen,
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
          keys: ['vulnerable'],
          externalPanel: external,
          sources,
          externalKeyMap: { vulnerable: null },
          showAdditiveProcess: false,
        }),
      ],
      `易伤区 ${formatFormulaNumber(p.vulnerableMultiplier)}`,
      buildEnemyCombatProcessItems({
        baseLabel: '易伤基础',
        baseValue: enemy.vulnerableMultiplier,
        sources,
        buffKey: 'vulnerable',
        finalValue: p.vulnerableMultiplier,
        resultLabel: '易伤区',
      }),
    ),
    staggerMultiplier: withTotal(
      [
        {
          label: '敌方与环境',
          items: [`失衡易伤基础 ${formatFormulaNumber(enemy.staggerMultiplier)}`],
        },
        ...buildStatSourceGroups({
          keys: ['staggerVulnerable'],
          externalPanel: external,
          sources,
          externalKeyMap: { staggerVulnerable: null },
          showAdditiveProcess: false,
        }),
      ],
      `失衡易伤区 ${formatFormulaNumber(p.staggerMultiplier)}`,
      buildEnemyCombatProcessItems({
        baseLabel: '失衡易伤基础',
        baseValue: enemy.staggerMultiplier,
        sources,
        buffKey: 'staggerVulnerable',
        finalValue: p.staggerMultiplier,
        resultLabel: '失衡易伤区',
      }),
    ),
    generalMultiplier: [
      {
        label: '乘区组成',
        items: [
          `基础伤害 ${generalFormulaParts.value[0]}`,
          `增伤区 ${generalFormulaParts.value[1]}`,
          `防御区 ${generalFormulaParts.value[2]}`,
          `抗性区 ${generalFormulaParts.value[3]}`,
          `易伤区 ${generalFormulaParts.value[4]}`,
          `失衡易伤区 ${generalFormulaParts.value[5]}`,
          `合计 ${formatFormulaNumber(p.generalMultiplier, 2)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `${generalFormulaParts.value[0]} × ${generalFormulaParts.value[1]} × ${generalFormulaParts.value[2]} × ${generalFormulaParts.value[3]} × ${generalFormulaParts.value[4]} × ${generalFormulaParts.value[5]}`,
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
      buildStatSourceGroups({
        keys: ['critRate', 'critDmg'],
        externalPanel: external,
        sources,
        finalValues: { critRate: panel.critRate, critDmg: panel.critDmg },
      }),
      `暴击区 1 + ${formatFormulaNumber(p.critRateRatio)} × ${formatFormulaNumber(p.critDmgRatio)} = ${formatFormulaNumber(p.critMultiplier)}`,
    ),
    specialMultiplier: withTotal(
      [
        {
          label: '敌方与环境',
          items: [`特殊乘区基础 ${formatFormulaNumber(enemy.specialMultiplier)}`],
        },
        ...buildStatSourceGroups({
          keys: ['special'],
          externalPanel: external,
          sources,
          externalKeyMap: { special: null },
          showAdditiveProcess: false,
        }),
      ],
      `特殊乘区 ${formatFormulaNumber(p.specialMultiplier)}`,
      buildEnemyCombatProcessItems({
        baseLabel: '特殊乘区基础',
        baseValue: enemy.specialMultiplier,
        sources,
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
        keys: usesProducerBase ? ['penRate'] : ['reduceDefense', 'penRate'],
        externalPanel: external,
        sources,
        finalValues: usesProducerBase
          ? { penRate: panel.penRate }
          : { reduceDefense: panel.reduceDefense, penRate: panel.penRate },
        extraGroups: [
          ...(usesProducerBase
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
        penRateRole: usesProducerBase ? '强度提供者' : '持有者',
        defCutRole: usesProducerBase ? '触发者' : '持有者',
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
          `通用乘区 ${directFormulaParts.value[0]}`,
          `暴击区 ${directFormulaParts.value[1]}`,
          `特殊乘区 ${directFormulaParts.value[2]}`,
          ...(p.baseDamageSource === 'pierce'
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
        label: usesProducerBase
          ? (props.producerAgentLabel ?? '异常强度提供者')
          : '招式持有者',
        items: [
          `角色等级 ${Math.round(p.levelZoneAgentLevel)}`,
          `等级区 ${formatFormulaNumber(p.levelZone)} = 1 + (${Math.round(p.levelZoneAgentLevel)} - 1) / 59`,
        ],
      },
    ],
    anomalyDmgBonusZone: withTotal(
      buildStatSourceGroups({
        keys: ['anomalyDmgBonus'],
        externalPanel: bonusExternal,
        sources: bonusSources,
        finalValues: { anomalyDmgBonus: bonusPanel.anomalyDmgBonus },
      }),
      `异常增伤区 1 + ${formatFormulaNumber(bonusPanel.anomalyDmgBonus, 2)}% = ${formatFormulaNumber(p.anomalyDmgBonusZone)}`,
    ),
    anomalyMultZone: withTotal(
      buildStatSourceGroups({
        keys: ['anomalyMult', 'anomalyMultFactor'],
        externalPanel: bonusExternal,
        sources: bonusSources,
        finalValues: {
          anomalyMult: bonusPanel.anomalyMult,
          anomalyMultFactor: bonusPanel.anomalyMultFactor,
        },
      }),
      `异常倍率区 max(0, ${formatFormulaNumber(bonusPanel.anomalyMult, 2)}%) × 修正 ${formatFormulaNumber(bonusPanel.anomalyMultFactor ?? 100, 2)}% = ${formatFormulaNumber(p.anomalyMultZone)}`,
      [
        `加算 ${formatFormulaNumber(bonusPanel.anomalyMult, 2)}% → ${formatFormulaNumber(Math.max(0, bonusPanel.anomalyMult / 100))}`,
        `倍率修正 ${formatFormulaNumber(bonusPanel.anomalyMultFactor ?? 100, 2)}% → ×${formatFormulaNumber((bonusPanel.anomalyMultFactor ?? 100) / 100)}`,
        `= ${formatFormulaNumber(p.anomalyMultZone)}`,
      ],
    ),
    anomalyReleaseCombinedDmgBonusZone: [
      {
        label: '乘区组成',
        items: [
          `异放增伤区 1 + ${formatFormulaNumber(bonusPanel.anomalyReleaseDmgBonus, 2)}% = ${formatFormulaNumber(1 + bonusPanel.anomalyReleaseDmgBonus / 100)}`,
          `异常增伤区 1 + ${formatFormulaNumber(bonusPanel.anomalyDmgBonus, 2)}% = ${formatFormulaNumber(p.anomalyDmgBonusZone)}`,
          `异放综合增伤区 1 + (${formatFormulaNumber(bonusPanel.anomalyReleaseDmgBonus, 2)}% + ${formatFormulaNumber(bonusPanel.anomalyDmgBonus, 2)}%) = ${formatFormulaNumber(p.anomalyReleaseCombinedDmgBonusZone)}`,
        ],
      },
      ...buildStatSourceGroups({
        keys: ['anomalyReleaseDmgBonus', 'anomalyDmgBonus'],
        externalPanel: bonusExternal,
        sources: bonusSources,
        finalValues: {
          anomalyReleaseDmgBonus: bonusPanel.anomalyReleaseDmgBonus,
          anomalyDmgBonus: bonusPanel.anomalyDmgBonus,
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
    anomalyCombinedCritZone: withTotal(
      buildStatSourceGroups({
        keys: ['anomalyCritRate', 'anomalyCritDmg', 'anomalyReleaseCritRate', 'anomalyReleaseCritDmg'],
        externalPanel: bonusExternal,
        sources: bonusSources,
        finalValues: {
          anomalyCritRate: bonusPanel.anomalyCritRate,
          anomalyCritDmg: bonusPanel.anomalyCritDmg,
          anomalyReleaseCritRate: bonusPanel.anomalyReleaseCritRate,
          anomalyReleaseCritDmg: bonusPanel.anomalyReleaseCritDmg,
        },
      }),
      [
        `暴击率=0：异常综合暴击区 = 1`,
        `暴击率=1：异常综合暴击区 = 1 + ${formatFormulaNumber(p.anomalyCombinedCritDmgRatio)} = ${formatFormulaNumber(p.anomalyCombinedFullCritZone)}`,
        `实际期望：1 + ${formatFormulaNumber(p.anomalyCombinedCritRateRatio)} × ${formatFormulaNumber(p.anomalyCombinedCritDmgRatio)} = ${formatFormulaNumber(p.anomalyCombinedCritZone)}`,
      ].join('；'),
    ),
    anomalyCritZone: withTotal(
      buildStatSourceGroups({
        keys: ['anomalyCritRate', 'anomalyCritDmg'],
        externalPanel: bonusExternal,
        sources: bonusSources,
        finalValues: {
          anomalyCritRate: bonusPanel.anomalyCritRate,
          anomalyCritDmg: bonusPanel.anomalyCritDmg,
        },
      }),
      [
        `暴击率=0：异常暴击区 = 1`,
        `暴击率=1：异常暴击区 = 1 + ${formatFormulaNumber(p.anomalyCritDmgRatio)} = ${formatFormulaNumber(p.anomalyFullCritZone)}`,
        `实际期望：1 + ${formatFormulaNumber(p.anomalyCritRateRatio)} × ${formatFormulaNumber(p.anomalyCritDmgRatio)} = ${formatFormulaNumber(p.anomalyCritZone)}`,
      ].join('；'),
    ),
    anomalyBaseExpected: p.remielSelfRadianceActive
      ? [
          {
            label: '乘区组成（蕾米埃尔异常基础；已含异化系数与双等级区）',
            items: [
              `局内攻击力 ${anomalyFormulaParts.value[0]}`,
              `局内精通区 ${anomalyFormulaParts.value[1]}`,
              `特殊等级区 ${anomalyFormulaParts.value[2]}`,
              `异化系数区 ${anomalyFormulaParts.value[3]}`,
              `等级区 ${anomalyFormulaParts.value[4]}`,
              `合计 ${formatNumber(anomalyBaseWithMutation.value)}`,
            ],
          },
          {
            label: '加减过程',
            fullWidth: true,
            items: [
              anomalyFormulaParts.value.join(' × '),
              `= ${formatNumber(anomalyBaseWithMutation.value)}`,
            ],
          },
        ]
      : [
          {
            label: p.mutationZone > 1 ? '乘区组成（含异化系数；不含异常增伤/倍率/暴击）' : '乘区组成（不含异常增伤/倍率/暴击）',
            items: [
              `通用乘区 ${anomalyFormulaParts.value[0]}`,
              `精通区 ${anomalyFormulaParts.value[1]}`,
              `等级区 ${anomalyFormulaParts.value[2]}`,
              ...(p.mutationZone > 1
                ? [`异化系数区 ${formatFormulaNumber(p.mutationZone)}`]
                : []),
              `合计 ${formatNumber(anomalyBaseWithMutation.value)}`,
            ],
          },
          {
            label: '加减过程',
            fullWidth: true,
            items: [
              [
                ...anomalyFormulaParts.value,
                ...(p.mutationZone > 1 ? [formatFormulaNumber(p.mutationZone)] : []),
              ].join(' × '),
              `= ${formatNumber(anomalyBaseWithMutation.value)}`,
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
    anomalyExpected: [
      {
        label: '乘区组成（含异常增伤/倍率/暴击）',
        items: [
          `异常基础期望 ${anomalyExpectedFormulaParts.value[0]}`,
          `异常增伤区 ${anomalyExpectedFormulaParts.value[1]}`,
          `异常倍率区 ${anomalyExpectedFormulaParts.value[2]}`,
          `异常暴击区（暴击率=0）1 → ${formatNumber(p.anomalyExpectedNoCrit)}`,
          `异常暴击区（暴击率=1）${formatFormulaNumber(p.anomalyFullCritZone)} → ${formatNumber(p.anomalyExpectedFullCrit)}`,
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
        `面板持续时间 ${formatFormulaNumber(multPanel.anomalyDuration, 2)}s（强度提供者）`,
        Math.abs(p.effectiveAnomalyDuration - multPanel.anomalyDuration) > 1e-6
          ? `火/以太触发：有效时间 = 面板 / 0.5 → ${formatFormulaNumber(p.effectiveAnomalyDuration)}s`
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
          `紊乱倍率区 = 基础 + 时间 × 补偿 = ${formatFormulaNumber(p.disorderZone)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `基础 ${formatFormulaNumber(p.disorderBaseMultRatio)}`,
          `时间项 ${formatFormulaNumber(p.effectiveAnomalyDuration)} × ${formatFormulaNumber(p.disorderCompMultRatio)} = ${formatFormulaNumber(p.effectiveAnomalyDuration * p.disorderCompMultRatio)}`,
          `${formatFormulaNumber(p.disorderBaseMultRatio)} + ${formatFormulaNumber(p.effectiveAnomalyDuration * p.disorderCompMultRatio)} = ${formatFormulaNumber(p.disorderZone)}`,
        ],
      },
    ],
    disorderExpected: [
      {
        label: '乘区组成',
        items: [
          `异常基础期望 ${formatNumber(anomalyBaseWithMutation.value)}`,
          `紊乱倍率区 ${formatFormulaNumber(p.disorderZone)}`,
          `紊乱增伤区 ${formatFormulaNumber(p.disorderDmgBonusZone)}`,
          `合计 ${formatNumber(p.disorderExpected)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `${disorderFormulaParts.value.join(' × ')}`,
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
          `乱流倍率区 = 基础 + 时间 × 补偿 = ${formatFormulaNumber(p.turbulenceZone)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `基础 ${formatFormulaNumber(p.turbulenceBaseMultRatio)}`,
          `时间项 ${formatFormulaNumber(p.effectiveAnomalyDuration)} × ${formatFormulaNumber(p.turbulenceCompMultRatio)} = ${formatFormulaNumber(p.effectiveAnomalyDuration * p.turbulenceCompMultRatio)}`,
          `${formatFormulaNumber(p.turbulenceBaseMultRatio)} + ${formatFormulaNumber(p.effectiveAnomalyDuration * p.turbulenceCompMultRatio)} = ${formatFormulaNumber(p.turbulenceZone)}`,
        ],
      },
    ],
    turbulenceCombinedDmgBonusZone: [
      {
        label: '乘区组成',
        items: [
          `乱流增伤区 ${formatFormulaNumber(p.turbulenceDmgBonusZone)}`,
          `异常增伤区 ${formatFormulaNumber(p.anomalyDmgBonusZone)}`,
          `乱流增伤区+异常增伤区 ${formatFormulaNumber(p.turbulenceCombinedDmgBonusZone)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `1 + ${formatFormulaNumber(bonusPanel.turbulenceDmgBonus, 2)}% + ${formatFormulaNumber(bonusPanel.anomalyDmgBonus, 2)}%`,
          `= ${formatFormulaNumber(p.turbulenceCombinedDmgBonusZone)}`,
        ],
      },
    ],
    turbulenceExpected: [
      {
        label: '乘区组成',
        items: [
          `异常基础期望 ${formatNumber(anomalyBaseWithMutation.value)}`,
          `乱流倍率区 ${formatFormulaNumber(p.turbulenceZone)}`,
          `乱流增伤区+异常增伤区 ${formatFormulaNumber(p.turbulenceCombinedDmgBonusZone)}`,
          `异常暴击区（暴击率=0）1 → ${formatNumber(p.turbulenceExpectedNoCrit)}`,
          `异常暴击区（暴击率=1）${formatFormulaNumber(p.anomalyFullCritZone)} → ${formatNumber(p.turbulenceExpectedFullCrit)}`,
        ],
      },
    ],
    anomalyReleaseExpected: [
      {
        label: '乘区组成',
        items: [
          `异常基础期望 ${formatNumber(anomalyBaseWithMutation.value)}`,
          `异放综合增伤区 ${formatFormulaNumber(p.anomalyReleaseCombinedDmgBonusZone)}（异放增伤+异常增伤）`,
          `异放倍率区 ${formatFormulaNumber(p.anomalyReleaseMultZone)}`,
          `异常综合暴击区 = 1 + (${formatFormulaNumber(p.anomalyCombinedCritRateRatio)} × ${formatFormulaNumber(p.anomalyCombinedCritDmgRatio)})`,
          `暴击率=0 → ${formatNumber(p.anomalyReleaseExpectedNoCrit)}`,
          `暴击率=1（区 ${formatFormulaNumber(p.anomalyCombinedFullCritZone)}）→ ${formatNumber(p.anomalyReleaseExpectedFullCrit)}`,
        ],
      },
    ],
    radianceExpected: [
      {
        label: '乘区组成',
        items: props.calcParts.remielSelfRadianceActive
          ? [
              `蕾米埃尔异常基础 ${formatNumber(anomalyBaseWithMutation.value)}`,
              `防御区 ${formatFormulaNumber(p.remielSelfDefenseMultiplier ?? 1)}`,
              `抗性区 ${formatFormulaNumber(p.remielSelfResistanceMultiplier ?? 1)}`,
              `易伤区 ${formatFormulaNumber(p.vulnerableMultiplier)}`,
              `失衡易伤区 ${formatFormulaNumber(p.staggerMultiplier)}`,
              `耀变综合增伤区 ${formatFormulaNumber(p.radianceCombinedDmgBonusZone)}（耀变增伤+异常增伤）`,
              `耀变倍率区 ${formatFormulaNumber(p.radianceMultZone)}`,
              `特殊倍率乘区 ${formatFormulaNumber(p.specialMultZone)}`,
              `特殊乘区 ${formatFormulaNumber(p.specialMultiplier)}`,
            ]
          : [
              `异常基础期望 ${formatNumber(anomalyBaseWithMutation.value)}`,
              `耀变综合增伤区 ${formatFormulaNumber(p.radianceCombinedDmgBonusZone)}（耀变增伤+异常增伤）`,
              `耀变倍率区 ${formatFormulaNumber(p.radianceMultZone)}`,
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
    radianceCombinedDmgBonusZone: [
      {
        label: '乘区组成',
        items: [
          `耀变增伤区 1 + ${formatFormulaNumber(bonusPanel.radianceDmgBonus, 2)}% = ${formatFormulaNumber(1 + bonusPanel.radianceDmgBonus / 100)}`,
          `异常增伤区 1 + ${formatFormulaNumber(bonusPanel.anomalyDmgBonus, 2)}% = ${formatFormulaNumber(p.anomalyDmgBonusZone)}`,
          `耀变综合增伤区 1 + (${formatFormulaNumber(bonusPanel.radianceDmgBonus, 2)}% + ${formatFormulaNumber(bonusPanel.anomalyDmgBonus, 2)}%) = ${formatFormulaNumber(p.radianceCombinedDmgBonusZone)}`,
        ],
      },
      ...buildStatSourceGroups({
        keys: ['radianceDmgBonus', 'anomalyDmgBonus'],
        externalPanel: bonusExternal,
        sources: bonusSources,
        finalValues: {
          radianceDmgBonus: bonusPanel.radianceDmgBonus,
          anomalyDmgBonus: bonusPanel.anomalyDmgBonus,
        },
      }),
    ],
    radianceMultZone: withTotal(
      buildStatSourceGroups({
        keys: ['radianceMult', 'radianceMultFactor'],
        externalPanel: bonusExternal,
        sources: bonusSources,
        externalKeyMap: { radianceMult: null, radianceMultFactor: null },
        finalValues: {
          radianceMult: bonusPanel.radianceMult,
          radianceMultFactor: bonusPanel.radianceMultFactor,
        },
      }),
      `耀变倍率区 max(0, ${formatFormulaNumber(bonusPanel.radianceMult, 2)}%) × 修正 ${formatFormulaNumber(bonusPanel.radianceMultFactor ?? 100, 2)}% = ${formatFormulaNumber(p.radianceMultZone)}`,
      [
        `加算 ${formatFormulaNumber(bonusPanel.radianceMult, 2)}% → ${formatFormulaNumber(Math.max(0, bonusPanel.radianceMult / 100))}`,
        `倍率修正 ${formatFormulaNumber(bonusPanel.radianceMultFactor ?? 100, 2)}% → ×${formatFormulaNumber((bonusPanel.radianceMultFactor ?? 100) / 100)}`,
        `= ${formatFormulaNumber(p.radianceMultZone)}`,
      ],
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
          defCutLabel: defTrigLabel,
          splitDefCut: true,
          isMb: Boolean(props.remielIsMb),
          mbLabel: '蕾米埃尔',
          penRateRole: '蕾米埃尔',
          defCutRole: '触发者',
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
              keys: ['resPen', 'radianceResPen'],
              externalPanel: remielExt,
              sources: remielSourcesForSelf,
              finalValues: {
                resPen: remielPanelForSelf.resPen,
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
})
</script>

<template>
  <div class="damage-result-detail">
    <h3 v-if="!calcParts.remielSelfRadianceActive" class="result-section-title">通用乘区</h3>
    <p v-else class="result-subtotal">蕾米埃尔本人耀变不使用通用乘区，异常基础见下方公式。</p>
    <div v-if="!calcParts.remielSelfRadianceActive" class="formula-block formula-block--aligned">
      <div class="formula-aligned-group">
        <span class="formula-label formula-aligned-title">{{ alignedGeneralFormula.title }}</span>
        <div class="formula-aligned-body">
          <template
            v-for="(term, index) in alignedGeneralFormula.terms"
            :key="`general-${term.label}`"
          >
            <span v-if="index > 0" class="formula-aligned-op" aria-hidden="true">×</span>
            <div class="formula-aligned-term">
              <span class="formula-aligned-term-label">{{ term.label }}</span>
              <span class="formula-aligned-term-value">
                <StatValueWithSources :value="term.value" :groups="valueTips[term.tipsKey]" />
              </span>
            </div>
          </template>
          <span class="formula-aligned-op" aria-hidden="true">=</span>
          <div class="formula-aligned-result">
            <StatValueWithSources
              :value="alignedGeneralFormula.result"
              :groups="valueTips[alignedGeneralFormula.key]"
            />
          </div>
        </div>
      </div>
    </div>
    <div v-if="!calcParts.remielSelfRadianceActive" class="result-grid">
      <p>基础伤害（局内）：<StatValueWithSources :value="calcParts.baseDamage" :groups="valueTips.baseDamage" /></p>
      <p>增伤区：<StatValueWithSources :value="calcParts.dmgMultiplier" :groups="valueTips.dmgMultiplier" /></p>
      <p>防御区：<StatValueWithSources :value="calcParts.defenseMultiplier" :groups="valueTips.defenseMultiplier" /></p>
      <p>抗性区：<StatValueWithSources :value="calcParts.resistanceMultiplier" :groups="valueTips.resistanceMultiplier" /></p>
      <p>易伤区（含增益）：<StatValueWithSources :value="calcParts.vulnerableMultiplier" :groups="valueTips.vulnerableMultiplier" /></p>
      <p>失衡易伤区（含增益）：<StatValueWithSources :value="calcParts.staggerMultiplier" :groups="valueTips.staggerMultiplier" /></p>
      <p class="result-subtotal">通用乘区：<StatValueWithSources :value="formatFormulaNumber(calcParts.generalMultiplier, 2)" :groups="valueTips.generalMultiplier" /></p>
    </div>

    <template v-if="show === 'direct'">
      <h3 class="result-section-title">直伤期望伤害</h3>
      <div class="formula-block formula-block--aligned">
        <DirectDamageFormulaAligned
          :group="alignedDirectFormula"
          :value-tips="valueTips"
        />
      </div>
      <div class="result-grid">
        <p>暴击率（计入上限 1）：<StatValueWithSources :value="calcParts.critRateRatio" :groups="valueTips.critRateRatio" /></p>
        <p>暴击区：<StatValueWithSources :value="calcParts.critMultiplier" :groups="valueTips.critMultiplier" /></p>
        <p>特殊乘区（含增益）：<StatValueWithSources :value="calcParts.specialMultiplier" :groups="valueTips.specialMultiplier" /></p>
        <p>直伤倍率区：<StatValueWithSources :value="calcParts.directDmgMultZone" :groups="valueTips.directDmgMultZone" /></p>
        <p v-if="calcParts.settlementDmgMultZone > 0">
          决算倍率区：<StatValueWithSources :value="calcParts.settlementDmgMultZone" :groups="valueTips.settlementDmgMultZone" />
        </p>
        <p>穿透率（计入）：<StatValueWithSources :value="calcParts.penRateRatio" :groups="valueTips.penRateRatio" /></p>
        <p>有效防御项：<StatValueWithSources :value="calcParts.effectiveDefense" :groups="valueTips.effectiveDefense" /></p>
        <p>贯穿力（局内）：<StatValueWithSources :value="Math.round(piercePower).toLocaleString('en-US')" :groups="valueTips.piercePower" /></p>
        <p class="result-total">直伤期望伤害：<StatValueWithSources :value="Math.round(calcParts.directDamageExpected).toLocaleString('en-US')" :groups="valueTips.directDamageExpected" /></p>
      </div>
    </template>

    <template v-else>
      <h3 class="result-section-title">异常 / 紊乱 / 乱流期望伤害</h3>
      <div class="formula-block formula-block--aligned">
        <div
          v-for="group in alignedAnomalyFormulas"
          :key="group.key"
          class="formula-aligned-group"
        >
          <span class="formula-label formula-aligned-title">
            <span v-if="group.agentLabel" class="formula-agent-label">{{ group.agentLabel }} · </span>
            {{ group.title }}
            <span v-if="group.hint" class="formula-aligned-hint">{{ group.hint }}</span>
          </span>
          <div class="formula-aligned-body">
            <template v-for="(term, index) in group.terms" :key="`${group.key}-${term.label}`">
              <span v-if="index > 0" class="formula-aligned-op" aria-hidden="true">×</span>
              <div class="formula-aligned-term">
                <span class="formula-aligned-term-label">{{ term.label }}</span>
                <span class="formula-aligned-term-value">
                  <StatValueWithSources :value="term.value" :groups="valueTips[term.tipsKey]" />
                </span>
              </div>
            </template>
            <span class="formula-aligned-op" aria-hidden="true">=</span>
            <div v-if="group.dualResults?.length" class="formula-aligned-dual">
              <div
                v-for="item in group.dualResults"
                :key="`${group.key}-${item.label}`"
                class="formula-aligned-result formula-aligned-result--dual"
              >
                <span class="formula-aligned-term-label">{{ item.label }}</span>
                <StatValueWithSources :value="item.value" :groups="valueTips[group.key]" />
              </div>
            </div>
            <div v-else class="formula-aligned-result">
              <StatValueWithSources :value="group.result" :groups="valueTips[group.key]" />
            </div>
          </div>
        </div>
      </div>
      <div class="result-grid">
        <h4 class="result-subsection-title">异常基础期望</h4>
        <p>精通区：<StatValueWithSources :value="calcParts.masteryZone" :groups="valueTips.masteryZone" /></p>
        <p>等级区：<StatValueWithSources :value="calcParts.levelZone" :groups="valueTips.levelZone" /></p>
        <p v-if="calcParts.mutationZone > 1">
          异化系数区：
          <StatValueWithSources :value="formatFormulaNumber(calcParts.mutationZone)" :groups="valueTips.mutationZone" />
        </p>
        <p class="result-total">异常基础期望：<StatValueWithSources :value="Math.round(anomalyBaseWithMutation).toLocaleString('en-US')" :groups="valueTips.anomalyBaseExpected" /></p>

        <template v-if="anomalySubKind === 'anomaly'">
        <h4 class="result-subsection-title">异常伤害</h4>
        <p>异常增伤区：<StatValueWithSources :value="calcParts.anomalyDmgBonusZone" :groups="valueTips.anomalyDmgBonusZone" /></p>
        <p>异常倍率区：<StatValueWithSources :value="calcParts.anomalyMultZone" :groups="valueTips.anomalyMultZone" /></p>
        <p>异常暴击区（暴击率=0）：1</p>
        <p>异常暴击区（暴击率=1）：<StatValueWithSources :value="calcParts.anomalyFullCritZone" :groups="valueTips.anomalyCritZone" /></p>
        <p class="result-total">异常伤害（暴击率=0）：<StatValueWithSources :value="formatNumber(calcParts.anomalyExpectedNoCrit)" :groups="valueTips.anomalyExpected" /></p>
        <p class="result-total">异常伤害（暴击率=1）：<StatValueWithSources :value="formatNumber(calcParts.anomalyExpectedFullCrit)" :groups="valueTips.anomalyExpected" /></p>
        </template>

        <template v-else-if="anomalySubKind === 'disorder'">
        <h4 class="result-subsection-title">紊乱期望伤害</h4>
        <p>紊乱基础倍率：<StatValueWithSources :value="calcParts.disorderBaseMultRatio" :groups="valueTips.disorderBaseMult" /></p>
        <p>异常持续时间(有效)：<StatValueWithSources :value="calcParts.effectiveAnomalyDuration" :groups="valueTips.anomalyDuration" /></p>
        <p>紊乱补偿倍率：<StatValueWithSources :value="calcParts.disorderCompMultRatio" :groups="valueTips.disorderCompMult" /></p>
        <p>紊乱倍率区：<StatValueWithSources :value="calcParts.disorderZone" :groups="valueTips.disorderZone" /></p>
        <p>紊乱增伤区：<StatValueWithSources :value="calcParts.disorderDmgBonusZone" :groups="valueTips.disorderDmgBonusZone" /></p>
        <p class="result-total">紊乱期望伤害：<StatValueWithSources :value="Math.round(calcParts.disorderExpected).toLocaleString('en-US')" :groups="valueTips.disorderExpected" /></p>
        </template>

        <template v-else-if="anomalySubKind === 'turbulence'">
        <h4 class="result-subsection-title">乱流伤害</h4>
        <p>乱流基础倍率：<StatValueWithSources :value="calcParts.turbulenceBaseMultRatio" :groups="valueTips.turbulenceBaseMult" /></p>
        <p>异常持续时间(有效)：<StatValueWithSources :value="calcParts.effectiveAnomalyDuration" :groups="valueTips.anomalyDuration" /></p>
        <p>乱流补偿倍率：<StatValueWithSources :value="calcParts.turbulenceCompMultRatio" :groups="valueTips.turbulenceCompMult" /></p>
        <p>乱流倍率区：<StatValueWithSources :value="calcParts.turbulenceZone" :groups="valueTips.turbulenceZone" /></p>
        <p>
          乱流增伤区+异常增伤区：<StatValueWithSources
            :value="calcParts.turbulenceCombinedDmgBonusZone"
            :groups="valueTips.turbulenceCombinedDmgBonusZone"
          />
        </p>
        <p>异常暴击区（暴击率=0）：1</p>
        <p>异常暴击区（暴击率=1）：<StatValueWithSources :value="calcParts.anomalyFullCritZone" :groups="valueTips.anomalyCritZone" /></p>
        <p class="result-total">乱流伤害（暴击率=0）：<StatValueWithSources :value="formatNumber(calcParts.turbulenceExpectedNoCrit)" :groups="valueTips.turbulenceExpected" /></p>
        <p class="result-total">乱流伤害（暴击率=1）：<StatValueWithSources :value="formatNumber(calcParts.turbulenceExpectedFullCrit)" :groups="valueTips.turbulenceExpected" /></p>
        </template>

        <template v-else-if="anomalySubKind === 'anomalyRelease'">
        <h4 class="result-subsection-title">异放伤害</h4>
        <p>
          异放综合增伤区：
          <StatValueWithSources
            :value="formatFormulaNumber(calcParts.anomalyReleaseCombinedDmgBonusZone)"
            :groups="valueTips.anomalyReleaseCombinedDmgBonusZone"
          />
        </p>
        <p>
          异放倍率区：
          <StatValueWithSources
            :value="formatFormulaNumber(calcParts.anomalyReleaseMultZone)"
            :groups="valueTips.anomalyReleaseMultZone"
          />
        </p>
        <p>
          异常综合暴击区公式：1 + ({{ formatFormulaNumber(calcParts.anomalyCombinedCritRateRatio) }})
          × ({{ formatFormulaNumber(calcParts.anomalyCombinedCritDmgRatio) }})
        </p>
        <p>异常综合暴击区（暴击率=0）：1</p>
        <p>
          异常综合暴击区（暴击率=1）：
          <StatValueWithSources
            :value="formatFormulaNumber(calcParts.anomalyCombinedFullCritZone)"
            :groups="valueTips.anomalyCombinedCritZone"
          />
        </p>
        <p class="result-total">
          异放伤害（暴击率=0）：
          <StatValueWithSources
            :value="formatNumber(calcParts.anomalyReleaseExpectedNoCrit)"
            :groups="valueTips.anomalyReleaseExpected"
          />
        </p>
        <p class="result-total">
          异放伤害（暴击率=1）：
          <StatValueWithSources
            :value="formatNumber(calcParts.anomalyReleaseExpectedFullCrit)"
            :groups="valueTips.anomalyReleaseExpected"
          />
        </p>
        </template>

        <template v-else-if="anomalySubKind === 'radiance'">
        <h4 class="result-subsection-title">耀变伤害</h4>
        <p>
          耀变综合增伤区：
          <StatValueWithSources
            :value="formatFormulaNumber(calcParts.radianceCombinedDmgBonusZone)"
            :groups="valueTips.radianceCombinedDmgBonusZone"
          />
        </p>
        <p>
          耀变倍率区：
          <StatValueWithSources
            :value="formatFormulaNumber(calcParts.radianceMultZone)"
            :groups="valueTips.radianceMultZone"
          />
        </p>
        <p class="result-total">
          耀变期望伤害：
          <StatValueWithSources
            :value="formatNumber(calcParts.radianceExpected)"
            :groups="valueTips.radianceExpected"
          />
        </p>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.damage-result-detail {
  display: flex;
  flex-direction: column;
}

.result-section-title {
  margin: 0.85rem 0 0.45rem;
  font-size: 0.88rem;
  color: #e8d4a8;
}

.result-section-title:first-child {
  margin-top: 0;
}

.result-subsection-title {
  grid-column: 1 / -1;
  margin: 0.65rem 0 0.15rem;
  font-size: 0.82rem;
  color: #c9a55c;
  font-weight: 600;
}

.result-subsection-title:first-child {
  margin-top: 0;
}

.formula-block {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0.35rem 0 0.55rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid #2d323a;
  border-radius: 10px;
  background: #0f1217;
}

.formula-label {
  display: inline-block;
  min-width: 6.5em;
  margin-right: 0.45rem;
  color: #e8d4a8;
  font-weight: 600;
}

.formula-block--aligned {
  gap: 0;
}

.formula-aligned-group {
  display: grid;
  grid-template-columns: 6.95em minmax(0, 1fr);
  gap: 0.35rem 0.45rem;
  padding: 0.55rem 0;
  align-items: start;
}

.formula-aligned-group + .formula-aligned-group {
  border-top: 1px solid #252a32;
}

.formula-agent-label {
  color: #6eb6ff;
  font-weight: 600;
}

.formula-aligned-title {
  margin: 0;
  padding-top: 0.15rem;
  line-height: 1.45;
}

.formula-aligned-body {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.35rem 0.45rem;
  min-width: 0;
}

.formula-aligned-term {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  min-width: 0;
}

.formula-aligned-term-label {
  font-size: 0.75rem;
  line-height: 1.35;
  color: #b7c0cd;
  text-align: center;
  white-space: nowrap;
}

.formula-aligned-hint {
  display: block;
  margin-top: 0.15rem;
  color: #8a93a0;
  font-size: 0.68rem;
  font-weight: 400;
  line-height: 1.35;
  white-space: normal;
}

.formula-aligned-term-value {
  font-size: 0.8rem;
  line-height: 1.4;
  color: #d4dbe6;
  text-align: center;
  white-space: nowrap;
}

.formula-aligned-term-value :deep(.stat-value > strong) {
  color: #d4dbe6;
  font-weight: 400;
}

.formula-aligned-op {
  flex: 0 0 auto;
  align-self: center;
  padding-bottom: 0.15rem;
  color: #8a93a0;
  font-size: 0.78rem;
}

.formula-aligned-result {
  flex: 0 0 auto;
  align-self: flex-end;
  padding-bottom: 0.05rem;
  font-size: 0.8rem;
  font-weight: 600;
}

.formula-aligned-dual {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  align-self: flex-end;
}

.formula-aligned-result--dual {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  align-items: flex-start;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.4rem 0.6rem;
  margin-top: 0.35rem;
  font-size: 0.82rem;
  color: #c5cad3;
}

.result-grid p {
  margin: 0;
}

.result-total {
  grid-column: 1 / -1;
  margin-top: 0.3rem !important;
  border-top: 1px solid #2a2f36;
  padding-top: 0.5rem;
}

.result-subtotal {
  grid-column: 1 / -1;
  margin-top: 0.15rem !important;
  border-top: 1px dashed #2a2f36;
  padding-top: 0.35rem;
}

@media (max-width: 980px) {
  .result-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .result-grid {
    grid-template-columns: 1fr;
  }

  .formula-aligned-body {
    flex-wrap: wrap;
    gap: 0.35rem;
  }
}
</style>
