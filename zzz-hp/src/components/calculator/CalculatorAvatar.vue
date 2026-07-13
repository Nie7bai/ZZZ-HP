<script setup lang="ts">
import { computed } from 'vue'
import { resolveAssetUrl } from '@/utils/gameData'

const props = defineProps<{
  avatarImage?: string | null
  name: string
}>()

const imageUrl = computed(() => resolveAssetUrl(props.avatarImage))
const fallback = computed(() => props.name.trim().slice(0, 1) || '?')
</script>

<template>
  <span class="calculator-avatar">
    <img v-if="imageUrl" :src="imageUrl" :alt="name" />
    <span v-else class="fallback">{{ fallback }}</span>
  </span>
</template>

<style scoped>
.calculator-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid #3a404b;
  background: linear-gradient(135deg, #263449, #1f2736);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.calculator-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.fallback {
  font-size: 0.84rem;
  font-weight: 700;
  color: #d9e7ff;
}
</style>
