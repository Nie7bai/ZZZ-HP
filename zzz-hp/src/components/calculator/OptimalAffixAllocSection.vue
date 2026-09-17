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
import BenefitCurvePanel from '@/components/calculator/BenefitCurvePanel.vue'
import OptimalDamageBarChart from '@/components/calculator/OptimalDamageBarChart.vue'
import AffixBenefitTable from '@/components/calculator/AffixBenefitTable.vue'
import AffixAllocationResult from '@/components/calculator/AffixAllocationResult.vue'
import AffixSearchAdvancedModal from '@/components/calculator/AffixSearchAdvancedModal.vue'
import GameAffixRulesModal from '@/components/calculator/GameAffixRulesModal.vue'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentPanelSources } from '@/types/damageCalcHistory'
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
  createEmptyAffixCounts,
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
  DRIVE_DISC_SLOT_4_OPTIONS,
  DRIVE_DISC_SLOT_5_OPTIONS,
  DRIVE_DISC_SLOT_6_OPTIONS,
} from '@/utils/affixDriveDiscConfig'
import {
  createEmptyBuffStatModifiers,
  createEmptyRefinementMods,
} from '@/utils/calculatorUi'
import type { DamageCalcResult } from '@/utils/damageCalc'
import { type DamageEnemyInput } from '@/utils/enemyResistance'
import {
  ANOMALY_CONSTRAINTS,
  BENEFIT_CURVE_MAX_ADDED,
  DIRECT_CONSTRAINTS,
  buildOptimalEvalContext,
  canReuseDirectSweepStructure,
  computeBenefitCurves,
  computeDiffAnalysis,
  computeEventAffixImpact,
  evaluateAffixCounts,
  evaluateAffixCountsForSweep,
  clearAffixEvalCache,
  evaluateOptimalEventDetail,
  withAffixLibraryExtraGains,
  buildDirectAffixCounts,
  buildAnomalyAffixCounts,
  flatStatLabel,
  outPercentLabel,
  outPercentFromAffixCounts,
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
  yieldToMain,
} from '@/utils/optimalAffixAlloc'
import { remapImportedPanelViaEffects } from '@/utils/panelPipeline'
import EquipPickerModal from '@/components/calculator/EquipPickerModal.vue'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import {
  resolveBuffSelectionForSlot,
  computeFinalPanel,
  type ConvertSlotPanels,
} from '@/utils/panelBuffCalc'

import {
  DAMAGE_EVENT_CRIT_MODE_OPTIONS,
  DAMAGE_EVENT_KIND_OPTIONS,
  eventNeedsAnomalyProducer,
} from '@/utils/damageEvent'
import { buildGenericPanelSkillContext } from '@/utils/resolvedHit'
import {
  buildSkillFlowPageSignature,
  formatAffixCountsSummary,
  type SkillFlowDisplayOption,
  type SkillFlowPanelOption,
} from '@/utils/skillFlowPanelSource'
import {
  buildHitEvalFingerprint,
  hitEvalCacheKey,
  internHitEvalContext,
  readHitEvalCache,
  writeHitEvalCache,
} from '@/utils/hitEvalCache'

import {
  computeAffixBenefitSeriesForTable,
  computeAffixBenefitTable,
  type AffixBenefitSeries,
  type AffixBenefitTable as AffixBenefitTableData,
} from '@/utils/affixBenefitAnalysis'
import {
  addAffixLibraryGroup,
  addCustomAffixLibraryEntry,
  affixGroupCaps,
  affixValuePerCountFromEntries,
  createDefaultAffixLibraryState,
  isAffixLibraryEntryEnabled,
  isUsingServerAffixPreset,
  loadAffixLibraryState,
  removeAffixLibraryEntry,
  removeAffixLibraryGroup,
  renameAffixLibraryGroup,
  resolveAffixLibrary,
  resolveAffixLibraryAll,
  restoreAffixLibraryDefaults,
  saveAffixLibraryState,
  setAffixLibraryEntryEnabled,
  setAffixLibraryGroupCap,
  updateAffixLibraryEntry,
  type AffixLibraryEntry,
  type AffixLibraryState,
} from '@/utils/affixLibrary'
import {
  formatAffixRollsSummary,
  solveOptimalAffixAllocationAsync,
  AFFIX_SEARCH_PRESET_LABELS,
  type AffixOptimizerProgress,
  type AffixOptimizerResult,
  type AffixSearchParams,
  type AffixSearchPresetId,
} from '@/utils/affixOptimizer'
import {
  effectiveAffixSearchParams,
  loadAffixSearchSettings,
  saveAffixSearchSettings,
  type AffixSearchSettings,
} from '@/utils/affixSearchSettings'
import {
  clampGameExtraCost,
  createGameAffixLibraryEntries,
  loadGameAffixRulesSettings,
  saveGameAffixRulesSettings,
  solveGameAffixAllocationAsync,
} from '@/utils/gameAffixRules'

const MB_PROFESSION = '命破'
const FENGYU_PROFESSION = '锋御'

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
  /** 已解析的激活面板（每人一份）：本模块只拿面板本身，不问它是哪一份来源 */
  activeSlotPanels?: Record<string, PanelStats>
  /** 原始来源记录：只为读「词条导入」那一路的 4/5/6 主属性（柱体上限规则） */
  slotPanels?: Record<string, AgentPanelSources>
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
  /**
   * 招式流程「用哪份面板」的覆盖值（三选项的 ②③）。
   *
   * 本模块的招式流程映射优先用它；为 null 时按「角色配置的激活面板 → 柱体推导」取值
   * （见下方 `skillFlowExternal`）。
   */
  skillFlowMainExternalOverride?: PanelStats | null
  /**
   * 招式流程选 ②③ 时，该次分配的 `gain:` extraGains。
   * ① 或回落配置面板时为空。页级额外 Buff 仍走 v-model extraGains。
   */
  skillFlowSourceExtraGains?: ExtraBuffGain[] | null
}>()

const extraGains = defineModel<ExtraBuffGain[]>('extraGains', { default: () => [] })

const emit = defineEmits<{
  'update:hitDamages': [value: Record<string, number>]
  'update:hitCalcResults': [value: Record<string, DamageCalcResult>]
  /** 上报「最优分配 / 当前柱」两个来源的当前编辑角色局外面板与摘要，供招式流程三选项使用 */
  'update:panelSourceOptions': [
    value: Partial<Record<'allocation' | 'sweep', SkillFlowPanelOption | null>>,
  ]
  /** 面板展示专用通道：上报「最优分配 / 当前柱」的局外 + 局内，供招式流程区「查看面板」展示 */
  'update:displayPanelSources': [
    value: Partial<Record<'allocation' | 'sweep', SkillFlowDisplayOption | null>>,
  ]
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
const sweepDamageKind = ref<OptimalDamageKind | null>(null)

watch(
  () => props.damageKind,
  (kind) => {
    if (kind === 'direct' || kind === 'anomaly') sweepDamageKind.value = kind
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
/**
 * 基础伤害来源：**页级共享**（`v-model:baseDamageSource`）。
 *
 * 原先两个 section 各存一份，同一个概念在两处可各选各的 —— 招式流程三选项要求
 * 「同一份配置只对应一份面板」，因此收到页级（也让页级签名能覆盖它）。
 */
const baseDamageSource = defineModel<BaseDamageSource>('baseDamageSource', { default: 'atk' })
const enemyInput = defineModel<DamageEnemyInput>('enemyInput', { required: true })

function setDamageKind(kind: OptimalDamageKind) {
  if (sweepDamageKind.value === kind) return
  sweepDamageKind.value = kind
}

const directAlloc = reactive<DirectAllocState>({
  flatStat: 0,
  hpFlat: 0,
  atkPercent: 0,
  pen: 0,
  mastery: 0,
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

/**
 * 4/5/6 号驱动盘主属性 —— 单一来源：「词条导入」那份来源记录（它只服务这一路）。
 *
 * 面板本身由外部配置给出（见 `optimalAffixAlloc.ts` 的 `mainBaseExternalPanel`），
 * 这里的主属性只服务两件事：
 * ① 柱体模式的词条上限规则（`36 − 6×同类主属性数`，用户要求「柱体模式照旧」）；
 * ② 主属性组合试算的相对差（`evaluateMainStatComboDamage`）。
 */
const driveDiscMainStats = computed<AffixDriveDiscMainStats>(() => ({
  ...createDefaultAffixDriveDiscMainStats(),
  ...(props.slotPanels?.[mainSlot.value.agentId]?.affixDriveDiscMainStats ?? {}),
}))

/** 当前编辑角色「词条导入」那一路的词条数（没有存面板时用来现推局外） */
const mainAffixCounts = computed<AffixCounts>(() => ({
  ...createEmptyAffixCounts(),
  ...(props.slotPanels?.[mainSlot.value.agentId]?.affixCounts ?? {}),
}))

const mainAgent = computed(() => props.agents.find((item) => item.id === mainSlot.value.agentId))

const { skillSubcategories, followUpSkillRules } = storeToRefs(useCalculatorBuffStore())

const selectedBangboo = computed(
  () =>
    props.bangboos.find((item) => item.id === props.selectedBangbooId) ??
    props.bangboos.find((item) => item.id === 'none') ??
    emptyBangboo,
)

/** 转模来源统一读各角色完整局外（导入/页级 activeSlotPanels）；旧方案 convertSlotPanels 仅作兜底 */
const evalConvertSlotPanels = computed((): ConvertSlotPanels => props.convertSlotPanels ?? {})

/**
 * 参与者的局外面板 —— 单一来源：直接读页级「角色配置」（`props.activeSlotPanels`）。
 *
 * 这里原先是模块自建的副本 `optimalParticipantPanels`（缺面板时用角色基础面板兜底），
 * 副本会与页级配置漂移，是「面板改完进最优仍用旧值」这类问题的来源，已删除。
 *
 * 也不再剔除当前编辑角色的面板：旧架构下当前编辑角色局外由候选词条推导，所以要把页级那份摘掉以免顶掉
 * 推导结果；新架构下**页级那份就是基准**，摘掉等于让基准失效（会静默回退到推导路径）。
 * 当前编辑槽位本身取的是「基准 + 候选词条」的评估结果（`ctx.mainExternalPanel`），
 * 面板聚合里 live 槽位优先读它，因此不会用到未叠加候选的基准值。
 */
const effectiveAnomalySlotPanels = computed(() => {
  const merged: Record<string, PanelStats> = {}
  for (const [agentId, panel] of Object.entries(props.activeSlotPanels ?? {})) {
    if (!panel || isPlaceholderExternalPanel(panel)) continue
    merged[agentId] = fillPanelStatsDefaults({ ...panel })
  }
  return merged
})

const isMb = computed(() => mainAgent.value?.profession === MB_PROFESSION)
const isFengYu = computed(() => mainAgent.value?.profession === FENGYU_PROFESSION)

/**
 * 词条功能改造：词条库 + 全词条收益 + 最优分配。
 *
 * 声明位置在 `evalCtx` 之前：评估上下文要带词条库的「每档值」，而 computed 首次求值时
 * 若还没走到声明处会触发 TDZ，所以库状态统一放在这里。
 */
const affixLibraryState = ref<AffixLibraryState>(createDefaultAffixLibraryState())
const affixLibraryEntries = computed<AffixLibraryEntry[]>(() =>
  resolveAffixLibrary(affixLibraryState.value),
)
const affixLibraryAllEntries = computed<AffixLibraryEntry[]>(() =>
  resolveAffixLibraryAll(affixLibraryState.value),
)
const enabledAffixEntryIds = computed(() =>
  affixLibraryAllEntries.value
    .filter((entry) => isAffixLibraryEntryEnabled(affixLibraryState.value, entry))
    .map((entry) => entry.id),
)
/**
 * 词条库的「每档值」表：局外 `panel:` 用条目自己的 `perRoll`，其余字段回落常量表。
 */
const affixLibraryValuePerCount = computed(() =>
  affixValuePerCountFromEntries(affixLibraryEntries.value),
)

const evalCtx = computed(() =>
  buildOptimalEvalContext({
    isMb: isMb.value,
    isFengYu: isFengYu.value,
    teamSlots: props.teamSlots,
    agents: props.agents,
    wengines: props.wengines,
    bangboo: selectedBangboo.value,
    bangbooRefine: props.bangbooRefine,
    driveDiscs: props.driveDiscs,
    mainSlotIndex: mainSlotIndex.value,
    driveDiscMainStats: { ...driveDiscMainStats.value },
    mainAffixCounts: mainAffixCounts.value,
    enemyInput: { ...enemyInput.value },
    baseDamageSource: isMb.value ? 'pierce' : isFengYu.value ? 'def' : baseDamageSource.value,
    extraGains: extraGains.value.map((item) => ({ ...item })),
    skillContext: buildGenericPanelSkillContext({
      element: mainAgent.value?.element,
      staggerPhase: props.staggerPhase ?? 'stagger',
      damageKind: sweepDamageKind.value ?? 'direct',
    }),
    buffSelection: props.buffSelection ?? null,
    slotBuffSelections: props.slotBuffSelections ?? null,
    activeSlotPanels: effectiveAnomalySlotPanels.value,
    convertSlotPanels: evalConvertSlotPanels.value,
    triggerAnomalyAgentId: props.triggerAnomalyAgentId,
    hits: props.hits,
    resolveSubcategory: (id) => skillSubcategories.value.find((item) => item.id === id) ?? null,
    skillSubcategories: skillSubcategories.value,
    followUpSkillRules: followUpSkillRules.value,
    environmentBuffs: props.environmentBuffs,
    // 词条库「每档值」随上下文走：柱图 / 详情 / 收益表 / 基准总伤共用一份，避免分叉
    valuePerCount: affixLibraryValuePerCount.value,
  }),
)

const flatLabel = computed(() => flatStatLabel(isMb.value, isFengYu.value))
const outLabel = computed(() => outPercentLabel(isMb.value, isFengYu.value))

const directError = computed(() =>
  validateDirectAlloc(directAlloc, isMb.value, driveDiscMainStats.value, isFengYu.value),
)
const anomalyError = computed(() =>
  validateAnomalyAlloc(anomalyAlloc, isMb.value, driveDiscMainStats.value, isFengYu.value),
)

const sweepConfigFingerprint = computed(() =>
  JSON.stringify({
    baseDamageSource: baseDamageSource.value,
    driveDiscMainStats: { ...driveDiscMainStats.value },
    enemy: enemyInput.value,
    extraGains: extraGains.value,
    convert: props.convertSlotPanels ?? {},
    participants: props.activeSlotPanels ?? {},
    damageKind: sweepDamageKind.value,
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

const DIFF_DEBOUNCE_MS = 450
const DIFF_EVENT_DEBOUNCE_MS = 900
const SKILL_FLOW_EMIT_DEBOUNCE_MS = 200
/** 词条输入时面板预览防抖，避免每个按键都同步全量算伤 */
const PANEL_PREVIEW_DEBOUNCE_MS = 180

const directPoints = ref<DirectSweepPoint[]>([])
const anomalyPoints = ref<AnomalySweepPoint[]>([])
const sweepComputing = ref(false)
/** 配置或词条分配变更后需手动点「开始计算」 */
const sweepNeedsCommit = ref(true)
/** 已点过「开始计算」，且之后配置/分配未再改 */
const sweepCommitted = ref(false)

const hasEventMode = computed(() => (props.hits?.length ?? 0) > 0)

let diffTimer: ReturnType<typeof setTimeout> | null = null
let skillFlowEmitTimer: ReturnType<typeof setTimeout> | null = null
let panelPreviewTimer: ReturnType<typeof setTimeout> | null = null
let sweepAbort: AbortController | null = null
let sweepGeneration = 0
/** 隐藏期间外部配置有变，回到本模块时再提示重算，不清空已有柱图 */
const pendingConfigDirty = ref(false)

function markSweepConfigDirty() {
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
  if (!sweepDamageKind.value) return
  if (sweepDamageKind.value === 'direct' && directError.value) return
  if (sweepDamageKind.value === 'anomaly' && anomalyError.value) return
  pendingConfigDirty.value = false
  sweepNeedsCommit.value = false
  sweepCommitted.value = true
  clearAffixEvalCache()
  clearBarSelection()
  void runSweepRecompute()
}

async function runSweepRecompute() {
  if (!sweepCommitted.value || !sweepDamageKind.value) {
    sweepComputing.value = false
    return
  }
  const generation = ++sweepGeneration
  sweepAbort?.abort()
  const controller = new AbortController()
  sweepAbort = controller
  sweepComputing.value = true
  const chunkSize = hasEventMode.value ? 3 : 6
  const kind = sweepDamageKind.value
  try {
    if (kind === 'direct') {
      if (directError.value) {
        directPoints.value = []
      } else if (
        directPoints.value.length > 0 &&
        canReuseCurrentDirectSweep(directPoints.value, directAlloc)
      ) {
        // 仅固定词条（精通/穿透/小攻等）变化：复用扫掠结构，只重算各点伤害
        directPoints.value = await refreshDirectSweepFixedStats(
          evalCtx.value,
          directAlloc,
          directPoints.value,
          { signal: controller.signal, chunkSize },
        )
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

function canReuseCurrentDirectSweep(points: DirectSweepPoint[], state: DirectAllocState) {
  // 结构 + 主词条上限一起判定，见 canReuseDirectSweepStructure 的说明
  return canReuseDirectSweepStructure(
    points,
    state,
    isMb.value,
    isFengYu.value,
    driveDiscMainStats.value,
  )
}

async function refreshDirectSweepFixedStats(
  ctx: ReturnType<typeof buildOptimalEvalContext>,
  state: DirectAllocState,
  points: DirectSweepPoint[],
  options: { signal: AbortSignal; chunkSize: number },
) {
  const next: DirectSweepPoint[] = []
  let sinceYield = 0
  for (const point of points) {
    if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const affixCounts = buildDirectAffixCounts(
      ctx.isMb,
      { ...state },
      point.outPercent,
      point.critDmg,
      ctx.isFengYu,
    )
    const swept = evaluateAffixCountsForSweep(ctx, affixCounts)
    next.push({
      ...point,
      affixCounts,
      evalSnapshot: null,
      directExpected: swept.grandTotal,
      eventLines: swept.eventLines,
      grandTotal: swept.grandTotal,
    })
    sinceYield += 1
    if (sinceYield >= options.chunkSize) {
      sinceYield = 0
      // 复用统一让出实现（MessageChannel）。此处原先自己用 rAF，每次让出要等满一帧
      // 16.66ms；事件模式下 chunkSize=3 会把扫掠拖成「让出次数 × 16.66ms」，与计算量无关
      await yieldToMain()
    }
  }
  return next
}

watch(isSectionActive, (active) => {
  if (!active) {
    sweepAbort?.abort()
    if (skillFlowEmitTimer) {
      clearTimeout(skillFlowEmitTimer)
      skillFlowEmitTimer = null
    }
    if (panelPreviewTimer) {
      clearTimeout(panelPreviewTimer)
      panelPreviewTimer = null
    }
    return
  }
  if (pendingConfigDirty.value) {
    pendingConfigDirty.value = false
    markSweepConfigDirty()
  }
})

watch(sweepConfigFingerprint, markSweepConfigDirty)

/** 用指纹代替 deep watch，避免响应式遍历放大开销 */
const allocSweepFingerprint = computed(() =>
  JSON.stringify({
    kind: sweepDamageKind.value,
    direct: { ...directAlloc },
    anomaly: { ...anomalyAlloc },
    directError: directError.value,
    anomalyError: anomalyError.value,
  }),
)

watch(allocSweepFingerprint, markSweepConfigDirty)

onBeforeUnmount(() => {
  if (diffTimer) clearTimeout(diffTimer)
  if (skillFlowEmitTimer) clearTimeout(skillFlowEmitTimer)
  if (panelPreviewTimer) clearTimeout(panelPreviewTimer)
  if (eventAffixImpactTimer) clearTimeout(eventAffixImpactTimer)
  sweepAbort?.abort()
})

const showEventAffixImpact = ref(false)
const showCombinedMainStatRankings = ref(false)
const eventAffixImpactLoading = ref(false)
const combinedMainStatRankingsLoading = ref(false)

const sweepPoints = computed(() =>
  sweepDamageKind.value === 'direct' ? directPoints.value : anomalyPoints.value,
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
  if (sweepDamageKind.value === 'direct') return selectedDirect.value?.affixCounts ?? null
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

const eventAffixImpact = ref<OptimalEventAffixImpact[]>([])
const eventAffixImpactStale = ref(false)
let eventAffixImpactTimer: ReturnType<typeof setTimeout> | null = null

function recomputeEventAffixImpact() {
  if (!hasEventMode.value || !analysisCounts.value || !sweepDamageKind.value) {
    eventAffixImpact.value = []
    return
  }
  eventAffixImpact.value = computeEventAffixImpact(
    evalCtx.value,
    analysisCounts.value,
    sweepDamageKind.value,
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
    kind: sweepDamageKind.value,
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
  sweepDamageKind.value === 'direct'
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
const allocPreviewCounts = computed(() => {
  if (selectedCounts.value) return null
  if (sweepDamageKind.value === 'direct') {
    if (directPoints.value[0]?.affixCounts) return null
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
      isFengYu.value,
    )
  }
  if (anomalyPoints.value[0]?.affixCounts) return null
  if (anomalyError.value || !sweepDamageKind.value || !mainAgent.value?.id) return null
  const total = Math.round(anomalyAlloc.totalRolls)
  return buildAnomalyAffixCounts(
    isMb.value,
    { ...anomalyAlloc, totalRolls: total },
    0,
    total,
    isFengYu.value,
  )
})

/** 防抖后的预览词条，避免输入时每个按键都同步 evaluate */
const debouncedAllocPreviewCounts = ref<AffixCounts | null>(null)

watch(
  allocPreviewCounts,
  (counts) => {
    if (panelPreviewTimer) clearTimeout(panelPreviewTimer)
    if (!counts) {
      debouncedAllocPreviewCounts.value = null
      return
    }
    panelPreviewTimer = setTimeout(() => {
      debouncedAllocPreviewCounts.value = counts
    }, PANEL_PREVIEW_DEBOUNCE_MS)
  },
  { immediate: true },
)

const displayCounts = computed(() => {
  if (selectedCounts.value) return selectedCounts.value
  if (sweepDamageKind.value === 'direct' && directPoints.value[0]?.affixCounts) {
    return directPoints.value[0].affixCounts
  }
  if (sweepDamageKind.value === 'anomaly' && anomalyPoints.value[0]?.affixCounts) {
    return anomalyPoints.value[0].affixCounts
  }
  return debouncedAllocPreviewCounts.value
})

const selectedEval = computed(() => {
  if (!selectedCounts.value) return null
  const point =
    sweepDamageKind.value === 'direct' ? selectedDirect.value : selectedAnomaly.value
  if (point?.evalSnapshot) return point.evalSnapshot
  // 过程 Tab 需要完整事件明细；其余场景只算当前编辑角色面板，避免点柱就卡一下
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
      mains: { ...driveDiscMainStats.value },
    }),
  () => {
    scheduleEventAffixImpactRefresh()
  },
)

/**
 * 招式流程用的局外面板。优先级：
 * ① 页级下发的覆盖值（三选项的 ②③）→ ② 角色配置里的激活面板 → ③ 没录入面板时才落回柱体推导
 * （未扫过且无配置面板 → 空，不算招式总伤）。
 */
const skillFlowExternal = computed(() => {
  const override = props.skillFlowMainExternalOverride
  if (override) return override
  // ① 角色配置面板：页级已解析的激活面板（与面板侧同一份来源）
  const mainAgentId = props.teamSlots[mainSlotIndex.value]?.agentId
  const savedConfigPanel = mainAgentId ? props.activeSlotPanels?.[mainAgentId] : undefined
  if (savedConfigPanel) return fillPanelStatsDefaults(savedConfigPanel)
  // 没有录入面板时保留旧行为：只在扫掠过之后按柱体算（未扫过为空）
  if (!sweepPoints.value.length) return null
  return analysisEval.value?.external ?? null
})

/**
 * 与页级同一份字段表算出的上下文签名（`buildSkillFlowPageSignature`）。
 *
 * 用途：上报来源时**带上「这份面板是在什么配置下算出来的」**，页级据此判过期。
 * 字段表只有一份（在 util 里），两个调用点各自的取值都来自页级下发的同一批 props，
 * 因此两边算出来必定一致。
 */
const panelSourceSignature = computed(() =>
  buildSkillFlowPageSignature({
    teamSlots: props.teamSlots,
    slotPanels: props.slotPanels,
    activeSlotPanels: props.activeSlotPanels ?? {},
    convertSlotPanels: props.convertSlotPanels,
    mainSlotIndex: mainSlotIndex.value,
    selectedBangbooId: props.selectedBangbooId,
    bangbooRefine: props.bangbooRefine,
    slotBuffSelections: props.slotBuffSelections,
    environmentBuffIds: (props.environmentBuffs ?? []).map((item) => item.id),
    extraGains: extraGains.value,
    enemyInput: enemyInput.value,
    staggerPhase: props.staggerPhase,
    damageKind: props.damageKind,
    anomalySubKind: props.anomalySubKind,
    skillCategoryId: props.skillCategoryId,
    skillSubcategoryId: props.skillSubcategoryId,
    triggerAnomalyAgentId: props.triggerAnomalyAgentId,
    baseDamageSource: baseDamageSource.value,
  }),
)

/**
 * 上报「最优分配 / 当前柱」两个来源的主 C 局外面板，供招式流程三选项使用。
 *
 * 定义位置在 `affixAllocEval` 之后（TDZ）：`affixAllocEval` 在本文件靠后定义，
 * 提前引用会在 setup 阶段直接抛「Cannot access before initialization」（实测踩过）。
 *
 * 报的是**算好的面板**而不是词条数：两个消费者必须拿到同一份数值（各自再叠一次会引入分叉）。
 * 只在真正算过时上报；未算过的来源报 null（选项据此禁用）。
 */
function emitPanelSourceOptions() {
  const result = affixAllocResult.value
  emit('update:panelSourceOptions', {
    allocation: affixAllocEval.value?.external
      ? buildPanelSourceOption(
          'allocation',
          affixAllocEval.value.external,
          allocationRollsSummary(result),
          result?.extraGains,
        )
      : null,
    sweep: selectedEval.value?.external
      ? buildPanelSourceOption(
          'sweep',
          selectedEval.value.external,
          sweepCountsSummary(selectedCounts.value),
        )
      : null,
  })
}

/**
 * 面板展示专用上报（独立通道，不污染流程计算用的 `panelSourceOptions`）。
 *
 * 展示功能需要 ②③ 的局外 + 局内；局内（finalPanel）不在流程计算上报里，
 * 这里把词条分析侧**已算好的** external / finalPanel 一并上报（同一份数值，
 * 与词条分析侧「局内（含增益）」结果一致，展示侧不再重复计算）。
 */
type DisplayPanelEvalLike = { external: PanelStats; finalPanel: PanelStats } | null | undefined

function allocationRollsSummary(result: AffixOptimizerResult | null): string {
  if (!result) return '零词条'
  const library = affixAllocResultLibrary.value.length
    ? affixAllocResultLibrary.value
    : affixLibraryEntries.value
  return formatAffixRollsSummary(library, result.rollsByEntryId)
}

function sweepCountsSummary(counts: AffixCounts | null | undefined): string {
  if (!counts) return '零词条'
  return formatAffixCountsSummary(
    { ...(counts as unknown as Record<string, number>) },
    AFFIX_SOURCE_LABELS,
  )
}

function buildDisplayPanelSourceOption(
  mode: 'allocation' | 'sweep',
  evalResult: DisplayPanelEvalLike,
  summary: string,
): SkillFlowDisplayOption | null {
  if (!evalResult?.external || !evalResult.finalPanel) return null
  return {
    mode,
    mainExternal: evalResult.external,
    finalPanel: evalResult.finalPanel,
    label: mode === 'allocation' ? `最优分配（${summary}）` : `当前柱（${summary}）`,
    signature: panelSourceSignature.value,
  }
}

function emitDisplayPanelSources() {
  const result = affixAllocResult.value
  emit('update:displayPanelSources', {
    allocation: buildDisplayPanelSourceOption(
      'allocation',
      affixAllocEval.value,
      allocationRollsSummary(result),
    ),
    sweep: buildDisplayPanelSourceOption(
      'sweep',
      selectedEval.value,
      sweepCountsSummary(selectedCounts.value),
    ),
  })
}

function buildPanelSourceOption(
  mode: 'allocation' | 'sweep',
  mainExternal: PanelStats,
  summary: string,
  extraGainsForOption?: ExtraBuffGain[],
): SkillFlowPanelOption {
  return {
    mode,
    mainExternal,
    label: mode === 'allocation' ? `最优分配（${summary}）` : `当前柱（${summary}）`,
    signature: panelSourceSignature.value,
    baseDamageSource: baseDamageSource.value,
    extraGains: extraGainsForOption,
  }
}

/** 选项 tooltip 里的词条名（与 `affixKeyLabel` 同口径，命破/锋御的局外大% 由词条键区分） */
const AFFIX_SOURCE_LABELS: Record<string, string> = {
  atkFlat: '攻击力',
  hpFlat: '生命值',
  defFlat: '防御力',
  atkPercent: '局外大攻击',
  hpPercent: '局外大生命',
  defPercent: '局外大防御',
  pen: '穿透值',
  critRate: '暴击',
  critDmg: '爆伤',
  mastery: '精通',
  dmgBonus: '增伤',
  penRate: '穿透率',
  reduceDefense: '减防',
  resPen: '抗性穿透',
}

/** 用最优词条面板重算流程/准备招式预览伤害，供招式流程展示（防抖 + per-hit 缓存） */
const skillFlowHitMapState = ref<{
  map: Record<string, number>
  results: Record<string, DamageCalcResult>
}>({ map: {}, results: {} })

let pendingSkillFlowEmit = false

const skillFlowContextFingerprint = computed(() =>
  JSON.stringify({
    enemy: enemyInput.value,
    extraGains: extraGains.value,
    sourceExtraGains: props.skillFlowSourceExtraGains ?? [],
    buffSelection: props.buffSelection,
    slotBuffSelections: props.slotBuffSelections,
    convert: props.convertSlotPanels ?? {},
    anomaly: props.activeSlotPanels ?? {},
    participants: props.activeSlotPanels ?? {},
    env: (props.environmentBuffs ?? []).map((item) => item.id),
    bangboo: [props.selectedBangbooId, props.bangbooRefine],
    mains: { ...driveDiscMainStats.value },
    baseDamageSource: baseDamageSource.value,
    damageKind: sweepDamageKind.value,
    stagger: props.staggerPhase,
  }),
)

const skillFlowHitFingerprint = computed(() => {
  if (!isSectionActive.value) return 'inactive'
  const external = skillFlowExternal.value
  return JSON.stringify({
    context: skillFlowContextFingerprint.value,
    external: external ?? null,
    hits: (props.hits ?? []).map(buildHitEvalFingerprint),
    previews: (props.previewHits ?? []).map(buildHitEvalFingerprint),
  })
})

function recomputeSkillFlowHitMaps() {
  if (!isSectionActive.value) {
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

  const ctx = evalCtx.value
  const allocatedGains = props.skillFlowMainExternalOverride
    ? (props.skillFlowSourceExtraGains ?? [])
    : []
  const flowCtx = withAffixLibraryExtraGains(ctx, allocatedGains)
  // 与面板计算共用同一张记忆表：键里带「用的是哪份面板」，两组输入各占一行，互不覆盖。
  // 令牌取自响应式指纹（不能从 ctx 取：ctx 是深解包后的原始对象，读取不建立依赖）。
  const contextToken = internHitEvalContext(skillFlowContextFingerprint.value)

  const resolveLine = (hit: import('@/utils/resolvedHit').ResolvedHit, usePerHit: boolean) => {
    const key = hitEvalCacheKey(buildHitEvalFingerprint(hit), contextToken, external, false)
    let entry = readHitEvalCache(key)
    if (!entry) {
      const detail = evaluateOptimalEventDetail(flowCtx, external, hit, {
        includeDetails: false,
      })
      if (!detail) return
      entry = {
        hitId: hit.id,
        total: detail.total,
        perHit: detail.perHit,
        result: detail.result,
      }
      writeHitEvalCache(key, entry)
    }
    // 准备招式（预览）走独立键：按单次伤害展示，不进总伤（总伤只汇总流程事件）
    const mapKey = usePerHit ? `preview:${hit.id}` : hit.id
    map[mapKey] = usePerHit ? entry.perHit : entry.total
    results[hit.id] = entry.result
  }

  for (const hit of props.hits ?? []) resolveLine(hit, false)
  for (const hit of props.previewHits ?? []) resolveLine(hit, true)

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

function metricOf(result: DamageCalcResult, grandTotal?: number) {
  if (typeof grandTotal === 'number' && Number.isFinite(grandTotal)) return grandTotal
  if (sweepDamageKind.value === 'direct') return result.directDamageExpected
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

/**
 * 事件模式下按「统计事件」筛选求和；非事件模式走原 metric。
 *
 * 词条分析页的组合试算不依赖扫掠柱图勾选（那边事件列表来自柱体，
 * 未跑扫掠时 `selectedChartEventIds` 常为空 → 以前会算出 0→0）。
 * 与「全词条收益」同口径：一律流程全部事件总伤。
 */
function resolveAffixMetricDamage(evaled: AffixEvalSnapshot) {
  if (!hasEventMode.value || !evaled.eventLines?.length) {
    return metricOf(evaled.result, evaled.grandTotal)
  }
  if (sectionMode.value === 'allocation') {
    return evaled.grandTotal
  }
  const ids = new Set(selectedChartEventIds.value)
  if (!ids.size) return evaled.grandTotal
  return evaled.eventLines
    .filter((line) => ids.has(line.eventId))
    .reduce((sum, line) => sum + line.total, 0)
}

const mainStatEventScopeHint = computed(() => {
  if (!hasEventMode.value) return ''
  if (sectionMode.value === 'allocation') {
    return '按全部统计事件计算'
  }
  if (!selectedChartEventIds.value.length) {
    return '未勾选柱图事件，已按全部事件回退'
  }
  if (selectedChartEventIds.value.length === chartEventOptions.value.length) {
    return '按全部统计事件计算'
  }
  return `按已选 ${selectedChartEventIds.value.length} 个统计事件计算`
})

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
    rankingSlot4Options.value.some((item) => item.id === driveDiscMainStats.value.slot4MainStat) &&
    rankingSlot5Options.value.some((item) => item.id === driveDiscMainStats.value.slot5MainStat) &&
    rankingSlot6Options.value.some((item) => item.id === driveDiscMainStats.value.slot6MainStat)
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

/**
 * 词条分配（新功能，主）与手动扫掠柱图（旧功能，次要）二选一。
 * 两者各有独立的输入与子页签（收益曲线 / 计算过程）。
 */
const sectionMode = ref<'allocation' | 'sweep'>('allocation')

/** 词条分配模式：输入与提交状态 */
const affixAllocTotalRolls = ref(30)
const affixAllocDetailTab = ref<'curve' | 'process'>('curve')
const affixAllocResult = ref<AffixOptimizerResult | null>(null)
const affixAllocResultStale = ref(false)
const affixAllocLoading = ref(false)
const affixAllocError = ref<string | null>(null)
/**
 * 最近一次点的是哪种分配方式 —— **只驱动界面上的「二选一」高亮**，不参与计算、不落盘。
 * 求解结果本身不带模式信息，所以这里单独记一格；失败/中止时也保留高亮，
 * 好让用户知道刚才点的是哪一个。
 */
const affixAllocMode = ref<'default' | 'game' | null>(null)
/**
 * 词条搜索设置（本机独立存盘）：预设 + 三项搜索参数 + 高级区展开状态。
 *
 * 三项参数各有一句白话解释，见 `dev-docs/词条最优分配.md`「改造：自适应 Beam」：
 * - 初始候选门槛：单档收益只跟**本组最高**比，差太远的直接出局、后面不再回头捡；
 * - 路线保留比例：同一档数下只留接近最好的那批分法；
 * - 最大保留路线：同时最多试多少种分法。
 *
 * ⚠️ 空组（临时）条目不参与最优计算，也不显示收益表。
 */
const affixSearchSettings = ref<AffixSearchSettings>(loadAffixSearchSettings())
/** 预设顺序（下拉展示用） */
const SEARCH_PRESET_ORDER: AffixSearchPresetId[] = ['fast', 'balanced', 'fine', 'custom']
/** 当前生效的三项参数：预设直取预设表，自定义取用户值 */
const affixSearchParams = computed<AffixSearchParams>(() =>
  effectiveAffixSearchParams(affixSearchSettings.value),
)

function persistAffixSearchSettings() {
  saveAffixSearchSettings(affixSearchSettings.value)
}

function setAffixSearchPreset(preset: AffixSearchPresetId) {
  // 切到自定义时，从「当前生效值」起步，避免丢掉另外两项
  const custom = preset === 'custom'
    ? { ...effectiveAffixSearchParams(affixSearchSettings.value) }
    : affixSearchSettings.value.custom
  affixSearchSettings.value = { ...affixSearchSettings.value, preset, custom }
  persistAffixSearchSettings()
}

function onAffixSearchPresetChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as AffixSearchPresetId
  setAffixSearchPreset(value)
}

/** 改任一项都视为「自定义」，并从当前生效值起步 */
function setAffixSearchCustom(patch: Partial<AffixSearchParams>) {
  const base = affixSearchSettings.value.preset === 'custom'
    ? affixSearchSettings.value.custom
    : effectiveAffixSearchParams(affixSearchSettings.value)
  affixSearchSettings.value = {
    ...affixSearchSettings.value,
    preset: 'custom',
    custom: { ...base, ...patch },
  }
  persistAffixSearchSettings()
}

/** 高级设置弹窗开合（不落盘：弹窗状态没必要持久化） */
const affixSearchAdvancedOpen = ref(false)

/** 求解进度（仅求解中刷新） */
const affixAllocProgress = ref<AffixOptimizerProgress | null>(null)
/** 进度刷新间隔（毫秒）：求解每个时间片都回调，逐次刷新会拖慢求解本身 */
const AFFIX_ALLOC_PROGRESS_THROTTLE_MS = 100
let lastProgressAt = 0
let affixAllocAbort: AbortController | null = null
/** 最近一次求解用的条目（普通库或游戏专用方案），结果表按这个显示 */
const affixAllocResultLibrary = ref<AffixLibraryEntry[]>([])
const gameAffixLibraryEntries = createGameAffixLibraryEntries()
const gameAffixSettings = ref(loadGameAffixRulesSettings(gameAffixLibraryEntries))
const gameAffixRulesOpen = ref(false)
const affixBenefitTable = ref<AffixBenefitTableData | null>(null)
/** 逐档收益曲线：按需补算（首屏不算），失效时置 null */
const affixBenefitSeries = ref<AffixBenefitSeries[] | null>(null)
/** 曲线补算中（首屏不算曲线，切到「收益曲线」时才补） */
const affixBenefitSeriesLoading = ref(false)
const affixBenefitLoading = ref(false)
const affixBenefitStep = ref(1)

/** 词条分配模式的基线：从零词条开始（回答「N 个词条怎么分」） */
const affixAllocBaseCounts = computed(() => createEmptyAffixCounts())

/** 词条分配模式的评估结果（用于计算过程页签） */
const affixAllocEval = computed(() => {
  const result = affixAllocResult.value
  if (!result) return null
  return evaluateAffixCounts(evalCtx.value, result.counts, result.panelDeltas, result.valuePerCount, result.extraGains)
})

/**
 * 主属性组合试算 / 排行的副词条基线：
 * - 词条分析页独立模块：零副词条；有导入面板时在面板上反推换主属性/2 件套（不叠求解词条）
 * - 扫掠柱图：沿用 analysisCounts（点柱 / 预览）
 */
const comboBaselineCounts = computed(() => {
  if (sectionMode.value === 'allocation') {
    return affixAllocBaseCounts.value
  }
  return analysisCounts.value
})

const comboBaselineReady = computed(() => {
  if (sectionMode.value === 'allocation') {
    return hasEventMode.value
  }
  return Boolean(analysisCounts.value && analysisEval.value)
})

/** 词条分析页组合试算能否走「导入面板反推」：需要页级基准局外 */
const comboUsesImportedPanel = computed(
  () =>
    sectionMode.value === 'allocation' &&
    Boolean(evalCtx.value.mainBaseExternalPanel),
)

// 两个来源的面板就绪 / 失效时上报给页级（招式流程三选项据此启用与判过期；
// 面板展示专用通道同一时机一并上报）
watch(
  [
    () => affixAllocEval.value?.external ?? null,
    () => selectedEval.value?.external ?? null,
    panelSourceSignature,
  ],
  () => {
    emitPanelSourceOptions()
    emitDisplayPanelSources()
  },
  { immediate: true },
)

affixLibraryState.value = loadAffixLibraryState()

function persistAffixLibrary(next: AffixLibraryState) {
  affixLibraryState.value = next
  saveAffixLibraryState(next)
  affixAllocResult.value = null
  affixAllocResultStale.value = false
  runAffixBenefitOnly()
}

function toggleAffixLibraryEntry(entryId: string, enabled: boolean) {
  persistAffixLibrary(setAffixLibraryEntryEnabled(affixLibraryState.value, entryId, enabled))
}

/**
 * 一次改多条启用状态（组页的「全选 / 全部取消」）。
 *
 * 只落一次盘：逐条走 `persistAffixLibrary` 会让求解重跑 N 次，几十条的组会明显卡。
 */
function toggleAffixLibraryEntries(entryIds: string[], enabled: boolean) {
  if (!entryIds.length) return
  let next = affixLibraryState.value
  for (const entryId of entryIds) next = setAffixLibraryEntryEnabled(next, entryId, enabled)
  persistAffixLibrary(next)
}

function addAffixLibraryEntry(entry: Omit<AffixLibraryEntry, 'id'>) {
  persistAffixLibrary(addCustomAffixLibraryEntry(affixLibraryState.value, entry))
}

function updateAffixLibraryEntryPatch(entryId: string, patch: Partial<AffixLibraryEntry>) {
  persistAffixLibrary(updateAffixLibraryEntry(affixLibraryState.value, entryId, patch))
}

function removeAffixLibraryEntryById(entryId: string) {
  persistAffixLibrary(removeAffixLibraryEntry(affixLibraryState.value, entryId))
}

function restoreAffixLibraryDefaultsHandler() {
  // 保留起点：空配置的库点「恢复默认」仍是空配置；独立库按当前官方预设重新复制一份。
  // 「独立库要复制官方那份」这一条由弹窗先行把官方数据取到（见 AffixLibraryModal.onRestoreDefaults），
  // 这里再兜一道：万一没取到就不动手，避免把代码兜底当成官方冻进用户的库。
  const origin = affixLibraryState.value.origin
  if (origin === 'copy' && !isUsingServerAffixPreset()) return
  persistAffixLibrary(restoreAffixLibraryDefaults(origin))
}

function addAffixLibraryGroupHandler(name: string, cap: number) {
  persistAffixLibrary(addAffixLibraryGroup(affixLibraryState.value, name, cap))
}

function setAffixLibraryGroupCapHandler(name: string, cap: number) {
  persistAffixLibrary(setAffixLibraryGroupCap(affixLibraryState.value, name, cap))
}

function renameAffixLibraryGroupHandler(from: string, to: string) {
  persistAffixLibrary(renameAffixLibraryGroup(affixLibraryState.value, from, to))
}

function removeAffixLibraryGroupHandler(name: string) {
  persistAffixLibrary(removeAffixLibraryGroup(affixLibraryState.value, name))
}

/**
 * 词条库弹窗做了库级变更（切换 / 新建 / 删除 / 导入）。
 *
 * 这些操作在弹窗里已经落盘，这里只需把激活那套重新读进来并重算：
 * `persistAffixLibrary` 会顺带清空旧的分配结果并重跑收益表。
 */
function onAffixLibrarySwitched() {
  persistAffixLibrary(loadAffixLibraryState())
}

/** 词条分配模式：收益表自动跟随上下文计算，最优分配点按钮才求解 */
function runAffixBenefitOnly() {
  if (affixBenefitLoading.value) return
  if (!affixLibraryEntries.value.length) {
    affixBenefitTable.value = null
    affixBenefitSeries.value = null
    return
  }
  affixBenefitLoading.value = true
  window.setTimeout(() => {
    try {
      // 只算「基线 + 逐条目 +1 档」：曲线占评估量约 85%，而折线图要等求解完成
      // 才渲染（见模板 v-if="affixAllocResult"），首屏用不到 → 需要时再补算
      affixBenefitTable.value = computeAffixBenefitTable({
        ctx: evalCtx.value,
        baseCounts: affixAllocBaseCounts.value,
        entries: affixLibraryEntries.value,
        rollsPerStep: affixBenefitStep.value,
        includeSeries: false,
      })
      affixBenefitSeries.value = null
    } finally {
      affixBenefitLoading.value = false
    }
  }, 0)
}

/**
 * 补算逐档收益曲线（用户真的要看折线图时）。
 * 已算过或正在算则直接返回，避免重复点击反复重算；放到下一个宏任务里算，避免卡住点击。
 */
function ensureAffixBenefitSeries() {
  if (affixBenefitSeries.value || affixBenefitSeriesLoading.value) return
  const table = affixBenefitTable.value
  if (!table || !table.rows.length) return
  const input = {
    ctx: evalCtx.value,
    baseCounts: affixAllocBaseCounts.value,
    entries: affixLibraryEntries.value,
    rollsPerStep: affixBenefitStep.value,
  }
  affixBenefitSeriesLoading.value = true
  window.setTimeout(() => {
    try {
      affixBenefitSeries.value = computeAffixBenefitSeriesForTable(input, table)
    } finally {
      affixBenefitSeriesLoading.value = false
    }
  }, 0)
}

let affixBenefitTimer: ReturnType<typeof setTimeout> | null = null

/** 上下文变化（招式、面板、主属性等）后自动重算收益表 */
function scheduleAffixBenefitRecompute() {
  if (sectionMode.value !== 'allocation') return
  if (affixBenefitTimer) clearTimeout(affixBenefitTimer)
  affixBenefitTimer = setTimeout(() => {
    if (sectionMode.value !== 'allocation') return
    runAffixBenefitOnly()
  }, DIFF_EVENT_DEBOUNCE_MS)
}

/** 词条分配模式：求解最优分配（分帧异步，可中止，带进度） */
async function runAffixAllocation() {
  if (affixAllocLoading.value) return
  if (!affixLibraryEntries.value.length) {
    affixAllocError.value = '词条库为空，请先启用至少一条词条'
    return
  }
  const total = Math.max(1, Math.min(60, Math.round(affixAllocTotalRolls.value)))
  affixAllocTotalRolls.value = total
  affixAllocMode.value = 'default'
  affixAllocLoading.value = true
  affixAllocError.value = null
  affixAllocProgress.value = null
  lastProgressAt = 0
  affixAllocAbort?.abort()
  const controller = new AbortController()
  affixAllocAbort = controller
  try {
    affixAllocResult.value = await solveOptimalAffixAllocationAsync(
      {
        ctx: evalCtx.value,
        entries: affixLibraryEntries.value,
        maxTotalRolls: total,
        searchPreset: affixSearchSettings.value.preset,
        initialCandidateThreshold: affixSearchParams.value.initialCandidateThreshold,
        initialCandidateFloor: affixSearchParams.value.initialCandidateFloor,
        routeRetentionRatio: affixSearchParams.value.routeRetentionRatio,
        maxRetainedRoutes: affixSearchParams.value.maxRetainedRoutes,
        groupCaps: affixGroupCaps(affixLibraryState.value),
      },
      {
        signal: controller.signal,
        // 进度节流：求解每个时间片都会回调一次（实测 200 次左右），而每次赋值都会
        // 触发整个组件重渲染 —— 剖析显示仅在求解期间重渲染 + 数字格式化就吃掉约
        // 11% 的 CPU（formatCalcDecimal/formatNumber 163ms、Vue 重建 ~40ms）。
        // 进度是给人看的，100ms 一次的刷新率远超人眼需求。
        onProgress: (progress) => {
          const now = performance.now()
          if (now - lastProgressAt < AFFIX_ALLOC_PROGRESS_THROTTLE_MS) return
          lastProgressAt = now
          affixAllocProgress.value = progress
        },
      },
    )
    affixAllocResultLibrary.value = affixLibraryEntries.value
    affixAllocResultStale.value = false
  } catch (error) {
    if ((error as DOMException)?.name === 'AbortError') return
    affixAllocError.value = error instanceof Error ? error.message : '计算失败'
    affixAllocResult.value = null
    affixAllocResultStale.value = false
  } finally {
    if (affixAllocAbort === controller) {
      affixAllocLoading.value = false
      affixAllocProgress.value = null
      affixAllocAbort = null
    }
  }
}

function persistGameAffixSettings() {
  saveGameAffixRulesSettings(gameAffixSettings.value)
}

function setGameExtraCost(value: number) {
  gameAffixSettings.value = {
    ...gameAffixSettings.value,
    extraCost: clampGameExtraCost(value),
  }
  persistGameAffixSettings()
}

function toggleGameAffixEntry(entryId: string, enabled: boolean) {
  const next = new Set(gameAffixSettings.value.enabledIds)
  if (enabled) next.add(entryId)
  else next.delete(entryId)
  gameAffixSettings.value = { ...gameAffixSettings.value, enabledIds: [...next] }
  persistGameAffixSettings()
}

function toggleGameAffixEntries(entryIds: string[], enabled: boolean) {
  const next = new Set(gameAffixSettings.value.enabledIds)
  for (const entryId of entryIds) {
    if (enabled) next.add(entryId)
    else next.delete(entryId)
  }
  gameAffixSettings.value = { ...gameAffixSettings.value, enabledIds: [...next] }
  persistGameAffixSettings()
}

/** 游戏专用 4 袋求解，不读用户词条库 */
async function runGameAffixAllocation() {
  if (affixAllocLoading.value) return
  if (!gameAffixSettings.value.enabledIds.length) {
    affixAllocError.value = '请先在「编辑」里勾选至少一条词条'
    return
  }
  const total = Math.max(1, Math.min(60, Math.round(affixAllocTotalRolls.value)))
  affixAllocTotalRolls.value = total
  affixAllocMode.value = 'game'
  affixAllocLoading.value = true
  affixAllocError.value = null
  affixAllocProgress.value = null
  lastProgressAt = 0
  affixAllocAbort?.abort()
  const controller = new AbortController()
  affixAllocAbort = controller
  try {
    affixAllocResult.value = await solveGameAffixAllocationAsync(
      {
        ctx: evalCtx.value,
        entries: gameAffixLibraryEntries,
        enabledIds: gameAffixSettings.value.enabledIds,
        extraCost: gameAffixSettings.value.extraCost,
        maxTotalRolls: total,
        searchPreset: affixSearchSettings.value.preset,
        initialCandidateThreshold: affixSearchParams.value.initialCandidateThreshold,
        initialCandidateFloor: affixSearchParams.value.initialCandidateFloor,
        routeRetentionRatio: affixSearchParams.value.routeRetentionRatio,
        maxRetainedRoutes: affixSearchParams.value.maxRetainedRoutes,
      },
      {
        signal: controller.signal,
        onProgress: (progress) => {
          const now = performance.now()
          if (now - lastProgressAt < AFFIX_ALLOC_PROGRESS_THROTTLE_MS) return
          lastProgressAt = now
          affixAllocProgress.value = progress
        },
      },
    )
    affixAllocResultLibrary.value = gameAffixLibraryEntries
    affixAllocResultStale.value = false
  } catch (error) {
    if ((error as DOMException)?.name === 'AbortError') return
    affixAllocError.value = error instanceof Error ? error.message : '计算失败'
    affixAllocResult.value = null
    affixAllocResultStale.value = false
  } finally {
    if (affixAllocAbort === controller) {
      affixAllocLoading.value = false
      affixAllocProgress.value = null
      affixAllocAbort = null
    }
  }
}

/** 中止正在进行的求解（改参数 / 手动停止时调用） */
function abortAffixAllocation() {
  if (affixAllocResult.value) affixAllocResultStale.value = true
  affixAllocAbort?.abort()
  affixAllocAbort = null
  affixAllocLoading.value = false
  affixAllocProgress.value = null
}

function markAffixAllocationStaleIfIdle() {
  if (affixAllocLoading.value) return
  if (affixAllocResult.value) affixAllocResultStale.value = true
}

function setAffixBenefitStep(step: number) {
  const next = Math.max(1, Math.min(20, Math.round(step)))
  if (next === affixBenefitStep.value) return
  affixBenefitStep.value = next
  runAffixBenefitOnly()
}

/** 词条分配模式的收益曲线数据：复用收益表的逐档曲线 */
const affixAllocCurveMode = ref<'cumulative' | 'marginal'>('cumulative')
const affixAllocCurveMaxRolls = 10
/** 曲线数据按需补算：未算过时为 null，模板据此显示「正在准备曲线」而不是空图 */
const affixAllocCurveData = computed(() => affixBenefitSeries.value)

// 折线图只在「收益曲线」子页签且已有求解结果时渲染；在那之前不必付曲线的计算成本
watch(
  [affixAllocDetailTab, affixAllocResult, affixBenefitTable],
  () => {
    if (affixAllocDetailTab.value !== 'curve') return
    if (!affixAllocResult.value) return
    ensureAffixBenefitSeries()
  },
  { immediate: true },
)

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
  if (!counts || !analysisEval.value) return null
  // 与组合试算同一口径：现场按当前主属性重算，避免扫掠快照/无 hits 面板口径错位
  const baseDmg = evaluateMainStatComboDamage(
    {
      slot4MainStat: driveDiscMainStats.value.slot4MainStat,
      slot5MainStat: driveDiscMainStats.value.slot5MainStat,
      slot6MainStat: driveDiscMainStats.value.slot6MainStat,
    },
    counts,
    currentTwoPieceId.value,
  )

  return MAIN_STAT_SLOTS.map(({ key, title, options }) => {
    const currentId = driveDiscMainStats.value[key]
    const current = options.find((o) => o.id === currentId)
    const rows = options
      .filter((o) => o.id !== currentId)
      .map((o) => {
        const nextStats: AffixDriveDiscMainStats = {
          slot4MainStat: driveDiscMainStats.value.slot4MainStat,
          slot5MainStat: driveDiscMainStats.value.slot5MainStat,
          slot6MainStat: driveDiscMainStats.value.slot6MainStat,
          [key]: o.id,
        }
        const dmg = evaluateMainStatComboDamage(nextStats, counts, currentTwoPieceId.value)
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
  if (!comboBaselineReady.value || !comboBaselineCounts.value) return []
  const counts = comboBaselineCounts.value
  const currentStats: AffixDriveDiscMainStats = {
    slot4MainStat: driveDiscMainStats.value.slot4MainStat,
    slot5MainStat: driveDiscMainStats.value.slot5MainStat,
    slot6MainStat: driveDiscMainStats.value.slot6MainStat,
  }
  const baseDamage = evaluateMainStatComboDamage(
    currentStats,
    counts,
    currentTwoPieceId.value,
  )
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
          counts,
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
  if (detailTab.value !== 'diff' || !analysisCounts.value || !sweepDamageKind.value) {
    diffAnalysis.value = null
    mainStatDiff.value = null
    showMainStatDiff.value = false
    return
  }
  diffAnalysis.value = computeDiffAnalysis(
    evalCtx.value,
    analysisCounts.value,
    sweepDamageKind.value,
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
  if (detailTab.value !== 'curve' || !analysisCounts.value || !sweepDamageKind.value) {
    benefitData.value = null
    return
  }
  benefitData.value = computeBenefitCurves(
    evalCtx.value,
    analysisCounts.value,
    sweepDamageKind.value,
    anomalyChartMetric.value,
    BENEFIT_CURVE_MAX_ADDED,
    hasEventMode.value ? selectedChartEventIds.value : null,
  )
}

function loadCombinedMainStatRankings() {
  if (
    combinedMainStatRankingsLoading.value ||
    rankingComboCount.value <= 0 ||
    !comboBaselineReady.value
  ) {
    return
  }
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
    kind: sweepDamageKind.value,
    metric: anomalyChartMetric.value,
    tab: detailTab.value,
    events: hasEventMode.value ? selectedChartEventIds.value : null,
    mains: { ...driveDiscMainStats.value },
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

/** 词条分配模式的上下文指纹：招式、主属性、队伍、面板等变化时自动重算收益表 */
const affixAllocFingerprint = computed(() =>
  JSON.stringify({
    mode: sectionMode.value,
    mains: { ...driveDiscMainStats.value },
    agents: props.teamSlots.map((s) => s.agentId ?? ''),
    hits: (props.hits ?? []).map(
      (h) =>
        `${h.id}:${h.skill.id}:${h.count}:${h.critMode}` +
        `:${h.anomalyPowerAgentId ?? ''}:${h.triggerAgentId ?? ''}:${h.anomalySubKind ?? ''}`,
    ),
    library: affixLibraryState.value,
    step: affixBenefitStep.value,
  }),
)

watch(affixAllocFingerprint, () => {
  if (sectionMode.value !== 'allocation') return
  // 上下文变了，正在跑的求解结果已经过期：中止它，避免用户对着旧结果判断
  if (affixAllocLoading.value) abortAffixAllocation()
  else markAffixAllocationStaleIfIdle()
  scheduleAffixBenefitRecompute()
})

// 求解参数变化同样让正在跑的求解过期
watch(
  [affixSearchSettings, affixAllocTotalRolls],
  () => {
    if (sectionMode.value !== 'allocation') return
    if (affixAllocLoading.value) abortAffixAllocation()
    else markAffixAllocationStaleIfIdle()
  },
)

watch(sectionMode, (mode) => {
  if (mode === 'allocation') scheduleAffixBenefitRecompute()
  showCombinedMainStatRankings.value = false
  combinedMainStatRankings.value = []
})
// 首屏 / 切回本页时先算一次收益表
watch(
  [() => hasEventMode.value, () => isSectionActive.value],
  ([hasEvents, active]) => {
    if (!hasEvents || !active) return
    if (sectionMode.value !== 'allocation') return
    scheduleAffixBenefitRecompute()
  },
  { immediate: true },
)

const combinedMainStatDraft = reactive(createDefaultAffixDriveDiscMainStats())
const combinedMainStatDraftTwoPieceId = ref('none')

function resolveMainStatLabel(
  options: readonly { id: string; label: string }[],
  id: string,
) {
  return options.find((item) => item.id === id)?.label ?? id
}

function syncCombinedMainStatDraftFromCurrent() {
  combinedMainStatDraft.slot4MainStat = driveDiscMainStats.value.slot4MainStat
  combinedMainStatDraft.slot5MainStat = driveDiscMainStats.value.slot5MainStat
  combinedMainStatDraft.slot6MainStat = driveDiscMainStats.value.slot6MainStat
  combinedMainStatDraftTwoPieceId.value = currentTwoPieceId.value
}

watch(
  () => [
    driveDiscMainStats.value.slot4MainStat,
    driveDiscMainStats.value.slot5MainStat,
    driveDiscMainStats.value.slot6MainStat,
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
  // 排行按「限定组合」里的 2 件套试算，套用时一并同步到组合试算草稿
  combinedMainStatDraftTwoPieceId.value = rankingTwoPieceId.value
}

function evaluateMainStatComboDamage(
  mainStats: AffixDriveDiscMainStats,
  counts: AffixCounts,
  twoPieceId?: string,
) {
  const ctx = evalCtx.value
  const nextTwoPieceId = twoPieceId ?? ctx.driveDiscSelection.twoPieceDriveDiscId
  /**
   * 词条分析页 + 已有导入局外：撤掉当前 4/5/6（及 2 件套）效果，再加上试算组合。
   * 不改收益表 / 求解器，也不动扫掠柱图（仍走下方「清基准重推」）。
   */
  if (sectionMode.value === 'allocation' && ctx.mainBaseExternalPanel) {
    const remapped = remapImportedPanelViaEffects({
      panel: ctx.mainBaseExternalPanel,
      fromMains: driveDiscMainStats.value,
      toMains: {
        slot4MainStat: mainStats.slot4MainStat,
        slot5MainStat: mainStats.slot5MainStat,
        slot6MainStat: mainStats.slot6MainStat,
      },
      fromTwoPieceId: currentTwoPieceId.value,
      toTwoPieceId: nextTwoPieceId,
      fourPieceDriveDiscId: ctx.driveDiscSelection.fourPieceDriveDiscId,
      driveDiscs: ctx.driveDiscs,
      agentHp: ctx.agentBase.hp,
      atkBase: ctx.agentBase.atk + ctx.wengineBaseAtk,
      agentDef: ctx.agentBase.def + (ctx.wengineBaseDef ?? 0),
      anomalyControlBase: ctx.agentBase.anomalyControl,
      energyRegenBase: ctx.agentBase.energyRegen,
    })
    const evaled = evaluateAffixCounts(
      {
        ...ctx,
        mainBaseExternalPanel: remapped,
        driveDiscMainStats: {
          ...ctx.driveDiscMainStats,
          ...mainStats,
        },
        driveDiscSelection: {
          ...ctx.driveDiscSelection,
          twoPieceDriveDiscId: nextTwoPieceId,
        },
      },
      counts,
    )
    return resolveAffixMetricDamage(evaled)
  }

  const evaled = evaluateAffixCounts(
    {
      ...ctx,
      /**
       * 扫掠 / 无导入面板：换主属性必须重新推导面板，否则主属性改了面板不变。
       */
      mainBaseExternalPanel: null,
      driveDiscMainStats: {
        ...ctx.driveDiscMainStats,
        ...mainStats,
      },
      driveDiscSelection: {
        ...ctx.driveDiscSelection,
        twoPieceDriveDiscId: nextTwoPieceId,
      },
    },
    counts,
  )
  return resolveAffixMetricDamage(evaled)
}

const combinedMainStatPreview = computed(() => {
  if (!comboBaselineReady.value || !comboBaselineCounts.value) return null
  const counts = comboBaselineCounts.value
  const currentStats: AffixDriveDiscMainStats = {
    slot4MainStat: driveDiscMainStats.value.slot4MainStat,
    slot5MainStat: driveDiscMainStats.value.slot5MainStat,
    slot6MainStat: driveDiscMainStats.value.slot6MainStat,
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
  // 基准必须与试算同一套 evaluate（含 hits）；不能用 analysisEval：
  // 异步扫掠后 evalSnapshot 常为空，会落到「无 hits」面板口径，事件模式下差值会错一个数量级
  const baseDamage = evaluateMainStatComboDamage(
    currentStats,
    counts,
    currentTwoPieceId.value,
  )
  const proposedDamage = unchanged
    ? baseDamage
    : evaluateMainStatComboDamage(
        draftStats,
        counts,
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
  if (sweepDamageKind.value === 'direct') {
    const point = directPoints.value[index]
    return point ? { outPercent: point.outPercent, secondary: point.critDmg } : null
  }
  const point = anomalyPoints.value[index]
  return point ? { outPercent: point.outPercent, secondary: point.mastery } : null
}

function findIndexForSweepKey(key: { outPercent: number; secondary: number } | null) {
  if (!key) return null
  if (sweepDamageKind.value === 'direct') {
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
  const points = sweepDamageKind.value === 'direct' ? directPoints.value : anomalyPoints.value
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
  const points = sweepDamageKind.value === 'direct' ? directPoints.value : anomalyPoints.value
  const point = points[idx]
  if (!point || point.evalSnapshot) return
  point.evalSnapshot = evaluateAffixCounts(evalCtx.value, point.affixCounts)
}

watch(
  [isMb, isFengYu],
  ([mb, fengYu], [prevMb, prevFengYu]) => {
    if (mb) {
      baseDamageSource.value = 'pierce'
    } else if (fengYu) {
      baseDamageSource.value = 'def'
    } else if (prevMb || prevFengYu) {
      // 从命破/锋御切回普通职业：必须复位，否则残留 def/pierce 会让普通角色拿错基础伤害
      baseDamageSource.value = 'atk'
    }
  },
  { immediate: true },
)

watch(sweepDamageKind, (kind) => {
  clearBarSelection()
  // 不再自动填默认暴击条数：切换伤害模式只清空柱体选中，不动用户已填的分配
  if (kind === 'anomaly') anomalyAlloc.totalRolls = 0
})

watch([directPoints, anomalyPoints, sweepDamageKind], syncSelectedBarAfterSweep)

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
  /**
   * 原 `slotPanelPreviews`（把本区结算面板灌进槽位卡片）已删除。
   *
   * 槽位卡片是「角色配置」的录入区，不该被临时分析结果覆盖（用户口径 2026-09-11）；
   * 结果面板改由招式流程区「查看面板」展示（局外 + 局内，基于三选项，见 skillFlowPanelSource.ts）。
   */
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
    activeSlotPanels: effectiveAnomalySlotPanels.value,
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
      { includeDetails: false },
    ).finalPanel
  } catch {
    return null
  }
}
</script>

<template>
  <section class="opt-section">
    <header class="opt-header">
      <h2>词条配比分析</h2>
      <p>
        两种用法二选一：「词条分析」在总词条数约束下求全词条最优配比；
        「扫掠柱图」手动指定两个维度扫掠对比。
      </p>
    </header>

    <h3 class="block-title">基础伤害来源</h3>
    <div class="grid three">
      <label class="field">
        <span>基础伤害来源</span>
        <select v-model="baseDamageSource" :disabled="isMb || isFengYu">
          <option value="atk">攻击力</option>
          <option value="def">防御力</option>
          <option value="pierce">贯穿力</option>
        </select>
        <small v-if="isMb" class="hint">命破角色固定使用贯穿力</small>
        <small v-else-if="isFengYu" class="hint">锋御角色固定使用防御力（锐化公式）</small>
      </label>
    </div>

    <div class="section-mode-row" role="tablist" aria-label="功能模式">
      <button
        type="button"
        role="tab"
        class="chip chip--mode"
        :class="{ active: sectionMode === 'allocation' }"
        :aria-selected="sectionMode === 'allocation'"
        @click="sectionMode = 'allocation'"
      >
        词条分析
      </button>
      <button
        type="button"
        role="tab"
        class="chip chip--mode"
        :class="{ active: sectionMode === 'sweep' }"
        :aria-selected="sectionMode === 'sweep'"
        @click="sectionMode = 'sweep'"
      >
        扫掠柱图
      </button>
    </div>

    <!-- ============ 词条分配模式 ============ -->
    <template v-if="sectionMode === 'allocation'">
      <template v-if="!hasEventMode">
        <p class="hint empty-hint">请先在「招式流程」配置至少一条招式，再回到此处求解最优分配。</p>
      </template>
      <template v-else>
        <h3 class="block-title">全词条收益</h3>
        <div class="benefit-step-row">
          <span class="ctl-label">收益评估档位</span>
          <button
            v-for="step in [1, 4, 6, 10]"
            :key="`step-${step}`"
            type="button"
            class="chip"
            :class="{ active: affixBenefitStep === step }"
            @click="setAffixBenefitStep(step)"
          >
            +{{ step }} 档
          </button>
          <span class="ctl-spacer" />
          <button type="button" class="ghost-btn" @click="runAffixBenefitOnly">重新计算收益</button>
        </div>
        <p class="hint">
          按「流程全部事件总伤」口径，逐条词条 +{{ affixBenefitStep }} 档评估；
          相对权重 = 本行收益率 ÷ 当前显示的最大收益率（筛选后按显示的行重算）。
        </p>
        <AffixBenefitTable
          :table="affixBenefitTable"
          :library="affixLibraryAllEntries"
          :enabled-ids="enabledAffixEntryIds"
          :groups="affixLibraryState.groups"
          :rolls-per-step="affixBenefitStep"
          :loading="affixBenefitLoading"
          @toggle-entry="toggleAffixLibraryEntry"
          @toggle-entries="toggleAffixLibraryEntries"
          @add-entry="addAffixLibraryEntry"
          @update-entry="updateAffixLibraryEntryPatch"
          @remove-entry="removeAffixLibraryEntryById"
          @restore-defaults="restoreAffixLibraryDefaultsHandler"
          @add-group="addAffixLibraryGroupHandler"
          @set-group-cap="setAffixLibraryGroupCapHandler"
          @rename-group="renameAffixLibraryGroupHandler"
          @remove-group="removeAffixLibraryGroupHandler"
          @library-switched="onAffixLibrarySwitched"
        />

        <h3 class="block-title">主属性组合试算</h3>
        <p class="hint">
          与「全词条收益 / 最优分配」同级独立模块。有面板导入时：按当前 4/5/6（及 2 件套）从局外数字反推扣减，再加回试算组合；
          请先在导入里填对当前主属性。无面板时回退为配置推导。不改动下方最优分配求解。
          <template v-if="comboUsesImportedPanel"> · 当前：已接导入面板</template>
          <template v-else> · 当前：无导入面板，走配置推导</template>
        </p>
        <template v-if="combinedMainStatPreview">
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
                  <option v-for="opt in DRIVE_DISC_SLOT_4_OPTIONS" :key="`alloc-draft-4-${opt.id}`" :value="opt.id">
                    {{ opt.label }}
                  </option>
                </select>
              </label>
              <label>
                <span class="combined-main-stat-label">5号替换为</span>
                <select v-model="combinedMainStatDraft.slot5MainStat">
                  <option v-for="opt in DRIVE_DISC_SLOT_5_OPTIONS" :key="`alloc-draft-5-${opt.id}`" :value="opt.id">
                    {{ opt.label }}
                  </option>
                </select>
              </label>
              <label>
                <span class="combined-main-stat-label">6号替换为</span>
                <select v-model="combinedMainStatDraft.slot6MainStat">
                  <option v-for="opt in DRIVE_DISC_SLOT_6_OPTIONS" :key="`alloc-draft-6-${opt.id}`" :value="opt.id">
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
                  :key="`alloc-rank-4-${opt.id}`"
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
                  :key="`alloc-rank-5-${opt.id}`"
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
                  :key="`alloc-rank-6-${opt.id}`"
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
              :disabled="combinedMainStatRankingsLoading || !comboBaselineCounts || rankingComboCount <= 0"
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
                  :key="`alloc-${row.slot4}-${row.slot5}-${row.slot6}`"
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
        <p v-else class="hint">配置招式流程后即可试算主属性组合。</p>

        <h3 class="block-title">最优分配</h3>
        <!--
          求解参数。整块**不再是 grid**：改动前每个子项（含两行说明）各占一个格子，
          第三列 `minmax(0, 1fr)` 在窄屏被挤成 0 宽，两行说明被压成 800~900px 高的竖条、
          整块高度 1755px；切「高级设置」还会触发 grid 自动排布整体重排（看起来就是"乱飘"）。
        -->
        <div class="alloc-input-row alloc-fields">
          <label class="field">
            <span>总词条数</span>
            <input v-model.lazy.number="affixAllocTotalRolls" type="number" min="1" max="60" step="1" />
          </label>
          <label class="field">
            <span>搜索预设</span>
            <select :value="affixSearchSettings.preset" @change="onAffixSearchPresetChange">
              <option v-for="presetId in SEARCH_PRESET_ORDER" :key="presetId" :value="presetId">
                {{ AFFIX_SEARCH_PRESET_LABELS[presetId] }}
              </option>
            </select>
          </label>
          <button type="button" class="ghost-btn" @click="affixSearchAdvancedOpen = true">
            高级设置
          </button>
        </div>

        <AffixSearchAdvancedModal
          :open="affixSearchAdvancedOpen"
          :params="affixSearchParams"
          @close="affixSearchAdvancedOpen = false"
          @update="setAffixSearchCustom"
        />

        <!-- 分配方式：二选一 —— 两颗独立按钮；正在跑时两颗一起变灰，行尾出现「停止」（不顶掉主按钮，避免跳动） -->
        <div class="alloc-mode-block">
          <div class="alloc-mode-row">
            <span class="alloc-mode-label">分配方式</span>
            <button
              type="button"
              class="alloc-mode-btn"
              :class="{ 'is-active': affixAllocMode === 'default' }"
              :disabled="affixAllocLoading || !affixLibraryEntries.length"
              :title="affixLibraryEntries.length ? '' : '词条库为空，请先启用至少一条词条'"
              @click="runAffixAllocation"
            >
              求最优分配
            </button>
            <button
              type="button"
              class="alloc-mode-btn"
              :class="{ 'is-active': affixAllocMode === 'game' }"
              :disabled="affixAllocLoading || !gameAffixSettings.enabledIds.length"
              :title="gameAffixSettings.enabledIds.length ? '' : '请先去「编辑」里勾选至少一条词条'"
              @click="runGameAffixAllocation"
            >
              游戏专用规则分配
            </button>
            <button
              type="button"
              class="ghost-btn alloc-mode-edit"
              :disabled="affixAllocLoading"
              title="编辑游戏专用规则分配"
              @click="gameAffixRulesOpen = true"
            >
              编辑
            </button>
            <button
              type="button"
              class="ghost-btn alloc-stop-btn"
              :class="{ 'is-reserved': !affixAllocLoading }"
              :disabled="!affixAllocLoading"
              @click="abortAffixAllocation"
            >
              停止
            </button>
          </div>
          <ul class="alloc-mode-notes">
            <li>
              <b>求最优分配</b>：自适应 Beam —— 同一预算下并行保留多条分法，再各做一轮换档兜底；不清楚规则就用预设「均衡」。
            </li>
            <li>
              <b>游戏专用规则分配</b>：模拟 4 号位主属性与副词条重复、以及 5/6 号位选到攻击/生命/防御时的总词条数损失，比左边慢。
            </li>
          </ul>
        </div>
        <p v-if="affixAllocError" class="err">{{ affixAllocError }}</p>
        <AffixAllocationResult
          :result="affixAllocResult"
          :library="affixAllocResultLibrary.length ? affixAllocResultLibrary : affixLibraryEntries"
          :loading="affixAllocLoading"
          :error="affixAllocError"
          :progress="affixAllocProgress"
          :stale="affixAllocResultStale"
        />
        <GameAffixRulesModal
          :open="gameAffixRulesOpen"
          :extra-cost="gameAffixSettings.extraCost"
          :enabled-ids="gameAffixSettings.enabledIds"
          :entries="gameAffixLibraryEntries"
          :total-rolls="affixAllocTotalRolls"
          @close="gameAffixRulesOpen = false"
          @update:extra-cost="setGameExtraCost"
          @toggle-entry="toggleGameAffixEntry"
          @toggle-entries="toggleGameAffixEntries"
        />

        <template v-if="affixAllocResult">
          <div class="detail-tabs alloc-subtabs">
            <button
              type="button"
              class="chip"
              :class="{ active: affixAllocDetailTab === 'curve' }"
              @click="affixAllocDetailTab = 'curve'"
            >
              收益曲线
            </button>
          </div>

          <template v-if="affixAllocDetailTab === 'curve'">
            <BenefitCurvePanel
              v-if="affixAllocCurveData"
              v-model:mode="affixAllocCurveMode"
              :series="affixAllocCurveData"
              :max-added="affixAllocCurveMaxRolls"
              hint="逐档真实重算；只画收益率最高的前几条词条"
            />
            <p v-else-if="affixBenefitSeriesLoading" class="hint">收益曲线计算中…（首屏只算「+1 档」表，曲线按需补算）</p>
            <p v-else class="hint">暂无收益曲线数据。</p>
          </template>
        </template>
      </template>
    </template>
    <!-- ============ 扫掠柱图模式（原逻辑） ============ -->
    <template v-else>
    <div class="kind-mode-row" role="tablist" aria-label="最优词条伤害模式">
      <span class="kind-mode-label">伤害模式</span>
      <button
        type="button"
        role="tab"
        class="chip"
        :class="{ active: sweepDamageKind === 'direct' }"
        :aria-selected="sweepDamageKind === 'direct'"
        @click="setDamageKind('direct')"
      >
        直伤
      </button>
      <button
        type="button"
        role="tab"
        class="chip"
        :class="{ active: sweepDamageKind === 'anomaly' }"
        :aria-selected="sweepDamageKind === 'anomaly'"
        @click="setDamageKind('anomaly')"
      >
        异常
      </button>
      <p v-if="!sweepDamageKind" class="hint kind-mode-hint">请先选择直伤或异常，再配置词条并开始计算。</p>
    </div>

    <template v-if="sweepDamageKind">
    <div class="alloc-layout">
      <div class="alloc-left">
        <template v-if="sweepDamageKind === 'direct'">
          <h3 class="block-title">直伤词条分配</h3>
          <p class="constraint-hint">
            <template v-if="isMb">
              总词条数 = 暴击 + 爆伤 + 局外大生命 + 局外大攻击（不含精通）；约束：总 ≤
              {{ DIRECT_CONSTRAINTS.maxTotalRolls }}，且 精通 + 攻击力 + 生命值 + 穿透 + 总 ≤
              {{ DIRECT_CONSTRAINTS.maxAtkPenTotal }}
            </template>
            <template v-else>
              总词条数 = 暴击 + 爆伤 + {{ outLabel }}（不含精通）；约束：总 ≤
              {{ DIRECT_CONSTRAINTS.maxTotalRolls }}，且 精通 + {{ flatLabel }} + 穿透 + 总 ≤
              {{ DIRECT_CONSTRAINTS.maxAtkPenTotal }}
            </template>
          </p>
          <div class="grid two">
            <label class="field">
              <span>{{ isMb ? '攻击力' : flatLabel }}</span>
              <input v-model.lazy.number="directAlloc.flatStat" type="number" min="0" step="1" />
            </label>
            <label v-if="isMb" class="field">
              <span>生命值</span>
              <input v-model.lazy.number="directAlloc.hpFlat" type="number" min="0" step="1" />
            </label>
            <label class="field">
              <span>穿透值</span>
              <input v-model.lazy.number="directAlloc.pen" type="number" min="0" step="1" />
            </label>
            <label class="field">
              <span>精通</span>
              <input v-model.lazy.number="directAlloc.mastery" type="number" min="0" step="1" />
              <small class="hint">固定填写，不计入总词条分配</small>
            </label>
            <label v-if="isMb" class="field">
              <span>局外大攻击</span>
              <input v-model.lazy.number="directAlloc.atkPercent" type="number" min="0" step="1" />
              <small class="hint">固定填写，计入总词条数</small>
            </label>
            <label class="field">
              <span>暴击</span>
              <input v-model.lazy.number="directAlloc.critRate" type="number" min="0" step="1" />
            </label>
            <label class="field">
              <span>总词条数</span>
              <input v-model.lazy.number="directAlloc.totalRolls" type="number" min="0" step="1" />
              <small class="hint">
                可分配余量 {{ remainDirect }}（{{
                  isMb ? '局外大生命+爆伤' : `${outLabel}+爆伤`
                }}）
              </small>
            </label>
          </div>
          <p v-if="directError" class="err">{{ directError }}</p>
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
              <input v-model.lazy.number="anomalyAlloc.flatStat" type="number" min="0" step="1" />
            </label>
            <label class="field">
              <span>穿透值</span>
              <input v-model.lazy.number="anomalyAlloc.pen" type="number" min="0" step="1" />
            </label>
            <label class="field">
              <span>总词条数</span>
              <input v-model.lazy.number="anomalyAlloc.totalRolls" type="number" min="0" step="1" />
            </label>
          </div>
          <p v-if="anomalyError" class="err">{{ anomalyError }}</p>
        </template>
      </div>

    </div>

    <div class="calc-commit-row">
      <button
        type="button"
        class="calc-run-btn"
        :class="{ 'is-computing': sweepComputing }"
        :disabled="sweepComputing || (sweepDamageKind === 'direct' ? Boolean(directError) : Boolean(anomalyError))"
        @click="startCalculation"
      >
        {{ sweepComputing ? '计算中…' : '开始计算' }}
      </button>
      <p v-if="sweepNeedsCommit" class="hint calc-commit-hint">
        配好后点「开始计算」。改暴击、总词条、固定条、主属性、敌人或增益后，也需再点一次。
      </p>
      <p v-else-if="sweepCommitted && !sweepComputing" class="hint calc-commit-hint calc-commit-hint--synced">
        已按当前配置计算。再改暴击、总词条或其他配置后，请再点「开始计算」。
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
        }}条数 / {{ sweepDamageKind === 'direct' ? '爆伤' : '精通' }}条数」。点击柱体查看详情。
      </template>
      <template v-else>
        X 轴标签为「{{ outLabel }}条数 / {{ sweepDamageKind === 'direct' ? '爆伤' : '精通' }}条数」。点击柱体查看详情。
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
      <template v-if="sweepDamageKind === 'direct' && directError">{{ directError }}</template>
      <template v-else-if="sweepDamageKind === 'anomaly' && anomalyError">{{ anomalyError }}</template>
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
      v-else-if="sweepDamageKind === 'direct'"
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
          <template v-if="sweepDamageKind === 'direct'">
            <template v-if="selectedDirect">
              {{ outLabel }} {{ selectedDirect.outPercent }} · 爆伤 {{ selectedDirect.critDmg }} · 暴击
              {{ directAlloc.critRate }} · 精通 {{ directAlloc.mastery }}
              <template v-if="isMb"> · 局外大攻击 {{ directAlloc.atkPercent }}</template>
            </template>
            <template v-else-if="analysisCounts">
              暴击 {{ analysisCounts.critRate }} · 爆伤 {{ analysisCounts.critDmg }} ·
              {{ outLabel }}
              {{ outPercentFromAffixCounts(analysisCounts, isMb, isFengYu) }} · 精通
              {{ analysisCounts.mastery }}
              <template v-if="isMb"> · 局外大攻击 {{ analysisCounts.atkPercent }}</template>
              <span class="hint-inline">（未点柱时按预览/首柱）</span>
            </template>
          </template>
          <template v-else-if="selectedAnomaly">
            {{ outLabel }} {{ selectedAnomaly.outPercent }} · 精通 {{ selectedAnomaly.mastery }}
          </template>
          <template v-else-if="analysisCounts">
            {{ outLabel }}
            {{ outPercentFromAffixCounts(analysisCounts, isMb, isFengYu) }} · 精通
            {{ analysisCounts.mastery }}
            <span class="hint-inline">（未点柱时按预览/首柱）</span>
          </template>
        </h3>
        <div class="detail-tabs">
          <button
            type="button"
            class="chip"
            :class="{ active: detailTab === 'diff' }"
            @click="detailTab = 'diff'"
          >
            词条差异计算
          </button>
          <button
            type="button"
            class="chip"
            :class="{ active: detailTab === 'curve' }"
            @click="detailTab = 'curve'"
          >
            收益曲线
          </button>
        </div>
        <p v-if="hasEventMode && mainStatEventScopeHint" class="hint detail-scope-hint">
          {{ mainStatEventScopeHint }}
        </p>
      </header>

      <p v-if="sweepDamageKind === 'anomaly' && !hasEventMode" class="metric-tabs">
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

      <template v-if="detailTab === 'diff' && diffAnalysis">
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

      <p v-if="detailTab === 'diff'" class="hint">词条差异计算中…若长时间无结果，请再点一次「开始计算」。</p>

      <template v-if="detailTab === 'curve' && benefitData">
        <BenefitCurvePanel
          v-model:mode="curveMode"
          :series="benefitData.series"
          :max-added="BENEFIT_CURVE_MAX_ADDED"
          :hint="`最大新增 ${BENEFIT_CURVE_MAX_ADDED} 词条`"
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

.section-mode-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
  margin: 0.75rem 0 0.5rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid #2a2f37;
}

/*
 * 区级模式切换（最优分配 / 扫掠柱图）：用户 2026-09-13「这2个按钮尺寸弄大点」。
 *
 * 它俩是「词条配比分析」整区的**主开关**，但用的是全站统一 `.chip`
 * （`assets/calculatorChip.css`），尺寸跟正文里那些 `+1 档` / `4号位（6）` 完全一样，
 * 摆在整片 chip 里看不出层级。这里只放大尺寸，颜色 / 选中态 / 圆角 / 字重一律交给
 * `.chip` 本体，昼夜两套主题照旧 —— 所以不加任何颜色声明。
 *
 * 全局那份不能动：改它等于把全站 28 个 chip 一起放大（本次只要这两颗）。
 */
.chip--mode {
  padding: 0.6rem 1.4rem;
  font-size: 1rem;
}

/*
 * 模式切换（最优分配 / 扫掠柱图）、伤害模式（直伤 / 异常）、子页签（词条差异 / 收益曲线）
 * 都直接用统一 chip：见 `assets/calculatorChip.css`。
 * 改造前它们各自写了一套（其中模式切换还是青柠色选中，且白天主题没有任何覆盖 —— 一直是黑的）。
 */

.alloc-input-row {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
  /* 竖向间距交给 .opt-section 的 flex gap —— 别再叠加 margin（那是「行距离谱」的一半原因） */
  margin: 0;
}

/*
 * 高级参数块：字段和它自己的说明贴在一起。
 * 说明原来是整块的兄弟段落（折叠时也一直显示），指代的却是收起后看不见的参数，故收进这里。
 */
.alloc-advanced {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

/*
 * 分配方式：二选一 —— 两颗独立按钮 + 一个从属的「编辑」；跑起来时两颗一起变灰、行尾出现「停止」。
 *
 * 改造前：每个子项（含两行说明）都是 `.alloc-action-grid` 的格子，第三列 `minmax(0, 1fr)`
 * 在窄屏被挤成 0 宽，说明被压成 800~900px 高的竖条、整块 1755px 高；切「高级设置」还会
 * 触发 grid 自动排布整体重排（用户反馈的"乱飘"）。现在整块是普通行式布局，只往下推。
 */
.alloc-mode-block {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.alloc-mode-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.alloc-mode-label {
  font-size: 0.8rem;
  color: #9aa3b0;
}

.alloc-mode-btn {
  border: 1px solid #333841;
  border-radius: 10px;
  background: #1a1e25;
  color: #d5dae3;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  padding: 0.5rem 1.1rem;
  min-width: 10.5rem; /* 两颗等宽 → 一眼看出是「二选一」 */
  text-align: center;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    opacity 0.15s ease;
}

.alloc-mode-btn:hover:not(:disabled) {
  border-color: #4a5260;
}

.alloc-mode-btn.is-active {
  border-color: var(--calc-run-border);
  background: var(--calc-run-bg);
  color: var(--calc-run-text);
}

.alloc-mode-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.alloc-mode-edit {
  padding: 0.4rem 0.7rem;
  font-weight: 400;
}

/* 「停止」常驻占位：不跑时只隐藏不可见，跑起来就不会把这一行挤换行（零位移） */
.alloc-stop-btn.is-reserved {
  visibility: hidden;
}

.alloc-mode-notes {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.8rem;
  line-height: 1.5;
  color: #9aa3b0;
}

.alloc-mode-notes b {
  color: #cfd5df;
  font-weight: 700;
}

.alloc-note {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.5;
  color: #9aa3b0;
}

.alloc-input-row .field-input-with-suffix {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.alloc-input-row .field-suffix {
  font-size: 0.75rem;
  color: var(--calc-muted, #6b7280);
  line-height: 1;
}

.alloc-input-row input {
  width: 7rem;
  padding: 0.3rem 0.4rem;
  border: 1px solid #2a2f37;
  border-radius: 6px;
  background: #171a1f;
  color: #e8eaed;
  font-size: 0.85rem;
}

.alloc-subtabs {
  margin-top: 0.9rem;
}

.empty-hint {
  padding: 0.75rem 0;
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
.metric-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: center;
}

/* 动作按钮（重新计算收益 / 计算敏感度 …）：保持既有观感，不并入 chip */
.ghost-btn {
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

.benefit-step-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.4rem;
}

.ctl-spacer {
  flex: 1;
}

.alloc-block {
  margin-top: 1rem;
  padding-top: 0.85rem;
  border-top: 1px dashed #2a2f37;
}

.alloc-header {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  margin-bottom: 0.5rem;
}

.alloc-header h4 {
  margin: 0;
  font-size: 0.95rem;
  color: #e8eaed;
}

.alloc-controls {
  display: flex;
  align-items: flex-end;
  gap: 0.65rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}

.alloc-controls .field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.75rem;
  color: #9aa3b0;
}

.alloc-controls input {
  width: 7rem;
  padding: 0.28rem 0.4rem;
  border: 1px solid #2a2f37;
  border-radius: 6px;
  background: #171a1f;
  color: #e8eaed;
  font-size: 0.82rem;
}
</style>
