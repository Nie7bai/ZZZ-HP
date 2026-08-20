<script setup lang="ts">
import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  reactive,
  ref,
  watch,
} from 'vue'
import { storeToRefs } from 'pinia'
import { type ExtraBuffGain } from '@/components/calculator/ExtraBuffGainEditor.vue'
import DamageResultDetail from '@/components/calculator/DamageResultDetail.vue'
import OptimalBenefitCurveChart from '@/components/calculator/OptimalBenefitCurveChart.vue'
import OptimalDamageBarChart from '@/components/calculator/OptimalDamageBarChart.vue'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type {
  AgentBuffDoc,
  AnomalyDamageSubKind,
  BangbooBuffDoc,
  BaseDamageSource,
  DriveDiscBuffDoc,
  WengineBuffDoc,
} from '@/types/calculator'
import {
  createDefaultAffixDriveDiscMainStats,
  createDefaultExternalPanel,
  createExternalPanelFromAgentBase,
  fillPanelStatsDefaults,
  isPlaceholderExternalPanel,
  type AffixCounts,
  type AffixDriveDiscMainStats,
  type DriveDiscSlot4StatId,
  type DriveDiscSlot5StatId,
  type DriveDiscSlot6StatId,
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
  createEmptyBuffStatModifiers,
  createEmptyRefinementMods,
} from '@/utils/calculatorUi'
import { formatCalcDecimal } from '@/utils/calcNumberFormat'
import type { DamageCalcResult } from '@/utils/damageCalc'
import { type DamageEnemyInput } from '@/utils/enemyResistance'
import {
  ANOMALY_CONSTRAINTS,
  BENEFIT_CURVE_MAX_ADDED,
  DIRECT_CONSTRAINTS,
  buildOptimalEvalContext,
  computeBenefitCurves,
  computeDiffAnalysis,
  computeEventAffixImpact,
  evaluateAffixCounts,
  clearAffixEvalCache,
  findMinCritRollsForOvercap,
  evaluateOptimalEventDetail,
  buildDirectAffixCounts,
  buildAnomalyAffixCounts,
  type OptimalEventEvalDetail,
  flatStatLabel,
  outPercentLabel,
  sweepAnomalyDamageAsync,
  sweepDirectDamageAsync,
  validateAnomalyAlloc,
  validateDirectAlloc,
  type AnomalyAllocState,
  type AnomalySweepPoint,
  type DirectAllocState,
  type DirectSweepPoint,
  type OptimalDamageKind,
  type OptimalEventAffixImpact,
  type OptimalEventDamageLine,
} from '@/utils/optimalAffixAlloc'
import EquipPickerModal from '@/components/calculator/EquipPickerModal.vue'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import {
  omitAgentFromAnomalySlotPanels,
  resolveBuffSelectionForSlot,
  slotParticipatesInConvertBuff,
  teamHasConvertSupportSlots,
  computeFinalPanel,
  type ConvertSlotPanels,
} from '@/utils/panelBuffCalc'
import { summarizeDamageByOwner } from '@/utils/damageEventOwner'
import DamageOwnerShareBlock from '@/components/calculator/DamageOwnerShareBlock.vue'
import {
  DAMAGE_EVENT_CRIT_MODE_OPTIONS,
  DAMAGE_EVENT_KIND_OPTIONS,
  eventNeedsAnomalyProducer,
} from '@/utils/damageEvent'
import { getHitSkipReason, buildGenericPanelSkillContext } from '@/utils/resolvedHit'

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
  { key: 'anomalyControl', label: '异常掌控' },
  { key: 'energyRegen', label: '能量回复效率%' },
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
  { id: 'anomalyControl', label: '异常掌控', kind: 'stat', key: 'anomalyControl' },
  { id: 'energyRegen', label: '能量回复效率%', kind: 'stat', key: 'energyRegen' },
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
  /** 计算页正在编辑的编队槽位；局外面板 / 最优分配跟这个人走 */
  editedSlotIndex?: number
  active?: boolean
  damageKind?: import('@/utils/optimalAffixAlloc').OptimalDamageKind
  anomalySubKind?: AnomalyDamageSubKind
  /** 页级异常强度提供者（第一击 power）；与逐 hit 字段并存时优先 hit */
  triggerAnomalyAgentId?: string | null
  anomalySlotPanels?: Record<string, PanelStats>
  convertSlotPanels?: ConvertSlotPanels
  skillCategoryId?: import('@/types/calculator').SkillCategoryId
  skillSubcategoryId?: string | null
  buffSelection?: import('@/utils/panelBuffCalc').BuffSelectionState | null
  slotBuffSelections?: import('@/utils/panelBuffCalc').MultiSlotBuffSelection | null
  staggerPhase?: import('@/types/calculator').StaggerPhase
  hits?: import('@/utils/resolvedHit').ResolvedHit[]
  /** 准备招式单次预览（与面板计算共用，用于技能卡伤害数字） */
  previewHits?: import('@/utils/resolvedHit').ResolvedHit[]
  environmentBuffs?: import('@/utils/environmentBuffCalc').EnvironmentBuffEntry[]
}>()

const extraGains = defineModel<ExtraBuffGain[]>('extraGains', { default: () => [] })

const emit = defineEmits<{
  'update:hitDamages': [value: Record<string, number>]
  'update:hitCalcResults': [value: Record<string, DamageCalcResult>]
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
type AnomalyMetric = 'anomaly' | 'disorder' | 'turbulence' | 'anomalyRelease' | 'radiance'
type CurveMode = 'cumulative' | 'marginal'

/** 本模块需手动选择直伤/异常；未选时只展示模式入口。默认跟随招式流程的首个伤害类型 */
const damageKind = ref<OptimalDamageKind | null>(null)

watch(
  () => props.damageKind,
  (kind) => {
    if (kind === 'direct' || kind === 'anomaly') damageKind.value = kind
  },
  { immediate: true },
)
const anomalySubKind = computed(() => props.anomalySubKind ?? 'anomaly')
/** KeepAlive 停用后仍会收到 props 变更；用 activated 门闩短路昂贵计算 */
const keptAliveActive = ref(true)
onActivated(() => {
  keptAliveActive.value = true
})
onDeactivated(() => {
  keptAliveActive.value = false
})
const isSectionActive = computed(() => props.active !== false && keptAliveActive.value)
const baseDamageSource = ref<BaseDamageSource>('atk')
const driveDiscMainStats = reactive(createDefaultAffixDriveDiscMainStats())
const enemyInput = defineModel<DamageEnemyInput>('enemyInput', { required: true })

function setDamageKind(kind: OptimalDamageKind) {
  if (damageKind.value === kind) return
  damageKind.value = kind
}

const directAlloc = reactive<DirectAllocState>({
  flatStat: 0,
  hpFlat: 0,
  atkPercent: 0,
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
  const index = props.editedSlotIndex
  if (index != null && index >= 0 && index < props.teamSlots.length) return index
  return 0
})

const mainSlot = computed(() => props.teamSlots[mainSlotIndex.value]!)

function applyCurrentSlotDriveDiscMainsOnce() {
  const mains = mainSlot.value.affixDriveDiscMainStats
  Object.assign(driveDiscMainStats, createDefaultAffixDriveDiscMainStats(), mains ?? {})
}

watch(
  isSectionActive,
  (active, wasActive) => {
    if (!active || wasActive === true) return
    applyCurrentSlotDriveDiscMainsOnce()
  },
  { immediate: true },
)

const mainAgent = computed(() => props.agents.find((item) => item.id === mainSlot.value.agentId))

const { skillSubcategories, followUpSkillRules } = storeToRefs(useCalculatorBuffStore())

const selectedBangboo = computed(
  () =>
    props.bangboos.find((item) => item.id === props.selectedBangbooId) ??
    props.bangboos.find((item) => item.id === 'none') ??
    emptyBangboo,
)

const anomalySupportSlots = computed(() => {
  const mainId = mainSlot.value.agentId
  const participantIds = new Set<string>()
  for (const hit of [...(props.hits ?? []), ...(props.previewHits ?? [])]) {
    for (const id of [hit.ownerAgentId, hit.anomalyPowerAgentId, hit.triggerAgentId]) {
      if (id && id !== mainId) participantIds.add(id)
    }
  }
  return props.teamSlots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => Boolean(slot.agentId && participantIds.has(slot.agentId)))
})

/**
 * 最优模块独立局外 / 转模副本：编辑不写回「面板/词条计算」页。
 */
const optimalParticipantPanels = reactive<Record<string, PanelStats>>({})
function buildBasePanelCalcContext() {
  const slotIndex = mainSlotIndex.value
  return {
    teamSlots: props.teamSlots,
    agents: props.agents,
    wengines: props.wengines,
    bangboo: selectedBangboo.value,
    bangbooRefine: props.bangbooRefine,
    mainSlotIndex: slotIndex,
    driveDiscs: props.driveDiscs,
    skillContext: buildGenericPanelSkillContext({
      element: mainAgent.value?.element,
      staggerPhase: props.staggerPhase ?? 'stagger',
    }),
    buffSelection: resolveBuffSelectionForSlot(props.slotBuffSelections, slotIndex),
    anomalySlotPanels: optimalParticipantPanels,
    convertSlotPanels: props.convertSlotPanels,
    environmentBuffs: props.environmentBuffs,
  }
}

const anomalyProducerAgentIds = computed(() => {
  const ids = new Set<string>()
  for (const item of anomalySupportSlots.value) {
    if (item.slot.agentId) ids.add(item.slot.agentId)
  }
  return ids
})

function seedOptimalParticipantPanel(agentId: string): PanelStats {
  const existing = optimalParticipantPanels[agentId]
  if (existing) return existing
  const fromPage = props.anomalySlotPanels?.[agentId]
  if (fromPage && !isPlaceholderExternalPanel(fromPage)) {
    const cloned = fillPanelStatsDefaults({ ...fromPage })
    optimalParticipantPanels[agentId] = cloned
    return cloned
  }
  const agent = props.agents.find((item) => item.id === agentId)
  const seeded = createExternalPanelFromAgentBase(agent?.basePanel)
  optimalParticipantPanels[agentId] = seeded
  return seeded
}

/** 参与者局外 UI 已去掉：始终跟页级导入同步，避免面板改完进最优仍用旧副本 */
function syncOptimalParticipantsFromPage() {
  for (const [agentId, panel] of Object.entries(props.anomalySlotPanels ?? {})) {
    if (!panel || isPlaceholderExternalPanel(panel)) continue
    optimalParticipantPanels[agentId] = fillPanelStatsDefaults({ ...panel })
  }
}

const panelSeedReady = ref(false)

watch(
  () =>
    props.teamSlots
      .map((slot) => slot.agentId)
      .filter((id): id is string => Boolean(id))
      .join('|'),
  () => {
    panelSeedReady.value = false
    for (const slot of props.teamSlots) {
      if (slot.agentId) seedOptimalParticipantPanel(slot.agentId)
    }
    syncOptimalParticipantsFromPage()
    panelSeedReady.value = true
  },
  { immediate: true },
)

watch(
  () => JSON.stringify(props.anomalySlotPanels ?? {}),
  () => {
    if (!panelSeedReady.value) return
    syncOptimalParticipantsFromPage()
  },
)

/** 主 C 参与转模链或队伍存在转模增益角色时，主 C 局外由本模块词条推导，不沿用面板页主 C 局外 */
const optimalConvertModeActive = computed(() => {
  const ctx = {
    teamSlots: props.teamSlots,
    agents: props.agents,
    wengines: props.wengines,
    bangboo: selectedBangboo.value,
    bangbooRefine: props.bangbooRefine,
    mainSlotIndex: mainSlotIndex.value,
    driveDiscs: props.driveDiscs,
    buffSelection: props.buffSelection ?? null,
    slotBuffSelections: props.slotBuffSelections ?? null,
  }
  return (
    slotParticipatesInConvertBuff(ctx, mainSlotIndex.value) ||
    teamHasConvertSupportSlots(ctx, { excludeAnomalyAgentIds: anomalyProducerAgentIds.value })
  )
})

/** 转模来源统一读各角色完整局外（导入/页级 anomalySlotPanels）；旧方案 convertSlotPanels 仅作兜底 */
const evalConvertSlotPanels = computed((): ConvertSlotPanels => props.convertSlotPanels ?? {})

const effectiveAnomalySlotPanels = computed(() => {
  const mainId = mainAgent.value?.id
  const merged: Record<string, PanelStats> = { ...optimalParticipantPanels }
  if (mainId && optimalConvertModeActive.value) {
    return omitAgentFromAnomalySlotPanels(merged, mainId)
  }
  return merged
})

const isMb = computed(() => mainAgent.value?.profession === MB_PROFESSION)

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
    enemyInput: { ...enemyInput.value },
    baseDamageSource: isMb.value ? 'pierce' : baseDamageSource.value,
    extraGains: extraGains.value.map((item) => ({ ...item })),
    skillContext: buildGenericPanelSkillContext({
      element: mainAgent.value?.element,
      staggerPhase: props.staggerPhase ?? 'stagger',
      damageKind: damageKind.value ?? 'direct',
    }),
    buffSelection: props.buffSelection ?? null,
    slotBuffSelections: props.slotBuffSelections ?? null,
    anomalySlotPanels: effectiveAnomalySlotPanels.value,
    convertSlotPanels: evalConvertSlotPanels.value,
    triggerAnomalyAgentId: props.triggerAnomalyAgentId,
    hits: props.hits,
    resolveSubcategory: (id) => skillSubcategories.value.find((item) => item.id === id) ?? null,
    skillSubcategories: skillSubcategories.value,
    followUpSkillRules: followUpSkillRules.value,
    environmentBuffs: props.environmentBuffs,
  }),
)

const flatLabel = computed(() => flatStatLabel(isMb.value))
const outLabel = computed(() => outPercentLabel(isMb.value))

const directError = computed(() =>
  validateDirectAlloc(directAlloc, isMb.value, driveDiscMainStats),
)
const anomalyError = computed(() =>
  validateAnomalyAlloc(anomalyAlloc, isMb.value, driveDiscMainStats),
)

const sweepConfigFingerprint = computed(() =>
  JSON.stringify({
    baseDamageSource: baseDamageSource.value,
    driveDiscMainStats: { ...driveDiscMainStats },
    enemy: enemyInput.value,
    extraGains: extraGains.value,
    convert: props.convertSlotPanels ?? {},
    participants: optimalParticipantPanels,
    damageKind: damageKind.value,
    buffSelection: props.buffSelection,
    slotBuffSelections: props.slotBuffSelections,
    agents: props.teamSlots.map((slot) => slot.agentId ?? ''),
    trigger: props.triggerAnomalyAgentId ?? '',
    hits: (props.hits ?? []).map(
      (hit) =>
        `${hit.id}:${hit.skill.id}:${hit.count}:${hit.critMode}:${hit.staggerPhase}` +
        `:${hit.anomalyPowerAgentId ?? ''}:${hit.triggerAgentId ?? ''}:${hit.anomalySubKind ?? ''}` +
        `:${JSON.stringify(hit.multOverrides ?? {})}:${JSON.stringify(hit.panelMods ?? {})}`,
    ),
    stagger: props.staggerPhase ?? '',
    bangboo: props.selectedBangbooId ?? '',
    bangbooRefine: props.bangbooRefine ?? 0,
  }),
)

const SWEEP_DEBOUNCE_MS = 320
const EVENT_SWEEP_DEBOUNCE_MS = 700
const DIFF_DEBOUNCE_MS = 450
const DIFF_EVENT_DEBOUNCE_MS = 900
const SKILL_FLOW_EMIT_DEBOUNCE_MS = 200

const directPoints = ref<DirectSweepPoint[]>([])
const anomalyPoints = ref<AnomalySweepPoint[]>([])
const sweepComputing = ref(false)
/** 配置（主属性/敌人/增益等）变更后需手动点开始计算 */
const sweepNeedsCommit = ref(true)
/** 已提交配置后，仅词条分配变化会自动重算柱状图 */
const sweepCommitted = ref(false)

const hasEventMode = computed(() => (props.hits?.length ?? 0) > 0)

let sweepTimer: ReturnType<typeof setTimeout> | null = null
let diffTimer: ReturnType<typeof setTimeout> | null = null
let skillFlowEmitTimer: ReturnType<typeof setTimeout> | null = null
let sweepAbort: AbortController | null = null
let sweepGeneration = 0
/** 隐藏期间外部配置有变，回到本模块时再提示重算，不清空已有柱图 */
const pendingConfigDirty = ref(false)

function markSweepConfigDirty() {
  if (!panelSeedReady.value) return
  // 配置变了（含切换异常强度提供者/触发者）时必须中止旧扫掠，否则会长时间卡在旧结果上
  sweepGeneration += 1
  sweepAbort?.abort()
  sweepAbort = null
  sweepComputing.value = false
  if (!isSectionActive.value) {
    pendingConfigDirty.value = true
    return
  }
  pendingConfigDirty.value = false
  sweepNeedsCommit.value = true
  sweepCommitted.value = false
  // 保留旧柱图与差异表；需重算时看上方提示
  benefitData.value = null
}

function startCalculation() {
  if (!damageKind.value) return
  if (damageKind.value === 'direct' && directError.value) return
  if (damageKind.value === 'anomaly' && anomalyError.value) return
  pendingConfigDirty.value = false
  sweepNeedsCommit.value = false
  sweepCommitted.value = true
  clearAffixEvalCache()
  clearBarSelection()
  void runSweepRecompute()
}

async function runSweepRecompute() {
  if (!sweepCommitted.value || !damageKind.value) {
    sweepComputing.value = false
    return
  }
  const generation = ++sweepGeneration
  sweepAbort?.abort()
  const controller = new AbortController()
  sweepAbort = controller
  sweepComputing.value = true
  const chunkSize = hasEventMode.value ? 3 : 6
  const kind = damageKind.value
  try {
    if (kind === 'direct') {
      if (directError.value) {
        directPoints.value = []
      } else {
        directPoints.value = await sweepDirectDamageAsync(
          evalCtx.value,
          { ...directAlloc },
          { signal: controller.signal, chunkSize },
        )
      }
      if (generation !== sweepGeneration) return
      anomalyPoints.value = []
    } else {
      if (anomalyError.value) {
        anomalyPoints.value = []
      } else {
        anomalyPoints.value = await sweepAnomalyDamageAsync(
          evalCtx.value,
          { ...anomalyAlloc },
          { signal: controller.signal, chunkSize },
        )
      }
      if (generation !== sweepGeneration) return
      directPoints.value = []
    }
    // 扫掠完成后默认选中首柱，保证下方「词条差异计算」有基准分配
    if (selectedIndex.value == null) {
      const points = kind === 'direct' ? directPoints.value : anomalyPoints.value
      if (points.length) {
        selectedIndex.value = 0
        selectedSweepKey.value = sweepKeyFromIndex(0)
      }
    }
    scheduleDiffRecompute()
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') return
    throw err
  } finally {
    if (generation === sweepGeneration) {
      sweepComputing.value = false
    }
  }
}

function scheduleSweepRecompute() {
  if (!isSectionActive.value || !sweepCommitted.value || !damageKind.value) return
  sweepComputing.value = true
  if (sweepTimer) clearTimeout(sweepTimer)
  const delay = hasEventMode.value ? EVENT_SWEEP_DEBOUNCE_MS : SWEEP_DEBOUNCE_MS
  sweepTimer = setTimeout(() => {
    void runSweepRecompute()
  }, delay)
}

watch(isSectionActive, (active) => {
  if (!active) {
    sweepAbort?.abort()
    if (skillFlowEmitTimer) {
      clearTimeout(skillFlowEmitTimer)
      skillFlowEmitTimer = null
    }
    return
  }
  if (pendingConfigDirty.value) {
    pendingConfigDirty.value = false
    markSweepConfigDirty()
  }
})

watch(sweepConfigFingerprint, markSweepConfigDirty)

watch(
  [directAlloc, anomalyAlloc, damageKind, directError, anomalyError],
  scheduleSweepRecompute,
  { deep: true },
)

onBeforeUnmount(() => {
  if (sweepTimer) clearTimeout(sweepTimer)
  if (diffTimer) clearTimeout(diffTimer)
  if (skillFlowEmitTimer) clearTimeout(skillFlowEmitTimer)
  if (eventAffixImpactTimer) clearTimeout(eventAffixImpactTimer)
  sweepAbort?.abort()
})

const showEventAffixImpact = ref(false)
const showCombinedMainStatRankings = ref(false)
const eventAffixImpactLoading = ref(false)
const combinedMainStatRankingsLoading = ref(false)

const sweepPoints = computed(() =>
  damageKind.value === 'direct' ? directPoints.value : anomalyPoints.value,
)

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

const chartEventReferencePoint = computed(() => {
  if (selectedIndex.value != null && sweepPoints.value[selectedIndex.value]) {
    return sweepPoints.value[selectedIndex.value]
  }
  return sweepPoints.value[0] ?? null
})

function resolveChartEventProducerLabel(hit: import('@/utils/resolvedHit').ResolvedHit) {
  if (!eventNeedsAnomalyProducer(hit.skill.damageType)) return null
  const raw = hit.anomalyPowerAgentId
  if (!raw) return null
  return props.agents.find((item) => item.id === raw)?.name ?? raw
}

function resolveChartEventCritLabel(critMode: import('@/types/calculator').DamageEventCritMode) {
  return DAMAGE_EVENT_CRIT_MODE_OPTIONS.find((item) => item.id === critMode)?.label ?? critMode
}

const chartEventOptions = computed(() => {
  const reference = chartEventReferencePoint.value
  const referenceLines = reference?.eventLines ?? sweepPoints.value[0]?.eventLines ?? []
  return referenceLines.map((line) => {
    const hit = props.hits?.find((item) => item.id === line.eventId)
    const kindLabel =
      DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === line.kind)?.label ?? line.kind
    const refLine = referenceLines.find((item) => item.eventId === line.eventId)
    const total = refLine?.total ?? line.total
    const perHit = refLine?.perHit ?? line.perHit
    const metaParts: string[] = [kindLabel]
    if (hit) {
      const producer = resolveChartEventProducerLabel(hit)
      if (producer) metaParts.push(producer)
      metaParts.push(resolveChartEventCritLabel(hit.critMode))
      if (hit.count > 1) metaParts.push(`×${hit.count}`)
      metaParts.push(`期望 ${formatNumber(total)}`)
      if (hit.count > 1) metaParts.push(`单次 ${formatNumber(perHit)}`)
    } else {
      metaParts.push(`期望 ${formatNumber(total)}`)
    }
    return {
      id: line.eventId,
      label: line.displayName,
      kindLabel,
      metaText: metaParts.join(' · '),
      total,
      perHit,
    }
  })
})

const chartEventSelectionSummary = computed(() => {
  if (!selectedChartEventIds.value.length) return ''
  const selected = chartEventOptions.value.filter((item) =>
    selectedChartEventIds.value.includes(item.id),
  )
  if (!selected.length) return ''
  if (selected.length === chartEventOptions.value.length) {
    return `已统计全部 ${selected.length} 个事件`
  }
  return selected.map((item) => `${item.kindLabel} ${item.label}`).join('；')
})

/** 柱状图参与统计的事件；默认全选 = 总伤害 */
const selectedChartEventIds = ref<string[]>([])

/** 仅在可选事件 id 集合变化时同步选择，切换柱体只更新期望数值时不重置 */
watch(
  () => chartEventOptions.value.map((item) => item.id),
  (optionIds, prevIds) => {
    if (!optionIds.length) return
    if (!prevIds?.length) {
      selectedChartEventIds.value = [...optionIds]
      return
    }
    const idsUnchanged =
      optionIds.length === prevIds.length && optionIds.every((id, index) => id === prevIds[index])
    if (idsUnchanged) return
    const optionSet = new Set(optionIds)
    const preserved = selectedChartEventIds.value.filter((id) => optionSet.has(id))
    selectedChartEventIds.value = preserved.length ? preserved : [...optionIds]
  },
  { immediate: true },
)

function isChartEventSelected(eventId: string) {
  return selectedChartEventIds.value.includes(eventId)
}

function toggleChartEvent(eventId: string) {
  const next = new Set(selectedChartEventIds.value)
  if (next.has(eventId)) {
    if (next.size <= 1) return
    next.delete(eventId)
  } else {
    next.add(eventId)
  }
  selectedChartEventIds.value = [...next]
}

function selectAllChartEvents() {
  selectedChartEventIds.value = chartEventOptions.value.map((item) => item.id)
}

function sumSelectedEventsForPoint(point: DirectSweepPoint | AnomalySweepPoint) {
  const ids = new Set(selectedChartEventIds.value)
  return (point.eventLines ?? [])
    .filter((line) => ids.has(line.eventId))
    .reduce((sum, line) => sum + line.total, 0)
}

const eventTotalBarSeries = computed(() => {
  if (!hasEventMode.value || !sweepPoints.value.length || !selectedChartEventIds.value.length) {
    return null
  }
  const allSelected = selectedChartEventIds.value.length === chartEventOptions.value.length
  return [
    {
      key: 'event-total',
      label: allSelected ? '总伤害期望' : `已选 ${selectedChartEventIds.value.length} 个事件`,
      color: '#7dd3a0',
      values: sweepPoints.value.map((point) => sumSelectedEventsForPoint(point)),
    },
  ]
})

const selectedProcessEventId = ref<string | null>(null)

interface ProcessEventRow {
  hit: import('@/utils/resolvedHit').ResolvedHit
  eventId: string
  displayName: string
  detail: OptimalEventEvalDetail | null
  skipReason: string | null
}

const eventAffixImpact = ref<OptimalEventAffixImpact[]>([])
const eventAffixImpactStale = ref(false)
let eventAffixImpactTimer: ReturnType<typeof setTimeout> | null = null

function recomputeEventAffixImpact() {
  if (!hasEventMode.value || !analysisCounts.value || !damageKind.value) {
    eventAffixImpact.value = []
    return
  }
  eventAffixImpact.value = computeEventAffixImpact(
    evalCtx.value,
    analysisCounts.value,
    damageKind.value,
  )
  eventAffixImpactStale.value = false
}

function loadEventAffixImpact() {
  if (eventAffixImpactLoading.value || sweepComputing.value) return
  eventAffixImpactLoading.value = true
  window.setTimeout(() => {
    recomputeEventAffixImpact()
    showEventAffixImpact.value = true
    eventAffixImpactLoading.value = false
  }, 0)
}

function scheduleEventAffixImpactRefresh() {
  if (!showEventAffixImpact.value || !hasEventMode.value) return
  eventAffixImpactStale.value = true
  if (eventAffixImpactTimer) clearTimeout(eventAffixImpactTimer)
  eventAffixImpactTimer = setTimeout(() => {
    if (!showEventAffixImpact.value || sweepComputing.value) return
    eventAffixImpactLoading.value = true
    window.setTimeout(() => {
      recomputeEventAffixImpact()
      eventAffixImpactLoading.value = false
    }, 0)
  }, hasEventMode.value ? DIFF_EVENT_DEBOUNCE_MS : DIFF_DEBOUNCE_MS)
}

/** 仅事件结构/伤害模式变化时才清空；分配微调改为后台刷新，避免表格被刷掉 */
const eventAffixImpactStructureKey = computed(() =>
  JSON.stringify({
    kind: damageKind.value,
    hasEvent: hasEventMode.value,
    hits: (props.hits ?? []).map(
      (hit) =>
        `${hit.id}:${hit.skill.id}:${hit.count}:${hit.critMode}` +
        `:${hit.anomalyPowerAgentId ?? ''}:${hit.triggerAgentId ?? ''}:${hit.anomalySubKind ?? ''}`,
    ),
    mainAgent: mainAgent.value?.id ?? '',
  }),
)

watch(eventAffixImpactStructureKey, () => {
  showEventAffixImpact.value = false
  eventAffixImpact.value = []
  eventAffixImpactStale.value = false
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

const anomalyChartList = computed(() => {
  const all = [
    {
      key: 'anomaly' as AnomalyMetric,
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
      key: 'disorder' as AnomalyMetric,
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
      key: 'turbulence' as AnomalyMetric,
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
    {
      key: 'anomalyRelease' as AnomalyMetric,
      title: '异放期望伤害',
      series: [
        {
          key: 'anomalyRelease',
          label: '异放期望',
          color: '#e5c07b',
          values: anomalyPoints.value.map((p) => p.anomalyReleaseExpected),
        },
      ],
    },
    {
      key: 'radiance' as AnomalyMetric,
      title: '耀变期望伤害',
      series: [
        {
          key: 'radiance',
          label: '耀变期望',
          color: '#ffd580',
          values: anomalyPoints.value.map((p) => p.radianceExpected),
        },
      ],
    },
  ]
  const sub = anomalySubKind.value
  return all.filter((item) => item.key === sub)
})

watch(
  anomalySubKind,
  (sub) => {
    anomalyChartMetric.value = sub
  },
  { immediate: true },
)

/** 面板展示用：未开算时按当前词条分配预览；已有扫掠点时优先用扫掠结果 */
const displayCounts = computed(() => {
  if (selectedCounts.value) return selectedCounts.value
  if (damageKind.value === 'direct') {
    if (directPoints.value[0]?.affixCounts) return directPoints.value[0].affixCounts
    if (directError.value || !mainAgent.value?.id) return null
    const crit = Math.round(directAlloc.critRate)
    const total = Math.round(directAlloc.totalRolls)
    const fixedAtk = isMb.value ? Math.round(directAlloc.atkPercent) : 0
    const remain = isMb.value ? total - crit - fixedAtk : total - crit
    if (remain < 0) return null
    return buildDirectAffixCounts(
      isMb.value,
      { ...directAlloc, critRate: crit, totalRolls: total },
      0,
      remain,
    )
  }
  if (anomalyPoints.value[0]?.affixCounts) return anomalyPoints.value[0].affixCounts
  if (anomalyError.value || !damageKind.value || !mainAgent.value?.id) return null
  const total = Math.round(anomalyAlloc.totalRolls)
  return buildAnomalyAffixCounts(isMb.value, { ...anomalyAlloc, totalRolls: total }, 0, total)
})

const selectedEval = computed(() => {
  if (!selectedCounts.value) return null
  const point =
    damageKind.value === 'direct' ? selectedDirect.value : selectedAnomaly.value
  if (point?.evalSnapshot) return point.evalSnapshot
  // 过程 Tab 需要完整事件明细；其余场景只算主 C 面板，避免点柱就卡一下
  if (detailTab.value === 'process') {
    return evaluateAffixCounts(evalCtx.value, selectedCounts.value)
  }
  return evaluateAffixCounts({ ...evalCtx.value, hits: undefined }, selectedCounts.value)
})

/** 面板展示：优先复用选中/扫掠结果；否则只算主 C 面板（不算全部事件） */
const displayEval = computed(() => {
  if (selectedEval.value) return selectedEval.value
  const point = sweepPoints.value[0]
  if (point?.evalSnapshot) return point.evalSnapshot
  if (!displayCounts.value) return null
  const panelOnlyCtx = { ...evalCtx.value, hits: undefined }
  return evaluateAffixCounts(panelOnlyCtx, displayCounts.value)
})

const analysisCounts = computed(() => selectedCounts.value ?? displayCounts.value)

const analysisEval = computed(() => {
  if (!analysisCounts.value) return null
  if (selectedCounts.value && selectedEval.value) return selectedEval.value
  return displayEval.value
})

watch(
  () =>
    JSON.stringify({
      counts: analysisCounts.value,
      mains: { ...driveDiscMainStats },
    }),
  () => {
    scheduleEventAffixImpactRefresh()
  },
)

/**
 * 招式流程用的局外面板：优先当前选中/展示柱体的最优词条面板；
 * 尚未开始计算时，按「第一个扫掠点」规则（余量全给爆伤/精通）现场推导，避免残留面板计算数值。
 */
const skillFlowExternal = computed(() => {
  if (analysisEval.value?.external) return analysisEval.value.external
  if (!damageKind.value) return null
  if (damageKind.value === 'direct') {
    if (directError.value) return null
    const crit = Math.round(directAlloc.critRate)
    const total = Math.round(directAlloc.totalRolls)
    const fixedAtk = isMb.value ? Math.round(directAlloc.atkPercent) : 0
    const remain = isMb.value ? total - crit - fixedAtk : total - crit
    if (remain < 0) return null
    const counts = buildDirectAffixCounts(
      isMb.value,
      { ...directAlloc, critRate: crit, totalRolls: total },
      0,
      remain,
    )
    return evaluateAffixCounts({ ...evalCtx.value, hits: undefined }, counts).external
  }
  if (anomalyError.value) return null
  const total = Math.round(anomalyAlloc.totalRolls)
  const counts = buildAnomalyAffixCounts(isMb.value, { ...anomalyAlloc, totalRolls: total }, 0, total)
  return evaluateAffixCounts({ ...evalCtx.value, hits: undefined }, counts).external
})

/** 用最优词条面板重算流程/准备招式预览伤害，供招式流程展示（防抖 + per-hit 缓存） */
const skillFlowHitMapState = ref<{
  map: Record<string, number>
  results: Record<string, DamageCalcResult>
}>({ map: {}, results: {} })

type SkillFlowLineCache = {
  signatureById: Record<string, string>
  lineById: Record<
    string,
    { total: number; perHit: number; result: DamageCalcResult }
  >
}
const skillFlowLineStore: SkillFlowLineCache = { signatureById: {}, lineById: {} }
let skillFlowCacheGlobalSig = ''
let pendingSkillFlowEmit = false

function clearSkillFlowLineStore() {
  for (const key of Object.keys(skillFlowLineStore.signatureById)) {
    delete skillFlowLineStore.signatureById[key]
  }
  for (const key of Object.keys(skillFlowLineStore.lineById)) {
    delete skillFlowLineStore.lineById[key]
  }
}

/** 对齐面板 buildResolvedHitSignature，避免改倍率覆写/panelMods 不刷新 */
function hitFingerprint(hit: import('@/utils/resolvedHit').ResolvedHit) {
  return JSON.stringify({
    id: hit.id,
    ownerAgentId: hit.ownerAgentId,
    anomalyPowerAgentId: hit.anomalyPowerAgentId,
    triggerAgentId: hit.triggerAgentId,
    count: hit.count,
    staggerPhase: hit.staggerPhase,
    critMode: hit.critMode,
    anomalySubKind: hit.anomalySubKind,
    skillId: hit.skill.id,
    damageType: hit.skill.damageType,
    baseMult: hit.skill.baseMult,
    baseMultFactor: hit.skill.baseMultFactor,
    settlementMult: hit.skill.settlementMult,
    skillTypes: hit.skill.skillTypes,
    buffAnchorId: hit.skill.buffAnchorId,
    multOverrides: hit.multOverrides,
    panelMods: hit.panelMods,
  })
}

const skillFlowContextFingerprint = computed(() =>
  JSON.stringify({
    enemy: enemyInput.value,
    extraGains: extraGains.value,
    buffSelection: props.buffSelection,
    slotBuffSelections: props.slotBuffSelections,
    convert: props.convertSlotPanels ?? {},
    anomaly: props.anomalySlotPanels ?? {},
    participants: optimalParticipantPanels,
    env: (props.environmentBuffs ?? []).map((item) => item.id),
    bangboo: [props.selectedBangbooId, props.bangbooRefine],
    mains: { ...driveDiscMainStats },
    baseDamageSource: baseDamageSource.value,
    damageKind: damageKind.value,
    stagger: props.staggerPhase,
  }),
)

const skillFlowHitFingerprint = computed(() => {
  if (!isSectionActive.value) return 'inactive'
  const external = skillFlowExternal.value
  return JSON.stringify({
    context: skillFlowContextFingerprint.value,
    external: external ?? null,
    hits: (props.hits ?? []).map(hitFingerprint),
    previews: (props.previewHits ?? []).map(hitFingerprint),
  })
})

function recomputeSkillFlowHitMaps() {
  if (!isSectionActive.value) {
    clearSkillFlowLineStore()
    skillFlowCacheGlobalSig = ''
    skillFlowHitMapState.value = { map: {}, results: {} }
    return
  }
  const map: Record<string, number> = {}
  const results: Record<string, DamageCalcResult> = {}
  const external = skillFlowExternal.value
  if (!external) {
    skillFlowHitMapState.value = { map, results }
    return
  }
  // 流程计入总伤；准备招式只算单次预览。招式库不算。
  for (const hit of [...(props.hits ?? []), ...(props.previewHits ?? [])]) {
    for (const id of [hit.ownerAgentId, hit.anomalyPowerAgentId, hit.triggerAgentId]) {
      if (id) seedOptimalParticipantPanel(id)
    }
  }

  const globalSig = skillFlowContextFingerprint.value + '|' + JSON.stringify(external)
  if (globalSig !== skillFlowCacheGlobalSig) {
    clearSkillFlowLineStore()
    skillFlowCacheGlobalSig = globalSig
  }

  const ctx = evalCtx.value
  const nextSignatures: Record<string, string> = {}

  const resolveLine = (hit: import('@/utils/resolvedHit').ResolvedHit, usePerHit: boolean) => {
    const signature = `${hitFingerprint(hit)}|${globalSig}|${usePerHit ? '1' : '0'}`
    nextSignatures[hit.id] = signature
    const cached = skillFlowLineStore.lineById[hit.id]
    if (cached && skillFlowLineStore.signatureById[hit.id] === signature) {
      map[hit.id] = usePerHit ? cached.perHit : cached.total
      results[hit.id] = cached.result
      return
    }
    const detail = evaluateOptimalEventDetail(ctx, external, hit)
    if (!detail) {
      delete skillFlowLineStore.lineById[hit.id]
      return
    }
    skillFlowLineStore.lineById[hit.id] = {
      total: detail.total,
      perHit: detail.perHit,
      result: detail.result,
    }
    skillFlowLineStore.signatureById[hit.id] = signature
    map[hit.id] = usePerHit ? detail.perHit : detail.total
    results[hit.id] = detail.result
  }

  for (const hit of props.hits ?? []) resolveLine(hit, false)
  for (const hit of props.previewHits ?? []) resolveLine(hit, true)

  for (const key of Object.keys(skillFlowLineStore.signatureById)) {
    if (!(key in nextSignatures)) {
      delete skillFlowLineStore.signatureById[key]
      delete skillFlowLineStore.lineById[key]
    }
  }

  skillFlowHitMapState.value = { map, results }
}

function emitSkillFlowHitMaps() {
  if (!isSectionActive.value) return
  if (sweepComputing.value) {
    pendingSkillFlowEmit = true
    return
  }
  pendingSkillFlowEmit = false
  recomputeSkillFlowHitMaps()
  emit('update:hitDamages', skillFlowHitMapState.value.map)
  emit('update:hitCalcResults', skillFlowHitMapState.value.results)
}

watch(
  skillFlowHitFingerprint,
  () => {
    if (!isSectionActive.value) {
      clearSkillFlowLineStore()
      skillFlowCacheGlobalSig = ''
      skillFlowHitMapState.value = { map: {}, results: {} }
      return
    }
    if (skillFlowEmitTimer) clearTimeout(skillFlowEmitTimer)
    skillFlowEmitTimer = setTimeout(() => {
      emitSkillFlowHitMaps()
    }, SKILL_FLOW_EMIT_DEBOUNCE_MS)
  },
  { immediate: true },
)

watch([sweepComputing, isSectionActive], ([computing, active]) => {
  if (computing || !active) return
  if (!pendingSkillFlowEmit && !skillFlowEmitTimer) return
  if (skillFlowEmitTimer) clearTimeout(skillFlowEmitTimer)
  skillFlowEmitTimer = setTimeout(() => {
    emitSkillFlowHitMaps()
  }, SKILL_FLOW_EMIT_DEBOUNCE_MS)
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
  return formatCalcDecimal(value, 4)
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

function metricOf(result: DamageCalcResult, grandTotal?: number) {
  if (typeof grandTotal === 'number' && Number.isFinite(grandTotal)) return grandTotal
  if (damageKind.value === 'direct') return result.directDamageExpected
  if (anomalyChartMetric.value === 'disorder') return result.disorderExpected
  if (anomalyChartMetric.value === 'turbulence') return result.turbulenceExpected
  if (anomalyChartMetric.value === 'anomalyRelease') return result.anomalyReleaseExpected
  if (anomalyChartMetric.value === 'radiance') return result.radianceExpected
  return result.anomalyExpected
}

type AffixEvalSnapshot = {
  result: DamageCalcResult
  grandTotal: number
  eventLines: OptimalEventDamageLine[]
}

/** 事件模式下按「统计事件」筛选求和；非事件模式走原 metric */
function resolveAffixMetricDamage(evaled: AffixEvalSnapshot) {
  if (!hasEventMode.value || !evaled.eventLines?.length) {
    return metricOf(evaled.result, evaled.grandTotal)
  }
  const ids = new Set(selectedChartEventIds.value)
  if (!ids.size) return 0
  return evaled.eventLines
    .filter((line) => ids.has(line.eventId))
    .reduce((sum, line) => sum + line.total, 0)
}

const mainStatEventScopeHint = computed(() => {
  if (!hasEventMode.value) return ''
  if (!selectedChartEventIds.value.length) return '未选择统计事件'
  if (selectedChartEventIds.value.length === chartEventOptions.value.length) {
    return '按全部统计事件计算'
  }
  return `按已选 ${selectedChartEventIds.value.length} 个统计事件计算`
})

const analysisMetricDamage = computed(() => {
  if (!analysisEval.value) return 0
  return resolveAffixMetricDamage(analysisEval.value)
})

/** 过程明细仅在「计算过程」Tab 展开且模块可见时求值，避免扫掠后全量重算卡顿 */
const processEventRows = computed((): ProcessEventRow[] => {
  if (!isSectionActive.value || detailTab.value !== 'process' || !hasEventMode.value) return []
  const counts = analysisCounts.value
  if (!counts) return []
  const external =
    analysisEval.value?.external ?? evaluateAffixCounts(evalCtx.value, counts).external
  const selectedIds = new Set(selectedChartEventIds.value)
  if (!selectedIds.size) return []
  return (props.hits ?? [])
    .filter((hit) => selectedIds.has(hit.id))
    .map((hit) => {
      const ownerName = props.agents.find((item) => item.id === hit.ownerAgentId)?.name
      const displayName = `${ownerName ? `${ownerName} · ` : ''}${hit.skill.name}`
      const skipReason = getHitSkipReason(hit, {
        teamSlots: props.teamSlots,
        agents: props.agents,
      })
      const detail = skipReason
        ? null
        : evaluateOptimalEventDetail(evalCtx.value, external, hit)
      return {
        hit,
        eventId: hit.id,
        displayName,
        detail,
        skipReason,
      }
    })
})

watch(
  processEventRows,
  (rows) => {
    const selectable = rows.filter((row) => row.detail)
    if (!selectable.length) {
      selectedProcessEventId.value = null
      return
    }
    if (!selectable.some((row) => row.eventId === selectedProcessEventId.value)) {
      selectedProcessEventId.value = selectable[0]!.eventId
    }
  },
  { immediate: true },
)

const selectedProcessEventRow = computed(
  () => processEventRows.value.find((row) => row.eventId === selectedProcessEventId.value) ?? null,
)

const selectedProcessEventDetail = computed(() => selectedProcessEventRow.value?.detail ?? null)

/** 与柱状图/词条分析同一口径：analysisEval.eventLines + analysisMetricDamage */
const processOwnerShareSummary = computed(() => {
  const evaled = analysisEval.value
  if (!hasEventMode.value || !evaled?.eventLines?.length) return null
  const selectedIds = new Set(selectedChartEventIds.value)
  if (!selectedIds.size) return null
  const hitById = new Map((props.hits ?? []).map((hit) => [hit.id, hit]))
  const lines = evaled.eventLines.filter((line) => selectedIds.has(line.eventId))
  if (!lines.length) return null
  const summary = summarizeDamageByOwner(
    lines
      .map((line) => {
        const hit = hitById.get(line.eventId)
        if (!hit) return null
        return {
          ownerAgentId: hit.ownerAgentId,
          eventId: line.eventId,
          displayName: line.displayName,
          total: line.total,
          perHit: line.perHit,
          count: hit.count,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item != null),
    (id) => props.agents.find((item) => item.id === id),
  )
  return {
    ...summary,
    grandTotal: analysisMetricDamage.value,
  }
})

const processSkippedEvents = computed(() => {
  if (!hasEventMode.value) return []
  const selectedIds = new Set(selectedChartEventIds.value)
  if (!selectedIds.size) return []
  const computedIds = new Set(
    (analysisEval.value?.eventLines ?? [])
      .filter((line) => selectedIds.has(line.eventId))
      .map((line) => line.eventId),
  )
  return (props.hits ?? [])
    .filter((hit) => selectedIds.has(hit.id) && !computedIds.has(hit.id))
    .map((hit) => {
      const ownerName = props.agents.find((item) => item.id === hit.ownerAgentId)?.name
      const displayName = `${ownerName ? `${ownerName} · ` : ''}${hit.skill.name}`
      const skipReason = getHitSkipReason(hit, {
        teamSlots: props.teamSlots,
        agents: props.agents,
      })
      return {
        eventId: hit.id,
        displayName,
        reason: skipReason ?? '无法计算',
      }
    })
})

const processDamageTotalLabel = computed(() =>
  damageKind.value === 'anomaly' ? '异常伤害事件总伤期望' : '伤害事件总伤期望',
)

function selectProcessEventFromShare(eventId: string) {
  const row = processEventRows.value.find((item) => item.eventId === eventId)
  if (!row?.detail) return
  detailTab.value = 'process'
  selectedProcessEventId.value = eventId
}

const filteredEventAffixImpact = computed(() => {
  if (!hasEventMode.value || !selectedChartEventIds.value.length) {
    return eventAffixImpact.value
  }
  const ids = new Set(selectedChartEventIds.value)
  return eventAffixImpact.value.filter((row) => ids.has(row.eventId))
})

const rankingSlot4Ids = ref<DriveDiscSlot4StatId[]>(
  DRIVE_DISC_SLOT_4_OPTIONS.map((item) => item.id),
)
const rankingSlot5Ids = ref<DriveDiscSlot5StatId[]>(
  DRIVE_DISC_SLOT_5_OPTIONS.map((item) => item.id),
)
const rankingSlot6Ids = ref<DriveDiscSlot6StatId[]>(
  DRIVE_DISC_SLOT_6_OPTIONS.map((item) => item.id),
)
const combinedRankingsExpanded = ref(false)

const rankingSlot4Options = computed(() => {
  const allowed = new Set(rankingSlot4Ids.value)
  return DRIVE_DISC_SLOT_4_OPTIONS.filter((item) => allowed.has(item.id))
})

const rankingSlot5Options = computed(() => {
  const allowed = new Set(rankingSlot5Ids.value)
  return DRIVE_DISC_SLOT_5_OPTIONS.filter((item) => allowed.has(item.id))
})

const rankingSlot6Options = computed(() => {
  const allowed = new Set(rankingSlot6Ids.value)
  return DRIVE_DISC_SLOT_6_OPTIONS.filter((item) => allowed.has(item.id))
})

const rankingComboCount = computed(() => {
  const n4 = rankingSlot4Options.value.length
  const n5 = rankingSlot5Options.value.length
  const n6 = rankingSlot6Options.value.length
  if (!n4 || !n5 || !n6) return 0
  let count = n4 * n5 * n6
  const currentInRange =
    rankingSlot4Options.value.some((item) => item.id === driveDiscMainStats.slot4MainStat) &&
    rankingSlot5Options.value.some((item) => item.id === driveDiscMainStats.slot5MainStat) &&
    rankingSlot6Options.value.some((item) => item.id === driveDiscMainStats.slot6MainStat)
  if (currentInRange && rankingTwoPieceId.value === currentTwoPieceId.value) count -= 1
  return count
})

const currentTwoPieceId = computed(() => mainSlot.value.twoPieceDriveDiscId)

/** 限定组合排行时使用的 2 件套（单选，替换当前 2 件套数值参与计算） */
const rankingTwoPieceId = ref('none')
const combinedTwoPiecePickerOpen = ref(false)
const rankingTwoPiecePickerOpen = ref(false)

watch(
  currentTwoPieceId,
  (id) => {
    rankingTwoPieceId.value = id
  },
  { immediate: true },
)

function resolveTwoPieceLabel(id: string) {
  if (id === 'none') return '不佩戴'
  return props.driveDiscs.find((item) => item.id === id)?.name ?? id
}

function resolveTwoPieceAvatar(id: string) {
  if (id === 'none') return null
  return props.driveDiscs.find((item) => item.id === id)?.avatar_image ?? null
}

function selectCombinedTwoPiece(id: string) {
  combinedMainStatDraftTwoPieceId.value = id
}

function selectRankingTwoPiece(id: string) {
  rankingTwoPieceId.value = id
}

function isRankingSlotOptionSelected(slot: 4 | 5 | 6, id: string) {
  if (slot === 4) return rankingSlot4Ids.value.includes(id as DriveDiscSlot4StatId)
  if (slot === 5) return rankingSlot5Ids.value.includes(id as DriveDiscSlot5StatId)
  return rankingSlot6Ids.value.includes(id as DriveDiscSlot6StatId)
}

function toggleRankingSlotOption(slot: 4 | 5 | 6, id: string) {
  if (slot === 4) {
    const next = new Set(rankingSlot4Ids.value)
    const statId = id as DriveDiscSlot4StatId
    if (next.has(statId)) {
      if (next.size <= 1) return
      next.delete(statId)
    } else {
      next.add(statId)
    }
    rankingSlot4Ids.value = [...next]
    return
  }
  if (slot === 5) {
    const next = new Set(rankingSlot5Ids.value)
    const statId = id as DriveDiscSlot5StatId
    if (next.has(statId)) {
      if (next.size <= 1) return
      next.delete(statId)
    } else {
      next.add(statId)
    }
    rankingSlot5Ids.value = [...next]
    return
  }
  const next = new Set(rankingSlot6Ids.value)
  const statId = id as DriveDiscSlot6StatId
  if (next.has(statId)) {
    if (next.size <= 1) return
    next.delete(statId)
  } else {
    next.add(statId)
  }
  rankingSlot6Ids.value = [...next]
}

function selectAllRankingSlotOptions(slot: 4 | 5 | 6) {
  if (slot === 4) rankingSlot4Ids.value = DRIVE_DISC_SLOT_4_OPTIONS.map((item) => item.id)
  else if (slot === 5) rankingSlot5Ids.value = DRIVE_DISC_SLOT_5_OPTIONS.map((item) => item.id)
  else rankingSlot6Ids.value = DRIVE_DISC_SLOT_6_OPTIONS.map((item) => item.id)
}

const MAIN_STAT_SLOTS = [
  { key: 'slot4MainStat', title: '4号位', options: DRIVE_DISC_SLOT_4_OPTIONS },
  { key: 'slot5MainStat', title: '5号位', options: DRIVE_DISC_SLOT_5_OPTIONS },
  { key: 'slot6MainStat', title: '6号位', options: DRIVE_DISC_SLOT_6_OPTIONS },
] as const

const diffAnalysis = ref<ReturnType<typeof computeDiffAnalysis> | null>(null)
const mainStatDiff = ref<ReturnType<typeof mainStatDiffBuilder> | null>(null)
const showMainStatDiff = ref(false)
const mainStatDiffLoading = ref(false)
const benefitData = ref<ReturnType<typeof computeBenefitCurves> | null>(null)
const combinedMainStatRankings = ref<
  {
    slot4: string
    slot5: string
    slot6: string
    summaryLabel: string
    damageDelta: number
    percentDelta: number
  }[]
>([])

function mainStatDiffBuilder() {
  const counts = analysisCounts.value
  const base = analysisEval.value
  if (!counts || !base) return null
  const baseDmg = resolveAffixMetricDamage(base)

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
        const dmg = resolveAffixMetricDamage(evaled)
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
}

function buildCombinedMainStatRankings() {
  if (!analysisCounts.value || !analysisEval.value) return []
  const baseDamage = resolveAffixMetricDamage(analysisEval.value)
  const currentStats = driveDiscMainStats
  const rows: {
    slot4: string
    slot5: string
    slot6: string
    summaryLabel: string
    damageDelta: number
    percentDelta: number
  }[] = []

  for (const slot4 of rankingSlot4Options.value) {
    for (const slot5 of rankingSlot5Options.value) {
      for (const slot6 of rankingSlot6Options.value) {
        if (
          slot4.id === currentStats.slot4MainStat &&
          slot5.id === currentStats.slot5MainStat &&
          slot6.id === currentStats.slot6MainStat &&
          rankingTwoPieceId.value === currentTwoPieceId.value
        ) {
          continue
        }
        const comboStats: AffixDriveDiscMainStats = {
          slot4MainStat: slot4.id,
          slot5MainStat: slot5.id,
          slot6MainStat: slot6.id,
        }
        const damage = evaluateMainStatComboDamage(
          comboStats,
          analysisCounts.value,
          rankingTwoPieceId.value,
        )
        const damageDelta = damage - baseDamage
        rows.push({
          slot4: slot4.id,
          slot5: slot5.id,
          slot6: slot6.id,
          summaryLabel: `${slot4.label} / ${slot5.label} / ${slot6.label}`,
          damageDelta,
          percentDelta: baseDamage > 0 ? (damageDelta / baseDamage) * 100 : 0,
        })
      }
    }
  }

  return rows.sort((a, b) => b.damageDelta - a.damageDelta)
}

function recomputeDiffAnalysis() {
  if (detailTab.value !== 'diff' || !analysisCounts.value || !damageKind.value) {
    diffAnalysis.value = null
    mainStatDiff.value = null
    showMainStatDiff.value = false
    return
  }
  diffAnalysis.value = computeDiffAnalysis(
    evalCtx.value,
    analysisCounts.value,
    damageKind.value,
    anomalyChartMetric.value,
    hasEventMode.value ? selectedChartEventIds.value : null,
  )
}

function loadMainStatDiff() {
  if (!analysisCounts.value || !analysisEval.value) return
  mainStatDiffLoading.value = true
  window.setTimeout(() => {
    mainStatDiff.value = mainStatDiffBuilder()
    showMainStatDiff.value = true
    mainStatDiffLoading.value = false
  }, 0)
}

function scheduleDiffRecompute() {
  if (diffTimer) clearTimeout(diffTimer)
  const delay = hasEventMode.value ? DIFF_EVENT_DEBOUNCE_MS : DIFF_DEBOUNCE_MS
  diffTimer = setTimeout(recomputeDiffAnalysis, delay)
}

function recomputeBenefitData() {
  if (detailTab.value !== 'curve' || !analysisCounts.value || !damageKind.value) {
    benefitData.value = null
    return
  }
  benefitData.value = computeBenefitCurves(
    evalCtx.value,
    analysisCounts.value,
    damageKind.value,
    anomalyChartMetric.value,
    BENEFIT_CURVE_MAX_ADDED,
    hasEventMode.value ? selectedChartEventIds.value : null,
  )
}

function loadCombinedMainStatRankings() {
  if (combinedMainStatRankingsLoading.value || rankingComboCount.value <= 0) return
  combinedMainStatRankingsLoading.value = true
  window.setTimeout(() => {
    combinedMainStatRankings.value = buildCombinedMainStatRankings()
    showCombinedMainStatRankings.value = true
    combinedRankingsExpanded.value = true
    combinedMainStatRankingsLoading.value = false
  }, 0)
}

function collapseCombinedMainStatRankings() {
  combinedRankingsExpanded.value = false
}

function expandCombinedMainStatRankings() {
  if (combinedMainStatRankings.value.length) {
    combinedRankingsExpanded.value = true
  }
}

const diffWatchFingerprint = computed(() =>
  JSON.stringify({
    counts: analysisCounts.value,
    kind: damageKind.value,
    metric: anomalyChartMetric.value,
    tab: detailTab.value,
    events: hasEventMode.value ? selectedChartEventIds.value : null,
    mains: { ...driveDiscMainStats },
    agents: props.teamSlots.map((s) => s.agentId ?? ''),
    hits: (props.hits ?? []).map(
      (h) =>
        `${h.id}:${h.skill.id}:${h.count}:${h.critMode}` +
        `:${h.anomalyPowerAgentId ?? ''}:${h.triggerAgentId ?? ''}:${h.anomalySubKind ?? ''}`,
    ),
  }),
)

watch(diffWatchFingerprint, () => {
  if (detailTab.value === 'diff') scheduleDiffRecompute()
  else if (detailTab.value === 'curve') recomputeBenefitData()
  showMainStatDiff.value = false
  mainStatDiff.value = null
  if (detailTab.value !== 'diff') {
    showCombinedMainStatRankings.value = false
    combinedMainStatRankings.value = []
  }
})

watch(detailTab, (tab) => {
  if (tab === 'diff') scheduleDiffRecompute()
  if (tab === 'curve') recomputeBenefitData()
  if (tab === 'process') ensureSelectedEvalSnapshot()
})

const combinedMainStatDraft = reactive(createDefaultAffixDriveDiscMainStats())
const combinedMainStatDraftTwoPieceId = ref('none')

function resolveMainStatLabel(
  options: readonly { id: string; label: string }[],
  id: string,
) {
  return options.find((item) => item.id === id)?.label ?? id
}

function syncCombinedMainStatDraftFromCurrent() {
  combinedMainStatDraft.slot4MainStat = driveDiscMainStats.slot4MainStat
  combinedMainStatDraft.slot5MainStat = driveDiscMainStats.slot5MainStat
  combinedMainStatDraft.slot6MainStat = driveDiscMainStats.slot6MainStat
  combinedMainStatDraftTwoPieceId.value = currentTwoPieceId.value
}

watch(
  () => [
    driveDiscMainStats.slot4MainStat,
    driveDiscMainStats.slot5MainStat,
    driveDiscMainStats.slot6MainStat,
    currentTwoPieceId.value,
  ],
  syncCombinedMainStatDraftFromCurrent,
  { immediate: true },
)

function resetCombinedMainStatDraft() {
  syncCombinedMainStatDraftFromCurrent()
}

function applyCombinedMainStatRanking(row: {
  slot4: string
  slot5: string
  slot6: string
}) {
  combinedMainStatDraft.slot4MainStat = row.slot4 as typeof combinedMainStatDraft.slot4MainStat
  combinedMainStatDraft.slot5MainStat = row.slot5 as typeof combinedMainStatDraft.slot5MainStat
  combinedMainStatDraft.slot6MainStat = row.slot6 as typeof combinedMainStatDraft.slot6MainStat
}

function evaluateMainStatComboDamage(
  mainStats: AffixDriveDiscMainStats,
  counts: AffixCounts,
  twoPieceId?: string,
) {
  const evaled = evaluateAffixCounts(
    {
      ...evalCtx.value,
      driveDiscMainStats: {
        ...evalCtx.value.driveDiscMainStats,
        ...mainStats,
      },
      driveDiscSelection: {
        ...evalCtx.value.driveDiscSelection,
        twoPieceDriveDiscId: twoPieceId ?? evalCtx.value.driveDiscSelection.twoPieceDriveDiscId,
      },
    },
    counts,
  )
  return resolveAffixMetricDamage(evaled)
}

const combinedMainStatPreview = computed(() => {
  if (!analysisCounts.value || !analysisEval.value) return null
  const baseDamage = resolveAffixMetricDamage(analysisEval.value)
  const currentStats: AffixDriveDiscMainStats = {
    slot4MainStat: driveDiscMainStats.slot4MainStat,
    slot5MainStat: driveDiscMainStats.slot5MainStat,
    slot6MainStat: driveDiscMainStats.slot6MainStat,
  }
  const draftStats: AffixDriveDiscMainStats = {
    slot4MainStat: combinedMainStatDraft.slot4MainStat,
    slot5MainStat: combinedMainStatDraft.slot5MainStat,
    slot6MainStat: combinedMainStatDraft.slot6MainStat,
  }
  const unchanged =
    draftStats.slot4MainStat === currentStats.slot4MainStat &&
    draftStats.slot5MainStat === currentStats.slot5MainStat &&
    draftStats.slot6MainStat === currentStats.slot6MainStat &&
    combinedMainStatDraftTwoPieceId.value === currentTwoPieceId.value
  const proposedDamage = unchanged
    ? baseDamage
    : evaluateMainStatComboDamage(
        draftStats,
        analysisCounts.value,
        combinedMainStatDraftTwoPieceId.value,
      )
  const damageDelta = proposedDamage - baseDamage
  return {
    baseDamage,
    proposedDamage,
    damageDelta,
    percentDelta: baseDamage > 0 ? (damageDelta / baseDamage) * 100 : 0,
    unchanged,
    currentLabels: {
      slot4: resolveMainStatLabel(DRIVE_DISC_SLOT_4_OPTIONS, currentStats.slot4MainStat),
      slot5: resolveMainStatLabel(DRIVE_DISC_SLOT_5_OPTIONS, currentStats.slot5MainStat),
      slot6: resolveMainStatLabel(DRIVE_DISC_SLOT_6_OPTIONS, currentStats.slot6MainStat),
      twoPiece: resolveTwoPieceLabel(currentTwoPieceId.value),
    },
  }
})

const remainDirect = computed(() => {
  const crit = Math.round(directAlloc.critRate)
  const total = Math.round(directAlloc.totalRolls)
  if (isMb.value) {
    const fixedAtk = Math.round(directAlloc.atkPercent)
    return Math.max(0, total - crit - fixedAtk)
  }
  return Math.max(0, total - crit)
})

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

function ensureSelectedEvalSnapshot() {
  const idx = selectedIndex.value
  if (idx == null) return
  const points = damageKind.value === 'direct' ? directPoints.value : anomalyPoints.value
  const point = points[idx]
  if (!point || point.evalSnapshot) return
  point.evalSnapshot = evaluateAffixCounts(evalCtx.value, point.affixCounts)
}

function applyDefaultCrit() {
  if (!mainAgent.value?.id || damageKind.value !== 'direct') return
  const crit = findMinCritRollsForOvercap(evalCtx.value, {
    flatStat: directAlloc.flatStat,
    hpFlat: directAlloc.hpFlat,
    atkPercent: directAlloc.atkPercent,
    pen: directAlloc.pen,
  })
  directAlloc.critRate = crit
  // 保留用户已填的更高总词条，避免每次重算默认暴击把总数打回 crit
  directAlloc.totalRolls = Math.max(Math.round(directAlloc.totalRolls) || 0, crit)
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
  if (!kind) return
  if (kind === 'direct') applyDefaultCrit()
  else {
    anomalyAlloc.totalRolls = 0
  }
})

watch([directPoints, anomalyPoints, damageKind], syncSelectedBarAfterSweep)

watch(
  () => directAlloc.critRate,
  (crit) => {
    const minTotal = isMb.value ? crit + Math.round(directAlloc.atkPercent) : crit
    if (directAlloc.totalRolls < minTotal) directAlloc.totalRolls = minTotal
  },
)

watch(
  () => directAlloc.atkPercent,
  (atkPercent) => {
    if (!isMb.value) return
    const minTotal = Math.round(directAlloc.critRate) + Math.round(atkPercent)
    if (directAlloc.totalRolls < minTotal) directAlloc.totalRolls = minTotal
  },
)

defineExpose({
  buffBreakdown: computed(() => displayEval.value?.breakdown ?? null),
  displayEval,
  previewFinalPanel,
  /** 全槽局外 + 局内（随增益实时重算；主 C 优先用扫掠/预览结算） */
  slotPanelPreviews: computed(() => {
    void optimalParticipantPanels
    void extraGains.value
    void JSON.stringify(props.slotBuffSelections ?? {})
    void props.staggerPhase
    void props.bangbooRefine
    void selectedBangboo.value.id
    void props.environmentBuffs
    void displayEval.value
    const mainEval = displayEval.value
    return props.teamSlots.map((slot, index) => {
      if (!slot.agentId) return null
      if (index === mainSlotIndex.value && mainEval) {
        return {
          external: mainEval.external,
          final: mainEval.finalPanel,
        }
      }
      const seeded = optimalParticipantPanels[slot.agentId]
      if (!seeded) return null
      const external = fillPanelStatsDefaults(seeded)
      return {
        external,
        final: previewFinalPanel(external, index),
      }
    })
  }),
})

function buildPreviewPanelContext(slotIndex: number) {
  const agent = props.agents.find((item) => item.id === props.teamSlots[slotIndex]?.agentId)
  return {
    teamSlots: props.teamSlots,
    agents: props.agents,
    wengines: props.wengines,
    bangboo: selectedBangboo.value,
    bangbooRefine: props.bangbooRefine,
    mainSlotIndex: slotIndex,
    liveExternalSlotIndex: mainSlotIndex.value,
    driveDiscs: props.driveDiscs,
    extraGains: extraGains.value,
    skillContext: buildGenericPanelSkillContext({
      element: agent?.element,
      staggerPhase: props.staggerPhase ?? 'stagger',
    }),
    buffSelection: resolveBuffSelectionForSlot(props.slotBuffSelections, slotIndex),
    anomalySlotPanels: effectiveAnomalySlotPanels.value,
    convertSlotPanels: props.convertSlotPanels,
    environmentBuffs: props.environmentBuffs,
  }
}

function previewFinalPanel(external: PanelStats, slotIndex?: number): PanelStats | null {
  const index = slotIndex ?? mainSlotIndex.value
  if (index < 0 || index >= props.teamSlots.length) return null
  try {
    return computeFinalPanel(
      fillPanelStatsDefaults(external),
      buildPreviewPanelContext(index),
    ).finalPanel
  } catch {
    return null
  }
}
</script>

<template>
  <section class="opt-section">
    <header class="opt-header">
      <h2>词条分配与伤害曲线</h2>
      <p>
        先选择直伤或异常模式，在约束内设置固定词条与总词条数后开始计算；点击柱体查看差异与收益曲线。柱状图在固定小词条与穿透等前提下扫掠，并非全词条穷举最优。
      </p>
    </header>

    <div class="kind-mode-row" role="tablist" aria-label="最优词条伤害模式">
      <span class="kind-mode-label">伤害模式</span>
      <button
        type="button"
        role="tab"
        class="kind-mode-tab"
        :class="{ active: damageKind === 'direct' }"
        :aria-selected="damageKind === 'direct'"
        @click="setDamageKind('direct')"
      >
        直伤
      </button>
      <button
        type="button"
        role="tab"
        class="kind-mode-tab"
        :class="{ active: damageKind === 'anomaly' }"
        :aria-selected="damageKind === 'anomaly'"
        @click="setDamageKind('anomaly')"
      >
        异常
      </button>
      <p v-if="!damageKind" class="hint kind-mode-hint">请先选择直伤或异常，再配置词条并开始计算。</p>
    </div>

    <template v-if="damageKind">
    <h3 class="block-title">基础伤害来源与驱动盘主属性</h3>
    <div class="grid three">
      <label class="field">
        <span>基础伤害来源</span>
        <select v-model="baseDamageSource" :disabled="isMb">
          <option value="atk">攻击力</option>
          <option value="def">防御力</option>
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

    <div class="alloc-layout">
      <div class="alloc-left">
        <template v-if="damageKind === 'direct'">
          <h3 class="block-title">直伤词条分配</h3>
          <p class="constraint-hint">
            <template v-if="isMb">
              总词条数 = 暴击 + 爆伤 + 局外大生命 + 局外大攻击；约束：总 ≤
              {{ DIRECT_CONSTRAINTS.maxTotalRolls }}，且 攻击力 + 生命值 + 穿透 + 总 ≤
              {{ DIRECT_CONSTRAINTS.maxAtkPenTotal }}
            </template>
            <template v-else>
              总词条数 = 暴击 + 爆伤 + {{ outLabel }}；约束：总 ≤
              {{ DIRECT_CONSTRAINTS.maxTotalRolls }}，且 {{ flatLabel }} + 穿透 + 总 ≤
              {{ DIRECT_CONSTRAINTS.maxAtkPenTotal }}
            </template>
          </p>
          <div class="grid two">
            <label class="field">
              <span>{{ isMb ? '攻击力' : flatLabel }}</span>
              <input v-model.number="directAlloc.flatStat" type="number" min="0" step="1" />
            </label>
            <label v-if="isMb" class="field">
              <span>生命值</span>
              <input v-model.number="directAlloc.hpFlat" type="number" min="0" step="1" />
            </label>
            <label class="field">
              <span>穿透值</span>
              <input v-model.number="directAlloc.pen" type="number" min="0" step="1" />
            </label>
            <label v-if="isMb" class="field">
              <span>局外大攻击</span>
              <input v-model.number="directAlloc.atkPercent" type="number" min="0" step="1" />
              <small class="hint">固定填写，计入总词条数</small>
            </label>
            <label class="field">
              <span>暴击</span>
              <input v-model.number="directAlloc.critRate" type="number" min="0" step="1" />
              <small class="hint">默认：局内暴击刚好 &gt; 100%</small>
            </label>
            <label class="field">
              <span>总词条数</span>
              <input v-model.number="directAlloc.totalRolls" type="number" min="0" step="1" />
              <small class="hint">
                可分配余量 {{ remainDirect }}（{{
                  isMb ? '局外大生命+爆伤' : `${outLabel}+爆伤`
                }}）
              </small>
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

    </div>

    <div v-if="displayEval" class="panel-layout">
      <section class="panel-block">
        <header class="panel-block-header">
          <h3>局外面板（初始）</h3>
          <p>
            {{ selectedCounts ? '跟随当前选中分配。' : '按当前词条分配预览（未开算时余量暂记入爆伤/精通）。' }}由词条分配与角色/音擎/驱动盘基础属性推导，仅展示在最优模块。
            <template v-if="optimalConvertModeActive">
              主 C 参与转模增益，此处主 C 局外由词条分配推导，不沿用面板页主 C 局外。
            </template>
          </p>
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

    <div class="calc-commit-row">
      <button
        type="button"
        class="calc-run-btn"
        :class="{ 'is-computing': sweepComputing }"
        :disabled="sweepComputing || (damageKind === 'direct' ? Boolean(directError) : Boolean(anomalyError))"
        @click="startCalculation"
      >
        {{ sweepComputing ? '计算中…' : '开始计算' }}
      </button>
      <p v-if="sweepNeedsCommit" class="hint calc-commit-hint">
        配好词条分配后点击开始；修改主属性、敌人、增益或转模后也需重新计算。
      </p>
      <p v-else-if="sweepCommitted && !sweepComputing" class="hint calc-commit-hint calc-commit-hint--synced">
        已按当前配置计算；继续调整词条分配会自动刷新柱状图。
      </p>
    </div>

    <h3 class="block-title">
      {{ hasEventMode ? '伤害事件期望柱状图' : '期望伤害柱状图' }}
    </h3>
    <p v-if="sweepComputing && hasEventMode" class="hint sweep-status">柱状图重算中…</p>
    <p class="hint">
      <template v-if="hasEventMode">
        默认显示全部事件总伤害（单柱）。可在下方勾选参与统计的事件，查看其合计伤害随词条分配的变化。X 轴为「{{
          outLabel
        }}条数 / {{ damageKind === 'direct' ? '爆伤' : '精通' }}条数」。点击柱体查看详情。
      </template>
      <template v-else>
        X 轴标签为「{{ outLabel }}条数 / {{ damageKind === 'direct' ? '爆伤' : '精通' }}条数」。点击柱体查看详情。
      </template>
    </p>
    <div v-if="hasEventMode && chartEventOptions.length" class="chart-event-filter">
      <div class="chart-event-filter-head">
        <span class="filter-label">统计事件</span>
        <span v-if="chartEventSelectionSummary" class="chart-event-filter-summary">
          {{ chartEventSelectionSummary }}
        </span>
        <button
          v-if="selectedChartEventIds.length !== chartEventOptions.length"
          type="button"
          class="ghost-btn"
          @click="selectAllChartEvents"
        >
          全选
        </button>
      </div>
      <div class="chart-event-filter-list">
        <button
          v-for="opt in chartEventOptions"
          :key="opt.id"
          type="button"
          class="chart-event-chip"
          :class="{ active: isChartEventSelected(opt.id) }"
          :title="opt.metaText"
          @click="toggleChartEvent(opt.id)"
        >
          <span class="chart-event-chip-top">
            <span class="chart-event-kind">{{ opt.kindLabel }}</span>
            <span class="chart-event-name">{{ opt.label }}</span>
          </span>
          <span class="chart-event-meta">{{ opt.metaText }}</span>
        </button>
      </div>
      <p class="chart-event-filter-hint">
        标注含类型、产生角色（如有）、暴击模式、次数与
        {{ selectedIndex != null ? '当前选中柱体' : '首个扫掠点' }}的期望伤害。
      </p>
    </div>
    <p v-if="!barLabels.length" class="empty">
      <template v-if="damageKind === 'direct' && directError">{{ directError }}</template>
      <template v-else-if="damageKind === 'anomaly' && anomalyError">{{ anomalyError }}</template>
      <template v-else-if="!sweepCommitted || sweepNeedsCommit">
        请点击上方「开始计算」生成柱状图。
      </template>
      <template v-else>当前约束下没有可用分配，请调整总词条数或 4/5/6 号主属性后再试。</template>
    </p>
    <OptimalDamageBarChart
      v-else-if="hasEventMode && eventTotalBarSeries?.length"
      :labels="barLabels"
      :series="eventTotalBarSeries"
      :selected-index="selectedIndex"
      @select="selectBar"
    />
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

    <div v-if="hasEventMode" class="event-affix-impact">
      <div class="lazy-action-row">
        <h4 class="sub-title">事件词条敏感度</h4>
        <button
          type="button"
          class="chip"
          :disabled="eventAffixImpactLoading || sweepComputing || !analysisCounts"
          @click="loadEventAffixImpact"
        >
          {{ eventAffixImpactLoading ? '计算中…' : showEventAffixImpact ? '重新计算' : '计算敏感度' }}
        </button>
      </div>
      <p v-if="!showEventAffixImpact" class="hint">
        事件较多时自动计算较慢，需要时再点击「计算敏感度」。
      </p>
      <template v-else-if="filteredEventAffixImpact.length">
      <p v-if="eventAffixImpactStale || eventAffixImpactLoading" class="hint">
        分配已变更，表格保留中，正在按新分配刷新…
      </p>
      <p v-else class="hint">
        对比当前分配下各候选副词条 +1 后，各事件伤害的最大变化。不受编辑中角色词条影响的事件（如非当前角色产生的紊乱/乱流）会单独标注。
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>伤害事件</th>
              <th>当前期望</th>
              <th>词条最大变化</th>
              <th>是否受编辑中角色词条影响</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in filteredEventAffixImpact"
              :key="row.eventId"
              :class="{ 'event-insensitive': !row.affixSensitive }"
            >
              <td>{{ row.displayName }}</td>
              <td>{{ formatNumber(row.total) }}</td>
              <td :class="row.maxAffixDelta > 0 ? 'pos' : ''">
                {{ row.maxAffixDelta > 0 ? formatDelta(row.maxAffixDelta) : '0' }}
              </td>
              <td>{{ row.affixSensitive ? '受影响' : '不受影响' }}</td>
              <td class="impact-reason">{{ row.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      </template>
      <p v-else class="hint">当前分配下暂无敏感度结果。</p>
    </div>

    <div v-if="analysisCounts && analysisEval" class="detail">
      <header class="detail-header">
        <h3>
          {{ selectedIndex != null ? '选中分配' : '当前分配' }}：
          <template v-if="damageKind === 'direct'">
            <template v-if="selectedDirect">
              {{ outLabel }} {{ selectedDirect.outPercent }} · 爆伤 {{ selectedDirect.critDmg }} · 暴击
              {{ directAlloc.critRate }}
              <template v-if="isMb"> · 局外大攻击 {{ directAlloc.atkPercent }}</template>
            </template>
            <template v-else-if="analysisCounts">
              暴击 {{ analysisCounts.critRate }} · 爆伤 {{ analysisCounts.critDmg }} ·
              {{ outLabel }}
              {{ isMb ? analysisCounts.hpPercent : analysisCounts.atkPercent }}
              <template v-if="isMb"> · 局外大攻击 {{ analysisCounts.atkPercent }}</template>
              <span class="hint-inline">（未点柱时按预览/首柱）</span>
            </template>
          </template>
          <template v-else-if="selectedAnomaly">
            {{ outLabel }} {{ selectedAnomaly.outPercent }} · 精通 {{ selectedAnomaly.mastery }}
          </template>
          <template v-else-if="analysisCounts">
            {{ outLabel }}
            {{ isMb ? analysisCounts.hpPercent : analysisCounts.atkPercent }} · 精通
            {{ analysisCounts.mastery }}
            <span class="hint-inline">（未点柱时按预览/首柱）</span>
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
        <p v-if="hasEventMode && mainStatEventScopeHint" class="hint detail-scope-hint">
          {{ mainStatEventScopeHint }}
        </p>
      </header>

      <p v-if="damageKind === 'anomaly' && !hasEventMode" class="metric-tabs">
        当前异常子类：{{
          anomalySubKind === 'disorder'
            ? '紊乱伤害'
            : anomalySubKind === 'turbulence'
              ? '乱流伤害'
              : anomalySubKind === 'anomalyRelease'
                ? '异放伤害'
                : anomalySubKind === 'radiance'
                  ? '耀变伤害'
                  : '异常伤害'
        }}
      </p>

      <template v-if="detailTab === 'process'">
        <template v-if="hasEventMode">
          <DamageOwnerShareBlock
            :summary="processOwnerShareSummary ?? { shares: [], grandTotal: 0 }"
            :selected-event-id="selectedProcessEventId"
            :total-label="processDamageTotalLabel"
            :skipped-events="processSkippedEvents"
            hint="总伤期望已并入本区（口径与柱状图所选统计事件一致）。点击产生者展开事件，再点事件查看下方计算过程。"
            @select-event="selectProcessEventFromShare"
          />
          <DamageResultDetail
            v-if="selectedProcessEventDetail"
            :calc-parts="selectedProcessEventDetail.result"
            :final-panel="selectedProcessEventDetail.finalPanel"
            :external-panel="selectedProcessEventDetail.external"
            :sources="selectedProcessEventDetail.breakdown.sources"
            :pierce-mod="selectedProcessEventDetail.breakdown.totalMods.pierce"
            :pierce-power="selectedProcessEventDetail.piercePower"
            :enemy-input="enemyInput"
            :is-mb="isMb"
            :show="selectedProcessEventDetail.kind === 'direct' ? 'direct' : 'anomaly'"
            :anomaly-sub-kind="selectedProcessEventDetail.anomalySubKind"
            :producer-final-panel="selectedProcessEventDetail.producerFinalPanel"
            :producer-external-panel="selectedProcessEventDetail.producerExternalPanel"
            :producer-sources="selectedProcessEventDetail.producerBreakdown?.sources"
            :producer-agent-label="selectedProcessEventDetail.producerAgentLabel"
            :bonus-final-panel="selectedProcessEventDetail.bonusFinalPanel"
            :bonus-external-panel="selectedProcessEventDetail.bonusExternalPanel"
            :bonus-sources="selectedProcessEventDetail.bonusBreakdown?.sources"
            :defense-trigger-final-panel="selectedProcessEventDetail.defenseTriggerFinalPanel"
            :defense-trigger-external-panel="selectedProcessEventDetail.defenseTriggerExternalPanel"
            :defense-trigger-sources="selectedProcessEventDetail.defenseTriggerBreakdown?.sources"
            :defense-trigger-agent-label="selectedProcessEventDetail.defenseTriggerAgentLabel"
            :base-agent-label="selectedProcessEventDetail.baseAgentLabel"
            :bonus-agent-label="selectedProcessEventDetail.bonusAgentLabel"
            :mutation-agent-label="selectedProcessEventDetail.mutationAgentLabel"
            :mutation-final-panel="selectedProcessEventDetail.mutationFinalPanel"
            :mutation-external-panel="selectedProcessEventDetail.mutationExternalPanel"
            :mutation-sources="selectedProcessEventDetail.mutationSources"
            :remiel-self-atk-source-items="selectedProcessEventDetail.remielSelfAtkSourceItems"
            :remiel-self-mastery-source-items="selectedProcessEventDetail.remielSelfMasterySourceItems"
            :remiel-self-external-panel="selectedProcessEventDetail.remielSelfExternalPanel"
            :remiel-self-sources="selectedProcessEventDetail.remielSelfSources"
            :remiel-self-final-panel="selectedProcessEventDetail.remielSelfFinalPanel"
            :remiel-is-mb="selectedProcessEventDetail.remielIsMb"
          />
          <p v-else-if="processOwnerShareSummary || processSkippedEvents.length" class="hint">
            在上方「产生者伤害占比」中点选事件，查看该事件的详细计算过程。
          </p>
          <p v-else class="hint">当前配置下暂无可用伤害事件，请检查产生角色与局外面板。</p>
        </template>
        <template v-else>
        <div class="result-summary">
          <p v-if="hasEventMode">
            伤害事件总伤期望：
            <strong>{{ formatNumber(analysisMetricDamage) }}</strong>
          </p>
          <template v-else-if="damageKind === 'direct'">
            <p>直伤期望伤害：<strong>{{ formatNumber(analysisEval!.result.directDamageExpected) }}</strong></p>
          </template>
          <template v-else>
            <p v-if="anomalySubKind === 'anomaly'">异常期望伤害：<strong>{{ formatNumber(analysisEval!.result.anomalyExpected) }}</strong></p>
            <p v-else-if="anomalySubKind === 'disorder'">紊乱期望伤害：<strong>{{ formatNumber(analysisEval!.result.disorderExpected) }}</strong></p>
            <p v-else-if="anomalySubKind === 'turbulence'">乱流期望伤害：<strong>{{ formatNumber(analysisEval!.result.turbulenceExpected) }}</strong></p>
            <p v-else-if="anomalySubKind === 'anomalyRelease'">异放期望伤害：<strong>{{ formatNumber(analysisEval!.result.anomalyReleaseExpected) }}</strong></p>
            <p v-else-if="anomalySubKind === 'radiance'">耀变期望伤害：<strong>{{ formatNumber(analysisEval!.result.radianceExpected) }}</strong></p>
            <p v-else>异常期望伤害：<strong>{{ formatNumber(analysisEval!.result.anomalyExpected) }}</strong></p>
          </template>
        </div>
        <DamageResultDetail
          :calc-parts="analysisEval!.result"
          :final-panel="analysisEval!.finalPanel"
          :external-panel="analysisEval!.external"
          :sources="analysisEval!.breakdown.sources"
          :pierce-mod="analysisEval!.breakdown.totalMods.pierce"
          :pierce-power="analysisEval!.piercePower"
          :enemy-input="enemyInput"
          :is-mb="isMb"
          :show="damageKind"
          :anomaly-sub-kind="anomalySubKind"
        />
        </template>
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
              <tr v-for="row in diffAnalysis.addOne" :key="row.key" :class="{ 'row-capped': row.capped }">
                <td>{{ row.label }}</td>
                <td>{{ row.currentValue }}</td>
                <td>+{{ row.addOne }}</td>
                <td :class="row.capped ? '' : row.damageDelta >= 0 ? 'pos' : 'neg'">
                  {{ row.capped ? '—' : formatDelta(row.damageDelta) }}
                </td>
                <td :class="row.capped ? 'capped-note' : row.percentDelta >= 0 ? 'pos' : 'neg'">
                  {{ row.capped ? row.note || '已达上限' : formatPercent(row.percentDelta) }}
                </td>
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
              <tr v-for="row in diffAnalysis.replace" :key="row.key" :class="{ 'row-capped': row.capped }">
                <td>{{ row.label }}</td>
                <td>-{{ row.removeOne }}</td>
                <td>{{ row.bestReplaceLabel }}</td>
                <td>+{{ row.addOne }}</td>
                <td :class="row.capped ? '' : row.damageDelta >= 0 ? 'pos' : 'neg'">
                  {{ row.capped ? '—' : formatDelta(row.damageDelta) }}
                </td>
                <td :class="row.capped ? 'capped-note' : row.percentDelta >= 0 ? 'pos' : 'neg'">
                  {{ row.capped ? row.note || '已达上限' : formatPercent(row.percentDelta) }}
                </td>
              </tr>
              <tr v-if="!diffAnalysis.replace.length">
                <td colspan="6" class="empty-cell">当前无可替换的已有候选词条</td>
              </tr>
            </tbody>
          </table>
        </div>

        <template v-if="combinedMainStatPreview">
          <header class="main-stat-section-heading">
            <h4 class="sub-title">主词条组合替换（4/5/6 与 2 件套）</h4>
            <p class="hint">
              在保持当前副词条分配不变的前提下，同时替换 4/5/6 号盘主属性与 2 件套并对比总伤害变化。
            </p>
          </header>

          <div class="combined-main-stat-card">
            <header class="combined-main-stat-card__header">
              <h5>组合试算</h5>
              <button type="button" class="reset-combination-btn" @click="resetCombinedMainStatDraft">
                重置为当前
              </button>
            </header>

            <div class="main-stat-stack main-stat-stack--current">
              <p class="main-stat-stack-title">当前主属性</p>
              <ul class="main-stat-stack-list">
                <li>
                  <span class="main-stat-slot-badge">4</span>
                  <span class="main-stat-slot-value">{{ combinedMainStatPreview.currentLabels.slot4 }}</span>
                </li>
                <li>
                  <span class="main-stat-slot-badge">5</span>
                  <span class="main-stat-slot-value">{{ combinedMainStatPreview.currentLabels.slot5 }}</span>
                </li>
                <li>
                  <span class="main-stat-slot-badge">6</span>
                  <span class="main-stat-slot-value">{{ combinedMainStatPreview.currentLabels.slot6 }}</span>
                </li>
                <li>
                  <span class="main-stat-slot-badge">2</span>
                  <span class="main-stat-slot-value">{{ combinedMainStatPreview.currentLabels.twoPiece }}</span>
                </li>
              </ul>
            </div>

            <i class="combined-main-stat-arrow" aria-hidden="true">→</i>

            <div class="main-stat-selects">
              <label>
                <span class="combined-main-stat-label">4号替换为</span>
                <select v-model="combinedMainStatDraft.slot4MainStat">
                  <option v-for="opt in DRIVE_DISC_SLOT_4_OPTIONS" :key="opt.id" :value="opt.id">
                    {{ opt.label }}
                  </option>
                </select>
              </label>
              <label>
                <span class="combined-main-stat-label">5号替换为</span>
                <select v-model="combinedMainStatDraft.slot5MainStat">
                  <option v-for="opt in DRIVE_DISC_SLOT_5_OPTIONS" :key="opt.id" :value="opt.id">
                    {{ opt.label }}
                  </option>
                </select>
              </label>
              <label>
                <span class="combined-main-stat-label">6号替换为</span>
                <select v-model="combinedMainStatDraft.slot6MainStat">
                  <option v-for="opt in DRIVE_DISC_SLOT_6_OPTIONS" :key="opt.id" :value="opt.id">
                    {{ opt.label }}
                  </option>
                </select>
              </label>
              <label class="main-stat-two-piece-field">
                <span class="combined-main-stat-label">2件套替换为</span>
                <EquipPickerModal
                  v-model:open="combinedTwoPiecePickerOpen"
                  title="选择 2 件套"
                  description="可不佩戴；与 4 件套同套时不重复计入"
                  search-placeholder="搜索驱动盘…"
                  :items="(driveDiscs as unknown as Array<Record<string, unknown>>)"
                  allow-none
                  none-label="不佩戴"
                  :selected-id="combinedMainStatDraftTwoPieceId"
                  :selected-label="resolveTwoPieceLabel(combinedMainStatDraftTwoPieceId)"
                  :selected-avatar="resolveTwoPieceAvatar(combinedMainStatDraftTwoPieceId)"
                  @select="selectCombinedTwoPiece"
                />
              </label>
            </div>

            <div class="combined-result">
              <span>总伤害变化</span>
              <p v-if="mainStatEventScopeHint" class="hint combined-result-scope">{{ mainStatEventScopeHint }}</p>
              <strong :class="combinedMainStatPreview.damageDelta >= 0 ? 'pos' : 'neg'">
                <template v-if="combinedMainStatPreview.unchanged">与当前相同</template>
                <template v-else>
                  {{ formatDelta(combinedMainStatPreview.damageDelta) }}
                  （{{ formatPercent(combinedMainStatPreview.percentDelta) }}）
                </template>
              </strong>
              <p class="hint combined-result-detail">
                当前 {{ formatNumber(combinedMainStatPreview.baseDamage) }}
                → 试算 {{ formatNumber(combinedMainStatPreview.proposedDamage) }}
              </p>
            </div>
          </div>

          <section class="ranking-slot-filter">
            <header class="ranking-slot-filter-header">
              <h5>限定组合计算范围</h5>
              <span class="hint">将计算 {{ rankingComboCount }} 种组合（不含当前配置）</span>
            </header>
            <div class="ranking-slot-filter-group">
              <div class="ranking-slot-filter-row ranking-slot-filter-row--select">
                <span class="ranking-slot-filter-label">2件套</span>
                <div class="ranking-two-piece-picker">
                  <EquipPickerModal
                    v-model:open="rankingTwoPiecePickerOpen"
                    title="选择 2 件套"
                    description="单选，替换当前 2 件套数值参与排行计算"
                    search-placeholder="搜索驱动盘…"
                    :items="(driveDiscs as unknown as Array<Record<string, unknown>>)"
                    allow-none
                    none-label="不佩戴"
                    :selected-id="rankingTwoPieceId"
                    :selected-label="resolveTwoPieceLabel(rankingTwoPieceId)"
                    :selected-avatar="resolveTwoPieceAvatar(rankingTwoPieceId)"
                    @select="selectRankingTwoPiece"
                  />
                </div>
                <span class="hint">单选，替换当前 2 件套数值参与排行计算</span>
              </div>
              <div class="ranking-slot-filter-row">
                <span class="ranking-slot-filter-label">4号</span>
                <button type="button" class="chip chip--compact" @click="selectAllRankingSlotOptions(4)">全选</button>
                <button
                  v-for="opt in DRIVE_DISC_SLOT_4_OPTIONS"
                  :key="`rank-4-${opt.id}`"
                  type="button"
                  class="chip chip--compact"
                  :class="{ active: isRankingSlotOptionSelected(4, opt.id) }"
                  @click="toggleRankingSlotOption(4, opt.id)"
                >
                  {{ opt.label }}
                </button>
              </div>
              <div class="ranking-slot-filter-row">
                <span class="ranking-slot-filter-label">5号</span>
                <button type="button" class="chip chip--compact" @click="selectAllRankingSlotOptions(5)">全选</button>
                <button
                  v-for="opt in DRIVE_DISC_SLOT_5_OPTIONS"
                  :key="`rank-5-${opt.id}`"
                  type="button"
                  class="chip chip--compact"
                  :class="{ active: isRankingSlotOptionSelected(5, opt.id) }"
                  @click="toggleRankingSlotOption(5, opt.id)"
                >
                  {{ opt.label }}
                </button>
              </div>
              <div class="ranking-slot-filter-row">
                <span class="ranking-slot-filter-label">6号</span>
                <button type="button" class="chip chip--compact" @click="selectAllRankingSlotOptions(6)">全选</button>
                <button
                  v-for="opt in DRIVE_DISC_SLOT_6_OPTIONS"
                  :key="`rank-6-${opt.id}`"
                  type="button"
                  class="chip chip--compact"
                  :class="{ active: isRankingSlotOptionSelected(6, opt.id) }"
                  @click="toggleRankingSlotOption(6, opt.id)"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
          </section>

          <div class="lazy-action-row combined-rankings-action">
            <button
              type="button"
              class="chip"
              :disabled="combinedMainStatRankingsLoading || !analysisCounts || rankingComboCount <= 0"
              @click="loadCombinedMainStatRankings"
            >
              {{
                combinedMainStatRankingsLoading
                  ? '排行计算中…'
                  : showCombinedMainStatRankings
                    ? '重新计算组合排行'
                    : '计算组合排行'
              }}
            </button>
            <button
              v-if="showCombinedMainStatRankings && combinedRankingsExpanded && combinedMainStatRankings.length"
              type="button"
              class="chip"
              @click="collapseCombinedMainStatRankings"
            >
              收起排行
            </button>
            <button
              v-else-if="showCombinedMainStatRankings && combinedMainStatRankings.length"
              type="button"
              class="chip"
              @click="expandCombinedMainStatRankings"
            >
              展开排行（{{ combinedMainStatRankings.length }} 条）
            </button>
            <span v-if="!showCombinedMainStatRankings" class="hint">
              可先限定 4/5/6 候选与 2 件套再计算，减少运算量。
            </span>
          </div>

          <div
            v-if="showCombinedMainStatRankings && combinedRankingsExpanded && combinedMainStatRankings.length"
            class="table-wrap combined-main-stat-table"
          >
            <table>
              <thead>
                <tr>
                  <th>4 / 5 / 6 主属性组合</th>
                  <th>伤害差值</th>
                  <th>百分比差值</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in combinedMainStatRankings"
                  :key="`${row.slot4}-${row.slot5}-${row.slot6}`"
                >
                  <td>{{ row.summaryLabel }}</td>
                  <td :class="row.damageDelta >= 0 ? 'pos' : 'neg'">{{ formatDelta(row.damageDelta) }}</td>
                  <td :class="row.percentDelta >= 0 ? 'pos' : 'neg'">{{ formatPercent(row.percentDelta) }}</td>
                  <td>
                    <button type="button" class="chip chip--compact" @click="applyCombinedMainStatRanking(row)">
                      填入试算
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <div class="main-stat-diff-toolbar">
          <button
            v-if="!showMainStatDiff"
            type="button"
            class="chip"
            :disabled="mainStatDiffLoading || !analysisCounts"
            @click="loadMainStatDiff"
          >
            {{ mainStatDiffLoading ? '分析中…' : '分析主属性单槽替换' }}
          </button>
        </div>

        <template v-if="showMainStatDiff && mainStatDiff">
          <h4 class="sub-title">主词条差异计算（单槽位替换）</h4>
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

      <p v-else-if="detailTab === 'diff'" class="hint">词条差异计算中…若长时间无结果，请再点一次「开始计算」。</p>

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
            v-for="row in [...benefitData.nextStep].sort((a, b) => Number(a.capped) - Number(b.capped) || b.percentDelta - a.percentDelta)"
            :key="row.key"
            :class="{ 'next-bars-item--capped': row.capped }"
          >
            <span class="next-label">{{ row.label }}</span>
            <div class="next-track">
              <div
                class="next-fill"
                :style="{
                  width: row.capped
                    ? '0%'
                    : `${Math.max(2, Math.min(100, Math.abs(row.percentDelta) * 8))}%`,
                  background: row.percentDelta >= 0 ? '#7dd3a0' : '#f07178',
                }"
              />
            </div>
            <strong :class="row.capped ? 'capped-note' : row.percentDelta >= 0 ? 'pos' : 'neg'">
              {{ row.capped ? row.note || '已达上限' : formatPercent(row.percentDelta) }}
            </strong>
          </li>
        </ul>
      </template>
    </div>
    </template>
  </section>
</template>

<style scoped>
.event-affix-impact {
  margin-top: 0.25rem;
}

.event-insensitive td {
  color: #9aa3b5;
}

.impact-reason {
  max-width: 18rem;
  font-size: 0.82rem;
  line-height: 1.45;
}

.event-breakdown-table {
  margin-bottom: 0.75rem;
}

.result-section-title {
  margin: 0;
  font-size: 0.92rem;
  color: #e8eaed;
}

.event-summary-block {
  margin-bottom: 0.85rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid #2d323a;
  border-radius: 10px;
  background: #0f1217;
}

.event-summary-list {
  margin: 0.45rem 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.event-summary-item {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.35rem 0.75rem;
  padding: 0.45rem 0.55rem;
  border: 1px solid #2a3038;
  border-radius: 8px;
  background: #141820;
  cursor: pointer;
}

.event-summary-item:hover {
  border-color: #3d4654;
}

.event-summary-item--active {
  border-color: rgba(125, 211, 160, 0.55);
  background: rgba(125, 211, 160, 0.08);
}

.event-summary-item--disabled {
  cursor: default;
  opacity: 0.72;
}

.event-summary-item--disabled:hover {
  border-color: #2a3140;
}

.event-summary-skip {
  color: #c07a7a;
  font-size: 0.8rem;
}

.event-summary-name {
  color: #e8ecf4;
  font-size: 0.86rem;
}

.event-summary-count {
  margin-left: 0.25rem;
  color: #9aa3b0;
  font-size: 0.8rem;
}

.event-summary-damage {
  color: #9aa3b0;
  font-size: 0.8rem;
}

.event-summary-total {
  margin: 0.55rem 0 0;
}

.chart-event-filter {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.chart-event-filter-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 0.65rem;
  align-items: center;
}

.chart-event-filter-summary {
  flex: 1 1 12rem;
  font-size: 0.78rem;
  color: #9aa3b0;
  line-height: 1.45;
}

.chart-event-filter-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.chart-event-filter-hint {
  margin: 0;
  font-size: 0.75rem;
  color: #7a8494;
  line-height: 1.45;
}

.chart-event-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  min-width: 10rem;
  max-width: 100%;
  padding: 0.45rem 0.6rem;
  border: 1px solid #3a4048;
  border-radius: 10px;
  background: #141820;
  color: #e8ecf4;
  cursor: pointer;
  text-align: left;
}

.chart-event-chip:hover {
  border-color: #4d5666;
  background: #181e28;
}

.chart-event-chip.active {
  border-color: rgba(125, 211, 160, 0.55);
  background: rgba(125, 211, 160, 0.08);
}

.chart-event-chip-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.chart-event-kind {
  flex-shrink: 0;
  padding: 0.08rem 0.4rem;
  border-radius: 999px;
  background: #252b36;
  color: #c9d2de;
  font-size: 0.72rem;
  font-weight: 600;
}

.chart-event-chip.active .chart-event-kind {
  background: rgba(125, 211, 160, 0.18);
  color: #dff3e8;
}

.chart-event-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: #eef2f7;
}

.chart-event-meta {
  font-size: 0.74rem;
  line-height: 1.4;
  color: #9aa3b0;
}

.filter-label {
  font-size: 0.8rem;
  color: #9aa3b0;
}

.opt-section {
  --calc-run-border: rgba(191, 255, 9, 0.45);
  --calc-run-bg: rgba(191, 255, 9, 0.12);
  --calc-run-text: #bfff09;
  --calc-run-bg-hover: rgba(191, 255, 9, 0.18);
  --calc-run-border-hover: rgba(191, 255, 9, 0.55);
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

.field-span-all {
  grid-column: 1 / -1;
}

.alloc-layout {
  display: grid;
  grid-template-columns: 1fr;
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

.anomaly-support-panels {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.anomaly-slot-details {
  border: 1px solid #2d323a;
  border-radius: 8px;
  padding: 0.35rem 0.5rem 0.55rem;
  background: rgba(0, 0, 0, 0.18);
}

.anomaly-slot-details summary {
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 600;
  color: #d5dae4;
  padding: 0.25rem 0;
}

.anomaly-slot-details .grid {
  margin-top: 0.45rem;
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

.kind-mode-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem 0.55rem;
}

.kind-mode-hint {
  flex: 1 1 12rem;
  margin: 0 !important;
}

.capped-note {
  color: #e6c07b !important;
  font-weight: 600;
  white-space: normal;
  max-width: 14rem;
  line-height: 1.35;
}

.row-capped td {
  color: #9aa3b5;
}

.next-bars-item--capped .next-label {
  color: #9aa3b5;
}

.kind-mode-label {
  font-size: 0.82rem;
  color: #9aa3b0;
  margin-right: 0.15rem;
}

.kind-mode-tab {
  border: 1px solid #2d323a;
  border-radius: 999px;
  background: #10141a;
  color: #c5ccd6;
  font: inherit;
  font-size: 0.8rem;
  padding: 0.28rem 0.75rem;
  cursor: pointer;
}

.kind-mode-tab.active {
  border-color: rgba(201, 165, 92, 0.55);
  background: rgba(201, 165, 92, 0.14);
  color: #f0d7a2;
  font-weight: 600;
}

.calc-commit-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem 0.85rem;
  margin-top: 0.35rem;
  padding-top: 0.65rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.calc-run-btn {
  border: 1px solid var(--calc-run-border);
  border-radius: 999px;
  background: var(--calc-run-bg);
  color: var(--calc-run-text);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  padding: 0.35rem 0.85rem;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    opacity 0.15s ease;
}

.calc-run-btn:hover:not(:disabled) {
  background: var(--calc-run-bg-hover);
  border-color: var(--calc-run-border-hover);
}

.calc-run-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.calc-run-btn.is-computing {
  cursor: wait;
}

.calc-commit-hint {
  margin: 0;
  flex: 1 1 14rem;
  font-size: 0.78rem;
}

.calc-commit-hint--synced {
  opacity: 0.85;
}

.main-stat-diff-toolbar {
  margin: 0.75rem 0 0;
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

.hint-inline {
  margin-left: 0.35rem;
  font-size: 0.78rem;
  font-weight: 400;
  color: #8b929e;
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

.main-stat-section-heading {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-top: 1rem;
}

.main-stat-section-heading .hint {
  margin: 0;
}

.combined-main-stat-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1.15fr) minmax(9rem, 0.85fr);
  gap: 0.75rem 0.85rem;
  align-items: center;
  margin-top: 0.55rem;
  padding: 0.85rem 0.9rem;
  border: 1px solid #3a4a2a;
  border-radius: 12px;
  background:
    linear-gradient(135deg, rgba(136, 171, 78, 0.08), transparent 42%),
    #10141a;
}

.combined-main-stat-card__header {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding-bottom: 0.55rem;
  border-bottom: 1px solid #2d323a;
}

.combined-main-stat-card__header h5 {
  margin: 0;
  font-size: 0.9rem;
  color: #f0f2f6;
}

.reset-combination-btn {
  border: 1px solid #3d4633;
  border-radius: 8px;
  background: rgba(136, 171, 78, 0.12);
  color: #d6e8b5;
  padding: 0.35rem 0.65rem;
  font-size: 0.78rem;
  cursor: pointer;
}

.main-stat-stack,
.combined-result {
  border: 1px solid #2d323a;
  border-radius: 10px;
  padding: 0.65rem 0.7rem;
  background: rgba(0, 0, 0, 0.18);
}

.main-stat-stack--current {
  border-color: #3d4a32;
  border-left-width: 3px;
  border-left-color: #88ab4e;
  padding: 0.7rem 0.75rem 0.75rem;
  background:
    linear-gradient(105deg, rgba(136, 171, 78, 0.14) 0%, rgba(136, 171, 78, 0.03) 42%, rgba(0, 0, 0, 0.12) 100%);
}

.main-stat-stack-title {
  margin: 0 0 0.45rem;
  font-size: 0.74rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #b8d88a;
  text-transform: none;
}

.main-stat-stack-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.38rem;
}

.main-stat-stack-list li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.main-stat-slot-badge {
  flex-shrink: 0;
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 6px;
  border: 1px solid rgba(136, 171, 78, 0.35);
  background: rgba(136, 171, 78, 0.16);
  color: #c8e0a0;
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.main-stat-slot-value {
  font-size: 0.82rem;
  line-height: 1.35;
  color: #eef2e8;
  font-weight: 500;
}

.main-stat-subheading {
  margin: 0 0 0.25rem;
  font-size: 0.76rem;
  color: #9aa3b0;
}

.main-stat-stack p {
  margin: 0.18rem 0;
  font-size: 0.82rem;
  color: #e8edf5;
}

.combined-main-stat-arrow {
  font-style: normal;
  color: #88ab4e;
  font-size: 1.25rem;
  text-align: center;
}

.main-stat-selects {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.main-stat-selects label {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
}

.main-stat-two-piece-field {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
}

.main-stat-two-piece-field :deep(.picker-summary) {
  font-size: 0.8rem;
}

.main-stat-two-piece-field :deep(.picker-open-hint) {
  font-size: 0.68rem;
}

.combined-main-stat-label {
  font-size: 0.76rem;
  color: #9aa3b0;
}

.main-stat-selects select {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #e8edf5;
  padding: 0.38rem 0.5rem;
  font-size: 0.8rem;
}

.combined-result {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.combined-result > span {
  font-size: 0.76rem;
  color: #9aa3b0;
}

.combined-result strong {
  font-size: 0.95rem;
}

.combined-result-detail {
  margin: 0;
  font-size: 0.76rem;
  line-height: 1.45;
}

.combined-result-scope {
  margin: 0.1rem 0 0.25rem;
  font-size: 0.72rem;
  line-height: 1.4;
}

.ranking-slot-filter {
  margin-top: 0.75rem;
  padding: 0.7rem 0.75rem;
  border: 1px solid #2d323a;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.12);
}

.ranking-slot-filter-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.35rem 0.75rem;
  margin-bottom: 0.55rem;
}

.ranking-slot-filter-header h5 {
  margin: 0;
  font-size: 0.84rem;
  color: #e8edf5;
}

.ranking-slot-filter-group {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.ranking-slot-filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.ranking-slot-filter-row--select {
  padding-bottom: 0.35rem;
  margin-bottom: 0.15rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.ranking-two-piece-picker {
  flex: 1 1 12rem;
  min-width: 10rem;
  max-width: 100%;
}

.ranking-two-piece-picker :deep(.picker-summary) {
  font-size: 0.78rem;
}

.ranking-two-piece-picker :deep(.picker-open-hint) {
  font-size: 0.66rem;
}

.ranking-slot-filter-label {
  flex-shrink: 0;
  width: 2rem;
  font-size: 0.76rem;
  font-weight: 600;
  color: #b8d88a;
}

.combined-main-stat-table {
  margin-top: 0.75rem;
}

.chip--compact {
  padding: 0.28rem 0.55rem;
  font-size: 0.76rem;
}

.lazy-action-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem 0.75rem;
  margin-bottom: 0.45rem;
}

.lazy-action-row .sub-title {
  margin: 0;
}

.combined-rankings-action {
  margin-top: 0.65rem;
}

.sweep-status {
  margin: 0 0 0.35rem;
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
  .combined-main-stat-card {
    grid-template-columns: 1fr;
  }

  .combined-main-stat-arrow {
    transform: rotate(90deg);
  }

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
