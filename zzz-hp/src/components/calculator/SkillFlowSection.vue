<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc, Skill, SkillDamageType, SkillGroup, SkillTypeId } from '@/types/calculator'
import type {
  FlowEntry,
  FlowGroupMemberOverride,
  PreparedSkill,
  SchemeSlot,
} from '@/types/damageCalcHistory'
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
  buildDefaultMemberAgents,
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
  clearSkillNoteOverride,
  hasSkillNoteOverride,
  resolveSkillNote,
  setSkillNoteOverride,
} from '@/utils/skillNoteOverrides'
import {
  createCustomSkillGroupId,
  findMemberAgents,
  findMemberOverride,
  isCustomSkillGroup,
  skillGroupMemberKey,
  sortSkillGroupMembers,
  sumHitDamagesForEntry,
} from '@/utils/skillGroup'
import {
  resolveInherentSkillMultPercent,
  skillMultNeedsAnomalyPowerProvider,
  unsetSkillMult,
} from '@/utils/skillSubcategoryMult'
import { skillTypeLabelsForDisplay } from '@/utils/skillTypes'
import {
  resolveEffectiveBaseMult,
  type SkillTalentLevels,
} from '@/utils/skillTalentLevels'

import { teamSlotDisplayLabel } from '@/utils/teamSlotLabel'

const props = defineProps<{
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  hits?: ResolvedHit[]
  hitDamages?: Record<string, number>
  hitCalcResults?: Record<string, DamageCalcResult>
  /** 每人五大类技能等级；展示 nanoka 有效倍率用 */
  skillTalentLevelsByAgent?: Record<string, SkillTalentLevels | Partial<SkillTalentLevels>>
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

type LibrarySkillCategoryFilter =
  | 'all'
  | 'basic'
  | 'dodge'
  | 'assist'
  | 'special'
  | 'chainUltimate'
  | 'other'

const LIBRARY_SKILL_CATEGORY_FILTERS: { id: LibrarySkillCategoryFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'basic', label: '普通攻击' },
  { id: 'dodge', label: '闪避' },
  { id: 'assist', label: '支援攻击' },
  { id: 'special', label: '特殊技' },
  { id: 'chainUltimate', label: '连携技与终结技' },
  { id: 'other', label: '其他' },
]

const LIBRARY_CATEGORY_TYPE_SETS: Record<
  Exclude<LibrarySkillCategoryFilter, 'all' | 'other'>,
  SkillTypeId[]
> = {
  basic: ['basic'],
  dodge: ['dodge', 'dash', 'dodgeCounter'],
  assist: ['assist'],
  special: ['special', 'specialBasic', 'specialEnhanced'],
  chainUltimate: ['chain', 'ultimate'],
}

const librarySkillCategory = ref<LibrarySkillCategoryFilter>('all')

function skillMatchesLibraryCategory(skill: Skill, category: LibrarySkillCategoryFilter): boolean {
  if (category === 'all') return true
  const types = skill.skillTypes ?? []
  if (category === 'other') {
    const covered = new Set(
      (Object.values(LIBRARY_CATEGORY_TYPE_SETS) as SkillTypeId[][]).flat(),
    )
    return !types.some((type) => covered.has(type))
  }
  const allowed = LIBRARY_CATEGORY_TYPE_SETS[category]
  return types.some((type) => allowed.includes(type))
}
const showCustomForm = ref(false)
const expanded = ref(true)
const modalTab = ref<'prep' | 'flow'>('prep')
const flowDragEnabled = ref(false)
const flowDraggingId = ref<string | null>(null)
/** n 条招式对应 n+1 条插入缝，拖放只认缝不认行的上/下沿。 */
const flowDropIndex = ref<number | null>(null)
const flowListEl = ref<HTMLUListElement | null>(null)
/** 准备列拖动排序（对齐流程） */
const prepDragEnabled = ref(false)
const prepDraggingId = ref<string | null>(null)
const prepDropIndex = ref<number | null>(null)
const prepListEl = ref<HTMLUListElement | null>(null)
const detail = ref<
  | { kind: 'library'; skillId: string }
  | { kind: 'libraryGroup'; groupId: string }
  | { kind: 'prepared'; preparedId: string }
  | { kind: 'preparedMember'; preparedId: string; memberKey: string; skillId: string }
  | { kind: 'flow'; entryId: string }
  | {
      kind: 'flowMember'
      entryId: string
      memberIndex: number
      skillId: string
      memberKey: string
    }
  | null
>(null)
/** 从组详情钻进招式时压栈，关闭招式回到组 */
const detailReturnStack = ref<NonNullable<typeof detail.value>[]>([])

const flowGroupTuneId = ref<string | null>(null)
/** 组内新建：绑定到当前编辑中的技能组 id */
const customFormOwnerGroupId = ref<string | null>(null)
const showCustomGroupForm = ref(false)
const customGroupName = ref('')
const customGroupHint = ref('')
const customSaveHint = ref('')
/** 组详情里添加已有招式 */
const groupAddSkillId = ref('')
const calcMemberLibraryQuery = ref('')
const calcGroupMemberIds = computed(
  () => new Set((detailGroup.value?.members ?? []).map((item) => item.skillId)),
)

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

watch(prepDragEnabled, (on) => {
  if (on) return
  prepDraggingId.value = null
  prepDropIndex.value = null
})

watch(modalTab, () => {
  prepDragEnabled.value = false
  prepDraggingId.value = null
  prepDropIndex.value = null
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

/** 旧数据未选双代理人时，回填为当前角色（普通招式 + 技能组内异常段） */
function hydratePreparedAnomalyAgents() {
  const next = ensureSchemeSlots(slots.value, Math.max(3, props.teamSlots.length))
  let changed = false
  next.forEach((slot, index) => {
    const ownerId = props.teamSlots[index]?.agentId
    if (!ownerId) return
    for (const item of slot.prepared) {
      const groupId = item.skillGroupId?.trim()
      if (groupId) {
        const group = buffStore.findSkillGroup(groupId)
        if (!group) continue
        const list = [...(item.memberAgents ?? [])]
        let memberChanged = false
        for (const member of sortSkillGroupMembers(group.members)) {
          const skill = buffStore.findSkill(member.skillId)
          if (!skill || !skillNeedsDualAgents(skill.damageType)) continue
          const key = skillGroupMemberKey(member)
          const defaults = defaultAnomalyAgents(skill.damageType, ownerId)
          let row = list.find((entry) => entry.memberKey === key)
          if (!row) {
            row = {
              memberKey: key,
              skillId: member.skillId,
              anomalyPowerAgentId: defaults.anomalyPowerAgentId,
              triggerAgentId: defaults.triggerAgentId,
            }
            list.push(row)
            memberChanged = true
            continue
          }
          if (!row.anomalyPowerAgentId && defaults.anomalyPowerAgentId) {
            row.anomalyPowerAgentId = defaults.anomalyPowerAgentId
            memberChanged = true
          }
          if (!row.triggerAgentId && defaults.triggerAgentId) {
            row.triggerAgentId = defaults.triggerAgentId
            memberChanged = true
          }
        }
        if (memberChanged) {
          item.memberAgents = list
          changed = true
        }
        continue
      }
      const skillId = item.skillId?.trim()
      if (!skillId) continue
      const skill = buffStore.findSkill(skillId)
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
      slots.value
        .map((slot) =>
          slot.prepared
            .map((item) => item.skillId || item.skillGroupId || '')
            .join('+'),
        )
        .join('|'),
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

const prepInsertIndex = computed(() => {
  const drop = prepDropIndex.value
  const draggingId = prepDraggingId.value
  if (drop == null || !draggingId) return null
  const from = currentSlot.value.prepared.findIndex((item) => item.id === draggingId)
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

const preparedSkillIds = computed(() => {
  const ids = new Set<string>()
  for (const item of currentSlot.value.prepared) {
    const sid = item.skillId?.trim()
    if (sid) ids.add(sid)
  }
  return ids
})

const preparedGroupIds = computed(() => {
  const ids = new Set<string>()
  for (const item of currentSlot.value.prepared) {
    const gid = item.skillGroupId?.trim()
    if (gid) ids.add(gid)
  }
  return ids
})

const preparedSkillNames = computed(() => {
  const names = new Set<string>()
  for (const item of currentSlot.value.prepared) {
    const name = preparedDisplayName(item).trim()
    if (name && name !== '招式已删除' && name !== '技能组已删除') names.add(name)
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

const visibleLibraryGroups = computed(() => {
  if (!currentAgentId.value) return [] as SkillGroup[]
  return buffStore.skillGroupsForAgent(currentAgentId.value)
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
  list = list.filter((skill) => skillMatchesLibraryCategory(skill, librarySkillCategory.value))
  const q = libraryQuery.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((skill) => {
    if (skill.name.toLowerCase().includes(q)) return true
    return resolveSkillNote(skill.id, skill.note).toLowerCase().includes(q)
  })
})

const libraryGroups = computed(() => {
  let list = visibleLibraryGroups.value
  const srcCustom = librarySourceCustom.value
  const srcPreset = librarySourcePreset.value
  if (srcCustom || srcPreset) {
    list = list.filter((group) => {
      const custom = isCustomSkillGroup(group)
      const matchCustom = srcCustom && custom
      const matchPreset = srcPreset && !custom
      return matchCustom || matchPreset
    })
  }
  const q = libraryQuery.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((group) => group.name.toLowerCase().includes(q))
})

const libraryEmptyText = computed(() => {
  if (!visibleLibrarySkills.value.length && !visibleLibraryGroups.value.length) {
    return '该角色还没有招式或技能组。可先新建自定义，或到管理端录入。'
  }
  return '当前筛选没有招式。'
})

const preparedColHint = computed(() =>
  modalTab.value === 'prep'
    ? '每种一条；异常类详情选双代理人；改名/倍率回招式库。伤害单次、不含失衡。'
    : '可多次加入流程；双代理人在准备详情选。伤害单次、不含失衡。',
)

function preparedBlockReason(skill: Skill): 'id' | 'name' | null {
  if (preparedSkillIds.value.has(skill.id)) return 'id'
  const name = skill.name.trim()
  if (name && preparedSkillNames.value.has(name)) return 'name'
  return null
}

function preparedGroupBlockReason(group: SkillGroup): 'id' | 'name' | null {
  if (preparedGroupIds.value.has(group.id)) return 'id'
  const name = group.name.trim()
  if (name && preparedSkillNames.value.has(name)) return 'name'
  return null
}

const unpreparedFilteredCount = computed(
  () => librarySkills.value.filter((skill) => !preparedBlockReason(skill)).length,
)

function damageTypeLabel(type: SkillDamageType) {
  return DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === type)?.label ?? type
}

/** 计算页标签：有小类只显示小类（如强化特殊技），隐藏被蕴含的大类（特殊技） */
function skillStypeLabels(skill: Skill): string[] {
  return skillTypeLabelsForDisplay(skill.skillTypes)
}

function formatGroupMultSum(sum: number): string {
  if (!Number.isFinite(sum)) return ''
  const rounded = Math.round(sum * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function parseDisplayedMult(text: string): number | null {
  const raw = text.trim()
  if (!raw || raw === '—' || raw === '待选择') return null
  const n = Number(raw.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** 组内某段在库/准备/流程下的倍率展示键（勿用 skill.id 误撞结算结果） */
function groupMemberCalcKey(
  member: { skillId: string },
  memberIndex: number,
  options?: { entry?: FlowEntry | null; preparedId?: string | null },
): string | null {
  if (options?.entry) return `${options.entry.id}#${memberIndex}:${member.skillId}`
  if (options?.preparedId) return `${options.preparedId}#preview:${memberIndex}:${member.skillId}`
  return null
}

function groupMemberEffectiveCount(
  member: import('@/types/calculator').SkillGroupMember,
  options?: { entry?: FlowEntry | null },
): number {
  if (options?.entry) return memberTuneCount(options.entry, member)
  return Math.max(0, Number(member.count) || 0)
}

/**
 * 组内总倍率 = Σ(段倍率 × 段次数)。
 * 流程卡上的整组「次数」另算，不乘进这里（与结算：segmentCount = memberCount × entry.count 一致）。
 */
function groupMultText(
  group: SkillGroup,
  options?: { entry?: FlowEntry | null; preparedId?: string | null },
): string {
  let sum = 0
  let counted = 0
  const members = sortSkillGroupMembers(group.members)
  members.forEach((member, memberIndex) => {
    const skill = buffStore.findSkill(member.skillId)
    if (!skill) return
    const calcKey = groupMemberCalcKey(member, memberIndex, options)
    const text = skillMultText(skill, calcKey)
    if (options?.entry || options?.preparedId) {
      const prepared =
        options.entry != null
          ? flowPrepared(options.entry)
          : currentSlot.value.prepared.find((item) => item.id === options.preparedId) ?? null
      if (prepared && cardTriggerWarnForMember(skill, prepared, member)) {
        return
      }
    }
    const n = parseDisplayedMult(text)
    if (n == null) return
    sum += n * groupMemberEffectiveCount(member, options)
    counted += 1
  })
  if (!counted) return group.members.length ? `${group.members.length} 段` : ''
  return formatGroupMultSum(sum)
}

/** 详情/细调里单段倍率：跟总倍率同一数据源 */
function groupMemberMultText(
  skill: Skill | null | undefined,
  member: import('@/types/calculator').SkillGroupMember,
  memberIndex: number,
  options?: { entry?: FlowEntry | null; preparedId?: string | null },
): string {
  if (!skill) return ''
  if (options?.entry || options?.preparedId) {
    const prepared =
      options.entry != null
        ? flowPrepared(options.entry)
        : currentSlot.value.prepared.find((item) => item.id === options.preparedId) ?? null
    if (prepared && cardTriggerWarnForMember(skill, prepared, member)) return '—'
    return skillMultText(skill, groupMemberCalcKey(member, memberIndex, options))
  }
  return libraryMultText(skill)
}

function cardTriggerWarnForMember(
  skill: Skill,
  prepared: PreparedSkill,
  member: import('@/types/calculator').SkillGroupMember,
): string | null {
  const ma = memberAgentsFor(prepared, member)
  const triggerId = ma?.triggerAgentId ?? prepared.triggerAgentId
  if (!triggerId) return null
  return anomalyTriggerMultHint(skill, triggerId)
}

/** 库内/未结算时的有效基础倍率（nanoka 按当前槽位技能等级） */
function libraryEffectiveBaseMult(skill: Skill): number {
  const ownerId = currentAgentId.value || skill.agentId
  return resolveEffectiveBaseMult(skill, props.skillTalentLevelsByAgent?.[ownerId]).baseMult
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
  const filled = libraryEffectiveBaseMult(skill)
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
  return formatDamage(sumHitDamagesForEntry(props.hitDamages, entryId) ?? undefined)
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
  const prev = detailReturnStack.value.pop()
  detail.value = prev ?? null
}

function pushDetail(next: NonNullable<typeof detail.value>) {
  if (detail.value) detailReturnStack.value.push(detail.value)
  detail.value = next
}

function openDetailRoot(next: NonNullable<typeof detail.value>) {
  detailReturnStack.value = []
  detail.value = next
}

function closeCustomForm() {
  showCustomForm.value = false
  customFormOwnerGroupId.value = null
  const prev = detailReturnStack.value.pop()
  if (prev) detail.value = prev
}

function openCustomForm(ownerGroupId?: string | null) {
  detailReturnStack.value = []
  // 组内新建时保留组详情在栈底，保存后回到组
  if (ownerGroupId && detail.value?.kind === 'libraryGroup') {
    detailReturnStack.value = [detail.value]
  }
  detail.value = null
  customFormOwnerGroupId.value = ownerGroupId?.trim() || null
  customSaveHint.value = ''
  customDraft.name = ''
  customDraft.damageType = 'direct'
  customDraft.skillTypes = []
  customDraft.buffAnchorId = ''
  customDraft.baseMult = 0
  customDraft.settlementMult = 0
  customDraft.note = ''
  showCustomForm.value = true
}

function openCustomGroupForm() {
  showCustomForm.value = false
  customGroupHint.value = ''
  customGroupName.value = ''
  showCustomGroupForm.value = true
}

function closeCustomGroupForm() {
  showCustomGroupForm.value = false
  customGroupHint.value = ''
}

function saveCustomGroup() {
  const name = customGroupName.value.trim()
  if (!name) {
    customGroupHint.value = '请填写技能组名称'
    return
  }
  if (!currentAgentId.value) {
    customGroupHint.value = '请先选择角色'
    return
  }
  const existing = buffStore.skillGroupsForAgent(currentAgentId.value)
  if (existing.some((item) => item.name.trim() === name)) {
    customGroupHint.value = '已有同名技能组'
    return
  }
  const id = createCustomSkillGroupId(currentAgentId.value)
  buffStore.upsertCustomSkillGroupDoc({
    id,
    agentId: currentAgentId.value,
    name,
    note: '',
    source: 'custom',
    members: [],
  })
  customGroupName.value = ''
  showCustomGroupForm.value = false
  openLibraryGroupDetail(id)
}

function openPreparedDetail(preparedId: string) {
  showCustomForm.value = false
  openDetailRoot({ kind: 'prepared', preparedId })
}

function openFlowDetail(entryId: string) {
  showCustomForm.value = false
  openDetailRoot({ kind: 'flow', entryId })
}

function openLibraryDetail(skillId: string, fromGroup = false) {
  showCustomForm.value = false
  if (fromGroup) pushDetail({ kind: 'library', skillId })
  else openDetailRoot({ kind: 'library', skillId })
}

function openLibraryGroupDetail(groupId: string) {
  showCustomForm.value = false
  openDetailRoot({ kind: 'libraryGroup', groupId })
}

function openPreparedMemberDetail(
  preparedId: string,
  member: { order: number; skillId: string },
) {
  showCustomForm.value = false
  pushDetail({
    kind: 'preparedMember',
    preparedId,
    memberKey: skillGroupMemberKey(member),
    skillId: member.skillId,
  })
}

function onGroupMemberDetail(member: { order: number; skillId: string }) {
  if (detail.value?.kind === 'prepared' && detailPrepared.value) {
    openPreparedMemberDetail(detailPrepared.value.id, member)
    return
  }
  openLibraryDetail(member.skillId, true)
}

const detailSkill = computed((): Skill | null => {
  const current = detail.value
  if (!current) return null
  if (current.kind === 'library') return buffStore.findSkill(current.skillId)
  if (current.kind === 'preparedMember' || current.kind === 'flowMember') {
    return buffStore.findSkill(current.skillId)
  }
  if (current.kind === 'libraryGroup') return null
  if (current.kind === 'prepared') {
    const prepared = currentSlot.value.prepared.find((item) => item.id === current.preparedId)
    if (!prepared || isPreparedGroup(prepared)) return null
    return preparedSkill(prepared)
  }
  if (current.kind === 'flow') {
    const entry = currentSlot.value.flow.find((item) => item.id === current.entryId)
    if (!entry) return null
    const prepared = currentSlot.value.prepared.find((item) => item.id === entry.preparedId)
    if (!prepared || isPreparedGroup(prepared)) return null
    return preparedSkill(prepared)
  }
  return null
})

const detailPrepared = computed((): PreparedSkill | null => {
  const current = detail.value
  if (!current) return null
  if (current.kind === 'prepared' || current.kind === 'preparedMember') {
    return currentSlot.value.prepared.find((item) => item.id === current.preparedId) ?? null
  }
  if (current.kind === 'flow' || current.kind === 'flowMember') {
    const entry = currentSlot.value.flow.find((item) => item.id === current.entryId)
    if (!entry) return null
    return currentSlot.value.prepared.find((item) => item.id === entry.preparedId) ?? null
  }
  return null
})

const detailGroup = computed((): SkillGroup | null => {
  const current = detail.value
  if (!current) return null
  if (current.kind === 'libraryGroup') return buffStore.findSkillGroup(current.groupId)
  if (current.kind === 'prepared' || current.kind === 'flow') {
    const prepared = detailPrepared.value
    return prepared ? preparedGroup(prepared) : null
  }
  return null
})

const detailGroupEditable = computed(() => {
  const group = detailGroup.value
  return Boolean(group && isCustomSkillGroup(group) && detail.value?.kind === 'libraryGroup')
})

const detailGroupMultText = computed(() => {
  const group = detailGroup.value
  if (!group) return ''
  const current = detail.value
  if (current?.kind === 'flow') {
    const entry = currentSlot.value.flow.find((item) => item.id === current.entryId) ?? null
    return groupMultText(group, { entry })
  }
  if (current?.kind === 'prepared' || current?.kind === 'preparedMember') {
    return groupMultText(group, { preparedId: detailPrepared.value?.id ?? null })
  }
  return groupMultText(group)
})

/** 详情成员行倍率/次数用的上下文（库详情无 entry/prepared） */
const detailGroupMultOptions = computed(() => {
  const current = detail.value
  if (!current) return {}
  if (current.kind === 'flow' || current.kind === 'flowMember') {
    const entry = currentSlot.value.flow.find((item) => item.id === current.entryId) ?? null
    return { entry }
  }
  if (
    current.kind === 'prepared' ||
    current.kind === 'preparedMember' ||
    current.kind === 'libraryGroup'
  ) {
    const preparedId = detailPrepared.value?.id ?? null
    return preparedId ? { preparedId } : {}
  }
  return {}
})

const detailTitle = computed(() => {
  if (detail.value?.kind === 'libraryGroup' || (detail.value?.kind === 'prepared' && detailGroup.value)) {
    return detailGroup.value?.name || '技能组详情'
  }
  return detailSkill.value?.name || '招式详情'
})

const detailCanEditDefinition = computed(
  () =>
    (detail.value?.kind === 'library' || detail.value?.kind === 'preparedMember') &&
    detailSkill.value?.source === 'custom',
)

const detailCanEditAgents = computed(() => {
  if (detail.value?.kind === 'preparedMember' || detail.value?.kind === 'flowMember') return true
  return detail.value?.kind === 'prepared' && !detailGroup.value
})

const detailMemberForAgents = computed(() => {
  const current = detail.value
  if (current?.kind !== 'preparedMember' && current?.kind !== 'flowMember') return null
  const group = preparedGroup(detailPrepared.value!)
  if (!group) return null
  return (
    sortSkillGroupMembers(group.members).find(
      (item) => skillGroupMemberKey(item) === current.memberKey,
    ) ?? null
  )
})

const groupDetailAddCandidates = computed(() => {
  const group = detailGroup.value
  if (!group || !detailGroupEditable.value) return [] as Skill[]
  const element = (currentAgent.value?.element ?? '').trim()
  let list = buffStore.skills.filter((item) => {
    // 计算页组只引用本角色可见招式；组私有仅本组；新建只进浏览器缓存
    if (item.agentId && item.agentId !== currentAgentId.value) return false
    if (item.ownerGroupId && item.ownerGroupId !== group.id) return false
    if (!item.agentId) {
      const skillEl = String(item.element ?? '').trim()
      if (skillEl && element && skillEl !== element) return false
    }
    return true
  })
  const q = calcMemberLibraryQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        damageTypeLabel(item.damageType).toLowerCase().includes(q),
    )
  }
  return list.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
})

const detailCalcKey = computed(() => {
  const current = detail.value
  if (!current) return null
  if (current.kind === 'flow') return current.entryId
  if (current.kind === 'flowMember') {
    return `${current.entryId}#${current.memberIndex}:${current.skillId}`
  }
  if (current.kind === 'prepared') return current.preparedId
  if (current.kind === 'preparedMember') {
    const group = preparedGroup(detailPrepared.value!)
    if (!group) return null
    const memberIndex = sortSkillGroupMembers(group.members).findIndex(
      (item) => skillGroupMemberKey(item) === current.memberKey,
    )
    if (memberIndex < 0) return null
    return `${current.preparedId}#preview:${memberIndex}:${current.skillId}`
  }
  if (current.kind === 'library') {
    const prepared = currentSlot.value.prepared.find((item) => item.skillId === current.skillId)
    return prepared?.id ?? current.skillId
  }
  return null
})

const detailSkipReason = computed(() => {
  const current = detail.value
  if (!current) return null
  if (current.kind === 'flowMember') {
    const prepared = detailPrepared.value
    const skill = detailSkill.value
    const member = detailMemberForAgents.value
    if (!prepared || !skill || !member) return null
    const agents = memberAgentsFor(prepared, member)
    return dualAgentHintForAgents(skill, agents?.anomalyPowerAgentId, agents?.triggerAgentId)
  }
  if (current.kind === 'flow') {
    const entry = currentSlot.value.flow.find((item) => item.id === current.entryId)
    return entry ? flowSkipReason(entry) : null
  }
  if (current.kind === 'preparedMember') {
    const prepared = detailPrepared.value
    const skill = detailSkill.value
    const member = detailMemberForAgents.value
    if (!prepared || !skill || !member) return null
    const agents = memberAgentsFor(prepared, member)
    return dualAgentHintForAgents(skill, agents?.anomalyPowerAgentId, agents?.triggerAgentId)
  }
  const prepared = detailPrepared.value
  const skill = detailSkill.value
  if (prepared && skill) return dualAgentHint(prepared, skill)
  return null
})

const detailAgentPowerId = computed(() => {
  if (
    (detail.value?.kind === 'preparedMember' || detail.value?.kind === 'flowMember') &&
    detailPrepared.value &&
    detailMemberForAgents.value
  ) {
    return (
      memberAgentsFor(detailPrepared.value, detailMemberForAgents.value)?.anomalyPowerAgentId ?? ''
    )
  }
  return detailPrepared.value?.anomalyPowerAgentId ?? ''
})

const detailAgentTriggerId = computed(() => {
  if (
    (detail.value?.kind === 'preparedMember' || detail.value?.kind === 'flowMember') &&
    detailPrepared.value &&
    detailMemberForAgents.value
  ) {
    return memberAgentsFor(detailPrepared.value, detailMemberForAgents.value)?.triggerAgentId ?? ''
  }
  return detailPrepared.value?.triggerAgentId ?? ''
})

const detailZoneRows = computed(() => {
  // 乘区 / 最终伤害：流程整行或组内某段；准备 / 招式库不算伤
  // 异常类：外侧汇总必暴击；详情内同时展示暴击 / 期望 / 不暴击。直伤仍为期望。
  const kind = detail.value?.kind
  if (kind !== 'flow' && kind !== 'flowMember') return []
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
  const current = detail.value
  if (!current) return
  if (current.kind === 'preparedMember' || current.kind === 'flowMember') {
    const prepared = detailPrepared.value
    const member = detailMemberForAgents.value
    if (!prepared || !member) return
    setMemberDetailAgent(member, field, raw)
    return
  }
  if (current.kind !== 'prepared') return
  const prepared = detailPrepared.value
  if (!prepared || isPreparedGroup(prepared)) return
  updatePrepared(prepared.id, { [field]: raw || null })
}

function memberAgentsFor(prepared: PreparedSkill, member: import('@/types/calculator').SkillGroupMember) {
  return findMemberAgents(prepared.memberAgents, member)
}

function setMemberDetailAgent(
  member: import('@/types/calculator').SkillGroupMember,
  field: 'anomalyPowerAgentId' | 'triggerAgentId',
  raw: string,
) {
  const prepared = detailPrepared.value
  if (!prepared?.skillGroupId) return
  const key = skillGroupMemberKey(member)
  const list = [...(prepared.memberAgents ?? [])]
  const index = list.findIndex((item) => item.memberKey === key)
  const nextRow = {
    memberKey: key,
    skillId: member.skillId,
    anomalyPowerAgentId: index >= 0 ? list[index]!.anomalyPowerAgentId ?? null : null,
    triggerAgentId: index >= 0 ? list[index]!.triggerAgentId ?? null : null,
    [field]: raw || null,
  }
  if (index >= 0) list[index] = { ...list[index]!, ...nextRow }
  else list.push(nextRow)
  updatePrepared(prepared.id, { memberAgents: list })
}

function addSkillToCustomGroup(skillId: string) {
  const group = detailGroup.value
  if (!group || !detailGroupEditable.value) return
  const skill = buffStore.findSkill(skillId)
  if (!skill) return
  const members = [
    ...group.members,
    {
      skillId,
      order: group.members.length,
      count: 1,
      includeInFlow: true,
    },
  ]
  buffStore.upsertCustomSkillGroupDoc({
    ...group,
    members: members.map((item, index) => ({ ...item, order: index })),
  })
  groupAddSkillId.value = ''
}

function removeMemberFromCustomGroup(index: number) {
  const group = detailGroup.value
  if (!group || !detailGroupEditable.value) return
  const members = group.members
    .filter((_, i) => i !== index)
    .map((item, i) => ({ ...item, order: i }))
  buffStore.upsertCustomSkillGroupDoc({ ...group, members })
}

function moveCustomGroupMember(index: number, delta: number) {
  const group = detailGroup.value
  if (!group || !detailGroupEditable.value) return
  const next = index + delta
  const list = sortSkillGroupMembers(group.members)
  if (next < 0 || next >= list.length) return
  const copy = [...list]
  const row = copy[index]
  if (!row) return
  copy.splice(index, 1)
  copy.splice(next, 0, row)
  buffStore.upsertCustomSkillGroupDoc({
    ...group,
    members: copy.map((item, i) => ({ ...item, order: i })),
  })
}

function patchCustomGroupMember(index: number, patch: Partial<{ count: number }>) {
  const group = detailGroup.value
  if (!group || !detailGroupEditable.value) return
  const members = sortSkillGroupMembers(group.members).map((item, i) =>
    i === index
      ? { ...item, ...patch, includeInFlow: true, order: i }
      : { ...item, includeInFlow: true, order: i },
  )
  buffStore.upsertCustomSkillGroupDoc({ ...group, members })
}

function deleteGroupPrivateSkill(skillId: string) {
  const skill = buffStore.findSkill(skillId)
  if (!skill || skill.source !== 'custom') return
  openConfirm(
    {
      title: '删除组内招式',
      message: `确认删除自建招式「${skill.name}」？会从技能组中移除并删除定义。`,
      confirmText: '删除',
      danger: true,
    },
    () => {
      const group = detailGroup.value
      if (group && detailGroupEditable.value) {
        const members = group.members
          .filter((item) => item.skillId !== skillId)
          .map((item, i) => ({ ...item, order: i }))
        buffStore.upsertCustomSkillGroupDoc({ ...group, members })
      }
      buffStore.removeCustomSkillDoc(skillId)
      if (detail.value?.kind === 'library' && detail.value.skillId === skillId) {
        closeDetail()
      }
    },
  )
}

function deleteCustomGroup(group: SkillGroup) {
  if (!isCustomSkillGroup(group)) return
  openConfirm(
    {
      title: '删除技能组',
      message: `确认删除自建技能组「${group.name}」？组内私有招式也会删除。`,
      confirmText: '删除',
      danger: true,
    },
    () => {
      writeSlots(
        slots.value.map((slot) => {
          const removedPreparedIds = new Set<string>()
          const prepared = slot.prepared.filter((item) => {
            if (item.skillGroupId === group.id) {
              removedPreparedIds.add(item.id)
              return false
            }
            return true
          })
          return {
            ...slot,
            prepared,
            flow: slot.flow.filter((entry) => !removedPreparedIds.has(entry.preparedId)),
          }
        }),
      )
      buffStore.removeCustomSkillGroupDoc(group.id)
      detailReturnStack.value = []
      detail.value = null
    },
  )
}

function dualAgentHintForAgents(
  skill: Skill,
  anomalyPowerAgentId: string | null | undefined,
  triggerAgentId: string | null | undefined,
): string | null {
  if (!skillNeedsDualAgents(skill.damageType)) return null
  const teamIds = new Set(props.teamSlots.map((slot) => slot.agentId).filter(Boolean))
  if (!anomalyPowerAgentId || !triggerAgentId) {
    return '双代理人未选全，加入流程后不会出伤'
  }
  if (!teamIds.has(anomalyPowerAgentId) || !teamIds.has(triggerAgentId)) {
    return '选定的代理人已不在当前队伍'
  }
  if (skill.damageType === 'turbulence') {
    if (!isTurbulenceWindTrigger(props.agents, triggerAgentId)) {
      return '乱流仅当异常类触发者为风属性角色时才能生效'
    }
  }
  if (skill.damageType === 'radiance') {
    const trigger = props.agents.find((item) => item.id === triggerAgentId)
    if (!isLuminousAgent(trigger)) {
      return '耀变仅当异常类触发者为蕾米埃尔时才能生效'
    }
  }
  return null
}

function dualAgentHint(prepared: PreparedSkill, skill: Skill): string | null {
  return dualAgentHintForAgents(skill, prepared.anomalyPowerAgentId, prepared.triggerAgentId)
}

function groupDualAgentHint(prepared: PreparedSkill): string | null {
  const group = preparedGroup(prepared)
  if (!group) return '技能组已从库中删除'
  for (const member of sortSkillGroupMembers(group.members)) {
    const skill = buffStore.findSkill(member.skillId)
    if (!skill || !skillNeedsDualAgents(skill.damageType)) continue
    const agents = memberAgentsFor(prepared, member)
    const hint = dualAgentHintForAgents(
      skill,
      agents?.anomalyPowerAgentId,
      agents?.triggerAgentId,
    )
    if (hint) return `「${skill.name}」${hint}`
  }
  return null
}

function preparedSkill(prepared: PreparedSkill): Skill | null {
  const skillId = prepared.skillId?.trim()
  if (!skillId) return null
  return buffStore.findSkill(skillId)
}

function preparedGroup(prepared: PreparedSkill): SkillGroup | null {
  const groupId = prepared.skillGroupId?.trim()
  if (!groupId) return null
  return buffStore.findSkillGroup(groupId)
}

function preparedDisplayName(prepared: PreparedSkill): string {
  const group = preparedGroup(prepared)
  if (group) return group.name
  if (prepared.skillGroupId) return '技能组已删除'
  const skill = preparedSkill(prepared)
  if (skill) return skill.name
  if (prepared.skillId) return '招式已删除'
  return '未知'
}

function isPreparedGroup(prepared: PreparedSkill): boolean {
  return Boolean(prepared.skillGroupId?.trim())
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
    skillGroupId: null,
    skillSource: skill.source === 'preset' ? 'preset' : 'custom',
    anomalyPowerAgentId: agents.anomalyPowerAgentId,
    triggerAgentId: agents.triggerAgentId,
    extraMods: null,
  })
  writeSlots(next)
}

function addPreparedGroup(group: SkillGroup) {
  const ownerId = currentAgentId.value
  if (!ownerId) return
  if (preparedGroupBlockReason(group)) return
  const next = ensureSchemeSlots(slots.value, Math.max(3, props.teamSlots.length))
  const slot = next[activeSlotIndex.value]
  if (!slot) return
  slot.prepared.push({
    id: newLocalId('prep'),
    skillId: null,
    skillGroupId: group.id,
    skillSource: 'preset',
    anomalyPowerAgentId: null,
    triggerAgentId: null,
    memberAgents: buildDefaultMemberAgents(group, ownerId, (id) => buffStore.findSkill(id)),
    extraMods: null,
  })
  writeSlots(next)
}

function addFilteredToPrepared() {
  const ownerId = currentAgentId.value
  if (!ownerId) return
  const existingIds = new Set(
    currentSlot.value.prepared.map((item) => item.skillId).filter(Boolean) as string[],
  )
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
      skillGroupId: null,
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

function nearestSeamIndexInList(
  list: HTMLUListElement | null,
  clientY: number,
): number | null {
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

function nearestSeamIndex(clientY: number): number | null {
  return nearestSeamIndexInList(flowListEl.value, clientY)
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

function onPrepDragStart(preparedId: string, event: DragEvent) {
  if (!prepDragEnabled.value || modalTab.value !== 'prep' || isFlowDragIgnoreTarget(event)) {
    event.preventDefault()
    return
  }
  event.dataTransfer?.setData('text/plain', preparedId)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  prepDraggingId.value = preparedId
}

function onPrepSortDragOver(event: DragEvent) {
  if (!prepDragEnabled.value || !prepDraggingId.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const index = nearestSeamIndexInList(prepListEl.value, event.clientY)
  if (index == null) return
  prepDropIndex.value = index
}

function onPrepSortDrop(event: DragEvent) {
  if (!prepDragEnabled.value || !prepDraggingId.value) return
  event.preventDefault()
  const index =
    nearestSeamIndexInList(prepListEl.value, event.clientY) ?? prepDropIndex.value
  if (index != null) reorderPreparedToIndex(prepDraggingId.value, index)
  prepDraggingId.value = null
  prepDropIndex.value = null
}

function onPrepDragEnd() {
  prepDraggingId.value = null
  prepDropIndex.value = null
}

function reorderPreparedToIndex(fromId: string, toIndex: number) {
  const next = ensureSchemeSlots(slots.value)
  const slot = next[activeSlotIndex.value]
  if (!slot) return
  const fromIndex = slot.prepared.findIndex((item) => item.id === fromId)
  if (fromIndex < 0) return
  let dest = toIndex
  const [item] = slot.prepared.splice(fromIndex, 1)
  if (fromIndex < dest) dest -= 1
  if (dest < 0) dest = 0
  if (dest > slot.prepared.length) dest = slot.prepared.length
  slot.prepared.splice(dest, 0, item!)
  slots.value = next
}

function flowSkipReason(entry: FlowEntry): string | null {
  const prepared = currentSlot.value.prepared.find((item) => item.id === entry.preparedId)
  if (!prepared) return '准备阶段里找不到这条招式'
  if (isPreparedGroup(prepared)) {
    if (!preparedGroup(prepared)) return '技能组已从库中删除'
    return groupDualAgentHint(prepared)
  }
  const hit = props.hits?.find((item) => item.id === entry.id)
  if (!hit) {
    if (!preparedSkill(prepared)) return '招式已从库中删除'
    return null
  }
  return getHitSkipReason(hit, { teamSlots: props.teamSlots, agents: props.agents })
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
  note: '',
})

const detailDraft = reactive({
  name: '',
  damageType: 'direct' as SkillDamageType,
  skillTypes: [] as SkillTypeId[],
  buffAnchorId: '' as string,
  baseMult: 0,
  settlementMult: 0,
  note: '',
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
    detailDraft.note = resolveSkillNote(skill.id, skill.note)
  },
)

const anchorOptions = computed(() =>
  skillSubcategories.value.filter((item) => item.agentId === currentAgentId.value),
)

function saveCustomSkill() {
  const name = customDraft.name.trim()
  if (!name) {
    customSaveHint.value = '请填写招式名称'
    return
  }
  customSaveHint.value = ''
  const anomaly = skillNeedsDualAgents(customDraft.damageType)
  const ownerGroupId = customFormOwnerGroupId.value
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
    ownerGroupId: ownerGroupId || null,
    note: customDraft.note.trim() || undefined,
  }
  buffStore.upsertCustomSkillDoc(skill)
  if (ownerGroupId) {
    const group = buffStore.findSkillGroup(ownerGroupId)
    if (group && isCustomSkillGroup(group)) {
      buffStore.upsertCustomSkillGroupDoc({
        ...group,
        members: [
          ...group.members,
          {
            skillId: skill.id,
            order: group.members.length,
            count: 1,
            includeInFlow: true,
          },
        ],
      })
    }
  } else {
    addPrepared(skill)
  }
  customDraft.name = ''
  customDraft.baseMult = 0
  customDraft.settlementMult = 0
  customDraft.skillTypes = []
  customDraft.buffAnchorId = ''
  customDraft.note = ''
  showCustomForm.value = false
  customFormOwnerGroupId.value = null
  // 组内新建：回到组详情
  const prev = detailReturnStack.value.pop()
  detail.value = prev ?? null
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

function displaySkillNote(skill: Skill | null | undefined): string {
  if (!skill) return ''
  return resolveSkillNote(skill.id, skill.note)
}

function saveDetailNote() {
  const skill = detailSkill.value
  if (!skill) return
  const note = detailDraft.note.trim()
  const base = (skill.note ?? '').trim()
  if (skill.source === 'custom' && detailCanEditDefinition.value) {
    buffStore.upsertCustomSkillDoc({
      ...skill,
      note: note || undefined,
    })
    clearSkillNoteOverride(skill.id)
    detailSaveHint.value = '备注已保存'
    return
  }
  if (note === base) {
    clearSkillNoteOverride(skill.id)
    detailSaveHint.value = note ? '已与管理端备注一致' : '已清除本机备注'
    return
  }
  setSkillNoteOverride(skill.id, note)
  detailSaveHint.value = '备注已保存到本机'
}

function resetDetailNote() {
  const skill = detailSkill.value
  if (!skill) return
  clearSkillNoteOverride(skill.id)
  detailDraft.note = (skill.note ?? '').trim()
  detailSaveHint.value = '已恢复管理端备注'
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
    note: detailDraft.note.trim() || undefined,
  })
  clearSkillNoteOverride(skill.id)
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
      clearSkillNoteOverride(skill.id)
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

function flowGroup(entry: FlowEntry): SkillGroup | null {
  const prepared = flowPrepared(entry)
  return prepared ? preparedGroup(prepared) : null
}

function flowSkillName(entry: FlowEntry): string {
  const prepared = flowPrepared(entry)
  if (!prepared) return '未知招式'
  if (isPreparedGroup(prepared)) {
    return preparedGroup(prepared)?.name ?? '技能组已删除'
  }
  return flowSkill(entry)?.name ?? '招式已删除'
}

function flowIsGroup(entry: FlowEntry): boolean {
  return Boolean(flowPrepared(entry)?.skillGroupId?.trim())
}

const tuningFlowEntry = computed(() => {
  const id = flowGroupTuneId.value
  if (!id) return null
  return currentSlot.value.flow.find((item) => item.id === id) ?? null
})

const tuningGroup = computed(() => {
  const entry = tuningFlowEntry.value
  return entry ? flowGroup(entry) : null
})

function openFlowGroupTune(entryId: string) {
  flowGroupTuneId.value = entryId
}

function closeFlowGroupTune() {
  flowGroupTuneId.value = null
}

/** 细调里看招式详情：叠在细调之上，关闭后仍回细调；带上流程段 id 以便展示计算过程 */
function openTuneMemberDetail(
  member: { order: number; skillId: string },
  memberIndex: number,
) {
  const entryId = flowGroupTuneId.value
  if (!entryId || !buffStore.findSkill(member.skillId)) return
  openDetailRoot({
    kind: 'flowMember',
    entryId,
    memberIndex,
    skillId: member.skillId,
    memberKey: skillGroupMemberKey(member),
  })
}

function memberOverrideFor(entry: FlowEntry, member: { order: number; skillId: string }) {
  return findMemberOverride(entry.memberOverrides, member as import('@/types/calculator').SkillGroupMember)
}

/** 细调展示次数：覆盖优先，否则组定义默认 */
function memberTuneCount(
  entry: FlowEntry,
  member: { order: number; skillId: string; count: number },
) {
  const ov = memberOverrideFor(entry, member)
  if (ov?.count != null && Number.isFinite(Number(ov.count))) return Math.max(0, Number(ov.count))
  return Math.max(0, Number(member.count) || 0)
}

/** 细调展示失衡：覆盖优先，否则继承整组流程行 */
function memberTuneStagger(
  entry: FlowEntry,
  member: { order: number; skillId: string },
) {
  const ov = memberOverrideFor(entry, member)
  if (ov?.staggerPhase === 'stagger' || ov?.staggerPhase === 'normal') {
    return ov.staggerPhase === 'stagger'
  }
  return entry.staggerPhase === 'stagger'
}

function setMemberOverride(
  entryId: string,
  member: { order: number; skillId: string; count: number },
  patch: Partial<Pick<FlowGroupMemberOverride, 'count' | 'staggerPhase'>>,
) {
  const entry = getActiveSlot()?.flow.find((item) => item.id === entryId)
  if (!entry) return
  const key = skillGroupMemberKey(member)
  const list = [...(entry.memberOverrides ?? [])]
  const index = list.findIndex((item) => item.memberKey === key)
  const prev = index >= 0 ? list[index] : undefined
  const base: FlowGroupMemberOverride = {
    memberKey: key,
    skillId: member.skillId,
    count: prev?.count ?? null,
    staggerPhase: prev?.staggerPhase ?? null,
    // 组内细调不再提供暴击覆盖
    critMode: null,
    ...patch,
  }
  if (patch.count === null) base.count = null
  if (patch.staggerPhase === null) base.staggerPhase = null
  const empty = base.count == null && base.staggerPhase == null
  if (index >= 0) {
    if (empty) list.splice(index, 1)
    else list[index] = base
  } else if (!empty) {
    list.push(base)
  }
  entry.memberOverrides = list.length ? list : null
}

function clearMemberOverride(entryId: string, member: { order: number; skillId: string }) {
  const entry = getActiveSlot()?.flow.find((item) => item.id === entryId)
  if (!entry?.memberOverrides?.length) return
  const key = skillGroupMemberKey(member)
  entry.memberOverrides = entry.memberOverrides.filter((item) => item.memberKey !== key)
  if (!entry.memberOverrides.length) entry.memberOverrides = null
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
    detailReturnStack.value = []
    showCustomForm.value = false
    showCustomGroupForm.value = false
    customFormOwnerGroupId.value = null
  }
})

function compactPreparedDuplicates() {
  const next = ensureSchemeSlots(slots.value, Math.max(3, props.teamSlots.length))
  let changed = false
  for (const slot of next) {
    const keepBySkill = new Map<string, string>()
    const keepByGroup = new Map<string, string>()
    const remap = new Map<string, string>()
    const kept: PreparedSkill[] = []
    for (const item of slot.prepared) {
      const groupId = item.skillGroupId?.trim()
      if (groupId) {
        const keepId = keepByGroup.get(groupId)
        if (keepId) {
          remap.set(item.id, keepId)
          changed = true
          continue
        }
        keepByGroup.set(groupId, item.id)
        kept.push(item)
        continue
      }
      const skillId = item.skillId?.trim()
      if (!skillId) {
        kept.push(item)
        continue
      }
      const keepId = keepBySkill.get(skillId)
      if (keepId) {
        remap.set(item.id, keepId)
        changed = true
        continue
      }
      keepBySkill.set(skillId, item.id)
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
      <button type="button" class="sf-toggle-btn" @click="expanded = !expanded">
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
              <div class="col-head col-head--library">
                <div class="col-title-row">
                  <h3>招式库</h3>
                  <input v-model="libraryQuery" class="search-input search-input--inline" placeholder="搜索招式名 / 备注" />
                </div>
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
                  <div class="chip-group create-actions" role="group" aria-label="新建">
                    <button type="button" class="mini-btn" @click="openCustomForm()">
                      新建招式
                    </button>
                    <button type="button" class="mini-btn" @click="openCustomGroupForm">
                      新建技能组
                    </button>
                    <button
                      type="button"
                      class="mini-btn"
                      :disabled="!unpreparedFilteredCount"
                      :title="`将筛选结果全部加入准备（${unpreparedFilteredCount}）`"
                      @click="addFilteredToPrepared"
                    >
                      全部加入 ({{ unpreparedFilteredCount }})
                    </button>
                  </div>
                </div>
              </div>
              <ul class="sf-list">
                <li v-if="libraryGroups.length" class="list-section-label">技能组</li>
                <SkillFlowCard
                  v-for="group in libraryGroups"
                  :key="`g-${group.id}`"
                  :name="group.name"
                  :note="group.note?.trim() || ''"
                  :pop-mult="groupMultText(group)"
                  pop-mult-label="总倍率"
                  dtype="技能组"
                  dtype-kind="direct"
                >
                  <template #actions>
                    <button
                      type="button"
                      class="mini-btn"
                      @click.stop="openLibraryGroupDetail(group.id)"
                    >
                      详情
                    </button>
                    <button
                      type="button"
                      class="mini-btn add-prepared-btn"
                      :disabled="Boolean(preparedGroupBlockReason(group))"
                      @click.stop="addPreparedGroup(group)"
                    >
                      {{
                        preparedGroupBlockReason(group) === 'name'
                          ? '已有同名'
                          : preparedGroupBlockReason(group)
                            ? '已加'
                            : '加入'
                      }}
                    </button>
                    <button
                      v-if="isCustomSkillGroup(group)"
                      type="button"
                      class="mini-btn danger"
                      @click.stop="deleteCustomGroup(group)"
                    >
                      删除
                    </button>
                  </template>
                </SkillFlowCard>
                <li class="list-section-row">
                  <span class="list-section-label-inline">招式</span>
                  <div class="chip-group" role="group" aria-label="招式分类">
                    <button
                      v-for="item in LIBRARY_SKILL_CATEGORY_FILTERS"
                      :key="item.id"
                      type="button"
                      class="chip"
                      :class="{ active: librarySkillCategory === item.id }"
                      @click="librarySkillCategory = item.id"
                    >
                      {{ item.label }}
                    </button>
                  </div>
                </li>
                <SkillFlowCard
                  v-for="skill in librarySkills"
                  :key="skill.id"
                  :name="skill.name"
                  :note="displaySkillNote(skill)"
                  :pop-mult="libraryMultText(skill)"
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
                <li v-if="!librarySkills.length && !libraryGroups.length" class="list-empty">
                  {{ libraryEmptyText }}
                </li>
                <li v-else-if="!librarySkills.length" class="list-empty">当前筛选没有招式。</li>
              </ul>
            </div>

            <div class="flow-col">
              <div class="col-head col-head--prepared">
                <div class="col-title-row">
                  <h3>{{ modalTab === 'prep' ? '准备招式' : '准备招式（加入流程）' }}</h3>
                  <div class="col-title-actions">
                    <label v-if="modalTab === 'prep'" class="drag-toggle">
                      <input v-model="prepDragEnabled" type="checkbox" />
                      拖动排序
                    </label>
                    <button
                      v-if="modalTab === 'prep'"
                      type="button"
                      class="mini-btn danger"
                      :disabled="!currentSlot.prepared.length"
                      @click="clearPrepared"
                    >
                      清空全部
                    </button>
                  </div>
                </div>
                <p class="col-desc col-desc--compact" :title="preparedColHint">
                  {{
                    modalTab === 'prep' && prepDragEnabled
                      ? '打开拖动后，按住招式行可改顺序。详情与移除仍是点击。'
                      : preparedColHint
                  }}
                </p>
              </div>
              <ul
                ref="prepListEl"
                class="sf-list"
                :class="{ 'sf-list--flow': modalTab === 'prep' && prepDragEnabled }"
                @dragover="onPrepSortDragOver"
                @drop="onPrepSortDrop"
              >
                <template v-for="(prepared, preparedIndex) in currentSlot.prepared" :key="prepared.id">
                  <li
                    v-if="modalTab === 'prep' && prepDragEnabled"
                    class="sf-insert-slot"
                    :class="{ 'is-active': prepInsertIndex === preparedIndex }"
                    aria-hidden="true"
                  />
                  <SkillFlowCard
                    v-if="isPreparedGroup(prepared)"
                    :name="preparedDisplayName(prepared)"
                    :note="preparedGroup(prepared)?.note?.trim() || ''"
                    :pop-mult="
                      preparedGroup(prepared)
                        ? groupMultText(preparedGroup(prepared)!, { preparedId: prepared.id })
                        : ''
                    "
                    pop-mult-label="总倍率"
                    dtype="技能组"
                    dtype-kind="direct"
                    :skip="Boolean(groupDualAgentHint(prepared))"
                    :row-draggable="modalTab === 'prep' && prepDragEnabled"
                    :dragging="prepDraggingId === prepared.id"
                    @dragstart="onPrepDragStart(prepared.id, $event)"
                    @dragend="onPrepDragEnd"
                  >
                    <template #actions>
                      <button
                        type="button"
                        class="mini-btn"
                        draggable="false"
                        @click="openPreparedDetail(prepared.id)"
                      >
                        详情
                      </button>
                      <button
                        v-if="modalTab === 'prep'"
                        type="button"
                        class="mini-btn danger"
                        draggable="false"
                        @click="removePrepared(prepared.id)"
                      >
                        移除
                      </button>
                      <button
                        v-else
                        type="button"
                        class="mini-btn"
                        @click="addToFlow(prepared)"
                      >
                        {{ flowPreparedIds.has(prepared.id) ? '再加一条' : '加入流程' }}
                      </button>
                    </template>
                  </SkillFlowCard>
                  <SkillFlowCard
                    v-else-if="preparedSkill(prepared)"
                    :name="preparedSkill(prepared)!.name"
                    :note="displaySkillNote(preparedSkill(prepared)!)"
                    :pop-mult="
                      dualAgentHint(prepared, preparedSkill(prepared)!)
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
                    :damage="
                      dualAgentHint(prepared, preparedSkill(prepared)!)
                        ? ''
                        : damageForFlow(prepared.id)
                    "
                    :row-draggable="modalTab === 'prep' && prepDragEnabled"
                    :dragging="prepDraggingId === prepared.id"
                    @select-agents="openPreparedDetail(prepared.id)"
                    @dragstart="onPrepDragStart(prepared.id, $event)"
                    @dragend="onPrepDragEnd"
                  >
                    <template #actions>
                      <button
                        type="button"
                        class="mini-btn"
                        draggable="false"
                        @click="openPreparedDetail(prepared.id)"
                      >
                        详情
                      </button>
                      <button
                        v-if="modalTab === 'prep'"
                        type="button"
                        class="mini-btn danger"
                        draggable="false"
                        @click="removePrepared(prepared.id)"
                      >
                        移除
                      </button>
                      <button
                        v-else
                        type="button"
                        class="mini-btn"
                        @click="addToFlow(prepared)"
                      >
                        {{ flowPreparedIds.has(prepared.id) ? '再加一条' : '加入流程' }}
                      </button>
                    </template>
                  </SkillFlowCard>
                  <SkillFlowCard
                    v-else
                    name="招式已删除"
                    skip
                    :row-draggable="modalTab === 'prep' && prepDragEnabled"
                    :dragging="prepDraggingId === prepared.id"
                    @dragstart="onPrepDragStart(prepared.id, $event)"
                    @dragend="onPrepDragEnd"
                  >
                    <template #actions>
                      <button
                        type="button"
                        class="mini-btn danger"
                        draggable="false"
                        @click="removePrepared(prepared.id)"
                      >
                        移除
                      </button>
                    </template>
                  </SkillFlowCard>
                </template>
                <li
                  v-if="modalTab === 'prep' && prepDragEnabled && currentSlot.prepared.length"
                  class="sf-insert-slot"
                  :class="{ 'is-active': prepInsertIndex === currentSlot.prepared.length }"
                  aria-hidden="true"
                />
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
                    compact
                    :note="
                      flowIsGroup(entry)
                        ? flowGroup(entry)?.note?.trim() || ''
                        : flowSkill(entry)
                          ? displaySkillNote(flowSkill(entry)!)
                          : ''
                    "
                    :pop-mult="
                      flowIsGroup(entry) && flowGroup(entry)
                        ? groupMultText(flowGroup(entry)!, { entry })
                        : flowSkill(entry)
                          ? skillMultText(flowSkill(entry)!, entry.id)
                          : ''
                    "
                    :pop-mult-label="flowIsGroup(entry) ? '总倍率' : '倍率'"
                    :warn="
                      flowIsGroup(entry)
                        ? null
                        : flowSkill(entry)
                          ? cardTriggerWarn(flowSkill(entry)!, entry.id)
                          : null
                    "
                    :count="entry.count"
                    :stagger="entry.staggerPhase === 'stagger'"
                    :dtype="
                      flowIsGroup(entry)
                        ? '技能组'
                        : flowSkill(entry)
                          ? damageTypeLabel(flowSkill(entry)!.damageType)
                          : ''
                    "
                    :dtype-kind="
                      flowIsGroup(entry)
                        ? 'direct'
                        : flowSkill(entry)
                          ? dtypeKind(flowSkill(entry)!.damageType)
                          : 'direct'
                    "
                    :agent-pair="
                      !flowIsGroup(entry) && flowSkill(entry) && flowPrepared(entry)
                        ? agentPairText(flowPrepared(entry)!, flowSkill(entry)!)
                        : ''
                    "
                    :agent-title="
                      !flowIsGroup(entry) && flowSkill(entry) && flowPrepared(entry)
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
                        v-if="flowIsGroup(entry)"
                        type="button"
                        class="mini-btn"
                        draggable="false"
                        @click="openFlowGroupTune(entry.id)"
                      >
                        细调
                      </button>
                      <button
                        v-else
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
      <div
        v-if="tuningFlowEntry && tuningGroup"
        class="skill-detail-overlay"
        @click.self="closeFlowGroupTune"
      >
        <div class="skill-detail-panel group-tune-panel" role="dialog" aria-modal="true">
          <header class="skill-detail-head">
            <h3>组内细调 · {{ tuningGroup.name }}</h3>
            <button type="button" class="close-btn" aria-label="关闭" @click="closeFlowGroupTune">
              ×
            </button>
          </header>
          <div class="skill-detail-body">
            <p v-if="tuningGroup.note?.trim()" class="group-note-banner">
              {{ tuningGroup.note.trim() }}
            </p>
            <p class="group-total-mult">
              组内总倍率
              <strong>{{
                groupMultText(tuningGroup, { entry: tuningFlowEntry }) || '—'
              }}</strong>
              <span class="muted">（各段倍率×次数之和）</span>
            </p>
            <p class="col-desc">
              与流程里普通招式相同：可改本段次数与失衡。留空/重置则继承组定义次数与整组失衡。
            </p>
            <ul class="sf-list group-tune-list">
              <SkillFlowCard
                v-for="(member, memberIndex) in sortSkillGroupMembers(tuningGroup.members)"
                :key="skillGroupMemberKey(member)"
                :index="memberIndex + 1"
                :name="buffStore.findSkill(member.skillId)?.name ?? member.skillId"
                :note="displaySkillNote(buffStore.findSkill(member.skillId))"
                :mult="
                  buffStore.findSkill(member.skillId)
                    ? groupMemberMultText(
                        buffStore.findSkill(member.skillId),
                        member,
                        memberIndex,
                        { entry: tuningFlowEntry! },
                      )
                    : ''
                "
                :warn="
                  !buffStore.findSkill(member.skillId)
                    ? '已删除'
                    : tuningFlowEntry && flowPrepared(tuningFlowEntry)
                      ? cardTriggerWarnForMember(
                          buffStore.findSkill(member.skillId)!,
                          flowPrepared(tuningFlowEntry)!,
                          member,
                        )
                      : null
                "
                :count="memberTuneCount(tuningFlowEntry!, member)"
                :stagger="memberTuneStagger(tuningFlowEntry!, member)"
                :dtype="
                  buffStore.findSkill(member.skillId)
                    ? damageTypeLabel(buffStore.findSkill(member.skillId)!.damageType)
                    : '—'
                "
                :dtype-kind="
                  buffStore.findSkill(member.skillId)
                    ? dtypeKind(buffStore.findSkill(member.skillId)!.damageType)
                    : 'direct'
                "
                :stypes="
                  buffStore.findSkill(member.skillId)
                    ? skillStypeLabels(buffStore.findSkill(member.skillId)!)
                    : []
                "
                :agent-pair="
                  tuningFlowEntry &&
                  flowPrepared(tuningFlowEntry) &&
                  buffStore.findSkill(member.skillId)
                    ? agentPairText(
                        {
                          ...flowPrepared(tuningFlowEntry)!,
                          anomalyPowerAgentId:
                            memberAgentsFor(flowPrepared(tuningFlowEntry)!, member)
                              ?.anomalyPowerAgentId ?? null,
                          triggerAgentId:
                            memberAgentsFor(flowPrepared(tuningFlowEntry)!, member)
                              ?.triggerAgentId ?? null,
                        },
                        buffStore.findSkill(member.skillId)!,
                      )
                    : ''
                "
                :agent-title="
                  tuningFlowEntry &&
                  flowPrepared(tuningFlowEntry) &&
                  buffStore.findSkill(member.skillId)
                    ? agentPairTitle(
                        {
                          ...flowPrepared(tuningFlowEntry)!,
                          anomalyPowerAgentId:
                            memberAgentsFor(flowPrepared(tuningFlowEntry)!, member)
                              ?.anomalyPowerAgentId ?? null,
                          triggerAgentId:
                            memberAgentsFor(flowPrepared(tuningFlowEntry)!, member)
                              ?.triggerAgentId ?? null,
                        },
                        buffStore.findSkill(member.skillId)!,
                      )
                    : ''
                "
                :damage="
                  damageForFlow(`${tuningFlowEntry!.id}#${memberIndex}:${member.skillId}`)
                "
                @select-agents="openTuneMemberDetail(member, memberIndex)"
                @update:count="
                  setMemberOverride(tuningFlowEntry!.id, member, {
                    count: $event,
                  })
                "
                @update:stagger="
                  setMemberOverride(tuningFlowEntry!.id, member, {
                    staggerPhase: $event ? 'stagger' : 'normal',
                  })
                "
              >
                <template #actions>
                  <button
                    type="button"
                    class="mini-btn"
                    :disabled="!buffStore.findSkill(member.skillId)"
                    @click="openTuneMemberDetail(member, memberIndex)"
                  >
                    详情
                  </button>
                  <button
                    type="button"
                    class="mini-btn"
                    @click="clearMemberOverride(tuningFlowEntry!.id, member)"
                  >
                    重置
                  </button>
                </template>
              </SkillFlowCard>
              <li v-if="!tuningGroup.members.length" class="list-empty">技能组暂无成员。</li>
            </ul>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
        <div v-if="detail" class="skill-detail-overlay" @click.self="closeDetail">
          <div class="skill-detail-panel" role="dialog" aria-modal="true" :aria-label="detailTitle">
            <header class="skill-detail-head">
              <h3>
                {{ detailGroup ? '技能组详情' : '招式详情' }} · {{ detailTitle }}
              </h3>
              <button type="button" class="close-btn" aria-label="关闭详情" @click="closeDetail">×</button>
            </header>
            <div v-if="detailGroup" class="skill-detail-body">
              <p v-if="detailGroup.note?.trim()" class="group-note-banner">
                {{ detailGroup.note.trim() }}
              </p>
              <p class="group-total-mult">
                组内总倍率
                <strong>{{ detailGroupMultText || '—' }}</strong>
                <span class="muted">（各段倍率×次数之和）</span>
              </p>
              <p class="col-desc">
                组内招式与普通招式相同。点「详情」查看/配置；关闭招式详情会回到本组。自建组新建招式只缓存在本机。
              </p>
              <p v-if="detailPrepared && groupDualAgentHint(detailPrepared)" class="warn-hint">
                {{ groupDualAgentHint(detailPrepared) }}
              </p>

              <div v-if="detailGroupEditable" class="calc-member-picker">
                <section class="calc-member-col">
                  <header class="calc-member-col-head">
                    <h4>普通招式</h4>
                    <input
                      v-model="calcMemberLibraryQuery"
                      class="field-input"
                      type="search"
                      placeholder="搜索招式名"
                    />
                    <button type="button" class="mini-btn" @click="openCustomForm(detailGroup.id)">
                      组内新建
                    </button>
                  </header>
                  <ul class="calc-member-list">
                    <li
                      v-for="sk in groupDetailAddCandidates"
                      :key="sk.id"
                      class="calc-member-card"
                    >
                      <div class="calc-member-main">
                        <strong :title="sk.name">{{ sk.name }}</strong>
                        <span class="muted">
                          {{ damageTypeLabel(sk.damageType)
                          }}{{ sk.ownerGroupId ? ' · 组内私有' : ''
                          }}{{ sk.source === 'custom' ? ' · 自建' : '' }}
                        </span>
                      </div>
                      <div class="calc-member-actions">
                        <button type="button" class="mini-btn" @click="addSkillToCustomGroup(sk.id)">
                          {{ calcGroupMemberIds.has(sk.id) ? '再加一条' : '加入' }}
                        </button>
                        <button
                          v-if="sk.source === 'custom' && sk.ownerGroupId === detailGroup.id"
                          type="button"
                          class="mini-btn danger"
                          @click="deleteGroupPrivateSkill(sk.id)"
                        >
                          删除
                        </button>
                      </div>
                    </li>
                    <li v-if="!groupDetailAddCandidates.length" class="list-empty">
                      {{
                        calcMemberLibraryQuery.trim()
                          ? '当前筛选没有可加入的招式。'
                          : '没有可加入的招式。'
                      }}
                    </li>
                  </ul>
                </section>
                <section class="calc-member-col">
                  <header class="calc-member-col-head">
                    <h4>技能组内（{{ detailGroup.members.length }}）</h4>
                    <p class="muted">调次数与顺序。</p>
                  </header>
                  <ul class="calc-member-list">
                    <li
                      v-for="(member, memberIndex) in sortSkillGroupMembers(detailGroup.members)"
                      :key="skillGroupMemberKey(member)"
                      class="calc-member-card calc-member-card--in"
                    >
                      <div class="calc-member-main">
                        <strong
                          class="calc-member-name"
                          :title="buffStore.findSkill(member.skillId)?.name ?? member.skillId"
                        >
                          {{ memberIndex + 1 }}.
                          {{ buffStore.findSkill(member.skillId)?.name ?? member.skillId }}
                        </strong>
                        <label class="calc-member-count">
                          次数
                          <input
                            class="field-input narrow"
                            type="number"
                            min="0"
                            step="1"
                            :value="member.count"
                            @change="
                              patchCustomGroupMember(memberIndex, {
                                count: Number(($event.target as HTMLInputElement).value) || 0,
                              })
                            "
                          />
                        </label>
                      </div>
                      <div class="calc-member-actions">
                        <button
                          type="button"
                          class="mini-btn"
                          :disabled="!buffStore.findSkill(member.skillId)"
                          @click="onGroupMemberDetail(member)"
                        >
                          详情
                        </button>
                        <button
                          type="button"
                          class="order-btn"
                          :disabled="memberIndex === 0"
                          @click="moveCustomGroupMember(memberIndex, -1)"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          class="order-btn"
                          :disabled="memberIndex === detailGroup.members.length - 1"
                          @click="moveCustomGroupMember(memberIndex, 1)"
                        >
                          ▼
                        </button>
                        <button
                          type="button"
                          class="mini-btn danger"
                          @click="removeMemberFromCustomGroup(memberIndex)"
                        >
                          移除
                        </button>
                        <button
                          v-if="
                            buffStore.findSkill(member.skillId)?.source === 'custom' &&
                            buffStore.findSkill(member.skillId)?.ownerGroupId === detailGroup.id
                          "
                          type="button"
                          class="mini-btn danger"
                          @click="deleteGroupPrivateSkill(member.skillId)"
                        >
                          删除招式
                        </button>
                      </div>
                    </li>
                    <li v-if="!detailGroup.members.length" class="list-empty">
                      还没有成员。从左侧加入。
                    </li>
                  </ul>
                </section>
              </div>

              <ul v-else class="sf-list group-member-list">
                <SkillFlowCard
                  v-for="(member, memberIndex) in sortSkillGroupMembers(detailGroup.members)"
                  :key="skillGroupMemberKey(member)"
                  :index="memberIndex + 1"
                  :name="buffStore.findSkill(member.skillId)?.name ?? member.skillId"
                  :note="displaySkillNote(buffStore.findSkill(member.skillId))"
                  :mult="
                    buffStore.findSkill(member.skillId)
                      ? groupMemberMultText(
                          buffStore.findSkill(member.skillId),
                          member,
                          memberIndex,
                          detailGroupMultOptions,
                        )
                      : ''
                  "
                  :warn="
                    buffStore.findSkill(member.skillId)
                      ? detailPrepared
                        ? cardTriggerWarnForMember(
                            buffStore.findSkill(member.skillId)!,
                            detailPrepared,
                            member,
                          )
                        : libraryMultWarn(buffStore.findSkill(member.skillId)!)
                      : '已删除'
                  "
                  :count="
                    detailGroupMultOptions.entry
                      ? memberTuneCount(detailGroupMultOptions.entry, member)
                      : member.count
                  "
                  count-readonly
                  :dtype="
                    buffStore.findSkill(member.skillId)
                      ? damageTypeLabel(buffStore.findSkill(member.skillId)!.damageType)
                      : '—'
                  "
                  :dtype-kind="
                    buffStore.findSkill(member.skillId)
                      ? dtypeKind(buffStore.findSkill(member.skillId)!.damageType)
                      : 'direct'
                  "
                  :stypes="
                    buffStore.findSkill(member.skillId)
                      ? skillStypeLabels(buffStore.findSkill(member.skillId)!)
                      : []
                  "
                  :agent-pair="
                    detailPrepared && buffStore.findSkill(member.skillId)
                      ? agentPairText(
                          {
                            ...detailPrepared,
                            anomalyPowerAgentId:
                              memberAgentsFor(detailPrepared, member)?.anomalyPowerAgentId ?? null,
                            triggerAgentId:
                              memberAgentsFor(detailPrepared, member)?.triggerAgentId ?? null,
                          },
                          buffStore.findSkill(member.skillId)!,
                        )
                      : ''
                  "
                  :skip="
                    Boolean(
                      detailPrepared &&
                        buffStore.findSkill(member.skillId) &&
                        dualAgentHintForAgents(
                          buffStore.findSkill(member.skillId)!,
                          memberAgentsFor(detailPrepared, member)?.anomalyPowerAgentId,
                          memberAgentsFor(detailPrepared, member)?.triggerAgentId,
                        ),
                    )
                  "
                >
                  <template #actions>
                    <button
                      type="button"
                      class="mini-btn"
                      :disabled="!buffStore.findSkill(member.skillId)"
                      @click="onGroupMemberDetail(member)"
                    >
                      详情
                    </button>
                  </template>
                </SkillFlowCard>
                <li v-if="!detailGroup.members.length" class="list-empty">组内还没有成员。</li>
              </ul>
            </div>
            <div v-else-if="detailSkill" class="skill-detail-body">
              <p v-if="detailSkipReason" class="warn-hint">{{ detailSkipReason }}</p>
              <template v-if="detailPrepared && skillNeedsDualAgents(detailSkill.damageType)">
                <p class="detail-section-title">双代理人</p>
                <div class="agent-row">
                  <label>
                    <span>异常强度提供者</span>
                    <select
                      v-if="detailCanEditAgents"
                      :value="detailAgentPowerId"
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
                      :value="agentFullName(detailAgentPowerId) || '未选'"
                      type="text"
                      readonly
                      tabindex="-1"
                    />
                  </label>
                  <label>
                    <span>异常类触发者</span>
                    <select
                      v-if="detailCanEditAgents"
                      :value="detailAgentTriggerId"
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
                      :value="agentFullName(detailAgentTriggerId) || '未选'"
                      type="text"
                      readonly
                      tabindex="-1"
                    />
                  </label>
                </div>
                <p v-if="detailSkipReason" class="warn-hint">
                  {{ detailSkipReason }}
                </p>
              </template>
              <p
                v-else-if="detail.kind === 'library' && skillNeedsDualAgents(detailSkill.damageType)"
                class="empty-hint"
              >
                加入准备后，异常类可在详情里选双代理人。
              </p>
              <p
                v-if="
                  detail.kind === 'prepared' ||
                  detail.kind === 'preparedMember' ||
                  detail.kind === 'flowMember'
                "
                class="empty-hint"
              >
                {{
                  skillNeedsDualAgents(detailSkill.damageType)
                    ? '名称、倍率、类型请到招式库里改。这里可改双代理人与本机备注。'
                    : '名称、倍率、类型请到招式库里改。备注可在此本机修改。'
                }}
              </p>
              <p v-else-if="detail.kind === 'flow'" class="empty-hint">
                次数和失衡在流程行改。招式定义请回招式库，双代理人请回准备或组内细调详情。备注可在此本机修改。
              </p>

              <p class="detail-section-title">招式设置</p>
              <p v-if="detailSkill.source === 'preset'" class="empty-hint">
                预设招式定义只读。备注可本机修改，未改时用管理端备注。
              </p>
              <p v-else-if="!detailCanEditDefinition" class="empty-hint">
                自定义招式的定义只在招式库可改。备注可在此本机修改。
              </p>
              <SkillDefinitionForm
                v-model="detailDraft"
                :readonly="!detailCanEditDefinition"
                note-editable
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
                {{
                  detail.kind === 'flow' || detail.kind === 'flowMember'
                    ? '还没有这段的结算结果。确认已加入流程并完成计算。'
                    : '还没有结算结果。直伤预览在准备行；异常类要先加入准备并选双代理人。计算过程在流程详情里看。'
                }}
              </p>
            </div>
            <div v-if="detailSkill && detailCanEditDefinition" class="skill-detail-foot">
              <button type="button" class="primary-btn save-action" @click="saveDetailSkill">
                保存招式
              </button>
              <button
                v-if="hasSkillNoteOverride(detailSkill.id)"
                type="button"
                class="mini-btn"
                @click="resetDetailNote"
              >
                恢复管理端备注
              </button>
              <p v-if="detailSaveHint" class="empty-hint foot-hint">{{ detailSaveHint }}</p>
            </div>
            <div v-else-if="detailSkill" class="skill-detail-foot">
              <button type="button" class="primary-btn save-action" @click="saveDetailNote">
                保存备注
              </button>
              <button
                v-if="hasSkillNoteOverride(detailSkill.id)"
                type="button"
                class="mini-btn"
                @click="resetDetailNote"
              >
                恢复管理端备注
              </button>
              <p v-if="detailSaveHint" class="empty-hint foot-hint">{{ detailSaveHint }}</p>
            </div>
            <p
              v-else-if="!detailSkill && !detailGroup"
              class="empty-hint skill-detail-missing"
            >
              招式已从库中删除。
            </p>
          </div>
        </div>
        </Teleport>

        <Teleport to="body">
        <div v-if="showCustomForm" class="skill-detail-overlay" @click.self="closeCustomForm">
          <div class="skill-detail-panel" role="dialog" aria-modal="true" aria-label="新建招式">
            <header class="skill-detail-head">
              <h3>{{ customFormOwnerGroupId ? '组内新建招式' : '新建招式' }}</h3>
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
                {{ customFormOwnerGroupId ? '保存并加入技能组' : '保存并加入准备' }}
              </button>
              <p v-if="customSaveHint" class="warn-hint foot-hint">{{ customSaveHint }}</p>
            </div>
          </div>
        </div>
        </Teleport>

        <Teleport to="body">
        <div v-if="showCustomGroupForm" class="skill-detail-overlay" @click.self="closeCustomGroupForm">
          <div class="skill-detail-panel" role="dialog" aria-modal="true" aria-label="新建技能组">
            <header class="skill-detail-head">
              <h3>新建技能组</h3>
              <button type="button" class="close-btn" aria-label="关闭" @click="closeCustomGroupForm">×</button>
            </header>
            <div class="skill-detail-body">
              <label class="field-block">
                <span>名称</span>
                <input v-model="customGroupName" class="field-input" type="text" placeholder="技能组名称" />
              </label>
              <p class="empty-hint">创建后可在详情里添加招式，或用「新建招式」做组内招式。</p>
            </div>
            <div class="skill-detail-foot">
              <button type="button" class="primary-btn save-action" @click="saveCustomGroup">
                创建技能组
              </button>
              <p v-if="customGroupHint" class="warn-hint foot-hint">{{ customGroupHint }}</p>
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
.sf-toggle-btn {
  margin-left: auto;
  appearance: none;
  border: 1px solid #c9a55c;
  background: #2c2410;
  color: #f0d7a2;
  font: inherit;
  font-weight: 600;
  font-size: 0.82rem;
  line-height: 1.2;
  padding: 0.4rem 0.95rem;
  border-radius: 8px;
  cursor: pointer;
  box-shadow: none;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;
}
.sf-toggle-btn:hover {
  border-color: #dfc07a;
  background: #3a3018;
  color: #f7e7c0;
}
.primary-btn {
  border: 1px solid #c9a55c;
  background: rgba(201, 165, 92, 0.16);
  color: #f0d7a2;
  font-weight: 600;
  padding: 0.4rem 0.95rem;
  border-radius: 8px;
  cursor: pointer;
}
.primary-btn:hover {
  background: rgba(201, 165, 92, 0.26);
  border-color: #dfc07a;
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
    min-height: 0;
  }
}
.col-head,
.col-foot {
  min-width: 0;
}
.col-head {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  align-items: stretch;
  justify-content: flex-start;
  margin: 0;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid #2a3038;
}
.col-head--library,
.col-head--prepared {
  min-height: 0;
}
.col-head h3 {
  margin: 0;
  font-size: 0.92rem;
  color: #e8edf5;
  line-height: 1.6rem;
  flex: 0 0 auto;
  white-space: nowrap;
}
.col-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-width: 0;
}
.col-title-actions {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex: 0 0 auto;
}
.col-head--library .col-title-row {
  gap: 0.55rem;
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
  line-height: 1.25;
}
.col-desc--compact {
  min-height: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
.search-input--inline {
  flex: 1 1 auto;
  min-width: 0;
  height: 1.75rem;
}
.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem 0.45rem;
  margin: 0;
  min-height: 0;
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
.chip-group.create-actions,
.chip-group + .chip-group.create-actions {
  padding-left: 0;
  border-left: none;
  margin-left: auto;
}
.col-head > .mini-btn {
  width: auto;
  height: 1.7rem;
  margin: 0;
}
.list-section-row .chip {
  padding: 0.14rem 0.45rem;
  font-size: 0.7rem;
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
  width: min(1040px, calc(100vw - 2.5rem));
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
  padding: 0.7rem 1.1rem 0.9rem;
  border-top: 1px solid #2a3038;
  background: #14181f;
  z-index: 2;
}
.skill-detail-foot .save-action {
  width: 100%;
  margin: 0;
  min-height: 2.2rem;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 600;
  letter-spacing: 0;
}
.skill-detail-foot .foot-hint {
  margin: 0;
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

.list-section-label {
  list-style: none;
  margin: 0.55rem 0 0.25rem;
  padding: 0.15rem 0.35rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #9aa3b0;
  letter-spacing: 0.02em;
}
.list-section-row {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.5rem;
  margin: 0.55rem 0 0.35rem;
  padding: 0 0.1rem;
}
.list-section-label-inline {
  flex: 0 0 auto;
  font-size: 0.75rem;
  font-weight: 600;
  color: #9aa3b0;
  letter-spacing: 0.02em;
}
.list-section-row .chip-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  min-width: 0;
}
.group-tune-panel {
  width: min(920px, 96vw);
}
.group-tune-list {
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.group-note-banner {
  margin: 0;
  padding: 0.55rem 0.7rem;
  border: 1px solid #c9a55c;
  border-radius: 8px;
  background: transparent;
  color: #e8edf5;
  font-size: 0.86rem;
  font-weight: 600;
  line-height: 1.45;
}
.group-total-mult {
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
  font-size: 0.82rem;
  color: #9aa3b0;
}
.group-total-mult strong {
  font-size: 1.05rem;
  font-weight: 800;
  color: #e8edf5;
  font-variant-numeric: tabular-nums;
}
.muted {
  color: #8b919c;
  font-size: 0.75rem;
}
.group-member-detail {
  border: 1px solid #2d323a;
  border-radius: 10px;
  padding: 0.75rem 0.85rem;
  display: grid;
  gap: 0.55rem;
  background: #0f1217;
}
.group-member-detail-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem 0.75rem;
}
.group-member-detail-head strong {
  font-size: 0.95rem;
}
.group-edit-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: center;
}
.group-edit-bar .field-input {
  flex: 1 1 12rem;
  min-width: 0;
}
.group-member-list {
  margin: 0;
  padding: 0;
}
.calc-member-picker {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.75rem;
  min-height: 280px;
}
.calc-member-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid #2a3038;
  border-radius: 10px;
  background: #12161d;
  overflow: hidden;
}
.calc-member-col-head {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.65rem 0.7rem;
  border-bottom: 1px solid #2a3038;
  background: #161a22;
}
.calc-member-col-head h4 {
  margin: 0;
  font-size: 0.88rem;
  color: #e8edf5;
}
.calc-member-list {
  list-style: none;
  margin: 0;
  padding: 0.55rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  overflow: auto;
  max-height: min(48vh, 420px);
}
.calc-member-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.45rem;
  padding: 0.5rem 0.55rem;
  border: 1px solid #2a3038;
  border-radius: 8px;
  background: #0f1217;
}
.calc-member-card--in {
  flex-direction: row;
  align-items: center;
  flex-wrap: nowrap;
  min-height: 2.15rem;
  padding: 0.28rem 0.45rem;
}
.calc-member-main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.45rem;
}
.calc-member-main strong,
.calc-member-name {
  display: inline-block;
  flex: 0 0 13em;
  width: 13em;
  min-width: 13em;
  max-width: 13em;
  font-size: 0.86rem;
  font-weight: 600;
  color: #e8edf5;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
.calc-member-count {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.28rem;
  font-size: 0.78rem;
  color: #9aa3b0;
  white-space: nowrap;
}
.calc-member-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 0.7rem;
  align-items: center;
  font-size: 0.78rem;
  color: #9aa3b0;
}
.calc-member-controls .narrow,
.calc-member-count .narrow {
  width: 2.75rem;
  min-height: 1.55rem;
  padding: 0.12rem 0.28rem;
  font-size: 0.78rem;
  line-height: 1.2;
}
.calc-member-actions {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.3rem;
  flex-shrink: 0;
  align-items: center;
}
.calc-member-card--in .calc-member-actions {
  width: auto;
  justify-content: flex-end;
  padding-top: 0;
  border-top: none;
}
.inline-check {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.field-input.narrow {
  width: 2.75rem;
  min-height: 1.55rem;
  padding: 0.12rem 0.28rem;
  font-size: 0.78rem;
  line-height: 1.2;
}
:global([data-theme='light']) .calc-member-col {
  border-color: #d7dde6;
  background: #f7f8fb;
}
:global([data-theme='light']) .calc-member-col-head {
  border-color: #e4e8ef;
  background: #fff;
}
:global([data-theme='light']) .calc-member-col-head h4,
:global([data-theme='light']) .calc-member-main strong,
:global([data-theme='light']) .calc-member-name {
  color: #2b3038;
}
:global([data-theme='light']) .calc-member-count {
  color: #5a6575;
}
:global([data-theme='light']) .calc-member-card {
  border-color: #d7dde6;
  background: #fff;
}
@media (max-width: 720px) {
  .calc-member-picker {
    grid-template-columns: minmax(0, 1fr);
  }
}
.field-block {
  display: grid;
  gap: 0.35rem;
  color: #c5cad4;
  font-size: 0.85rem;
}
.field-block .field-input,
.field-input {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid #2a3038;
  border-radius: 8px;
  background: #0f1217;
  color: #e8edf5;
  padding: 0.45rem 0.65rem;
  font: inherit;
}
.create-actions {
  margin-left: auto;
}

:global([data-theme='light']) .chip-group + .chip-group {
  border-left-color: #d0d6e0;
}
:global([data-theme='light']) .chip-group + .chip-group.create-actions {
  border-left: none;
}

:global([data-theme='light']) .sf-agent-tab {
  border-color: #cfd6e0;
  background: #fff;
  color: #3a4250;
}
:global([data-theme='light']) .sf-agent-tab.active {
  border-color: #b8923f;
  background: #fff8ea;
  color: #2b3038;
}
:global([data-theme='light']) .sf-agent-tab:hover {
  border-color: #b0b8c4;
}
:global([data-theme='light']) .sf-toggle-btn {
  background: #fff;
  color: #5a4630;
  border-color: #cfd6e0;
}
:global([data-theme='light']) .skill-flow-editor {
  background: #f7f8fb;
  border-color: #d7dde6;
}
:global([data-theme='light']) .skill-flow-modal-header {
  background: #fff;
  border-bottom: 1px solid #e4e8ef;
}
:global([data-theme='light']) .skill-flow-modal-header h2 {
  color: #2b3038;
}
:global([data-theme='light']) .modal-agent-row {
  background: #f7f8fb;
}
:global([data-theme='light']) .flow-summary-counts,
:global([data-theme='light']) .col-desc,
:global([data-theme='light']) .empty-hint,
:global([data-theme='light']) .list-section-label,
:global([data-theme='light']) .list-section-label-inline,
:global([data-theme='light']) .muted,
:global([data-theme='light']) .detail-section-title {
  color: #6a7382;
}
:global([data-theme='light']) .skill-detail-overlay {
  background: rgba(40, 48, 60, 0.35);
}
:global([data-theme='light']) .skill-detail-panel {
  background: #fff;
  border-color: #d7dde6;
  box-shadow: 0 18px 48px rgba(40, 48, 60, 0.18);
}
:global([data-theme='light']) .skill-detail-head,
:global([data-theme='light']) .skill-detail-foot {
  border-color: #e4e8ef;
  background: #f7f8fb;
}
:global([data-theme='light']) .skill-detail-head h3,
:global([data-theme='light']) .zone-display-val,
:global([data-theme='light']) .field-block {
  color: #2b3038;
}
:global([data-theme='light']) .skill-detail-body {
  background: #fff;
}
:global([data-theme='light']) .field-input,
:global([data-theme='light']) .group-member-detail,
:global([data-theme='light']) .zone-display-item {
  background: #f7f8fb;
  border-color: #d7dde6;
  color: #2b3038;
}
:global([data-theme='light']) .warn-hint {
  color: #b54747;
}
:global([data-theme='light']) .group-note-banner {
  border-color: #9a7318;
  background: transparent;
  color: #1a1f27;
  font-weight: 700;
}
:global([data-theme='light']) .group-total-mult {
  color: #3a4250;
}
:global([data-theme='light']) .group-total-mult strong {
  color: #12161d;
}
:global([data-theme='light']) .group-total-mult .muted {
  color: #5a6575;
}
:global([data-theme='light']) .close-btn {
  background: #fff;
  border-color: #d7dde6;
  color: #3a4250;
}
:global([data-theme='light']) .close-btn:hover {
  border-color: #b8923f;
  color: #2b3038;
}
:global([data-theme='light']) .primary-btn {
  color: #1a1407;
}
:global([data-theme='light']) .chip {
  border-color: #cfd6e0;
  background: #fff;
  color: #3a4250;
}
:global([data-theme='light']) .chip.active {
  border-color: #b8923f;
  background: #fff8ea;
  color: #2b3038;
}
:global([data-theme='light']) .col-head {
  border-bottom-color: #e4e8ef;
}
:global([data-theme='light']) .col-head h3 {
  color: #2b3038;
}
:global([data-theme='light']) .search-input,
:global([data-theme='light']) .custom-form input,
:global([data-theme='light']) .custom-form select,
:global([data-theme='light']) .agent-row select,
:global([data-theme='light']) .agent-row input {
  border-color: #d7dde6;
  background: #fff;
  color: #2b3038;
}
:global([data-theme='light']) .mini-btn {
  border-color: #cfd6e0;
  background: #fff;
  color: #3a4250;
}
:global([data-theme='light']) .mini-btn.danger {
  border-color: #e2b4b4;
  color: #b54747;
  background: #fff7f7;
}
:global([data-theme='light']) .order-btn {
  border-color: #cfd6e0;
  background: #fff;
  color: #3a4250;
}
:global([data-theme='light']) .modal-tab {
  color: #5a6575;
}
:global([data-theme='light']) .modal-tab.active {
  color: #2b3038;
  border-bottom-color: #b8923f;
}
:global([data-theme='light']) .modal-agent-tab {
  border-color: #cfd6e0;
  background: #fff;
  color: #3a4250;
}
:global([data-theme='light']) .modal-agent-tab.active {
  border-color: #b8923f;
  background: #fff8ea;
  color: #2b3038;
}
:global([data-theme='light']) .drag-toggle {
  color: #5a6575;
}
:global([data-theme='light']) .calc-member-controls {
  color: #5a6575;
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
