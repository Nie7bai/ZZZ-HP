<script setup lang="ts">
const variants = [
  { title: '旧·式舆防卫战', path: '/admin/defense/old', color: '#4ecdc4' },
  { title: '新·式舆防卫战', path: '/admin/defense/new', color: '#36b5aa' },
]
</script>

<template>
  <main class="admin-select">
    <RouterLink to="/admin" class="back">← 返回管理员入口</RouterLink>

    <h1 class="title">式舆防卫战</h1>
    <p class="desc">请选择要修改数据的版本</p>

    <div class="cards">
      <RouterLink
        v-for="variant in variants"
        :key="variant.path"
        :to="variant.path"
        class="card"
        :style="{ '--accent': variant.color }"
      >
        <span class="card-title">{{ variant.title }}</span>
      </RouterLink>
    </div>
  </main>
</template>

<style scoped>
.admin-select {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  gap: 1.5rem;
  position: relative;
}

.back {
  position: absolute;
  top: 1.25rem;
  left: 1.25rem;
  font-size: 0.85rem;
  color: var(--color-text);
  opacity: 0.7;
  text-decoration: none;
  transition: opacity 0.2s;
}

.back:hover {
  opacity: 1;
}

.title {
  margin: 0;
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 700;
  color: var(--color-heading);
  letter-spacing: 0.04em;
  text-align: center;
}

.desc {
  margin: 0;
  font-size: 0.9rem;
  color: var(--color-text);
  opacity: 0.7;
  text-align: center;
}

.cards {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  justify-content: center;
  max-width: 720px;
  width: 100%;
  margin-top: 1rem;
}

.card {
  flex: 1 1 240px;
  max-width: 320px;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1.5rem;
  border: 2px solid var(--accent);
  border-radius: 12px;
  background: var(--color-background-soft);
  text-decoration: none;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;
}

.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--accent) 35%, transparent);
  background: color-mix(in srgb, var(--accent) 12%, var(--color-background-soft));
}

.card-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-heading);
  text-align: center;
}
</style>
