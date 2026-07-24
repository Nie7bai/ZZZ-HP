<script setup lang="ts">
import { computed } from 'vue'
import StatValueWithSources from '@/components/calculator/StatValueWithSources.vue'
import type { PanelStats } from '@/types/calculatorPanel'
import type { DamageCalcResult } from '@/utils/damageCalc'
import type { BuffModSource } from '@/utils/panelBuffCalc'
import {
  buildAtkPanelProcessItems,
  buildEnemyCombatProcessItems,
  buildStatSourceGroups,
  type StatSourceGroup,
} from '@/utils/statSourceTips'

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
  }
  isMb: boolean
  /** direct=通用乘区+直伤；anomaly=通用乘区+异常/紊乱/乱流 */
  show: 'direct' | 'anomaly'
}>()

function round(v: number, p = 2) {
  const f = 10 ** p
  return Math.round(v * f) / f
}

function formatNumber(v: number) {
  return Math.round(v).toLocaleString('en-US')
}

function formatFormulaNumber(v: number, precision = 4) {
  if (!Number.isFinite(v)) return String(v)
  if (Number.isInteger(v) || Math.abs(v) >= 1000) {
    return round(v, Math.abs(v) >= 1000 ? 2 : 0).toLocaleString('en-US')
  }
  const text = round(v, precision).toString()
  return text.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')
}

function formatSigned(value: number) {
  if (value > 0) return `+${value}`
  return String(value)
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
  return [
    formatFormulaNumber(p.generalMultiplier, 2),
    formatFormulaNumber(p.critMultiplier),
    formatFormulaNumber(p.specialMultiplier),
    formatFormulaNumber(p.directDmgMultZone),
  ]
})

const anomalyFormulaParts = computed(() => {
  const p = props.calcParts
  return [
    formatFormulaNumber(p.generalMultiplier, 2),
    formatFormulaNumber(p.masteryZone),
    formatFormulaNumber(p.levelZone),
  ]
})

const anomalyExpectedFormulaParts = computed(() => {
  const p = props.calcParts
  return [
    formatNumber(p.anomalyBaseExpected),
    formatFormulaNumber(p.anomalyDmgBonusZone),
    formatFormulaNumber(p.anomalyMultZone),
    formatFormulaNumber(p.anomalyCritZone),
  ]
})

const disorderFormulaParts = computed(() => {
  const p = props.calcParts
  return [
    formatNumber(p.anomalyBaseExpected),
    formatFormulaNumber(p.disorderZone),
    formatFormulaNumber(p.disorderDmgBonusZone),
  ]
})

const turbulenceFormulaParts = computed(() => {
  const p = props.calcParts
  const parts = [
    formatNumber(p.anomalyBaseExpected),
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
  | 'disorderExpected'
  | 'turbulenceExpected'

const alignedGeneralFormula = computed(() => {
  const p = props.calcParts
  return {
    key: 'generalMultiplier' as AlignedFormulaResultKey,
    title: '公式',
    terms: [
      { label: '基础伤害', value: formatFormulaNumber(p.baseDamage, 2), tipsKey: 'baseDamage' },
      { label: '增伤区', value: formatFormulaNumber(p.dmgMultiplier), tipsKey: 'dmgMultiplier' },
      { label: '防御区', value: formatFormulaNumber(p.defenseMultiplier), tipsKey: 'defenseMultiplier' },
      { label: '抗性区', value: formatFormulaNumber(p.resistanceMultiplier), tipsKey: 'resistanceMultiplier' },
      { label: '易伤区', value: formatFormulaNumber(p.vulnerableMultiplier), tipsKey: 'vulnerableMultiplier' },
      { label: '失衡易伤区', value: formatFormulaNumber(p.staggerMultiplier), tipsKey: 'staggerMultiplier' },
    ] satisfies AlignedFormulaTerm[],
    result: formatNumber(p.generalMultiplier),
  }
})

const alignedDirectFormula = computed(() => {
  const p = props.calcParts
  return {
    key: 'directDamageExpected' as AlignedFormulaResultKey,
    title: '公式',
    terms: [
      { label: '通用乘区', value: formatFormulaNumber(p.generalMultiplier, 2), tipsKey: 'generalMultiplier' },
      { label: '暴击区', value: formatFormulaNumber(p.critMultiplier), tipsKey: 'critMultiplier' },
      { label: '特殊乘区', value: formatFormulaNumber(p.specialMultiplier), tipsKey: 'specialMultiplier' },
      { label: '直伤倍率区', value: formatFormulaNumber(p.directDmgMultZone), tipsKey: 'directDmgMultZone' },
    ] satisfies AlignedFormulaTerm[],
    result: formatNumber(p.directDamageExpected),
  }
})

const alignedAnomalyFormulas = computed(() => {
  const p = props.calcParts
  return [
    {
      key: 'anomalyBaseExpected' as AlignedFormulaResultKey,
      title: '异常基础',
      hint: '（不含异常增伤/倍率/暴击）',
      terms: [
        { label: '通用乘区', value: formatFormulaNumber(p.generalMultiplier, 2), tipsKey: 'generalMultiplier' },
        { label: '精通区', value: formatFormulaNumber(p.masteryZone), tipsKey: 'masteryZone' },
        { label: '等级区', value: formatFormulaNumber(p.levelZone), tipsKey: 'levelZone' },
      ] satisfies AlignedFormulaTerm[],
      result: formatNumber(p.anomalyBaseExpected),
    },
    {
      key: 'anomalyExpected' as AlignedFormulaResultKey,
      title: '异常期望',
      terms: [
        { label: '异常基础期望', value: formatNumber(p.anomalyBaseExpected), tipsKey: 'anomalyBaseExpected' },
        { label: '异常增伤区', value: formatFormulaNumber(p.anomalyDmgBonusZone), tipsKey: 'anomalyDmgBonusZone' },
        { label: '异常倍率区', value: formatFormulaNumber(p.anomalyMultZone), tipsKey: 'anomalyMultZone' },
        { label: '异常暴击区', value: formatFormulaNumber(p.anomalyCritZone), tipsKey: 'anomalyCritZone' },
      ] satisfies AlignedFormulaTerm[],
      result: formatNumber(p.anomalyExpected),
    },
    {
      key: 'disorderExpected' as AlignedFormulaResultKey,
      title: '紊乱期望',
      terms: [
        { label: '异常基础期望', value: formatNumber(p.anomalyBaseExpected), tipsKey: 'anomalyBaseExpected' },
        { label: '紊乱倍率区', value: formatFormulaNumber(p.disorderZone), tipsKey: 'disorderZone' },
        { label: '紊乱增伤区', value: formatFormulaNumber(p.disorderDmgBonusZone), tipsKey: 'disorderDmgBonusZone' },
      ] satisfies AlignedFormulaTerm[],
      result: formatNumber(p.disorderExpected),
    },
    {
      key: 'turbulenceExpected' as AlignedFormulaResultKey,
      title: '乱流期望',
      terms: [
        { label: '异常基础期望', value: formatNumber(p.anomalyBaseExpected), tipsKey: 'anomalyBaseExpected' },
        { label: '乱流倍率区', value: formatFormulaNumber(p.turbulenceZone), tipsKey: 'turbulenceZone' },
        {
          label: '乱流增伤区+异常增伤区',
          value: formatFormulaNumber(p.turbulenceCombinedDmgBonusZone),
          tipsKey: 'turbulenceCombinedDmgBonusZone' as ValueTipsKey,
        },
        ...(p.turbulenceUsesAnomalyCrit
          ? [
              {
                label: '异常暴击区',
                value: formatFormulaNumber(p.anomalyCritZone),
                tipsKey: 'anomalyCritZone' as ValueTipsKey,
              },
            ]
          : []),
      ] satisfies AlignedFormulaTerm[],
      result: formatNumber(p.turbulenceExpected),
    },
  ]
})

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
  const panel = props.finalPanel
  const external = props.externalPanel
  const sources = props.sources
  const enemy = props.enemyInput
  const pierceMod = props.pierceMod

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

  const atkProcessItems = buildAtkPanelProcessItems({
    externalAtk: external.atk,
    finalAtk: panel.atk,
    sources,
  })

  return {
    baseDamage:
      p.baseDamageSource === 'atk'
        ? withTotal(
            atkGroups,
            `局内攻击力 ${formatFormulaNumber(panel.atk, 2)}`,
            atkProcessItems,
          )
        : withTotal(
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
    dmgMultiplier: withTotal(
      buildStatSourceGroups({
        keys: ['dmgBonus'],
        externalPanel: external,
        sources,
        finalValues: { dmgBonus: panel.dmgBonus },
      }),
      `局内增伤 ${formatFormulaNumber(panel.dmgBonus, 2)}% → 增伤区 1 + ${formatFormulaNumber(panel.dmgBonus, 2)}% = ${formatFormulaNumber(p.dmgMultiplier)}`,
    ),
    defenseMultiplier: props.isMb
      ? [{ label: '命破主C', items: ['防御区固定为 1'] }]
      : withTotal(
          buildStatSourceGroups({
            keys: ['reduceDefense', 'penRate'],
            externalPanel: external,
            sources,
            finalValues: { reduceDefense: panel.reduceDefense, penRate: panel.penRate },
            extraGroups: [
              {
                label: '敌方与环境 / 局外面板',
                items: [
                  `敌方防御 ${formatFormulaNumber(enemy.defense, 2)}`,
                  `无视防御 ${formatFormulaNumber(external.ignoreDefense, 2)}%`,
                  `穿透值 ${formatFormulaNumber(external.pen, 2)}`,
                ],
              },
            ],
            showAdditiveProcess: false,
          }),
          `有效防御 ${formatFormulaNumber(p.effectiveDefense, 2)} → 防御区 794 / (794 + ${formatFormulaNumber(p.effectiveDefense, 2)}) = ${formatFormulaNumber(p.defenseMultiplier)}`,
          [
            `有效防御 ${formatFormulaNumber(p.effectiveDefense, 2)}`,
            `794 / (794 + ${formatFormulaNumber(p.effectiveDefense, 2)}) = ${formatFormulaNumber(p.defenseMultiplier)}`,
          ],
        ),
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
          showAdditiveProcess: false,
        }),
      ],
      `抗性区 1 - ${formatFormulaNumber(p.enemyResistance)} + ${formatFormulaNumber(panel.resPen, 2)}% = ${formatFormulaNumber(p.resistanceMultiplier)}`,
      [
        `敌方抗性 ${formatFormulaNumber(p.enemyResistance)}`,
        ...(panel.resPen || sources.some((s) => s.mods.resPen)
          ? [
              `局内抗穿 ${formatFormulaNumber(panel.resPen, 2)}%`,
              ...sources
                .filter((s) => s.mods.resPen)
                .map((s) => `${s.label} ${formatSigned(s.mods.resPen)}%`),
            ]
          : []),
        `1 - ${formatFormulaNumber(p.enemyResistance)} + ${formatFormulaNumber(panel.resPen, 2)}% = ${formatFormulaNumber(p.resistanceMultiplier)}`,
      ],
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
          `合计 ${formatNumber(p.generalMultiplier)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `${generalFormulaParts.value[0]} × ${generalFormulaParts.value[1]} × ${generalFormulaParts.value[2]} × ${generalFormulaParts.value[3]} × ${generalFormulaParts.value[4]} × ${generalFormulaParts.value[5]}`,
          `= ${formatNumber(p.generalMultiplier)}`,
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
    directDmgMultZone: withTotal(
      buildStatSourceGroups({
        keys: ['directDmgMult'],
        externalPanel: external,
        sources,
        finalValues: { directDmgMult: panel.directDmgMult },
      }),
      `直伤倍率区 ${formatFormulaNumber(panel.directDmgMult, 2)}% = ${formatFormulaNumber(p.directDmgMultZone)}`,
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
        keys: ['reduceDefense', 'penRate'],
        externalPanel: external,
        sources,
        finalValues: { reduceDefense: panel.reduceDefense, penRate: panel.penRate },
        extraGroups: [
          {
            label: '敌方与环境 / 局外面板',
            items: [
              `敌方防御 ${formatFormulaNumber(enemy.defense, 2)}`,
              `无视防御 ${formatFormulaNumber(external.ignoreDefense, 2)}%`,
              `穿透值 ${formatFormulaNumber(external.pen, 2)}`,
            ],
          },
        ],
        showAdditiveProcess: false,
      }),
      `有效防御 ${formatFormulaNumber(p.effectiveDefense, 2)}`,
      [
        `敌方防御 ${formatFormulaNumber(enemy.defense, 2)}`,
        `无视防御 ${formatFormulaNumber(external.ignoreDefense, 2)}%`,
        `减防 ${formatFormulaNumber(panel.reduceDefense, 2)}%`,
        `穿透率 ${formatFormulaNumber(panel.penRate, 2)}%`,
        `穿透值 ${formatFormulaNumber(external.pen, 2)}`,
        `防御因子 ${formatFormulaNumber(p.defenseFactor)}`,
        `折后防御 ${formatFormulaNumber(enemy.defense * p.defenseFactor * (1 - p.penRateRatio), 2)}`,
        `折后防御 - 穿透值 = ${formatFormulaNumber(p.effectiveDefense, 2)}`,
      ],
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
          `直伤倍率区 ${directFormulaParts.value[3]}`,
          `合计 ${formatNumber(p.directDamageExpected)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `${directFormulaParts.value[0]} × ${directFormulaParts.value[1]} × ${directFormulaParts.value[2]} × ${directFormulaParts.value[3]}`,
          `= ${formatNumber(p.directDamageExpected)}`,
        ],
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
        label: '敌方与环境',
        items: [
          `代理人等级 ${Math.round(enemy.level)}`,
          `等级区 ${formatFormulaNumber(p.levelZone)} = 1 + (${Math.round(enemy.level)} - 1) / 59`,
        ],
      },
    ],
    anomalyDmgBonusZone: withTotal(
      buildStatSourceGroups({
        keys: ['anomalyDmgBonus'],
        externalPanel: external,
        sources,
        finalValues: { anomalyDmgBonus: panel.anomalyDmgBonus },
      }),
      `异常增伤区 1 + ${formatFormulaNumber(panel.anomalyDmgBonus, 2)}% = ${formatFormulaNumber(p.anomalyDmgBonusZone)}`,
    ),
    anomalyMultZone: withTotal(
      buildStatSourceGroups({
        keys: ['anomalyMult'],
        externalPanel: external,
        sources,
        finalValues: { anomalyMult: panel.anomalyMult },
      }),
      `异常倍率区 ${formatFormulaNumber(panel.anomalyMult, 2)}% = ${formatFormulaNumber(p.anomalyMultZone)}`,
    ),
    anomalyCritZone: withTotal(
      buildStatSourceGroups({
        keys: ['anomalyCritRate', 'anomalyCritDmg'],
        externalPanel: external,
        sources,
        finalValues: {
          anomalyCritRate: panel.anomalyCritRate,
          anomalyCritDmg: panel.anomalyCritDmg,
        },
      }),
      `异常暴击区 1 + ${formatFormulaNumber(p.anomalyCritRateRatio)} × ${formatFormulaNumber(p.anomalyCritDmgRatio)} = ${formatFormulaNumber(p.anomalyCritZone)}`,
    ),
    anomalyBaseExpected: [
      {
        label: '乘区组成（不含异常增伤/倍率/暴击）',
        items: [
          `通用乘区 ${anomalyFormulaParts.value[0]}`,
          `精通区 ${anomalyFormulaParts.value[1]}`,
          `等级区 ${anomalyFormulaParts.value[2]}`,
          `合计 ${formatNumber(p.anomalyBaseExpected)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `${anomalyFormulaParts.value.join(' × ')}`,
          `= ${formatNumber(p.anomalyBaseExpected)}`,
        ],
      },
    ],
    anomalyExpected: [
      {
        label: '乘区组成（含异常增伤/倍率/暴击）',
        items: [
          `异常基础期望 ${anomalyExpectedFormulaParts.value[0]}`,
          `异常增伤区 ${anomalyExpectedFormulaParts.value[1]}`,
          `异常倍率区 ${anomalyExpectedFormulaParts.value[2]}`,
          `异常暴击区 ${anomalyExpectedFormulaParts.value[3]}`,
          `合计 ${formatNumber(p.anomalyExpected)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `${anomalyExpectedFormulaParts.value.join(' × ')}`,
          `= ${formatNumber(p.anomalyExpected)}`,
        ],
      },
    ],
    disorderBaseMult: withTotal(
      buildStatSourceGroups({
        keys: ['disorderBaseMult'],
        externalPanel: external,
        sources,
        finalValues: { disorderBaseMult: panel.disorderBaseMult },
      }),
      `紊乱基础倍率 ${formatFormulaNumber(panel.disorderBaseMult, 2)}% = ${formatFormulaNumber(p.disorderBaseMultRatio)}`,
    ),
    anomalyDuration: withTotal(
      buildStatSourceGroups({
        keys: ['anomalyDuration'],
        externalPanel: external,
        sources,
        finalValues: { anomalyDuration: panel.anomalyDuration },
      }),
      `异常持续时间 ${formatFormulaNumber(panel.anomalyDuration, 2)}s → 有效 ${formatFormulaNumber(p.effectiveAnomalyDuration)}s`,
    ),
    disorderCompMult: withTotal(
      buildStatSourceGroups({
        keys: ['disorderCompMult'],
        externalPanel: external,
        sources,
        finalValues: { disorderCompMult: panel.disorderCompMult },
      }),
      `紊乱补偿倍率 ${formatFormulaNumber(panel.disorderCompMult, 2)}% = ${formatFormulaNumber(p.disorderCompMultRatio)}`,
    ),
    disorderDmgBonusZone: withTotal(
      buildStatSourceGroups({
        keys: ['disorderDmgBonus'],
        externalPanel: external,
        sources,
        finalValues: { disorderDmgBonus: panel.disorderDmgBonus },
      }),
      `紊乱增伤区 1 + ${formatFormulaNumber(panel.disorderDmgBonus, 2)}% = ${formatFormulaNumber(p.disorderDmgBonusZone)}`,
    ),
    disorderZone: [
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
          `异常基础期望 ${formatNumber(p.anomalyBaseExpected)}`,
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
      buildStatSourceGroups({
        keys: ['turbulenceBaseMult'],
        externalPanel: external,
        sources,
        finalValues: { turbulenceBaseMult: panel.turbulenceBaseMult },
      }),
      `乱流基础倍率 ${formatFormulaNumber(panel.turbulenceBaseMult, 2)}% = ${formatFormulaNumber(p.turbulenceBaseMultRatio)}`,
    ),
    turbulenceCompMult: withTotal(
      buildStatSourceGroups({
        keys: ['turbulenceCompMult'],
        externalPanel: external,
        sources,
        finalValues: { turbulenceCompMult: panel.turbulenceCompMult },
      }),
      `乱流补偿倍率 ${formatFormulaNumber(panel.turbulenceCompMult, 2)}% = ${formatFormulaNumber(p.turbulenceCompMultRatio)}`,
    ),
    turbulenceDmgBonusZone: withTotal(
      buildStatSourceGroups({
        keys: ['turbulenceDmgBonus'],
        externalPanel: external,
        sources,
        finalValues: { turbulenceDmgBonus: panel.turbulenceDmgBonus },
      }),
      `乱流增伤区 1 + ${formatFormulaNumber(panel.turbulenceDmgBonus, 2)}% = ${formatFormulaNumber(p.turbulenceDmgBonusZone)}`,
    ),
    turbulenceZone: [
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
          `1 + ${formatFormulaNumber(panel.turbulenceDmgBonus, 2)}% + ${formatFormulaNumber(panel.anomalyDmgBonus, 2)}%`,
          `= ${formatFormulaNumber(p.turbulenceCombinedDmgBonusZone)}`,
        ],
      },
    ],
    turbulenceExpected: [
      {
        label: '乘区组成',
        items: [
          `异常基础期望 ${formatNumber(p.anomalyBaseExpected)}`,
          `乱流倍率区 ${formatFormulaNumber(p.turbulenceZone)}`,
          `乱流增伤区+异常增伤区 ${formatFormulaNumber(p.turbulenceCombinedDmgBonusZone)}`,
          ...(p.turbulenceUsesAnomalyCrit
            ? [`异常暴击区 ${formatFormulaNumber(p.anomalyCritZone)}`]
            : []),
          `合计 ${formatNumber(p.turbulenceExpected)}`,
        ],
      },
      {
        label: '加减过程',
        fullWidth: true,
        items: [
          `${turbulenceFormulaParts.value.join(' × ')}`,
          `= ${formatNumber(p.turbulenceExpected)}`,
        ],
      },
    ],
  }
})
</script>

<template>
  <div class="damage-result-detail">
    <h3 class="result-section-title">通用乘区</h3>
    <div class="formula-block formula-block--aligned">
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
    <div class="result-grid">
      <p>基础伤害（局内）：<StatValueWithSources :value="calcParts.baseDamage" :groups="valueTips.baseDamage" /></p>
      <p>增伤区：<StatValueWithSources :value="calcParts.dmgMultiplier" :groups="valueTips.dmgMultiplier" /></p>
      <p>防御区：<StatValueWithSources :value="calcParts.defenseMultiplier" :groups="valueTips.defenseMultiplier" /></p>
      <p>抗性区：<StatValueWithSources :value="calcParts.resistanceMultiplier" :groups="valueTips.resistanceMultiplier" /></p>
      <p>易伤区（含增益）：<StatValueWithSources :value="calcParts.vulnerableMultiplier" :groups="valueTips.vulnerableMultiplier" /></p>
      <p>失衡易伤区（含增益）：<StatValueWithSources :value="calcParts.staggerMultiplier" :groups="valueTips.staggerMultiplier" /></p>
      <p class="result-subtotal">通用乘区：<StatValueWithSources :value="Math.round(calcParts.generalMultiplier).toLocaleString('en-US')" :groups="valueTips.generalMultiplier" /></p>
    </div>

    <template v-if="show === 'direct'">
      <h3 class="result-section-title">直伤期望伤害</h3>
      <div class="formula-block formula-block--aligned">
        <div class="formula-aligned-group">
          <span class="formula-label formula-aligned-title">{{ alignedDirectFormula.title }}</span>
          <div class="formula-aligned-body">
            <template
              v-for="(term, index) in alignedDirectFormula.terms"
              :key="`direct-${term.label}`"
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
                :value="alignedDirectFormula.result"
                :groups="valueTips[alignedDirectFormula.key]"
              />
            </div>
          </div>
        </div>
      </div>
      <div class="result-grid">
        <p>暴击率（计入上限 1）：<StatValueWithSources :value="calcParts.critRateRatio" :groups="valueTips.critRateRatio" /></p>
        <p>暴击区：<StatValueWithSources :value="calcParts.critMultiplier" :groups="valueTips.critMultiplier" /></p>
        <p>特殊乘区（含增益）：<StatValueWithSources :value="calcParts.specialMultiplier" :groups="valueTips.specialMultiplier" /></p>
        <p>直伤倍率区：<StatValueWithSources :value="calcParts.directDmgMultZone" :groups="valueTips.directDmgMultZone" /></p>
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
            <div class="formula-aligned-result">
              <StatValueWithSources :value="group.result" :groups="valueTips[group.key]" />
            </div>
          </div>
        </div>
      </div>
      <div class="result-grid">
        <h4 class="result-subsection-title">异常基础期望</h4>
        <p>精通区：<StatValueWithSources :value="calcParts.masteryZone" :groups="valueTips.masteryZone" /></p>
        <p>等级区：<StatValueWithSources :value="calcParts.levelZone" :groups="valueTips.levelZone" /></p>
        <p class="result-total">异常基础期望：<StatValueWithSources :value="Math.round(calcParts.anomalyBaseExpected).toLocaleString('en-US')" :groups="valueTips.anomalyBaseExpected" /></p>

        <h4 class="result-subsection-title">异常期望伤害</h4>
        <p>异常增伤区：<StatValueWithSources :value="calcParts.anomalyDmgBonusZone" :groups="valueTips.anomalyDmgBonusZone" /></p>
        <p>异常倍率区：<StatValueWithSources :value="calcParts.anomalyMultZone" :groups="valueTips.anomalyMultZone" /></p>
        <p>异常暴击区：<StatValueWithSources :value="calcParts.anomalyCritZone" :groups="valueTips.anomalyCritZone" /></p>
        <p class="result-total">异常期望伤害：<StatValueWithSources :value="Math.round(calcParts.anomalyExpected).toLocaleString('en-US')" :groups="valueTips.anomalyExpected" /></p>

        <h4 class="result-subsection-title">紊乱期望伤害</h4>
        <p>紊乱基础倍率：<StatValueWithSources :value="calcParts.disorderBaseMultRatio" :groups="valueTips.disorderBaseMult" /></p>
        <p>异常持续时间(有效)：<StatValueWithSources :value="calcParts.effectiveAnomalyDuration" :groups="valueTips.anomalyDuration" /></p>
        <p>紊乱补偿倍率：<StatValueWithSources :value="calcParts.disorderCompMultRatio" :groups="valueTips.disorderCompMult" /></p>
        <p>紊乱倍率区：<StatValueWithSources :value="calcParts.disorderZone" :groups="valueTips.disorderZone" /></p>
        <p>紊乱增伤区：<StatValueWithSources :value="calcParts.disorderDmgBonusZone" :groups="valueTips.disorderDmgBonusZone" /></p>
        <p class="result-total">紊乱期望伤害：<StatValueWithSources :value="Math.round(calcParts.disorderExpected).toLocaleString('en-US')" :groups="valueTips.disorderExpected" /></p>

        <h4 class="result-subsection-title">乱流期望伤害</h4>
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
        <p v-if="calcParts.turbulenceUsesAnomalyCrit">
          异常暴击区：<StatValueWithSources :value="calcParts.anomalyCritZone" :groups="valueTips.anomalyCritZone" />
        </p>
        <p class="result-total">乱流期望伤害：<StatValueWithSources :value="Math.round(calcParts.turbulenceExpected).toLocaleString('en-US')" :groups="valueTips.turbulenceExpected" /></p>
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
