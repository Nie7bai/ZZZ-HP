<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import AdminBuffEffectEditor from '@/components/admin/calculator/AdminBuffEffectEditor.vue'
import AdminCalculatorAvatarField from '@/components/admin/calculator/AdminCalculatorAvatarField.vue'
import AdminRememberedNumberField from '@/components/admin/calculator/AdminRememberedNumberField.vue'
import AdminWengineAdvancedStatsGrid from '@/components/admin/calculator/AdminWengineAdvancedStatsGrid.vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import type { AgentMindscapeRankBuffs, WengineAdvancedStats, WengineBuffDoc } from '@/types/calculator'
import type { WengineBuffEditSectionId } from '@/constants/wengineBuffEditNav'
import { packFromBlocks, packFromEffects } from '@/utils/buffEffect'
import {
  rememberWengineStatValue,
  WENGINE_BASE_ATK_FIELD_KEY,
  wengineAdvancedStatFieldKey,
} from '@/utils/wengineStatSuggestions'
import {
  AGENT_ROLES,
  createEmptySelfTeamBuffs,
  createEmptyWengineAdvancedStats,
  createEmptyWengineRefinementBuffs,
  REFINEMENT_RANKS,
  WENGINE_ADVANCED_STAT_FIELDS,
  WENGINE_RARITIES,
} from '@/utils/calculatorUi'

const store = useCalculatorBuffStore()
const { wengines } = storeToRefs(store)

const search = ref('')
const roleFilter = ref('')
const selectedId = ref(wengines.value[0]?.id ?? '')
const message = ref('')
const error = ref('')
const saving = ref(false)
const suggestionRefreshToken = ref(0)
const activeRefinementRank = ref(1)
const avatarFieldRef = ref<InstanceType<typeof AdminCalculatorAvatarField> | null>(null)

const form = ref({
  id: '',
  name: '',
  profession: '',
  rarity: 'A' as WengineBuffDoc['rarity'],
  note: '',
  baseAtk: 0,
  advancedStats: createEmptyWengineAdvancedStats(),
  fixedBuffs: createEmptySelfTeamBuffs(),
  refinementForm: createEmptyWengineRefinementBuffs(),
})

const filteredWengines = computed(() => {
  const keyword = search.value.trim()
  return wengines.value.filter((item) =>
    (!keyword || `${item.name}${item.rarity}${item.id}${item.profession}`.includes(keyword)) &&
    (!roleFilter.value || item.profession === roleFilter.value),
  )
})

const activeRefinementForm = computed(
  () => form.value.refinementForm[activeRefinementRank.value - 1]!,
)

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

function loadRefinementForm(refinementBuffs: WengineBuffDoc['refinementBuffs']) {
  return REFINEMENT_RANKS.map((_, index) =>
    cloneSelfTeamBuffs(refinementBuffs[index] ?? createEmptySelfTeamBuffs()),
  )
}

function loadForm(doc: WengineBuffDoc) {
  form.value = {
    id: doc.id,
    name: doc.name,
    profession: doc.profession ?? '',
    rarity: doc.rarity,
    note: doc.note ?? '',
    baseAtk: doc.baseAtk,
    advancedStats: { ...doc.advancedStats },
    fixedBuffs: cloneSelfTeamBuffs(doc.fixedBuffs),
    refinementForm: loadRefinementForm(doc.refinementBuffs),
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
    profession: '',
    rarity: 'A',
    note: '',
    baseAtk: 0,
    advancedStats: createEmptyWengineAdvancedStats(),
    fixedBuffs: createEmptySelfTeamBuffs(),
    refinementForm: createEmptyWengineRefinementBuffs(),
  }
  activeRefinementRank.value = 1
  selectedId.value = ''
  avatarFieldRef.value?.clearAvatarImage()
}

function selectItem(id: string) {
  selectedId.value = id
  const doc = wengines.value.find((item) => item.id === id)
  if (doc) loadForm(doc)
}

function createNew() {
  resetForm()
}

function buildRefinementBuffs() {
  return form.value.refinementForm.map((rank) => packFromBlocks(rank.effectBlocks ?? []))
}

function rememberWenginePanelStats() {
  rememberWengineStatValue(WENGINE_BASE_ATK_FIELD_KEY, form.value.baseAtk)
  for (const field of WENGINE_ADVANCED_STAT_FIELDS) {
    rememberWengineStatValue(
      wengineAdvancedStatFieldKey(field.key),
      form.value.advancedStats[field.key],
    )
  }
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
  if (!isEditing && wengines.value.some((item) => item.id === id)) {
    error.value = '该 ID 已存在'
    return
  }
  if (isEditing && selectedId.value !== id && wengines.value.some((item) => item.id === id)) {
    error.value = '新 ID 已被其他音擎占用'
    return
  }

  saving.value = true
  try {
    const avatar_image = (await avatarFieldRef.value?.resolveAvatarImageOnSave()) ?? null
    const doc: WengineBuffDoc = {
      id,
      name,
      profession: form.value.profession,
      rarity: form.value.rarity,
      note: form.value.note.trim(),
      avatar_image,
      baseAtk: Number(form.value.baseAtk) || 0,
      advancedStats: { ...form.value.advancedStats } as WengineAdvancedStats,
      fixedBuffs: packFromBlocks(form.value.fixedBuffs.effectBlocks ?? []),
      refinementBuffs: buildRefinementBuffs(),
    }

    if (isEditing && selectedId.value !== id) {
      await store.deleteWengine(selectedId.value)
    }

    await store.upsertWengine(doc)
    selectedId.value = id
    rememberWenginePanelStats()
    suggestionRefreshToken.value += 1
    message.value = isEditing ? `已保存音擎「${name}」` : `已新增音擎「${name}」`
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function removeItem() {
  if (!selectedId.value) return
  const current = wengines.value.find((item) => item.id === selectedId.value)
  if (!current) return
  if (!window.confirm(`确定删除音擎「${current.name}」吗？`)) return

  try {
    await store.deleteWengine(selectedId.value)
    message.value = `已删除音擎「${current.name}」`
    const next = wengines.value[0]
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
  wengines,
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

async function scrollToSection(sectionId: WengineBuffEditSectionId) {
  await nextTick()
  const target = panelRootRef.value?.querySelector<HTMLElement>(`#${sectionId}`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

defineExpose({ scrollToSection, saveItem, removeItem, selectedId, saving })
</script>

<template>
  <div ref="panelRootRef" class="editor-panel">
    <header class="panel-header">
      <h1 class="panel-title">编辑音擎增益</h1>
      <p class="panel-desc">固定增益与精1至精5精炼增益，均使用固定数值条目。</p>
    </header>

    <div class="editor-layout">
      <aside id="admin-wengine-picker" class="item-list editor-anchor">
        <label class="field">
          <span class="field-label">搜索音擎</span>
          <input v-model="search" type="text" class="field-input" placeholder="名称 / 稀有度" />
        </label>
        <label class="field">
          <span class="field-label">职业筛选</span>
          <select v-model="roleFilter" class="field-input">
            <option value="">全部职业</option>
            <option v-for="role in AGENT_ROLES" :key="role" :value="role">
              {{ role }}
            </option>
          </select>
        </label>

        <button type="button" class="secondary-btn" @click="createNew">+ 新增音擎</button>

        <div class="list-scroll">
          <button
            v-for="item in filteredWengines"
            :key="item.id"
            type="button"
            class="list-item"
            :class="{ active: selectedId === item.id }"
            @click="selectItem(item.id)"
          >
            <CalculatorAvatar :avatar-image="item.avatar_image" :name="item.name" />
            <span class="list-name">{{ item.name }}</span>
            <span class="list-meta">{{ item.profession || '未分类' }} · {{ item.rarity }} 级</span>
          </button>
        </div>
      </aside>

      <form class="editor-form" @submit.prevent="saveItem">
        <div id="admin-wengine-basic" class="editor-anchor">
        <div class="field-row">
          <label class="field">
            <span class="field-label">ID *</span>
            <input v-model="form.id" type="text" class="field-input" placeholder="如 s-resonance" />
          </label>
          <label class="field">
            <span class="field-label">名称 *</span>
            <input v-model="form.name" type="text" class="field-input" placeholder="音擎名称" />
          </label>
        </div>

        <div class="field-row">
          <label class="field">
            <span class="field-label">职业</span>
            <select v-model="form.profession" class="field-input">
              <option value="">未分类</option>
              <option v-for="role in AGENT_ROLES" :key="role" :value="role">
                {{ role }}
              </option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">稀有度</span>
            <select v-model="form.rarity" class="field-input">
              <option v-for="rarity in WENGINE_RARITIES" :key="rarity" :value="rarity">
                {{ rarity }}
              </option>
            </select>
          </label>
        </div>
        </div>

        <div id="admin-wengine-note" class="editor-anchor">
          <label class="field note-field">
            <span class="field-label">音擎注释</span>
            <textarea
              v-model="form.note"
              class="field-textarea"
              rows="3"
              placeholder="佩戴该音擎时在伤害计算页显示此注释"
            />
          </label>
        </div>

        <div id="admin-wengine-avatar" class="editor-anchor">
          <AdminCalculatorAvatarField ref="avatarFieldRef" />
        </div>

        <section id="admin-wengine-base-stats" class="mindscape-section editor-anchor">
          <header class="mindscape-header">
            <h3>基础属性</h3>
            <p>音擎局外基础攻击与高级属性，暂不纳入当前伤害计算；保存后数值会记入本机历史，可从下拉快速选用。</p>
          </header>
          <AdminRememberedNumberField
            v-model="form.baseAtk"
            :field-key="WENGINE_BASE_ATK_FIELD_KEY"
            label="基础攻击力"
            :refresh-token="suggestionRefreshToken"
          />
          <p class="mods-section-title">高级属性</p>
          <AdminWengineAdvancedStatsGrid
            v-model="form.advancedStats"
            :fields="WENGINE_ADVANCED_STAT_FIELDS"
            :refresh-token="suggestionRefreshToken"
          />
        </section>

        <section id="admin-wengine-fixed" class="mindscape-section editor-anchor">
          <header class="mindscape-header">
            <h3>固定增益</h3>
          </header>
          <AdminBuffEffectEditor v-model="form.fixedBuffs.effectBlocks" />
        </section>

        <section id="admin-wengine-refinement" class="mindscape-section editor-anchor">
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

          <p class="mods-section-title">精{{ activeRefinementRank }} · 效果块</p>
          <AdminBuffEffectEditor v-model="activeRefinementForm.effectBlocks" />
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
