<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import {
  fetchBossInfoList,
  updateBossInfoRecord,
  type BossInfoCatalog,
  type BossInfoRecord,
} from '@/api/bossInfo'
import AdminBuffEffectEditor from '@/components/admin/calculator/AdminBuffEffectEditor.vue'
import type { BuffEffectBlock } from '@/types/calculator'
import { normalizeBuffEffectBlocks, packFromBlocks } from '@/utils/buffEffect'
import { resolveAssetUrl } from '@/utils/gameData'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'

interface BossInfoDraft {
  boss_name: string
  defense: number
  level: number
  stagger_multiplier: number
  weakness: string
  resistance: string
  crisis_base_hp: number | ''
  boss_image: string
  field_buff_name: string
  field_buff_text: string
  field_buff_image: string
}

const catalog = ref<BossInfoCatalog>('all')
const keyword = ref('')
const loading = ref(false)
const savingId = ref<number | null>(null)
const error = ref('')
const message = ref('')
const items = ref<BossInfoRecord[]>([])
const total = ref(0)
const editingId = ref<number | null>(null)
const draft = ref<BossInfoDraft>(createEmptyDraft())
const fieldBuffBlocks = ref<BuffEffectBlock[]>([])
const editPanelRef = ref<HTMLElement | null>(null)

const calculatorBuffStore = useCalculatorBuffStore()

const catalogTabs: { id: BossInfoCatalog; label: string; desc: string }[] = [
  { id: 'all', label: '总基础库', desc: '全部 boss_info 记录' },
  { id: 'crisis', label: '危局', desc: '在危局强袭战出现过的怪物' },
  { id: 'defense', label: '防卫战', desc: '在式舆防卫战出现过的怪物' },
  { id: 'deduction', label: '临界', desc: '在临界推演出现过的怪物' },
]

function createEmptyDraft(): BossInfoDraft {
  return {
    boss_name: '',
    defense: 0,
    level: 1,
    stagger_multiplier: 1.5,
    weakness: '',
    resistance: '',
    crisis_base_hp: '',
    boss_image: '',
    field_buff_name: '',
    field_buff_text: '',
    field_buff_image: '',
  }
}

function toDraft(row: BossInfoRecord): BossInfoDraft {
  return {
    boss_name: row.boss_name ?? '',
    defense: Number(row.defense) || 0,
    level: Number(row.level) || 1,
    stagger_multiplier: Number(row.stagger_multiplier) || 1.5,
    weakness: row.weakness ?? '',
    resistance: row.resistance ?? '',
    crisis_base_hp:
      row.crisis_base_hp != null && Number.isFinite(Number(row.crisis_base_hp))
        ? Number(row.crisis_base_hp)
        : '',
    boss_image: row.boss_image ?? '',
    field_buff_name: row.field_buff_name ?? '',
    field_buff_text: row.field_buff_text ?? '',
    field_buff_image: row.field_buff_image ?? '',
  }
}

async function loadList() {
  loading.value = true
  error.value = ''
  try {
    const result = await fetchBossInfoList({
      keyword: keyword.value.trim(),
      catalog: catalog.value,
      limit: 500,
      offset: 0,
    })
    items.value = result.items
    total.value = result.total
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function startEdit(row: BossInfoRecord) {
  editingId.value = row.id
  draft.value = toDraft(row)
  fieldBuffBlocks.value = normalizeBuffEffectBlocks(row.field_buff_effect_blocks ?? [])
  message.value = ''
  error.value = ''
  try {
    await calculatorBuffStore.ensureLoaded()
  } catch {
    // 效果编辑器招式小类可选；加载失败不阻断基础字段编辑
  }
  await nextTick()
  editPanelRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function cancelEdit() {
  editingId.value = null
  draft.value = createEmptyDraft()
  fieldBuffBlocks.value = []
}

async function saveEdit() {
  if (editingId.value == null) return
  if (!draft.value.boss_name.trim()) {
    error.value = '名称不能为空'
    return
  }
  savingId.value = editingId.value
  message.value = ''
  error.value = ''
  try {
    const packed = packFromBlocks(normalizeBuffEffectBlocks(fieldBuffBlocks.value))
    const bossName = draft.value.boss_name.trim()
    const blocks = packed.effectBlocks
      .filter((block) => block.effects?.length)
      .map((block) => {
        const name = block.name?.trim() || ''
        const isGeneric = !name || /^效果块\s*\d+$/.test(name)
        return {
          ...block,
          name: isGeneric ? draft.value.field_buff_name.trim() || '场地 Buff' : name,
          note: block.note?.trim() || '',
        }
      })
    const fieldBuffName =
      draft.value.field_buff_name.trim() || (blocks.length ? '场地 Buff' : '') || null
    await updateBossInfoRecord(editingId.value, {
      boss_name: bossName,
      defense: Number(draft.value.defense) || 0,
      level: Number(draft.value.level) || 1,
      weakness: draft.value.weakness.trim() || null,
      resistance: draft.value.resistance.trim() || null,
      boss_image: draft.value.boss_image.trim() || null,
      crisis_base_hp:
        draft.value.crisis_base_hp === '' || draft.value.crisis_base_hp == null
          ? null
          : Number(draft.value.crisis_base_hp),
      stagger_multiplier: Number(draft.value.stagger_multiplier) || 1.5,
      field_buff_name: fieldBuffName,
      field_buff_text: draft.value.field_buff_text.trim() || null,
      field_buff_image: draft.value.field_buff_image.trim() || null,
      field_buff_effect_blocks: blocks.length ? blocks : null,
    })
    message.value = '已保存'
    cancelEdit()
    await loadList()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    savingId.value = null
  }
}

watch(catalog, () => {
  cancelEdit()
  void loadList()
})

onMounted(() => {
  void loadList()
})
</script>

<template>
  <div class="boss-info-catalog">
    <header class="catalog-header">
      <div>
        <h1>怪物基础库</h1>
        <p>
          维护 boss_info：同名怪物在危局 / 防卫战 / 临界 / 计算器中共用基础数据。危局 Boss 场地 Buff
          挂在此表（与 Boss 名一一对应）。
        </p>
      </div>
      <div class="search-row">
        <input
          v-model="keyword"
          type="search"
          placeholder="按名称搜索"
          @keydown.enter.prevent="loadList"
        />
        <button type="button" :disabled="loading" @click="loadList">
          {{ loading ? '加载中…' : '搜索' }}
        </button>
      </div>
    </header>

    <div class="catalog-tabs" role="tablist" aria-label="怪物库分类">
      <button
        v-for="tab in catalogTabs"
        :key="tab.id"
        type="button"
        role="tab"
        class="catalog-tab"
        :class="{ active: catalog === tab.id }"
        :aria-selected="catalog === tab.id"
        :title="tab.desc"
        @click="catalog = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>
    <p class="catalog-tab-desc">
      {{ catalogTabs.find((tab) => tab.id === catalog)?.desc }}
    </p>

    <p v-if="message" class="catalog-message">{{ message }}</p>
    <p v-if="error" class="catalog-error">{{ error }}</p>
    <p class="catalog-meta">共 {{ total }} 条 · 失衡易伤默认 150%（1.5）</p>

    <section
      v-if="editingId != null"
      ref="editPanelRef"
      class="edit-panel"
    >
      <header class="edit-header">
        <h2>编辑 · {{ draft.boss_name || '怪物' }}</h2>
        <div class="actions">
          <button type="button" :disabled="savingId === editingId" @click="saveEdit">
            {{ savingId === editingId ? '保存中…' : '保存' }}
          </button>
          <button type="button" class="ghost" @click="cancelEdit">取消</button>
        </div>
      </header>

      <div class="edit-grid">
        <label class="field">
          <span>名称</span>
          <input v-model="draft.boss_name" type="text" />
        </label>
        <label class="field">
          <span>防御</span>
          <input v-model.number="draft.defense" type="number" min="0" />
        </label>
        <label class="field">
          <span>等级</span>
          <input v-model.number="draft.level" type="number" min="1" />
        </label>
        <label class="field">
          <span>失衡易伤</span>
          <input v-model.number="draft.stagger_multiplier" type="number" min="0" step="0.01" />
        </label>
        <label class="field">
          <span>弱点</span>
          <input v-model="draft.weakness" type="text" />
        </label>
        <label class="field">
          <span>抗性</span>
          <input v-model="draft.resistance" type="text" />
        </label>
        <label class="field">
          <span>危局基础血量</span>
          <input v-model="draft.crisis_base_hp" type="number" min="0" step="1" />
        </label>
        <label class="field">
          <span>图片路径</span>
          <input v-model="draft.boss_image" type="text" placeholder="/boss_image/..." />
        </label>
      </div>

      <div class="field-buff-section">
        <h3>危局 Boss 场地 Buff</h3>
        <p class="field-hint">
          仅危局使用；与 Boss 名一一对应。文本仅作展示对照，计算器读取下方结构化效果。
        </p>
        <div class="edit-grid">
          <label class="field">
            <span>场地 Buff 名称</span>
            <input v-model="draft.field_buff_name" type="text" placeholder="留空表示无场地 Buff" />
          </label>
          <label class="field">
            <span>场地 Buff 图片</span>
            <input v-model="draft.field_buff_image" type="text" placeholder="/buff_image/..." />
          </label>
        </div>
        <label class="field">
          <span>场地 Buff 文本</span>
          <textarea
            v-model="draft.field_buff_text"
            rows="4"
            placeholder="每行一条效果描述（展示对照用）"
          />
        </label>
        <div class="field field-blocks">
          <span>结构化效果（可选）</span>
          <AdminBuffEffectEditor
            v-model="fieldBuffBlocks"
            :default-first-block-name="draft.field_buff_name || '场地 Buff'"
          />
        </div>
      </div>
    </section>

    <div class="table-wrap">
      <table class="catalog-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>防御</th>
            <th>等级</th>
            <th>失衡易伤</th>
            <th>弱点</th>
            <th>抗性</th>
            <th>危局基础血量</th>
            <th>场地 Buff</th>
            <th>图片</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in items" :key="row.id" :class="{ editing: editingId === row.id }">
            <td>{{ row.boss_name }}</td>
            <td>{{ row.defense }}</td>
            <td>{{ row.level }}</td>
            <td>{{ row.stagger_multiplier ?? 1.5 }}</td>
            <td>{{ row.weakness || '—' }}</td>
            <td>{{ row.resistance || '—' }}</td>
            <td>{{ row.crisis_base_hp ?? '—' }}</td>
            <td>{{ row.field_buff_name || '—' }}</td>
            <td>
              <img
                v-if="row.boss_image"
                :src="resolveAssetUrl(row.boss_image)"
                alt=""
                class="thumb"
              />
              <span v-else>—</span>
            </td>
            <td class="actions">
              <button type="button" @click="startEdit(row)">
                {{ editingId === row.id ? '编辑中' : '编辑' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!loading && !items.length" class="empty-list">当前分类下暂无记录</p>
    </div>
  </div>
</template>

<style scoped>
.boss-info-catalog {
  max-width: 1280px;
  margin: 0 auto;
  padding: 1rem 0 2rem;
}

.catalog-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.catalog-header h1 {
  margin: 0 0 0.35rem;
  font-size: 1.35rem;
  color: var(--color-heading);
}

.catalog-header p {
  margin: 0;
  font-size: 0.86rem;
  color: var(--color-text);
  opacity: 0.75;
  max-width: 640px;
}

.search-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.search-row input {
  min-width: 220px;
}

.search-row button,
.actions button {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  padding: 0.35rem 0.75rem;
  cursor: pointer;
}

.actions button.ghost {
  background: transparent;
}

.catalog-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-bottom: 0.35rem;
}

.catalog-tab {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: transparent;
  color: var(--color-text);
  padding: 0.35rem 0.9rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.84rem;
}

.catalog-tab.active {
  border-color: #e8a838;
  color: var(--color-heading);
  background: color-mix(in srgb, #e8a838 16%, transparent);
}

.catalog-tab-desc {
  margin: 0 0 0.75rem;
  font-size: 0.78rem;
  opacity: 0.7;
}

.catalog-meta {
  margin: 0 0 0.75rem;
  font-size: 0.82rem;
  opacity: 0.7;
}

.catalog-message {
  color: #7cb87c;
  margin: 0 0 0.5rem;
}

.catalog-error {
  color: #e57373;
  margin: 0 0 0.5rem;
}

.table-wrap {
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: 10px;
}

.catalog-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
}

.catalog-table th,
.catalog-table td {
  border-bottom: 1px solid var(--color-border);
  padding: 0.45rem 0.55rem;
  text-align: left;
  vertical-align: middle;
}

.catalog-table th {
  background: var(--color-background-soft);
  position: sticky;
  top: 0;
}

.catalog-table tr.editing {
  background: color-mix(in srgb, var(--color-background-soft) 70%, #e8a838 12%);
}

.thumb {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 6px;
}

.actions {
  white-space: nowrap;
  display: flex;
  gap: 0.35rem;
}

.empty-list {
  margin: 0;
  padding: 1rem;
  text-align: center;
  opacity: 0.65;
  font-size: 0.85rem;
}

.edit-panel {
  margin: 0 0 1.25rem;
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
}

.edit-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 1rem;
}

.edit-header h2 {
  margin: 0;
  font-size: 1.1rem;
  color: var(--color-heading);
}

.edit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.82rem;
}

.field span {
  font-weight: 600;
  color: var(--color-heading);
}

.field input,
.field textarea {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
  padding: 0.4rem 0.55rem;
  font: inherit;
}

.field textarea {
  resize: vertical;
  min-height: 5rem;
}

.field-blocks {
  margin-top: 0.75rem;
}

.field-buff-section {
  margin-top: 0.5rem;
  padding-top: 1rem;
  border-top: 1px dashed var(--color-border);
}

.field-buff-section h3 {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
  color: var(--color-heading);
}

.field-hint {
  margin: 0 0 0.75rem;
  font-size: 0.8rem;
  opacity: 0.72;
  line-height: 1.45;
}
</style>
