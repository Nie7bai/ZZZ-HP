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
        <div class="phase-detail-content">
          <button type="button" class="phase-detail-close-btn" aria-label="关闭弹窗" @click.stop="emit('close')">
            ×
          </button>
          <header class="phase-detail-header">
            <h2 class="phase-detail-title">{{ modeTitles[mode] }} · {{ point.label }}</h2>
            <p class="phase-detail-subtitle">往期详细 · 点击空白处关闭</p>
          </header>
          <div class="phase-detail-body" @click.stop>
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
  position: fixed;
  inset: 0;
  z-index: 1300;
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
  cursor: default;
}

.phase-detail-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.phase-detail-close-btn {
  position: absolute;
  top: 0.55rem;
  right: 0.55rem;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-heading);
  font-size: 1.45rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0.75;
}

.phase-detail-close-btn:hover {
  opacity: 1;
  background: var(--color-background-mute);
}

.phase-detail-header {
  flex-shrink: 0;
  padding: 0.85rem 3rem 0.65rem;
  border-bottom: 1px solid var(--color-border);
  text-align: center;
  cursor: pointer;
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
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  cursor: default;
}

.phase-detail-body > :deep(*) {
  flex: none;
  height: auto;
  min-height: 100%;
}

@media (max-width: 768px) {
  .phase-detail-overlay {
    padding: 0;
    align-items: stretch;
    justify-content: stretch;
  }

  .phase-detail-modal {
    width: 100%;
    height: 100%;
    max-height: 100%;
    border-radius: 0;
    border-left: none;
    border-right: none;
  }

  .phase-detail-body {
    /* iOS：保证正文区能滚到底 */
    flex: 1 1 auto;
    min-height: 0;
  }

  .phase-detail-close-btn {
    top: 0.4rem;
    right: 0.4rem;
    width: 2.5rem;
    height: 2.5rem;
  }

  .phase-detail-header {
    padding: 0.65rem 2.6rem 0.5rem 0.75rem;
    text-align: left;
  }

  .phase-detail-title {
    font-size: 1rem;
    line-height: 1.3;
  }

  .phase-detail-subtitle {
    margin-top: 0.2rem;
    font-size: 0.7rem;
  }

  .phase-detail-body > :deep(*) {
    min-height: auto;
  }
}
</style>
