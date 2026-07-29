<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import ExtraBuffGainEditor, {
  type ExtraBuffGain,
} from '@/components/calculator/ExtraBuffGainEditor.vue'
import BuffModSourcesDisplay from '@/components/calculator/BuffModSourcesDisplay.vue'
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
  DamageEventMultOverrides,
  DriveDiscBuffDoc,
  SkillSubcategory,
  WengineBuffDoc,
} from '@/types/calculator'
import { CHARACTER_ATTR_OPTIONS } from '@/types/calculator'
import type { DamageCalcPanelSnapshot } from '@/types/damageCalcHistory'
import {
  createDefaultExternalPanel,
  createDefaultAffixDriveDiscMainStats,
  createEmptyAffixCounts,
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
  externalPanelToConvertPartial,
  panelToConvertAttrValues,
  resolveMainCAnomalyReleaseMultFields,
  type ConvertSlotPanels,
} from '@/utils/panelBuffCalc'
import { computeDamageResult, type DamageCalcInput, type EnemyResistanceType } from '@/utils/damageCalc'
import {
  canSelectTurbulenceDamageEvent,
  eventNeedsAnomalyProducer,
  isTurbulenceTeamCompositionOk,
  mapEventKindToCalc,
  summarizeDamageEvents,
  type DamageEventLine,
} from '@/utils/damageEvent'
import { formatCalcDecimal } from '@/utils/calcNumberFormat'
import {
  buildAlignedDirectFormulaGroup,
  buildDirectDamageExpectedProcessItems,
  formatDirectDmgMultZoneFormula,
  formatSettlementDmgMultZoneFormula,
} from '@/utils/directDamageDisplay'
import { buildAtkPanelProcessItems, buildDefPanelProcessItems, buildEnemyCombatProcessItems, buildStatSourceGroups, type StatSourceGroup } from '@/utils/statSourceTips'
import {
  ENEMY_DEFENSE_PRESETS,
  STAGGER_MULTIPLIER_PRESETS,
} from '@/utils/enemyInputPresets'
import DirectDamageFormulaAligned from '@/components/calculator/DirectDamageFormulaAligned.vue'
import EnemyPresetCombo from '@/components/calculator/EnemyPresetCombo.vue'
import type { PanelScreenshotRecognition } from '@/types/panelScreenshot'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import { resolveIsFollowUp } from '@/utils/buffEffect'

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
  calcMode: PanelCalcMode
  sectionId?: string
  damageKind?: import('@/types/calculator').DamageCalcKind
  anomalySubKind?: AnomalyDamageSubKind
  triggerAnomalyAgentId?: string | null
  /** 异常非主 C 槽位局外面板，key = agentId */
  anomalySlotPanels?: Record<string, PanelStats>
  /** 转模增益角色局外面板（仅转模来源属性），key = agentId */
  convertSlotPanels?: ConvertSlotPanels
  skillCategoryId?: import('@/types/calculator').SkillCategoryId
  skillSubcategoryId?: string | null
  buffSelection?: import('@/utils/panelBuffCalc').BuffSelectionState | null
  staggerPhase?: import('@/types/calculator').StaggerPhase
  damageEvents?: DamageEvent[]
}>()

const emit = defineEmits<{
  'update:anomalySlotPanels': [value: Record<string, PanelStats>]
  'update:convertSlotPanels': [value: ConvertSlotPanels]
}>()

const baseDamageSource = ref<BaseDamageSource>('atk')
const showDetailedResults = ref(false)
const selectedDamageEventId = ref<string | null>(null)
const externalPanel = reactive<PanelStats>(createDefaultExternalPanel())
const affixCounts = reactive(createEmptyAffixCounts())
const affixDriveDiscMainStats = reactive(createDefaultAffixDriveDiscMainStats())
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

const mainSlotIndex = computed(() => {
  const index = props.teamSlots.findIndex((slot) => slot.isMainC)
  return index >= 0 ? index : 0
})

const mainSlot = computed(() => props.teamSlots[mainSlotIndex.value]!)

const mainAgent = computed(() =>
  props.agents.find((item) => item.id === mainSlot.value.agentId),
)

const { skillSubcategories, followUpSkillRules } = storeToRefs(useCalculatorBuffStore())

const skillIsFollowUp = computed(() =>
  resolveIsFollowUp({
    agentId: mainAgent.value?.id,
    categoryId: props.skillCategoryId ?? 'basic',
    subcategoryId: props.skillSubcategoryId ?? null,
    skillSubcategories: skillSubcategories.value,
    followUpSkillRules: followUpSkillRules.value,
  }),
)

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
  return parts.length ? parts.join(' · ') : '未选择（请在上方驱动盘区为主C选择）'
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

/** 伤害事件中选为产生角色且非主 C 的槽位 */
const anomalySupportSlots = computed(() => {
  const mainId = mainSlot.value.agentId
  const triggerIds = new Set<string>()
  for (const event of props.damageEvents ?? []) {
    if (!eventNeedsAnomalyProducer(event.kind)) continue
    const id = event.triggerAgentId
    if (!id || id === '__at_calc__' || id === mainId) continue
    triggerIds.add(id)
  }
  return props.teamSlots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => Boolean(slot.agentId && triggerIds.has(slot.agentId)))
})

function buildBasePanelCalcContext() {
  return {
    teamSlots: props.teamSlots,
    agents: props.agents,
    wengines: props.wengines,
    bangboo: selectedBangboo.value,
    bangbooRefine: props.bangbooRefine,
    mainSlotIndex: mainSlotIndex.value,
    driveDiscs: props.driveDiscs,
    extraMods: extraMods.value,
    skillContext: {
      damageKind: props.damageKind ?? 'direct',
      categoryId: props.skillCategoryId ?? 'basic',
      subcategoryId: props.skillSubcategoryId ?? null,
      element: damageElement.value,
      staggerPhase: props.staggerPhase ?? 'stagger',
      isFollowUp: skillIsFollowUp.value,
      anomalySubKind:
        props.damageKind === 'anomaly' ? (props.anomalySubKind ?? 'anomaly') : undefined,
    },
    buffSelection: props.buffSelection ?? null,
    anomalySlotPanels: props.anomalySlotPanels,
    convertSlotPanels: props.convertSlotPanels,
  }
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
    ...(props.convertSlotPanels ?? {}),
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
    ...(props.convertSlotPanels ?? {}),
    [agentId]: externalPanelToConvertPartial(panel, keys),
  })
}

function ensureAnomalySlotPanel(agentId: string): PanelStats {
  const existing = props.anomalySlotPanels?.[agentId]
  if (existing) return existing
  return createDefaultExternalPanel()
}

function updateAnomalySlotPanel(agentId: string, key: keyof PanelStats, value: number) {
  const next = {
    ...(props.anomalySlotPanels ?? {}),
    [agentId]: {
      ...ensureAnomalySlotPanel(agentId),
      [key]: value,
    },
  }
  emit('update:anomalySlotPanels', next)
}

function emitAnomalySlotPanel(agentId: string, panel: PanelStats) {
  emit('update:anomalySlotPanels', {
    ...(props.anomalySlotPanels ?? {}),
    [agentId]: { ...panel },
  })
}

function applyAgentBaseToExternalPanel(base: PanelStats | AgentBuffDoc['basePanel']) {
  externalPanel.def = base.def
  externalPanel.directDmgMult = base.directDmgMult
  externalPanel.anomalyMult = base.anomalyMult
  externalPanel.anomalyCritRate = base.anomalyCritRate
  externalPanel.anomalyCritDmg = base.anomalyCritDmg
  externalPanel.anomalyDmgBonus = base.anomalyDmgBonus
  externalPanel.anomalyControl = base.anomalyControl
  externalPanel.energyRegen = base.energyRegen
  externalPanel.disorderBaseMult = base.disorderBaseMult
  externalPanel.anomalyDuration = base.anomalyDuration
  externalPanel.disorderCompMult = base.disorderCompMult
  externalPanel.turbulenceBaseMult = base.turbulenceBaseMult
  externalPanel.turbulenceCompMult = base.turbulenceCompMult
  externalPanel.disorderDmgBonus = base.disorderDmgBonus
  externalPanel.turbulenceDmgBonus = base.turbulenceDmgBonus
  if ('mastery' in base && typeof base.mastery === 'number') {
    externalPanel.mastery = base.mastery
  }
}

const triggerSlotIndex = computed(() => {
  const id = props.triggerAnomalyAgentId
  if (!id) return -1
  return props.teamSlots.findIndex((slot) => slot.agentId === id)
})

const triggerAgent = computed(() =>
  props.agents.find((item) => item.id === props.triggerAnomalyAgentId),
)

const needsTriggerPanel = computed(() => {
  const sub = props.anomalySubKind
  return (
    props.damageKind === 'anomaly' &&
    (sub === 'turbulence' || sub === 'anomalyRelease' || sub === 'disorder')
  )
})

/** 异放/乱流时伤害属性跟随触发角色；否则用主 C */
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

const panelBreakdown = computed(() => {
  void convertSlotPanelsSignature.value
  return computeFinalPanel(effectiveExternalPanel.value, {
    ...buildBasePanelCalcContext(),
    attrValues: convertAttrDefaults.value,
  })
})

const finalPanel = computed(() => {
  const panel = { ...panelBreakdown.value.finalPanel }
  if (
    props.damageKind === 'anomaly' &&
    (props.anomalySubKind ?? 'anomaly') === 'anomalyRelease'
  ) {
    const fields = resolveMainCAnomalyReleaseMultFields(
      effectiveExternalPanel.value,
      {
        teamSlots: props.teamSlots,
        agents: props.agents,
        wengines: props.wengines,
        bangboo: selectedBangboo.value,
        bangbooRefine: props.bangbooRefine,
        mainSlotIndex: mainSlotIndex.value,
        driveDiscs: props.driveDiscs,
        extraMods: extraMods.value,
        skillContext: {
          damageKind: props.damageKind ?? 'anomaly',
          categoryId: props.skillCategoryId ?? 'basic',
          subcategoryId: props.skillSubcategoryId ?? null,
          element: damageElement.value,
          staggerPhase: props.staggerPhase ?? 'stagger',
          isFollowUp: skillIsFollowUp.value,
          anomalySubKind: 'anomalyRelease',
        },
        buffSelection: props.buffSelection ?? null,
        attrValues: convertAttrDefaults.value,
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
  return buildPanelSourceValuesBySlotRecord(
    {
      ...buildBasePanelCalcContext(),
      attrValues: convertAttrDefaults.value,
    },
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

const triggerPanelBreakdown = computed(() => {
  if (!triggerExternalPanel.value || triggerSlotIndex.value < 0) return null
  return computeFinalPanel(triggerExternalPanel.value, {
    ...buildBasePanelCalcContext(),
    mainSlotIndex: triggerSlotIndex.value,
    skillContext: {
      damageKind: props.damageKind ?? 'anomaly',
      categoryId: props.skillCategoryId ?? 'basic',
      subcategoryId: props.skillSubcategoryId ?? null,
      element: triggerAgent.value?.element,
      staggerPhase: props.staggerPhase ?? 'stagger',
      isFollowUp: skillIsFollowUp.value,
      anomalySubKind:
        props.damageKind === 'anomaly' ? (props.anomalySubKind ?? 'anomaly') : undefined,
    },
  })
})

const triggerFinalPanel = computed(() => triggerPanelBreakdown.value?.finalPanel ?? null)

const turbulenceTeamOk = computed(() =>
  isTurbulenceTeamCompositionOk(props.teamSlots, props.agents),
)

const turbulenceEventCalculable = computed(() =>
  canSelectTurbulenceDamageEvent(
    props.teamSlots,
    props.agents,
    mainAgent.value?.element,
  ),
)

const anomalyCalcBlockedReason = computed(() => {
  if (props.damageKind !== 'anomaly') return ''
  const sub = props.anomalySubKind ?? 'anomaly'
  if (sub === 'turbulence' && mainAgent.value?.element !== '风') {
    return '乱流伤害仅风属性代理人可计算'
  }
  if (sub === 'turbulence' && !turbulenceTeamOk.value) {
    return '乱流需队伍同时包含风属性与至少一个非风属性'
  }
  if (sub === 'anomalyRelease' && finalPanel.value.anomalyReleaseMult <= 0) {
    return '异放伤害仅拥有异放倍率的代理人可计算（当前异放倍率为 0，请通过增益或面板补充）'
  }
  if (
    (sub === 'turbulence' || sub === 'anomalyRelease' || sub === 'disorder') &&
    !props.triggerAnomalyAgentId
  ) {
    return '请先选择当前属性异常的产生角色'
  }
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
  // 乘区/百分比统一明确展示到至少 4 位小数；大数与整数仍按原规则
  if (!Number.isFinite(v)) return String(v)
  if (Number.isInteger(v) && Math.abs(v) < 1000) {
    return v.toLocaleString('en-US')
  }
  if (Math.abs(v) >= 1000) {
    return formatCalcDecimal(v, Math.min(precision, 2))
  }
  return formatCalcDecimal(v, Math.max(precision, 4))
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
    if (isAffixMode.value) return

    if (oldId) {
      const oldAgent = props.agents.find((item) => item.id === oldId)
      if (oldAgent?.profession === '异常') {
        emitAnomalySlotPanel(oldId, externalPanel)
      }
      const convertSlot = convertSupportSlots.value.find((item) => item.agentId === oldId)
      if (convertSlot) {
        emitConvertSlotPanel(oldId, convertSlot.requiredAttrs, externalPanel)
      } else if (props.convertSlotPanels?.[oldId]) {
        const keys = Object.keys(props.convertSlotPanels[oldId]) as CharacterAttrKey[]
        emitConvertSlotPanel(oldId, keys, externalPanel)
      }
    }

    if (!mainAgent.value || !newId) return

    const savedAnomaly = props.anomalySlotPanels?.[newId]
    if (savedAnomaly && mainAgent.value.profession === '异常') {
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
    if (mainAgent.value.profession === '异常') {
      emitAnomalySlotPanel(newId, externalPanel)
    }
  },
  { immediate: true },
)

watch(
  externalPanel,
  () => {
    const id = mainAgent.value?.id
    if (!id || isAffixMode.value) return
    if (mainAgent.value?.profession === '异常') {
      emitAnomalySlotPanel(id, externalPanel)
    }
    const convertSlot = convertSupportSlots.value.find((item) => item.agentId === id)
    if (convertSlot) {
      emitConvertSlotPanel(id, convertSlot.requiredAttrs, externalPanel)
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

const calcParts = computed(() =>
  computeDamageResult({
    finalPanel: finalPanel.value,
    piercePower: piercePower.value,
    baseDamageSource: effectiveBaseDamageSource.value,
    isMbMainAgent: isMbMainAgent.value,
    enemyInput,
    combatVulnerable: panelBreakdown.value.combatMods.vulnerable,
    combatGlobalStaggerVulnerable: panelBreakdown.value.combatMods.globalStaggerVulnerable,
    combatStaggerVulnerable: panelBreakdown.value.combatMods.staggerVulnerable,
    combatStaggerVulnerableOnly: panelBreakdown.value.combatMods.staggerVulnerableOnly,
    combatSpecial: panelBreakdown.value.combatMods.special,
    combatPierceDmgBonus: panelBreakdown.value.combatMods.pierceDmgBonus,
    staggerPhase: props.staggerPhase ?? 'stagger',
    mainAgentElement: mainAgent.value?.element ?? '',
    mainAgentId: mainAgent.value?.id ?? '',
    mainAgentName: mainAgent.value?.name ?? '',
    anomalySubKind: props.anomalySubKind ?? 'anomaly',
    triggerFinalPanel: triggerFinalPanel.value ?? undefined,
    triggerAgentElement: triggerAgent.value?.element,
    triggerPiercePower: triggerPiercePower.value,
    triggerIsMb: triggerAgent.value?.profession === MB_PROFESSION,
    skillSubcategory: resolvedSkillSubcategory.value,
  }),
)

const disorderDamageLabel = computed(() =>
  calcParts.value.hasPolarDisorder ? '极性紊乱' : '紊乱伤害',
)

function resolveEventTriggerElement(event: DamageEvent): string | undefined {
  const rawTriggerId = event.triggerAgentId ?? props.triggerAnomalyAgentId
  const triggerId =
    rawTriggerId && rawTriggerId !== '__at_calc__' ? rawTriggerId : null
  if (!triggerId) return undefined
  return props.agents.find((agent) => agent.id === triggerId)?.element
}

function buildEventSkillContext(event: DamageEvent) {
  const { damageKind: evtDamageKind, anomalySubKind: evtAnomalySubKind } = mapEventKindToCalc(
    event.kind,
  )
  const eventNeedsTrigger =
    event.kind === 'disorder' ||
    event.kind === 'turbulence' ||
    event.kind === 'anomalyRelease'
  const triggerElement = resolveEventTriggerElement(event)
  const skillBound = event.skillBound !== false || evtDamageKind === 'direct'
  const evtIsFollowUp = skillBound
    ? resolveIsFollowUp({
        agentId: mainAgent.value?.id,
        categoryId: event.categoryId,
        subcategoryId: event.skillSubcategoryId,
        skillSubcategories: skillSubcategories.value,
        followUpSkillRules: followUpSkillRules.value,
      })
    : false

  return {
    skillCtx: {
      damageKind: evtDamageKind,
      categoryId: skillBound ? event.categoryId : ('basic' as const),
      subcategoryId: skillBound ? (event.skillSubcategoryId ?? null) : null,
      element: eventNeedsTrigger ? triggerElement : mainAgent.value?.element,
      staggerPhase: event.staggerPhase,
      isFollowUp: evtIsFollowUp,
      anomalySubKind: evtAnomalySubKind,
    },
    eventNeedsTrigger,
    triggerElement,
    skillBound,
    evtDamageKind,
    evtAnomalySubKind,
  }
}

function buildEventPanelCalcContext(skillCtx: ReturnType<typeof buildEventSkillContext>['skillCtx']) {
  return {
    ...buildBasePanelCalcContext(),
    skillContext: skillCtx,
    attrValues: convertAttrDefaults.value,
  }
}

function buildEventCalcFull(event: DamageEvent): DamageCalcInput | null {
  const {
    skillCtx: evtSkillCtx,
    eventNeedsTrigger,
    triggerElement: evtTriggerElement,
    skillBound,
    evtDamageKind,
    evtAnomalySubKind,
  } = buildEventSkillContext(event)

  const rawTriggerId = event.triggerAgentId ?? props.triggerAnomalyAgentId
  const evtTriggerAgentId =
    rawTriggerId && rawTriggerId !== '__at_calc__' ? rawTriggerId : null
  if (eventNeedsTrigger && !evtTriggerAgentId) return null

  if (event.kind === 'turbulence' && !turbulenceEventCalculable.value) return null

  const tAgent =
    eventNeedsTrigger && evtTriggerAgentId
      ? props.agents.find((a) => a.id === evtTriggerAgentId)
      : undefined
  const evtTriggerIsMb = tAgent?.profession === MB_PROFESSION

  const evtBreakdown = computeFinalPanel(effectiveExternalPanel.value, buildEventPanelCalcContext(evtSkillCtx))

  let evtFinalPanel = { ...evtBreakdown.finalPanel }
  const overrides = event.multOverrides
  if (overrides) {
    if (overrides.directDmgMult != null) evtFinalPanel.directDmgMult = overrides.directDmgMult
    if (overrides.settlementDmgMult != null) {
      evtFinalPanel.settlementDmgMult = overrides.settlementDmgMult
    }
    if (overrides.directDmgMultFactor != null) {
      evtFinalPanel.directDmgMultFactor = overrides.directDmgMultFactor
    }
    if (overrides.anomalyMult != null) evtFinalPanel.anomalyMult = overrides.anomalyMult
    if (overrides.anomalyMultFactor != null) {
      evtFinalPanel.anomalyMultFactor = overrides.anomalyMultFactor
    }
    if (overrides.anomalyReleaseMult != null) {
      evtFinalPanel.anomalyReleaseMult = overrides.anomalyReleaseMult
    }
    if (overrides.anomalyReleaseMultFactor != null) {
      evtFinalPanel.anomalyReleaseMultFactor = overrides.anomalyReleaseMultFactor
    }
    if (overrides.disorderBaseMult != null) {
      evtFinalPanel.disorderBaseMult = overrides.disorderBaseMult
    }
    if (overrides.disorderBaseMultFactor != null) {
      evtFinalPanel.disorderBaseMultFactor = overrides.disorderBaseMultFactor
    }
    if (overrides.disorderCompMult != null) {
      evtFinalPanel.disorderCompMult = overrides.disorderCompMult
    }
    if (overrides.turbulenceBaseMult != null) {
      evtFinalPanel.turbulenceBaseMult = overrides.turbulenceBaseMult
    }
    if (overrides.turbulenceBaseMultFactor != null) {
      evtFinalPanel.turbulenceBaseMultFactor = overrides.turbulenceBaseMultFactor
    }
    if (overrides.turbulenceCompMult != null) {
      evtFinalPanel.turbulenceCompMult = overrides.turbulenceCompMult
    }
  }

  if (event.kind === 'anomalyRelease') {
    const releaseFields = resolveMainCAnomalyReleaseMultFields(
      effectiveExternalPanel.value,
      buildEventPanelCalcContext(evtSkillCtx),
      evtTriggerElement,
    )
    if (overrides?.anomalyReleaseMult == null) {
      evtFinalPanel.anomalyReleaseMult = releaseFields.anomalyReleaseMult
    }
    if (overrides?.anomalyReleaseMultFactor == null) {
      evtFinalPanel.anomalyReleaseMultFactor = releaseFields.anomalyReleaseMultFactor
    }
  }

  const evtPierce = computePiercePower(
    evtFinalPanel.hp,
    evtFinalPanel.atk,
    evtBreakdown.totalMods.pierce,
  )

  let evtTriggerFinalPanel: PanelStats | undefined
  let evtTriggerPierce: number | undefined
  if (eventNeedsTrigger && evtTriggerAgentId) {
    const tSlotIndex = props.teamSlots.findIndex((slot) => slot.agentId === evtTriggerAgentId)
    if (tSlotIndex < 0) return null

    if (evtTriggerAgentId === mainAgent.value?.id) {
      evtTriggerFinalPanel = evtFinalPanel
      evtTriggerPierce = evtPierce
    } else {
      const tExternal = ensureAnomalySlotPanel(evtTriggerAgentId)
      const tBreakdown = computeFinalPanel(tExternal, {
        teamSlots: props.teamSlots,
        agents: props.agents,
        wengines: props.wengines,
        bangboo: selectedBangboo.value,
        bangbooRefine: props.bangbooRefine,
        mainSlotIndex: tSlotIndex,
        driveDiscs: props.driveDiscs,
        extraMods: extraMods.value,
        skillContext: {
          damageKind: 'anomaly',
          categoryId: skillBound ? event.categoryId : 'basic',
          subcategoryId: skillBound ? (event.skillSubcategoryId ?? null) : null,
          element: tAgent?.element,
          staggerPhase: event.staggerPhase,
          isFollowUp: false,
          anomalySubKind: evtAnomalySubKind,
        },
        buffSelection: props.buffSelection ?? null,
      })
      evtTriggerFinalPanel = tBreakdown.finalPanel
      evtTriggerPierce = computePiercePower(
        tBreakdown.finalPanel.hp,
        tBreakdown.finalPanel.atk,
        tBreakdown.totalMods.pierce,
      )
    }

    // 紊乱/乱流倍率取产生角色最终面板（未覆写时）
    // 异放倍率留在主 C 面板：按产生角色属性从主 C 增益筛选
    if (evtTriggerFinalPanel) {
      const o = overrides
      if (event.kind === 'disorder') {
        if (o?.disorderBaseMult == null) {
          evtFinalPanel.disorderBaseMult = evtTriggerFinalPanel.disorderBaseMult
        }
        if (o?.disorderBaseMultFactor == null) {
          evtFinalPanel.disorderBaseMultFactor = evtTriggerFinalPanel.disorderBaseMultFactor
        }
        if (o?.disorderCompMult == null) {
          evtFinalPanel.disorderCompMult = evtTriggerFinalPanel.disorderCompMult
        }
      } else if (event.kind === 'turbulence') {
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

  const sub =
    skillBound ? resolveSubcategoryById(event.skillSubcategoryId) : null
  const effectiveSub =
    sub && overrides
      ? {
          ...sub,
          directDmgMult: overrides.directDmgMult ?? sub.directDmgMult,
          settlementDmgMult: overrides.settlementDmgMult ?? sub.settlementDmgMult,
          directDmgMultFactor: overrides.directDmgMultFactor ?? sub.directDmgMultFactor,
          anomalyReleaseMult: overrides.anomalyReleaseMult ?? sub.anomalyReleaseMult,
          anomalyReleaseMultFactor:
            overrides.anomalyReleaseMultFactor ?? sub.anomalyReleaseMultFactor,
          disorderMult: overrides.disorderBaseMult ?? sub.disorderMult,
          disorderMultFactor: overrides.disorderBaseMultFactor ?? sub.disorderMultFactor,
        }
      : sub

  return {
    finalPanel: evtFinalPanel,
    piercePower: evtPierce,
    baseDamageSource: effectiveBaseDamageSource.value,
    isMbMainAgent: isMbMainAgent.value,
    enemyInput,
    combatVulnerable: evtBreakdown.combatMods.vulnerable,
    combatGlobalStaggerVulnerable: evtBreakdown.combatMods.globalStaggerVulnerable,
    combatStaggerVulnerable: evtBreakdown.combatMods.staggerVulnerable,
    combatStaggerVulnerableOnly: evtBreakdown.combatMods.staggerVulnerableOnly ?? 0,
    combatSpecial: evtBreakdown.combatMods.special,
    combatPierceDmgBonus: evtBreakdown.combatMods.pierceDmgBonus,
    staggerPhase: event.staggerPhase,
    mainAgentElement: mainAgent.value?.element ?? '',
    mainAgentId: mainAgent.value?.id ?? '',
    mainAgentName: mainAgent.value?.name ?? '',
    anomalySubKind: evtAnomalySubKind,
    triggerFinalPanel: evtTriggerFinalPanel,
    triggerAgentElement: evtTriggerElement,
    triggerPiercePower: evtTriggerPierce,
    triggerIsMb: evtTriggerIsMb,
    skillSubcategory: effectiveSub,
  }
}

const damageEventSummary = computed(() => {
  if (!props.damageEvents?.length) return null
  return summarizeDamageEvents(props.damageEvents, buildEventCalcFull, resolveSubcategoryById)
})

const hasDamageEventResults = computed(
  () => (damageEventSummary.value?.lines.length ?? 0) > 0,
)

const damageEventTotalLabel = computed(() =>
  props.damageKind === 'anomaly' ? '异常伤害事件总伤期望' : '伤害事件总伤期望',
)

const selectedDamageEventLine = computed(
  () =>
    damageEventSummary.value?.lines.find((line) => line.event.id === selectedDamageEventId.value) ??
    null,
)

function toggleDamageEventSelection(eventId: string) {
  selectedDamageEventId.value = selectedDamageEventId.value === eventId ? null : eventId
}

watch(
  () => props.damageEvents,
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
  const p = calcParts.value
  return [
    formatFormulaNumber(p.generalMultiplier, 2),
    formatFormulaNumber(p.masteryZone),
    formatFormulaNumber(p.levelZone),
  ]
})

const anomalyExpectedFormulaParts = computed(() => {
  const p = calcParts.value
  return [
    formatNumber(p.anomalyBaseExpected),
    formatFormulaNumber(p.anomalyDmgBonusZone),
    formatFormulaNumber(p.anomalyMultZone),
    formatFormulaNumber(p.anomalyCritZone),
  ]
})

const disorderFormulaParts = computed(() => {
  const p = calcParts.value
  return [
    formatNumber(p.anomalyBaseExpected),
    formatFormulaNumber(p.disorderZone),
    formatFormulaNumber(p.disorderDmgBonusZone),
  ]
})

const turbulenceFormulaParts = computed(() => {
  const p = calcParts.value
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

interface AlignedFormulaGroup {
  key: AlignedFormulaResultKey
  title: string
  hint?: string
  terms: AlignedFormulaTerm[]
  result: string
  /** 涉及异常暴击时输出暴击率=0 / =1 两版 */
  dualResults?: { label: string; value: string }[]
}

const effectiveAnomalySubKind = computed(
  () => props.anomalySubKind ?? 'anomaly',
)

const alignedGeneralFormula = computed((): AlignedFormulaGroup => {
  const p = calcParts.value
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
    result: formatNumber(p.generalMultiplier),
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
  const line = selectedDamageEventLine.value
  if (!line || line.event.kind !== 'direct') return null
  return buildAlignedDirectFormula(line.result, formatNumber(line.perHit))
})

const selectedEventAnomalyTitle = computed(() => {
  const line = selectedDamageEventLine.value
  if (!line || line.event.kind === 'direct') return ''
  if (line.event.kind === 'disorder') {
    return `${line.displayName} · ${line.result.hasPolarDisorder ? '极性紊乱' : '紊乱'}期望伤害`
  }
  if (line.event.kind === 'turbulence') return `${line.displayName} · 乱流期望伤害`
  if (line.event.kind === 'anomalyRelease') return `${line.displayName} · 异放期望伤害`
  return `${line.displayName} · 异常期望伤害`
})

function buildAlignedAnomalyFormulasFor(
  p: ReturnType<typeof computeDamageResult>,
  sub: AnomalyDamageSubKind,
  disorderLabel: string,
): AlignedFormulaGroup[] {
  const base: AlignedFormulaGroup = {
    key: 'anomalyBaseExpected',
    title: '异常基础',
    hint: '（不含异常增伤/倍率/暴击）',
    terms: [
      { label: '通用乘区', value: formatFormulaNumber(p.generalMultiplier, 2), tipsKey: 'generalMultiplier' },
      { label: '精通区', value: formatFormulaNumber(p.masteryZone), tipsKey: 'masteryZone' },
      { label: '等级区', value: formatFormulaNumber(p.levelZone), tipsKey: 'levelZone' },
      { label: '特殊乘区', value: formatFormulaNumber(p.specialMultiplier), tipsKey: 'specialMultiplier' },
    ],
    result: formatNumber(p.anomalyBaseExpected),
  }
  const anomaly: AlignedFormulaGroup = {
    key: 'anomalyExpected',
    title: '异常伤害',
    terms: [
      { label: '异常基础期望', value: formatNumber(p.anomalyBaseExpected), tipsKey: 'anomalyBaseExpected' },
      { label: '异常增伤区', value: formatFormulaNumber(p.anomalyDmgBonusZone), tipsKey: 'anomalyDmgBonusZone' },
      { label: '异常倍率区', value: formatFormulaNumber(p.anomalyMultZone), tipsKey: 'anomalyMultZone' },
      {
        label: '异常暴击区',
        value: `1 / ${formatFormulaNumber(p.anomalyFullCritZone)}`,
        tipsKey: 'anomalyCritZone',
      },
    ],
    result: formatNumber(p.anomalyExpected),
    dualResults: [
      { label: '暴击率=0', value: formatNumber(p.anomalyExpectedNoCrit) },
      { label: '暴击率=1', value: formatNumber(p.anomalyExpectedFullCrit) },
    ],
  }
  const disorder: AlignedFormulaGroup = {
    key: 'disorderExpected',
    title: `${disorderLabel}期望`,
    terms: [
      { label: '异常基础期望', value: formatNumber(p.anomalyBaseExpected), tipsKey: 'anomalyBaseExpected' },
      { label: '紊乱倍率区', value: formatFormulaNumber(p.disorderZone), tipsKey: 'disorderZone' },
      { label: '紊乱增伤区', value: formatFormulaNumber(p.disorderDmgBonusZone), tipsKey: 'disorderDmgBonusZone' },
    ],
    result: formatNumber(p.disorderExpected),
  }
  const turbulence: AlignedFormulaGroup = {
    key: 'turbulenceExpected',
    title: '乱流伤害',
    terms: [
      { label: '异常基础期望', value: formatNumber(p.anomalyBaseExpected), tipsKey: 'anomalyBaseExpected' },
      { label: '乱流倍率区', value: formatFormulaNumber(p.turbulenceZone), tipsKey: 'turbulenceZone' },
      {
        label: '乱流增伤区+异常增伤区',
        value: formatFormulaNumber(p.turbulenceCombinedDmgBonusZone),
        tipsKey: 'turbulenceCombinedDmgBonusZone',
      },
      {
        label: '异常暴击区',
        value: `1 / ${formatFormulaNumber(p.anomalyFullCritZone)}`,
        tipsKey: 'anomalyCritZone',
      },
    ],
    result: formatNumber(p.turbulenceExpected),
    dualResults: [
      { label: '暴击率=0', value: formatNumber(p.turbulenceExpectedNoCrit) },
      { label: '暴击率=1', value: formatNumber(p.turbulenceExpectedFullCrit) },
    ],
  }
  const release: AlignedFormulaGroup = {
    key: 'anomalyReleaseExpected',
    title: '异放伤害',
    terms: [
      { label: '异常基础期望', value: formatNumber(p.anomalyBaseExpected), tipsKey: 'anomalyBaseExpected' },
      {
        label: '异放综合增伤区',
        value: formatFormulaNumber(p.anomalyReleaseCombinedDmgBonusZone),
        tipsKey: 'anomalyReleaseCombinedDmgBonusZone',
      },
      {
        label: '异放倍率区',
        value: formatFormulaNumber(p.anomalyReleaseMultZone),
        tipsKey: 'anomalyReleaseMultZone',
      },
      {
        label: '异常综合暴击区',
        value: `1 / ${formatFormulaNumber(p.anomalyCombinedFullCritZone)}`,
        tipsKey: 'anomalyCombinedCritZone',
      },
    ],
    result: formatNumber(p.anomalyReleaseExpected),
    dualResults: [
      { label: '暴击率=0', value: formatNumber(p.anomalyReleaseExpectedNoCrit) },
      { label: '暴击率=1', value: formatNumber(p.anomalyReleaseExpectedFullCrit) },
    ],
  }

  if (sub === 'disorder') return [base, disorder]
  if (sub === 'turbulence') return [base, turbulence]
  if (sub === 'anomalyRelease') return [base, release]
  return [base, anomaly]
}

const alignedAnomalyFormulas = computed((): AlignedFormulaGroup[] =>
  buildAlignedAnomalyFormulasFor(
    calcParts.value,
    effectiveAnomalySubKind.value,
    disorderDamageLabel.value,
  ),
)

const selectedEventAnomalyFormulas = computed((): AlignedFormulaGroup[] | null => {
  const line = selectedDamageEventLine.value
  if (!line || line.event.kind === 'direct') return null
  const { anomalySubKind } = mapEventKindToCalc(line.event.kind)
  const disorderLabel = line.result.hasPolarDisorder ? '极性紊乱' : '紊乱伤害'
  return buildAlignedAnomalyFormulasFor(line.result, anomalySubKind, disorderLabel)
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

const valueTips = computed(() => {
  const p = calcParts.value
  const panel = finalPanel.value
  const external = effectiveExternalPanel.value
  const sources = panelBreakdown.value.sources
  const combat = panelBreakdown.value.combatMods
  const enemy = enemyInput
  const pierceMod = panelBreakdown.value.totalMods.pierce

  const sub = effectiveAnomalySubKind.value
  const usesProducerMult =
    (sub === 'turbulence' || sub === 'disorder') &&
    Boolean(triggerFinalPanel.value && triggerExternalPanel.value && triggerPanelBreakdown.value)
  const multPanel = usesProducerMult ? triggerFinalPanel.value! : panel
  const multExternal = usesProducerMult ? triggerExternalPanel.value! : external
  const multSources = usesProducerMult ? triggerPanelBreakdown.value!.sources : sources
  const producerExtraGroup = usesProducerMult
    ? [
        {
          label: triggerAgent.value?.name
            ? `异常产生角色 · ${triggerAgent.value.name}`
            : '异常产生角色',
          items: ['紊乱/乱流基础与补偿倍率、异常持续时间取产生角色面板'],
        },
      ]
    : []

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
    `贯穿力 ${formatFormulaNumber(piercePower.value, 2)} = 0.1×${formatFormulaNumber(panel.hp, 2)} + 0.3×${formatFormulaNumber(panel.atk, 2)} + ${formatFormulaNumber(pierceMod, 2)}`,
    [
      ...(atkProcessItems.length ? ['攻击力：', ...atkProcessItems] : []),
      `贯穿力 = 0.1 × ${formatFormulaNumber(panel.hp, 2)} + 0.3 × ${formatFormulaNumber(panel.atk, 2)} + ${formatFormulaNumber(pierceMod, 2)} = ${formatFormulaNumber(piercePower.value, 2)}`,
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
    defenseMultiplier: isMbMainAgent.value
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
                  `无视防御/减防 ${formatFormulaNumber(external.ignoreDefense + panel.reduceDefense, 2)}%`,
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
          showAdditiveProcess: false,
        }),
      ],
      `贯穿增伤区 ${formatFormulaNumber(p.pierceDmgMultiplier)}`,
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
      formatDirectDmgMultZoneFormula(panel, p.directDmgMultZone, resolvedSkillSubcategory.value),
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
      formatSettlementDmgMultZoneFormula(panel, p.settlementDmgMultZone, resolvedSkillSubcategory.value),
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
              `无视防御/减防 ${formatFormulaNumber(panel.ignoreDefense + panel.reduceDefense, 2)}%`,
              `穿透值 ${formatFormulaNumber(panel.pen, 2)}`,
            ],
          },
        ],
        showAdditiveProcess: false,
      }),
      `有效防御 ${formatFormulaNumber(p.effectiveDefense, 2)}`,
      (() => {
        const defenseCut = panel.ignoreDefense + panel.reduceDefense
        const defenseAfter = enemy.defense * p.defenseFactor * (1 - p.penRateRatio)
        return [
          `防御因子 = max(0, 1 − 无视防御/减防) = max(0, 1 − ${formatFormulaNumber(defenseCut / 100)}) = ${formatFormulaNumber(p.defenseFactor)}`,
          `折后防御 = 敌方防御 × 防御因子 × (1 − 穿透率) = ${formatFormulaNumber(enemy.defense, 2)} × ${formatFormulaNumber(p.defenseFactor)} × (1 − ${formatFormulaNumber(p.penRateRatio)}) = ${formatFormulaNumber(defenseAfter, 2)}`,
          `有效防御 = max(0, 折后防御) − 穿透值 = max(0, ${formatFormulaNumber(defenseAfter, 2)}) − ${formatFormulaNumber(panel.pen, 2)} = ${formatFormulaNumber(p.effectiveDefense, 2)}`,
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
      `贯穿力 ${formatFormulaNumber(piercePower.value, 2)} = 0.1×${formatFormulaNumber(panel.hp, 2)} + 0.3×${formatFormulaNumber(panel.atk, 2)} + ${formatFormulaNumber(pierceMod, 2)}`,
      [
        ...(atkProcessItems.length ? ['攻击力：', ...atkProcessItems] : []),
        `贯穿力 = 0.1 × ${formatFormulaNumber(panel.hp, 2)} + 0.3 × ${formatFormulaNumber(panel.atk, 2)} + ${formatFormulaNumber(pierceMod, 2)} = ${formatFormulaNumber(piercePower.value, 2)}`,
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
    anomalyReleaseCombinedDmgBonusZone: [
      {
        label: '乘区组成',
        items: [
          `异放增伤区 1 + ${formatFormulaNumber(panel.anomalyReleaseDmgBonus, 2)}% = ${formatFormulaNumber(1 + panel.anomalyReleaseDmgBonus / 100)}`,
          `异常增伤区 1 + ${formatFormulaNumber(panel.anomalyDmgBonus, 2)}% = ${formatFormulaNumber(p.anomalyDmgBonusZone)}`,
          `异放综合增伤区 1 + (${formatFormulaNumber(panel.anomalyReleaseDmgBonus, 2)}% + ${formatFormulaNumber(panel.anomalyDmgBonus, 2)}%) = ${formatFormulaNumber(p.anomalyReleaseCombinedDmgBonusZone)}`,
        ],
      },
    ],
    anomalyReleaseMultZone: withTotal(
      buildStatSourceGroups({
        keys: ['anomalyReleaseMult', 'anomalyReleaseMultFactor'],
        externalPanel: external,
        sources,
        finalValues: {
          anomalyReleaseMult: panel.anomalyReleaseMult,
          anomalyReleaseMultFactor: panel.anomalyReleaseMultFactor,
        },
      }),
      `异放倍率区 ${formatFormulaNumber(panel.anomalyReleaseMult, 2)}% × ${formatFormulaNumber(panel.anomalyReleaseMultFactor, 2)}% = ${formatFormulaNumber(p.anomalyReleaseMultZone)}`,
    ),
    anomalyCombinedCritZone: withTotal(
      buildStatSourceGroups({
        keys: ['anomalyCritRate', 'anomalyCritDmg', 'anomalyReleaseCritRate', 'anomalyReleaseCritDmg'],
        externalPanel: external,
        sources,
        finalValues: {
          anomalyCritRate: panel.anomalyCritRate,
          anomalyCritDmg: panel.anomalyCritDmg,
          anomalyReleaseCritRate: panel.anomalyReleaseCritRate,
          anomalyReleaseCritDmg: panel.anomalyReleaseCritDmg,
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
        externalPanel: external,
        sources,
        finalValues: {
          anomalyCritRate: panel.anomalyCritRate,
          anomalyCritDmg: panel.anomalyCritDmg,
        },
      }),
      [
        `暴击率=0：异常暴击区 = 1`,
        `暴击率=1：异常暴击区 = 1 + ${formatFormulaNumber(p.anomalyCritDmgRatio)} = ${formatFormulaNumber(p.anomalyFullCritZone)}`,
        `实际期望：1 + ${formatFormulaNumber(p.anomalyCritRateRatio)} × ${formatFormulaNumber(p.anomalyCritDmgRatio)} = ${formatFormulaNumber(p.anomalyCritZone)}`,
      ].join('；'),
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
        externalPanel: external,
        sources,
        finalValues: { disorderDmgBonus: panel.disorderDmgBonus },
      }),
      `紊乱增伤区 1 + ${formatFormulaNumber(panel.disorderDmgBonus, 2)}% = ${formatFormulaNumber(p.disorderDmgBonusZone)}`,
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
        externalPanel: external,
        sources,
        finalValues: { turbulenceDmgBonus: panel.turbulenceDmgBonus },
      }),
      `乱流增伤区 1 + ${formatFormulaNumber(panel.turbulenceDmgBonus, 2)}% = ${formatFormulaNumber(p.turbulenceDmgBonusZone)}`,
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
          `异常暴击区（暴击率=0）1 → ${formatNumber(p.turbulenceExpectedNoCrit)}`,
          `异常暴击区（暴击率=1）${formatFormulaNumber(p.anomalyFullCritZone)} → ${formatNumber(p.turbulenceExpectedFullCrit)}`,
        ],
      },
    ],
    anomalyReleaseExpected: [
      {
        label: '乘区组成',
        items: [
          `异常基础期望 ${formatNumber(p.anomalyBaseExpected)}`,
          `异放综合增伤区 ${formatFormulaNumber(p.anomalyReleaseCombinedDmgBonusZone)}（异放增伤+异常增伤）`,
          `异放倍率区 ${formatFormulaNumber(p.anomalyReleaseMultZone)}`,
          `异常综合暴击区 = 1 + (${formatFormulaNumber(p.anomalyCombinedCritRateRatio)} × ${formatFormulaNumber(p.anomalyCombinedCritDmgRatio)})`,
          `暴击率=0 → ${formatNumber(p.anomalyReleaseExpectedNoCrit)}`,
          `暴击率=1（区 ${formatFormulaNumber(p.anomalyCombinedFullCritZone)}）→ ${formatNumber(p.anomalyReleaseExpectedFullCrit)}`,
        ],
      },
    ],
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
  return {
    baseDamageSource: baseDamageSource.value,
    externalPanel: { ...externalPanel },
    affixCounts: { ...affixCounts },
    affixDriveDiscMainStats: { ...affixDriveDiscMainStats },
    extraMods: { ...extraMods.value },
    extraGains: extraGains.value.map((item) => ({ ...item })),
    enemyInput: { ...enemyInput },
  }
}

function loadSnapshot(snapshot: DamageCalcPanelSnapshot) {
  baseDamageSource.value = snapshot.baseDamageSource
  Object.assign(externalPanel, createDefaultExternalPanel(), snapshot.externalPanel)
  Object.assign(affixCounts, snapshot.affixCounts)
  Object.assign(affixDriveDiscMainStats, snapshot.affixDriveDiscMainStats)
  if (snapshot.extraGains?.length) {
    extraGains.value = snapshot.extraGains.map((item) => ({
      id: item.id,
      name: item.name,
      stat: item.stat as BuffStatKey,
      value: item.value,
      applySituation: item.applySituation ?? 'global',
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
  Object.assign(enemyInput, snapshot.enemyInput)
  if (!Number.isFinite(enemyInput.level) || enemyInput.level < 1) {
    enemyInput.level = 60
  }
}

/** 事件倍率默认值：异常取主 C 最终面板；紊乱/乱流取产生角色最终面板；异放倍率取主 C（按产生角色属性筛选增益） */
function resolveMultDefaultsForEvent(
  event: DamageEvent,
): Partial<Record<keyof DamageEventMultOverrides, number>> {
  const result: Partial<Record<keyof DamageEventMultOverrides, number>> = {}

  if (event.kind === 'anomalyRelease') {
    const { skillCtx, triggerElement } = buildEventSkillContext(event)
    const fields = resolveMainCAnomalyReleaseMultFields(
      effectiveExternalPanel.value,
      buildEventPanelCalcContext(skillCtx),
      triggerElement,
    )
    result.anomalyReleaseMult = fields.anomalyReleaseMult
    result.anomalyReleaseMultFactor = fields.anomalyReleaseMultFactor
    return result
  }

  const probe: DamageEvent = { ...event, multOverrides: null }
  const input = buildEventCalcFull(probe)

  if (event.kind === 'direct') {
    const panel = input?.finalPanel ?? finalPanel.value
    result.directDmgMult = panel.directDmgMult
    result.settlementDmgMult = panel.settlementDmgMult
    result.directDmgMultFactor = panel.directDmgMultFactor
    return result
  }

  if (event.kind === 'anomaly') {
    const panel = input?.finalPanel ?? finalPanel.value
    result.anomalyMult = panel.anomalyMult
    result.anomalyMultFactor = panel.anomalyMultFactor
    return result
  }

  const panel = input?.triggerFinalPanel
  if (!panel) return result

  if (event.kind === 'disorder') {
    result.disorderBaseMult = panel.disorderBaseMult
    result.disorderBaseMultFactor = panel.disorderBaseMultFactor
    result.disorderCompMult = panel.disorderCompMult
  } else if (event.kind === 'turbulence') {
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
              : '录入主C局外面板（初始面板），局内面板由队伍增益、音擎、邦布与额外 Buff 自动汇总。'
          }}
        </p>
      </div>
    </header>

    <p v-if="teamSummary" class="team-summary">{{ teamSummary }}</p>
    <p v-if="isMbMainAgent" class="mb-hint">
      当前主C为命破：基础伤害来源固定为贯穿力，防御区固定为 1。
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
        <span>主C角色名</span>
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
          2/4 件套沿用上方主C驱动盘选择（{{ mainDriveDiscSummary }}）；默认 6 盘均为 15 级，1 号
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
          基于主C角色基础面板、音擎与驱动盘属性计算局外面板；每条副词条按固定数值折算（如生命 +112、攻击 +19、穿透 +9、双暴 +2.4%/+4.8%、精通 +9 等）。
        </p>
      </header>
      <p v-if="!mainAgent" class="affix-hint">请先选择主C角色，以加载其基础面板。</p>
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
            <h3>当前属性异常的产生角色 · 局外面板</h3>
            <p>
              紊乱/乱流/异放的异常基础乘区使用该角色<strong>局内最终面板</strong>（吃完增益后）；请为在伤害事件中选为产生角色且非主
              C 的代理人录入局外初始面板。
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
                <span>{{ slot.kind === 'stat' ? slot.label : '' }}</span>
                <input
                  v-if="slot.kind === 'stat'"
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

        <section class="panel-block extra-mods-block">
          <header class="panel-block-header">
            <h3>额外 Buff 增益</h3>
            <p>未录入角色/音擎/邦布数据时的补充增益，按条添加，参与局内面板与乘区汇总。</p>
          </header>
          <ExtraBuffGainEditor v-model="extraGains" />
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

    <details class="buff-breakdown">
      <summary>查看局内增益汇总数值</summary>
      <ul class="mods-summary">
        <li v-for="field in BUFF_STAT_FIELDS" :key="field.key">
          <span>{{ buffStatFieldLabel(field) }}</span>
          <strong>{{ panelBreakdown.totalMods[field.key] }}</strong>
        </li>
      </ul>
      <BuffModSourcesDisplay
        :sources="panelBreakdown.sources"
        :skill-subcategories="skillSubcategories"
      />
    </details>

    <h3 class="enemy-title">敌方与环境</h3>
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
      <label class="field"><span>易伤区（基础）</span><input v-model.number="enemyInput.vulnerableMultiplier" type="number" step="0.01" /></label>
      <label class="field">
        <span>失衡易伤区（基础）</span>
        <EnemyPresetCombo
          v-model="enemyInput.staggerMultiplier"
          :presets="STAGGER_MULTIPLIER_PRESETS"
          step="0.01"
          aria-label="失衡易伤预设"
        />
      </label>
      <label class="field"><span>特殊乘区（基础）</span><input v-model.number="enemyInput.specialMultiplier" type="number" step="0.01" /></label>
      <label class="field"><span>代理人等级</span><input v-model.number="enemyInput.level" type="number" min="1" max="60" step="1" /></label>
    </div>

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

    <template v-if="!showDetailedResults && !anomalyCalcBlockedReason">
      <div class="result-grid result-grid-summary">
        <p v-if="hasDamageEventResults" class="result-total">
          {{ damageEventTotalLabel }}：
          <span>{{ formatNumber(damageEventSummary!.grandTotal) }}</span>
        </p>
        <p v-else-if="damageKind !== 'anomaly'" class="result-total">
          直伤期望伤害：
          <StatValueWithSources
            :value="formatNumber(calcParts.directDamageExpected)"
            :groups="valueTips.directDamageExpected"
          />
        </p>
        <template v-if="damageKind !== 'direct'">
          <template v-if="effectiveAnomalySubKind === 'anomaly'">
            <p class="result-total">
              异常伤害（暴击率=0）：
              <StatValueWithSources
                :value="formatNumber(calcParts.anomalyExpectedNoCrit)"
                :groups="valueTips.anomalyExpected"
              />
            </p>
            <p class="result-total">
              异常伤害（暴击率=1）：
              <StatValueWithSources
                :value="formatNumber(calcParts.anomalyExpectedFullCrit)"
                :groups="valueTips.anomalyExpected"
              />
            </p>
          </template>
          <p v-else-if="effectiveAnomalySubKind === 'disorder'" class="result-total">
            {{ disorderDamageLabel }}期望伤害：
            <StatValueWithSources
              :value="formatNumber(calcParts.disorderExpected)"
              :groups="valueTips.disorderExpected"
            />
          </p>
          <template v-else-if="effectiveAnomalySubKind === 'turbulence'">
            <p class="result-total">
              乱流伤害（暴击率=0）：
              <StatValueWithSources
                :value="formatNumber(calcParts.turbulenceExpectedNoCrit)"
                :groups="valueTips.turbulenceExpected"
              />
            </p>
            <p class="result-total">
              乱流伤害（暴击率=1）：
              <StatValueWithSources
                :value="formatNumber(calcParts.turbulenceExpectedFullCrit)"
                :groups="valueTips.turbulenceExpected"
              />
            </p>
          </template>
          <template v-else>
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
        </template>
      </div>
    </template>

    <template v-else>
    <section v-if="hasDamageEventResults" class="event-summary-block">
      <h3 class="result-section-title event-summary-title">{{ damageEventTotalLabel }}</h3>
      <ul class="event-summary-list">
        <li
          v-for="line in damageEventSummary!.lines"
          :key="line.event.id"
          class="event-summary-item"
          :class="{ 'event-summary-item--active': selectedDamageEventId === line.event.id }"
          role="button"
          tabindex="0"
          @click="toggleDamageEventSelection(line.event.id)"
          @keydown.enter.prevent="toggleDamageEventSelection(line.event.id)"
          @keydown.space.prevent="toggleDamageEventSelection(line.event.id)"
        >
          <span class="event-summary-name">
            {{ line.displayName }}
            <span v-if="line.event.count > 1" class="event-summary-count">×{{ line.event.count }}</span>
          </span>
          <span class="event-summary-damage">
            单次 {{ formatNumber(line.perHit) }} · 合计 {{ formatNumber(line.total) }}
          </span>
        </li>
      </ul>
      <p class="result-total event-summary-total">
        {{ damageEventTotalLabel }}：{{ formatNumber(damageEventSummary!.grandTotal) }}
      </p>
    </section>

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
      <p class="result-subtotal">通用乘区：<StatValueWithSources :value="formatNumber(calcParts.generalMultiplier)" :groups="valueTips.generalMultiplier" /></p>
    </div>

    <section
      v-if="selectedDamageEventLine && selectedEventDirectFormula"
      class="event-detail-block"
    >
      <h3 class="result-section-title">
        {{ selectedDamageEventLine.displayName }} · 直伤期望伤害
      </h3>
      <div class="formula-block formula-block--aligned">
        <DirectDamageFormulaAligned
          :group="selectedEventDirectFormula"
          :value-tips="valueTips"
        />
      </div>
      <div class="result-grid">
        <p>暴击率（计入上限 1）：<StatValueWithSources :value="selectedDamageEventLine.result.critRateRatio" :groups="valueTips.critRateRatio" /></p>
        <p>暴击区：<StatValueWithSources :value="selectedDamageEventLine.result.critMultiplier" :groups="valueTips.critMultiplier" /></p>
        <p>特殊乘区（含增益）：<StatValueWithSources :value="selectedDamageEventLine.result.specialMultiplier" :groups="valueTips.specialMultiplier" /></p>
        <p v-if="selectedDamageEventLine.result.baseDamageSource === 'pierce'">
          贯穿增伤区：<StatValueWithSources :value="selectedDamageEventLine.result.pierceDmgMultiplier" :groups="valueTips.pierceDmgMultiplier" />
        </p>
        <p>直伤倍率区：<StatValueWithSources :value="selectedDamageEventLine.result.directDmgMultZone" :groups="valueTips.directDmgMultZone" /></p>
        <p v-if="selectedDamageEventLine.result.settlementDmgMultZone > 0">
          决算倍率区：<StatValueWithSources :value="selectedDamageEventLine.result.settlementDmgMultZone" :groups="valueTips.settlementDmgMultZone" />
        </p>
        <p>穿透率（计入）：<StatValueWithSources :value="selectedDamageEventLine.result.penRateRatio" :groups="valueTips.penRateRatio" /></p>
        <p>有效防御项：<StatValueWithSources :value="selectedDamageEventLine.result.effectiveDefense" :groups="valueTips.effectiveDefense" /></p>
        <p>贯穿力（局内）：<StatValueWithSources :value="formatNumber(piercePower)" :groups="valueTips.piercePower" /></p>
        <p class="result-total">
          直伤期望伤害：
          <StatValueWithSources
            :value="formatNumber(selectedDamageEventLine.perHit)"
            :groups="valueTips.directDamageExpected"
          />
        </p>
        <p v-if="selectedDamageEventLine.event.count > 1" class="result-total">
          合计伤害：
          <span>{{ formatNumber(selectedDamageEventLine.total) }}</span>
        </p>
      </div>
    </section>

    <section
      v-if="selectedDamageEventLine && selectedEventAnomalyFormulas"
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
          单次期望：{{ formatNumber(selectedDamageEventLine.perHit) }}
        </p>
        <p v-if="selectedDamageEventLine.event.count > 1" class="result-total">
          合计伤害：{{ formatNumber(selectedDamageEventLine.total) }}
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
      <p class="result-total">异常基础期望：<StatValueWithSources :value="formatNumber(calcParts.anomalyBaseExpected)" :groups="valueTips.anomalyBaseExpected" /></p>

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

      <template v-else>
      <h4 class="result-subsection-title">异放伤害</h4>
      <p>
        异放综合增伤区：{{ formatFormulaNumber(calcParts.anomalyReleaseCombinedDmgBonusZone) }}
      </p>
      <p>异放倍率区：{{ formatFormulaNumber(calcParts.anomalyReleaseMultZone) }}</p>
      <p>
        异常综合暴击区公式：1 + ({{ formatFormulaNumber(calcParts.anomalyCombinedCritRateRatio) }})
        × ({{ formatFormulaNumber(calcParts.anomalyCombinedCritDmgRatio) }})
      </p>
      <p>异常综合暴击区（暴击率=0）：1</p>
      <p>异常综合暴击区（暴击率=1）：{{ formatFormulaNumber(calcParts.anomalyCombinedFullCritZone) }}</p>
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
  margin-top: 0.75rem;
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
  margin: 0 0 0.75rem;
  padding: 0.55rem 0.75rem;
  border-radius: 10px;
  border: 1px solid rgba(224, 120, 80, 0.45);
  background: rgba(224, 120, 80, 0.12);
  color: #f0c2a8;
  font-size: 0.84rem;
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
</style>
