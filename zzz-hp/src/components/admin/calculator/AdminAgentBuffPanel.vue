<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import AdminBuffStatFieldGrid from '@/components/admin/calculator/AdminBuffStatFieldGrid.vue'
import AdminCalculatorAvatarField from '@/components/admin/calculator/AdminCalculatorAvatarField.vue'
import AdminNumericStatFieldGrid from '@/components/admin/calculator/AdminNumericStatFieldGrid.vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import type { AgentBasePanel, AgentBuffDoc, AgentMindscapeRankBuffs, SupportStatNeed } from '@/types/calculator'
import type { AgentBuffEditSectionId } from '@/constants/agentBuffEditNav'
import {
  AGENT_BASE_PANEL_FIELDS,
  AGENT_ELEMENTS,
  AGENT_MINDSCAPE_RANKS,
  AGENT_ROLES,
  createEmptyAgentBasePanel,
  createEmptyMindscapeBuffs,
  createEmptyMindscapeNotes,
  createEmptySelfTeamBuffs,
  defaultAnomalyMultByElement,
  defaultDisorderStats,
  defaultTurbulenceStats,
  normalizeMindscapeNotes,
  SUPPORT_STAT_OPTIONS,
} from '@/utils/calculatorUi'

const store = useCalculatorBuffStore()
const { agents } = storeToRefs(store)

const search = ref('')
const roleFilter = ref('')
const selectedId = ref(agents.value[0]?.id ?? '')
const message = ref('')
const error = ref('')
const saving = ref(false)
const activeMindscapeRank = ref(0)
const avatarFieldRef = ref<InstanceType<typeof AdminCalculatorAvatarField> | null>(null)

const form = ref({
  id: '',
  name: '',
  profession: '',
  element: '',
  note: '',
  basePanel: createEmptyAgentBasePanel(),
  supportNeeds: [] as SupportStatNeed[],
  mindscapeForm: createEmptyMindscapeBuffs(),
  mindscapeNotes: createEmptyMindscapeNotes(),
})

const filteredAgents = computed(() => {
  const keyword = search.value.trim()
  return agents.value.filter((item) => {
    const bySearch = !keyword || `${item.name}${item.profession}${item.element}${item.id}`.includes(keyword)
    const byRole = !roleFilter.value || item.profession === roleFilter.value
    return bySearch && byRole
  })
})

const activeMindscapeForm = computed(() => form.value.mindscapeForm[activeMindscapeRank.value]!)
const activeMindscapeNote = computed({
  get: () => form.value.mindscapeNotes[activeMindscapeRank.value] ?? '',
  set: (value: string) => {
    form.value.mindscapeNotes[activeMindscapeRank.value] = value
  },
})

function loadMindscapeForm(mindscapeBuffs: AgentBuffDoc['mindscapeBuffs']) {
  return AGENT_MINDSCAPE_RANKS.map((_, index) => {
    const rank = mindscapeBuffs[index] ?? createEmptySelfTeamBuffs()
    return {
      selfMods: { ...rank.selfMods },
      teamMods: { ...rank.teamMods },
    }
  })
}

function loadForm(agent: AgentBuffDoc) {
  form.value = {
    id: agent.id,
    name: agent.name,
    profession: agent.profession,
    element: agent.element,
    note: agent.note ?? '',
    basePanel: { ...agent.basePanel },
    supportNeeds: [...agent.supportNeeds],
    mindscapeForm: loadMindscapeForm(agent.mindscapeBuffs),
    mindscapeNotes: normalizeMindscapeNotes(agent.mindscapeNotes),
  }
  activeMindscapeRank.value = 0
  void nextTick(() => {
    avatarFieldRef.value?.setAvatarImage(agent.avatar_image)
  })
}

function resetForm() {
  form.value = {
    id: '',
    name: '',
    profession: '',
    element: '',
    note: '',
    basePanel: createEmptyAgentBasePanel(),
    supportNeeds: [],
    mindscapeForm: createEmptyMindscapeBuffs(),
    mindscapeNotes: createEmptyMindscapeNotes(),
  }
  activeMindscapeRank.value = 0
  selectedId.value = ''
  avatarFieldRef.value?.clearAvatarImage()
}

function selectAgent(id: string) {
  selectedId.value = id
  const agent = agents.value.find((item) => item.id === id)
  if (agent) loadForm(agent)
}

function createNew() {
  resetForm()
}

function toggleSupportNeed(stat: SupportStatNeed) {
  const index = form.value.supportNeeds.indexOf(stat)
  if (index >= 0) {
    form.value.supportNeeds.splice(index, 1)
    return
  }
  form.value.supportNeeds.push(stat)
}

function onElementChange() {
  form.value.basePanel.anomalyMult = defaultAnomalyMultByElement(form.value.element)
  const agentKey = `${form.value.id} ${form.value.name}`
  const disorder = defaultDisorderStats(form.value.element, agentKey)
  const turbulence = defaultTurbulenceStats(form.value.element, agentKey)
  form.value.basePanel.disorderBaseMult = disorder.disorderBaseMult
  form.value.basePanel.anomalyDuration = disorder.anomalyDuration
  form.value.basePanel.disorderCompMult = disorder.disorderCompMult
  form.value.basePanel.turbulenceBaseMult = turbulence.turbulenceBaseMult
  form.value.basePanel.turbulenceCompMult = turbulence.turbulenceCompMult
}

function buildMindscapeBuffs(): AgentMindscapeRankBuffs[] {
  return form.value.mindscapeForm.map((rank) => ({
    selfMods: { ...rank.selfMods },
    teamMods: { ...rank.teamMods },
  }))
}

async function saveAgent() {
  message.value = ''
  error.value = ''

  const id = form.value.id.trim()
  const name = form.value.name.trim()
  if (!id || !name) {
    error.value = 'ID 与名称为必填项'
    return
  }

  const isEditing = Boolean(selectedId.value)
  if (!isEditing && agents.value.some((item) => item.id === id)) {
    error.value = '该 ID 已存在'
    return
  }
  if (isEditing && selectedId.value !== id && agents.value.some((item) => item.id === id)) {
    error.value = '新 ID 已被其他角色占用'
    return
  }

  saving.value = true
  try {
    const avatar_image = (await avatarFieldRef.value?.resolveAvatarImageOnSave()) ?? null
    const doc: AgentBuffDoc = {
      id,
      name,
      profession: form.value.profession.trim(),
      element: form.value.element.trim(),
      supportNeeds: [...form.value.supportNeeds],
      avatar_image,
      note: form.value.note.trim(),
      basePanel: { ...form.value.basePanel } as AgentBasePanel,
      mindscapeNotes: form.value.mindscapeNotes.map((item) => item.trim()),
      mindscapeBuffs: buildMindscapeBuffs(),
    }

    if (isEditing && selectedId.value !== id) {
      await store.deleteAgent(selectedId.value)
    }

    await store.upsertAgent(doc)
    selectedId.value = id
    message.value = isEditing ? `已保存角色「${name}」` : `已新增角色「${name}」`
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function removeAgent() {
  if (!selectedId.value) return
  const current = agents.value.find((item) => item.id === selectedId.value)
  if (!current) return
  if (!window.confirm(`确定删除角色「${current.name}」吗？`)) return

  try {
    await store.deleteAgent(selectedId.value)
    message.value = `已删除角色「${current.name}」`
    const next = agents.value[0]
    if (next) {
      selectAgent(next.id)
    } else {
      resetForm()
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除失败'
  }
}

watch(
  agents,
  (list) => {
    if (!list.length) {
      resetForm()
      return
    }
    if (!selectedId.value || !list.some((item) => item.id === selectedId.value)) {
      selectAgent(list[0]!.id)
    }
  },
  { immediate: true },
)

const panelRootRef = ref<HTMLElement | null>(null)

async function scrollToSection(sectionId: AgentBuffEditSectionId) {
  await nextTick()
  const target = panelRootRef.value?.querySelector<HTMLElement>(`#${sectionId}`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

defineExpose({ scrollToSection, saveAgent, removeAgent, selectedId, saving })
</script>

<template>
  <div ref="panelRootRef" class="editor-panel">
    <header class="panel-header">
      <h1 class="panel-title">编辑角色增益</h1>
      <p class="panel-desc">影画增益使用固定数值条目，主副定位在伤害计算时选择。</p>
    </header>

    <div class="editor-layout">
      <aside id="admin-agent-picker" class="item-list editor-anchor">
        <label class="field">
          <span class="field-label">搜索角色</span>
          <input v-model="search" type="text" class="field-input" placeholder="名称 / 职业 / 属性" />
        </label>
        <label class="field">
          <span class="field-label">职业筛选</span>
          <select v-model="roleFilter" class="field-input">
            <option value="">全部职业</option>
            <option v-for="profession in AGENT_ROLES" :key="profession" :value="profession">
              {{ profession }}
            </option>
          </select>
        </label>

        <button type="button" class="secondary-btn" @click="createNew">+ 新增角色</button>

        <div class="list-scroll">
          <button
            v-for="agent in filteredAgents"
            :key="agent.id"
            type="button"
            class="list-item"
            :class="{ active: selectedId === agent.id }"
            @click="selectAgent(agent.id)"
          >
            <CalculatorAvatar :avatar-image="agent.avatar_image" :name="agent.name" />
            <span class="list-name">{{ agent.name }}</span>
            <span class="list-meta">{{ agent.profession }} · {{ agent.element }}</span>
          </button>
        </div>
      </aside>

      <form class="editor-form" @submit.prevent="saveAgent">
        <div id="admin-agent-basic" class="editor-anchor">
        <div class="field-row">
          <label class="field">
            <span class="field-label">ID *</span>
            <input v-model="form.id" type="text" class="field-input" placeholder="如 anby" />
          </label>
          <label class="field">
            <span class="field-label">名称 *</span>
            <input v-model="form.name" type="text" class="field-input" placeholder="角色名称" />
          </label>
        </div>

        <div class="field-row">
          <label class="field">
            <span class="field-label">职业</span>
            <select v-model="form.profession" class="field-input">
              <option value="">请选择职业</option>
              <option v-for="profession in AGENT_ROLES" :key="profession" :value="profession">
                {{ profession }}
              </option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">属性</span>
            <select v-model="form.element" class="field-input" @change="onElementChange">
              <option value="">请选择属性</option>
              <option v-for="element in AGENT_ELEMENTS" :key="element" :value="element">
                {{ element }}
              </option>
            </select>
          </label>
        </div>
        </div>

        <div id="admin-agent-support" class="editor-anchor support-needs">
          <p class="field-label">辅助需求属性</p>
          <p class="support-hint">记录该角色作为辅助入队时需要堆叠的属性，与是否在计算中标记为主C无关。</p>
          <div class="checkbox-grid">
            <label
              v-for="option in SUPPORT_STAT_OPTIONS"
              :key="option.id"
              class="checkbox-item"
            >
              <input
                type="checkbox"
                :checked="form.supportNeeds.includes(option.id)"
                @change="toggleSupportNeed(option.id)"
              />
              <span>{{ option.label }}</span>
            </label>
          </div>
        </div>

        <label id="admin-agent-note" class="field note-field editor-anchor">
          <span class="field-label">角色注释</span>
          <textarea
            v-model="form.note"
            class="field-textarea"
            rows="3"
            placeholder="角色通用说明，将在队伍槽位与查阅页显示"
          />
        </label>

        <div id="admin-agent-avatar" class="editor-anchor">
          <AdminCalculatorAvatarField ref="avatarFieldRef" />
        </div>

        <section id="admin-agent-base-panel" class="mindscape-section editor-anchor">
          <header class="mindscape-header">
            <h3>基础面板</h3>
            <p>角色局外基础属性，暂不纳入当前伤害计算，供后续新模式使用。</p>
          </header>
          <AdminNumericStatFieldGrid v-model="form.basePanel" :fields="AGENT_BASE_PANEL_FIELDS" />
        </section>

        <section id="admin-agent-mindscape" class="mindscape-section editor-anchor">
          <header class="mindscape-header">
            <h3>影画增益</h3>
            <p>各影画填写该阶新增增益；高阶影画自动叠加低阶（如 1 影含 0 影）。</p>
          </header>

          <div class="mindscape-tabs">
            <button
              v-for="rank in AGENT_MINDSCAPE_RANKS"
              :key="rank"
              type="button"
              class="mindscape-tab"
              :class="{ active: activeMindscapeRank === rank }"
              @click="activeMindscapeRank = rank"
            >
              {{ rank }}影
            </button>
          </div>

          <label class="field note-field">
            <span class="field-label">{{ activeMindscapeRank }} 影注释</span>
            <textarea
              v-model="activeMindscapeNote"
              class="field-textarea"
              rows="3"
              placeholder="该影画阶的机制说明、触发条件等"
            />
          </label>

          <p class="mods-section-title">{{ activeMindscapeRank }} 影 · 自身增益</p>
          <AdminBuffStatFieldGrid v-model="activeMindscapeForm.selfMods" />

          <p class="mods-section-title">{{ activeMindscapeRank }} 影 · 队友增益</p>
          <AdminBuffStatFieldGrid v-model="activeMindscapeForm.teamMods" />
        </section>

        <p v-if="error" class="form-error">{{ error }}</p>
        <p v-if="message" class="form-success">{{ message }}</p>

        <div class="actions">
          <button type="submit" class="submit-btn" :disabled="saving">
            {{ saving ? '保存中...' : '保存' }}
          </button>
          <button v-if="selectedId" type="button" class="danger-btn" @click="removeAgent">
            删除
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped src="./adminCalculatorPanel.css"></style>
<style scoped>
.editor-anchor {
  scroll-margin-top: 1rem;
}
</style>
