<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import AdminBuffEffectEditor from '@/components/admin/calculator/AdminBuffEffectEditor.vue'
import AdminCalculatorAvatarField from '@/components/admin/calculator/AdminCalculatorAvatarField.vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import type { DriveDiscBuffEditSectionId } from '@/constants/driveDiscBuffEditNav'
import type { AgentMindscapeRankBuffs, BuffEffectBlock, DriveDiscBuffDoc } from '@/types/calculator'
import {
  flatModsToEffects,
  flattenEffectBlocks,
  normalizeBuffEffectBlocks,
  packFromBlocks,
  packFromEffects,
  wrapEffectsAsBlocks,
} from '@/utils/buffEffect'
import { createEmptyBuffStatModifiers, createEmptySelfTeamBuffs } from '@/utils/calculatorUi'

const store = useCalculatorBuffStore()
const { driveDiscs } = storeToRefs(store)

const search = ref('')
const selectedId = ref(driveDiscs.value[0]?.id ?? '')
const message = ref('')
const error = ref('')
const saving = ref(false)
const avatarFieldRef = ref<InstanceType<typeof AdminCalculatorAvatarField> | null>(null)

const form = ref({
  id: '',
  name: '',
  twoPieceNote: '',
  fourPieceNote: '',
  twoPieceBlocks: [] as BuffEffectBlock[],
  fourPieceBuffs: createEmptySelfTeamBuffs(),
})

const filteredDriveDiscs = computed(() => {
  const keyword = search.value.trim()
  if (!keyword) return driveDiscs.value
  return driveDiscs.value.filter((item) => `${item.name}${item.id}`.includes(keyword))
})

function cloneSelfTeamBuffs(buffs: AgentMindscapeRankBuffs): AgentMindscapeRankBuffs {
  if (buffs.effectBlocks?.length) {
    return packFromBlocks(
      buffs.effectBlocks.map((block) => ({
        ...block,
        effects: block.effects.map((effect) => ({
          ...effect,
          convert: effect.convert ? { ...effect.convert } : undefined,
          elementFilter: Array.isArray(effect.elementFilter)
            ? [...effect.elementFilter]
            : effect.elementFilter,
        })),
      })),
    )
  }
  return packFromEffects(
    (buffs.effects ?? []).map((effect) => ({
      ...effect,
      convert: effect.convert ? { ...effect.convert } : undefined,
      elementFilter: Array.isArray(effect.elementFilter)
        ? [...effect.elementFilter]
        : effect.elementFilter,
    })),
  )
}

function loadForm(doc: DriveDiscBuffDoc) {
  const twoPieceEffects = doc.twoPieceEffects?.length
    ? doc.twoPieceEffects
    : flatModsToEffects(doc.twoPieceMods, 'self')
  form.value = {
    id: doc.id,
    name: doc.name,
    twoPieceNote: doc.twoPieceNote,
    fourPieceNote: doc.fourPieceNote,
    twoPieceBlocks: wrapEffectsAsBlocks(twoPieceEffects),
    fourPieceBuffs: cloneSelfTeamBuffs(doc.fourPieceBuffs),
  }
  void nextTick(() => {
    avatarFieldRef.value?.setAvatarImage(doc.avatar_image)
  })
}

function resetForm() {
  form.value = {
    id: '',
    name: '',
    twoPieceNote: '',
    fourPieceNote: '',
    twoPieceBlocks: [],
    fourPieceBuffs: createEmptySelfTeamBuffs(),
  }
  selectedId.value = ''
  avatarFieldRef.value?.clearAvatarImage()
}

function selectItem(id: string) {
  selectedId.value = id
  const doc = driveDiscs.value.find((item) => item.id === id)
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
  if (!isEditing && driveDiscs.value.some((item) => item.id === id)) {
    error.value = '该 ID 已存在'
    return
  }
  if (isEditing && selectedId.value !== id && driveDiscs.value.some((item) => item.id === id)) {
    error.value = '新 ID 已被其他驱动盘占用'
    return
  }

  saving.value = true
  try {
    const avatar_image = (await avatarFieldRef.value?.resolveAvatarImageOnSave()) ?? null
    const twoPieceBlocks = normalizeBuffEffectBlocks(form.value.twoPieceBlocks)
    const twoPieceEffects = flattenEffectBlocks(twoPieceBlocks)
    const twoPieceMods = createEmptyBuffStatModifiers()
    for (const effect of twoPieceEffects) {
      const amount = Number(effect.value ?? effect.valuePerStack) || 0
      if (amount) twoPieceMods[effect.stat] += amount
    }
    const doc: DriveDiscBuffDoc = {
      id,
      name,
      avatar_image,
      twoPieceNote: form.value.twoPieceNote.trim(),
      fourPieceNote: form.value.fourPieceNote.trim(),
      twoPieceEffects,
      twoPieceMods,
      fourPieceBuffs: packFromBlocks(form.value.fourPieceBuffs.effectBlocks ?? []),
    }

    if (isEditing && selectedId.value !== id) {
      await store.deleteDriveDisc(selectedId.value)
    }

    await store.upsertDriveDisc(doc)
    selectedId.value = id
    message.value = isEditing ? `已保存驱动盘「${name}」` : `已新增驱动盘「${name}」`
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function removeItem() {
  if (!selectedId.value) return
  const current = driveDiscs.value.find((item) => item.id === selectedId.value)
  if (!current) return
  if (!window.confirm(`确定删除驱动盘「${current.name}」吗？`)) return

  try {
    await store.deleteDriveDisc(selectedId.value)
    message.value = `已删除驱动盘「${current.name}」`
    const next = driveDiscs.value[0]
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
  driveDiscs,
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

async function scrollToSection(sectionId: DriveDiscBuffEditSectionId) {
  await nextTick()
  const target = panelRootRef.value?.querySelector<HTMLElement>(`#${sectionId}`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

defineExpose({ scrollToSection, saveItem, removeItem, selectedId, saving })
</script>

<template>
  <div ref="panelRootRef" class="editor-panel">
    <header class="panel-header">
      <h1 class="panel-title">编辑驱动盘增益</h1>
      <p class="panel-desc">2 件套为全队固定增益；4 件套分自身与队友。</p>
    </header>

    <div class="editor-layout">
      <aside id="admin-drive-disc-picker" class="item-list editor-anchor">
        <label class="field">
          <span class="field-label">搜索驱动盘</span>
          <input v-model="search" type="text" class="field-input" placeholder="名称" />
        </label>

        <button type="button" class="secondary-btn" @click="createNew">+ 新增驱动盘</button>

        <div class="list-scroll">
          <button
            v-for="item in filteredDriveDiscs"
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
        <div id="admin-drive-disc-basic" class="editor-anchor">
          <div class="field-row">
            <label class="field">
              <span class="field-label">ID *</span>
              <input v-model="form.id" type="text" class="field-input" placeholder="如 woodpecker" />
            </label>
            <label class="field">
              <span class="field-label">名称 *</span>
              <input v-model="form.name" type="text" class="field-input" placeholder="驱动盘名称" />
            </label>
          </div>
        </div>

        <div id="admin-drive-disc-avatar" class="editor-anchor">
          <AdminCalculatorAvatarField ref="avatarFieldRef" />
        </div>

        <section id="admin-drive-disc-two-piece" class="mindscape-section editor-anchor">
          <header class="mindscape-header">
            <h3>2 件套增益</h3>
            <p>局外生命%/局外攻击% 仅参与词条计算；其余增益在词条模式下计入局外面板。</p>
          </header>
          <label class="field note-field">
            <span class="field-label">2 件套注释</span>
            <textarea
              v-model="form.twoPieceNote"
              class="field-textarea"
              rows="2"
              placeholder="佩戴该套装 2 件套时显示"
            />
          </label>
          <AdminBuffEffectEditor
            v-model="form.twoPieceBlocks"
            lock-apply-target="self"
            hint="2 件套效果；局外生命%/局外攻击% 主要用于词条计算。"
          />
        </section>

        <section id="admin-drive-disc-four-piece" class="mindscape-section editor-anchor">
          <header class="mindscape-header">
            <h3>4 件套增益</h3>
            <p>主C 槽位取自身增益，队友槽位取队友增益。佩戴 4 件套时同时显示本套 2 件与 4 件注释。</p>
          </header>
          <label class="field note-field">
            <span class="field-label">4 件套注释</span>
            <textarea
              v-model="form.fourPieceNote"
              class="field-textarea"
              rows="2"
              placeholder="佩戴该套装 4 件套时显示"
            />
          </label>
          <AdminBuffEffectEditor v-model="form.fourPieceBuffs.effectBlocks" />
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
