<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  onUnmounted,
  provide,
  reactive,
  ref,
  watch,
} from 'vue'
import { storeToRefs } from 'pinia'
import InfoTip from '@/components/common/InfoTip.vue'
import BangbooPickerSection from '@/components/calculator/BangbooPickerSection.vue'
import BuffEffectPickerModal from '@/components/calculator/BuffEffectPickerModal.vue'
import EnvironmentBuffFilterBar from '@/components/calculator/EnvironmentBuffFilterBar.vue'
import DamageCalcHistorySection from '@/components/calculator/DamageCalcHistorySection.vue'
import SkillFlowSection from '@/components/calculator/SkillFlowSection.vue'
import {
  buildSkillFlowPageSignature,
  resolveSkillFlowPanelSource,
  type SkillFlowDisplayOption,
  type SkillFlowPanelOption,
  type SkillFlowPanelSourceMode,
} from '@/utils/skillFlowPanelSource'
import OptimalAffixAllocSection from '@/components/calculator/OptimalAffixAllocSection.vue'
import PanelCalcSection from '@/components/calculator/PanelCalcSection.vue'
import ExtraBuffGainModal from '@/components/calculator/ExtraBuffGainModal.vue'
import type { ExtraBuffGain } from '@/types/extraBuff'
import EnemyEnvironmentSection from '@/components/calculator/EnemyEnvironmentSection.vue'
import BuffModSourcesDisplay from '@/components/calculator/BuffModSourcesDisplay.vue'
import TeamBuilderSection from '@/components/calculator/TeamBuilderSection.vue'
import TeamSlotSwitcher from '@/components/calculator/TeamSlotSwitcher.vue'
import UnifiedPresetPicker, {
  type UnifiedPresetConfirmPayload,
} from '@/components/calculator/UnifiedPresetPicker.vue'
import type { DamageCalcSectionId } from '@/constants/damageCalcNav'
import type {
  AgentPanelSourceKind,
  AgentPanelSources,
  DamageCalcHistoryEntry,
  DamageCalcSchemePanelSnapshot,
  DamageCalcWorkingDraft,
  FlowBuffOverride,
  SchemeSlot,
} from '@/types/damageCalcHistory'
import type { PanelCalcMode, PanelStats } from '@/types/calculatorPanel'
import {
  createDefaultAffixDriveDiscMainStats,
  createDefaultExternalPanel,
  createEmptyAffixCounts,
  fillPanelStatsDefaults,
  resetSchemeExcludedPanelFields,
} from '@/types/calculatorPanel'
import type {
  AnomalyDamageSubKind,
  BangbooBuffDoc,
  BaseDamageSource,
  DamageCalcKind,
  StaggerPhase,
} from '@/types/calculator'
import {
  createDefaultSkillTalentLevels,
  fillSkillTalentLevels,
  type SkillTalentLevels,
} from '@/utils/skillTalentLevels'
import type { DefenseSeason } from '@/types/defense'
import type { PhaseData } from '@/types/history'
import { fetchCrisisAssaultPhases } from '@/api/crisisAssault'
import { fetchDefenseSeasons } from '@/api/defense'
import {
  deductionPeriodDisplay,
  fetchDeductionPhases,
  type DeductionPeriod,
} from '@/api/deduction'
import { lookupBossInfo } from '@/api/bossInfo'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import {
  createHistoryEntryId,
  findDamageCalcHistory,
  getLoadedSchemeId,
  listAllDamageCalcHistory,
  loadWorkingDraft,
  takeSchemeStoreWriteFailed,
  nameConflictType,
  saveDamageCalcHistory,
  saveWorkingDraft,
  setLoadedSchemeId,
} from '@/utils/damageCalcHistory'
import type { SkillFlowDamageRecordSlotMeta } from '@/utils/skillFlowDamageRecords'
import { getRuntimeConfigVersions } from '@/zones/schemeSource'
import {
  buildFlowBuffEffectText,
  effectRecipientNote,
  buildFlowBuffEffectTexts,
  type FlowBuffEffectTextOptions,
} from '@/utils/flowBuffTable'
import { buildDefaultBuffSelection, collectAllBuffEffects, excludeExtraGainEntries, createEmptyMultiSlotBuffSelection, getBuffEffectEnabled, isEnvironmentBuffSourceKey, mergeDefaultBuffSelectionIntoMulti, resolveBuffSelectionForSlot, setBuffEffectEnabled, slotHasPanelConvertEffect, syncTeamProfessionAutoEnabled, toTeammateView, type MultiSlotBuffSelection, type ConvertSlotPanels, type ConvertResolveInputs, type ResolvedEffectParameters, type BuffSelectionState } from '@/utils/panelBuffCalc'
import { computeExternalPanelFromTeamSlot } from '@/utils/affixPanelCalc'
import { MULTI_SLOT_BUFF_SELECTION_KEY } from '@/utils/presetBuffScope'
import {
  applySchemeEnvironmentBuffChecks,
  captureSchemeEnvironmentBuffChecks,
  type SchemeEnvironmentBuffApplyResult,
  type SchemeEnvironmentBuffChecks,
} from '@/utils/schemeEnvironmentBuff'
import {
  migrateLegacyPanelsToSources,
  panelSourceKindsWithData,
  resolveActivePanel,
  resolveActivePanelSourceKind,
  setActivePanelSource,
  writeAffixInputsIntoSource,
  writePanelSource,
} from '@/utils/agentPanelSources'
import {
  listCrisisEnvironmentBuffs,
  listDefenseEnvironmentBuffs,
  listDeductionEnvironmentBuffs,
  listDeductionEnvNodeFilterOptions,
  listDefenseEnvFrontierFilterOptions,
  parseBossFieldBossName,
  type EnvironmentBuffEntry,
} from '@/utils/environmentBuffCalc'
import type { EnvironmentBuffFilterMode } from '@/components/calculator/EnvironmentBuffFilterBar.vue'
import { planNavScroll } from '@/utils/navScrollPlan'
import { mapBossInfoToDamageEnemyInput } from '@/utils/enemyInputFromBoss'
import {
  createDefaultDamageEnemyInput,
  normalizeDamageEnemyInput,
  type DamageEnemyInput,
} from '@/utils/enemyResistance'
import { BUFF_STAT_FIELDS, buffStatFieldLabel, createEmptyBuffStatModifiers, createEmptyRefinementMods } from '@/utils/calculatorUi'
import {
  ensureSchemeSlots,
  resolveFlow,
  resolveSkillPreviews,
  buildGenericPanelSkillContext,
  schemeSlotsHaveContent,
} from '@/utils/resolvedHit'
import type { DamageCalcResult } from '@/utils/damageCalc'
import { createBuffCalculationRuntime, type SkillFlowCalculationDetail } from '@/utils/skillFlowCalculation'

export interface TeamSlot {
  agentId: string
  rank: number
  wengineId: string
  wengineRefine: number
  twoPieceDriveDiscId: string
  fourPieceDriveDiscId: string
}

const calculatorBuffStore = useCalculatorBuffStore()
const {
  agents,
  wengines,
  bangboos,
  driveDiscs,
  skillSubcategories,
  followUpSkillRules,
} = storeToRefs(calculatorBuffStore)

const teamSlots = reactive<TeamSlot[]>([
  {
    agentId: '',
    rank: 0,
    wengineId: 'none',
    wengineRefine: 1,
    twoPieceDriveDiscId: 'none',
    fourPieceDriveDiscId: 'none',
  },
  {
    agentId: '',
    rank: 0,
    wengineId: 'none',
    wengineRefine: 1,
    twoPieceDriveDiscId: 'none',
    fourPieceDriveDiscId: 'none',
  },
  {
    agentId: '',
    rank: 0,
    wengineId: 'none',
    wengineRefine: 1,
    twoPieceDriveDiscId: 'none',
    fourPieceDriveDiscId: 'none',
  },
])

const activeSlot = ref(0)
const selectedBangbooId = ref('none')
const bangbooRefine = ref(1)
/** 计算方式：恒为「最优词条分配」（2026-09-13 起常驻，无进入/退出；统一结果区常驻页面底部） */
const panelCalcMode = ref<PanelCalcMode>('optimal')
const enemyInput = ref<DamageEnemyInput>(createDefaultDamageEnemyInput())
const historyEntries = ref<DamageCalcHistoryEntry[]>(listAllDamageCalcHistory())
const activeHistoryId = ref('')
const historyMessage = ref('')
const currentSchemeName = computed(
  () => historyEntries.value.find((entry) => entry.id === activeHistoryId.value)?.name ?? '',
)

const staggerPhase = ref<StaggerPhase>('stagger')
/**
 * 每个角色的**两份局外面板**（面板导入 / 词条导入）+ 当前激活那份。
 *
 * 唯一的面板存放处：词条数、4/5/6 主属性也跟在各自的来源记录里。
 * 计算链路不直接读它 —— 读 `activeSlotPanels`（已解析的激活那份）。
 */
const slotPanels = reactive<Record<string, AgentPanelSources>>({})
/** 已解析的激活面板（每人一份）：下游只拿这一份，不接收也不查询来源 */
const activeSlotPanels = computed<Record<string, PanelStats>>(() => {
  const map: Record<string, PanelStats> = {}
  for (const [agentId, sources] of Object.entries(slotPanels)) {
    const panel = resolveActivePanel(sources)
    if (panel) map[agentId] = panel
  }
  return map
})
const convertSlotPanels = reactive<ConvertSlotPanels>({})
const skillTalentLevelsByAgent = reactive<Record<string, SkillTalentLevels>>({})
const extraGains = ref<ExtraBuffGain[]>([])
const schemeSlots = ref<SchemeSlot[]>(ensureSchemeSlots([], 3))
const hitDamages = ref<Record<string, number>>({})
const hitCalcResults = ref<Record<string, DamageCalcResult>>({})
/**
 * 招式流程「用哪份面板」（三选项）与词条分析上报的候选来源。
 *
 * 数据只活在内存（词条分析产物明确不落盘）：刷新后 ②③ 自动回到禁用并回落 ①。
 * 判定见 `utils/skillFlowPanelSource.ts`。
 */
const skillFlowPanelSource = ref<SkillFlowPanelSourceMode>('config')
const skillFlowPanelOptions = ref<
  Partial<Record<'allocation' | 'sweep', SkillFlowPanelOption | null>>
>({ allocation: null, sweep: null })
/**
 * 基础伤害来源（攻击力 / 防御力 / 贯穿力）：**页级唯一一份**，两个 section 与之双向绑定。
 *
 * 原先两侧各存一份、可各选各的；招式流程三选项要求「同一份配置只对应一份面板」，
 * 因此收到页级 —— 顺带让页级签名能覆盖它（见 `buildSkillFlowPageSignature`）。
 */
const baseDamageSource = ref<BaseDamageSource>('atk')

const resolvedFlow = computed(() =>
  resolveFlow({
    slots: schemeSlots.value,
    teamSlots,
    findSkill: (id) => calculatorBuffStore.findSkill(id),
    findSkillGroup: (id) => calculatorBuffStore.findSkillGroup(id),
    skillSubcategories: skillSubcategories.value,
    skillTalentLevelsByAgent,
    resolveAgentProfession: (id) =>
      agents.value.find((agent) => agent.id === id)?.profession,
  }),
)

/** 槽位影画变更时，技能等级跟随新影画档位上限（升档自动补高；语义见 dev-docs/skill-talent-level-rank-sync.md）。
 * 导入确认也会改 slot.rank（applyUnifiedImport），那一路的等级由 payload 显式写入，
 * 用 importRankGuard 跳过 watch，避免把用户刚确认的等级覆盖成上限。 */
let importRankGuard = false
watch(
  () => teamSlots.map((slot) => `${slot.agentId}:${slot.rank}`).join('|'),
  () => {
    if (importRankGuard) return
    for (const slot of teamSlots) {
      if (!slot.agentId) continue
      skillTalentLevelsByAgent[slot.agentId] = createDefaultSkillTalentLevels(slot.rank)
    }
  },
)
const hits = computed(() => resolvedFlow.value.hits)

const previewHits = computed(() =>
  resolveSkillPreviews({
    slots: schemeSlots.value,
    teamSlots,
    findSkill: (id) => calculatorBuffStore.findSkill(id),
    findSkillGroup: (id) => calculatorBuffStore.findSkillGroup(id),
    skillSubcategories: skillSubcategories.value,
    skillTalentLevelsByAgent,
    resolveAgentProfession: (id) =>
      agents.value.find((agent) => agent.id === id)?.profession,
  }),
)
const firstHit = computed(() => hits.value[0] ?? null)

const anomalySubKind = computed<AnomalyDamageSubKind>(
  () => firstHit.value?.anomalySubKind ?? 'attributeAnomaly',
)
/** 页级回落：第一击的异常强度提供者（非触发者）；逐 hit 请用 hit 字段 */
const triggerAnomalyAgentId = computed(() => firstHit.value?.anomalyPowerAgentId ?? null)
const damageKind = computed<DamageCalcKind>(() => firstHit.value?.damageKind ?? 'direct')
const skillCategoryId = computed(() => firstHit.value?.coords[0]?.category ?? 'basic')
const skillSubcategoryId = computed(() => firstHit.value?.coords[0]?.subcategoryId ?? null)

const buffPickerOpen = ref(false)
const extraBuffModalOpen = ref(false)
const teamPresetPickerOpen = ref(false)
const buffPickerViewSlotIndex = ref(0)
const multiSlotBuffSelection = reactive<MultiSlotBuffSelection>(createEmptyMultiSlotBuffSelection())
// 导入弹窗的「高级设置」直接用这一份勾选（勾选即时生效，与局内 Buff 选择器同源）
provide(MULTI_SLOT_BUFF_SELECTION_KEY, multiSlotBuffSelection)

const envBuffMode = ref<EnvironmentBuffFilterMode>('none')
const envBuffVersion = ref('')
const envBuffPhaseId = ref('')
const envBuffFrontierId = ref('')
const envBuffNodeId = ref('')
/** 方案加载时环境恢复的提示（期数不可用 / 勾选按名称重建） */
const envSchemeNotice = ref('')
const crisisPhases = ref<PhaseData[]>([])
const defenseSeasons = ref<DefenseSeason[]>([])
const deductionPeriods = ref<DeductionPeriod[]>([])
const envBuffLoadError = ref('')
let syncingBossFieldBuff = false
let syncingEnemyFromEnv = false
let draftHydrated = false
/** 恢复草稿/方案期间跳过 Buff 默认同步与场地 Buff 反写怪物 */
let restoringWorkingState = false
let draftSaveTimer: ReturnType<typeof setTimeout> | null = null
/** 草稿保存异常提示（写失败 / 被别的标签页抢先）—— 绝不静默丢数据 */
const draftSaveWarning = ref('')
const prevEnabledBossFieldKeys = ref<string[]>([])
const prevEnabledDefenseKeys = ref<string[]>([])
/** 临界节点 Buff（deduction-buff-*）单选：记录上一轮已勾选 sourceKey */
const prevEnabledDeductionNodeKeys = ref<string[]>([])

function compareVersionDesc(a: string, b: string) {
  const parse = (value: string) =>
    value.split('.').map((part) => Number(part.replace(/\D/g, '')) || 0)
  const left = parse(a)
  const right = parse(b)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (right[i] ?? 0) - (left[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function sortPhaseOptionsDesc<T extends { version?: string; phase?: string; isHidden?: boolean }>(
  options: T[],
) {
  return options.slice().sort((a, b) => {
    const versionDiff = compareVersionDesc(a.version || '', b.version || '')
    if (versionDiff !== 0) return versionDiff
    return Number(b.phase || 0) - Number(a.phase || 0)
  })
}

function pickLatestPublicOptionId<T extends { id: string; isHidden?: boolean }>(options: T[]) {
  const publicOpt = options.find((opt) => !opt.isHidden)
  return publicOpt?.id ?? options[0]?.id ?? ''
}

function findFifthFrontierId(frontiers: { id: string; title: string }[]) {
  const byTitle = frontiers.find((frontier) => /第五防线/.test(frontier.title))
  if (byTitle) return byTitle.id
  const byId = frontiers.find((frontier) => frontier.id.endsWith('05'))
  return byId?.id ?? frontiers[0]?.id ?? ''
}

const crisisPhaseOptions = computed(() =>
  sortPhaseOptionsDesc(
    crisisPhases.value.map((phase) => {
      const phaseNum = phase.phase.replace(/\D/g, '') || phase.phase
      return {
        id: phase.id,
        label: `${phase.version} 第${phaseNum}期`,
        version: phase.version,
        phase: phaseNum,
        isHidden: Boolean(phase.isHidden),
      }
    }),
  ),
)

const defensePhaseOptions = computed(() =>
  sortPhaseOptionsDesc(
    defenseSeasons.value.map((season) => {
      const phaseNum = season.phase.replace(/\D/g, '') || season.phase
      return {
        id: season.seasonId,
        label: `${season.version} 第${phaseNum}期`,
        version: season.version,
        phase: phaseNum,
        isHidden: Boolean(season.isHidden),
      }
    }),
  ),
)

const deductionPhaseOptions = computed(() =>
  sortPhaseOptionsDesc(
    deductionPeriods.value.map((period) => {
      const pid = period.periodId
      const versionKey =
        pid.length >= 3 ? pid.slice(0, pid.length - 2) : pid
      const phaseNum =
        pid.length >= 2 ? pid.slice(-2) : period.phase.replace(/\D/g, '') || period.phase
      return {
        id: pid,
        label: deductionPeriodDisplay(period),
        version: versionKey,
        phase: phaseNum,
        isHidden: false,
      }
    }),
  ),
)

const deductionNodeOptions = computed(() =>
  listDeductionEnvNodeFilterOptions(selectedDeductionPeriod.value),
)

const envPhaseOptions = computed(() => {
  if (envBuffMode.value === 'crisis') return crisisPhaseOptions.value
  if (envBuffMode.value === 'defense') return defensePhaseOptions.value
  if (envBuffMode.value === 'deduction') return deductionPhaseOptions.value
  return []
})

function pickLatestEnvPhaseId(mode: EnvironmentBuffFilterMode) {
  if (mode === 'crisis') return pickLatestPublicOptionId(crisisPhaseOptions.value)
  if (mode === 'defense') return pickLatestPublicOptionId(defensePhaseOptions.value)
  if (mode === 'deduction') return pickLatestPublicOptionId(deductionPhaseOptions.value)
  return ''
}

function applyDefaultDefenseFrontier() {
  const season = selectedDefenseSeason.value
  if (!season) {
    envBuffFrontierId.value = ''
    return
  }
  const preferred = findFifthFrontierId(season.frontiers)
  const options = listDefenseEnvFrontierFilterOptions(season)
  if (preferred && options.some((opt) => opt.id === preferred)) {
    envBuffFrontierId.value = preferred
    return
  }
  envBuffFrontierId.value = options[0]?.id ?? ''
}

function applyDefaultDeductionNode() {
  const options = deductionNodeOptions.value
  if (!options.length) {
    envBuffNodeId.value = ''
    return
  }
  envBuffNodeId.value = options[0]?.id ?? ''
}

const selectedCrisisPhase = computed(
  () => crisisPhases.value.find((phase) => phase.id === envBuffPhaseId.value) ?? null,
)

const selectedDefenseSeason = computed(
  () => defenseSeasons.value.find((season) => season.seasonId === envBuffPhaseId.value) ?? null,
)

const selectedDeductionPeriod = computed(
  () => deductionPeriods.value.find((period) => period.periodId === envBuffPhaseId.value) ?? null,
)

const defenseFrontierOptions = computed(() =>
  listDefenseEnvFrontierFilterOptions(selectedDefenseSeason.value),
)

const activeEnvironmentBuffs = computed<EnvironmentBuffEntry[]>(() => {  if (envBuffMode.value === 'none' || !envBuffPhaseId.value) return []
  if (envBuffMode.value === 'crisis') {
    const phase = selectedCrisisPhase.value
    if (!phase) return []
    return listCrisisEnvironmentBuffs(phase)
  }
  if (envBuffMode.value === 'deduction') {
    const period = selectedDeductionPeriod.value
    if (!period) return []
    return listDeductionEnvironmentBuffs(period, {
      nodeId: envBuffNodeId.value || undefined,
    })
  }
  if (!envBuffFrontierId.value) return []
  const season = selectedDefenseSeason.value
  if (!season) return []
  // 选中防线后展示该防线全部房间 Buff
  return listDefenseEnvironmentBuffs(season, {
    frontierId: envBuffFrontierId.value,
  })
})

const envBuffForceGroups = computed(() => {
  if (envBuffMode.value === 'crisis') return ['危局 Buff', 'Boss 场地 Buff']
  if (envBuffMode.value === 'defense') return ['防线 Buff']
  if (envBuffMode.value === 'deduction') return ['临界 Buff', 'Boss 场地 Buff']
  return []
})

/**
 * 页级上下文签名：判断词条分析上报的那份面板是否还能代表「当前配置」。
 *
 * 逐字段从**响应式来源**读（读取即收集依赖，配置一变签名就变）——
 * 不能从深解包后的计算上下文取，那样读不建立依赖，会命中过期结果（实测踩过）。
 */
const skillFlowPageSignature = computed(() =>
  buildSkillFlowPageSignature({
    teamSlots,
    slotPanels,
    activeSlotPanels: activeSlotPanels.value,
    convertSlotPanels,
    mainSlotIndex: activeSlot.value,
    selectedBangbooId: selectedBangbooId.value,
    bangbooRefine: bangbooRefine.value,
    slotBuffSelections: multiSlotBuffSelection,
    environmentBuffIds: activeEnvironmentBuffs.value.map((item) => item.id),
    extraGains: extraGains.value,
    enemyInput: enemyInput.value,
    staggerPhase: staggerPhase.value,
    damageKind: damageKind.value,
    anomalySubKind: anomalySubKind.value,
    skillCategoryId: skillCategoryId.value,
    skillSubcategoryId: skillSubcategoryId.value,
    triggerAnomalyAgentId: triggerAnomalyAgentId.value,
    baseDamageSource: baseDamageSource.value,
    skillTalentLevelsByAgent,
    agentElements: agents.value.map(agent => [agent.id, agent.element]),
    hits: hits.value,
  }),
)

/** 当前选择解析出的当前编辑角色局外面板覆盖值（null = 用角色配置面板） */
/**
 * 面板展示专用通道（与流程计算用的 `skillFlowPanelOptions` 分开）：
 * 词条分析侧上报的 ②③ 局外 + 局内面板，招式流程区「查看面板」展示用。
 */
const displayPanelSources = ref<
  Partial<Record<'allocation' | 'sweep', SkillFlowDisplayOption | null>>
>({})

/** 招式流程区「查看面板」（config 选项）展示用的顶部同源预览：当前编辑槽位的局外 + 局内 + 生效来源 */
const configPanelPreviewForSkillFlow = computed(() => {
  const previews = stickySlotPanelPreviews.value
  const preview = previews[activeSlot.value]
  if (!preview || !preview.external) return null
  return {
    external: preview.external,
    final: preview.final ?? null,
    sourceKind: slotPanelSourceKinds.value[activeSlot.value] ?? null,
  }
})

const skillFlowPanelResolved = computed(() =>
  resolveSkillFlowPanelSource({
    mode: skillFlowPanelSource.value,
    options: skillFlowPanelOptions.value,
    currentSignature: skillFlowPageSignature.value,
  }),
)

const skillFlowMainExternalOverride = computed(() => skillFlowPanelResolved.value.mainExternal)
const skillFlowSourceExtraGains = computed(
  () => skillFlowPanelResolved.value.extraGains ?? null,
)

const skillFlowPanelAvailability = computed(() => {
  const signature = skillFlowPageSignature.value
  const reasonFor = (option: SkillFlowPanelOption | null | undefined) => {
    if (!option) return '尚未计算：先在「词条配比分析」里算一次'
    if (option.signature !== signature) return '配置已改动，请重新计算词条分析'
    return null
  }
  const allocationReason = reasonFor(skillFlowPanelOptions.value.allocation)
  const sweepReason = reasonFor(skillFlowPanelOptions.value.sweep)
  return {
    config: { enabled: true, reason: null },
    allocation: {
      enabled: allocationReason == null,
      reason:
        allocationReason ??
        '尚未计算：先在「词条配比分析」里求解',
      detail: skillFlowPanelOptions.value.allocation?.label ?? null,
    },
    sweep: {
      enabled: sweepReason == null,
      reason:
        sweepReason ??
        '尚未计算：先在「词条配比分析 · 扫掠柱图」里算一次并点选一根柱',
      detail: skillFlowPanelOptions.value.sweep?.label ?? null,
    },
    /** 选中项失效的提示（已在用 ① 的面板） */
    notice: skillFlowPanelResolved.value.active ? null : skillFlowPanelResolved.value.reason,
  }
})

const envBuffFilterHint = computed(() => {
  if (envBuffLoadError.value) return envBuffLoadError.value
  if (envSchemeNotice.value) return envSchemeNotice.value
  if (envBuffMode.value === 'none') {
    return '默认不显示危局 / Boss 场地 / 防线 / 临界 Buff。选择模式后出现对应分组。'
  }
  if (!envBuffPhaseId.value) {
    return envBuffMode.value === 'deduction'
      ? '请选择期数（默认最新一期）。'
      : '请选择版本与期数（默认已公开最新一期）。'
  }
  if (envBuffMode.value === 'crisis') {
    const list = activeEnvironmentBuffs.value
    const crisisCount = list.filter((item) => item.kind === 'crisis').length
    const bossCount = list.filter((item) => item.kind === 'boss-field').length
    return `危局 Buff ${crisisCount} 条 · Boss 场地 Buff ${bossCount} 条（默认不勾选；勾选 Boss 场地会联动敌方）。`
  }
  if (envBuffMode.value === 'deduction') {
    const list = activeEnvironmentBuffs.value
    const nodeCount = list.filter((item) => item.kind === 'deduction-node').length
    const fieldCount = list.filter((item) => item.kind === 'deduction-field').length
    const nodeHint = envBuffNodeId.value
      ? deductionNodeOptions.value.find((opt) => opt.id === envBuffNodeId.value)?.label ?? ''
      : '全部战斗节点'
    return `节点：${nodeHint} · 临界 Buff ${nodeCount} 条 · Boss 场地 Buff ${fieldCount} 条（仅含已录入结构化效果；默认不勾选；临界 / Boss 场地均为单选）。`
  }
  if (!envBuffFrontierId.value) return '请选择防线后显示该防线全部房间 Buff。'
  const count = activeEnvironmentBuffs.value.length
  return count
    ? `已加载该防线 ${count} 条 Buff（全部房间）。勾选时展示对应房间 Boss，并同步到敌方与环境。`
    : '该防线暂无已录入结构化效果的 Buff。'
})

async function loadEnvironmentBuffCatalogs() {
  envBuffLoadError.value = ''
  const errors: string[] = []

  const crisisResult = await Promise.allSettled([fetchCrisisAssaultPhases()])
  if (crisisResult[0]?.status === 'fulfilled') {
    crisisPhases.value = crisisResult[0].value
  } else {
    crisisPhases.value = []
    const reason = crisisResult[0]?.reason
    errors.push(
      `危局：${reason instanceof Error ? reason.message : '加载失败'}`,
    )
  }

  const defenseResult = await Promise.allSettled([
    fetchDefenseSeasons('new'),
    fetchDefenseSeasons('old'),
  ])
  const defenseLoaded: import('@/types/defense').DefenseSeason[] = []
  if (defenseResult[0]?.status === 'fulfilled') {
    defenseLoaded.push(...defenseResult[0].value)
  } else {
    const reason = defenseResult[0]?.reason
    errors.push(
      `防卫(新)：${reason instanceof Error ? reason.message : '加载失败'}`,
    )
  }
  if (defenseResult[1]?.status === 'fulfilled') {
    defenseLoaded.push(...defenseResult[1].value)
  } else {
    const reason = defenseResult[1]?.reason
    errors.push(
      `防卫(旧)：${reason instanceof Error ? reason.message : '加载失败'}`,
    )
  }
  defenseSeasons.value = defenseLoaded

  const deductionResult = await Promise.allSettled([fetchDeductionPhases()])
  if (deductionResult[0]?.status === 'fulfilled') {
    deductionPeriods.value = deductionResult[0].value
  } else {
    deductionPeriods.value = []
    const reason = deductionResult[0]?.reason
    errors.push(
      `临界：${reason instanceof Error ? reason.message : '加载失败'}`,
    )
  }

  if (
    errors.length &&
    !crisisPhases.value.length &&
    !defenseSeasons.value.length &&
    !deductionPeriods.value.length
  ) {
    envBuffLoadError.value = errors.join('；')
  } else if (errors.length) {
    envBuffLoadError.value = `部分数据加载失败：${errors.join('；')}`
  }

  if (envBuffMode.value !== 'none' && !envBuffPhaseId.value) {
    envBuffPhaseId.value = pickLatestEnvPhaseId(envBuffMode.value)
    if (envBuffMode.value === 'defense') applyDefaultDefenseFrontier()
    if (envBuffMode.value === 'deduction') applyDefaultDeductionNode()
  }
}

watch(envBuffMode, (mode) => {
  if (restoringWorkingState) return
  envSchemeNotice.value = ''
  clearEnvironmentBuffSelections()
  envBuffFrontierId.value = ''
  envBuffNodeId.value = ''
  if (mode === 'none') {
    envBuffVersion.value = ''
    envBuffPhaseId.value = ''
    return
  }
  envBuffPhaseId.value = pickLatestEnvPhaseId(mode)
  if (mode === 'defense') applyDefaultDefenseFrontier()
  if (mode === 'deduction') applyDefaultDeductionNode()
})

watch(envBuffPhaseId, () => {
  if (restoringWorkingState) return
  envSchemeNotice.value = ''
  clearEnvironmentBuffSelections()
  if (envBuffMode.value === 'defense') applyDefaultDefenseFrontier()
  if (envBuffMode.value === 'deduction') applyDefaultDeductionNode()
})

watch(envBuffNodeId, () => {
  if (restoringWorkingState) return
  envSchemeNotice.value = ''
  // 临界换节点：上一节点勾选的局内环境 Buff 清空
  clearEnvironmentBuffSelections()
})

watch(envBuffFrontierId, () => {
  if (restoringWorkingState) return
  envSchemeNotice.value = ''
  clearEnvironmentBuffSelections()
})

watch(defenseFrontierOptions, (options) => {
  if (restoringWorkingState) return
  // 目录还没加载完（options 为空）时**不能清**：否则已存的环境筛选会被加载时序清成空串。
  if (!options.length) return
  if (!envBuffFrontierId.value) return
  if (!options.some((opt) => opt.id === envBuffFrontierId.value)) {
    envBuffFrontierId.value = options[0]?.id ?? ''
  }
})

watch(buffPickerOpen, (open) => {
  if (!open) return
  if (crisisPhases.value.length || defenseSeasons.value.length || deductionPeriods.value.length) {
    if (envBuffMode.value !== 'none' && !envBuffPhaseId.value) {
      envBuffPhaseId.value = pickLatestEnvPhaseId(envBuffMode.value)
      if (envBuffMode.value === 'defense') applyDefaultDefenseFrontier()
      if (envBuffMode.value === 'deduction') applyDefaultDeductionNode()
    }
    return
  }
  void loadEnvironmentBuffCatalogs()
})

function onPageHide() {
  persistWorkingDraftNow()
}

onMounted(() => {
  void loadEnvironmentBuffCatalogs()
  // Teleport defer 可能比本组件 onMounted 更晚挂上招式流程；晚一拍再恢复，避免子组件把空 slots 写回。
  void nextTick(() => {
    restoreWorkingState()
  })
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onDraftVisibilityChange)
})

onDeactivated(() => {
  persistWorkingDraftNow()
})

// 卸载**前**抓快照：Vue 在父组件 beforeUnmount 之后才拆子树（模板 ref 那时才被清空），
// 所以这一次落盘拿得到完整、最新的面板状态；等到 onUnmounted 再抓，子组件已拆、只能沿用旧快照。
onBeforeUnmount(() => {
  persistWorkingDraftNow()
})

onUnmounted(() => {
  window.removeEventListener('pagehide', onPageHide)
  document.removeEventListener('visibilitychange', onDraftVisibilityChange)
  if (draftSaveTimer) clearTimeout(draftSaveTimer)
  topAreaObserver?.disconnect()
  topAreaObserver = null
})

function disableCollectedEffects(
  effects: ReturnType<typeof collectAllBuffEffects>,
  predicate: (item: (typeof effects)[number]) => boolean,
) {
  for (const item of effects) {
    if (!predicate(item)) continue
    setBuffEffectEnabled(
      multiSlotBuffSelection,
      buffPickerViewSlotIndex.value,
      item.effect.id,
      item.effect.applyTarget,
      false,
      { manual: false },
    )
  }
}

/** 切换模式 / 期数 / 节点 / 防线时清空已勾环境 Buff（含全队 store 残留） */
function clearEnvironmentBuffSelections() {
  const clearStore = (store: BuffSelectionState | undefined) => {
    if (!store) return
    for (const id of Object.keys(store.enabledIds)) {
      if (!isEnvironmentBuffSourceKey(id)) continue
      delete store.enabledIds[id]
    }
    for (const id of Object.keys(store.stacksByEffectId)) {
      if (!isEnvironmentBuffSourceKey(id)) continue
      delete store.stacksByEffectId[id]
    }
    for (const id of Object.keys(store.convertInputs)) {
      if (!isEnvironmentBuffSourceKey(id)) continue
      delete store.convertInputs[id]
    }
    if (store.manualTouchedIds) {
      for (const id of Object.keys(store.manualTouchedIds)) {
        if (!isEnvironmentBuffSourceKey(id)) continue
        delete store.manualTouchedIds[id]
      }
    }
  }
  clearStore(multiSlotBuffSelection.team)
  for (const store of Object.values(multiSlotBuffSelection.bySlot)) {
    clearStore(store)
  }
  prevEnabledBossFieldKeys.value = []
  prevEnabledDefenseKeys.value = []
  prevEnabledDeductionNodeKeys.value = []
  // 立刻写入环境 Buff 默认「未勾选」，避免缺省回退 enabledDefault 造成全选观感
  for (const opt of buffPickerSlotOptions.value) {
    syncBuffDefaultsForSlot(opt.index)
  }
}

async function applyEnemyBossByName(bossName: string, meta?: { version?: string; phase?: string }) {
  const name = bossName.trim()
  if (!name || syncingEnemyFromEnv) return
  syncingEnemyFromEnv = true
  try {
    const info = await lookupBossInfo(name)
    if (!info) return
    const next = mapBossInfoToDamageEnemyInput(info, enemyInput.value)
    if (meta?.version && meta?.phase) {
      next.bossRecordLabel = `${meta.version} 第${meta.phase}期 · ${name}`
    }
    Object.assign(enemyInput.value, normalizeDamageEnemyInput(next))
  } finally {
    // pre-flush 的 bossName watch 在本函数返回后才跑；须拖到 nextTick 再清标志，避免刚勾选的场地 Buff 被清掉
    await nextTick()
    syncingEnemyFromEnv = false
  }
}

const emptyBangboo: BangbooBuffDoc = {
  id: 'none',
  name: '未选择',
  avatar_image: null,
  effects: [],
  refinementEffects: createEmptyRefinementMods().map(() => []),
  fixedMods: createEmptyBuffStatModifiers(),
  refinementMods: createEmptyRefinementMods(),
}

const skillFlowTeleportTo = computed(() =>
  panelCalcMode.value === 'optimal' ? '#skill-flow-anchor-optimal' : '#skill-flow-anchor-panel',
)

const panelCalcSectionRef = ref<InstanceType<typeof PanelCalcSection> | null>(null)
const optimalAffixSectionRef = ref<InstanceType<typeof OptimalAffixAllocSection> | null>(null)

/** 详情由当前计算模块提供，沿用流程数字的上下文与面板来源。 */
function resolveFlowCalculationDetail(hitId: string): SkillFlowCalculationDetail | null {
  const hit = hits.value.find(item => item.id === hitId)
  return hit ? flowCalculationRuntime.value.getHitDetail(hit) : null
}

/** 伤害记录用：每槽位的影画 / 音擎 / 驱动盘摘要（与顶栏槽位卡同口径，分项存储） */
const recordSlotMeta = computed<SkillFlowDamageRecordSlotMeta[]>(() =>
  teamSlots.map((slot) => {
    if (!slot.agentId) return {}
    const wengine = wengines.value.find((item) => item.id === slot.wengineId)
    const four = driveDiscs.value.find((item) => item.id === slot.fourPieceDriveDiscId)
    const two = driveDiscs.value.find((item) => item.id === slot.twoPieceDriveDiscId)
    return {
      rank: slot.rank,
      wengine: wengine?.name,
      wengineRefine: wengine ? slot.wengineRefine : undefined,
      disc4: four?.name,
      disc2: two?.name,
    }
  }),
)

const buffSelectionSignature = computed(() => JSON.stringify(multiSlotBuffSelection))
const combatBuffBreakdown = computed(() => {
  void extraGains.value
  void buffSelectionSignature.value
  void teamSlots.map((s) => s.agentId)
  void selectedBangbooId.value
  void bangbooRefine.value
  void hits.value.length
  void staggerPhase.value
  if (panelCalcMode.value === 'optimal') {
    return optimalAffixSectionRef.value?.buffBreakdown ?? null
  }
  return panelCalcSectionRef.value?.panelBreakdown ?? null
})

const activeSlotData = computed(() => teamSlots[activeSlot.value]!)
const activeAgent = computed(() =>
  agents.value.find((item) => item.id === activeSlotData.value.agentId),
)

const mainSlotIndex = computed(() => {
  const index = activeSlot.value
  return index >= 0 && index < teamSlots.length ? index : 0
})

const selectedBangboo = computed(
  () =>
    bangboos.value.find((item) => item.id === selectedBangbooId.value) ??
    bangboos.value.find((item) => item.id === 'none') ??
    emptyBangboo,
)

/** 全局配置与实际流程由页级明确选择用途；候选面板与随附增益成对捕获。 */
const calculationContextInput = computed(() => ({
  isMb: activeAgent.value?.profession === '命破', isFengYu: activeAgent.value?.profession === '锋御',
  teamSlots, agents: agents.value, wengines: wengines.value, driveDiscs: driveDiscs.value,
  bangboo: selectedBangboo.value, bangbooRefine: bangbooRefine.value, mainSlotIndex: mainSlotIndex.value,
  driveDiscMainStats: { ...createDefaultAffixDriveDiscMainStats(), ...slotPanels[activeSlotData.value.agentId]?.affixDriveDiscMainStats },
  enemyInput: enemyInput.value,
  baseDamageSource: activeAgent.value?.profession === '命破' ? 'pierce' as const : activeAgent.value?.profession === '锋御' ? 'def' as const : baseDamageSource.value,
  extraGains: extraGains.value, slotBuffSelections: multiSlotBuffSelection,
  buffSelection: resolveBuffSelectionForSlot(multiSlotBuffSelection, mainSlotIndex.value),
  activeSlotPanels: activeSlotPanels.value, convertSlotPanels, skillTalentLevelsByAgent,
  hits: hits.value, triggerAnomalyAgentId: triggerAnomalyAgentId.value,
  resolveSubcategory: ((items) => (id: string | null) => items.find(item => item.id === id) ?? null)(skillSubcategories.value),
  skillSubcategories: skillSubcategories.value, followUpSkillRules: followUpSkillRules.value,
  environmentBuffs: activeEnvironmentBuffs.value,
}))
const configurationCalculationRuntime = computed(() => createBuffCalculationRuntime({
  contextInput: calculationContextInput.value, externalPanelPolicy: 'configured', mainExternal: null,
  sourceExtraGains: [], staggerPhase: staggerPhase.value, globalDamageKind: damageKind.value,
}))
const flowCalculationRuntime = computed(() => createBuffCalculationRuntime({
  contextInput: calculationContextInput.value, externalPanelPolicy: 'configured',
  mainExternal: skillFlowPanelResolved.value.mainExternal,
  sourceExtraGains: skillFlowPanelResolved.value.extraGains ?? [],
  staggerPhase: staggerPhase.value, globalDamageKind: damageKind.value,
}))

/** 队伍/音擎/驱动盘/邦布配置签名：变化时补默认 Buff，不整表清空勾选 */
const teamBuffSignature = computed(() =>
  JSON.stringify({
    slots: teamSlots.map((slot) => ({
      agentId: slot.agentId,
      rank: slot.rank,
      wengineId: slot.wengineId,
      wengineRefine: slot.wengineRefine,
      twoPieceDriveDiscId: slot.twoPieceDriveDiscId,
      fourPieceDriveDiscId: slot.fourPieceDriveDiscId,
    })),
    bangbooId: selectedBangbooId.value,
    bangbooRefine: bangbooRefine.value,
  }),
)

/** 异放/乱流/紊乱有产生角色时，增益属性过滤跟随该角色属性；否则跟当前编辑槽位 */
const damageElement = computed(() => {
  const needsTrigger =
    damageKind.value === 'anomaly' &&
    (anomalySubKind.value === 'disorder' ||
      anomalySubKind.value === 'turbulence' ||
      anomalySubKind.value === 'anomalyRelease')
  if (needsTrigger && triggerAnomalyAgentId.value) {
    const trigger = agents.value.find((item) => item.id === triggerAnomalyAgentId.value)
    if (trigger?.element) return trigger.element
  }
  return activeAgent.value?.element
})

const buffPickerSlotOptions = computed(() => {
  const options: { index: number; label: string }[] = []
  teamSlots.forEach((slot, index) => {
    if (!slot.agentId) return
    const agent = agents.value.find((item) => item.id === slot.agentId)
    if (!agent) return
    options.push({
      index,
      label: `${agent.name} · ${agent.element}`,
    })
  })
  return options
})

function buildBuffCollectContext(mainSlotIdx: number) {
  const agent = agents.value.find((item) => item.id === teamSlots[mainSlotIdx]?.agentId)
  return {
    teamSlots,
    agents: agents.value,
    wengines: wengines.value,
    bangboo: selectedBangboo.value,
    bangbooRefine: bangbooRefine.value,
    mainSlotIndex: mainSlotIdx,
    driveDiscs: driveDiscs.value,
    // 额外 Buff：勾选器用不到（它单独收集），但流程增益表 / 行级例外弹窗要用
    extraGains: extraGains.value,
    environmentBuffs: activeEnvironmentBuffs.value,
    skillContext: buildGenericPanelSkillContext({
      element: agent?.element ?? damageElement.value,
      staggerPhase: staggerPhase.value,
    }),
  }
}

const buffPickerCollectContext = computed(() =>
  buildBuffCollectContext(buffPickerViewSlotIndex.value),
)

const collectedEffectsForPicker = computed(() =>
  excludeExtraGainEntries(collectAllBuffEffects(buffPickerCollectContext.value)),
)

/** 每个槽位当主槽时收到的效果（流程增益表并集用；3 个槽位，代价可控） */
const buffEffectsByMainSlot = computed(() =>
  teamSlots.map((_, index) => collectAllBuffEffects(buildBuffCollectContext(index))),
)

/** 编辑中槽位的流程涉及哪些角色：持有者 + 强度提供者 + 触发者 */
const flowInvolvedSlotIndexes = computed(() => {
  const indexOfAgent = (agentId?: string | null) =>
    agentId ? teamSlots.findIndex((slot) => slot.agentId === agentId) : -1
  const slots = new Set<number>([activeSlot.value])
  for (const hit of hits.value) {
    if (indexOfAgent(hit.ownerAgentId) !== activeSlot.value) continue
    for (const agentId of [hit.anomalyPowerAgentId, hit.triggerAgentId]) {
      const index = indexOfAgent(agentId)
      if (index >= 0) slots.add(index)
    }
  }
  return slots
})

/**
 * 流程增益表 / 行级例外弹窗的输入 = 「所有人的 team 增益 + 参与角色的 self 增益」并集 + 额外 Buff。
 *
 * 定稿口径（dev-docs/skill-buff-per-row.md 第十一轮）：**受益者维度** —— 不参与的角色，
 * 其个人增益列**不出现**。所以对每个参与角色各收集一次、按 `effect.id` 去重合并。
 * 额外 Buff 单独收集、不进勾选器，但它也要能在表里按行关。
 */
const collectedEffectsForFlowTable = computed(() => {
  const involved = flowInvolvedSlotIndexes.value
  const merged = new Map<string, ReturnType<typeof collectAllBuffEffects>[number]>()
  /**
   * ⚠️ 合并顺序**当前编辑槽位优先**：每个条目带的 `group` 标签是"它那次收集时的主视角"写的
   * （`buffEffectsByMainSlot[i]` 各自以 i 为主槽收集）。若按槽位号顺序合并，先到的别人视角会赢 ——
   * 表现就是「南宫那一行的『自身』里冒出雅自己的增益」「南宫自己的团队增益被写成『队友』」。
   */
  const order = [
    activeSlot.value,
    ...teamSlots.map((_, index) => index).filter((index) => index !== activeSlot.value),
  ]
  for (const slotIndex of order) {
    const items = buffEffectsByMainSlot.value[slotIndex] ?? []
    for (const item of items) {
      if (item.effect.applyTarget === 'self' && !involved.has(slotIndex)) continue
      if (!merged.has(item.effect.id)) merged.set(item.effect.id, item)
    }
  }
  // 非本槽位提供的条目：把标签从"它的主视角"改写成队友口径（`自身 → 队友`）
  return [...merged.values()].map((item) =>
    item.providerSlot != null && item.providerSlot !== activeSlot.value
      ? toTeammateView(item)
      : item,
  )
})

/**
 * 表里每条增益的显示文本（与局内 Buff 勾选器**同一套取值**：转模要算出值，否则显示成 0）。
 * 输入取自勾选器正在用的那几个（属性默认值 / 槽位面板取值 / 技能等级表）。
 * **视角固定为当前编辑槽位**（流程属于它），不跟随选择器里切换的查看槽位。
 */
const flowBuffTextOptions = computed<FlowBuffEffectTextOptions>(() => ({
  selection: multiSlotBuffSelection, slotIndex: activeSlot.value,
  skillSubcategories: skillSubcategories.value,
  ...configurationCalculationRuntime.value.getConfigurationInputs(activeSlot.value, 'global'),
}))

const flowBuffEffectTexts = computed(() =>
  buildFlowBuffEffectTexts(collectedEffectsForFlowTable.value, flowBuffTextOptions.value),
)

/** 单元格文本：按**该行合并后的例外**取事件值（组 + 成员，成员优先） */
function flowBuffEffectTextFor(
  effectId: string,
  rowOverride: FlowBuffOverride | null,
  rowKey?: string | null,
): string | null {
  const item = collectedEffectsForFlowTable.value.find((entry) => entry.effect.id === effectId)
  if (!item) return null
  const options = { ...flowBuffTextOptions.value, ...buffConvertResolveInputsForSlot(activeSlot.value, rowOverride, rowKey) }
  return buildFlowBuffEffectText(item, options, rowOverride)
}

/**
 * 单元格的来源/受益说明（Spec §2.3 第 4 项）：与数值同参数、同身份，
 * 显式用这次预览的查看槽位生成，不从事件持有者或页面活动态猜。
 */
/** 全局选择器的待选配置参数（共享参数解析，按显式查看槽位） */
const buffPickerConfigurationParameters = computed<Record<string, ResolvedEffectParameters>>(() =>
  configurationCalculationRuntime.value.getConfigurationInputs(buffPickerViewSlotIndex.value, 'global').configurationParameters,
)

function flowBuffRecipientNoteFor(
  effectId: string,
  rowOverride: FlowBuffOverride | null,
  rowKey?: string | null,
): string | null {
  const item = collectedEffectsForFlowTable.value.find((entry) => entry.effect.id === effectId)
  if (!item) return null
  const inputs = buffConvertResolveInputsForSlot(activeSlot.value, rowOverride, rowKey)
  const summary = inputs.effectSummaries?.[effectId]
  if (!summary) return null
  return effectRecipientNote(summary, activeSlot.value)
}

/**
 * 本行增益例外弹窗的转模解析输入（属性默认值 / 面板取值 / 全槽位取值表）。
 *
 * 用当前事件与合并后的行级例外构建来源面板；弹窗内修改例外时同样重新求值。
 */
function buffConvertResolveInputsForSlot(slotIndex: number, rowOverride?: FlowBuffOverride | null, rowKey?: string | null): ConvertResolveInputs {
  if (rowKey) {
    const hit = hits.value.find(item => item.id === rowKey) ?? null
    const groupRow = !hit && schemeSlots.value.some(slot => {
      const entry = slot.flow.find(item => item.id === rowKey)
      return entry && slot.prepared.some(prepared => prepared.id === entry.preparedId && prepared.skillGroupId)
    })
    if (groupRow) return configurationCalculationRuntime.value.getConfigurationInputs(slotIndex, 'group', rowOverride)
    return flowCalculationRuntime.value.getHitBuffPreview(slotIndex, hit, rowOverride)
  }
  return configurationCalculationRuntime.value.getConfigurationInputs(slotIndex, rowOverride !== undefined ? 'group' : 'global', rowOverride)
}

const mainSlotBuffSelection = computed(() =>
  resolveBuffSelectionForSlot(multiSlotBuffSelection, mainSlotIndex.value),
)

const buffEnabledCount = computed(() => {
  const resolved = mainSlotBuffSelection.value
  if (!resolved) return 0
  return Object.values(resolved.enabledIds).filter(Boolean).length
})

/** 顶栏「转模」标签：该槽位影画/音擎/驱动盘含局外或局内转模 */
const convertSlotIndexes = computed(() => {
  void teamSlots.map(
    (slot) =>
      `${slot.agentId}:${slot.rank}:${slot.wengineId}:${slot.wengineRefine}:${slot.twoPieceDriveDiscId}:${slot.fourPieceDriveDiscId}`,
  )
  const indexes = new Set<number>()
  for (let i = 0; i < teamSlots.length; i++) {
    if (!teamSlots[i]?.agentId) continue
    // 以该槽为主槽收集，才能看到其「自身」转模
    const ctx = buildBuffCollectContext(i)
    if (slotHasPanelConvertEffect(ctx, i)) indexes.add(i)
  }
  return indexes
})

function syncBuffDefaultsForSlot(slotIndex: number) {
  const effects = collectAllBuffEffects(buildBuffCollectContext(slotIndex))
  const attrDefaults =
    panelCalcSectionRef.value?.getAttrDefaultsForSlot?.(slotIndex) ??
    panelCalcSectionRef.value?.convertAttrDefaults ??
    {}
  const defaults = buildDefaultBuffSelection(effects, attrDefaults)
  mergeDefaultBuffSelectionIntoMulti(multiSlotBuffSelection, slotIndex, effects, defaults)
  syncTeamProfessionAutoEnabled(
    multiSlotBuffSelection,
    slotIndex,
    effects,
    teamSlots,
    agents.value,
  )
}

watch(teamBuffSignature, () => {
  if (restoringWorkingState) return
  for (const opt of buffPickerSlotOptions.value) {
    syncBuffDefaultsForSlot(opt.index)
  }
})

watch(
  () => teamSlots.map((slot) => slot.agentId).join(','),
  () => {
    if (restoringWorkingState) return
    const options = buffPickerSlotOptions.value
    if (!options.length) return
    if (!options.some((opt) => opt.index === buffPickerViewSlotIndex.value)) {
      buffPickerViewSlotIndex.value = activeSlot.value
    }
    for (const opt of options) {
      syncBuffDefaultsForSlot(opt.index)
    }
  },
  { immediate: true },
)

watch(
  [collectedEffectsForPicker, buffPickerViewSlotIndex],
  () => {
    if (restoringWorkingState) return
    syncBuffDefaultsForSlot(buffPickerViewSlotIndex.value)
  },
  { immediate: true },
)

/** 仅队伍职业构成变化时重同步人数条件勾选（保留人工勾选） */
watch(
  () =>
    [
      ...teamSlots.map((slot) => slot.agentId),
      ...agents.value.map((agent) => `${agent.id}:${agent.profession}`),
    ].join('|'),
  () => {
    if (restoringWorkingState) return
    for (const opt of buffPickerSlotOptions.value) {
      const effects = collectAllBuffEffects(buildBuffCollectContext(opt.index))
      syncTeamProfessionAutoEnabled(
        multiSlotBuffSelection,
        opt.index,
        effects,
        teamSlots,
        agents.value,
      )
    }
  },
)

function syncManualConvertDefaults() {
  if (restoringWorkingState) return
  for (const opt of buffPickerSlotOptions.value) {
    const effects = collectAllBuffEffects(buildBuffCollectContext(opt.index))
    for (const item of effects) {
      if (item.effect.extraGain) continue
      if (item.effect.kind !== 'convert' || !item.effect.convert) continue
      const source = item.effect.convert.panelSource ?? 'external'
      if (source !== 'manual') continue
      const store =
        item.effect.applyTarget === 'team'
          ? multiSlotBuffSelection.team
          : multiSlotBuffSelection.bySlot[opt.index]
      if (!store) continue
      const id = item.effect.id
      if (id in store.convertInputs) continue
      const configured = item.effect.convert.defaultBase
      store.convertInputs[id] =
        configured != null && Number.isFinite(configured) ? configured : 0
    }
  }
}

watch(
  () => panelCalcSectionRef.value?.convertAttrDefaults,
  syncManualConvertDefaults,
)

watch(
  [activeEnvironmentBuffs, () => multiSlotBuffSelection, buffPickerViewSlotIndex],
  async () => {
    if (syncingBossFieldBuff || restoringWorkingState) return
    const catalog = activeEnvironmentBuffs.value
    if (!catalog.length) return
    const effects = collectAllBuffEffects(buildBuffCollectContext(buffPickerViewSlotIndex.value))
    const enabledBossFieldKeys = new Set<string>()
    for (const item of effects) {
      const bossName = parseBossFieldBossName(item.sourceKey)
      if (!bossName) continue
      const enabled = getBuffEffectEnabled(
        multiSlotBuffSelection,
        buffPickerViewSlotIndex.value,
        item.effect.id,
        item.effect.applyTarget,
        false,
      )
      if (enabled) enabledBossFieldKeys.add(item.sourceKey)
    }

    if (enabledBossFieldKeys.size > 1) {
      syncingBossFieldBuff = true
      try {
        const current = [...enabledBossFieldKeys]
        const newly = current.filter((key) => !prevEnabledBossFieldKeys.value.includes(key))
        const keepKey = newly[0] ?? current[current.length - 1]!
        disableCollectedEffects(effects, (item) => {
          const fieldBoss = parseBossFieldBossName(item.sourceKey)
          return Boolean(fieldBoss) && item.sourceKey !== keepKey
        })
        enabledBossFieldKeys.clear()
        enabledBossFieldKeys.add(keepKey)
      } finally {
        syncingBossFieldBuff = false
      }
    }
    prevEnabledBossFieldKeys.value = [...enabledBossFieldKeys]

    // 临界节点 Buff：只能勾选一个（后点覆盖先前）
    const enabledDeductionNodeKeys = new Set<string>()
    for (const item of effects) {
      if (!item.sourceKey.startsWith('deduction-buff-')) continue
      const enabled = getBuffEffectEnabled(
        multiSlotBuffSelection,
        buffPickerViewSlotIndex.value,
        item.effect.id,
        item.effect.applyTarget,
        false,
      )
      if (enabled) enabledDeductionNodeKeys.add(item.sourceKey)
    }
    if (enabledDeductionNodeKeys.size > 1) {
      const current = [...enabledDeductionNodeKeys]
      const newly = current.filter((key) => !prevEnabledDeductionNodeKeys.value.includes(key))
      const keepKey = newly[0] ?? current[current.length - 1]!
      disableCollectedEffects(
        effects,
        (item) => item.sourceKey.startsWith('deduction-buff-') && item.sourceKey !== keepKey,
      )
      enabledDeductionNodeKeys.clear()
      enabledDeductionNodeKeys.add(keepKey)
    }
    prevEnabledDeductionNodeKeys.value = [...enabledDeductionNodeKeys]

    if (enabledBossFieldKeys.size === 1) {
      const sourceKey = [...enabledBossFieldKeys][0]!
      const entry = catalog.find((item) => item.sourceKey === sourceKey)
      const bossName = entry?.bossName ?? parseBossFieldBossName(sourceKey)
      const currentBoss = enemyInput.value.bossName
      if (bossName && bossName !== currentBoss) {
        await applyEnemyBossByName(bossName, {
          version: entry?.version,
          phase: entry?.phase,
        })
      }
    }

    const enabledDefenseKeys = catalog
      .filter((entry) => {
        if (entry.kind !== 'defense-room') return false
        return effects.some((item) => {
          if (item.sourceKey !== entry.sourceKey) return false
          return getBuffEffectEnabled(
            multiSlotBuffSelection,
            buffPickerViewSlotIndex.value,
            item.effect.id,
            item.effect.applyTarget,
            false,
          )
        })
      })
      .map((entry) => entry.sourceKey)
    const newlyDefense = enabledDefenseKeys.filter(
      (key) => !prevEnabledDefenseKeys.value.includes(key),
    )
    prevEnabledDefenseKeys.value = enabledDefenseKeys
    const defenseKey =
      newlyDefense[0] ?? (enabledDefenseKeys.length === 1 ? enabledDefenseKeys[0] : null)
    if (!defenseKey) return
    const defenseEntry = catalog.find((entry) => entry.sourceKey === defenseKey)
    const roomBoss = defenseEntry?.roomBosses?.[0]
    const currentBoss = enemyInput.value.bossName
    if (roomBoss?.name && roomBoss.name !== currentBoss) {
      await applyEnemyBossByName(roomBoss.name, {
        version: defenseEntry?.version,
        phase: defenseEntry?.phase,
      })
    }
  },
  { deep: true },
)

watch(
  () => enemyInput.value.bossName,
  (bossName) => {
    if (syncingEnemyFromEnv || syncingBossFieldBuff || restoringWorkingState) return
    const effects = collectAllBuffEffects(buildBuffCollectContext(buffPickerViewSlotIndex.value))
    // 按 Boss 名匹配，兼容危局 boss-field-* 与临界 deduction-field-*
    disableCollectedEffects(effects, (item) => {
      const fieldBoss = parseBossFieldBossName(item.sourceKey)
      if (!fieldBoss) return false
      return !bossName || fieldBoss !== bossName
    })
  },
)

function selectSlot(index: number) {
  activeSlot.value = index
}

function openTeamPresetPicker(index: number) {
  activeSlot.value = index
  teamPresetPickerOpen.value = true
}

function assignAgent(agentId: string) {
  activeSlotData.value.agentId = agentId
}

function clearSlot(index: number) {
  const slot = teamSlots[index]!
  const oldId = slot.agentId
  slot.agentId = ''
  slot.rank = 0
  slot.wengineId = 'none'
  slot.wengineRefine = 1
  slot.twoPieceDriveDiscId = 'none'
  slot.fourPieceDriveDiscId = 'none'
  if (oldId && !teamSlots.some((item) => item.agentId === oldId)) {
    // 两份面板都随角色一起清掉（角色不在队里了，留着没意义）
    delete slotPanels[oldId]
    delete convertSlotPanels[oldId]
  }
}

function selectWengine(wengineId: string) {
  if (wengineId !== 'none' && activeSlotData.value.wengineId === wengineId) {
    activeSlotData.value.wengineId = 'none'
    return
  }
  activeSlotData.value.wengineId = wengineId
  if (wengineId !== 'none') {
    const wengine = wengines.value.find((item) => item.id === wengineId)
    if (wengine && wengine.rarity !== 'S') {
      activeSlotData.value.wengineRefine = 5
    }
  }
}

function selectBangboo(bangbooId: string) {
  if (bangbooId !== 'none' && selectedBangbooId.value === bangbooId) {
    selectedBangbooId.value = 'none'
    return
  }
  selectedBangbooId.value = bangbooId
}

const stickySlotPanelPreviews = computed(() => {
  // 显式依赖：增益/邦布/环境变化时必须重读子组件预览（template ref 不会自动串联子 computed）
  void buffSelectionSignature.value
  void extraGains.value
  void selectedBangbooId.value
  void bangbooRefine.value
  void staggerPhase.value
  void activeEnvironmentBuffs.value
  void panelCalcMode.value
  void slotPanels
  void convertSlotPanels
  void teamSlots.map((s) => [
    s.agentId,
    s.wengineId,
    s.twoPieceDriveDiscId,
    s.fourPieceDriveDiscId,
  ])

  /**
   * 两个状态一律用 `PanelCalcSection` 的预览（「面板导入 / 词条导入」两态已冻结，见下方模板）：
   * 它是「**激活那份面板** + 当前增益」算出的局外 / 局内，
   * 随 Buff 实时重算；`PanelCalcSection` 在最优模式下仍以 `v-show` 挂载，预览随时可读。
   *
   * 最优模式也走这里（原先跳过），于是卡片的内容与「角色配置」严格一致 ——
   * 卡片是**录入区**的呈现，展示的就是配置里那份面板，与最优分析的候选结果无关；
   * 分析结果改由招式流程区「查看面板」展示（局外 + 局内，见 skillFlowPanelSource.ts）。
   */
  const fromPanel = panelCalcSectionRef.value?.slotPanelPreviews
  if (fromPanel) return fromPanel

  // 兜底：轻量局外（页级配置值，即「角色配置」里激活的那一份）
  return teamSlots.map((slot) => {
    if (!slot.agentId) return null
    const saved = activeSlotPanels.value[slot.agentId]
    const external =
      saved ??
      computeExternalPanelFromTeamSlot({
        slot,
        agents: agents.value,
        wengines: wengines.value,
        driveDiscs: driveDiscs.value,
      })
    return { external, final: null as PanelStats | null }
  })
})

/**
 * 每个槽位**当前生效**的面板来源（面板导入 / 词条导入）—— 顶部槽位卡片的胶囊标签用。
 *
 * 取「实际在用」而不是「用户选的」（见 `resolveActivePanelSourceKind`）：选中那份没数据时
 * 面板会回落到另一份，照用户的选择标注就会标错。两份都没有数据的槽位给 `null`，卡片不标来源。
 */
const slotPanelSourceKinds = computed(() =>
  teamSlots.map((slot) =>
    slot.agentId ? (resolveActivePanelSourceKind(slotPanels[slot.agentId]) ?? null) : null,
  ),
)

/** 导入弹窗局内预览：随草稿局外 + 当前增益实时重算（对齐改前内嵌面板行为） */
const importFinalPanelToken = computed(() =>
  JSON.stringify({
    buffs: buffSelectionSignature.value,
    extra: extraGains.value,
    bangboo: selectedBangbooId.value,
    refine: bangbooRefine.value,
    stagger: staggerPhase.value,
    env: activeEnvironmentBuffs.value.map((e) => e.sourceKey),
    mode: panelCalcMode.value,
    slot: activeSlot.value,
  }),
)

function resolveImportFinalPanel(external: PanelStats): PanelStats | null {
  const slotIndex = activeSlot.value
  if (panelCalcMode.value === 'optimal') {
    return (
      optimalAffixSectionRef.value?.previewFinalPanel?.(external, slotIndex) ??
      panelCalcSectionRef.value?.previewFinalPanel?.(external, slotIndex) ??
      null
    )
  }
  return panelCalcSectionRef.value?.previewFinalPanel?.(external, slotIndex) ?? null
}

const activeFinalPanelPreview = computed(() => {
  if (panelCalcMode.value === 'optimal') {
    const evalResult = optimalAffixSectionRef.value?.displayEval as
      | { finalPanel?: PanelStats }
      | undefined
    return evalResult?.finalPanel ?? null
  }
  return panelCalcSectionRef.value?.panelBreakdown?.finalPanel ?? null
})

/**
 * 「确定导入」——**唯一**的面板写盘入口（`dev-docs/affix-calc-manual.md` §1.4）。
 *
 * 写哪一份由弹窗里点确定时所在的子页决定：面板页写「面板导入」那份，词条页写「词条导入」那份。另一份原样保留。
 *
 * 4/5/6 主属性（容器级字段 `affixDriveDiscMainStats`）**两条路都写** —— 它是「面板上的事实」，
 * 截图识别也会给出（`panelScreenshot.ts` 的 `driveDiscMainStats`）；词条数 `affixCounts` 只跟词条导入那一路。
 */
function applyUnifiedImport(payload: UnifiedPresetConfirmPayload) {
  const slot = teamSlots[activeSlot.value]
  if (!slot) return
  // 导入确认引起的 rank 变化不走「影画→重置等级上限」watch，等级以 payload 为准
  importRankGuard = true
  slot.rank = payload.rank
  slot.wengineId = payload.wengineId
  slot.wengineRefine = payload.wengineRefine
  slot.twoPieceDriveDiscId = payload.twoPieceDriveDiscId
  slot.fourPieceDriveDiscId = payload.fourPieceDriveDiscId
  const agentId = payload.agentId
  const existing = slotPanels[agentId]
  const importedAt = Date.now()
  if (payload.panelSource === 'affixDerived') {
    const written = writePanelSource(existing, 'affixDerived', payload.externalPanel, {
      importedAt,
      source: 'affix',
    })
    slotPanels[agentId] = writeAffixInputsIntoSource(written, {
      affixCounts: { ...payload.affixCounts },
      affixDriveDiscMainStats: { ...payload.affixDriveDiscMainStats },
    })
  } else {
    const written = writePanelSource(existing, 'imported', payload.externalPanel, {
      importedAt,
      source: payload.panelSourceDetail ?? 'manual',
    })
    // 4/5/6 主属性是**面板上的事实**（截图识别也会给出），面板导入这一路同样要落盘 ——
    // 此前只写了词条导入那份，导致「面板导入（含截图识别到的主属性）」点确定后主属性被丢掉。
    // 词条数（affixCounts）仍只属于词条导入那一路：面板页没有它的输入。
    slotPanels[agentId] = writeAffixInputsIntoSource(written, {
      affixDriveDiscMainStats: { ...payload.affixDriveDiscMainStats },
    })
  }
  skillTalentLevelsByAgent[agentId] = fillSkillTalentLevels(
    payload.skillTalentLevels,
    payload.rank,
  )
  slot.agentId = agentId
  nextTick(() => {
    // 本轮导入的 rank 变更已消费完毕，恢复影画 watch（watch 默认 flush pre，先于 nextTick 回调执行）
    importRankGuard = false
    panelCalcSectionRef.value?.syncLivePanelFromCommitted?.()
  })
}

/**
 * 手动切换某角色当前生效的那份面板：只改 `active`，两份面板本身原样不动。
 * 切换后全页面按新面板重算（口径见 `dev-docs/affix-calc-manual.md` §1.5）。
 */
function setSlotPanelActiveSource(agentId: string, kind: AgentPanelSourceKind) {
  if (!agentId) return
  const existing = slotPanels[agentId]
  if (!existing) return
  if (!panelSourceKindsWithData(existing).includes(kind)) return
  slotPanels[agentId] = setActivePanelSource(existing, kind)
}

/** 子组件上报的来源记录补丁（只含变化的 agentId），按 key 合并 */
function applySlotPanelPatch(patch: Record<string, AgentPanelSources>) {
  for (const [agentId, sources] of Object.entries(patch)) {
    if (sources) slotPanels[agentId] = sources
  }
}

function cloneTeamSlots(): DamageCalcHistoryEntry['teamSlots'] {
  return teamSlots.map((slot) => ({
    agentId: slot.agentId,
    rank: slot.rank,
    wengineId: slot.wengineId,
    wengineRefine: slot.wengineRefine,
    twoPieceDriveDiscId: slot.twoPieceDriveDiscId || 'none',
    fourPieceDriveDiscId: slot.fourPieceDriveDiscId || 'none',
  }))
}

function applyTeamSlots(slots: DamageCalcHistoryEntry['teamSlots']) {
  slots.forEach((slot, index) => {
    const target = teamSlots[index]
    if (!target) return
    // 先写装备/词条，再改 agentId：换人 watch 若仍跑到，读到的是方案里的盘，而不是空槽默认。
    target.rank = slot.rank
    target.wengineId = slot.wengineId
    target.wengineRefine = slot.wengineRefine
    target.twoPieceDriveDiscId =
      typeof slot.twoPieceDriveDiscId === 'string' && slot.twoPieceDriveDiscId
        ? slot.twoPieceDriveDiscId
        : 'none'
    target.fourPieceDriveDiscId =
      typeof slot.fourPieceDriveDiscId === 'string' && slot.fourPieceDriveDiscId
        ? slot.fourPieceDriveDiscId
        : 'none'
    target.agentId = slot.agentId
  })
}

/** 两份面板一起深拷贝，并剥掉不进方案的内部字段（异化系数等） */
function captureSchemeSlotPanels(): Record<string, AgentPanelSources> {
  const cloned = JSON.parse(JSON.stringify(slotPanels)) as Record<string, AgentPanelSources>
  for (const sources of Object.values(cloned)) {
    for (const key of ['importedPanel', 'affixDerivedPanel'] as const) {
      const panel = sources[key]
      if (panel) sources[key] = resetSchemeExcludedPanelFields(panel)
    }
  }
  return cloned
}

function cloneConvertSlotPanels(): ConvertSlotPanels {
  return JSON.parse(JSON.stringify(convertSlotPanels)) as ConvertSlotPanels
}

function applySlotPanels(panels?: Record<string, AgentPanelSources>) {
  for (const key of Object.keys(slotPanels)) {
    delete slotPanels[key]
  }
  if (!panels) return
  const cloned = JSON.parse(JSON.stringify(panels)) as Record<string, AgentPanelSources>
  for (const sources of Object.values(cloned)) {
    for (const key of ['importedPanel', 'affixDerivedPanel'] as const) {
      const panel = sources[key]
      if (panel) sources[key] = resetSchemeExcludedPanelFields(fillPanelStatsDefaults(panel))
    }
    if (sources.affixCounts) {
      sources.affixCounts = { ...createEmptyAffixCounts(), ...sources.affixCounts }
    }
    if (sources.affixDriveDiscMainStats) {
      sources.affixDriveDiscMainStats = {
        ...createDefaultAffixDriveDiscMainStats(),
        ...sources.affixDriveDiscMainStats,
      }
    }
  }
  Object.assign(slotPanels, cloned)
}

function applyConvertSlotPanels(panels?: ConvertSlotPanels) {
  for (const key of Object.keys(convertSlotPanels)) {
    delete convertSlotPanels[key]
  }
  if (!panels) return
  Object.assign(convertSlotPanels, JSON.parse(JSON.stringify(panels)))
}

function pickSlotsToRestore(entry: { slots?: SchemeSlot[]; loadedSchemeId?: string }) {
  if (schemeSlotsHaveContent(entry.slots)) return entry.slots
  // 只有「压根没有 slots 字段」的老草稿才回退方案库（迁移用）。
  // 显式写下的空流程必须原样保留：用户清空准备/流程后刷新，不能被方案库「复活」；
  // 载入一个流程为空的方案时，也不能去取上一个高亮方案的流程。
  if (entry.slots != null) return entry.slots
  const schemeId = entry.loadedSchemeId || getLoadedSchemeId()
  const scheme = findDamageCalcHistory(schemeId)
  if (schemeSlotsHaveContent(scheme?.slots)) return scheme!.slots
  return entry.slots
}

function describeEnvironmentRestore(
  result: SchemeEnvironmentBuffApplyResult,
  phaseMissing: boolean,
): string {
  const parts: string[] = []
  if (phaseMissing) parts.push('方案记录的环境期数已不可用，请重新选择期数')
  // 完全命中就不打扰：只在重建 / 缺失时说明
  if (result.remapped) parts.push(`已按名称重建 ${result.remapped} 条环境 Buff 勾选`)
  if (result.missing) parts.push(`${result.missing} 条效果在当前期数找不到，已跳过`)
  return parts.join('；')
}

function applyWorkingState(entry: {
  teamSlots: DamageCalcHistoryEntry['teamSlots']
  activeSlot: number
  selectedBangbooId: string
  bangbooRefine: number
  panelCalcMode: PanelCalcMode
  /** 双来源结构（新）：每人的两份面板 + 激活那份 */
  slotPanels?: Record<string, AgentPanelSources>
  /** @deprecated 老草稿：一份面板（读取时按 panelCalcMode 归位） */
  anomalySlotPanels?: Record<string, PanelStats>
  convertSlotPanels?: ConvertSlotPanels
  slots?: SchemeSlot[]
  loadedSchemeId?: string
  staggerPhase?: StaggerPhase
  multiSlotBuffSelection?: MultiSlotBuffSelection
  panelState?: DamageCalcHistoryEntry['panelState'] | null
  envBuffMode?: EnvironmentBuffFilterMode
  envBuffVersion?: string
  envBuffPhaseId?: string
  envBuffFrontierId?: string
  envBuffNodeId?: string
  /** 环境 Buff 勾选快照（方案才有；草稿直接靠 multiSlotBuffSelection 的 id） */
  envBuffChecks?: SchemeEnvironmentBuffChecks
  preserveBaseDamageSource?: boolean
}) {
  restoringWorkingState = true
  envSchemeNotice.value = ''
  panelCalcSectionRef.value?.beginRestore()
  const restoredBuff = entry.multiSlotBuffSelection
    ? (JSON.parse(JSON.stringify(entry.multiSlotBuffSelection)) as MultiSlotBuffSelection)
    : createEmptyMultiSlotBuffSelection()
  activeSlot.value = entry.activeSlot
  applyTeamSlots(entry.teamSlots)
  selectedBangbooId.value = entry.selectedBangbooId
  bangbooRefine.value = entry.bangbooRefine
  // 计算方式恒为「最优词条分配」（2026-09-13 起常驻）：方案加载不再改动它。

  // 新结构直接用；老草稿（单份面板 + 槽位级词条数）按 panelCalcMode 归位
  applySlotPanels(
    entry.slotPanels ??
      migrateLegacyPanelsToSources({
        legacyPanels: entry.anomalySlotPanels,
        panelCalcMode: entry.panelCalcMode,
        teamSlots: entry.teamSlots,
      }),
  )
  applyConvertSlotPanels(entry.convertSlotPanels)
  schemeSlots.value = ensureSchemeSlots(pickSlotsToRestore(entry), 3)
  staggerPhase.value = entry.staggerPhase ?? 'stagger'
  if (entry.envBuffMode != null) envBuffMode.value = entry.envBuffMode
  if (entry.envBuffVersion != null) envBuffVersion.value = entry.envBuffVersion
  if (entry.envBuffPhaseId != null) envBuffPhaseId.value = entry.envBuffPhaseId
  if (entry.envBuffFrontierId != null) envBuffFrontierId.value = entry.envBuffFrontierId
  if (entry.envBuffNodeId != null) envBuffNodeId.value = entry.envBuffNodeId
  // 方案记录的期数在当前目录里找不到（下架 / 重导）：说清楚，别只留一个空下拉。
  // 目录还没加载完时不判定，避免把「正在加载」误报成「期数不可用」。
  const envModeCatalogLoaded =
    entry.envBuffMode === 'crisis'
      ? crisisPhases.value.length > 0
      : entry.envBuffMode === 'defense'
        ? defenseSeasons.value.length > 0
        : entry.envBuffMode === 'deduction'
          ? deductionPeriods.value.length > 0
          : false
  const envPhaseMissing =
    envModeCatalogLoaded &&
    !!entry.envBuffPhaseId &&
    !envPhaseOptions.value.some((option) => option.id === entry.envBuffPhaseId)

  const applyPanelSnapshot = (isRestoreReplay = false) => {
    if (!entry.panelState) return
    const panelState = {
      ...entry.panelState,
      externalPanel: resetSchemeExcludedPanelFields({
        ...entry.panelState.externalPanel,
      }),
    }
    panelCalcSectionRef.value?.loadSnapshot(panelState, {
      preserveBaseDamageSource: entry.preserveBaseDamageSource,
      isRestoreReplay,
    })
    for (const key of Object.keys(skillTalentLevelsByAgent)) delete skillTalentLevelsByAgent[key]
    const talentMap = entry.panelState.skillTalentLevelsByAgent
    if (talentMap) {
      for (const [agentId, levels] of Object.entries(talentMap)) {
        const rank = teamSlots.find((slot) => slot.agentId === agentId)?.rank ?? 0
        skillTalentLevelsByAgent[agentId] = fillSkillTalentLevels(levels, rank)
      }
    }
  }
  // 必须在换人 watch 同一轮里写回快照，不能拖到 nextTick：
  // 否则新角色的面板要等下一帧才进快照，槽位卡片与预览会先用旧角色的面板渲染一帧。
  applyPanelSnapshot()

  // Buff 默认同步仍等队伍签名 watch 跑完再覆盖
  void nextTick(() => {
    multiSlotBuffSelection.team = restoredBuff.team
    multiSlotBuffSelection.bySlot = restoredBuff.bySlot
    if (entry.envBuffChecks) {
      const restored = applySchemeEnvironmentBuffChecks(
        multiSlotBuffSelection,
        entry.envBuffChecks,
        activeEnvironmentBuffs.value,
      )
      const notice = describeEnvironmentRestore(restored, envPhaseMissing)
      if (notice) envSchemeNotice.value = notice
    } else if (envPhaseMissing) {
      envSchemeNotice.value = '方案记录的环境期数已不可用，请重新选择期数'
    }
    applyPanelSnapshot(true)
    void nextTick(() => {
      persistWorkingDraftNow(true)
      restoringWorkingState = false
      panelCalcSectionRef.value?.endRestore()
    })
  })
}

function captureSchemePanelState(): DamageCalcSchemePanelSnapshot | null {
  const snapshot = panelCalcSectionRef.value?.getSnapshot()
  if (!snapshot) return null

  // 方案快照白名单：只保留用户侧配置。
  // 不跟方案走的内部字段：
  // - 基础伤害来源开关（删掉，不进方案）
  // - 异化系数乘区输入（mutationCoeff / mutationCoeffFactor）
  const schemeSnapshot = { ...snapshot }
  delete (schemeSnapshot as { baseDamageSource?: unknown }).baseDamageSource
  const externalPanel = resetSchemeExcludedPanelFields({ ...schemeSnapshot.externalPanel })
  return {
    ...schemeSnapshot,
    externalPanel,
    skillTalentLevelsByAgent: JSON.parse(JSON.stringify(skillTalentLevelsByAgent)) as Record<
      string,
      SkillTalentLevels
    >,
  }
}

function captureWorkingDraft(): DamageCalcWorkingDraft | null {
  const panelState = panelCalcSectionRef.value?.getSnapshot() ?? null
  const withTalent = panelState
    ? {
        ...panelState,
        skillTalentLevelsByAgent: JSON.parse(JSON.stringify(skillTalentLevelsByAgent)) as Record<
          string,
          SkillTalentLevels
        >,
      }
    : null
  return {
    savedAt: Date.now(),
    loadedSchemeId: activeHistoryId.value || getLoadedSchemeId(),
    teamSlots: cloneTeamSlots(),
    activeSlot: activeSlot.value,
    selectedBangbooId: selectedBangbooId.value,
    bangbooRefine: bangbooRefine.value,
    panelCalcMode: panelCalcMode.value,
    // 取不到快照时**不带这个键**（不是写 null）：落盘端（saveWorkingDraft）会沿用已存的那份，
    // 避免卸载 / 页面隐藏瞬间把「敌方与环境 / 额外 Buff」抹成默认。
    ...(withTalent ? { panelState: withTalent } : {}),
    slotPanels: captureSchemeSlotPanels(),
    convertSlotPanels: cloneConvertSlotPanels(),
    slots: JSON.parse(JSON.stringify(schemeSlots.value)),
    staggerPhase: staggerPhase.value,
    multiSlotBuffSelection: JSON.parse(JSON.stringify(multiSlotBuffSelection)),
    envBuffMode: envBuffMode.value,
    envBuffVersion: envBuffVersion.value,
    envBuffPhaseId: envBuffPhaseId.value,
    envBuffFrontierId: envBuffFrontierId.value,
    envBuffNodeId: envBuffNodeId.value,
  }
}

function persistWorkingDraftNow(force = false) {
  if (!force && (!draftHydrated || restoringWorkingState)) return
  const draft = captureWorkingDraft()
  if (!draft) return
  const result = saveWorkingDraft(draft)
  // 绝不静默丢数据：写失败 / 被别的标签页抢先，都要让用户看见
  if (result === 'ok') {
    draftSaveWarning.value = ''
  } else if (result === 'failed') {
    draftSaveWarning.value =
      '草稿保存失败：浏览器存储写不进去（可能已满或处于隐私模式）。请先用方案库导出备份，再清理浏览器存储。'
  } else {
    draftSaveWarning.value =
      '已用本页内容覆盖草稿：另一个标签页也改过它，对方的改动可能已被覆盖。建议只保留一个标签页。'
  }
}

function schedulePersistWorkingDraft() {
  if (!draftHydrated || restoringWorkingState) return
  if (draftSaveTimer) clearTimeout(draftSaveTimer)
  draftSaveTimer = setTimeout(() => {
    draftSaveTimer = null
    persistWorkingDraftNow()
  }, 400)
}

function onDraftVisibilityChange() {
  if (document.visibilityState === 'hidden') persistWorkingDraftNow()
}

function restoreWorkingState() {
  const loadedId = getLoadedSchemeId()
  activeHistoryId.value = loadedId
  const draft = loadWorkingDraft()
  if (draft) {
    // 历史坏数据：草稿缺 panelState（曾被子组件 ref 失效的那次落盘写成 null）。
    // 当前高亮方案里还留着的话就补回来 —— 用户不必手动去方案库重载。
    const fallbackPanelState = draft.panelState
      ? null
      : (findDamageCalcHistory(draft.loadedSchemeId || loadedId)?.panelState ?? null)
    applyWorkingState({
      ...draft,
      panelState: draft.panelState ?? fallbackPanelState,
      loadedSchemeId: draft.loadedSchemeId || loadedId,
      preserveBaseDamageSource: true,
    })
    if (draft.loadedSchemeId) activeHistoryId.value = draft.loadedSchemeId
  } else if (loadedId) {
    const entry = findDamageCalcHistory(loadedId)
    if (entry) applyWorkingState({ ...entry, preserveBaseDamageSource: false })
  }
  void nextTick(() => {
    void nextTick(() => {
      draftHydrated = true
      persistWorkingDraftNow(true)
    })
  })
}

/** 方案要记住的环境筛选 + 勾选快照（草稿另走自己的 envBuff* 字段，不抓 checks） */
function captureSchemeEnvironmentState() {
  return {
    envBuffMode: envBuffMode.value,
    envBuffVersion: envBuffVersion.value,
    envBuffPhaseId: envBuffPhaseId.value,
    envBuffFrontierId: envBuffFrontierId.value,
    envBuffNodeId: envBuffNodeId.value,
    envBuffChecks: captureSchemeEnvironmentBuffChecks(
      multiSlotBuffSelection,
      activeEnvironmentBuffs.value,
    ),
  }
}

/**
 * 版本留痕：记下保存时的运行时乘区方案 / 计算链路版本。
 * 只写不读（加载与计算都不看这两个字段），用于日后对比「方案是在哪一版配置下算的」。
 */
function captureRuntimeConfigVersions(): Pick<
  DamageCalcHistoryEntry,
  'zoneSchemeVersion' | 'damageChainVersions'
> {
  const versions = getRuntimeConfigVersions()
  return {
    zoneSchemeVersion: versions.zoneSchemeVersion,
    damageChainVersions: versions.damageChainVersions,
  }
}

function saveHistoryEntry(payload: { name: string; folder: string }) {
  const panelState = captureSchemePanelState()
  if (!panelState) return

  const folder = payload.folder?.trim() || ''
  // 同名保护：「保存当前配置」只用于新建方案，不能覆盖同名方案，也不能与目录重名。
  // 要覆盖已有方案，必须点该方案卡片上的「保存」按钮（走 overwriteHistoryEntry）。
  const name = payload.name.trim()
  const conflict = nameConflictType(folder, name, 'scheme')
  if (conflict === 'scheme') {
    historyMessage.value = `已存在同名方案「${name}」；覆盖请点击该方案上的「保存」按钮`
    return
  }
  const entry: DamageCalcHistoryEntry = {
    id: createHistoryEntryId(),
    name: payload.name,
    savedAt: Date.now(),
    teamSlots: cloneTeamSlots(),
    activeSlot: activeSlot.value,
    selectedBangbooId: selectedBangbooId.value,
    bangbooRefine: bangbooRefine.value,
    panelCalcMode: panelCalcMode.value,
    panelState,
    slotPanels: captureSchemeSlotPanels(),
    convertSlotPanels: cloneConvertSlotPanels(),
    slots: JSON.parse(JSON.stringify(schemeSlots.value)),
    staggerPhase: staggerPhase.value,
    multiSlotBuffSelection: JSON.parse(JSON.stringify(multiSlotBuffSelection)),
    ...captureSchemeEnvironmentState(),
    ...captureRuntimeConfigVersions(),
    folder,
    order: Date.now(),
  }

  historyEntries.value = saveDamageCalcHistory(entry)
  // 写盘失败（配额满 / 隐私模式）必须说出来，不能报「已保存」
  if (takeSchemeStoreWriteFailed()) {
    historyMessage.value =
      '保存失败：浏览器存储写不进去（可能已满或处于隐私模式）。请先导出备份，再清理浏览器存储。'
    return
  }
  activeHistoryId.value = entry.id
  setLoadedSchemeId(entry.id)
  historyMessage.value = `已保存「${payload.name}」${folder ? `（${folder}）` : ''}`
  persistWorkingDraftNow()
}

function loadHistoryEntry(entry: DamageCalcHistoryEntry) {
  // 先登记 id 再灌状态：pickSlotsToRestore 的老草稿回退会读 getLoadedSchemeId()，
  // 顺序反了会读到「上一个高亮方案」，把别的方案的流程串进来。
  activeHistoryId.value = entry.id
  setLoadedSchemeId(entry.id)
  applyWorkingState({ ...entry, preserveBaseDamageSource: false })
  historyMessage.value = `已加载「${entry.name}」`
  // 环境恢复结果在下一拍才确定（等勾选回灌）；期数不可用 / 重建数量补进同一条消息
  void nextTick(() => {
    if (envSchemeNotice.value) {
      historyMessage.value = `已加载「${entry.name}」 · ${envSchemeNotice.value}`
    }
  })
}

/** 用当前页面配置覆盖指定方案（保留其 id / 名称 / 目录） */
function overwriteHistoryEntry(id: string) {
  const panelState = captureSchemePanelState()
  if (!panelState) return
  const existing = historyEntries.value.find((item) => item.id === id)
  if (!existing) return
  const updated: DamageCalcHistoryEntry = {
    ...existing,
    savedAt: Date.now(),
    order: Date.now(),
    teamSlots: cloneTeamSlots(),
    activeSlot: activeSlot.value,
    selectedBangbooId: selectedBangbooId.value,
    bangbooRefine: bangbooRefine.value,
    panelCalcMode: panelCalcMode.value,
    panelState,
    slotPanels: captureSchemeSlotPanels(),
    convertSlotPanels: cloneConvertSlotPanels(),
    slots: JSON.parse(JSON.stringify(schemeSlots.value)),
    staggerPhase: staggerPhase.value,
    multiSlotBuffSelection: JSON.parse(JSON.stringify(multiSlotBuffSelection)),
    ...captureSchemeEnvironmentState(),
    ...captureRuntimeConfigVersions(),
  }
  historyEntries.value = saveDamageCalcHistory(updated)
  // 同上：覆盖失败不能报「已覆盖」
  if (takeSchemeStoreWriteFailed()) {
    historyMessage.value =
      '覆盖失败：浏览器存储写不进去（可能已满或处于隐私模式）。请先导出备份，再清理浏览器存储。'
    return
  }
  activeHistoryId.value = updated.id
  historyMessage.value = `已用当前配置覆盖「${updated.name}」`
  persistWorkingDraftNow()
}

/** 方案库内部直接改了 localStorage（复制/重命名/删除/批量/目录/导入），在此刷新列表（全量） */
function onSchemeLibraryChanged() {
  historyEntries.value = listAllDamageCalcHistory()
  // 方案库弹窗里的复制/改名/删除/移动/建目录等操作也走同一条写盘路径，失败同样要说出来
  if (takeSchemeStoreWriteFailed()) {
    historyMessage.value =
      '刚才的方案库改动没有写进浏览器存储（可能已满或处于隐私模式）。请先导出备份，再清理浏览器存储。'
  }
}

function blankTeamSlots(): TeamSlot[] {
  return [
    {
      agentId: '',
      rank: 0,
      wengineId: 'none',
      wengineRefine: 1,
      twoPieceDriveDiscId: 'none',
      fourPieceDriveDiscId: 'none',
    },
    {
      agentId: '',
      rank: 0,
      wengineId: 'none',
      wengineRefine: 1,
      twoPieceDriveDiscId: 'none',
      fourPieceDriveDiscId: 'none',
    },
    {
      agentId: '',
      rank: 0,
      wengineId: 'none',
      wengineRefine: 1,
      twoPieceDriveDiscId: 'none',
      fourPieceDriveDiscId: 'none',
    },
  ]
}

function defaultEnemyInput(): DamageEnemyInput {
  return createDefaultDamageEnemyInput()
}

/**
 * 方案边界内的空白面板：队伍/面板/额外 Buff/准备流程/敌方。
 * 不含方案库、自建招式、流程伤害记录、公式开关；环境筛选（危局/防卫/临界）不在这份面板快照里，
 * 而是与勾选快照一起挂在方案条目上（`envBuff*` / `envBuffChecks`）。
 */
function emptySchemePanelState(): DamageCalcSchemePanelSnapshot {
  return {
    externalPanel: resetSchemeExcludedPanelFields(createDefaultExternalPanel()),
    skillTalentLevelsByAgent: {},
    extraGains: [],
    enemyInput: defaultEnemyInput(),
  }
}

function resetPageSchemeConfig() {
  applyWorkingState({
    teamSlots: blankTeamSlots(),
    activeSlot: 0,
    selectedBangbooId: 'none',
    bangbooRefine: 1,
    panelCalcMode: 'panel',
    slotPanels: {},
    convertSlotPanels: {},
    slots: ensureSchemeSlots([], 3),
    staggerPhase: 'stagger',
    multiSlotBuffSelection: createEmptyMultiSlotBuffSelection(),
    panelState: emptySchemePanelState(),
    preserveBaseDamageSource: true,
  })
  for (const key of Object.keys(skillTalentLevelsByAgent)) delete skillTalentLevelsByAgent[key]
  extraGains.value = []
  enemyInput.value = defaultEnemyInput()
  activeHistoryId.value = ''
  setLoadedSchemeId('')
}

function onSchemeImported(loadedId: string) {
  calculatorBuffStore.reloadCustomSkillsFromStorage()
  historyEntries.value = listAllDamageCalcHistory()
  const entry = loadedId ? findDamageCalcHistory(loadedId) : null
  if (entry) {
    loadHistoryEntry(entry)
    return
  }
  resetPageSchemeConfig()
}

watch(
  [
    teamSlots,
    schemeSlots,
    activeSlot,
    selectedBangbooId,
    bangbooRefine,
    panelCalcMode,
    staggerPhase,
    extraGains,
    enemyInput,
    slotPanels,
    convertSlotPanels,
    multiSlotBuffSelection,
    // 环境筛选（危局 / 防卫 / 临界）也在草稿里，别只等 pagehide / 失活才落盘
    envBuffMode,
    envBuffVersion,
    envBuffPhaseId,
    envBuffFrontierId,
    envBuffNodeId,
  ],
  schedulePersistWorkingDraft,
  { deep: true },
)

const pageRootRef = ref<HTMLElement | null>(null)
const skillFlowSectionRef = ref<InstanceType<typeof SkillFlowSection> | null>(null)
const historySectionRef = ref<InstanceType<typeof DamageCalcHistorySection> | null>(null)

/**
 * 顶部准备区的 DOM。只用来量高度 —— 收起/展开、窄屏换行、顶部提示条出现都会改它，
 * 所以交给 ResizeObserver 维护一份缓存值，滚动时只读缓存，不在滚动里读布局。
 */
const topAreaRef = ref<HTMLElement | null>(null)
const topAreaHeight = ref(0)
/** 导航落地时顶栏下方再留的间隙（px） */
const NAV_SCROLL_GAP = 10
/** 距离超过这么多屏就直接瞬移，短距离仍平滑 */
const NAV_INSTANT_SCREEN_RATIO = 1.6
/** 连点导航时只认最后一次 */
let navScrollToken = 0
let topAreaObserver: ResizeObserver | null = null

/**
 * 导航滚动到区块：
 * - 顶栏高度取 ResizeObserver 维护的缓存值（顶栏收起/展开、换行、提示条都不会算错）；
 * - 跳跃距离超过 1.6 屏（或系统开了"减少动态效果"）直接瞬移，短距离仍平滑；
 * - 瞬移落地给目标区块闪一下淡金描边，避免"跳完不知道落在哪"；
 * - 目标已经整块露在可视区里就不动（连点同一项不会跳）。
 */
async function scrollToSection(sectionId: DamageCalcSectionId) {
  const token = ++navScrollToken
  await nextTick()
  // 「面板导入 / 词条导入」入口已永久删除（2026-09-12，见 damageCalcNav.ts）；
  // 「词条配比分析」区块即锚点本身（#damage-panel），无映射。
  // 流程区内还有「伤害记录」锚点（其下含「当前流程」）：要先展开流程区，
  // 展开后目标位置下移 —— 必须等这一帧之后再算位置
  if (sectionId === 'skill-flow' || sectionId === 'flow-records') {
    skillFlowSectionRef.value?.expand()
    await nextTick()
  }
  if (token !== navScrollToken) return

  const target = pageRootRef.value?.querySelector<HTMLElement>(`#${sectionId}`)
  const scroller = resolveScrollContainer()
  if (!target || !scroller) return

  // 缓存值还没建好（首帧）时现场量一次兜底，正常路径不会走到这里
  const offset =
    (topAreaHeight.value || topAreaRef.value?.getBoundingClientRect().height || 0) + NAV_SCROLL_GAP
  const scrollerRect = scroller.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

  const plan = planNavScroll({
    scrollTop: scroller.scrollTop,
    containerHeight: scroller.clientHeight,
    containerTop: scrollerRect.top,
    targetTop: targetRect.top,
    targetBottom: targetRect.bottom,
    targetHeight: targetRect.height,
    offset,
    instantScreenRatio: NAV_INSTANT_SCREEN_RATIO,
    reduceMotion,
  })
  if (plan.action === 'skip') return

  scroller.scrollTo({ top: plan.top, behavior: plan.behavior })
  if (plan.instant) flashSection(target)
}

/**
 * 顶部准备区（三个角色槽位 + 详情条 + 方案库/清空）整体收起。
 * 收起后这一段只剩右下角一颗「展开」按钮，把竖向空间让给下面的计算区；
 * 状态只记本机 localStorage，不进方案数据，也不影响任何计算口径。
 */
const TOP_AREA_COLLAPSED_KEY = 'zzz-hp-team-slot-editor-collapsed'

function readTopAreaCollapsed() {
  try {
    return localStorage.getItem(TOP_AREA_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

const topAreaCollapsed = ref(readTopAreaCollapsed())

function toggleTopArea() {
  topAreaCollapsed.value = !topAreaCollapsed.value
  try {
    localStorage.setItem(TOP_AREA_COLLAPSED_KEY, topAreaCollapsed.value ? '1' : '0')
  } catch {
    // localStorage 不可用时只影响下次进页面的默认状态
  }
}

function openSchemeLibrary() {
  historySectionRef.value?.openModal()
}

function clearCurrentScheme() {
  historySectionRef.value?.clearLoadedScheme()
}

function onClearLoadedScheme() {
  resetPageSchemeConfig()
}

/**
 * 页面真正的滚动容器：外层 `.calculator-page` 是 `100vh + overflow:hidden`，
 * 滚动发生在里面那块 `.content`（`overflow-y:auto`）上，所以不能用 window 的滚动量。
 */
function resolveScrollContainer(): HTMLElement | null {
  const root = pageRootRef.value
  if (!root) return null
  let node: HTMLElement | null = root.parentElement
  while (node) {
    const overflowY = getComputedStyle(node).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
      return node
    }
    node = node.parentElement
  }
  const doc = document.scrollingElement
  return doc instanceof HTMLElement ? doc : null
}

/** 瞬移落地提示：给目标区块一圈淡金描边（outline 不参与布局，不会引起重排） */
function flashSection(target: HTMLElement) {
  target.classList.remove('nav-landed')
  void target.offsetWidth
  target.classList.add('nav-landed')
  window.setTimeout(() => target.classList.remove('nav-landed'), 1000)
}

/** 顶栏高度变化时写入缓存，同时供 CSS 的 `scroll-margin-top` 使用 */
function syncTopAreaHeight(height: number) {
  const rounded = Math.max(0, Math.round(height))
  topAreaHeight.value = rounded
  pageRootRef.value?.style.setProperty('--top-area-h', `${rounded}px`)
}

function observeTopArea(el: HTMLElement | null) {
  topAreaObserver?.disconnect()
  topAreaObserver = null
  if (!el) {
    syncTopAreaHeight(0)
    return
  }
  syncTopAreaHeight(el.getBoundingClientRect().height)
  if (typeof ResizeObserver === 'undefined') return
  topAreaObserver = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1]
    const blockSize = entry?.borderBoxSize?.[0]?.blockSize
    syncTopAreaHeight(blockSize ?? el.getBoundingClientRect().height)
  })
  topAreaObserver.observe(el)
}

watch(topAreaRef, (el) => observeTopArea(el), { flush: 'post' })

defineExpose({ scrollToSection })
</script>

<template>
  <div ref="pageRootRef" class="damage-page">
    <p v-if="draftSaveWarning" class="draft-save-warning" role="alert">{{ draftSaveWarning }}</p>
    <div ref="topAreaRef" class="team-slot-sticky" :class="{ 'is-folded': topAreaCollapsed }">
      <TeamSlotSwitcher
        v-if="!topAreaCollapsed"
        :team-slots="teamSlots"
        :agents="agents"
        :wengines="wengines"
        :drive-discs="driveDiscs"
        :active-index="activeSlot"
        :panel-previews="stickySlotPanelPreviews"
        :panel-source-kinds="slotPanelSourceKinds"
        :convert-slot-indexes="convertSlotIndexes"
        @select="selectSlot"
        @import="openTeamPresetPicker"
        @clear="clearSlot"
      />
      <div class="scheme-lib-actions">
        <template v-if="!topAreaCollapsed">
          <button type="button" class="scheme-lib-btn" @click="openSchemeLibrary">方案库</button>
          <button
            type="button"
            class="scheme-clear-btn"
            title="清空当前页面配置，不删除方案库里的存档"
            @click="clearCurrentScheme"
          >
            清空当前配置
          </button>
        </template>
        <!-- 右下角：收起 / 展开整个顶部准备区 -->
        <button
          type="button"
          class="scheme-fold-btn"
          :aria-expanded="!topAreaCollapsed"
          :title="
            topAreaCollapsed
              ? '展开顶部准备区（角色槽位 / 配装 / 方案库）'
              : '收起整个顶部准备区，只保留这颗按钮'
          "
          @click="toggleTopArea"
        >
          {{ topAreaCollapsed ? '展开' : '收起' }}
        </button>
      </div>
    </div>
    <UnifiedPresetPicker
      v-model:open="teamPresetPickerOpen"
      hide-trigger
      :agents="agents"
      :wengines="wengines"
      :drive-discs="driveDiscs"
      :team-slots="teamSlots"
      :active-slot="activeSlot"
      :slot-panels="slotPanels"
      :skill-talent-levels-by-agent="skillTalentLevelsByAgent"
      :final-panel-preview="activeFinalPanelPreview"
      :final-panel-token="importFinalPanelToken"
      :resolve-final-panel="resolveImportFinalPanel"
      :buff-attr-defaults="
        panelCalcSectionRef?.getAttrDefaultsForSlot?.(activeSlot) ??
        panelCalcSectionRef?.convertAttrDefaults ??
        {}
      "
      :buff-panel-source-values="
        panelCalcSectionRef?.getPanelSourceValuesForSlot?.(activeSlot) ??
        panelCalcSectionRef?.convertPanelSourceValues ??
        undefined
      "
      :buff-skill-talent-levels-by-agent="skillTalentLevelsByAgent"
      :buff-skill-subcategories="skillSubcategories"
      @confirm="applyUnifiedImport"
      @update:active-panel-source="setSlotPanelActiveSource"
    />
    <!-- 构图：方案库 → 编队/邦布 → 局内Buff → 敌方与环境 → 计算方式 → 伤害 → 招式流程 -->
    <DamageCalcHistorySection
      ref="historySectionRef"
      :entries="historyEntries"
      :agents="agents"
      :active-entry-id="activeHistoryId"
      :message="historyMessage"
      @save="saveHistoryEntry"
      @overwrite="overwriteHistoryEntry"
      @load="loadHistoryEntry"
      @changed="onSchemeLibraryChanged"
      @imported="onSchemeImported"
      @clear-loaded="onClearLoadedScheme"
    />

    <TeamBuilderSection
      :agents="agents"
      :wengines="wengines"
      :drive-discs="driveDiscs"
      :team-slots="teamSlots"
      :active-slot="activeSlot"
      :active-agent="activeAgent"
      :slot-panels="slotPanels"
      :skill-talent-levels-by-agent="skillTalentLevelsByAgent"
      :final-panel-preview="activeFinalPanelPreview"
      :final-panel-token="importFinalPanelToken"
      :resolve-final-panel="resolveImportFinalPanel"
      @update:active-panel-source="setSlotPanelActiveSource"
      @select-slot="selectSlot"
      @assign-agent="assignAgent"
      @clear-slot="clearSlot"
      @select-wengine="selectWengine"
      @confirm-import="applyUnifiedImport"
    />

    <BangbooPickerSection
      :bangboos="bangboos"
      :selected-id="selectedBangbooId"
      :refine="bangbooRefine"
      @select="selectBangboo"
      @update:refine="bangbooRefine = $event"
    />

    <section
      id="damage-combat-buff"
      class="calc-mode-section combat-buff-section damage-anchor"
    >
      <header class="calc-mode-header">
        <h2>
          局内 Buff 增益
          <InfoTip
            label="局内 Buff 说明"
            text="勾选局内 Buff、补充额外增益，并查看当前局内增益汇总。失衡判定跟招式流程条目走。"
          />
        </h2>
      </header>
      <div class="skill-context-row">
        <button type="button" class="buff-open-btn" @click="buffPickerOpen = true">
          选择局内 Buff（已选 {{ buffEnabledCount }} ）
        </button>
        <button type="button" class="buff-open-btn" @click="extraBuffModalOpen = true">
          额外 Buff 增益（已加 {{ extraGains.length }} ）
        </button>
        <p class="buff-set-hint">2件套数值均已自动配置，无需选择2件套。</p>
      </div>

      <details v-if="combatBuffBreakdown" class="buff-breakdown">
        <summary>查看局内增益汇总数值</summary>
        <ul class="mods-summary">
          <li v-for="field in BUFF_STAT_FIELDS" :key="field.key">
            <span>{{ buffStatFieldLabel(field) }}</span>
            <strong>{{ combatBuffBreakdown.totalMods[field.key] }}</strong>
          </li>
        </ul>
        <BuffModSourcesDisplay
          :sources="combatBuffBreakdown.sources"
          :skill-subcategories="skillSubcategories"
        />
      </details>
    </section>

    <ExtraBuffGainModal
      v-model:open="extraBuffModalOpen"
      v-model:gains="extraGains"
      :skill-subcategories="skillSubcategories"
      :team-slots="teamSlots"
      :agents="agents"
    />

    <BuffEffectPickerModal
      v-model:open="buffPickerOpen"
      v-model:multi-selection="multiSlotBuffSelection"
      v-model:view-slot-index="buffPickerViewSlotIndex"
      :effects="collectedEffectsForPicker"
      :configuration-parameters="buffPickerConfigurationParameters"
      :force-groups="envBuffForceGroups"
      :slot-options="buffPickerSlotOptions"
      :team-slots="teamSlots"
      :agents="agents"
      :attr-defaults="panelCalcSectionRef?.getAttrDefaultsForSlot?.(buffPickerViewSlotIndex) ?? panelCalcSectionRef?.convertAttrDefaults ?? {}"
      :panel-source-values="panelCalcSectionRef?.getPanelSourceValuesForSlot?.(buffPickerViewSlotIndex) ?? panelCalcSectionRef?.convertPanelSourceValues ?? undefined"
      :panel-source-values-by-slot="panelCalcSectionRef?.panelSourceValuesBySlot ?? undefined"
      :skill-talent-levels-by-agent="skillTalentLevelsByAgent"
      :skill-subcategories="skillSubcategories"
    >
      <template #environment-filter>
        <EnvironmentBuffFilterBar
          v-model:mode="envBuffMode"
          v-model:version="envBuffVersion"
          v-model:phase-id="envBuffPhaseId"
          v-model:frontier-id="envBuffFrontierId"
          v-model:node-id="envBuffNodeId"
          :phase-options="envPhaseOptions"
          :phase-label-mode="envBuffMode === 'deduction' ? 'deduction' : 'default'"
          :frontier-options="defenseFrontierOptions"
          :node-options="deductionNodeOptions"
          :hint="envBuffFilterHint"
        />
      </template>
    </BuffEffectPickerModal>

    <section id="damage-enemy" class="calc-mode-section enemy-env-section damage-anchor">
      <EnemyEnvironmentSection
        v-model="enemyInput"
        title="敌方与环境"
        description="选择 Boss 或手动录入防御、抗性与失衡倍率，供面板导入与最优词条共用。"
      />
    </section>

    <PanelCalcSection
      v-show="panelCalcMode !== 'optimal'"
      ref="panelCalcSectionRef"
      :flow-calculation-runtime="flowCalculationRuntime"
      :configuration-calculation-runtime="configurationCalculationRuntime"
      :calc-suspended="panelCalcMode === 'optimal'"
      :section-id="panelCalcMode !== 'optimal' ? 'damage-panel' : undefined"
      :team-slots="teamSlots"
      :agents="agents"
      :wengines="wengines"
      :bangboos="bangboos"
      :drive-discs="driveDiscs"
      :selected-bangboo-id="selectedBangbooId"
      :bangboo-refine="bangbooRefine"
      :edited-slot-index="activeSlot"
      :calc-mode="panelCalcMode === 'optimal' ? 'panel' : panelCalcMode"
      :damage-kind="damageKind"
      :anomaly-sub-kind="anomalySubKind"
      :trigger-anomaly-agent-id="triggerAnomalyAgentId"
      :slot-panels="slotPanels"
      :convert-slot-panels="convertSlotPanels"
      :skill-talent-levels-by-agent="skillTalentLevelsByAgent"
      :skill-category-id="skillCategoryId"
      :skill-subcategory-id="skillSubcategoryId"
      :slot-buff-selections="multiSlotBuffSelection"
      :stagger-phase="staggerPhase"
      :hits="hits"
      :preview-hits="previewHits"
      :environment-buffs="activeEnvironmentBuffs"
      :skill-flow-main-external-override="skillFlowMainExternalOverride"
      :skill-flow-source-extra-gains="skillFlowSourceExtraGains"
      v-model:base-damage-source="baseDamageSource"
      v-model:enemy-input="enemyInput"
      v-model:extra-gains="extraGains"
      @update:slot-panels="applySlotPanelPatch"
      @update:convert-slot-panels="Object.assign(convertSlotPanels, $event)"
      @update:hit-damages="hitDamages = $event"
      @update:hit-calc-results="hitCalcResults = $event"
    >
      <!-- 锚点常驻，招式流程经 Teleport 插入，避免双实例销毁重建 -->
      <template #after-setup>
        <div id="skill-flow-anchor-panel" class="skill-flow-anchor" />
      </template>
    </PanelCalcSection>

    <KeepAlive>
      <OptimalAffixAllocSection
        v-if="panelCalcMode === 'optimal'"
        ref="optimalAffixSectionRef"
        id="damage-panel"
        class="damage-anchor"
        :flow-calculation-runtime="flowCalculationRuntime"
        :active="panelCalcMode === 'optimal'"
        :team-slots="teamSlots"
        :agents="agents"
        :wengines="wengines"
        :bangboos="bangboos"
        :drive-discs="driveDiscs"
        :selected-bangboo-id="selectedBangbooId"
        :bangboo-refine="bangbooRefine"
        :edited-slot-index="activeSlot"
        :damage-kind="damageKind"
        :anomaly-sub-kind="anomalySubKind"
        :trigger-anomaly-agent-id="triggerAnomalyAgentId"
        :active-slot-panels="activeSlotPanels"
        :slot-panels="slotPanels"
        :skill-category-id="skillCategoryId"
        :skill-subcategory-id="skillSubcategoryId"
        :buff-selection="mainSlotBuffSelection"
        :slot-buff-selections="multiSlotBuffSelection"
        :stagger-phase="staggerPhase"
        :hits="hits"
        :preview-hits="previewHits"
        :environment-buffs="activeEnvironmentBuffs"
        :skill-flow-main-external-override="skillFlowMainExternalOverride"
        :skill-flow-source-extra-gains="skillFlowSourceExtraGains"
        :skill-talent-levels-by-agent="skillTalentLevelsByAgent"
        v-model:base-damage-source="baseDamageSource"
        v-model:enemy-input="enemyInput"
        v-model:extra-gains="extraGains"
        :convert-slot-panels="convertSlotPanels"
        @update:hit-damages="hitDamages = $event"
        @update:hit-calc-results="hitCalcResults = $event"
        @update:panel-source-options="skillFlowPanelOptions = $event"
        @update:display-panel-sources="displayPanelSources = $event"
      />
    </KeepAlive>

    <div
      id="skill-flow-anchor-optimal"
      v-show="panelCalcMode === 'optimal'"
      class="skill-flow-anchor"
    />

    <!-- 单实例 Teleport：面板时插在录入后，最优时插在模块后 -->
    <Teleport defer :to="skillFlowTeleportTo">
      <SkillFlowSection
        ref="skillFlowSectionRef"
        :team-slots="teamSlots"
        :agents="agents"
        :hits="hits"
        :hit-damages="hitDamages"
        :hit-calc-results="hitCalcResults"
        :resolve-calculation-detail="resolveFlowCalculationDetail"
        :buff-effects="collectedEffectsForFlowTable"
        :buff-effect-texts="flowBuffEffectTexts"
        :buff-effect-text-for="flowBuffEffectTextFor"
        :buff-effect-note-for="flowBuffRecipientNoteFor"
        :convert-resolve-inputs="buffConvertResolveInputsForSlot"
        :multi-buff-selection="multiSlotBuffSelection"
        :skill-talent-levels-by-agent="skillTalentLevelsByAgent"
        :scheme-name="currentSchemeName"
        :slot-meta="recordSlotMeta"
        :panel-source-mode="skillFlowPanelSource"
        :panel-source-availability="skillFlowPanelAvailability"
        :display-panel-sources="displayPanelSources"
        :config-panel-preview="configPanelPreviewForSkillFlow"
        @update:panel-source-mode="skillFlowPanelSource = $event"
        v-model:slots="schemeSlots"
        v-model:edited-slot-index="activeSlot"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.damage-page {
  display: flex;
  flex-direction: column;
  gap: 1.35rem;
}

.draft-save-warning {
  margin: 0;
  padding: 0.55rem 0.8rem;
  border-radius: 8px;
  border: 1px solid #7a4a2a;
  background: rgba(160, 90, 40, 0.18);
  color: #f0c9a8;
  font-size: 0.82rem;
  line-height: 1.5;
}

.team-slot-sticky {
  position: sticky;
  top: 0;
  z-index: 30;
  overflow: visible;
  display: flex;
  align-items: stretch;
  gap: 0.65rem;
  width: calc(100% + 2rem);
  margin: 0 -1rem 0;
  padding: 0.55rem 1rem 0.6rem;
  border: none;
  border-bottom: 1px solid rgba(201, 165, 92, 0.35);
  border-radius: 0;
  background: linear-gradient(180deg, #1c222c 0%, #151920 100%);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.04) inset,
    0 8px 20px rgba(0, 0, 0, 0.28);
}

.team-slot-sticky :deep(.team-slot-switcher) {
  flex: 1;
  min-width: 0;
}

.scheme-lib-actions {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
  gap: 0.28rem;
  padding-left: 0.55rem;
  border-left: 1px solid rgba(201, 165, 92, 0.22);
}

.scheme-lib-btn,
.scheme-clear-btn,
.scheme-fold-btn {
  appearance: none;
  border-radius: 8px;
  font: inherit;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: none;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;
  padding: 0.38rem 0.8rem;
  font-size: 0.78rem;
  border: 1px solid #343a44;
  background: #12161d;
  color: #d5dae4;
}

.scheme-lib-btn:hover,
.scheme-clear-btn:hover,
.scheme-fold-btn:hover {
  border-color: #c9a55c;
  color: #f0d7a2;
  background: #161b24;
}

/* 收起 / 展开：比上面两颗轻一档，收起来以后它就是这一条唯一的按钮 */
.scheme-fold-btn {
  padding: 0.26rem 0.8rem;
  font-size: 0.74rem;
  font-weight: 600;
  border-color: #4c5563;
  background: transparent;
  color: #c3ccdb;
}

.scheme-fold-btn:hover {
  border-color: rgba(214, 178, 104, 0.7);
  background: rgba(201, 165, 92, 0.16);
  color: #ffe9bd;
}

/* 收起后整条只剩右下角那颗按钮 */
.team-slot-sticky.is-folded {
  justify-content: flex-end;
  align-items: center;
  padding: 0.35rem 1rem 0.4rem;
}

.team-slot-sticky.is-folded .scheme-lib-actions {
  justify-content: flex-end;
}

.skill-flow-anchor {
  /* Teleport 挂载点：保持块级容器，避免 display:contents 在部分浏览器下丢子树 */
  min-height: 0;
}

.damage-page :deep(.damage-anchor) {
  /* 顶栏高度由 ResizeObserver 写到 --top-area-h（展开/收起、换行、提示条都会自动跟上） */
  scroll-margin-top: calc(var(--top-area-h, 4.2rem) + 0.6rem);
}

/*
 * 远距离瞬移落地提示：只画 outline，不参与布局、不触发重排。
 * 由 scrollToSection() 在瞬移后临时挂 1 秒。
 */
.damage-page :deep(.damage-anchor.nav-landed) {
  animation: nav-landed-flash 1s ease-out 1;
}

@keyframes nav-landed-flash {
  0% {
    outline: 2px solid rgba(201, 165, 92, 0.9);
    outline-offset: 2px;
  }
  100% {
    outline: 2px solid rgba(201, 165, 92, 0);
    outline-offset: 2px;
  }
}

.calc-mode-section {
  border: 1px solid #343a44;
  border-radius: 14px;
  background: linear-gradient(180deg, #1a1e26 0%, #12151a 100%);
  padding: 1.05rem 1.1rem 1.15rem;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.04) inset,
    0 10px 28px rgba(0, 0, 0, 0.22);
}

.calc-mode-section + .calc-mode-section,
.damage-page > .opt-section,
.damage-page > :deep(.panel-section),
.damage-page > :deep(.history-section),
.damage-page > :deep(.team-section),
.damage-page > :deep(.upload-section) {
  position: relative;
}

.calc-mode-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.65rem 1rem;
}

.calc-mode-header h2 {
  margin: 0;
  font-size: 1.05rem;
  color: #f0f2f6;
}


.calc-mode-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.calc-mode-tab {
  border: 1px solid #2d323a;
  border-radius: 999px;
  background: #0f1217;
  color: #d5dae4;
  padding: 0.35rem 0.95rem;
  font-size: 0.84rem;
  cursor: pointer;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.calc-mode-tab.active {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.14);
  color: #f0d7a2;
  font-weight: 600;
}

/* 【临时冻结 · 2026-09-11】「面板导入 / 词条导入」停用态：仍在原位，但明确不可点 */
.calc-mode-tab--frozen,
.calc-mode-tab--frozen:hover {
  border-color: #23272e;
  background: #0c0e12;
  color: #5b6270;
  cursor: not-allowed;
  text-decoration: line-through;
  text-decoration-color: rgba(91, 98, 112, 0.8);
}

.skill-context-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.25rem;
  margin-top: 0;
  align-items: center;
}

.combat-buff-section {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.enemy-env-section :deep(.enemy-environment) {
  margin-top: 0;
  border: none;
  padding: 0;
  background: transparent;
}

.combat-buff-section .buff-breakdown {
  border: 1px solid #2d323a;
  border-radius: 10px;
  padding: 0.55rem 0.75rem;
  background: #0f1217;
}

.combat-buff-section .buff-breakdown summary {
  cursor: pointer;
  color: #d5dae4;
  font-size: 0.86rem;
}

.combat-buff-section .mods-summary {
  list-style: none;
  margin: 0.65rem 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  gap: 0.35rem 0.75rem;
}

.combat-buff-section .mods-summary li {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.78rem;
  color: #9aa3b0;
}

.combat-buff-section .mods-summary strong {
  color: #e8edf5;
  font-weight: 600;
}

.buff-open-btn {
  align-self: center;
  border: 1px solid #c9a55c;
  border-radius: 8px;
  background: rgba(201, 165, 92, 0.14);
  color: #f0d7a2;
  padding: 0.45rem 0.85rem;
  font-size: 0.84rem;
  cursor: pointer;
}

.buff-set-hint {
  align-self: center;
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: #9aa3b0;
  flex: 1 1 12rem;
  min-width: 0;
}

@media (max-width: 768px) {
  .damage-page {
    gap: 0.75rem;
  }

  .damage-page :deep(.damage-anchor) {
    /* 窄屏同样吃测量值，只把间隙收小（原来写死 0.65rem，会把顶栏高度漏掉） */
    scroll-margin-top: calc(var(--top-area-h, 4.2rem) + 0.35rem);
  }

  .calc-mode-section {
    padding: 0.75rem;
  }

  .calc-mode-header h2 {
    font-size: 0.98rem;
  }


  .calc-mode-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
  }

  .calc-mode-tab {
    width: 100%;
    min-height: 2.4rem;
    border-radius: 8px;
    text-align: center;
  }
}
</style>
