<script setup lang="ts">
import { computed } from 'vue'
import { linkifyPlainText } from '@/utils/linkifyText'

const props = defineProps<{
  text: string
}>()

const html = computed(() => linkifyPlainText(props.text))
</script>

<template>
  <span class="info-link-text" v-html="html" />
</template>

<style scoped>
.info-link-text :deep(a) {
  color: var(--gb-link, #42a5f5);
  text-decoration: underline;
  text-underline-offset: 2px;
  word-break: break-all;
}

.info-link-text :deep(a:hover) {
  opacity: 0.88;
}
</style>
