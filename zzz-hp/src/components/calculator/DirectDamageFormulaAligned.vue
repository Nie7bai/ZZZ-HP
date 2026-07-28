<script setup lang="ts">
import StatValueWithSources from '@/components/calculator/StatValueWithSources.vue'
import type { AlignedDirectFormulaGroup } from '@/utils/directDamageDisplay'
import type { StatSourceGroup } from '@/utils/statSourceTips'

const props = defineProps<{
  group: AlignedDirectFormulaGroup
  valueTips: Partial<Record<string, StatSourceGroup[]>>
  formatBaseChain?: (value: number) => string
}>()

function formatChain(value: number | undefined) {
  const safe = value ?? 0
  return props.formatBaseChain ? props.formatBaseChain(safe) : String(safe)
}
</script>

<template>
  <div class="formula-aligned-group">
    <span class="formula-label formula-aligned-title">{{ group.title }}</span>
    <div class="formula-aligned-body">
      <template v-for="(term, index) in group.terms" :key="`${group.key}-base-${term.label}`">
        <span v-if="index > 0" class="formula-aligned-op" aria-hidden="true">×</span>
        <div class="formula-aligned-term">
          <span class="formula-aligned-term-label">{{ term.label }}</span>
          <span class="formula-aligned-term-value">
            <StatValueWithSources :value="term.value" :groups="valueTips[term.tipsKey] ?? []" />
          </span>
        </div>
      </template>

      <template v-if="group.sumMultZones?.length">
        <span class="formula-aligned-op" aria-hidden="true">=</span>
        <div class="formula-aligned-term formula-aligned-term--base-chain">
          <span class="formula-aligned-term-label">基础链</span>
          <span class="formula-aligned-term-value">{{ formatChain(group.baseChainValue) }}</span>
        </div>
        <template v-for="(zone, zoneIndex) in group.sumMultZones" :key="`${group.key}-zone-${zone.label}`">
          <span class="formula-aligned-op" aria-hidden="true">{{ zoneIndex === 0 ? '×' : '+' }}</span>
          <template v-if="zoneIndex > 0">
            <span class="formula-aligned-base-repeat">{{ formatChain(group.baseChainValue) }}</span>
            <span class="formula-aligned-op" aria-hidden="true">×</span>
          </template>
          <div class="formula-aligned-term formula-aligned-term--sum-zone">
            <span class="formula-aligned-term-label">{{ zone.label }}</span>
            <span class="formula-aligned-term-value">
              <StatValueWithSources :value="zone.value" :groups="valueTips[zone.tipsKey] ?? []" />
            </span>
          </div>
        </template>
      </template>

      <template v-else-if="group.terms.length">
        <!-- 单倍率区：最后一项已是直伤倍率区，仅补等号 -->
      </template>

      <span class="formula-aligned-op" aria-hidden="true">=</span>
      <div class="formula-aligned-result">
        <StatValueWithSources :value="group.result" :groups="valueTips[group.key] ?? []" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.formula-aligned-term--base-chain .formula-aligned-term-label,
.formula-aligned-base-repeat {
  color: var(--calc-muted, #aeb6c6);
}

.formula-aligned-base-repeat {
  font-size: 0.82rem;
  padding: 0 0.15rem;
}

.formula-aligned-term--sum-zone .formula-aligned-term-label {
  min-width: 5.5rem;
}
</style>
