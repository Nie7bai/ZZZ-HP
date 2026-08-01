<script setup lang="ts">
export interface ChartSeriesTooltipRow {
  label: string
  value: string
  color?: string
  /** 用于小窗按数值从高到低排序 */
  numericValue?: number
}

defineProps<{
  visible: boolean
  phaseLabel: string
  chartTitle: string
  rows: ChartSeriesTooltipRow[]
  positionStyle: Record<string, string>
}>()
</script>

<template>
  <div
    v-if="visible && rows.length"
    class="chart-series-tooltip"
    :style="positionStyle"
    role="tooltip"
  >
    <div class="tooltip-glass" aria-hidden="true" />
    <div class="tooltip-content">
      <p class="tooltip-phase">{{ phaseLabel }}</p>
      <p class="tooltip-chart">{{ chartTitle }}</p>
      <ul class="tooltip-rows">
        <li v-for="(row, index) in rows" :key="`${row.label}-${index}`" class="tooltip-row">
          <i class="tooltip-swatch" :style="{ background: row.color || '#e85d4c' }" />
          <span class="tooltip-label">{{ row.label }}</span>
          <strong class="tooltip-value" :style="{ color: row.color || '#e85d4c' }">{{ row.value }}</strong>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.chart-series-tooltip {
  position: fixed;
  z-index: 1200;
  width: min(220px, calc(100vw - 16px));
  border-radius: 9px;
  overflow: hidden;
  pointer-events: none;
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.24);
}

.tooltip-glass {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
}

[data-theme='dark'] .tooltip-glass {
  background: rgba(12, 16, 26, 0.78);
}

.tooltip-content {
  position: relative;
  z-index: 1;
  padding: 0.45rem 0.52rem 0.52rem;
  background: rgba(255, 255, 255, 0.35);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

[data-theme='dark'] .tooltip-content {
  background: rgba(0, 0, 0, 0.18);
}

.tooltip-phase {
  margin: 0;
  text-align: center;
  font-size: 0.68rem;
  font-weight: 700;
  color: #e8a838;
  letter-spacing: 0.02em;
}

.tooltip-chart {
  margin: 0.15rem 0 0.35rem;
  text-align: center;
  font-size: 0.62rem;
  color: var(--color-text);
  opacity: 0.78;
}

.tooltip-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
}

.tooltip-row {
  display: grid;
  grid-template-columns: 0.55rem 1fr auto;
  align-items: center;
  gap: 0.35rem;
  padding: 0.28rem 0.34rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.35);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

[data-theme='dark'] .tooltip-row {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
}

.tooltip-swatch {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 999px;
}

.tooltip-label {
  min-width: 0;
  font-size: 0.62rem;
  color: var(--color-heading);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tooltip-value {
  font-size: 0.64rem;
  font-weight: 700;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}

[data-theme='dark'] .tooltip-value {
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
}
</style>
