<script setup lang="ts">
import { computed } from 'vue'
import { parseElementIcons } from '@/utils/elementIcons'

const props = withDefaults(
  defineProps<{
    value?: string | string[] | null
    /** 前缀文案：弱 / 抗 / 弱点 */
    label?: string
    variant?: 'weak' | 'resist'
    /** 是否显示属性文字（图标旁） */
    showName?: boolean
  }>(),
  {
    value: '',
    label: '',
    variant: 'weak',
    showName: true,
  },
)

const items = computed(() => parseElementIcons(props.value))
</script>

<template>
  <span v-if="items.length" class="trait-icons" :class="`trait-icons--${variant}`">
    <span v-if="label" class="trait-icons-label">{{ label }}</span>
    <span v-for="elem in items" :key="elem.name" class="trait-icons-item">
      <img class="trait-icons-img" :src="elem.icon" :alt="elem.name" :title="elem.name" loading="lazy" />
      <span v-if="showName" class="trait-icons-name">{{ elem.name }}</span>
    </span>
  </span>
</template>

<style scoped>
.trait-icons {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.2rem 0.35rem;
  font-size: inherit;
  line-height: 1.35;
}

.trait-icons-label {
  font-weight: 650;
  margin-right: 0.1rem;
  color: inherit;
}

.trait-icons-item {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
}

.trait-icons-img {
  width: 1.05em;
  height: 1.05em;
  border-radius: 2px;
  object-fit: contain;
}

.trait-icons-name {
  font-size: 0.92em;
  color: inherit;
}
</style>
