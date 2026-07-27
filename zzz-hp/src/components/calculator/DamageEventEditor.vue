<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  DamageEvent,
  DamageEventMultOverrides,
  SkillCategoryId,
  SkillSubcategory,
} from '@/types/calculator'
import { SKILL_CATEGORY_OPTIONS } from '@/types/calculator'
import { createEmptyDamageEvent, DAMAGE_EVENT_KIND_OPTIONS } from '@/utils/damageEvent'

const props = withDefaults(
  defineProps<{
    modelValue: DamageEvent[]
    skillSubcategories: SkillSubcategory[]
    agentId?: string
    /** 嵌入弹窗时去掉外边框，仅保留编辑区 */
    embedded?: boolean
    /** 模式类型，控制 kind 选择和倍率展示 */
    modeType?: 'direct' | 'anomaly'
    /** 队伍中可用的异常触发角色 */
    triggerAgentOptions?: { id: string; name: string }[]
  }>(),
  { embedded: false, modeType: 'direct' },
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

function eventSummary(event: DamageEvent) {
  const kind =
    DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === event.kind)?.label ?? event.kind
  const cat = SKILL_CATEGORY_OPTIONS.find((item) => item.id === event.categoryId)?.label ?? ''
  const sub = event.skillSubcategoryId
    ? props.skillSubcategories.find((item) => item.id === event.skillSubcategoryId)?.name
    : '整大类'
  return `${kind} · ${cat} · ${sub} ×${event.count}`
}

function addEvent() {
  const next = createEmptyDamageEvent(events.value.length)
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

/** 读取事件的倍率覆写值；null/undefined 表示使用默认 */
function getMultOverride(event: DamageEvent, key: keyof DamageEventMultOverrides): number | null {
  return event.multOverrides?.[key] ?? null
}

function setMultOverride(eventId: string, key: keyof DamageEventMultOverrides, raw: string) {
  const current = events.value.find((item) => item.id === eventId)
  if (!current) return
  const parsed = raw.trim() === '' ? null : Number(raw)
  const value = parsed !== null && !Number.isFinite(parsed) ? null : parsed
  const overrides: DamageEventMultOverrides = { ...current.multOverrides, [key]: value }
  updateEvent(eventId, { multOverrides: overrides })
}

const DIRECT_MULT_FIELDS: { key: keyof DamageEventMultOverrides; label: string }[] = [
  { key: 'directDmgMult', label: '直伤倍率%' },
]

const ANOMALY_MULT_FIELDS: { key: keyof DamageEventMultOverrides; label: string }[] = [
  { key: 'anomalyMult', label: '异常倍率%' },
  { key: 'anomalyReleaseMult', label: '异放倍率%' },
  { key: 'disorderBaseMult', label: '紊乱基础倍率%' },
  { key: 'disorderCompMult', label: '紊乱补偿倍率%' },
  { key: 'turbulenceBaseMult', label: '乱流基础倍率%' },
  { key: 'turbulenceCompMult', label: '乱流补偿倍率%' },
]

const currentMultFields = computed(() =>
  props.modeType === 'direct' ? DIRECT_MULT_FIELDS : ANOMALY_MULT_FIELDS,
)

const needsTriggerAgent = computed(() => {
  if (!selectedEvent.value) return false
  const kind = selectedEvent.value.kind
  return kind === 'disorder' || kind === 'turbulence' || kind === 'anomalyRelease'
})

const directKindOptions = computed(() =>
  DAMAGE_EVENT_KIND_OPTIONS.filter((opt) => opt.id === 'direct'),
)

const anomalyKindOptions = computed(() =>
  DAMAGE_EVENT_KIND_OPTIONS.filter((opt) => opt.id !== 'direct'),
)

const filteredKindOptions = computed(() =>
  props.modeType === 'direct' ? directKindOptions.value : anomalyKindOptions.value,
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
                updateEvent(selectedEvent!.id, {
                  kind: ($event.target as HTMLSelectElement).value as DamageEvent['kind'],
                })
              "
            >
              <option v-for="opt in filteredKindOptions" :key="opt.id" :value="opt.id">
                {{ opt.label }}
              </option>
            </select>
          </label>
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
        <div class="field-row">
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

        <div v-if="needsTriggerAgent && triggerAgentOptions?.length" class="field-row">
          <label class="field">
            <span>触发角色</span>
            <select
              :value="selectedEvent!.triggerAgentId ?? ''"
              @change="
                updateEvent(selectedEvent!.id, {
                  triggerAgentId: ($event.target as HTMLSelectElement).value || null,
                })
              "
            >
              <option value="">待设置</option>
              <option v-for="agent in triggerAgentOptions" :key="agent.id" :value="agent.id">
                {{ agent.name }}
              </option>
            </select>
          </label>
        </div>

        <div v-if="currentMultFields.length" class="mult-section">
          <h5 class="mult-title">倍率区（留空使用默认）</h5>
          <div class="field-row">
            <label v-for="mf in currentMultFields" :key="mf.key" class="field">
              <span>{{ mf.label }}</span>
              <input
                type="number"
                step="any"
                :value="getMultOverride(selectedEvent!, mf.key)"
                :placeholder="'默认'"
                @input="setMultOverride(selectedEvent!.id, mf.key, ($event.target as HTMLInputElement).value)"
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

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 8rem;
  flex: 1;
}

.field span {
  font-size: 0.76rem;
  color: #9aa3b0;
}

.field select,
.field input {
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
