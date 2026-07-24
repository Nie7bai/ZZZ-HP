<script setup lang="ts">
import { ref } from 'vue'
import type { BuffApplySituation, BuffStatKey } from '@/types/calculator'
import { BUFF_STAT_FIELDS, buffStatFieldLabel } from '@/utils/calculatorUi'

export interface ExtraBuffGain {
  id: string
  name: string
  stat: BuffStatKey
  value: number
  /** 作用情况，默认全局 */
  applySituation?: BuffApplySituation
}

const gains = defineModel<ExtraBuffGain[]>({ required: true })

const draftName = ref('自定义增益')
const draftStat = ref<BuffStatKey>('dmgBonus')
const draftValue = ref(0)
const draftSituation = ref<BuffApplySituation>('global')

const SITUATION_LABELS: Record<BuffApplySituation, string> = {
  global: '全局',
  stagger: '失衡期',
  non_stagger: '非失衡期',
}

function addGain() {
  const name = draftName.value.trim() || '自定义增益'
  gains.value = [
    ...gains.value,
    {
      id: `extra-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      stat: draftStat.value,
      value: Number.isFinite(draftValue.value) ? draftValue.value : 0,
      applySituation: draftSituation.value,
    },
  ]
  draftValue.value = 0
  draftSituation.value = 'global'
}

function removeGain(id: string) {
  gains.value = gains.value.filter((item) => item.id !== id)
}

function situationLabel(value?: BuffApplySituation) {
  return SITUATION_LABELS[value ?? 'global']
}
</script>

<template>
  <div class="extra-buff-editor">
    <div class="extra-buff-form">
      <label class="field">
        <span>名称</span>
        <input v-model="draftName" type="text" placeholder="自定义增益" />
      </label>
      <label class="field">
        <span>增益类型</span>
        <select v-model="draftStat">
          <option v-for="field in BUFF_STAT_FIELDS" :key="field.key" :value="field.key">
            {{ buffStatFieldLabel(field) }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>作用情况</span>
        <select v-model="draftSituation">
          <option value="global">全局</option>
          <option value="stagger">失衡期</option>
          <option value="non_stagger">非失衡期</option>
        </select>
      </label>
      <label class="field">
        <span>数值</span>
        <input v-model.number="draftValue" type="number" step="any" />
      </label>
      <button type="button" class="add-btn" @click="addGain">添加增益</button>
    </div>

    <ul v-if="gains.length" class="extra-buff-list">
      <li v-for="item in gains" :key="item.id" class="extra-buff-item">
        <div class="extra-buff-copy">
          <strong>{{ item.name }}</strong>
          <span>
            {{
              buffStatFieldLabel(
                BUFF_STAT_FIELDS.find((field) => field.key === item.stat) ?? {
                  key: item.stat,
                  label: item.stat,
                  unit: 'flat',
                  hint: '',
                },
              )
            }}
            +{{ item.value }} · {{ situationLabel(item.applySituation) }}
          </span>
        </div>
        <button type="button" class="remove-btn" @click="removeGain(item.id)">移除</button>
      </li>
    </ul>
    <p v-else class="extra-buff-empty">尚未添加额外 Buff 增益</p>
  </div>
</template>

<style scoped>
.extra-buff-editor {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.extra-buff-form {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
  gap: 0.55rem;
  align-items: end;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  font-size: 0.78rem;
  color: var(--calc-muted, #c9d0dc);
}

.field input,
.field select {
  border: 1px solid var(--calc-border, #4a5563);
  border-radius: 8px;
  background: var(--calc-input-bg, #1a1f2a);
  color: var(--calc-text, #e8ecf4);
  padding: 0.45rem 0.55rem;
}

.add-btn,
.remove-btn {
  border: 1px solid var(--calc-border, #4a5563);
  border-radius: 8px;
  background: var(--calc-surface-3, #243044);
  color: var(--calc-text, #e8ecf4);
  padding: 0.45rem 0.7rem;
  cursor: pointer;
  font-size: 0.8rem;
}

.remove-btn {
  background: transparent;
  color: #c45c5c;
  border-color: rgba(196, 92, 92, 0.45);
}

.extra-buff-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.extra-buff-item {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: center;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--calc-border, #3a4456);
  border-radius: 10px;
  background: var(--calc-surface-2, #161b24);
}

.extra-buff-copy {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.extra-buff-copy strong {
  font-size: 0.86rem;
  color: var(--calc-text, #e8ecf4);
}

.extra-buff-copy span {
  font-size: 0.76rem;
  color: var(--calc-muted, #9aa3b5);
}

.extra-buff-empty {
  margin: 0;
  font-size: 0.8rem;
  color: var(--calc-muted, #8b93a3);
}

@media (max-width: 900px) {
  .extra-buff-form {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
