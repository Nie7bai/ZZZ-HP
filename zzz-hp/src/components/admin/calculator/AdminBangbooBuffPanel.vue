<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import AdminBuffStatFieldGrid from '@/components/admin/calculator/AdminBuffStatFieldGrid.vue'
import AdminCalculatorAvatarField from '@/components/admin/calculator/AdminCalculatorAvatarField.vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import type { BangbooBuffEditSectionId } from '@/constants/bangbooBuffEditNav'
import type { BangbooBuffDoc, BuffStatModifiers } from '@/types/calculator'
import {
  createEmptyBuffStatModifiers,
  createEmptyRefinementMods,
  REFINEMENT_RANKS,
} from '@/utils/calculatorUi'

const store = useCalculatorBuffStore()
const { bangboos } = storeToRefs(store)

const search = ref('')
const selectedId = ref(bangboos.value[0]?.id ?? '')
const message = ref('')
const error = ref('')
const saving = ref(false)
const activeRefinementRank = ref(1)
const avatarFieldRef = ref<InstanceType<typeof AdminCalculatorAvatarField> | null>(null)

const form = ref({
  id: '',
  name: '',
  fixedMods: createEmptyBuffStatModifiers(),
  refinementForm: createEmptyRefinementMods(),
})

const filteredBangboos = computed(() => {
  const keyword = search.value.trim()
  if (!keyword) return bangboos.value
  return bangboos.value.filter((item) => `${item.name}${item.id}`.includes(keyword))
})

const activeRefinementForm = computed(
  () => form.value.refinementForm[activeRefinementRank.value - 1]!,
)

function cloneMods(mods: BuffStatModifiers): BuffStatModifiers {
  return { ...mods }
}

function loadRefinementForm(refinementMods: BangbooBuffDoc['refinementMods']) {
  return REFINEMENT_RANKS.map((_, index) =>
    cloneMods(refinementMods[index] ?? createEmptyBuffStatModifiers()),
  )
}

function loadForm(doc: BangbooBuffDoc) {
  form.value = {
    id: doc.id,
    name: doc.name,
    fixedMods: cloneMods(doc.fixedMods),
    refinementForm: loadRefinementForm(doc.refinementMods),
  }
  activeRefinementRank.value = 1
  void nextTick(() => {
    avatarFieldRef.value?.setAvatarImage(doc.avatar_image)
  })
}

function resetForm() {
  form.value = {
    id: '',
    name: '',
    fixedMods: createEmptyBuffStatModifiers(),
    refinementForm: createEmptyRefinementMods(),
  }
  activeRefinementRank.value = 1
  selectedId.value = ''
  avatarFieldRef.value?.clearAvatarImage()
}

function selectItem(id: string) {
  selectedId.value = id
  const doc = bangboos.value.find((item) => item.id === id)
  if (doc) loadForm(doc)
}

function createNew() {
  resetForm()
}

async function saveItem() {
  message.value = ''
  error.value = ''

  const id = form.value.id.trim()
  const name = form.value.name.trim()
  if (!id || !name) {
    error.value = 'ID 与名称为必填项'
    return
  }

  const isEditing = Boolean(selectedId.value)
  if (!isEditing && bangboos.value.some((item) => item.id === id)) {
    error.value = '该 ID 已存在'
    return
  }
  if (isEditing && selectedId.value !== id && bangboos.value.some((item) => item.id === id)) {
    error.value = '新 ID 已被其他邦布占用'
    return
  }

  saving.value = true
  try {
    const avatar_image = (await avatarFieldRef.value?.resolveAvatarImageOnSave()) ?? null
    const doc: BangbooBuffDoc = {
      id,
      name,
      avatar_image,
      fixedMods: cloneMods(form.value.fixedMods),
      refinementMods: form.value.refinementForm.map((mods) => cloneMods(mods)),
    }

    if (isEditing && selectedId.value !== id) {
      await store.deleteBangboo(selectedId.value)
    }

    await store.upsertBangboo(doc)
    selectedId.value = id
    message.value = isEditing ? `已保存邦布「${name}」` : `已新增邦布「${name}」`
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function removeItem() {
  if (!selectedId.value) return
  const current = bangboos.value.find((item) => item.id === selectedId.value)
  if (!current) return
  if (!window.confirm(`确定删除邦布「${current.name}」吗？`)) return

  try {
    await store.deleteBangboo(selectedId.value)
    message.value = `已删除邦布「${current.name}」`
    const next = bangboos.value[0]
    if (next) {
      selectItem(next.id)
    } else {
      resetForm()
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除失败'
  }
}

watch(
  bangboos,
  (list) => {
    if (!list.length) {
      resetForm()
      return
    }
    if (!selectedId.value || !list.some((item) => item.id === selectedId.value)) {
      selectItem(list[0]!.id)
    }
  },
  { immediate: true },
)

const panelRootRef = ref<HTMLElement | null>(null)

async function scrollToSection(sectionId: BangbooBuffEditSectionId) {
  await nextTick()
  const target = panelRootRef.value?.querySelector<HTMLElement>(`#${sectionId}`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

defineExpose({ scrollToSection, saveItem, removeItem, selectedId, saving })
</script>

<template>
  <div ref="panelRootRef" class="editor-panel">
    <header class="panel-header">
      <h1 class="panel-title">编辑邦布增益</h1>
      <p class="panel-desc">固定增益与精1至精5精炼增益均使用固定数值条目。</p>
    </header>

    <div class="editor-layout">
      <aside id="admin-bangboo-picker" class="item-list editor-anchor">
        <label class="field">
          <span class="field-label">搜索邦布</span>
          <input v-model="search" type="text" class="field-input" placeholder="名称" />
        </label>

        <button type="button" class="secondary-btn" @click="createNew">+ 新增邦布</button>

        <div class="list-scroll">
          <button
            v-for="item in filteredBangboos"
            :key="item.id"
            type="button"
            class="list-item"
            :class="{ active: selectedId === item.id }"
            @click="selectItem(item.id)"
          >
            <CalculatorAvatar :avatar-image="item.avatar_image" :name="item.name" />
            <span class="list-name">{{ item.name }}</span>
          </button>
        </div>
      </aside>

      <form class="editor-form" @submit.prevent="saveItem">
        <div id="admin-bangboo-basic" class="editor-anchor">
          <div class="field-row">
            <label class="field">
              <span class="field-label">ID *</span>
              <input v-model="form.id" type="text" class="field-input" placeholder="如 resonaboo" />
            </label>
            <label class="field">
              <span class="field-label">名称 *</span>
              <input v-model="form.name" type="text" class="field-input" placeholder="邦布名称" />
            </label>
          </div>
        </div>

        <div id="admin-bangboo-avatar" class="editor-anchor">
          <AdminCalculatorAvatarField ref="avatarFieldRef" />
        </div>

        <section id="admin-bangboo-fixed" class="mindscape-section editor-anchor">
          <header class="mindscape-header">
            <h3>固定增益</h3>
          </header>
          <AdminBuffStatFieldGrid v-model="form.fixedMods" />
        </section>

        <section id="admin-bangboo-refinement" class="mindscape-section editor-anchor">
          <header class="mindscape-header">
            <h3>精炼增益</h3>
          </header>

          <div class="mindscape-tabs">
            <button
              v-for="rank in REFINEMENT_RANKS"
              :key="rank"
              type="button"
              class="mindscape-tab"
              :class="{ active: activeRefinementRank === rank }"
              @click="activeRefinementRank = rank"
            >
              精{{ rank }}
            </button>
          </div>

          <p class="mods-section-title">精{{ activeRefinementRank }}</p>
          <AdminBuffStatFieldGrid v-model="activeRefinementForm" />
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
.editor-anchor {
  scroll-margin-top: 1rem;
}
</style>
