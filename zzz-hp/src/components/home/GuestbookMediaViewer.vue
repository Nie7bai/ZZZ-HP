<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { resolveAssetUrl } from '@/utils/gameData'
import { addCustomSticker, hasCustomSticker } from '@/utils/guestbookCustomStickers'
import GuestbookComposerIcons from '@/components/home/GuestbookComposerIcons.vue'

const props = defineProps<{
  open: boolean
  urls: string[]
  index?: number
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:index': [value: number]
  favorited: [url: string]
}>()

const scale = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const dragging = ref(false)
const dragStart = ref({ x: 0, y: 0, ox: 0, oy: 0 })
const localIndex = ref(0)
const favHint = ref('')
let favHintTimer: ReturnType<typeof setTimeout> | null = null

const currentRaw = computed(() => props.urls[localIndex.value] || '')
const currentUrl = computed(() => resolveAssetUrl(currentRaw.value) || currentRaw.value)
const isFavorite = computed(() => hasCustomSticker(currentRaw.value))
const counterLabel = computed(() =>
  props.urls.length > 1 ? `${localIndex.value + 1}/${props.urls.length}` : '',
)

watch(
  () => props.index,
  (value) => {
    if (value == null) return
    localIndex.value = value
  },
  { immediate: true },
)

watch(
  () => props.open,
  (open) => {
    if (open) resetTransform()
  },
)

function resetTransform() {
  scale.value = 1
  offsetX.value = 0
  offsetY.value = 0
}

function close() {
  emit('update:open', false)
}

function zoom(delta: number) {
  scale.value = Math.min(5, Math.max(0.2, Number((scale.value + delta).toFixed(2))))
}

function onWheel(event: WheelEvent) {
  event.preventDefault()
  zoom(event.deltaY < 0 ? 0.12 : -0.12)
}

function onPointerDown(event: PointerEvent) {
  if ((event.target as HTMLElement).closest('.ik-media-viewer__toolbar')) return
  dragging.value = true
  dragStart.value = {
    x: event.clientX,
    y: event.clientY,
    ox: offsetX.value,
    oy: offsetY.value,
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return
  // 未缩放时不平移，留给 pointerup 做左右滑切换
  if (scale.value === 1) return
  offsetX.value = dragStart.value.ox + event.clientX - dragStart.value.x
  offsetY.value = dragStart.value.oy + event.clientY - dragStart.value.y
}

function onPointerUp(event: PointerEvent) {
  if (dragging.value && scale.value === 1) {
    const dx = event.clientX - dragStart.value.x
    const dy = event.clientY - dragStart.value.y
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) next()
      else prev()
    }
  }
  dragging.value = false
  try {
    ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
  } catch {
    /* ignore */
  }
}

function prev() {
  if (localIndex.value <= 0) return
  localIndex.value -= 1
  emit('update:index', localIndex.value)
  resetTransform()
}

function next() {
  if (localIndex.value >= props.urls.length - 1) return
  localIndex.value += 1
  emit('update:index', localIndex.value)
  resetTransform()
}

function downloadImage() {
  const url = currentUrl.value
  if (!url) return
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `guestbook-${Date.now()}.jpg`
  anchor.target = '_blank'
  anchor.rel = 'noopener'
  anchor.click()
}

function showFavHint(message: string) {
  favHint.value = message
  if (favHintTimer) clearTimeout(favHintTimer)
  favHintTimer = setTimeout(() => {
    favHint.value = ''
    favHintTimer = null
  }, 2000)
}

function toggleFavorite() {
  const raw = currentRaw.value
  if (!raw) return
  if (hasCustomSticker(raw)) {
    showFavHint('已在收藏表情中')
    return
  }
  addCustomSticker(raw)
  emit('favorited', raw)
  showFavHint('已添加收藏表情')
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape') close()
  if (event.key === 'ArrowLeft') prev()
  if (event.key === 'ArrowRight') next()
  if (event.key === '+' || event.key === '=') zoom(0.15)
  if (event.key === '-') zoom(-0.15)
}

watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener('keydown', onKeydown)
    else window.removeEventListener('keydown', onKeydown)
  },
)

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (favHintTimer) clearTimeout(favHintTimer)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ik-media-viewer" @click.self="close">
      <div class="ik-media-viewer__stage" @wheel="onWheel">
        <span v-if="counterLabel" class="ik-media-viewer__counter">{{ counterLabel }}</span>

        <div class="ik-media-viewer__toolbar">
          <button type="button" class="ik-media-viewer__tool" title="缩小" @click="zoom(-0.2)">−</button>
          <button type="button" class="ik-media-viewer__tool" title="放大" @click="zoom(0.2)">＋</button>
          <button type="button" class="ik-media-viewer__tool" title="重置" @click="resetTransform">⟲</button>
          <button
            type="button"
            class="ik-media-viewer__tool"
            :class="{ 'is-active': isFavorite }"
            title="收藏表情"
            @click="toggleFavorite"
          >
            <GuestbookComposerIcons kind="heart" />
          </button>
          <button type="button" class="ik-media-viewer__tool" title="下载" @click="downloadImage">↓</button>
          <button type="button" class="ik-media-viewer__tool ik-media-viewer__tool--close" title="关闭" @click="close">
            ×
          </button>
        </div>

        <p v-if="favHint" class="ik-media-viewer__hint">{{ favHint }}</p>

        <button
          v-if="urls.length > 1"
          type="button"
          class="ik-media-viewer__nav ik-media-viewer__nav--prev"
          :disabled="localIndex <= 0"
          aria-label="上一张"
          @click.stop="prev"
        >
          ‹
        </button>

        <div
          class="ik-media-viewer__canvas"
          :class="{ 'is-dragging': dragging }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <img
            :src="currentUrl"
            alt=""
            draggable="false"
            :style="{
              transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
            }"
          />
        </div>

        <button
          v-if="urls.length > 1"
          type="button"
          class="ik-media-viewer__nav ik-media-viewer__nav--next"
          :disabled="localIndex >= urls.length - 1"
          aria-label="下一张"
          @click.stop="next"
        >
          ›
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ik-media-viewer {
  position: fixed;
  inset: 0;
  z-index: 12000;
  background: rgba(0, 0, 0, 0.88);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ik-media-viewer__stage {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.ik-media-viewer__counter {
  position: absolute;
  top: 18px;
  left: 18px;
  z-index: 3;
  color: rgba(255, 255, 255, 0.82);
  font-size: 14px;
  font-weight: 700;
}

.ik-media-viewer__toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.45);
}

.ik-media-viewer__tool {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.ik-media-viewer__tool:hover {
  background: rgba(255, 255, 255, 0.1);
}

.ik-media-viewer__tool.is-active {
  color: #fbfe00;
}

.ik-media-viewer__tool--close {
  font-size: 24px;
}

.ik-media-viewer__hint {
  position: absolute;
  top: 58px;
  right: 18px;
  z-index: 3;
  margin: 0;
  color: #bfff09;
  font-size: 12px;
}

.ik-media-viewer__canvas {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  touch-action: none;
}

.ik-media-viewer__canvas.is-dragging {
  cursor: grabbing;
}

.ik-media-viewer__canvas img {
  max-width: min(92vw, 1200px);
  max-height: 88vh;
  object-fit: contain;
  user-select: none;
  will-change: transform;
}

.ik-media-viewer__nav {
  position: absolute;
  top: 50%;
  z-index: 3;
  transform: translateY(-50%);
  width: 48px;
  height: 72px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 36px;
  line-height: 1;
  cursor: pointer;
  transition:
    background 0.15s ease,
    opacity 0.15s ease;
}

.ik-media-viewer__nav:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.72);
}

.ik-media-viewer__nav:disabled {
  opacity: 0.28;
  cursor: default;
}

.ik-media-viewer__nav--prev {
  left: 16px;
}

.ik-media-viewer__nav--next {
  right: 16px;
}
</style>
