<script setup lang="ts">
/**
 * 额外 Buff 编辑器（Spec §4.1 / §4.2）。
 *
 * 布局与增益库一致：**左侧是增益清单（每条一个名字，依次排下去），选中的那条在右侧编辑**。
 * 不折叠、不做树、卡片内不加效果 —— 一条增益 = 一行共享效果行。
 *
 * 其它约束：
 * - `v-model` 的入参/出参是 `ExtraBuffGain[]`，类型定义只在 `@/types/extraBuff`。
 * - 任何字段改动都**重建卡片对象并广播新数组**：目录缓存键按对象身份记忆化，
 *   就地改同一个数组会让计算结果不刷新（Spec §4.2 第 6 项）。
 */
import { computed, nextTick, ref, watch } from 'vue'
import AdminBuffEffectRow from '@/components/admin/calculator/AdminBuffEffectRow.vue'
import type { AgentBuffDoc, BuffDamageType, BuffEffect } from '@/types/calculator'
import type { ExtraBuffApplySlot, ExtraBuffGain, ExtraBuffSlotIndex } from '@/types/extraBuff'
import {
  createExtraBuffGain,
  extraGainAppliesToSlot,
  serializeExtraGains,
} from '@/utils/extraBuffCalc'
import {
  buildEffectRows,
  changeRowZone,
  toggleRowDamageType,
  type EffectRow,
} from '@/utils/buffEffectRows'
import { findBuffStatZoneById } from '@/utils/buffStatZones'
import { teamSlotDisplayLabel } from '@/utils/teamSlotLabel'

import { formatCalcDecimal } from '@/utils/calcNumberFormat'
import { buffStatDisplayLabel } from '@/utils/buffStatZones'

const props = defineProps<{
  teamSlots?: Array<{ agentId?: string | null }>
  agents?: AgentBuffDoc[]
}>()

const gains = defineModel<ExtraBuffGain[]>({ required: true })

/** 编辑副本：共享效果行会就地改传入的对象，所以这里只碰副本，改完再广播 */
const local = ref<ExtraBuffGain[]>(serializeExtraGains(gains.value))
let lastSignature = JSON.stringify(serializeExtraGains(gains.value))

function signatureOf(cards: readonly ExtraBuffGain[]): string {
  return JSON.stringify(serializeExtraGains([...cards]))
}

/** 右侧正在编辑的那条（只存 id；不持久化） */
const selectedId = ref<string>(local.value[0]?.id ?? '')

function ensureSelection() {
  if (!local.value.length) {
    selectedId.value = ''
    return
  }
  if (!local.value.some((card) => card.id === selectedId.value)) {
    selectedId.value = local.value[0]!.id
  }
}

watch(
  () => gains.value,
  (next) => {
    const signature = signatureOf(next ?? [])
    if (signature === lastSignature) return
    local.value = serializeExtraGains(next ?? [])
    lastSignature = signature
    ensureSelection()
  },
)

/** 广播：把副本重建为新数组（派生 applyTarget，保持 id/顺序） */
function broadcast() {
  const rebuilt = serializeExtraGains(local.value).map((card) => ({
    ...card,
    effects: card.effects.map((effect) => ({
      ...effect,
      applyTarget: (card.applySlot === 'team' ? 'team' : 'self') as BuffEffect['applyTarget'],
    })),
  }))
  const signature = signatureOf(rebuilt)
  if (signature === lastSignature) return
  lastSignature = signature
  gains.value = rebuilt
}

watch(local, broadcast, { deep: true })

const selectedCard = computed(
  () => local.value.find((card) => card.id === selectedId.value) ?? null,
)

const nameInput = ref<HTMLInputElement | null>(null)

/** 槽位选项：作用对象与来源槽位共用（Spec §4.2 第 1 项） */
const slotOptions = computed(() => {
  const slots = props.teamSlots ?? []
  const agents = props.agents ?? []
  return [0, 1, 2].map((index) => {
    const slot = slots[index] ?? { agentId: '' }
    const label = teamSlotDisplayLabel(slot, index, agents)
    return { value: index as ExtraBuffSlotIndex, label: `${label}（槽位 ${index + 1}）` }
  })
})

const applySlotOptions = computed(() => slotOptions.value)

function addGain() {
  const card = createExtraBuffGain({ applySlot: 0, sourceSlot: 0 })
  local.value = [...local.value, card]
  selectedId.value = card.id
  void nextTick(() => {
    nameInput.value?.focus()
    nameInput.value?.select()
  })
}

function removeGain(id: string) {
  const index = local.value.findIndex((card) => card.id === id)
  local.value = local.value.filter((card) => card.id !== id)
  if (selectedId.value === id) {
    const fallback = local.value[Math.min(index, local.value.length - 1)] ?? null
    selectedId.value = fallback?.id ?? ''
  }
  ensureSelection()
}

function normalizeName(card: ExtraBuffGain) {
  const text = card.name.trim()
  card.name = text || '自定义增益'
}

function setApplySlot(card: ExtraBuffGain, value: ExtraBuffApplySlot) {
  card.applySlot = value
}

function setSourceSlot(card: ExtraBuffGain, value: ExtraBuffSlotIndex) {
  card.sourceSlot = value
}

/** 一条增益在共享效果行里的当前行（一卡恰好一行） */
function rowsOf(card: ExtraBuffGain): EffectRow[] {
  return buildEffectRows(card.effects)
}

function onChangeZone(card: ExtraBuffGain, row: EffectRow, zoneId: string, types: BuffDamageType[]) {
  const zone = findBuffStatZoneById(zoneId)
  if (!zone) return
  card.effects = changeRowZone(card.effects, row, zone, types)
}

function onToggleType(card: ExtraBuffGain, row: EffectRow, type: BuffDamageType, checked: boolean) {
  card.effects = toggleRowDamageType(card.effects, row, type, checked)
}

const appliesToLabel = (card: ExtraBuffGain): string =>
  card.applySlot === 'team'
    ? '全队'
    : (slotOptions.value.find((opt) => opt.value === card.applySlot)?.label ?? '槽位 1')

const listNameOf = (card: ExtraBuffGain): string => card.name.trim() || '自定义增益'

/** 左栏一行摘要：属性 + 数值（够判断是哪条，不用展开看） */
function summaryOf(card: ExtraBuffGain): string {
  const effect = card.effects[0]
  if (!effect) return ''
  // 自定义乘区（如 custom:emberMarkRatio）要有登记名，别露出内部键
  const label = buffStatDisplayLabel(effect.stat)
  const num = (value: number) => formatCalcDecimal(value)
  if (effect.kind === 'stacked') {
    return `${label} ${num(effect.valuePerStack ?? 0)}/层 × ${num(effect.defaultStacks ?? 0)} 层`
  }
  if (effect.kind === 'convert') {
    return `${label} 转模 ${num(effect.convert?.ratioPercent ?? 0)}%`
  }
  return `${label} +${num(effect.value ?? 0)}`
}

defineExpose({
  /** 给测试/调试用：当前卡片数 */
  gainCount: computed(() => local.value.length),
  appliesToLabel,
  extraGainAppliesToSlot,
})
</script>

<template>
  <div class="extra-buff-editor">
    <aside class="extra-buff-side">
      <div class="extra-buff-side-head">
        <button type="button" class="add-btn" @click="addGain">＋ 添加增益</button>
        <span class="extra-buff-count">共 {{ local.length }} 条</span>
      </div>

      <p v-if="!local.length" class="extra-buff-empty">
        还没有额外 Buff。点「添加增益」新建一条。
      </p>

      <!--
        左侧是**清单**：一条一行依次排下去（用户 2026-10-26：下拉框里只看得到一条、点不到其它）。
        条目多时在框内滚动（`max-height` + `overflow`），弹窗高度不跟着涨。
      -->
      <ul v-else class="extra-buff-list">
        <li v-for="card in local" :key="card.id">
          <button
            type="button"
            class="extra-buff-list-item"
            :class="{ 'is-active': card.id === selectedId }"
            :aria-current="card.id === selectedId ? 'true' : undefined"
            @click="selectedId = card.id"
          >
            <span class="extra-buff-list-name" :title="listNameOf(card)">{{ listNameOf(card) }}</span>
            <span class="extra-buff-list-slot">
              {{ appliesToLabel(card) }} · {{ summaryOf(card) }}
            </span>
          </button>
        </li>
      </ul>
    </aside>

    <section class="extra-buff-detail">
      <template v-if="selectedCard">
        <header class="extra-buff-detail-head">
          <input
            ref="nameInput"
            v-model="selectedCard.name"
            type="text"
            class="extra-buff-name"
            placeholder="自定义增益"
            :aria-label="`额外 Buff 名称 ${selectedCard.name}`"
            @blur="normalizeName(selectedCard)"
          />
          <span class="extra-buff-scope" :title="appliesToLabel(selectedCard)">
            {{ appliesToLabel(selectedCard) }}
          </span>
          <button type="button" class="extra-buff-remove" @click="removeGain(selectedCard.id)">
            移除
          </button>
        </header>

        <div class="extra-buff-card-body">
          <AdminBuffEffectRow
            v-for="row in rowsOf(selectedCard)"
            :key="row.key"
            :row="row"
            :agent-id="undefined"
            context-mode="extra"
            :apply-slot="selectedCard.applySlot"
            :source-slot="selectedCard.sourceSlot"
            :slot-options="applySlotOptions"
            @change-zone="(zoneId, types) => onChangeZone(selectedCard!, row, zoneId, types)"
            @toggle-type="(type, checked) => onToggleType(selectedCard!, row, type, checked)"
            @update:applySlot="(value) => setApplySlot(selectedCard!, value)"
            @update:sourceSlot="(value) => setSourceSlot(selectedCard!, value)"
          />
        </div>
      </template>

      <p v-else class="extra-buff-empty">
        左侧选一条增益开始编辑，或点「＋ 添加增益」新建。
      </p>
    </section>
  </div>
</template>

<style scoped>
/*
 * 主题：弹窗 Teleport 到 body，拿不到 `.calculator-page` 上的 `--calc-*`，
 * 所以这里用全局 `--color-*`（随 `html[data-theme]` 翻转）+ `color-mix` 派生，
 * 白天/暗夜共用一套声明，不再各写一份覆盖。
 */
.extra-buff-editor {
  --eb-surface: var(--color-background-soft, #141922);
  --eb-surface-2: var(--color-background-mute, #1a1f2a);
  --eb-border: var(--color-border, #2d3646);
  --eb-text: var(--color-text, #e8ecf4);
  --eb-muted: color-mix(in srgb, var(--color-text, #e8ecf4) 64%, transparent);
  --eb-input-bg: color-mix(in srgb, var(--color-background, #10141c) 88%, var(--color-text, #e8ecf4) 5%);
  --eb-accent: #c9a55c;
  display: grid;
  /*
   * 左栏放下拉框 + 摘要即可，不必占一半：共享效果行在 780px 以下会开始换行、反而更难读，
   * 所以左栏取 1/3（最小 260px），右侧拿剩余空间。要改回一半只动这一行。
   */
  grid-template-columns: minmax(260px, 33%) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
  font-size: 0.95rem;
  color: var(--eb-text);
}

/* ---------- 左侧：增益清单 ---------- */
.extra-buff-side {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
  padding-right: 0.9rem;
  border-right: 1px solid var(--eb-border);
}

.extra-buff-side-head {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.add-btn {
  border: 1px solid var(--eb-border);
  border-radius: 10px;
  background: var(--eb-surface-2);
  color: var(--eb-text);
  padding: 0.5rem 0.9rem;
  font-size: 0.95rem;
  font-weight: 600;
  min-height: 2.4rem;
  cursor: pointer;
}

.add-btn:hover {
  border-color: var(--eb-accent);
  background: color-mix(in srgb, var(--eb-accent) 12%, var(--eb-surface-2));
}

.extra-buff-count {
  font-size: 0.85rem;
  color: var(--eb-muted);
}

/* ---------- 左侧清单（条目多时框内滚动，不撑高弹窗） ---------- */
.extra-buff-list {
  list-style: none;
  margin: 0;
  padding: 0.15rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-height: 52vh;
  overflow: auto;
  overscroll-behavior: contain;
}

.extra-buff-list-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--eb-text);
  padding: 0.45rem 0.55rem;
  font-size: 0.95rem;
  cursor: pointer;
}

.extra-buff-list-item:hover {
  background: color-mix(in srgb, var(--eb-text) 7%, transparent);
}

.extra-buff-list-item.is-active {
  border-color: var(--eb-accent);
  background: color-mix(in srgb, var(--eb-accent) 14%, transparent);
}

.extra-buff-list-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.extra-buff-list-slot {
  font-size: 0.78rem;
  color: var(--eb-muted);
}

/* ---------- 右侧：选中那条的编辑区（自己滚，不跟左侧联动） ---------- */
.extra-buff-detail {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  /* 右侧独立滚动：长表单不会把弹窗顶高 */
  max-height: 62vh;
  overflow: auto;
  padding-right: 0.2rem;
}

.extra-buff-detail-head {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}

.extra-buff-empty {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--eb-muted);
}

.extra-buff-name {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--eb-border);
  border-radius: 9px;
  background: var(--eb-input-bg);
  color: var(--eb-text);
  padding: 0.5rem 0.7rem;
  font-size: 1.05rem;
  line-height: 1.4;
}

.extra-buff-name:focus-visible {
  outline: 2px solid var(--eb-accent);
  outline-offset: 1px;
}

.extra-buff-scope {
  flex-shrink: 0;
  font-size: 0.85rem;
  color: var(--eb-muted);
  border: 1px solid var(--eb-border);
  border-radius: 999px;
  padding: 0.25rem 0.65rem;
  white-space: nowrap;
}

.extra-buff-remove {
  flex-shrink: 0;
  border: 1px solid color-mix(in srgb, #d9534f 55%, var(--eb-border));
  border-radius: 9px;
  background: transparent;
  color: color-mix(in srgb, #d9534f 78%, var(--eb-text) 22%);
  padding: 0.4rem 0.8rem;
  font-size: 0.9rem;
  min-height: 2.2rem;
  cursor: pointer;
}

.extra-buff-remove:hover {
  background: color-mix(in srgb, #d9534f 14%, transparent);
}

.extra-buff-card-body {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

/*
 * 共享效果行本身是管理端的紧凑排版；额外 Buff 一屏只有一条，空间充足 ——
 * 这里只在**本容器内**把它放大，不改共享组件，也不影响增益库那侧的密度。
 */
.extra-buff-card-body :deep(.effect-row) {
  font-size: 0.95rem;
  padding: 0.75rem 0.85rem;
  background: transparent;
  border-color: color-mix(in srgb, var(--eb-border) 80%, transparent);
}

.extra-buff-card-body :deep(.effect-title strong) {
  font-size: 1rem;
}

.extra-buff-card-body :deep(.line-label),
.extra-buff-card-body :deep(.inline-field > span) {
  font-size: 0.9rem;
}

.extra-buff-card-body :deep(select),
.extra-buff-card-body :deep(input[type='text']),
.extra-buff-card-body :deep(.step-input) {
  font-size: 0.95rem;
  min-height: 2.1rem;
}

.extra-buff-card-body :deep(.summary-value) {
  font-size: 1rem;
}

/* 窄屏：清单在上、详情在下，仍然不产生横向滚动 */
@media (max-width: 900px) {
  .extra-buff-editor {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.8rem;
  }

  .extra-buff-side {
    border-right: none;
    border-bottom: 1px solid var(--eb-border);
    padding-right: 0;
    padding-bottom: 0.7rem;
  }

  .extra-buff-list {
    max-height: 28vh;
  }

  .extra-buff-detail {
    max-height: none;
  }

  .extra-buff-detail-head {
    flex-wrap: wrap;
  }

  .extra-buff-name {
    flex-basis: 100%;
  }
}
</style>
