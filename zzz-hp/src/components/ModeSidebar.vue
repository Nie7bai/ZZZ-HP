<script setup lang="ts">
import { computed } from 'vue'
import {
  getModePanelDefinitions,
  getModePanelLabel,
  getModePanelPath,
  type ModePanelId,
} from '@/config/modePanels'
import type { ModeKey } from '@/types/history'

const props = defineProps<{
  activePanel: ModePanelId
  title: string
  backTo?: string
  backLabel?: string
  mode: ModeKey
  modePanelBasePath: string
}>()

const mobileOpen = defineModel<boolean>('mobileOpen', { default: false })

const panels = computed(() =>
  getModePanelDefinitions(props.mode).map((panel) => ({
    id: panel.id,
    label: getModePanelLabel(props.mode, panel.id),
    to: getModePanelPath(props.modePanelBasePath, panel.id),
  })),
)

const backText = computed(() => (props.backLabel ?? '返回首页').replace(/^←\s*/, ''))

function closeMobileNav() {
  mobileOpen.value = false
}
</script>

<template>
  <div class="sidebar-root">
    <button
      v-show="mobileOpen"
      type="button"
      class="sidebar-backdrop"
      aria-label="关闭菜单"
      @click="closeMobileNav"
    />
    <aside class="sidebar" :class="{ 'sidebar--open': mobileOpen }">
      <RouterLink :to="backTo ?? '/'" class="back" @click="closeMobileNav">
        <span class="back-arrow" aria-hidden="true">◄</span>{{ backText }}
      </RouterLink>

      <h2 class="sidebar-title zzz-display">
        <span class="sidebar-title-text">{{ title }}</span>
        <span class="sidebar-title-bar" aria-hidden="true" />
      </h2>

      <nav class="sidebar-nav">
        <RouterLink
          v-for="panel in panels"
          :key="panel.id"
          :to="panel.to"
          class="nav-btn"
          :class="{ active: props.activePanel === panel.id }"
          @click="closeMobileNav"
        >
          <span class="nav-btn-tick" aria-hidden="true" />
          <span class="nav-btn-label">{{ panel.label }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-foot" aria-hidden="true">ZZZ-HP</div>
    </aside>
  </div>
</template>

<style scoped>
.sidebar-root {
  flex-shrink: 0;
}

.sidebar-backdrop {
  display: none;
}

/* ZZZ 深色侧栏轨道：明暗主题下都保持游戏菜单质感 */
.sidebar {
  width: 224px;
  height: 100vh;
  flex-shrink: 0;
  padding: 1.4rem 0.9rem;
  border-right: 2px solid #000;
  background: var(--zzz-ink);
  background-image: var(--zzz-tex-chessboard-dark);
  background-position:
    0 0,
    3px 3px;
  background-size: 6px 6px;
  color: #f5f5f0;
  display: flex;
  flex-direction: column;
  gap: 1.3rem;
  overflow-y: auto;
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-family: var(--zzz-font-mono);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(245, 245, 240, 0.55);
  text-decoration: none;
  transition: color 0.18s ease-out;
}

.back-arrow {
  font-size: 0.62rem;
  color: var(--zzz-yellow);
}

.back:hover {
  color: #f5f5f0;
}

.sidebar-title {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding-bottom: 0.8rem;
  border-bottom: 1px solid var(--zzz-line);
}

.sidebar-title-text {
  font-size: 1.28rem;
  font-weight: 900;
  letter-spacing: 0.06em;
  color: #f5f5f0;
}

.sidebar-title-bar {
  width: 2.4rem;
  height: 4px;
  background: var(--zzz-yellow);
  transform: skew(-24deg);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.nav-btn {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.72rem 0.9rem;
  border: 1px solid #000;
  border-radius: var(--zzz-radius-btn);
  background: var(--zzz-ink-2);
  color: rgba(245, 245, 240, 0.85);
  font-size: 0.92rem;
  font-weight: 600;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.14),
    inset 0 0 0 2px #2e2e2e,
    inset 0 0 0 3px var(--zzz-ink-2);
  transition:
    background-color 0.16s ease-out,
    color 0.16s ease-out,
    box-shadow 0.16s ease-out;
}

.nav-btn-tick {
  flex-shrink: 0;
  width: 0.5rem;
  height: 0.5rem;
  background: transparent;
  transform: skew(-24deg);
  border: 1px solid rgba(245, 245, 240, 0.35);
  transition:
    background-color 0.16s ease-out,
    border-color 0.16s ease-out;
}

.nav-btn:hover {
  color: #f5f5f0;
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.14),
    inset 0 0 0 2px var(--zzz-yellow),
    inset 0 0 0 3px var(--zzz-ink-2);
}

.nav-btn:hover .nav-btn-tick {
  border-color: var(--zzz-yellow);
}

.nav-btn.active {
  color: #0a0a0a;
  font-weight: 800;
  animation: zzz-flash-bg 1s ease-in-out infinite alternate;
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.35),
    inset 0 0 0 2px rgba(0, 0, 0, 0.6);
}

.nav-btn.active .nav-btn-tick {
  background: #0a0a0a;
  border-color: #0a0a0a;
}

.sidebar-foot {
  margin-top: auto;
  font-family: var(--zzz-font-display);
  font-size: 0.9rem;
  letter-spacing: 0.14em;
  color: transparent;
  -webkit-text-stroke: 1px var(--zzz-line);
  user-select: none;
}

.sidebar-foot::before {
  content: '';
  display: block;
  height: 10px;
  margin-bottom: 0.7rem;
  border-radius: 2px;
  background: #050505 url('/zzz-assets/tab-bg-point.webp') repeat;
}

/* 仅手机：侧栏改为抽屉，桌面样式不变 */
@media (max-width: 768px) {
  .sidebar-root {
    width: 0;
    height: 0;
    overflow: visible;
  }

  .sidebar-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 1190;
    border: none;
    padding: 0;
    margin: 0;
    background: rgba(0, 0, 0, 0.6);
    cursor: pointer;
  }

  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 1200;
    width: min(280px, 86vw);
    height: 100dvh;
    box-shadow: 8px 0 28px rgba(0, 0, 0, 0.45);
    transform: translateX(-105%);
    transition: transform 0.22s ease;
    padding-top: max(1.25rem, env(safe-area-inset-top));
    padding-bottom: max(1.25rem, env(safe-area-inset-bottom));
  }

  .sidebar--open {
    transform: translateX(0);
  }

  .nav-btn {
    min-height: 2.75rem;
    font-size: 0.9rem;
  }
}
</style>
