<script setup lang="ts">
import siteLogo from '@/assets/ZZZ.png'
import HomeChangelog from '@/components/home/HomeChangelog.vue'

const modes = [
  { title: '危局强袭战', path: '/crisis-assault', color: '#ff6b35' },
  { title: '式舆防卫战', path: '/defense', color: '#4ecdc4' },
  { title: '临界推演', path: '/deduction', color: '#a78bfa' },
  { title: '角色计算器', path: '/character-calculator', color: '#f6c453' },
  { title: '网站说明', path: '/about', color: '#7eb8da' },
]
</script>

<template>
  <main class="home">
    <img class="home-logo" :src="siteLogo" alt="ZZZ-HP" />
    <h1 class="title">欢迎使用 ZZZ-HP</h1>
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

    <HomeChangelog />

    <RouterLink to="/admin/login" class="admin-entry">管理员入口</RouterLink>
  </main>
</template>

<style scoped>
.home {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  gap: 2.5rem;
  position: relative;
}

.title {
  font-size: clamp(1.35rem, 4vw, 2rem);
  font-weight: 700;
  color: var(--color-heading);
  letter-spacing: 0.05em;
  text-align: center;
}

.home-logo {
  width: min(220px, 56vw);
  height: auto;
  object-fit: contain;
  user-select: none;
}

.cards {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  justify-content: center;
  max-width: 900px;
  width: 100%;
}

.card {
  flex: 1 1 240px;
  max-width: 280px;
  min-height: 140px;
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
  font-size: 1.35rem;
  font-weight: 600;
  color: var(--color-heading);
  text-align: center;
}

.admin-entry {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 1100;
  padding: 0.55rem 0.9rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-background-soft);
  color: var(--color-text);
  font-size: 0.85rem;
  font-weight: 600;
  text-decoration: none;
  opacity: 0.75;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  transition:
    opacity 0.2s,
    background-color 0.2s,
    border-color 0.2s,
    transform 0.2s,
    color 0.2s;
}

.admin-entry:hover {
  opacity: 1;
  color: var(--color-heading);
  background: var(--color-background-mute);
  border-color: var(--color-border-hover);
  transform: translateY(-1px);
}

@media (max-width: 560px) {
  .home {
    padding: 1.25rem 0.85rem 4.5rem;
    gap: 1.5rem;
    justify-content: flex-start;
  }

  .title {
    margin-top: 0.75rem;
    font-size: 1.65rem;
  }

  .card {
    min-height: 100px;
    padding: 1.35rem 1rem;
  }

  .card-title {
    font-size: 1.15rem;
  }

  .admin-entry {
    right: 0.75rem;
    bottom: 0.75rem;
  }
}
</style>
