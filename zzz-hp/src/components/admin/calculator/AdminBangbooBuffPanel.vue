<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import AdminBuffEffectEditor from '@/components/admin/calculator/AdminBuffEffectEditor.vue'
import AdminCalculatorAvatarField from '@/components/admin/calculator/AdminCalculatorAvatarField.vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import type { BangbooBuffEditSectionId } from '@/constants/bangbooBuffEditNav'
import type { BangbooBuffDoc, BuffEffect, BuffEffectBlock } from '@/types/calculator'
import {
  createEmptyBuffEffectBlock,
  flatModsToEffects,
  flattenEffectBlocks,
  normalizeBuffEffectBlocks,
  wrapEffectsAsBlocks,
} from '@/utils/buffEffect'
import { createEmptyBuffStatModifiers, REFINEMENT_RANKS } from '@/utils/calculatorUi'

const store = useCalculatorBuffStore()
const { bangboos } = storeToRefs(store)

const search = ref('')
const selectedId = ref(bangboos.value[0]?.id ?? '')
const message = ref('')
const error = ref('')
const saving = ref(false)
const activeRefinementRank = ref(1)
const avatarFieldRef = ref<InstanceType<typeof AdminCalculatorAvatarField> | null>(null)
const panelRootRef = ref<HTMLElement | null>(null)

function emptyRefinementBlocks(): BuffEffectBlock[][] {
  return REFINEMENT_RANKS.map(() => [])
}

const form = ref({
  id: '',
  name: '',
  effectBlocks: [] as BuffEffectBlock[],
  refinementBlocks: emptyRefinementBlocks(),
})

const filteredBangboos = computed(() => {
  const keyword = search.value.trim()
  if (!keyword) return bangboos.value
  return bangboos.value.filter((item) => `${item.name}${item.id}`.includes(keyword))
})

const activeRefinementBlocks = computed({
  get: () => form.value.refinementBlocks[activeRefinementRank.value - 1]!,
  set: (value: BuffEffectBlock[]) => {
    form.value.refinementBlocks[activeRefinementRank.value - 1] = value
  },
})

function toBlocks(effects: BuffEffect[]): BuffEffectBlock[] {
  return wrapEffectsAsBlocks(effects).map((block) =>
    createEmptyBuffEffectBlock({
      ...block,
      effects: block.effects.map((e) => ({
        ...e,
        applyTarget: 'team',
      })),
    }),
  )
}

function loadForm(doc: BangbooBuffDoc) {
  const effects =
    doc.effects?.length ? doc.effects : flatModsToEffects(doc.fixedMods, 'team')
  const refinementBlocks = REFINEMENT_RANKS.map((_, index) => {
    const list = doc.refinementEffects?.[index]
    if (list?.length) return toBlocks(list)
    return toBlocks(flatModsToEffects(doc.refinementMods[index] ?? createEmptyBuffStatModifiers(), 'team'))
  })
  form.value = {
    id: doc.id,
    name: doc.name,
    effectBlocks: toBlocks(effects),
    refinementBlocks,
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
    effectBlocks: [],
    refinementBlocks: emptyRefinementBlocks(),
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

function effectsToMods(list: BuffEffect[]) {
  const mods = createEmptyBuffStatModifiers()
  for (const effect of list) {
    const amount = Number(effect.value ?? effect.valuePerStack) || 0
    if (amount) mods[effect.stat] += amount
  }
  return mods
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
    const effectBlocks = normalizeBuffEffectBlocks(form.value.effectBlocks)
    const refinementBlocks = form.value.refinementBlocks.map((blocks) =>
      normalizeBuffEffectBlocks(blocks),
    )
    const effects = flattenEffectBlocks(effectBlocks)
    const refinementEffects = refinementBlocks.map((blocks) => flattenEffectBlocks(blocks))
    const doc: BangbooBuffDoc = {
      id,
      name,
      avatar_image,
      effects,
      refinementEffects,
      fixedMods: effectsToMods(effects),
      refinementMods: refinementEffects.map((list) => effectsToMods(list)),
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
  if (!window.confirm(`确认删除邦布「${form.value.name || selectedId.value}」？`)) return
  try {
    await store.deleteBangboo(selectedId.value)
    message.value = '已删除'
    resetForm()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除失败'
  }
}

async function scrollToSection(sectionId: BangbooBuffEditSectionId) {
  await nextTick()
  panelRootRef.value
    ?.querySelector<HTMLElement>(`#${sectionId}`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

watch(
  bangboos,
  (list) => {
    if (!selectedId.value && list[0]) selectItem(list[0].id)
  },
  { immediate: true },
)

defineExpose({ scrollToSection, saveItem, removeItem, selectedId, saving })
</script>

<template>
  <div ref="panelRootRef" class="editor-panel">
    <header class="panel-header">
      <h1 class="panel-title">编辑邦布增益</h1>
      <p class="panel-desc">邦布增益默认作用于全队（含主C）。</p>
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
        <section id="admin-bangboo-basic" class="mindscape-section editor-anchor">
          <header class="mindscape-header">
            <h3>基础信息</h3>
          </header>
          <div class="field-row">
            <label class="field">
              <span class="field-label">ID *</span>
              <input v-model="form.id" class="field-input" />
            </label>
            <label class="field">
              <span class="field-label">名称 *</span>
              <input v-model="form.name" class="field-input" />
            </label>
          </div>
          <div id="admin-bangboo-avatar" class="editor-anchor">
            <AdminCalculatorAvatarField ref="avatarFieldRef" category="bangboo" />
          </div>
        </section>

        <section id="admin-bangboo-fixed" class="mindscape-section editor-anchor">
          <header class="mindscape-header">
            <h3>固定增益</h3>
          </header>
          <AdminBuffEffectEditor v-model="form.effectBlocks" lock-apply-target="team" />
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
          <AdminBuffEffectEditor v-model="activeRefinementBlocks" lock-apply-target="team" />
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
