<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import SkillDefinitionForm from '@/components/calculator/SkillDefinitionForm.vue'
import AgentFuzzySelect from '@/components/admin/calculator/AgentFuzzySelect.vue'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import type {
  Skill,
  SkillDamageType,
  SkillGroup,
  SkillGroupMember,
  SkillTypeId,
} from '@/types/calculator'
import { DAMAGE_EVENT_KIND_OPTIONS } from '@/utils/damageEvent'
import { PUBLIC_ANOMALY_ELEMENTS } from '@/utils/publicAnomalySkills'
import { skillNeedsDualAgents } from '@/utils/resolvedHit'
import {
  resolveInherentSkillMultPercent,
  skillMultNeedsAnomalyPowerProvider,
  unsetSkillMult,
} from '@/utils/skillSubcategoryMult'
import { isCustomSkillGroup, sortSkillGroupMembers } from '@/utils/skillGroup'
import { SKILL_TYPE_OPTIONS } from '@/utils/skillTypes'

const store = useCalculatorBuffStore()
const { agents, presetSkills, skillSubcategories } = storeToRefs(store)
const presetSkillGroups = computed(() =>
  store.skillGroups.filter((item) => !isCustomSkillGroup(item)),
)

const message = ref('')
const error = ref('')
const saving = ref(false)
const selectedId = ref('')
const filterAgentId = ref('')
const listQuery = ref('')
/** 招式库内子区：普通招式 / 技能组 */
const libraryTab = ref<'skills' | 'groups'>('skills')

const form = ref({
  id: '',
  agentId: '',
  name: '',
  damageType: 'direct' as SkillDamageType,
  skillTypes: [] as SkillTypeId[],
  buffAnchorId: '' as string,
  baseMult: 0,
  baseMultFactor: 100,
  settlementMult: 0,
  element: '',
  ownerGroupId: '' as string,
  note: '',
})

const groupForm = ref({
  id: '',
  agentId: '',
  name: '',
  note: '',
  members: [] as SkillGroupMember[],
})

const memberModalOpen = ref(false)
const memberLibraryQuery = ref('')
const privateSkillFormOpen = ref(false)
const privateSkillDraft = ref({
  name: '',
  damageType: 'direct' as SkillDamageType,
  skillTypes: ['basic'] as SkillTypeId[],
  buffAnchorId: '',
  baseMult: 0,
  settlementMult: 0,
  note: '',
})

const sortedList = computed(() => {
  const q = listQuery.value.trim().toLowerCase()
  return [...presetSkills.value]
    .filter((item) => !item.ownerGroupId)
    .filter((item) => {
      if (!filterAgentId.value) return true
      if (filterAgentId.value === '__common__') return !item.agentId
      return item.agentId === filterAgentId.value
    })
    .filter((item) => {
      if (!q) return true
      return (
        item.name.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        (item.note ?? '').toLowerCase().includes(q) ||
        damageTypeLabel(item.damageType).toLowerCase().includes(q)
      )
    })
    .sort(
      (a, b) =>
        a.agentId.localeCompare(b.agentId) ||
        a.damageType.localeCompare(b.damageType) ||
        a.name.localeCompare(b.name),
    )
})

const sortedGroups = computed(() => {
  const q = listQuery.value.trim().toLowerCase()
  return [...presetSkillGroups.value]
    .filter((item) => {
      if (!filterAgentId.value) return true
      if (filterAgentId.value === '__common__') return !item.agentId
      return item.agentId === filterAgentId.value
    })
    .filter((item) => {
      if (!q) return true
      return (
        item.name.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        (item.note ?? '').toLowerCase().includes(q)
      )
    })
    .sort(
      (a, b) =>
        a.agentId.localeCompare(b.agentId) ||
        a.name.localeCompare(b.name, 'zh') ||
        a.id.localeCompare(b.id),
    )
})

const anchorOptions = computed(() =>
  skillSubcategories.value.filter(
    (item) => Boolean(item.agentId) && (!form.value.agentId || item.agentId === form.value.agentId),
  ),
)

const selectedAnchor = computed(
  () =>
    anchorOptions.value.find((item) => item.id === form.value.buffAnchorId) ??
    skillSubcategories.value.find((item) => item.id === form.value.buffAnchorId) ??
    null,
)

const formAgent = computed(
  () => agents.value.find((item) => item.id === form.value.agentId) ?? null,
)

const groupMemberSkillIds = computed(
  () => new Set(groupForm.value.members.map((m) => m.skillId)),
)

const groupSelectableSkills = computed(() => {
  const agentId = groupForm.value.agentId
  const groupId = selectedId.value || groupForm.value.id || '__new__'
  let list = store.skillsSelectableForGroup(agentId, groupId)
  const q = memberLibraryQuery.value.trim().toLowerCase()
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

const memberSkillName = (skillId: string) => {
  const fromPreset = presetSkills.value.find((item) => item.id === skillId)
  if (fromPreset) return fromPreset.name
  return store.findSkill(skillId)?.name ?? skillId
}

function applyAnchorMults(force: boolean) {
  const skipPrefill =
    form.value.damageType === 'disorder' || form.value.damageType === 'turbulence'
  const mult = skipPrefill
    ? null
    : resolveInherentSkillMultPercent({
        damageType: form.value.damageType,
        buffAnchorId: form.value.buffAnchorId,
        subcategory: selectedAnchor.value,
        agent: formAgent.value,
        element: form.value.element || formAgent.value?.element,
      })
  if (mult != null && (force || unsetSkillMult(form.value.baseMult))) {
    form.value.baseMult = mult
  } else if (force && mult == null) {
    form.value.baseMult = 0
  }
  if (form.value.damageType === 'direct' && selectedAnchor.value) {
    const settlement = Number(selectedAnchor.value.settlementDmgMult)
    if (!unsetSkillMult(settlement) && (force || unsetSkillMult(form.value.settlementMult))) {
      form.value.settlementMult = settlement
    }
  } else if (force && form.value.damageType !== 'direct') {
    form.value.settlementMult = 0
  }
}

function onDamageTypeUserChange(event: Event) {
  const next = (event.target as HTMLSelectElement).value as SkillDamageType
  form.value.damageType = next
  if (skillNeedsDualAgents(next)) form.value.skillTypes = []
  applyAnchorMults(true)
}

function onAnchorUserChange() {
  applyAnchorMults(true)
}

watch(
  () =>
    [
      form.value.buffAnchorId,
      form.value.damageType,
      selectedAnchor.value?.id ?? '',
      form.value.agentId,
      form.value.element,
      formAgent.value?.element ?? '',
    ] as const,
  () => applyAnchorMults(false),
  { immediate: true },
)

const baseMultPlaceholder = computed(() =>
  skillMultNeedsAnomalyPowerProvider(form.value.damageType)
    ? '等待选择异常强度提供者'
    : '可不填',
)

function agentName(id: string) {
  if (!id) return '公共'
  return agents.value.find((item) => item.id === id)?.name ?? id
}

function damageTypeLabel(id: string) {
  return DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === id)?.label ?? id
}

function resetForm() {
  form.value = {
    id: '',
    agentId: filterAgentId.value === '__common__' ? '' : filterAgentId.value,
    name: '',
    damageType: 'direct',
    skillTypes: [],
    buffAnchorId: '',
    baseMult: 0,
    baseMultFactor: 100,
    settlementMult: 0,
    element: '',
    ownerGroupId: '',
    note: '',
  }
  selectedId.value = ''
  message.value = ''
  error.value = ''
}

function resetGroupForm() {
  groupForm.value = {
    id: '',
    agentId: filterAgentId.value === '__common__' ? '' : filterAgentId.value,
    name: '',
    note: '',
    members: [],
  }
  selectedId.value = ''
  memberModalOpen.value = false
  memberLibraryQuery.value = ''
  message.value = ''
  error.value = ''
}

function selectItem(item: Skill) {
  libraryTab.value = 'skills'
  selectedId.value = item.id
  form.value = {
    id: item.id,
    agentId: item.agentId,
    name: item.name,
    damageType: item.damageType,
    skillTypes: [...item.skillTypes],
    buffAnchorId: item.buffAnchorId ?? '',
    baseMult: item.baseMult,
    baseMultFactor: item.baseMultFactor ?? 100,
    settlementMult: item.settlementMult ?? 0,
    element: item.element ?? '',
    ownerGroupId: item.ownerGroupId ?? '',
    note: item.note ?? '',
  }
}

function selectGroup(item: SkillGroup) {
  libraryTab.value = 'groups'
  selectedId.value = item.id
  groupForm.value = {
    id: item.id,
    agentId: item.agentId,
    name: item.name,
    note: item.note ?? '',
    members: sortSkillGroupMembers(item.members.map((m) => ({ ...m }))),
  }
}

function toggleSkillType(id: SkillTypeId) {
  const index = form.value.skillTypes.indexOf(id)
  if (index >= 0) form.value.skillTypes.splice(index, 1)
  else form.value.skillTypes.push(id)
}

function switchTab(tab: 'skills' | 'groups') {
  libraryTab.value = tab
  if (tab === 'skills') resetForm()
  else resetGroupForm()
}

function moveMember(index: number, delta: number) {
  const next = index + delta
  const list = groupForm.value.members
  if (next < 0 || next >= list.length) return
  const copy = [...list]
  const row = copy[index]
  if (!row) return
  copy.splice(index, 1)
  copy.splice(next, 0, row)
  groupForm.value.members = copy.map((item, i) => ({ ...item, order: i }))
}

function removeMember(index: number) {
  groupForm.value.members = groupForm.value.members
    .filter((_, i) => i !== index)
    .map((item, i) => ({ ...item, order: i }))
}

function addMemberSkill(skill: Skill) {
  // 同一招式可多次加入；顺序决定结算展开顺序
  groupForm.value.members = [
    ...groupForm.value.members,
    {
      skillId: skill.id,
      order: groupForm.value.members.length,
      count: 1,
      includeInFlow: true,
    },
  ]
}

async function createPrivateSkillInGroup() {
  if (!groupForm.value.agentId) {
    error.value = '请先为技能组选择角色，再创建组内招式'
    return
  }
  if (!selectedId.value) {
    error.value = '请先保存技能组，再创建组内招式'
    return
  }
  privateSkillDraft.value = {
    name: '',
    damageType: 'direct',
    skillTypes: ['basic'],
    buffAnchorId: '',
    baseMult: 0,
    settlementMult: 0,
    note: '',
  }
  privateSkillFormOpen.value = true
}

async function savePrivateSkillInGroup() {
  const name = privateSkillDraft.value.name.trim()
  if (!name) {
    error.value = '请填写招式名称'
    return
  }
  if (!groupForm.value.agentId || !selectedId.value) return
  try {
    const anomaly = skillNeedsDualAgents(privateSkillDraft.value.damageType)
    const saved = await store.upsertPresetSkillDoc({
      id: '',
      agentId: groupForm.value.agentId,
      name,
      source: 'preset',
      damageType: privateSkillDraft.value.damageType,
      skillTypes: anomaly ? [] : [...privateSkillDraft.value.skillTypes],
      buffAnchorId: privateSkillDraft.value.buffAnchorId || null,
      baseMult: Number(privateSkillDraft.value.baseMult) || 0,
      baseMultFactor: 100,
      settlementMult: Number(privateSkillDraft.value.settlementMult) || 0,
      element: agents.value.find((a) => a.id === groupForm.value.agentId)?.element ?? '',
      ownerGroupId: selectedId.value,
      note: privateSkillDraft.value.note.trim() || undefined,
    })
    groupForm.value.members = [
      ...groupForm.value.members,
      {
        skillId: saved.id,
        order: groupForm.value.members.length,
        count: 1,
        includeInFlow: true,
      },
    ]
    privateSkillFormOpen.value = false
    message.value = `已创建组内招式「${saved.name}」`
  } catch (err) {
    error.value = err instanceof Error ? err.message : '创建组内招式失败'
  }
}

async function deletePrivateMemberSkill(skillId: string) {
  const skill = presetSkills.value.find((item) => item.id === skillId)
  if (!skill?.ownerGroupId || skill.ownerGroupId !== selectedId.value) return
  if (!window.confirm(`确认删除组内招式「${skill.name}」？定义会一并删除。`)) return
  try {
    await store.removePresetSkillDoc(skillId)
    groupForm.value.members = groupForm.value.members
      .filter((item) => item.skillId !== skillId)
      .map((item, i) => ({ ...item, order: i }))
    message.value = `已删除「${skill.name}」`
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除失败'
  }
}

function memberIsPrivate(skillId: string) {
  const skill = presetSkills.value.find((item) => item.id === skillId)
  return Boolean(skill?.ownerGroupId && skill.ownerGroupId === selectedId.value)
}

const privateSkillAnchors = computed(() =>
  skillSubcategories.value.filter((item) => item.agentId === groupForm.value.agentId),
)

const privateSkillAgent = computed(
  () => agents.value.find((item) => item.id === groupForm.value.agentId) ?? null,
)

async function saveItem() {
  message.value = ''
  error.value = ''
  const name = form.value.name.trim()
  if (!name) {
    error.value = '名称为必填项'
    return
  }
  saving.value = true
  try {
    const anomaly = skillNeedsDualAgents(form.value.damageType)
    const saved = await store.upsertPresetSkillDoc({
      id: selectedId.value || '',
      agentId: form.value.agentId,
      name,
      source: 'preset',
      damageType: form.value.damageType,
      skillTypes: anomaly ? [] : [...form.value.skillTypes],
      buffAnchorId: form.value.buffAnchorId || null,
      baseMult: Number(form.value.baseMult) || 0,
      baseMultFactor: Number(form.value.baseMultFactor) || 100,
      settlementMult: Number(form.value.settlementMult) || 0,
      element: form.value.element,
      ownerGroupId: form.value.ownerGroupId || null,
      note: form.value.note.trim() || undefined,
    })
    selectedId.value = saved.id
    form.value.id = saved.id
    message.value = '已保存招式'
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function saveGroup() {
  message.value = ''
  error.value = ''
  const name = groupForm.value.name.trim()
  if (!name) {
    error.value = '技能组名称为必填项'
    return
  }
  saving.value = true
  try {
    const saved = await store.upsertPresetSkillGroupDoc({
      id: selectedId.value || '',
      agentId: groupForm.value.agentId,
      name,
      note: groupForm.value.note,
      members: sortSkillGroupMembers(
        groupForm.value.members.map((m, i) => ({
          ...m,
          order: i,
          count: Math.max(0, Number(m.count) || 0),
          includeInFlow: true,
        })),
      ),
    })
    selectedId.value = saved.id
    groupForm.value.id = saved.id
    groupForm.value.members = sortSkillGroupMembers(saved.members.map((m) => ({ ...m })))
    message.value = '已保存技能组'
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function removeItem() {
  if (!selectedId.value) return
  if (libraryTab.value === 'groups') {
    if (!window.confirm(`确认删除技能组「${groupForm.value.name || selectedId.value}」？组内私有招式也会删除。`))
      return
    try {
      // 管理端只维护预设；若误选到自建组，改走本机删除
      const existing = store.findSkillGroup(selectedId.value)
      if (existing && isCustomSkillGroup(existing)) {
        store.removeCustomSkillGroupDoc(selectedId.value)
      } else {
        await store.removePresetSkillGroupDoc(selectedId.value)
      }
      resetGroupForm()
      message.value = '已删除技能组'
    } catch (err) {
      error.value = err instanceof Error ? err.message : '删除失败'
    }
    return
  }
  if (!window.confirm(`确认删除招式「${form.value.name || selectedId.value}」？`)) return
  try {
    await store.removePresetSkillDoc(selectedId.value)
    resetForm()
    message.value = '已删除'
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除失败'
  }
}

async function saveCurrent() {
  if (libraryTab.value === 'groups') return saveGroup()
  return saveItem()
}

defineExpose({
  selectedId,
  saving,
  saveItem: saveCurrent,
  removeItem,
})
</script>

<template>
  <div class="editor-panel">
    <header class="panel-header admin-skill-head">
      <div class="admin-skill-head-row">
        <h1 class="panel-title">招式库</h1>
        <div class="tab-row" role="tablist" aria-label="招式库分区">
          <button
            type="button"
            class="tab-btn"
            :class="{ active: libraryTab === 'skills' }"
            @click="switchTab('skills')"
          >
            招式
          </button>
          <button
            type="button"
            class="tab-btn"
            :class="{ active: libraryTab === 'groups' }"
            @click="switchTab('groups')"
          >
            技能组
          </button>
        </div>
      </div>
      <div class="admin-skill-toolbar">
        <label class="field admin-skill-filter">
          <span class="field-label">角色</span>
          <AgentFuzzySelect v-model="filterAgentId" :agents="agents" empty-label="全部角色" />
        </label>
        <label class="field admin-skill-search">
          <span class="field-label">搜索</span>
          <input
            v-model="listQuery"
            class="field-input"
            type="search"
            :placeholder="libraryTab === 'skills' ? '招式名 / 备注 / ID' : '组名 / 备注 / ID'"
          />
        </label>
      </div>
    </header>

    <div class="editor-layout">
      <aside class="item-list">
        <button
          v-if="libraryTab === 'skills'"
          type="button"
          class="secondary-btn"
          @click="resetForm"
        >
          + 新建招式
        </button>
        <button v-else type="button" class="secondary-btn" @click="resetGroupForm">
          + 新建技能组
        </button>
        <div class="list-scroll">
          <template v-if="libraryTab === 'skills'">
            <button
              v-for="item in sortedList"
              :key="item.id"
              type="button"
              class="list-item"
              :class="{ active: selectedId === item.id }"
              @click="selectItem(item)"
            >
              <span class="list-name">{{ item.name }}</span>
              <span class="list-meta">
                {{ agentName(item.agentId) }} · {{ damageTypeLabel(item.damageType)
                }}{{ item.element ? ` · ${item.element}` : ''
                }}{{ item.note?.trim() ? ` · ${item.note.trim()}` : '' }}
              </span>
            </button>
            <p v-if="!sortedList.length" class="list-empty-hint">没有匹配的招式。</p>
          </template>
          <template v-else>
            <button
              v-for="item in sortedGroups"
              :key="item.id"
              type="button"
              class="list-item"
              :class="{ active: selectedId === item.id }"
              @click="selectGroup(item)"
            >
              <span class="list-name"
                ><span class="group-badge">组</span>{{ item.name }}</span
              >
              <span class="list-meta">
                {{ agentName(item.agentId) }} · {{ item.members.length }} 段
                {{ item.note?.trim() ? ` · ${item.note.trim()}` : '' }}
              </span>
            </button>
            <p v-if="!sortedGroups.length" class="list-empty-hint">没有匹配的技能组。</p>
          </template>
        </div>
      </aside>

      <form
        v-if="libraryTab === 'skills'"
        class="editor-form"
        @submit.prevent="saveItem"
      >
        <section class="mindscape-section">
          <header class="mindscape-header">
            <h3>{{ selectedId ? '编辑招式' : '新建招式' }}</h3>
          </header>
          <div class="field-row">
            <label class="field">
              <span class="field-label">角色</span>
              <AgentFuzzySelect v-model="form.agentId" :agents="agents" empty-label="公共招式" />
            </label>
            <label class="field">
              <span class="field-label">伤害类型 *</span>
              <select
                :value="form.damageType"
                class="field-input"
                @change="onDamageTypeUserChange"
              >
                <option v-for="opt in DAMAGE_EVENT_KIND_OPTIONS" :key="opt.id" :value="opt.id">
                  {{ opt.label }}
                </option>
              </select>
            </label>
          </div>
          <div class="field-row">
            <label class="field">
              <span class="field-label">招式名称 *</span>
              <input v-model="form.name" class="field-input" placeholder="显示名称" />
            </label>
            <label class="field">
              <span class="field-label">备注</span>
              <input
                v-model="form.note"
                class="field-input"
                type="text"
                maxlength="80"
                placeholder="计算页行上悬停可见"
              />
            </label>
            <label class="field">
              <span class="field-label">元素</span>
              <select v-model="form.element" class="field-input">
                <option value="">不限定</option>
                <option v-for="el in PUBLIC_ANOMALY_ELEMENTS" :key="el" :value="el">
                  {{ el }}
                </option>
              </select>
            </label>
          </div>
          <label v-if="form.id" class="field">
            <span class="field-label">ID（自动）</span>
            <input :value="form.id" class="field-input" readonly />
          </label>
          <div v-if="!skillNeedsDualAgents(form.damageType)" class="type-checks">
            <span class="field-label">招式类型（可多选，可空）</span>
            <label v-for="opt in SKILL_TYPE_OPTIONS" :key="opt.id" class="check">
              <input
                type="checkbox"
                :checked="form.skillTypes.includes(opt.id)"
                @change="toggleSkillType(opt.id)"
              />
              {{ opt.label }}
            </label>
          </div>
          <p v-else class="field-hint">异常类不设招式类型；可选增益锚点以命中招式限定 Buff。</p>
          <label class="field">
            <span class="field-label">增益锚点（仅本角色）</span>
            <select
              v-model="form.buffAnchorId"
              class="field-input"
              @change="onAnchorUserChange"
            >
              <option value="">无</option>
              <option v-for="item in anchorOptions" :key="item.id" :value="item.id">
                {{ item.name }}
              </option>
            </select>
          </label>
          <div class="field-row">
            <label class="field">
              <span class="field-label">倍率%</span>
              <input
                v-model.number="form.baseMult"
                class="field-input"
                type="number"
                step="any"
                :placeholder="baseMultPlaceholder"
              />
            </label>
            <label class="field">
              <span class="field-label">倍率修正%</span>
              <input
                v-model.number="form.baseMultFactor"
                class="field-input"
                type="number"
                step="any"
              />
            </label>
            <label v-if="form.damageType === 'direct'" class="field">
              <span class="field-label">决算倍率%</span>
              <input
                v-model.number="form.settlementMult"
                class="field-input"
                type="number"
                step="any"
                placeholder="可不填"
              />
            </label>
          </div>
        </section>

        <p v-if="message" class="form-ok">{{ message }}</p>
        <p v-if="error" class="form-error">{{ error }}</p>
        <div class="form-actions">
          <button type="submit" class="primary-btn" :disabled="saving">
            {{ saving ? '保存中…' : selectedId ? '保存修改' : '创建招式' }}
          </button>
          <button type="button" class="secondary-btn" :disabled="saving" @click="resetForm">
            清空表单
          </button>
          <button
            type="button"
            class="danger-btn"
            :disabled="!selectedId || saving"
            @click="removeItem"
          >
            删除
          </button>
        </div>
      </form>

      <form v-else class="editor-form" @submit.prevent="saveGroup">
        <section class="mindscape-section">
          <header class="mindscape-header">
            <h3>{{ selectedId ? '编辑技能组' : '新建技能组' }}</h3>
          </header>
          <div class="field-row">
            <label class="field">
              <span class="field-label">角色</span>
              <AgentFuzzySelect
                v-model="groupForm.agentId"
                :agents="agents"
                empty-label="公共组"
              />
            </label>
            <label class="field">
              <span class="field-label">组名称 *</span>
              <input v-model="groupForm.name" class="field-input" placeholder="如：血华誓·锻星" />
            </label>
          </div>
          <label class="field">
            <span class="field-label">备注</span>
            <input v-model="groupForm.note" class="field-input" placeholder="可选" />
          </label>
          <label v-if="groupForm.id" class="field">
            <span class="field-label">ID</span>
            <input :value="groupForm.id" class="field-input" readonly />
          </label>

          <div class="members-head">
            <h4>成员（{{ groupForm.members.length }}）</h4>
            <button type="button" class="secondary-btn" @click="memberModalOpen = true">
              编辑成员
            </button>
          </div>
          <ul v-if="groupForm.members.length" class="member-preview">
            <li v-for="(m, i) in groupForm.members" :key="`${m.order}-${m.skillId}`">
              {{ i + 1 }}. {{ memberSkillName(m.skillId) }}
              · ×{{ m.count }}
            </li>
          </ul>
          <p v-else class="field-hint">尚未添加成员。可点「编辑成员」引用招式或创建组内招式。</p>
        </section>

        <p v-if="message" class="form-ok">{{ message }}</p>
        <p v-if="error" class="form-error">{{ error }}</p>
        <div class="form-actions">
          <button type="submit" class="primary-btn" :disabled="saving">
            {{ saving ? '保存中…' : selectedId ? '保存技能组' : '创建技能组' }}
          </button>
          <button
            type="button"
            class="secondary-btn"
            :disabled="saving"
            @click="resetGroupForm"
          >
            清空表单
          </button>
          <button
            type="button"
            class="danger-btn"
            :disabled="!selectedId || saving"
            @click="removeItem"
          >
            删除
          </button>
        </div>
      </form>
    </div>

    <div v-if="memberModalOpen" class="modal-mask" @click.self="memberModalOpen = false">
      <div class="modal-card member-picker" role="dialog" aria-label="编辑技能组成员">
        <header class="modal-head">
          <h3>编辑成员 · {{ groupForm.name || '未命名组' }}</h3>
          <div class="modal-head-actions">
            <button type="button" class="secondary-btn" @click="createPrivateSkillInGroup">
              组内新建
            </button>
            <button type="button" class="secondary-btn" @click="memberModalOpen = false">完成</button>
          </div>
        </header>
        <p class="member-picker-hint">
          仅可选管理端预设招式（不含计算页自建）。同一招式可多次加入；公共属性异常只显示本角色属性。右侧调次数与顺序。
        </p>
        <div class="member-picker-grid">
          <section class="member-col">
            <header class="member-col-head">
              <h4>普通招式</h4>
              <input
                v-model="memberLibraryQuery"
                class="field-input"
                type="search"
                placeholder="搜索招式名"
              />
              <p class="member-col-desc">点加入进组；组内私有可直接删除。</p>
            </header>
            <ul class="member-card-list">
              <li v-for="sk in groupSelectableSkills" :key="sk.id" class="member-card">
                <div class="member-card-main">
                  <span class="member-card-name" :title="sk.name">{{ sk.name }}</span>
                  <span class="member-card-meta">
                    {{ damageTypeLabel(sk.damageType)
                    }}{{ sk.ownerGroupId ? ' · 组内私有' : '' }}{{ sk.element ? ` · ${sk.element}` : '' }}
                  </span>
                </div>
                <div class="member-card-actions">
                  <button type="button" class="mini-btn" @click="addMemberSkill(sk)">
                    {{ groupMemberSkillIds.has(sk.id) ? '再加一条' : '加入' }}
                  </button>
                  <button
                    v-if="memberIsPrivate(sk.id)"
                    type="button"
                    class="mini-btn danger"
                    @click="deletePrivateMemberSkill(sk.id)"
                  >
                    删除
                  </button>
                </div>
              </li>
              <li v-if="!groupSelectableSkills.length" class="member-empty">
                {{
                  !groupForm.agentId
                    ? '请先为技能组选择角色。'
                    : memberLibraryQuery.trim()
                      ? '当前筛选没有可加入的招式。'
                      : '没有可加入的管理端招式。'
                }}
              </li>
            </ul>
          </section>

          <section class="member-col">
            <header class="member-col-head">
              <h4>技能组内（{{ groupForm.members.length }}）</h4>
              <p class="member-col-desc">组内顺序即结算展开顺序；同一招式可出现多段。</p>
            </header>
            <ul class="member-card-list">
              <li
                v-for="(m, index) in groupForm.members"
                :key="`${m.skillId}-${index}`"
                class="member-card member-card--in-group"
              >
                <div class="member-card-main">
                  <span class="member-card-name" :title="memberSkillName(m.skillId)">
                    {{ index + 1 }}. {{ memberSkillName(m.skillId) }}
                  </span>
                  <label class="inline-field">
                    次数
                    <input
                      v-model.number="m.count"
                      class="field-input narrow"
                      type="number"
                      min="0"
                      step="1"
                    />
                  </label>
                </div>
                <div class="member-card-actions">
                  <button
                    type="button"
                    class="order-btn"
                    title="上移"
                    :disabled="index === 0"
                    @click="moveMember(index, -1)"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    class="order-btn"
                    title="下移"
                    :disabled="index === groupForm.members.length - 1"
                    @click="moveMember(index, 1)"
                  >
                    ▼
                  </button>
                  <button type="button" class="mini-btn danger" @click="removeMember(index)">
                    移除
                  </button>
                  <button
                    v-if="memberIsPrivate(m.skillId)"
                    type="button"
                    class="mini-btn danger"
                    @click="deletePrivateMemberSkill(m.skillId)"
                  >
                    删除招式
                  </button>
                </div>
              </li>
              <li v-if="!groupForm.members.length" class="member-empty">还没有成员。从左侧加入。</li>
            </ul>
          </section>
        </div>
      </div>
    </div>

    <div
      v-if="privateSkillFormOpen"
      class="modal-mask"
      @click.self="privateSkillFormOpen = false"
    >
      <div class="modal-card" role="dialog" aria-label="组内新建招式">
        <header class="modal-head">
          <h3>组内新建招式</h3>
          <button type="button" class="secondary-btn" @click="privateSkillFormOpen = false">
            取消
          </button>
        </header>
        <p class="member-picker-hint">与普通招式新建相同；保存后自动加入本组并标记为组内私有。</p>
        <div class="private-skill-body">
          <SkillDefinitionForm
            v-model="privateSkillDraft"
            appearance="light"
            :anchors="privateSkillAnchors"
            :agent="privateSkillAgent"
          />
        </div>
        <div class="private-skill-foot">
          <button type="button" class="primary-btn private-skill-save" @click="savePrivateSkillInGroup">
            保存并加入组
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="./adminCalculatorPanel.css"></style>
<style scoped>
.type-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.8rem;
  margin: 0.5rem 0 0.75rem;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.82rem;
}
.field-hint {
  margin: 0.35rem 0 0.6rem;
  font-size: 0.8rem;
  color: #8b919c;
}
.tab-row {
  display: flex;
  gap: 0.35rem;
  align-items: end;
}
.tab-btn {
  border: 1px solid #d0d4dc;
  background: #fff;
  border-radius: 6px;
  padding: 0.35rem 0.75rem;
  cursor: pointer;
}
.tab-btn.active {
  border-color: #3d7eff;
  color: #1a4fb8;
  background: #eef4ff;
}
.admin-skill-head {
  text-align: left;
  margin-bottom: 0.85rem;
}
.admin-skill-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.55rem;
}
.admin-skill-head .panel-title {
  margin: 0;
  font-size: 1.35rem;
}
.admin-skill-toolbar {
  display: grid;
  grid-template-columns: minmax(12rem, 16rem) minmax(0, 1fr);
  gap: 0.65rem 0.85rem;
  align-items: end;
}
.admin-skill-filter,
.admin-skill-search {
  margin: 0;
}
.list-empty-hint {
  margin: 0.55rem 0.2rem;
  font-size: 0.8rem;
  color: #8b919c;
  text-align: center;
}
.group-badge {
  display: inline-block;
  margin-right: 0.35rem;
  padding: 0 0.3rem;
  border-radius: 4px;
  font-size: 0.7rem;
  background: #e8f0ff;
  color: #2a5db0;
  vertical-align: middle;
}
.members-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0.75rem 0 0.35rem;
}
.members-head h4 {
  margin: 0;
  font-size: 0.95rem;
}
.member-preview {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.85rem;
  color: #4a5060;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 24, 32, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 80;
}
.modal-card {
  width: min(1100px, 96vw);
  max-height: 88vh;
  overflow: auto;
  background: #fff;
  border-radius: 10px;
  padding: 1rem 1.1rem;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
}
.modal-head,
.modal-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.modal-head-actions {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.modal-head h3 {
  margin: 0;
  font-size: 1rem;
}
.member-picker-hint {
  margin: 0.45rem 0 0.75rem;
  font-size: 0.8rem;
  color: #6b7280;
}
.member-picker-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.85rem;
  align-items: stretch;
  min-height: 420px;
}
.member-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid #e6e8ee;
  border-radius: 10px;
  background: #f7f8fa;
  overflow: hidden;
}
.member-col-head {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.7rem 0.75rem 0.55rem;
  border-bottom: 1px solid #e6e8ee;
  background: #fff;
}
.member-col-head h4 {
  margin: 0;
  font-size: 0.92rem;
  color: #1f2937;
}
.member-col-desc {
  margin: 0;
  font-size: 0.75rem;
  color: #8b919c;
}
.member-card-list {
  list-style: none;
  margin: 0;
  padding: 0.55rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  overflow-y: auto;
  max-height: min(56vh, 520px);
}
.member-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.55rem;
  padding: 0.55rem 0.6rem;
  border: 1px solid #e6e8ee;
  border-radius: 8px;
  background: #fff;
}
.member-card--in-group {
  flex-direction: row;
  align-items: center;
  flex-wrap: nowrap;
}
.member-card-main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.45rem;
}
.member-card-name {
  display: inline-block;
  flex: 0 0 13em;
  width: 13em;
  min-width: 13em;
  max-width: 13em;
  font-size: 0.86rem;
  font-weight: 600;
  color: #1f2937;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
.member-card-meta {
  font-size: 0.72rem;
  color: #8b919c;
}
.member-card-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 0.75rem;
  align-items: center;
}
.member-card-actions {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.3rem;
  flex-shrink: 0;
  align-items: center;
}
.member-card--in-group .member-card-actions {
  justify-content: flex-end;
  padding-top: 0;
  border-top: none;
}
.inline-field {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.78rem;
  color: #4b5563;
}
.inline-check {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.78rem;
  color: #4b5563;
}
.mini-btn {
  border: 1px solid #d0d4dc;
  background: #fff;
  border-radius: 6px;
  padding: 0.22rem 0.5rem;
  font-size: 0.78rem;
  cursor: pointer;
  color: #1f2937;
}
.mini-btn:hover {
  border-color: #3d7eff;
  color: #1a4fb8;
}
.mini-btn.danger {
  color: #b42318;
  border-color: #f0c2bd;
}
.order-btn {
  border: 1px solid #d0d4dc;
  background: #fff;
  border-radius: 6px;
  width: 1.7rem;
  height: 1.5rem;
  line-height: 1;
  cursor: pointer;
  font-size: 0.7rem;
}
.order-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.member-empty {
  margin: 0.35rem 0.2rem;
  padding: 0.75rem 0.4rem;
  text-align: center;
  font-size: 0.8rem;
  color: #8b919c;
}
.narrow {
  width: 2.75rem;
  min-height: 1.55rem;
  padding: 0.12rem 0.28rem;
  font-size: 0.78rem;
  line-height: 1.2;
}
.private-skill-body {
  max-height: min(58vh, 520px);
  overflow: auto;
  padding-right: 0.15rem;
}
.private-skill-foot {
  margin-top: 0.85rem;
  padding-top: 0.75rem;
  border-top: 1px solid #e6e8ee;
}
.private-skill-save {
  width: 100%;
  min-height: 2.2rem;
  font-weight: 600;
  font-size: 0.88rem;
  border: 1px solid #c9d4b8;
  background: #f3f7ee;
  color: #3d4f2f;
  border-radius: 8px;
}
.private-skill-save:hover {
  border-color: #c9a55c;
  background: #fff8eb;
  color: #5c4818;
}
@media (max-width: 800px) {
  .member-picker-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
