<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AffixBenefitTable } from '@/utils/affixBenefitAnalysis'
import { formatAffixPerRoll, type AffixLibraryEntry } from '@/utils/affixLibrary'
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
    rollsPerStep?: number
    loading?: boolean
  }>(),
  { rollsPerStep: 1, loading: false },
)

const emit = defineEmits<{
  select: [entryId: string]
  toggleEntry: [entryId: string, enabled: boolean]
  addEntry: [entry: Omit<AffixLibraryEntry, 'id'>]
  updateEntry: [entryId: string, patch: Partial<AffixLibraryEntry>]
  removeEntry: [entryId: string]
  restoreDefaults: []
  /** 弹窗里做了库级变更（切库/导入等），页面应重新载入激活库并重算 */
  librarySwitched: []
}>()

const sortKey = ref<'percent' | 'name'>('percent')
const showLibraryModal = ref(false)

const sortedRows = computed(() => {
  const rows = props.table?.rows ?? []
  if (sortKey.value === 'name') {
    return [...rows].sort((a, b) => a.label.localeCompare(b.label, 'zh'))
  }
  return rows
})

// ---------- 列宽（可拖拽，按比例） ----------
/**
 * 列宽用**比例**而不是像素：表格占满容器宽度，比例才能「拖多少就是多少」。
 * 默认比例把「词条」列压到 20%（原 auto 布局下它吃掉约 28%），数值列相应放宽。
 */
const BENEFIT_COLUMN_SPECS: ResizableColumnSpec[] = [
  { key: 'entry', defaultRatio: 20, minWidthPx: 120 },
  { key: 'perRoll', defaultRatio: 11, minWidthPx: 64 },
  { key: 'currentRolls', defaultRatio: 13, minWidthPx: 80 },
  { key: 'damageDelta', defaultRatio: 22, minWidthPx: 110 },
  { key: 'percentDelta', defaultRatio: 12, minWidthPx: 80 },
  { key: 'weight', defaultRatio: 22, minWidthPx: 100 },
]

const BENEFIT_COLUMN_STORAGE_KEY = 'zzz-hp-affix-benefit-col-ratios'

const benefitTableWrap = ref<HTMLElement | null>(null)

const {
  ratioOf: benefitColumnRatio,
  resizingKey: resizingColumnKey,
  startResize: startColumnResize,
  resetColumn: resetColumnWidth,
} = useResizableColumns(BENEFIT_COLUMN_STORAGE_KEY, BENEFIT_COLUMN_SPECS)

/** 表头元数据；与 BENEFIT_COLUMN_SPECS 的 key 一一对应 */
const benefitColumns = computed(() => [
  { key: 'entry', label: '词条', numeric: false },
  { key: 'perRoll', label: '每档', numeric: true },
  { key: 'currentRolls', label: '当前档数', numeric: true },
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

    <AffixLibraryModal
      :open="showLibraryModal"
      :library="library"
      :enabled-ids="enabledIds"
      @close="showLibraryModal = false"
      @toggle-entry="(id, enabled) => emit('toggleEntry', id, enabled)"
      @add-entry="(entry) => emit('addEntry', entry)"
      @update-entry="(id, patch) => emit('updateEntry', id, patch)"
      @remove-entry="(id) => emit('removeEntry', id)"
      @restore-defaults="emit('restoreDefaults')"
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
          （每条按 +{{ rollsPerStep }} 档单独评估，共 {{ table.evaluatedCount }} 条）
        </span>
      </p>
      <div ref="benefitTableWrap" class="table-wrap benefit-table-wrap">
        <table class="benefit-table">
          <colgroup>
            <col
              v-for="col in benefitColumns"
              :key="col.key"
              :style="{ width: `${benefitColumnRatio(col.key)}%` }"
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
                  title="拖动调整列宽；双击恢复默认"
                  @mousedown="startColumnResize(col.key, $event, benefitTableWrap)"
                  @dblclick="resetColumnWidth(col.key)"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in sortedRows"
              :key="row.entryId"
              class="benefit-row"
              @click="emit('select', row.entryId)"
            >
              <td>{{ row.label }}</td>
              <td class="num-cell">{{ formatAffixPerRoll(row.target, row.perRoll) }}</td>
              <td class="num-cell">{{ row.currentRolls }}</td>
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
                  :style="{ width: `${Math.max(0, Math.min(1, row.weight)) * 100}%` }"
                />
                <span class="weight-text">{{ formatWeight(row.weight) }}</span>
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

.chip {
  border: 1px solid var(--calc-border, #d5dae3);
  border-radius: 999px;
  background: var(--calc-surface-2, #f1efe9);
  color: var(--calc-text, #1c212a);
  font: inherit;
  font-size: 0.78rem;
  padding: 0.22rem 0.7rem;
  cursor: pointer;
}

.chip:hover {
  border-color: var(--calc-accent, #c9a55c);
}

.chip.active {
  border-color: var(--calc-accent, #c9a55c);
  background: var(--calc-accent-bg, #fff8eb);
  color: #5c4818;
  font-weight: 600;
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

/* ---------- 收益表：列宽可拖拽 ---------- */

/* 表格占满容器（保持原有布局），列宽按比例分配 */
.benefit-table {
  /* fixed 布局：列宽严格按 <col> 比例走，拖拽才能精确生效 */
  table-layout: fixed;
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
