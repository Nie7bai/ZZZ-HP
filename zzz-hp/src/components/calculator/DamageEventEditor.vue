<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  DamageEvent,
  DamageEventMultOverrides,
  SkillCategoryId,
  SkillSubcategory,
} from '@/types/calculator'
import { SKILL_CATEGORY_OPTIONS, TRIGGER_AGENT_AT_CALC } from '@/types/calculator'
import {
  createEmptyDamageEvent,
  DAMAGE_EVENT_KIND_OPTIONS,
  eventNeedsAnomalyProducer,
} from '@/utils/damageEvent'

const props = withDefaults(
  defineProps<{
    modelValue: DamageEvent[]
    skillSubcategories: SkillSubcategory[]
    agentId?: string
    /** 嵌入弹窗时去掉外边框，仅保留编辑区 */
    embedded?: boolean
    /** 模式类型，控制 kind 选择和倍率展示 */
    modeType?: 'direct' | 'anomaly'
    /**
     * 当前属性异常的产生角色候选项。
     * 管理端可不传具体队友；配合 allowCalcTimeTrigger 显示「计算时选择」。
     */
    triggerAgentOptions?: { id: string; name: string }[]
    /** 管理端：允许配置为计算时再选产生角色 */
    allowCalcTimeTrigger?: boolean
    /** 计算页：队伍满足风 + 另一属性时乱流事件可参与计算 */
    turbulenceCalculable?: boolean
    /** 计算页：主 C 须为风属性才能计算乱流 */
    mainAgentElement?: string | null
    /** 计算页：按面板解析出的倍率默认值（覆写为空时展示） */
    resolveMultDefaults?: (
      event: DamageEvent,
    ) => Partial<Record<keyof DamageEventMultOverrides, number>>
  }>(),
  { embedded: false, modeType: 'direct', allowCalcTimeTrigger: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: DamageEvent[]]
}>()

const selectedEventId = ref('')

const events = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const selectedEvent = computed(() =>
  events.value.find((item) => item.id === selectedEventId.value),
)

watch(
  () => events.value.map((item) => item.id).join(','),
  () => {
    if (!events.value.length) {
      selectedEventId.value = ''
      return
    }
    if (!events.value.some((item) => item.id === selectedEventId.value)) {
      selectedEventId.value = events.value[0]!.id
    }
  },
  { immediate: true },
)

function filteredSubcategories(categoryId: SkillCategoryId) {
  return props.skillSubcategories.filter((item) => {
    if (item.categoryId !== categoryId) return false
    if (!props.agentId) return true
    return !item.agentId || item.agentId === props.agentId
  })
}

function isSkillBound(event: DamageEvent) {
  if (props.modeType === 'direct') return true
  return event.skillBound !== false
}

function eventSummary(event: DamageEvent) {
  const kind =
    DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === event.kind)?.label ?? event.kind
  if (!isSkillBound(event)) {
    return `${kind} · 无招式 ×${event.count}`
  }
  const cat = SKILL_CATEGORY_OPTIONS.find((item) => item.id === event.categoryId)?.label ?? ''
  const sub = event.skillSubcategoryId
    ? props.skillSubcategories.find((item) => item.id === event.skillSubcategoryId)?.name
    : '整大类'
  return `${kind} · ${cat} · ${sub} ×${event.count}`
}

function addEvent() {
  const defaultKind = props.modeType === 'anomaly' ? 'anomaly' : 'direct'
  const next = createEmptyDamageEvent(events.value.length, defaultKind)
  if (
    props.allowCalcTimeTrigger &&
    eventNeedsAnomalyProducer(defaultKind)
  ) {
    next.triggerAgentId = TRIGGER_AGENT_AT_CALC
  }
  events.value = [...events.value, next]
  selectedEventId.value = next.id
}

function removeEvent(id: string) {
  events.value = events.value.filter((item) => item.id !== id)
}

function updateEvent(id: string, patch: Partial<DamageEvent>) {
  events.value = events.value.map((item) => (item.id === id ? { ...item, ...patch } : item))
}

function onCategoryChange(event: DamageEvent, categoryId: SkillCategoryId) {
  updateEvent(event.id, { categoryId, skillSubcategoryId: null })
}

function onSkillBoundChange(event: DamageEvent, bound: boolean) {
  updateEvent(event.id, {
    skillBound: bound,
    ...(bound ? {} : { skillSubcategoryId: null }),
  })
}

function onKindChange(event: DamageEvent, kind: DamageEvent['kind']) {
  const patch: Partial<DamageEvent> = { kind }
  if (eventNeedsAnomalyProducer(kind)) {
    if (props.allowCalcTimeTrigger && !event.triggerAgentId) {
      patch.triggerAgentId = TRIGGER_AGENT_AT_CALC
    }
  } else {
    patch.triggerAgentId = null
  }
  updateEvent(event.id, patch)
}

const multDefaultsByEventId = computed(() => {
  const map = new Map<string, Partial<Record<keyof DamageEventMultOverrides, number>>>()
  if (!props.resolveMultDefaults) return map
  for (const event of events.value) {
    map.set(event.id, props.resolveMultDefaults(event))
  }
  return map
})

/** 读取事件倍率输入展示值：覆写优先，否则用面板解析默认 */
function getMultDisplayValue(
  event: DamageEvent,
  key: keyof DamageEventMultOverrides,
): number | '' {
  const override = event.multOverrides?.[key]
  if (override != null) return override
  const resolved = multDefaultsByEventId.value.get(event.id)?.[key]
  return resolved == null ? '' : resolved
}

function setMultOverride(eventId: string, key: keyof DamageEventMultOverrides, raw: string) {
  const current = events.value.find((item) => item.id === eventId)
  if (!current) return
  const trimmed = raw.trim()
  if (trimmed === '') {
    const overrides: DamageEventMultOverrides = { ...current.multOverrides, [key]: null }
    updateEvent(eventId, { multOverrides: overrides })
    return
  }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return
  const resolved = multDefaultsByEventId.value.get(current.id)?.[key]
  // 与默认值相同则清覆写，避免无意义覆盖
  if (resolved != null && parsed === resolved) {
    const overrides: DamageEventMultOverrides = { ...current.multOverrides, [key]: null }
    updateEvent(eventId, { multOverrides: overrides })
    return
  }
  const overrides: DamageEventMultOverrides = { ...current.multOverrides, [key]: parsed }
  updateEvent(eventId, { multOverrides: overrides })
}

const DIRECT_MULT_FIELDS: { key: keyof DamageEventMultOverrides; label: string }[] = [
  { key: 'directDmgMult', label: '直伤倍率%' },
  { key: 'directDmgMultFactor', label: '直伤倍率修正' },
]

const ANOMALY_MULT_FIELDS: { key: keyof DamageEventMultOverrides; label: string }[] = [
  { key: 'anomalyMult', label: '异常倍率%' },
  { key: 'anomalyMultFactor', label: '异常倍率修正' },
  { key: 'anomalyReleaseMult', label: '异放倍率%' },
  { key: 'anomalyReleaseMultFactor', label: '异放倍率修正' },
  { key: 'disorderBaseMult', label: '紊乱基础倍率%' },
  { key: 'disorderBaseMultFactor', label: '紊乱倍率修正' },
  { key: 'disorderCompMult', label: '紊乱补偿倍率%' },
  { key: 'turbulenceBaseMult', label: '乱流基础倍率%' },
  { key: 'turbulenceBaseMultFactor', label: '乱流倍率修正' },
  { key: 'turbulenceCompMult', label: '乱流补偿倍率%' },
]

const currentMultFields = computed(() => {
  if (props.modeType === 'direct') return DIRECT_MULT_FIELDS
  const event = selectedEvent.value
  if (!event) return ANOMALY_MULT_FIELDS
  if (event.kind === 'anomaly') {
    return ANOMALY_MULT_FIELDS.filter(
      (f) => f.key === 'anomalyMult' || f.key === 'anomalyMultFactor',
    )
  }
  if (event.kind === 'disorder') {
    return ANOMALY_MULT_FIELDS.filter((f) =>
      ['disorderBaseMult', 'disorderBaseMultFactor', 'disorderCompMult'].includes(f.key),
    )
  }
  if (event.kind === 'turbulence') {
    return ANOMALY_MULT_FIELDS.filter((f) =>
      ['turbulenceBaseMult', 'turbulenceBaseMultFactor', 'turbulenceCompMult'].includes(f.key),
    )
  }
  if (event.kind === 'anomalyRelease') {
    return ANOMALY_MULT_FIELDS.filter(
      (f) => f.key === 'anomalyReleaseMult' || f.key === 'anomalyReleaseMultFactor',
    )
  }
  return ANOMALY_MULT_FIELDS
})

const needsTriggerAgent = computed(() => {
  if (!selectedEvent.value) return false
  return eventNeedsAnomalyProducer(selectedEvent.value.kind)
})

const showTriggerSelect = computed(() => needsTriggerAgent.value)

const filteredKindOptions = computed(() =>
  props.modeType === 'direct'
    ? DAMAGE_EVENT_KIND_OPTIONS.filter((opt) => opt.id === 'direct')
    : DAMAGE_EVENT_KIND_OPTIONS.filter((opt) => opt.id !== 'direct'),
)

const turbulenceKindHint = computed(() => {
  if (props.modeType !== 'anomaly' || selectedEvent.value?.kind !== 'turbulence') return ''
  if (props.turbulenceCalculable !== false) return ''
  if (props.mainAgentElement && props.mainAgentElement !== '风') {
    return '当前条件不满足：乱流伤害仅主 C 为风属性时可计算，该事件将不参与伤害汇总'
  }
  return '当前条件不满足：乱流需队伍同时包含风属性与至少一个非风属性代理人，该事件将不参与伤害汇总'
})

watch(
  () => selectedEvent.value?.triggerAgentId,
  (next, prev) => {
    if (!selectedEvent.value || next === prev) return
    if (selectedEvent.value.kind !== 'anomalyRelease') return
    const current = selectedEvent.value
    if (!current.multOverrides) return
    const overrides = { ...current.multOverrides }
    let changed = false
    if (overrides.anomalyReleaseMult != null) {
      overrides.anomalyReleaseMult = null
      changed = true
    }
    if (overrides.anomalyReleaseMultFactor != null) {
      overrides.anomalyReleaseMultFactor = null
      changed = true
    }
    if (changed) {
      updateEvent(current.id, { multOverrides: overrides })
    }
  },
)
</script>

<template>
  <section class="damage-event-editor" :class="{ embedded }">
    <div class="editor-layout">
      <aside class="event-list">
        <button type="button" class="add-btn" @click="addEvent">+ 添加事件</button>
        <div v-if="!events.length" class="empty-hint">暂无伤害事件，点击上方添加</div>
        <button
          v-for="event in events"
          :key="event.id"
          type="button"
          class="event-item"
          :class="{ active: selectedEventId === event.id }"
          @click="selectedEventId = event.id"
        >
          {{ eventSummary(event) }}
        </button>
      </aside>

      <form v-if="selectedEvent" class="event-detail" @submit.prevent>
        <h4>事件详情</h4>
        <div class="field-row">
          <label v-if="filteredKindOptions.length > 1" class="field">
            <span>伤害种类</span>
            <select
              :value="selectedEvent!.kind"
              @change="
                onKindChange(
                  selectedEvent!,
                  ($event.target as HTMLSelectElement).value as DamageEvent['kind'],
                )
              "
            >
              <option
                v-for="opt in filteredKindOptions"
                :key="opt.id"
                :value="opt.id"
              >
                {{ opt.label }}
              </option>
            </select>
          </label>
          <p v-if="turbulenceKindHint" class="kind-hint">{{ turbulenceKindHint }}</p>
          <label class="field">
            <span>次数</span>
            <input
              type="number"
              min="0"
              step="1"
              :value="selectedEvent!.count"
              @input="
                updateEvent(selectedEvent!.id, {
                  count: Math.max(0, Number(($event.target as HTMLInputElement).value) || 0),
                })
              "
            />
          </label>
        </div>

        <div v-if="modeType === 'anomaly'" class="field-row">
          <label class="field field--checkbox">
            <span>绑定招式</span>
            <label class="checkbox-line">
              <input
                type="checkbox"
                :checked="isSkillBound(selectedEvent!)"
                @change="
                  onSkillBoundChange(
                    selectedEvent!,
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />
              <span>该事件按招式大类/小类结算（关闭则仅按伤害种类计算）</span>
            </label>
          </label>
        </div>

        <div v-if="isSkillBound(selectedEvent!)" class="field-row">
          <label class="field">
            <span>招式大类</span>
            <select
              :value="selectedEvent!.categoryId"
              @change="
                onCategoryChange(
                  selectedEvent!,
                  ($event.target as HTMLSelectElement).value as SkillCategoryId,
                )
              "
            >
              <option v-for="opt in SKILL_CATEGORY_OPTIONS" :key="opt.id" :value="opt.id">
                {{ opt.label }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>招式小类</span>
            <select
              :value="selectedEvent!.skillSubcategoryId ?? ''"
              @change="
                updateEvent(selectedEvent!.id, {
                  skillSubcategoryId: ($event.target as HTMLSelectElement).value || null,
                })
              "
            >
              <option value="">整大类</option>
              <option
                v-for="sub in filteredSubcategories(selectedEvent!.categoryId)"
                :key="sub.id"
                :value="sub.id"
              >
                {{ sub.name }}
              </option>
            </select>
          </label>
        </div>

        <div v-if="showTriggerSelect" class="field-row">
          <label class="field">
            <span>当前属性异常的产生角色</span>
            <select
              :value="selectedEvent!.triggerAgentId ?? ''"
              @change="
                updateEvent(selectedEvent!.id, {
                  triggerAgentId: ($event.target as HTMLSelectElement).value || null,
                })
              "
            >
              <option v-if="allowCalcTimeTrigger" :value="TRIGGER_AGENT_AT_CALC">
                计算时选择
              </option>
              <option v-if="!allowCalcTimeTrigger" value="">请选择产生角色</option>
              <option
                v-for="agent in triggerAgentOptions"
                :key="agent.id"
                :value="agent.id"
              >
                {{ agent.name }}
              </option>
            </select>
          </label>
        </div>

        <div v-if="currentMultFields.length" class="mult-section">
          <h5 class="mult-title">倍率 / 倍率修正</h5>
          <div class="field-row">
            <label v-for="mf in currentMultFields" :key="mf.key" class="field">
              <span>{{ mf.label }}</span>
              <input
                :key="`${selectedEvent!.id}-${selectedEvent!.kind}-${selectedEvent!.triggerAgentId ?? ''}-${mf.key}`"
                type="number"
                step="any"
                :value="getMultDisplayValue(selectedEvent!, mf.key)"
                :placeholder="resolveMultDefaults ? '面板默认' : '默认'"
                @input="
                  setMultOverride(
                    selectedEvent!.id,
                    mf.key,
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
            </label>
          </div>
        </div>

        <button type="button" class="remove-btn" @click="removeEvent(selectedEvent!.id)">
          删除此事件
        </button>
      </form>

      <p v-else class="detail-placeholder">选择左侧事件以编辑详情</p>
    </div>
  </section>
</template>

<style scoped>
.damage-event-editor {
  margin-top: 0.75rem;
  border: 1px solid #2d323a;
  border-radius: 12px;
  background: #10141a;
  padding: 0.75rem;
}

.damage-event-editor.embedded {
  margin-top: 0;
  border: none;
  background: transparent;
  padding: 0;
}

.editor-layout {
  display: grid;
  grid-template-columns: minmax(0, 220px) minmax(0, 1fr);
  gap: 0.75rem;
  align-items: start;
}

.event-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.add-btn {
  border: 1px dashed #3a424f;
  border-radius: 8px;
  background: transparent;
  color: #c9a55c;
  padding: 0.4rem 0.55rem;
  font-size: 0.8rem;
  cursor: pointer;
}

.event-item {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #d5dae4;
  padding: 0.45rem 0.55rem;
  font-size: 0.76rem;
  text-align: left;
  cursor: pointer;
}

.event-item.active {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.12);
  color: #f0d7a2;
}

.empty-hint,
.detail-placeholder {
  margin: 0;
  font-size: 0.78rem;
  color: #8f96a3;
}

.event-detail h4 {
  margin: 0 0 0.65rem;
  font-size: 0.88rem;
  color: #e8ebf0;
}

.field-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-bottom: 0.55rem;
}

.kind-hint {
  flex: 1 1 100%;
  margin: 0;
  font-size: 0.76rem;
  color: #c9a55c;
  line-height: 1.45;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 8rem;
  flex: 1;
}

.field--checkbox {
  min-width: 100%;
}

.checkbox-line {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  font-size: 0.8rem;
  color: #c5cdd8;
}

.field span {
  font-size: 0.76rem;
  color: #9aa3b0;
}

.field select,
.field input[type='number'],
.field input[type='text'] {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #ebedf0;
  padding: 0.4rem 0.55rem;
  font-size: 0.84rem;
}

.mult-section {
  margin-top: 0.45rem;
  padding-top: 0.45rem;
  border-top: 1px solid #2a2f36;
}

.mult-title {
  margin: 0 0 0.45rem;
  font-size: 0.8rem;
  color: #9aa3b0;
  font-weight: 500;
}

.remove-btn {
  margin-top: 0.35rem;
  border: 1px solid #5a3434;
  border-radius: 8px;
  background: rgba(180, 70, 70, 0.12);
  color: #e8a8a8;
  padding: 0.35rem 0.65rem;
  font-size: 0.78rem;
  cursor: pointer;
}

@media (max-width: 768px) {
  .editor-layout {
    grid-template-columns: 1fr;
  }
}
</style>
