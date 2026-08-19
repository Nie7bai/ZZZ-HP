<script setup lang="ts">
import { computed } from 'vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc, DriveDiscBuffDoc, WengineBuffDoc } from '@/types/calculator'
import { isWengineProfessionMatch } from '@/utils/calculatorUi'
import { teamSlotDisplayLabel } from '@/utils/teamSlotLabel'

const props = defineProps<{
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  wengines: WengineBuffDoc[]
  driveDiscs: DriveDiscBuffDoc[]
  activeIndex: number
}>()

const emit = defineEmits<{
  select: [index: number]
  import: [index: number]
  clear: [index: number]
}>()

function label(slot: TeamSlot, index: number) {
  return teamSlotDisplayLabel(slot, index, props.agents)
}

function agentOf(slot: TeamSlot) {
  if (!slot.agentId) return undefined
  return props.agents.find((item) => item.id === slot.agentId)
}

function wengineOf(slot: TeamSlot) {
  if (!slot.wengineId || slot.wengineId === 'none') return undefined
  return props.wengines.find((item) => item.id === slot.wengineId)
}

function discOf(id: string) {
  if (!id || id === 'none') return undefined
  return props.driveDiscs.find((item) => item.id === id)
}

const activeSlot = computed(() => props.teamSlots[props.activeIndex])
const activeAgent = computed(() => (activeSlot.value ? agentOf(activeSlot.value) : undefined))
const activeWengine = computed(() => (activeSlot.value ? wengineOf(activeSlot.value) : undefined))
const activeFourPiece = computed(() =>
  activeSlot.value ? discOf(activeSlot.value.fourPieceDriveDiscId) : undefined,
)
const activeTwoPiece = computed(() =>
  activeSlot.value ? discOf(activeSlot.value.twoPieceDriveDiscId) : undefined,
)

const wengineProfessionMatch = computed(() => {
  if (!activeAgent.value || !activeWengine.value) return true
  return isWengineProfessionMatch(activeAgent.value.profession, activeWengine.value.profession)
})

function updateRank(value: number) {
  const slot = activeSlot.value
  if (!slot) return
  slot.rank = value
}

function updateRefine(value: number) {
  const slot = activeSlot.value
  if (!slot || !activeWengine.value || !wengineProfessionMatch.value) return
  slot.wengineRefine = value
}

function gearLine() {
  const slot = activeSlot.value
  if (!slot || !activeAgent.value) return '点导入选择角色、音擎和驱动盘'
  const wengineName = activeWengine.value
    ? wengineProfessionMatch.value
      ? `${activeWengine.value.name} · 精${slot.wengineRefine}`
      : `${activeWengine.value.name} · 异职`
    : '未佩戴音擎'
  const discs = [activeFourPiece.value?.name, activeTwoPiece.value?.name].filter(Boolean)
  return `${wengineName} · ${discs.length ? discs.join(' + ') : '未选驱动盘'}`
}
</script>

<template>
  <div class="team-slot-switcher">
    <div class="slot-tabs" role="tablist" aria-label="编辑中角色">
      <button
        v-for="(slot, index) in teamSlots"
        :key="index"
        type="button"
        class="slot-btn"
        :class="{ active: activeIndex === index, empty: !slot.agentId }"
        role="tab"
        :aria-selected="activeIndex === index"
        @click="emit('select', index)"
      >
        <CalculatorAvatar
          v-if="agentOf(slot)"
          class="slot-avatar"
          :avatar-image="agentOf(slot)!.avatar_image"
          :name="agentOf(slot)!.name"
        />
        <span class="slot-name">{{ label(slot, index) }}</span>
        <span v-if="activeIndex === index" class="editing-dot">编辑中</span>
      </button>
    </div>

    <div class="slot-editor" :class="{ empty: !activeAgent }">
      <template v-if="activeAgent && activeSlot">
        <div class="editor-identity">
          <strong>{{ activeAgent.name }}</strong>
          <span>{{ activeAgent.element }} · {{ activeAgent.profession }} · {{ activeSlot.rank }}影</span>
          <span class="gear-summary">{{ gearLine() }}</span>
        </div>
        <div class="editor-controls">
          <label class="control">
            <span>影画</span>
            <input
              class="slider"
              type="range"
              min="0"
              max="6"
              step="1"
              :value="activeSlot.rank"
              @input="updateRank(Number(($event.target as HTMLInputElement).value))"
            />
            <em>{{ activeSlot.rank }}影</em>
          </label>
          <label class="control">
            <span>精炼</span>
            <input
              class="slider"
              type="range"
              min="1"
              max="5"
              step="1"
              :value="activeSlot.wengineRefine"
              :disabled="!activeWengine || !wengineProfessionMatch"
              @input="updateRefine(Number(($event.target as HTMLInputElement).value))"
            />
            <em>{{
              activeWengine
                ? wengineProfessionMatch
                  ? `精${activeSlot.wengineRefine}`
                  : '精-'
                : '-'
            }}</em>
          </label>
        </div>
        <div class="editor-actions">
          <button type="button" class="import-btn" @click="emit('import', activeIndex)">导入编队</button>
          <button type="button" class="clear-btn" @click="emit('clear', activeIndex)">移除</button>
        </div>
      </template>
      <template v-else>
        <p class="empty-hint">槽位 {{ activeIndex + 1 }} 为空，导入角色、音擎和驱动盘。</p>
        <button type="button" class="import-btn" @click="emit('import', activeIndex)">导入编队</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.team-slot-switcher {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}

.slot-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.45rem;
}

.slot-btn {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  border: 1px solid #b7d3e8;
  border-radius: 10px;
  background: #f7fbfe;
  color: #1c3a52;
  padding: 0.35rem 0.55rem;
  font: inherit;
  font-size: 0.82rem;
  line-height: 1.3;
  cursor: pointer;
  text-align: left;
}

.slot-btn.empty {
  color: #6d8598;
}

.slot-btn.active {
  border-color: #c9a55c;
  background: #b8d9f0;
  color: #16324a;
  font-weight: 600;
  box-shadow: inset 0 0 0 1px rgba(201, 165, 92, 0.45);
}

.slot-btn:hover {
  border-color: #7eadd0;
  background: #e7f4fc;
}

.slot-avatar :deep(.calculator-avatar) {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  flex-shrink: 0;
}

.slot-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editing-dot {
  flex-shrink: 0;
  margin-left: auto;
  border-radius: 999px;
  background: linear-gradient(180deg, #c9a55c, #9f7d3f);
  color: #1a140d;
  font-size: 0.66rem;
  font-weight: 700;
  padding: 0.08rem 0.4rem;
}

.slot-editor {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
  padding: 0.4rem 0.55rem;
  border: 1px solid #b7d3e8;
  border-radius: 10px;
  background: #eef7fd;
}

.slot-editor.empty {
  justify-content: space-between;
}

.editor-identity {
  display: flex;
  flex-direction: column;
  gap: 0.08rem;
  min-width: 0;
  flex: 1;
}

.editor-identity strong {
  font-size: 0.86rem;
  color: #16324a;
}

.editor-identity span {
  font-size: 0.72rem;
  color: #4d6a80;
}

.gear-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem 0.85rem;
  flex-shrink: 0;
}

.control {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.74rem;
  color: #1c3a52;
}

.control span {
  color: #8a6a2e;
  font-weight: 700;
}

.control em {
  min-width: 2.2rem;
  font-style: normal;
  font-weight: 700;
}

.slider {
  width: 88px;
  accent-color: #c9a55c;
}

.slider:disabled {
  opacity: 0.45;
}

.editor-actions {
  display: flex;
  gap: 0.4rem;
  flex-shrink: 0;
  margin-left: auto;
}

.import-btn,
.clear-btn {
  appearance: none;
  border-radius: 8px;
  padding: 0.32rem 0.7rem;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
}

.import-btn {
  border: 1px solid #6ea8d0;
  background: linear-gradient(180deg, #b5dff4, #8ec4e8);
  color: #16324a;
}

.clear-btn {
  border: 1px solid #c9a55c;
  background: #fff8ea;
  color: #6a4e1d;
}

.empty-hint {
  margin: 0;
  font-size: 0.8rem;
  color: #4d6a80;
}

@media (max-width: 980px) {
  .slot-editor {
    flex-wrap: wrap;
  }

  .editor-actions {
    width: 100%;
    margin-left: 0;
  }

  .import-btn,
  .clear-btn {
    flex: 1;
  }
}

@media (max-width: 720px) {
  .editing-dot {
    display: none;
  }

  .gear-summary {
    display: none;
  }

  .slider {
    width: 72px;
  }
}
</style>
