<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { fetchChangelogs, type ChangelogEntry } from '@/api/changelog'
import IkModalShell from '@/components/common/IkModalShell.vue'

const entries = ref<ChangelogEntry[]>([])
const loading = ref(false)
const error = ref('')
const pageExpanded = ref(true)
const modalOpen = ref(false)
const modalExpandedId = ref<number | null>(null)

const latest = computed(() => entries.value[0] ?? null)
const latestVersion = computed(() => latest.value?.version ?? '')

function formatDate(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value.slice(0, 10)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function togglePage() {
  if (!latest.value) return
  pageExpanded.value = !pageExpanded.value
}

function toggleModalItem(id: number) {
  modalExpandedId.value = modalExpandedId.value === id ? null : id
}

function openAllModal() {
  modalOpen.value = true
  if (latest.value) modalExpandedId.value = latest.value.id
}

function closeAllModal() {
  modalOpen.value = false
}

watch(modalOpen, (open) => {
  if (open && latest.value && modalExpandedId.value == null) {
    modalExpandedId.value = latest.value.id
  }
})

onMounted(async () => {
  loading.value = true
  error.value = ''
  try {
    entries.value = await fetchChangelogs()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载更新日志失败'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="changelog" aria-label="更新日志">
    <header class="changelog-header">
      <h2>更新日志</h2>
      <button
        v-if="latestVersion"
        type="button"
        class="version-badge"
        title="查看全部更新日志"
        @click="openAllModal"
      >
        当前 {{ latestVersion }}
      </button>
    </header>

    <p v-if="loading" class="hint">加载中…</p>
    <p v-else-if="error" class="hint error">{{ error }}</p>
    <p v-else-if="!latest" class="hint">暂无更新记录</p>

    <ul v-else class="changelog-list">
      <li class="changelog-item">
        <button type="button" class="changelog-summary" @click="togglePage">
          <span class="ver">v{{ latest.version }}</span>
          <span class="sum-title">{{ latest.title }}</span>
          <span class="date">{{ formatDate(latest.publishedAt) }}</span>
          <span class="chevron" :class="{ open: pageExpanded }">▾</span>
        </button>
        <div v-show="pageExpanded" class="changelog-body">
          <pre class="content">{{ latest.content }}</pre>
        </div>
      </li>
    </ul>
  </section>

  <IkModalShell :open="modalOpen" size="post" :z-index="8800" @close="closeAllModal">
    <template #header>
      <div class="changelog-modal-header">
        <h2 class="changelog-modal-title">更新日志</h2>
        <span v-if="latestVersion" class="version-badge version-badge--static">当前 {{ latestVersion }}</span>
      </div>
    </template>
    <div class="changelog-modal-body">
      <ul class="changelog-list">
        <li v-for="item in entries" :key="item.id" class="changelog-item">
          <button type="button" class="changelog-summary" @click="toggleModalItem(item.id)">
            <span class="ver">v{{ item.version }}</span>
            <span class="sum-title">{{ item.title }}</span>
            <span class="date">{{ formatDate(item.publishedAt) }}</span>
            <span class="chevron" :class="{ open: modalExpandedId === item.id }">▾</span>
          </button>
          <div v-show="modalExpandedId === item.id" class="changelog-body">
            <pre class="content">{{ item.content }}</pre>
          </div>
        </li>
      </ul>
    </div>
  </IkModalShell>
</template>

<style scoped>
.changelog {
  width: min(720px, 100%);
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-background-soft);
  padding: 1.1rem 1.2rem 1.2rem;
}

.changelog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
}

.changelog-header h2 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--color-heading);
  letter-spacing: 0.04em;
}

.version-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  color: #2f6f4e;
  background: color-mix(in srgb, #3d9b6a 16%, transparent);
  border: 1px solid color-mix(in srgb, #3d9b6a 35%, transparent);
  border-radius: 999px;
  padding: 0.22rem 0.65rem;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.version-badge:hover {
  color: #1f5a3c;
  background: color-mix(in srgb, #3d9b6a 26%, transparent);
  border-color: color-mix(in srgb, #3d9b6a 50%, transparent);
}

.version-badge--static {
  cursor: default;
  pointer-events: none;
}

.hint {
  margin: 0;
  font-size: 0.88rem;
  color: var(--color-text);
  opacity: 0.7;
}

.hint.error {
  color: #c44;
  opacity: 1;
}

.changelog-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.changelog-item {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--color-background);
}

.changelog-summary {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 0.55rem 0.75rem;
  border: none;
  background: transparent;
  color: var(--color-text);
  text-align: left;
  padding: 0.7rem 0.85rem;
  cursor: pointer;
}

.changelog-summary:hover {
  background: var(--color-background-mute);
}

.ver {
  font-size: 0.8rem;
  font-weight: 700;
  color: #c4a35a;
  letter-spacing: 0.02em;
}

.sum-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-heading);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.date {
  font-size: 0.75rem;
  color: var(--color-text);
  opacity: 0.55;
  white-space: nowrap;
}

.chevron {
  font-size: 0.75rem;
  opacity: 0.55;
  transition: transform 0.18s ease;
}

.chevron.open {
  transform: rotate(180deg);
}

.changelog-body {
  border-top: 1px solid var(--color-border);
  padding: 0.75rem 0.9rem 0.9rem;
}

.content {
  margin: 0;
  font-family: inherit;
  font-size: 0.84rem;
  line-height: 1.55;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
}

.changelog-modal-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
  flex: 1;
}

.changelog-modal-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
  color: #fff;
  letter-spacing: 0.04em;
}

.changelog-modal-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 1rem 1.15rem 1.25rem;
  background: var(--color-background-soft);
}

.changelog-modal-body .changelog-list {
  max-width: 720px;
  margin: 0 auto;
}

@media (max-width: 560px) {
  .changelog-summary {
    grid-template-columns: auto 1fr auto;
    grid-template-areas:
      'ver date chevron'
      'title title title';
  }

  .ver {
    grid-area: ver;
  }

  .sum-title {
    grid-area: title;
    white-space: normal;
  }

  .date {
    grid-area: date;
  }

  .chevron {
    grid-area: chevron;
  }
}
</style>
