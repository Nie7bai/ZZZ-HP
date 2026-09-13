<script setup lang="ts">
import { computed, ref } from 'vue'
import { affixRelativeWeights, type AffixBenefitTable } from '@/utils/affixBenefitAnalysis'
import { formatAffixPerRoll, type AffixLibraryEntry, type AffixLibraryGroup } from '@/utils/affixLibrary'
import AffixLibraryModal from '@/components/calculator/AffixLibraryModal.vue'
import { useResizableColumns, type ResizableColumnSpec } from '@/composables/useResizableColumns'

/**
 * 词条收益表（词条功能改造）
 *
 * 每条词条 +N 档的总伤增量、收益率、相对权重。
 * 词条库的编辑与多套库切换收在 `AffixLibraryModal` 里（点「词条库」按钮打开）。
 */

const props = withDefaults(
  defineProps<{
    table: AffixBenefitTable | null
    library: AffixLibraryEntry[]
    /** 条目 id → 是否参与计算 */
    enabledIds: string[]
    /** 当前激活库的分组（组名 + 组额度） */
    groups: AffixLibraryGroup[]
    rollsPerStep?: number
    loading?: boolean
  }>(),
  { rollsPerStep: 1, loading: false },
)

const emit = defineEmits<{
  select: [entryId: string]
  toggleEntry: [entryId: string, enabled: boolean]
  /** 一次改多条（弹窗里组页的「全选 / 全部取消」） */
  toggleEntries: [entryIds: string[], enabled: boolean]
  addEntry: [entry: Omit<AffixLibraryEntry, 'id'>]
  updateEntry: [entryId: string, patch: Partial<AffixLibraryEntry>]
  removeEntry: [entryId: string]
  restoreDefaults: []
  addGroup: [name: string, cap: number]
  setGroupCap: [name: string, cap: number]
  renameGroup: [from: string, to: string]
  removeGroup: [name: string]
  /** 弹窗里做了库级变更（切库/导入等），页面应重新载入激活库并重算 */
  librarySwitched: []
}>()

const sortKey = ref<'percent' | 'name'>('percent')
const showLibraryModal = ref(false)

/**
 * 分组筛选（**多选**）：只记「被关掉的分组」，空集 = 不筛选、全都显示。
 *
 * 为什么反着记：库里新增的分组要默认可见。记「选中的」就得在分组增减时同步补名字，
 * 漏一处新组就凭空消失（而它明明有收益）；记「关掉的」则新组天然是开的。
 */
const hiddenGroups = ref<Set<string>>(new Set())

/** 未分组条目在筛选条上的显示名（`entry.group` 为空串） */
const UNGROUPED_GROUP_LABEL = '未分组'

/**
 * 「隐藏无收益」：只留收益率 **> 0** 的条目。
 *
 * 口径写死在这里：收益率为 0（改了等于没改）与为负（越改越低）都算「无收益」，
 * 看收益表时这两类通常是噪声 —— 用户口径「现在所有词条显示太多了」。
 */
const hideNoBenefit = ref(false)

const sortedRows = computed(() => {
  const rows = props.table?.rows ?? []
  if (sortKey.value === 'name') {
    return [...rows].sort((a, b) => a.label.localeCompare(b.label, 'zh'))
  }
  return rows
})

/** 条目 id → 组名（空串 = 未分组）；筛选条与分组统计都用它 */
const groupByEntryId = computed(() => {
  const map = new Map<string, string>()
  for (const entry of props.library) map.set(entry.id, entry.group)
  return map
})

/** 筛选条上的分组：按组表顺序，未分组排最后；只列**当前表里真有条目**的组 */
const tableGroupNames = computed(() => {
  const present = new Set<string>()
  for (const row of sortedRows.value) present.add(groupByEntryId.value.get(row.entryId) ?? '')
  const ordered = props.groups.map((group) => group.name).filter((name) => present.has(name))
  // 组表里没有的组名（例如组被删掉、条目还在）也要给一条，否则那些条目筛不出来
  for (const name of present) {
    if (name && !ordered.includes(name)) ordered.push(name)
  }
  if (present.has('')) ordered.push('')
  return ordered
})

/** 某分组在当前表里的条目数（显示在 chip 上，省得点开才看出来） */
function countInGroup(name: string): number {
  let count = 0
  for (const row of sortedRows.value) {
    if ((groupByEntryId.value.get(row.entryId) ?? '') === name) count += 1
  }
  return count
}

/** 筛选条上的显示名（未分组是空串，得翻译一下） */
function groupChipLabel(name: string): string {
  return name || UNGROUPED_GROUP_LABEL
}

function isGroupVisible(name: string): boolean {
  return !hiddenGroups.value.has(name)
}

function toggleGroupFilter(name: string) {
  const next = new Set(hiddenGroups.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  hiddenGroups.value = next
}

/** 表格里真正显示的行：分组筛选 + 「隐藏无收益」两道都过 */
const visibleRows = computed(() =>
  sortedRows.value.filter((row) => {
    if (hideNoBenefit.value && !(row.percentDelta > 0)) return false
    return !hiddenGroups.value.has(groupByEntryId.value.get(row.entryId) ?? '')
  }),
)

/** 是否有筛选在生效（用来决定要不要显示「已被筛掉多少条」的提示） */
const filteringActive = computed(
  () => hiddenGroups.value.size > 0 || hideNoBenefit.value,
)

/**
 * 显示用的相对权重：分母是**当前显示出来的行**里的最大收益率。
 *
 * 为什么不直接用 `row.weight`（那是整表口径）：筛掉收益最高的那几组以后，
 * 显示出来的行里就没有 1.000 了，整列柱子一起变短 —— 看不出这批里谁强谁弱。
 * 公式与整表口径同一个（`affixRelativeWeights`），只是分母换成显示行。
 */
const displayWeights = computed(() => {
  const rows = visibleRows.value
  const weights = affixRelativeWeights(rows)
  const map = new Map<string, number>()
  rows.forEach((row, index) => map.set(row.entryId, weights[index] ?? 0))
  return map
})

/** 取某行显示用权重（没算到就是 0，例如全为负收益） */
function displayWeightOf(entryId: string): number {
  return displayWeights.value.get(entryId) ?? 0
}

/** 把筛选一次清干净 */
function resetFilters() {
  hiddenGroups.value = new Set()
  hideNoBenefit.value = false
}

// ---------- 列宽（可拖拽，Excel 式：每列独立像素宽） ----------
/**
 * 列宽规则见 `useResizableColumns`：
 * - 还没拖过：按下面的 `defaultRatio` 铺满容器（首屏与改造前视觉一致）；
 * - 拖过一次之后：每列都是**独立像素宽**，拖某一列不影响其它列，
 *   表格总宽 = 各列之和（超出横向滚动、不足右侧留白，与 Excel 一致）。
 *
 * 所以 `defaultRatio` 不是持久语义，只在「首次铺满」与「双击复位」时用。
 */
const BENEFIT_COLUMN_SPECS: ResizableColumnSpec[] = [
  { key: 'entry', defaultRatio: 22, minWidthPx: 120 },
  { key: 'perRoll', defaultRatio: 12, minWidthPx: 64 },
  { key: 'damageDelta', defaultRatio: 24, minWidthPx: 110 },
  { key: 'percentDelta', defaultRatio: 13, minWidthPx: 80 },
  { key: 'weight', defaultRatio: 29, minWidthPx: 100 },
]

const BENEFIT_COLUMN_STORAGE_KEY = 'zzz-hp-affix-benefit-col-widths'

const benefitTableWrap = ref<HTMLElement | null>(null)

const {
  hasPixelWidths: benefitHasPixelWidths,
  totalWidthPx: benefitTotalWidthPx,
  widthOf: benefitColumnWidth,
  resizingKey: resizingColumnKey,
  startResize: startColumnResize,
  resetColumn: resetColumnWidth,
} = useResizableColumns(BENEFIT_COLUMN_STORAGE_KEY, BENEFIT_COLUMN_SPECS)

/**
 * 像素态下必须把表格宽显式设成各列之和。
 *
 * 仍旧写 `width: 100%` 的话，浏览器会把差值摊回各列 —— 那就又变成「拖一列、别的列跟着变」，
 * 正是本次要去掉的行为。
 */
const benefitTableStyle = computed(() =>
  benefitHasPixelWidths.value ? { width: `${benefitTotalWidthPx.value}px` } : undefined,
)

/** 表头元数据；与 BENEFIT_COLUMN_SPECS 的 key 一一对应 */
const benefitColumns = computed(() => [
  { key: 'entry', label: '词条', numeric: false },
  { key: 'perRoll', label: '每档', numeric: true },
  { key: 'damageDelta', label: `+${props.rollsPerStep} 档伤害增量`, numeric: true },
  { key: 'percentDelta', label: '收益率', numeric: true },
  { key: 'weight', label: '相对权重', numeric: true },
])


function formatDelta(value: number) {
  if (!Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${Math.round(value).toLocaleString('en-US')}`
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatWeight(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '—'
  return value.toFixed(3)
}

/** 弹窗里做了库级变更：转告页面重新载入激活库并重算 */
function onLibrarySwitched() {
  emit('librarySwitched')
}

</script>

<template>
  <div class="benefit-workbench">
    <div class="toolbar">
      <span class="ctl-label">排序</span>
      <button
        type="button"
        class="chip"
        :class="{ active: sortKey === 'percent' }"
        @click="sortKey = 'percent'"
      >
        收益降序
      </button>
      <button
        type="button"
        class="chip"
        :class="{ active: sortKey === 'name' }"
        @click="sortKey = 'name'"
      >
        按名称
      </button>
      <span class="ctl-spacer" />
      <button
        type="button"
        class="chip"
        :class="{ active: showLibraryModal }"
        @click="showLibraryModal = true"
      >
        词条库（{{ library.length }} 条）
      </button>
    </div>

    <!--
      筛选条：按组多选 + 隐藏无收益。
      词条多了以后整表太长，分组是现成的分类维度（用户 2026-09-13 口径「做分类显示」）。
    -->
    <div v-if="tableGroupNames.length" class="toolbar filter-bar">
      <span class="ctl-label">分组</span>
      <button
        v-for="name in tableGroupNames"
        :key="name || '__ungrouped__'"
        type="button"
        class="chip"
        :class="{ active: isGroupVisible(name) }"
        :title="isGroupVisible(name) ? '点一下把这组从表里去掉' : '点一下把这组加回表里'"
        @click="toggleGroupFilter(name)"
      >
        {{ groupChipLabel(name) }}（{{ countInGroup(name) }}）
      </button>
      <span class="ctl-spacer" />
      <button
        type="button"
        class="chip"
        :class="{ active: hideNoBenefit }"
        title="只留收益率大于 0 的条目（收益率为 0 或为负的都算无收益）"
        @click="hideNoBenefit = !hideNoBenefit"
      >
        隐藏无收益
      </button>
      <button v-if="filteringActive" type="button" class="chip" @click="resetFilters">
        清除筛选
      </button>
    </div>

    <AffixLibraryModal
      :open="showLibraryModal"
      :library="library"
      :enabled-ids="enabledIds"
      :groups="groups"
      @close="showLibraryModal = false"
      @toggle-entry="(id, enabled) => emit('toggleEntry', id, enabled)"
      @toggle-entries="(ids, enabled) => emit('toggleEntries', ids, enabled)"
      @add-entry="(entry) => emit('addEntry', entry)"
      @update-entry="(id, patch) => emit('updateEntry', id, patch)"
      @remove-entry="(id) => emit('removeEntry', id)"
      @restore-defaults="emit('restoreDefaults')"
      @add-group="(name, cap) => emit('addGroup', name, cap)"
      @set-group-cap="(name, cap) => emit('setGroupCap', name, cap)"
      @rename-group="(from, to) => emit('renameGroup', from, to)"
      @remove-group="(name) => emit('removeGroup', name)"
      @switched="onLibrarySwitched"
    />

    <p v-if="loading" class="hint">正在计算词条收益…</p>
    <p v-else-if="!table || !table.rows.length" class="hint">
      没有参与计算的词条。请点右上角「词条库」启用条目。
    </p>
    <template v-else>
      <p class="baseline-line">
        基线总伤：<strong>{{ Math.round(table.baselineDamage).toLocaleString('en-US') }}</strong>
        <span class="summary-hint">
          （每条按 +{{ rollsPerStep }} 档单独评估，共 {{ table.evaluatedCount }} 条<span
            v-if="visibleRows.length !== table.rows.length"
          >
            ，当前显示 {{ visibleRows.length }} 条</span
          >）
        </span>
      </p>
      <p v-if="!visibleRows.length" class="hint">
        当前筛选下没有条目。点「清除筛选」看全部。
      </p>
      <div ref="benefitTableWrap" class="table-wrap benefit-table-wrap">
        <table class="benefit-table" :style="benefitTableStyle">
          <colgroup>
            <col
              v-for="col in benefitColumns"
              :key="col.key"
              :style="{ width: benefitColumnWidth(col.key) }"
            />
          </colgroup>
          <thead>
            <tr>
              <th
                v-for="col in benefitColumns"
                :key="col.key"
                :class="{ 'num-head': col.numeric }"
              >
                {{ col.label }}
                <span
                  class="col-resizer"
                  :class="{ active: resizingColumnKey === col.key }"
                  title="拖动调整列宽；双击恢复本列默认宽"
                  @mousedown="startColumnResize(col.key, $event, benefitTableWrap)"
                  @dblclick="resetColumnWidth(col.key, benefitTableWrap)"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in visibleRows"
              :key="row.entryId"
              class="benefit-row"
              @click="emit('select', row.entryId)"
            >
              <td>{{ row.label }}</td>
              <td class="num-cell">{{ formatAffixPerRoll(row.target, row.perRoll) }}</td>
              <td
                class="num-cell"
                :class="row.damageDelta > 0 ? 'pos' : row.damageDelta < 0 ? 'neg' : ''"
              >
                {{ formatDelta(row.damageDelta) }}
              </td>
              <td
                class="num-cell"
                :class="row.percentDelta > 0 ? 'pos' : row.percentDelta < 0 ? 'neg' : ''"
              >
                {{ formatPercent(row.percentDelta) }}
              </td>
              <td class="num-cell weight-cell">
                <span
                  class="weight-bar"
                  :style="{ width: `${Math.max(0, Math.min(1, displayWeightOf(row.entryId))) * 100}%` }"
                />
                <span class="weight-text">{{ formatWeight(displayWeightOf(row.entryId)) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

  </div>
</template>

<style scoped>
.benefit-workbench {
  margin-top: 0.5rem;
  color: var(--calc-text, #1c212a);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}

.ctl-label {
  font-size: 0.8rem;
  color: var(--calc-muted, #6b7280);
}

/*
 * 筛选条：与上面排序条同一套控件，视觉上压低一行，避免两条工具栏抢主次。
 * `.chip` 本体见 `assets/calculatorChip.css`（全站唯一来源），这里只写本组件特有的部分。
 */
.filter-bar {
  margin-top: -0.25rem;
}

.ctl-spacer {
  flex: 1;
}

.baseline-line {
  margin: 0 0 0.5rem;
  font-size: 0.82rem;
  color: var(--calc-text, #1c212a);
}

.baseline-line strong {
  color: #8a6d2e;
}

.summary-hint {
  color: var(--calc-muted, #6b7280);
  font-size: 0.75rem;
}

.hint {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: var(--calc-muted, #6b7280);
}

.err {
  margin: 0.3rem 0 0;
  font-size: 0.78rem;
  color: #b42318;
}

.table-wrap {
  overflow: auto;
  border: 1px solid var(--calc-border, #d5dae3);
  border-radius: 10px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

th {
  padding: 0.55rem 0.65rem;
  border-bottom: 1px solid var(--calc-border, #d5dae3);
  background: var(--calc-surface-2, #f1efe9);
  color: var(--calc-muted, #6b7280);
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
}

/* 数值列表头必须与 .num-cell 同向（右对齐），否则表头在左、数字在右，看着不对齐 */
th.num-head {
  text-align: right;
}

/* ---------- 收益表：列宽可拖拽（每列独立像素宽） ---------- */

/* 表格默认占满容器（这是「还没拖过」时的观感）；拖过一次后由内联 style 改成各列之和 */
.benefit-table {
  /* fixed 布局：列宽严格按 <col> 走，拖拽才能精确生效 */
  table-layout: fixed;
  width: 100%;
}

/* 表头与数值同一右侧内边距，保证右对齐仍然对齐；超长内容省略号避免撑破列宽 */
.benefit-table th,
.benefit-table td {
  padding-right: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
}

.benefit-table th {
  position: relative;
}

/* 列分界竖线：静止时可见（浅灰），hover / 拖拽时变金色加粗 */
.col-resizer {
  position: absolute;
  top: 0;
  right: 0;
  width: 9px;
  height: 100%;
  cursor: col-resize;
  user-select: none;
  z-index: 2;
}

.col-resizer::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 15%;
  width: 1px;
  height: 70%;
  background: rgba(112, 103, 86, 0.55);
  transition: background 0.12s ease-out, width 0.12s ease-out;
}

.col-resizer:hover::before,
.col-resizer.active::before {
  left: 3px;
  width: 2px;
  background: var(--calc-accent, #c9a55c);
}

td {
  padding: 0.55rem 0.65rem;
  border-bottom: 1px solid var(--calc-border, #d5dae3);
  color: var(--calc-text, #1c212a);
  text-align: left;
}

tbody tr:last-child td {
  border-bottom: none;
}

.num-cell {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

td.pos {
  color: #1f7a47;
}

td.neg {
  color: #b42318;
}

.benefit-row {
  cursor: pointer;
}

.benefit-row:hover {
  background: rgba(201, 165, 92, 0.1);
}

.weight-cell {
  position: relative;
  min-width: 96px;
}

.weight-bar {
  position: absolute;
  left: 0;
  top: 50%;
  height: 60%;
  transform: translateY(-50%);
  background: rgba(201, 165, 92, 0.28);
  border-radius: 2px;
  pointer-events: none;
}

.weight-text {
  position: relative;
}

.library-editor {
  margin-top: 0.85rem;
  padding-top: 0.75rem;
  border-top: 1px dashed var(--calc-border, #d5dae3);
}

.library-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.4rem;
}

.library-header h4 {
  margin: 0;
  font-size: 0.88rem;
  color: var(--calc-text, #1c212a);
}

.ghost-btn {
  border: 1px solid var(--calc-border, #d5dae3);
  border-radius: 8px;
  background: var(--calc-surface-2, #f1efe9);
  color: var(--calc-text, #1c212a);
  font: inherit;
  font-size: 0.78rem;
  padding: 0.22rem 0.6rem;
  cursor: pointer;
}

.library-table tr.disabled {
  opacity: 0.5;
}

.type-cell {
  white-space: nowrap;
  color: var(--calc-muted, #6b7280);
  font-size: 0.76rem;
}

/* 「每档」输入 + 单位后缀：单位不是输入值的一部分，只是提示 */
.per-roll-cell {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  width: 100%;
}

.unit-hint {
  flex: none;
  color: var(--calc-muted, #6b7280);
  font-size: 0.76rem;
}

.inline-input {
  width: 100%;
  min-width: 4.5rem;
  padding: 0.18rem 0.35rem;
  border: 1px solid var(--calc-border, #d5dae3);
  border-radius: 4px;
  background: var(--calc-input-bg, #ffffff);
  color: var(--calc-text, #1c212a);
  font: inherit;
  font-size: 0.78rem;
}

.inline-input.num {
  width: 5rem;
}

.del-btn {
  width: 1.5rem;
  height: 1.5rem;
  border: 1px solid rgba(196, 92, 92, 0.45);
  border-radius: 4px;
  background: transparent;
  color: #b42318;
  cursor: pointer;
  line-height: 1;
}

.add-entry {
  margin-top: 0.75rem;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--calc-border, #d5dae3);
  border-radius: 8px;
  background: var(--calc-surface-2, #f1efe9);
}

.add-entry h5 {
  margin: 0 0 0.45rem;
  font-size: 0.82rem;
  color: var(--calc-text, #1c212a);
}

.add-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.45rem;
  align-items: end;
}

.add-grid label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.75rem;
  color: var(--calc-muted, #6b7280);
}

.add-grid input,
.add-grid select {
  padding: 0.25rem 0.35rem;
  border: 1px solid var(--calc-border, #d5dae3);
  border-radius: 4px;
  background: var(--calc-input-bg, #ffffff);
  color: var(--calc-text, #1c212a);
  font: inherit;
  font-size: 0.78rem;
}

.btn-primary {
  border: 1px solid var(--calc-accent, #c9a55c);
  border-radius: 999px;
  background: var(--calc-accent-bg, #fff8eb);
  color: #5c4818;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.28rem 0.85rem;
  cursor: pointer;
  height: fit-content;
}

.btn-primary:hover {
  background: #fff3d6;
  border-color: #b8944a;
}
</style>
