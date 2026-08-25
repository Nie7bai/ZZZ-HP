<script setup lang="ts">
import AdminBuffCatalogPanel from '@/components/admin/AdminBuffCatalogPanel.vue'
</script>

<template>
  <main class="admin-buff-catalog-page">
    <RouterLink to="/admin" class="back">← 返回管理入口</RouterLink>
    <AdminBuffCatalogPanel />
  </main>
</template>

<style scoped>
.admin-buff-catalog-page {
  min-height: 100vh;
  padding: 1.25rem 1rem 2rem;
  max-width: 1100px;
  margin: 0 auto;
}

.back {
  display: inline-block;
  margin-bottom: 1rem;
  font-size: 0.85rem;
  color: var(--color-text);
  opacity: 0.75;
  text-decoration: none;
}

.back:hover {
  opacity: 1;
}
</style>
