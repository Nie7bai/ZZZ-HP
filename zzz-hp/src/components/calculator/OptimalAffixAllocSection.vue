<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import ExtraBuffGainEditor, {
  type ExtraBuffGain,
} from '@/components/calculator/ExtraBuffGainEditor.vue'
import BuffModSourcesDisplay from '@/components/calculator/BuffModSourcesDisplay.vue'
import DamageResultDetail from '@/components/calculator/DamageResultDetail.vue'
import OptimalBenefitCurveChart from '@/components/calculator/OptimalBenefitCurveChart.vue'
import OptimalDamageBarChart from '@/components/calculator/OptimalDamageBarChart.vue'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type {
  AgentBuffDoc,
  BangbooBuffDoc,
  BuffStatKey,
  DriveDiscBuffDoc,
  WengineBuffDoc,
} from '@/types/calculator'
import {
  createDefaultAffixDriveDiscMainStats,
  type AffixDriveDiscMainStats,
  type PanelStats,
} from '@/types/calculatorPanel'
import {
  AFFIX_DRIVE_DISC_SLOT_1_HP,
  AFFIX_DRIVE_DISC_SLOT_2_ATK,
  DRIVE_DISC_SLOT_4_OPTIONS,
  DRIVE_DISC_SLOT_5_OPTIONS,
  DRIVE_DISC_SLOT_6_OPTIONS,
} from '@/utils/affixDriveDiscConfig'
import {
  BUFF_STAT_FIELDS,
  buffStatFieldLabel,
  createEmptyBuffStatModifiers,
  createEmptyRefinementMods,
  mergeBuffStatModifiers,
} from '@/utils/calculatorUi'
import type { DamageCalcResult, EnemyResistanceType } from '@/utils/damageCalc'
import {
  ANOMALY_CONSTRAINTS,
  BENEFIT_CURVE_MAX_ADDED,
  DIRECT_CONSTRAINTS,
  buildOptimalEvalContext,
  computeBenefitCurves,
  computeDiffAnalysis,
  evaluateAffixCounts,
  findMinCritRollsForOvercap,
  flatStatLabel,
  outPercentLabel,
  sweepAnomalyDamage,
  sweepDirectDamage,
  validateAnomalyAlloc,
  validateDirectAlloc,
  type AnomalyAllocState,
  type AnomalySweepPoint,
  type DirectAllocState,
  type DirectSweepPoint,
  type OptimalDamageKind,
} from '@/utils/optimalAffixAlloc'
import {
  ENEMY_DEFENSE_PRESETS,
  STAGGER_MULTIPLIER_PRESETS,
} from '@/utils/enemyInputPresets'
import EnemyPresetCombo from '@/components/calculator/EnemyPresetCombo.vue'

const MB_PROFESSION = '命破'

const PANEL_FIELDS: { key: keyof PanelStats; label: string }[] = [
  { key: 'hp', label: '生命值' },
  { key: 'atk', label: '攻击力' },
  { key: 'critRate', label: '暴击率%' },
  { key: 'critDmg', label: '暴伤%' },
  { key: 'dmgBonus', label: '增伤%' },
  { key: 'ignoreDefense', label: '无视防御%' },
  { key: 'reduceDefense', label: '减防%' },
  { key: 'penRate', label: '穿透率%' },
  { key: 'pen', label: '穿透值' },
  { key: 'resPen', label: '抗穿%' },
  { key: 'mastery', label: '精通' },
  { key: 'anomalyCritRate', label: '异常暴击%' },
  { key: 'anomalyCritDmg', label: '异常爆伤%' },
  { key: 'anomalyDmgBonus', label: '异常增伤%' },
  { key: 'directDmgMult', label: '直伤倍率%' },
  { key: 'anomalyMult', label: '异常倍率%' },
  { key: 'disorderBaseMult', label: '紊乱基础倍率%' },
  { key: 'anomalyDuration', label: '异常持续时间(s)' },
  { key: 'disorderCompMult', label: '紊乱补偿倍率%' },
  { key: 'turbulenceBaseMult', label: '乱流基础倍率%' },
  { key: 'turbulenceCompMult', label: '乱流补偿倍率%' },
  { key: 'disorderDmgBonus', label: '紊乱增伤%' },
  { key: 'turbulenceDmgBonus', label: '乱流增伤%' },
]

type FinalPanelField =
  | { id: string; label: string; kind: 'stat'; key: keyof PanelStats }
  | { id: string; label: string; kind: 'defenseMerged' }
  | { id: string; label: string; kind: 'special' }
  | { id: string; label: string; kind: 'pierce' }

const FINAL_PANEL_FIELDS: FinalPanelField[] = [
  { id: 'hp', label: '生命值', kind: 'stat', key: 'hp' },
  { id: 'atk', label: '攻击力', kind: 'stat', key: 'atk' },
  { id: 'critRate', label: '暴击率%', kind: 'stat', key: 'critRate' },
  { id: 'critDmg', label: '暴伤%', kind: 'stat', key: 'critDmg' },
  { id: 'dmgBonus', label: '增伤%', kind: 'stat', key: 'dmgBonus' },
  { id: 'defenseMerged', label: '无视防御/减防%', kind: 'defenseMerged' },
  { id: 'penRate', label: '穿透率%', kind: 'stat', key: 'penRate' },
  { id: 'pen', label: '穿透值', kind: 'stat', key: 'pen' },
  { id: 'resPen', label: '抗穿%', kind: 'stat', key: 'resPen' },
  { id: 'special', label: '特殊补充%', kind: 'special' },
  { id: 'mastery', label: '精通', kind: 'stat', key: 'mastery' },
  { id: 'anomalyCritRate', label: '异常暴击%', kind: 'stat', key: 'anomalyCritRate' },
  { id: 'anomalyCritDmg', label: '异常爆伤%', kind: 'stat', key: 'anomalyCritDmg' },
  { id: 'anomalyDmgBonus', label: '异常增伤%', kind: 'stat', key: 'anomalyDmgBonus' },
  { id: 'directDmgMult', label: '直伤倍率%', kind: 'stat', key: 'directDmgMult' },
  { id: 'anomalyMult', label: '异常倍率%', kind: 'stat', key: 'anomalyMult' },
  { id: 'disorderBaseMult', label: '紊乱基础倍率%', kind: 'stat', key: 'disorderBaseMult' },
  { id: 'anomalyDuration', label: '异常持续时间(s)', kind: 'stat', key: 'anomalyDuration' },
  { id: 'disorderCompMult', label: '紊乱补偿倍率%', kind: 'stat', key: 'disorderCompMult' },
  { id: 'turbulenceBaseMult', label: '乱流基础倍率%', kind: 'stat', key: 'turbulenceBaseMult' },
  { id: 'turbulenceCompMult', label: '乱流补偿倍率%', kind: 'stat', key: 'turbulenceCompMult' },
  { id: 'disorderDmgBonus', label: '紊乱增伤%', kind: 'stat', key: 'disorderDmgBonus' },
  { id: 'turbulenceDmgBonus', label: '乱流增伤%', kind: 'stat', key: 'turbulenceDmgBonus' },
  { id: 'pierce', label: '贯穿力', kind: 'pierce' },
]

const EXTERNAL_PANEL_FIELDS = PANEL_FIELDS.filter(
  (field) =>
    field.key !== 'anomalyCritRate' &&
    field.key !== 'anomalyCritDmg' &&
    field.key !== 'anomalyDmgBonus' &&
    field.key !== 'disorderDmgBonus' &&
    field.key !== 'turbulenceDmgBonus' &&
    field.key !== 'ignoreDefense' &&
    field.key !== 'reduceDefense' &&
    field.key !== 'resPen',
)

const props = defineProps<{
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  wengines: WengineBuffDoc[]
  bangboos: BangbooBuffDoc[]
  driveDiscs: DriveDiscBuffDoc[]
  selectedBangbooId: string
  bangbooRefine: number
  damageKind?: import('@/utils/optimalAffixAlloc').OptimalDamageKind
  skillCategoryId?: import('@/types/calculator').SkillCategoryId
  skillSubcategoryId?: string | null
  buffSelection?: import('@/utils/panelBuffCalc').BuffSelectionState | null
  staggerPhase?: import('@/types/calculator').StaggerPhase
}>()

const emptyBangboo: BangbooBuffDoc = {
  id: 'none',
  name: '未选择',
  avatar_image: null,
  effects: [],
  refinementEffects: createEmptyRefinementMods().map(() => []),
  fixedMods: createEmptyBuffStatModifiers(),
  refinementMods: createEmptyRefinementMods(),
}

type DetailTab = 'diff' | 'process' | 'curve'
type AnomalyMetric = 'anomaly' | 'disorder' | 'turbulence'
type CurveMode = 'cumulative' | 'marginal'

const damageKind = computed(() => props.damageKind ?? 'direct')
const baseDamageSource = ref<'atk' | 'pierce'>('atk')
const driveDiscMainStats = reactive(createDefaultAffixDriveDiscMainStats())
const extraGains = ref<ExtraBuffGain[]>([])
const extraMods = computed(() => {
  let total = createEmptyBuffStatModifiers()
  const phase = props.staggerPhase ?? 'stagger'
  for (const gain of extraGains.value) {
    const situation = gain.applySituation ?? 'global'
    if (situation === 'stagger' && phase !== 'stagger') continue
    if (situation === 'non_stagger' && phase !== 'normal') continue
    const next = createEmptyBuffStatModifiers()
    next[gain.stat as BuffStatKey] = gain.value
    total = mergeBuffStatModifiers(total, next)
  }
  return total
})
const enemyInput = reactive({
  defense: 953,
  resistanceType: 'normal' as EnemyResistanceType,
  vulnerableMultiplier: 1,
  staggerMultiplier: 1,
  specialMultiplier: 1,
  level: 60,
})

const directAlloc = reactive<DirectAllocState>({
  flatStat: 0,
  pen: 0,
  critRate: 0,
  totalRolls: 0,
})

const anomalyAlloc = reactive<AnomalyAllocState>({
  flatStat: 0,
  pen: 0,
  totalRolls: 0,
})

const selectedIndex = ref<number | null>(null)
/** 记录选中柱体对应的扫掠分配，调整小词条后尽量保持同一分配 */
const selectedSweepKey = ref<{ outPercent: number; secondary: number } | null>(null)
const detailTab = ref<DetailTab>('diff')
const anomalyChartMetric = ref<AnomalyMetric>('anomaly')
const curveMode = ref<CurveMode>('cumulative')
/** 异常模式三张图共享的悬停索引，实现联动 */
const anomalyHoverIndex = ref<number | null>(null)

const mainSlotIndex = computed(() => {
  const index = props.teamSlots.findIndex((slot) => slot.isMainC)
  return index >= 0 ? index : 0
})

const mainSlot = computed(() => props.teamSlots[mainSlotIndex.value]!)

const mainAgent = computed(() => props.agents.find((item) => item.id === mainSlot.value.agentId))

const isMb = computed(() => mainAgent.value?.profession === MB_PROFESSION)

const selectedBangboo = computed(
  () =>
    props.bangboos.find((item) => item.id === props.selectedBangbooId) ??
    props.bangboos.find((item) => item.id === 'none') ??
    emptyBangboo,
)

const evalCtx = computed(() =>
  buildOptimalEvalContext({
    isMb: isMb.value,
    teamSlots: props.teamSlots,
    agents: props.agents,
    wengines: props.wengines,
    bangboo: selectedBangboo.value,
    bangbooRefine: props.bangbooRefine,
    driveDiscs: props.driveDiscs,
    mainSlotIndex: mainSlotIndex.value,
    driveDiscMainStats: { ...driveDiscMainStats },
    enemyInput: { ...enemyInput },
    baseDamageSource: isMb.value ? 'pierce' : baseDamageSource.value,
    extraMods: { ...extraMods.value },
    skillContext: {
      damageKind: damageKind.value,
      categoryId: props.skillCategoryId ?? 'basic',
      subcategoryId: props.skillSubcategoryId ?? null,
      element: mainAgent.value?.element,
      staggerPhase: props.staggerPhase ?? 'stagger',
    },
    buffSelection: props.buffSelection ?? null,
  }),
)

const flatLabel = computed(() => flatStatLabel(isMb.value))
const outLabel = computed(() => outPercentLabel(isMb.value))

const directError = computed(() => validateDirectAlloc(directAlloc, isMb.value))
const anomalyError = computed(() => validateAnomalyAlloc(anomalyAlloc, isMb.value))

const directPoints = computed<DirectSweepPoint[]>(() => {
  if (directError.value) return []
  return sweepDirectDamage(evalCtx.value, { ...directAlloc })
})

const anomalyPoints = computed<AnomalySweepPoint[]>(() => {
  if (anomalyError.value) return []
  return sweepAnomalyDamage(evalCtx.value, { ...anomalyAlloc })
})

const barLabels = computed(() =>
  damageKind.value === 'direct'
    ? directPoints.value.map((p) => `${p.outPercent}/${p.critDmg}`)
    : anomalyPoints.value.map((p) => `${p.outPercent}/${p.mastery}`),
)

const directBarSeries = computed(() => [
  {
    key: 'direct',
    label: '直伤期望',
    color: '#7dd3a0',
    values: directPoints.value.map((p) => p.directExpected),
  },
])

const anomalyChartList = computed(() => [
  {
    key: 'anomaly',
    title: '异常期望伤害',
    series: [
      {
        key: 'anomaly',
        label: '异常期望',
        color: '#abb2bf',
        values: anomalyPoints.value.map((p) => p.anomalyExpected),
      },
    ],
  },
  {
    key: 'disorder',
    title: '紊乱期望伤害',
    series: [
      {
        key: 'disorder',
        label: '紊乱期望',
        color: '#c678dd',
        values: anomalyPoints.value.map((p) => p.disorderExpected),
      },
    ],
  },
  {
    key: 'turbulence',
    title: '乱流期望伤害',
    series: [
      {
        key: 'turbulence',
        label: '乱流期望',
        color: '#6eb6ff',
        values: anomalyPoints.value.map((p) => p.turbulenceExpected),
      },
    ],
  },
])

const selectedDirect = computed(() => {
  if (selectedIndex.value == null) return null
  return directPoints.value[selectedIndex.value] ?? null
})

const selectedAnomaly = computed(() => {
  if (selectedIndex.value == null) return null
  return anomalyPoints.value[selectedIndex.value] ?? null
})

const selectedCounts = computed(() => {
  if (damageKind.value === 'direct') return selectedDirect.value?.affixCounts ?? null
  return selectedAnomaly.value?.affixCounts ?? null
})

const selectedEval = computed(() => {
  if (!selectedCounts.value) return null
  return evaluateAffixCounts(evalCtx.value, selectedCounts.value)
})

/** 面板展示用：未选中柱体时按第一个扫掠点（分配全部给爆伤/精通）展示 */
const displayCounts = computed(() => {
  if (selectedCounts.value) return selectedCounts.value
  if (damageKind.value === 'direct') return directPoints.value[0]?.affixCounts ?? null
  return anomalyPoints.value[0]?.affixCounts ?? null
})

const displayEval = computed(() => {
  if (!displayCounts.value) return null
  return evaluateAffixCounts(evalCtx.value, displayCounts.value)
})

const displayExternalPierce = computed(() => {
  const ext = displayEval.value?.external
  if (!ext) return 0
  return Math.round((0.1 * ext.hp + 0.3 * ext.atk) * 100) / 100
})

function formatPanelValue(key: keyof PanelStats | 'pierce' | 'special', value: number) {
  if (
    key === 'hp' ||
    key === 'atk' ||
    key === 'pen' ||
    key === 'mastery' ||
    key === 'pierce' ||
    key === 'anomalyDuration'
  ) {
    return formatNumber(value)
  }
  return Math.round(value * 100) / 100
}

function formatFinalPanelField(field: FinalPanelField) {
  const evalResult = displayEval.value
  if (!evalResult) return '—'
  if (field.kind === 'stat') {
    return formatPanelValue(field.key, evalResult.finalPanel[field.key])
  }
  if (field.kind === 'defenseMerged') {
    return formatPanelValue(
      'reduceDefense',
      evalResult.finalPanel.ignoreDefense + evalResult.finalPanel.reduceDefense,
    )
  }
  if (field.kind === 'special') {
    return formatPanelValue('special', evalResult.breakdown.combatMods.special)
  }
  return formatPanelValue('pierce', evalResult.piercePower)
}

const diffAnalysis = computed(() => {
  if (!selectedCounts.value) return null
  return computeDiffAnalysis(
    evalCtx.value,
    selectedCounts.value,
    damageKind.value,
    anomalyChartMetric.value,
  )
})

function metricOf(result: DamageCalcResult) {
  if (damageKind.value === 'direct') return result.directDamageExpected
  if (anomalyChartMetric.value === 'disorder') return result.disorderExpected
  if (anomalyChartMetric.value === 'turbulence') return result.turbulenceExpected
  return result.anomalyExpected
}

const MAIN_STAT_SLOTS = [
  { key: 'slot4MainStat', title: '4号位', options: DRIVE_DISC_SLOT_4_OPTIONS },
  { key: 'slot5MainStat', title: '5号位', options: DRIVE_DISC_SLOT_5_OPTIONS },
  { key: 'slot6MainStat', title: '6号位', options: DRIVE_DISC_SLOT_6_OPTIONS },
] as const

/** 主词条差异计算：逐槽位把当前主属性换成其他候选并对比伤害 */
const mainStatDiff = computed(() => {
  const counts = selectedCounts.value
  const base = selectedEval.value
  if (!counts || !base) return null
  const baseDmg = metricOf(base.result)

  return MAIN_STAT_SLOTS.map(({ key, title, options }) => {
    const currentId = driveDiscMainStats[key]
    const current = options.find((o) => o.id === currentId)
    const rows = options
      .filter((o) => o.id !== currentId)
      .map((o) => {
        const ctx2 = {
          ...evalCtx.value,
          driveDiscMainStats: {
            ...evalCtx.value.driveDiscMainStats,
            [key]: o.id,
          } as AffixDriveDiscMainStats,
        }
        const evaled = evaluateAffixCounts(ctx2, counts)
        const dmg = metricOf(evaled.result)
        const delta = dmg - baseDmg
        return {
          id: o.id,
          label: o.label,
          damageDelta: delta,
          percentDelta: baseDmg > 0 ? (delta / baseDmg) * 100 : 0,
        }
      })
    return { key, title, currentLabel: current?.label ?? '—', rows }
  })
})

const benefitData = computed(() => {
  if (!selectedCounts.value) return null
  return computeBenefitCurves(
    evalCtx.value,
    selectedCounts.value,
    damageKind.value,
    anomalyChartMetric.value,
    BENEFIT_CURVE_MAX_ADDED,
  )
})

const remainDirect = computed(() =>
  Math.max(0, Math.round(directAlloc.totalRolls) - Math.round(directAlloc.critRate)),
)

function formatNumber(v: number) {
  return Math.round(v).toLocaleString('en-US')
}

function formatDelta(v: number, digits = 3) {
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}`
}

function formatPercent(v: number) {
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(3)}%`
}

function sweepKeyFromIndex(index: number) {
  if (damageKind.value === 'direct') {
    const point = directPoints.value[index]
    return point ? { outPercent: point.outPercent, secondary: point.critDmg } : null
  }
  const point = anomalyPoints.value[index]
  return point ? { outPercent: point.outPercent, secondary: point.mastery } : null
}

function findIndexForSweepKey(key: { outPercent: number; secondary: number } | null) {
  if (!key) return null
  if (damageKind.value === 'direct') {
    const idx = directPoints.value.findIndex(
      (point) => point.outPercent === key.outPercent && point.critDmg === key.secondary,
    )
    return idx >= 0 ? idx : null
  }
  const idx = anomalyPoints.value.findIndex(
    (point) => point.outPercent === key.outPercent && point.mastery === key.secondary,
  )
  return idx >= 0 ? idx : null
}

function syncSelectedBarAfterSweep() {
  if (selectedSweepKey.value) {
    const idx = findIndexForSweepKey(selectedSweepKey.value)
    if (idx != null) {
      selectedIndex.value = idx
      return
    }
  }
  const points = damageKind.value === 'direct' ? directPoints.value : anomalyPoints.value
  if (selectedIndex.value == null) return
  if (!points.length) {
    selectedIndex.value = null
    selectedSweepKey.value = null
    return
  }
  if (selectedIndex.value >= points.length) {
    selectedIndex.value = points.length - 1
    selectedSweepKey.value = sweepKeyFromIndex(selectedIndex.value)
  }
}

function clearBarSelection() {
  selectedIndex.value = null
  selectedSweepKey.value = null
}

function selectBar(index: number) {
  selectedIndex.value = index
  selectedSweepKey.value = sweepKeyFromIndex(index)
  detailTab.value = 'diff'
}

function applyDefaultCrit() {
  const crit = findMinCritRollsForOvercap(evalCtx.value, {
    flatStat: directAlloc.flatStat,
    pen: directAlloc.pen,
  })
  directAlloc.critRate = crit
  directAlloc.totalRolls = crit
  clearBarSelection()
}

// 调整 4/5/6 号盘主属性时不重置暴击/总词条数，仅在切换角色时重算默认值
watch(
  () => [mainAgent.value?.id, isMb.value],
  () => {
    if (damageKind.value === 'direct') applyDefaultCrit()
  },
  { immediate: true },
)

watch(damageKind, (kind) => {
  clearBarSelection()
  if (kind === 'direct') applyDefaultCrit()
  else {
    anomalyAlloc.totalRolls = 0
  }
})

watch([directPoints, anomalyPoints, damageKind], syncSelectedBarAfterSweep)

watch(
  () => directAlloc.critRate,
  (crit) => {
    if (directAlloc.totalRolls < crit) directAlloc.totalRolls = crit
  },
)
</script>

<template>
  <section class="opt-section">
    <header class="opt-header">
      <h2>词条分配与伤害曲线</h2>
      <p>
        在约束内设置固定词条与总词条数，扫掠局外大{{ isMb ? '生命' : '攻击' }}与{{
          damageKind === 'direct' ? '爆伤' : '精通'
        }}的分配，并点击柱体查看差异与收益曲线。柱状图在固定{{ flatLabel }}、穿透等前提下扫掠，并非全词条穷举最优。
      </p>
    </header>

    <h3 class="block-title">基础伤害来源与驱动盘主属性</h3>
    <div class="grid three">
      <label class="field">
        <span>基础伤害来源</span>
        <select v-model="baseDamageSource" :disabled="isMb">
          <option value="atk">攻击力</option>
          <option value="pierce">贯穿力</option>
        </select>
        <small v-if="isMb" class="hint">命破角色固定使用贯穿力</small>
      </label>
      <label class="field">
        <span>4号主属性</span>
        <select v-model="driveDiscMainStats.slot4MainStat">
          <option v-for="opt in DRIVE_DISC_SLOT_4_OPTIONS" :key="opt.id" :value="opt.id">
            {{ opt.label }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>5号主属性</span>
        <select v-model="driveDiscMainStats.slot5MainStat">
          <option v-for="opt in DRIVE_DISC_SLOT_5_OPTIONS" :key="opt.id" :value="opt.id">
            {{ opt.label }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>6号主属性</span>
        <select v-model="driveDiscMainStats.slot6MainStat">
          <option v-for="opt in DRIVE_DISC_SLOT_6_OPTIONS" :key="opt.id" :value="opt.id">
            {{ opt.label }}
          </option>
        </select>
      </label>
      <p class="hint span-2">
        1号固定生命 {{ AFFIX_DRIVE_DISC_SLOT_1_HP }} · 2号固定攻击 {{ AFFIX_DRIVE_DISC_SLOT_2_ATK }}（已计入词条推导）
      </p>
    </div>

    <h3 class="block-title">敌方与环境</h3>
    <div class="grid four">
      <label class="field">
        <span>敌方防御</span>
        <EnemyPresetCombo
          v-model="enemyInput.defense"
          :presets="ENEMY_DEFENSE_PRESETS"
          aria-label="敌方防御预设"
        />
      </label>
      <label class="field">
        <span>敌方抗性</span>
        <select v-model="enemyInput.resistanceType">
          <option value="weak">有弱点（-0.2）</option>
          <option value="normal">无弱点无抗性（0）</option>
          <option value="res20">有抗性（0.2）</option>
          <option value="res40">高抗性（0.4）</option>
        </select>
      </label>
      <label class="field">
        <span>易伤区（基础）</span>
        <input v-model.number="enemyInput.vulnerableMultiplier" type="number" step="0.01" />
      </label>
      <label class="field">
        <span>失衡易伤区（基础）</span>
        <EnemyPresetCombo
          v-model="enemyInput.staggerMultiplier"
          :presets="STAGGER_MULTIPLIER_PRESETS"
          step="0.01"
          aria-label="失衡易伤预设"
        />
      </label>
      <label class="field">
        <span>特殊乘区（基础）</span>
        <input v-model.number="enemyInput.specialMultiplier" type="number" step="0.01" />
      </label>
      <label class="field">
        <span>代理人等级</span>
        <input v-model.number="enemyInput.level" type="number" min="1" max="60" step="1" />
      </label>
    </div>

    <div class="kind-hint">
      当前计算方式：{{ damageKind === 'direct' ? '直伤' : '异常' }}（与上方全局选择同步）
    </div>

    <div class="alloc-layout">
      <div class="alloc-left">
        <template v-if="damageKind === 'direct'">
          <h3 class="block-title">直伤词条分配</h3>
          <p class="constraint-hint">
            总词条数 = 暴击 + 爆伤 + {{ outLabel }}；约束：总 ≤ {{ DIRECT_CONSTRAINTS.maxTotalRolls }}，且
            {{ flatLabel }} + 穿透 + 总 ≤ {{ DIRECT_CONSTRAINTS.maxAtkPenTotal }}
          </p>
          <div class="grid two">
            <label class="field">
              <span>{{ flatLabel }}</span>
              <input v-model.number="directAlloc.flatStat" type="number" min="0" step="1" />
            </label>
            <label class="field">
              <span>穿透值</span>
              <input v-model.number="directAlloc.pen" type="number" min="0" step="1" />
            </label>
            <label class="field">
              <span>暴击</span>
              <input v-model.number="directAlloc.critRate" type="number" min="0" step="1" />
              <small class="hint">默认：局内暴击刚好 &gt; 100%</small>
            </label>
            <label class="field">
              <span>总词条数</span>
              <input v-model.number="directAlloc.totalRolls" type="number" min="0" step="1" />
              <small class="hint">可分配余量 {{ remainDirect }}（{{ outLabel }}+爆伤）</small>
            </label>
          </div>
          <p v-if="directError" class="err">{{ directError }}</p>
          <button type="button" class="ghost-btn" @click="applyDefaultCrit">重算默认暴击条数</button>
        </template>

        <template v-else>
          <h3 class="block-title">异常词条分配</h3>
          <p class="constraint-hint">
            总词条数 = 精通 + {{ outLabel }}；约束：总 ≤ {{ ANOMALY_CONSTRAINTS.maxTotalRolls }}，且
            {{ flatLabel }} + 穿透 + 总 ≤ {{ ANOMALY_CONSTRAINTS.maxAtkPenTotal }}
          </p>
          <div class="grid two">
            <label class="field">
              <span>{{ flatLabel }}</span>
              <input v-model.number="anomalyAlloc.flatStat" type="number" min="0" step="1" />
            </label>
            <label class="field">
              <span>穿透值</span>
              <input v-model.number="anomalyAlloc.pen" type="number" min="0" step="1" />
            </label>
            <label class="field">
              <span>总词条数</span>
              <input v-model.number="anomalyAlloc.totalRolls" type="number" min="0" step="1" />
            </label>
          </div>
          <p v-if="anomalyError" class="err">{{ anomalyError }}</p>
        </template>
      </div>

      <section class="panel-block extra-mods-block alloc-right">
        <header class="panel-block-header">
          <h3>额外 Buff 增益</h3>
          <p>补充增益按条添加，参与局内面板与乘区汇总。</p>
        </header>
        <ExtraBuffGainEditor v-model="extraGains" />
      </section>
    </div>

    <div v-if="displayEval" class="panel-layout">
      <section class="panel-block">
        <header class="panel-block-header">
          <h3>局外面板（初始）</h3>
          <p>{{ selectedCounts ? '跟随当前选中分配。' : '未选中柱体时按第一个扫掠点展示。' }}由词条分配与角色/音擎/驱动盘基础属性推导。</p>
        </header>
        <div class="grid four">
          <label v-for="field in EXTERNAL_PANEL_FIELDS" :key="`external-${field.key}`" class="field">
            <span>{{ field.label }}</span>
            <input :value="formatPanelValue(field.key, displayEval.external[field.key])" type="text" readonly />
          </label>
          <label class="field">
            <span>贯穿力</span>
            <input :value="formatPanelValue('pierce', displayExternalPierce)" type="text" readonly />
          </label>
        </div>
      </section>

      <section class="panel-block panel-block--final">
        <header class="panel-block-header">
          <h3>局内面板（最终）</h3>
          <p>叠加自身/队友/音擎/邦布/驱动盘/额外 Buff 后的战斗面板，仅展示。</p>
        </header>
        <div class="grid four">
          <label v-for="field in FINAL_PANEL_FIELDS" :key="`final-${field.id}`" class="field">
            <span>{{ field.label }}</span>
            <input :value="formatFinalPanelField(field)" type="text" readonly />
          </label>
        </div>
      </section>
    </div>

    <details v-if="displayEval" class="buff-breakdown">
      <summary>查看局内增益汇总数值</summary>
      <ul class="mods-summary">
        <li v-for="field in BUFF_STAT_FIELDS" :key="field.key">
          <span>{{ buffStatFieldLabel(field) }}</span>
          <strong>{{ displayEval.breakdown.totalMods[field.key] }}</strong>
        </li>
      </ul>
      <BuffModSourcesDisplay :sources="displayEval.breakdown.sources" />
    </details>

    <h3 class="block-title">期望伤害柱状图</h3>
    <p class="hint">
      X 轴标签为「{{ outLabel }}条数 / {{ damageKind === 'direct' ? '爆伤' : '精通' }}条数」。点击柱体查看详情。
    </p>
    <p v-if="!barLabels.length" class="empty">请先修正词条约束，或提高总词条数。</p>
    <OptimalDamageBarChart
      v-else-if="damageKind === 'direct'"
      :labels="barLabels"
      :series="directBarSeries"
      :selected-index="selectedIndex"
      @select="selectBar"
    />
    <div v-else class="anomaly-charts">
      <div v-for="chart in anomalyChartList" :key="chart.key" class="anomaly-chart-item">
        <h4 class="sub-title">{{ chart.title }}</h4>
        <OptimalDamageBarChart
          :labels="barLabels"
          :series="chart.series"
          :height="180"
          :selected-index="selectedIndex"
          :hover-index="anomalyHoverIndex"
          @select="selectBar"
          @hover="anomalyHoverIndex = $event"
        />
      </div>
    </div>

    <div v-if="selectedCounts && selectedEval" class="detail">
      <header class="detail-header">
        <h3>
          选中分配：
          <template v-if="damageKind === 'direct' && selectedDirect">
            {{ outLabel }} {{ selectedDirect.outPercent }} · 爆伤 {{ selectedDirect.critDmg }} · 暴击
            {{ directAlloc.critRate }}
          </template>
          <template v-else-if="selectedAnomaly">
            {{ outLabel }} {{ selectedAnomaly.outPercent }} · 精通 {{ selectedAnomaly.mastery }}
          </template>
        </h3>
        <div class="detail-tabs">
          <button
            type="button"
            class="detail-tab"
            :class="{ active: detailTab === 'diff' }"
            @click="detailTab = 'diff'"
          >
            词条差异计算
          </button>
          <button
            type="button"
            class="detail-tab"
            :class="{ active: detailTab === 'curve' }"
            @click="detailTab = 'curve'"
          >
            收益曲线
          </button>
          <button
            type="button"
            class="detail-tab"
            :class="{ active: detailTab === 'process' }"
            @click="detailTab = 'process'"
          >
            计算过程
          </button>
        </div>
      </header>

      <div v-if="damageKind === 'anomaly'" class="metric-tabs">
        <span>分析指标：</span>
        <button
          type="button"
          class="chip"
          :class="{ active: anomalyChartMetric === 'anomaly' }"
          @click="anomalyChartMetric = 'anomaly'"
        >
          异常期望
        </button>
        <button
          type="button"
          class="chip"
          :class="{ active: anomalyChartMetric === 'disorder' }"
          @click="anomalyChartMetric = 'disorder'"
        >
          紊乱期望
        </button>
        <button
          type="button"
          class="chip"
          :class="{ active: anomalyChartMetric === 'turbulence' }"
          @click="anomalyChartMetric = 'turbulence'"
        >
          乱流期望
        </button>
      </div>

      <template v-if="detailTab === 'process'">
        <div class="result-summary">
          <template v-if="damageKind === 'direct'">
            <p>直伤期望伤害：<strong>{{ formatNumber(selectedEval.result.directDamageExpected) }}</strong></p>
          </template>
          <template v-else>
            <p>异常期望伤害：<strong>{{ formatNumber(selectedEval.result.anomalyExpected) }}</strong></p>
            <p>紊乱期望伤害：<strong>{{ formatNumber(selectedEval.result.disorderExpected) }}</strong></p>
            <p>乱流期望伤害：<strong>{{ formatNumber(selectedEval.result.turbulenceExpected) }}</strong></p>
          </template>
        </div>
        <DamageResultDetail
          :calc-parts="selectedEval.result"
          :final-panel="selectedEval.finalPanel"
          :external-panel="selectedEval.external"
          :sources="selectedEval.breakdown.sources"
          :pierce-mod="selectedEval.breakdown.totalMods.pierce"
          :pierce-power="selectedEval.piercePower"
          :enemy-input="enemyInput"
          :is-mb="isMb"
          :show="damageKind"
        />
      </template>

      <template v-else-if="detailTab === 'diff' && diffAnalysis">
        <h4 class="sub-title">副词条差异计算（相对当前分配 +1 条）</h4>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>候选词条</th>
                <th>当前值</th>
                <th>加一条</th>
                <th>伤害差</th>
                <th>百分比差</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in diffAnalysis.addOne" :key="row.key">
                <td>{{ row.label }}</td>
                <td>{{ row.currentValue }}</td>
                <td>+{{ row.addOne }}</td>
                <td :class="row.damageDelta >= 0 ? 'pos' : 'neg'">{{ formatDelta(row.damageDelta) }}</td>
                <td :class="row.percentDelta >= 0 ? 'pos' : 'neg'">{{ formatPercent(row.percentDelta) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h4 class="sub-title">已有副词条替换参考（-1 换最优候选 +1）</h4>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>当前词条</th>
                <th>减一条</th>
                <th>最优替换</th>
                <th>加一条</th>
                <th>伤害差</th>
                <th>百分比差</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in diffAnalysis.replace" :key="row.key">
                <td>{{ row.label }}</td>
                <td>-{{ row.removeOne }}</td>
                <td>{{ row.bestReplaceLabel }}</td>
                <td>+{{ row.addOne }}</td>
                <td :class="row.damageDelta >= 0 ? 'pos' : 'neg'">{{ formatDelta(row.damageDelta) }}</td>
                <td :class="row.percentDelta >= 0 ? 'pos' : 'neg'">{{ formatPercent(row.percentDelta) }}</td>
              </tr>
              <tr v-if="!diffAnalysis.replace.length">
                <td colspan="6" class="empty-cell">当前无可替换的已有候选词条</td>
              </tr>
            </tbody>
          </table>
        </div>

        <template v-if="mainStatDiff">
          <h4 class="sub-title">主词条差异计算（4/5/6 号盘主属性替换）</h4>
          <div class="main-stat-diff">
            <div v-for="slotDiff in mainStatDiff" :key="slotDiff.key" class="main-stat-card">
              <p class="main-stat-title">{{ slotDiff.title }}</p>
              <p class="main-stat-current">当前：<strong>{{ slotDiff.currentLabel }}</strong></p>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>替换为</th>
                      <th>伤害差值</th>
                      <th>百分比差值</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in slotDiff.rows" :key="row.id">
                      <td>{{ row.label }}</td>
                      <td :class="row.damageDelta >= 0 ? 'pos' : 'neg'">{{ formatDelta(row.damageDelta) }}</td>
                      <td :class="row.percentDelta >= 0 ? 'pos' : 'neg'">{{ formatPercent(row.percentDelta) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </template>
      </template>

      <template v-else-if="detailTab === 'curve' && benefitData">
        <div class="curve-toolbar">
          <button
            type="button"
            class="chip"
            :class="{ active: curveMode === 'cumulative' }"
            @click="curveMode = 'cumulative'"
          >
            累计提升
          </button>
          <button
            type="button"
            class="chip"
            :class="{ active: curveMode === 'marginal' }"
            @click="curveMode = 'marginal'"
          >
            边际收益
          </button>
          <span class="hint">最大新增 {{ BENEFIT_CURVE_MAX_ADDED }} 词条</span>
        </div>
        <OptimalBenefitCurveChart
          :series="benefitData.series"
          :mode="curveMode"
          :max-added="BENEFIT_CURVE_MAX_ADDED"
        />

        <h4 class="sub-title">下一条累计提升</h4>
        <ul class="next-bars">
          <li
            v-for="row in [...benefitData.nextStep].sort((a, b) => b.percentDelta - a.percentDelta)"
            :key="row.key"
          >
            <span class="next-label">{{ row.label }}</span>
            <div class="next-track">
              <div
                class="next-fill"
                :style="{
                  width: `${Math.max(2, Math.min(100, Math.abs(row.percentDelta) * 8))}%`,
                  background: row.percentDelta >= 0 ? '#7dd3a0' : '#f07178',
                }"
              />
            </div>
            <strong :class="row.percentDelta >= 0 ? 'pos' : 'neg'">{{ formatPercent(row.percentDelta) }}</strong>
          </li>
        </ul>
      </template>
    </div>
  </section>
</template>

<style scoped>
.opt-section {
  border: 1px solid #2a2d33;
  border-radius: 14px;
  background: linear-gradient(180deg, #171a1f 0%, #12151a 100%);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.opt-header h2 {
  margin: 0;
  font-size: 1.05rem;
  color: #f0f2f6;
}

.opt-header p,
.constraint-hint,
.hint {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: #9aa3b0;
}

.block-title,
.sub-title {
  margin: 0.35rem 0 0;
  font-size: 0.92rem;
  color: #e8eaed;
}

.grid {
  display: grid;
  gap: 0.65rem;
}

.grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.grid.three {
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
}

.grid.four {
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
}

.alloc-layout {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  gap: 0.75rem;
  align-items: start;
}

.alloc-left {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  min-width: 0;
}

.panel-layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  align-items: stretch;
}

.panel-block {
  border: 1px solid #2d323a;
  border-radius: 12px;
  padding: 0.75rem;
  background: #10141a;
  min-width: 0;
}

.panel-block--final {
  border-color: #3a4a31;
  background: linear-gradient(180deg, #121712 0%, #0f1410 100%);
}

.panel-block-header h3 {
  margin: 0;
  font-size: 0.92rem;
  color: #e8ebf0;
}

.panel-block-header p {
  margin: 0.25rem 0 0.65rem;
  font-size: 0.76rem;
  color: #8f96a3;
}

.panel-block .field > input:read-only {
  opacity: 0.92;
  background: #0c1016;
}

.extra-mods-block {
  padding: 0.6rem 0.65rem;
}

.extra-mods-block .panel-block-header p {
  margin: 0.2rem 0 0.45rem;
  font-size: 0.72rem;
  line-height: 1.35;
}

.extra-mods-block :deep(.buff-stat-grid-wrap) {
  gap: 0;
}

.extra-mods-block :deep(.buff-stat-hint:empty) {
  display: none;
}

.extra-mods-block :deep(.buff-stat-grid) {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.32rem 0.4rem;
}

.extra-mods-block :deep(.field) {
  gap: 0.12rem;
}

.extra-mods-block :deep(.field-label) {
  font-size: 0.68rem;
  line-height: 1.2;
  opacity: 0.85;
}

.extra-mods-block :deep(.field-input) {
  padding: 0.28rem 0.4rem;
  font-size: 0.8rem;
  border-radius: 6px;
}

.buff-breakdown {
  border: 1px solid #2d323a;
  border-radius: 10px;
  padding: 0.55rem 0.75rem;
  background: #0f1217;
  color: #b7c0cd;
  font-size: 0.8rem;
}

.buff-breakdown summary {
  cursor: pointer;
  color: #d5dae4;
}

.mods-summary {
  margin: 0.55rem 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem 0.75rem;
}

.mods-summary li {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.8rem;
}

@media (max-width: 980px) {
  .alloc-layout,
  .panel-layout {
    grid-template-columns: 1fr;
  }

  .extra-mods-block :deep(.buff-stat-grid) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.span-2 {
  grid-column: span 2;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  font-size: 0.8rem;
  color: #9aa3b0;
}

.field > input,
.field > select {
  border: 1px solid #333841;
  border-radius: 8px;
  background: #0f1217;
  color: #e8eaed;
  padding: 0.45rem 0.55rem;
  font: inherit;
}

.kind-hint {
  margin: 0.75rem 0 0;
  font-size: 0.82rem;
  opacity: 0.75;
}
.detail-tabs,
.metric-tabs,
.curve-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: center;
}

.kind-tab,
.detail-tab,
.ghost-btn,
.chip {
  border: 1px solid #333841;
  border-radius: 999px;
  background: #1a1e25;
  color: #d5dae3;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  padding: 0.35rem 0.85rem;
  cursor: pointer;
}

.kind-tab.active,
.detail-tab.active,
.chip.active {
  border-color: rgba(191, 255, 9, 0.45);
  background: rgba(191, 255, 9, 0.12);
  color: #bfff09;
}

.err {
  margin: 0;
  color: #f07178;
  font-size: 0.82rem;
}

.anomaly-charts {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.anomaly-chart-item {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.empty,
.empty-cell {
  color: #8b93a1;
  font-size: 0.85rem;
  text-align: center;
}

.detail {
  margin-top: 0.35rem;
  padding-top: 0.85rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.detail-header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  align-items: center;
  justify-content: space-between;
}

.detail-header h3 {
  margin: 0;
  font-size: 0.95rem;
  color: #f0f2f6;
}

.result-summary {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.45rem 0.85rem;
  font-size: 0.82rem;
  color: #c5cad3;
}

.result-summary strong {
  color: #bfff09;
}

.table-wrap {
  overflow: auto;
  border: 1px solid #2a2d33;
  border-radius: 10px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

th,
td {
  padding: 0.55rem 0.65rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  text-align: left;
  white-space: nowrap;
}

th {
  color: #9aa3b0;
  background: rgba(0, 0, 0, 0.25);
}

.pos {
  color: #7dd3a0;
}

.neg {
  color: #f07178;
}

.main-stat-diff {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.main-stat-card {
  border: 1px solid #2d323a;
  border-radius: 12px;
  padding: 0.7rem 0.75rem;
  background: #10141a;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
}

.main-stat-title {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 700;
  color: #f0f2f6;
}

.main-stat-current {
  margin: 0;
  font-size: 0.8rem;
  color: #9aa3b0;
}

.main-stat-current strong {
  color: #bfff09;
}

@media (max-width: 980px) {
  .main-stat-diff {
    grid-template-columns: 1fr;
  }
}

.next-bars {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.next-bars li {
  display: grid;
  grid-template-columns: 6.5rem 1fr auto;
  gap: 0.55rem;
  align-items: center;
  font-size: 0.8rem;
}

.next-label {
  color: #c5cad3;
}

.next-track {
  height: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.next-fill {
  height: 100%;
  border-radius: 999px;
}
</style>
