<script setup lang="ts">
import type { ChartBossPreview } from '@/api/crisisAssault'

defineProps<{
  visible: boolean
  phaseLabel: string
  bosses: ChartBossPreview[]
  positionStyle: Record<string, string>
}>()
</script>

<template>
  <div
    v-if="visible && bosses.length"
    class="chart-boss-tooltip"
    :style="positionStyle"
    role="tooltip"
  >
    <div class="tooltip-glass" aria-hidden="true" />
    <div class="tooltip-content">
      <p class="tooltip-phase">{{ phaseLabel }}</p>
      <ul class="tooltip-boss-list">
        <li v-for="(boss, index) in bosses" :key="`${boss.room}-${index}`" class="tooltip-boss-item">
          <div class="tooltip-boss-image-wrap">
            <img
              v-if="boss.imageUrl"
              :src="boss.imageUrl"
              :alt="boss.bossName"
              class="tooltip-boss-image"
            />
            <span v-else class="tooltip-boss-placeholder">?</span>
          </div>
          <div class="tooltip-boss-meta">
            <span class="tooltip-boss-room">
              {{ boss.room === '困难' ? '困难' : `房间 ${boss.room}` }}
            </span>
            <span class="tooltip-boss-name">{{ boss.bossName }}</span>
            <span class="tooltip-boss-hp">{{ boss.hp }}</span>
            <span v-if="boss.hpConverted953" class="tooltip-boss-hp-converted">
              953：{{ boss.hpConverted953 }}
            </span>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.chart-boss-tooltip {
  position: fixed;
  z-index: 1200;
  width: min(188px, calc(100vw - 16px));
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
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(18px) saturate(170%);
  -webkit-backdrop-filter: blur(18px) saturate(170%);
}

[data-theme='dark'] .tooltip-glass {
  background: rgba(18, 22, 32, 0.42);
}

.tooltip-content {
  position: relative;
  z-index: 1;
  padding: 0.38rem 0.45rem 0.45rem;
}

.tooltip-phase {
  margin: 0 0 0.3rem;
  text-align: center;
  font-size: 0.68rem;
  font-weight: 700;
  color: #e8a838;
  letter-spacing: 0.02em;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}

.tooltip-boss-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
}

.tooltip-boss-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.22rem 0.28rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

[data-theme='dark'] .tooltip-boss-item {
  background: rgba(255, 255, 255, 0.05);
}

.tooltip-boss-image-wrap {
  flex-shrink: 0;
  width: 32px;
  height: 40px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(0, 0, 0, 0.18);
}

.tooltip-boss-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(1.5px) saturate(0.75);
  transform: scale(1.08);
  opacity: 0.88;
}

.tooltip-boss-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 0.82rem;
  opacity: 0.45;
  color: var(--color-heading);
}

.tooltip-boss-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.04rem;
}

.tooltip-boss-room {
  font-size: 0.58rem;
  color: var(--color-text);
  opacity: 0.72;
}

.tooltip-boss-name {
  font-size: 0.64rem;
  font-weight: 700;
  color: var(--color-heading);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tooltip-boss-hp {
  font-size: 0.62rem;
  font-weight: 600;
  color: #e85d4c;
}

.tooltip-boss-hp-converted {
  font-size: 0.58rem;
  font-weight: 600;
  color: #4c8fe8;
}
</style>
