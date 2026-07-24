<script setup lang="ts">
defineProps<{
  open: boolean
  size?: 'knock' | 'post' | 'wide'
  zIndex?: number
}>()

const emit = defineEmits<{
  close: []
}>()

function onBackdropClick(event: MouseEvent) {
  if (event.target === event.currentTarget) emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ik-overlay">
      <div
        v-if="open"
        class="ik-overlay"
        :style="zIndex ? { zIndex: String(zIndex) } : undefined"
        @click="onBackdropClick"
      >
        <div class="ik-overlay__stripe" aria-hidden="true" />
        <div
          class="ik-dialog"
          :class="{
            'ik-dialog--knock': size === 'knock',
            'ik-dialog--post': size === 'post' || !size,
            'ik-dialog--wide': size === 'wide',
          }"
          role="dialog"
          aria-modal="true"
          @click.stop
        >
          <div class="ik-dialog__outer">
            <div class="ik-dialog__inner">
              <header v-if="$slots.header" class="ik-dialog__header">
                <slot name="header" />
                <button type="button" class="ik-dialog__close" aria-label="关闭" @click="emit('close')">
                  <img
                    src="/images/close-btn.webp"
                    alt="关闭"
                    class="ik-dialog__close-img"
                    draggable="false"
                  />
                </button>
              </header>
              <div class="ik-dialog__main">
                <slot />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
