<script setup lang="ts">
import { computed } from 'vue'
import { buildAllocationRows } from '@/utils/affixOptimizer'
import type { AffixOptimizerResult } from '@/utils/affixOptimizer'
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
}>()

const rows = computed(() =>
  props.result ? buildAllocationRows(props.library, props.result.rollsByEntryId) : [],
)

const maxRolls = computed(() =>
  rows.value.reduce((max, row) => Math.max(max, row.rolls), 0),
)

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
    <p v-if="loading" class="hint">正在搜索最优分配…（会调用伤害引擎数百次）</p>
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
      </div>

      <p v-if="result.truncated" class="hint warn">
        搜索达到调用上限，结果可能不是全局最优。可减少参与词条后重试。
      </p>

      <div v-if="rows.length" class="table-wrap">
        <table class="alloc-table">
          <thead>
            <tr>
              <th>词条</th>
              <th>每档</th>
              <th>分配档数</th>
              <th>合计数值</th>
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
        <span class="hint">引擎调用 {{ result.engineCalls }} 次</span>
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
</style>
