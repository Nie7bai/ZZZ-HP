<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import NumberStepper from '@/components/common/NumberStepper.vue'
import type {
  BuffEffect,
  BuffEffectBlock,
  BuffSkillTarget,
  BuffSkillTargetId,
  SkillCategoryId,
  SkillSubcategory,
} from '@/types/calculator'
import {
  BUFF_SKILL_TARGET_OPTIONS,
  CHARACTER_ATTR_OPTIONS,
  CONVERT_PANEL_SOURCE_OPTIONS,
  BUFF_SCOPE_OPTIONS,
  SKILL_CATEGORY_OPTIONS,
} from '@/types/calculator'
import { AGENT_ELEMENTS } from '@/utils/calculatorUi'
import {
  BUFF_STAT_FIELDS,
  GENERAL_BUFF_STAT_FIELDS,
  SKILL_BUFF_STAT_FIELDS,
  buffStatFieldLabel,
} from '@/utils/calculatorUi'
import { formatCalcDecimal } from '@/utils/calcNumberFormat'
import {
  createEmptyBuffEffect,
  createEmptyBuffEffectBlock,
  formatSkillTargetBracket,
  getEffectSkillTargets,
  packFromBlocks,
  setEffectSkillTargets,
} from '@/utils/buffEffect'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import { createDefaultSkillSubcategoryMults } from '@/utils/skillSubcategoryMult'

const props = defineProps<{
  lockApplyTarget?: 'self' | 'team' | null
  hint?: string
  /** 当前编辑的角色（招式小类创建/筛选） */
  agentId?: string
  /** 空列表时新增的第一个效果块默认名称（如「精1」） */
  defaultFirstBlockName?: string
  /** 仅允许能量回复效率（百分比）等受限场景用；现已统一百分比语义 */
  energyRegenFlatOnly?: boolean
  /**
   * 勾选「异常计算时也生效」时回调（用于邦布/音擎精炼跨精同步）。
   * 返回 true 表示已由外部处理，编辑器不再单独改当前 effect。
   */
  onAppliesToAnomalyChange?: (effect: BuffEffect, value: boolean) => void
}>()

const model = defineModel<BuffEffectBlock[]>({ required: true })

const calculatorBuffStore = useCalculatorBuffStore()
const { agents, skillSubcategories } = storeToRefs(calculatorBuffStore)

const creatingSubcatForId = ref<string | null>(null)
const newSubcat = ref({
  agentId: '',
  name: '',
  categoryId: 'basic' as SkillCategoryId,
  countsAsFollowUp: false,
})
const subcatMessage = ref('')
const subcatError = ref('')

/** 正在添加的招式草稿（按效果 id） */
const draftSkillByEffectId = ref<Record<string, BuffSkillTarget>>({})

const subcategoriesByCategory = computed(() => {
  const map = new Map<string, SkillSubcategory[]>()
  const agentFilter = props.agentId || newSubcat.value.agentId
  for (const item of skillSubcategories.value) {
    if (agentFilter && item.agentId && item.agentId !== agentFilter) continue
    const list = map.get(item.categoryId) ?? []
    list.push(item)
    map.set(item.categoryId, list)
  }
  return map
})

const followUpSubcategories = computed(() => {
  const agentFilter = props.agentId || newSubcat.value.agentId
  return skillSubcategories.value.filter((item) => {
    if (!item.countsAsFollowUp) return false
    if (agentFilter && item.agentId && item.agentId !== agentFilter) return false
    return true
  })
})

function skillTargetOptionsFor(_effect: BuffEffect) {
  return BUFF_SKILL_TARGET_OPTIONS
}

function ensureDraftSkill(effect: BuffEffect): BuffSkillTarget {
  const existing = draftSkillByEffectId.value[effect.id]
  if (existing) return existing
  const draft: BuffSkillTarget = {
    category: (effect.skillCategory as BuffSkillTargetId) ?? 'basic',
    subcategoryId: null,
  }
  draftSkillByEffectId.value[effect.id] = draft
  return draft
}

function subcategoriesForCategory(category: BuffSkillTargetId): SkillSubcategory[] {
  if (category === 'follow_up') return followUpSubcategories.value
  return subcategoriesByCategory.value.get(category as SkillCategoryId) ?? []
}

function subcategoriesForEffect(effect: BuffEffect): SkillSubcategory[] {
  const draft = ensureDraftSkill(effect)
  return subcategoriesForCategory(draft.category)
}

function canCreateSubcat(effect: BuffEffect) {
  return ensureDraftSkill(effect).category !== 'follow_up'
}

function isCreatingSubcat(effect: BuffEffect) {
  return creatingSubcatForId.value === effect.id
}

function skillTargetsOf(effect: BuffEffect) {
  return getEffectSkillTargets(effect)
}

function skillTargetLabel(target: BuffSkillTarget) {
  return formatSkillTargetBracket(target, skillSubcategories.value)
}

function removeSkillTarget(effect: BuffEffect, index: number) {
  const next = skillTargetsOf(effect).filter((_, i) => i !== index)
  setEffectSkillTargets(effect, next.length ? next : [{ category: 'basic', subcategoryId: null }])
}

function addSkillTarget(effect: BuffEffect) {
  const draft = ensureDraftSkill(effect)
  const next = [
    ...skillTargetsOf(effect),
    {
      category: draft.category,
      subcategoryId: draft.subcategoryId ?? null,
    },
  ]
  setEffectSkillTargets(effect, next)
}

function isAllElements(effect: BuffEffect) {
  return !effect.elementFilter || effect.elementFilter === 'all'
}

function isElementChecked(effect: BuffEffect, el: string) {
  if (isAllElements(effect)) return false
  return Array.isArray(effect.elementFilter) && effect.elementFilter.includes(el)
}

function setAllElements(effect: BuffEffect) {
  effect.elementFilter = 'all'
}

function toggleElement(effect: BuffEffect, el: string) {
  const current = isAllElements(effect)
    ? []
    : Array.isArray(effect.elementFilter)
      ? [...effect.elementFilter]
      : []
  const idx = current.indexOf(el)
  if (idx >= 0) current.splice(idx, 1)
  else current.push(el)
  effect.elementFilter = current.length ? current : 'all'
}

function elementFilterSummary(effect: BuffEffect) {
  if (isAllElements(effect)) return '全部属性'
  if (!Array.isArray(effect.elementFilter) || !effect.elementFilter.length) return '全部属性'
  return effect.elementFilter.join('、')
}

function statFieldsFor(effect: BuffEffect) {
  const filterEnergyRegen = <T extends { key: string }>(fields: T[]) =>
    props.energyRegenFlatOnly
      ? fields.filter((field) => field.key === 'energyRegen')
      : fields
  const base =
    effect.scope === 'skill'
      ? filterEnergyRegen([...SKILL_BUFF_STAT_FIELDS, ...GENERAL_BUFF_STAT_FIELDS])
      : filterEnergyRegen(
          GENERAL_BUFF_STAT_FIELDS.length ? GENERAL_BUFF_STAT_FIELDS : BUFF_STAT_FIELDS,
        )
  // 当前值若不在选项里，强制保留，避免 <select> 回落到第一项「增伤」并写脏数据
  if (!base.some((field) => field.key === effect.stat)) {
    const orphan = BUFF_STAT_FIELDS.find((field) => field.key === effect.stat)
    if (orphan) return [orphan, ...base]
  }
  return base
}

function defaultEffectStat(): BuffEffect['stat'] {
  return props.energyRegenFlatOnly ? 'energyRegen' : 'dmgBonus'
}

const FACTOR_STATS = new Set([
  'directDmgMultFactor',
  'anomalyMultFactor',
  'anomalyReleaseMultFactor',
  'disorderBaseMultFactor',
  'turbulenceBaseMultFactor',
])

function onStatChange(effect: BuffEffect, raw: string) {
  const next = raw as BuffEffect['stat']
  const prevWasFactor = FACTOR_STATS.has(effect.stat)
  const nextIsFactor = FACTOR_STATS.has(next)
  effect.stat = next
  // 倍率修正增益填写百分点增量，切过来默认 0
  if (nextIsFactor && !prevWasFactor && (effect.value == null || effect.value === 1 || effect.value === 0)) {
    effect.value = 0
  }
  if (!nextIsFactor && prevWasFactor && effect.value === 0) {
    effect.value = 0
  }
}

function addBlock() {
  const isFirst = model.value.length === 0
  const name =
    isFirst && props.defaultFirstBlockName?.trim()
      ? props.defaultFirstBlockName.trim()
      : `效果块 ${model.value.length + 1}`
  model.value = [
    ...model.value,
    createEmptyBuffEffectBlock({
      name,
      effects: [
        createEmptyBuffEffect({
          applyTarget: props.lockApplyTarget ?? 'self',
          stat: defaultEffectStat(),
        }),
      ],
    }),
  ]
}

function removeBlock(index: number) {
  model.value = model.value.filter((_, i) => i !== index)
}

function addEffect(block: BuffEffectBlock) {
  block.effects.push(
    createEmptyBuffEffect({
      applyTarget: props.lockApplyTarget ?? 'self',
      stat: defaultEffectStat(),
    }),
  )
}

function removeEffect(block: BuffEffectBlock, effectIndex: number) {
  block.effects.splice(effectIndex, 1)
}

function onScopeChange(effect: BuffEffect) {
  if (effect.scope === 'skill') {
    const targets = getEffectSkillTargets(effect)
    if (!targets.length) {
      setEffectSkillTargets(effect, [{ category: 'basic', subcategoryId: null }])
    } else {
      setEffectSkillTargets(effect, targets)
    }
    if (!SKILL_BUFF_STAT_FIELDS.some((f) => f.key === effect.stat)) {
      effect.stat = 'skillDmgBonus'
    }
    return
  }
  if (
    effect.scope === 'anomaly' ||
    effect.scope === 'disorder' ||
    effect.scope === 'turbulence' ||
    effect.scope === 'anomalyRelease'
  ) {
    setEffectSkillTargets(effect, [])
    effect.appliesToAnomaly = undefined
  }
}

function isAnomalyDamageScope(scope: BuffEffect['scope']) {
  return (
    scope === 'anomaly' ||
    scope === 'disorder' ||
    scope === 'turbulence' ||
    scope === 'anomalyRelease'
  )
}

function onDraftCategoryChange(effect: BuffEffect, category: BuffSkillTargetId) {
  const draft = ensureDraftSkill(effect)
  draft.category = category
  draft.subcategoryId = null
}

async function createSubcategory(effect: BuffEffect) {
  subcatMessage.value = ''
  subcatError.value = ''
  const name = newSubcat.value.name.trim()
  // 允许空 agentId = 全部角色
  const agentId = props.agentId ?? newSubcat.value.agentId
  if (!name) {
    subcatError.value = '小类名称为必填'
    return
  }
  try {
    const saved = await calculatorBuffStore.upsertSkillSubcategoryDoc({
      id: '',
      agentId,
      categoryId: newSubcat.value.categoryId,
      name,
      countsAsFollowUp: newSubcat.value.countsAsFollowUp,
      ...createDefaultSkillSubcategoryMults(),
    })
    const draft = ensureDraftSkill(effect)
    draft.category = saved.categoryId
    draft.subcategoryId = saved.id
    setEffectSkillTargets(effect, [
      ...skillTargetsOf(effect),
      { category: saved.categoryId, subcategoryId: saved.id },
    ])
    creatingSubcatForId.value = null
    newSubcat.value = {
      agentId: props.agentId || agentId,
      name: '',
      categoryId: saved.categoryId,
      countsAsFollowUp: false,
    }
    subcatMessage.value = `已添加小类「${saved.name}」`
  } catch (err) {
    subcatError.value = err instanceof Error ? err.message : '添加失败'
  }
}

function openCreateSubcat(effect: BuffEffect) {
  creatingSubcatForId.value = effect.id
  const draft = ensureDraftSkill(effect)
  const categoryId =
    draft.category && draft.category !== 'follow_up' ? draft.category : 'basic'
  newSubcat.value = {
    agentId: props.agentId || '',
    name: '',
    categoryId,
    countsAsFollowUp: false,
  }
  subcatError.value = ''
  subcatMessage.value = ''
}

function closeCreateSubcat() {
  creatingSubcatForId.value = null
  subcatError.value = ''
  subcatMessage.value = ''
}

function setAppliesToAnomaly(effect: BuffEffect, checked: boolean) {
  if (props.onAppliesToAnomalyChange) {
    props.onAppliesToAnomalyChange(effect, checked)
    return
  }
  effect.appliesToAnomaly = checked ? true : undefined
}

function convertPreviewText(effect: BuffEffect): string {
  const convert = effect.convert
  if (!convert) return ''
  const attrLabel =
    CHARACTER_ATTR_OPTIONS.find((item) => item.id === convert.from)?.label ?? convert.from
  const statLabel = buffStatFieldLabel(
    BUFF_STAT_FIELDS.find((item) => item.key === effect.stat) ?? BUFF_STAT_FIELDS[0]!,
  )
  const initial = convert.initialBase ?? 0
  const initialHint =
    initial > 0 ? `，超出初始值 ${formatCalcDecimal(initial)} 的部分参与折算` : ''
  if (convert.panelSource === 'manual') {
    const base = convert.defaultBase ?? 0
    const excess = Math.max(0, base - initial)
    let amount = (excess * (convert.ratioPercent ?? 0)) / 100
    let capped = false
    if (convert.cap != null && Number.isFinite(convert.cap) && amount > convert.cap) {
      amount = convert.cap
      capped = true
    }
    const rounded = formatCalcDecimal(amount)
    const baseExpr =
      initial > 0
        ? `max(0, ${formatCalcDecimal(base)} − ${formatCalcDecimal(initial)})`
        : formatCalcDecimal(base)
    return `${attrLabel} ${baseExpr} × ${formatCalcDecimal(convert.ratioPercent ?? 0)}% = ${statLabel} +${rounded}${capped ? '（已达上限）' : ''}${initialHint}`
  }
  const sourceLabel = convert.panelSource === 'final' ? '局内' : '局外'
  return `${sourceLabel}${attrLabel} × ${formatCalcDecimal(convert.ratioPercent ?? 0)}% → ${statLabel}，超出初始值部分实时折算${initialHint}`
}

function ensureConvert(effect: BuffEffect) {
  if (!effect.convert) {
    effect.convert = {
      from: 'atk',
      panelSource: 'external',
      ratioPercent: 0,
      cap: null,
      defaultBase: null,
      initialBase: 0,
    }
  }
  if (!effect.convert.panelSource) {
    effect.convert.panelSource = 'external'
  }
  if (effect.convert.defaultBase === undefined) {
    effect.convert.defaultBase = null
  }
  if (effect.convert.initialBase == null || !Number.isFinite(effect.convert.initialBase)) {
    effect.convert.initialBase = 0
  }
  return effect.convert
}

defineExpose({
  syncPack: () => packFromBlocks(model.value),
})
</script>

<template>
  <div class="effect-editor">
    <p v-if="hint !== ''" class="hint">
      {{
        hint ??
        '每个效果块可包含多条效果。招式可多选动作（按顺序展示）；未选小类时整大类生效。属性限定可多选。默认：通用增益参与异常；招式伤害/倍率不参与，除非勾选「异常计算时也生效」。'
      }}
    </p>

    <div v-if="!model.length" class="empty">暂无效果块</div>

    <article v-for="(block, blockIndex) in model" :key="block.id" class="block-card">
      <header class="block-head">
        <label class="field name-field">
          <span>效果块名称</span>
          <input
            v-model="block.name"
            type="text"
            autocomplete="off"
            placeholder="可自定义名称"
          />
        </label>
        <button type="button" class="danger-btn" @click="removeBlock(blockIndex)">删除块</button>
      </header>

      <label class="field note-field">
        <span>块备注 / 注释</span>
        <textarea
          v-model="block.note"
          rows="2"
          autocomplete="off"
          placeholder="可选说明、触发条件等"
        />
      </label>

      <div v-for="(effect, effectIndex) in block.effects" :key="effect.id" class="effect-card">
        <header class="effect-card-head">
          <strong>效果 {{ effectIndex + 1 }}</strong>
          <button type="button" class="danger-btn" @click="removeEffect(block, effectIndex)">
            删除
          </button>
        </header>

        <div class="grid">
          <label class="field">
            <span>作用情况</span>
            <select
              :value="effect.applySituation ?? 'global'"
              @change="
                (e) => {
                  const v = (e.target as HTMLSelectElement).value
                  effect.applySituation =
                    v === 'stagger' || v === 'non_stagger' ? v : 'global'
                }
              "
            >
              <option value="global">全局</option>
              <option value="stagger">失衡期</option>
              <option value="non_stagger">非失衡期</option>
            </select>
          </label>

          <label class="field">
            <span>作用域</span>
            <select v-model="effect.scope" @change="onScopeChange(effect)">
              <option
                v-for="opt in BUFF_SCOPE_OPTIONS"
                :key="opt.id"
                :value="opt.id"
              >
                {{ opt.label }}
              </option>
            </select>
          </label>

          <label v-if="!lockApplyTarget" class="field">
            <span>目标</span>
            <select v-model="effect.applyTarget">
              <option value="self">自身</option>
              <option value="team">全队（含自己）</option>
            </select>
          </label>

          <label class="field">
            <span>数值类型</span>
            <select v-model="effect.kind">
              <option value="fixed">固定</option>
              <option value="stacked">叠层</option>
              <option value="convert">转模</option>
            </select>
          </label>

          <label class="field">
            <span>属性</span>
            <select
              :value="effect.stat"
              @change="onStatChange(effect, ($event.target as HTMLSelectElement).value)"
            >
              <option
                v-for="field in statFieldsFor(effect)"
                :key="field.key"
                :value="field.key"
              >
                {{ buffStatFieldLabel(field) }}
              </option>
            </select>
          </label>

          <div class="field field-span">
            <span>属性限定（可多选）· 当前：{{ elementFilterSummary(effect) }}</span>
            <div class="chip-row">
              <label class="chip">
                <input
                  type="checkbox"
                  :checked="isAllElements(effect)"
                  @change="setAllElements(effect)"
                />
                <span>全部属性</span>
              </label>
              <label v-for="el in AGENT_ELEMENTS" :key="el" class="chip">
                <input
                  type="checkbox"
                  :checked="isElementChecked(effect, el)"
                  @change="toggleElement(effect, el)"
                />
                <span>{{ el }}</span>
              </label>
            </div>
          </div>

          <template v-if="effect.scope === 'skill'">
            <div class="field field-span">
              <span>已选招式（可多选，按顺序展示）</span>
              <div class="chip-row">
                <span
                  v-for="(target, targetIndex) in skillTargetsOf(effect)"
                  :key="`${target.category}-${target.subcategoryId ?? 'all'}-${targetIndex}`"
                  class="skill-chip"
                >
                  {{ skillTargetLabel(target) }}
                  <button
                    type="button"
                    class="chip-remove"
                    aria-label="移除招式"
                    @click="removeSkillTarget(effect, targetIndex)"
                  >
                    ×
                  </button>
                </span>
                <span v-if="!skillTargetsOf(effect).length" class="muted">尚未添加招式</span>
              </div>
            </div>
            <label class="field">
              <span>添加·招式大类</span>
              <select
                :value="ensureDraftSkill(effect).category"
                @change="
                  (e) =>
                    onDraftCategoryChange(
                      effect,
                      (e.target as HTMLSelectElement).value as BuffSkillTargetId,
                    )
                "
              >
                <option
                  v-for="opt in skillTargetOptionsFor(effect)"
                  :key="opt.id"
                  :value="opt.id"
                >
                  {{ opt.label }}
                </option>
              </select>
            </label>
            <label class="field">
              <span>添加·招式小类</span>
              <select v-model="ensureDraftSkill(effect).subcategoryId">
                <option :value="null">
                  {{
                    ensureDraftSkill(effect).category === 'follow_up' ? '全部追加' : '整大类'
                  }}
                </option>
                <option
                  v-for="sub in subcategoriesForEffect(effect)"
                  :key="sub.id"
                  :value="sub.id"
                >
                  {{ sub.name }}
                </option>
              </select>
            </label>
            <div class="field subcat-actions">
              <button type="button" class="ghost-btn" @click="addSkillTarget(effect)">
                ＋ 添加动作
              </button>
              <button
                v-if="canCreateSubcat(effect)"
                type="button"
                class="ghost-btn"
                @click="openCreateSubcat(effect)"
              >
                ＋ 新建招式小类
              </button>
            </div>
          </template>

          <label class="field checkbox">
            <input v-model="effect.enabledDefault" type="checkbox" />
            <span>默认启用</span>
          </label>

          <label
            v-if="!isAnomalyDamageScope(effect.scope)"
            class="field checkbox"
            title="默认：通用增益参与异常；招式伤害/倍率不参与。勾选后异常结算也会计入。邦布/音擎精炼下勾选会对所有精炼同步。"
          >
            <input
              :checked="effect.appliesToAnomaly === true"
              type="checkbox"
              @change="
                (e) => {
                  setAppliesToAnomaly(effect, (e.target as HTMLInputElement).checked)
                }
              "
            />
            <span>异常计算时也生效</span>
          </label>
        </div>

        <div v-if="isCreatingSubcat(effect)" class="subcat-create">
          <header class="subcat-create-head">
            <p class="hint">新建招式小类（仅当前效果）</p>
            <button type="button" class="close-subcat" aria-label="关闭" @click="closeCreateSubcat">
              ×
            </button>
          </header>
          <div class="grid">
            <label v-if="!agentId" class="field">
              <span>角色</span>
              <select v-model="newSubcat.agentId">
                <option value="">全部角色</option>
                <option v-for="agent in agents" :key="agent.id" :value="agent.id">
                  {{ agent.name }}
                </option>
              </select>
            </label>
            <label class="field">
              <span>招式大类</span>
              <select v-model="newSubcat.categoryId">
                <option v-for="opt in SKILL_CATEGORY_OPTIONS" :key="opt.id" :value="opt.id">
                  {{ opt.label }}
                </option>
              </select>
            </label>
            <label class="field">
              <span>小类名称</span>
              <input v-model="newSubcat.name" type="text" placeholder="显示名称" />
            </label>
            <label class="field checkbox">
              <input v-model="newSubcat.countsAsFollowUp" type="checkbox" />
              <span>视为追加攻击</span>
            </label>
          </div>
          <div class="subcat-create-actions">
            <button type="button" class="ghost-btn" @click="createSubcategory(effect)">保存小类</button>
            <button type="button" class="ghost-btn" @click="closeCreateSubcat">取消</button>
          </div>
          <p v-if="subcatError" class="err">{{ subcatError }}</p>
          <p v-if="subcatMessage" class="ok">{{ subcatMessage }}</p>
        </div>

        <div v-if="effect.kind === 'fixed'" class="grid">
          <label class="field">
            <span>数值</span>
            <NumberStepper
              :model-value="effect.value ?? 0"
              :min="-999999"
              :max="999999"
              :step="0.0001"
              @update:model-value="effect.value = $event"
            />
          </label>
        </div>

        <div v-else-if="effect.kind === 'stacked'" class="grid">
          <label class="field">
            <span>每层数值</span>
            <NumberStepper
              :model-value="effect.valuePerStack ?? 0"
              :min="-999999"
              :max="999999"
              :step="0.0001"
              @update:model-value="effect.valuePerStack = $event"
            />
          </label>
          <label class="field">
            <span>最大层数</span>
            <NumberStepper
              :model-value="effect.maxStacks ?? 1"
              :min="1"
              :max="99"
              @update:model-value="effect.maxStacks = $event"
            />
          </label>
          <label class="field">
            <span>默认层数</span>
            <NumberStepper
              :model-value="effect.defaultStacks ?? 1"
              :min="0"
              :max="99"
              @update:model-value="effect.defaultStacks = $event"
            />
          </label>
        </div>

        <div v-else class="grid">
          <label class="field">
            <span>面板来源</span>
            <select v-model="ensureConvert(effect).panelSource">
              <option
                v-for="opt in CONVERT_PANEL_SOURCE_OPTIONS"
                :key="opt.id"
                :value="opt.id"
              >
                {{ opt.label }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>来源属性</span>
            <select v-model="ensureConvert(effect).from">
              <option v-for="opt in CHARACTER_ATTR_OPTIONS" :key="opt.id" :value="opt.id">
                {{ opt.label }}
              </option>
            </select>
          </label>
          <label
            v-if="ensureConvert(effect).panelSource === 'manual'"
            class="field"
          >
            <span>自行设置基础值</span>
            <NumberStepper
              :model-value="ensureConvert(effect).defaultBase ?? 0"
              :min="0"
              :max="999999"
              :step="0.0001"
              @update:model-value="ensureConvert(effect).defaultBase = $event"
            />
          </label>
          <label class="field">
            <span>转换比例%</span>
            <NumberStepper
              :model-value="ensureConvert(effect).ratioPercent"
              :min="-9999"
              :max="9999"
              :step="0.0001"
              @update:model-value="ensureConvert(effect).ratioPercent = $event"
            />
          </label>
          <label class="field">
            <span>转模初始值</span>
            <NumberStepper
              :model-value="ensureConvert(effect).initialBase ?? 0"
              :min="0"
              :max="999999"
              :step="0.0001"
              @update:model-value="ensureConvert(effect).initialBase = $event"
            />
          </label>
          <label class="field">
            <span>上限（0=无上限）</span>
            <NumberStepper
              :model-value="ensureConvert(effect).cap ?? 0"
              :min="0"
              :max="999999"
              :step="0.0001"
              @update:model-value="
                (v) => {
                  ensureConvert(effect).cap = v > 0 ? v : null
                }
              "
            />
          </label>
          <p class="convert-preview">{{ convertPreviewText(effect) }}</p>
        </div>
      </div>

      <button type="button" class="add-btn" @click="addEffect(block)">＋ 在此块添加效果</button>
    </article>

    <button type="button" class="add-btn" @click="addBlock">＋ 添加效果块</button>
  </div>
</template>

<style scoped>
.effect-editor {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.hint {
  margin: 0;
  font-size: 0.76rem;
  opacity: 0.72;
  line-height: 1.45;
  color: var(--color-text);
}

.empty {
  font-size: 0.85rem;
  opacity: 0.65;
  padding: 0.5rem 0;
}

.block-card {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 0.85rem;
  background: var(--color-background-soft);
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.block-head {
  display: flex;
  gap: 0.75rem;
  align-items: end;
  justify-content: space-between;
}

.name-field {
  flex: 1;
}

.effect-card {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 0.7rem;
  background: var(--color-background);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.effect-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

@media (min-width: 900px) {
  .grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.76rem;
  color: var(--color-text);
}

.field.checkbox {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
  padding-top: 1.1rem;
}

.field input[type='text'],
.field textarea,
.field select {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
  padding: 0.4rem 0.5rem;
  font: inherit;
}

.field textarea {
  resize: vertical;
  min-height: 2.6rem;
  line-height: 1.4;
}

.note-field {
  width: 100%;
}

.convert-preview {
  grid-column: 1 / -1;
  margin: 0;
  padding: 0.35rem 0.5rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-border) 25%, transparent);
  font-size: 0.76rem;
  font-weight: 700;
  color: var(--color-text);
}

.subcat-actions {
  justify-content: end;
  padding-top: 1.1rem;
}

.subcat-create {
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  padding: 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  background: var(--color-background-soft, transparent);
}

.subcat-create-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.subcat-create-head .hint {
  margin: 0;
}

.close-subcat {
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: 1.35rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.25rem;
}

.subcat-create-actions {
  display: flex;
  gap: 0.45rem;
}

.field-span {
  grid-column: 1 / -1;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  font-size: 0.74rem;
  background: var(--color-background);
  cursor: pointer;
}

.skill-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.2rem 0.45rem 0.2rem 0.55rem;
  font-size: 0.74rem;
  background: color-mix(in srgb, var(--color-background) 80%, var(--color-border));
}

.chip-remove {
  border: none;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  font-size: 0.95rem;
  line-height: 1;
  padding: 0 0.1rem;
  opacity: 0.7;
}

.chip-remove:hover {
  opacity: 1;
}

.muted {
  font-size: 0.74rem;
  opacity: 0.6;
}

.add-btn,
.danger-btn,
.ghost-btn {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  padding: 0.4rem 0.7rem;
  cursor: pointer;
  font-size: 0.82rem;
}

.danger-btn {
  color: #c45c5c;
  border-color: rgba(196, 92, 92, 0.4);
}

.err {
  margin: 0;
  color: #c45c5c;
  font-size: 0.78rem;
}

.ok {
  margin: 0;
  color: hsl(160, 100%, 32%);
  font-size: 0.78rem;
}
</style>
