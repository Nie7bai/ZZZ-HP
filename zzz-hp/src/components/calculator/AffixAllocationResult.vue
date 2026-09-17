<script setup lang="ts">
import { computed } from 'vue'
import { buildAllocationRows } from '@/utils/affixOptimizer'
import type { AffixOptimizerProgress, AffixOptimizerResult } from '@/utils/affixOptimizer'
import type { AffixLibraryEntry } from '@/utils/affixLibrary'
import { formatAffixPerRoll } from '@/utils/affixLibrary'

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
  /** 上一次完成的结果已过期（中止或条件已变） */
  stale?: boolean
  /** 最近一次求解的实际耗时（毫秒）：从点下按钮到返回，含门槛测量 / 专路 / Beam / 换档；中止或没跑过为 null */
  elapsedMs?: number | null
  /** 求解中的实时耗时（毫秒，由外层每 200ms 推一次）；没在跑为 null */
  liveMs?: number | null
}>()

/** 阶段名 → 界面文案 */
const PHASE_LABELS: Record<AffixOptimizerProgress['phase'], string> = {
  baseline: '准备基线',
  measure: '测量各词条单档收益',
  beam: '多路线搜索（Beam）',
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
  const path = progress.searchPath === 'penRate' ? '穿透专路 · ' : ''
  const branch = progress.gameBranch
    ? `组合 ${progress.gameBranch.index}/${progress.gameBranch.total}（${progress.gameBranch.label}）· `
    : ''
  const layer = progress.layerUsedRolls != null ? `第 ${progress.layerUsedRolls} 档层 · ` : ''
  const routes = progress.survivedRoutes != null ? `存活 ${progress.survivedRoutes} 条 · ` : ''
  const b = progress.adaptiveB != null ? `本层 B=${progress.adaptiveB} · ` : ''
  return `${branch}${path}${layer}${routes}${b}${phase}`
})

/**
 * 游戏专用结果里的「胜出口袋 + 各袋合计」。
 * 普通「求最优分配」没有这段，返回 null。
 */
const gameInfo = computed(() => {
  const result = props.result as
    | (AffixOptimizerResult & {
      gameWinner?: { index: number; total: number; label: string }
      gameTotals?: { workUsed: number; engineCalls: number; cacheHits: number; pockets: number }
    })
    | null
  if (!result?.gameWinner || !result.gameTotals) return null
  return { winner: result.gameWinner, totals: result.gameTotals }
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

/** 耗时显示：10 秒以内保留一位小数，超过给整秒 */
function formatDuration(ms: number) {
  const seconds = Math.max(0, ms) / 1000
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`
}
</script>

<template>
  <div class="alloc-result">
    <template v-if="loading">
      <p class="hint">
        {{ progressLabel }}
        <template v-if="liveMs != null"> · 已用 {{ formatDuration(liveMs) }}</template>
      </p>
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
    <p v-else-if="!result" class="hint">输入总词条数后点「求最优分配」或「游戏专用规则分配」。</p>
    <template v-else>
      <p v-if="stale" class="hint warn">
        此结果已过期：求解已中止，或词条数 / 队伍 / 招式等条件已变。请重新点「求最优分配」或「游戏专用规则分配」。
      </p>
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
          <span class="budget-label">多路线搜索</span>
          <strong class="budget-value">存活 {{ result.survivedRoutes }} 条</strong>
          <span class="budget-hint">
            预算层 {{ result.beamLayers }} 层 · 自适应 B {{ result.adaptiveBMin }}~{{ result.adaptiveBMax }}
            （上限 {{ result.searchParams.maxRetainedRoutes }}）· 换档 {{ result.refinedRoutes }} 条 ·
            门槛 {{ Math.round(result.searchParams.initialCandidateThreshold * 1000) / 10 }}%（淘汰 {{ result.initialDropped }} 条）·
            层内比例 {{ Math.round(result.searchParams.routeRetentionRatio * 100) }}%（淘汰 {{ result.layerRatioDropped }} 条）
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

      <p v-if="gameInfo" class="hint">
        胜出口袋：组合 {{ gameInfo.winner.index }}/{{ gameInfo.winner.total }}（{{ gameInfo.winner.label }}）·
        各袋合计 {{ formatNumber(gameInfo.totals.workUsed) }} 计算量 / {{ gameInfo.totals.engineCalls }} 次评估
        （缓存命中 {{ gameInfo.totals.cacheHits }}）· 共 {{ gameInfo.totals.pockets }} 袋
      </p>

      <p v-if="result.truncated" class="hint warn">
        搜索达到计算量上限，结果可能不是全局最优。可减少参与词条、调小总词条数，
        或改用更快的搜索预设。
      </p>

      <p v-else-if="result.refineSkipped" class="hint">
        多路线搜索已完整跑完；候选太多，跳过了最后的 1/2 档换档微调（降低「最大保留路线」可开启）。
      </p>

      <div v-if="rows.length" class="table-wrap">
        <table class="alloc-table">
          <thead>
            <tr>
              <th class="group-head">组</th>
              <th>词条</th>
              <th class="num-head">每档</th>
              <th class="num-head">分配档数</th>
              <th class="num-head">合计数值</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.entry.id">
              <td class="group-cell">{{ row.entry.group || '—' }}</td>
              <td>{{ row.entry.label }}</td>
              <td class="num-cell">{{ formatAffixPerRoll(row.entry.target, row.entry.perRoll) }}</td>
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
          引擎调用 {{ result.engineCalls }} 次 · 扩展 {{ result.expandedRoutes }} 条路线 · 淘汰 {{ result.prunedRoutes }} 条 ·
          {{ result.winningPath === 'penRate' ? '穿透专路胜出' : '普通路线胜出' }}
          <template v-if="result.penRatePathUsed"> · 已跑穿透专路</template>
          · 走完阶段 {{ result.phasesCompleted.join(' → ') }}
          <template v-if="elapsedMs != null"> · 耗时 {{ formatDuration(elapsedMs) }}</template>
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

/**
 * 「组」列（2026-09-16 加）：同一字段可能同时落在 5 号位与 6 号位两组（标签一样），
 * 只靠词条名分不清；组名让两行可辨。数据本来按条目 id 记，这里纯显示。
 */
.group-head,
.group-cell {
  white-space: nowrap;
  color: var(--calc-muted, #6b7280);
  font-size: 0.92em;
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

/*
 * ── 暗色主题（与 `AffixBenefitTable.vue` 同一处问题、同一套修法）──
 *
 * 颜色写成 `var(--calc-*, 浅色兜底)`，而 `--calc-*` 只在白天主题下定义 ——
 * 暗色下取不到变量，全部落到浅色兜底：表头米白、表体近黑字（黑底黑字）。
 * 这里按同一个模式在根元素上重定义变量，并覆盖少量硬编码色；
 * 前缀带 `[data-theme='dark']`，白天一个像素不动。
 */
[data-theme='dark'] .alloc-result {
  --calc-surface-2: rgba(0, 0, 0, 0.25);
  --calc-border: #2a2f37;
  --calc-text: #e8eaed;
  --calc-muted: #9aa3b0;
}

/* 提升幅度（.pos）与提示色：浅色的深绿 / 深金在暗底上发闷 */
[data-theme='dark'] .alloc-result .summary-value.pos {
  color: #7dd3a0 !important;
}

[data-theme='dark'] .alloc-result .warn {
  color: #e0c27a;
}

[data-theme='dark'] .alloc-result .err {
  color: #f07178;
}
</style>
