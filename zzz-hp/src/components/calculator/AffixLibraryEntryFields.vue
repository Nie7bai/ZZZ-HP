<script setup lang="ts">
/* 父组件把草稿对象传进来，表单就地改。v-for 行不能 v-model 迭代变量。 */
/* eslint-disable vue/no-mutating-props */
import { computed } from 'vue'
import {
  BUFF_SCOPE_OPTIONS,
  BUFF_SKILL_TARGET_OPTIONS,
} from '@/types/calculator'
import AffixTargetBranchSelect from '@/components/calculator/AffixTargetBranchSelect.vue'
import { affixPerRollUnit, isGainTarget } from '@/utils/affixLibrary'

export interface AffixLibraryEntryFormFields {
  label: string
  target: string
  perRoll: number
  cap: number
  group: string
  applySituation?: string
  scope?: string
  skillCategory?: string
  skillSubcategoryId?: string | null
  appliesToAnomaly?: boolean
  sortOrder?: number
  enabledByDefault?: boolean
  id?: string
  rollCost?: number
}

const props = withDefaults(
  defineProps<{
    entry: AffixLibraryEntryFormFields
    groups: { name: string }[]
    allowCustom?: boolean
    customTarget?: boolean
    showAdminExtras?: boolean
    emptyGroupLabel?: string
    disabled?: boolean
    targetHint?: string
    targetHintWarn?: boolean
    ruleHint?: string
    idNote?: string
    idMaxLength?: number
  }>(),
  {
    allowCustom: false,
    customTarget: false,
    showAdminExtras: false,
    emptyGroupLabel: '（未分组）',
    disabled: false,
    targetHint: '',
    targetHintWarn: false,
    ruleHint: '',
    idNote: '',
    idMaxLength: 64,
  },
)

const emit = defineEmits<{
  custom: []
  'commit-custom': []
  'id-input': []
}>()

const isGain = computed(() => isGainTarget(props.entry.target))
const perRollUnit = computed(() =>
  affixPerRollUnit(props.entry.target as Parameters<typeof affixPerRollUnit>[0]) === 'percent'
    ? '%'
    : '',
)

function applyPickedTarget(target: string) {
  props.entry.target = target
  if (!isGainTarget(target)) {
    props.entry.applySituation = undefined
    props.entry.scope = undefined
    props.entry.skillCategory = undefined
    props.entry.skillSubcategoryId = undefined
    props.entry.appliesToAnomaly = undefined
  } else if (!props.entry.scope) {
    props.entry.applySituation = 'global'
    props.entry.scope = 'general'
    props.entry.skillCategory = 'basic'
  }
}
</script>

<template>
  <div class="entry-fields">
    <label v-if="showAdminExtras" class="entry-fields--target">
      <span>
        ID
        <em v-if="idNote" class="field-note">{{ idNote }}</em>
      </span>
      <input
        v-model="entry.id"
        type="text"
        placeholder="如 main:slot4:critDmg"
        :maxlength="idMaxLength"
        :disabled="disabled"
        @input="emit('id-input')"
      />
    </label>
    <label>
      <span>名称</span>
      <input v-model="entry.label" type="text" :disabled="disabled" />
    </label>
    <label class="entry-fields--target">
      <span>目标</span>
      <AffixTargetBranchSelect
        v-if="!customTarget"
        :model-value="entry.target"
        :disabled="disabled"
        :allow-custom="allowCustom"
        @update:model-value="applyPickedTarget"
        @custom="emit('custom')"
      />
      <input
        v-else
        v-model="entry.target"
        class="target-input"
        type="text"
        placeholder="panel:xxx 或 gain:xxx"
        :disabled="disabled"
        @change="emit('commit-custom')"
      />
      <span v-if="customTarget && targetHint" class="target-hint" :class="{ 'target-hint--warn': targetHintWarn }">
        {{ targetHint }}
      </span>
    </label>
    <p v-if="ruleHint" class="entry-fields--hint">{{ ruleHint }}</p>
    <template v-if="isGain">
      <label>
        <span>作用情况</span>
        <select v-model="entry.applySituation" :disabled="disabled">
          <option value="global">全局</option>
          <option value="stagger">失衡期</option>
          <option value="non_stagger">非失衡期</option>
        </select>
      </label>
      <label>
        <span>作用域</span>
        <select v-model="entry.scope" :disabled="disabled">
          <option v-for="opt in BUFF_SCOPE_OPTIONS" :key="opt.id" :value="opt.id">
            {{ opt.label }}
          </option>
        </select>
      </label>
      <label v-if="entry.scope === 'skill'">
        <span>招式大类</span>
        <select v-model="entry.skillCategory" :disabled="disabled">
          <option v-for="opt in BUFF_SKILL_TARGET_OPTIONS" :key="opt.id" :value="opt.id">
            {{ opt.label }}
          </option>
        </select>
      </label>
      <label v-if="entry.scope === 'skill'" class="entry-fields--check">
        <span>异常结算</span>
        <span class="check-row">
          <input v-model="entry.appliesToAnomaly" type="checkbox" :disabled="disabled" />
          也生效
        </span>
      </label>
    </template>
    <label>
      <span>每档</span>
      <span class="per-roll-cell">
        <input v-model.number="entry.perRoll" type="number" step="0.1" min="0" :disabled="disabled" />
        <span class="unit-hint">{{ perRollUnit }}</span>
      </span>
    </label>
    <label>
      <span>上限（0=不限）</span>
      <input v-model.number="entry.cap" type="number" min="0" step="1" :disabled="disabled" />
    </label>
    <label v-if="showAdminExtras">
      <span>每档占用</span>
      <input
        v-model.number="entry.rollCost"
        type="number"
        min="0"
        step="1"
        title="每条词条占几个「总词条数」预算；用户侧固定为 1"
        :disabled="disabled"
      />
    </label>
    <label>
      <span>分组</span>
      <select v-model="entry.group" :disabled="disabled">
        <option value="">{{ emptyGroupLabel }}</option>
        <option v-for="group in groups" :key="group.name" :value="group.name">
          {{ group.name }}
        </option>
      </select>
    </label>
    <label v-if="showAdminExtras">
      <span>排序</span>
      <input v-model.number="entry.sortOrder" type="number" step="1" :disabled="disabled" />
    </label>
    <label v-if="showAdminExtras" class="entry-fields--check">
      <span>默认启用</span>
      <input v-model="entry.enabledByDefault" type="checkbox" :disabled="disabled" />
    </label>
    <slot />
  </div>
</template>

<style scoped>
.entry-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 0.4rem;
  align-items: end;
}

.entry-fields label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.76rem;
  color: var(--color-text, #9aa3b0);
  min-width: 0;
}

.entry-fields input,
.entry-fields select {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 0.2rem 0.35rem;
  border: 1px solid var(--color-border, #3a4049);
  border-radius: 7px;
  background: var(--color-background, #10131a);
  color: var(--color-heading, #e4e8ef);
  font: inherit;
  font-size: 0.8rem;
}

.entry-fields--target {
  grid-column: 1 / -1;
}

.entry-fields--hint {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 0.72rem;
  opacity: 0.75;
}

.entry-fields--check {
  flex-direction: row;
  align-items: center;
  gap: 0.35rem;
}

.entry-fields--check input[type='checkbox'] {
  width: auto;
}

.check-row {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.per-roll-cell {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  width: 100%;
}

.per-roll-cell > input {
  flex: 1 1 auto;
}

.unit-hint {
  flex: 0 0 0.62rem;
  width: 0.62rem;
  font-size: 0.75rem;
  line-height: 1.4;
  opacity: 0.6;
}

.target-hint {
  font-size: 0.7rem;
  opacity: 0.75;
}

.target-hint--warn {
  color: #e85d4c;
  opacity: 1;
}

.field-note {
  font-size: 0.68rem;
  font-style: normal;
  opacity: 0.7;
}
</style>
