<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import ModeLayout from '@/layouts/ModeLayout.vue'

const route = useRoute()

const title = computed(() => {
  const metaTitle = route.meta.title
  return typeof metaTitle === 'string' ? metaTitle : '式舆防卫战'
})
</script>

<template>
  <ModeLayout :title="title" mode="defense" back-to="/defense" back-label="← 返回选择" />
</template>
