<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import AgentFuzzySelect from '@/components/admin/calculator/AgentFuzzySelect.vue'
import DamageEventEditor from '@/components/calculator/DamageEventEditor.vue'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import type { DamageEventMode } from '@/types/calculator'

const store = useCalculatorBuffStore()
const { agents, skillSubcategories, damageEventModes } = storeToRefs(store)

const message = ref('')
const error = ref('')
const saving = ref(false)
const selectedId = ref('')
const filterAgentId = ref('')

const form = ref({
  id: '',
  agentId: '',
  name: '',
  modeType: 'direct' as DamageEventMode['modeType'],
  events: [] as DamageEventMode['events'],
})

const sortedList = computed(() =>
  [...damageEventModes.value]
    .filter((item) => !filterAgentId.value || item.agentId === filterAgentId.value)
    .sort(
      (a, b) =>
        a.agentId.localeCompare(b.agentId) ||
        a.name.localeCompare(b.name),
    ),
)

function agentName(id: string) {
  if (!id) return '全部角色'
  return agents.value.find((item) => item.id === id)?.name ?? id
}

function resetForm() {
  form.value = {
    id: '',
    agentId: filterAgentId.value,
    name: '',
    modeType: 'direct',
    events: [],
  }
  selectedId.value = ''
  message.value = ''
  error.value = ''
}

function selectItem(item: DamageEventMode) {
  selectedId.value = item.id
  form.value = {
    id: item.id,
    agentId: item.agentId,
    name: item.name,
    modeType: item.modeType ?? 'direct',
    events: item.events.map((event) => ({ ...event })),
  }
}

async function saveItem() {
  message.value = ''
  error.value = ''
  const name = form.value.name.trim()
  if (!name) {
    error.value = '模式名称为必填项'
    return
  }
  saving.value = true
  try {
    const saved = await store.upsertDamageEventModeDoc({
      id: selectedId.value || '',
      agentId: form.value.agentId,
      name,
      modeType: form.value.modeType,
      events: form.value.events,
    })
    selectedId.value = saved.id
    form.value.id = saved.id
    form.value.modeType = saved.modeType
    form.value.events = saved.events.map((event) => ({ ...event }))
    message.value = '已保存伤害事件模式'
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function removeItem() {
  if (!selectedId.value) return
  if (!window.confirm(`确认删除模式「${form.value.name || selectedId.value}」？`)) return
  try {
    await store.removeDamageEventModeDoc(selectedId.value)
    resetForm()
    message.value = '已删除'
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除失败'
  }
}

defineExpose({ selectedId, saving, saveItem, removeItem })
</script>

<template>
  <div class="editor-panel">
    <header class="panel-header">
      <h1 class="panel-title">伤害事件模式</h1>
      <p class="panel-desc">
        按角色配置伤害事件序列，计算页可载入为自定义事件列表。每条事件含种类、招式上下文与次数。
      </p>
    </header>

    <div class="filter-row">
      <label class="field">
        <span class="field-label">筛选角色</span>
        <AgentFuzzySelect v-model="filterAgentId" :agents="agents" empty-label="全部角色" />
      </label>
    </div>

    <div class="editor-layout">
      <aside class="item-list">
        <button type="button" class="secondary-btn" @click="resetForm">+ 新建模式</button>
        <div class="list-scroll">
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
              {{ agentName(item.agentId) }} · {{ item.modeType === 'anomaly' ? '异常' : '直伤' }} ·
              {{ item.events.length }} 条事件
            </span>
          </button>
        </div>
      </aside>

      <form class="editor-form" @submit.prevent="saveItem">
        <section class="mindscape-section">
          <header class="mindscape-header">
            <h3>{{ selectedId ? '编辑模式' : '新建模式' }}</h3>
          </header>
          <div class="field-row">
            <label class="field">
              <span class="field-label">所属角色</span>
              <AgentFuzzySelect
                v-model="form.agentId"
                :agents="agents"
                empty-label="全部角色"
                :disabled="Boolean(selectedId)"
                placeholder="输入角色名搜索…"
              />
            </label>
            <label class="field">
              <span class="field-label">模式名称 *</span>
              <input v-model="form.name" class="field-input" placeholder="如：常规轴" />
            </label>
            <label class="field">
              <span class="field-label">模式类型</span>
              <select v-model="form.modeType" class="field-input">
                <option value="direct">直伤</option>
                <option value="anomaly">异常</option>
              </select>
            </label>
            <label v-if="form.id" class="field">
              <span class="field-label">ID（自动）</span>
              <input :value="form.id" class="field-input" readonly />
            </label>
          </div>

          <DamageEventEditor
            v-model="form.events"
            :skill-subcategories="skillSubcategories"
            :agent-id="form.agentId || undefined"
            :mode-type="form.modeType"
          />
        </section>

        <p v-if="error" class="form-error">{{ error }}</p>
        <p v-if="message" class="form-success">{{ message }}</p>

        <div class="actions">
          <button type="submit" class="submit-btn" :disabled="saving">
            {{ saving ? '保存中...' : '保存' }}
          </button>
          <button v-if="selectedId" type="button" class="danger-btn" @click="removeItem">
            删除
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped src="./adminCalculatorPanel.css"></style>
<style scoped>
.filter-row {
  margin-bottom: 0.85rem;
  max-width: 280px;
}
.editor-form :deep(.damage-event-editor) {
  margin-top: 0.85rem;
  border-color: var(--color-border);
  background: color-mix(in srgb, var(--color-border) 12%, var(--color-background));
}
.editor-form :deep(.add-btn) {
  border-color: color-mix(in srgb, var(--color-border) 80%, #c9a55c);
  color: var(--color-heading);
}
.editor-form :deep(.event-item),
.editor-form :deep(.field select),
.editor-form :deep(.field input) {
  border-color: var(--color-border);
  background: var(--color-background);
  color: var(--color-text);
  color-scheme: inherit;
}
.editor-form :deep(.event-item.active) {
  border-color: #c9a55c;
  background: color-mix(in srgb, #c9a55c 12%, var(--color-background));
  color: var(--color-heading);
}
.editor-form :deep(.event-detail h4),
.editor-form :deep(.field span),
.editor-form :deep(.empty-hint),
.editor-form :deep(.detail-placeholder) {
  color: var(--color-text);
}
.editor-form :deep(.field span),
.editor-form :deep(.empty-hint),
.editor-form :deep(.detail-placeholder) {
  opacity: 0.75;
}
</style>
