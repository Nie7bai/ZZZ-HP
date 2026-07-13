<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import DefenseDetailPanel from '@/components/defense/DefenseDetailPanel.vue'
import HistoryDetailPanel from '@/components/history/HistoryDetailPanel.vue'
import type { HpChartPoint } from '@/api/crisisAssault'
import { modeTitles, type ModeKey } from '@/types/history'

const props = defineProps<{
  visible: boolean
  point: HpChartPoint | null
  mode: ModeKey
}>()

const emit = defineEmits<{
  close: []
}>()

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

watch(
  () => props.visible,
  (isVisible) => {
    document.body.style.overflow = isVisible ? 'hidden' : ''
  },
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="#mode-content-portal">
    <div v-if="visible && point" class="phase-detail-overlay" @click="emit('close')">
      <div
        class="phase-detail-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="`${point.label} 往期详细`"
        @click.stop="emit('close')"
      >
        <button type="button" class="phase-detail-dismiss-full" aria-label="关闭弹窗" />
        <div class="phase-detail-content">
          <span class="phase-detail-close-hint" aria-hidden="true">×</span>
          <header class="phase-detail-header">
            <h2 class="phase-detail-title">{{ modeTitles[mode] }} · {{ point.label }}</h2>
            <p class="phase-detail-subtitle">往期详细 · 点击任意区域关闭</p>
          </header>
          <div class="phase-detail-body">
            <DefenseDetailPanel
              v-if="mode === 'defense'"
              embedded
              :chart-point="point"
            />
            <HistoryDetailPanel
              v-else
              :mode="mode"
              embedded
              :chart-point="point"
            />
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.phase-detail-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.75rem;
  background: rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  overflow: hidden;
  cursor: pointer;
}

.phase-detail-modal {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(1680px, 100%);
  height: min(calc(100% - 1rem), 1040px);
  max-height: 96%;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-background);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  cursor: pointer;
}

.phase-detail-dismiss-full {
  position: absolute;
  inset: 0;
  z-index: 2;
  border: none;
  padding: 0;
  margin: 0;
  background: transparent;
  cursor: pointer;
}

.phase-detail-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  pointer-events: none;
}

.phase-detail-close-hint {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  z-index: 0;
  font-size: 1.55rem;
  line-height: 1;
  color: var(--color-heading);
  opacity: 0.85;
  pointer-events: none;
}

.phase-detail-header {
  flex-shrink: 0;
  padding: 0.85rem 3rem 0.65rem;
  border-bottom: 1px solid var(--color-border);
  text-align: center;
}

.phase-detail-title {
  margin: 0;
  font-size: clamp(1.15rem, 2.5vw, 1.45rem);
  font-weight: 700;
  color: var(--color-heading);
}

.phase-detail-subtitle {
  margin: 0.35rem 0 0;
  font-size: 0.82rem;
  color: var(--color-text);
  opacity: 0.65;
}

.phase-detail-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.phase-detail-body > :deep(*) {
  flex: 1;
  min-height: 0;
}
</style>
