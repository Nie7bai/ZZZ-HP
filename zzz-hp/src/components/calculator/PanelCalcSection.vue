<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { type ExtraBuffGain } from '@/components/calculator/ExtraBuffGainEditor.vue'
import StatValueWithSources from '@/components/calculator/StatValueWithSources.vue'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type {
  AgentBuffDoc,
  AnomalyDamageSubKind,
  BangbooBuffDoc,
  BaseDamageSource,
  BuffStatKey,
  BuffStatModifiers,
  CharacterAttrKey,
  DamageEvent,
  DamageEventKind,
  DamageEventMultOverrides,
  DriveDiscBuffDoc,
  SkillCalcContext,
  SkillSubcategory,
  WengineBuffDoc,
} from '@/types/calculator'
import { CHARACTER_ATTR_OPTIONS } from '@/types/calculator'
import type { DamageCalcPanelSnapshot } from '@/types/damageCalcHistory'
import {
  applyAgentBaseToPanelStats,
  createDefaultExternalPanel,
  createDefaultAffixDriveDiscMainStats,
  createEmptyAffixCounts,
  createExternalPanelFromAgentBase,
  isPlaceholderExternalPanel,
  type AffixCounts,
  type AffixDriveDiscMainStats,
  type PanelCalcMode,
  type PanelStats,
} from '@/types/calculatorPanel'
import {
  AFFIX_COUNT_FIELDS,
  computeExternalPanelFromAffixes,
  inferAffixCountsFromExternalPanel,
} from '@/utils/affixPanelCalc'
import {
  DRIVE_DISC_SLOT_4_OPTIONS,
  DRIVE_DISC_SLOT_5_OPTIONS,
  DRIVE_DISC_SLOT_6_OPTIONS,
  AFFIX_DRIVE_DISC_SLOT_1_HP,
  AFFIX_DRIVE_DISC_SLOT_2_ATK,
} from '@/utils/affixDriveDiscConfig'
import {
  BUFF_STAT_FIELDS,
  buffStatFieldLabel,
  createEmptyAgentBasePanel,
  createEmptyBuffStatModifiers,
  createEmptyRefinementMods,
  createEmptyWengineAdvancedStats,
  getMindscapeNotesUpToRank,
  mergeBuffStatModifiers,
} from '@/utils/calculatorUi'
import {
  applyConvertPartialToExternalPanel,
  buildPanelSourceValuesBySlotRecord,
  collectConvertSupportSlots,
  computeFinalPanel,
  computePiercePower,
  convertSlotPartialToExternalPanel,
  externalPanelToConvertPartial,
  panelToConvertAttrValues,
  resolveBuffSelectionForSlot,
  resolveAnomalyReleaseMultFields,
  type ConvertSlotPanels,
  type MultiSlotBuffSelection,
} from '@/utils/panelBuffCalc'
import {
  computeDamageResult,
  resolveAnomalyPowerBaseDamageSource,
  type DamageCalcInput,
  type DamageCalcResult,
} from '@/utils/damageCalc'
import { mergeSkillSubcategoryMultOverrides } from '@/utils/skillSubcategoryMult'
import {
  normalizeDamageEnemyInput,
  resolveEnemyResistanceForElement,
  resistanceTypeLabel,
  type DamageEnemyInput,
  type EnemyResistanceElement,
} from '@/utils/enemyResistance'
import {
  mapEventKindToCalc,
  pickEventDamage,
  applyOwnerPanelMultOverrides,
  applyRadianceBonusMultOverrides,
  resolveRadianceBonusMultDefaults,
} from '@/utils/damageEvent'
import {
  buildGenericPanelSkillContext,
  buildSkillContextFromHit,
  getHitSkipReason,
  skillNeedsDualAgents,
  applyHitPanelMods,
  summarizeHits,
  type HitLine,
  type ResolvedHit,
} from '@/utils/resolvedHit'
import { summarizeDamageByOwner, RADIANCE_SELF_TRIGGER_HINT } from '@/utils/damageEventOwner'
import {
  mergeExtraModsForEvent,
} from '@/utils/extraBuffCalc'
import {
  computeMutationZone,
  findLuminousAgentInTeam,
  isRemielSelfRadiancePowerProvider,
  resolveDamageCalcResistanceElements,
  isLuminousAgent,
} from '@/utils/remielUtils'
import { resolveRemielSelfRadianceCalcInput, computeRemielSelfInCombatPanel } from '@/utils/remielSelfRadiancePanel'
import { formatCalcDecimal } from '@/utils/calcNumberFormat'
import {
  buildAlignedDirectFormulaGroup,
  buildDirectDamageExpectedProcessItems,
  formatDirectDmgMultZoneFormula,
  formatSettlementDmgMultZoneFormula,
} from '@/utils/directDamageDisplay'
import {
  buildAlignedAnomalyFormulaGroups,
  formatAnomalyFormulaAgentLabel,
  resolveAnomalyBaseWithMutation,
  type AnomalyFormulaAgentLabels,
} from '@/utils/anomalyFormulaDisplay'
import { buildAtkPanelProcessItems, buildDefPanelProcessItems, buildEnemyCombatProcessItems, buildStatSourceGroups, type StatSourceGroup } from '@/utils/statSourceTips'
import DirectDamageFormulaAligned from '@/components/calculator/DirectDamageFormulaAligned.vue'
import DamageOwnerShareBlock from '@/components/calculator/DamageOwnerShareBlock.vue'
import type { PanelScreenshotRecognition } from '@/types/panelScreenshot'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'

const MB_PROFESSION = '命破'

type PanelFieldSlot =
  | { id: string; kind: 'stat'; key: keyof PanelStats; label: string }
  | { id: string; kind: 'pierce'; label: string }
  | { id: string; kind: 'mod'; key: keyof BuffStatModifiers; label: string }
  | { id: string; kind: 'finalRate'; rate: 'anomaly' | 'disorder' | 'turbulence' | 'release'; label: string }
  | { id: string; kind: 'spacer' }

/** 局外面板字段（按行排布，含空位）— 倍率相关字段移至伤害事件详情 */
const EXTERNAL_PANEL_SLOTS: PanelFieldSlot[] = [
  { id: 'hp', kind: 'stat', key: 'hp', label: '生命值' },
  { id: 'atk', kind: 'stat', key: 'atk', label: '攻击力' },
  { id: 'pierce', kind: 'pierce', label: '贯穿力' },
  { id: 'def', kind: 'stat', key: 'def', label: '防御力' },
  { id: 'critRate', kind: 'stat', key: 'critRate', label: '暴击率%' },
  { id: 'critDmg', kind: 'stat', key: 'critDmg', label: '爆伤%' },
  { id: 'dmgBonus', kind: 'stat', key: 'dmgBonus', label: '增伤%' },
  { id: 'penRate', kind: 'stat', key: 'penRate', label: '穿透率%' },
  { id: 'pen', kind: 'stat', key: 'pen', label: '穿透值' },
  { id: 'reduceDefense', kind: 'stat', key: 'reduceDefense', label: '无视防御/减防%' },
  { id: 'mastery', kind: 'stat', key: 'mastery', label: '精通' },
  { id: 'anomalyControl', kind: 'stat', key: 'anomalyControl', label: '异常掌控' },
  { id: 'energyRegen', kind: 'stat', key: 'energyRegen', label: '能量回复效率%' },
  { id: 'anomalyDuration', kind: 'stat', key: 'anomalyDuration', label: '异常持续时间(s)' },
]

/** 局内最终面板字段 — 倍率/factor/finalRate 移至伤害事件详情 */
const FINAL_PANEL_SLOTS: PanelFieldSlot[] = [
  { id: 'hp', kind: 'stat', key: 'hp', label: '生命值' },
  { id: 'atk', kind: 'stat', key: 'atk', label: '攻击力' },
  { id: 'pierce', kind: 'pierce', label: '贯穿力' },
  { id: 'def', kind: 'stat', key: 'def', label: '防御力' },
  { id: 'critRate', kind: 'stat', key: 'critRate', label: '暴击率%' },
  { id: 'critDmg', kind: 'stat', key: 'critDmg', label: '爆伤%' },
  { id: 'dmgBonus', kind: 'stat', key: 'dmgBonus', label: '增伤%' },
  { id: 'penRate', kind: 'stat', key: 'penRate', label: '穿透率%' },
  { id: 'pen', kind: 'stat', key: 'pen', label: '穿透值' },
  { id: 'reduceDefense', kind: 'stat', key: 'reduceDefense', label: '无视防御/减防%' },
  { id: 'mastery', kind: 'stat', key: 'mastery', label: '精通' },
  { id: 'anomalyControl', kind: 'stat', key: 'anomalyControl', label: '异常掌控' },
  { id: 'energyRegen', kind: 'stat', key: 'energyRegen', label: '能量回复效率%' },
  { id: 'anomalyCritRate', kind: 'stat', key: 'anomalyCritRate', label: '异常暴击%' },
  { id: 'anomalyCritDmg', kind: 'stat', key: 'anomalyCritDmg', label: '异常爆伤%' },
  { id: 'anomalyDmgBonus', kind: 'stat', key: 'anomalyDmgBonus', label: '异常增伤%' },
  { id: 'anomalyReleaseCritRate', kind: 'stat', key: 'anomalyReleaseCritRate', label: '异放暴击%' },
  { id: 'anomalyReleaseCritDmg', kind: 'stat', key: 'anomalyReleaseCritDmg', label: '异放爆伤%' },
  { id: 'anomalyReleaseDmgBonus', kind: 'stat', key: 'anomalyReleaseDmgBonus', label: '异放增伤%' },
  { id: 'disorderDmgBonus', kind: 'stat', key: 'disorderDmgBonus', label: '紊乱增伤%' },
  { id: 'turbulenceDmgBonus', kind: 'stat', key: 'turbulenceDmgBonus', label: '乱流增伤%' },
  { id: 'pierceDmgBonus', kind: 'mod', key: 'pierceDmgBonus', label: '贯穿增伤%' },
  { id: 'special', kind: 'mod', key: 'special', label: '特殊补充%' },
]

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
  /** 计算页正在编辑的编队槽位；局外面板跟这个人走，与主C无关 */
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
  /** 各角色局外面板，key = agentId；当前编辑槽位用 live 编辑器，其余读这里 */
  anomalySlotPanels?: Record<string, PanelStats>
  /** 转模增益角色局外面板（仅转模来源属性），key = agentId */
  convertSlotPanels?: ConvertSlotPanels
  skillCategoryId?: import('@/types/calculator').SkillCategoryId
  skillSubcategoryId?: string | null
  slotBuffSelections?: MultiSlotBuffSelection | null
  staggerPhase?: import('@/types/calculator').StaggerPhase
  /** 流程展开后的结算列表，来自 resolveFlow */
  hits?: ResolvedHit[]
  /** 招式库 / 准备招式的单次预览，不计入流程总伤 */
  previewHits?: ResolvedHit[]
  /** 为 true 时跳过伤害事件汇总等非必要重算（如最优词条模式） */
  calcSuspended?: boolean
  /** 场地 / 环境 Buff（危局全局、Boss 场地、防卫房间） */
  environmentBuffs?: import('@/utils/environmentBuffCalc').EnvironmentBuffEntry[]
}>()

const extraGains = defineModel<ExtraBuffGain[]>('extraGains', { default: () => [] })

const emit = defineEmits<{
  'update:anomalySlotPanels': [value: Record<string, PanelStats>]
  'update:convertSlotPanels': [value: ConvertSlotPanels]
  'update:hitDamages': [value: Record<string, number>]
  'update:hitCalcResults': [value: Record<string, DamageCalcResult>]
}>()

const baseDamageSource = ref<BaseDamageSource>('atk')
const showDetailedResults = ref(false)
const selectedDamageEventId = ref<string | null>(null)
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
const affixDriveDiscMainStats = reactive(createDefaultAffixDriveDiscMainStats())

type AgentAffixState = {
  affixCounts: AffixCounts
  affixDriveDiscMainStats: AffixDriveDiscMainStats
}
const affixStateByAgent = reactive<Record<string, AgentAffixState>>({})

function captureAffixState(): AgentAffixState {
  return {
    affixCounts: { ...affixCounts },
    affixDriveDiscMainStats: { ...affixDriveDiscMainStats },
  }
}

function applyAffixState(state: AgentAffixState | undefined) {
  Object.assign(affixCounts, createEmptyAffixCounts(), state?.affixCounts)
  Object.assign(
    affixDriveDiscMainStats,
    createDefaultAffixDriveDiscMainStats(),
    state?.affixDriveDiscMainStats,
  )
}

function buildExtraModsForHit(hit: ResolvedHit, slotAgentId: string) {
  if (!extraGains.value.length) return createEmptyBuffStatModifiers()
  const ownerElement = props.agents.find((item) => item.id === hit.ownerAgentId)?.element
  return mergeExtraModsForEvent(extraGains.value, buildSkillContextFromHit(hit, ownerElement), {
    slotAgentId,
    editedAgentId: mainAgent.value?.id ?? '',
    staggerPhase: hit.staggerPhase,
    resolveAgentProfession: (agentId) =>
      props.agents.find((item) => item.id === agentId)?.profession,
    teamSlots: props.teamSlots,
    agents: props.agents,
  })
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
      slotAgentId: mainId,
      editedAgentId: mainId,
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

function ensureElementResistanceMap() {
  if (!enemyInput.value.elementResistance) {
    enemyInput.value.elementResistance = normalizeDamageEnemyInput(enemyInput.value).elementResistance
  }
  return enemyInput.value.elementResistance!
}

/** 当前正在编辑的编队槽位（点选代理人卡片），不是主C */
const mainSlotIndex = computed(() => {
  const index = props.editedSlotIndex
  if (index >= 0 && index < props.teamSlots.length) return index
  return 0
})

const mainSlot = computed(() => props.teamSlots[mainSlotIndex.value]!)

const mainAgent = computed(() =>
  props.agents.find((item) => item.id === mainSlot.value.agentId),
)

const { skillSubcategories } = storeToRefs(useCalculatorBuffStore())

const resolvedSkillSubcategory = computed<SkillSubcategory | null>(() => {
  const id = props.skillSubcategoryId
  if (!id) return null
  return skillSubcategories.value.find((item) => item.id === id) ?? null
})

function resolveSubcategoryById(id: string | null): SkillSubcategory | null {
  if (!id) return null
  return skillSubcategories.value.find((item) => item.id === id) ?? null
}

const mainWengine = computed(() => {
  const id = mainSlot.value.wengineId
  if (!id || id === 'none') return null
  return props.wengines.find((item) => item.id === id) ?? null
})

const derivedExternalPanel = computed(() =>
  computeExternalPanelFromAffixes({
    agentBase: mainAgent.value?.basePanel ?? createEmptyAgentBasePanel(),
    wengineBaseAtk: mainWengine.value?.baseAtk ?? 0,
    wengineAdvanced: mainWengine.value?.advancedStats ?? createEmptyWengineAdvancedStats(),
    affixCounts,
    driveDiscSelection: {
      twoPieceDriveDiscId: mainSlot.value.twoPieceDriveDiscId,
      fourPieceDriveDiscId: mainSlot.value.fourPieceDriveDiscId,
    },
    driveDiscMainStats: affixDriveDiscMainStats,
    driveDiscs: props.driveDiscs,
  }),
)

function driveDiscNameById(id: string) {
  if (!id || id === 'none') return null
  return props.driveDiscs.find((item) => item.id === id)?.name ?? null
}

const mainDriveDiscSummary = computed(() => {
  const slot = mainSlot.value
  const fourName = driveDiscNameById(slot.fourPieceDriveDiscId)
  const twoName = driveDiscNameById(slot.twoPieceDriveDiscId)
  const parts: string[] = []
  if (fourName) parts.push(`4件：${fourName}`)
  if (twoName && twoName !== fourName) parts.push(`2件：${twoName}`)
  return parts.length ? parts.join(' · ') : '未选择（请先点选编队槽位并配置驱动盘）'
})

const effectiveExternalPanel = computed<PanelStats>(() =>
  props.calcMode === 'affix' ? derivedExternalPanel.value : externalPanel,
)

const isAffixMode = computed(() => props.calcMode === 'affix')

const isMbMainAgent = computed(() => mainAgent.value?.profession === MB_PROFESSION)

const selectedBangboo = computed(
  () =>
    props.bangboos.find((item) => item.id === props.selectedBangbooId) ??
    props.bangboos.find((item) => item.id === 'none') ??
    emptyBangboo,
)

const effectiveBaseDamageSource = computed<BaseDamageSource>(() =>
  isMbMainAgent.value ? 'pierce' : baseDamageSource.value,
)

const convertAttrDefaults = computed<Partial<Record<CharacterAttrKey, number>>>(() =>
  panelToConvertAttrValues(effectiveExternalPanel.value, { level: 60, pierceMod: 0 }),
)

/** 流程参与者里、不是当前正在编辑的槽位 */
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

function resolveExternalPanelForSlotIndex(slotIndex: number): PanelStats {
  if (slotIndex === mainSlotIndex.value) return effectiveExternalPanel.value
  const agentId = props.teamSlots[slotIndex]?.agentId
  if (!agentId) return createDefaultExternalPanel()
  const anomaly = props.anomalySlotPanels?.[agentId]
  if (anomaly) return { ...anomaly }
  const partial = props.convertSlotPanels?.[agentId]
  if (partial) return convertSlotPartialToExternalPanel(partial)
  return createDefaultExternalPanel()
}

function resolveRemielSelfRadianceCalcForPowerProvider(
  anomalyPowerAgentId: string | null | undefined,
  skillContext?: import('@/types/calculator').SkillCalcContext,
) {
  const remiel = findLuminousAgentInTeam(props.teamSlots, props.agents)
  if (!remiel || !isRemielSelfRadiancePowerProvider(anomalyPowerAgentId, remiel.id)) {
    return undefined
  }
  const agent = props.agents.find((item) => item.id === remiel.id)
  const baseCtx = buildPanelCalcContextForSlot(remiel.slotIndex)
  return resolveRemielSelfRadianceCalcInput({
    teamSlots: props.teamSlots,
    agents: props.agents,
    externalPanel: resolveExternalPanelForSlotIndex(remiel.slotIndex),
    panelCtx: skillContext ? { ...baseCtx, skillContext } : baseCtx,
    remielSlotIndex: remiel.slotIndex,
    agentLevel: resolveAgentLevel(remiel.id),
    isMb: agent?.profession === MB_PROFESSION,
  })
}

function resolveBuffMatchElementForSlot(slotIndex: number): string | undefined {
  const agent = props.agents.find((item) => item.id === props.teamSlots[slotIndex]?.agentId)
  return agent?.element
}

function resolveLuminousTeamModifiers() {
  const found = findLuminousAgentInTeam(props.teamSlots, props.agents)
  if (!found) {
    return { mutationZone: 1, radianceResPen: 0 }
  }
  // 异化系数 scope=mutation 仅在 anomaly 上下文生效；须与耀变/异常结算一致
  const breakdown = computeFinalPanel(
    resolveExternalPanelForSlotIndex(found.slotIndex),
    {
      ...buildPanelCalcContextForSlot(found.slotIndex),
      skillContext: buildGenericPanelSkillContext({
        element: found.element,
        staggerPhase: props.staggerPhase ?? 'stagger',
        damageKind: 'anomaly',
      }),
    },
  )
  const panel = breakdown.finalPanel
  return {
    mutationZone: computeMutationZone(panel),
    radianceResPen: panel.radianceResPen,
  }
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
    skillContext: buildSkillContextForSlot(slotIndex),
    buffSelection: resolveBuffSelectionForSlot(props.slotBuffSelections, slotIndex),
    anomalySlotPanels: props.anomalySlotPanels,
    convertSlotPanels: props.convertSlotPanels,
    mainExternalPanel: resolveExternalPanelForSlotIndex(mainSlotIndex.value),
    attrValues: getAttrDefaultsForSlot(slotIndex),
    environmentBuffs: props.environmentBuffs,
  }
}

function buildBasePanelCalcContext() {
  return buildPanelCalcContextForSlot(mainSlotIndex.value)
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

const anomalyProducerAgentIds = computed(() => {
  const ids = new Set<string>()
  for (const item of anomalySupportSlots.value) {
    if (item.slot.agentId) ids.add(item.slot.agentId)
  }
  return ids
})

/** 需录入局外面板的转模增益角色（非主 C、非异常产生角色） */
const convertSupportSlots = computed(() =>
  collectConvertSupportSlots(buildBasePanelCalcContext(), {
    excludeAnomalyAgentIds: anomalyProducerAgentIds.value,
  }),
)

function characterAttrLabel(key: CharacterAttrKey): string {
  return CHARACTER_ATTR_OPTIONS.find((item) => item.id === key)?.label ?? key
}

function ensureConvertSlotPartial(agentId: string): Partial<Record<CharacterAttrKey, number>> {
  return props.convertSlotPanels?.[agentId] ?? {}
}

function updateConvertSlotAttr(agentId: string, key: CharacterAttrKey, value: number) {
  emit('update:convertSlotPanels', {
    ...props.convertSlotPanels,
    [agentId]: {
      ...ensureConvertSlotPartial(agentId),
      [key]: value,
    },
  })
}

function emitConvertSlotPanel(
  agentId: string,
  keys: CharacterAttrKey[],
  panel: PanelStats,
) {
  if (!keys.length) return
  emit('update:convertSlotPanels', {
    ...props.convertSlotPanels,
    [agentId]: externalPanelToConvertPartial(panel, keys),
  })
}

function ensureAnomalySlotPanel(agentId: string): PanelStats {
  const existing = props.anomalySlotPanels?.[agentId]
  if (existing && !isPlaceholderExternalPanel(existing)) return existing
  const agent = props.agents.find((item) => item.id === agentId)
  return createExternalPanelFromAgentBase(agent?.basePanel)
}

function updateAnomalySlotPanel(agentId: string, key: keyof PanelStats, value: number) {
  const next = {
    ...props.anomalySlotPanels,
    [agentId]: {
      ...ensureAnomalySlotPanel(agentId),
      [key]: value,
    },
  }
  emit('update:anomalySlotPanels', next)
}

function emitAnomalySlotPanel(agentId: string, panel: PanelStats) {
  emit('update:anomalySlotPanels', {
    ...props.anomalySlotPanels,
    [agentId]: { ...panel },
  })
}

function applyAgentBaseToExternalPanel(base: PanelStats | AgentBuffDoc['basePanel']) {
  applyAgentBaseToPanelStats(externalPanel, base)
}

const triggerSlotIndex = computed(() => {
  const id = props.triggerAnomalyAgentId
  if (!id) return -1
  return props.teamSlots.findIndex((slot) => slot.agentId === id)
})

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

const triggerAgentLevel = computed(() => resolveAgentLevel(props.triggerAnomalyAgentId))

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

/** 异放/乱流/耀变时伤害属性跟随触发角色；否则用主 C（流明不作等价属性替换，等价属性仅用于抗性区） */
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

const triggerExternalPanel = computed<PanelStats | null>(() => {
  if (!needsTriggerPanel.value || !props.triggerAnomalyAgentId) return null
  if (props.triggerAnomalyAgentId === mainAgent.value?.id) {
    return effectiveExternalPanel.value
  }
  return ensureAnomalySlotPanel(props.triggerAnomalyAgentId)
})

const producerPanelBreakdownByAgentId = computed(() => {
  void convertSlotPanelsSignature.value
  void slotBuffSelectionsSignature.value
  const map: Record<string, ReturnType<typeof computeFinalPanel>> = {}
  for (const item of anomalySupportSlots.value) {
    const agentId = item.slot.agentId
    if (!agentId) continue
    map[agentId] = computeFinalPanel(
      ensureAnomalySlotPanel(agentId),
      buildPanelCalcContextForSlot(item.index),
    )
  }
  return map
})

const triggerPanelBreakdown = computed(() => {
  if (!needsTriggerPanel.value || !props.triggerAnomalyAgentId || triggerSlotIndex.value < 0) {
    return null
  }
  if (props.triggerAnomalyAgentId === mainAgent.value?.id) {
    return panelBreakdown.value
  }
  return producerPanelBreakdownByAgentId.value[props.triggerAnomalyAgentId] ?? null
})

const triggerFinalPanel = computed(() => triggerPanelBreakdown.value?.finalPanel ?? null)

const anomalyCalcBlockedReason = computed(() => {
  // 招式流程按 hit 逐条 skip；不再按「第一条事件 + 主 C」整页封锁（否则主 C 蕾米时队友异常事件无法出伤）
  return ''
})

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

function formatPanelValue(key: keyof PanelStats | 'pierce' | 'special' | string, value: number) {
  if (
    key === 'hp' ||
    key === 'atk' ||
    key === 'def' ||
    key === 'pen' ||
    key === 'mastery' ||
    key === 'anomalyControl' ||
    key === 'pierce' ||
    key === 'anomalyDuration'
  ) {
    return formatNumber(value)
  }
  return formatCalcDecimal(value, 4)
}

function formatPanelSlot(slot: PanelFieldSlot, scope: 'external' | 'final') {
  if (slot.kind === 'spacer') return ''
  if (slot.kind === 'pierce') {
    return formatPanelValue(
      'pierce',
      scope === 'external' ? externalPiercePower.value : piercePower.value,
    )
  }
  if (slot.kind === 'mod') {
    return formatPanelValue(slot.key, panelBreakdown.value.totalMods[slot.key])
  }
  if (slot.kind === 'finalRate') {
    const p = calcParts.value
    if (slot.rate === 'anomaly') {
      return formatPanelValue('anomalyMult', finalPanel.value.anomalyMult)
    }
    if (slot.rate === 'disorder') {
      return formatPanelValue('disorder', p.disorderZone * 100)
    }
    if (slot.rate === 'turbulence') {
      return formatPanelValue('turbulence', p.turbulenceZone * 100)
    }
    return formatPanelValue('release', finalPanel.value.anomalyReleaseMult)
  }
  const panel = scope === 'external' ? effectiveExternalPanel.value : finalPanel.value
  return formatPanelValue(slot.key, panel[slot.key])
}

function formatAnomalyFinalPanel(agentId: string, slot: PanelFieldSlot) {
  if (slot.kind === 'spacer') return ''
  const breakdown = producerPanelBreakdownByAgentId.value[agentId]
  const external = ensureAnomalySlotPanel(agentId)
  const panel = breakdown?.finalPanel ?? external
  if (slot.kind === 'pierce') {
    const pierceMod = breakdown?.totalMods.pierce ?? 0
    return formatPanelValue('pierce', computePiercePower(panel.hp, panel.atk, pierceMod))
  }
  if (slot.kind === 'mod') {
    return formatPanelValue(slot.key, breakdown?.totalMods[slot.key] ?? 0)
  }
  if (slot.kind === 'finalRate') return '—'
  return formatPanelValue(slot.key, panel[slot.key])
}

const externalPiercePower = computed(() =>
  computePiercePower(effectiveExternalPanel.value.hp, effectiveExternalPanel.value.atk),
)

function applyRecognitionToExternalPanel(result: PanelScreenshotRecognition) {
  // 面板计算与词条计算同步写入，避免只更新当前模式
  for (const [key, value] of Object.entries(result.externalPanel) as [
    keyof PanelStats,
    number,
  ][]) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      externalPanel[key] = value
    }
  }

  // 先写入识别到的 4/5/6 主属性，再反推词条（反推会扣除主属性贡献）
  const mains = result.driveDiscMainStats
  if (mains?.slot4MainStat) affixDriveDiscMainStats.slot4MainStat = mains.slot4MainStat
  if (mains?.slot5MainStat) affixDriveDiscMainStats.slot5MainStat = mains.slot5MainStat
  if (mains?.slot6MainStat) affixDriveDiscMainStats.slot6MainStat = mains.slot6MainStat

  const inferred = inferAffixCountsFromExternalPanel({
    target: result.externalPanel,
    agentBase: mainAgent.value?.basePanel ?? createEmptyAgentBasePanel(),
    wengineBaseAtk: mainWengine.value?.baseAtk ?? 0,
    wengineAdvanced: mainWengine.value?.advancedStats ?? createEmptyWengineAdvancedStats(),
    driveDiscSelection: {
      twoPieceDriveDiscId: mainSlot.value.twoPieceDriveDiscId,
      fourPieceDriveDiscId: mainSlot.value.fourPieceDriveDiscId,
    },
    driveDiscMainStats: { ...affixDriveDiscMainStats },
    driveDiscs: props.driveDiscs,
  })
  Object.assign(affixCounts, createEmptyAffixCounts(), inferred.affixCounts)
}

watch(
  isMbMainAgent,
  (isMb) => {
    if (isMb) {
      baseDamageSource.value = 'pierce'
    }
  },
  { immediate: true },
)

watch(
  () => mainAgent.value?.id,
  (newId, oldId) => {
    if (oldId) {
      affixStateByAgent[oldId] = captureAffixState()
      const convertSlot = convertSupportSlots.value.find((item) => item.agentId === oldId)
      if (convertSlot) {
        emitConvertSlotPanel(oldId, convertSlot.requiredAttrs, effectiveExternalPanel.value)
      } else if (props.convertSlotPanels?.[oldId]) {
        const keys = Object.keys(props.convertSlotPanels[oldId]) as CharacterAttrKey[]
        emitConvertSlotPanel(oldId, keys, effectiveExternalPanel.value)
      }
    }

    if (!mainAgent.value || !newId) return

    // 首次挂载不要覆盖方案/草稿里已经灌进编辑器的局外面板。
    if (!oldId) {
      if (affixStateByAgent[newId]) applyAffixState(affixStateByAgent[newId])
      const savedAnomaly = props.anomalySlotPanels?.[newId]
      if (savedAnomaly && !isPlaceholderExternalPanel(savedAnomaly) && mainAgent.value.profession === '异常') {
        Object.assign(externalPanel, createDefaultExternalPanel(), savedAnomaly)
        return
      }
      const savedConvert = props.convertSlotPanels?.[newId]
      if (savedConvert && Object.keys(savedConvert).length > 0) {
        applyAgentBaseToExternalPanel(mainAgent.value.basePanel)
        applyConvertPartialToExternalPanel(savedConvert, externalPanel)
        return
      }
      applyAgentBaseToExternalPanel(mainAgent.value.basePanel)
      emitAnomalySlotPanel(newId, { ...effectiveExternalPanel.value })
      return
    }

    applyAffixState(affixStateByAgent[newId])
    const savedAnomaly = props.anomalySlotPanels?.[newId]
    if (savedAnomaly && !isPlaceholderExternalPanel(savedAnomaly)) {
      Object.assign(externalPanel, createDefaultExternalPanel(), savedAnomaly)
      return
    }

    const savedConvert = props.convertSlotPanels?.[newId]
    if (savedConvert && Object.keys(savedConvert).length > 0) {
      Object.assign(externalPanel, createExternalPanelFromAgentBase(mainAgent.value.basePanel))
      applyConvertPartialToExternalPanel(savedConvert, externalPanel)
      return
    }

    Object.assign(externalPanel, createExternalPanelFromAgentBase(mainAgent.value.basePanel))
    emitAnomalySlotPanel(newId, { ...effectiveExternalPanel.value })
  },
  { immediate: true },
)

watch(
  effectiveExternalPanel,
  () => {
    const id = mainAgent.value?.id
    if (!id) return
    emitAnomalySlotPanel(id, { ...effectiveExternalPanel.value })
    if (isAffixMode.value) affixStateByAgent[id] = captureAffixState()
    const convertSlot = convertSupportSlots.value.find((item) => item.agentId === id)
    if (convertSlot) {
      emitConvertSlotPanel(id, convertSlot.requiredAttrs, effectiveExternalPanel.value)
    }
  },
  { deep: true },
)

const piercePower = computed(() =>
  computePiercePower(
    finalPanel.value.hp,
    finalPanel.value.atk,
    panelBreakdown.value.totalMods.pierce,
  ),
)

const triggerPiercePower = computed(() => {
  if (!triggerFinalPanel.value || !triggerPanelBreakdown.value) return piercePower.value
  return computePiercePower(
    triggerFinalPanel.value.hp,
    triggerFinalPanel.value.atk,
    triggerPanelBreakdown.value.totalMods.pierce,
  )
})

const luminousTeamModifiers = computed(() => resolveLuminousTeamModifiers())

const calcParts = computed(() =>
  computeDamageResult({
    finalPanel: finalPanel.value,
    piercePower: piercePower.value,
    baseDamageSource: effectiveBaseDamageSource.value,
    isMbMainAgent: isMbMainAgent.value,
    enemyInput: enemyInput.value,
    combatVulnerable: panelBreakdown.value.combatMods.vulnerable,
    combatGlobalStaggerVulnerable: panelBreakdown.value.combatMods.globalStaggerVulnerable,
    combatStaggerVulnerable: panelBreakdown.value.combatMods.staggerVulnerable,
    combatStaggerVulnerableOnly: panelBreakdown.value.combatMods.staggerVulnerableOnly,
    combatSpecial: panelBreakdown.value.combatMods.special,
    combatPierceDmgBonus: panelBreakdown.value.combatMods.pierceDmgBonus,
    staggerPhase: props.staggerPhase ?? 'stagger',
    mainAgentElement: mainAgent.value?.element ?? '',
    ...resolveDamageCalcResistanceElements(
      props.teamSlots,
      props.agents,
      mainSlotIndex.value,
      props.triggerAnomalyAgentId,
    ),
    mainAgentId: mainAgent.value?.id ?? '',
    mainAgentName: mainAgent.value?.name ?? '',
    anomalySubKind: props.anomalySubKind ?? 'anomaly',
    triggerFinalPanel: triggerFinalPanel.value ?? undefined,
    triggerAgentElement: triggerAgent.value?.element,
    triggerPiercePower: triggerPiercePower.value,
    triggerBaseDamageSource: resolveAnomalyPowerBaseDamageSource({
      ownerAgentId: mainAgent.value?.id ?? '',
      anomalyPowerAgentId: props.triggerAnomalyAgentId,
      ownerBaseDamageSource: effectiveBaseDamageSource.value,
      anomalyPowerAgentIsMb: triggerAgent.value?.profession === MB_PROFESSION,
    }),
    triggerIsMb: triggerAgent.value?.profession === MB_PROFESSION,
    skillSubcategory: resolvedSkillSubcategory.value,
    mainAgentLevel: enemyInput.value.level,
    ownerAgentLevel: enemyInput.value.level,
    triggerAgentLevel: triggerAgentLevel.value,
    anomalyTriggerPanel: finalPanel.value,
    mutationZone: luminousTeamModifiers.value.mutationZone,
    remielRadianceResPen:
      (props.anomalySubKind ?? 'anomaly') === 'radiance'
        ? luminousTeamModifiers.value.radianceResPen
        : 0,
    remielSelfRadianceCalc: resolveRemielSelfRadianceCalcForPowerProvider(
      props.triggerAnomalyAgentId,
    ),
  }),
)

const disorderDamageLabel = computed(() =>
  calcParts.value.hasPolarDisorder ? '极性紊乱' : '紊乱伤害',
)

function resolveHitPowerElement(hit: ResolvedHit): string | undefined {
  if (!hit.anomalyPowerAgentId) return undefined
  return props.agents.find((agent) => agent.id === hit.anomalyPowerAgentId)?.element
}

function buildHitSkillContext(hit: ResolvedHit) {
  const ownerSlotIndex = props.teamSlots.findIndex((slot) => slot.agentId === hit.ownerAgentId)
  const ownerBuffElement = props.agents.find((item) => item.id === hit.ownerAgentId)?.element
  return {
    skillCtx: buildSkillContextFromHit(hit, ownerBuffElement),
    ownerSlotIndex: ownerSlotIndex >= 0 ? ownerSlotIndex : mainSlotIndex.value,
  }
}

function buildHitPanelCalcContext(
  skillCtx: SkillCalcContext,
  ownerSlotIndex: number,
  hit: ResolvedHit,
) {
  const ownerId = props.teamSlots[ownerSlotIndex]?.agentId ?? ''
  return {
    ...buildPanelCalcContextForSlot(ownerSlotIndex, buildExtraModsForHit(hit, ownerId)),
    skillContext: skillCtx,
  }
}

function resolveOwnerExternalPanel(ownerSlotIndex: number, ownerAgentId: string): PanelStats {
  // 主 C 只表示「面板计算正在编辑谁」。招式结算读该角色自己的局外面板：
  // 正在编辑的人用 live 编辑器，其他人用各自存好的槽位面板。
  if (ownerSlotIndex === mainSlotIndex.value) return effectiveExternalPanel.value
  return ensureAnomalySlotPanel(ownerAgentId)
}

/** 计算某角色在本条招式上下文下的局内最终面板 */
function computeHitPanelForAgent(hit: ResolvedHit, agentId: string): PanelStats | null {
  const slotIndex = props.teamSlots.findIndex((slot) => slot.agentId === agentId)
  if (slotIndex < 0) return null
  const external =
    slotIndex === mainSlotIndex.value
      ? effectiveExternalPanel.value
      : ensureAnomalySlotPanel(agentId)
  const element = props.agents.find((item) => item.id === agentId)?.element
  return computeFinalPanel(external, {
    ...buildPanelCalcContextForSlot(slotIndex, buildExtraModsForHit(hit, agentId)),
    skillContext: buildSkillContextFromHit(hit, element),
  }).finalPanel
}

function buildHitCalcInput(hit: ResolvedHit): DamageCalcInput | null {
  if (getHitSkipReason(hit, { teamSlots: props.teamSlots, agents: props.agents })) {
    return null
  }

  const { skillCtx: evtSkillCtx, ownerSlotIndex } = buildHitSkillContext(hit)
  const ownerAgentId = hit.ownerAgentId
  const evtAnomalySubKind = hit.anomalySubKind
  const damageType = hit.skill.damageType
  const needsPowerAgent = skillNeedsDualAgents(damageType)

  const ownerAgent = props.agents.find((item) => item.id === ownerAgentId)
  const evtOwnerIsMb = ownerAgent?.profession === MB_PROFESSION
  const evtBaseDamageSource: BaseDamageSource = evtOwnerIsMb ? 'pierce' : baseDamageSource.value

  const evtPowerAgentId = hit.anomalyPowerAgentId
  if (needsPowerAgent && !evtPowerAgentId) return null

  const evtPowerElement = resolveHitPowerElement(hit)
  const tAgent =
    needsPowerAgent && evtPowerAgentId
      ? props.agents.find((a) => a.id === evtPowerAgentId)
      : undefined
  const evtTriggerIsMb = tAgent?.profession === MB_PROFESSION

  const ownerExternal = resolveOwnerExternalPanel(ownerSlotIndex, ownerAgentId)
  const evtPanelCtx = buildHitPanelCalcContext(evtSkillCtx, ownerSlotIndex, hit)
  const evtBreakdown = computeFinalPanel(ownerExternal, evtPanelCtx)

  const overrides = hit.multOverrides
  let evtFinalPanel = applyHitPanelMods(
    applyOwnerPanelMultOverrides(evtBreakdown.finalPanel, overrides),
    hit.panelMods,
  )

  const evtPierce = computePiercePower(
    evtFinalPanel.hp,
    evtFinalPanel.atk,
    evtBreakdown.totalMods.pierce,
  )

  let evtTriggerFinalPanel: PanelStats | undefined
  let evtTriggerPierce: number | undefined
  if (needsPowerAgent && evtPowerAgentId) {
    const tSlotIndex = props.teamSlots.findIndex((slot) => slot.agentId === evtPowerAgentId)
    if (tSlotIndex < 0) return null

    if (evtPowerAgentId === ownerAgentId) {
      evtTriggerFinalPanel = evtFinalPanel
      evtTriggerPierce = evtPierce
    } else {
      const tExternal = ensureAnomalySlotPanel(evtPowerAgentId)
      const tBreakdown = computeFinalPanel(tExternal, {
        ...buildPanelCalcContextForSlot(
          tSlotIndex,
          buildExtraModsForHit(hit, evtPowerAgentId),
        ),
        skillContext: buildSkillContextFromHit(hit, tAgent?.element),
      })
      // 招式倍率覆写：紊乱/乱流落到强度提供者面板
      evtTriggerFinalPanel = applyOwnerPanelMultOverrides(tBreakdown.finalPanel, {
        disorderBaseMult: overrides?.disorderBaseMult,
        disorderBaseMultFactor: overrides?.disorderBaseMultFactor,
        disorderCompMult: overrides?.disorderCompMult,
        turbulenceBaseMult: overrides?.turbulenceBaseMult,
        turbulenceBaseMultFactor: overrides?.turbulenceBaseMultFactor,
        turbulenceCompMult: overrides?.turbulenceCompMult,
      })
      evtTriggerPierce = computePiercePower(
        evtTriggerFinalPanel.hp,
        evtTriggerFinalPanel.atk,
        tBreakdown.totalMods.pierce,
      )
    }

    // 紊乱/乱流倍率取异常强度提供者最终面板（未覆写时）
    // 异放倍率留在异常类触发者面板：按提供者属性从触发者增益筛选
    if (evtTriggerFinalPanel) {
      const o = overrides
      if (damageType === 'disorder') {
        if (o?.disorderBaseMult == null) {
          evtFinalPanel.disorderBaseMult = evtTriggerFinalPanel.disorderBaseMult
        }
        if (o?.disorderBaseMultFactor == null) {
          evtFinalPanel.disorderBaseMultFactor = evtTriggerFinalPanel.disorderBaseMultFactor
        }
        if (o?.disorderCompMult == null) {
          evtFinalPanel.disorderCompMult = evtTriggerFinalPanel.disorderCompMult
        }
      } else if (damageType === 'turbulence') {
        if (o?.turbulenceBaseMult == null) {
          evtFinalPanel.turbulenceBaseMult = evtTriggerFinalPanel.turbulenceBaseMult
        }
        if (o?.turbulenceBaseMultFactor == null) {
          evtFinalPanel.turbulenceBaseMultFactor = evtTriggerFinalPanel.turbulenceBaseMultFactor
        }
        if (o?.turbulenceCompMult == null) {
          evtFinalPanel.turbulenceCompMult = evtTriggerFinalPanel.turbulenceCompMult
        }
      }
    }
  }

  // 增益锚点即旧招式小类，小类倍率仍作为未填倍率时的兜底（倍率修正只写面板，避免双重相乘）
  const sub = resolveSubcategoryById(hit.skill.buffAnchorId ?? null)
  const effectiveSub =
    sub && overrides ? mergeSkillSubcategoryMultOverrides(sub, overrides) : sub

  const luminousMods = resolveLuminousTeamModifiers()

  const actualMainId = mainAgent.value?.id ?? ''
  // 异常增伤/倍率等乘区取异常类触发者；直伤用不到，回落 owner 自己的面板
  let anomalyTriggerPanel = evtFinalPanel
  if (needsPowerAgent) {
    if (!hit.triggerAgentId) return null
    if (hit.triggerAgentId !== ownerAgentId) {
      const trigPanel = computeHitPanelForAgent(hit, hit.triggerAgentId)
      if (!trigPanel) return null
      anomalyTriggerPanel = trigPanel
    }
  }

  if (damageType === 'anomaly' || damageType === 'anomalyRelease') {
    // 属性异常/异放倍率跟着触发者：招式倍率覆写写到触发者面板
    anomalyTriggerPanel = applyOwnerPanelMultOverrides(anomalyTriggerPanel, {
      anomalyMult: overrides?.anomalyMult,
      anomalyMultFactor: overrides?.anomalyMultFactor,
      anomalyReleaseMult: overrides?.anomalyReleaseMult,
      anomalyReleaseMultFactor: overrides?.anomalyReleaseMultFactor,
    })
  }

  // 异放：未手填倍率时，按触发者面板 + 强度提供者属性筛选增益，写回触发者
  if (damageType === 'anomalyRelease') {
    const needReleaseMult = overrides?.anomalyReleaseMult == null
    const needReleaseFactor = overrides?.anomalyReleaseMultFactor == null
    if (needReleaseMult || needReleaseFactor) {
      const triggerId = hit.triggerAgentId ?? ownerAgentId
      const trigSlotIndex = props.teamSlots.findIndex((slot) => slot.agentId === triggerId)
      const trigExternal =
        triggerId === ownerAgentId
          ? ownerExternal
          : resolveOwnerExternalPanel(trigSlotIndex, triggerId)
      const trigAgent = props.agents.find((item) => item.id === triggerId)
      const trigPanelCtx =
        triggerId === ownerAgentId
          ? evtPanelCtx
          : {
              ...buildPanelCalcContextForSlot(
                trigSlotIndex,
                buildExtraModsForHit(hit, triggerId),
              ),
              skillContext: buildSkillContextFromHit(hit, trigAgent?.element),
            }
      const releaseFields = resolveAnomalyReleaseMultFields(
        trigExternal,
        trigPanelCtx,
        evtPowerElement,
      )
      anomalyTriggerPanel = {
        ...anomalyTriggerPanel,
        anomalyReleaseMult: needReleaseMult
          ? releaseFields.anomalyReleaseMult
          : anomalyTriggerPanel.anomalyReleaseMult,
        anomalyReleaseMultFactor: needReleaseFactor
          ? releaseFields.anomalyReleaseMultFactor
          : anomalyTriggerPanel.anomalyReleaseMultFactor,
      }
    }
  }

  if (damageType === 'radiance') {
    anomalyTriggerPanel = applyRadianceBonusMultOverrides(anomalyTriggerPanel, overrides)
    if (hit.triggerAgentId === ownerAgentId || !hit.triggerAgentId) {
      evtFinalPanel = anomalyTriggerPanel
    }
  }

  const ownerResSlot = ownerSlotIndex >= 0 ? ownerSlotIndex : mainSlotIndex.value
  const ownerResistance = resolveDamageCalcResistanceElements(
    props.teamSlots,
    props.agents,
    ownerResSlot,
    evtPowerAgentId,
  )
  const triggerAgentDoc = hit.triggerAgentId
    ? props.agents.find((item) => item.id === hit.triggerAgentId)
    : undefined

  return {
    finalPanel: evtFinalPanel,
    anomalyTriggerPanel,
    piercePower: evtPierce,
    baseDamageSource: evtBaseDamageSource,
    isMbMainAgent: evtOwnerIsMb,
    enemyInput: enemyInput.value,
    combatVulnerable: evtBreakdown.combatMods.vulnerable,
    combatGlobalStaggerVulnerable: evtBreakdown.combatMods.globalStaggerVulnerable,
    combatStaggerVulnerable: evtBreakdown.combatMods.staggerVulnerable,
    combatStaggerVulnerableOnly: evtBreakdown.combatMods.staggerVulnerableOnly ?? 0,
    combatSpecial: evtBreakdown.combatMods.special,
    combatPierceDmgBonus: evtBreakdown.combatMods.pierceDmgBonus,
    staggerPhase: hit.staggerPhase,
    ownerAgentElement: ownerAgent?.element ?? '',
    ownerAgentResistanceElement: ownerResistance.mainAgentResistanceElement,
    anomalyTriggerElement: triggerAgentDoc?.element,
    mainAgentElement: ownerAgent?.element ?? '',
    ...ownerResistance,
    mainAgentId: actualMainId,
    mainAgentName: mainAgent.value?.name ?? '',
    anomalySubKind: evtAnomalySubKind,
    triggerFinalPanel: evtTriggerFinalPanel,
    triggerAgentElement: evtPowerElement,
    triggerPiercePower: evtTriggerPierce,
    triggerBaseDamageSource: resolveAnomalyPowerBaseDamageSource({
      ownerAgentId,
      anomalyPowerAgentId: evtPowerAgentId,
      ownerBaseDamageSource: evtBaseDamageSource,
      anomalyPowerAgentIsMb: evtTriggerIsMb,
    }),
    triggerIsMb: evtTriggerIsMb,
    skillSubcategory: effectiveSub,
    mainAgentLevel: resolveAgentLevel(ownerAgentId),
    ownerAgentLevel: resolveAgentLevel(ownerAgentId),
    triggerAgentLevel: evtPowerAgentId
      ? resolveAgentLevel(evtPowerAgentId)
      : resolveAgentLevel(ownerAgentId),
    mutationZone: luminousMods.mutationZone,
    remielRadianceResPen: damageType === 'radiance' ? luminousMods.radianceResPen : 0,
    remielSelfRadianceCalc: resolveRemielSelfRadianceCalcForPowerProvider(
      evtPowerAgentId,
      buildSkillContextFromHit(hit, ownerAgent?.element),
    ),
  }
}

const damageEventSummary = computed(() => {
  if (props.calcSuspended || !damageCalcEnabled.value || !props.hits?.length) return null
  return summarizeHits(
    props.hits,
    buildHitCalcInput,
    (hit) => props.agents.find((item) => item.id === hit.ownerAgentId)?.name,
  )
})

const previewHitSummary = computed(() => {
  if (props.calcSuspended || !damageCalcEnabled.value || !props.previewHits?.length) return null
  return summarizeHits(props.previewHits, buildHitCalcInput)
})

watch(
  [damageEventSummary, previewHitSummary],
  () => {
    if (props.calcSuspended || !damageCalcEnabled.value) return
    const map: Record<string, number> = {}
    const results: Record<string, DamageCalcResult> = {}
    for (const line of damageEventSummary.value?.lines ?? []) {
      map[line.hit.id] = line.total
      results[line.hit.id] = line.result
    }
    for (const line of previewHitSummary.value?.lines ?? []) {
      map[line.hit.id] = line.perHit
      results[line.hit.id] = line.result
    }
    emit('update:hitDamages', map)
    emit('update:hitCalcResults', results)
  },
  { immediate: true },
)

const hasDamageEvents = computed(() => (props.hits?.length ?? 0) > 0)

const selectedEventDetailLine = computed((): HitLine | null => {
  const base = selectedDamageEventLine.value
  if (!base) return null
  const input = buildHitCalcInput(base.hit)
  if (!input) return base
  const result = computeDamageResult(input)
  const perHit = pickEventDamage(result, base.hit.skill.damageType, base.hit.critMode)
  return {
    ...base,
    result,
    perHit,
    total: perHit * base.hit.count,
  }
})

const showGeneralZone = computed(() => {
  if (!showDetailedResults.value || !selectedEventDetailLine.value) return false
  if (displayCalcParts.value.remielSelfRadianceActive) return false
  return true
})

const displayCalcParts = computed(
  () => selectedEventDetailLine.value?.result ?? calcParts.value,
)

const damageEventSkipHints = computed(() => {
  if (!props.hits?.length) return [] as string[]
  const hints: string[] = []
  const ctx = { teamSlots: props.teamSlots, agents: props.agents }
  for (const hit of props.hits) {
    const reason = getHitSkipReason(hit, ctx)
    if (reason) hints.push(`${hit.skill.name}：${reason}`)
  }
  return hints
})

const hasDamageEventResults = computed(
  () => (damageEventSummary.value?.lines.length ?? 0) > 0,
)

const damageOwnerShareSummary = computed(() => {
  const lines = damageEventSummary.value?.lines
  if (!lines?.length) return null
  return summarizeDamageByOwner(
    lines.map((line) => ({
      ownerAgentId: line.hit.ownerAgentId,
      eventId: line.hit.id,
      displayName: line.displayName,
      total: line.total,
      perHit: line.perHit,
      count: line.hit.count,
    })),
    (id) => props.agents.find((item) => item.id === id),
  )
})

function selectDamageEventFromShare(eventId: string) {
  showDetailedResults.value = true
  selectedDamageEventId.value = eventId
}

const damageEventTotalLabel = computed(() =>
  props.damageKind === 'anomaly' ? '异常伤害事件总伤期望' : '伤害事件总伤期望',
)

const selectedDamageEventLine = computed(
  () =>
    damageEventSummary.value?.lines.find((line) => line.hit.id === selectedDamageEventId.value) ??
    null,
)

watch(
  () => props.hits,
  () => {
    selectedDamageEventId.value = null
  },
)

watch(showDetailedResults, (enabled) => {
  if (!enabled) selectedDamageEventId.value = null
})

const generalFormulaParts = computed(() => {
  const p = calcParts.value
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
  const p = calcParts.value
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
  const p = displayCalcParts.value
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

const anomalyBaseWithMutation = computed(() =>
  resolveAnomalyBaseWithMutation(displayCalcParts.value),
)

const anomalyExpectedFormulaParts = computed(() => {
  const p = calcParts.value
  return [
    formatNumber(anomalyBaseWithMutation.value),
    formatFormulaNumber(p.anomalyDmgBonusZone),
    formatFormulaNumber(p.anomalyMultZone),
    formatFormulaNumber(p.anomalyCritZone),
  ]
})

const disorderFormulaParts = computed(() => {
  const p = calcParts.value
  return [
    formatNumber(anomalyBaseWithMutation.value),
    formatFormulaNumber(p.disorderZone),
    formatFormulaNumber(p.disorderDmgBonusZone),
  ]
})

const turbulenceFormulaParts = computed(() => {
  const p = calcParts.value
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
  | 'pierceDmgMultiplier'
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
  | 'disorderZone'
  | 'disorderDmgBonusZone'
  | 'disorderExpected'
  | 'turbulenceBaseMult'
  | 'turbulenceCompMult'
  | 'turbulenceZone'
  | 'turbulenceDmgBonusZone'
  | 'turbulenceCombinedDmgBonusZone'
  | 'turbulenceExpected'
  | 'anomalyExpected'
  | 'anomalyReleaseExpected'
  | 'radianceExpected'
  | 'radianceMutation'
  | 'radianceCombinedDmgBonusZone'
  | 'radianceMultZone'
  | 'specialMultZone'
  | 'mutationZone'
  | 'remielSelfInCombatAtk'
  | 'remielSelfInCombatMasteryZone'
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
  | 'radianceExpected'
  | 'radianceMutation'
  | 'disorderExpected'
  | 'turbulenceExpected'

interface AlignedFormulaGroup {
  key: AlignedFormulaResultKey
  title: string
  hint?: string
  agentLabel?: string
  terms: AlignedFormulaTerm[]
  result: string
  /** 涉及异常暴击时输出暴击率=0 / =1 两版 */
  dualResults?: { label: string; value: string }[]
}

const effectiveAnomalySubKind = computed(
  () => props.anomalySubKind ?? 'anomaly',
)

const alignedGeneralFormula = computed((): AlignedFormulaGroup => {
  const p = selectedEventDetailLine.value?.result ?? calcParts.value
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

function buildAlignedDirectFormula(
  p: ReturnType<typeof computeDamageResult>,
  resultValue?: string,
) {
  return buildAlignedDirectFormulaGroup(p, formatFormulaNumber, formatNumber, resultValue)
}

const alignedDirectFormula = computed(() => buildAlignedDirectFormula(calcParts.value))

const selectedEventDirectFormula = computed(() => {
  const line = selectedEventDetailLine.value
  if (!line || line.hit.skill.damageType !== 'direct') return null
  return buildAlignedDirectFormula(line.result, formatNumber(line.perHit))
})

const selectedEventAnomalyTitle = computed(() => {
  const line = selectedEventDetailLine.value
  if (!line) return ''
  const damageType = line.hit.skill.damageType
  if (damageType === 'direct') return ''
  if (damageType === 'disorder') {
    return `${line.displayName} · ${line.result.hasPolarDisorder ? '极性紊乱' : '紊乱'}期望伤害`
  }
  if (damageType === 'turbulence') return `${line.displayName} · 乱流期望伤害`
  if (damageType === 'anomalyRelease') return `${line.displayName} · 异放期望伤害`
  if (damageType === 'radiance') return `${line.displayName} · 耀变期望伤害`
  return `${line.displayName} · 异常期望伤害`
})

function resolveAnomalyFormulaLabels(
  hit?: ResolvedHit,
  sub?: AnomalyDamageSubKind,
): AnomalyFormulaAgentLabels {
  const mainName = mainAgent.value?.name
  const remiel = findLuminousAgentInTeam(props.teamSlots, props.agents)
  const remielName = remiel
    ? props.agents.find((item) => item.id === remiel.id)?.name
    : undefined
  const effectiveSub = sub ?? effectiveAnomalySubKind.value
  const usesTriggerBonus =
    effectiveSub === 'anomaly' ||
    effectiveSub === 'anomalyRelease' ||
    effectiveSub === 'radiance'
  const mutationAgent = formatAnomalyFormulaAgentLabel('mutation', remielName)
  if (hit) {
    const nameOf = (id: string | null) =>
      id ? props.agents.find((item) => item.id === id)?.name : undefined
    const ownerName = nameOf(hit.ownerAgentId)
    const powerName = nameOf(hit.anomalyPowerAgentId)
    const triggerName = nameOf(hit.triggerAgentId)
    const hitUsesTriggerBonus =
      hit.skill.damageType === 'anomaly' ||
      hit.skill.damageType === 'anomalyRelease' ||
      hit.skill.damageType === 'radiance'
    return {
      baseAgent: skillNeedsDualAgents(hit.skill.damageType)
        ? formatAnomalyFormulaAgentLabel('anomalyPower', powerName ?? ownerName ?? mainName)
        : formatAnomalyFormulaAgentLabel('owner', ownerName ?? mainName),
      bonusAgent: hitUsesTriggerBonus
        ? formatAnomalyFormulaAgentLabel('trigger', triggerName ?? ownerName ?? mainName)
        : formatAnomalyFormulaAgentLabel('owner', ownerName ?? mainName),
      mutationAgent,
    }
  }
  const triggerName = props.triggerAnomalyAgentId
    ? props.agents.find((item) => item.id === props.triggerAnomalyAgentId)?.name
    : undefined
  return {
    baseAgent:
      props.damageKind === 'anomaly'
        ? formatAnomalyFormulaAgentLabel('anomalyPower', triggerName ?? mainName)
        : formatAnomalyFormulaAgentLabel('owner', mainName),
    bonusAgent: usesTriggerBonus
      ? formatAnomalyFormulaAgentLabel('trigger', triggerName ?? mainName)
      : formatAnomalyFormulaAgentLabel('owner', mainName),
    mutationAgent,
  }
}

function buildAlignedAnomalyFormulasFor(
  p: ReturnType<typeof computeDamageResult>,
  sub: AnomalyDamageSubKind,
  disorderLabel: string,
  labels?: AnomalyFormulaAgentLabels,
): AlignedFormulaGroup[] {
  return buildAlignedAnomalyFormulaGroups(
    p,
    sub,
    disorderLabel,
    formatFormulaNumber,
    formatNumber,
    labels,
  ) as AlignedFormulaGroup[]
}

const alignedAnomalyFormulas = computed((): AlignedFormulaGroup[] =>
  buildAlignedAnomalyFormulasFor(
    calcParts.value,
    effectiveAnomalySubKind.value,
    disorderDamageLabel.value,
    resolveAnomalyFormulaLabels(),
  ),
)

const selectedEventAnomalyFormulas = computed((): AlignedFormulaGroup[] | null => {
  const line = selectedEventDetailLine.value
  if (!line || line.hit.skill.damageType === 'direct') return null
  const anomalySubKind = line.hit.anomalySubKind
  const disorderLabel = line.result.hasPolarDisorder ? '极性紊乱' : '紊乱伤害'
  return buildAlignedAnomalyFormulasFor(
    line.result,
    anomalySubKind,
    disorderLabel,
    resolveAnomalyFormulaLabels(line.hit, anomalySubKind),
  )
})

function formatSigned(value: number) {
  if (value > 0) return `+${value}`
  return String(value)
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

const selectedEventOwnerBreakdown = computed(() => {
  const line = selectedEventDetailLine.value
  if (!line) return null
  const { skillCtx, ownerSlotIndex } = buildHitSkillContext(line.hit)
  const external = resolveOwnerExternalPanel(ownerSlotIndex, line.hit.ownerAgentId)
  return computeFinalPanel(external, buildHitPanelCalcContext(skillCtx, ownerSlotIndex, line.hit))
})

const valueTips = computed(() => {
  // 与界面展示一致：有选中事件时用该事件结果，不用页级第一击
  const p = displayCalcParts.value
  const panel = finalPanel.value
  const external = effectiveExternalPanel.value
  const sources = panelBreakdown.value.sources
  const combat = panelBreakdown.value.combatMods
  const enemy = enemyInput.value
  const pierceMod = panelBreakdown.value.totalMods.pierce

  const remielInTeam = p.remielSelfRadianceActive
    ? findLuminousAgentInTeam(props.teamSlots, props.agents)
    : null
  const remielSelfBreakdown = remielInTeam
    ? computeRemielSelfInCombatPanel(
        resolveExternalPanelForSlotIndex(remielInTeam.slotIndex),
        buildPanelCalcContextForSlot(remielInTeam.slotIndex),
        remielInTeam.slotIndex,
      )
    : null
  const remielSelfPanel = remielSelfBreakdown?.finalPanel
  const remielSelfSources = remielSelfBreakdown?.sources ?? []
  const remielSelfExternal = remielInTeam
    ? resolveExternalPanelForSlotIndex(remielInTeam.slotIndex)
    : external
  const remielSelfEnemyRes =
    p.remielSelfRadianceActive && p.remielSelfResistanceElement
      ? resolveEnemyResistanceForElement(
          normalizeDamageEnemyInput(enemy),
          p.remielSelfResistanceElement,
        )
      : 0
  const remielSelfResPenTotal =
    (remielSelfPanel?.resPen ?? 0) + (remielSelfPanel?.radianceResPen ?? 0)
  const remielIsMb =
    remielInTeam?.id != null &&
    props.agents.find((item) => item.id === remielInTeam.id)?.profession === MB_PROFESSION

  const eventLine = selectedEventDetailLine.value
  const ownerBreakdown = selectedEventOwnerBreakdown.value
  const eventOwnerCtx = eventLine ? buildHitSkillContext(eventLine.hit) : null
  const eventHitInput = eventLine ? buildHitCalcInput(eventLine.hit) : null

  // 类型增伤/倍率/暴击：属性异常/异放/耀变→异常类触发者；紊乱/乱流→招式持有者
  let bonusPanel = panel
  let bonusExternal = external
  let bonusSources = sources
  if (eventLine && eventOwnerCtx) {
    const damageType = eventLine.hit.skill.damageType
    const usesTriggerBonus =
      damageType === 'anomaly' ||
      damageType === 'anomalyRelease' ||
      damageType === 'radiance'
    const bonusAgentId = usesTriggerBonus
      ? (eventLine.hit.triggerAgentId ?? eventLine.hit.ownerAgentId)
      : eventLine.hit.ownerAgentId
    const bonusSlotIndex = props.teamSlots.findIndex((slot) => slot.agentId === bonusAgentId)
    if (bonusSlotIndex >= 0) {
      if (!usesTriggerBonus && ownerBreakdown && bonusAgentId === eventLine.hit.ownerAgentId) {
        bonusPanel = ownerBreakdown.finalPanel
        bonusExternal = resolveOwnerExternalPanel(eventOwnerCtx.ownerSlotIndex, bonusAgentId)
        bonusSources = ownerBreakdown.sources
      } else {
        const be = resolveOwnerExternalPanel(bonusSlotIndex, bonusAgentId)
        const bonusElement = props.agents.find((item) => item.id === bonusAgentId)?.element
        const bb = computeFinalPanel(be, {
          ...buildPanelCalcContextForSlot(
            bonusSlotIndex,
            buildExtraModsForHit(eventLine.hit, bonusAgentId),
          ),
          skillContext: buildSkillContextFromHit(eventLine.hit, bonusElement),
        })
        bonusPanel =
          damageType === 'radiance'
            ? applyRadianceBonusMultOverrides(bb.finalPanel, eventLine.hit.multOverrides)
            : damageType === 'anomaly' || damageType === 'anomalyRelease'
              ? applyOwnerPanelMultOverrides(bb.finalPanel, {
                  anomalyMult: eventLine.hit.multOverrides?.anomalyMult,
                  anomalyMultFactor: eventLine.hit.multOverrides?.anomalyMultFactor,
                  anomalyReleaseMult: eventLine.hit.multOverrides?.anomalyReleaseMult,
                  anomalyReleaseMultFactor:
                    eventLine.hit.multOverrides?.anomalyReleaseMultFactor,
                })
              : bb.finalPanel
        // 异放 tip：未手填时补上与结算相同的转模筛选
        if (damageType === 'anomalyRelease') {
          const o = eventLine.hit.multOverrides
          const needMult = o?.anomalyReleaseMult == null
          const needFactor = o?.anomalyReleaseMultFactor == null
          if (needMult || needFactor) {
            const powerElement = resolveHitPowerElement(eventLine.hit)
            const releaseFields = resolveAnomalyReleaseMultFields(
              be,
              {
                ...buildPanelCalcContextForSlot(
                  bonusSlotIndex,
                  buildExtraModsForHit(eventLine.hit, bonusAgentId),
                ),
                skillContext: buildSkillContextFromHit(eventLine.hit, bonusElement),
              },
              powerElement,
            )
            bonusPanel = {
              ...bonusPanel,
              anomalyReleaseMult: needMult
                ? releaseFields.anomalyReleaseMult
                : bonusPanel.anomalyReleaseMult,
              anomalyReleaseMultFactor: needFactor
                ? releaseFields.anomalyReleaseMultFactor
                : bonusPanel.anomalyReleaseMultFactor,
            }
          }
        }
        bonusExternal = be
        bonusSources = bb.sources
      }
    }
  }

  // 减防/无视防御 tip：始终取异常类触发者（与 damageCalc.defensePanel 一致）
  let defTrigPanel = panel
  let defTrigSources = sources
  let defTrigAgentLabel = mainAgent.value?.name ?? '招式持有者'
  if (eventLine) {
    const trigId = eventLine.hit.triggerAgentId
    if (trigId) {
      const damageType = eventLine.hit.skill.damageType
      const bonusIsTrigger =
        damageType === 'anomaly' ||
        damageType === 'anomalyRelease' ||
        damageType === 'radiance'
      const bonusAgentId = bonusIsTrigger
        ? (eventLine.hit.triggerAgentId ?? eventLine.hit.ownerAgentId)
        : null
      if (bonusIsTrigger && bonusAgentId === trigId) {
        defTrigPanel = bonusPanel
        defTrigSources = bonusSources
      } else {
        const trigSlotIndex = props.teamSlots.findIndex((slot) => slot.agentId === trigId)
        if (trigSlotIndex >= 0) {
          const te = resolveOwnerExternalPanel(trigSlotIndex, trigId)
          const trigElement = props.agents.find((item) => item.id === trigId)?.element
          const tb = computeFinalPanel(te, {
            ...buildPanelCalcContextForSlot(
              trigSlotIndex,
              buildExtraModsForHit(eventLine.hit, trigId),
            ),
            skillContext: buildSkillContextFromHit(eventLine.hit, trigElement),
          })
          defTrigPanel = tb.finalPanel
          defTrigSources = tb.sources
        }
      }
      defTrigAgentLabel =
        props.agents.find((item) => item.id === trigId)?.name ?? '异常类触发者'
    }
  }

  // 异常基础 / 紊乱乱流倍率 tip：按选中事件的强度提供者，不再绑页级第一击
  const sub = (eventLine?.hit.anomalySubKind ?? effectiveAnomalySubKind.value) as AnomalyDamageSubKind
  const eventPowerId = eventLine?.hit.anomalyPowerAgentId ?? props.triggerAnomalyAgentId
  const eventPowerSlotIndex =
    eventPowerId != null
      ? props.teamSlots.findIndex((slot) => slot.agentId === eventPowerId)
      : -1
  const eventPowerAgent =
    eventPowerId != null
      ? props.agents.find((item) => item.id === eventPowerId)
      : triggerAgent.value

  let eventPowerBreakdown = triggerPanelBreakdown.value
  let eventPowerExternal = triggerExternalPanel.value
  if (eventLine && eventPowerId && eventPowerSlotIndex >= 0) {
    if (eventPowerId === eventLine.hit.ownerAgentId && ownerBreakdown) {
      eventPowerBreakdown = ownerBreakdown
      eventPowerExternal = resolveOwnerExternalPanel(
        eventOwnerCtx?.ownerSlotIndex ?? eventPowerSlotIndex,
        eventPowerId,
      )
    } else {
      // 有选中 hit 时始终按 hit 增益重算，避免复用页级第一击、漏来源
      const pe = resolveOwnerExternalPanel(eventPowerSlotIndex, eventPowerId)
      eventPowerExternal = pe
      eventPowerBreakdown = computeFinalPanel(pe, {
        ...buildPanelCalcContextForSlot(
          eventPowerSlotIndex,
          buildExtraModsForHit(eventLine.hit, eventPowerId),
        ),
        skillContext: buildSkillContextFromHit(eventLine.hit, eventPowerAgent?.element),
      })
    }
  }

  const eventPowerFinalPanel =
    eventHitInput?.triggerFinalPanel ??
    eventPowerBreakdown?.finalPanel ??
    triggerFinalPanel.value

  const usesProducerBase =
    (sub === 'anomaly' ||
      sub === 'turbulence' ||
      sub === 'disorder' ||
      sub === 'anomalyRelease' ||
      sub === 'radiance') &&
    Boolean(eventPowerFinalPanel && eventPowerExternal && eventPowerBreakdown)
  const usesProducerMult = usesProducerBase && (sub === 'turbulence' || sub === 'disorder')
  // 有选中事件时：直伤/持有者乘区 tip 跟招式持有者，勿绑页级编辑槽
  const ownerTipPanel = ownerBreakdown?.finalPanel ?? panel
  const ownerTipExternal =
    eventLine && ownerBreakdown && eventOwnerCtx
      ? resolveOwnerExternalPanel(eventOwnerCtx.ownerSlotIndex, eventLine.hit.ownerAgentId)
      : external
  const ownerTipSources = ownerBreakdown?.sources ?? sources
  const ownerTipPierceMod = ownerBreakdown?.totalMods.pierce ?? pierceMod
  const ownerTipAgent =
    eventLine != null
      ? props.agents.find((item) => item.id === eventLine.hit.ownerAgentId)
      : mainAgent.value
  const tipPanel = usesProducerBase ? eventPowerFinalPanel! : ownerTipPanel
  const tipExternal = usesProducerBase ? eventPowerExternal! : ownerTipExternal
  const tipSources = usesProducerBase ? eventPowerBreakdown!.sources : ownerTipSources
  const tipPierceMod = usesProducerBase
    ? eventPowerBreakdown!.totalMods.pierce
    : ownerTipPierceMod
  const tipPiercePower = usesProducerBase
    ? (eventHitInput?.triggerPiercePower ?? triggerPiercePower.value)
    : eventLine
      ? computePiercePower(ownerTipPanel.hp, ownerTipPanel.atk, ownerTipPierceMod)
      : piercePower.value
  const tipIsMb = usesProducerBase
    ? eventPowerAgent?.profession === MB_PROFESSION
    : ownerTipAgent?.profession === MB_PROFESSION
  const multPanel = usesProducerMult ? eventPowerFinalPanel! : ownerTipPanel
  const multExternal = usesProducerMult ? eventPowerExternal! : ownerTipExternal
  const multSources = usesProducerMult ? eventPowerBreakdown!.sources : ownerTipSources
  const durationPanel = usesProducerBase ? eventPowerFinalPanel! : ownerTipPanel
  const durationExternal = usesProducerBase ? eventPowerExternal! : ownerTipExternal
  const durationSources = usesProducerBase ? eventPowerBreakdown!.sources : ownerTipSources
  const producerExtraGroup = usesProducerBase
    ? [
        {
          label: eventPowerAgent?.name ?? '产生角色',
          items:
            sub === 'radiance' && p.remielSelfRadianceActive
              ? [RADIANCE_SELF_TRIGGER_HINT]
              : usesProducerMult
                ? [
                    '异常基础乘区、紊乱/乱流倍率与异常持续时间取异常强度提供者面板；乱流/紊乱增伤与异常暴击取招式持有者；减防/无视防御取异常类触发者',
                  ]
                : ['异常基础乘区（含等级区）取异常强度提供者面板；减防/无视防御取异常类触发者'],
        },
      ]
    : []

  const atkGroups = buildStatSourceGroups({
    keys: ['inCombatAtkPercent', 'atk'],
    externalPanel: tipExternal,
    sources: tipSources,
    externalKeyMap: { inCombatAtkPercent: null, atk: null },
    extraGroups: tipExternal.atk
      ? [{ label: '局外面板', items: [`攻击力 ${formatFormulaNumber(tipExternal.atk, 2)}`] }]
      : [],
  })

  const hpGroups = buildStatSourceGroups({
    keys: ['inCombatHpPercent'],
    externalPanel: tipExternal,
    sources: tipSources,
    externalKeyMap: { inCombatHpPercent: null },
    extraGroups: tipExternal.hp
      ? [{ label: '局外面板', items: [`生命值 ${formatFormulaNumber(tipExternal.hp, 2)}`] }]
      : [],
  })

  const pierceGroups = buildStatSourceGroups({
    keys: ['pierce'],
    externalPanel: tipExternal,
    sources: tipSources,
    externalKeyMap: { pierce: null },
  })

  const defGroups = buildStatSourceGroups({
    keys: ['inCombatDefPercent', 'def'],
    externalPanel: tipExternal,
    sources: tipSources,
    externalKeyMap: { inCombatDefPercent: null, def: null },
    extraGroups: tipExternal.def
      ? [{ label: '局外面板', items: [`防御力 ${formatFormulaNumber(tipExternal.def, 2)}`] }]
      : [],
  })

  const atkProcessItems = buildAtkPanelProcessItems({
    externalAtk: tipExternal.atk,
    finalAtk: tipPanel.atk,
    sources: tipSources,
  })

  const defProcessItems = buildDefPanelProcessItems({
    externalDef: tipExternal.def,
    finalDef: tipPanel.def,
    sources: tipSources,
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
    `贯穿力 ${formatFormulaNumber(tipPiercePower, 2)} = 0.1×${formatFormulaNumber(tipPanel.hp, 2)} + 0.3×${formatFormulaNumber(tipPanel.atk, 2)} + ${formatFormulaNumber(tipPierceMod, 2)}`,
    [
      ...(atkProcessItems.length ? ['攻击力：', ...atkProcessItems] : []),
      `贯穿力 = 0.1 × ${formatFormulaNumber(tipPanel.hp, 2)} + 0.3 × ${formatFormulaNumber(tipPanel.atk, 2)} + ${formatFormulaNumber(tipPierceMod, 2)} = ${formatFormulaNumber(tipPiercePower, 2)}`,
    ],
  )

  return {
    baseDamage:
      p.baseDamageSource === 'atk'
        ? withTotal(
            atkGroups,
            `局内攻击力 ${formatFormulaNumber(tipPanel.atk, 2)}`,
            atkProcessItems,
          )
        : p.baseDamageSource === 'def'
          ? withTotal(
              defGroups,
              `局内防御力 ${formatFormulaNumber(tipPanel.def, 2)}`,
              defProcessItems,
            )
          : pierceBaseDamageTips,
    dmgMultiplier: withTotal(
      buildStatSourceGroups({
        keys: ['dmgBonus'],
        externalPanel: tipExternal,
        sources: tipSources,
        finalValues: { dmgBonus: tipPanel.dmgBonus },
      }),
      `局内增伤 ${formatFormulaNumber(tipPanel.dmgBonus, 2)}% → 增伤区 1 + ${formatFormulaNumber(tipPanel.dmgBonus, 2)}% = ${formatFormulaNumber(p.dmgMultiplier)}`,
    ),
    defenseMultiplier: tipIsMb
      ? [
          {
            label: usesProducerBase
              ? (eventPowerAgent?.name ?? '异常强度提供者')
              : (ownerTipAgent?.name ?? mainAgent.value?.name ?? '招式持有者'),
            items: ['防御区固定为 1'],
          },
        ]
      : withTotal(
          buildStatSourceGroups({
            keys: usesProducerBase ? ['penRate'] : ['reduceDefense', 'penRate'],
            externalPanel: tipExternal,
            sources: tipSources,
            finalValues: usesProducerBase
              ? { penRate: tipPanel.penRate }
              : { reduceDefense: tipPanel.reduceDefense, penRate: tipPanel.penRate },
            extraGroups: usesProducerBase
              ? [
                  {
                    label: `异常类触发者 · ${defTrigAgentLabel}`,
                    items: [
                      `减防 ${formatFormulaNumber(defTrigPanel.reduceDefense, 2)}%`,
                      `无视防御 ${formatFormulaNumber(defTrigPanel.ignoreDefense, 2)}%`,
                      ...defTrigSources
                        .filter((s) => s.mods.reduceDefense || s.mods.ignoreDefense)
                        .map((s) => {
                          const parts: string[] = []
                          if (s.mods.reduceDefense) {
                            parts.push(`减防 ${formatSigned(s.mods.reduceDefense)}%`)
                          }
                          if (s.mods.ignoreDefense) {
                            parts.push(`无视 ${formatSigned(s.mods.ignoreDefense)}%`)
                          }
                          return `${s.label} ${parts.join(' · ')}`
                        }),
                    ],
                  },
                  {
                    label: '敌方与环境 / 局外面板',
                    items: [
                      `敌方防御 ${formatFormulaNumber(enemy.defense, 2)}`,
                      `穿透值 ${formatFormulaNumber(tipExternal.pen, 2)}`,
                    ],
                  },
                ]
              : [
                  {
                    label: '敌方与环境 / 局外面板',
                    items: [
                      `敌方防御 ${formatFormulaNumber(enemy.defense, 2)}`,
                      `无视防御/减防 ${formatFormulaNumber(tipPanel.ignoreDefense + tipPanel.reduceDefense, 2)}%`,
                      `穿透值 ${formatFormulaNumber(tipExternal.pen, 2)}`,
                    ],
                  },
                ],
            showAdditiveProcess: false,
          }),
          `有效防御 ${formatFormulaNumber(p.effectiveDefense, 2)} → 防御区 794 / (794 + ${formatFormulaNumber(p.effectiveDefense, 2)}) = ${formatFormulaNumber(p.defenseMultiplier)}`,
          [
            `穿透率 ${formatFormulaNumber(tipPanel.penRate, 2)}%（${usesProducerBase ? '强度提供者' : '持有者'}）`,
            `减防 ${formatFormulaNumber(defTrigPanel.reduceDefense, 2)}% + 无视 ${formatFormulaNumber(defTrigPanel.ignoreDefense, 2)}%（${usesProducerBase ? '触发者' : '持有者'}）`,
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
          externalPanel: tipExternal,
          sources: tipSources,
          finalValues: { resPen: tipPanel.resPen },
          showAdditiveProcess: false,
        }),
      ],
      `抗性区 1 - ${formatFormulaNumber(p.enemyResistance)} + ${formatFormulaNumber(tipPanel.resPen, 2)}% = ${formatFormulaNumber(p.resistanceMultiplier)}`,
      [
        `敌方抗性 ${formatFormulaNumber(p.enemyResistance)}`,
        ...(tipPanel.resPen || tipSources.some((s) => s.mods.resPen)
          ? [
              `局内抗穿 ${formatFormulaNumber(tipPanel.resPen, 2)}%`,
              ...tipSources
                .filter((s) => s.mods.resPen)
                .map((s) => `${s.label} ${formatSigned(s.mods.resPen)}%`),
            ]
          : []),
        `1 - ${formatFormulaNumber(p.enemyResistance)} + ${formatFormulaNumber(tipPanel.resPen, 2)}% = ${formatFormulaNumber(p.resistanceMultiplier)}`,
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
          externalPanel: tipExternal,
          sources: tipSources,
          externalKeyMap: { vulnerable: null },
          showAdditiveProcess: false,
        }),
      ],
      `易伤区 ${formatFormulaNumber(p.vulnerableMultiplier)}`,
      buildEnemyCombatProcessItems({
        baseLabel: '易伤基础',
        baseValue: enemy.vulnerableMultiplier,
        sources: tipSources,
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
          externalPanel: tipExternal,
          sources: tipSources,
          externalKeyMap: { staggerVulnerable: null },
          showAdditiveProcess: false,
        }),
      ],
      `失衡易伤区 ${formatFormulaNumber(p.staggerMultiplier)}`,
      buildEnemyCombatProcessItems({
        baseLabel: '失衡易伤基础',
        baseValue: enemy.staggerMultiplier,
        sources: tipSources,
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
        externalPanel: tipExternal,
        sources: tipSources,
        finalValues: { critRate: tipPanel.critRate },
      }),
      `局内暴击 ${formatFormulaNumber(tipPanel.critRate, 2)}% = ${formatFormulaNumber(p.critRateRatio)}（计入上限）`,
    ),
    critMultiplier: withTotal(
      buildStatSourceGroups({
        keys: ['critRate', 'critDmg'],
        externalPanel: tipExternal,
        sources: tipSources,
        finalValues: { critRate: tipPanel.critRate, critDmg: tipPanel.critDmg },
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
          externalPanel: tipExternal,
          sources: tipSources,
          externalKeyMap: { special: null },
          showAdditiveProcess: false,
        }),
      ],
      `特殊乘区 ${formatFormulaNumber(p.specialMultiplier)}`,
      buildEnemyCombatProcessItems({
        baseLabel: '特殊乘区基础',
        baseValue: enemy.specialMultiplier,
        sources: tipSources,
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
          externalPanel: tipExternal,
          sources: tipSources,
          externalKeyMap: { pierceDmgBonus: null },
          showAdditiveProcess: false,
        }),
      ],
      `贯穿增伤区 ${formatFormulaNumber(p.pierceDmgMultiplier)}`,
    ),
    directDmgMultZone: withTotal(
      buildStatSourceGroups({
        keys: ['directDmgMult', 'directDmgMultFactor'],
        externalPanel: tipExternal,
        sources: tipSources,
        finalValues: {
          directDmgMult: tipPanel.directDmgMult,
          directDmgMultFactor: tipPanel.directDmgMultFactor,
        },
      }),
      formatDirectDmgMultZoneFormula(tipPanel, p.directDmgMultZone, resolvedSkillSubcategory.value),
    ),
    settlementDmgMultZone: withTotal(
      buildStatSourceGroups({
        keys: ['settlementDmgMult', 'directDmgMultFactor'],
        externalPanel: tipExternal,
        sources: tipSources,
        finalValues: {
          settlementDmgMult: tipPanel.settlementDmgMult,
          directDmgMultFactor: tipPanel.directDmgMultFactor,
        },
      }),
      formatSettlementDmgMultZoneFormula(tipPanel, p.settlementDmgMultZone, resolvedSkillSubcategory.value),
    ),
    penRateRatio: withTotal(
      buildStatSourceGroups({
        keys: ['penRate'],
        externalPanel: tipExternal,
        sources: tipSources,
        finalValues: { penRate: tipPanel.penRate },
      }),
      `局内穿透率 ${formatFormulaNumber(tipPanel.penRate, 2)}% = ${formatFormulaNumber(p.penRateRatio)}（计入上限）`,
    ),
    effectiveDefense: withTotal(
      buildStatSourceGroups({
        keys: usesProducerBase ? ['penRate'] : ['reduceDefense', 'penRate'],
        externalPanel: tipExternal,
        sources: tipSources,
        finalValues: usesProducerBase
          ? { penRate: tipPanel.penRate }
          : { reduceDefense: tipPanel.reduceDefense, penRate: tipPanel.penRate },
        extraGroups: [
          ...(usesProducerBase
            ? [
                {
                  label: `异常类触发者 · ${defTrigAgentLabel}`,
                  items: [
                    `减防 ${formatFormulaNumber(defTrigPanel.reduceDefense, 2)}%`,
                    `无视防御 ${formatFormulaNumber(defTrigPanel.ignoreDefense, 2)}%`,
                  ],
                },
              ]
            : []),
          {
            label: '敌方与环境 / 局外面板',
            items: [
              `敌方防御 ${formatFormulaNumber(enemy.defense, 2)}`,
              `无视防御/减防 ${formatFormulaNumber(defTrigPanel.ignoreDefense + defTrigPanel.reduceDefense, 2)}%`,
              `穿透值 ${formatFormulaNumber(tipExternal.pen, 2)}`,
            ],
          },
        ],
        showAdditiveProcess: false,
      }),
      `有效防御 ${formatFormulaNumber(p.effectiveDefense, 2)}`,
      (() => {
        const defenseCut = defTrigPanel.ignoreDefense + defTrigPanel.reduceDefense
        const defenseAfter = enemy.defense * p.defenseFactor * (1 - p.penRateRatio)
        return [
          `防御因子 = max(0, 1 − 无视防御/减防) = max(0, 1 − ${formatFormulaNumber(defenseCut / 100)}) = ${formatFormulaNumber(p.defenseFactor)}`,
          `折后防御 = 敌方防御 × 防御因子 × (1 − 穿透率) = ${formatFormulaNumber(enemy.defense, 2)} × ${formatFormulaNumber(p.defenseFactor)} × (1 − ${formatFormulaNumber(p.penRateRatio)}) = ${formatFormulaNumber(defenseAfter, 2)}`,
          `有效防御 = max(0, 折后防御) − 穿透值 = max(0, ${formatFormulaNumber(defenseAfter, 2)}) − ${formatFormulaNumber(tipExternal.pen, 2)} = ${formatFormulaNumber(p.effectiveDefense, 2)}`,
        ]
      })(),
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
      `贯穿力 ${formatFormulaNumber(tipPiercePower, 2)} = 0.1×${formatFormulaNumber(tipPanel.hp, 2)} + 0.3×${formatFormulaNumber(tipPanel.atk, 2)} + ${formatFormulaNumber(tipPierceMod, 2)}`,
      [
        ...(atkProcessItems.length ? ['攻击力：', ...atkProcessItems] : []),
        `贯穿力 = 0.1 × ${formatFormulaNumber(tipPanel.hp, 2)} + 0.3 × ${formatFormulaNumber(tipPanel.atk, 2)} + ${formatFormulaNumber(tipPierceMod, 2)} = ${formatFormulaNumber(tipPiercePower, 2)}`,
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
      [
        ...producerExtraGroup,
        ...buildStatSourceGroups({
          keys: ['mastery'],
          externalPanel: tipExternal,
          sources: tipSources,
          finalValues: { mastery: tipPanel.mastery },
        }),
      ],
      `精通区 ${formatFormulaNumber(tipPanel.mastery, 2)} → ${formatFormulaNumber(p.masteryZone)}`,
    ),
    remielSelfInCombatAtk: p.remielSelfRadianceActive
      ? [
          {
            label: '本人耀变局内攻击（特殊口径）',
            items: [
              `局外攻击力 ${formatFormulaNumber(remielSelfExternal.atk, 2)}`,
              `+ 自身攻击力转模 ${formatFormulaNumber(
                Math.max(0, (p.remielSelfInCombatAtk ?? 0) - remielSelfExternal.atk),
                2,
              )}`,
              `= ${formatFormulaNumber(p.remielSelfInCombatAtk ?? 0, 2)}`,
              '仅：局外攻击 + 蕾米埃尔角色/影画「攻击力转模」',
              '不含局内攻击%、队友/邦布、音擎/驱动盘其它攻击增益',
            ],
          },
          {
            label: '对照（本人耀变不用）',
            items: [
              `完整局内攻击（仅本槽） ${formatFormulaNumber(remielSelfPanel?.atk ?? tipPanel.atk, 2)}`,
              `当前编辑槽局内攻击 ${formatFormulaNumber(tipPanel.atk, 2)}`,
            ],
          },
        ]
      : [],
    remielSelfInCombatMasteryZone: p.remielSelfRadianceActive
      ? [
          {
            label: '本人耀变局内精通（特殊口径）',
            items: [
              `局外精通 ${formatFormulaNumber(remielSelfExternal.mastery, 2)}`,
              `+ 四件套/音擎全局精通 ${formatFormulaNumber(
                Math.max(
                  0,
                  (p.remielSelfInCombatMasteryZone ?? 0) * 100 - remielSelfExternal.mastery,
                ),
                2,
              )}`,
              `局内精通 ${formatFormulaNumber((p.remielSelfInCombatMasteryZone ?? 0) * 100, 2)}`,
              `局内精通区 ÷100 → ${formatFormulaNumber(p.remielSelfInCombatMasteryZone ?? 0)}`,
              '仅：局外精通 + 驱动盘4件套全局精通 + 音擎全局精通',
              '不含队友/邦布及其它精通增益',
            ],
          },
          {
            label: '对照（本人耀变不用）',
            items: [
              `完整局内精通（仅本槽） ${formatFormulaNumber(remielSelfPanel?.mastery ?? tipPanel.mastery, 2)} → 区 ${formatFormulaNumber((remielSelfPanel?.mastery ?? tipPanel.mastery) / 100)}`,
              `当前编辑槽局内精通 ${formatFormulaNumber(tipPanel.mastery, 2)} → 区 ${formatFormulaNumber(p.masteryZone)}`,
            ],
          },
        ]
      : [],
    levelZone: [
      ...(usesProducerBase ? producerExtraGroup : []),
      {
        label: usesProducerBase
          ? (eventPowerAgent?.name ?? '异常强度提供者')
          : (ownerTipAgent?.name ?? mainAgent.value?.name ?? '招式持有者'),
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
              ...(p.remielSelfResistanceElement
                ? [`抗性基准属性 ${p.remielSelfResistanceElement}`]
                : []),
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
          externalPanel: durationExternal,
          sources: durationSources,
          finalValues: { anomalyDuration: durationPanel.anomalyDuration },
        }),
      ],
      `异常持续时间 ${formatFormulaNumber(durationPanel.anomalyDuration, 2)}s → 有效 ${formatFormulaNumber(p.effectiveAnomalyDuration)}s`,
      (() => {
        const trigEl =
          (eventLine?.hit.triggerAgentId
            ? props.agents.find((item) => item.id === eventLine.hit.triggerAgentId)?.element
            : null) ||
          eventPowerAgent?.element ||
          ''
        const items = [
          `面板持续时间 ${formatFormulaNumber(durationPanel.anomalyDuration, 2)}s（强度提供者）`,
        ]
        if (trigEl === '火' || trigEl === '以太') {
          items.push(
            `触发者属性 ${trigEl}：有效时间 = 面板 / 0.5`,
            `${formatFormulaNumber(durationPanel.anomalyDuration, 2)} / 0.5 = ${formatFormulaNumber(p.effectiveAnomalyDuration)}s`,
          )
        } else {
          items.push(
            trigEl ? `触发者属性 ${trigEl}：有效时间 = 面板` : '有效时间 = 面板',
            `= ${formatFormulaNumber(p.effectiveAnomalyDuration)}s`,
          )
        }
        return items
      })(),
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
    radianceExpected: p.remielSelfRadianceActive
      ? [
          {
            label: '乘区组成',
            items: [
              `蕾米埃尔异常基础 ${formatNumber(anomalyBaseWithMutation.value)}`,
              `防御区 ${formatFormulaNumber(p.remielSelfDefenseMultiplier ?? 1)}`,
              `抗性区 ${formatFormulaNumber(p.remielSelfResistanceMultiplier ?? 1)}${
                p.remielSelfResistanceElement ? `（基准属性 ${p.remielSelfResistanceElement}）` : ''
              }`,
              `易伤区 ${formatFormulaNumber(p.vulnerableMultiplier)}`,
              `失衡易伤区 ${formatFormulaNumber(p.staggerMultiplier)}`,
              `耀变综合增伤区 ${formatFormulaNumber(p.radianceCombinedDmgBonusZone)}（耀变增伤+异常增伤）`,
              `耀变倍率区 ${formatFormulaNumber(p.radianceMultZone)}`,
              `特殊倍率乘区 ${formatFormulaNumber(p.specialMultZone)}`,
              `特殊乘区 ${formatFormulaNumber(p.specialMultiplier)}`,
            ],
          },
        ]
      : [
          {
            label: '乘区组成',
            items: [
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
    specialMultZone: withTotal(
      buildStatSourceGroups({
        keys: ['specialMult', 'specialMultFactor'],
        externalPanel: bonusExternal,
        sources: bonusSources,
        externalKeyMap: { specialMult: null, specialMultFactor: null },
        finalValues: {
          specialMult: bonusPanel.specialMult,
          specialMultFactor: bonusPanel.specialMultFactor,
        },
      }),
      `特殊倍率乘区 max(0, ${formatFormulaNumber(bonusPanel.specialMult, 2)}%) × 修正 ${formatFormulaNumber(bonusPanel.specialMultFactor ?? 100, 2)}% = ${formatFormulaNumber(p.specialMultZone)}`,
      [
        `加算 ${formatFormulaNumber(bonusPanel.specialMult, 2)}% → ${formatFormulaNumber(Math.max(0, bonusPanel.specialMult / 100))}`,
        `倍率修正 ${formatFormulaNumber(bonusPanel.specialMultFactor ?? 100, 2)}% → ×${formatFormulaNumber((bonusPanel.specialMultFactor ?? 100) / 100)}`,
        `= ${formatFormulaNumber(p.specialMultZone)}`,
      ],
    ),
    mutationZone: [
      {
        label: p.remielSelfRadianceActive ? '异化系数（本人耀变）' : '异化系数',
        items: [
          '取蕾米埃尔最终局内面板的异化系数与修正（含队友等）',
          `异化系数区 ${formatFormulaNumber(
            p.remielSelfRadianceActive
              ? (p.remielSelfMutationZone ?? p.mutationZone)
              : p.mutationZone,
          )}`,
        ],
      },
    ],
    remielSelfDefenseMultiplier: p.remielSelfRadianceActive
      ? remielIsMb
        ? [{ label: '蕾米埃尔', items: ['防御区固定为 1（命破）'] }]
        : withTotal(
            buildStatSourceGroups({
              keys: ['penRate'],
              externalPanel: remielSelfExternal,
              sources: remielSelfSources,
              finalValues: { penRate: remielSelfPanel?.penRate ?? 0 },
              extraGroups: [
                {
                  label: `异常类触发者 · ${defTrigAgentLabel}`,
                  items: [
                    `减防 ${formatFormulaNumber(defTrigPanel.reduceDefense, 2)}%`,
                    `无视防御 ${formatFormulaNumber(defTrigPanel.ignoreDefense, 2)}%`,
                  ],
                },
                {
                  label: '敌方与环境 / 局外面板',
                  items: [
                    `敌方防御 ${formatFormulaNumber(enemy.defense, 2)}`,
                    `穿透值 ${formatFormulaNumber(remielSelfExternal.pen, 2)}`,
                  ],
                },
              ],
              showAdditiveProcess: false,
            }),
            `防御区 ${formatFormulaNumber(p.remielSelfDefenseMultiplier ?? 1)}（穿透取蕾米埃尔；减防/无视取异常类触发者）`,
          )
      : [],
    remielSelfResistanceMultiplier: p.remielSelfRadianceActive
      ? withTotal(
          [
            {
              label: '敌方与环境',
              items: [
                p.remielSelfResistanceElement
                  ? `${p.remielSelfResistanceElement} 抗性 ${formatFormulaNumber(remielSelfEnemyRes)}（${resistanceTypeLabel(
                      ensureElementResistanceMap()[
                        p.remielSelfResistanceElement as EnemyResistanceElement
                      ] ?? 'normal',
                    )}）`
                  : '无后续非流明队友，敌方抗性按无弱点无抗性（0）',
              ],
            },
            ...buildStatSourceGroups({
              keys: ['resPen', 'radianceResPen'],
              externalPanel: remielSelfExternal,
              sources: remielSelfSources,
              finalValues: {
                resPen: remielSelfPanel?.resPen ?? 0,
                radianceResPen: remielSelfPanel?.radianceResPen ?? 0,
              },
              showAdditiveProcess: false,
            }),
          ],
          `抗性区 1 - ${formatFormulaNumber(remielSelfEnemyRes)} + ${formatFormulaNumber(remielSelfResPenTotal, 2)}% = ${formatFormulaNumber(p.remielSelfResistanceMultiplier ?? 1)}`,
          [
            p.remielSelfResistanceElement
              ? `基准属性 ${p.remielSelfResistanceElement} · 敌方抗性 ${formatFormulaNumber(remielSelfEnemyRes)}`
              : '无后续非流明队友 · 敌方抗性 0',
            ...(remielSelfResPenTotal
              ? [`抗穿合计 ${formatFormulaNumber(remielSelfResPenTotal, 2)}%`]
              : []),
            `1 - ${formatFormulaNumber(remielSelfEnemyRes)} + ${formatFormulaNumber(remielSelfResPenTotal, 2)}% = ${formatFormulaNumber(p.remielSelfResistanceMultiplier ?? 1)}`,
          ],
        )
      : [],
  }
})

const selectedEventDmgMultiplierTips = computed(() => {
  const line = selectedEventDetailLine.value
  const p = displayCalcParts.value
  if (!line) return valueTips.value.dmgMultiplier

  // 紊乱/乱流/异放/耀变/属性异常：通用增伤区（异常基础链）取异常强度提供者；直伤取招式持有者
  const damageType = line.hit.skill.damageType
  const usesProducerBase =
    damageType === 'anomaly' ||
    damageType === 'disorder' ||
    damageType === 'turbulence' ||
    damageType === 'anomalyRelease' ||
    damageType === 'radiance'
  const agentId =
    usesProducerBase && line.hit.anomalyPowerAgentId
      ? line.hit.anomalyPowerAgentId
      : line.hit.ownerAgentId
  const slotIndex = props.teamSlots.findIndex((slot) => slot.agentId === agentId)
  if (slotIndex < 0) return valueTips.value.dmgMultiplier

  const external = resolveOwnerExternalPanel(slotIndex, agentId)
  const element = props.agents.find((item) => item.id === agentId)?.element
  const breakdown = computeFinalPanel(external, {
    ...buildPanelCalcContextForSlot(slotIndex, buildExtraModsForHit(line.hit, agentId)),
    skillContext: buildSkillContextFromHit(line.hit, element),
  })
  const sources = breakdown.sources
  const skillBonus = breakdown.totalMods.skillDmgBonus ?? 0
  const generalBonus = breakdown.finalPanel.dmgBonus - skillBonus
  const agentName = props.agents.find((item) => item.id === agentId)?.name
  const roleLabel = usesProducerBase ? '异常强度提供者' : '招式持有者'
  const generalGroups = buildStatSourceGroups({
    keys: ['dmgBonus'],
    externalPanel: external,
    sources,
    finalValues: { dmgBonus: generalBonus },
  }).map((group) => ({
    ...group,
    label: `通用 · ${group.label}`,
  }))
  const skillGroups = buildStatSourceGroups({
    keys: ['skillDmgBonus'],
    externalPanel: external,
    sources,
    finalValues: { skillDmgBonus: skillBonus },
  }).map((group) => ({
    ...group,
    label: `招式 · ${group.label}`,
  }))
  return withTotal(
    [
      {
        label: '面板来源',
        items: [`${roleLabel}${agentName ? ` · ${agentName}` : ''}`],
      },
      ...generalGroups,
      ...skillGroups,
    ],
    `增伤区 1 + ${formatFormulaNumber(generalBonus, 2)}% + ${formatFormulaNumber(skillBonus, 2)}% = ${formatFormulaNumber(p.dmgMultiplier)}`,
  )
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

const teamAgentNotes = computed(() =>
  props.teamSlots
    .map((slot, index) => {
      if (!slot.agentId) return null
      const agent = props.agents.find((item) => item.id === slot.agentId)
      if (!agent) return null
      const roleLabel = slot.isMainC ? '主C' : `槽位${index + 1}`
      const note = agent.note?.trim() ?? ''
      const mindscapeNotes = getMindscapeNotesUpToRank(agent, slot.rank)
      return {
        key: `${index}-${agent.id}`,
        label: `${roleLabel} · ${agent.name}（${slot.rank}影）`,
        note,
        mindscapeNotes,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null),
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
      const roleLabel = slot.isMainC ? '主C' : `槽位${index + 1}`
      return {
        key: `${index}-${wengine.id}`,
        label: `${roleLabel} · ${agent.name} · ${wengine.name}（精${slot.wengineRefine}）`,
        note,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null),
)

function getSnapshot(): DamageCalcPanelSnapshot {
  const id = mainAgent.value?.id
  if (id) affixStateByAgent[id] = captureAffixState()
  return {
    baseDamageSource: baseDamageSource.value,
    externalPanel: { ...externalPanel },
    affixCounts: { ...affixCounts },
    affixDriveDiscMainStats: { ...affixDriveDiscMainStats },
    affixStateByAgent: JSON.parse(JSON.stringify(affixStateByAgent)) as Record<
      string,
      AgentAffixState
    >,
    extraMods: { ...extraMods.value },
    extraGains: extraGains.value.map((item) => ({ ...item })),
    enemyInput: { ...enemyInput.value },
  }
}

function loadSnapshot(snapshot: DamageCalcPanelSnapshot) {
  baseDamageSource.value = snapshot.baseDamageSource
  Object.assign(externalPanel, createDefaultExternalPanel(), snapshot.externalPanel)
  Object.assign(affixCounts, snapshot.affixCounts)
  Object.assign(affixDriveDiscMainStats, snapshot.affixDriveDiscMainStats)
  for (const key of Object.keys(affixStateByAgent)) delete affixStateByAgent[key]
  if (snapshot.affixStateByAgent) {
    Object.assign(affixStateByAgent, JSON.parse(JSON.stringify(snapshot.affixStateByAgent)))
  }
  const currentId = mainAgent.value?.id
  if (currentId) {
    affixStateByAgent[currentId] = captureAffixState()
    applyAffixState(affixStateByAgent[currentId])
  }
  if (snapshot.extraGains?.length) {
    extraGains.value = snapshot.extraGains.map((item) => ({
      id: item.id,
      name: item.name,
      stat: item.stat as BuffStatKey,
      value: item.value,
      applySituation: item.applySituation ?? 'global',
      scope: item.scope,
      applyTarget: item.applyTarget,
      skillCategory: item.skillCategory,
      skillSubcategoryId: item.skillSubcategoryId,
      appliesToAnomaly: item.appliesToAnomaly,
      applyProfession: item.applyProfession ?? null,
      teamProfession: item.teamProfession ?? null,
      teamProfessionValues: item.teamProfessionValues ?? null,
      teamProfessionMinCount: item.teamProfessionMinCount ?? null,
    }))
  } else {
    const mods = { ...createEmptyBuffStatModifiers(), ...snapshot.extraMods }
    extraGains.value = BUFF_STAT_FIELDS.filter((field) => mods[field.key] !== 0).map(
      (field, index) => ({
        id: `legacy-${field.key}-${index}`,
        name: buffStatFieldLabel(field),
        stat: field.key,
        value: mods[field.key],
        applySituation: 'global' as const,
      }),
    )
  }
  Object.assign(enemyInput.value, normalizeDamageEnemyInput(snapshot.enemyInput))
  if (!Number.isFinite(enemyInput.value.level) || enemyInput.value.level < 1) {
    enemyInput.value.level = 60
  }
}

/**
 * 招式倍率的面板默认值，供准备阶段预填。
 * 属性异常/异放/耀变取异常类触发者；紊乱/乱流取异常强度提供者；直伤取持有者。
 */
function resolveMultDefaultsForEvent(
  hit: ResolvedHit,
): Partial<Record<keyof DamageEventMultOverrides, number>> {
  const result: Partial<Record<keyof DamageEventMultOverrides, number>> = {}
  const damageType = hit.skill.damageType
  const input = buildHitCalcInput({ ...hit, multOverrides: null })

  if (damageType === 'anomalyRelease') {
    const triggerId = hit.triggerAgentId ?? hit.ownerAgentId
    const trigSlotIndex = props.teamSlots.findIndex((slot) => slot.agentId === triggerId)
    const { skillCtx, ownerSlotIndex } = buildHitSkillContext(hit)
    const trigExternal =
      triggerId === hit.ownerAgentId
        ? resolveOwnerExternalPanel(ownerSlotIndex, hit.ownerAgentId)
        : resolveOwnerExternalPanel(trigSlotIndex, triggerId)
    const trigAgent = props.agents.find((item) => item.id === triggerId)
    const trigPanelCtx =
      triggerId === hit.ownerAgentId
        ? buildHitPanelCalcContext(skillCtx, ownerSlotIndex, hit)
        : {
            ...buildPanelCalcContextForSlot(
              trigSlotIndex,
              buildExtraModsForHit(hit, triggerId),
            ),
            skillContext: buildSkillContextFromHit(hit, trigAgent?.element),
          }
    const fields = resolveAnomalyReleaseMultFields(
      trigExternal,
      trigPanelCtx,
      resolveHitPowerElement(hit),
    )
    result.anomalyReleaseMult = fields.anomalyReleaseMult
    result.anomalyReleaseMultFactor = fields.anomalyReleaseMultFactor
    return result
  }

  if (damageType === 'direct') {
    const panel = input?.finalPanel ?? finalPanel.value
    result.directDmgMult = panel.directDmgMult
    result.settlementDmgMult = panel.settlementDmgMult
    result.directDmgMultFactor = panel.directDmgMultFactor
    return result
  }

  if (damageType === 'anomaly') {
    const panel = input?.anomalyTriggerPanel ?? input?.finalPanel ?? finalPanel.value
    result.anomalyMult = panel.anomalyMult
    result.anomalyMultFactor = panel.anomalyMultFactor
    return result
  }

  if (damageType === 'radiance') {
    Object.assign(
      result,
      resolveRadianceBonusMultDefaults(input?.anomalyTriggerPanel ?? finalPanel.value),
    )
    return result
  }

  const panel = input?.triggerFinalPanel
  if (!panel) return result

  if (damageType === 'disorder') {
    result.disorderBaseMult = panel.disorderBaseMult
    result.disorderBaseMultFactor = panel.disorderBaseMultFactor
    result.disorderCompMult = panel.disorderCompMult
  } else if (damageType === 'turbulence') {
    result.turbulenceBaseMult = panel.turbulenceBaseMult
    result.turbulenceBaseMultFactor = panel.turbulenceBaseMultFactor
    result.turbulenceCompMult = panel.turbulenceCompMult
  }
  return result
}

defineExpose({
  getSnapshot,
  loadSnapshot,
  applyRecognitionToExternalPanel,
  convertAttrDefaults,
  convertPanelSourceValues,
  panelSourceValuesBySlot,
  resolveMultDefaultsForEvent,
  getAttrDefaultsForSlot,
  getPanelSourceValuesForSlot,
  panelBreakdown,
  enemyInput,
  applyEnemyInput(next: import('@/utils/enemyResistance').DamageEnemyInput) {
    Object.assign(enemyInput.value, normalizeDamageEnemyInput(next))
  },
})
</script>

<template>
  <section :id="sectionId" class="section-card panel-section damage-anchor">
    <header class="section-header">
      <div>
        <h2>面板录入与伤害计算</h2>
        <p class="section-desc">
          {{
            isAffixMode
              ? '录入副词条条数，由角色/音擎基础属性推导局外面板；局内面板与伤害乘区逻辑与面板计算一致。'
              : '录入当前槽位角色的局外面板（初始面板），局内面板由队伍增益、音擎、邦布与额外 Buff 自动汇总。'
          }}
        </p>
      </div>
    </header>

    <p v-if="teamSummary" class="team-summary">{{ teamSummary }}</p>
    <p v-if="isMbMainAgent" class="mb-hint">
      当前角色为命破：基础伤害来源固定为贯穿力，防御区固定为 1。
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
        <select v-model="baseDamageSource" :disabled="isMbMainAgent">
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

    <section v-if="isAffixMode" class="panel-block affix-input-block">
      <header class="panel-block-header">
        <h3>驱动盘主属性</h3>
        <p>
          2/4 件套沿用上方当前槽位的驱动盘选择（{{ mainDriveDiscSummary }}）；默认 6 盘均为 15 级，1 号
          +{{ AFFIX_DRIVE_DISC_SLOT_1_HP }} 生命、2 号 +{{ AFFIX_DRIVE_DISC_SLOT_2_ATK }} 攻击。请选择
          4/5/6 号盘主属性。
        </p>
      </header>
      <div class="grid four">
        <label class="field">
          <span>4 号盘主属性</span>
          <select v-model="affixDriveDiscMainStats.slot4MainStat">
            <option v-for="option in DRIVE_DISC_SLOT_4_OPTIONS" :key="option.id" :value="option.id">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>5 号盘主属性</span>
          <select v-model="affixDriveDiscMainStats.slot5MainStat">
            <option v-for="option in DRIVE_DISC_SLOT_5_OPTIONS" :key="option.id" :value="option.id">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>6 号盘主属性</span>
          <select v-model="affixDriveDiscMainStats.slot6MainStat">
            <option v-for="option in DRIVE_DISC_SLOT_6_OPTIONS" :key="option.id" :value="option.id">
              {{ option.label }}
            </option>
          </select>
        </label>
      </div>
    </section>

    <section v-if="isAffixMode" class="panel-block affix-input-block">
      <header class="panel-block-header">
        <h3>词条数</h3>
        <p>
          基于当前角色基础面板、音擎与驱动盘属性计算局外面板；每条副词条按固定数值折算（如生命 +112、攻击 +19、穿透 +9、双暴 +2.4%/+4.8%、精通 +9 等）。
        </p>
      </header>
      <p v-if="!mainAgent" class="affix-hint">请先在编队中点选要编辑的角色，以加载其基础面板。</p>
      <div class="grid four">
        <label v-for="field in AFFIX_COUNT_FIELDS" :key="field.key" class="field">
          <span>{{ field.label }}（{{ field.unitLabel }}）</span>
          <input v-model.number="affixCounts[field.key]" type="number" min="0" step="1" />
          <span class="field-hint">每条 +{{ field.perCount }}</span>
        </label>
      </div>
      <div v-if="mainAgent" class="affix-base-summary">
        <p>
          基础来源：{{ mainAgent.name }}（生命 {{ mainAgent.basePanel.hp }} / 攻击
          {{ mainAgent.basePanel.atk }}）
          <template v-if="mainWengine">
            · {{ mainWengine.name }}（音擎攻击 {{ mainWengine.baseAtk }}）
          </template>
        </p>
      </div>
    </section>

    <div class="panel-layout">
      <div class="panel-layout-left">
        <section class="panel-block">
          <header class="panel-block-header">
            <h3>局外面板（初始）</h3>
            <p>
              {{
                isAffixMode
                  ? '由词条数、驱动盘与角色/音擎基础属性自动计算，不含战斗增益。'
                  : '仅展示录入或上传的角色面板数据，不含任何战斗增益。'
              }}
            </p>
          </header>
          <div class="grid four">
            <template v-for="slot in EXTERNAL_PANEL_SLOTS" :key="`external-${slot.id}`">
              <div v-if="slot.kind === 'spacer'" class="field field-spacer" aria-hidden="true" />
              <label v-else-if="slot.kind === 'stat'" class="field">
                <span>{{ slot.label }}</span>
                <input
                  v-if="!isAffixMode"
                  v-model.number="externalPanel[slot.key]"
                  type="number"
                  step="any"
                />
                <input
                  v-else
                  :value="formatPanelSlot(slot, 'external')"
                  type="text"
                  readonly
                />
              </label>
              <label v-else class="field">
                <span>{{ slot.label }}</span>
                <input :value="formatPanelSlot(slot, 'external')" type="text" readonly />
              </label>
            </template>
          </div>
        </section>

        <section
          v-if="anomalySupportSlots.length"
          class="panel-block anomaly-support-panels"
        >
          <header class="panel-block-header">
            <h3>其他参与者 · 局外面板</h3>
            <p>
              招式持有者 / 异常强度提供者 / 异常类触发者若不是当前正在编辑的槽位，可在此改他们的局外初始面板；也可以点选编队卡片切过去编辑。
            </p>
          </header>
          <details
            v-for="item in anomalySupportSlots"
            :key="item.slot.agentId"
            class="anomaly-slot-details"
          >
            <summary>
              {{ props.agents.find((a) => a.id === item.slot.agentId)?.name ?? item.slot.agentId }}
              ·
              {{ props.agents.find((a) => a.id === item.slot.agentId)?.element ?? '' }}
            </summary>
            <div class="grid four">
              <label
                v-for="slot in EXTERNAL_PANEL_SLOTS.filter((s) => s.kind === 'stat')"
                :key="`${item.slot.agentId}-${slot.id}`"
                class="field"
              >
                <span>{{ slot.label }}</span>
                <input
                  type="number"
                  step="any"
                  :value="ensureAnomalySlotPanel(item.slot.agentId)[slot.key]"
                  @change="
                    updateAnomalySlotPanel(
                      item.slot.agentId,
                      slot.key,
                      Number(($event.target as HTMLInputElement).value) || 0,
                    )
                  "
                />
              </label>
            </div>
            <details class="anomaly-producer-final-details">
              <summary>局内面板（只读）</summary>
              <div class="grid four">
                <label
                  v-for="slot in FINAL_PANEL_SLOTS"
                  :key="`${item.slot.agentId}-final-${slot.id}`"
                  class="field"
                  :class="{ 'field-spacer-wrap': slot.kind === 'spacer' }"
                >
                  <span v-if="slot.kind !== 'spacer'">{{ slot.label }}</span>
                  <input
                    v-if="slot.kind !== 'spacer'"
                    :value="formatAnomalyFinalPanel(item.slot.agentId, slot)"
                    type="text"
                    readonly
                  />
                </label>
              </div>
            </details>
          </details>
        </section>

        <section
          v-if="convertSupportSlots.length"
          class="panel-block convert-support-panels"
        >
          <header class="panel-block-header">
            <h3>转模增益角色 · 局外面板</h3>
            <p>
              队友增益含<strong>局外/局内转模</strong>且来源非主
              C、非异常产生角色时，仅需录入该角色转模实际用到的来源属性；局内面板将在此基础上叠加其身上增益后参与转模计算。切换为主
              C 后，已填属性会映射到主 C 局外面板。
            </p>
          </header>
          <details
            v-for="item in convertSupportSlots"
            :key="item.agentId"
            class="anomaly-slot-details"
          >
            <summary>
              {{ props.agents.find((a) => a.id === item.agentId)?.name ?? item.agentId }}
              ·
              {{ props.agents.find((a) => a.id === item.agentId)?.element ?? '' }}
            </summary>
            <div class="grid four">
              <label
                v-for="attr in item.requiredAttrs"
                :key="`${item.agentId}-${attr}`"
                class="field"
              >
                <span>{{ characterAttrLabel(attr) }}</span>
                <input
                  type="number"
                  step="any"
                  :value="ensureConvertSlotPartial(item.agentId)[attr] ?? 0"
                  @change="
                    updateConvertSlotAttr(
                      item.agentId,
                      attr,
                      Number(($event.target as HTMLInputElement).value) || 0,
                    )
                  "
                />
              </label>
            </div>
          </details>
        </section>

      </div>

      <section class="panel-block panel-block--final panel-layout-right">
        <header class="panel-block-header">
          <h3>局内面板（最终）</h3>
          <p>叠加自身/队友/音擎/邦布/驱动盘/额外 Buff 后的战斗面板，仅展示。</p>
        </header>
        <div class="grid four panel-grid-fill">
          <template v-for="slot in FINAL_PANEL_SLOTS" :key="`final-${slot.id}`">
            <div v-if="slot.kind === 'spacer'" class="field field-spacer" aria-hidden="true" />
            <label v-else class="field">
              <span>{{ slot.label }}</span>
              <input :value="formatPanelSlot(slot, 'final')" type="text" readonly />
            </label>
          </template>
        </div>
      </section>
    </div>

    <!-- 父页可插入招式流程等：构图上落在面板区与伤害结果之间 -->
    <slot name="after-setup" />

    <div class="result-mode-bar">
      <h3 class="enemy-title result-mode-title">伤害结果</h3>
      <label class="detail-mode-toggle">
        <input v-model="showDetailedResults" type="checkbox" />
        <span>显示详细数据</span>
      </label>
    </div>

    <p v-if="anomalyCalcBlockedReason" class="anomaly-block-hint">
      {{ anomalyCalcBlockedReason }}
    </p>
    <ul v-else-if="damageEventSkipHints.length" class="anomaly-block-hint anomaly-block-hint-list">
      <li v-for="(hint, index) in damageEventSkipHints" :key="index">{{ hint }}</li>
    </ul>

    <template v-if="!showDetailedResults && !anomalyCalcBlockedReason">
      <p v-if="!hasDamageEvents" class="anomaly-block-hint">暂无伤害事件</p>
      <DamageOwnerShareBlock
        v-else-if="hasDamageEventResults"
        :summary="damageOwnerShareSummary"
        :selected-event-id="selectedDamageEventId"
        :total-label="damageEventTotalLabel"
        hint="总伤期望已并入本区。点击产生者展开事件；若要看公式分解，请先开启「显示详细数据」。"
        @select-event="selectDamageEventFromShare"
      />
    </template>

    <template v-else-if="!anomalyCalcBlockedReason">
    <p v-if="!hasDamageEvents" class="anomaly-block-hint">暂无伤害事件</p>
    <DamageOwnerShareBlock
      v-if="hasDamageEventResults"
      :summary="damageOwnerShareSummary"
      :selected-event-id="selectedDamageEventId"
      :total-label="damageEventTotalLabel"
      hint="总伤期望已并入本区。点击产生者展开事件明细，再点事件可查看下方计算过程。"
      @select-event="selectDamageEventFromShare"
    />

    <p v-if="hasDamageEvents && !showGeneralZone && displayCalcParts.remielSelfRadianceActive" class="anomaly-block-hint">
      蕾米埃尔本人耀变不使用通用乘区，详见下方耀变公式分解
    </p>
    <p v-else-if="hasDamageEvents && !showGeneralZone" class="anomaly-block-hint">
      在上方「产生者伤害占比」中点选事件后，可查看通用乘区与详细分解
    </p>

    <template v-if="showGeneralZone">
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
                <StatValueWithSources
                  :value="term.value"
                  :groups="term.tipsKey === 'dmgMultiplier' ? selectedEventDmgMultiplierTips : valueTips[term.tipsKey]"
                />
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
      <p>基础伤害（局内）：<StatValueWithSources :value="displayCalcParts.baseDamage" :groups="valueTips.baseDamage" /></p>
      <p>增伤区：<StatValueWithSources :value="displayCalcParts.dmgMultiplier" :groups="selectedEventDmgMultiplierTips" /></p>
      <p>防御区：<StatValueWithSources :value="displayCalcParts.defenseMultiplier" :groups="valueTips.defenseMultiplier" /></p>
      <p>抗性区：<StatValueWithSources :value="displayCalcParts.resistanceMultiplier" :groups="valueTips.resistanceMultiplier" /></p>
      <p>易伤区（含增益）：<StatValueWithSources :value="displayCalcParts.vulnerableMultiplier" :groups="valueTips.vulnerableMultiplier" /></p>
      <p>失衡易伤区（含增益）：<StatValueWithSources :value="displayCalcParts.staggerMultiplier" :groups="valueTips.staggerMultiplier" /></p>
      <p class="result-subtotal">通用乘区：<StatValueWithSources :value="formatFormulaNumber(displayCalcParts.generalMultiplier, 2)" :groups="valueTips.generalMultiplier" /></p>
    </div>
    </template>

    <section
      v-if="selectedEventDetailLine && selectedEventDirectFormula"
      class="event-detail-block"
    >
      <h3 class="result-section-title">
        {{ selectedEventDetailLine.displayName }} · 直伤期望伤害
      </h3>
      <div class="formula-block formula-block--aligned">
        <DirectDamageFormulaAligned
          :group="selectedEventDirectFormula"
          :value-tips="valueTips"
        />
      </div>
      <div class="result-grid">
        <p>暴击率（计入上限 1）：<StatValueWithSources :value="selectedEventDetailLine.result.critRateRatio" :groups="valueTips.critRateRatio" /></p>
        <p>暴击区：<StatValueWithSources :value="selectedEventDetailLine.result.critMultiplier" :groups="valueTips.critMultiplier" /></p>
        <p>特殊乘区（含增益）：<StatValueWithSources :value="selectedEventDetailLine.result.specialMultiplier" :groups="valueTips.specialMultiplier" /></p>
        <p v-if="selectedEventDetailLine.result.baseDamageSource === 'pierce'">
          贯穿增伤区：<StatValueWithSources :value="selectedEventDetailLine.result.pierceDmgMultiplier" :groups="valueTips.pierceDmgMultiplier" />
        </p>
        <p>直伤倍率区：<StatValueWithSources :value="selectedEventDetailLine.result.directDmgMultZone" :groups="valueTips.directDmgMultZone" /></p>
        <p v-if="selectedEventDetailLine.result.settlementDmgMultZone > 0">
          决算倍率区：<StatValueWithSources :value="selectedEventDetailLine.result.settlementDmgMultZone" :groups="valueTips.settlementDmgMultZone" />
        </p>
        <p>穿透率（计入）：<StatValueWithSources :value="selectedEventDetailLine.result.penRateRatio" :groups="valueTips.penRateRatio" /></p>
        <p>有效防御项：<StatValueWithSources :value="selectedEventDetailLine.result.effectiveDefense" :groups="valueTips.effectiveDefense" /></p>
        <p>贯穿力（局内）：<StatValueWithSources :value="formatNumber(piercePower)" :groups="valueTips.piercePower" /></p>
        <p class="result-total">
          直伤期望伤害：
          <StatValueWithSources
            :value="formatNumber(selectedEventDetailLine.perHit)"
            :groups="valueTips.directDamageExpected"
          />
        </p>
        <p v-if="selectedEventDetailLine.hit.count > 1" class="result-total">
          合计伤害：
          <span>{{ formatNumber(selectedEventDetailLine.total) }}</span>
        </p>
      </div>
    </section>

    <section
      v-if="selectedEventDetailLine && selectedEventAnomalyFormulas"
      class="event-detail-block"
    >
      <h3 class="result-section-title">{{ selectedEventAnomalyTitle }}</h3>
      <div class="formula-block formula-block--aligned">
        <div
          v-for="group in selectedEventAnomalyFormulas"
          :key="`event-${group.key}`"
          class="formula-aligned-group"
        >
          <span class="formula-label formula-aligned-title">
            <span v-if="group.agentLabel" class="formula-agent-label">{{ group.agentLabel }} · </span>
            {{ group.title }}
            <span v-if="group.hint" class="formula-aligned-hint">{{ group.hint }}</span>
          </span>
          <div class="formula-aligned-body">
            <template v-for="(term, index) in group.terms" :key="`event-${group.key}-${term.label}`">
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
                :key="`event-${group.key}-${item.label}`"
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
        <p class="result-total">
          单次期望：{{ formatNumber(selectedEventDetailLine.perHit) }}
        </p>
        <p v-if="selectedEventDetailLine.hit.count > 1" class="result-total">
          合计伤害：{{ formatNumber(selectedEventDetailLine.total) }}
        </p>
      </div>
    </section>

    <template v-if="damageKind !== 'anomaly' && !hasDamageEventResults">
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
      <p v-if="calcParts.baseDamageSource === 'pierce'">
        贯穿增伤区：<StatValueWithSources :value="calcParts.pierceDmgMultiplier" :groups="valueTips.pierceDmgMultiplier" />
      </p>
      <p>直伤倍率区：<StatValueWithSources :value="calcParts.directDmgMultZone" :groups="valueTips.directDmgMultZone" /></p>
      <p v-if="calcParts.settlementDmgMultZone > 0">
        决算倍率区：<StatValueWithSources :value="calcParts.settlementDmgMultZone" :groups="valueTips.settlementDmgMultZone" />
      </p>
      <p>穿透率（计入）：<StatValueWithSources :value="calcParts.penRateRatio" :groups="valueTips.penRateRatio" /></p>
      <p>有效防御项：<StatValueWithSources :value="calcParts.effectiveDefense" :groups="valueTips.effectiveDefense" /></p>
      <p>贯穿力（局内）：<StatValueWithSources :value="formatNumber(piercePower)" :groups="valueTips.piercePower" /></p>
      <p class="result-total">直伤期望伤害：<StatValueWithSources :value="formatNumber(calcParts.directDamageExpected)" :groups="valueTips.directDamageExpected" /></p>
    </div>
    </template>

    <template v-if="damageKind !== 'direct' && !anomalyCalcBlockedReason && !hasDamageEventResults">
    <h3 class="result-section-title">
      {{
        effectiveAnomalySubKind === 'disorder'
          ? `${disorderDamageLabel}期望伤害`
          : effectiveAnomalySubKind === 'turbulence'
            ? '乱流期望伤害'
            : effectiveAnomalySubKind === 'anomalyRelease'
              ? '异放期望伤害'
              : effectiveAnomalySubKind === 'radiance'
                ? '耀变期望伤害'
                : '异常期望伤害'
      }}
    </h3>
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
      <p>特殊乘区：<StatValueWithSources :value="calcParts.specialMultiplier" :groups="valueTips.specialMultiplier" /></p>
      <p v-if="calcParts.mutationZone > 1">
        异化系数区：
        <StatValueWithSources :value="formatFormulaNumber(calcParts.mutationZone)" :groups="valueTips.mutationZone" />
      </p>
      <p class="result-total">异常基础期望：<StatValueWithSources :value="formatNumber(anomalyBaseWithMutation)" :groups="valueTips.anomalyBaseExpected" /></p>

      <template v-if="effectiveAnomalySubKind === 'anomaly'">
      <h4 class="result-subsection-title">异常伤害</h4>
      <p>异常增伤区：<StatValueWithSources :value="calcParts.anomalyDmgBonusZone" :groups="valueTips.anomalyDmgBonusZone" /></p>
      <p>异常倍率区：<StatValueWithSources :value="calcParts.anomalyMultZone" :groups="valueTips.anomalyMultZone" /></p>
      <p>异常暴击区（暴击率=0）：1</p>
      <p>异常暴击区（暴击率=1）：<StatValueWithSources :value="calcParts.anomalyFullCritZone" :groups="valueTips.anomalyCritZone" /></p>
      <p class="result-total">异常伤害（暴击率=0）：<StatValueWithSources :value="formatNumber(calcParts.anomalyExpectedNoCrit)" :groups="valueTips.anomalyExpected" /></p>
      <p class="result-total">异常伤害（暴击率=1）：<StatValueWithSources :value="formatNumber(calcParts.anomalyExpectedFullCrit)" :groups="valueTips.anomalyExpected" /></p>
      </template>

      <template v-else-if="effectiveAnomalySubKind === 'disorder'">
      <h4 class="result-subsection-title">{{ disorderDamageLabel }}期望伤害</h4>
      <p>紊乱基础倍率：<StatValueWithSources :value="calcParts.disorderBaseMultRatio" :groups="valueTips.disorderBaseMult" /></p>
      <p>异常持续时间(有效)：<StatValueWithSources :value="calcParts.effectiveAnomalyDuration" :groups="valueTips.anomalyDuration" /></p>
      <p>紊乱补偿倍率：<StatValueWithSources :value="calcParts.disorderCompMultRatio" :groups="valueTips.disorderCompMult" /></p>
      <p>紊乱倍率区：<StatValueWithSources :value="calcParts.disorderZone" :groups="valueTips.disorderZone" /></p>
      <p>紊乱增伤区：<StatValueWithSources :value="calcParts.disorderDmgBonusZone" :groups="valueTips.disorderDmgBonusZone" /></p>
      <p class="result-total">{{ disorderDamageLabel }}期望伤害：<StatValueWithSources :value="formatNumber(calcParts.disorderExpected)" :groups="valueTips.disorderExpected" /></p>
      </template>

      <template v-else-if="effectiveAnomalySubKind === 'turbulence'">
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

      <template v-else-if="effectiveAnomalySubKind === 'anomalyRelease'">
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

      <template v-else-if="effectiveAnomalySubKind === 'radiance'">
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
      <template v-if="calcParts.remielSelfRadianceActive">
        <p>
          特殊倍率乘区：
          <StatValueWithSources
            :value="formatFormulaNumber(calcParts.specialMultZone)"
            :groups="valueTips.specialMultZone"
          />
        </p>
        <p>
          特殊乘区：
          <StatValueWithSources
            :value="formatFormulaNumber(calcParts.specialMultiplier)"
            :groups="valueTips.specialMultiplier"
          />
        </p>
      </template>
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
    </template>
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
