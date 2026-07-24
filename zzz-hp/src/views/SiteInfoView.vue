<script setup lang="ts">
import SiteInfoLayout from '@/layouts/SiteInfoLayout.vue'

withDefaults(
  defineProps<{
    backTo?: string
    backLabel?: string
  }>(),
  {
    backTo: '/',
    backLabel: '← 返回首页',
  },
)
</script>

<template>
  <SiteInfoLayout :back-to="backTo" :back-label="backLabel" />
</template>
