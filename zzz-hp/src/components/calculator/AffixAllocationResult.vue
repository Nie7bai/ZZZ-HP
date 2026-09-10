<script setup lang="ts">
import { computed } from 'vue'
import { buildAllocationRows } from '@/utils/affixOptimizer'
import type { AffixOptimizerProgress, AffixOptimizerResult } from '@/utils/affixOptimizer'
import type { AffixLibraryEntry } from '@/utils/affixLibrary'

/**
 * 最优分配结果面板
 *
 * 展示求解器给出的分配方案、总伤与提升。与旧柱图是并列的独立功能，
 * 不把结果写回柱图输入。
 */

const props = defineProps<{
  result: AffixOptimizerResult | null
  library: AffixLibraryEntry[]
  loading?: boolean
  error?: string | null
  /** 求解进度（仅求解中传入） */
  progress?: AffixOptimizerProgress | null
}>()

/** 阶段名 → 界面文案 */
const PHASE_LABELS: Record<AffixOptimizerProgress['phase'], string> = {
  baseline: '准备基线',
  measure: '测量各词条单档收益',
  greedy: '贪心构造',
  swap1: '一换一优化',
  swap2: '二换二优化',
  done: '已完成',
}

const rows = computed(() =>
  props.result ? buildAllocationRows(props.library, props.result.rollsByEntryId) : [],
)

const maxRolls = computed(() =>
  rows.value.reduce((max, row) => Math.max(max, row.rolls), 0),
)

const progressLabel = computed(() => {
  const progress = props.progress
  if (!progress) return '正在准备…'
  const phase = PHASE_LABELS[progress.phase] ?? progress.phase
  const start = progress.startCount > 1
    ? `（起点 ${progress.startIndex}/${progress.startCount}）`
    : ''
  return `${phase}${start}`
})

/** 预算进度百分比；manual 模式无预算，用「已评估次数」的相对量给个粗略进度 */
const progressPercent = computed(() => {
  const progress = props.progress
  if (!progress) return 0
  if (progress.workBudget == null) return 0
  if (progress.workBudget <= 0) return 100
  return Math.min(100, Math.round((progress.workUsed / progress.workBudget) * 100))
})

function barWidth(rolls: number) {
  if (maxRolls.value <= 0) return '0%'
  return `${(rolls / maxRolls.value) * 100}%`
}

function formatNumber(value: number) {
  return Math.round(value).toLocaleString('en-US')
}
</script>

<template>
  <div class="alloc-result">
    <template v-if="loading">
      <p class="hint">{{ progressLabel }}</p>
      <div v-if="progress && progress.workBudget != null" class="progress-track">
        <div class="progress-fill" :style="{ width: `${progressPercent}%` }" />
      </div>
      <p v-if="progress" class="hint">
        已评估 {{ progress.engineCalls }} 个方案（缓存命中 {{ progress.cacheHits }}）·
        预算用量 {{ progressPercent }}%
        <template v-if="progress.baselineDamage > 0 && progress.bestTotal > progress.baselineDamage">
          · 当前最好 {{ formatNumber(progress.bestTotal) }}
        </template>
      </p>
      <p class="hint">搜索过程中可点「停止」，或直接改上方参数（会自动中止重算）。</p>
    </template>
    <p v-else-if="error" class="err">{{ error }}</p>
    <p v-else-if="!result" class="hint">输入总词条数后点「求最优分配」。</p>
    <template v-else>
      <div class="alloc-summary">
        <div class="summary-item">
          <span class="summary-label">最优总伤</span>
          <strong class="summary-value">{{ formatNumber(result.totalDamage) }}</strong>
        </div>
        <div class="summary-item">
          <span class="summary-label">基线总伤</span>
          <strong class="summary-value">{{ formatNumber(result.baselineDamage) }}</strong>
        </div>
        <div class="summary-item">
          <span class="summary-label">提升</span>
          <strong class="summary-value pos">+{{ result.improvementPercent.toFixed(2) }}%</strong>
        </div>
      </div>

      <div class="budget-row">
        <div class="budget-item">
          <span class="budget-label">总词条数</span>
          <strong class="budget-value">{{ result.usedRolls }} / {{ result.maxTotalRolls }}</strong>
          <span class="budget-hint">每条词条 1 档 = 1 个词条</span>
        </div>
        <div class="budget-item">
          <span class="budget-label">候选宽度</span>
          <strong class="budget-value">
            {{
              result.candidateWidth === result.candidateWidthMax
                ? `${result.candidateWidth} 条`
                : `${result.candidateWidth} ~ ${result.candidateWidthMax} 条`
            }}{{ result.candidateWidthMode === 'manual' ? '（手动）' : '（按预算推导）' }}
          </strong>
          <span class="budget-hint">
            每轮参与试算的条目数；流程越贵、宽度越窄，搜得越快也越可能漏解
          </span>
        </div>
        <div class="budget-item">
          <span class="budget-label">搜索工作量</span>
          <strong class="budget-value">
            {{ result.engineCalls }} 次评估
          </strong>
          <span class="budget-hint">
            缓存命中 {{ result.cacheHits }} 次（不计入预算）·
            计算量 {{ Math.round(result.workUsed) }}<template v-if="result.workBudget != null"> / {{ result.workBudget }}</template>
          </span>
        </div>
      </div>

      <p v-if="result.truncated" class="hint warn">
        搜索达到计算量上限，结果可能不是全局最优。可减少参与词条、调小总词条数，
        或改用「手动指定条数」跑到底。
      </p>

      <div v-if="rows.length" class="table-wrap">
        <table class="alloc-table">
          <thead>
            <tr>
              <th>词条</th>
              <th class="num-head">每档</th>
              <th class="num-head">分配档数</th>
              <th class="num-head">合计数值</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.entry.id">
              <td>{{ row.entry.label }}</td>
              <td class="num-cell">{{ row.entry.perRoll }}</td>
              <td class="num-cell rolls-cell">
                <span class="rolls-bar" :style="{ width: barWidth(row.rolls) }" />
                <span class="rolls-text">{{ row.rolls }}</span>
              </td>
              <td class="num-cell">
                +{{ Number(row.totalValue.toFixed(2)).toLocaleString('en-US') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="hint">当前约束下没有可分配的词条。</p>

      <div class="actions">
        <span class="hint">
          引擎调用 {{ result.engineCalls }} 次 · 起点 {{ result.startsRun }} 个 ·
          走完阶段 {{ result.phasesCompleted.join(' → ') }}
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.alloc-result {
  margin-top: 0.5rem;
  color: var(--calc-text, #1c212a);
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

.alloc-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}

.summary-item {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--calc-border, #d5dae3);
  border-radius: 8px;
  background: var(--calc-surface-2, #f1efe9);
}

.summary-label {
  font-size: 0.72rem;
  color: var(--calc-muted, #6b7280);
}

.summary-value {
  font-size: 1rem;
  color: var(--calc-text, #1c212a);
}

.alloc-result .summary-value.pos {
  color: #1f7a47 !important;
}

.budget-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}

.budget-item {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--calc-border, #d5dae3);
  border-radius: 8px;
  background: var(--calc-surface-2, #f1efe9);
}

.budget-label {
  font-size: 0.72rem;
  color: var(--calc-muted, #6b7280);
}

.budget-value {
  font-size: 0.95rem;
  color: var(--calc-text, #1c212a);
}

.budget-hint {
  font-size: 0.68rem;
  color: var(--calc-muted, #6b7280);
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

.rolls-cell {
  position: relative;
  min-width: 110px;
}

.rolls-bar {
  position: absolute;
  left: 0;
  top: 50%;
  height: 60%;
  transform: translateY(-50%);
  background: rgba(201, 165, 92, 0.28);
  border-radius: 2px;
  pointer-events: none;
}

.rolls-text {
  position: relative;
}

.actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.65rem;
}

.warn {
  color: #8a6d2e;
}

.progress-track {
  position: relative;
  height: 6px;
  margin: 0.35rem 0;
  border-radius: 3px;
  background: var(--calc-border, #d5dae3);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: rgba(201, 165, 92, 0.85);
  transition: width 0.15s ease-out;
}
</style>
