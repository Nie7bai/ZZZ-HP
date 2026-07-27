<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import AgentFuzzySelect from '@/components/admin/calculator/AgentFuzzySelect.vue'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import type { FollowUpSkillRule, SkillCategoryId, SkillSubcategory } from '@/types/calculator'
import { SKILL_CATEGORY_OPTIONS } from '@/types/calculator'

const store = useCalculatorBuffStore()
const { agents, skillSubcategories, followUpSkillRules } = storeToRefs(store)

const message = ref('')
const error = ref('')
const saving = ref(false)
const selectedId = ref('')
const filterAgentId = ref('')

const form = ref({
  id: '',
  agentId: '',
  categoryId: 'basic' as SkillCategoryId,
  name: '',
  countsAsFollowUp: false,
  directDmgMult: 100,
  anomalyReleaseMult: 0,
  disorderMult: 0,
  directDmgMultFactor: 1,
  anomalyReleaseMultFactor: 1,
  disorderMultFactor: 1,
})

const ruleForm = ref({
  agentId: '',
  categoryId: 'basic' as SkillCategoryId,
})
const ruleMessage = ref('')
const ruleError = ref('')
const ruleSaving = ref(false)

const sortedList = computed(() =>
  [...skillSubcategories.value]
    .filter((item) => {
      if (!filterAgentId.value) return true
      if (filterAgentId.value === '__common__') return !item.agentId
      return item.agentId === filterAgentId.value
    })
    .sort(
      (a, b) =>
        a.agentId.localeCompare(b.agentId) ||
        a.categoryId.localeCompare(b.categoryId) ||
        a.name.localeCompare(b.name),
    ),
)

const sortedRules = computed(() =>
  [...followUpSkillRules.value].sort(
    (a, b) =>
      a.agentId.localeCompare(b.agentId) ||
      a.categoryId.localeCompare(b.categoryId) ||
      a.id.localeCompare(b.id),
  ),
)

function agentName(id: string) {
  if (!id) return '全部角色'
  return agents.value.find((item) => item.id === id)?.name ?? id
}

function categoryLabel(id: string) {
  return SKILL_CATEGORY_OPTIONS.find((item) => item.id === id)?.label ?? id
}

function resetForm() {
  form.value = {
    id: '',
    agentId: filterAgentId.value === '__common__' ? '' : filterAgentId.value,
    categoryId: 'basic',
    name: '',
    countsAsFollowUp: false,
    directDmgMult: 100,
    anomalyReleaseMult: 0,
    disorderMult: 0,
    directDmgMultFactor: 1,
    anomalyReleaseMultFactor: 1,
    disorderMultFactor: 1,
  }
  selectedId.value = ''
  message.value = ''
  error.value = ''
}

function selectItem(item: SkillSubcategory) {
  selectedId.value = item.id
  form.value = {
    id: item.id,
    agentId: item.agentId,
    categoryId: item.categoryId,
    name: item.name,
    countsAsFollowUp: Boolean(item.countsAsFollowUp),
    directDmgMult: item.directDmgMult,
    anomalyReleaseMult: item.anomalyReleaseMult,
    disorderMult: item.disorderMult,
    directDmgMultFactor: item.directDmgMultFactor,
    anomalyReleaseMultFactor: item.anomalyReleaseMultFactor,
    disorderMultFactor: item.disorderMultFactor,
  }
}

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
    const saved = await store.upsertSkillSubcategoryDoc({
      id: selectedId.value || '',
      agentId: form.value.agentId,
      categoryId: form.value.categoryId,
      name,
      countsAsFollowUp: form.value.countsAsFollowUp,
      directDmgMult: form.value.directDmgMult,
      anomalyReleaseMult: form.value.anomalyReleaseMult,
      disorderMult: form.value.disorderMult,
      directDmgMultFactor: form.value.directDmgMultFactor,
      anomalyReleaseMultFactor: form.value.anomalyReleaseMultFactor,
      disorderMultFactor: form.value.disorderMultFactor,
    })
    selectedId.value = saved.id
    form.value.id = saved.id
    message.value = '已保存招式小类'
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function removeItem() {
  if (!selectedId.value) return
  if (!window.confirm(`确认删除小类「${form.value.name || selectedId.value}」？`)) return
  try {
    await store.removeSkillSubcategoryDoc(selectedId.value)
    resetForm()
    message.value = '已删除'
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除失败'
  }
}

async function addWholeCategoryRule() {
  ruleMessage.value = ''
  ruleError.value = ''
  ruleSaving.value = true
  try {
    const payload: FollowUpSkillRule = {
      id: '',
      agentId: ruleForm.value.agentId,
      categoryId: ruleForm.value.categoryId,
      subcategoryId: null,
    }
    const dup = followUpSkillRules.value.some(
      (item) =>
        item.agentId === payload.agentId &&
        item.categoryId === payload.categoryId &&
        item.subcategoryId == null,
    )
    if (dup) {
      ruleError.value = '该规则已存在'
      return
    }
    await store.upsertFollowUpSkillRuleDoc(payload)
    ruleMessage.value = '已添加整大类追加标记'
  } catch (err) {
    ruleError.value = err instanceof Error ? err.message : '添加失败'
  } finally {
    ruleSaving.value = false
  }
}

async function removeRule(id: string) {
  if (!window.confirm('确认删除该追加攻击规则？')) return
  try {
    await store.removeFollowUpSkillRuleDoc(id)
    ruleMessage.value = '已删除规则'
  } catch (err) {
    ruleError.value = err instanceof Error ? err.message : '删除失败'
  }
}

defineExpose({ selectedId, saving, saveItem, removeItem })
</script>

<template>
  <div class="editor-panel">
    <header class="panel-header">
      <h1 class="panel-title">招式小类管理</h1>
      <p class="panel-desc">
        角色可选「全部角色」；勾选「视为追加攻击」后，增益中「追加攻击」伪大类可对其生效。未选小类时整大类生效。
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
        <button type="button" class="secondary-btn" @click="resetForm">+ 新建小类</button>
        <div class="list-scroll">
          <button
            v-for="item in sortedList"
            :key="item.id"
            type="button"
            class="list-item"
            :class="{ active: selectedId === item.id }"
            @click="selectItem(item)"
          >
            <span class="list-name">
              {{ item.name }}
              <span v-if="item.countsAsFollowUp" class="tag-follow">追加</span>
            </span>
            <span class="list-meta">
              {{ agentName(item.agentId) }} · {{ categoryLabel(item.categoryId) }}
            </span>
          </button>
        </div>
      </aside>

      <form class="editor-form" @submit.prevent="saveItem">
        <section class="mindscape-section">
          <header class="mindscape-header">
            <h3>{{ selectedId ? '编辑小类' : '新建小类' }}</h3>
          </header>
          <div class="field-row">
            <label class="field">
              <span class="field-label">角色</span>
              <AgentFuzzySelect
                v-model="form.agentId"
                :agents="agents"
                empty-label="全部角色"
                :disabled="Boolean(selectedId)"
              />
            </label>
            <label class="field">
              <span class="field-label">招式大类 *</span>
              <select v-model="form.categoryId" class="field-input">
                <option v-for="opt in SKILL_CATEGORY_OPTIONS" :key="opt.id" :value="opt.id">
                  {{ opt.label }}
                </option>
              </select>
            </label>
          </div>
          <div class="field-row">
            <label class="field">
              <span class="field-label">小类名称 *</span>
              <input v-model="form.name" class="field-input" placeholder="显示名称" />
            </label>
            <label v-if="form.id" class="field">
              <span class="field-label">ID（自动）</span>
              <input :value="form.id" class="field-input" readonly />
            </label>
          </div>
          <label class="field checkbox-field">
            <input v-model="form.countsAsFollowUp" type="checkbox" />
            <span>视为追加攻击</span>
          </label>

          <div class="field-row mult-row">
            <label class="field">
              <span class="field-label">直伤倍率%</span>
              <input v-model.number="form.directDmgMult" class="field-input" type="number" step="any" />
            </label>
            <label class="field">
              <span class="field-label">异放倍率%</span>
              <input v-model.number="form.anomalyReleaseMult" class="field-input" type="number" step="any" />
            </label>
            <label class="field">
              <span class="field-label">紊乱倍率%</span>
              <input v-model.number="form.disorderMult" class="field-input" type="number" step="any" />
            </label>
          </div>
          <div class="field-row mult-row">
            <label class="field">
              <span class="field-label">直伤倍率修正</span>
              <input v-model.number="form.directDmgMultFactor" class="field-input" type="number" step="any" min="0" />
            </label>
            <label class="field">
              <span class="field-label">异放倍率修正</span>
              <input
                v-model.number="form.anomalyReleaseMultFactor"
                class="field-input"
                type="number"
                step="any"
                min="0"
              />
            </label>
            <label class="field">
              <span class="field-label">紊乱倍率修正</span>
              <input v-model.number="form.disorderMultFactor" class="field-input" type="number" step="any" min="0" />
            </label>
          </div>
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

        <section class="mindscape-section follow-up-section">
          <header class="mindscape-header">
            <h3>整大类追加标记</h3>
            <p>不依赖具体小类：该角色（或全部角色）选中此大类结算时，一律视为追加攻击。</p>
          </header>
          <div class="field-row">
            <label class="field">
              <span class="field-label">角色</span>
              <AgentFuzzySelect v-model="ruleForm.agentId" :agents="agents" empty-label="全部角色" />
            </label>
            <label class="field">
              <span class="field-label">招式大类</span>
              <select v-model="ruleForm.categoryId" class="field-input">
                <option v-for="opt in SKILL_CATEGORY_OPTIONS" :key="opt.id" :value="opt.id">
                  {{ opt.label }}
                </option>
              </select>
            </label>
          </div>
          <div class="actions">
            <button
              type="button"
              class="secondary-btn"
              :disabled="ruleSaving"
              @click="addWholeCategoryRule"
            >
              {{ ruleSaving ? '添加中...' : '＋ 添加整大类标记' }}
            </button>
          </div>
          <p v-if="ruleError" class="form-error">{{ ruleError }}</p>
          <p v-if="ruleMessage" class="form-success">{{ ruleMessage }}</p>
          <ul class="rule-list">
            <li v-for="rule in sortedRules" :key="rule.id" class="rule-item">
              <span>
                {{ agentName(rule.agentId) }} · {{ categoryLabel(rule.categoryId) }}
                <template v-if="rule.subcategoryId"> · 小类 {{ rule.subcategoryId }}</template>
                <template v-else> · 整大类</template>
              </span>
              <button type="button" class="danger-btn compact" @click="removeRule(rule.id)">
                删除
              </button>
            </li>
          </ul>
        </section>
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
.tag-follow {
  margin-left: 0.35rem;
  padding: 0.05rem 0.3rem;
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-border) 40%, transparent);
  font-size: 0.7rem;
  font-weight: 700;
}
.checkbox-field {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-top: 0.5rem;
  font-weight: 600;
}
.mult-row {
  margin-top: 0.65rem;
}
.follow-up-section {
  margin-top: 1.25rem;
}
.rule-list {
  list-style: none;
  margin: 0.75rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.rule-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.45rem 0.6rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-border) 20%, transparent);
  font-size: 0.85rem;
}
.danger-btn.compact {
  padding: 0.25rem 0.55rem;
  font-size: 0.75rem;
}
</style>
