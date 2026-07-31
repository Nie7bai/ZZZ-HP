<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  BuffApplySituation,
  BuffApplyTarget,
  BuffScope,
  BuffSkillTargetId,
  BuffStatKey,
  SkillCategoryId,
} from '@/types/calculator'
import {
  BUFF_SCOPE_OPTIONS,
  BUFF_SKILL_TARGET_OPTIONS,
} from '@/types/calculator'
import { BUFF_STAT_FIELDS, buffStatFieldLabel } from '@/utils/calculatorUi'
import { scopeLabel } from '@/utils/extraBuffCalc'

export interface ExtraBuffGain {
  id: string
  name: string
  stat: BuffStatKey
  value: number
  /** 作用情况，默认全局 */
  applySituation?: BuffApplySituation
  /** 作用域，默认通用 */
  scope?: BuffScope
  /** 作用目标，默认自身 */
  applyTarget?: BuffApplyTarget
  /** 招式 scope 时的大类（兼容字段） */
  skillCategory?: BuffSkillTargetId
  /** 招式 scope 时的小类；空 = 整大类 */
  skillSubcategoryId?: string | null
  /** 异常结算是否也吃这条效果（招式 scope） */
  appliesToAnomaly?: boolean
}

const props = defineProps<{
  skillSubcategories?: Array<{
    id: string
    agentId: string
    categoryId: SkillCategoryId
    name: string
  }>
}>()

const gains = defineModel<ExtraBuffGain[]>({ required: true })

const draftName = ref('自定义增益')
const draftStat = ref<BuffStatKey>('dmgBonus')
const draftValue = ref(0)
const draftSituation = ref<BuffApplySituation>('global')
const draftScope = ref<BuffScope>('general')
const draftApplyTarget = ref<BuffApplyTarget>('self')
const draftSkillCategory = ref<BuffSkillTargetId>('basic')
const draftSkillSubcategoryId = ref<string>('')
const draftAppliesToAnomaly = ref(false)

const SITUATION_LABELS: Record<BuffApplySituation, string> = {
  global: '全局',
  stagger: '失衡期',
  non_stagger: '非失衡期',
}

const APPLY_TARGET_LABELS: Record<BuffApplyTarget, string> = {
  self: '自身',
  team: '全队（含自己）',
}

const draftSubcategories = computed(() =>
  (props.skillSubcategories ?? []).filter(
    (item) => item.categoryId === draftSkillCategory.value,
  ),
)

function addGain() {
  const name = draftName.value.trim() || '自定义增益'
  const gain: ExtraBuffGain = {
    id: `extra-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    stat: draftStat.value,
    value: Number.isFinite(draftValue.value) ? draftValue.value : 0,
    applySituation: draftSituation.value,
    scope: draftScope.value,
    applyTarget: draftApplyTarget.value,
  }
  if (draftScope.value === 'skill') {
    gain.skillCategory = draftSkillCategory.value
    gain.skillSubcategoryId = draftSkillSubcategoryId.value || null
    if (draftAppliesToAnomaly.value) gain.appliesToAnomaly = true
  }
  gains.value = [...gains.value, gain]
  draftValue.value = 0
  draftSituation.value = 'global'
  draftScope.value = 'general'
  draftApplyTarget.value = 'self'
  draftSkillSubcategoryId.value = ''
  draftAppliesToAnomaly.value = false
}

function removeGain(id: string) {
  gains.value = gains.value.filter((item) => item.id !== id)
}

function situationLabel(value?: BuffApplySituation) {
  return SITUATION_LABELS[value ?? 'global']
}

function skillTargetSummary(item: ExtraBuffGain): string {
  if (item.scope !== 'skill') return ''
  const cat =
    BUFF_SKILL_TARGET_OPTIONS.find((opt) => opt.id === item.skillCategory)?.label ??
    item.skillCategory ??
    '招式'
  if (!item.skillSubcategoryId) return cat
  const sub = props.skillSubcategories?.find((s) => s.id === item.skillSubcategoryId)
  return sub ? `${cat} · ${sub.name}` : cat
}

function gainMeta(item: ExtraBuffGain): string {
  const parts = [
    scopeLabel(item.scope),
    APPLY_TARGET_LABELS[item.applyTarget ?? 'self'],
    situationLabel(item.applySituation),
  ]
  const skill = skillTargetSummary(item)
  if (skill) parts.push(skill)
  if (item.appliesToAnomaly) parts.push('异常也生效')
  return parts.join(' · ')
}
</script>

<template>
  <div class="extra-buff-editor">
    <p class="extra-buff-hint">
      额外 Buff 添加后立即参与计算：按作用域/目标/失衡情况过滤，有伤害事件时按各事件的产生角色（owner）匹配。
    </p>
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
        <span>作用域</span>
        <select v-model="draftScope">
          <option v-for="opt in BUFF_SCOPE_OPTIONS" :key="opt.id" :value="opt.id">
            {{ opt.label }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>目标</span>
        <select v-model="draftApplyTarget">
          <option value="self">自身</option>
          <option value="team">全队（含自己）</option>
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
      <template v-if="draftScope === 'skill'">
        <label class="field">
          <span>招式大类</span>
          <select v-model="draftSkillCategory" @change="draftSkillSubcategoryId = ''">
            <option v-for="opt in BUFF_SKILL_TARGET_OPTIONS" :key="opt.id" :value="opt.id">
              {{ opt.label }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>招式小类</span>
          <select v-model="draftSkillSubcategoryId">
            <option value="">整大类</option>
            <option v-for="sub in draftSubcategories" :key="sub.id" :value="sub.id">
              {{ sub.name }}
            </option>
          </select>
        </label>
        <label class="field field-check">
          <input v-model="draftAppliesToAnomaly" type="checkbox" />
          <span>异常结算时也生效</span>
        </label>
      </template>
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
            +{{ item.value }} · {{ gainMeta(item) }}
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

.extra-buff-hint {
  margin: 0;
  font-size: 0.78rem;
  color: var(--calc-muted, #9aa3b5);
  line-height: 1.45;
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

.field-check {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
  padding-bottom: 0.35rem;
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
