<script setup lang="ts">
import type { ChartRoomBuffPreview } from '@/api/crisisAssault'

defineProps<{
  visible: boolean
  phaseLabel: string
  roomBuff: ChartRoomBuffPreview | null
  positionStyle: Record<string, string>
}>()
</script>

<template>
  <div
    v-if="visible && roomBuff"
    class="chart-room-buff-tooltip"
    :style="positionStyle"
    role="tooltip"
  >
    <div class="tooltip-glass" aria-hidden="true" />
    <div class="tooltip-content">
      <p class="tooltip-phase">{{ phaseLabel }}</p>
      <div class="tooltip-buff-card">
        <div class="tooltip-buff-head">
          <div v-if="roomBuff.imageUrl" class="tooltip-buff-image-wrap">
            <img :src="roomBuff.imageUrl" :alt="roomBuff.name" class="tooltip-buff-image" />
          </div>
          <div class="tooltip-buff-meta">
            <span class="tooltip-buff-room">房间 {{ roomBuff.room }}</span>
            <span class="tooltip-buff-name">{{ roomBuff.name }}</span>
          </div>
        </div>
        <ul class="tooltip-buff-lines">
          <li v-for="(line, index) in roomBuff.lines" :key="index">{{ line }}</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chart-room-buff-tooltip {
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

.tooltip-buff-card {
  padding: 0.28rem 0.32rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

[data-theme='dark'] .tooltip-buff-card {
  background: rgba(255, 255, 255, 0.05);
}

.tooltip-buff-head {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.28rem;
}

.tooltip-buff-image-wrap {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(0, 0, 0, 0.18);
}

.tooltip-buff-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tooltip-buff-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.04rem;
}

.tooltip-buff-room {
  font-size: 0.58rem;
  color: var(--color-text);
  opacity: 0.72;
}

.tooltip-buff-name {
  font-size: 0.66rem;
  font-weight: 700;
  color: var(--color-heading);
  line-height: 1.3;
}

.tooltip-buff-lines {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}

.tooltip-buff-lines li {
  font-size: 0.58rem;
  line-height: 1.35;
  color: var(--color-text);
  opacity: 0.88;
}
</style>
