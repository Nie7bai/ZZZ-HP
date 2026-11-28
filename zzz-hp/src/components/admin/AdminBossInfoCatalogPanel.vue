<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  createBossInfoRecord,
  deleteBossInfoRecord,
  fetchBossInfoList,
  syncBossInfoFromBoss,
  updateBossInfoRecord,
  type BossInfoCatalog,
  type BossInfoFieldBuffSet,
  type BossInfoRecord,
  type BossInfoWeaknessSet,
} from '@/api/bossInfo'
import AdminBossInfoImportExportPanel from '@/components/admin/AdminBossInfoImportExportPanel.vue'
import AdminBuffEffectEditor from '@/components/admin/calculator/AdminBuffEffectEditor.vue'
import AdminConfirmDialog from '@/components/admin/AdminConfirmDialog.vue'
import type { BuffEffectBlock } from '@/types/calculator'
import { normalizeBuffEffectBlocks, packFromBlocks } from '@/utils/buffEffect'
import { resolveAssetUrl } from '@/utils/gameData'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import ElementTraitChips from '@/components/shared/ElementTraitChips.vue'

interface BossInfoDraft {
  boss_name: string
  defense: number
  level: number
  stagger_multiplier: number
  stagger_time: number | ''
  /** 异常条系数（初始异常积蓄 = 基础异常条 × 系数），空按 1 处理 */
  anomaly_bar_coefficient: number | ''
  weakness: string
  resistance: string
  /** 高抗性（40%）属性，为 resistance 的子集 */
  resistance_high: string
  crisis_base_hp: number | ''
  /** 得分机制多套（与场地 Buff 同构；第一套为默认） */
  scoring_note_sets: ScoringNoteSetDraft[]
  boss_image: string
}

interface FieldBuffSetDraft {
  id: string
  label: string
  name: string
  text: string
  image: string
  blocks: BuffEffectBlock[]
}

interface ScoringNoteSetDraft {
  id: string
  label: string
  name: string
  text: string
}

interface WeaknessSetDraft {
  id: string
  label: string
  weakness: string
  resistance: string
  resistanceHigh: string
}

const catalog = ref<BossInfoCatalog>('all')
const pageTab = ref<'list' | 'io'>('list')
const keyword = ref('')
const loading = ref(false)
const syncing = ref(false)
const savingId = ref<number | null>(null)
const deletingId = ref<number | null>(null)
const error = ref('')
const message = ref('')
const items = ref<BossInfoRecord[]>([])
const total = ref(0)
const editingId = ref<number | null>(null)
/** 新增模式：编辑面板开着一份空草稿，保存时走 POST */
const creating = ref(false)
const savingNew = ref(false)
/** 编辑时的原名：改名要提示是否同步到各期 */
const originalName = ref('')
/**
 * 保存请求代次：取消编辑 / 重新打开会 +1，
 * 旧请求（含挂起 20 秒后才超时的那种）回来时不再改当前表单的状态，
 * 否则会出现「没点保存却显示保存中」。
 */
let saveEpoch = 0
const editorOpen = computed(() => creating.value || editingId.value != null)
/**
 * 当前表单是否正在保存。
 * 不能写成 `savingId === editingId`：新增时两者都是 null，`null === null` 为真，
 * 打开面板就会误显示「保存中…」且按钮禁用（2026-11-28 事故）。
 */
const savingThisForm = computed(() =>
  creating.value ? savingNew.value : savingId.value != null && savingId.value === editingId.value,
)
const draft = ref<BossInfoDraft>(createEmptyDraft())
const fieldBuffSets = ref<FieldBuffSetDraft[]>([])
const weaknessSets = ref<WeaknessSetDraft[]>([])
const weakSetSeq = ref(0)

function createEmptyWeaknessSet(partial?: Partial<WeaknessSetDraft>): WeaknessSetDraft {
  weakSetSeq.value += 1
  return {
    id: partial?.id || `trait_${Date.now().toString(36)}_${weakSetSeq.value}`,
    label: partial?.label ?? '',
    weakness: partial?.weakness ?? '',
    resistance: partial?.resistance ?? '',
    resistanceHigh: partial?.resistanceHigh ?? '',
  }
}

function weaknessSetsFromRecord(row: BossInfoRecord): WeaknessSetDraft[] {
  const sets = Array.isArray(row.weakness_sets) ? row.weakness_sets : []
  const drafts = sets.map((set: BossInfoWeaknessSet) =>
    createEmptyWeaknessSet({
      id: set.id,
      label: set.label ?? '',
      weakness: set.weakness ?? '',
      resistance: set.resistance ?? '',
      resistanceHigh: set.resistanceHigh ?? '',
    }),
  )
  if (drafts.length) return drafts
  // 旧基础三列 → 第一套；三项都空也保留一套空套（便于直接新增/填写）
  const legacy = {
    weakness: row.weakness ?? '',
    resistance: row.resistance ?? '',
    resistanceHigh: row.resistance_high ?? '',
  }
  return [createEmptyWeaknessSet({ id: 'legacy', ...legacy })]
}

function createEmptyScoringNoteSet(): ScoringNoteSetDraft {
  return {
    id: `sn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    label: '',
    name: '得分机制',
    text: '',
  }
}

function addScoringNoteSet() {
  draft.value.scoring_note_sets.push(createEmptyScoringNoteSet())
}

function removeScoringNoteSet(index: number) {
  draft.value.scoring_note_sets.splice(index, 1)
}

function addWeaknessSet() {
  weaknessSets.value.push(createEmptyWeaknessSet())
}

function removeWeaknessSet(index: number) {
  weaknessSets.value.splice(index, 1)
}

function packWeaknessSetsPayload(): BossInfoWeaknessSet[] {
  // 只要在编辑器里新增过就保留，空套也提交（不再按内容过滤）
  return weaknessSets.value.map((set) => ({
    id: set.id,
    label: set.label.trim() || null,
    weakness: set.weakness.trim() || null,
    resistance: set.resistance.trim() || null,
    resistanceHigh: set.resistanceHigh.trim() || null,
  }))
}

const editPanelRef = ref<HTMLElement | null>(null)
const confirmVisible = ref(false)
const confirmMessage = ref('')
const pendingDelete = ref<BossInfoRecord | null>(null)
const renameVisible = ref(false)
const renameMessage = ref('')
const renameSaving = ref(false)
let pendingRenamePayload: ReturnType<typeof buildSavePayload> | null = null

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
    stagger_time: '',
    anomaly_bar_coefficient: '',
    weakness: '',
    resistance: '',
    resistance_high: '',
    crisis_base_hp: '',
    scoring_note_sets: [],
    boss_image: '',
  }
}

function makeSetId() {
  return `set_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function createEmptyFieldBuffSet(partial?: Partial<FieldBuffSetDraft>): FieldBuffSetDraft {
  return {
    id: partial?.id || makeSetId(),
    label: partial?.label ?? '',
    name: partial?.name ?? '',
    text: partial?.text ?? '',
    image: partial?.image ?? '',
    blocks: partial?.blocks ? normalizeBuffEffectBlocks(partial.blocks) : [],
  }
}

function setsFromRecord(row: BossInfoRecord): FieldBuffSetDraft[] {
  const fromSets = Array.isArray(row.field_buff_sets) ? row.field_buff_sets : []
  if (fromSets.length) {
    return fromSets.map((set: BossInfoFieldBuffSet) =>
      createEmptyFieldBuffSet({
        id: set.id,
        label: set.label ?? '',
        name: set.name ?? '',
        text: set.text ?? '',
        image: set.image ?? '',
        blocks: normalizeBuffEffectBlocks(set.effectBlocks ?? []),
      }),
    )
  }
  if (
    row.field_buff_name ||
    row.field_buff_text ||
    row.field_buff_image ||
    (row.field_buff_effect_blocks?.length ?? 0) > 0
  ) {
    return [
      createEmptyFieldBuffSet({
        id: 'legacy',
        name: row.field_buff_name ?? '',
        text: row.field_buff_text ?? '',
        image: row.field_buff_image ?? '',
        blocks: normalizeBuffEffectBlocks(row.field_buff_effect_blocks ?? []),
      }),
    ]
  }
  return []
}

function fieldBuffSummary(row: BossInfoRecord) {
  const sets = Array.isArray(row.field_buff_sets) ? row.field_buff_sets : []
  if (sets.length) {
    if (sets.length === 1) return sets[0]!.name || sets[0]!.label || '1 套'
    return `${sets.length} 套 · ${sets[0]!.name || sets[0]!.label || '未命名'}`
  }
  return row.field_buff_name || '—'
}

function toDraft(row: BossInfoRecord): BossInfoDraft {
  return {
    boss_name: row.boss_name ?? '',
    defense: Number(row.defense) || 0,
    level: Number(row.level) || 1,
    stagger_multiplier: Number(row.stagger_multiplier) || 1.5,
    stagger_time:
      row.stagger_time != null && Number.isFinite(Number(row.stagger_time))
        ? Number(row.stagger_time)
        : '',
    anomaly_bar_coefficient:
      row.anomaly_bar_coefficient != null && Number.isFinite(Number(row.anomaly_bar_coefficient))
        ? Number(row.anomaly_bar_coefficient)
        : '',
    weakness: row.weakness ?? '',
    resistance: row.resistance ?? '',
    resistance_high: row.resistance_high ?? '',
    crisis_base_hp:
      row.crisis_base_hp != null && Number.isFinite(Number(row.crisis_base_hp))
        ? Number(row.crisis_base_hp)
        : '',
    scoring_note_sets: Array.isArray(row.scoring_note_sets)
      ? row.scoring_note_sets.map((set) => ({
          id: set.id,
          label: set.label ?? '',
          name: set.name ?? '',
          text: set.text ?? '',
        }))
      : row.scoring_note
        ? [{ id: 'legacy', label: '', name: '得分机制', text: row.scoring_note }]
        : [],
    boss_image: row.boss_image ?? '',
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

async function startCreate() {
  saveEpoch += 1
  savingNew.value = false
  savingId.value = null
  creating.value = true
  editingId.value = null
  draft.value = createEmptyDraft()
  fieldBuffSets.value = []
  weaknessSets.value = []
  message.value = ''
  error.value = ''
  try {
    await calculatorBuffStore.ensureLoaded()
  } catch {
    // 效果编辑器招式小类可选；加载失败不阻断基础字段录入
  }
  await nextTick()
  editPanelRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

async function startEdit(row: BossInfoRecord) {
  saveEpoch += 1
  savingNew.value = false
  savingId.value = null
  creating.value = false
  editingId.value = row.id
  originalName.value = row.boss_name
  draft.value = toDraft(row)
  fieldBuffSets.value = setsFromRecord(row)
  weaknessSets.value = weaknessSetsFromRecord(row)
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
  saveEpoch += 1
  creating.value = false
  editingId.value = null
  savingNew.value = false
  savingId.value = null
  draft.value = createEmptyDraft()
  fieldBuffSets.value = []
  weaknessSets.value = []
}

function addFieldBuffSet() {
  fieldBuffSets.value.push(createEmptyFieldBuffSet({ name: '场地 Buff' }))
}

function removeFieldBuffSet(index: number) {
  fieldBuffSets.value.splice(index, 1)
}

function packFieldBuffSetsPayload(): BossInfoFieldBuffSet[] {
  const out: BossInfoFieldBuffSet[] = []
  for (const set of fieldBuffSets.value) {
    const packed = packFromBlocks(normalizeBuffEffectBlocks(set.blocks))
    const blocks = packed.effectBlocks
      .filter((block) => block.effects?.length)
      .map((block) => {
        const name = block.name?.trim() || ''
        const isGeneric = !name || /^效果块\s*\d+$/.test(name)
        return {
          ...block,
          name: isGeneric ? set.name.trim() || '场地 Buff' : name,
          note: block.note?.trim() || '',
        }
      })
    const name = set.name.trim() || (blocks.length ? '场地 Buff' : '')
    if (!name && !set.text.trim() && !set.image.trim() && !blocks.length) continue
    out.push({
      id: set.id || makeSetId(),
      label: set.label.trim() || null,
      name: name || '场地 Buff',
      text: set.text.trim(),
      image: set.image.trim() || null,
      effectBlocks: blocks.length ? blocks : null,
    })
  }
  return out
}

function buildSavePayload() {
  const bossName = draft.value.boss_name.trim()
  const sets = packFieldBuffSetsPayload()
  const weaknessSetsPayload = packWeaknessSetsPayload()
  const firstWeakness = weaknessSetsPayload[0]
  return {
    boss_name: bossName,
    defense: Number(draft.value.defense) || 0,
    level: Number(draft.value.level) || 1,
    // 多套是权威来源：基础三列由第一套镜像，隐藏字段不再直接保存
    weakness: firstWeakness?.weakness ?? null,
    resistance: firstWeakness?.resistance ?? null,
    resistance_high: firstWeakness?.resistanceHigh ?? null,
    boss_image: draft.value.boss_image.trim() || null,
    crisis_base_hp:
      draft.value.crisis_base_hp === '' || draft.value.crisis_base_hp == null
        ? null
        : Number(draft.value.crisis_base_hp),
    stagger_multiplier: Number(draft.value.stagger_multiplier) || 1.5,
    stagger_time:
      draft.value.stagger_time === '' || draft.value.stagger_time == null
        ? null
        : Number(draft.value.stagger_time),
    scoring_note_sets: draft.value.scoring_note_sets
      .map((set) => ({
        id: set.id,
        label: set.label.trim() || null,
        name: set.name.trim() || '得分机制',
        text: set.text.trim(),
      }))
      .filter((set) => set.text || set.name !== '得分机制'),
    anomaly_bar_coefficient:
      draft.value.anomaly_bar_coefficient === '' || draft.value.anomaly_bar_coefficient == null
        ? null
        : Number(draft.value.anomaly_bar_coefficient),
    field_buff_sets: sets,
    weakness_sets: packWeaknessSetsPayload(),
  }
}

async function saveEdit() {
  if (!creating.value && editingId.value == null) return
  if (!draft.value.boss_name.trim()) {
    error.value = '名称不能为空'
    return
  }
  const payload = buildSavePayload()
  if (!creating.value && originalName.value && originalName.value !== payload.boss_name) {
    pendingRenamePayload = payload
    renameMessage.value =
      `名称已由「${originalName.value}」改为「${payload.boss_name}」。\n` +
      '各期（危局 / 防卫战 / 临界）里的怪物行仍是旧名，不同步的话那些期会找不到这只怪的基础数据（弱点、场地 Buff、得分机制）。\n' +
      '是否把各期的同名怪物行一起改名？'
    renameVisible.value = true
    return
  }
  await commitSave(payload, false)
}

async function confirmRename(syncPeriods: boolean) {
  const payload = pendingRenamePayload
  renameVisible.value = false
  renameSaving.value = true
  try {
    if (payload) await commitSave(payload, syncPeriods)
  } finally {
    renameSaving.value = false
    pendingRenamePayload = null
    renameMessage.value = ''
  }
}

async function commitSave(payload: ReturnType<typeof buildSavePayload>, syncPeriods: boolean) {
  const epoch = ++saveEpoch
  const isCreate = creating.value
  if (isCreate) savingNew.value = true
  else savingId.value = editingId.value
  message.value = ''
  error.value = ''
  try {
    if (isCreate) {
      const result = await createBossInfoRecord(payload)
      message.value = result.action === 'updated' ? '同名怪物已存在，已更新' : '已新增怪物'
    } else {
      const result = await updateBossInfoRecord(editingId.value as number, {
        ...payload,
        ...(syncPeriods ? { rename_periods: true } : {}),
      })
      const renamed = Number(result.renamedPeriods ?? 0)
      message.value = syncPeriods
        ? `已保存${renamed ? `，并同步改名 ${renamed} 条期数怪物行` : '（各期没有同名怪物行可同步）'}`
        : '已保存'
    }
    cancelEdit()
    await loadList()
  } catch (err) {
    if (epoch === saveEpoch) error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    if (epoch === saveEpoch) {
      savingNew.value = false
      savingId.value = null
    }
  }
}

function askDelete(row: BossInfoRecord) {
  pendingDelete.value = row
  confirmMessage.value = `确定从怪物基础库删除「${row.boss_name}」吗？\n仅删除 boss_info 目录记录，不会删除各期已录入的怪物行。`
  confirmVisible.value = true
}

function askDeleteCurrent() {
  if (editingId.value == null) return
  const row = items.value.find((item) => item.id === editingId.value)
  if (row) {
    askDelete(row)
    return
  }
  askDelete({
    id: editingId.value,
    boss_name: draft.value.boss_name.trim() || '未命名',
    defense: Number(draft.value.defense) || 0,
    level: Number(draft.value.level) || 1,
    boss_image: draft.value.boss_image.trim() || null,
    weakness: draft.value.weakness.trim() || null,
    resistance: draft.value.resistance.trim() || null,
  })
}

function closeDeleteConfirm() {
  if (deletingId.value != null) return
  confirmVisible.value = false
  pendingDelete.value = null
  confirmMessage.value = ''
}

async function executeDelete() {
  const row = pendingDelete.value
  if (!row) return
  deletingId.value = row.id
  message.value = ''
  error.value = ''
  try {
    const result = await deleteBossInfoRecord(row.id)
    const hint =
      result.referenced_count > 0
        ? `（各期仍有 ${result.referenced_count} 条同名记录）`
        : ''
    message.value = `已删除「${result.boss_name}」${hint}`
    if (editingId.value === row.id) cancelEdit()
    confirmVisible.value = false
    pendingDelete.value = null
    await loadList()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除失败'
  } finally {
    deletingId.value = null
  }
}

async function syncFromBoss() {
  if (syncing.value) return
  syncing.value = true
  message.value = ''
  error.value = ''
  try {
    const mode = catalog.value === 'all' ? null : catalog.value
    const result = await syncBossInfoFromBoss(mode)
    const scopeLabel =
      mode == null ? '全部模式' : catalogTabs.find((tab) => tab.id === mode)?.label || mode
    message.value = `已从 ${scopeLabel} boss 表同步：扫描 ${result.scanned} · 新建 ${result.created} · 更新图片 ${result.updatedImage} · 未变 ${result.unchanged}`
    await loadList()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '同步失败'
  } finally {
    syncing.value = false
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
          可配置多套，由各期怪物行绑定。临界有图而基础库缺图时，可用「从 boss 同步」。
        </p>
        <div class="page-tabs" role="tablist">
          <button
            type="button"
            class="page-tab"
            :class="{ active: pageTab === 'list' }"
            role="tab"
            :aria-selected="pageTab === 'list'"
            @click="pageTab = 'list'"
          >
            列表管理
          </button>
          <button
            type="button"
            class="page-tab"
            :class="{ active: pageTab === 'io' }"
            role="tab"
            :aria-selected="pageTab === 'io'"
            @click="pageTab = 'io'"
          >
            导入 / 导出
          </button>
        </div>
      </div>
      <div v-if="pageTab === 'list'" class="search-row">
        <input
          v-model="keyword"
          type="search"
          class="search-input"
          placeholder="按名称搜索"
          @keydown.enter.prevent="loadList"
        />
        <button type="button" class="search-btn" :disabled="loading" @click="loadList">
          {{ loading ? '加载中…' : '搜索' }}
        </button>
        <button
          type="button"
          class="search-btn"
          :disabled="loading"
          title="直接在基础库新建一只怪物（以名称为业务键）"
          @click="startCreate"
        >
          新增怪物
        </button>
        <button
          type="button"
          class="search-btn sync-btn"
          :disabled="syncing || loading"
          :title="
            catalog === 'all'
              ? '从全部模式 boss 表回填缺失怪物，并把 /UI/ 路径换成可用本地图'
              : `从当前分类（${catalogTabs.find((tab) => tab.id === catalog)?.label}）boss 表同步`
          "
          @click="syncFromBoss"
        >
          {{ syncing ? '同步中…' : '从 boss 同步' }}
        </button>
      </div>
    </header>

    <AdminBossInfoImportExportPanel v-if="pageTab === 'io'" @imported="loadList" />

    <template v-else>
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
    <p class="catalog-meta">共 {{ total }} 条 · 失衡易伤默认 150%（1.5）· 失衡时间单位秒（可空）</p>

    <section
      v-if="editorOpen"
      ref="editPanelRef"
      class="edit-panel"
    >
      <header class="edit-header">
        <h2>{{ creating ? '新增 · 怪物' : `编辑 · ${draft.boss_name || '怪物'}` }}</h2>
        <div class="actions">
          <button type="button" :disabled="savingThisForm" @click="saveEdit">
            {{ savingThisForm ? '保存中…' : '保存' }}
          </button>
          <button type="button" class="ghost" @click="cancelEdit">取消</button>
          <button
            v-if="!creating"
            type="button"
            class="danger-btn"
            :disabled="editingId != null && deletingId === editingId"
            @click="askDeleteCurrent"
          >
            删除
          </button>
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
          <span>失衡时间（秒）</span>
          <input v-model="draft.stagger_time" type="number" min="0" step="0.1" />
        </label>
        <label class="field">
          <span>异常条系数</span>
          <input
            v-model="draft.anomaly_bar_coefficient"
            type="number"
            min="0"
            step="0.0001"
            placeholder="1.32"
          />
        </label>
        <label class="field">
          <span>危局基础血量</span>
          <input v-model="draft.crisis_base_hp" type="number" min="0" step="1" />
        </label>
        <label class="field">
          <span>图片路径</span>
          <input v-model="draft.boss_image" type="text" placeholder="/boss_image/..." />
        </label>
        <div class="field field--wide">
          <header class="field-buff-header">
            <div>
              <span>得分机制（多套，纯文本无增益）</span>
              <p class="field-hint">
                第一套为默认；某期改了规则就新增一套，在「编辑怪物（期数）」里绑定。
                详情页显示在「场地 Buff」上方。
              </p>
            </div>
            <button type="button" class="ghost" @click="addScoringNoteSet">新增一套</button>
          </header>
          <p v-if="!draft.scoring_note_sets.length" class="field-hint">暂无得分机制，可点「新增一套」。</p>
          <div
            v-for="(set, setIndex) in draft.scoring_note_sets"
            :key="set.id"
            class="scoring-set"
          >
            <div class="scoring-set-head">
              <input v-model="set.label" type="text" class="field-input" placeholder="标记（可选，如「3.4 调整」）" />
              <input v-model="set.name" type="text" class="field-input" placeholder="名称（默认「得分机制」）" />
              <button type="button" class="ghost danger" @click="removeScoringNoteSet(setIndex)">删除</button>
            </div>
            <textarea
              v-model="set.text"
              rows="4"
              class="field-input"
              placeholder="每行一条；留空则该套视为未填写"
            />
          </div>
        </div>
      </div>

      <div class="field-buff-section">
        <header class="field-buff-header">
          <div>
            <h3>弱点 / 抗性（多套）</h3>
            <p class="field-hint">
              多套是唯一来源，第一套即原来的基础弱点/抗性；危局按当期绑定的一套展示。
              没有多套配置的怪物继续沿用旧格式。
            </p>
          </div>
          <button type="button" class="ghost" @click="addWeaknessSet">新增一套</button>
        </header>

        <p v-if="!weaknessSets.length" class="field-hint empty-sets">
          暂无多套配置；单套弱点/抗性用上方字段即可。
        </p>

        <div
          v-for="(set, setIndex) in weaknessSets"
          :key="set.id"
          class="field-buff-set"
          :title="`套 id：${set.id}`"
        >
          <header class="field-buff-set-head">
            <strong>套 {{ setIndex + 1 }}</strong>
            <button type="button" class="danger-btn" @click="removeWeaknessSet(setIndex)">
              删除
            </button>
          </header>
          <label class="field">
            <span>备注（可选）</span>
            <input v-model="set.label" type="text" placeholder="如：第一阶段 / 狂暴后" />
          </label>
          <div class="edit-grid">
            <div class="field">
              <ElementTraitChips v-model="set.weakness" label="弱点" variant="weak" />
            </div>
            <div class="field">
              <ElementTraitChips
                v-model="set.resistance"
                v-model:high="set.resistanceHigh"
                label="抗性"
                variant="resist"
                allow-high
              />
            </div>
          </div>
        </div>
      </div>

      <div class="field-buff-section">
        <header class="field-buff-header">
          <div>
            <h3>危局 Boss 场地 Buff</h3>
            <p class="field-hint">
              可配置多套，由危局每期怪物行绑定其中一套。文本仅作展示对照，计算器读取结构化效果。
            </p>
          </div>
          <button type="button" class="ghost" @click="addFieldBuffSet">新增一套</button>
        </header>

        <p v-if="!fieldBuffSets.length" class="field-hint empty-sets">暂无场地 Buff，可点「新增一套」。</p>

        <div
          v-for="(set, setIndex) in fieldBuffSets"
          :key="set.id"
          class="field-buff-set"
          :title="`套 id：${set.id}`"
        >
          <header class="field-buff-set-head">
            <strong>套 {{ setIndex + 1 }}</strong>
            <button type="button" class="danger-btn" @click="removeFieldBuffSet(setIndex)">
              删除
            </button>
          </header>
          <div class="edit-grid">
            <label class="field">
              <span>备注（可选）</span>
              <input v-model="set.label" type="text" placeholder="如：3.1 第 2 期" />
            </label>
            <label class="field">
              <span>场地 Buff 名称</span>
              <input v-model="set.name" type="text" placeholder="留空且无效果则丢弃本套" />
            </label>
            <label class="field">
              <span>场地 Buff 图片</span>
              <input v-model="set.image" type="text" placeholder="/buff_image/..." />
            </label>
          </div>
          <label class="field">
            <span>场地 Buff 文本</span>
            <textarea
              v-model="set.text"
              rows="3"
              placeholder="每行一条效果描述（展示对照用）"
            />
          </label>
          <div class="field field-blocks">
            <span>结构化效果（可选）</span>
            <AdminBuffEffectEditor
              v-model="set.blocks"
              :default-first-block-name="set.name || '场地 Buff'"
            />
          </div>
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
            <th>失衡时间</th>
            <th>异常条系数</th>
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
            <td>{{ row.stagger_time ?? '—' }}</td>
            <td>{{ row.anomaly_bar_coefficient ?? 1 }}</td>
            <td>{{ row.weakness || '—' }}</td>
            <td>{{ row.resistance || '—' }}</td>
            <td>{{ row.crisis_base_hp ?? '—' }}</td>
            <td>{{ fieldBuffSummary(row) }}</td>
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
              <button
                type="button"
                class="danger-btn"
                :disabled="deletingId === row.id"
                @click="askDelete(row)"
              >
                {{ deletingId === row.id ? '删除中…' : '删除' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!loading && !items.length" class="empty-list">当前分类下暂无记录</p>
    </div>

    <AdminConfirmDialog
      :visible="renameVisible"
      title="名称已变更，是否同步各期？"
      :message="renameMessage"
      confirm-text="同步改名"
      cancel-text="仅改基础库"
      :loading="renameSaving"
      @confirm="confirmRename(true)"
      @cancel="confirmRename(false)"
    />
    <AdminConfirmDialog
      :visible="confirmVisible"
      title="确认删除怪物基础信息"
      :message="confirmMessage"
      confirm-text="删除"
      :danger="true"
      :loading="deletingId !== null"
      @confirm="executeDelete"
      @cancel="closeDeleteConfirm"
    />
    </template>
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

.page-tabs {
  display: inline-flex;
  gap: 0.4rem;
  margin-top: 0.55rem;
}

.page-tab {
  padding: 0.4rem 0.85rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 0.86rem;
  font-weight: 600;
  cursor: pointer;
}

.page-tab.active {
  border-color: #c4a35a;
  background: hsla(40, 50%, 55%, 0.16);
}

.search-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.search-input {
  min-width: 220px;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  font: inherit;
  font-size: 0.88rem;
  outline: none;
  transition: border-color 0.15s ease;
}

.search-input:focus {
  border-color: #c9a55c;
}

.search-btn,
.actions button,
.field-buff-header .ghost {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  padding: 0.4rem 0.85rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.84rem;
}

.search-btn:hover:not(:disabled),
.actions button:hover:not(:disabled) {
  border-color: #c9a55c;
  color: var(--color-heading);
  background: color-mix(in srgb, #c9a55c 12%, var(--color-background-soft));
}

.sync-btn {
  border-color: hsla(200, 70%, 45%, 0.45);
  background: hsla(200, 70%, 45%, 0.1);
}

.search-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.actions button.ghost,
.field-buff-header .ghost {
  background: transparent;
}

.field-buff-header .ghost:hover {
  border-color: #c9a55c;
  color: var(--color-heading);
  background: color-mix(in srgb, #c9a55c 12%, transparent);
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
  align-items: center;
}

.actions .danger-btn {
  padding: 0.35rem 0.7rem;
  font-size: 0.82rem;
  background: var(--color-background);
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

/* 得分机制是长文本，跨满整行 */
.field--wide {
  grid-column: 1 / -1;
}

.scoring-set {
  margin-top: 0.5rem;
  padding: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.scoring-set-head {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  flex-wrap: wrap;
}

.scoring-set-head .field-input {
  flex: 1 1 140px;
  min-width: 120px;
}

.ghost.danger {
  color: #e07070;
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
  margin-top: 0.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.field-buff-section h3 {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
  color: var(--color-heading);
}

.field-buff-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: flex-start;
}

.field-buff-set {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 0.85rem;
  background: var(--color-background);
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.field-buff-set-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.55rem;
}

.field-buff-set-head strong {
  font-size: 0.88rem;
  color: var(--color-heading);
}

.danger-btn {
  border: 1px solid rgba(196, 92, 92, 0.4);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: #c45c5c;
  padding: 0.35rem 0.7rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
}

.danger-btn:hover {
  border-color: rgba(196, 92, 92, 0.65);
  background: color-mix(in srgb, #c45c5c 10%, var(--color-background-soft));
}

.empty-sets {
  margin: 0;
}

.field-hint {
  margin: 0;
  font-size: 0.8rem;
  opacity: 0.72;
  line-height: 1.45;
}

.field-buff-set .edit-grid {
  margin-bottom: 0;
}

.field-buff-set .field-blocks {
  margin-top: 0;
}
</style>
