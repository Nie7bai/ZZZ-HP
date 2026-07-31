<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import NumberStepper from '@/components/common/NumberStepper.vue'
import type { CharacterAttrKey, SkillSubcategory } from '@/types/calculator'
import type {
  CollectedEffect,
  MultiSlotBuffSelection,
  PanelSourceValues,
} from '@/utils/panelBuffCalc'
import {
  getBuffEffectConvertInput,
  getBuffEffectEnabled,
  getBuffEffectStacks,
  parseSourceKeySlotIndex,
  setBuffEffectConvertInput,
  setBuffEffectEnabled,
  setBuffEffectStacks,
  isTeamBuffApplyTarget,
} from '@/utils/panelBuffCalc'
import { formatBuffEffectResultText, resolveConvertValue } from '@/utils/buffEffect'
import { formatCalcSigned } from '@/utils/calcNumberFormat'
import { buffStatFieldLabel, BUFF_STAT_FIELDS } from '@/utils/calculatorUi'
import { CHARACTER_ATTR_OPTIONS } from '@/types/calculator'

const props = defineProps<{
  effects: CollectedEffect[]
  attrDefaults?: Partial<Record<CharacterAttrKey, number>>
  panelSourceValues?: PanelSourceValues
  /** 按队伍槽位的局外/局内转模取值（队友转模来源） */
  panelSourceValuesBySlot?: Record<number, PanelSourceValues>
  skillSubcategories?: SkillSubcategory[]
  /** 可选角色槽位（Buff 勾选视角） */
  slotOptions?: { index: number; label: string }[]
}>()

function panelSourceValuesForEffect(item: CollectedEffect): PanelSourceValues | undefined {
  const slotIndex = parseSourceKeySlotIndex(item.sourceKey)
  if (slotIndex != null && props.panelSourceValuesBySlot?.[slotIndex]) {
    return props.panelSourceValuesBySlot[slotIndex]
  }
  return props.panelSourceValues
}

const open = defineModel<boolean>('open', { default: false })
const multiSelection = defineModel<MultiSlotBuffSelection>('multiSelection', { required: true })
const viewSlotIndex = defineModel<number>('viewSlotIndex', { default: 0 })

const search = ref('')
const activeGroup = ref('全部')
const showConvertOverride = ref<Record<string, boolean>>({})

const groupOrder = [
  '全部',
  '自身',
  '自身音擎',
  '自身驱动盘',
  '全队（含自身）',
  '全队音擎',
  '队友',
  '队友音擎',
  '队友驱动盘',
  '邦布',
]

interface BuffCardGroup {
  key: string
  providerName: string
  providerAvatar: string | null
  blockName: string
  note: string
  group: string
  items: CollectedEffect[]
}

const availableGroups = computed(() => {
  const set = new Set(props.effects.map((item) => item.group))
  return groupOrder.filter((g) => g === '全部' || set.has(g))
})

watch(availableGroups, (groups) => {
  if (!groups.includes(activeGroup.value)) activeGroup.value = '全部'
})

function statLabel(stat: string) {
  const field = BUFF_STAT_FIELDS.find((item) => item.key === stat)
  return field ? buffStatFieldLabel(field) : stat
}

function attrLabel(from: string) {
  return CHARACTER_ATTR_OPTIONS.find((item) => item.id === from)?.label ?? from
}

function panelSourceLabel(item: CollectedEffect) {
  const source = item.effect.convert?.panelSource ?? 'external'
  if (source === 'final') return '局内'
  if (source === 'manual') return '自行'
  return '局外'
}

function isManualConvert(item: CollectedEffect) {
  return item.effect.convert?.panelSource === 'manual'
}

function isEnabled(item: CollectedEffect) {
  return getBuffEffectEnabled(
    multiSelection.value,
    viewSlotIndex.value,
    item.effect.id,
    item.effect.applyTarget,
    item.effect.enabledDefault !== false,
  )
}

function setEnabled(item: CollectedEffect, enabled: boolean) {
  setBuffEffectEnabled(
    multiSelection.value,
    viewSlotIndex.value,
    item.effect.id,
    item.effect.applyTarget,
    enabled,
  )
}

function stacksModel(item: CollectedEffect, fallback: number) {
  return getBuffEffectStacks(
    multiSelection.value,
    viewSlotIndex.value,
    item.effect.id,
    item.effect.applyTarget,
    fallback,
  )
}

function setStacks(item: CollectedEffect, value: number) {
  setBuffEffectStacks(
    multiSelection.value,
    viewSlotIndex.value,
    item.effect.id,
    item.effect.applyTarget,
    Math.max(0, value),
  )
}

function convertLiveBase(item: CollectedEffect) {
  const convert = item.effect.convert
  if (!convert) return 0
  if (convert.panelSource === 'manual') {
    return convert.defaultBase != null && Number.isFinite(convert.defaultBase)
      ? convert.defaultBase
      : 0
  }
  if (convert.defaultBase != null && Number.isFinite(convert.defaultBase)) {
    return convert.defaultBase
  }
  const source = convert.panelSource ?? 'external'
  const panelSources = panelSourceValuesForEffect(item)
  const map =
    (source === 'final' || source === 'external'
      ? panelSources?.[source]
      : undefined) ??
    props.attrDefaults ??
    {}
  return map[convert.from] ?? props.attrDefaults?.[convert.from] ?? 0
}

function hasConvertOverride(item: CollectedEffect) {
  return (
    getBuffEffectConvertInput(
      multiSelection.value,
      viewSlotIndex.value,
      item.effect.id,
      item.effect.applyTarget,
    ) != null
  )
}

function convertOverrideModel(item: CollectedEffect) {
  const saved = getBuffEffectConvertInput(
    multiSelection.value,
    viewSlotIndex.value,
    item.effect.id,
    item.effect.applyTarget,
  )
  if (saved != null) return saved
  return convertLiveBase(item)
}

function setConvert(item: CollectedEffect, value: number) {
  setBuffEffectConvertInput(
    multiSelection.value,
    viewSlotIndex.value,
    item.effect.id,
    item.effect.applyTarget,
    Math.max(0, value),
  )
  showConvertOverride.value[item.effect.id] = true
}

function clearConvertOverride(item: CollectedEffect) {
  const id = item.effect.id
  if (isManualConvert(item)) {
    setBuffEffectConvertInput(
      multiSelection.value,
      viewSlotIndex.value,
      id,
      item.effect.applyTarget,
      convertLiveBase(item),
    )
    return
  }
  const store = isTeamBuffApplyTarget(item.effect.applyTarget)
    ? multiSelection.value.team
    : multiSelection.value.bySlot[viewSlotIndex.value]
  if (store) delete store.convertInputs[id]
  showConvertOverride.value[id] = false
}

function convertResult(item: CollectedEffect) {
  const convert = item.effect.convert
  const id = item.effect.id
  const source = convert?.panelSource ?? 'external'
  const saved = getBuffEffectConvertInput(
    multiSelection.value,
    viewSlotIndex.value,
    id,
    item.effect.applyTarget,
  )
  let override: number | null | undefined
  if (source === 'manual') {
    override = saved ?? convert?.defaultBase ?? 0
  } else if (showConvertOverride.value[id] && saved != null) {
    override = saved
  } else {
    override = null
  }
  return resolveConvertValue(
    item.effect,
    props.attrDefaults ?? {},
    override,
    panelSourceValuesForEffect(item),
  )
}

function blockNameText(item: CollectedEffect) {
  return item.blockName?.trim() || '增益'
}

function situationLabel(item: CollectedEffect) {
  const situation = item.effect.applySituation ?? 'global'
  if (situation === 'stagger') return '失衡期'
  if (situation === 'non_stagger') return '非失衡期'
  return '全局'
}

function noteText(item: CollectedEffect) {
  return item.blockNote?.trim() || ''
}

function formatSigned(value: number) {
  return formatCalcSigned(value)
}

/** 参考站效果行：招式前缀 + 属性名 + 数值 */
function effectResultText(item: CollectedEffect) {
  let amountText = ''
  if (item.effect.kind === 'stacked' || item.effect.stackable) {
    const stacks = stacksModel(item, item.effect.defaultStacks ?? 1)
    const per = item.effect.valuePerStack ?? 0
    amountText = formatSigned(per * stacks)
  } else if (item.effect.kind === 'convert') {
    amountText = formatSigned(convertResult(item))
  } else {
    amountText = formatSigned(Number(item.effect.value) || 0)
  }
  return formatBuffEffectResultText(item.effect, amountText, {
    statLabelFn: (stat) => statLabel(stat),
    skillSubcategories: props.skillSubcategories,
  })
}

function isStackable(item: CollectedEffect) {
  return item.effect.kind === 'stacked' || Boolean(item.effect.stackable)
}

function isConvert(item: CollectedEffect) {
  return item.effect.kind === 'convert' && Boolean(item.effect.convert)
}

function cardSelected(card: BuffCardGroup) {
  return card.items.every((item) => isEnabled(item))
}

function cardPartial(card: BuffCardGroup) {
  const states = card.items.map((item) => isEnabled(item))
  const on = states.filter(Boolean).length
  return on > 0 && on < states.length
}

function toggleCard(card: BuffCardGroup) {
  const next = !cardSelected(card)
  for (const item of card.items) {
    setEnabled(item, next)
  }
}

function toggleEffect(item: CollectedEffect) {
  setEnabled(item, !isEnabled(item))
}

const filtered = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return props.effects.filter((item) => {
    if (activeGroup.value !== '全部' && item.group !== activeGroup.value) return false
    if (!keyword) return true
    const hay = [
      item.providerName,
      blockNameText(item),
      item.group,
      noteText(item),
      effectResultText(item),
      statLabel(item.effect.stat),
      item.sourceLabel,
    ]
      .join(' ')
      .toLowerCase()
    return hay.includes(keyword)
  })
})

/** 按来源块分组，一张卡多条效果（对齐参考站） */
const filteredCards = computed(() => {
  const map = new Map<string, BuffCardGroup>()
  for (const item of filtered.value) {
    const blockName = blockNameText(item)
    const situation = situationLabel(item)
    const key = `${item.sourceKey}::${item.blockId}::${blockName}::${situation}`
    let card = map.get(key)
    if (!card) {
      card = {
        key,
        providerName: item.providerName || item.sourceLabel,
        providerAvatar: item.providerAvatar ?? null,
        blockName,
        note: noteText(item),
        group: item.group,
        items: [],
      }
      map.set(key, card)
    }
    card.items.push(item)
    if (!card.note) card.note = noteText(item)
  }
  return [...map.values()]
})

const selectedCount = computed(
  () => props.effects.filter((item) => isEnabled(item)).length,
)

function addCurrentList() {
  for (const item of filtered.value) {
    setEnabled(item, true)
  }
}

function removeCurrentList() {
  for (const item of filtered.value) {
    setEnabled(item, false)
  }
}

function close() {
  open.value = false
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="buff-picker-overlay" role="presentation" @click.self="close">
      <div class="buff-picker-modal" role="dialog" aria-modal="true" aria-label="选择 Buff">
        <header class="buff-picker-header">
          <div class="buff-picker-header-main">
            <div class="buff-picker-title-row">
              <h3>选择 Buff</h3>
              <button type="button" class="close-btn" aria-label="关闭" @click="close">×</button>
            </div>
            <p>按增益块或块内单条效果勾选；全队增益在一处取消后所有角色同步取消。</p>
            <div v-if="slotOptions?.length" class="slot-tabs">
              <button
                v-for="opt in slotOptions"
                :key="opt.index"
                type="button"
                class="slot-tab"
                :class="{ active: viewSlotIndex === opt.index }"
                @click="viewSlotIndex = opt.index"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
        </header>

        <div class="toolbar">
          <input
            v-model="search"
            type="search"
            class="search"
            placeholder="搜索来源、名称、效果"
          />
          <span class="count">已选 {{ selectedCount }} 项</span>
          <button type="button" class="ghost" @click="addCurrentList">添加当前列表</button>
          <button type="button" class="ghost" @click="removeCurrentList">移除当前列表</button>
        </div>

        <div class="group-tabs">
          <button
            v-for="group in availableGroups"
            :key="group"
            type="button"
            class="group-tab"
            :class="{ active: activeGroup === group }"
            @click="activeGroup = group"
          >
            {{ group }}
          </button>
        </div>

        <div v-if="!filteredCards.length" class="empty">当前筛选下无可选增益</div>
        <div v-else class="list">
          <article
            v-for="card in filteredCards"
            :key="card.key"
            class="buff-row"
            :class="{
              selected: cardSelected(card),
              partial: cardPartial(card),
            }"
          >
            <div class="buff-row-main">
              <input
                type="checkbox"
                class="buff-check"
                :checked="cardSelected(card)"
                :indeterminate.prop="cardPartial(card)"
                @change="toggleCard(card)"
              />
              <button type="button" class="buff-row-toggle" @click="toggleCard(card)">
                <CalculatorAvatar
                  class="buff-avatar"
                  :avatar-image="card.providerAvatar"
                  :name="card.providerName"
                />
                <span class="buff-copy">
                  <strong :title="`${card.providerName} | ${card.blockName}`">
                    {{ card.providerName }}
                    <span class="title-sep">|</span>
                    {{ card.blockName }}
                  </strong>
                  <small v-if="card.note" :title="card.note">{{ card.note }}</small>
                </span>
              </button>
            </div>

            <div class="buff-effect-lines">
              <div v-for="item in card.items" :key="item.effect.id" class="buff-effect-row">
                <label class="buff-effect-check" @click.stop>
                  <input
                    type="checkbox"
                    class="buff-check buff-check--inline"
                    :checked="isEnabled(item)"
                    @change="toggleEffect(item)"
                  />
                  <span class="buff-effect-text">{{ effectResultText(item) }}</span>
                </label>
                <label
                  v-if="isStackable(item)"
                  class="rule-coverage-control"
                  @click.stop
                >
                  <span>层数</span>
                  <NumberStepper
                    :model-value="stacksModel(item, item.effect.defaultStacks ?? 1)"
                    :min="0"
                    :max="item.effect.maxStacks ?? 99"
                    :disabled="!isEnabled(item)"
                    @update:model-value="setStacks(item, $event)"
                  />
                </label>
                <label
                  v-else-if="isConvert(item) && item.effect.convert"
                  class="rule-coverage-control convert"
                  @click.stop
                >
                  <span>
                    {{ panelSourceLabel(item) }}·{{ attrLabel(item.effect.convert.from) }}
                    → {{ formatSigned(convertResult(item)) }}
                  </span>
                  <template
                    v-if="
                      isManualConvert(item) ||
                      hasConvertOverride(item) ||
                      showConvertOverride[item.effect.id]
                    "
                  >
                    <NumberStepper
                      :model-value="convertOverrideModel(item)"
                      :min="0"
                      :max="999999"
                      :step="isManualConvert(item) && item.effect.convert.from === 'level' ? 1 : 10"
                      :disabled="!isEnabled(item)"
                      @update:model-value="setConvert(item, $event)"
                    />
                    <button
                      v-if="!isManualConvert(item)"
                      type="button"
                      class="convert-clear"
                      @click="clearConvertOverride(item)"
                    >
                      实时
                    </button>
                    <button
                      v-else
                      type="button"
                      class="convert-clear"
                      @click="clearConvertOverride(item)"
                    >
                      复位
                    </button>
                  </template>
                  <button
                    v-else
                    type="button"
                    class="convert-clear"
                    :disabled="!isEnabled(item)"
                    @click="showConvertOverride[item.effect.id] = true"
                  >
                    覆盖
                  </button>
                </label>
              </div>
            </div>

            <div class="chip-row">
              <span
                v-for="stat in [...new Set(card.items.map((item) => item.effect.stat))]"
                :key="stat"
                class="chip"
              >
                {{ statLabel(stat) }}
              </span>
              <span
                v-if="situationLabel(card.items[0]!) !== '全局'"
                class="chip muted"
              >
                {{ situationLabel(card.items[0]!) }}
              </span>
            </div>
          </article>
        </div>

        <footer class="buff-picker-footer">
          <span class="muted">勾选即时生效</span>
          <button type="button" class="primary" @click="close">完成</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.buff-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(8, 12, 20, 0.72);
}

.buff-picker-modal {
  width: min(1080px, calc(100vw - 16px));
  max-height: min(88vh, 900px);
  display: flex;
  flex-direction: column;
  border: 1px solid #4a5563;
  border-radius: 14px;
  background: #141922;
  color: #e8ecf4;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
}

.buff-picker-header {
  padding: 1rem 1.1rem 0.85rem;
  border-bottom: 1px solid #2d3646;
}

.buff-picker-header-main {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.buff-picker-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.slot-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.15rem 0 0;
}

.slot-tab {
  border: 1px solid #3a4455;
  border-radius: 8px;
  background: #151a24;
  color: #c8d0dc;
  padding: 0.28rem 0.7rem;
  font-size: 0.82rem;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}

.slot-tab:hover {
  border-color: #4f5d72;
  background: #1c2432;
}

.slot-tab.active {
  border-color: #6b8f4e;
  background: #243018;
  color: #e8f0dc;
}

.buff-picker-header h3 {
  margin: 0;
  font-size: 1.05rem;
  color: #f4f7fc;
}

.buff-picker-header p {
  margin: 0.25rem 0 0;
  font-size: 0.78rem;
  color: #9aa3b5;
}

.close-btn {
  border: none;
  background: transparent;
  font-size: 1.45rem;
  line-height: 1;
  cursor: pointer;
  color: #c5ccd8;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  align-items: center;
  padding: 0.85rem 1.1rem 0.35rem;
}

.search {
  flex: 1 1 12rem;
  min-width: 10rem;
  border: 1px solid #4a5563;
  border-radius: 8px;
  background: #1a1f2a;
  color: #e8ecf4;
  padding: 0.45rem 0.65rem;
}

.count {
  font-size: 0.8rem;
  padding: 0.25rem 0.65rem;
  border-radius: 999px;
  border: 1px solid #4a5563;
  background: #1b2230;
  color: #c9a55c;
}

.ghost,
.group-tab,
.primary {
  border: 1px solid #4a5563;
  border-radius: 8px;
  background: #1b2230;
  color: #e8ecf4;
  padding: 0.35rem 0.7rem;
  font-size: 0.8rem;
  cursor: pointer;
}

.primary {
  border-color: rgba(63, 140, 255, 0.55);
  background: rgba(63, 140, 255, 0.16);
  color: #8cbcff;
}

.group-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0.45rem 1.1rem 0.75rem;
  padding: 0.55rem;
  border-radius: 10px;
  background: #1a2030;
}

.group-tab.active {
  border-color: #3f8cff;
  color: #8cbcff;
  background: rgba(63, 140, 255, 0.12);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0 1.1rem 0.85rem;
  overflow: auto;
  min-height: 0;
  flex: 1;
}

.buff-row {
  display: grid;
  gap: 0.65rem;
  padding: 0.85rem 0.95rem;
  border: 1px solid #3a4456;
  border-radius: 12px;
  background: #181e2a;
}

.buff-row.selected {
  border-color: rgba(63, 140, 255, 0.7);
  background: rgba(63, 140, 255, 0.08);
}

.buff-row.partial {
  border-color: rgba(63, 140, 255, 0.45);
}

.buff-row-main {
  display: flex;
  gap: 0.55rem;
  align-items: flex-start;
}

.buff-check {
  width: 1.15rem;
  height: 1.15rem;
  flex: 0 0 auto;
  margin-top: 0.55rem;
  accent-color: #2f7df6;
}

.buff-row-toggle {
  flex: 1;
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  padding: 0.35rem 0.4rem;
}

.buff-row-toggle:hover {
  border-color: rgba(63, 140, 255, 0.25);
  background: rgba(63, 140, 255, 0.05);
}

.buff-avatar {
  width: 40px;
  height: 40px;
  margin-top: 0.1rem;
}

.buff-copy {
  flex: 1;
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}

.buff-copy strong {
  font-size: 0.95rem;
  color: #f2f5fb;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-sep {
  margin: 0 0.28rem;
  font-weight: 600;
  color: #9aa3b5;
}

.buff-copy small {
  color: #9aa3b5;
  font-size: 0.76rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.buff-effect-lines {
  display: grid;
  gap: 0;
}

.buff-effect-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.65rem;
  align-items: center;
  padding: 0.45rem 0;
  border-bottom: 1px solid #2d3646;
}

.buff-effect-check {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  min-width: 0;
  cursor: pointer;
}

.buff-check--inline {
  margin-top: 0.15rem;
}

.buff-effect-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.buff-effect-text {
  min-width: 0;
  font-size: 0.9rem;
  font-weight: 700;
  color: #f2f5fb;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.rule-coverage-control {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #9aa3b5;
  font-size: 0.74rem;
  font-weight: 650;
  white-space: nowrap;
}

.rule-coverage-control :deep(.num-stepper) {
  max-width: 9.5rem;
  min-width: 8rem;
}

.convert-clear {
  border: 1px solid #4a5563;
  border-radius: 6px;
  background: #1b2230;
  color: #9aa3b5;
  padding: 0.2rem 0.45rem;
  font-size: 0.72rem;
  cursor: pointer;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.chip {
  display: inline-flex;
  padding: 0.12rem 0.5rem;
  border-radius: 999px;
  border: 1px solid #4a5563;
  background: #1b2230;
  font-size: 0.72rem;
  color: #d5dae4;
}

.empty {
  opacity: 0.65;
  font-size: 0.85rem;
  padding: 1.5rem 1.1rem;
}

.buff-picker-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1.1rem 1rem;
  border-top: 1px solid #2d3646;
}

.muted {
  font-size: 0.78rem;
  color: #8b93a3;
}
</style>
