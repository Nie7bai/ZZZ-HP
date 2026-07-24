<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import NumberStepper from '@/components/common/NumberStepper.vue'
import type { CharacterAttrKey } from '@/types/calculator'
import type { CollectedEffect, BuffSelectionState } from '@/utils/panelBuffCalc'
import { resolveConvertValue } from '@/utils/buffEffect'
import { buffStatFieldLabel, BUFF_STAT_FIELDS } from '@/utils/calculatorUi'
import { CHARACTER_ATTR_OPTIONS } from '@/types/calculator'

const props = defineProps<{
  effects: CollectedEffect[]
  attrDefaults?: Partial<Record<CharacterAttrKey, number>>
}>()

const open = defineModel<boolean>('open', { default: false })
const selection = defineModel<BuffSelectionState>('selection', { required: true })

const search = ref('')
const activeGroup = ref('全部')

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

function isEnabled(id: string, fallback: boolean) {
  if (id in selection.value.enabledIds) return selection.value.enabledIds[id]!
  return fallback
}

function setEnabled(id: string, enabled: boolean) {
  selection.value.enabledIds[id] = enabled
}

function stacksModel(id: string, fallback: number) {
  if (!(id in selection.value.stacksByEffectId)) {
    selection.value.stacksByEffectId[id] = fallback
  }
  return selection.value.stacksByEffectId[id]!
}

function setStacks(id: string, value: number) {
  selection.value.stacksByEffectId[id] = Math.max(0, value)
}

function defaultConvertBase(item: CollectedEffect) {
  const convert = item.effect.convert
  if (!convert) return 0
  if (convert.defaultBase != null && Number.isFinite(convert.defaultBase)) {
    return convert.defaultBase
  }
  return props.attrDefaults?.[convert.from] ?? 0
}

function convertModel(id: string, item: CollectedEffect) {
  if (!(id in selection.value.convertInputs)) {
    selection.value.convertInputs[id] = defaultConvertBase(item)
  }
  return selection.value.convertInputs[id]!
}

function setConvert(id: string, value: number) {
  selection.value.convertInputs[id] = Math.max(0, value)
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
  const rounded = Math.round(value * 100) / 100
  return `${rounded >= 0 ? '+ ' : ''}${rounded}`
}

/** 参考站效果行：属性名 + 数值 */
function effectResultText(item: CollectedEffect) {
  const label = statLabel(item.effect.stat)
  if (item.effect.kind === 'stacked' || item.effect.stackable) {
    const stacks = stacksModel(item.effect.id, item.effect.defaultStacks ?? 1)
    const per = item.effect.valuePerStack ?? 0
    return `${label} ${formatSigned(per * stacks)}`
  }
  if (item.effect.kind === 'convert') {
    return `${label} ${formatSigned(convertResult(item))}`
  }
  return `${label} ${formatSigned(Number(item.effect.value) || 0)}`
}

function convertResult(item: CollectedEffect) {
  const base = convertModel(item.effect.id, item)
  return resolveConvertValue(item.effect, props.attrDefaults ?? {}, base)
}

function isStackable(item: CollectedEffect) {
  return item.effect.kind === 'stacked' || Boolean(item.effect.stackable)
}

function isConvert(item: CollectedEffect) {
  return item.effect.kind === 'convert' && Boolean(item.effect.convert)
}

function cardSelected(card: BuffCardGroup) {
  return card.items.every((item) =>
    isEnabled(item.effect.id, item.effect.enabledDefault !== false),
  )
}

function cardPartial(card: BuffCardGroup) {
  const states = card.items.map((item) =>
    isEnabled(item.effect.id, item.effect.enabledDefault !== false),
  )
  const on = states.filter(Boolean).length
  return on > 0 && on < states.length
}

function toggleCard(card: BuffCardGroup) {
  const next = !cardSelected(card)
  for (const item of card.items) {
    setEnabled(item.effect.id, next)
  }
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
  () =>
    props.effects.filter((item) =>
      isEnabled(item.effect.id, item.effect.enabledDefault !== false),
    ).length,
)

function addCurrentList() {
  for (const item of filtered.value) {
    setEnabled(item.effect.id, true)
  }
}

function removeCurrentList() {
  for (const item of filtered.value) {
    setEnabled(item.effect.id, false)
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
          <div>
            <h3>选择 Buff</h3>
            <p>按增益块勾选；块内每条效果独立计入计算。</p>
          </div>
          <button type="button" class="close-btn" aria-label="关闭" @click="close">×</button>
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
                <span class="buff-effect-text">{{ effectResultText(item) }}</span>
                <label
                  v-if="isStackable(item)"
                  class="rule-coverage-control"
                  @click.stop
                >
                  <span>层数</span>
                  <NumberStepper
                    :model-value="stacksModel(item.effect.id, item.effect.defaultStacks ?? 1)"
                    :min="0"
                    :max="item.effect.maxStacks ?? 99"
                    :disabled="!isEnabled(item.effect.id, item.effect.enabledDefault !== false)"
                    @update:model-value="setStacks(item.effect.id, $event)"
                  />
                </label>
                <label
                  v-else-if="isConvert(item) && item.effect.convert"
                  class="rule-coverage-control convert"
                  @click.stop
                >
                  <span>{{ attrLabel(item.effect.convert.from) }}</span>
                  <NumberStepper
                    :model-value="convertModel(item.effect.id, item)"
                    :min="0"
                    :max="999999"
                    :step="10"
                    :disabled="!isEnabled(item.effect.id, item.effect.enabledDefault !== false)"
                    @update:model-value="setConvert(item.effect.id, $event)"
                  />
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
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: flex-start;
  padding: 1rem 1.1rem 0.75rem;
  border-bottom: 1px solid #2d3646;
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
