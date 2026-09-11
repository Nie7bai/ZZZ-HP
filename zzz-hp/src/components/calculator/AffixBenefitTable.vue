<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AffixBenefitTable } from '@/utils/affixBenefitAnalysis'
import type { AffixLibraryEntry } from '@/utils/affixLibrary'
import { useResizableColumns, type ResizableColumnSpec } from '@/composables/useResizableColumns'

/**
 * 词条收益表 + 词条库编辑（词条功能改造）
 *
 * 上表：每条词条 +N 档的总伤增量、收益率、相对权重。
 * 下表：词条库编辑器，可增删改条目、切换参与状态。
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
  addEntry: [entry: Omit<AffixLibraryEntry, 'id' | 'builtin'>]
  updateEntry: [entryId: string, patch: Partial<AffixLibraryEntry>]
  removeEntry: [entryId: string]
  restoreDefaults: []
}>()

const sortKey = ref<'percent' | 'name'>('percent')
const showLibraryEditor = ref(false)

const enabledSet = computed(() => new Set(props.enabledIds))

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

// ---------- 新增条目表单 ----------
const draft = ref({
  label: '',
  kind: 'substat' as 'substat' | 'panelField',
  affixKey: 'atkPercent',
  panelField: 'dmgBonus',
  perRoll: 3,
  cap: 0,
  group: '',
})
const draftError = ref<string | null>(null)

const SUBSTAT_OPTIONS = [
  { id: 'atkPercent', label: '局外攻击力%' },
  { id: 'atkFlat', label: '固定攻击力' },
  { id: 'hpPercent', label: '局外生命值%' },
  { id: 'hpFlat', label: '固定生命值' },
  { id: 'defPercent', label: '局外防御力%' },
  { id: 'defFlat', label: '固定防御力' },
  { id: 'critRate', label: '暴击率%' },
  { id: 'critDmg', label: '暴击伤害%' },
  { id: 'mastery', label: '异常精通' },
  { id: 'pen', label: '固定穿透' },
]

const PANEL_FIELD_OPTIONS = [
  { id: 'dmgBonus', label: '增伤%' },
  { id: 'penRate', label: '穿透率%' },
  { id: 'reduceDefense', label: '减防%' },
  { id: 'ignoreDefense', label: '无视防御%' },
  { id: 'resPen', label: '抗性穿透%' },
  { id: 'anomalyDmgBonus', label: '异常增伤%' },
  { id: 'anomalyCritRate', label: '异常暴击率%' },
  { id: 'anomalyCritDmg', label: '异常暴击伤害%' },
  { id: 'anomalyReleaseDmgBonus', label: '异放增伤%' },
  { id: 'disorderDmgBonus', label: '紊乱增伤%' },
  { id: 'turbulenceDmgBonus', label: '乱流增伤%' },
  { id: 'radianceDmgBonus', label: '耀变增伤%' },
  { id: 'radianceResPen', label: '耀变抗性穿透%' },
  { id: 'specialMult', label: '特殊倍率%' },
]

function submitDraft() {
  const label = draft.value.label.trim()
  if (!label) {
    draftError.value = '请填写词条名称'
    return
  }
  if (!Number.isFinite(draft.value.perRoll) || draft.value.perRoll <= 0) {
    draftError.value = '每档数值须为正数'
    return
  }
  draftError.value = null
  emit('addEntry', {
    label,
    kind: draft.value.kind,
    affixKey: draft.value.kind === 'substat' ? (draft.value.affixKey as never) : undefined,
    panelField: draft.value.kind === 'panelField' ? (draft.value.panelField as never) : undefined,
    perRoll: draft.value.perRoll,
    cap: draft.value.cap,
    group: draft.value.group.trim(),
    // 独立功能口径：每条词条 1 档一律占 1 个总词条数
    rollCost: 1,
    enabledByDefault: true,
  })
  draft.value.label = ''
  draft.value.cap = 0
  draft.value.group = ''
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
        :class="{ active: showLibraryEditor }"
        @click="showLibraryEditor = !showLibraryEditor"
      >
        词条库（{{ library.length }} 条）
      </button>
    </div>

    <p v-if="loading" class="hint">正在计算词条收益…</p>
    <p v-else-if="!table || !table.rows.length" class="hint">
      没有参与计算的词条。请在下方「词条库」中启用条目。
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
              <td class="num-cell">{{ row.perRoll }}</td>
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

    <section v-if="showLibraryEditor" class="library-editor">
      <header class="library-header">
        <h4>词条库</h4>
        <button type="button" class="ghost-btn" @click="emit('restoreDefaults')">恢复默认</button>
      </header>

      <div class="table-wrap">
        <table class="library-table">
          <thead>
            <tr>
              <th>参与</th>
              <th>名称</th>
              <th>类型</th>
              <th>每档</th>
              <th>上限</th>
              <th>互斥组</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in library" :key="entry.id" :class="{ disabled: !enabledSet.has(entry.id) }">
              <td>
                <input
                  type="checkbox"
                  :checked="enabledSet.has(entry.id)"
                  @change="emit('toggleEntry', entry.id, ($event.target as HTMLInputElement).checked)"
                />
              </td>
              <td>
                <input
                  class="inline-input"
                  :value="entry.label"
                  @change="emit('updateEntry', entry.id, { label: ($event.target as HTMLInputElement).value })"
                />
              </td>
              <td class="type-cell">
                {{ entry.kind === 'substat' ? '副词条' : '面板字段' }}
                <span v-if="entry.builtin" class="builtin-tag">内置</span>
              </td>
              <td>
                <input
                  class="inline-input num"
                  type="number"
                  step="0.1"
                  :value="entry.perRoll"
                  @change="emit('updateEntry', entry.id, { perRoll: Number(($event.target as HTMLInputElement).value) })"
                />
              </td>
              <td>
                <input
                  class="inline-input num"
                  type="number"
                  min="0"
                  step="1"
                  :value="entry.cap"
                  title="0 表示不设上限"
                  @change="emit('updateEntry', entry.id, { cap: Number(($event.target as HTMLInputElement).value) })"
                />
              </td>
              <td>
                <input
                  class="inline-input"
                  :value="entry.group"
                  placeholder="空=自由"
                  @change="emit('updateEntry', entry.id, { group: ($event.target as HTMLInputElement).value })"
                />
              </td>
              <td>
                <button
                  v-if="!entry.builtin"
                  type="button"
                  class="del-btn"
                  title="删除自建条目"
                  @click="emit('removeEntry', entry.id)"
                >
                  ×
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="add-entry">
        <h5>新增词条</h5>
        <div class="add-grid">
          <label>
            <span>名称</span>
            <input v-model="draft.label" type="text" placeholder="如：5号位增伤" />
          </label>
          <label>
            <span>类型</span>
            <select v-model="draft.kind">
              <option value="substat">副词条</option>
              <option value="panelField">面板字段</option>
            </select>
          </label>
          <label v-if="draft.kind === 'substat'">
            <span>字段</span>
            <select v-model="draft.affixKey">
              <option v-for="opt in SUBSTAT_OPTIONS" :key="opt.id" :value="opt.id">
                {{ opt.label }}
              </option>
            </select>
          </label>
          <label v-else>
            <span>字段</span>
            <select v-model="draft.panelField">
              <option v-for="opt in PANEL_FIELD_OPTIONS" :key="opt.id" :value="opt.id">
                {{ opt.label }}
              </option>
            </select>
          </label>
          <label>
            <span>每档</span>
            <input v-model.number="draft.perRoll" type="number" step="0.1" min="0" />
          </label>
          <label>
            <span>上限</span>
            <input v-model.number="draft.cap" type="number" min="0" step="1" title="0 = 不设上限" />
          </label>
          <label>
            <span>互斥组</span>
            <input v-model="draft.group" type="text" placeholder="可空" />
          </label>
          <button type="button" class="btn-primary" @click="submitDraft">添加</button>
        </div>
        <p v-if="draftError" class="err">{{ draftError }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.benefit-workbench {
  margin-top: 0.5rem;
  color: var(--calc-text, #e8eaed);
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
  color: var(--calc-muted, #9aa3b0);
}

.chip {
  border: 1px solid var(--calc-border, #2d323a);
  border-radius: 999px;
  background: var(--calc-surface-2, #141820);
  color: var(--calc-text, #e8eaed);
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
  background: var(--calc-accent-bg, rgba(201, 165, 92, 0.14));
  color: var(--calc-accent-fg, #f0d7a2);
  font-weight: 600;
}

.ctl-spacer {
  flex: 1;
}

.baseline-line {
  margin: 0 0 0.5rem;
  font-size: 0.82rem;
  color: var(--calc-text, #e8eaed);
}

.baseline-line strong {
  color: var(--calc-accent, #c9a55c);
}

.summary-hint {
  color: var(--calc-muted, #9aa3b0);
  font-size: 0.75rem;
}

.hint {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: var(--calc-muted, #9aa3b0);
}

.err {
  margin: 0.3rem 0 0;
  font-size: 0.78rem;
  color: var(--calc-neg, #f07178);
}

.table-wrap {
  overflow: auto;
  border: 1px solid var(--calc-border, #2d323a);
  border-radius: 10px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

th {
  padding: 0.55rem 0.65rem;
  border-bottom: 1px solid var(--calc-border, #2d323a);
  background: var(--calc-surface-2, #141820);
  color: var(--calc-muted, #9aa3b0);
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
  border-bottom: 1px solid var(--calc-border, #2d323a);
  color: var(--calc-text, #e8eaed);
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
  color: var(--calc-pos, #7dd3a0);
}

td.neg {
  color: var(--calc-neg, #f07178);
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
  border-top: 1px dashed var(--calc-border, #2d323a);
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
  color: var(--calc-text, #e8eaed);
}

.ghost-btn {
  border: 1px solid var(--calc-border, #2d323a);
  border-radius: 8px;
  background: var(--calc-surface-2, #141820);
  color: var(--calc-text, #e8eaed);
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
  color: var(--calc-muted, #9aa3b0);
  font-size: 0.76rem;
}

.builtin-tag {
  margin-left: 0.3rem;
  padding: 0 0.25rem;
  border-radius: 4px;
  background: color-mix(in srgb, var(--calc-muted, #9aa3b0) 18%, transparent);
  font-size: 0.68rem;
}

.inline-input {
  width: 100%;
  min-width: 4.5rem;
  padding: 0.18rem 0.35rem;
  border: 1px solid var(--calc-border, #2d323a);
  border-radius: 4px;
  background: var(--calc-input-bg, #0f1217);
  color: var(--calc-text, #e8eaed);
  font: inherit;
  font-size: 0.78rem;
}

.inline-input.num {
  width: 5rem;
}

.del-btn {
  width: 1.5rem;
  height: 1.5rem;
  border: 1px solid color-mix(in srgb, var(--calc-neg, #f07178) 45%, transparent);
  border-radius: 4px;
  background: transparent;
  color: var(--calc-neg, #f07178);
  cursor: pointer;
  line-height: 1;
}

.add-entry {
  margin-top: 0.75rem;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--calc-border, #2d323a);
  border-radius: 8px;
  background: var(--calc-surface-2, #141820);
}

.add-entry h5 {
  margin: 0 0 0.45rem;
  font-size: 0.82rem;
  color: var(--calc-text, #e8eaed);
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
  color: var(--calc-muted, #9aa3b0);
}

.add-grid input,
.add-grid select {
  padding: 0.25rem 0.35rem;
  border: 1px solid var(--calc-border, #2d323a);
  border-radius: 4px;
  background: var(--calc-input-bg, #0f1217);
  color: var(--calc-text, #e8eaed);
  font: inherit;
  font-size: 0.78rem;
}

.btn-primary {
  border: 1px solid var(--calc-accent, #c9a55c);
  border-radius: 999px;
  background: var(--calc-accent-bg, rgba(201, 165, 92, 0.14));
  color: var(--calc-accent-fg, #f0d7a2);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.28rem 0.85rem;
  cursor: pointer;
  height: fit-content;
}

.btn-primary:hover {
  background: var(--calc-run-bg-hover, rgba(201, 165, 92, 0.22));
  border-color: var(--calc-run-border-hover, rgba(201, 165, 92, 0.55));
}
</style>
