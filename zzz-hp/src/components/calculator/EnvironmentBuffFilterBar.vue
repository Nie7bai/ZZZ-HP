<script setup lang="ts">
import { computed, watch } from 'vue'
import type { EnvironmentBuffMode } from '@/utils/environmentBuffCalc'

export type EnvironmentBuffFilterMode = EnvironmentBuffMode | 'none'

export interface EnvironmentBuffFilterOption {
  id: string
  label: string
  version?: string
  phase?: string
  isHidden?: boolean
}

export interface EnvironmentBuffFrontierOption {
  id: string
  label: string
}

export interface EnvironmentBuffNodeOption {
  id: string
  label: string
}

const mode = defineModel<EnvironmentBuffFilterMode>('mode', { default: 'none' })
const version = defineModel<string>('version', { default: '' })
const phaseId = defineModel<string>('phaseId', { default: '' })
const frontierId = defineModel<string>('frontierId', { default: '' })
const nodeId = defineModel<string>('nodeId', { default: '' })

const props = defineProps<{
  phaseOptions: EnvironmentBuffFilterOption[]
  frontierOptions?: EnvironmentBuffFrontierOption[]
  nodeOptions?: EnvironmentBuffNodeOption[]
  /** 临界推演：期数下拉显示完整期名而非「第 N 期」 */
  phaseLabelMode?: 'default' | 'deduction'
  hint?: string
}>()

const showModeFilters = computed(
  () => mode.value === 'crisis' || mode.value === 'defense' || mode.value === 'deduction',
)
const showVersionFilter = computed(() => mode.value === 'crisis' || mode.value === 'defense')
const showDefenseFrontier = computed(() => mode.value === 'defense' && Boolean(phaseId.value))
const showDeductionNode = computed(() => mode.value === 'deduction' && Boolean(phaseId.value))

const phaseSelectLabel = (opt: EnvironmentBuffFilterOption) => {
  if (props.phaseLabelMode === 'deduction' || mode.value === 'deduction') return opt.label
  return `第${opt.phase || opt.label}期${opt.isHidden ? '（未公开）' : ''}`
}

const versionOptions = computed(() => {
  const map = new Map<string, string>()
  for (const opt of props.phaseOptions) {
    const ver = opt.version?.trim()
    if (!ver) continue
    if (!map.has(ver)) map.set(ver, ver)
  }
  return [...map.keys()].sort((a, b) => compareVersionDesc(a, b))
})

/** 危局/防卫：按版本筛期；临界：直接列全部期数 */
const phaseOptionsForSelect = computed(() => {
  if (mode.value === 'deduction') {
    return props.phaseOptions.slice().sort((a, b) => {
      const versionDiff = compareVersionDesc(a.version || '', b.version || '')
      if (versionDiff !== 0) return versionDiff
      return Number(b.phase || 0) - Number(a.phase || 0)
    })
  }
  if (!version.value) return []
  return props.phaseOptions
    .filter((opt) => opt.version === version.value)
    .slice()
    .sort((a, b) => Number(b.phase || 0) - Number(a.phase || 0))
})

function compareVersionDesc(a: string, b: string) {
  const parse = (value: string) =>
    value.split('.').map((part) => Number(part.replace(/\D/g, '')) || 0)
  const left = parse(a)
  const right = parse(b)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (right[i] ?? 0) - (left[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** 期数由父级在切换模式时设为最新公开期；危局/防卫做版本↔期数联动 */
watch(
  () => [phaseId.value, props.phaseOptions, mode.value] as const,
  () => {
    if (!showModeFilters.value) {
      version.value = ''
      return
    }
    if (mode.value === 'deduction') {
      version.value = ''
      return
    }
    const current = props.phaseOptions.find((opt) => opt.id === phaseId.value)
    if (current?.version) {
      version.value = current.version
      return
    }
    const latestVersion = versionOptions.value[0] ?? ''
    version.value = latestVersion
  },
  { immediate: true },
)

watch(version, (next, prev) => {
  if (!showVersionFilter.value || next === prev) return
  if (!next) {
    phaseId.value = ''
    return
  }
  const matched = phaseOptionsForSelect.value
  if (!matched.some((opt) => opt.id === phaseId.value)) {
    const publicMatched = matched.find((opt) => !opt.isHidden)
    phaseId.value = publicMatched?.id ?? matched[0]?.id ?? ''
  }
})

watch(
  () => props.nodeOptions,
  (options) => {
    if (!nodeId.value) return
    if (!(options ?? []).some((opt) => opt.id === nodeId.value)) {
      nodeId.value = ''
    }
  },
)
</script>

<template>
  <div class="env-buff-filter">
    <div class="env-buff-filter-row">
      <label class="env-field">
        <span>模式</span>
        <select v-model="mode">
          <option value="none">默认</option>
          <option value="crisis">危局强袭战</option>
          <option value="defense">式舆防卫战</option>
          <option value="deduction">临界推演</option>
        </select>
      </label>
      <template v-if="showModeFilters">
        <label v-if="showVersionFilter" class="env-field env-field--sm">
          <span>版本</span>
          <select v-model="version">
            <option value="">请选择</option>
            <option v-for="ver in versionOptions" :key="ver" :value="ver">
              {{ ver }}
            </option>
          </select>
        </label>
        <label
          class="env-field"
          :class="mode === 'deduction' ? 'env-field--period' : 'env-field--sm'"
        >
          <span>期数</span>
          <select v-model="phaseId">
            <option value="">请选择</option>
            <option v-for="opt in phaseOptionsForSelect" :key="opt.id" :value="opt.id">
              {{ phaseSelectLabel(opt) }}
            </option>
          </select>
        </label>
        <label v-if="showDefenseFrontier" class="env-field env-field--sm">
          <span>防线</span>
          <select v-model="frontierId">
            <option value="">请选择</option>
            <option v-for="opt in frontierOptions ?? []" :key="opt.id" :value="opt.id">
              {{ opt.label }}
            </option>
          </select>
        </label>
        <label v-if="showDeductionNode" class="env-field env-field--sm">
          <span>节点</span>
          <select v-model="nodeId">
            <option value="">全部战斗节点</option>
            <option v-for="opt in nodeOptions ?? []" :key="opt.id" :value="opt.id">
              {{ opt.label }}
            </option>
          </select>
        </label>
      </template>
    </div>
    <p v-if="hint" class="env-buff-hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.env-buff-filter {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
}

.env-buff-filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: end;
}

.env-field {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  min-width: 9.5rem;
  font-size: 0.72rem;
}

.env-field--sm {
  min-width: 6.5rem;
}

.env-field--period {
  min-width: 11rem;
}

.env-field span {
  opacity: 0.7;
  line-height: 1.2;
}

.env-field select {
  border: 1px solid #3a4456;
  border-radius: 6px;
  background: #0f141f;
  color: #e8eefc;
  padding: 0.22rem 0.4rem;
  font: inherit;
  font-size: 0.72rem;
  min-height: 1.7rem;
}

.env-buff-hint {
  margin: 0;
  font-size: 0.68rem;
  line-height: 1.35;
  opacity: 0.7;
}
</style>
