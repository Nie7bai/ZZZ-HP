<script setup lang="ts">
import { useRouter } from 'vue-router'
import { clearAdminAuthenticated } from '@/utils/adminAuth'

const router = useRouter()

const modes = [
  { title: '危局强袭战', path: '/admin/crisis-assault', color: '#ff6b35' },
  { title: '式舆防卫战', path: '/admin/defense', color: '#4ecdc4' },
  { title: '临界推演', path: '/admin/deduction', color: '#a78bfa' },
  { title: '角色计算器', path: '/admin/character-calculator', color: '#3f8cff' },
]

function logout() {
  clearAdminAuthenticated()
  router.push('/admin/login')
}
</script>

<template>
  <main class="admin-select">
    <RouterLink to="/" class="back">← 返回首页</RouterLink>
    <button type="button" class="logout" @click="logout">退出登录</button>

    <h1 class="title">管理员入口</h1>
    <p class="desc">请选择要修改数据的模式</p>

    <div class="cards">
      <RouterLink
        v-for="mode in modes"
        :key="mode.path"
        :to="mode.path"
        class="card"
        :style="{ '--accent': mode.color }"
      >
        <span class="card-title">{{ mode.title }}</span>
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

.logout {
  position: absolute;
  top: 1.25rem;
  right: 1.25rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-background-soft);
  color: var(--color-text);
  font-size: 0.85rem;
  padding: 0.4rem 0.85rem;
  cursor: pointer;
  opacity: 0.8;
  transition:
    opacity 0.2s,
    background-color 0.2s;
}

.logout:hover {
  opacity: 1;
  background: var(--color-background-mute);
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
  max-width: 900px;
  width: 100%;
  margin-top: 1rem;
}

.card {
  flex: 1 1 240px;
  max-width: 280px;
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
