<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import EnemyBossPickerModal from '@/components/calculator/EnemyBossPickerModal.vue'
import EnemyPresetCombo from '@/components/calculator/EnemyPresetCombo.vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import {
  ENEMY_DEFENSE_PRESETS,
  STAGGER_MULTIPLIER_PRESETS,
} from '@/utils/enemyInputPresets'
import {
  ENEMY_RESISTANCE_ELEMENTS,
  ENEMY_RESISTANCE_OPTIONS,
  createDefaultDamageEnemyInput,
  listActiveResistanceElements,
  normalizeDamageEnemyInput,
  resistanceTypeLabel,
  type DamageEnemyInput,
  type EnemyInputMode,
  type EnemyResistanceElement,
  type EnemyResistanceType,
} from '@/utils/enemyResistance'

const props = defineProps<{
  title?: string
  description?: string
}>()

const model = defineModel<DamageEnemyInput>({ required: true })

const inputMode = ref<EnemyInputMode>('database')
const bossModalOpen = ref(false)

function replaceModel(next: Partial<DamageEnemyInput>) {
  Object.assign(model.value, normalizeDamageEnemyInput({ ...model.value, ...next }))
}

function patchEnemyInput(patch: Partial<DamageEnemyInput>) {
  replaceModel(patch)
}

const sectionTitle = computed(() =>
  props.title === undefined ? '敌方与环境' : props.title.trim(),
)

const bossSelectionLabel = computed(() => {
  const input = model.value
  if (input.bossSource === 'boss_record' && input.bossRecordLabel) {
    return input.bossRecordLabel
  }
  if (input.bossName) {
    return input.bossName
  }
  return ''
})

const visibleResistanceElements = computed(() => {
  if (inputMode.value === 'manual') {
    return [...ENEMY_RESISTANCE_ELEMENTS]
  }
  return listActiveResistanceElements(model.value)
})

const hasBossApplied = computed(
  () =>
    model.value.bossSource === 'boss_info' ||
    model.value.bossSource === 'boss_record' ||
    Boolean(model.value.bossName),
)

watch(
  () => model.value.bossSource,
  (source) => {
    if (source === 'boss_info' || source === 'boss_record') {
      inputMode.value = 'database'
    }
  },
  { immediate: true },
)

function ensureElementResistanceMap() {
  const normalized = normalizeDamageEnemyInput(model.value)
  return normalized.elementResistance!
}

function setElementResistance(element: EnemyResistanceElement, value: EnemyResistanceType) {
  patchEnemyInput({
    elementResistance: {
      ...ensureElementResistanceMap(),
      [element]: value,
    },
  })
}

function applyBossInput(next: DamageEnemyInput) {
  replaceModel(next)
  inputMode.value = 'database'
}

function clearBossSelection() {
  // 整表回落默认敌方基础参数，避免沿用已选怪物的防御/抗性/失衡等残留
  Object.assign(model.value, createDefaultDamageEnemyInput())
}

function switchMode(mode: EnemyInputMode) {
  inputMode.value = mode
}
</script>

<template>
  <section class="enemy-environment">
    <header class="enemy-environment-header" :class="{ 'enemy-environment-header--no-title': !sectionTitle }">
      <div v-if="sectionTitle || description" class="enemy-environment-heading">
        <h3 v-if="sectionTitle" class="enemy-environment-title">{{ sectionTitle }}</h3>
        <p v-if="description" class="enemy-environment-desc">{{ description }}</p>
      </div>
      <div class="input-mode-toggle" role="tablist" aria-label="敌方输入模式">
        <button
          type="button"
          role="tab"
          class="mode-btn"
          :class="{ active: inputMode === 'manual' }"
          :aria-selected="inputMode === 'manual'"
          @click="switchMode('manual')"
        >
          手动输入
        </button>
        <button
          type="button"
          role="tab"
          class="mode-btn"
          :class="{ active: inputMode === 'database' }"
          :aria-selected="inputMode === 'database'"
          @click="switchMode('database')"
        >
          怪物基础库
        </button>
      </div>
    </header>

    <div v-if="inputMode === 'database'" class="database-panel">
      <button type="button" class="boss-select-trigger" @click="bossModalOpen = true">
        <div v-if="hasBossApplied" class="boss-select-content selected">
          <CalculatorAvatar
            v-if="model.bossImage"
            class="boss-select-avatar"
            :avatar-image="model.bossImage"
            :name="bossSelectionLabel"
          />
          <div class="boss-select-text">
            <span class="boss-select-label">已选怪物</span>
            <strong>{{ bossSelectionLabel }}</strong>
          </div>
        </div>
        <div v-else class="boss-select-content placeholder">
          <span class="boss-select-label">未选择怪物</span>
          <strong>点击打开列表选择 Boss</strong>
        </div>
        <span class="boss-select-action">选择</span>
      </button>
      <button
        v-if="hasBossApplied"
        type="button"
        class="clear-boss-btn"
        @click="clearBossSelection"
      >
        清除怪物
      </button>
      <p class="database-hint">应用后自动填入防御与失衡易伤；下方仅展示有弱点或有抗性的属性。</p>
    </div>

    <div class="enemy-fields grid four">
      <label class="field">
        <span>敌方防御</span>
        <EnemyPresetCombo
          :model-value="model.defense"
          :presets="ENEMY_DEFENSE_PRESETS"
          aria-label="敌方防御预设"
          @update:model-value="patchEnemyInput({ defense: $event })"
        />
      </label>

      <template v-if="inputMode === 'manual'">
        <label
          v-for="element in ENEMY_RESISTANCE_ELEMENTS"
          :key="`res-${element}`"
          class="field"
        >
          <span>{{ element }} · 抗性</span>
          <select
            :value="ensureElementResistanceMap()[element]"
            @change="
              setElementResistance(element, ($event.target as HTMLSelectElement).value as EnemyResistanceType)
            "
          >
            <option v-for="opt in ENEMY_RESISTANCE_OPTIONS" :key="opt.id" :value="opt.id">
              {{ opt.label }}
            </option>
          </select>
        </label>
      </template>

      <template v-else>
        <p v-if="!hasBossApplied" class="res-empty-hint span-row">
          未选怪物，当前使用默认敌方基础参数
        </p>
        <p v-else-if="!visibleResistanceElements.length" class="res-empty-hint span-row">
          当前怪物无额外弱点/抗性条目；可在「手动输入」模式中调整。
        </p>
        <label
          v-for="element in visibleResistanceElements"
          :key="`res-active-${element}`"
          class="field res-active-field"
        >
          <span>
            {{ element }} ·
            {{ resistanceTypeLabel(ensureElementResistanceMap()[element] ?? 'normal') }}
          </span>
          <select
            :value="ensureElementResistanceMap()[element]"
            @change="
              setElementResistance(element, ($event.target as HTMLSelectElement).value as EnemyResistanceType)
            "
          >
            <option v-for="opt in ENEMY_RESISTANCE_OPTIONS" :key="opt.id" :value="opt.id">
              {{ opt.label }}
            </option>
          </select>
        </label>
      </template>

      <label class="field">
        <span>易伤区（基础）</span>
        <input
          :value="model.vulnerableMultiplier"
          type="number"
          step="0.01"
          @input="
            patchEnemyInput({
              vulnerableMultiplier: Number(($event.target as HTMLInputElement).value),
            })
          "
        />
      </label>
      <label class="field">
        <span>失衡易伤区（基础）</span>
        <EnemyPresetCombo
          :model-value="model.staggerMultiplier"
          :presets="STAGGER_MULTIPLIER_PRESETS"
          step="0.01"
          aria-label="失衡易伤预设"
          @update:model-value="patchEnemyInput({ staggerMultiplier: $event })"
        />
      </label>
      <label class="field">
        <span>特殊乘区（基础）</span>
        <input
          :value="model.specialMultiplier"
          type="number"
          step="0.01"
          @input="
            patchEnemyInput({
              specialMultiplier: Number(($event.target as HTMLInputElement).value),
            })
          "
        />
      </label>
      <label class="field">
        <span>代理人等级</span>
        <input
          :value="model.level"
          type="number"
          min="1"
          max="60"
          step="1"
          @input="patchEnemyInput({ level: Number(($event.target as HTMLInputElement).value) })"
        />
      </label>
    </div>

    <EnemyBossPickerModal
      :open="bossModalOpen"
      :current-input="model"
      @close="bossModalOpen = false"
      @apply="applyBossInput"
    />
  </section>
</template>

<style scoped>
.enemy-environment {
  grid-column: 1 / -1;
}

.enemy-environment-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.65rem 1rem;
  margin-bottom: 0.65rem;
}

.enemy-environment-header--no-title {
  justify-content: flex-end;
  align-items: center;
}

.enemy-environment-heading {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
  flex: 1 1 auto;
}

.enemy-environment-title {
  margin: 0;
  font-size: 1.05rem;
  color: #f0f2f6;
}

.enemy-environment-desc {
  margin: 0;
  font-size: 0.8rem;
  color: #9aa3b0;
}

.input-mode-toggle {
  display: inline-flex;
  flex: 0 0 auto;
  margin-left: auto;
  padding: 0.2rem;
  border-radius: 999px;
  border: 1px solid #2d323a;
  background: #10141a;
}

.mode-btn {
  border: none;
  border-radius: 999px;
  background: transparent;
  color: #9aa3b2;
  padding: 0.28rem 0.85rem;
  font-size: 0.78rem;
  cursor: pointer;
  transition:
    color 0.18s,
    background-color 0.18s;
}

.mode-btn.active {
  background: rgba(201, 165, 92, 0.16);
  color: #e8d4a8;
}

.database-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  margin-bottom: 0.65rem;
}

.boss-select-trigger {
  flex: 1 1 280px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.55rem 0.75rem;
  border-radius: 10px;
  border: 1px solid #2d323a;
  background: #0f1217;
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition:
    border-color 0.18s,
    background-color 0.18s;
}

.boss-select-trigger:hover {
  border-color: #c9a55c;
  background: #141820;
}

.boss-select-content {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  min-width: 0;
}

.boss-select-content.selected {
  flex-direction: row;
  align-items: center;
  gap: 0.55rem;
}

.boss-select-text {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  min-width: 0;
}

.boss-select-avatar :deep(.calculator-avatar) {
  width: 40px;
  height: 40px;
  border-radius: 8px;
}

.boss-select-content.placeholder strong {
  color: #9aa3b2;
  font-weight: 500;
}

.boss-select-label {
  font-size: 0.72rem;
  color: #9aa3b2;
}

.boss-select-content strong {
  font-size: 0.86rem;
  color: #e8eaed;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.boss-select-action {
  flex-shrink: 0;
  font-size: 0.78rem;
  color: #e8d4a8;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: rgba(201, 165, 92, 0.12);
}

.clear-boss-btn {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: transparent;
  color: #9aa3b2;
  padding: 0.38rem 0.65rem;
  font-size: 0.78rem;
  cursor: pointer;
}

.clear-boss-btn:hover {
  color: #e8eaed;
  border-color: #4a5568;
}

.database-hint {
  flex: 1 1 100%;
  margin: 0;
  font-size: 0.76rem;
  color: #9aa3b2;
}

.grid {
  display: grid;
  gap: 0.55rem;
}

.grid.four {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.enemy-fields {
  margin-top: 0.15rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field span {
  font-size: 0.76rem;
  color: #aab2bf;
}

.field > input,
.field > select {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #ebedf0;
  padding: 0.44rem 0.54rem;
}

.res-empty-hint {
  margin: 0;
  font-size: 0.78rem;
  color: #9aa3b2;
  padding: 0.35rem 0.1rem;
}

.res-active-field span {
  color: #e8d4a8;
}

.span-row {
  grid-column: 1 / -1;
}

@media (max-width: 1100px) {
  .grid.four {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .grid.four {
    grid-template-columns: 1fr;
  }

  .field > input,
  .field > select {
    width: 100%;
    min-width: 0;
  }
}
</style>
