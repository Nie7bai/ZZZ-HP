<script setup lang="ts">
import type { BuffModSource } from '@/utils/panelBuffCalc'
import BuffModsDisplay from '@/components/calculator/BuffModsDisplay.vue'
import { hasNonZeroBuffMods } from '@/utils/calculatorUi'
import { computed } from 'vue'

const props = defineProps<{
  sources: BuffModSource[]
}>()

const visibleSources = computed(() =>
  props.sources.filter(
    (source) => hasNonZeroBuffMods(source.mods) || Boolean(source.note?.trim()),
  ),
)
</script>

<template>
  <div v-if="visibleSources.length" class="buff-sources">
    <h4 class="buff-sources-title">增益来源明细</h4>
    <article v-for="source in visibleSources" :key="source.key" class="buff-source-item">
      <p class="buff-source-label">{{ source.label }}</p>
      <p v-if="source.note?.trim()" class="buff-source-note">{{ source.note }}</p>
      <div class="buff-source-mods" :class="{ 'has-note': source.note?.trim() }">
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
  border-top: 1px solid #4a5563;
}

.buff-sources-title {
  margin: 0 0 0.55rem;
  font-size: 0.82rem;
  color: #d5dae4;
}

.buff-source-item + .buff-source-item {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid #4a5563;
}

.buff-source-label {
  margin: 0 0 0.35rem;
  font-size: 0.78rem;
  color: #c9a55c;
}

.buff-source-note {
  margin: 0 0 0.45rem;
  font-size: 0.76rem;
  line-height: 1.5;
  color: #c5cdd8;
  white-space: pre-wrap;
}

.buff-source-mods.has-note {
  margin-top: 0.15rem;
  padding-top: 0.6rem;
  border-top: 1px dashed #5a6573;
}

.buff-sources-empty {
  margin: 0.75rem 0 0;
  padding-top: 0.75rem;
  border-top: 1px solid #4a5563;
  font-size: 0.8rem;
  color: #7a828f;
}
</style>
