<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc, Skill, SkillDamageType, SkillTypeId } from '@/types/calculator'
import type { FlowEntry, PreparedSkill, SchemeSlot } from '@/types/damageCalcHistory'
import SkillFlowCard from '@/components/calculator/SkillFlowCard.vue'
import SkillFlowStatsPanel from '@/components/calculator/SkillFlowStatsPanel.vue'
import SkillDefinitionForm from '@/components/calculator/SkillDefinitionForm.vue'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import { listAllDamageCalcHistory } from '@/utils/damageCalcHistory'
import type { DamageCalcResult } from '@/utils/damageCalc'
import {
  DAMAGE_EVENT_KIND_OPTIONS,
  isTurbulenceWindTrigger,
} from '@/utils/damageEvent'
import {
  defaultAnomalyAgents,
  ensureSchemeSlots,
  getHitSkipReason,
  newLocalId,
  skillNeedsDualAgents,
  type ResolvedHit,
} from '@/utils/resolvedHit'
import { isLuminousAgent } from '@/utils/remielUtils'
import {
  buildSkillCalcZoneRows,
  formatSkillMultZoneAsPercent,
  pickSkillMultPercentRatio,
} from '@/utils/skillCalcZones'
import { createCustomSkillId } from '@/utils/skillLibrary'
import {
  resolveInherentSkillMultPercent,
  skillMultNeedsAnomalyPowerProvider,
  unsetSkillMult,
} from '@/utils/skillSubcategoryMult'
import { SKILL_TYPE_OPTIONS } from '@/utils/skillTypes'

import { teamSlotDisplayLabel } from '@/utils/teamSlotLabel'

const props = defineProps<{
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  hits?: ResolvedHit[]
  hitDamages?: Record<string, number>
  hitCalcResults?: Record<string, DamageCalcResult>
  /** 当前加载的方案名；未归档为空 */
  schemeName?: string
}>()

const slots = defineModel<SchemeSlot[]>('slots', { required: true })
const activeSlotIndex = defineModel<number>('editedSlotIndex', { default: 0 })

function writeSlots(next: SchemeSlot[]) {
  slots.value = ensureSchemeSlots(next, Math.max(3, props.teamSlots.length))
}

const buffStore = useCalculatorBuffStore()
const { skillSubcategories } = storeToRefs(buffStore)

const libraryQuery = ref('')
/** 可选筛选，全不点 = 当前角色可见的全部招式（含本元素公共异常） */
const libraryKindDirect = ref(false)
const libraryKindAnomaly = ref(false)
const librarySourceCustom = ref(false)
const librarySourcePreset = ref(false)
const showCustomForm = ref(false)
const expanded = ref(true)
const modalTab = ref<'prep' | 'flow'>('prep')
const flowDragEnabled = ref(false)
const flowDraggingId = ref<string | null>(null)
/** n 条招式对应 n+1 条插入缝，拖放只认缝不认行的上/下沿。 */
const flowDropIndex = ref<number | null>(null)
const flowListEl = ref<HTMLUListElement | null>(null)
const detail = ref<
  | { kind: 'library'; skillId: string }
  | { kind: 'prepared'; preparedId: string }
  | { kind: 'flow'; entryId: string }
  | null
>(null)

watch(
  () => props.teamSlots.length,
  (count) => {
    const need = Math.max(3, count)
    if (slots.value.length === need) return
    slots.value = ensureSchemeSlots(slots.value, need)
  },
)

watch(modalTab, () => {
  flowDraggingId.value = null
  flowDropIndex.value = null
})

watch(flowDragEnabled, (on) => {
  if (on) return
  flowDraggingId.value = null
  flowDropIndex.value = null
})

watch(
  () => props.teamSlots.map((slot) => slot.agentId).join(','),
  () => {
    const firstFilled = props.teamSlots.findIndex((slot) => slot.agentId)
    if (firstFilled >= 0 && !props.teamSlots[activeSlotIndex.value]?.agentId) {
      activeSlotIndex.value = firstFilled
    }
  },
)

/** 旧数据未选双代理人时，回填为当前角色 */
function hydratePreparedAnomalyAgents() {
  const next = ensureSchemeSlots(slots.value, Math.max(3, props.teamSlots.length))
  let changed = false
  next.forEach((slot, index) => {
    const ownerId = props.teamSlots[index]?.agentId
    if (!ownerId) return
    for (const item of slot.prepared) {
      const skill = buffStore.findSkill(item.skillId)
      if (!skill || !skillNeedsDualAgents(skill.damageType)) continue
      const defaults = defaultAnomalyAgents(skill.damageType, ownerId)
      if (!item.anomalyPowerAgentId && defaults.anomalyPowerAgentId) {
        item.anomalyPowerAgentId = defaults.anomalyPowerAgentId
        changed = true
      }
      if (!item.triggerAgentId && defaults.triggerAgentId) {
        item.triggerAgentId = defaults.triggerAgentId
        changed = true
      }
    }
  })
  if (changed) slots.value = next
}

watch(
  () =>
    [
      props.teamSlots.map((slot) => slot.agentId).join(','),
      slots.value.map((slot) => slot.prepared.map((item) => item.skillId).join('+')).join('|'),
    ].join('#'),
  () => hydratePreparedAnomalyAgents(),
  { immediate: true },
)

const currentSlot = computed(() => slots.value[activeSlotIndex.value] ?? { prepared: [], flow: [] })
/** 真正会换位时才画线；停在自己原来那条缝上不显示。 */
const flowInsertIndex = computed(() => {
  const drop = flowDropIndex.value
  const draggingId = flowDraggingId.value
  if (drop == null || !draggingId) return null
  const from = currentSlot.value.flow.findIndex((item) => item.id === draggingId)
  if (from < 0) return drop
  if (drop === from || drop === from + 1) return null
  return drop
})
const currentAgentId = computed(() => props.teamSlots[activeSlotIndex.value]?.agentId ?? '')
const currentAgent = computed(
  () => props.agents.find((item) => item.id === currentAgentId.value) ?? null,
)
const currentTeamSlotLabel = computed(() => {
  const slot = props.teamSlots[activeSlotIndex.value]
  return slot ? slotLabel(slot, activeSlotIndex.value) : '空位'
})

const teamAgentOptions = computed(() =>
  props.teamSlots
    .map((slot) => props.agents.find((item) => item.id === slot.agentId))
    .filter((item): item is AgentBuffDoc => Boolean(item)),
)

const preparedSkillIds = computed(
  () => new Set(currentSlot.value.prepared.map((item) => item.skillId)),
)

const preparedSkillNames = computed(() => {
  const names = new Set<string>()
  for (const item of currentSlot.value.prepared) {
    const name = preparedSkill(item)?.name.trim()
    if (name) names.add(name)
  }
  return names
})

const flowPreparedIds = computed(
  () => new Set(currentSlot.value.flow.map((item) => item.preparedId)),
)

const visibleLibrarySkills = computed(() => {
  if (!currentAgentId.value) return [] as Skill[]
  const element = props.agents.find((item) => item.id === currentAgentId.value)?.element ?? ''
  return buffStore.skillsForAgent(currentAgentId.value, element)
})

const librarySkills = computed(() => {
  let list = visibleLibrarySkills.value
  const kindDirect = libraryKindDirect.value
  const kindAnomaly = libraryKindAnomaly.value
  if (kindDirect !== kindAnomaly) {
    list = list.filter((skill) => skillNeedsDualAgents(skill.damageType) === kindAnomaly)
  }
  const srcCustom = librarySourceCustom.value
  const srcPreset = librarySourcePreset.value
  if (srcCustom || srcPreset) {
    list = list.filter((skill) => {
      const matchCustom = srcCustom && skill.source === 'custom'
      const matchPreset = srcPreset && skill.source === 'preset'
      return matchCustom || matchPreset
    })
  }
  const q = libraryQuery.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((skill) => skill.name.toLowerCase().includes(q))
})

const libraryEmptyText = computed(() => {
  if (!visibleLibrarySkills.value.length) {
    return '该角色还没有招式。可先新建自定义，或到管理端录入预设。'
  }
  return '当前筛选没有招式。'
})

function preparedBlockReason(skill: Skill): 'id' | 'name' | null {
  if (preparedSkillIds.value.has(skill.id)) return 'id'
  const name = skill.name.trim()
  if (name && preparedSkillNames.value.has(name)) return 'name'
  return null
}

const unpreparedFilteredCount = computed(
  () => librarySkills.value.filter((skill) => !preparedBlockReason(skill)).length,
)

function damageTypeLabel(type: SkillDamageType) {
  return DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === type)?.label ?? type
}

function skillStypeLabels(skill: Skill) {
  return skill.skillTypes
    .map((id) => SKILL_TYPE_OPTIONS.find((item) => item.id === id)?.label ?? id)
    .filter(Boolean)
}

/** 有结算结果时显示最终倍率区对应的百分点；否则回落招式固有/填写值 */
function skillMultText(skill: Skill, calcKey?: string | null) {
  if (calcKey) {
    const result = props.hitCalcResults?.[calcKey]
    if (result) {
      const ratio = pickSkillMultPercentRatio(result, skill.damageType)
      if (ratio != null) return formatSkillMultZoneAsPercent(ratio)
    }
  }
  const filled = Number(skill.baseMult)
  if (!unsetSkillMult(filled)) return String(filled)
  const anchorId = skill.buffAnchorId?.trim()
  const sub = anchorId
    ? skillSubcategories.value.find((item) => item.id === anchorId)
    : null
  const agent = props.agents.find((item) => item.id === skill.agentId) ?? null
  const fromInherent = resolveInherentSkillMultPercent({
    damageType: skill.damageType,
    buffAnchorId: anchorId,
    subcategory: sub,
    agent,
    element: skill.element || agent?.element,
  })
  if (fromInherent != null) return String(fromInherent)
  if (skillMultNeedsAnomalyPowerProvider(skill.damageType)) return '待选择'
  return ''
}

function findPreparedForMultContext(
  skill: Skill,
  calcKey?: string | null,
): PreparedSkill | null {
  if (calcKey) {
    const byPreparedId = currentSlot.value.prepared.find((item) => item.id === calcKey)
    if (byPreparedId) return byPreparedId
    const flow = currentSlot.value.flow.find((item) => item.id === calcKey)
    if (flow) {
      return currentSlot.value.prepared.find((item) => item.id === flow.preparedId) ?? null
    }
  }
  return currentSlot.value.prepared.find((item) => item.skillId === skill.id) ?? null
}

function cardTriggerWarn(skill: Skill | null, calcKey?: string | null): string | null {
  if (!skill) return null
  const prepared = findPreparedForMultContext(skill, calcKey)
  if (!prepared?.triggerAgentId) return null
  return anomalyTriggerMultHint(skill, prepared.triggerAgentId)
}

function libraryMultText(skill: Skill) {
  // 直伤等不依赖双代理人：库内可直接展示固有/填写倍率
  if (!skillNeedsDualAgents(skill.damageType)) {
    return skillMultText(skill, skill.id)
  }
  const prepared = currentSlot.value.prepared.find((item) => item.skillId === skill.id)
  // 异放/乱流/耀变等：等准备阶段选好强度提供者与触发者后再显示
  if (!prepared?.anomalyPowerAgentId || !prepared?.triggerAgentId) {
    return '待选择'
  }
  // 乱流非风触发 / 耀变非蕾米：不展示倍率
  if (anomalyTriggerMultHint(skill, prepared.triggerAgentId)) {
    return '—'
  }
  return skillMultText(skill, prepared.id)
}

function libraryMultWarn(skill: Skill): string | null {
  const prepared = currentSlot.value.prepared.find((item) => item.skillId === skill.id)
  if (!prepared?.triggerAgentId) return null
  return anomalyTriggerMultHint(skill, prepared.triggerAgentId)
}

function agentShortName(agentId: string | null | undefined) {
  if (!agentId) return ''
  return props.agents.find((item) => item.id === agentId)?.name?.slice(0, 1) || ''
}

function agentFullName(agentId: string | null | undefined) {
  if (!agentId) return ''
  return props.agents.find((item) => item.id === agentId)?.name ?? ''
}

/** 异常类才有胶囊；未选为空；异放等预设了触发者则显示「→安」 */
function agentPairText(prepared: PreparedSkill, skill: Skill) {
  if (!skillNeedsDualAgents(skill.damageType)) return ''
  const left = agentShortName(prepared.anomalyPowerAgentId)
  const right = agentShortName(prepared.triggerAgentId)
  if (!left && !right) return ''
  if (left && right) return `${left}→${right}`
  if (right) return `→${right}`
  return `${left}→`
}

function agentPairTitle(prepared: PreparedSkill, skill: Skill) {
  if (!skillNeedsDualAgents(skill.damageType)) return ''
  const left = agentFullName(prepared.anomalyPowerAgentId)
  const right = agentFullName(prepared.triggerAgentId)
  if (!left && !right) return ''
  return `${left || '未选'} → ${right || '未选'}`
}

function formatDamage(value: number | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return ''
  return Math.round(value).toLocaleString('en-US')
}

function damageForFlow(entryId: string) {
  return formatDamage(props.hitDamages?.[entryId])
}

function dtypeKind(type: SkillDamageType) {
  return skillNeedsDualAgents(type) ? 'anomaly' : 'direct'
}

type PendingConfirm = {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => void
}

const pendingConfirm = ref<PendingConfirm | null>(null)

function closeConfirm() {
  pendingConfirm.value = null
}

function runConfirm() {
  const pending = pendingConfirm.value
  pendingConfirm.value = null
  pending?.onConfirm()
}

function openConfirm(opts: Omit<PendingConfirm, 'onConfirm'>, action: () => void) {
  pendingConfirm.value = { ...opts, onConfirm: action }
}

function clearPrepared() {
  if (!currentSlot.value.prepared.length) return
  openConfirm(
    {
      title: '清空准备招式',
      message: '清空当前角色的全部准备招式？流程里对应条目也会去掉。',
      confirmText: '清空',
      danger: true,
    },
    () => {
      const next = ensureSchemeSlots(slots.value)
      const slot = next[activeSlotIndex.value]!
      slot.prepared = []
      slot.flow = []
      slots.value = next
      detail.value = null
    },
  )
}

function closeDetail() {
  detail.value = null
}

function closeCustomForm() {
  showCustomForm.value = false
}

function openCustomForm() {
  detail.value = null
  showCustomForm.value = true
}

function openPreparedDetail(preparedId: string) {
  showCustomForm.value = false
  detail.value = { kind: 'prepared', preparedId }
}

function openFlowDetail(entryId: string) {
  showCustomForm.value = false
  detail.value = { kind: 'flow', entryId }
}

function openLibraryDetail(skillId: string) {
  showCustomForm.value = false
  detail.value = { kind: 'library', skillId }
}

const detailSkill = computed((): Skill | null => {
  const current = detail.value
  if (!current) return null
  if (current.kind === 'library') return buffStore.findSkill(current.skillId)
  if (current.kind === 'prepared') {
    const prepared = currentSlot.value.prepared.find((item) => item.id === current.preparedId)
    return prepared ? preparedSkill(prepared) : null
  }
  const entry = currentSlot.value.flow.find((item) => item.id === current.entryId)
  if (!entry) return null
  const prepared = currentSlot.value.prepared.find((item) => item.id === entry.preparedId)
  return prepared ? preparedSkill(prepared) : null
})

const detailPrepared = computed((): PreparedSkill | null => {
  const current = detail.value
  if (!current) return null
  if (current.kind === 'prepared') {
    return currentSlot.value.prepared.find((item) => item.id === current.preparedId) ?? null
  }
  if (current.kind === 'flow') {
    const entry = currentSlot.value.flow.find((item) => item.id === current.entryId)
    if (!entry) return null
    return currentSlot.value.prepared.find((item) => item.id === entry.preparedId) ?? null
  }
  return null
})

const detailTitle = computed(() => detailSkill.value?.name || '招式详情')

const detailCanEditDefinition = computed(
  () => detail.value?.kind === 'library' && detailSkill.value?.source === 'custom',
)

const detailCanEditAgents = computed(() => detail.value?.kind === 'prepared')

const detailCalcKey = computed(() => {
  const current = detail.value
  if (!current) return null
  if (current.kind === 'flow') return current.entryId
  if (current.kind === 'prepared') return current.preparedId
  const prepared = currentSlot.value.prepared.find((item) => item.skillId === current.skillId)
  return prepared?.id ?? current.skillId
})

const detailSkipReason = computed(() => {
  const current = detail.value
  if (!current) return null
  if (current.kind === 'flow') {
    const entry = currentSlot.value.flow.find((item) => item.id === current.entryId)
    return entry ? flowSkipReason(entry) : null
  }
  const prepared = detailPrepared.value
  const skill = detailSkill.value
  if (prepared && skill) return dualAgentHint(prepared, skill)
  return null
})

const detailZoneRows = computed(() => {
  const skill = detailSkill.value
  const key = detailCalcKey.value
  if (!skill || !key || detailSkipReason.value) return []
  const result = props.hitCalcResults?.[key]
  if (!result) return []
  return buildSkillCalcZoneRows(result, skill.damageType)
})

/** 详情「倍率%」：最终倍率区换算为百分点；触发者不合规则不展示倍率 */
const detailResolvedMultDisplay = computed(() => {
  const skill = detailSkill.value
  const key = detailCalcKey.value
  if (!skill || !key) return null
  if (detailCanEditDefinition.value && detailDraft.damageType !== skill.damageType) return null
  const prepared = detailPrepared.value
  if (prepared?.triggerAgentId) {
    const hint = anomalyTriggerMultHint(skill, prepared.triggerAgentId)
    if (hint) return null
  }
  const result = props.hitCalcResults?.[key]
  if (!result) return null
  const ratio = pickSkillMultPercentRatio(result, skill.damageType)
  if (ratio == null) return null
  return formatSkillMultZoneAsPercent(ratio)
})

function setDetailAgent(field: 'anomalyPowerAgentId' | 'triggerAgentId', raw: string) {
  if (detail.value?.kind !== 'prepared') return
  const prepared = detailPrepared.value
  if (!prepared) return
  updatePrepared(prepared.id, { [field]: raw || null })
}

function preparedSkill(prepared: PreparedSkill): Skill | null {
  return buffStore.findSkill(prepared.skillId)
}

function slotLabel(slot: TeamSlot, index: number) {
  return teamSlotDisplayLabel(slot, index, props.agents)
}

function addPrepared(skill: Skill) {
  const ownerId = currentAgentId.value
  if (!ownerId) return
  if (preparedBlockReason(skill)) return

  const slotIndex = activeSlotIndex.value
  const agents = defaultAnomalyAgents(skill.damageType, ownerId)
  const next = ensureSchemeSlots(slots.value, Math.max(3, props.teamSlots.length))
  const slot = next[slotIndex]
  if (!slot) return
  slot.prepared.push({
    id: newLocalId('prep'),
    skillId: skill.id,
    skillSource: skill.source === 'preset' ? 'preset' : 'custom',
    anomalyPowerAgentId: agents.anomalyPowerAgentId,
    triggerAgentId: agents.triggerAgentId,
    extraMods: null,
  })
  writeSlots(next)
}

function addFilteredToPrepared() {
  const ownerId = currentAgentId.value
  if (!ownerId) return
  const existingIds = new Set(currentSlot.value.prepared.map((item) => item.skillId))
  const existingNames = new Set(preparedSkillNames.value)
  const next = ensureSchemeSlots(slots.value, Math.max(3, props.teamSlots.length))
  const slot = next[activeSlotIndex.value]
  if (!slot) return
  for (const skill of librarySkills.value) {
    const name = skill.name.trim()
    if (existingIds.has(skill.id) || (name && existingNames.has(name))) continue
    existingIds.add(skill.id)
    if (name) existingNames.add(name)
    const agents = defaultAnomalyAgents(skill.damageType, ownerId)
    slot.prepared.push({
      id: newLocalId('prep'),
      skillId: skill.id,
      skillSource: skill.source === 'preset' ? 'preset' : 'custom',
      anomalyPowerAgentId: agents.anomalyPowerAgentId,
      triggerAgentId: agents.triggerAgentId,
      extraMods: null,
    })
  }
  writeSlots(next)
}

function removePrepared(preparedId: string) {
  const next = ensureSchemeSlots(slots.value)
  const slot = next[activeSlotIndex.value]!
  slot.prepared = slot.prepared.filter((item) => item.id !== preparedId)
  slot.flow = slot.flow.filter((item) => item.preparedId !== preparedId)
  slots.value = next
}

function updatePrepared(preparedId: string, patch: Partial<PreparedSkill>) {
  const next = ensureSchemeSlots(slots.value)
  const slot = next[activeSlotIndex.value]!
  const index = slot.prepared.findIndex((item) => item.id === preparedId)
  if (index < 0) return
  slot.prepared[index] = { ...slot.prepared[index]!, ...patch }
  slots.value = next
}

function getActiveSlot(): SchemeSlot | undefined {
  return slots.value[activeSlotIndex.value]
}

function addToFlow(prepared: PreparedSkill) {
  const ownerId = currentAgentId.value
  if (!ownerId) return
  const slot = getActiveSlot()
  if (!slot) return
  slot.flow.push({
    id: newLocalId('flow'),
    ownerAgentId: ownerId,
    preparedId: prepared.id,
    count: 1,
    staggerPhase: 'stagger',
    critMode: 'expected',
  })
}

function updateFlow(entryId: string, patch: Partial<FlowEntry>) {
  const entry = getActiveSlot()?.flow.find((item) => item.id === entryId)
  if (!entry) return
  Object.assign(entry, patch)
}

function removeFlow(entryId: string) {
  const slot = getActiveSlot()
  if (!slot) return
  const index = slot.flow.findIndex((item) => item.id === entryId)
  if (index < 0) return
  slot.flow.splice(index, 1)
}

const FLOW_DRAG_IGNORE = 'button, input, label, select, textarea, a'

function isFlowDragIgnoreTarget(event: DragEvent) {
  const fromEvent = event.target instanceof Element ? event.target : null
  const atPoint = document.elementFromPoint(event.clientX, event.clientY)
  return Boolean(
    fromEvent?.closest(FLOW_DRAG_IGNORE) || atPoint?.closest(FLOW_DRAG_IGNORE),
  )
}

function nearestSeamIndex(clientY: number): number | null {
  const list = flowListEl.value
  if (!list) return null
  const cards = list.querySelectorAll<HTMLElement>('.sf-card')
  const n = cards.length
  if (!n) return 0
  const seamY = (i: number) => {
    if (i <= 0) return cards[0]!.getBoundingClientRect().top
    if (i >= n) return cards[n - 1]!.getBoundingClientRect().bottom
    const prev = cards[i - 1]!.getBoundingClientRect()
    const next = cards[i]!.getBoundingClientRect()
    return (prev.bottom + next.top) / 2
  }
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i <= n; i += 1) {
    const dist = Math.abs(clientY - seamY(i))
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}

function onFlowDragStart(entryId: string, event: DragEvent) {
  if (!flowDragEnabled.value || isFlowDragIgnoreTarget(event)) {
    event.preventDefault()
    return
  }
  event.dataTransfer?.setData('text/plain', entryId)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  flowDraggingId.value = entryId
}

function onFlowSortDragOver(event: DragEvent) {
  if (!flowDragEnabled.value || !flowDraggingId.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const index = nearestSeamIndex(event.clientY)
  if (index == null) return
  flowDropIndex.value = index
}

function onFlowSortDrop(event: DragEvent) {
  if (!flowDragEnabled.value || !flowDraggingId.value) return
  event.preventDefault()
  const index = nearestSeamIndex(event.clientY) ?? flowDropIndex.value
  if (index != null) reorderFlowToIndex(flowDraggingId.value, index)
  flowDraggingId.value = null
  flowDropIndex.value = null
}

function onFlowDragEnd() {
  flowDraggingId.value = null
  flowDropIndex.value = null
}

function reorderFlowToIndex(fromId: string, toIndex: number) {
  const slot = getActiveSlot()
  if (!slot) return
  const fromIndex = slot.flow.findIndex((item) => item.id === fromId)
  if (fromIndex < 0) return
  let dest = toIndex
  const [item] = slot.flow.splice(fromIndex, 1)
  if (fromIndex < dest) dest -= 1
  if (dest < 0) dest = 0
  if (dest > slot.flow.length) dest = slot.flow.length
  slot.flow.splice(dest, 0, item!)
}

function movePrepared(preparedId: string, delta: number) {
  const next = ensureSchemeSlots(slots.value)
  const slot = next[activeSlotIndex.value]!
  const index = slot.prepared.findIndex((item) => item.id === preparedId)
  const target = index + delta
  if (index < 0 || target < 0 || target >= slot.prepared.length) return
  const [item] = slot.prepared.splice(index, 1)
  slot.prepared.splice(target, 0, item!)
  slots.value = next
}

function flowSkipReason(entry: FlowEntry): string | null {
  const hit = props.hits?.find((item) => item.id === entry.id)
  if (!hit) {
    const prepared = currentSlot.value.prepared.find((item) => item.id === entry.preparedId)
    if (!prepared) return '准备阶段里找不到这条招式'
    if (!preparedSkill(prepared)) return '招式已从库中删除'
    return null
  }
  return getHitSkipReason(hit, { teamSlots: props.teamSlots, agents: props.agents })
}

function dualAgentHint(prepared: PreparedSkill, skill: Skill): string | null {
  if (!skillNeedsDualAgents(skill.damageType)) return null
  const teamIds = new Set(props.teamSlots.map((slot) => slot.agentId).filter(Boolean))
  if (!prepared.anomalyPowerAgentId || !prepared.triggerAgentId) {
    return '双代理人未选全，加入流程后不会出伤'
  }
  if (!teamIds.has(prepared.anomalyPowerAgentId) || !teamIds.has(prepared.triggerAgentId)) {
    return '选定的代理人已不在当前队伍'
  }
  if (skill.damageType === 'turbulence') {
    if (!isTurbulenceWindTrigger(props.agents, prepared.triggerAgentId)) {
      return '乱流仅当异常类触发者为风属性角色时才能生效'
    }
  }
  if (skill.damageType === 'radiance') {
    const trigger = props.agents.find((item) => item.id === prepared.triggerAgentId)
    if (!isLuminousAgent(trigger)) {
      return '耀变仅当异常类触发者为蕾米埃尔时才能生效'
    }
  }
  return null
}

/** 乱流/耀变触发者不合规时不展示倍率，改为提醒文案 */
function anomalyTriggerMultHint(
  skill: Skill,
  triggerAgentId: string | null | undefined,
): string | null {
  if (skill.damageType === 'turbulence') {
    if (!triggerAgentId || !isTurbulenceWindTrigger(props.agents, triggerAgentId)) {
      return '乱流仅当异常类触发者为风属性角色时才能生效'
    }
  }
  if (skill.damageType === 'radiance') {
    const trigger = triggerAgentId
      ? props.agents.find((item) => item.id === triggerAgentId)
      : null
    if (!isLuminousAgent(trigger)) {
      return '耀变仅当异常类触发者为蕾米埃尔时才能生效'
    }
  }
  return null
}

const customDraft = reactive({
  name: '',
  damageType: 'direct' as SkillDamageType,
  skillTypes: [] as SkillTypeId[],
  buffAnchorId: '' as string,
  baseMult: 0,
  settlementMult: 0,
})

const detailDraft = reactive({
  name: '',
  damageType: 'direct' as SkillDamageType,
  skillTypes: [] as SkillTypeId[],
  buffAnchorId: '' as string,
  baseMult: 0,
  settlementMult: 0,
})
const detailSaveHint = ref('')

watch(
  () => (detailSkill.value ? `${detail.value?.kind}:${detailSkill.value.id}` : ''),
  () => {
    const skill = detailSkill.value
    detailSaveHint.value = ''
    if (!skill) return
    detailDraft.name = skill.name
    detailDraft.damageType = skill.damageType
    detailDraft.skillTypes = [...skill.skillTypes]
    detailDraft.buffAnchorId = skill.buffAnchorId ?? ''
    detailDraft.baseMult = skill.baseMult
    detailDraft.settlementMult = skill.settlementMult ?? 0
  },
)

const anchorOptions = computed(() =>
  skillSubcategories.value.filter((item) => item.agentId === currentAgentId.value),
)

function saveCustomSkill() {
  const name = customDraft.name.trim()
  if (!name) return
  const anomaly = skillNeedsDualAgents(customDraft.damageType)
  const skill: Skill = {
    id: createCustomSkillId(),
    name,
    agentId: currentAgentId.value,
    source: 'custom',
    damageType: customDraft.damageType,
    skillTypes: anomaly ? [] : [...customDraft.skillTypes],
    buffAnchorId: customDraft.buffAnchorId || null,
    baseMult: Number(customDraft.baseMult) || 0,
    element: '',
    settlementMult:
      !anomaly && Number(customDraft.settlementMult)
        ? Number(customDraft.settlementMult)
        : undefined,
  }
  buffStore.upsertCustomSkillDoc(skill)
  addPrepared(skill)
  customDraft.name = ''
  customDraft.baseMult = 0
  customDraft.settlementMult = 0
  customDraft.skillTypes = []
  customDraft.buffAnchorId = ''
  showCustomForm.value = false
}

function syncPreparedAgentsForSkill(skillId: string, damageType: SkillDamageType) {
  const next = ensureSchemeSlots(slots.value)
  let changed = false
  next.forEach((slot, index) => {
    const ownerId = props.teamSlots[index]?.agentId
    if (!ownerId) return
    const defaults = defaultAnomalyAgents(damageType, ownerId)
    const needsDual = skillNeedsDualAgents(damageType)
    for (const item of slot.prepared) {
      if (item.skillId !== skillId) continue
      if (!needsDual) {
        if (item.anomalyPowerAgentId || item.triggerAgentId) {
          item.anomalyPowerAgentId = null
          item.triggerAgentId = null
          changed = true
        }
        continue
      }
      if (!item.anomalyPowerAgentId && !item.triggerAgentId) {
        item.anomalyPowerAgentId = defaults.anomalyPowerAgentId
        item.triggerAgentId = defaults.triggerAgentId
        changed = true
      }
    }
  })
  if (changed) slots.value = next
}

function saveDetailSkill() {
  const skill = detailSkill.value
  if (!skill || skill.source !== 'custom' || detail.value?.kind !== 'library') return
  const name = detailDraft.name.trim()
  if (!name) {
    detailSaveHint.value = '请填写名称'
    return
  }
  const nameTaken = currentSlot.value.prepared.some((item) => {
    if (item.skillId === skill.id) return false
    return preparedSkill(item)?.name.trim() === name
  })
  if (nameTaken) {
    detailSaveHint.value = '准备阶段已有同名招式'
    return
  }
  const anomaly = skillNeedsDualAgents(detailDraft.damageType)
  buffStore.upsertCustomSkillDoc({
    ...skill,
    name,
    damageType: detailDraft.damageType,
    skillTypes: anomaly ? [] : [...detailDraft.skillTypes],
    buffAnchorId: detailDraft.buffAnchorId || null,
    baseMult: Number(detailDraft.baseMult) || 0,
    settlementMult:
      !anomaly && Number(detailDraft.settlementMult)
        ? Number(detailDraft.settlementMult)
        : undefined,
  })
  syncPreparedAgentsForSkill(skill.id, detailDraft.damageType)
  detailSaveHint.value = '已保存'
}

function skillRefPlaces(skillId: string): { inCurrent: boolean; inSaved: boolean } {
  const inCurrent = slots.value.some((slot) =>
    slot.prepared.some((item) => item.skillId === skillId),
  )
  const inSaved = listAllDamageCalcHistory().some((entry) =>
    (entry.slots ?? []).some((slot) => slot.prepared.some((item) => item.skillId === skillId)),
  )
  return { inCurrent, inSaved }
}

function deleteCustomSkill(skill: Skill) {
  if (skill.source !== 'custom') return
  const { inCurrent, inSaved } = skillRefPlaces(skill.id)
  let message = `删除自定义招式「${skill.name}」？`
  if (inCurrent && inSaved) {
    message = `「${skill.name}」还在当前编辑的流程里，也有已保存的方案在用。删除后那些条目会显示招式已删除且不出伤。确定删除？`
  } else if (inCurrent) {
    message = `「${skill.name}」还在当前编辑的流程里。删除后那些条目会显示招式已删除且不出伤。确定删除？`
  } else if (inSaved) {
    message = `「${skill.name}」仍被已保存的方案使用。删除后那些条目会显示招式已删除且不出伤。确定删除？`
  }
  openConfirm(
    {
      title: '删除自定义招式',
      message,
      confirmText: '删除',
      danger: true,
    },
    () => {
      buffStore.removeCustomSkillDoc(skill.id)
    },
  )
}

function flowPrepared(entry: FlowEntry): PreparedSkill | null {
  return currentSlot.value.prepared.find((item) => item.id === entry.preparedId) ?? null
}

function flowSkill(entry: FlowEntry): Skill | null {
  const prepared = flowPrepared(entry)
  return prepared ? preparedSkill(prepared) : null
}

function flowSkillName(entry: FlowEntry): string {
  return flowSkill(entry)?.name ?? (flowPrepared(entry) ? '招式已删除' : '未知招式')
}

type ExtraModKey = 'baseMult' | 'settlementMult' | 'dmgBonus' | 'critRate' | 'critDmg'

function extraNumber(prepared: PreparedSkill, key: ExtraModKey) {
  const value = prepared.extraMods?.[key]
  return value == null ? '' : String(value)
}

function setExtraNumber(prepared: PreparedSkill, key: ExtraModKey, raw: string) {
  const nextMods = { ...(prepared.extraMods ?? {}) }
  if (raw.trim() === '') delete nextMods[key]
  else nextMods[key] = Number(raw)
  updatePrepared(prepared.id, {
    extraMods: Object.keys(nextMods).length ? nextMods : null,
  })
}

watch(expanded, (open) => {
  if (!open) {
    detail.value = null
    showCustomForm.value = false
  }
})

function compactPreparedDuplicates() {
  const next = ensureSchemeSlots(slots.value, Math.max(3, props.teamSlots.length))
  let changed = false
  for (const slot of next) {
    const keepBySkill = new Map<string, string>()
    const remap = new Map<string, string>()
    const kept: PreparedSkill[] = []
    for (const item of slot.prepared) {
      const keepId = keepBySkill.get(item.skillId)
      if (keepId) {
        remap.set(item.id, keepId)
        changed = true
        continue
      }
      keepBySkill.set(item.skillId, item.id)
      kept.push(item)
    }
    if (kept.length === slot.prepared.length) continue
    slot.prepared = kept
    slot.flow = slot.flow.map((entry) => {
      const mapped = remap.get(entry.preparedId)
      return mapped ? { ...entry, preparedId: mapped } : entry
    })
  }
  if (changed) {
    slots.value = next
    if (detail.value?.kind === 'prepared' && remapMissingPrepared(detail.value.preparedId, next)) {
      detail.value = null
    }
  }
}

function remapMissingPrepared(preparedId: string, nextSlots: SchemeSlot[]) {
  return nextSlots.every((slot) => !slot.prepared.some((item) => item.id === preparedId))
}

watch(
  () => slots.value.map((slot) => slot.prepared.map((item) => item.skillId).join(',')).join('|'),
  compactPreparedDuplicates,
  { immediate: true },
)

function expand() {
  expanded.value = true
}

function onModalKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (showCustomForm.value) {
    closeCustomForm()
    return
  }
  if (detail.value) closeDetail()
}

onMounted(() => window.addEventListener('keydown', onModalKeydown))
onUnmounted(() => window.removeEventListener('keydown', onModalKeydown))

defineExpose({ expand })
</script>

<template>
  <section id="skill-flow" class="calc-mode-section damage-anchor">
    <header class="calc-mode-header">
      <h2>招式流程</h2>
      <p class="calc-mode-desc">
        从招式库加入当前角色的准备招式，再排进流程。异常类必须选定双代理人才能出伤；换掉队伍角色后不会自动改成新人。
      </p>
    </header>

    <div class="sf-agent-tabs" role="tablist" aria-label="角色流程">
      <button
        v-for="(slot, index) in teamSlots"
        :key="index"
        type="button"
        class="sf-agent-tab"
        :class="{ active: activeSlotIndex === index }"
        @click="activeSlotIndex = index"
      >
        {{ slotLabel(slot, index) }}
      </button>
    </div>

    <div class="flow-summary">
      <span class="flow-summary-counts">
        {{ currentTeamSlotLabel }} · 已准备 {{ currentSlot.prepared.length }} 条 · 流程 {{ currentSlot.flow.length }} 项
      </span>
      <button type="button" class="primary-btn" @click="expanded = !expanded">
        {{ expanded ? '收起' : '展开' }}
      </button>
    </div>

    <div v-show="expanded" class="skill-flow-modal skill-flow-editor">
        <div class="modal-tabs" role="tablist" aria-label="阶段">
          <button
            type="button"
            role="tab"
            class="modal-tab"
            :class="{ active: modalTab === 'prep' }"
            @click="modalTab = 'prep'"
          >
            准备阶段
          </button>
          <button
            type="button"
            role="tab"
            class="modal-tab"
            :class="{ active: modalTab === 'flow' }"
            @click="modalTab = 'flow'"
          >
            流程
          </button>
        </div>

        <div class="modal-body">
          <p v-if="!currentAgentId" class="empty-hint modal-empty">请先在编队里选择角色。</p>

          <div v-else class="flow-grid" :class="`tab-${modalTab}`">
            <div v-if="modalTab === 'prep'" class="flow-col">
              <div class="col-head">
                <h3>招式库</h3>
                <input v-model="libraryQuery" class="search-input" placeholder="搜索招式名" />
                <div class="filter-row">
                  <div class="chip-group" role="group" aria-label="伤害大类">
                    <button
                      type="button"
                      class="chip"
                      :class="{ active: libraryKindDirect }"
                      @click="libraryKindDirect = !libraryKindDirect"
                    >
                      直伤类
                    </button>
                    <button
                      type="button"
                      class="chip"
                      :class="{ active: libraryKindAnomaly }"
                      @click="libraryKindAnomaly = !libraryKindAnomaly"
                    >
                      异常类
                    </button>
                  </div>
                  <div class="chip-group" role="group" aria-label="招式来源">
                    <button
                      type="button"
                      class="chip"
                      :class="{ active: librarySourceCustom }"
                      @click="librarySourceCustom = !librarySourceCustom"
                    >
                      自建
                    </button>
                    <button
                      type="button"
                      class="chip"
                      :class="{ active: librarySourcePreset }"
                      @click="librarySourcePreset = !librarySourcePreset"
                    >
                      预设
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  class="mini-btn"
                  :disabled="!unpreparedFilteredCount"
                  @click="addFilteredToPrepared"
                >
                  将筛选结果全部加入准备（{{ unpreparedFilteredCount }}）
                </button>
              </div>
              <ul class="sf-list">
                <SkillFlowCard
                  v-for="skill in librarySkills"
                  :key="skill.id"
                  :name="skill.name"
                  :mult="libraryMultText(skill)"
                  :warn="libraryMultWarn(skill)"
                  :dtype="damageTypeLabel(skill.damageType)"
                  :dtype-kind="dtypeKind(skill.damageType)"
                  :stypes="skillStypeLabels(skill)"
                >
                  <template #actions>
                    <button
                      type="button"
                      class="mini-btn"
                      @click.stop="openLibraryDetail(skill.id)"
                    >
                      详情
                    </button>
                    <button
                      type="button"
                      class="mini-btn add-prepared-btn"
                      :disabled="Boolean(preparedBlockReason(skill))"
                      @click.stop="addPrepared(skill)"
                    >
                      {{
                        preparedBlockReason(skill) === 'name'
                          ? '已有同名'
                          : preparedBlockReason(skill)
                            ? '已加'
                            : '加入'
                      }}
                    </button>
                    <button
                      v-if="skill.source === 'custom'"
                      type="button"
                      class="mini-btn danger"
                      @click.stop="deleteCustomSkill(skill)"
                    >
                      删除
                    </button>
                  </template>
                </SkillFlowCard>
                <li v-if="!librarySkills.length" class="list-empty">
                  {{ libraryEmptyText }}
                </li>
              </ul>
              <div class="col-foot">
                <button type="button" class="mini-btn" @click="openCustomForm">新建招式</button>
              </div>
            </div>

            <div class="flow-col">
              <div class="col-head">
                <h3>{{ modalTab === 'prep' ? '准备招式' : '准备招式（加入流程）' }}</h3>
                <button
                  v-if="modalTab === 'prep'"
                  type="button"
                  class="mini-btn danger"
                  :disabled="!currentSlot.prepared.length"
                  @click="clearPrepared"
                >
                  清空全部
                </button>
                <p class="col-desc">
                  {{
                    modalTab === 'prep'
                      ? '每种招式只准备一条。异常类在详情里选双代理人；名称和倍率请回招式库改。伤害为单次结算（不含失衡易伤）。'
                      : '同一准备招式可以多次加入流程。双代理人请在准备阶段的详情里选。'
                  }}
                </p>
              </div>
              <ul class="sf-list">
                <template v-for="(prepared, preparedIndex) in currentSlot.prepared" :key="prepared.id">
                  <SkillFlowCard
                    v-if="preparedSkill(prepared)"
                    :name="preparedSkill(prepared)!.name"
                    :mult="
                      cardTriggerWarn(preparedSkill(prepared)!, prepared.id)
                        ? '—'
                        : skillMultText(preparedSkill(prepared)!, prepared.id)
                    "
                    :warn="cardTriggerWarn(preparedSkill(prepared)!, prepared.id)"
                    :dtype="damageTypeLabel(preparedSkill(prepared)!.damageType)"
                    :dtype-kind="dtypeKind(preparedSkill(prepared)!.damageType)"
                    :stypes="skillStypeLabels(preparedSkill(prepared)!)"
                    :agent-pair="agentPairText(prepared, preparedSkill(prepared)!)"
                    :agent-title="agentPairTitle(prepared, preparedSkill(prepared)!)"
                    :skip="Boolean(dualAgentHint(prepared, preparedSkill(prepared)!))"
                    :damage="formatDamage(hitDamages?.[prepared.id])"
                    @select-agents="openPreparedDetail(prepared.id)"
                  >
                    <template #actions>
                      <button
                        type="button"
                        class="mini-btn"
                        @click="openPreparedDetail(prepared.id)"
                      >
                        详情
                      </button>
                      <template v-if="modalTab === 'prep'">
                        <button
                          type="button"
                          class="order-btn"
                          title="上移"
                          :disabled="preparedIndex === 0"
                          @click="movePrepared(prepared.id, -1)"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          class="order-btn"
                          title="下移"
                          :disabled="preparedIndex === currentSlot.prepared.length - 1"
                          @click="movePrepared(prepared.id, 1)"
                        >
                          ▼
                        </button>
                        <button type="button" class="mini-btn danger" @click="removePrepared(prepared.id)">
                          移除
                        </button>
                      </template>
                      <button v-else type="button" class="mini-btn" @click="addToFlow(prepared)">
                        {{ flowPreparedIds.has(prepared.id) ? '再加一条' : '加入流程' }}
                      </button>
                    </template>
                  </SkillFlowCard>
                  <SkillFlowCard v-else name="招式已删除" skip>
                    <template #actions>
                      <button type="button" class="mini-btn danger" @click="removePrepared(prepared.id)">
                        移除
                      </button>
                    </template>
                  </SkillFlowCard>
                </template>
                <li v-if="!currentSlot.prepared.length" class="list-empty">
                  {{
                    modalTab === 'prep'
                      ? '还没有准备招式。'
                      : '先在准备阶段加入招式，才能排进流程。'
                  }}
                </li>
              </ul>
            </div>

            <div v-if="modalTab === 'flow'" class="flow-col">
              <div class="col-head">
                <div class="col-title-row">
                  <h3>流程</h3>
                  <label class="drag-toggle">
                    <input v-model="flowDragEnabled" type="checkbox" />
                    拖动排序
                  </label>
                </div>
                <p class="col-desc">
                  {{
                    flowDragEnabled
                      ? '打开拖动后，按住招式行可改顺序。详情、次数和失衡仍是点击。'
                      : '只改次数和是否失衡。需要换顺序时打开「拖动排序」。'
                  }}
                </p>
              </div>
              <ul
                ref="flowListEl"
                class="sf-list sf-list--flow"
                @dragover="onFlowSortDragOver"
                @drop="onFlowSortDrop"
              >
                <template v-for="(entry, index) in currentSlot.flow" :key="entry.id">
                  <li
                    class="sf-insert-slot"
                    :class="{ 'is-active': flowInsertIndex === index }"
                    aria-hidden="true"
                  />
                  <SkillFlowCard
                    :index="index + 1"
                    :name="flowSkillName(entry)"
                    :mult="
                      flowSkill(entry)
                        ? cardTriggerWarn(flowSkill(entry)!, entry.id)
                          ? '—'
                          : skillMultText(flowSkill(entry)!, entry.id)
                        : ''
                    "
                    :warn="
                      flowSkill(entry) ? cardTriggerWarn(flowSkill(entry)!, entry.id) : null
                    "
                    :count="entry.count"
                    :stagger="entry.staggerPhase === 'stagger'"
                    :dtype="flowSkill(entry) ? damageTypeLabel(flowSkill(entry)!.damageType) : ''"
                    :dtype-kind="flowSkill(entry) ? dtypeKind(flowSkill(entry)!.damageType) : 'direct'"
                    :stypes="flowSkill(entry) ? skillStypeLabels(flowSkill(entry)!) : []"
                    :agent-pair="
                      flowSkill(entry) && flowPrepared(entry)
                        ? agentPairText(flowPrepared(entry)!, flowSkill(entry)!)
                        : ''
                    "
                    :agent-title="
                      flowSkill(entry) && flowPrepared(entry)
                        ? agentPairTitle(flowPrepared(entry)!, flowSkill(entry)!)
                        : ''
                    "
                    :agents-clickable="false"
                    :row-draggable="flowDragEnabled"
                    :dragging="flowDraggingId === entry.id"
                    :damage="damageForFlow(entry.id)"
                    :skip="Boolean(flowSkipReason(entry))"
                    @update:count="updateFlow(entry.id, { count: $event })"
                    @update:stagger="
                      updateFlow(entry.id, { staggerPhase: $event ? 'stagger' : 'normal' })
                    "
                    @dragstart="onFlowDragStart(entry.id, $event)"
                    @dragend="onFlowDragEnd"
                  >
                    <template #actions>
                      <button
                        type="button"
                        class="mini-btn"
                        draggable="false"
                        @click="openFlowDetail(entry.id)"
                      >
                        详情
                      </button>
                      <button
                        type="button"
                        class="mini-btn danger"
                        draggable="false"
                        @click="removeFlow(entry.id)"
                      >
                        移除
                      </button>
                    </template>
                  </SkillFlowCard>
                </template>
                <li
                  v-if="currentSlot.flow.length"
                  class="sf-insert-slot"
                  :class="{ 'is-active': flowInsertIndex === currentSlot.flow.length }"
                  aria-hidden="true"
                />
                <li v-if="!currentSlot.flow.length" class="list-empty">
                  还没有流程条目。从左侧把准备招式加进来。
                </li>
              </ul>
            </div>
          </div>
          <SkillFlowStatsPanel
            :team-slots="teamSlots"
            :agents="agents"
            :slots="slots"
            :hits="hits"
            :hit-damages="hitDamages"
            :active-slot-index="activeSlotIndex"
            :scheme-name="schemeName"
          />
        </div>
    </div>

    <Teleport to="body">
        <div v-if="detail" class="skill-detail-overlay" @click.self="closeDetail">
          <div class="skill-detail-panel" role="dialog" aria-modal="true" :aria-label="detailTitle">
            <header class="skill-detail-head">
              <h3>招式详情 · {{ detailTitle }}</h3>
              <button type="button" class="close-btn" aria-label="关闭详情" @click="closeDetail">×</button>
            </header>
            <div v-if="detailSkill" class="skill-detail-body">
              <p v-if="detailSkipReason" class="warn-hint">{{ detailSkipReason }}</p>
              <template v-if="detailPrepared && skillNeedsDualAgents(detailSkill.damageType)">
                <p class="detail-section-title">双代理人</p>
                <div class="agent-row">
                  <label>
                    <span>异常强度提供者</span>
                    <select
                      v-if="detailCanEditAgents"
                      :value="detailPrepared.anomalyPowerAgentId ?? ''"
                      @change="
                        setDetailAgent(
                          'anomalyPowerAgentId',
                          ($event.target as HTMLSelectElement).value,
                        )
                      "
                    >
                      <option value="">未选</option>
                      <option v-for="agent in teamAgentOptions" :key="agent.id" :value="agent.id">
                        {{ agent.name }}
                      </option>
                    </select>
                    <input
                      v-else
                      :value="agentFullName(detailPrepared.anomalyPowerAgentId) || '未选'"
                      type="text"
                      readonly
                      tabindex="-1"
                    />
                  </label>
                  <label>
                    <span>异常类触发者</span>
                    <select
                      v-if="detailCanEditAgents"
                      :value="detailPrepared.triggerAgentId ?? ''"
                      @change="
                        setDetailAgent(
                          'triggerAgentId',
                          ($event.target as HTMLSelectElement).value,
                        )
                      "
                    >
                      <option value="">未选</option>
                      <option v-for="agent in teamAgentOptions" :key="agent.id" :value="agent.id">
                        {{ agent.name }}
                      </option>
                    </select>
                    <input
                      v-else
                      :value="agentFullName(detailPrepared.triggerAgentId) || '未选'"
                      type="text"
                      readonly
                      tabindex="-1"
                    />
                  </label>
                </div>
                <p v-if="dualAgentHint(detailPrepared, detailSkill)" class="warn-hint">
                  {{ dualAgentHint(detailPrepared, detailSkill) }}
                </p>
              </template>
              <p v-else-if="detail.kind === 'library' && skillNeedsDualAgents(detailSkill.damageType)" class="empty-hint">
                加入准备后，异常类可在详情里选双代理人。
              </p>
              <p v-if="detail.kind === 'prepared'" class="empty-hint">
                {{
                  skillNeedsDualAgents(detailSkill.damageType)
                    ? '名称、倍率、类型请到招式库里改。这里只能改双代理人。'
                    : '名称、倍率、类型请到招式库里改。准备阶段不能改招式定义。'
                }}
              </p>
              <p v-else-if="detail.kind === 'flow'" class="empty-hint">
                次数和失衡在流程行上改。招式定义请回招式库，双代理人请回准备阶段。
              </p>

              <p class="detail-section-title">招式设置</p>
              <p v-if="detailSkill.source === 'preset'" class="empty-hint">预设招式只读，不能改定义。</p>
              <p v-else-if="!detailCanEditDefinition" class="empty-hint">自定义招式的定义只在招式库可改。</p>
              <SkillDefinitionForm
                v-model="detailDraft"
                :readonly="!detailCanEditDefinition"
                :anchors="anchorOptions"
                :agent="currentAgent"
                :resolved-mult-display="detailResolvedMultDisplay"
              />

              <p class="detail-section-title">计算过程</p>
              <div v-if="detailZoneRows.length" class="zone-display-grid">
                <div v-for="row in detailZoneRows" :key="row.label" class="zone-display-item">
                  <span class="zone-display-label">{{ row.label }}</span>
                  <span class="zone-display-val">{{ row.value }}</span>
                </div>
              </div>
              <p v-else class="empty-hint">
                还没有结算结果。直伤在库里就能预览；异常类要先加入准备并选双代理人。
              </p>
            </div>
            <div v-if="detailSkill && detailCanEditDefinition" class="skill-detail-foot">
              <button type="button" class="primary-btn save-action" @click="saveDetailSkill">
                保存招式
              </button>
              <p v-if="detailSaveHint" class="empty-hint">{{ detailSaveHint }}</p>
            </div>
            <p v-else-if="!detailSkill" class="empty-hint skill-detail-missing">招式已从库中删除。</p>
          </div>
        </div>
        </Teleport>

        <Teleport to="body">
        <div v-if="showCustomForm" class="skill-detail-overlay" @click.self="closeCustomForm">
          <div class="skill-detail-panel" role="dialog" aria-modal="true" aria-label="新建招式">
            <header class="skill-detail-head">
              <h3>新建招式</h3>
              <button type="button" class="close-btn" aria-label="关闭" @click="closeCustomForm">×</button>
            </header>
            <div class="skill-detail-body">
              <SkillDefinitionForm
                v-model="customDraft"
                :anchors="anchorOptions"
                :agent="currentAgent"
              />
            </div>
            <div class="skill-detail-foot">
              <button type="button" class="primary-btn save-action" @click="saveCustomSkill">
                保存并加入准备
              </button>
            </div>
          </div>
        </div>
        </Teleport>

        <Teleport to="body">
          <div
            v-if="pendingConfirm"
            class="scheme-confirm-overlay"
            @click.self="closeConfirm"
          >
            <div class="scheme-confirm" :class="{ danger: pendingConfirm.danger }">
              <div class="scheme-confirm-title">{{ pendingConfirm.title }}</div>
              <p class="scheme-confirm-msg">{{ pendingConfirm.message }}</p>
              <div class="scheme-confirm-btns">
                <button type="button" class="scheme-confirm-cancel" @click="closeConfirm">
                  {{ pendingConfirm.cancelText || '取消' }}
                </button>
                <button
                  type="button"
                  class="scheme-confirm-ok"
                  :class="{ danger: pendingConfirm.danger }"
                  @click="runConfirm"
                >
                  {{ pendingConfirm.confirmText || '确认' }}
                </button>
              </div>
            </div>
          </div>
        </Teleport>
  </section>
</template>

<style scoped>
.sf-agent-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}
.sf-agent-tab {
  appearance: none;
  -webkit-appearance: none;
  box-shadow: none;
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #d5dae4;
  padding: 0.35rem 0.85rem;
  font: inherit;
  font-size: 0.84rem;
  line-height: 1.3;
  cursor: pointer;
}
.sf-agent-tab.active {
  border-color: #c9a55c;
  background: #0f1217;
  color: #e8edf5;
  font-weight: 600;
}
.sf-agent-tab:hover {
  border-color: #4a5160;
}

.flow-summary {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  flex-wrap: wrap;
  margin-top: 0.6rem;
}
.flow-summary-counts {
  color: #9aa3b0;
  font-size: 0.85rem;
}
.primary-btn {
  margin-left: auto;
  border: 1px solid #c9a55c;
  background: linear-gradient(180deg, #d8b56a, #b88d3a);
  color: #1a1407;
  font-weight: 600;
  padding: 0.4rem 0.95rem;
  border-radius: 8px;
  cursor: pointer;
}
.primary-btn:hover {
  filter: brightness(1.05);
}

.skill-flow-editor {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: auto;
  margin-top: 0.75rem;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  container-type: inline-size;
  container-name: skill-flow;
  background: #14181f;
  border: 1px solid #2a3038;
  border-radius: 14px;
}

.skill-flow-modal-header,
.modal-agent-row,
.modal-tabs {
  flex: 0 0 auto;
}

.skill-flow-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.7rem 1rem;
  border-bottom: 1px solid #2a3038;
  background: #181d27;
}
.skill-flow-modal-header h2 {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 1.05rem;
  color: #e8edf5;
}
.close-btn {
  flex: 0 0 auto;
  width: 2rem;
  height: 2rem;
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #d5dae4;
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
}
.close-btn:hover {
  border-color: #c9a55c;
  color: #e8edf5;
}

.modal-agent-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  padding: 0.65rem 1rem 0.4rem;
  background: #14181f;
}
.modal-agent-tab {
  border: 1px solid #2d323a;
  border-radius: 999px;
  background: #0f1217;
  color: #d5dae4;
  padding: 0.35rem 0.95rem;
  font-size: 0.84rem;
  cursor: pointer;
}
.modal-agent-tab.active {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.14);
  color: #f0d7a2;
  font-weight: 600;
}

.modal-tabs {
  display: flex;
  gap: 0;
  padding: 0 1rem;
  border-bottom: 1px solid #2a3038;
  background: #14181f;
}
.modal-tab {
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: #9aa3b0;
  padding: 0.6rem 1.1rem;
  font-size: 0.92rem;
  cursor: pointer;
  margin-bottom: -1px;
}
.modal-tab:hover {
  color: #dce4f0;
}
.modal-tab.active {
  border-bottom-color: #c9a55c;
  color: #f0d7a2;
}

.modal-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 0.75rem 1rem 1rem;
}
.modal-empty {
  margin: auto;
  text-align: center;
}

.flow-grid {
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto;
  column-gap: 0.85rem;
  align-items: stretch;
}
.flow-col {
  min-width: 0;
  max-width: 100%;
  overflow-x: clip;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: subgrid;
  grid-row: 1 / span 3;
}
@supports not (grid-template-rows: subgrid) {
  .flow-col {
    display: flex;
    flex-direction: column;
    grid-template-columns: none;
    grid-row: auto;
  }
  .col-head {
    min-height: 9.2rem;
  }
}
.col-head,
.col-foot {
  min-width: 0;
}
.col-head {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  align-items: stretch;
  justify-content: flex-start;
  margin: 0;
  padding-bottom: 0.45rem;
  border-bottom: 1px solid #2a3038;
}
.col-head h3 {
  margin: 0;
  font-size: 0.92rem;
  color: #e8edf5;
  line-height: 1.6rem;
}
.col-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.drag-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.76rem;
  color: #9aa3b0;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.drag-toggle input {
  margin: 0;
  accent-color: #c9a55c;
}
.col-desc,
.empty-hint,
.list-empty {
  margin: 0;
  color: #9aa3b0;
  font-size: 0.78rem;
}
.col-desc {
  min-height: 2.4rem;
  line-height: 1.2rem;
}
.search-input,
.custom-form input,
.custom-form select,
.agent-row select,
.agent-row input {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #e8edf5;
  padding: 0.3rem 0.45rem;
}
.search-input {
  box-sizing: border-box;
  width: 100%;
  height: 2rem;
  margin: 0;
}
.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem 0.7rem;
  margin: 0;
  min-height: 2rem;
}
.chip-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.chip-group + .chip-group {
  padding-left: 0.65rem;
  border-left: 1px solid #343a44;
}
.col-head > .mini-btn {
  width: 100%;
  height: 2rem;
  margin: 0;
}

.sf-list {
  list-style: none;
  margin: 0.45rem 0 0;
  padding: 0 0.2rem 0 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.sf-list--flow {
  gap: 0;
}
.sf-insert-slot {
  position: relative;
  flex: 0 0 auto;
  height: 0.45rem;
  list-style: none;
}
.sf-insert-slot:first-child,
.sf-insert-slot:last-child {
  height: 0;
}
.sf-insert-slot.is-active::after {
  content: '';
  position: absolute;
  left: 0.12rem;
  right: 0.12rem;
  top: 50%;
  height: 2px;
  background: #c9a55c;
  border-radius: 1px;
  transform: translateY(-50%);
  box-shadow: 0 0 5px rgba(201, 165, 92, 0.85);
  pointer-events: none;
}
.list-empty {
  padding: 0.85rem 0.4rem;
}

.col-foot {
  margin-top: 0.5rem;
}
.custom-form {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.custom-form label,
.type-checks {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.76rem;
  color: #9aa3b0;
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.chip {
  border: 1px solid #343a44;
  border-radius: 999px;
  background: #12161d;
  color: #d5dae4;
  padding: 0.22rem 0.6rem;
  font-size: 0.74rem;
  cursor: pointer;
}
.chip.active {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.14);
  color: #f0d7a2;
}
.chip.highlight {
  border-color: #4a90d9 !important;
  border-style: dashed !important;
}

.mini-btn {
  border: 1px solid #3a4150;
  border-radius: 8px;
  background: #1a2030;
  color: #dce4f0;
  padding: 0.2rem 0.55rem;
  cursor: pointer;
  font-size: 0.78rem;
  white-space: nowrap;
}
.mini-btn.danger {
  border-color: #6b3a3a;
  color: #f0c0c0;
}
.mini-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.order-btn {
  width: 1.6rem;
  height: 1.25rem;
  line-height: 1;
  border: 1px solid #3a4a31;
  border-radius: 5px;
  background: #161a20;
  color: #d8e8c8;
  font-size: 0.7rem;
  cursor: pointer;
  text-align: center;
  padding: 0;
}
.order-btn:hover:not(:disabled) {
  border-color: #c9a55c;
}
.order-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.agent-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.45rem;
}
.agent-row label {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  min-width: 0;
  font-size: 0.7rem;
  color: #9aa3b0;
}
.agent-row select,
.agent-row input {
  min-width: 0;
  width: 100%;
}
.agent-row input[readonly] {
  cursor: default;
}

.warn-hint {
  margin: 0;
  color: #c07a7a;
  font-size: 0.76rem;
}

.skill-detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(7, 10, 16, 0.55);
}
.skill-detail-panel {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: min(920px, calc(100vw - 2.5rem));
  min-height: min(70vh, 640px);
  max-height: min(90vh, 920px);
  overflow: hidden;
  background: #181d27;
  border: 1px solid #2a3038;
  border-radius: 12px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
}
.skill-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex: 0 0 auto;
  padding: 0.75rem 1.1rem;
  border-bottom: 1px solid #2a3038;
}
.skill-detail-head h3 {
  margin: 0;
  font-size: 0.95rem;
  color: #e8edf5;
}
.skill-detail-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.7rem;
  min-height: 0;
  padding: 0.95rem 1.1rem 1.15rem;
  overflow: auto;
  overscroll-behavior: contain;
}
.skill-detail-foot {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.75rem 1.1rem 1rem;
  border-top: 1px solid #2a3038;
  background: #14181f;
}
.skill-detail-foot .save-action {
  width: 100%;
  margin: 0;
  padding: 0.62rem 1rem;
  font-size: 0.92rem;
}
.skill-detail-foot .empty-hint {
  text-align: center;
}
.skill-detail-missing {
  flex: 1 1 auto;
  padding: 0.95rem 1.1rem 1.15rem;
}
.detail-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.detail-facts .sf-dtype,
.detail-facts .sf-stype,
.sf-dtype,
.sf-stype {
  display: inline-flex;
  align-items: center;
  padding: 0.08rem 0.42rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  white-space: nowrap;
}
.sf-dtype.is-anomaly {
  background: #1a2a38;
  border: 1px solid #3a6a88;
  color: #8ec8e8;
}
.sf-dtype.is-direct {
  background: rgba(201, 165, 92, 0.14);
  border: 1px solid #8a6a1f;
  color: #f0d7a2;
}
.sf-stype {
  background: #15241f;
  border: 1px solid #2f5c52;
  color: #8fd4c4;
}
.detail-mult,
.detail-section-title {
  margin: 0;
  font-size: 0.82rem;
  color: #dce4f0;
}
.detail-section-title {
  font-weight: 700;
}
.zone-display-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
  gap: 0.4rem;
}
.zone-display-item {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid #2a3038;
  border-radius: 8px;
  background: #12161d;
}
.zone-display-label {
  font-size: 0.7rem;
  color: #9aa3b0;
}
.zone-display-val {
  font-size: 0.86rem;
  font-weight: 700;
  color: #e8edf5;
  font-variant-numeric: tabular-nums;
}

/* 按展开区实际宽度叠列，不要只看窗口：侧栏会让内容区比 viewport 窄一截 */
@container skill-flow (max-width: 48rem) {
  .flow-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 800px) {
  .flow-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
