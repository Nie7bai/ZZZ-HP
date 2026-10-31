<script setup lang="ts">
import { computed, ref } from 'vue'
import { buildEventZoneDisplay, type EventZoneDisplayRow } from '@/utils/eventDamageSourceTips'
import { skillCalcZoneGroup } from '@/utils/skillCalcZones'
import type { SkillFlowCalculationDetail } from '@/utils/skillFlowCalculation'
import type { StatSourceGroup } from '@/utils/statSourceTips'

/**
 * 「计算过程」乘区格：与招式流程详情的计算过程同一套渲染（提供者 / 触发者两框 + 混用框 + 结果格）。
 * 供伤害统计的招式贡献排行复用，避免两处各画一套、样式漂移。
 */
const props = defineProps<{
  calculation: SkillFlowCalculationDetail | null
  /** 多次结算合计：期望 × 次数 = 合计；不传则不显示 */
  summary?: { perHit: number; count: number; total: number } | null
  /** 没有结算结果时的提示文案 */
  emptyHint?: string
  /** 异常类：按输入身份分成「异常强度提供者 / 异常类触发者 / 共用」三块列出 */
  groupByActor?: boolean
  /** 「异常强度提供者 · 名字」；缺省只显示身份 */
  producerLabel?: string
  /** 「异常类触发者 · 名字」；缺省只显示身份 */
  triggerLabel?: string
}>()

const rows = computed(() => (props.calculation ? buildEventZoneDisplay(props.calculation) : []))

interface ActorSection {
  key: 'producer' | 'trigger' | 'mixed'
  label: string
  className: string
  rows: EventZoneDisplayRow[]
}

/** 异常类：按 skillCalcZoneGroup 的格子归属把乘区行分开列，避免混在一个网格里 */
const actorSections = computed<ActorSection[]>(() => {
  if (!props.groupByActor) return []
  const pick = (group: 'producer' | 'trigger' | 'mixed') =>
    rows.value.filter((row) => skillCalcZoneGroup(row.label) === group)
  const sections: ActorSection[] = [
    {
      key: 'producer',
      label: props.producerLabel || '异常强度提供者',
      className: 'zone-box--producer',
      rows: pick('producer'),
    },
    {
      key: 'trigger',
      label: props.triggerLabel || '异常类触发者',
      className: 'zone-box--trigger',
      rows: pick('trigger'),
    },
    {
      key: 'mixed',
      label: '共用 · 敌方与环境',
      className: 'zone-box--mixed',
      rows: pick('mixed'),
    },
  ]
  return sections.filter((section) => section.rows.length)
})

/** 分组模式下最终伤害仍单独成行，与未分组时的结果格同款 */
const groupedResultRows = computed(() =>
  props.groupByActor ? rows.value.filter((row) => skillCalcZoneGroup(row.label) === 'result') : [],
)

const zoneSplit = computed(() => {
  const list = rows.value
  const singles = [
    ...new Set(
      list
        .filter((row) => row.sourceSlots.length === 1 && row.sourceLabel !== '最终伤害')
        .map((row) => row.sourceLabel),
    ),
  ]
  if (singles.length < 2) return null
  return {
    producerName: singles[0]!,
    triggerName: singles[1]!,
    producerRows: list.filter((row) => row.sourceLabel === singles[0]),
    triggerRows: list.filter((row) => row.sourceLabel === singles[1]),
    mixedRows: list.filter(
      (row) => row.sourceLabel !== '最终伤害' && !singles.slice(0, 2).includes(row.sourceLabel),
    ),
    resultRows: list.filter((row) => row.sourceLabel === '最终伤害'),
  }
})

interface ZoneTipState {
  label: string
  groups: StatSourceGroup[]
  x: number
  y: number
  transform: string
}

const zoneTip = ref<ZoneTipState | null>(null)
let zoneTipHideTimer: ReturnType<typeof setTimeout> | null = null

function clearZoneTipHideTimer() {
  if (zoneTipHideTimer == null) return
  clearTimeout(zoneTipHideTimer)
  zoneTipHideTimer = null
}

function zoneTipGroups(row: EventZoneDisplayRow): StatSourceGroup[] {
  const projected = rows.value.find((item) => item.label === row.label)
  if (!projected) return []
  return [{ label: row.sourceLabel, items: [`${row.label} ${row.value}`] }, ...projected.groups]
}

/** 悬停即显示；定位贴着对应格子，并按上下空间自动翻转 */
function showZoneTip(row: EventZoneDisplayRow, event: Event) {
  clearZoneTipHideTimer()
  const el = event.currentTarget as HTMLElement | null
  if (!el) return
  const rect = el.getBoundingClientRect()
  const width = 400
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - width / 2),
    window.innerWidth - width - 8,
  )
  const below = rect.top < 260
  zoneTip.value = {
    label: row.label,
    groups: zoneTipGroups(row),
    x: left,
    y: below ? rect.bottom + 8 : rect.top - 8,
    transform: below ? 'none' : 'translateY(-100%)',
  }
}

function scheduleZoneTipHide() {
  clearZoneTipHideTimer()
  zoneTipHideTimer = setTimeout(() => {
    zoneTip.value = null
    zoneTipHideTimer = null
  }, 120)
}

function cancelZoneTipHide() {
  clearZoneTipHideTimer()
}

function formatDamageNumber(value: number) {
  return Math.round(value).toLocaleString('en-US')
}
</script>

<template>
  <div class="flow-zone-calculation">
    <template v-if="actorSections.length">
      <section
        v-for="section in actorSections"
        :key="section.key"
        class="zone-box"
        :class="section.className"
      >
        <header class="zone-box-head">
          <strong class="zone-box-name">{{ section.label }}</strong>
        </header>
        <div class="zone-display-grid">
          <div
            v-for="row in section.rows"
            :key="`${section.key}-${row.label}`"
            class="zone-display-item zone-display-item--clickable"
            :class="{ 'zone-display-item--result': row.label === '最终伤害' }"
            role="button"
            tabindex="0"
            @pointerenter="showZoneTip(row, $event)"
            @pointerleave="scheduleZoneTipHide"
            @focus="showZoneTip(row, $event)"
            @blur="scheduleZoneTipHide"
          >
            <span class="zone-display-label">{{ row.label }}</span>
            <span class="zone-display-val">{{ row.value }}</span>
          </div>
        </div>
      </section>
    </template>
    <div
      v-if="actorSections.length && groupedResultRows.length"
      class="zone-display-grid zone-result-grid"
    >
      <div
        v-for="row in groupedResultRows"
        :key="`grouped-result-${row.label}`"
        class="zone-display-item zone-display-item--clickable zone-display-item--result"
        role="button"
        tabindex="0"
        @pointerenter="showZoneTip(row, $event)"
        @pointerleave="scheduleZoneTipHide"
        @focus="showZoneTip(row, $event)"
        @blur="scheduleZoneTipHide"
      >
        <span class="zone-display-label">{{ row.label }}</span>
        <span class="zone-display-val">{{ row.value }}</span>
      </div>
    </div>
    <template v-else-if="zoneSplit">
      <div class="zone-split">
        <section class="zone-box zone-box--producer">
          <header class="zone-box-head">
            <span>采用面板</span>
            <strong class="zone-box-name">{{ zoneSplit.producerName }}</strong>
          </header>
          <div class="zone-display-grid">
            <div
              v-for="row in zoneSplit.producerRows"
              :key="`producer-${row.label}`"
              class="zone-display-item zone-display-item--clickable"
              role="button"
              tabindex="0"
              @pointerenter="showZoneTip(row, $event)"
              @pointerleave="scheduleZoneTipHide"
              @focus="showZoneTip(row, $event)"
              @blur="scheduleZoneTipHide"
            >
              <span class="zone-display-label">{{ row.label }}</span>
              <span class="zone-display-val">{{ row.value }}</span>
            </div>
          </div>
        </section>

        <section class="zone-box zone-box--trigger">
          <header class="zone-box-head">
            <span>采用面板</span>
            <strong class="zone-box-name">{{ zoneSplit.triggerName }}</strong>
          </header>
          <div class="zone-display-grid">
            <div
              v-for="row in zoneSplit.triggerRows"
              :key="`trigger-${row.label}`"
              class="zone-display-item zone-display-item--clickable"
              role="button"
              tabindex="0"
              @pointerenter="showZoneTip(row, $event)"
              @pointerleave="scheduleZoneTipHide"
              @focus="showZoneTip(row, $event)"
              @blur="scheduleZoneTipHide"
            >
              <span class="zone-display-label">{{ row.label }}</span>
              <span class="zone-display-val">{{ row.value }}</span>
            </div>
          </div>
        </section>
      </div>

      <section v-if="zoneSplit.mixedRows.length" class="zone-box zone-box--mixed">
        <header class="zone-box-head">
          <span>多个面板 / 事件参数</span>
        </header>
        <div class="zone-display-grid">
          <div
            v-for="row in zoneSplit.mixedRows"
            :key="`mixed-${row.label}`"
            class="zone-display-item zone-display-item--clickable"
            role="button"
            tabindex="0"
            @pointerenter="showZoneTip(row, $event)"
            @pointerleave="scheduleZoneTipHide"
            @focus="showZoneTip(row, $event)"
            @blur="scheduleZoneTipHide"
          >
            <span class="zone-display-label">{{ row.label }}</span>
            <span class="zone-display-val">{{ row.value }}</span>
          </div>
        </div>
      </section>

      <div v-if="zoneSplit.resultRows.length" class="zone-display-grid zone-result-grid">
        <div
          v-for="row in zoneSplit.resultRows"
          :key="`result-${row.label}`"
          class="zone-display-item zone-display-item--clickable zone-display-item--result"
          role="button"
          tabindex="0"
          @pointerenter="showZoneTip(row, $event)"
          @pointerleave="scheduleZoneTipHide"
          @focus="showZoneTip(row, $event)"
          @blur="scheduleZoneTipHide"
        >
          <span class="zone-display-label">{{ row.label }}</span>
          <span class="zone-display-val">{{ row.value }}</span>
        </div>
      </div>
    </template>

    <div v-else-if="rows.length" class="zone-display-grid">
      <div
        v-for="row in rows"
        :key="row.label"
        class="zone-display-item zone-display-item--clickable"
        role="button"
        tabindex="0"
        @pointerenter="showZoneTip(row, $event)"
        @pointerleave="scheduleZoneTipHide"
        @focus="showZoneTip(row, $event)"
        @blur="scheduleZoneTipHide"
      >
        <span class="zone-display-label">{{ row.label }}</span>
        <span class="zone-display-val">{{ row.value }}</span>
      </div>
    </div>

    <p v-else-if="emptyHint" class="zone-empty">{{ emptyHint }}</p>

    <div v-if="summary" class="zone-summary">
      <span class="zone-summary-label">计算合计</span>
      <span class="zone-summary-formula">
        期望 {{ formatDamageNumber(summary.perHit) }}
        <template v-if="summary.count > 1">
          × {{ summary.count }} 次 = 合计
          <strong>{{ formatDamageNumber(summary.total) }}</strong>
        </template>
        <template v-else>
          = 合计 <strong>{{ formatDamageNumber(summary.total) }}</strong>
        </template>
      </span>
    </div>

    <Teleport to="body">
      <div
        v-if="zoneTip"
        class="zone-tip stat-value-tip"
        :style="{
          left: `${zoneTip.x}px`,
          top: `${zoneTip.y}px`,
          transform: zoneTip.transform,
        }"
        @pointerenter="cancelZoneTipHide"
        @pointerleave="scheduleZoneTipHide"
      >
        <p class="tip-title">{{ zoneTip.label }}</p>
        <div class="tip-groups">
          <div
            v-for="(group, groupIndex) in zoneTip.groups"
            :key="groupIndex"
            class="tip-group"
            :class="{ 'tip-group--full': group.fullWidth }"
          >
            <p class="tip-label">{{ group.label }}</p>
            <ul class="tip-items">
              <li v-for="(item, itemIndex) in group.items" :key="itemIndex">{{ item }}</li>
            </ul>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.flow-zone-calculation {
  display: flex;
  flex-direction: column;
}

.zone-display-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
  gap: 0.4rem;
}

.zone-display-item {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid #2a3038;
  border-radius: 8px;
  background: #12161d;
}

.zone-display-label {
  font-size: 0.7rem;
  color: #9aa3b0;
}

.zone-display-val {
  font-size: 0.86rem;
  font-weight: 700;
  color: #e8edf5;
  font-variant-numeric: tabular-nums;
}

/* 提供者 / 触发者两框（两者不同角色时） */
.zone-split {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.zone-box {
  padding: 0.5rem 0.55rem;
  border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
  border-radius: 10px;
}

.zone-box--producer {
  border-color: color-mix(in srgb, #6f9fd0 60%, var(--color-border));
  background: color-mix(in srgb, #6f9fd0 6%, transparent);
}

.zone-box--trigger {
  border-color: color-mix(in srgb, #c9a55c 55%, var(--color-border));
  background: color-mix(in srgb, #c9a55c 6%, transparent);
}

/* 通用乘区：同时含提供者与触发者数据，单独一条，不塞进任一框 */
.zone-box--mixed {
  margin-top: 0.55rem;
  background: transparent;
}

.zone-box-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--color-heading);
}

.zone-box-name {
  font-weight: 600;
  opacity: 0.8;
}

.zone-result-grid {
  margin-top: 0.5rem;
}

.zone-display-item--clickable {
  cursor: pointer;
}

.zone-display-item--clickable:hover {
  border-color: color-mix(in srgb, #c9a55c 65%, var(--color-border));
}

.zone-display-item--result .zone-display-val {
  color: #8fc9ee;
}

/* 乘区详解弹层：外观复用事件详情用的 .stat-value-tip，这里只补定位 */
.zone-tip {
  position: fixed;
  z-index: 1301;
  width: 400px;
  max-width: calc(100vw - 16px);
}

.zone-tip::after,
.zone-tip::before {
  display: none;
}

.zone-empty {
  margin: 0;
  font-size: 0.76rem;
  color: var(--color-text-muted, #9aa3b0);
}

/* 多次结算合计：期望 × 次数 = 合计 */
.zone-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.35rem 0.75rem;
  margin-top: 0.6rem;
  padding-top: 0.5rem;
  border-top: 1px dashed color-mix(in srgb, var(--color-border) 60%, transparent);
  font-size: 0.8rem;
  color: var(--color-heading);
}

.zone-summary-label {
  font-weight: 700;
  opacity: 0.85;
}

.zone-summary-formula strong {
  font-size: 0.95rem;
  color: #8fc9ee;
  font-variant-numeric: tabular-nums;
}
</style>
