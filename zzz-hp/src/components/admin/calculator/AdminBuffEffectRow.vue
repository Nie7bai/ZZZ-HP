<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import NumberStepper from '@/components/common/NumberStepper.vue'
import type {
  BuffDamageType,
  BuffEffect,
  BuffSkillTarget,
  BuffSkillTargetId,
  BuffStatKey,
  CustomBuffStatKey,
  SkillCategoryId,
  SkillSubcategory,
} from '@/types/calculator'
import {
  BUFF_SKILL_TARGET_OPTIONS,
  CONVERT_FROM_OPTIONS,
  CONVERT_PANEL_SOURCE_OPTIONS,
  SKILL_CATEGORY_OPTIONS,
} from '@/types/calculator'
import { AGENT_ELEMENTS, AGENT_ROLES } from '@/utils/calculatorUi'
import { formatCalcDecimal } from '@/utils/calcNumberFormat'
import {
  createDefaultSkillSubcategoryMults,
} from '@/utils/skillSubcategoryMult'
import {
  convertSummaryLabel,
  formatApplySituationLabel,
  formatSkillTargetBracket,
  formatSkillTargetsPrefix,
  formatTeamProfessionGateLabel,
  getEffectSkillTargets,
  normalizeTeamProfessionValues,
  resolveConvertValue,
  setEffectSkillTargets,
} from '@/utils/buffEffect'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import {
  BUFF_STAT_ZONES,
  allowedDamageTypesOf,
  buffStatLabelOf,
  buffStatUnitOf,
  isZoneTypeLocked,
  statRowsForZone,
} from '@/utils/buffStatZones'
import { damageTypeLabel, damageTypesLabel, BUFF_DAMAGE_TYPE_IDS } from '@/utils/buffDamageTypes'
import { canConfirmMerge, type EffectRow } from '@/utils/buffEffectRows'
import type { ExtraBuffApplySlot, ExtraBuffSlotIndex } from '@/types/extraBuff'

const props = defineProps<{
  row: EffectRow
  agentId?: string
  lockApplyTarget?: 'self' | 'team' | null
  mergeMode?: boolean
  selected?: boolean
  /**
   * `catalog`（缺省）= 增益库编辑器；`extra` = 额外 Buff 卡片（一卡一行、目标按槽位）。
   * extra 模式下隐藏块级操作（合并/拆开/对齐/默认启用/新建小类/行内删除），
   * 目标控件换成「作用对象」，转模多一个「来源槽位」。
   */
  contextMode?: 'catalog' | 'extra'
  applySlot?: ExtraBuffApplySlot
  sourceSlot?: ExtraBuffSlotIndex
  slotOptions?: Array<{ value: ExtraBuffSlotIndex; label: string }>
}>()

const emit = defineEmits<{
  'change-zone': [zoneId: string, types: BuffDamageType[]]
  'toggle-type': [type: BuffDamageType, checked: boolean]
  split: []
  remove: []
  'confirm-merge': []
  align: []
  'toggle-select': []
  'update:applySlot': [value: ExtraBuffApplySlot]
  'update:sourceSlot': [value: ExtraBuffSlotIndex]
}>()

const calculatorBuffStore = useCalculatorBuffStore()
const { agents, skillSubcategories } = storeToRefs(calculatorBuffStore)

const first = computed(() => props.row.effects[0]!)
/** 额外 Buff 卡片模式：一卡一行，卡片级操作在卡片头部，不在这里 */
const isExtraMode = computed(() => props.contextMode === 'extra')
const applySlotModel = computed(() => String(props.applySlot ?? 0))
function onApplySlotChange(event: Event) {
  const raw = (event.target as HTMLSelectElement).value
  emit('update:applySlot', raw === 'team' ? 'team' : (Number(raw) as ExtraBuffSlotIndex))
}
function onSourceSlotChange(event: Event) {
  emit('update:sourceSlot', Number((event.target as HTMLSelectElement).value) as ExtraBuffSlotIndex)
}
const zone = computed(() => props.row.zone)
const allowedTypes = computed(() =>
  zone.value ? allowedDamageTypesOf(zone.value) : undefined,
)
const memberCount = computed(() => props.row.effects.length)
const rowTitle = computed(() => zone.value?.label ?? statLabel(first.value?.stat))
const memberLabels = computed(() =>
  props.row.effects.map((effect) => {
    const type = props.row.damageTypes.find(
      (id) => statRowsForZone(zone.value!, [id])[0]?.stat === effect.stat,
    )
    return type ? damageTypeLabel(type) : statLabel(effect.stat)
  }),
)

function statLabel(stat: BuffStatKey | CustomBuffStatKey | undefined) {
  if (!stat) return '未知属性'
  return buffStatLabelOf(stat)
}

/** 组内联动：所有可编辑字段都写到整组 */
function patchAll(mutator: (effect: BuffEffect) => void) {
  for (const effect of props.row.effects) mutator(effect)
}

function patchField<K extends keyof BuffEffect>(key: K, value: BuffEffect[K]) {
  patchAll((effect) => {
    effect[key] = Array.isArray(value) ? ([...value] as BuffEffect[K]) : value
  })
}

const applySituation = computed({
  get: () => first.value?.applySituation ?? 'global',
  set: (value: BuffEffect['applySituation']) => patchField('applySituation', value),
})
const applyTarget = computed({
  get: () => first.value?.applyTarget ?? 'self',
  set: (value: BuffEffect['applyTarget']) => patchField('applyTarget', value),
})
const applyProfession = computed({
  get: () => first.value?.applyProfession ?? '',
  set: (value: string) => patchField('applyProfession', value || null),
})
const teamProfession = computed({
  get: () => first.value?.teamProfession ?? '',
  set: (value: string) => patchField('teamProfession', value || null),
})
const kind = computed({
  get: () => first.value?.kind ?? 'fixed',
  set: (value: BuffEffect['kind']) => {
    patchAll((effect) => {
      effect.kind = value
      if (value === 'convert') ensureConvert(effect)
      else effect.convert = undefined
    })
  },
})
const value = computed({
  get: () => first.value?.value ?? 0,
  set: (next: number) => patchField('value', next),
})
const valuePerStack = computed({
  get: () => first.value?.valuePerStack ?? 0,
  set: (next: number) => patchField('valuePerStack', next),
})
const maxStacks = computed({
  get: () => first.value?.maxStacks ?? 1,
  set: (next: number) => patchField('maxStacks', next),
})
const defaultStacks = computed({
  get: () => first.value?.defaultStacks ?? 1,
  set: (next: number) => patchField('defaultStacks', next),
})
const enabledDefault = computed({
  get: () => first.value?.enabledDefault !== false,
  set: (next: boolean) => patchField('enabledDefault', next),
})

const teamProfessionTier = computed<Array<number | null>>(() => {
  const effect = first.value
  if (!effect?.teamProfession) return [null, null, null]
  return (
    normalizeTeamProfessionValues(
      effect.teamProfessionValues,
      effect.teamProfession,
      effect.teamProfessionMinCount,
      effect.value,
    ) ?? [null, null, null]
  )
})

function setTeamProfession(next: string) {
  patchAll((effect) => {
    const text = next.trim()
    effect.teamProfession = text || null
    effect.teamProfessionMinCount = null
    effect.teamProfessionValues = text ? [null, null, null] : null
  })
}

function setTeamProfessionTierOn(index: number, on: boolean) {
  const tiers = [...teamProfessionTier.value]
  tiers[index] = on ? 0 : null
  patchAll((effect) => {
    effect.teamProfessionValues = [...tiers]
    effect.teamProfessionMinCount = null
  })
}

const isAllElements = computed(
  () => !first.value?.elementFilter || first.value.elementFilter === 'all',
)
function isElementChecked(element: string) {
  const filter = first.value?.elementFilter
  return Array.isArray(filter) && filter.includes(element)
}
function setAllElements() {
  patchField('elementFilter', 'all')
}
function toggleElement(element: string) {
  const current = isAllElements.value
    ? []
    : Array.isArray(first.value?.elementFilter)
      ? [...first.value.elementFilter]
      : []
  const index = current.indexOf(element)
  if (index >= 0) current.splice(index, 1)
  else current.push(element)
  patchField('elementFilter', current.length ? current : 'all')
}

const skillLimited = computed(() => getEffectSkillTargets(first.value).length > 0)
function setSkillLimited(checked: boolean) {
  if (checked) {
    patchAll((effect) => {
      const targets = getEffectSkillTargets(effect)
      if (!targets.length) {
        setEffectSkillTargets(effect, [{ category: 'basic', subcategoryId: null }])
      }
      if (
        !props.row.zone?.statsByType &&
        effect.stat !== 'skillDmgBonus' &&
        effect.stat !== 'skillMultiplierBonus'
      ) {
        effect.stat = 'skillDmgBonus'
      }
    })
    return
  }
  patchAll((effect) => setEffectSkillTargets(effect, []))
}

const draftSkillByEffectId = ref<Record<string, BuffSkillTarget>>({})
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
const draftSkill = computed(() => ensureDraftSkill(first.value))
const skillTargetsOf = computed(() => getEffectSkillTargets(first.value))
function skillTargetLabel(target: BuffSkillTarget) {
  return formatSkillTargetBracket(target, skillSubcategories.value)
}

/**
 * 招式 chip 文案：额外 Buff 会同时列出三名队员的小类，同名时补上所属角色名；
 * 管理端传了 `agentId`（只列本角色），保持原来的纯名字。
 */
function skillTargetName(target: BuffSkillTarget) {
  const base = skillTargetLabel(target).replace(/^\[|\]$/g, '')
  if (props.agentId || !target.subcategoryId) return base
  const sub = skillSubcategories.value.find((item) => item.id === target.subcategoryId)
  if (!sub?.agentId) return base
  const agent = agents.value.find((item) => item.id === sub.agentId)
  return agent ? `${base}（${agent.name}）` : base
}
function onDraftCategoryChange(category: BuffSkillTargetId) {
  const draft = ensureDraftSkill(first.value)
  draft.category = category
  draft.subcategoryId = null
}
/**
 * 招式小类选项文案：**额外 Buff 不按编辑角色过滤**，所以会同时列出三名队员的小类，
 * 同名（如「特殊技」）必须带上所属角色名才能区分（Spec §4.2 第 4 项）。
 * 管理端传了 `agentId`，只列本角色的，保持原来的纯名字。
 */
function subcategoryLabel(sub: SkillSubcategory): string {
  if (props.agentId || !sub.agentId) return sub.name
  const agent = agents.value.find((item) => item.id === sub.agentId)
  return agent ? `${sub.name}（${agent.name}）` : sub.name
}

function subcategoriesForCategory(category: BuffSkillTargetId): SkillSubcategory[] {
  const agentFilter = props.agentId
  return skillSubcategories.value.filter((item) => {
    if (agentFilter && item.agentId && item.agentId !== agentFilter) return false
    return item.categoryId === category || (category === 'follow_up' && item.countsAsFollowUp)
  })
}
function addSkillTarget() {
  const draft = ensureDraftSkill(first.value)
  patchAll((effect) => {
    setEffectSkillTargets(effect, [
      ...getEffectSkillTargets(effect),
      { category: draft.category, subcategoryId: draft.subcategoryId ?? null },
    ])
  })
}
function removeSkillTarget(index: number) {
  patchAll((effect) => {
    const next = getEffectSkillTargets(effect).filter((_, i) => i !== index)
    setEffectSkillTargets(effect, next.length ? next : [])
  })
}

const creatingSubcat = ref(false)
const subcatError = ref('')
const subcatMessage = ref('')
const newSubcat = ref({
  agentId: '',
  name: '',
  categoryId: 'basic' as SkillCategoryId,
  countsAsFollowUp: false,
})
function openCreateSubcat() {
  creatingSubcat.value = true
  subcatError.value = ''
  subcatMessage.value = ''
  newSubcat.value = {
    agentId: props.agentId || '',
    name: '',
    categoryId:
      (first.value.skillCategory as SkillCategoryId) ?? 'basic',
    countsAsFollowUp: false,
  }
}
async function createSubcategory() {
  const name = newSubcat.value.name.trim()
  if (!name) {
    subcatError.value = '小类名称为必填'
    return
  }
  try {
    const saved = await calculatorBuffStore.upsertSkillSubcategoryDoc({
      id: '',
      agentId: props.agentId || newSubcat.value.agentId,
      categoryId: newSubcat.value.categoryId,
      name,
      countsAsFollowUp: newSubcat.value.countsAsFollowUp,
      ...createDefaultSkillSubcategoryMults(),
    })
    patchAll((effect) => {
      setEffectSkillTargets(effect, [
        ...getEffectSkillTargets(effect),
        { category: saved.categoryId, subcategoryId: saved.id },
      ])
    })
    creatingSubcat.value = false
    subcatMessage.value = `已添加小类「${saved.name}」`
  } catch (err) {
    subcatError.value = err instanceof Error ? err.message : '添加失败'
  }
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
  if (!effect.convert.panelSource) effect.convert.panelSource = 'external'
  if (effect.convert.defaultBase === undefined) effect.convert.defaultBase = null
  if (effect.convert.initialBase == null || !Number.isFinite(effect.convert.initialBase)) {
    effect.convert.initialBase = 0
  }
}
const convert = computed(() => {
  ensureConvert(first.value)
  return first.value.convert!
})
function patchConvert<K extends keyof NonNullable<BuffEffect['convert']>>(
  key: K,
  nextValue: NonNullable<BuffEffect['convert']>[K],
) {
  patchAll((effect) => {
    ensureConvert(effect)
    effect.convert![key] = nextValue
  })
}

function convertPreviewText() {
  const cv = convert.value
  const attrLabel =
    CONVERT_FROM_OPTIONS.find((item) => item.id === cv.from)?.label ?? cv.from
  const statLabelText =
    first.value?.stat === 'anomalyControl' || first.value?.stat === 'anomalyControlPercent'
      ? (zone.value?.label ?? statLabel(first.value.stat))
      : statLabel(first.value.stat)
  const initial = cv.initialBase ?? 0
  const initialHint =
    initial > 0 ? `，超出初始值 ${formatCalcDecimal(initial)} 的部分参与折算` : ''
  if (cv.panelSource === 'manual') {
    const base = cv.defaultBase ?? 0
    const amount = resolveConvertValue(first.value, {})
    const uncapped = resolveConvertValue(
      { ...first.value, convert: { ...cv, cap: null } },
      {},
    )
    const baseExpr =
      initial > 0
        ? `max(0, ${formatCalcDecimal(base)} − ${formatCalcDecimal(initial)})`
        : formatCalcDecimal(base)
    return `${attrLabel} ${baseExpr} × ${formatCalcDecimal(cv.ratioPercent ?? 0)}% = ${statLabelText} ${amount < 0 ? '' : '+'}${formatCalcDecimal(amount)}${amount !== uncapped ? '（已达上限）' : ''}${initialHint}`
  }
  const sourceLabel = cv.panelSource === 'final' ? '局内' : '局外'
  return `${sourceLabel}${attrLabel} × ${formatCalcDecimal(cv.ratioPercent ?? 0)}% → ${statLabelText}，超出初始值部分实时折算${initialHint}`
}

function onZoneChange(event: Event) {
  const zoneId = (event.target as HTMLSelectElement).value
  emit('change-zone', zoneId, props.row.damageTypes)
}

function onSplit() {
  emit('split')
}

/* ───────────────────────── 界面密度（2026-10-20） ─────────────────────────
 * 只改展示与展开层级，不动数据：
 * - 默认折叠成一行摘要，摘要只列「非默认值」（目标自身始终显示，不加徽章/不置顶）；
 * - 展开后：条件折叠面板（作用情况 / 伤害类型 / 目标 / 职业限制 / 属性限定 / 限定招式）
 *   + 高级折叠（默认启用 / 队内职业人数 / 备注）+ 右侧固定数值列；
 * - 默认值不占位，靠「＋ 条件」下拉加回控件；
 * - 展开 / 折叠 / 显隐都不持久化（组件重建即回到折叠）。
 * ---------------------------------------------------------------------- */

/** 下拉菜单开关（行本身不再有折叠态：行、条件、高级、块备注都常显） */
const condMenuOpen = ref(false)
const skillMenuOpen = ref(false)
/**
 * 「＋ 条件」菜单向上弹：按钮固定在条件行最左后，卡片贴近底部时菜单仍可能越过滚动容器底边，
 * 所以打开后按实际位置决定朝上还是朝下（不写死，两种情况都要能完整看到）。
 */
const condMenuUp = ref(false)

/**
 * 「＋ 条件」菜单定位：**固定定位 + 视口夹紧**。
 *
 * 之前用「相对按钮的绝对定位 + 找滚动容器算空间」有两个坑（用户 2026-10-26 反馈"方向有时是反的"）：
 * ① 容器是卡片里的可滚区域，量出来的"上方空间"和用户看到的并不一致；
 * ② 曾经给过 140px 最小高度，上方只剩几十像素时会顶出容器、首行被裁。
 * 现在统一按**视口**算：放得下就朝下，装不下且上方更宽就朝上，再把 left/top 夹进视口。
 */
async function toggleCondMenu() {
  condMenuOpen.value = !condMenuOpen.value
  if (!condMenuOpen.value) {
    detachCondMenuListeners()
    return
  }
  await nextTick()
  positionCondMenu()
  window.addEventListener('scroll', positionCondMenu, true)
  window.addEventListener('resize', positionCondMenu)
}

function detachCondMenuListeners() {
  window.removeEventListener('scroll', positionCondMenu, true)
  window.removeEventListener('resize', positionCondMenu)
}

function positionCondMenu() {
  const menu = document.querySelector('.cond-menu') as HTMLElement | null
  const anchor = menu?.parentElement ?? null
  if (!menu || !anchor) return
  const margin = 8
  menu.style.maxHeight = ''
  menu.style.top = '0px'
  menu.style.left = '0px'
  const wanted = menu.getBoundingClientRect().height
  const rect = anchor.getBoundingClientRect()
  const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - margin)
  const spaceAbove = Math.max(0, rect.top - margin)
  const openUp = wanted > spaceBelow && spaceAbove > spaceBelow
  const available = openUp ? spaceAbove : spaceBelow
  const maxHeight = Math.max(28, Math.min(wanted, available))
  const height = Math.min(wanted, maxHeight)
  const top = openUp ? rect.top - 4 - height : rect.bottom + 4
  const left = rect.left
  menu.style.maxHeight = `${maxHeight}px`
  menu.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - margin - height))}px`
  menu.style.left = `${Math.max(
    margin,
    Math.min(left, window.innerWidth - margin - menu.offsetWidth),
  )}px`
  condMenuUp.value = openUp
}

interface RevealState {
  situation: boolean
  profession: boolean
  element: boolean
  skill: boolean
  damageType: boolean
  teamProfession: boolean
  anomaly: boolean
  enabledDefault: boolean
}
type RevealKey = keyof RevealState

/** 由「＋ 条件」临时加回的控件：数据回默认值后仍显示，点 ✕ 收起；不持久化 */
const revealed = ref<RevealState>({
  situation: false,
  profession: false,
  element: false,
  skill: false,
  damageType: false,
  teamProfession: false,
  anomaly: false,
  enabledDefault: false,
})

/** 类1 = 类型锁死（一行灰字）；类2 = 异常 5 项 chips；类3 = 默认隐藏，按需展开 */
const tier = computed(() => zone.value?.tier ?? 3)
const tierLocked = computed(() => (zone.value ? isZoneTypeLocked(zone.value) : false))
const lockedTypeLabel = computed(() => damageTypesLabel(zone.value?.lockedTypes ?? []))
const chipTypes = computed<BuffDamageType[]>(() => allowedTypes.value ?? BUFF_DAMAGE_TYPE_IDS)

/** 当前勾选的伤害类型（类2 由 stat 反推，类1 由 zone 锁死） */
function isDamageTypeChecked(type: BuffDamageType) {
  return props.row.damageTypes.includes(type)
}

function onDamageTypeToggle(type: BuffDamageType, event: Event) {
  emit('toggle-type', type, (event.target as HTMLInputElement).checked)
}

const showSituation = computed(
  () => applySituation.value !== 'global' || revealed.value.situation,
)
const showProfession = computed(
  () => Boolean(first.value?.applyProfession) || revealed.value.profession,
)
const showElement = computed(() => !isAllElements.value || revealed.value.element)
const showSkill = computed(() => skillLimited.value || revealed.value.skill)
const showDamageTypes = computed(
  () =>
    tier.value === 3 &&
    (props.row.damageTypes.length > 0 || revealed.value.damageType),
)
const showTeamProfession = computed(
  () => Boolean(first.value?.teamProfession) || revealed.value.teamProfession,
)
const showEnabledDefault = computed(
  () => first.value?.enabledDefault === false || revealed.value.enabledDefault,
)

const elementNames = computed(() => {
  const filter = first.value?.elementFilter
  return Array.isArray(filter) ? filter.map((item) => String(item)) : []
})

const targetText = computed(() => (applyTarget.value === 'team' ? '全队' : '自身'))
const situationText = computed(() => formatApplySituationLabel(first.value))
const skillText = computed(() => {
  const prefix = formatSkillTargetsPrefix(first.value, skillSubcategories.value)
  return prefix ? `招式${prefix}` : ''
})
const teamGateText = computed(() => formatTeamProfessionGateLabel(first.value))

/** 伤害类型摘要：类1 固定不列；类2 全选 = 默认不列；类3 有值才列 */
const damageText = computed(() => {
  if (tier.value === 1) return ''
  const types = props.row.damageTypes
  if (!types.length) return ''
  if (tier.value === 2) {
    const allowed = allowedTypes.value ?? []
    if (!allowed.length || types.length >= allowed.length) return ''
  }
  return `伤害·${types.map((type) => damageTypeLabel(type)).join('/')}`
})

/** 折叠态摘要：只列非默认值；目标始终在（必看字段，不加徽章、不置顶） */
const summaryText = computed(() => {
  const parts: string[] = [targetText.value]
  if (skillText.value) parts.push(skillText.value)
  if (elementNames.value.length) parts.push(elementNames.value.join('·'))
  if (damageText.value) parts.push(damageText.value)
  if (applySituation.value !== 'global') parts.push(situationText.value)
  if (applyProfession.value) parts.push(`职业·${applyProfession.value}`)
  if (teamGateText.value) parts.push(teamGateText.value)
  if (first.value?.enabledDefault === false) parts.push('默认关闭')
  return parts.join(' · ')
})


// 自定义乘区键不在内置字段表里：单位回落 `%`（buffStatUnitOf 兜底 percent）
const statUnit = computed(() => buffStatUnitOf(first.value?.stat))
const unitSuffix = computed(() => (statUnit.value === 'percent' ? '%' : ''))
const unitLabel = computed(() => {
  if (statUnit.value === 'percent') return '%'
  if (statUnit.value === 'factor') return '×'
  return '固定'
})

/** 折叠态尾部数值：固定 / 叠层 / 转模 三种口径 */
const amountText = computed(() => {
  if (kind.value === 'stacked') {
    return `${formatCalcDecimal(valuePerStack.value)}${unitSuffix.value}×${maxStacks.value}层`
  }
  if (kind.value === 'convert') return convertSummaryLabel(first.value?.convert)
  return `${formatCalcDecimal(value.value)}${unitSuffix.value}`
})

interface CondMenuItem {
  key: RevealKey
  label: string
  shown: boolean
  /** false = 该行不适用（如类1/类2 不提供伤害类型开关） */
  only?: boolean
}

const condMenuItems = computed<CondMenuItem[]>(() => {
  const items: CondMenuItem[] = [
    { key: 'situation', label: '作用情况', shown: showSituation.value },
    { key: 'damageType', label: '伤害类型', shown: showDamageTypes.value, only: tier.value === 3 },
    { key: 'profession', label: '职业限制', shown: showProfession.value },
    { key: 'element', label: '属性限定', shown: showElement.value },
    { key: 'skill', label: '限定招式', shown: showSkill.value },
    { key: 'teamProfession', label: '队内职业人数', shown: showTeamProfession.value },
    { key: 'enabledDefault', label: '默认启用', shown: showEnabledDefault.value },
  ]
  return items.filter((item) => item.only !== false)
})

function reveal(key: RevealKey) {
  revealed.value = { ...revealed.value, [key]: true }
  condMenuOpen.value = false
}

function clearDamageTypes() {
  for (const type of props.row.damageTypes) emit('toggle-type', type, false)
}

/** 恢复默认并重新隐藏该控件（默认值 = 不占位） */
function resetCondition(key: RevealKey) {
  if (key === 'situation') applySituation.value = 'global'
  else if (key === 'profession') applyProfession.value = ''
  else if (key === 'element') setAllElements()
  else if (key === 'skill') setSkillLimited(false)
  else if (key === 'damageType') clearDamageTypes()
  else if (key === 'teamProfession') setTeamProfession('')
  else if (key === 'enabledDefault') enabledDefault.value = true
  revealed.value = { ...revealed.value, [key]: false }
}

/** 招式 chip 文字：去掉 [ ] 便于压一行 */


function onCreateSubcatFromMenu() {
  skillMenuOpen.value = false
  openCreateSubcat()
}

function onAddSkillTarget() {
  addSkillTarget()
  skillMenuOpen.value = false
}

/** 点空白处收起下拉（纯界面状态） */
function onDocumentClick() {
  condMenuOpen.value = false
  skillMenuOpen.value = false
  detachCondMenuListeners()
}
onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  detachCondMenuListeners()
})
</script>

<template>
  <article class="effect-row" :class="{ 'effect-row--warn': row.issues.length }">
    <header class="effect-row-head">
      <label v-if="mergeMode" class="merge-check">
        <input type="checkbox" :checked="selected" @change="emit('toggle-select')" />
        <span>选择</span>
      </label>

      <div class="effect-title">
        <strong>{{ rowTitle }}</strong>
        <span v-if="!isExtraMode && memberCount > 1" class="badge">{{ memberCount }} 条</span>
        <span v-if="!isExtraMode && row.groupId" class="badge badge-group">组</span>
        <span v-else-if="!isExtraMode && row.heuristic" class="badge badge-ungrouped">未分组</span>
        <span v-if="row.issues.length" class="badge badge-warn">⚠ 不一致</span>
      </div>

      <span v-if="summaryText" class="summary-text" :title="summaryText">· {{ summaryText }}</span>

      <span class="summary-value">{{ amountText }}</span>

      <div v-if="!isExtraMode" class="effect-actions">
        <button
          v-if="canConfirmMerge(row)"
          type="button"
          class="ghost-btn"
          @click="emit('confirm-merge')"
        >
          确认合并
        </button>
        <button
          v-if="memberCount > 1 || row.damageTypes.length > 1"
          type="button"
          class="ghost-btn"
          @click="onSplit"
        >
          拆开
        </button>
        <button type="button" class="danger-btn" @click="emit('remove')">删除</button>
      </div>
    </header>

    <p v-if="!isExtraMode && row.issues.length" class="row-warn">
      <span>⚠ {{ row.issues.map((issue) => issue.label).join(' / ') }}不一致</span>
      <button type="button" class="ghost-btn" @click="emit('align')">一键对齐</button>
    </p>

    <div class="row-body">
      <div class="body-main">
        <p v-if="!isExtraMode && memberCount > 1" class="member-line">
          <span class="muted">组内：</span>
          <span v-for="(label, index) in memberLabels" :key="index" class="member-chip">{{ label }}</span>
        </p>

        <!-- 条件：常显，无折叠 -->
        <div class="cond-line">
          <span class="line-label">条件</span>

          <!--
            「＋ 条件」固定在条件行最前：伤害类型多选后换行时，它不会跟着被挤下去，
            下拉菜单也不会跑出容器（用户 2026-10-25 反馈）。
          -->
          <span class="add-cond">
            <button
              type="button"
              class="ghost-btn add-cond-btn"
              title="把默认不占位的条件控件加回来"
              @click.stop="toggleCondMenu"
            >
              ＋ 条件
            </button>
            <div v-if="condMenuOpen" class="cond-menu" :class="{ 'is-up': condMenuUp }" @click.stop>
              <button
                v-for="item in condMenuItems"
                :key="item.key"
                type="button"
                class="cond-item"
                :disabled="item.shown"
                @click="reveal(item.key)"
              >
                <span class="cond-item-mark">{{ item.shown ? '✓' : '＋' }}</span>
                {{ item.label }}
              </button>
            </div>
          </span>

          <label v-if="isExtraMode" class="inline-field">
            <span>作用对象</span>
            <select :value="applySlotModel" @change="onApplySlotChange">
              <option value="team">全队</option>
              <option
                v-for="opt in slotOptions ?? []"
                :key="`slot-${opt.value}`"
                :value="String(opt.value)"
              >
                {{ opt.label }}
              </option>
            </select>
          </label>
          <label v-else-if="!lockApplyTarget" class="inline-field">
            <span>目标</span>
            <select v-model="applyTarget">
              <option value="self">自身</option>
              <option value="team">全队</option>
            </select>
          </label>

          <span v-if="showSituation" class="inline-field">
            <span>作用</span>
            <select v-model="applySituation">
              <option value="global">全局</option>
              <option value="stagger">失衡期</option>
              <option value="non_stagger">非失衡期</option>
            </select>
            <button
              type="button"
              class="reset-x"
              title="恢复默认（全局）"
              @click="resetCondition('situation')"
            >
              ✕
            </button>
          </span>

          <span v-if="showProfession" class="inline-field">
            <span>职业</span>
            <select v-model="applyProfession">
              <option value="">不限</option>
              <option v-for="role in AGENT_ROLES" :key="role" :value="role">{{ role }}</option>
            </select>
            <button
              type="button"
              class="reset-x"
              title="恢复默认（不限）"
              @click="resetCondition('profession')"
            >
              ✕
            </button>
          </span>

          <p v-if="tierLocked" class="dmg-fixed">
            <span class="dmg-label-strong">伤害类型：</span>{{ lockedTypeLabel }}（固定）
          </p>
          <span v-else-if="tier === 2" class="dmg-line">
            <span class="line-sub">伤害类型</span>
            <label v-for="type in chipTypes" :key="type" class="chip">
              <input
                type="checkbox"
                :checked="isDamageTypeChecked(type)"
                @change="onDamageTypeToggle(type, $event)"
              />
              <span>{{ damageTypeLabel(type) }}</span>
            </label>
          </span>
          <span v-else-if="showDamageTypes" class="dmg-line">
            <span class="line-sub">伤害类型</span>
            <label v-for="type in chipTypes" :key="type" class="chip">
              <input
                type="checkbox"
                :checked="isDamageTypeChecked(type)"
                @change="onDamageTypeToggle(type, $event)"
              />
              <span>{{ damageTypeLabel(type) }}</span>
            </label>
            <button
              type="button"
              class="reset-x"
              title="恢复默认（全部伤害类型）"
              @click="resetCondition('damageType')"
            >
              ✕
            </button>
          </span>

          <span v-if="showElement" class="inline-field chips-inline">
            <span>属性</span>
            <label class="chip">
              <input type="checkbox" :checked="isAllElements" @change="setAllElements" />
              <span>全部</span>
            </label>
            <label v-for="element in AGENT_ELEMENTS" :key="element" class="chip">
              <input
                type="checkbox"
                :checked="isElementChecked(element)"
                @change="toggleElement(element)"
              />
              <span>{{ element }}</span>
            </label>
            <button
              type="button"
              class="reset-x"
              title="恢复默认（全部属性）"
              @click="resetCondition('element')"
            >
              ✕
            </button>
          </span>

          <span v-if="showSkill" class="inline-field skill-line">
            <span>招式</span>
            <span
              v-for="(target, index) in skillTargetsOf"
              :key="`${target.category}-${target.subcategoryId ?? 'all'}-${index}`"
              class="skill-chip"
            >
              {{ skillTargetName(target) }}
              <button
                type="button"
                class="chip-remove"
                aria-label="移除招式"
                @click="removeSkillTarget(index)"
              >
                ✕
              </button>
            </span>
            <span class="skill-add">
              <button type="button" class="ghost-btn" @click.stop="skillMenuOpen = !skillMenuOpen">
                ＋ 添加
              </button>
              <div v-if="skillMenuOpen" class="skill-menu" @click.stop>
                <label class="menu-field">
                  <span>招式大类</span>
                  <select
                    :value="draftSkill.category"
                    @change="
                      onDraftCategoryChange(
                        ($event.target as HTMLSelectElement).value as BuffSkillTargetId,
                      )
                    "
                  >
                    <option v-for="opt in BUFF_SKILL_TARGET_OPTIONS" :key="opt.id" :value="opt.id">
                      {{ opt.label }}
                    </option>
                  </select>
                </label>
                <label class="menu-field">
                  <span>招式小类</span>
                  <select v-model="draftSkill.subcategoryId">
                    <option :value="null">
                      {{ draftSkill.category === 'follow_up' ? '全部追加' : '整大类' }}
                    </option>
                    <option
                      v-for="sub in subcategoriesForCategory(draftSkill.category)"
                      :key="sub.id"
                      :value="sub.id"
                    >
                      {{ subcategoryLabel(sub) }}
                    </option>
                  </select>
                </label>
                <div class="menu-actions">
                  <button type="button" class="ghost-btn" @click="onAddSkillTarget">
                    ＋ 添加动作
                  </button>
                  <button
                    v-if="!isExtraMode"
                    type="button"
                    class="ghost-btn"
                    @click="onCreateSubcatFromMenu"
                  >
                    ＋ 新建小类
                  </button>
                </div>
              </div>
            </span>
            <button
              type="button"
              class="reset-x"
              title="恢复默认（不限招式）"
              @click="resetCondition('skill')"
            >
              ✕
            </button>
          </span>
        </div>

        <!-- 高级：常显，无折叠 -->
        <div class="adv-line">
          <span class="line-label">高级</span>

          <span v-if="!isExtraMode && showEnabledDefault" class="inline-check">
            <input v-model="enabledDefault" type="checkbox" />
            <span>默认启用</span>
            <button
              type="button"
              class="reset-x"
              title="恢复默认（默认启用）"
              @click="resetCondition('enabledDefault')"
            >
              ✕
            </button>
          </span>

          <span v-if="showTeamProfession" class="inline-field">
            <span>队内人数</span>
            <select
              :value="teamProfession"
              @change="setTeamProfession(($event.target as HTMLSelectElement).value)"
            >
              <option value="">不限</option>
              <option v-for="role in AGENT_ROLES" :key="`gate-${role}`" :value="role">
                {{ role }}
              </option>
            </select>
            <span v-if="teamProfession" class="tier-inline">
              <label v-for="n in 3" :key="`tier-${row.key}-${n}`" class="tier-inline-item">
                <input
                  type="checkbox"
                  :checked="teamProfessionTier[n - 1] != null"
                  @change="
                    setTeamProfessionTierOn(n - 1, ($event.target as HTMLInputElement).checked)
                  "
                />
                <span>{{ n }}人</span>
              </label>
            </span>
            <button
              type="button"
              class="reset-x"
              title="恢复默认（不限）"
              @click="resetCondition('teamProfession')"
            >
              ✕
            </button>
          </span>

          <span v-if="first.note" class="note-inline">{{ first.note }}</span>

          <span
            v-if="!showEnabledDefault && !showTeamProfession && !first.note"
            class="muted"
          >
            都是默认值（不占位）：用「＋ 条件」加回
          </span>
        </div>
      </div>

      <!-- 右侧数值列：常显 -->
      <aside class="value-col">
        <div class="value-row">
          <label class="inline-field grow">
            <span>属性</span>
            <select :value="zone?.id ?? ''" @change="onZoneChange">
              <option v-for="item in BUFF_STAT_ZONES" :key="item.id" :value="item.id">
                {{ item.label }}
              </option>
            </select>
          </label>
          <label class="inline-field">
            <span>类型</span>
            <select v-model="kind">
              <option value="fixed">固定</option>
              <option value="stacked">叠层</option>
              <option value="convert">转模</option>
            </select>
          </label>
        </div>

        <div class="value-row">
          <span class="line-sub">{{ kind === 'stacked' ? '每层' : '数值' }}</span>
          <NumberStepper
            v-if="kind === 'stacked'"
            v-model="valuePerStack"
            :min="-999999"
            :max="999999"
            :step="0.0001"
          />
          <NumberStepper
            v-else-if="kind === 'fixed'"
            v-model="value"
            :min="-999999"
            :max="999999"
            :step="0.0001"
          />
          <span v-else class="value-fallback">{{ convertSummaryLabel(first.convert) }}</span>
          <span v-if="kind !== 'convert'" class="unit">{{ unitLabel }}</span>
        </div>

        <div v-if="kind === 'stacked'" class="value-row">
          <span class="line-sub">最大</span>
          <!-- 层数允许 2 位小数（2026-10-22 用户口径：填了就是真值）；± 按钮仍按 1 层 -->
          <NumberStepper v-model="maxStacks" :min="1" :max="99" :step="0.01" :button-step="1" />
          <span class="line-sub">默认</span>
          <NumberStepper v-model="defaultStacks" :min="0" :max="99" :step="0.01" :button-step="1" />
        </div>

        <div v-else-if="kind === 'convert'" class="convert-block">
          <label class="inline-field">
            <span>来源</span>
            <select
              :value="convert.panelSource"
              @change="
                patchConvert(
                  'panelSource',
                  ($event.target as HTMLSelectElement).value as 'external' | 'final' | 'manual',
                )
              "
            >
              <option v-for="opt in CONVERT_PANEL_SOURCE_OPTIONS" :key="opt.id" :value="opt.id">
                {{ opt.label }}
              </option>
            </select>
          </label>
          <label
            v-if="isExtraMode && (convert.panelSource ?? 'external') !== 'manual'"
            class="inline-field"
          >
            <span>来源槽位</span>
            <select :value="String(sourceSlot ?? 0)" @change="onSourceSlotChange">
              <option
                v-for="opt in slotOptions ?? []"
                :key="`src-${opt.value}`"
                :value="String(opt.value)"
              >
                {{ opt.label }}
              </option>
            </select>
          </label>
          <label class="inline-field">
            <span>属性</span>
            <select
              :value="convert.from"
              @change="
                patchConvert(
                  'from',
                  ($event.target as HTMLSelectElement).value as typeof convert.from,
                )
              "
            >
              <option v-for="opt in CONVERT_FROM_OPTIONS" :key="opt.id" :value="opt.id">
                {{ opt.label }}
              </option>
            </select>
          </label>
          <label v-if="convert.panelSource === 'manual'" class="inline-field convert-number-field">
            <span>基础</span>
            <NumberStepper
              :model-value="convert.defaultBase ?? 0"
              :min="0"
              :max="999999"
              :step="0.0001"
              @update:model-value="patchConvert('defaultBase', $event)"
            />
          </label>
          <label class="inline-field convert-number-field">
            <span>比例%</span>
            <NumberStepper
              :model-value="convert.ratioPercent"
              :min="-9999"
              :max="9999"
              :step="0.0001"
              @update:model-value="patchConvert('ratioPercent', $event)"
            />
          </label>
          <label class="inline-field convert-number-field">
            <span>初始</span>
            <NumberStepper
              :model-value="convert.initialBase ?? 0"
              :min="0"
              :max="999999"
              :step="0.0001"
              @update:model-value="patchConvert('initialBase', $event)"
            />
          </label>
          <label class="inline-field convert-number-field">
            <span>上限</span>
            <NumberStepper
              :model-value="convert.cap ?? 0"
              :min="0"
              :max="999999"
              :step="0.0001"
              @update:model-value="patchConvert('cap', $event > 0 ? $event : null)"
            />
          </label>
          <p class="convert-preview">{{ convertPreviewText() }}</p>
        </div>
      </aside>
    </div>

    <div v-if="creatingSubcat" class="subcat-create">
      <header class="subcat-create-head">
        <p class="hint">新建招式小类（仅当前行）</p>
        <button type="button" class="close-subcat" aria-label="关闭" @click="creatingSubcat = false">
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
        <button type="button" class="ghost-btn" @click="createSubcategory">保存小类</button>
        <button type="button" class="ghost-btn" @click="creatingSubcat = false">取消</button>
      </div>
      <p v-if="subcatError" class="err">{{ subcatError }}</p>
      <p v-if="subcatMessage" class="ok">{{ subcatMessage }}</p>
    </div>
  </article>
</template>
<style scoped>
/* 条件与数值常显；文字和控件尺寸继承编辑器的局部排版变量。 */
.effect-row {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.65rem 0.75rem;
  background: var(--color-background);
  font-size: var(--buff-editor-text-size);
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.effect-row--warn {
  border-color: rgba(196, 92, 92, 0.55);
}

.effect-row-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  min-height: var(--buff-editor-control-height);
}

.effect-title {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex: 0 0 auto;
  min-width: 0;
}

.effect-title strong {
  font-size: var(--buff-editor-title-size);
  font-weight: 600;
  color: var(--color-heading);
  white-space: nowrap;
}

/* 摘要只列非默认值；过长省略 */
.summary-text {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--buff-editor-label-size);
  opacity: 0.72;
}

.summary-value {
  margin-left: auto;
  flex: 0 1 auto;
  font-size: var(--buff-editor-title-size);
  font-weight: 700;
  color: var(--color-heading);
  overflow-wrap: anywhere;
}

.badge {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 0 0.35rem;
  font-size: var(--buff-editor-meta-size);
  line-height: 1.35;
  opacity: 0.85;
  white-space: nowrap;
}

.badge-group {
  border-color: rgba(64, 140, 255, 0.5);
}

.badge-ungrouped {
  border-color: rgba(220, 160, 40, 0.55);
}

.badge-warn {
  color: #c45c5c;
  border-color: rgba(196, 92, 92, 0.55);
}

.effect-actions {
  display: flex;
  gap: 0.25rem;
  flex: 0 0 auto;
}

.merge-check {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-size: var(--buff-editor-text-size);
  flex: 0 0 auto;
}

.row-warn {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #c45c5c;
  font-size: var(--buff-editor-text-size);
}

.member-line {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
}

.member-chip {
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  padding: 0 0.3rem;
  font-size: var(--buff-editor-text-size);
}

/* 主体：左（条件 + 高级，常显）+ 右（数值列，常显） */
.row-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 22rem;
  gap: 0.75rem;
  align-items: start;
}

.body-main {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.cond-line,
.adv-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.6rem;
  font-size: var(--buff-editor-text-size);
  line-height: 1.5;
  min-width: 0;
}

.adv-line {
  opacity: 0.92;
}

.line-label {
  flex: 0 0 auto;
  font-size: var(--buff-editor-label-size);
  font-weight: 600;
  color: var(--color-heading);
}

/* 所有字段标签同一字号，重要性由名称和编辑值表达。 */
.line-sub {
  flex: 0 0 auto;
  font-size: var(--buff-editor-label-size);
  font-weight: 600;
  opacity: 0.8;
}

.inline-field {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.inline-field.grow {
  flex: 1 1 auto;
}

.inline-field > span:first-child {
  font-size: var(--buff-editor-label-size);
  font-weight: 600;
  white-space: nowrap;
}

.chips-inline {
  flex-wrap: wrap;
}

.inline-field select,
.cond-line select,
.value-col select {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background);
  color: var(--color-text);
  min-height: var(--buff-editor-control-height);
  padding: 0.3rem 0.4rem;
  font: inherit;
  font-size: var(--buff-editor-text-size);
  max-width: 11rem;
}

.inline-field.grow select {
  flex: 1 1 auto;
  min-width: 0;
}

.inline-check {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  min-height: var(--buff-editor-control-height);
  flex-wrap: wrap;
}

.inline-check input {
  margin: 0;
}

.effect-row input[type='checkbox'] {
  width: 1rem;
  height: 1rem;
  flex: 0 0 auto;
}

.tier-inline {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.tier-inline-item {
  display: inline-flex;
  align-items: center;
  gap: 0.12rem;
  font-size: var(--buff-editor-text-size);
}

.note-inline {
  margin: 0;
  font-size: var(--buff-editor-text-size);
  opacity: 0.75;
  white-space: pre-wrap;
}

.reset-x {
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: var(--buff-editor-meta-size);
  line-height: 1;
  min-width: 1.5rem;
  min-height: 1.5rem;
  padding: 0 0.2rem;
  opacity: 0.45;
  cursor: pointer;
}

.reset-x:hover {
  opacity: 1;
  color: #c45c5c;
}

/* ＋ 条件 下拉 */
.add-cond {
  position: relative;
  display: inline-flex;
}

.cond-menu {
  /* 位置由 positionCondMenu() 按视口算好写进 inline style（fixed 可逃出滚动容器裁剪） */
  position: fixed;
  z-index: 2000;
  min-width: 11.5rem;
  max-height: min(60vh, 22rem);
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  padding: 0.25rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.32);
}



.cond-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: var(--buff-editor-text-size);
  padding: 0.28rem 0.4rem;
  border-radius: 6px;
  cursor: pointer;
}

.cond-item:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-border) 45%, transparent);
}

.cond-item:disabled {
  opacity: 0.42;
  cursor: default;
}

.cond-item-mark {
  width: 0.75rem;
  opacity: 0.7;
}

/* 伤害类型：类1 灰字 / 类2、类3 chips */
.dmg-fixed {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-size: var(--buff-editor-text-size);
  opacity: 0.6;
  white-space: nowrap;
}

.dmg-label-strong {
  font-weight: 600;
}

.dmg-line {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  min-height: 1.875rem;
  padding: 0.15rem 0.5rem;
  font-size: var(--buff-editor-text-size);
  line-height: 1.4;
  background: var(--color-background);
  cursor: pointer;
}

.chip input {
  margin: 0;
}

.skill-line {
  flex-wrap: wrap;
}

.skill-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 0 0.25rem;
  font-size: var(--buff-editor-text-size);
  line-height: 1.4;
}

.chip-remove {
  border: none;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  font-size: var(--buff-editor-meta-size);
  line-height: 1;
  opacity: 0.6;
  padding: 0;
}

.skill-add {
  position: relative;
  display: inline-flex;
}

.skill-menu {
  position: absolute;
  left: 0;
  top: calc(100% + 4px);
  z-index: 30;
  width: 15rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.45rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.32);
}

.menu-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: var(--buff-editor-text-size);
}

.menu-field select {
  max-width: none;
}

.menu-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

/* 右侧数值列（常显，横排压高） */
.value-col {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0 0 0 0.75rem;
  border-left: 1px dashed var(--color-border);
  font-size: var(--buff-editor-text-size);
  min-width: 0;
}

.value-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.value-col :deep(.num-stepper) {
  height: var(--buff-editor-control-height);
  min-width: 0;
  max-width: 11rem;
  font-variant-numeric: tabular-nums;
}

.value-col :deep(.step-input) {
  padding: 0.3rem 0.5rem;
  font-size: var(--buff-editor-text-size);
  font-weight: 600;
  line-height: 1.5;
  color: var(--color-heading);
}

.value-col :deep(.step-btn) {
  flex: 0 0 calc(var(--buff-editor-control-height) - 2px);
  width: calc(var(--buff-editor-control-height) - 2px);
  height: 100%;
  font-size: var(--buff-editor-title-size);
}

.value-row :deep(.num-stepper) {
  flex: 1 1 0;
}

.unit {
  flex: 0 0 auto;
  font-size: var(--buff-editor-text-size);
  opacity: 0.66;
}

.value-fallback {
  font-size: var(--buff-editor-meta-size);
  opacity: 0.8;
  overflow: hidden;
  text-overflow: ellipsis;
  overflow-wrap: anywhere;
}

.convert-block {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.6rem;
  align-items: center;
}

.convert-number-field {
  display: grid;
  grid-template-columns: 3.5rem minmax(0, 11rem);
  width: 100%;
}

.convert-preview {
  margin: 0;
  width: 100%;
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-border) 25%, transparent);
  font-size: var(--buff-editor-meta-size);
  line-height: 1.5;
}

.subcat-create {
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.subcat-create-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.subcat-create-actions {
  display: flex;
  gap: 0.4rem;
}

.close-subcat {
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: 1.15rem;
  cursor: pointer;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4rem;
}

@media (min-width: 900px) {
  .grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: var(--buff-editor-text-size);
  color: var(--color-text);
  min-width: 0;
}

.field.checkbox {
  flex-direction: row;
  align-items: center;
  gap: 0.35rem;
  padding-top: 1rem;
}

.field input[type='text'],
.field select {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background);
  color: var(--color-text);
  padding: 0.25rem 0.35rem;
  min-height: var(--buff-editor-control-height);
  font: inherit;
  font-size: var(--buff-editor-text-size);
}

.muted {
  font-size: var(--buff-editor-meta-size);
  opacity: 0.55;
}

.hint {
  margin: 0;
  font-size: var(--buff-editor-meta-size);
  opacity: 0.7;
}

.err {
  margin: 0;
  color: #c45c5c;
  font-size: var(--buff-editor-text-size);
}

.ok {
  margin: 0;
  color: hsl(160, 100%, 32%);
  font-size: var(--buff-editor-text-size);
}

.ghost-btn,
.danger-btn {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background);
  color: var(--color-heading);
  min-height: var(--buff-editor-control-height);
  padding: 0.3rem 0.6rem;
  cursor: pointer;
  font-family: inherit;
  font-size: var(--buff-editor-text-size);
  line-height: 1.5;
  white-space: nowrap;
}

.danger-btn {
  color: #c45c5c;
  border-color: rgba(196, 92, 92, 0.4);
}

/* 窄屏：数值列下移（不折叠，只是换行） */
@media (max-width: 900px) {
  .row-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .value-col {
    border-left: none;
    border-top: 1px dashed var(--color-border);
    padding: 0.75rem 0 0;
  }
}
</style>