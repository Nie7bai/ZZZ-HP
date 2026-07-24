<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import SiteInfoPanel from '@/components/info/SiteInfoPanel.vue'
import {
  fetchSiteInfoSections,
  SITE_INFO_PANEL_LABELS,
  SITE_INFO_PANEL_ORDER,
  type SiteInfoSection,
} from '@/api/siteInfo'
import type { SiteInfoPanelId } from '@/types/siteInfo'

export type { SiteInfoPanelId }

const props = withDefaults(
  defineProps<{
    backTo?: string
    backLabel?: string
  }>(),
  {
    backTo: '/',
    backLabel: '← 返回首页',
  },
)

const panels = SITE_INFO_PANEL_ORDER.map((id) => ({
  id,
  label: SITE_INFO_PANEL_LABELS[id],
}))

const sections = ref<Partial<Record<SiteInfoPanelId, SiteInfoSection>>>({})
const loading = ref(true)
const loadError = ref('')

const activePanel = ref<SiteInfoPanelId>('about')
const mobileNavOpen = ref(false)

const activeSection = computed(() => sections.value[activePanel.value] ?? null)

const mobileSubtitle = computed(
  () => panels.find((p) => p.id === activePanel.value)?.label ?? '',
)

async function loadSections() {
  loading.value = true
  loadError.value = ''
  try {
    const list = await fetchSiteInfoSections()
    const map: Partial<Record<SiteInfoPanelId, SiteInfoSection>> = {}
    for (const item of list) map[item.panelKey] = item
    sections.value = map
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '加载网站说明失败'
  } finally {
    loading.value = false
  }
}

function selectPanel(id: SiteInfoPanelId) {
  activePanel.value = id
  mobileNavOpen.value = false
}

watch(activePanel, () => {
  mobileNavOpen.value = false
})

watch(mobileNavOpen, (open) => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = open ? 'hidden' : ''
})

onUnmounted(() => {
  document.body.style.overflow = ''
})

onMounted(() => {
  void loadSections()
})
</script>

<template>
  <div class="mode-layout" :class="{ 'mode-layout--nav-open': mobileNavOpen }">
    <header class="mobile-topbar">
      <button
        type="button"
        class="mobile-menu-btn"
        aria-label="打开菜单"
        @click="mobileNavOpen = true"
      >
        菜单
      </button>
      <div class="mobile-topbar-text">
        <strong>网站说明</strong>
        <span>{{ mobileSubtitle }}</span>
      </div>
    </header>

    <div class="sidebar-root">
      <button
        v-show="mobileNavOpen"
        type="button"
        class="sidebar-backdrop"
        aria-label="关闭菜单"
        @click="mobileNavOpen = false"
      />
      <aside class="sidebar" :class="{ 'sidebar--open': mobileNavOpen }">
        <RouterLink :to="props.backTo" class="back" @click="mobileNavOpen = false">
          {{ props.backLabel }}
        </RouterLink>

        <h2 class="sidebar-title">网站说明</h2>

        <nav class="sidebar-nav">
          <button
            v-for="panel in panels"
            :key="panel.id"
            type="button"
            class="nav-btn"
            :class="{ active: activePanel === panel.id }"
            @click="selectPanel(panel.id)"
          >
            {{ panel.label }}
          </button>
        </nav>
      </aside>
    </div>

    <main class="mode-content mode-content--page-scroll">
      <p v-if="loadError" class="info-load-error">{{ loadError }}</p>
      <SiteInfoPanel :panel="activePanel" :section="activeSection" :loading="loading" />
    </main>
  </div>
</template>

<style scoped>
.mode-layout {
  display: flex;
  height: 100vh;
  width: 100%;
  overflow: hidden;
}

.mobile-topbar {
  display: none;
}

.sidebar-root {
  flex-shrink: 0;
}

.sidebar-backdrop {
  display: none;
}

.sidebar {
  width: 220px;
  height: 100vh;
  flex-shrink: 0;
  padding: 1.5rem 1rem;
  border-right: 1px solid var(--color-border);
  background: var(--color-background-soft);
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  overflow-y: auto;
}

.back {
  font-size: 0.85rem;
  color: var(--color-text);
  opacity: 0.7;
  transition: opacity 0.2s;
  text-decoration: none;
}

.back:hover {
  opacity: 1;
}

.sidebar-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-heading);
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.nav-btn {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  font-size: 0.95rem;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 0.2s,
    border-color 0.2s,
    color 0.2s;
}

.nav-btn:hover {
  border-color: var(--color-border-hover);
  background: var(--color-background-mute);
}

.nav-btn.active {
  border-color: hsla(160, 100%, 37%, 0.6);
  background: hsla(160, 100%, 37%, 0.12);
  color: var(--color-heading);
  font-weight: 600;
}

.mode-content {
  position: relative;
  flex: 1;
  min-height: 0;
  padding: 0.75rem 1rem 1rem;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.mode-content--page-scroll {
  overflow-x: hidden;
  overflow-y: auto;
}

.info-load-error {
  max-width: 820px;
  margin: 0 auto 0.75rem;
  padding: 0.65rem 0.85rem;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, #c44 35%, var(--color-border));
  background: color-mix(in srgb, #c44 8%, var(--color-background-soft));
  color: #c44;
  font-size: 0.88rem;
}

@media (max-width: 768px) {
  .mode-layout {
    flex-direction: column;
    height: 100dvh;
  }

  .mobile-topbar {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    flex-shrink: 0;
    padding: 0.55rem 0.75rem;
    padding-top: max(0.55rem, env(safe-area-inset-top));
    border-bottom: 1px solid var(--color-border);
    background: var(--color-background-soft);
  }

  .mobile-menu-btn {
    flex-shrink: 0;
    min-height: 2.4rem;
    padding: 0.4rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-background);
    color: var(--color-heading);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .mobile-topbar-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .mobile-topbar-text strong {
    font-size: 0.92rem;
    color: var(--color-heading);
    line-height: 1.2;
  }

  .mobile-topbar-text span {
    font-size: 0.75rem;
    color: var(--color-text);
    opacity: 0.7;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

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
    background: rgba(0, 0, 0, 0.5);
    cursor: pointer;
  }

  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 1200;
    width: min(280px, 86vw);
    height: 100dvh;
    border-right: 1px solid var(--color-border);
    box-shadow: 8px 0 28px rgba(0, 0, 0, 0.28);
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

  .mode-content {
    padding: 0.55rem 0.6rem 0.85rem;
  }
}
</style>
