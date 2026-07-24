<script setup lang="ts">
import type { BuffModSource } from '@/utils/panelBuffCalc'
import BuffModsDisplay from '@/components/calculator/BuffModsDisplay.vue'
import { effectSummaryLabel } from '@/utils/buffEffect'
import { buffStatFieldLabel, BUFF_STAT_FIELDS, hasNonZeroBuffMods } from '@/utils/calculatorUi'
import { computed } from 'vue'

const props = defineProps<{
  sources: BuffModSource[]
}>()

const visibleSources = computed(() =>
  props.sources.filter(
    (source) =>
      hasNonZeroBuffMods(source.mods) ||
      Boolean(source.note?.trim()) ||
      Boolean(source.effects?.length),
  ),
)

function statLabel(stat: string) {
  const field = BUFF_STAT_FIELDS.find((item) => item.key === stat)
  return field ? buffStatFieldLabel(field) : stat
}
</script>

<template>
  <div v-if="visibleSources.length" class="buff-sources">
    <h4 class="buff-sources-title">增益来源明细（按增益块）</h4>
    <article v-for="source in visibleSources" :key="source.key" class="buff-source-item">
      <p class="buff-source-label">
        {{ source.label }}
        <span v-if="source.blockName" class="buff-block-tag">{{ source.blockName }}</span>
      </p>
      <p v-if="source.note?.trim()" class="buff-source-note">{{ source.note }}</p>
      <ul v-if="source.effects?.length" class="buff-effect-list">
        <li v-for="effect in source.effects" :key="effect.id">
          {{ effectSummaryLabel(effect, (s) => statLabel(s)) }}
        </li>
      </ul>
      <div
        v-else
        class="buff-source-mods"
        :class="{ 'has-note': source.note?.trim() }"
      >
        <BuffModsDisplay :mods="source.mods" />
      </div>
    </article>
  </div>
  <p v-else class="buff-sources-empty">当前没有可展示的增益来源</p>
</template>

<style scoped>
.buff-sources {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--calc-border, #4a5563);
}

.buff-sources-title {
  margin: 0 0 0.55rem;
  font-size: 0.82rem;
  color: var(--calc-text, #d5dae4);
}

.buff-source-item + .buff-source-item {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--calc-border, #4a5563);
}

.buff-source-label {
  margin: 0 0 0.35rem;
  font-size: 0.78rem;
  color: var(--calc-accent, #c9a55c);
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
}

.buff-block-tag {
  display: inline-flex;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  border: 1px solid rgba(63, 140, 255, 0.45);
  color: #8cbcff;
  font-size: 0.72rem;
}

.buff-source-note {
  margin: 0 0 0.45rem;
  font-size: 0.76rem;
  line-height: 1.5;
  color: var(--calc-muted, #aeb6c6);
}

.buff-effect-list {
  margin: 0 0 0.45rem;
  padding-left: 1.1rem;
  font-size: 0.76rem;
  color: var(--calc-text, #c9d0dc);
  line-height: 1.45;
}

.buff-source-mods.has-note {
  margin-top: 0.25rem;
}

.buff-sources-empty {
  margin: 0.75rem 0 0;
  font-size: 0.8rem;
  color: var(--calc-muted, #8b93a3);
}
</style>
