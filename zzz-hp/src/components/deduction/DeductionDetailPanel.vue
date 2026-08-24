<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  deductionNodeTypeLabel,
  deductionPeriodDisplay,
  fetchDeductionPhases,
  isDeductionBattleNode,
  isDeductionStoryNode,
  type DeductionFieldBuff,
  type DeductionMonster,
  type DeductionNode,
  type DeductionPeriod,
} from '@/api/deduction'
import {
  fetchDeductionPickBosses,
  fetchDeductionPickBuffs,
  fetchDeductionShiyuMinions,
  type AdminEditFocus,
  type AdminPickBoss,
  type AdminPickBuff,
} from '@/api/deductionAdmin'
import AdminDeductionFuzzySelect from '@/components/admin/AdminDeductionFuzzySelect.vue'
import { formatHp, splitBuffLines } from '@/utils/gameData'
import { parseElementIcons } from '@/utils/elementIcons'

const props = withDefaults(
  defineProps<{
    /** 管理端：显示编辑入口并发出编辑事件 */
    adminMode?: boolean
  }>(),
  { adminMode: false },
)

const emit = defineEmits<{
  'admin-save-info': [version: string, nodeId: string, payload: { name: string; type: number; storyText: string }]
  'admin-save-buff': [version: string, nodeId: string, index: number, payload: { title: string; desc: string; buff_image?: string | null }]
  'admin-create-buff': [version: string, nodeId: string, index: number, payload: { title: string; desc: string; buff_image?: string | null }]
  'admin-remove-buff': [version: string, nodeId: string, index: number]
  'admin-save-story-option': [version: string, nodeId: string, index: number, payload: { name: string; desc: string }]
  'admin-create-story-option': [version: string, nodeId: string, index: number, payload: { name: string; desc: string }]
  'admin-remove-story-option': [version: string, nodeId: string, index: number]
  'admin-save-layer': [version: string, nodeId: string, index: number, payload: { name: string; isBoss: boolean }]
  'admin-add-layer': [version: string, nodeId: string, isBoss: boolean]
  'admin-remove-layer': [version: string, nodeId: string, index: number]
  'admin-save-monster': [version: string, nodeId: string, layer: number, index: number, payload: DeductionMonster]
  'admin-create-monster': [version: string, nodeId: string, layer: number, index: number, payload: DeductionMonster]
  'admin-remove-monster': [version: string, nodeId: string, layer: number, index: number]
  'admin-reorder-nodes': [version: string]
  'admin-create-node': [version: string]
  'admin-delete-node': [version: string, node: DeductionNode]
  'admin-create-period': []
  'admin-rename-period': [period: DeductionPeriod]
  'admin-delete-period': [period: DeductionPeriod]
}>()

type InlineTarget =
  | { kind: 'info' }
  | { kind: 'story' }
  | { kind: 'buff'; index: number }
  | { kind: 'layer'; layer: number }
  | { kind: 'monster'; layer: number; index: number }
  | { kind: 'storyOption'; index: number }

/** 管理端内联编辑：当前正在就地编辑的目标 */
const editing = ref<InlineTarget | null>(null)
const editError = ref('')
/** 新增后尚未保存的条目：点击取消时回滚删除，避免空数据残留 */
const pendingNewItem = ref<AdminEditFocus | null>(null)
const infoDraft = ref({ name: '', type: 0, story: '' })
const buffDraft = ref<{ title: string; desc: string; buff_image: string | null }>({
  title: '',
  desc: '',
  buff_image: null,
})
const storyOptionDraft = ref({ name: '', desc: '' })
const layerDraft = ref<{ name: string }>({ name: '' })
const monsterDraft = ref<DeductionMonster>({
  name: '',
  hp: 0,
  defense: 0,
  level: 1,
  weakness: null,
  resistance: null,
  boss_image: null,
})

function currentVersion() {
  return currentPeriod.value?.periodId ?? ''
}

function beginEditInfo() {
  if (!activeNode.value) return
  infoDraft.value = {
    name: activeNode.value.name,
    type: normalizeNodeType(activeNode.value.type),
    story: activeNode.value.storyText ?? '',
  }
  editing.value = { kind: 'info' }
}

function beginEditStory() {
  if (!activeNode.value) return
  infoDraft.value = {
    name: activeNode.value.name,
    type: activeNode.value.type,
    story: activeNode.value.storyText ?? '',
  }
  editing.value = { kind: 'story' }
}

function beginEditBuff(index: number) {
  const buff = activeNode.value?.buffs[index]
  if (!buff) return
  editError.value = ''
  buffDraft.value = {
    title: buff.title,
    desc: buff.desc ?? '',
    buff_image: buff.buff_image ?? null,
  }
  editing.value = { kind: 'buff', index }
}

function beginEditLayer(layer: number) {
  const l = activeNode.value?.layers[layer]
  if (!l) return
  layerDraft.value = { name: l.name }
  editing.value = { kind: 'layer', layer }
}

function beginEditMonster(layer: number, index: number) {
  const m = activeNode.value?.layers[layer]?.monsters[index]
  if (!m) return
  editError.value = ''
  monsterDraft.value = JSON.parse(JSON.stringify(m)) as DeductionMonster
  editing.value = { kind: 'monster', layer, index }
}

function cancelEdit() {
  if (pendingNewItem.value) {
    // 有未保存的新增项：以服务端数据为准重新拉取，本地待存项被丢弃，界面不残留
    void refreshAfterPendingDiscard()
  } else {
    editing.value = null
    editError.value = ''
  }
}

/** 丢弃本地未保存的新增项：重新拉取服务端数据（本地新增未持久化，刷新后自然消失） */
async function refreshAfterPendingDiscard() {
  pendingNewItem.value = null
  editing.value = null
  editError.value = ''
  await reload()
}

// ── 新增：仅本地展示（真实写入由「保存」触发） ──────────────────────

function onAddBuff() {
  if (!activeNode.value) return
  const index = activeNode.value.buffs.length
  activeNode.value.buffs.push({ title: '', desc: '', buff_image: null })
  editing.value = { kind: 'buff', index }
  pendingNewItem.value = { kind: 'buff', index }
  editError.value = ''
}

function onAddStoryOption() {
  if (!activeNode.value) return
  const opts = (activeNode.value.storyOptions ??= [])
  const index = opts.length
  opts.push({ name: '', desc: null })
  editing.value = { kind: 'storyOption', index }
  pendingNewItem.value = { kind: 'storyOption', index }
  editError.value = ''
}

function onAddMonster(layer: number) {
  if (!activeNode.value) return
  const monsters = activeNode.value.layers[layer]?.monsters
  if (!monsters) return
  const index = monsters.length
  monsters.push({
    name: '',
    hp: 0,
    defense: 0,
    level: 1,
    weakness: null,
    resistance: null,
    boss_image: null,
  })
  editing.value = { kind: 'monster', layer, index }
  pendingNewItem.value = { kind: 'monster', layer, index }
  editError.value = ''
}

function saveInfo() {
  if (!activeNode.value) return
  emit('admin-save-info', currentVersion(), activeNode.value.nodeId, {
    name: infoDraft.value.name.trim() || activeNode.value.name,
    type: infoDraft.value.type,
    storyText: infoDraft.value.story,
  })
  editing.value = null
}

function saveStory() {
  if (!activeNode.value) return
  emit('admin-save-info', currentVersion(), activeNode.value.nodeId, {
    name: activeNode.value.name,
    type: activeNode.value.type,
    storyText: infoDraft.value.story,
  })
  editing.value = null
}

function saveBuff() {
  if (!activeNode.value || editing.value?.kind !== 'buff') return
  const title = buffDraft.value.title.trim()
  if (!title) {
    editError.value = '增益名称不能为空'
    return
  }
  editError.value = ''
  const pending = pendingNewItem.value
  pendingNewItem.value = null
  const payload = {
    title,
    desc: buffDraft.value.desc,
    buff_image: buffDraft.value.buff_image,
  }
  if (pending?.kind === 'buff') {
    emit('admin-create-buff', currentVersion(), activeNode.value.nodeId, pending.index, payload)
  } else {
    emit('admin-save-buff', currentVersion(), activeNode.value.nodeId, editing.value.index, payload)
  }
  editing.value = null
}

function beginEditStoryOption(index: number) {
  const opt = activeNode.value?.storyOptions?.[index]
  if (!opt) return
  storyOptionDraft.value = { name: opt.name, desc: opt.desc ?? '' }
  editing.value = { kind: 'storyOption', index }
}

function saveStoryOption() {
  if (!activeNode.value || editing.value?.kind !== 'storyOption') return
  const pending = pendingNewItem.value
  pendingNewItem.value = null
  const payload = {
    name: storyOptionDraft.value.name.trim() || '未命名选项',
    desc: storyOptionDraft.value.desc,
  }
  if (pending?.kind === 'storyOption') {
    emit('admin-create-story-option', currentVersion(), activeNode.value.nodeId, pending.index, payload)
  } else {
    emit('admin-save-story-option', currentVersion(), activeNode.value.nodeId, editing.value.index, payload)
  }
  editing.value = null
}

function isEditingStoryOption(index: number) {
  return editing.value?.kind === 'storyOption' && editing.value.index === index
}

function saveLayer() {
  if (!activeNode.value || editing.value?.kind !== 'layer') return
  const layer = activeNode.value.layers[editing.value.layer]
  if (!layer) return
  emit('admin-save-layer', currentVersion(), activeNode.value.nodeId, editing.value.layer, {
    name: layerDraft.value.name.trim() || `层 ${editing.value.layer + 1}`,
    // 编辑层名不改前战/终局类型，isBoss 由行内开关即时保存
    isBoss: layer.isBoss === true,
  })
  editing.value = null
}

/** 行内前战/终局开关：切换即保存 */
function onToggleLayerBoss(layerIndex: number, event: Event) {
  if (!activeNode.value) return
  const layer = activeNode.value.layers[layerIndex]
  if (!layer) return
  const isBoss = (event.target as HTMLInputElement).checked
  emit('admin-save-layer', currentVersion(), activeNode.value.nodeId, layerIndex, {
    name: layer.name,
    isBoss,
  })
}

function saveMonster() {
  if (!activeNode.value || editing.value?.kind !== 'monster') return
  const name = monsterDraft.value.name.trim()
  if (!name) {
    editError.value = '怪物名称不能为空'
    return
  }
  editError.value = ''
  const pending = pendingNewItem.value
  pendingNewItem.value = null
  const payload = monsterDraft.value
  if (pending?.kind === 'monster') {
    emit('admin-create-monster', currentVersion(), activeNode.value.nodeId, pending.layer, pending.index, payload)
  } else {
    emit('admin-save-monster', currentVersion(), activeNode.value.nodeId, editing.value.layer, editing.value.index, payload)
  }
  editing.value = null
}

function isEditingBuff(index: number) {
  return editing.value?.kind === 'buff' && editing.value.index === index
}

function isEditingMonster(layer: number, index: number) {
  return editing.value?.kind === 'monster' && editing.value.layer === layer && editing.value.index === index
}

function isEditingLayer(layer: number) {
  return editing.value?.kind === 'layer' && editing.value.layer === layer
}

// ── 内联编辑器辅助 ──────────────────────

const NODE_TYPES = [
  { value: 1, label: '剧情' },
  { value: 2, label: '战斗' },
]

/** 归一化节点类型：仅保留 剧情(1) / 战斗(2)，老数据 3=最终战→战斗、4=开场/5=剧情变体→剧情 */
function normalizeNodeType(type: number): number {
  return isDeductionBattleNode(type) ? 2 : 1
}

const ELEMENTS = ['冰', '火', '电', '以太', '物理', '风', '霜', '流明']

function splitElements(value: string | null): string[] {
  if (!value) return []
  return value
    .split(/[、,]/)
    .map((s) => s.replace(/属性$/, '').trim())
    .filter(Boolean)
}

function joinElements(list: string[]): string | null {
  return list.length ? [...new Set(list)].join('、') : null
}

function toggleElement(list: string[], el: string): string[] {
  return list.includes(el) ? list.filter((x) => x !== el) : [...list, el]
}

// ── 下拉数据源（怪物 / Buff） ──────────────────────

const pickBosses = ref<AdminPickBoss[]>([])
const pickBuffs = ref<AdminPickBuff[]>([])
const shiyuMinions = ref<AdminPickBoss[]>([])
const pickersLoading = ref(false)

/** 终局（Boss）层 → 危局数据源；前战（小怪）层 → shiyu 数据源 */
function isBossLayer(layerIndex: number): boolean {
  return activeNode.value?.layers[layerIndex]?.isBoss === true
}

function monsterPickerOptions(layerIndex: number): AdminPickBoss[] {
  return isBossLayer(layerIndex) ? pickBosses.value : shiyuMinions.value
}

function onMonsterName(value: string) {
  if (monsterDraft.value.name !== value) monsterDraft.value.boss_image = null
  monsterDraft.value.name = value
}

/** 选中候选后自动填入属性 / 数据（与旧 AdminDeductionPanel 逻辑一致） */
function onPickMonster(option: { name: string; [key: string]: unknown }) {
  monsterDraft.value.name = option.name
  monsterDraft.value.hp = Number(option.hp) || 0
  monsterDraft.value.defense = Number(option.defense) || 0
  monsterDraft.value.level = Number(option.level) || monsterDraft.value.level
  monsterDraft.value.weakness =
    option.weakness == null ? null : String(option.weakness)
  monsterDraft.value.resistance =
    option.resistance == null ? null : String(option.resistance)
  if (option.boss_image) monsterDraft.value.boss_image = String(option.boss_image)
}

function onPickBuff(option: { name: string; [key: string]: unknown }) {
  buffDraft.value.title = option.name
  buffDraft.value.desc = option.desc == null ? '' : String(option.desc)
  if (option.buff_image) buffDraft.value.buff_image = String(option.buff_image)
}

async function loadPickers() {
  if (!props.adminMode) return
  pickersLoading.value = true
  // 各源独立加载：shiyu 小怪抓 nanoka 较慢/偶发失败，不应拖累 Boss / Buff 数据源
  const results = await Promise.allSettled([
    fetchDeductionPickBosses(),
    fetchDeductionPickBuffs(),
    fetchDeductionShiyuMinions(),
  ])
  if (results[0].status === 'fulfilled') pickBosses.value = results[0].value
  else console.warn('[deduction] Boss 数据源加载失败:', results[0].reason)
  if (results[1].status === 'fulfilled') pickBuffs.value = results[1].value
  else console.warn('[deduction] Buff 数据源加载失败:', results[1].reason)
  if (results[2].status === 'fulfilled') shiyuMinions.value = results[2].value
  else console.warn('[deduction] shiyu 小怪数据源加载失败:', results[2].reason)
  pickersLoading.value = false
}

// ── 新增层：前战 / 终局 选择 ──────────────────────

const layerAddOpen = ref(false)

function confirmAddLayer(isBoss: boolean) {
  layerAddOpen.value = false
  if (activeNode.value) {
    emit('admin-add-layer', currentVersion(), activeNode.value.nodeId, isBoss)
  }
}

const periods = ref<DeductionPeriod[]>([])
const currentIndex = ref(0)
const activeNodeIndex = ref(0)
const loading = ref(false)
const loadError = ref('')
const showPicker = ref(false)

const currentPeriod = computed<DeductionPeriod | null>(
  () => periods.value[currentIndex.value] ?? null,
)

const activeNode = computed<DeductionNode | null>(
  () => currentPeriod.value?.nodes[activeNodeIndex.value] ?? null,
)

const suppressNodeReset = ref(false)

watch(currentPeriod, () => {
  if (suppressNodeReset.value) return
  activeNodeIndex.value = 0
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    periods.value = await fetchDeductionPhases()
    currentIndex.value = periods.value.length - 1
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '加载失败'
    periods.value = []
  } finally {
    loading.value = false
  }
}

/** 管理端刷新：默认保持当前期数与节点选中位，不跳回第一个页签；可传 target 跳转到指定期数/节点 */
async function reload(target?: { periodId?: string; nodeId?: string }) {
  const keepPeriod = target?.periodId ?? currentPeriod.value?.periodId
  const keepNodeId = target?.nodeId ?? activeNode.value?.nodeId
  suppressNodeReset.value = true
  await load()
  if (keepPeriod != null) {
    const idx = periods.value.findIndex((p) => p.periodId === keepPeriod)
    if (idx >= 0) {
      currentIndex.value = idx
      if (keepNodeId != null) {
        const nidx = currentPeriod.value?.nodes.findIndex((n) => n.nodeId === keepNodeId) ?? -1
        // 目标节点不存在（如刚被删除）时落到该期第一个节点
        activeNodeIndex.value = nidx >= 0 ? nidx : 0
      }
    } else {
      // 原期数已不存在（如刚被删除）：落到当前期第一个节点
      activeNodeIndex.value = 0
    }
  }
  // watch(currentPeriod) 默认 pre-flush（异步）：必须等挂起的 watcher 跑完（期间仍抑制重置）
  // 再解除抑制，否则它会在 suppressNodeReset 复位后把 activeNodeIndex 重置回 0，导致跳回第一个节点。
  await nextTick()
  suppressNodeReset.value = false
  // 注：reload 会以服务端数据整体替换本地数据，任何未保存的本地新增项都会被丢弃（符合“仅保存才入库”语义）
}

defineExpose({ reload })

function onAdminCreateNode() {
  if (props.adminMode && currentPeriod.value) {
    emit('admin-create-node', currentPeriod.value.periodId)
  }
}

function onAdminDeleteNode() {
  if (props.adminMode && currentPeriod.value && activeNode.value) {
    emit('admin-delete-node', currentPeriod.value.periodId, activeNode.value)
  }
}

/** 切换期数/节点前：若存在未保存的新增项，先刷新服务端数据丢弃它，再执行切换 */
async function prevPeriod() {
  if (pendingNewItem.value) await refreshAfterPendingDiscard()
  if (currentIndex.value > 0) currentIndex.value--
}

async function nextPeriod() {
  if (pendingNewItem.value) await refreshAfterPendingDiscard()
  if (currentIndex.value < periods.value.length - 1) currentIndex.value++
}

async function selectPeriod(index: number) {
  if (pendingNewItem.value) await refreshAfterPendingDiscard()
  currentIndex.value = index
  showPicker.value = false
}

async function selectNode(index: number) {
  if (index === activeNodeIndex.value) return
  if (pendingNewItem.value) await refreshAfterPendingDiscard()
  activeNodeIndex.value = index
}

function onImageError(event: Event) {
  ;(event.target as HTMLImageElement).style.display = 'none'
}

function fieldBuffLines(fieldBuff: DeductionFieldBuff | null | undefined) {
  const text = fieldBuff?.text?.trim()
  return text ? splitBuffLines(text) : []
}

onMounted(() => {
  load()
  loadPickers()
})
</script>

<template>
  <div class="dd-panel">
    <div v-if="loading" class="dd-state">加载中…</div>
    <div v-else-if="loadError" class="dd-state dd-state--error">加载失败：{{ loadError }}</div>
    <div v-else-if="!currentPeriod" class="dd-state">暂无推演数据</div>

    <template v-else>
      <!-- 期数导航 -->
      <div class="dd-topbar">
        <button class="dd-nav" type="button" :disabled="currentIndex === 0" @click="prevPeriod">
          ‹
        </button>
        <button class="dd-period-btn" type="button" @click="showPicker = true">
          {{ deductionPeriodDisplay(currentPeriod) }}
          <span class="dd-period-caret">▾</span>
        </button>
        <button
          class="dd-nav"
          type="button"
          :disabled="currentIndex >= periods.length - 1"
          @click="nextPeriod"
        >
          ›
        </button>
        <template v-if="adminMode">
          <button class="dd-admin-btn" type="button" @click="emit('admin-create-period')">
            新建期数
          </button>
          <button
            class="dd-admin-btn"
            type="button"
            @click="emit('admin-rename-period', currentPeriod)"
          >
            改名
          </button>
          <button
            class="dd-admin-btn dd-admin-btn--danger"
            type="button"
            @click="emit('admin-delete-period', currentPeriod)"
          >
            删除
          </button>
        </template>
      </div>

      <!-- 节点页签 -->
      <div v-if="currentPeriod.nodes.length" class="dd-tabs">
        <button
          v-for="(node, index) in currentPeriod.nodes"
          :key="node.nodeId"
          type="button"
          class="dd-tab"
          :class="{
            'dd-tab--active': index === activeNodeIndex,
            'dd-tab--story': isDeductionStoryNode(node.type),
            'dd-tab--battle': isDeductionBattleNode(node.type),
          }"
          @click="selectNode(index)"
        >
          {{ node.name }}
        </button>
        <template v-if="adminMode">
          <button class="dd-tab dd-tab--admin" type="button" @click="onAdminCreateNode">
            + 新建节点
          </button>
          <button
            class="dd-tab dd-tab--admin"
            type="button"
            @click="emit('admin-reorder-nodes', currentVersion())"
          >
            排序节点
          </button>
          <button
            class="dd-tab dd-tab--admin dd-tab--admin-danger"
            type="button"
            @click="onAdminDeleteNode"
          >
            删除本节点
          </button>
        </template>
      </div>

      <!-- 当前节点内容 -->
      <div v-if="activeNode" class="dd-node-view">
        <article
          class="dd-card"
          :class="isDeductionBattleNode(activeNode.type) ? 'dd-card--battle' : 'dd-card--story'"
        >
          <header class="dd-card-head">
            <span
              class="dd-badge"
              :class="{ 'dd-badge--battle': isDeductionBattleNode(activeNode.type) }"
            >
              {{ deductionNodeTypeLabel(activeNode.type) }}
            </span>

            <!-- 信息内联编辑 -->
            <template v-if="adminMode && editing?.kind === 'info'">
              <input v-model="infoDraft.name" class="dd-inline dd-inline--name" placeholder="节点名称" />
              <select v-model="infoDraft.type" class="dd-inline dd-inline--select">
                <option v-for="t in NODE_TYPES" :key="t.value" :value="t.value">
                  {{ t.label }}
                </option>
              </select>
              <button class="dd-admin-btn dd-admin-btn--primary" type="button" @click="saveInfo">
                保存
              </button>
              <button class="dd-admin-btn" type="button" @click="cancelEdit">取消</button>
            </template>
            <template v-else>
              <h3 class="dd-card-title">{{ activeNode.name }}</h3>
              <button v-if="adminMode" class="dd-admin-btn" type="button" @click="beginEditInfo">
                编辑名称/类型
              </button>
            </template>
          </header>

          <!-- 剧情（故事节点）：内联编辑 -->
          <template v-if="isDeductionStoryNode(activeNode.type)">
            <div v-if="adminMode && editing?.kind === 'story'" class="dd-inline-block">
              <textarea
                v-model="infoDraft.story"
                class="dd-inline dd-inline--textarea"
                rows="10"
                placeholder="剧情文本"
              ></textarea>
              <div class="dd-inline-actions">
                <button class="dd-admin-btn dd-admin-btn--primary" type="button" @click="saveStory">
                  保存剧情
                </button>
                <button class="dd-admin-btn" type="button" @click="cancelEdit">取消</button>
              </div>
            </div>
            <template v-else>
              <p v-if="activeNode.storyText" class="dd-story-text">{{ activeNode.storyText }}</p>
              <p v-else-if="adminMode" class="dd-empty">暂无剧情文本</p>
              <button
                v-if="adminMode"
                class="dd-admin-btn dd-admin-btn--add"
                type="button"
                @click="beginEditStory"
              >
                {{ activeNode.storyText ? '编辑剧情' : '+ 新增剧情' }}
              </button>
            </template>

            <!-- 剧情选项（管理端可增删改，公开端只读） -->
            <div v-if="adminMode || activeNode.storyOptions?.length" class="dd-story-options">
              <h4 class="dd-section-title">选项</h4>
              <div
                v-for="(opt, oi) in activeNode.storyOptions ?? []"
                :key="oi"
                class="dd-option"
                :class="{ 'dd-option--editing': adminMode && isEditingStoryOption(oi) }"
              >
                <template v-if="adminMode && isEditingStoryOption(oi)">
                  <div class="dd-inline-block">
                    <input
                      v-model="storyOptionDraft.name"
                      class="dd-inline dd-inline--wide"
                      placeholder="选项文本"
                    />
                    <textarea
                      v-model="storyOptionDraft.desc"
                      class="dd-inline dd-inline--textarea"
                      rows="2"
                      placeholder="解锁条件（可选）"
                    ></textarea>
                    <div class="dd-inline-actions">
                      <button class="dd-admin-btn dd-admin-btn--primary" type="button" @click="saveStoryOption">保存</button>
                      <button class="dd-admin-btn" type="button" @click="cancelEdit">取消</button>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <span class="dd-option-index">{{ oi + 1 }}</span>
                  <div class="dd-option-body">
                    <span class="dd-option-name">{{ opt.name }}</span>
                    <span v-if="opt.desc" class="dd-option-desc">{{ opt.desc }}</span>
                  </div>
                  <template v-if="adminMode">
                    <button class="dd-admin-btn" type="button" @click="beginEditStoryOption(oi)">编辑</button>
                    <button
                      class="dd-admin-btn dd-admin-btn--danger"
                      type="button"
                      @click="emit('admin-remove-story-option', currentVersion(), activeNode?.nodeId ?? '', oi)"
                    >
                      删
                    </button>
                  </template>
                </template>
              </div>
              <button
                v-if="adminMode"
                class="dd-admin-btn dd-admin-btn--add"
                type="button"
                @click="onAddStoryOption"
              >
                + 新增选项
              </button>
            </div>
          </template>

          <!-- 战斗节点：可选增益（管理端常显 + 逐个新增 + 就地编辑） -->
          <section v-if="isDeductionBattleNode(activeNode.type)" class="dd-buffs">
            <h4 class="dd-section-title">可选增益</h4>
            <div v-for="(buff, bi) in activeNode.buffs" :key="bi" class="dd-buff">
              <template v-if="adminMode && isEditingBuff(bi)">
                <div class="dd-inline-block">
                  <AdminDeductionFuzzySelect
                    :options="pickBuffs"
                    :model-value="buffDraft.title"
                    label="增益名"
                    placeholder="搜索 Buff…"
                    :loading="pickersLoading"
                    @update:model-value="buffDraft.title = $event"
                    @select="onPickBuff"
                  />
                  <textarea
                    v-model="buffDraft.desc"
                    class="dd-inline dd-inline--textarea"
                    rows="3"
                    placeholder="效果描述"
                  ></textarea>
                  <p v-if="editError" class="dd-edit-error">{{ editError }}</p>
                  <div class="dd-inline-actions">
                    <button class="dd-admin-btn dd-admin-btn--primary" type="button" @click="saveBuff">保存</button>
                    <button class="dd-admin-btn" type="button" @click="cancelEdit">取消</button>
                  </div>
                </div>
              </template>
              <template v-else>
                <div class="dd-buff-head">
                  <img
                    v-if="buff.buff_image"
                    class="dd-buff-img"
                    :src="buff.buff_image"
                    :alt="buff.title"
                    loading="lazy"
                    @error="onImageError"
                  />
                  <strong class="dd-buff-title">{{ buff.title }}</strong>
                  <template v-if="adminMode">
                    <button class="dd-admin-btn" type="button" @click="beginEditBuff(bi)">编辑</button>
                    <button
                      class="dd-admin-btn dd-admin-btn--danger"
                      type="button"
                      @click="emit('admin-remove-buff', currentVersion(), activeNode?.nodeId ?? '', bi)"
                    >
                      删
                    </button>
                  </template>
                </div>
                <p v-if="buff.desc" class="dd-buff-desc">{{ buff.desc }}</p>
              </template>
            </div>
            <button
              v-if="adminMode && editing?.kind !== 'buff'"
              class="dd-admin-btn dd-admin-btn--add"
              type="button"
              @click="onAddBuff"
            >
              + 新增增益
            </button>
          </section>

          <!-- 战斗节点：关卡层（管理端常显 + 逐个新增 + 就地编辑） -->
          <section v-if="isDeductionBattleNode(activeNode.type)" class="dd-layers">
            <h4 class="dd-section-title">关卡层</h4>
            <div v-for="(layer, li) in activeNode.layers" :key="li" class="dd-layer">
              <div class="dd-layer-head">
                <template v-if="adminMode && isEditingLayer(li)">
                  <input v-model="layerDraft.name" class="dd-inline dd-inline--sm" placeholder="层名" />
                  <button class="dd-admin-btn dd-admin-btn--primary" type="button" @click="saveLayer">保存</button>
                  <button class="dd-admin-btn" type="button" @click="cancelEdit">取消</button>
                </template>
                <template v-else>
                  <h5 class="dd-layer-title">{{ layer.name }}</h5>
                  <template v-if="adminMode">
                    <button class="dd-admin-btn" type="button" @click="beginEditLayer(li)">编辑层名</button>
                    <button
                      class="dd-admin-btn dd-admin-btn--danger"
                      type="button"
                      @click="emit('admin-remove-layer', currentVersion(), activeNode?.nodeId ?? '', li)"
                    >
                      删层
                    </button>
                    <label
                      class="dd-toggle-inline"
                      title="终局=Boss关（危局数据源），前战=小怪关（shiyu数据源），切换即时保存"
                    >
                      <input
                        type="checkbox"
                        :checked="layer.isBoss === true"
                        @change="onToggleLayerBoss(li, $event)"
                      />
                      <span :class="{ 'dd-toggle-inline--on': layer.isBoss === true }">
                        {{ layer.isBoss === true ? '终局' : '前战' }}
                      </span>
                    </label>
                  </template>
                </template>
              </div>

              <div v-if="fieldBuffLines(layer.fieldBuff).length" class="dd-field-buff">
                <h6 class="dd-field-buff-title">{{ layer.fieldBuff?.name || '区域增益' }}</h6>
                <p
                  v-for="(line, lineIndex) in fieldBuffLines(layer.fieldBuff)"
                  :key="lineIndex"
                  class="dd-field-buff-line"
                >
                  {{ line }}
                </p>
              </div>
              <div v-if="layer.monsters.length" class="dd-monsters">
                <div v-for="(monster, mi) in layer.monsters" :key="mi" class="dd-monster">
                  <template v-if="adminMode && isEditingMonster(li, mi)">
                    <div class="dd-inline-block">
                      <AdminDeductionFuzzySelect
                        :options="monsterPickerOptions(li)"
                        :model-value="monsterDraft.name"
                        label="名字"
                        :placeholder="isBossLayer(li) ? '搜索 Boss…' : '搜索小怪…'"
                        :loading="pickersLoading"
                        @update:model-value="onMonsterName"
                        @select="onPickMonster"
                      />
                      <div class="dd-inline-row">
                        <label class="dd-num-inline">Lv <input v-model.number="monsterDraft.level" type="number" class="dd-inline dd-inline--num" /></label>
                        <label class="dd-num-inline">HP <input v-model.number="monsterDraft.hp" type="number" class="dd-inline dd-inline--num dd-inline--num-lg" /></label>
                        <label class="dd-num-inline">防御 <input v-model.number="monsterDraft.defense" type="number" class="dd-inline dd-inline--num dd-inline--num-lg" /></label>
                      </div>
                      <div class="dd-inline-row">
                        <span class="dd-mini-label">弱点</span>
                        <button
                          v-for="el in ELEMENTS"
                          :key="'w' + el"
                          type="button"
                          class="dd-elem-chip"
                          :class="{ 'dd-elem-chip--on': splitElements(monsterDraft.weakness).includes(el) }"
                          @click="monsterDraft.weakness = joinElements(toggleElement(splitElements(monsterDraft.weakness), el))"
                        >
                          {{ el }}
                        </button>
                      </div>
                      <div class="dd-inline-row">
                        <span class="dd-mini-label">抗性</span>
                        <button
                          v-for="el in ELEMENTS"
                          :key="'r' + el"
                          type="button"
                          class="dd-elem-chip"
                          :class="{ 'dd-elem-chip--on dd-elem-chip--resist': splitElements(monsterDraft.resistance).includes(el) }"
                          @click="monsterDraft.resistance = joinElements(toggleElement(splitElements(monsterDraft.resistance), el))"
                        >
                          {{ el }}
                        </button>
                      </div>
                      <p v-if="editError" class="dd-edit-error">{{ editError }}</p>
                      <div class="dd-inline-actions">
                        <button class="dd-admin-btn dd-admin-btn--primary" type="button" @click="saveMonster">保存</button>
                        <button class="dd-admin-btn" type="button" @click="cancelEdit">取消</button>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="dd-monster-main">
                      <img
                        v-if="monster.boss_image"
                        class="dd-monster-img"
                        :src="monster.boss_image"
                        alt=""
                        loading="lazy"
                        @error="onImageError"
                      />
                      <div class="dd-monster-info">
                        <div class="dd-monster-name">
                          {{ monster.name }}
                          <span class="dd-monster-lv">Lv{{ monster.level }}</span>
                        </div>
                        <div class="dd-monster-stats">
                          <span class="dd-stat">HP {{ formatHp(monster.hp) }}</span>
                          <span class="dd-stat">防御 {{ formatHp(monster.defense) }}</span>
                          <span v-if="parseElementIcons(monster.weakness).length" class="dd-stat dd-stat--weak">
                            弱
                            <span
                              v-for="elem in parseElementIcons(monster.weakness)"
                              :key="elem.name"
                              class="dd-elem"
                            >
                              <img
                                class="dd-elem-img"
                                :src="elem.icon"
                                :alt="elem.name"
                                :title="elem.name"
                                loading="lazy"
                              />
                              <span class="dd-elem-name">{{ elem.name }}</span>
                            </span>
                          </span>
                          <span v-if="parseElementIcons(monster.resistance).length" class="dd-stat dd-stat--resist">
                            抗
                            <span
                              v-for="elem in parseElementIcons(monster.resistance)"
                              :key="elem.name"
                              class="dd-elem"
                            >
                              <img
                                class="dd-elem-img"
                                :src="elem.icon"
                                :alt="elem.name"
                                :title="elem.name"
                                loading="lazy"
                              />
                              <span class="dd-elem-name">{{ elem.name }}</span>
                            </span>
                          </span>
                        </div>
                      </div>
                      <template v-if="adminMode">
                        <button class="dd-admin-btn" type="button" @click="beginEditMonster(li, mi)">编辑</button>
                        <button
                          class="dd-admin-btn dd-admin-btn--danger"
                          type="button"
                          @click="emit('admin-remove-monster', currentVersion(), activeNode?.nodeId ?? '', li, mi)"
                        >
                          删
                        </button>
                      </template>
                    </div>
                  </template>
                </div>
              </div>
              <div v-else class="dd-empty">该层暂无怪物数据</div>
              <button
                v-if="adminMode"
                class="dd-admin-btn dd-admin-btn--add"
                type="button"
                @click="onAddMonster(li)"
              >
                + 怪物
              </button>
            </div>
            <div class="dd-layer-add" v-if="adminMode">
              <button
                class="dd-admin-btn dd-admin-btn--add"
                type="button"
                @click="layerAddOpen = !layerAddOpen"
              >
                + 新增层
              </button>
              <div v-if="layerAddOpen" class="dd-layer-add-pop">
                <span class="dd-mini-label">关卡类型</span>
                <button
                  type="button"
                  class="dd-layer-type-btn"
                  @click="confirmAddLayer(false)"
                >
                  前战
                </button>
                <button
                  type="button"
                  class="dd-layer-type-btn dd-layer-type-btn--boss"
                  @click="confirmAddLayer(true)"
                >
                  终局
                </button>
              </div>
            </div>
          </section>
        </article>
      </div>

      <!-- 期数选择 -->
      <Teleport to="body">
        <div v-if="showPicker" class="dd-picker-mask" @click.self="showPicker = false">
          <div class="dd-picker">
            <h4 class="dd-picker-title">选择推演期数</h4>
            <button
              v-for="(period, index) in periods"
              :key="period.periodId"
              class="dd-picker-item"
              :class="{ 'dd-picker-item--active': index === currentIndex }"
              type="button"
              @click="selectPeriod(index)"
            >
              {{ deductionPeriodDisplay(period) }}
              <span class="dd-picker-meta">{{ period.nodes.length }} 个节点</span>
            </button>
            <button class="dd-picker-close" type="button" @click="showPicker = false">关闭</button>
          </div>
        </div>
      </Teleport>
    </template>
  </div>
</template>

<style scoped>
.dd-panel {
  min-height: 100%;
  padding: 0.5rem 0.25rem 2rem;
}

.dd-state {
  min-height: 40vh;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text);
  opacity: 0.65;
  font-size: 1rem;
}

.dd-state--error {
  color: #ef4444;
}

/* 期数导航 */
.dd-topbar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.dd-nav {
  width: 2.4rem;
  height: 2.4rem;
  border: 1px solid var(--zzz-line, var(--color-border));
  border-radius: 8px;
  background: var(--zzz-card, var(--color-background-soft));
  color: var(--color-heading);
  font-size: 1.2rem;
  cursor: pointer;
  flex-shrink: 0;
}

.dd-nav:disabled {
  opacity: 0.35;
  cursor: default;
}

.dd-period-btn {
  min-width: 9rem;
  height: 2.6rem;
  padding: 0 1.2rem;
  border: 1px solid var(--zzz-line, var(--color-border));
  border-radius: 8px;
  background: var(--zzz-card, var(--color-background-soft));
  color: var(--color-heading);
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
}

.dd-period-caret {
  margin-left: 0.4rem;
  opacity: 0.6;
  font-size: 0.8rem;
}

/* 管理端编辑按钮 */
.dd-admin-btn {
  flex-shrink: 0;
  padding: 0.28rem 0.6rem;
  border: 1px solid var(--zzz-line, var(--color-border));
  border-radius: 6px;
  background: var(--zzz-card, var(--color-background-soft));
  color: var(--color-text);
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  opacity: 0.85;
  transition:
    opacity 0.15s,
    border-color 0.15s,
    background-color 0.15s;
}

.dd-admin-btn:hover {
  opacity: 1;
  border-color: #e8a838;
}

.dd-admin-btn--primary {
  margin-left: auto;
  background: #f59e0b;
  border-color: #f59e0b;
  color: #141412;
  opacity: 1;
}

.dd-admin-btn--danger {
  color: #e85d4c;
  border-color: color-mix(in srgb, #e85d4c 40%, var(--zzz-line, var(--color-border)));
}

.dd-tab--admin {
  border-style: dashed;
  color: #f59e0b;
  opacity: 0.9;
}

.dd-tab--admin-danger {
  color: #e85d4c;
  border-color: color-mix(in srgb, #e85d4c 45%, var(--zzz-line, var(--color-border)));
}

/* ── 管理端内联编辑 ── */
.dd-inline-block {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.6rem 0.7rem;
  border: 1px solid color-mix(in srgb, #f59e0b 45%, var(--zzz-line, var(--color-border)));
  border-radius: 8px;
  background: color-mix(in srgb, #f59e0b 6%, var(--color-background-soft));
}

.dd-inline {
  box-sizing: border-box;
  padding: 0.4rem 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-mute);
  color: var(--color-heading);
  font-size: 0.85rem;
  font-family: inherit;
}

.dd-inline:focus {
  outline: none;
  border-color: #f59e0b;
}

.dd-inline--name {
  min-width: 9rem;
  font-size: 1rem;
  font-weight: 700;
}

.dd-inline--select {
  width: auto;
  min-width: 7rem;
}

.dd-inline--wide {
  width: 100%;
}

.dd-inline--sm {
  flex: 1;
  min-width: 0;
}

.dd-inline--num {
  width: 5.5rem;
  margin-left: 0.25rem;
}

.dd-inline--num-lg {
  width: 9.5rem;
}

.dd-inline--textarea {
  width: 100%;
  resize: vertical;
}

.dd-inline-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}

.dd-edit-error {
  margin: 0;
  padding: 0.3rem 0.5rem;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, #e85d4c 45%, var(--zzz-line, var(--color-border)));
  background: color-mix(in srgb, #e85d4c 10%, transparent);
  color: #e8a8a8;
  font-size: 0.78rem;
  font-weight: 600;
}

.dd-inline-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.dd-num-inline {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--color-text);
  opacity: 0.9;
}

.dd-toggle-inline {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 700;
  color: #f59e0b;
  flex-shrink: 0;
}

.dd-toggle-inline input {
  width: 2rem;
  height: 1rem;
  appearance: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-text) 22%, transparent);
  position: relative;
  cursor: pointer;
  margin: 0;
  transition: background 0.15s ease;
}

.dd-toggle-inline input::after {
  content: '';
  position: absolute;
  top: 0.11rem;
  left: 0.14rem;
  width: 0.78rem;
  height: 0.78rem;
  border-radius: 50%;
  background: var(--color-background, #fff);
  transition: left 0.15s ease;
}

.dd-toggle-inline input:checked {
  background: #f59e0b;
}

.dd-toggle-inline input:checked::after {
  left: 1.05rem;
}

.dd-toggle-inline--on {
  color: #f59e0b;
}

/* 新增层：前战 / 终局 选择 */
.dd-layer-add {
  position: relative;
  display: inline-flex;
}

.dd-layer-add-pop {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
}

.dd-layer-type-btn {
  padding: 0.3rem 0.85rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-mute);
  color: var(--color-heading);
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
}

.dd-layer-type-btn:hover {
  border-color: #f59e0b;
  color: #fcd34d;
}

.dd-layer-type-btn--boss {
  border-color: color-mix(in srgb, #f87171 45%, var(--color-border));
}

.dd-layer-type-btn--boss:hover {
  border-color: #f87171;
  color: #fca5a5;
}

.dd-mini-label {
  flex-shrink: 0;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--color-text);
  opacity: 0.75;
}

.dd-elem-chip {
  padding: 0.16rem 0.42rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: transparent;
  color: var(--color-text);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  opacity: 0.65;
}

.dd-elem-chip--on {
  background: color-mix(in srgb, #34d399 24%, transparent);
  border-color: #34d399;
  color: #047857;
  opacity: 1;
}

.dd-elem-chip--resist.dd-elem-chip--on {
  background: color-mix(in srgb, #f87171 24%, transparent);
  border-color: #f87171;
  color: #b91c1c;
}

.dd-admin-btn--add {
  border-style: dashed;
  color: #f59e0b;
}

.dd-layer-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.dd-layer-head .dd-layer-title {
  margin: 0;
}

.dd-empty {
  color: var(--color-text);
  opacity: 0.5;
  font-size: 0.82rem;
}

/* 节点页签 */
.dd-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: center;
  padding: 0.4rem 0 0.8rem;
  margin-bottom: 0.6rem;
  border-bottom: 1px dashed var(--zzz-line, var(--color-border));
}

.dd-tab {
  padding: 0.32rem 0.75rem;
  border: 1px solid var(--zzz-line, var(--color-border));
  border-radius: 999px;
  background: transparent;
  font-family: var(--zzz-font-mono, monospace);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--color-text);
  opacity: 0.75;
  cursor: pointer;
  transition:
    opacity 0.15s,
    border-color 0.15s,
    background-color 0.15s;
}

.dd-tab--story {
  border-color: color-mix(in srgb, #a78bfa 40%, var(--zzz-line, var(--color-border)));
}

.dd-tab--battle {
  border-color: color-mix(in srgb, #f59e0b 40%, var(--zzz-line, var(--color-border)));
}

.dd-tab--active {
  opacity: 1;
  color: var(--color-heading);
}

.dd-tab--story.dd-tab--active {
  background: color-mix(in srgb, #a78bfa 24%, transparent);
  border-color: #a78bfa;
}

.dd-tab--battle.dd-tab--active {
  background: color-mix(in srgb, #f59e0b 24%, transparent);
  border-color: #f59e0b;
}

/* 节点卡片 */
.dd-node-view {
  padding-bottom: 1rem;
}

.dd-card {
  border: 1px solid var(--zzz-line, var(--color-border));
  border-radius: 10px;
  padding: 0.85rem 1rem;
  background: var(--color-background-soft);
}

.dd-card--battle {
  border-color: color-mix(in srgb, #f59e0b 45%, var(--zzz-line, var(--color-border)));
}

.dd-card--story {
  border-color: color-mix(in srgb, #a78bfa 45%, var(--zzz-line, var(--color-border)));
}

.dd-card-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.6rem;
}

.dd-badge {
  flex-shrink: 0;
  padding: 0.16rem 0.55rem;
  border-radius: 6px;
  background: color-mix(in srgb, #a78bfa 22%, transparent);
  color: #c4b5fd;
  font-size: 0.78rem;
  font-weight: 700;
}

.dd-badge--battle {
  background: color-mix(in srgb, #f59e0b 22%, transparent);
  color: #fcd34d;
}

.dd-card-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--color-heading);
  letter-spacing: 0.03em;
}

/* 剧情文本 */
.dd-story-text {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.75;
  color: var(--color-text);
  opacity: 0.92;
  font-size: 0.95rem;
}

/* 剧情选项 */
.dd-story-options {
  margin-top: 0.9rem;
  padding-top: 0.7rem;
  border-top: 1px dashed var(--zzz-line, var(--color-border));
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.dd-option {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid color-mix(in srgb, #a78bfa 30%, var(--zzz-line, var(--color-border)));
  border-left: 3px solid #a78bfa;
  border-radius: 8px;
  background: color-mix(in srgb, #a78bfa 7%, var(--color-background-soft));
}

/* 编辑态：纵向铺满整行，让输入框/textarea 占满宽度 */
.dd-option--editing {
  flex-direction: column;
  align-items: stretch;
}

.dd-option--editing .dd-inline-block {
  width: 100%;
}

.dd-option--editing .dd-inline-actions {
  justify-content: flex-end;
}

.dd-option-index {
  flex-shrink: 0;
  width: 1.4rem;
  height: 1.4rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: color-mix(in srgb, #a78bfa 28%, transparent);
  color: #c4b5fd;
  font-size: 0.72rem;
  font-weight: 800;
}

.dd-option-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.dd-option-name {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--color-heading);
}

.dd-option-desc {
  font-size: 0.75rem;
  color: var(--color-text);
  opacity: 0.65;
}

/* 区块标题 */
.dd-section-title {
  margin: 0 0 0.55rem;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-heading);
  opacity: 0.85;
  font-family: var(--zzz-font-mono, monospace);
  letter-spacing: 0.05em;
}

/* 可选增益（战斗卡顶部） */
.dd-buffs {
  margin-bottom: 0.9rem;
  padding-bottom: 0.7rem;
  border-bottom: 1px dashed var(--zzz-line, var(--color-border));
}

.dd-buff {
  padding: 0.4rem 0;
}

.dd-buff + .dd-buff {
  border-top: 1px dotted var(--zzz-line, var(--color-border));
}

.dd-buff-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.dd-buff-img {
  width: 2rem;
  height: 2rem;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--zzz-line, var(--color-border));
  background: color-mix(in srgb, var(--color-text) 8%, transparent);
  flex-shrink: 0;
}

.dd-buff-title {
  color: #fcd34d;
  font-size: 0.9rem;
  font-weight: 800;
}

.dd-buff-desc {
  margin: 0.25rem 0 0;
  white-space: pre-wrap;
  line-height: 1.65;
  font-size: 0.85rem;
  color: var(--color-text);
  opacity: 0.9;
}

/* 战斗层 */
.dd-layers {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.dd-layer {
  border: 1px solid var(--zzz-line, var(--color-border));
  border-radius: 8px;
  padding: 0.6rem 0.75rem;
}

.dd-layer-title {
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-heading);
  opacity: 0.85;
  font-family: var(--zzz-font-mono, monospace);
  letter-spacing: 0.05em;
}

.dd-field-buff {
  margin: 0 0 0.5rem;
  padding: 0.5rem 0.6rem;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, #f59e0b 35%, var(--zzz-line, var(--color-border)));
  border-left: 3px solid #f59e0b;
  background: color-mix(in srgb, #f59e0b 8%, var(--zzz-card, var(--color-background-soft)));
}

.dd-field-buff-title {
  margin: 0 0 0.3rem;
  font-size: 0.78rem;
  font-weight: 700;
  color: #d97706;
  letter-spacing: 0.06em;
}

.dd-field-buff-line {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.6;
  color: var(--color-text);
  opacity: 0.9;
  white-space: pre-line;
}

.dd-field-buff-line + .dd-field-buff-line {
  margin-top: 0.15rem;
}

.dd-monsters {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.dd-monster {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.45rem 0.55rem;
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-text) 5%, transparent);
}

.dd-monster-main {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}

.dd-monster-img {
  width: 3rem;
  height: 3rem;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--zzz-line, var(--color-border));
  background: color-mix(in srgb, var(--color-text) 8%, transparent);
  flex-shrink: 0;
}

.dd-monster-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.dd-monster-name {
  font-weight: 700;
  color: var(--color-heading);
  font-size: 0.92rem;
}

.dd-monster-lv {
  margin-left: 0.4rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text);
  opacity: 0.7;
}

.dd-monster-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.9rem;
}

.dd-stat {
  font-family: var(--zzz-font-mono, monospace);
  font-size: 0.78rem;
  color: var(--color-text);
  opacity: 0.85;
}

.dd-stat--weak {
  color: #34d399;
}

.dd-stat--resist {
  color: #f87171;
}

.dd-elem {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  margin-left: 0.35rem;
}

.dd-elem-name {
  font-size: 0.78rem;
}

.dd-elem-img {
  width: 1.05em;
  height: 1.05em;
  border-radius: 2px;
}

.dd-empty {
  color: var(--color-text);
  opacity: 0.5;
  font-size: 0.82rem;
}

/* 期数选择 */
.dd-picker-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dd-picker {
  width: min(92vw, 340px);
  max-height: 70vh;
  overflow-y: auto;
  border: 1px solid var(--zzz-line, var(--color-border));
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.dd-picker-title {
  margin: 0 0 0.25rem;
  color: var(--color-heading);
  font-size: 0.95rem;
}

.dd-picker-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--zzz-line, var(--color-border));
  border-radius: 8px;
  background: var(--color-background-mute);
  color: var(--color-heading);
  font-size: 0.92rem;
  font-weight: 700;
  cursor: pointer;
}

.dd-picker-item--active {
  border-color: #f59e0b;
  color: #fcd34d;
}

.dd-picker-meta {
  font-size: 0.75rem;
  font-weight: 400;
  opacity: 0.6;
}

.dd-picker-close {
  margin-top: 0.4rem;
  padding: 0.55rem;
  border-radius: 8px;
  border: 1px solid var(--zzz-line, var(--color-border));
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
}

@media (max-width: 768px) {
  .dd-panel {
    padding: 0.25rem 0 2rem;
  }

  .dd-card {
    padding: 0.7rem 0.75rem;
  }

  .dd-tabs {
    flex-wrap: nowrap;
    overflow-x: auto;
    justify-content: flex-start;
    padding-bottom: 0.5rem;
  }

  .dd-tab {
    flex-shrink: 0;
  }
}

/* ── 白天主题适配：强调色加深保证可读（--zzz-ink-* 在 light 下不切换） ── */
[data-theme='light'] .dd-badge {
  color: #6d28d9;
}

[data-theme='light'] .dd-option-index {
  color: #6d28d9;
}

[data-theme='light'] .dd-badge--battle {
  color: #b45309;
}

[data-theme='light'] .dd-buff-title {
  color: #b45309;
}

[data-theme='light'] .dd-stat--weak {
  color: #047857;
}

[data-theme='light'] .dd-stat--resist {
  color: #b91c1c;
}

[data-theme='light'] .dd-picker-item--active {
  border-color: #d97706;
  color: #92400e;
}

[data-theme='light'] .dd-tab--story.dd-tab--active {
  background: color-mix(in srgb, #a78bfa 18%, var(--color-background-mute));
}

[data-theme='light'] .dd-tab--battle.dd-tab--active {
  background: color-mix(in srgb, #f59e0b 18%, var(--color-background-mute));
}
</style>
