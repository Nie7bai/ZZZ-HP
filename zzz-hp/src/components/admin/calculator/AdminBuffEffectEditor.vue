<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useSlots, watch } from 'vue'
import AdminBuffEffectRow from '@/components/admin/calculator/AdminBuffEffectRow.vue'
import type {
  BuffDamageType,
  BuffEffect,
  BuffEffectBlock,
} from '@/types/calculator'
import { createEmptyBuffEffect, createEmptyBuffEffectBlock, convertSummaryLabel, packFromBlocks } from '@/utils/buffEffect'
import { formatCalcDecimal } from '@/utils/calcNumberFormat'
import { buffStatLabelOf, buffStatUnitOf, findBuffStatZoneById } from '@/utils/buffStatZones'
import {
  alignRow,
  buildEffectRows,
  changeRowZone,
  confirmMergeRow,
  mergeRows,
  replaceRowEffects,
  splitRow,
  toggleRowDamageType,
  validateEffectGroups,
  type EffectRow,
} from '@/utils/buffEffectRows'
import {
  blockOnlySelection,
  effectRowAnchor,
  pickRowAfterRemoval,
  resolveEffectSelection,
  toSelectionRowRefs,
  type EffectRowAnchor,
} from '@/utils/buffEffectSelection'

/** 工具条「当前编辑」下拉里的可切换对象（代理人 / 音擎 / 邦布…） */
interface BuffEditorOwnerOption {
  id: string
  name: string
  /** 次要信息，如「强攻 · 电」「S 音擎」 */
  meta?: string
}

const props = defineProps<{
  lockApplyTarget?: 'self' | 'team' | null
  hint?: string
  /** 当前编辑的角色（招式小类创建/筛选） */
  agentId?: string
  /** 空列表时新增的第一个效果块默认名称（如「精1」） */
  defaultFirstBlockName?: string
  /** 空列表时新增的第一个效果块默认注释 */
  defaultFirstBlockNote?: string
  /** 仅允许能量回复效率（百分比）等受限场景用；现已统一百分比语义 */
  energyRegenFlatOnly?: boolean
  /**
   */
  /** 工具条：当前编辑对象名称（代理人 / 音擎 / 邦布…） */
  ownerLabel?: string
  /** 工具条：当前编辑对象 id（下拉里高亮） */
  ownerId?: string
  /** 工具条：可切换对象列表；配合 `switch-owner` 事件使用 */
  owners?: BuffEditorOwnerOption[]
  /** 块排序口径：代理人（核心被动/额外能力/招式/影画）或音擎（基础/精炼） */
  ownerKind?: 'agent' | 'wengine'
  /** 工具条保存状态；不传则用组件内的「有改动 / 无改动」本地标记 */
  saveState?: 'clean' | 'dirty' | 'saving' | 'saved'
  /** 已保存的补充说明（如「12:03」） */
  savedAtLabel?: string
}>()

const emit = defineEmits<{
  'switch-owner': [id: string]
}>()

const slots = useSlots()

const model = defineModel<BuffEffectBlock[]>({ required: true })

/** [拆开] 后本次编辑里不再按启发式聚回去（只影响显示，不写数据） */
const suppressedByBlock = ref<Record<string, string[]>>({})
const mergeMode = ref(false)
const selectedRowKeys = ref<string[]>([])
const mergeError = ref('')

/* ───────────────────────── 三列布局：工具条 / 块列表 / 当前块 ───────────────────────── */

const selectedBlockId = ref('')
const ownerMenuOpen = ref(false)
const ownerSearch = ref('')
/** 组件内的「有改动」标记：只用于工具条提示，不参与保存 */
const localDirty = ref(false)

watch(
  model,
  () => {
    localDirty.value = true
  },
  { deep: true },
)

function rowsOf(block: BuffEffectBlock): EffectRow[] {
  const suppressed = new Set(suppressedByBlock.value[block.id] ?? [])
  return buildEffectRows(block.effects, { suppressHeuristicIds: suppressed })
}

const blockSummaries = computed(() => {
  const map = new Map<string, { rows: number; effects: number; warn: boolean; ungrouped: boolean }>()
  for (const block of model.value) {
    const rows = rowsOf(block)
    map.set(block.id, {
      rows: rows.length,
      effects: block.effects.length,
      warn: rows.some((row) => row.issues.length > 0),
      ungrouped: rows.some((row) => row.heuristic && !row.groupId),
    })
  }
  return map
})

const totalEffects = computed(() =>
  model.value.reduce((sum, block) => sum + block.effects.length, 0),
)
const recordedBlocks = computed(
  () => model.value.filter((block) => block.effects.length > 0).length,
)

/** 块排序口径：页面没给 ownerKind 时按块名猜（音擎=基础/精炼，其余按代理人） */
const editorKind = computed<'agent' | 'wengine'>(() => {
  if (props.ownerKind === 'agent' || props.ownerKind === 'wengine') return props.ownerKind
  if ((props.defaultFirstBlockName ?? '').trim().startsWith('精')) return 'wengine'
  const names = model.value.map((block) => (block.name ?? '').trim())
  if (names.some((name) => /精炼/.test(name) || /^精\s*[1-6]$/.test(name))) return 'wengine'
  return 'agent'
})

const AGENT_SKILL_ORDER = ['普通攻击', '闪避', '支援', '特殊', '连携', '终结', '追加']
const CN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }

interface BlockOrderKey {
  group: number
  sub: number
}

/**
 * 展示排序（不改数据顺序）：
 * - 代理人：核心被动 → 额外能力 → 招式（按类别）→ 影画 1..6 → 其它（保持原顺序）
 * - 音擎：基础 → 精炼 1..5 → 其它
 */
function blockOrderKey(name: string, kind: 'agent' | 'wengine'): BlockOrderKey {
  const text = (name ?? '').trim()
  if (kind === 'wengine') {
    const refine = /精炼\s*([1-6])/.exec(text) ?? /精\s*([1-6])/.exec(text)
    if (refine) return { group: 1, sub: Number(refine[1]) }
    if (/基础/.test(text)) return { group: 0, sub: 0 }
    return { group: 9, sub: 0 }
  }
  const rank = /影画\s*([0-9一二三四五六])/.exec(text)
  if (rank) {
    const rankLabel = rank[1]!
    return { group: 3, sub: CN_DIGITS[rankLabel] ?? (Number(rankLabel) || 0) }
  }
  if (/核心/.test(text)) return { group: 0, sub: 0 }
  if (/额外/.test(text)) return { group: 1, sub: 0 }
  const skillIndex = AGENT_SKILL_ORDER.findIndex((keyword) => text.includes(keyword))
  if (skillIndex >= 0) return { group: 2, sub: skillIndex }
  if (/招式/.test(text)) return { group: 2, sub: AGENT_SKILL_ORDER.length }
  return { group: 9, sub: 0 }
}

const orderedBlocks = computed(() => {
  const kind = editorKind.value
  return model.value
    .map((block, index) => ({ block, index, key: blockOrderKey(block.name ?? '', kind) }))
    .sort(
      (left, right) =>
        left.key.group - right.key.group ||
        left.key.sub - right.key.sub ||
        left.index - right.index,
    )
    .map((item) => item.block)
})

const activeBlock = computed(
  () =>
    orderedBlocks.value.find((block) => block.id === selectedBlockId.value) ??
    orderedBlocks.value[0] ??
    null,
)

/* ── 左列导航树：块 → 行；块可整块折叠（这是唯一的折叠），行只负责选中 ── */
const selectedRowKey = ref('')
const collapsedBlocks = ref<Record<string, boolean>>({})

/**
 * 选中行的稳定锚点：行的 `key` 会随数据 patch 变化
 * （勾/取消伤害类型、拆开、合并时 effect id / groupId 会重建），
 * 所以额外记住「块 id + 乘区 + groupId + 序号」，数据变了也能落回同一行。
 */
const selectedAnchor = ref<EffectRowAnchor | null>(null)

type RowItem = { block: BuffEffectBlock; row: EffectRow }

function applySelection(item: RowItem) {
  selectedRowKey.value = item.row.key
  selectedBlockId.value = item.block.id
  const rows = rowsOf(item.block)
  const index = rows.findIndex((row) => row.key === item.row.key)
  selectedAnchor.value = effectRowAnchor(item.row, item.block.id, index)
}

/** 选中块本身（该块没有效果行）：右列显示块信息，不显示效果行 */
function selectBlockOnly(block: BuffEffectBlock) {
  const resolved = blockOnlySelection(block.id)
  selectedRowKey.value = resolved.rowKey
  selectedBlockId.value = resolved.blockId
  selectedAnchor.value = resolved.anchor
}

/** 让一个块可继续编辑：有行选第一行，没行就选中块本身 */
function focusBlock(block: BuffEffectBlock | null | undefined) {
  if (!block) return
  const firstRow = rowsOf(block)[0]
  if (firstRow) applySelection({ block, row: firstRow })
  else selectBlockOnly(block)
}

function isBlockCollapsed(blockId: string) {
  return collapsedBlocks.value[blockId] === true
}

function toggleBlock(blockId: string) {
  collapsedBlocks.value = {
    ...collapsedBlocks.value,
    [blockId]: !isBlockCollapsed(blockId),
  }
}

/** 所有行（按块展示顺序展开），右列只渲染选中的那一行 */
const allRows = computed<RowItem[]>(() =>
  orderedBlocks.value.flatMap((block) => rowsOf(block).map((row) => ({ block, row }))),
)

const activeRow = computed(
  () => allRows.value.find((item) => item.row.key === selectedRowKey.value) ?? null,
)

/**
 * 右列当前要编辑的块：优先取选中行的块；选中态落在块上（空块）时取该块。
 * 没有块时为空 → 右列显示空态提示。
 */
const activeCardBlock = computed<BuffEffectBlock | null>(
  () => activeRow.value?.block ?? activeBlock.value ?? null,
)

/** 数据 patch 后重新落位：优先同 key，其次按锚点（同块同乘区 → 同 groupId / 同序号） */
function resolveSelection() {
  const rows = allRows.value
  const resolved = resolveEffectSelection({
    rows: toSelectionRowRefs(rows),
    blockIds: orderedBlocks.value.map((block) => block.id),
    selectedRowKey: selectedRowKey.value,
    anchor: selectedAnchor.value,
    selectedBlockId: selectedBlockId.value,
  })
  selectedRowKey.value = resolved.rowKey
  selectedBlockId.value = resolved.blockId
  selectedAnchor.value = resolved.anchor
}

watch(allRows, resolveSelection, { immediate: true })

watch(
  () => model.value.map((block) => block.id).join('|'),
  () => {
    if (!model.value.some((block) => block.id === selectedBlockId.value)) {
      selectedBlockId.value = orderedBlocks.value[0]?.id ?? ''
    }
  },
  { immediate: true },
)

/** 左列行摘要：`属性 · 目标 · 数值` */
function rowNavLabel(row: EffectRow) {
  const first = row.effects[0]
  if (!first) return '（空行）'
  // 自定义乘区键回落到注册表 label；unit 对 custom 键默认 `%`
  const stat = row.zone?.label ?? buffStatLabelOf(first.stat)
  const target = (first.applyTarget ?? 'self') === 'team' ? '全队' : '自身'
  const suffix = buffStatUnitOf(first.stat) === 'percent' ? '%' : ''
  const amount =
    first.kind === 'stacked'
      ? `${formatCalcDecimal(first.valuePerStack ?? 0)}${suffix}×${first.maxStacks ?? 1}层`
      : first.kind === 'convert'
        ? convertSummaryLabel(first.convert)
        : `${formatCalcDecimal(first.value ?? 0)}${suffix}`
  return `${stat} · ${target} · ${amount}`
}

function selectRow(block: BuffEffectBlock, row: EffectRow) {
  applySelection({ block, row })
}

function selectBlock(block: BuffEffectBlock) {
  focusBlock(block)
}

/** 窄条模式下的块图标：取块名前两个字 */
function blockInitial(name: string) {
  return (name ?? '').trim().slice(0, 2) || '块'
}

/* ───────────────────────── 工具条：当前编辑 / 块统计 / 保存状态 ───────────────────────── */

const hasOwnerSlot = computed(() => Boolean(slots['owner-switcher']))
const canSwitchOwner = computed(
  () => hasOwnerSlot.value || (props.owners?.length ?? 0) > 0,
)
const ownerButtonTitle = computed(() =>
  canSwitchOwner.value ? '搜索 / 切换当前编辑对象' : '当前编辑对象由所在页面切换',
)
const ownerName = computed(() => (props.ownerLabel ?? '').trim() || '未命名')

const filteredOwners = computed(() => {
  const keyword = ownerSearch.value.trim().toLowerCase()
  const list = props.owners ?? []
  if (!keyword) return list
  return list.filter((owner) =>
    `${owner.name} ${owner.meta ?? ''}`.toLowerCase().includes(keyword),
  )
})

function toggleOwnerMenu() {
  if (!canSwitchOwner.value) return
  ownerMenuOpen.value = !ownerMenuOpen.value
  if (!ownerMenuOpen.value) ownerSearch.value = ''
}

function closeOwnerMenu() {
  ownerMenuOpen.value = false
  ownerSearch.value = ''
}

function pickOwner(id: string) {
  emit('switch-owner', id)
  closeOwnerMenu()
}

function onDocumentClick() {
  ownerMenuOpen.value = false
}
onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))

const saveStateResolved = computed<'clean' | 'dirty' | 'saving' | 'saved'>(
  () => props.saveState ?? (localDirty.value ? 'dirty' : 'clean'),
)

const saveStateText = computed(() => {
  const state = saveStateResolved.value
  if (state === 'saving') return '保存中…'
  if (state === 'saved') {
    return props.savedAtLabel ? `已保存 · ${props.savedAtLabel}` : '已保存'
  }
  if (state === 'dirty') return '● 未保存'
  return '✓ 无改动'
})

/** 上层保存成功后调用：清掉工具条的「未保存」提示（可选用法） */
function markSaved() {
  localDirty.value = false
}

/* ───────────────────────── 块 / 效果的行操作（数据逻辑保持原样） ───────────────────────── */

function rememberSuppressed(blockId: string, effects: readonly BuffEffect[]) {
  const ids = new Set(suppressedByBlock.value[blockId] ?? [])
  for (const effect of effects) ids.add(effect.id)
  suppressedByBlock.value = {
    ...suppressedByBlock.value,
    [blockId]: [...ids],
  }
}

function clearSuppressed(blockId: string, effects: readonly BuffEffect[]) {
  const removed = new Set(effects.map((effect) => effect.id))
  const next = (suppressedByBlock.value[blockId] ?? []).filter((id) => !removed.has(id))
  suppressedByBlock.value = { ...suppressedByBlock.value, [blockId]: next }
}

function addBlock() {
  const isFirst = model.value.length === 0
  const name =
    isFirst && props.defaultFirstBlockName?.trim()
      ? props.defaultFirstBlockName.trim()
      : `效果块 ${model.value.length + 1}`
  const note =
    isFirst && props.defaultFirstBlockNote?.trim()
      ? props.defaultFirstBlockNote.trim()
      : ''
  const block = createEmptyBuffEffectBlock({
    name,
    note,
    effects: [
      createEmptyBuffEffect({
        applyTarget: props.lockApplyTarget ?? 'self',
        stat: props.energyRegenFlatOnly ? 'energyRegen' : 'dmgBonus',
      }),
    ],
  })
  model.value = [...model.value, block]
  selectedBlockId.value = block.id
}

function removeBlock(block: BuffEffectBlock) {
  const index = model.value.findIndex((item) => item.id === block.id)
  if (index < 0) return
  // 删除后落到原显示位置的邻近块（没有就落到剩余的最后一个块）
  const displayIndex = Math.max(
    0,
    orderedBlocks.value.findIndex((item) => item.id === block.id),
  )
  const wasActive = activeCardBlock.value?.id === block.id
  delete suppressedByBlock.value[block.id]
  model.value = model.value.filter((_, i) => i !== index)
  if (!wasActive) return

  const remaining = orderedBlocks.value
  const neighbour = remaining[Math.min(displayIndex, remaining.length - 1)] ?? null
  if (neighbour) {
    focusBlock(neighbour)
    return
  }
  selectedRowKey.value = ''
  selectedBlockId.value = ''
  selectedAnchor.value = null
}

function addEffect(block: BuffEffectBlock) {
  const effect = createEmptyBuffEffect({
    applyTarget: props.lockApplyTarget ?? 'self',
    stat: props.energyRegenFlatOnly ? 'energyRegen' : 'dmgBonus',
  })
  block.effects.push(effect)
  // 新行就地选中（行 key 由 effect id 派生，push 后即可查到）
  const row = rowsOf(block).find((item) => item.effects.some((entry) => entry.id === effect.id))
  if (row) applySelection({ block, row })
}

function removeRow(block: BuffEffectBlock, row: EffectRow) {
  const rowsBefore = rowsOf(block)
  const removedIndex = rowsBefore.findIndex((item) => item.key === row.key)
  const ids = new Set(row.effects.map((effect) => effect.id))
  block.effects = block.effects.filter((effect) => !ids.has(effect.id))
  clearSuppressed(block.id, row.effects)
  selectedRowKeys.value = selectedRowKeys.value.filter((key) => key !== row.key)

  // 删完这块的最后一行时，选中态留在「块」上（否则右列无处显示块名 / 删除块 / 加效果）
  const rowsAfter = rowsOf(block)
  const nextRow = pickRowAfterRemoval(rowsAfter, removedIndex < 0 ? 0 : removedIndex)
  if (nextRow) applySelection({ block, row: nextRow })
  else selectBlockOnly(block)
}

function onChangeZone(
  block: BuffEffectBlock,
  row: EffectRow,
  zoneId: string,
  types: BuffDamageType[],
) {
  const zone = findBuffStatZoneById(zoneId)
  if (!zone) return
  block.effects = changeRowZone(block.effects, row, zone, types)
  clearSuppressed(block.id, row.effects)
}

function onToggleType(
  block: BuffEffectBlock,
  row: EffectRow,
  type: BuffDamageType,
  checked: boolean,
) {
  block.effects = toggleRowDamageType(block.effects, row, type, checked)
  clearSuppressed(block.id, row.effects)
}

function onSplit(block: BuffEffectBlock, row: EffectRow) {
  const beforeIds = new Set(block.effects.map((effect) => effect.id))
  const oldIds = row.effects.map((effect) => effect.id)
  const next = splitRow(block.effects, row)
  block.effects = next
  const splitIds =
    row.effects.length > 1
      ? oldIds
      : [...oldIds, ...next.filter((effect) => !beforeIds.has(effect.id)).map((effect) => effect.id)]
  rememberSuppressed(
    block.id,
    splitIds.map((id) => next.find((effect) => effect.id === id)).filter(Boolean) as BuffEffect[],
  )
}

function onConfirmMerge(block: BuffEffectBlock, row: EffectRow) {
  block.effects = confirmMergeRow(block.effects, row)
}

function onAlign(block: BuffEffectBlock, row: EffectRow) {
  block.effects = replaceRowEffects(block.effects, row, alignRow(row))
}

function toggleMergeMode() {
  mergeMode.value = !mergeMode.value
  selectedRowKeys.value = []
  mergeError.value = ''
}

function toggleSelect(row: EffectRow) {
  const exists = selectedRowKeys.value.includes(row.key)
  selectedRowKeys.value = exists
    ? selectedRowKeys.value.filter((key) => key !== row.key)
    : [...selectedRowKeys.value, row.key]
}

function mergeSelected(block: BuffEffectBlock) {
  const rows = rowsOf(block).filter((row) => selectedRowKeys.value.includes(row.key))
  const result = mergeRows(block.effects, rows)
  if (!result.ok || !result.effects) {
    mergeError.value = result.error ?? '合并失败'
    return
  }
  block.effects = result.effects
  mergeError.value = ''
  selectedRowKeys.value = []
}

defineExpose({
  syncPack: () => {
    const validation = validateEffectGroups(model.value)
    if (!validation.ok) {
      throw new Error(validation.errors.join('；'))
    }
    return packFromBlocks(model.value)
  },
  /** 上层保存成功后调用，清掉工具条的「未保存」提示 */
  markSaved,
})
</script>


<template>
  <div class="effect-editor">
    <!-- 顶部工具条：当前编辑 + 块统计 + 保存状态（低频的搜索/切换收进下拉） -->
    <header class="editor-toolbar">
      <div v-if="ownerLabel || canSwitchOwner" class="owner-switch">
        <button
          type="button"
          class="owner-btn"
          :class="{ 'is-open': ownerMenuOpen }"
          :disabled="!canSwitchOwner"
          :title="ownerButtonTitle"
          @click.stop="toggleOwnerMenu"
        >
          <span class="owner-prefix">当前编辑：</span>
          <strong class="owner-name">{{ ownerName }}</strong>
          <span v-if="canSwitchOwner" class="owner-caret" aria-hidden="true" />
        </button>

        <div v-if="ownerMenuOpen" class="owner-menu" @click.stop>
          <slot name="owner-switcher" :close="closeOwnerMenu">
            <input
              v-model="ownerSearch"
              class="owner-search"
              type="search"
              placeholder="搜索名称 / 职业 / 属性"
              autocomplete="off"
            />
            <div class="owner-list">
              <button
                v-for="owner in filteredOwners"
                :key="owner.id"
                type="button"
                class="owner-item"
                :class="{ 'is-active': owner.id === ownerId }"
                @click="pickOwner(owner.id)"
              >
                <span class="owner-item-name">{{ owner.name }}</span>
                <span v-if="owner.meta" class="owner-item-meta">{{ owner.meta }}</span>
              </button>
              <p v-if="!filteredOwners.length" class="owner-empty">没有匹配项</p>
            </div>
          </slot>
        </div>
      </div>

      <span class="toolbar-stats">
        块 {{ model.length }} · 已录 {{ recordedBlocks }} · 效果 {{ totalEffects }} 条
      </span>

      <!-- 页面自带的切换器（如 影画 1..6 / 固定·精1..5）放进同一行工具条 -->
      <slot name="toolbar-extra" />

      <span class="toolbar-spacer" />

      <span
        class="save-state"
        :class="`is-${saveStateResolved}`"
        :title="
          saveState === undefined
            ? '本页是否有未保存改动（由本组件内的编辑动作判断）'
            : '保存状态由所在页面同步'
        "
      >
        {{ saveStateText }}
      </span>

      <!-- 页面级动作（保存 / 删除）跟保存状态并排放在右上角 -->
      <slot name="toolbar-actions" />

      <button type="button" class="ghost-btn" @click="toggleMergeMode">
        {{ mergeMode ? '退出合并模式' : '合并行…' }}
      </button>
    </header>

    <p v-if="mergeMode" class="hint">
      勾选左侧同块、同族、同值的行，再点右侧「合并选中」。
      <span v-if="mergeError" class="err">{{ mergeError }}</span>
    </p>
    <p v-else-if="hint !== ''" class="hint">
      {{
        hint ??
        '左列选块 / 选行；右列显示选中行的完整内容（全部常显）。改数值 / 目标 / 条件会整组一起改；[拆开] 清 groupId；[合并] 把同块同族同值的行写成同一个 groupId。'
      }}
    </p>

    <div class="editor-body">
      <!-- 左列：块 → 行 两级导航树（块可整块折叠，这是唯一的折叠） -->
      <nav class="block-tree" aria-label="效果块与效果行">
        <div v-for="block in orderedBlocks" :key="block.id" class="tree-block">
          <div class="tree-block-head" :class="{ 'is-active': block.id === activeBlock?.id }">
            <button
              type="button"
              class="tree-toggle"
              :aria-expanded="!isBlockCollapsed(block.id)"
              :title="isBlockCollapsed(block.id) ? '显示该块的行' : '隐藏该块的行'"
              @click="toggleBlock(block.id)"
            >
              <span class="tree-caret" :class="{ 'is-collapsed': isBlockCollapsed(block.id) }" />
            </button>
            <button
              type="button"
              class="tree-block-btn"
              :class="{ 'is-empty': block.effects.length === 0 }"
              :title="`${block.name || '未命名块'} · ${block.effects.length} 条`"
              @click="selectBlock(block)"
            >
              <span class="block-initial">{{ blockInitial(block.name) }}</span>
              <span class="block-name">{{ block.name || '未命名块' }}</span>
              <span class="block-count">{{ block.effects.length }}</span>
              <span
                v-if="blockSummaries.get(block.id)?.warn"
                class="block-dot is-warn"
                title="组内不一致"
              />
              <span
                v-else-if="blockSummaries.get(block.id)?.ungrouped"
                class="block-dot is-ungrouped"
                title="未分组"
              />
            </button>
          </div>

          <ul v-show="!isBlockCollapsed(block.id)" class="tree-rows">
            <li v-for="row in rowsOf(block)" :key="row.key" class="tree-row-wrap">
              <input
                v-if="mergeMode"
                type="checkbox"
                class="tree-row-check"
                :checked="selectedRowKeys.includes(row.key)"
                @change="toggleSelect(row)"
              />
              <button
                type="button"
                class="tree-row"
                :class="{ 'is-active': row.key === selectedRowKey }"
                :title="rowNavLabel(row)"
                @click="selectRow(block, row)"
              >
                <span class="tree-row-label">{{ rowNavLabel(row) }}</span>
                <span class="tree-row-badges">
                  <span v-if="row.effects.length > 1" class="tree-badge">{{ row.effects.length }} 条</span>
                  <span v-if="row.issues.length" class="tree-badge is-warn" title="组内不一致">⚠</span>
                  <span
                    v-else-if="row.heuristic && !row.groupId"
                    class="tree-badge is-ungrouped"
                    title="未分组"
                  >
                    未分组
                  </span>
                </span>
              </button>
            </li>
            <li v-if="!rowsOf(block).length" class="tree-empty">（空块）</li>
          </ul>
        </div>

        <button type="button" class="block-add" title="添加效果块" @click="addBlock">＋ 块</button>
      </nav>

      <!-- 右列：选中行的完整内容（永远展开，没有任何折叠控件）；空块显示块信息 -->
      <section class="block-work">
        <article v-if="activeCardBlock" class="block-card">
          <header class="block-head">
            <label class="field name-field">
              <span>效果块名称</span>
              <input
                v-model="activeCardBlock.name"
                type="text"
                autocomplete="off"
                placeholder="可自定义名称"
              />
            </label>
            <button type="button" class="danger-btn" @click="removeBlock(activeCardBlock)">
              删除块
            </button>
          </header>

          <label class="field note-field">
            <span>块备注 / 注释</span>
            <textarea
              v-model="activeCardBlock.note"
              class="note-input"
              rows="2"
              autocomplete="off"
              placeholder="可选说明、触发条件等"
            />
          </label>

          <p v-if="mergeMode" class="merge-block-actions">
            <button
              type="button"
              class="ghost-btn"
              :disabled="selectedRowKeys.length < 2"
              @click="mergeSelected(activeCardBlock)"
            >
              合并选中（{{ selectedRowKeys.length }}）
            </button>
          </p>

          <AdminBuffEffectRow
            v-if="activeRow"
            :key="activeRow.row.key"
            :row="activeRow.row"
            :agent-id="agentId"
            :lock-apply-target="lockApplyTarget"
            :merge-mode="mergeMode"
            :selected="selectedRowKeys.includes(activeRow.row.key)"
            @change-zone="(zoneId, types) => onChangeZone(activeRow!.block, activeRow!.row, zoneId, types)"
            @toggle-type="(type, checked) => onToggleType(activeRow!.block, activeRow!.row, type, checked)"
            @split="onSplit(activeRow!.block, activeRow!.row)"
            @remove="removeRow(activeRow!.block, activeRow!.row)"
            @confirm-merge="onConfirmMerge(activeRow!.block, activeRow!.row)"
            @align="onAlign(activeRow!.block, activeRow!.row)"
            @toggle-select="toggleSelect(activeRow!.row)"
          />

          <p v-else class="block-empty-hint">
            这个块还没有效果行（空块）：点下面的「＋ 在此块添加效果」加一条，或点右上「删除块」删掉它。
          </p>

          <button type="button" class="add-btn" @click="addEffect(activeCardBlock)">
            ＋ 在此块添加效果
          </button>
        </article>

        <div v-else class="empty">
          <span>从左侧选择一个效果</span>
          <span class="muted">（还没有效果块时，点左列「＋ 块」新建）</span>
        </div>
      </section>
    </div>
  </div>
</template>
<style scoped>
.effect-editor {
  --buff-editor-title-size: 1rem;
  --buff-editor-text-size: 0.9375rem;
  --buff-editor-label-size: 0.875rem;
  --buff-editor-meta-size: 0.8125rem;
  --buff-editor-control-height: 2.25rem;
  font-size: var(--buff-editor-text-size);
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

/* ── 顶部工具条 ── */
.editor-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  padding: 0.35rem 0.45rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft);
}

.owner-switch {
  position: relative;
  display: inline-flex;
  min-width: 0;
}

.owner-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  max-width: 22rem;
  min-height: var(--buff-editor-control-height);
  padding: 0.35rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
  font: inherit;
  font-size: var(--buff-editor-text-size);
  cursor: pointer;
}

.owner-btn:disabled {
  cursor: default;
  opacity: 0.85;
}

.owner-btn.is-open {
  border-color: color-mix(in srgb, var(--color-heading) 45%, var(--color-border));
}

.owner-prefix {
  opacity: 0.7;
}

.owner-name {
  font-size: var(--buff-editor-title-size);
  font-weight: 600;
  color: var(--color-heading);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 下拉指示：CSS 画的箭头（页面上不出现 ▸/▾ 字符） */
.owner-caret {
  flex: 0 0 auto;
  width: 0.38rem;
  height: 0.38rem;
  margin-left: 0.1rem;
  border-right: 1px solid currentColor;
  border-bottom: 1px solid currentColor;
  transform: rotate(45deg) translateY(-0.1rem);
  opacity: 0.6;
}

.owner-menu {
  position: absolute;
  left: 0;
  top: calc(100% + 4px);
  z-index: 40;
  width: 17rem;
  max-height: 22rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
}

.owner-search {
  width: 100%;
  min-height: var(--buff-editor-control-height);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
  padding: 0.3rem 0.45rem;
  font: inherit;
  font-size: var(--buff-editor-text-size);
}

.owner-list {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  overflow-y: auto;
  max-height: 17rem;
}

.owner-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.4rem;
  padding: 0.28rem 0.4rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--buff-editor-text-size);
  text-align: left;
  cursor: pointer;
}

.owner-item:hover {
  background: color-mix(in srgb, var(--color-border) 45%, transparent);
}

/* 下拉里的当前项：同薄荷强调色（原来是 heading 16% 的灰泥色） */
.owner-item.is-active {
  background: hsla(160, 100%, 37%, 0.14);
}

.owner-item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.owner-item-meta {
  flex: 0 0 auto;
  font-size: var(--buff-editor-text-size);
  opacity: 0.6;
}

.owner-empty {
  margin: 0;
  padding: 0.3rem 0.4rem;
  font-size: var(--buff-editor-text-size);
  opacity: 0.6;
}

.toolbar-stats {
  font-size: var(--buff-editor-meta-size);
  opacity: 0.72;
  white-space: nowrap;
}

.toolbar-spacer {
  flex: 1 1 auto;
}

.save-state {
  font-size: var(--buff-editor-meta-size);
  white-space: nowrap;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  opacity: 0.85;
}

.save-state.is-dirty {
  color: #d08b2c;
  border-color: rgba(208, 139, 44, 0.5);
}

.save-state.is-saving {
  color: #4d8bd8;
  border-color: rgba(77, 139, 216, 0.5);
}

.save-state.is-saved,
.save-state.is-clean {
  opacity: 0.6;
}

/* ── 主体：左导航树 + 右内容 ── */
.editor-body {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 0.55rem;
  align-items: start;
}

.block-tree {
  position: sticky;
  top: 0.35rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  max-height: 62vh;
  overflow-y: auto;
  padding: 0.25rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft);
}

.tree-block {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}

.tree-block-head {
  display: flex;
  align-items: center;
  gap: 0.1rem;
  border-radius: 8px;
}

/* 选中态：与「影画页签」「列表项」同一套薄荷强调色（hsla(160…)，见 adminCalculatorPanel.css）。
   原先用 color-mix(heading 12%) 在暖纸底上是一层灰泥色，和左边导航的薄荷色打架。 */
.tree-block-head.is-active {
  background: hsla(160, 100%, 37%, 0.12);
}

.tree-toggle {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: var(--buff-editor-control-height);
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}

/* 折叠指示：CSS 画的箭头（旋转 90° = 展开，0° = 收起） */
.tree-caret {
  width: 0.36rem;
  height: 0.36rem;
  border-right: 1px solid var(--color-text);
  border-bottom: 1px solid var(--color-text);
  transform: rotate(90deg);
  opacity: 0.7;
  transition: transform 0.12s ease;
}

.tree-caret.is-collapsed {
  transform: rotate(0deg);
}

.tree-block-btn {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
  min-height: var(--buff-editor-control-height);
  padding: 0.35rem 0.3rem 0.35rem 0;
  border: none;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--buff-editor-label-size);
  text-align: left;
  cursor: pointer;
}

.block-initial {
  display: none;
  flex: 0 0 auto;
  font-size: var(--buff-editor-meta-size);
  font-weight: 600;
}

.tree-block-btn.is-empty {
  opacity: 0.5;
}

.block-name {
  flex: 1 1 auto;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.block-count {
  flex: 0 0 auto;
  font-size: var(--buff-editor-meta-size);
  opacity: 0.6;
}

.block-dot {
  flex: 0 0 auto;
  width: 0.36rem;
  height: 0.36rem;
  border-radius: 50%;
}

.block-dot.is-warn {
  background: #c45c5c;
}

.block-dot.is-ungrouped {
  background: #dca028;
}

.tree-rows {
  list-style: none;
  margin: 0;
  padding: 0 0 0 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}

.tree-row-wrap {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  min-width: 0;
}

.tree-row-check {
  margin: 0;
  flex: 0 0 auto;
}

.tree-row {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.25rem;
  min-width: 0;
  min-height: var(--buff-editor-control-height);
  padding: 0.35rem 0.4rem;
  border: none;
  border-left: 2px solid transparent;
  border-radius: 0 6px 6px 0;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--buff-editor-label-size);
  text-align: left;
  cursor: pointer;
}

.tree-row:hover {
  background: color-mix(in srgb, var(--color-border) 40%, transparent);
}

.tree-row.is-active {
  border-left-color: hsl(160, 100%, 32%);
  background: hsla(160, 100%, 37%, 0.16);
  color: var(--color-heading);
  font-weight: 600;
}

.tree-row-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-row-badges {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 0.12rem;
}

.tree-badge {
  font-size: var(--buff-editor-meta-size);
  line-height: 1.3;
  padding: 0 0.22rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  opacity: 0.75;
}

.tree-badge.is-warn {
  color: #c45c5c;
  border-color: rgba(196, 92, 92, 0.55);
}

.tree-badge.is-ungrouped {
  color: #dca028;
  border-color: rgba(220, 160, 40, 0.55);
}

.tree-empty {
  padding: 0.1rem 0.3rem;
  font-size: var(--buff-editor-text-size);
  opacity: 0.5;
}

.block-add {
  margin-top: 0.15rem;
  min-height: var(--buff-editor-control-height);
  padding: 0.3rem 0.45rem;
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  background: transparent;
  color: var(--color-heading);
  font: inherit;
  font-size: var(--buff-editor-text-size);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}

.block-work {
  min-width: 0;
}

.hint {
  margin: 0;
  font-size: var(--buff-editor-meta-size);
  opacity: 0.75;
  line-height: 1.45;
  color: var(--color-text);
}

.empty {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--buff-editor-title-size);
  opacity: 0.7;
  padding: 1rem 0.5rem;
}

.muted {
  font-size: var(--buff-editor-meta-size);
  opacity: 0.6;
}

.merge-block-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
}

/* 空块（块内已无效果行）：右列仍显示块信息，用一条淡色提示说明下一步 */
.block-empty-hint {
  margin: 0;
  padding: 0.6rem 0.7rem;
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  color: var(--color-text);
  font-size: var(--buff-editor-meta-size);
  opacity: 0.75;
}

.block-card {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 0.7rem;
  background: var(--color-background-soft);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.block-head {
  display: flex;
  gap: 0.75rem;
  align-items: end;
  justify-content: space-between;
  flex-wrap: wrap;
}

.name-field {
  flex: 1 1 15rem;
  min-width: 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: var(--buff-editor-label-size);
  color: var(--color-text);
}

.field > span {
  font-weight: 600;
  color: var(--color-heading);
}

.field input[type='text'],
.field textarea,
.field select {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
  min-height: var(--buff-editor-control-height);
  padding: 0.4rem 0.65rem;
  font: inherit;
  font-size: var(--buff-editor-text-size);
  line-height: 1.5;
  width: 100%;
  min-width: 0;
}

.field.name-field input[type='text'] {
  min-height: 2.5rem;
  font-size: var(--buff-editor-title-size);
  font-weight: 600;
  color: var(--color-heading);
}

.field textarea {
  resize: vertical;
  min-height: 4rem;
  line-height: 1.5;
}

.note-input {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
  padding: 0.4rem 0.65rem;
  font: inherit;
  font-size: var(--buff-editor-text-size);
  resize: vertical;
  min-height: 4rem;
  line-height: 1.5;
}

.add-btn,
.ghost-btn,
.danger-btn {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  min-height: var(--buff-editor-control-height);
  padding: 0.35rem 0.65rem;
  cursor: pointer;
  font-family: inherit;
  font-size: var(--buff-editor-text-size);
  line-height: 1.5;
  white-space: nowrap;
}

.danger-btn {
  color: #c45c5c;
  border-color: rgba(196, 92, 92, 0.4);
}

.ghost-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.err {
  margin: 0;
  color: #c45c5c;
  font-size: var(--buff-editor-text-size);
}

/* ── 响应式：只压左列（220 → 180 → 56 窄条），右列宽度不动 ── */
@media (max-width: 1200px) {
  .editor-body {
    grid-template-columns: 180px minmax(0, 1fr);
  }
}

@media (max-width: 980px) {
  .editor-body {
    grid-template-columns: 56px minmax(0, 1fr);
  }

  .block-tree {
    padding: 0.2rem;
  }

  .tree-toggle,
  .tree-rows,
  .block-name {
    display: none;
  }

  .block-initial {
    display: inline;
  }

  .tree-block-btn {
    flex-direction: column;
    align-items: center;
    gap: 0.05rem;
    padding: 0.25rem 0.05rem;
    font-size: var(--buff-editor-label-size);
  }

  .block-add {
    padding: 0.25rem 0.05rem;
    font-size: var(--buff-editor-label-size);
  }
}
</style>