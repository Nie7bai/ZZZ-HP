<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  kind: 'image' | 'mention' | 'emoji' | 'heart' | 'reply' | 'more'
}>()

const label = computed(() => {
  if (props.kind === 'image') return '图片'
  if (props.kind === 'mention') return '@ 提及'
  if (props.kind === 'heart') return '收藏表情'
  if (props.kind === 'reply') return '引用'
  if (props.kind === 'more') return '更多'
  return '表情'
})
</script>

<template>
  <svg
    v-if="kind === 'image'"
    class="gb-composer-icon"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" stroke="currentColor" stroke-width="1.8" />
    <path d="M7 15l3.5-3.5 2.5 2.5L17 11l3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="9" cy="9.5" r="1.2" fill="currentColor" />
  </svg>
  <svg
    v-else-if="kind === 'mention'"
    class="gb-composer-icon"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="8.2" stroke="currentColor" stroke-width="1.8" />
    <path
      d="M14.5 9.5c0 1.4-1.1 2.5-2.5 2.5S9.5 10.9 9.5 9.5 10.6 7 12 7s2.5 1.1 2.5 2.5zm0 2.5V16"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
    />
  </svg>
  <svg
    v-else-if="kind === 'heart'"
    class="gb-composer-icon gb-composer-icon--heart"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M12 20.5s-6.2-3.9-8.2-7.4C2.2 9.7 3.6 6.4 6.8 5.4c1.8-.6 3.7.1 5.2 1.7 1.5-1.6 3.4-2.3 5.2-1.7 3.2 1 4.6 4.3 3 7.7-2 3.5-8.2 7.4-8.2 7.4z"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linejoin="round"
    />
  </svg>
  <svg
    v-else-if="kind === 'reply'"
    class="gb-composer-icon"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M10 8.5H6.5A2.5 2.5 0 0 0 4 11v5.5A2.5 2.5 0 0 0 6.5 19H14a2.5 2.5 0 0 0 2.5-2.5V14"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
    />
    <path
      d="M9.5 12.5 20 5v6.5"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
  <svg
    v-else-if="kind === 'more'"
    class="gb-composer-icon"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <circle cx="6" cy="12" r="1.4" fill="currentColor" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    <circle cx="18" cy="12" r="1.4" fill="currentColor" />
  </svg>
  <svg
    v-else
    class="gb-composer-icon"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="8.2" stroke="currentColor" stroke-width="1.8" />
    <circle cx="9" cy="10.5" r="1" fill="currentColor" />
    <circle cx="15" cy="10.5" r="1" fill="currentColor" />
    <path d="M9 14.5c.8 1 1.9 1.5 3 1.5s2.2-.5 3-1.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
  </svg>
  <span class="sr-only">{{ label }}</span>
</template>

<style scoped>
.gb-composer-icon {
  width: 20px;
  height: 20px;
  display: block;
}

.gb-composer-icon--heart {
  transform: scale(0.92);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
