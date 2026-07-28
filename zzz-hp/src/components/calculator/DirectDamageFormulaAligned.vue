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
    <div class="formula-aligned-body">
      <template v-for="(segment, segmentIndex) in formulaSegments" :key="`${group.key}-segment-${segmentIndex}`">
        <span v-if="segmentIndex > 0" class="formula-aligned-op" aria-hidden="true">+</span>
        <template v-for="(term, termIndex) in segment" :key="`${group.key}-segment-${segmentIndex}-${term.label}`">
          <span
            v-if="termIndex > 0"
            class="formula-aligned-op"
            aria-hidden="true"
          >×</span>
          <div class="formula-aligned-term">
            <span class="formula-aligned-term-label">{{ term.label }}</span>
            <span class="formula-aligned-term-value">
              <StatValueWithSources :value="term.value" :groups="valueTips[term.tipsKey] ?? []" />
            </span>
          </div>
        </template>
      </template>
      <span class="formula-aligned-op" aria-hidden="true">=</span>
      <div class="formula-aligned-result">
        <StatValueWithSources :value="group.result" :groups="valueTips[group.key] ?? []" />
      </div>
    </div>
  </div>
</template>
