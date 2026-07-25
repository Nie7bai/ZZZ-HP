<script setup lang="ts">
import { RouterView } from 'vue-router'
import ThemeToggle from '@/components/ThemeToggle.vue'
import HomeGuestbook from '@/components/home/HomeGuestbook.vue'
import MiyousheLoginDialog from '@/components/auth/MiyousheLoginDialog.vue'
</script>

<template>
  <RouterView />
  <ThemeToggle />
  <HomeGuestbook />
  <MiyousheLoginDialog />
</template>
