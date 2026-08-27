<script setup lang="ts">
import { computed, watch } from 'vue'
import type {
  AgentBuffDoc,
  SkillDamageType,
  SkillSubcategory,
  SkillTypeId,
} from '@/types/calculator'
import { DAMAGE_EVENT_KIND_OPTIONS } from '@/utils/damageEvent'
import { skillNeedsDualAgents } from '@/utils/resolvedHit'
import {
  resolveInherentSkillMultPercent,
  skillMultNeedsAnomalyPowerProvider,
  unsetSkillMult,
} from '@/utils/skillSubcategoryMult'
import { SKILL_TYPE_OPTIONS } from '@/utils/skillTypes'

const draft = defineModel<{
  name: string
  damageType: SkillDamageType
  skillTypes: SkillTypeId[]
  buffAnchorId: string
  baseMult: number
  settlementMult: number
}>({ required: true })

const props = defineProps<{
  readonly?: boolean
  anchors: SkillSubcategory[]
  /** 用于读取「限定该锚点」的角色 Buff 固有倍率（如蕾米埃尔耀变） */
  agent?: AgentBuffDoc | null
  /**
   * 已结算的最终倍率区展示（如异放倍率区 0.7120）。
   * 选完异常强度提供者后由外部传入，优先于「等待选择」提示。
   */
  resolvedMultDisplay?: string | null
}>()

watch(
  () => draft.value.damageType,
  (type) => {
    if (props.readonly || !skillNeedsDualAgents(type)) return
    // 异常类仍不设招式类型；增益锚点可保留
    draft.value.skillTypes = []
  },
)

const damageTypeLabel = computed(
  () =>
    DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === draft.value.damageType)?.label ??
    draft.value.damageType,
)

const selectedAnchor = computed(() => {
  const id = draft.value.buffAnchorId?.trim()
  if (!id) return null
  return props.anchors.find((item) => item.id === id) ?? null
})

const anchorLabel = computed(() => selectedAnchor.value?.name ?? '无')

function resolveAnchorBaseMult(): number | null {
  // 紊乱/乱流：不预填基础倍率，有结算时用最终倍率区展示在「倍率%」
  if (draft.value.damageType === 'disorder' || draft.value.damageType === 'turbulence') {
    return null
  }
  return resolveInherentSkillMultPercent({
    damageType: draft.value.damageType,
    buffAnchorId: draft.value.buffAnchorId,
    subcategory: selectedAnchor.value,
    agent: props.agent,
    element: props.agent?.element,
  })
}

function resolveAnchorSettlement(): number | null {
  if (draft.value.damageType !== 'direct' || !selectedAnchor.value) return null
  const value = Number(selectedAnchor.value.settlementDmgMult)
  return unsetSkillMult(value) ? null : value
}

/** 选锚点 / 改伤害类型时写入字段；数据就绪时仅在基础倍率为空时回填固有值 */
function applyAnchorMults(force: boolean) {
  if (props.readonly) return
  const mult = resolveAnchorBaseMult()
  if (mult != null && (force || unsetSkillMult(draft.value.baseMult))) {
    draft.value.baseMult = mult
  } else if (force && mult == null) {
    // 新类型无固有（如异放）时清掉旧类型残留，避免异常↔紊乱↔异放串值
    draft.value.baseMult = 0
  }
  const settlement = resolveAnchorSettlement()
  if (settlement != null && (force || unsetSkillMult(draft.value.settlementMult))) {
    draft.value.settlementMult = settlement
  } else if (force && settlement == null) {
    draft.value.settlementMult = 0
  }
}

/** 用户改伤害类型：先写入新类型，再按新类型重填固有倍率 */
function onDamageTypeUserChange(event: Event) {
  if (props.readonly) return
  const next = (event.target as HTMLSelectElement).value as SkillDamageType
  draft.value.damageType = next
  if (skillNeedsDualAgents(next)) draft.value.skillTypes = []
  applyAnchorMults(true)
}

/** 用户改锚点：按当前伤害类型重填固有倍率 */
function onAnchorUserChange() {
  applyAnchorMults(true)
}

watch(
  () =>
    [
      draft.value.buffAnchorId,
      draft.value.damageType,
      selectedAnchor.value?.id ?? '',
      props.agent?.id ?? '',
      props.agent?.element ?? '',
    ] as const,
  () => applyAnchorMults(false),
  { immediate: true },
)

const baseMultPlaceholder = computed(() => {
  if (props.resolvedMultDisplay) return props.resolvedMultDisplay
  if (skillMultNeedsAnomalyPowerProvider(draft.value.damageType)) {
    return '等待选择异常强度提供者'
  }
  return '可不填'
})

/** 未填时输入框留空，不默认显 0；有结算最终倍率时优先显示（紊乱/乱流不挡在已填基础倍率前） */
const baseMultInput = computed({
  get: () => {
    const type = draft.value.damageType
    if (
      (type === 'disorder' || type === 'turbulence') &&
      props.resolvedMultDisplay
    ) {
      return props.resolvedMultDisplay
    }
    if (!unsetSkillMult(draft.value.baseMult)) return draft.value.baseMult
    if (props.resolvedMultDisplay) return props.resolvedMultDisplay
    return ''
  },
  set: (value: string | number) => {
    if (value === '' || value == null) {
      draft.value.baseMult = 0
      return
    }
    const next = Number(value)
    draft.value.baseMult = Number.isFinite(next) ? next : 0
  },
})

const settlementMultInput = computed({
  get: () => (unsetSkillMult(draft.value.settlementMult) ? '' : draft.value.settlementMult),
  set: (value: string | number) => {
    if (value === '' || value == null) {
      draft.value.settlementMult = 0
      return
    }
    const next = Number(value)
    draft.value.settlementMult = Number.isFinite(next) ? next : 0
  },
})

/** 只读：紊乱/乱流优先最终倍率区 → 填写值 → 固有 → 等待提示 */
const readonlyBaseMultDisplay = computed(() => {
  const type = draft.value.damageType
  if (
    (type === 'disorder' || type === 'turbulence') &&
    props.resolvedMultDisplay
  ) {
    return props.resolvedMultDisplay
  }
  const filled = Number(draft.value.baseMult)
  if (!unsetSkillMult(filled)) return String(filled)
  if (props.resolvedMultDisplay) return props.resolvedMultDisplay
  const fromAnchor = resolveAnchorBaseMult()
  if (fromAnchor != null) return String(fromAnchor)
  if (skillMultNeedsAnomalyPowerProvider(type)) {
    return '等待选择异常强度提供者'
  }
  // 紊乱/乱流未结算时回落属性默认基础倍率，仅作占位
  if (type === 'disorder' || type === 'turbulence') {
    const inherent = resolveInherentSkillMultPercent({
      damageType: type,
      buffAnchorId: draft.value.buffAnchorId,
      subcategory: selectedAnchor.value,
      agent: props.agent,
      element: props.agent?.element,
    })
    if (inherent != null) return String(inherent)
  }
  return ''
})

const readonlySettlementDisplay = computed(() => {
  const filled = Number(draft.value.settlementMult)
  if (!unsetSkillMult(filled)) return String(filled)
  const fromAnchor = resolveAnchorSettlement()
  if (fromAnchor != null) return String(fromAnchor)
  return ''
})

const multFieldLabel = computed(() => {
  const type = draft.value.damageType
  if (type === 'disorder' || type === 'turbulence') return '最终倍率%'
  return '倍率%'
})

function toggleSkillType(id: SkillTypeId) {
  if (props.readonly) return
  const index = draft.value.skillTypes.indexOf(id)
  if (index >= 0) draft.value.skillTypes.splice(index, 1)
  else draft.value.skillTypes.push(id)
}
</script>

<template>
  <div class="custom-form" :class="{ 'is-readonly': readonly }">
    <label>
      <span>名称</span>
      <input v-if="readonly" :value="draft.name" type="text" readonly tabindex="-1" />
      <input v-else v-model="draft.name" placeholder="显示名称" />
    </label>
    <label>
      <span>伤害类型</span>
      <input v-if="readonly" :value="damageTypeLabel" type="text" readonly tabindex="-1" />
      <select v-else :value="draft.damageType" @change="onDamageTypeUserChange">
        <option v-for="opt in DAMAGE_EVENT_KIND_OPTIONS" :key="opt.id" :value="opt.id">
          {{ opt.label }}
        </option>
      </select>
    </label>
    <div v-if="!skillNeedsDualAgents(draft.damageType)" class="type-checks">
      <span>招式类型（可多选，可空）</span>
      <div v-if="readonly" class="chip-row">
        <span v-if="!draft.skillTypes.length" class="empty-hint">无</span>
        <span
          v-for="item in SKILL_TYPE_OPTIONS.filter((opt) => draft.skillTypes.includes(opt.id))"
          :key="item.id"
          class="chip active"
        >
          {{ item.label }}
        </span>
      </div>
      <div v-else class="chip-row">
        <button
          v-for="opt in SKILL_TYPE_OPTIONS"
          :key="opt.id"
          type="button"
          class="chip"
          :class="{ active: draft.skillTypes.includes(opt.id) }"
          @click="toggleSkillType(opt.id)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>
    <p v-else class="empty-hint">
      异常类不设招式类型；可选增益锚点以吃「限定某一招」的 Buff。此处的「异常」特指属性异常等伤害事件。
    </p>
    <label>
      <span>增益锚点（仅本角色）</span>
      <input v-if="readonly" :value="anchorLabel" type="text" readonly tabindex="-1" />
      <select v-else v-model="draft.buffAnchorId" @change="onAnchorUserChange">
        <option value="">无</option>
        <option v-for="item in anchors" :key="item.id" :value="item.id">
          {{ item.name }}
        </option>
      </select>
    </label>
    <label>
      <span>{{ multFieldLabel }}</span>
      <input
        v-if="readonly"
        :value="readonlyBaseMultDisplay"
        type="text"
        readonly
        tabindex="-1"
      />
      <input
        v-else
        v-model="baseMultInput"
        type="number"
        :placeholder="baseMultPlaceholder"
      />
    </label>
    <label v-if="draft.damageType === 'direct'">
      <span>决算倍率%</span>
      <input
        v-if="readonly"
        :value="readonlySettlementDisplay"
        type="text"
        readonly
        tabindex="-1"
      />
      <input v-else v-model="settlementMultInput" type="number" placeholder="可不填" />
    </label>
  </div>
</template>

<style scoped>
.custom-form {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.custom-form.is-readonly {
  opacity: 0.92;
}
.custom-form label,
.type-checks {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.76rem;
  color: #9aa3b0;
}
.custom-form input,
.custom-form select {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #e8edf5;
  padding: 0.3rem 0.45rem;
}
.custom-form input[readonly] {
  cursor: default;
}
.is-readonly .chip {
  cursor: default;
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.chip {
  border: 1px solid #343a44;
  border-radius: 999px;
  background: #12161d;
  color: #d5dae4;
  padding: 0.22rem 0.6rem;
  font-size: 0.74rem;
  cursor: pointer;
}
.chip.active {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.14);
  color: #f0d7a2;
}
.empty-hint {
  margin: 0;
  color: #9aa3b0;
  font-size: 0.78rem;
}
</style>
