<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  CRISIS_SCORE_MAX,
  formatPercent,
  formatScorePerHp,
  getCrisisScoreTable,
  type CrisisScoreHpRow,
  type CrisisScoreTableMode,
} from '@/data/crisisScoreHpTable'

const tableMode = ref<CrisisScoreTableMode>('normal')

const rows = computed(() => getCrisisScoreTable(tableMode.value))

const panelDesc = computed(() =>
  tableMode.value === 'hard'
    ? `满分 ${CRISIS_SCORE_MAX.toLocaleString('zh-CN')} 分（困难）；第6管标为「6/节点」（0.5万）；另有 1.5万 / 2.5万 节点；节点已得分数已高亮`
    : `满分 ${CRISIS_SCORE_MAX.toLocaleString('zh-CN')} 分（正常）；「节点」为阶段分数节点；2万节点对应满星 S（FS-HP）；节点已得分数已高亮`,
)

function barLabel(row: CrisisScoreHpRow): string {
  if (row.isMilestone && row.bar != null) return `${row.bar}/节点`
  if (row.isMilestone || row.bar == null) return '节点'
  return String(row.bar)
}
</script>

<template>
  <div class="score-hp-panel">
    <header class="panel-header">
      <h1 class="page-title">危局强袭战 · 分数与血量对应表</h1>
      <p class="panel-desc">{{ panelDesc }}</p>
      <div class="mode-toggle" role="group" aria-label="对应表模式">
        <button
          type="button"
          class="mode-btn"
          :class="{ active: tableMode === 'normal' }"
          @click="tableMode = 'normal'"
        >
          正常
        </button>
        <button
          type="button"
          class="mode-btn"
          :class="{ active: tableMode === 'hard' }"
          @click="tableMode = 'hard'"
        >
          困难
        </button>
      </div>
    </header>

    <div class="table-scroll">
      <table class="score-table">
        <thead>
          <tr>
            <th>第几管血</th>
            <th>分数</th>
            <th>分数占比</th>
            <th>血量占比</th>
            <th>分数/血量</th>
            <th>已得分数</th>
            <th>已打血量</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in rows"
            :key="`${tableMode}-${row.bar ?? 'm'}-${row.cumulativeScore}-${index}`"
            :class="{ 'is-milestone': row.isMilestone }"
          >
            <td>{{ barLabel(row) }}</td>
            <td>{{ row.score.toLocaleString('zh-CN') }}</td>
            <td>{{ formatPercent(row.scoreRatio) }}</td>
            <td>{{ formatPercent(row.hpRatio) }}</td>
            <td>{{ formatScorePerHp(row.scorePerHp) }}</td>
            <td :class="{ 'is-node-score': row.isMilestone }">
              {{ row.cumulativeScore.toLocaleString('zh-CN') }}
            </td>
            <td>{{ formatPercent(row.cumulativeHp) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.score-hp-panel {
  width: 100%;
  max-width: 1100px;
  margin: 0 auto;
  padding: 0.5rem 0.35rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  box-sizing: border-box;
}

.panel-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  text-align: center;
}

.page-title {
  font-size: clamp(1.15rem, 2.6vw, 1.7rem);
  font-weight: 700;
  color: var(--color-heading);
  letter-spacing: 0.03em;
}

.panel-desc {
  font-size: 0.82rem;
  color: var(--color-text);
  opacity: 0.72;
  line-height: 1.45;
  max-width: 44rem;
}

.mode-toggle {
  display: inline-flex;
  padding: 0.15rem;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background);
}

.mode-btn {
  min-width: 4.5rem;
  padding: 0.35rem 0.85rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}

.mode-btn:hover {
  background: var(--color-background-mute);
}

.mode-btn.active {
  background: var(--color-background-soft);
  color: var(--color-heading);
  box-shadow: inset 0 0 0 1px var(--color-border);
}

.table-scroll {
  width: 100%;
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
}

.score-table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.score-table th,
.score-table td {
  padding: 0.55rem 0.7rem;
  text-align: center;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
  white-space: nowrap;
}

.score-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: color-mix(in srgb, var(--color-background-mute) 88%, var(--color-background));
  color: var(--color-heading);
  font-weight: 700;
  font-size: 0.8rem;
}

.score-table tbody tr:hover {
  background: color-mix(in srgb, var(--color-background-mute) 55%, transparent);
}

.score-table tbody tr.is-milestone {
  background: color-mix(in srgb, #e8a838 12%, transparent);
  font-weight: 600;
}

.score-table tbody tr.is-milestone td:first-child {
  color: #c98920;
}

.score-table td.is-node-score {
  color: #c98920;
  font-weight: 800;
  background: color-mix(in srgb, #e8a838 16%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, #e8a838 40%, transparent);
}

@media (max-width: 768px) {
  .score-hp-panel {
    padding: 0.25rem 0.1rem 0.9rem;
  }

  .score-table {
    font-size: 0.8rem;
  }

  .score-table th,
  .score-table td {
    padding: 0.45rem 0.5rem;
  }
}
</style>
