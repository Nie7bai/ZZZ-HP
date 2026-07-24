<script setup lang="ts">
import { computed } from 'vue'
import SiteInfoLinkText from '@/components/info/SiteInfoLinkText.vue'
import type { SiteInfoSection } from '@/api/siteInfo'
import type { SiteInfoPanelId } from '@/types/siteInfo'

const props = defineProps<{
  panel: SiteInfoPanelId
  section: SiteInfoSection | null
  loading?: boolean
}>()

type ContentBlock = {
  heading?: string
  body: string
}

function parseBlocks(content: string): ContentBlock[] {
  const text = content.trim()
  if (!text) return []

  if (!text.includes('【')) {
    return text
      .split(/\n{2,}/)
      .map((body) => body.trim())
      .filter(Boolean)
      .map((body) => ({ body }))
  }

  const chunks = text.split(/\n(?=【)/)
  return chunks
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const match = chunk.match(/^【([^】]+)】\n?([\s\S]*)$/)
      if (match) {
        return { heading: match[1]?.trim(), body: (match[2] || '').trim() }
      }
      return { body: chunk }
    })
}

const title = computed(() => props.section?.title || '加载中…')
const blocks = computed(() => parseBlocks(props.section?.content || ''))
const useDisclaimer = computed(() => props.panel === 'legal')
const useCards = computed(
  () => (props.panel === 'features' || props.panel === 'credits') && blocks.value.some((b) => b.heading),
)
</script>

<template>
  <article class="info-panel">
    <p v-if="loading" class="info-panel__hint">加载中…</p>
    <template v-else-if="section">
      <h1 class="info-panel__title">{{ title }}</h1>

      <div v-if="useCards" class="info-panel__list">
        <div v-for="(block, idx) in blocks" :key="idx" class="info-panel__list-item">
          <strong v-if="block.heading">{{ block.heading }}</strong>
          <p><SiteInfoLinkText :text="block.body" /></p>
        </div>
      </div>

      <div v-else-if="useDisclaimer" class="info-panel__disclaimer">
        <p v-for="(block, idx) in blocks" :key="idx"><SiteInfoLinkText :text="block.body" /></p>
      </div>

      <div v-else class="info-panel__plain">
        <p v-for="(block, idx) in blocks" :key="idx"><SiteInfoLinkText :text="block.body" /></p>
      </div>
    </template>
    <p v-else class="info-panel__hint err">暂无内容</p>
  </article>
</template>

<style scoped>
.info-panel {
  max-width: 820px;
  margin: 0 auto;
  padding: 0.5rem 0.25rem 2rem;
  color: var(--color-text);
  font-size: 0.95rem;
  line-height: 1.7;
}

.info-panel__title {
  margin: 0 0 1rem;
  font-size: clamp(1.35rem, 3vw, 1.75rem);
  font-weight: 700;
  color: var(--color-heading);
  letter-spacing: 0.03em;
}

.info-panel__hint {
  margin: 0;
  opacity: 0.7;
}

.info-panel__hint.err {
  color: #c44;
  opacity: 1;
}

.info-panel__plain p {
  margin: 0 0 0.75rem;
}

.info-panel__list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.info-panel__list-item {
  padding: 0.95rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
}

.info-panel__list-item strong {
  display: block;
  margin-bottom: 0.35rem;
  color: var(--color-heading);
  font-size: 1rem;
}

.info-panel__list-item p {
  margin: 0;
  font-size: 0.92rem;
  opacity: 0.92;
  white-space: pre-wrap;
}

.info-panel__disclaimer {
  padding: 1rem 1.1rem;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, #c4a35a 35%, var(--color-border));
  background: color-mix(in srgb, #c4a35a 10%, var(--color-background-soft));
}

.info-panel__disclaimer p {
  margin: 0 0 0.65rem;
  white-space: pre-wrap;
}

.info-panel__disclaimer p:last-child {
  margin-bottom: 0;
}
</style>
