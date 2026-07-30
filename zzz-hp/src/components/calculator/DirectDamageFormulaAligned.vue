<script setup lang="ts">
import { computed } from 'vue'
import StatValueWithSources from '@/components/calculator/StatValueWithSources.vue'
import type { AlignedDirectFormulaGroup, DirectFormulaTerm } from '@/utils/directDamageDisplay'
import type { StatSourceGroup } from '@/utils/statSourceTips'

const props = defineProps<{
  group: AlignedDirectFormulaGroup
  valueTips: Partial<Record<string, StatSourceGroup[]>>
}>()

const formulaSegments = computed((): DirectFormulaTerm[][] => {
  const { group } = props
  if (group.sumMultZones?.length) {
    return group.sumMultZones.map((zone) => [...group.terms, zone])
  }
  return [group.terms]
})
</script>

<template>
  <div class="formula-aligned-group">
    <span class="formula-label formula-aligned-title">{{ group.title }}</span>
    <div class="formula-aligned-body formula-aligned-body--compact">
      <template v-for="(segment, segmentIndex) in formulaSegments" :key="`${group.key}-segment-${segmentIndex}`">
        <span v-if="segmentIndex > 0" class="formula-aligned-op" aria-hidden="true">+</span>
        <template v-for="(term, termIndex) in segment" :key="`${group.key}-segment-${segmentIndex}-${term.label}`">
          <span
            v-if="termIndex > 0"
            class="formula-aligned-op"
            aria-hidden="true"
          >×</span>
          <div class="formula-aligned-term formula-aligned-term--inline">
            <span class="formula-aligned-term-label">{{ term.label }}</span>
            <span class="formula-aligned-term-value">
              <StatValueWithSources :value="term.value" :groups="valueTips[term.tipsKey] ?? []" />
            </span>
          </div>
        </template>
      </template>
      <span class="formula-aligned-op" aria-hidden="true">=</span>
      <div class="formula-aligned-result formula-aligned-result--inline">
        <StatValueWithSources :value="group.result" :groups="valueTips[group.key] ?? []" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.formula-aligned-group {
  display: grid;
  grid-template-columns: 6.95em minmax(0, 1fr);
  gap: 0.35rem 0.45rem;
  padding: 0.55rem 0;
  align-items: start;
}

.formula-aligned-title {
  margin: 0;
  padding-top: 0.15rem;
  line-height: 1.45;
}

.formula-aligned-body--compact {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.35rem 0.45rem;
  min-width: 0;
  overflow-x: auto;
  padding-bottom: 0.1rem;
}

.formula-aligned-term--inline {
  display: inline-flex;
  flex-direction: row;
  align-items: baseline;
  gap: 0.28rem;
  flex-shrink: 0;
}

.formula-aligned-term-label {
  font-size: 0.75rem;
  line-height: 1.35;
  color: var(--calc-muted, #b7c0cd);
  white-space: nowrap;
}

.formula-aligned-term-value {
  font-size: 0.88rem;
  line-height: 1.35;
  white-space: nowrap;
}

.formula-aligned-op {
  flex-shrink: 0;
  color: var(--calc-muted, #8a93a0);
  font-size: 0.82rem;
  line-height: 1.35;
  user-select: none;
}

.formula-aligned-result--inline {
  flex-shrink: 0;
  font-size: 0.88rem;
  line-height: 1.35;
  white-space: nowrap;
}
</style>
