<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'
import type { StatSourceGroup } from '@/utils/statSourceTips'

defineProps<{
  value: string | number
  groups: StatSourceGroup[]
}>()

const triggerRef = ref<HTMLElement | null>(null)
const tipVisible = ref(false)
const tipStyle = ref<Record<string, string>>({})

function getTipWidth() {
  if (window.innerWidth <= 768) {
    return Math.min(360, window.innerWidth - 24)
  }
  return Math.min(560, Math.max(320, window.innerWidth * 0.88))
}

async function updateTipPosition() {
  const el = triggerRef.value
  if (!el) return
  await nextTick()

  const rect = el.getBoundingClientRect()
  const tipWidth = getTipWidth()
  const margin = 12
  const sidebarReserve = window.innerWidth <= 768 ? margin : 232

  let left = rect.left + rect.width / 2 - tipWidth / 2
  left = Math.max(left, sidebarReserve, margin)
  left = Math.min(left, window.innerWidth - tipWidth - margin)

  const top = Math.max(margin, rect.top - 8)

  tipStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    width: `${tipWidth}px`,
    transform: 'translateY(-100%)',
  }
}

function onShow() {
  tipVisible.value = true
  updateTipPosition()
}

function onHide() {
  tipVisible.value = false
}

function onToggle() {
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
  if (tipVisible.value) onHide()
  else onShow()
}

function onDocumentPointerDown(event: Event) {
  if (!tipVisible.value) return
  const target = event.target
  if (!(target instanceof Node)) return
  if (triggerRef.value?.contains(target)) return
  onHide()
}

function onScrollOrResize() {
  if (!tipVisible.value) return
  updateTipPosition()
}

if (typeof window !== 'undefined') {
  window.addEventListener('scroll', onScrollOrResize, true)
  window.addEventListener('resize', onScrollOrResize)
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
}

onBeforeUnmount(() => {
  if (typeof window === 'undefined') return
  window.removeEventListener('scroll', onScrollOrResize, true)
  window.removeEventListener('resize', onScrollOrResize)
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
})
</script>

<template>
  <span
    ref="triggerRef"
    class="stat-value"
    tabindex="0"
    @mouseenter="onShow"
    @mouseleave="onHide"
    @focus="onShow"
    @blur="onHide"
    @click="onToggle"
  >
    <strong>{{ value }}</strong>
    <Teleport to="body">
      <div
        v-if="tipVisible && groups.length"
        class="stat-value-tip"
        :style="tipStyle"
        role="tooltip"
      >
        <p class="tip-title">数值组成</p>
        <div class="tip-groups">
          <article
            v-for="(group, index) in groups"
            :key="`${group.label}-${index}`"
            class="tip-group"
            :class="{ 'tip-group--full': group.fullWidth }"
          >
            <p class="tip-label">{{ group.label }}</p>
            <ul class="tip-items" :class="{ 'tip-items--process': group.fullWidth }">
              <li v-for="item in group.items" :key="item">{{ item }}</li>
            </ul>
          </article>
        </div>
      </div>
      <div
        v-else-if="tipVisible"
        class="stat-value-tip tip-empty"
        :style="tipStyle"
        role="tooltip"
      >
        暂无组成明细
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.stat-value {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: help;
}

.stat-value > strong {
  border-bottom: 1px dotted color-mix(in srgb, #e8d4a8 70%, transparent);
}
</style>

<style>
.stat-value-tip {
  position: fixed;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  min-width: 320px;
  padding: 0.75rem 0.85rem;
  border: 1px solid #3a414c;
  border-radius: 8px;
  background: #151920;
  color: #d5dae4;
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.45;
  white-space: normal;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
  pointer-events: none;
  overflow: visible;
}

.stat-value-tip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  border: 6px solid transparent;
  border-top-color: #3a414c;
  transform: translateX(-50%);
}

.stat-value-tip .tip-title {
  margin: 0;
  font-size: 0.8rem;
  color: #d5dae4;
  font-weight: 600;
}

.stat-value-tip .tip-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem 1rem;
}

.stat-value-tip .tip-group {
  min-width: 0;
}

.stat-value-tip .tip-group--full {
  grid-column: 1 / -1;
}

.stat-value-tip .tip-items--process li:last-child {
  margin-top: 0.15rem;
  padding-top: 0.25rem;
  border-top: 1px solid #2d323a;
  color: #e8d4a8;
  font-weight: 600;
}

.stat-value-tip .tip-label {
  margin: 0 0 0.3rem;
  font-size: 0.76rem;
  color: #c9a55c;
}

.stat-value-tip .tip-items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.2rem;
}

.stat-value-tip .tip-items li {
  color: #b7c0cd;
  word-break: break-word;
}

.stat-value-tip.tip-empty {
  color: #7a828f;
  min-width: 180px;
  width: auto;
}

@media (max-width: 768px) {
  .stat-value-tip {
    min-width: 0;
  }

  .stat-value-tip .tip-groups {
    grid-template-columns: 1fr;
  }
}
</style>
