<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { AgentBuffDoc } from '@/types/calculator'
import type { DamageCalcHistoryEntry } from '@/types/damageCalcHistory'
import {
  formatDamageCalcAgentSelection,
  formatDamageCalcHistoryTime,
} from '@/utils/damageCalcHistory'

const props = defineProps<{
  entries: DamageCalcHistoryEntry[]
  agents: AgentBuffDoc[]
  activeEntryId?: string
  message?: string
}>()

const emit = defineEmits<{
  save: [name: string]
  load: [entry: DamageCalcHistoryEntry]
  remove: [id: string]
}>()

const draftName = ref('')
const formMessage = ref('')
const modalOpen = ref(false)

const calcModeLabel: Record<DamageCalcHistoryEntry['panelCalcMode'], string> = {
  panel: '面板计算',
  affix: '词条计算',
}

const activeEntry = computed(() =>
  props.entries.find((item) => item.id === props.activeEntryId),
)

const summaryHint = computed(() => {
  if (activeEntry.value) {
    return entryLabel(activeEntry.value)
  }
  if (props.entries.length) {
    return `共 ${props.entries.length} 条记录`
  }
  return '暂无历史记录'
})

function entryLabel(entry: DamageCalcHistoryEntry) {
  const agents = formatDamageCalcAgentSelection(entry.teamSlots, props.agents)
  return `${entry.name} · ${agents}`
}

function openModal() {
  modalOpen.value = true
  formMessage.value = ''
}

function closeModal() {
  modalOpen.value = false
  draftName.value = ''
  formMessage.value = ''
}

function saveCurrent() {
  const name = draftName.value.trim()
  if (!name) {
    formMessage.value = '请先输入数据命名'
    return
  }
  formMessage.value = ''
  emit('save', name)
  draftName.value = ''
}

function loadEntry(entry: DamageCalcHistoryEntry) {
  emit('load', entry)
  closeModal()
}

function removeEntry(id: string, event: Event) {
  event.stopPropagation()
  if (!window.confirm('确定删除这条历史数据吗？')) return
  emit('remove', id)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && modalOpen.value) {
    closeModal()
  }
}

watch(
  () => modalOpen.value,
  (isOpen) => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
  },
)

watch(
  () => props.message,
  (value) => {
    if (value) formMessage.value = ''
  },
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <section id="damage-calc-history" class="history-section damage-anchor">
    <button type="button" class="history-trigger" @click="openModal">
      <header class="history-header">
        <div>
          <h2>历史数据</h2>
          <p class="history-desc">保存当前队伍与面板配置，点击历史项可恢复并重新计算。</p>
        </div>
        <span class="history-open-hint" aria-hidden="true">›</span>
      </header>
      <p class="history-summary">{{ summaryHint }}</p>
    </button>
    <p v-if="message" class="history-inline-message">{{ message }}</p>
  </section>

  <Teleport to="body">
    <div
      v-if="modalOpen"
      class="history-modal-overlay"
      role="presentation"
      @click.self="closeModal"
    >
      <div class="history-modal" role="dialog" aria-modal="true" aria-label="历史数据">
        <header class="history-modal-header">
          <div>
            <h2>历史数据</h2>
            <p>保存当前队伍与面板配置，点击条目可恢复并重新计算。</p>
          </div>
          <button type="button" class="history-modal-close" aria-label="关闭" @click="closeModal">
            ×
          </button>
        </header>

        <div class="history-save-row">
          <label class="field">
            <span class="field-label">数据命名</span>
            <input
              v-model="draftName"
              type="text"
              class="field-input"
              placeholder="如：朱鸢队满配测试"
              @keyup.enter="saveCurrent"
            />
          </label>
          <button type="button" class="save-btn" @click="saveCurrent">保存当前配置</button>
        </div>

        <p v-if="formMessage || message" class="history-message">
          {{ formMessage || message }}
        </p>

        <p v-if="!entries.length" class="history-empty">暂无历史数据，填写命名后保存当前配置。</p>

        <ul v-else class="history-list" role="list">
          <li v-for="entry in entries" :key="entry.id">
            <button
              type="button"
              class="history-item"
              :class="{ active: activeEntryId === entry.id }"
              @click="loadEntry(entry)"
            >
              <span class="history-item-main">{{ entryLabel(entry) }}</span>
              <span class="history-item-meta">
                {{ calcModeLabel[entry.panelCalcMode] }} · {{ formatDamageCalcHistoryTime(entry.savedAt) }}
              </span>
            </button>
            <button
              type="button"
              class="history-delete"
              title="删除"
              aria-label="删除历史数据"
              @click="removeEntry(entry.id, $event)"
            >
              ×
            </button>
          </li>
        </ul>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.history-section {
  border: 1px solid #2a2d33;
  border-radius: 14px;
  background: linear-gradient(180deg, #171a1f 0%, #12151a 100%);
  padding: 0;
  overflow: hidden;
}

.history-trigger {
  width: 100%;
  display: block;
  border: none;
  background: transparent;
  color: inherit;
  padding: 1rem;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.2s;
}

.history-trigger:hover {
  background: rgba(201, 165, 92, 0.06);
}

.history-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.history-header h2 {
  margin: 0;
  font-size: 1.05rem;
  color: #f0f2f6;
}

.history-desc {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: #9aa3b0;
}

.history-open-hint {
  flex: 0 0 auto;
  font-size: 1.2rem;
  color: #8f96a3;
  line-height: 1;
  margin-top: 0.15rem;
}

.history-summary {
  margin: 0.65rem 0 0;
  padding: 0.5rem 0.65rem;
  border: 1px solid #2d323a;
  border-radius: 10px;
  background: #0f1217;
  font-size: 0.8rem;
  color: #b7c0cd;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-inline-message {
  margin: 0;
  padding: 0 1rem 0.75rem;
  font-size: 0.76rem;
  color: #d8c39a;
}

.history-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(3px);
}

.history-modal {
  width: min(720px, 100%);
  max-height: min(82vh, 760px);
  display: flex;
  flex-direction: column;
  border: 1px solid #2a2d33;
  border-radius: 14px;
  background: linear-gradient(180deg, #171a1f 0%, #12151a 100%);
  padding: 1rem;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
}

.history-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
}

.history-modal-header h2 {
  margin: 0;
  font-size: 1.05rem;
  color: #f0f2f6;
}

.history-modal-header p {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: #9aa3b0;
}

.history-modal-close {
  flex: 0 0 auto;
  width: 2rem;
  height: 2rem;
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #d5dae4;
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
}

.history-modal-close:hover {
  border-color: #c9a55c;
}

.history-save-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  align-items: flex-end;
}

.field {
  display: flex;
  flex: 1 1 220px;
  flex-direction: column;
  gap: 0.25rem;
}

.field-label {
  font-size: 0.76rem;
  color: #aab2bf;
}

.field-input {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #ebedf0;
  padding: 0.44rem 0.54rem;
}

.save-btn {
  border: 1px solid #3a4a31;
  border-radius: 8px;
  background: #1a2218;
  color: #d8e8c8;
  padding: 0.48rem 0.9rem;
  font-size: 0.84rem;
  cursor: pointer;
  white-space: nowrap;
}

.save-btn:hover {
  border-color: #c9a55c;
  background: #222818;
}

.history-message {
  margin: 0.55rem 0 0;
  font-size: 0.78rem;
  color: #d8c39a;
}

.history-empty {
  margin: 0.75rem 0 0;
  font-size: 0.8rem;
  color: #7a828f;
}

.history-list {
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  overflow: auto;
  flex: 1;
  min-height: 0;
}

.history-list li {
  display: flex;
  align-items: stretch;
  gap: 0.35rem;
}

.history-item {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  border: 1px solid #2d323a;
  border-radius: 10px;
  background: #0f1217;
  color: #d5dae4;
  padding: 0.55rem 0.7rem;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.history-item:hover,
.history-item.active {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.08);
}

.history-item-main {
  font-size: 0.84rem;
  color: #eef1f6;
  line-height: 1.45;
  word-break: break-word;
}

.history-item-meta {
  font-size: 0.72rem;
  color: #8f96a3;
}

.history-delete {
  flex: 0 0 auto;
  width: 2rem;
  border: 1px solid #3a2d2d;
  border-radius: 10px;
  background: #1a1212;
  color: #d8a0a0;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
}

.history-delete:hover {
  border-color: #c96c6c;
  background: #241616;
}
</style>
