<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { type ExtraBuffGain } from '@/components/calculator/ExtraBuffGainEditor.vue'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type {
  AgentBuffDoc,
  AnomalyDamageSubKind,
  BangbooBuffDoc,
  BaseDamageSource,
  BuffStatKey,
  BuffStatModifiers,
  CharacterAttrKey,
  DriveDiscBuffDoc,
  WengineBuffDoc,
} from '@/types/calculator'
import type { DamageCalcPanelSnapshot, DamageCalcSchemePanelSnapshot } from '@/types/damageCalcHistory'
import {
  applyAgentBaseToPanelStats,
  createDefaultExternalPanel,
  createEmptyAffixCounts,
  createEmptyAffixDriveDiscMainStats,
  createEmptyExternalPanel,
  createExternalPanelFromAgentBase,
  fillPanelStatsDefaults,
  type AffixCounts,
  type AffixDriveDiscMainStats,
  type PanelCalcMode,
  type PanelStats,
} from '@/types/calculatorPanel'
import {
  panelOfSource,
  resolveActivePanel,
} from '@/utils/agentPanelSources'
import type { AgentPanelSources } from '@/types/damageCalcHistory'
import {
  BUFF_STAT_FIELDS,
  buffStatFieldLabel,
  createEmptyBuffStatModifiers,
  createEmptyRefinementMods,
} from '@/utils/calculatorUi'
import {
  applyConvertPartialToExternalPanel,
  buildPanelSourceValuesBySlotRecord,
  computeFinalPanel,

  convertSlotPartialToExternalPanel,
  panelToConvertAttrValues,
  resolveBuffSelectionForSlot,
  resolveAnomalyReleaseMultFields,

  type ConvertSlotPanels,
  type MultiSlotBuffSelection,
} from '@/utils/panelBuffCalc'
import {


  type DamageCalcResult,
} from '@/utils/damageCalc'
import {
  normalizeDamageEnemyInput,
  type DamageEnemyInput,
} from '@/utils/enemyResistance'
import {
  DAMAGE_EVENT_KIND_OPTIONS,
  disorderLabelFromResult,
} from '@/utils/damageEvent'
import {
  buildGenericPanelSkillContext,

  type HitLine,
  type ResolvedHit,
} from '@/utils/resolvedHit'
import {
  buildOptimalEvalContext,
  evaluateOptimalEventDetail,
} from '@/utils/optimalAffixAlloc'
import {
  buildHitEvalFingerprint,
  hitEvalCacheKey,
  internHitEvalContext,
  readHitEvalCache,
  writeHitEvalCache,
  type HitEvalCacheEntry,
} from '@/utils/hitEvalCache'
import {
  mergeExtraModsForEvent,
  normalizeExtraGain,
} from '@/utils/extraBuffCalc'
import {




} from '@/utils/remielUtils'
import {

} from '@/utils/remielSelfRadiancePanel'

import {

} from '@/utils/anomalyFormulaDisplay'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'

const MB_PROFESSION = '命破'
const FENGYU_PROFESSION = '锋御'

const emptyBangboo: BangbooBuffDoc = {
  id: 'none',
  name: '未选择',
  avatar_image: null,
  effects: [],
  refinementEffects: createEmptyRefinementMods().map(() => []),
  fixedMods: createEmptyBuffStatModifiers(),
  refinementMods: createEmptyRefinementMods(),
}

const props = defineProps<{
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  wengines: WengineBuffDoc[]
  bangboos: BangbooBuffDoc[]
  driveDiscs: DriveDiscBuffDoc[]
  selectedBangbooId: string
  bangbooRefine: number
  /** 计算页正在编辑的编队槽位；局外面板跟这个人走 */
  editedSlotIndex: number
  calcMode: PanelCalcMode
  sectionId?: string
  damageKind?: import('@/types/calculator').DamageCalcKind
  anomalySubKind?: AnomalyDamageSubKind
  /**
   * 页级异常强度提供者 id（第一击 anomalyPowerAgentId）。
   * 命名含 trigger，实为 power；逐 hit 结算请用 hit.anomalyPowerAgentId / hit.triggerAgentId。
   */
  triggerAnomalyAgentId?: string | null
  /**
   * 各角色的**两份局外面板**（面板导入 / 词条导入 + 当前激活那份），key = agentId。
   *
   * 面板录入（两个子页 + 截图识别）在导入弹窗 `UnifiedPresetPicker` 里，本组件只按来源读取；
   * 计算链路只取激活那份（`resolveActivePanel`），不问来历。
   */
  slotPanels?: Record<string, AgentPanelSources>
  /** 转模增益角色局外面板（仅转模来源属性），key = agentId */
  convertSlotPanels?: ConvertSlotPanels
  skillCategoryId?: import('@/types/calculator').SkillCategoryId
  skillSubcategoryId?: string | null
  slotBuffSelections?: MultiSlotBuffSelection | null
  staggerPhase?: import('@/types/calculator').StaggerPhase
  /** 流程展开后的结算列表，来自 resolveFlow */
  hits?: ResolvedHit[]
  /** 准备招式的单次预览，不计入流程总伤 */
  previewHits?: ResolvedHit[]
  /** 为 true 时跳过伤害事件汇总等非必要重算（如最优词条模式） */
  calcSuspended?: boolean
  /** 环境 / 场地 Buff（危局全局、Boss 场地、防卫房间） */
  environmentBuffs?: import('@/utils/environmentBuffCalc').EnvironmentBuffEntry[]
  /**
   * 当前编辑角色的局外面板覆盖值（招式流程三选项的「词条分析」两态）。
   *
   * 为 null / 省略时用角色配置那份激活面板。见 `utils/skillFlowPanelSource.ts`。
   */
  skillFlowMainExternalOverride?: PanelStats | null
}>()

const extraGains = defineModel<ExtraBuffGain[]>('extraGains', { default: () => [] })

const emit = defineEmits<{
  /** 只传变化的那些 agentId（补丁），页级按 key 合并。**当前组件内无 emit 点**，保留声明以对齐页级接线 */
  'update:slotPanels': [patch: Record<string, AgentPanelSources>]
  /**
   * 当前组件内已无 emit 点（换人自动刷新转模面板已删除——面板只有「确定导入」能写，
   * 见 dev-docs/affix-calc-manual.md §1.2；旧数据经页级接线读回），保留声明以对齐页级接线。
   */
  'update:convertSlotPanels': [value: ConvertSlotPanels]
  'update:hitDamages': [value: Record<string, number>]
  'update:hitCalcResults': [value: Record<string, DamageCalcResult>]
}>()

/**
 * 基础伤害来源：**页级共享**（`v-model:baseDamageSource`）。
 *
 * 原先两个 section 各存一份，同一个概念在两处可各选各的；招式流程三选项要求
 * 「同一份配置只对应一份面板」，因此收到页级（也让页级签名能覆盖它）。
 */
const baseDamageSource = defineModel<BaseDamageSource>('baseDamageSource', { default: 'atk' })
const damageEventSummary = ref<{ lines: HitLine[]; grandTotal: number } | null>(null)
const HIT_RESULT_DEBOUNCE_MS = 80
let hitSummarySyncTimer: ReturnType<typeof setTimeout> | null = null
/**
 * calcSuspended 解除后延后恢复伤害汇总，避免切回面板时同步卡死。
 * 首帧保持 false→true 与挂起态对齐：挂起时关闭，恢复时双 rAF 后再开。
 */
const damageCalcEnabled = ref(!props.calcSuspended)
watch(
  () => props.calcSuspended,
  (suspended) => {
    if (suspended) {
      damageCalcEnabled.value = false
      return
    }
    damageCalcEnabled.value = false
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!props.calcSuspended) damageCalcEnabled.value = true
      })
    })
  },
)
const externalPanel = reactive<PanelStats>(createDefaultExternalPanel())
const affixCounts = reactive(createEmptyAffixCounts())
const affixDriveDiscMainStats = reactive(createEmptyAffixDriveDiscMainStats())

type AgentAffixState = {
  affixCounts: AffixCounts
  affixDriveDiscMainStats: AffixDriveDiscMainStats
}

function applyAffixState(state: AgentAffixState | undefined) {
  Object.assign(affixCounts, createEmptyAffixCounts(), state?.affixCounts)
  Object.assign(
    affixDriveDiscMainStats,
    createEmptyAffixDriveDiscMainStats(),
    state?.affixDriveDiscMainStats,
  )
}

function slotAffixState(slot: TeamSlot | undefined): AgentAffixState | undefined {
  const sources = slot?.agentId ? props.slotPanels?.[slot.agentId] : undefined
  if (!sources?.affixDriveDiscMainStats && !sources?.affixCounts) return undefined
  return {
    affixCounts: { ...createEmptyAffixCounts(), ...sources.affixCounts },
    affixDriveDiscMainStats: {
      ...createEmptyAffixDriveDiscMainStats(),
      ...sources.affixDriveDiscMainStats,
    },
  }
}

function loadAffixFromCurrentSlot() {
  const fromSlot = slotAffixState(props.teamSlots[mainSlotIndex.value])
  if (fromSlot) {
    applyAffixState(fromSlot)
    return
  }
  if (suppressRestoreResets) return
  applyAffixState(undefined)
}



/** 局内通用面板上的额外 Buff：只吃通用，不跟流程第一条招式走 */
function buildExtraModsForMainPanel(): BuffStatModifiers {
  if (!extraGains.value.length) return createEmptyBuffStatModifiers()
  const mainId = mainAgent.value?.id ?? ''
  const phase = props.staggerPhase ?? 'stagger'
  return mergeExtraModsForEvent(
    extraGains.value,
    buildGenericPanelSkillContext({
      element: mainAgent.value?.element,
      staggerPhase: phase,
    }),
    {
      slotIndex: mainSlotIndex.value,
      slotAgentId: mainId,
      staggerPhase: phase,
      resolveAgentProfession: (agentId) =>
        props.agents.find((item) => item.id === agentId)?.profession,
      teamSlots: props.teamSlots,
      agents: props.agents,
    },
  )
}

const extraMods = computed(() => buildExtraModsForMainPanel())

const enemyInput = defineModel<DamageEnemyInput>('enemyInput', { required: true })


/** 当前正在编辑的编队槽位（点选代理人卡片） */
const mainSlotIndex = computed(() => {
  const index = props.editedSlotIndex
  if (index >= 0 && index < props.teamSlots.length) return index
  return 0
})

const mainSlot = computed(() => props.teamSlots[mainSlotIndex.value]!)

const mainAgent = computed(() =>
  props.agents.find((item) => item.id === mainSlot.value.agentId),
)

const { skillSubcategories, followUpSkillRules } = storeToRefs(useCalculatorBuffStore())


/**
 * 每个角色**激活那份**局外面板 —— 计算链路唯一的取面板入口。
 * 来源（面板导入 / 词条导入）到这里就解析完了，下游不再区分。
 */
const resolvedActiveSlotPanels = computed<Record<string, PanelStats>>(() => {
  const map: Record<string, PanelStats> = {}
  for (const [agentId, sources] of Object.entries(props.slotPanels ?? {})) {
    const panel = resolveActivePanel(sources)
    if (panel) map[agentId] = panel
  }
  return map
})

/**
 * 编辑中那个人的局外面板 —— 显示与计算唯一的取面板入口。
 *
 * 只读**激活那份**（面板导入 / 词条导入同等对待），不看「面板导入 / 词条导入」两个 tab，
 * 也不问来历。改造前这里按 `calcMode === 'affix'` 分流（词条模式读现推值、面板模式读
 * live 编辑器），于是那两个 tab 会**悄悄改掉算进去的面板**——实测同一份激活面板下，
 * 只因为 tab 停在「面板导入」而不是「词条导入」，局内攻击就从 3883 变成 6136
 * （2026-09-11 复现，见 `dev-docs/affix-calc-manual.md` §2）。
 */
const effectiveExternalPanel = computed<PanelStats>(() => {
  const id = mainAgent.value?.id
  const active = id ? resolveActivePanel(props.slotPanels?.[id]) : undefined
  if (active) return active
  // 该角色没有面板记录 → 空面板：没有面板就不出伤害（不再拿 live 编辑器/占位面板顶替）
  return createEmptyExternalPanel()
})

const isAffixMode = computed(() => props.calcMode === 'affix')

/**
 * 当前角色**没有面板**（两份都没数据，也没有转模部分面板）。
 *
 * 这时计算拿到的是一份空面板（全 0）→ 不出伤害。给界面一句提示，别让人对着 0 猜
 * （「没点导入就没有面板」+「没有面板就没有伤害」= 所有者口径 2026-09-12）。
 */
const mainPanelMissing = computed(() => {
  const id = mainAgent.value?.id
  if (!id) return false
  if (resolveActivePanel(props.slotPanels?.[id])) return false
  return !props.convertSlotPanels?.[id]
})

const isMbMainAgent = computed(() => mainAgent.value?.profession === MB_PROFESSION)
const isFengYuMainAgent = computed(() => mainAgent.value?.profession === FENGYU_PROFESSION)

const selectedBangboo = computed(
  () =>
    props.bangboos.find((item) => item.id === props.selectedBangbooId) ??
    props.bangboos.find((item) => item.id === 'none') ??
    emptyBangboo,
)

const effectiveBaseDamageSource = computed<BaseDamageSource>(() => {
  if (isMbMainAgent.value) return 'pierce'
  if (isFengYuMainAgent.value) return 'def'
  return baseDamageSource.value
})

const convertAttrDefaults = computed<Partial<Record<CharacterAttrKey, number>>>(() =>
  panelToConvertAttrValues(effectiveExternalPanel.value, { level: 60, pierceMod: 0 }),
)

/**
 * 某槽位的局外面板 —— **只认该角色自己存着的那份（激活那份）**。
 *
 * 没有面板记录时给**空面板**（全 0），不给占位毕业面板、也不拿 live 编辑器顶替：
 * 没有面板就不该算出伤害（所有者口径 2026-09-12）。
 * 转模角色走 `convertSlotPanels`（转模面板维持现状，不属于「面板导入」那条线）。
 */
function resolveExternalPanelForSlotIndex(slotIndex: number): PanelStats {
  const agentId =
    slotIndex >= 0 && slotIndex < props.teamSlots.length
      ? props.teamSlots[slotIndex]?.agentId
      : undefined
  if (!agentId) return createEmptyExternalPanel()
  const active = resolveActivePanel(props.slotPanels?.[agentId])
  if (active) return active
  const partial = props.convertSlotPanels?.[agentId]
  if (partial) return convertSlotPartialToExternalPanel(partial)
  return createEmptyExternalPanel()
}

/** 每人一份局外，供全队转模按来源槽位取值（不要拿编辑中角色的面板去套队友） */
const slotExternalPanelsMap = computed<Record<number, PanelStats>>(() => {
  const map: Record<number, PanelStats> = {}
  props.teamSlots.forEach((slot, index) => {
    if (!slot.agentId) return
    map[index] = resolveExternalPanelForSlotIndex(index)
  })
  return map
})


function resolveBuffMatchElementForSlot(slotIndex: number): string | undefined {
  const agent = props.agents.find((item) => item.id === props.teamSlots[slotIndex]?.agentId)
  return agent?.element
}


function buildSkillContextForSlot(slotIndex: number) {
  const agent = props.agents.find((item) => item.id === props.teamSlots[slotIndex]?.agentId)
  return buildGenericPanelSkillContext({
    element: resolveBuffMatchElementForSlot(slotIndex) ?? agent?.element ?? mainAgent.value?.element,
    staggerPhase: props.staggerPhase ?? 'stagger',
  })
}

function buildPanelCalcContextForSlot(
  slotIndex: number,
  extraModsOverride?: BuffStatModifiers,
) {
  return {
    teamSlots: props.teamSlots,
    agents: props.agents,
    wengines: props.wengines,
    bangboo: selectedBangboo.value,
    bangbooRefine: props.bangbooRefine,
    mainSlotIndex: slotIndex,
    liveExternalSlotIndex: mainSlotIndex.value,
    driveDiscs: props.driveDiscs,
    extraMods: extraModsOverride ?? extraMods.value,
    extraGains: extraGains.value,
    skillContext: buildSkillContextForSlot(slotIndex),
    buffSelection: resolveBuffSelectionForSlot(props.slotBuffSelections, slotIndex),
    // 已解析的激活面板（每人一份）：引擎侧不再知道「来源」这回事
    activeSlotPanels: resolvedActiveSlotPanels.value,
    convertSlotPanels: props.convertSlotPanels,
    slotExternalPanels: slotExternalPanelsMap.value,
    mainExternalPanel: resolveExternalPanelForSlotIndex(mainSlotIndex.value),
    attrValues: getAttrDefaultsForSlot(slotIndex),
    environmentBuffs: props.environmentBuffs,
  }
}

function getAttrDefaultsForSlot(slotIndex: number) {
  const external = resolveExternalPanelForSlotIndex(slotIndex)
  const agentId = props.teamSlots[slotIndex]?.agentId
  const partial = agentId ? props.convertSlotPanels?.[agentId] : undefined
  const level =
    partial?.level ??
    (slotIndex === mainSlotIndex.value
      ? enemyInput.value.level
      : agentId
        ? resolveAgentLevel(agentId)
        : 60)
  return panelToConvertAttrValues(external, { level, pierceMod: 0 })
}

function getPanelSourceValuesForSlot(slotIndex: number) {
  const record = buildPanelSourceValuesBySlotRecord(
    buildPanelCalcContextForSlot(slotIndex),
    resolveExternalPanelForSlotIndex(slotIndex),
  )
  return record[slotIndex]
}

/**
 * 某角色当前生效的那份面板；一份都没有时给**空面板**。
 *
 * 不拿角色基础面板或另一份面板顶替（所有者口径 2026-09-12：空就是空，界面提示去录入）——
 * 凭空造一份会让用户以为面板已经配好，还会被当成真数据写盘。
 */

function applyAgentBaseToExternalPanel(base: PanelStats | AgentBuffDoc['basePanel']) {
  applyAgentBaseToPanelStats(externalPanel, base)
}


const triggerAgent = computed(() =>
  props.agents.find((item) => item.id === props.triggerAnomalyAgentId),
)

function resolveAgentLevel(agentId: string | null | undefined): number {
  if (!agentId || agentId === mainAgent.value?.id) {
    return enemyInput.value.level
  }
  const saved = props.convertSlotPanels?.[agentId]?.level
  return typeof saved === 'number' && saved >= 1 ? saved : 60
}


const needsTriggerPanel = computed(() => {
  const sub = props.anomalySubKind
  return (
    props.damageKind === 'anomaly' &&
    (sub === 'turbulence' ||
      sub === 'anomalyRelease' ||
      sub === 'disorder' ||
      sub === 'radiance')
  )
})

/** 异放/乱流/耀变时伤害属性跟随触发角色；否则用当前编辑角色（流明不作等价属性替换，等价属性仅用于抗性区） */
const damageElement = computed(() => {
  if (needsTriggerPanel.value && triggerAgent.value?.element) {
    return triggerAgent.value.element
  }
  return mainAgent.value?.element
})

/** 追踪转模局外面板深层变更，确保局内增益展示重算 */
const convertSlotPanelsSignature = computed(() =>
  JSON.stringify(props.convertSlotPanels ?? {}),
)

const slotBuffSelectionsSignature = computed(() =>
  JSON.stringify(props.slotBuffSelections ?? {}),
)

const panelBreakdown = computed(() => {
  void convertSlotPanelsSignature.value
  void slotBuffSelectionsSignature.value
  return computeFinalPanel(
    effectiveExternalPanel.value,
    buildPanelCalcContextForSlot(mainSlotIndex.value),
  )
})

const finalPanel = computed(() => {
  const panel = { ...panelBreakdown.value.finalPanel }
  if (
    !props.hits?.length &&
    props.damageKind === 'anomaly' &&
    (props.anomalySubKind ?? 'anomaly') === 'anomalyRelease'
  ) {
    const fields = resolveAnomalyReleaseMultFields(
      effectiveExternalPanel.value,
      {
        ...buildPanelCalcContextForSlot(mainSlotIndex.value),
        skillContext: {
          ...buildSkillContextForSlot(mainSlotIndex.value),
          damageKind: 'anomaly',
          anomalySubKind: 'anomalyRelease',
          element: damageElement.value,
        },
      },
      damageElement.value ?? undefined,
    )
    panel.anomalyReleaseMult = fields.anomalyReleaseMult
    panel.anomalyReleaseMultFactor = fields.anomalyReleaseMultFactor
  }
  return panel
})

const convertPanelSourceValues = computed(() => ({
  external: panelToConvertAttrValues(effectiveExternalPanel.value, { level: 60, pierceMod: 0 }),
  final: panelToConvertAttrValues(finalPanel.value, {
    level: 60,
    pierceMod: panelBreakdown.value.totalMods.pierce,
  }),
}))

const panelSourceValuesBySlot = computed(() => {
  void convertSlotPanelsSignature.value
  void slotBuffSelectionsSignature.value
  return buildPanelSourceValuesBySlotRecord(
    buildPanelCalcContextForSlot(mainSlotIndex.value),
    effectiveExternalPanel.value,
  )
})








/** 导入确认后：刷新 live 面板编辑器 —— 面板页编辑的是「面板导入」那份，故按该来源取数 */
function syncLivePanelFromCommitted() {
  loadAffixFromCurrentSlot()
  const id = mainAgent.value?.id
  if (!id || isAffixMode.value) return
  const saved = panelOfSource(props.slotPanels?.[id], 'imported')
  if (saved) {
    Object.assign(externalPanel, createDefaultExternalPanel(), saved)
  }
}

watch(
  [isMbMainAgent, isFengYuMainAgent],
  ([isMb, isFengYu], [prevMb, prevFengYu]) => {
    if (isMb) {
      baseDamageSource.value = 'pierce'
    } else if (isFengYu) {
      baseDamageSource.value = 'def'
    } else if (prevMb || prevFengYu) {
      // 从命破/锋御切回普通职业：必须复位，否则残留 def/pierce 会让普通角色拿错基础伤害
      baseDamageSource.value = 'atk'
    }
  },
  { immediate: true },
)

/** 读盘/恢复方案时禁止换人 watch 把词条主属性、局外面板冲成默认值 */
let suppressRestoreResets = 0

function beginRestore() {
  suppressRestoreResets += 1
}

function endRestore() {
  suppressRestoreResets = Math.max(0, suppressRestoreResets - 1)
}

watch(
  () => props.editedSlotIndex,
  (newIdx, oldIdx) => {
    if (suppressRestoreResets) return
    if (oldIdx == null || oldIdx === newIdx) return
    loadAffixFromCurrentSlot()
    // 换槽后立刻把当前槽已提交局外灌进 live，供快照/兼容路径使用
    if (!isAffixMode.value) {
      const newId = props.teamSlots[newIdx]?.agentId
      const saved = newId ? panelOfSource(props.slotPanels?.[newId], 'imported') : undefined
      if (saved) {
        Object.assign(externalPanel, createDefaultExternalPanel(), saved)
      }
    }
  },
)

watch(
  () => mainAgent.value?.id,
  (newId, oldId) => {
    if (suppressRestoreResets) return

    if (!mainAgent.value || !newId) return

    loadAffixFromCurrentSlot()

    // 首次挂载不要覆盖方案/草稿里已经灌进编辑器的局外面板。
    if (!oldId) {
      const savedAnomaly = panelOfSource(props.slotPanels?.[newId], 'imported')
      if (savedAnomaly) {
        Object.assign(externalPanel, createDefaultExternalPanel(), savedAnomaly)
        return
      }
      const savedConvert = props.convertSlotPanels?.[newId]
      if (savedConvert && Object.keys(savedConvert).length > 0) {
        applyAgentBaseToExternalPanel(mainAgent.value.basePanel)
        applyConvertPartialToExternalPanel(savedConvert, externalPanel)
        return
      }
      // 没有任何存着的面板：保持空（不拿角色基础面板充数，界面提示去录入）
      return
    }

    const savedAnomaly = panelOfSource(props.slotPanels?.[newId], 'imported')
    if (savedAnomaly) {
      Object.assign(externalPanel, createDefaultExternalPanel(), savedAnomaly)
      return
    }

    const savedConvert = props.convertSlotPanels?.[newId]
    if (savedConvert && Object.keys(savedConvert).length > 0) {
      Object.assign(externalPanel, createExternalPanelFromAgentBase(mainAgent.value.basePanel))
      applyConvertPartialToExternalPanel(savedConvert, externalPanel)
      return
    }

    // 换到的人没有任何面板：清空，等用户去「导入」录入
    Object.assign(externalPanel, createDefaultExternalPanel())
  },
  { immediate: true },
)




/**



/**
 * 面板计算链路用的统一评估上下文（`计算方式 = 面板导入 / 词条导入`）。
 *
 * 招式伤害只认「上下文 + 当前编辑角色的局外面板」，「面板从哪来」由 `skillFlowMainExternal` 决定 ——
 * 这条链路与最优词条分配链路共用同一段招式计算，见 `dev-docs/affix-calc-manual.md` §4（计算链路统一·步骤①~④）。
 */
const skillFlowEvalCtx = computed(() =>
  buildOptimalEvalContext({
    isMb: isMbMainAgent.value,
    isFengYu: isFengYuMainAgent.value,
    teamSlots: props.teamSlots,
    agents: props.agents,
    wengines: props.wengines,
    bangboo: selectedBangboo.value,
    bangbooRefine: props.bangbooRefine,
    driveDiscs: props.driveDiscs,
    mainSlotIndex: mainSlotIndex.value,
    driveDiscMainStats: affixDriveDiscMainStats,
    enemyInput: enemyInput.value,
    baseDamageSource: effectiveBaseDamageSource.value,
    extraGains: extraGains.value,
    buffSelection: resolveBuffSelectionForSlot(props.slotBuffSelections, mainSlotIndex.value),
    slotBuffSelections: props.slotBuffSelections,
    activeSlotPanels: resolvedActiveSlotPanels.value,
    convertSlotPanels: props.convertSlotPanels,
    // 非当前编辑槽位沿用本组件那份解析（激活面板 → 转模部分面板 → 空面板），
    // 与改造前逐位一致（引擎默认解析的回落不同，不能让它接管）
    slotExternalPanels: slotExternalPanelsMap.value,
    hits: props.hits,
    triggerAnomalyAgentId: props.triggerAnomalyAgentId,
    resolveSubcategory: (id) => skillSubcategories.value.find((item) => item.id === id) ?? null,
    skillSubcategories: skillSubcategories.value,
    followUpSkillRules: followUpSkillRules.value,
    environmentBuffs: props.environmentBuffs,
  }),
)

/**
 * 主 C 局外面板：默认取角色配置里那份激活面板；
 * 选了「词条分析」两态时用页级下发的覆盖值（同一份数值两个消费者共用）。
 */
const skillFlowMainExternal = computed(
  () => props.skillFlowMainExternalOverride ?? resolveExternalPanelForSlotIndex(mainSlotIndex.value),
)


/**
 * 「配置变了没」的指纹：**必须从响应式来源直接读**。
 *
 * 教训（2026-09-11 实测）：先前用 `buildHitEvalContextSignature(ctx)` 直接从上下文取，
 * 但上下文里的对象是深解包后的**原始对象**（不经过响应式代理），读它**不会**建立依赖 ——
 * 于是改了敌方防御等参数后这个 computed 不重算、键不变、命中旧结果，界面数字纹丝不动。
 * 所以这里保留按响应式来源逐项读取的写法（改造前即如此），键里的「用的是哪份面板」
 * 另有 `mainExternal` 承担。
 */
const hitCalcGlobalSignature = computed(() =>
  JSON.stringify({
    src: baseDamageSource.value,
    slots: props.teamSlots.map((slot, index) => [
      slot.agentId,
      slot.rank,
      slot.wengineId,
      slot.wengineRefine,
      slot.twoPieceDriveDiscId,
      slot.fourPieceDriveDiscId,
      index === props.editedSlotIndex
        ? ''
        : JSON.stringify(
            resolveActivePanel(slot.agentId ? props.slotPanels?.[slot.agentId] : undefined) ?? null,
          ),
    ]),
    bangboo: [props.selectedBangbooId, props.bangbooRefine],
    edit: props.editedSlotIndex,
    mode: props.calcMode,
    stagger: props.staggerPhase,
    kind: [
      props.triggerAnomalyAgentId,
      props.damageKind,
      props.anomalySubKind,
      props.skillCategoryId,
      props.skillSubcategoryId,
    ],
    buffs: slotBuffSelectionsSignature.value,
    convert: convertSlotPanelsSignature.value,
    // 激活那份局外（已解析）必须进指纹，否则导入/切换来源后流程与伤害可能不重算
    anomaly: resolvedActiveSlotPanels.value,
    env: (props.environmentBuffs ?? []).map((item) => item.id),
    extra: extraGains.value,
    enemy: enemyInput.value,
    ext: externalPanel,
    affix: affixCounts,
    mains: affixDriveDiscMainStats,
  }),
)

/** 准备招式的单次预览行（只用于上报，不参与流程总伤） */
const previewHitLineById: Record<string, HitLine> = {}

function buildHitLine(
  hit: ResolvedHit,
  entry: HitEvalCacheEntry,
  resolveOwnerName?: (hit: ResolvedHit) => string | undefined,
): HitLine {
  const kindLabel =
    DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === hit.skill.damageType)?.label ??
    hit.skill.damageType
  const suffix =
    hit.skill.damageType === 'disorder'
      ? `（${disorderLabelFromResult(entry.result)}）`
      : ''
  const ownerName = resolveOwnerName?.(hit)
  return {
    hit,
    perHit: entry.perHit,
    total: entry.total,
    label: `${kindLabel}${suffix}`,
    displayName: `${ownerName ? `${ownerName} · ` : ''}${hit.skill.name}${suffix}`,
    result: entry.result,
  }
}

function syncHitSummary(
  hits: ResolvedHit[] | undefined,
  resolveOwnerName?: (hit: ResolvedHit) => string | undefined,
  options?: { usePerHit?: boolean },
) {
  const list = hits ?? []
  const contextToken = internHitEvalContext(hitCalcGlobalSignature.value)
  const lines: HitLine[] = []
  let grandTotal = 0

  for (const hit of list) {
    const key = hitEvalCacheKey(
      buildHitEvalFingerprint(hit),
      contextToken,
      skillFlowMainExternal.value,
      false,
    )
    let entry = readHitEvalCache(key)
    if (!entry) {
      try {
        const detail = evaluateOptimalEventDetail(
          skillFlowEvalCtx.value,
          skillFlowMainExternal.value,
          hit,
          // requirePanel：这四条伤害页入口统一要求「有面板才出伤害」（没面板 → 没有伤害）
          { includeDetails: false, requirePanel: true },
        )
        if (detail) {
          entry = {
            hitId: hit.id,
            perHit: detail.perHit,
            total: detail.total,
            result: detail.result,
          }
          writeHitEvalCache(key, entry)
        }
      } catch (error) {
        console.error('[syncHitSummary] skip hit due to calc error', hit.skill?.name, error)
      }
    }
    if (!entry) continue

    const line = buildHitLine(hit, entry, resolveOwnerName)
    lines.push(line)
    grandTotal += options?.usePerHit ? line.perHit : line.total
  }

  return { lines, grandTotal }
}

function emitHitMaps() {
  if (props.calcSuspended || !damageCalcEnabled.value) return
  const map: Record<string, number> = {}
  const results: Record<string, DamageCalcResult> = {}
  // 流程 hit 计入总伤；准备招式只发单次预览，不进伤害结果汇总
  for (const line of damageEventSummary.value?.lines ?? []) {
    map[line.hit.id] = line.total
    results[line.hit.id] = line.result
  }
  for (const line of Object.values(previewHitLineById)) {
    map[line.hit.id] = line.perHit
    results[line.hit.id] = line.result
  }
  emit('update:hitDamages', map)
  emit('update:hitCalcResults', results)
}

watch(
  [
    () => props.hits,
    () => props.previewHits,
    hitCalcGlobalSignature,
    // 招式流程三选项切换：换面板必须重算（缓存键里含面板，换来源即换键）
    () => props.skillFlowMainExternalOverride,
    () => props.calcSuspended,
    () => damageCalcEnabled.value,
  ],
  () => {
    const inactive = props.calcSuspended || !damageCalcEnabled.value
    if (inactive) {
      if (hitSummarySyncTimer) {
        clearTimeout(hitSummarySyncTimer)
        hitSummarySyncTimer = null
      }
      return
    }
    if (hitSummarySyncTimer) {
      clearTimeout(hitSummarySyncTimer)
      hitSummarySyncTimer = null
    }
    hitSummarySyncTimer = setTimeout(() => {
      hitSummarySyncTimer = null
      if (props.calcSuspended || !damageCalcEnabled.value) return
      const hits = props.hits
      damageEventSummary.value = hits?.length
        ? syncHitSummary(
            hits,
            (hit) => props.agents.find((item) => item.id === hit.ownerAgentId)?.name,
          )
        : { lines: [], grandTotal: 0 }
      const previewHits = props.previewHits
      for (const key of Object.keys(previewHitLineById)) delete previewHitLineById[key]
      if (previewHits?.length) {
        for (const line of syncHitSummary(
          previewHits,
          (hit) => props.agents.find((item) => item.id === hit.ownerAgentId)?.name,
          { usePerHit: true },
        ).lines) {
          previewHitLineById[line.hit.id] = line
        }
      }
      emitHitMaps()
    }, HIT_RESULT_DEBOUNCE_MS)
  },
  { immediate: true },
)

onUnmounted(() => {
  if (hitSummarySyncTimer) {
    clearTimeout(hitSummarySyncTimer)
    hitSummarySyncTimer = null
  }
})































const teamSummary = computed(() =>
  props.teamSlots
    .map((slot, index) => {
      const agent = props.agents.find((item) => item.id === slot.agentId)
      const wengine = props.wengines.find((item) => item.id === slot.wengineId)
      if (!agent) return null
      return `槽位${index + 1} ${agent.name} / ${wengine?.name ?? '未选音擎'} / ${slot.rank}影 / 精${slot.wengineRefine}`
    })
    .filter(Boolean)
    .join('；'),
)

const teamWengineNotes = computed(() =>
  props.teamSlots
    .map((slot, index) => {
      if (!slot.agentId || !slot.wengineId || slot.wengineId === 'none') return null
      const agent = props.agents.find((item) => item.id === slot.agentId)
      const wengine = props.wengines.find((item) => item.id === slot.wengineId)
      if (!agent || !wengine) return null
      const note = wengine.note?.trim() ?? ''
      if (!note) return null
      const roleLabel = `槽位${index + 1}`
      return {
        key: `${index}-${wengine.id}`,
        label: `${roleLabel} · ${agent.name} · ${wengine.name}（精${slot.wengineRefine}）`,
        note,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null),
)

function getSnapshot(): DamageCalcPanelSnapshot {
  return {
    baseDamageSource: baseDamageSource.value,
    externalPanel: { ...externalPanel },
    extraMods: { ...extraMods.value },
    extraGains: extraGains.value.map((item) => ({ ...item })),
    enemyInput: { ...enemyInput.value },
  }
}

function loadSnapshot(
  snapshot: DamageCalcPanelSnapshot | DamageCalcSchemePanelSnapshot,
  options?: { preserveBaseDamageSource?: boolean },
) {
  // baseDamageSource 属于计算器内部公式入口；方案快照不应影响它。
  // 只有在恢复“工作草稿”（需要沿用当前页运行时状态）时才保留。
  if (options?.preserveBaseDamageSource && snapshot.baseDamageSource) {
    baseDamageSource.value = snapshot.baseDamageSource
  }
  Object.assign(externalPanel, createDefaultExternalPanel(), snapshot.externalPanel)
  loadAffixFromCurrentSlot()
  if (snapshot.extraGains?.length) {
    extraGains.value = snapshot.extraGains.map((item) =>
      normalizeExtraGain({
        id: item.id,
        name: item.name,
        stat: item.stat as BuffStatKey,
        value: item.value,
        applySituation: item.applySituation ?? 'global',
        scope: item.scope,
        applyTarget: item.applyTarget,
        applySlot: item.applySlot,
        skillCategory: item.skillCategory,
        skillSubcategoryId: item.skillSubcategoryId,
        appliesToAnomaly: item.appliesToAnomaly,
        applyProfession: item.applyProfession ?? null,
        teamProfession: item.teamProfession ?? null,
        teamProfessionValues: item.teamProfessionValues ?? null,
        teamProfessionMinCount: item.teamProfessionMinCount ?? null,
      }),
    )
  } else {
    const mods = { ...createEmptyBuffStatModifiers(), ...snapshot.extraMods }
    extraGains.value = BUFF_STAT_FIELDS.filter((field) => mods[field.key] !== 0).map(
      (field, index) => ({
        id: `legacy-${field.key}-${index}`,
        name: buffStatFieldLabel(field),
        stat: field.key,
        value: mods[field.key],
        applySituation: 'global' as const,
        applySlot: 0,
        applyTarget: 'self' as const,
      }),
    )
  }
  Object.assign(enemyInput.value, normalizeDamageEnemyInput(snapshot.enemyInput))
  if (!Number.isFinite(enemyInput.value.level) || enemyInput.value.level < 1) {
    enemyInput.value.level = 60
  }
}

/** 导入草稿等场景：用指定局外 + 当前增益上下文实时算局内 */
function previewFinalPanel(external: PanelStats, slotIndex?: number): PanelStats | null {
  const index = slotIndex ?? mainSlotIndex.value
  if (index < 0 || index >= props.teamSlots.length) return null
  try {
    return computeFinalPanel(
      fillPanelStatsDefaults(external),
      buildPanelCalcContextForSlot(index),
    ).finalPanel
  } catch {
    return null
  }
}

defineExpose({
  getSnapshot,
  loadSnapshot,
  beginRestore,
  endRestore,
  syncLivePanelFromCommitted,
  previewFinalPanel,
  convertAttrDefaults,
  convertPanelSourceValues,
  panelSourceValuesBySlot,
  getAttrDefaultsForSlot,
  getPanelSourceValuesForSlot,
  panelBreakdown,
  enemyInput,
  slotPanelPreviews: computed(() => {
    void panelBreakdown.value
    void slotBuffSelectionsSignature.value
    void slotExternalPanelsMap.value
    void resolvedActiveSlotPanels.value
    void props.slotPanels
    void props.convertSlotPanels
    void extraGains.value
    void props.bangbooRefine
    void selectedBangboo.value.id
    void props.staggerPhase
    void props.environmentBuffs
    return props.teamSlots.map((slot, index) => {
      if (!slot.agentId) return null
      const external = resolveExternalPanelForSlotIndex(index)
      try {
        const breakdown = computeFinalPanel(external, buildPanelCalcContextForSlot(index))
        return { external, final: breakdown.finalPanel }
      } catch {
        return { external, final: null }
      }
    })
  }),
  applyEnemyInput(next: import('@/utils/enemyResistance').DamageEnemyInput) {
    Object.assign(enemyInput.value, normalizeDamageEnemyInput(next))
  },
})
</script>

<template>
  <section :id="sectionId" class="section-card panel-section damage-anchor">
    <header class="section-header">
      <div>
        <h2>伤害计算</h2>
        <p class="section-desc">
          全队局外 / 词条 / 局内面板请在「导入」中录入与查看；悬停顶部槽位可预览局外与局内（随 Buff
          增益实时更新）。此处仅结算伤害结果。
        </p>
        <!-- 没面板就不出伤害（所有者口径 2026-09-12）：给一句提示，别让人对着 0 猜 -->
        <p v-if="mainPanelMissing" class="section-desc panel-missing-hint" role="status">
          当前角色还没有面板（局外面板为 0，伤害不计算）——请点顶部「导入」录入或截图识别后「确定导入」。
        </p>
      </div>
    </header>

    <p v-if="teamSummary" class="team-summary">{{ teamSummary }}</p>
    <p v-if="isMbMainAgent" class="mb-hint">
      当前角色为命破：基础伤害来源固定为贯穿力，防御区固定为 1。
    </p>
    <p v-else-if="isFengYuMainAgent" class="mb-hint">
      当前角色为锋御：基础伤害来源固定为防御力，走锐化公式（锐爆区，暴击率可至
      200%）。
    </p>

    <details v-if="teamWengineNotes.length" class="team-notes team-wengine-notes">
      <summary class="team-notes-title">查看队伍音擎注释</summary>
      <article v-for="item in teamWengineNotes" :key="item.key" class="team-note-item">
        <p class="team-note-label">{{ item.label }}</p>
        <p class="team-note-text">
          <span class="team-note-type">音擎注释</span>
          {{ item.note }}
        </p>
      </article>
    </details>

    <div class="grid four meta-grid">
      <label class="field">
        <span>基础伤害来源</span>
        <select v-model="baseDamageSource" :disabled="isMbMainAgent || isFengYuMainAgent">
          <option value="atk">攻击力</option>
          <option value="def">防御力</option>
          <option value="pierce">贯穿力</option>
        </select>
      </label>
      <label class="field">
        <span>当前角色</span>
        <input :value="mainAgent?.name ?? '未选择'" type="text" readonly />
      </label>
      <label class="field">
        <span>已选邦布</span>
        <input :value="selectedBangboo.name" type="text" readonly />
      </label>
      <label class="field">
        <span>邦布精炼</span>
        <input :value="`精${bangbooRefine}`" type="text" readonly />
      </label>
    </div>

    <!-- 父页可插入招式流程等：构图上落在面板区与伤害结果之间 -->
    <slot name="after-setup" />

  </section>
</template>

<style scoped>
.section-card {
  border: 1px solid #2a2d33;
  border-radius: 14px;
  background: linear-gradient(180deg, #171a1f 0%, #12151a 100%);
  padding: 1rem;
}

.section-header h2 {
  margin: 0;
  font-size: 1.05rem;
  color: #f0f2f6;
}

.section-desc {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: #9aa3b0;
}

/* 没面板就没伤害：这句要显眼，别让人对着 0 猜 */
.panel-missing-hint {
  margin-top: 0.5rem;
  padding: 0.45rem 0.7rem;
  border-radius: 8px;
  border: 1px dashed #8a6d3b;
  background: rgba(201, 165, 92, 0.12);
  color: #f0d7a2;
}

.team-summary,
.mb-hint {
  margin: 0 0 0.85rem;
  padding: 0.55rem 0.75rem;
  border-radius: 10px;
  background: #0f1217;
  border: 1px solid #2d323a;
  font-size: 0.8rem;
  color: #b7c0cd;
}

.mb-hint {
  border-color: #5a4a31;
  color: #d8c39a;
}

.team-notes {
  margin: 0 0 0.85rem;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  border: 1px solid #34302a;
  background: #14120f;
}

.team-notes-title {
  cursor: pointer;
  font-size: 0.84rem;
  color: #e8d4a8;
}

.team-notes[open] .team-notes-title {
  margin-bottom: 0.55rem;
}

.team-note-item + .team-note-item {
  margin-top: 0.55rem;
  padding-top: 0.55rem;
  border-top: 1px solid #2d2820;
}

.team-note-label {
  margin: 0 0 0.35rem;
  font-size: 0.8rem;
  color: #d8c39a;
  font-weight: 600;
}

.team-note-text {
  margin: 0.25rem 0 0;
  font-size: 0.78rem;
  line-height: 1.5;
  color: #c5cdd8;
  white-space: pre-wrap;
}

.team-note-type {
  display: block;
  margin-bottom: 0.15rem;
  font-size: 0.72rem;
  color: #8f8678;
}

.team-note-empty {
  margin: 0.15rem 0 0;
  font-size: 0.76rem;
  color: #7a828f;
}

.grid {
  display: grid;
  gap: 0.55rem;
}

.grid.four {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.field-span-all {
  grid-column: 1 / -1;
}

.meta-grid {
  margin-bottom: 0.85rem;
}

.panel-layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin-bottom: 0.85rem;
  align-items: stretch;
}

.panel-layout-left {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.panel-block.panel-layout-right {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 100%;
}

.panel-grid-fill {
  flex: 1;
  align-content: start;
}

.panel-block {
  border: 1px solid #2d323a;
  border-radius: 12px;
  padding: 0.75rem;
  background: #10141a;
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

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field-spacer {
  min-height: 1px;
  visibility: hidden;
  pointer-events: none;
}

.field span {
  font-size: 0.76rem;
  color: #aab2bf;
}

.field > input,
.field > select,
.extra-buff-textarea {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #ebedf0;
  padding: 0.44rem 0.54rem;
}

.field > input:read-only {
  opacity: 0.92;
  background: #0c1016;
}

.extra-mods-block {
  margin-bottom: 0;
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

@media (max-width: 980px) {
  .extra-mods-block :deep(.buff-stat-grid) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 680px) {
  .extra-mods-block :deep(.buff-stat-grid) {
    grid-template-columns: 1fr;
  }
}

.affix-input-block {
  margin-bottom: 0.85rem;
}

.affix-hint {
  margin: 0 0 0.65rem;
  font-size: 0.78rem;
  color: #d8c39a;
}

.field-hint {
  font-size: 0.72rem;
  color: #7a828f;
}

.affix-base-summary {
  margin-top: 0.65rem;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px solid #2d323a;
  background: #0f1217;
  font-size: 0.78rem;
  color: #9aa3b0;
}

.affix-base-summary p {
  margin: 0;
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

.buff-breakdown {
  margin-bottom: 0.85rem;
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

.buff-breakdown ul {
  margin: 0.55rem 0 0;
  padding-left: 1.1rem;
}

.buff-breakdown li {
  margin: 0.2rem 0;
}

.enemy-title {
  margin: 0 0 0.55rem;
  font-size: 0.9rem;
  color: #d5dae4;
}

.result-mode-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin: 1rem 0 0.55rem;
}

.result-mode-title {
  margin: 0;
}

.detail-mode-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  color: #c5cdd8;
  cursor: pointer;
  user-select: none;
}

.detail-mode-toggle input {
  accent-color: #e8d4a8;
}

.result-grid-summary {
  grid-template-columns: 1fr;
  margin-top: 0.35rem;
}

.result-section-title {
  margin: 0.85rem 0 0.45rem;
  font-size: 0.88rem;
  color: #e8d4a8;
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

.formula-line {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.55;
  color: #b7c0cd;
  word-break: break-word;
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
  color: var(--accent, #6eb6ff);
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
  .panel-layout {
    grid-template-columns: 1fr;
  }

  .grid.four,
  .result-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .panel-block.panel-layout-right {
    height: auto;
    min-height: 0;
  }
}

@media (max-width: 768px) {
  .result-mode-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 0.45rem;
  }

  .result-mode-title {
    font-size: 0.95rem;
  }

  .detail-mode-toggle {
    align-self: flex-start;
  }

  .panel-block {
    padding: 0.75rem;
  }

  .grid.four,
  .result-grid {
    grid-template-columns: 1fr;
  }

  .field > input,
  .field > select {
    width: 100%;
    min-width: 0;
  }

  .formula-aligned-body {
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .formula-aligned-term {
    min-width: 0;
  }

  .affix-base-summary {
    font-size: 0.78rem;
    line-height: 1.45;
  }
}

.anomaly-support-panels {
  border-color: #3a4a31;
  margin-top: 0.75rem;
}

.anomaly-producer-final-details {
  margin-top: 0.65rem;
  padding: 0.45rem 0.55rem;
  border: 1px dashed #3a4455;
  border-radius: 8px;
  background: #0c1018;
}

.anomaly-producer-final-details > summary {
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 600;
  color: #b8c4d4;
  list-style: none;
}

.anomaly-producer-final-details > summary::-webkit-details-marker {
  display: none;
}

.anomaly-producer-final-details > summary::before {
  content: '▸ ';
  color: #8a96a8;
}

.anomaly-producer-final-details[open] > summary::before {
  content: '▾ ';
}

.anomaly-producer-final-details .grid {
  margin-top: 0.55rem;
}

.anomaly-slot-details {
  margin-top: 0.55rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid #2d323a;
  border-radius: 10px;
  background: #0f1217;
}

.anomaly-slot-details summary {
  cursor: pointer;
  color: #e8ecf4;
  font-size: 0.86rem;
  font-weight: 600;
}

.anomaly-slot-details .grid {
  margin-top: 0.65rem;
}

.anomaly-block-hint {
  margin: 0.35rem 0 0.75rem;
  padding: 0.55rem 0.75rem;
  border-radius: 8px;
  background: rgba(240, 113, 120, 0.08);
  border: 1px solid rgba(240, 113, 120, 0.25);
  color: #f07178;
  font-size: 0.85rem;
  line-height: 1.45;
}
.anomaly-block-hint-list {
  padding-left: 1.35rem;
  list-style: disc;
}

.event-summary-block {
  margin-bottom: 0.85rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid #2d323a;
  border-radius: 10px;
  background: #0f1217;
}

.event-summary-title {
  margin: 0;
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
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 0.45rem 0.55rem;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 0.82rem;
  color: #c5cdd8;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.event-summary-item:hover {
  background: rgba(255, 255, 255, 0.04);
  border-color: #3a414c;
}

.event-summary-item--active {
  background: rgba(201, 165, 92, 0.1);
  border-color: rgba(201, 165, 92, 0.45);
}

.event-summary-name {
  flex: 1;
  min-width: 0;
  color: #e8edf3;
}

.event-summary-count {
  margin-left: 0.25rem;
  color: #9aa3b0;
}

.event-summary-damage {
  flex-shrink: 0;
  color: #aeb7c4;
  text-align: right;
}

.event-detail-block {
  margin-bottom: 1rem;
}

.event-summary-total {
  margin-top: 0.55rem !important;
  padding-top: 0.45rem;
  border-top: 1px solid #2a2f36;
}

@media (max-width: 680px) {
  .panel-layout {
    grid-template-columns: 1fr;
  }
}

.panel-section :deep(.skill-flow-section),
.panel-section :deep(#skill-flow) {
  margin: 1rem 0 0.35rem;
  border: 1px solid #2a2d33;
  border-radius: 12px;
  background: #12151a;
  padding: 0.85rem 1rem;
}
</style>
