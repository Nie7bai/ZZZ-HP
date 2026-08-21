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
import { BUFF_STAT_FIELDS, AGENT_ROLES, buffStatFieldLabel } from '@/utils/calculatorUi'
import { formatTeamProfessionGateLabel } from '@/utils/buffEffect'
import {
  extraGainApplySlotLabel,
  normalizeExtraGain,
  resolveExtraGainApplySlot,
  scopeLabel,
  type ExtraBuffApplySlot,
} from '@/utils/extraBuffCalc'
import { teamSlotDisplayLabel } from '@/utils/teamSlotLabel'
import type { AgentBuffDoc } from '@/types/calculator'

export interface ExtraBuffGain {
  id: string
  name: string
  stat: BuffStatKey
  value: number
  /** 作用情况，默认全局 */
  applySituation?: BuffApplySituation
  /** 作用域，默认通用 */
  scope?: BuffScope
  /** 作用目标；与 applySlot 同步，team=全队，self=指定槽位 */
  applyTarget?: BuffApplyTarget
  /** 作用槽位：'team' = 全队；0/1/2 = 角色1/2/3。旧 self 视为 0 */
  applySlot?: ExtraBuffApplySlot
  /** 受益职业；空 = 不限 */
  applyProfession?: string | null
  /** 队内职业人数条件；空 = 不限 */
  teamProfession?: string | null
  /** 启用的人数档（非 null = 该人数生效） */
  teamProfessionValues?: Array<number | null> | null
  /** @deprecated */
  teamProfessionMinCount?: number | null
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
  teamSlots?: Array<{ agentId?: string | null }>
  agents?: AgentBuffDoc[]
}>()

const gains = defineModel<ExtraBuffGain[]>({ required: true })

const draftName = ref('自定义增益')
const draftStat = ref<BuffStatKey>('dmgBonus')
const draftValue = ref(0)
const draftSituation = ref<BuffApplySituation>('global')
const draftScope = ref<BuffScope>('general')
const draftApplySlot = ref<ExtraBuffApplySlot>(0)
const draftApplyProfession = ref('')
const draftTeamProfession = ref('')
const draftTeamProfessionValues = ref<Array<number | null>>([null, null, null])
const draftSkillCategory = ref<BuffSkillTargetId>('basic')
const draftSkillSubcategoryId = ref<string>('')
const draftAppliesToAnomaly = ref(false)

const SITUATION_LABELS: Record<BuffApplySituation, string> = {
  global: '全局',
  stagger: '失衡期',
  non_stagger: '非失衡期',
}

const slotOptions = computed(() => {
  const slots = props.teamSlots ?? [{ agentId: '' }, { agentId: '' }, { agentId: '' }]
  const agents = props.agents ?? []
  return [0, 1, 2].map((index) => ({
    value: index,
    label: teamSlotDisplayLabel(slots[index] ?? { agentId: '' }, index, agents),
  }))
})

const draftSubcategories = computed(() =>
  (props.skillSubcategories ?? []).filter(
    (item) => item.categoryId === draftSkillCategory.value,
  ),
)

function onDraftTeamProfessionChange() {
  if (!draftTeamProfession.value) {
    draftTeamProfessionValues.value = [null, null, null]
  }
}

function isDraftTierOn(index: number) {
  return draftTeamProfessionValues.value[index] != null
}

function setDraftTierOn(index: number, on: boolean) {
  const next = [...draftTeamProfessionValues.value]
  next[index] = on ? 0 : null
  draftTeamProfessionValues.value = next
}

function addGain() {
  const name = draftName.value.trim() || '自定义增益'
  const gain: ExtraBuffGain = {
    id: `extra-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    stat: draftStat.value,
    value: Number.isFinite(draftValue.value) ? draftValue.value : 0,
    applySituation: draftSituation.value,
    scope: draftScope.value,
    applySlot: draftApplySlot.value,
    applyTarget: draftApplySlot.value === 'team' ? 'team' : 'self',
  }
  if (draftApplyProfession.value.trim()) {
    gain.applyProfession = draftApplyProfession.value.trim()
  }
  if (draftTeamProfession.value.trim()) {
    gain.teamProfession = draftTeamProfession.value.trim()
    gain.teamProfessionValues = [...draftTeamProfessionValues.value]
  }
  if (draftScope.value === 'skill') {
    gain.skillCategory = draftSkillCategory.value
    gain.skillSubcategoryId = draftSkillSubcategoryId.value || null
    if (draftAppliesToAnomaly.value) gain.appliesToAnomaly = true
  }
  gains.value = [...gains.value, normalizeExtraGain(gain)]
  draftValue.value = 0
  draftSituation.value = 'global'
  draftScope.value = 'general'
  draftApplySlot.value = 0
  draftApplyProfession.value = ''
  draftTeamProfession.value = ''
  draftTeamProfessionValues.value = [null, null, null]
  draftSkillSubcategoryId.value = ''
  draftAppliesToAnomaly.value = false
}

function removeGain(id: string) {
  gains.value = gains.value.filter((item) => item.id !== id)
}

function parseApplySlot(value: string): ExtraBuffApplySlot {
  return value === 'team' ? 'team' : Number(value)
}

function setGainApplySlot(id: string, value: string) {
  const applySlot = parseApplySlot(value)
  gains.value = gains.value.map((item) =>
    item.id === id
      ? normalizeExtraGain({
          ...item,
          applySlot,
          applyTarget: applySlot === 'team' ? 'team' : 'self',
        })
      : item,
  )
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
    extraGainApplySlotLabel(item, props.teamSlots ?? [], props.agents ?? []),
  ]
  if (item.applyProfession?.trim()) {
    parts.push(`职业·${item.applyProfession.trim()}`)
  }
  const gate = formatTeamProfessionGateLabel(item)
  if (gate) parts.push(gate)
  parts.push(situationLabel(item.applySituation))
  const skill = skillTargetSummary(item)
  if (skill) parts.push(skill)
  if (item.appliesToAnomaly) parts.push('异常也生效')
  return parts.join(' · ')
}
</script>

<template>
  <div class="extra-buff-editor">
    <p class="extra-buff-hint">
      额外 Buff 添加后立即参与计算。目标按槽位固定（全队或角色1/2/3），切换编辑中角色不会改作用对象。队内职业人数条件只限制何时生效，不改变数值本身。
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
        <span>作用对象</span>
        <select
          :value="draftApplySlot"
          @change="draftApplySlot = parseApplySlot(($event.target as HTMLSelectElement).value)"
        >
          <option value="team">全队</option>
          <option v-for="opt in slotOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>职业</span>
        <select v-model="draftApplyProfession">
          <option value="">不限</option>
          <option v-for="role in AGENT_ROLES" :key="role" :value="role">
            {{ role }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>队内职业人数条件</span>
        <select v-model="draftTeamProfession" @change="onDraftTeamProfessionChange">
          <option value="">不限</option>
          <option v-for="role in AGENT_ROLES" :key="`gate-${role}`" :value="role">
            {{ role }}
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

    <div v-if="draftTeamProfession" class="team-prof-tiers">
      <span class="tiers-label">何时生效（勾选人数）</span>
      <div class="team-prof-tier-row">
        <label v-for="n in 3" :key="`draft-tier-${n}`" class="tier-cell">
          <span class="tier-head">
            <input
              type="checkbox"
              :checked="isDraftTierOn(n - 1)"
              @change="setDraftTierOn(n - 1, ($event.target as HTMLInputElement).checked)"
            />
            <span>恰好{{ n }}人时生效</span>
          </span>
        </label>
      </div>
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
        <select
          class="item-slot-select"
          :value="String(resolveExtraGainApplySlot(item))"
          @change="setGainApplySlot(item.id, ($event.target as HTMLSelectElement).value)"
        >
          <option value="team">全队</option>
          <option v-for="opt in slotOptions" :key="`item-${item.id}-${opt.value}`" :value="String(opt.value)">
            {{ opt.label }}
          </option>
        </select>
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
  border: 1px solid var(--calc-border, rgba(255, 255, 255, 0.12));
  border-radius: 8px;
  background: var(--calc-panel, #151922);
  color: var(--calc-text, #edf1f7);
  padding: 0.42rem 0.55rem;
  font-size: 0.82rem;
}

.team-prof-tiers {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.tiers-label {
  font-size: 0.78rem;
  color: var(--calc-muted, #c9d0dc);
}

.team-prof-tier-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.55rem;
}

.tier-cell {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  border: 1px solid var(--calc-border, rgba(255, 255, 255, 0.12));
  border-radius: 8px;
  padding: 0.45rem 0.55rem;
  background: var(--calc-panel, #151922);
}

.tier-head {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  color: var(--calc-text, #edf1f7);
}

.add-btn,
.remove-btn {
  border: 1px solid var(--calc-border, rgba(255, 255, 255, 0.14));
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--calc-text, #edf1f7);
  padding: 0.45rem 0.7rem;
  cursor: pointer;
  font-size: 0.8rem;
}

.extra-buff-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.extra-buff-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border: 1px solid var(--calc-border, rgba(255, 255, 255, 0.1));
  border-radius: 10px;
  padding: 0.55rem 0.7rem;
}

.item-slot-select {
  flex-shrink: 0;
  max-width: 8.5rem;
  border: 1px solid var(--calc-border, rgba(255, 255, 255, 0.12));
  border-radius: 8px;
  background: var(--calc-panel, #151922);
  color: var(--calc-text, #edf1f7);
  padding: 0.32rem 0.45rem;
  font-size: 0.78rem;
}

.extra-buff-copy {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.extra-buff-copy strong {
  font-size: 0.88rem;
}

.extra-buff-copy span {
  font-size: 0.75rem;
  color: var(--calc-muted, #9aa3b5);
  word-break: break-word;
}

.extra-buff-empty {
  margin: 0;
  font-size: 0.78rem;
  color: var(--calc-muted, #9aa3b5);
}

@media (max-width: 900px) {
  .extra-buff-form {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .team-prof-tier-row {
    grid-template-columns: 1fr;
  }
}
</style>
