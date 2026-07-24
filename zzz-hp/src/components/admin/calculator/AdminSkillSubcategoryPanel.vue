<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import type { SkillCategoryId, SkillSubcategory } from '@/types/calculator'
import { SKILL_CATEGORY_OPTIONS } from '@/types/calculator'

const store = useCalculatorBuffStore()
const { agents, skillSubcategories } = storeToRefs(store)

const message = ref('')
const error = ref('')
const saving = ref(false)
const selectedId = ref('')

const form = ref({
  id: '',
  agentId: '',
  categoryId: 'basic' as SkillCategoryId,
  name: '',
})

const sortedList = computed(() =>
  [...skillSubcategories.value].sort(
    (a, b) =>
      a.agentId.localeCompare(b.agentId) ||
      a.categoryId.localeCompare(b.categoryId) ||
      a.name.localeCompare(b.name),
  ),
)

function agentName(id: string) {
  return (agents.value.find((item) => item.id === id)?.name ?? id) || '未指定角色'
}

function categoryLabel(id: string) {
  return SKILL_CATEGORY_OPTIONS.find((item) => item.id === id)?.label ?? id
}

function resetForm() {
  form.value = {
    id: '',
    agentId: agents.value[0]?.id ?? '',
    categoryId: 'basic',
    name: '',
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
  }
}

async function saveItem() {
  message.value = ''
  error.value = ''
  const name = form.value.name.trim()
  if (!form.value.agentId) {
    error.value = '请先选择角色'
    return
  }
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
    })
    selectedId.value = saved.id
    form.value.id = saved.id
    message.value = selectedId.value ? '已保存招式小类' : '已新建招式小类'
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

defineExpose({ selectedId, saving, saveItem, removeItem })
</script>

<template>
  <div class="editor-panel">
    <header class="panel-header">
      <h1 class="panel-title">招式小类管理</h1>
      <p class="panel-desc">先选角色，再选招式大类并填写名称；ID 自动分配。未选小类时整大类生效。</p>
    </header>

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
            <span class="list-name">{{ item.name }}</span>
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
              <span class="field-label">角色 *</span>
              <select v-model="form.agentId" class="field-input" :disabled="Boolean(selectedId)">
                <option value="">请选择角色</option>
                <option v-for="agent in agents" :key="agent.id" :value="agent.id">
                  {{ agent.name }}
                </option>
              </select>
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
