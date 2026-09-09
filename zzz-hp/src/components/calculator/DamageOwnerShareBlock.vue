<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DamageOwnerShareSummary } from '@/utils/damageEventOwner'

const props = defineProps<{
  summary: DamageOwnerShareSummary | null | undefined
  /** 当前选中的事件 id（高亮对应明细行） */
  selectedEventId?: string | null
  /** 总伤期望标题，如「异常伤害事件总伤期望」 */
  totalLabel?: string
  /** 顶部提示文案 */
  hint?: string
  /** 未能计入总伤的事件（缺双代理人等） */
  skippedEvents?: Array<{ eventId: string; displayName: string; reason: string }>
}>()

const emit = defineEmits<{
  'select-event': [eventId: string]
}>()

const expandedOwnerIds = ref<Set<string>>(new Set())

/**
 * 仅在统计口径真正变化时重置展开状态。
 * 上游会周期性重建 summary 对象（同内容新引用），直接按引用判断会把用户展开的
 * 产生者强制折叠，因此这里比较结构签名。
 */
const summaryStructureKey = computed(() =>
  (props.summary?.shares ?? [])
    .map((item) => `${item.agentId}:${item.events.map((event) => event.eventId).join(',')}`)
    .join('|'),
)

watch(summaryStructureKey, () => {
  expandedOwnerIds.value = new Set()
})

function formatNumber(v: number) {
  return Math.round(v).toLocaleString('zh-CN')
}

function formatPct(ratio: number) {
  return `${(ratio * 100).toFixed(1)}%`
}

function isExpanded(agentId: string) {
  return expandedOwnerIds.value.has(agentId)
}

function toggleOwner(agentId: string) {
  const next = new Set(expandedOwnerIds.value)
  if (next.has(agentId)) {
    next.delete(agentId)
  } else {
    next.add(agentId)
  }
  expandedOwnerIds.value = next
}

function onOwnerKeydown(event: KeyboardEvent, agentId: string) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    toggleOwner(agentId)
  }
}

function onEventClick(eventId: string) {
  emit('select-event', eventId)
}

function eventMetaText(event: {
  total: number
  perHit?: number
  count?: number
  ratio: number
  ownerRatio: number
}) {
  const count = event.count ?? 0
  if (event.perHit != null && count > 1) {
    return `单次 ${formatNumber(event.perHit)} · 合计 ${formatNumber(event.total)}`
  }
  return formatNumber(event.total)
}
</script>

<template>
  <section v-if="summary?.shares.length || skippedEvents?.length" class="owner-share-block">
    <div class="owner-share-header">
      <h3 class="owner-share-title">产生者伤害占比</h3>
      <p class="owner-share-hint">
        {{
          hint ??
          '总伤期望已并入本区。点击产生者展开事件明细，再点事件可查看计算过程。'
        }}
      </p>
    </div>

    <p v-if="summary" class="owner-share-total">
      <span class="owner-share-total-label">{{ totalLabel ?? '伤害事件总伤期望' }}</span>
      <strong class="owner-share-total-value">{{ formatNumber(summary.grandTotal) }}</strong>
    </p>

    <ul v-if="summary?.shares.length" class="owner-share-list">
      <li v-for="item in summary.shares" :key="item.agentId" class="owner-share-item">
        <div
          class="owner-share-trigger"
          :class="{
            'owner-share-trigger--expanded': isExpanded(item.agentId),
            'owner-share-trigger--expandable': item.events.length > 0,
          }"
          :role="item.events.length > 0 ? 'button' : undefined"
          :tabindex="item.events.length > 0 ? 0 : undefined"
          :aria-expanded="item.events.length > 0 ? isExpanded(item.agentId) : undefined"
          @click="item.events.length > 0 && toggleOwner(item.agentId)"
          @keydown="item.events.length > 0 && onOwnerKeydown($event, item.agentId)"
        >
          <div class="owner-share-head">
            <span class="owner-share-name">
              <span
                v-if="item.events.length > 0"
                class="owner-share-chevron"
                :class="{ 'owner-share-chevron--open': isExpanded(item.agentId) }"
                aria-hidden="true"
              >
                ›
              </span>
              {{ item.agentName }}
            </span>
            <span class="owner-share-meta">
              {{ formatPct(item.ratio) }}
              <span class="owner-share-sep" aria-hidden="true">·</span>
              {{ formatNumber(item.total) }}
              <span v-if="item.eventCount > 1" class="owner-share-events">
                （{{ item.eventCount }} 条事件）
              </span>
            </span>
          </div>
          <div
            class="owner-share-track"
            role="img"
            :aria-label="`${item.agentName} ${formatPct(item.ratio)}`"
          >
            <div
              class="owner-share-bar"
              :style="{ width: `${Math.max(item.ratio * 100, 0.5)}%` }"
            />
          </div>
        </div>
        <ul v-if="isExpanded(item.agentId)" class="owner-event-list">
          <li
            v-for="event in item.events"
            :key="event.eventId"
            class="owner-event-item"
            :class="{ 'owner-event-item--active': selectedEventId === event.eventId }"
            role="button"
            tabindex="0"
            @click.stop="onEventClick(event.eventId)"
            @keydown.enter.prevent.stop="onEventClick(event.eventId)"
            @keydown.space.prevent.stop="onEventClick(event.eventId)"
          >
            <span class="owner-event-name" :title="event.displayName">{{ event.displayName }}</span>
            <span class="owner-event-meta">
              <span class="owner-event-ratio-total">{{ formatPct(event.ratio) }}</span>
              <span class="owner-share-sep" aria-hidden="true">·</span>
              {{ eventMetaText(event) }}
              <span v-if="item.eventCount > 1" class="owner-event-ratio-owner">
                （占 {{ item.agentName }} {{ formatPct(event.ownerRatio) }}）
              </span>
            </span>
            <div class="owner-event-track" aria-hidden="true">
              <div
                class="owner-event-bar"
                :style="{ width: `${Math.max(event.ratio * 100, 0.5)}%` }"
              />
            </div>
          </li>
        </ul>
      </li>
    </ul>

    <p v-else-if="summary && !summary.shares.length" class="owner-share-empty">
      当前统计范围内暂无计入总伤的事件。
    </p>

    <ul v-if="skippedEvents?.length" class="owner-skip-list">
      <li v-for="item in skippedEvents" :key="item.eventId" class="owner-skip-item">
        <span class="owner-skip-name">{{ item.displayName }}</span>
        <span class="owner-skip-reason">{{ item.reason }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.owner-share-block {
  margin-bottom: 0.75rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--calc-border, #2d323a);
  border-radius: 10px;
  background: var(--calc-surface-2, #0f1217);
}

.owner-share-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.25rem 0.75rem;
}

.owner-share-title {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--calc-text, #e8eaed);
}

.owner-share-hint {
  margin: 0;
  font-size: 0.74rem;
  color: var(--calc-muted, #9aa3b0);
  line-height: 1.4;
  max-width: 36rem;
}

.owner-share-total {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.35rem 0.75rem;
  margin: 0.55rem 0 0;
  padding: 0.45rem 0.55rem;
  border-radius: 8px;
  background: rgba(201, 165, 92, 0.1);
  border: 1px solid rgba(201, 165, 92, 0.28);
}

.owner-share-total-label {
  font-size: 0.8rem;
  color: var(--calc-muted, #9aa3b0);
}

.owner-share-total-value {
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--calc-accent, #c9a55c);
  font-variant-numeric: tabular-nums;
}

.owner-share-empty {
  margin: 0.55rem 0 0;
  font-size: 0.78rem;
  color: var(--calc-muted, #9aa3b0);
}

.owner-share-list {
  margin: 0.5rem 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.owner-share-item {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.owner-share-trigger {
  border-radius: 8px;
  padding: 0.15rem 0.25rem;
  margin: -0.15rem -0.25rem;
}

.owner-share-trigger--expandable {
  cursor: pointer;
  transition: background 0.15s ease;
}

.owner-share-trigger--expandable:hover,
.owner-share-trigger--expanded {
  background: rgba(255, 255, 255, 0.04);
}

.owner-share-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.35rem 0.75rem;
  margin-bottom: 0.3rem;
  font-size: 0.82rem;
}

.owner-share-name {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-weight: 700;
  color: var(--calc-text, #d5dae3);
}

.owner-share-chevron {
  display: inline-block;
  width: 0.85rem;
  font-size: 0.95rem;
  line-height: 1;
  color: var(--calc-muted, #9aa3b0);
  transform: rotate(0deg);
  transition: transform 0.15s ease;
}

.owner-share-chevron--open {
  transform: rotate(90deg);
}

.owner-share-meta {
  color: var(--calc-muted, #9aa3b0);
  font-variant-numeric: tabular-nums;
}

.owner-share-sep {
  margin: 0 0.15rem;
  opacity: 0.65;
}

.owner-share-events {
  margin-left: 0.15rem;
  font-size: 0.76rem;
  opacity: 0.85;
}

.owner-share-track {
  height: 6px;
  border-radius: 999px;
  background: var(--calc-surface-3, rgba(255, 255, 255, 0.06));
  overflow: hidden;
}

.owner-share-bar {
  height: 100%;
  min-width: 2px;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--calc-accent, #c9a55c) 85%, #fff 15%),
    var(--calc-accent, #c9a55c)
  );
}

.owner-event-list {
  margin: 0;
  padding: 0 0 0 1.1rem;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.owner-event-item {
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 0.35rem 0.45rem;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.owner-event-item:hover {
  background: rgba(255, 255, 255, 0.03);
  border-color: var(--calc-border, #3a414c);
}

.owner-event-item--active {
  background: rgba(201, 165, 92, 0.1);
  border-color: rgba(201, 165, 92, 0.45);
}

.owner-event-name {
  display: block;
  font-size: 0.78rem;
  color: var(--calc-text, #c5cdd8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.owner-event-meta {
  display: block;
  margin-top: 0.12rem;
  font-size: 0.74rem;
  color: var(--calc-muted, #9aa3b0);
  font-variant-numeric: tabular-nums;
}

.owner-event-ratio-total {
  color: var(--calc-accent, #c9a55c);
  font-weight: 700;
}

.owner-event-ratio-owner {
  margin-left: 0.1rem;
  font-size: 0.72rem;
  opacity: 0.9;
}

.owner-event-track {
  height: 4px;
  margin-top: 0.28rem;
  border-radius: 999px;
  background: var(--calc-surface-3, rgba(255, 255, 255, 0.05));
  overflow: hidden;
}

.owner-event-bar {
  height: 100%;
  min-width: 2px;
  border-radius: inherit;
  background: color-mix(in srgb, var(--calc-accent, #c9a55c) 70%, transparent);
}

.owner-skip-list {
  margin: 0.55rem 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.owner-skip-item {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.25rem 0.75rem;
  padding: 0.3rem 0.45rem;
  border-radius: 6px;
  background: rgba(180, 80, 80, 0.08);
  border: 1px solid rgba(180, 80, 80, 0.22);
  font-size: 0.74rem;
}

.owner-skip-name {
  color: var(--calc-text, #d5dae3);
}

.owner-skip-reason {
  color: #e0a0a0;
}
</style>
