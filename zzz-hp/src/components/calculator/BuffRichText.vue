<script setup lang="ts">
import { computed } from 'vue'
import { BUFF_RICH_NUMBER_COLOR, formatBuffRichHtml } from '@/utils/buffRichText'

const props = defineProps<{
  text?: string | null
}>()

const html = computed(() => formatBuffRichHtml(props.text))
</script>

<template>
  <span v-if="html" class="buff-rich-text" v-html="html" />
</template>

<style scoped>
.buff-rich-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font-weight: 400;
}
</style>

<!-- 字重/颜色放全局，避免被父级 strong / 面板字重盖掉观感 -->
<style>
.buff-rich-text .buff-rt-num,
.buff-rich-text .buff-rt-el,
.buff-rich-text .buff-rt-color,
.buff-rich-text .buff-rt-kw {
  font-weight: 700;
}

.buff-rich-text .buff-rt-num {
  color: v-bind('BUFF_RICH_NUMBER_COLOR');
}

.buff-rich-text .buff-rt-kw {
  color: var(--color-heading, var(--calc-text, currentColor));
}

.buff-rich-text .buff-rt-el--火 {
  color: #ff5521;
}
.buff-rich-text .buff-rt-el--冰 {
  color: #98eff0;
}
.buff-rich-text .buff-rt-el--电 {
  color: #2eb6ff;
}
.buff-rich-text .buff-rt-el--以太 {
  color: #fe437e;
}
.buff-rich-text .buff-rt-el--物理 {
  color: #f0d12b;
}
.buff-rich-text .buff-rt-el--风 {
  color: #a6c5fd;
}
.buff-rich-text .buff-rt-el--流明 {
  color: #ffa9dd;
}
</style>
