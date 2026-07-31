<script setup lang="ts">
import { ref, watch } from 'vue'
import type { DamageOwnerShareSummary } from '@/utils/damageEventOwner'

const props = defineProps<{
  summary: DamageOwnerShareSummary | null | undefined
  /** 当前选中的事件 id（高亮对应明细行） */
  selectedEventId?: string | null
}>()

const emit = defineEmits<{
  'select-event': [eventId: string]
}>()

const expandedOwnerIds = ref<Set<string>>(new Set())

watch(
  () => props.summary,
  () => {
    expandedOwnerIds.value = new Set()
  },
)

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
</script>

<template>
  <section v-if="summary?.shares.length" class="owner-share-block">
    <div class="owner-share-header">
      <h3 class="owner-share-title">产生者伤害占比</h3>
      <p class="owner-share-hint">点击产生者展开各事件在总伤中的占比</p>
    </div>
    <ul class="owner-share-list">
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
              {{ formatNumber(event.total) }}
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
</style>
