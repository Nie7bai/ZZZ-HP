<script setup lang="ts">
import { computed } from 'vue'
import UnifiedPresetPicker from '@/components/calculator/UnifiedPresetPicker.vue'
import TeamSlotCard from '@/components/calculator/TeamSlotCard.vue'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc, DriveDiscBuffDoc, WengineBuffDoc } from '@/types/calculator'

const props = defineProps<{
  agents: AgentBuffDoc[]
  wengines: WengineBuffDoc[]
  driveDiscs: DriveDiscBuffDoc[]
  teamSlots: TeamSlot[]
  activeSlot: number
  activeAgent?: AgentBuffDoc
}>()

const emit = defineEmits<{
  selectSlot: [index: number]
  assignAgent: [agentId: string]
  clearSlot: [index: number]
  toggleMainC: [index: number]
  selectWengine: [wengineId: string]
}>()

const activeSlotData = computed(() => props.teamSlots[props.activeSlot]!)

function wengineById(id: string) {
  if (id === 'none') return undefined
  return props.wengines.find((item) => item.id === id)
}

function discById(id: string) {
  if (id === 'none') return undefined
  return props.driveDiscs.find((item) => item.id === id)
}

function agentById(id: string) {
  return props.agents.find((item) => item.id === id)
}

function updateSlotRank(index: number, rank: number) {
  props.teamSlots[index]!.rank = rank
}

function updateSlotRefine(value: number) {
  activeSlotData.value.wengineRefine = value
}
</script>

<template>
  <section id="damage-team" class="section-card agent-section damage-anchor">
    <header class="section-header">
      <h2>代理人</h2>
      <p class="section-desc">选择槽位后，为当前槽位指定代理人</p>
    </header>

    <div class="team-slots">
      <TeamSlotCard
        v-for="(slot, index) in teamSlots"
        :key="index"
        :index="index"
        :slot="slot"
        :agent="slot.agentId ? agentById(slot.agentId) : undefined"
        :wengine="slot.wengineId !== 'none' ? wengineById(slot.wengineId) : undefined"
        :two-piece-disc="discById(slot.twoPieceDriveDiscId)"
        :four-piece-disc="discById(slot.fourPieceDriveDiscId)"
        :is-active="activeSlot === index"
        @select="emit('selectSlot', index)"
        @remove="emit('clearSlot', index)"
        @toggle-main-c="emit('toggleMainC', index)"
        @update:rank="updateSlotRank(index, $event)"
        @update:refine="updateSlotRefine($event)"
      />
    </div>

    <UnifiedPresetPicker
      :agents="agents"
      :wengines="wengines"
      :drive-discs="driveDiscs"
      :team-slots="teamSlots"
      :active-slot="activeSlot"
    />
  </section>
</template>

<style scoped>
.section-card {
  border: 1px solid #2a2d33;
  border-radius: 14px;
  background: linear-gradient(180deg, #171a1f 0%, #12151a 100%);
  padding: 1rem;
}

.section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
}

.section-header h2,
.wengine-toolbar h3 {
  margin: 0;
  font-size: 1.05rem;
  color: #f0f2f6;
}

.section-desc {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: #9aa3b0;
}

.search-input {
  width: min(320px, 100%);
  border: 1px solid #313640;
  border-radius: 10px;
  background: #0f1217;
  color: #edf0f5;
  padding: 0.55rem 0.75rem;
  font-size: 0.88rem;
}

.search-input:disabled {
  opacity: 0.55;
}

.filter-block {
  margin-bottom: 0.7rem;
}

.filter-label {
  margin: 0 0 0.35rem;
  font-size: 0.76rem;
  color: #9aa3b0;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.chip {
  border: 1px solid #343a44;
  border-radius: 999px;
  background: #12161d;
  color: #d5dae4;
  padding: 0.28rem 0.7rem;
  font-size: 0.78rem;
  cursor: pointer;
}

.chip.active,
.chip.highlight {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.14);
  color: #f0d7a2;
}

.chip.rarity {
  min-width: 2rem;
  text-align: center;
  border-radius: 8px;
}

.team-slots {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  margin: 0 0 0.85rem;
}

.agent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(78px, 1fr));
  gap: 0.45rem;
}

.agent-cell {
  border: 1px solid #2d323a;
  border-radius: 10px;
  background: #10141a;
  color: #e4e8ef;
  padding: 0.45rem 0.35rem 0.35rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
}

.agent-cell.active {
  border-color: #c9a55c;
  box-shadow: inset 0 0 0 1px rgba(201, 165, 92, 0.35);
}

.agent-avatar :deep(.calculator-avatar) {
  width: 54px;
  height: 54px;
}

.agent-name {
  width: 100%;
  font-size: 0.72rem;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wengine-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
  padding: 0.75rem;
  border: 1px solid #34302a;
  border-radius: 12px;
  background: linear-gradient(180deg, #1a1714 0%, #14120f 100%);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.toolbar-avatar :deep(.calculator-avatar) {
  width: 48px;
  height: 48px;
}

.editing-label {
  margin: 0;
  font-size: 0.74rem;
  color: #c9a55c;
}

.refine-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: #d8c39a;
  font-size: 0.82rem;
}

.refine-slider {
  width: 120px;
  accent-color: #c9a55c;
}

.refine-badge {
  min-width: 2.4rem;
  text-align: center;
  border: 1px solid #5a4a31;
  border-radius: 999px;
  padding: 0.15rem 0.45rem;
  font-size: 0.76rem;
}

.selected-bar {
  margin: 0 0 0.75rem;
  padding: 0.55rem 0.75rem;
  border-radius: 10px;
  background: #0f1217;
  border: 1px solid #2d323a;
  font-size: 0.84rem;
  color: #d5dae4;
}

.off-spec-hint {
  color: #d4a017;
  font-size: 0.78rem;
}

.wengine-selected-bar {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.55rem 0.75rem;
  border: 1px solid #2d323a;
  border-radius: 10px;
  background: #0f1217;
}

.wengine-bar-avatar :deep(.calculator-avatar) {
  width: 40px;
  height: 40px;
  border-radius: 8px;
}

.wengine-bar-name {
  font-size: 0.84rem;
  color: #e4e8ef;
  font-weight: 600;
}

.wengine-none-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.55rem 0.75rem;
  border: 1px dashed #2d323a;
  border-radius: 10px;
  background: #0f1217;
  color: #9aa3b0;
  font-size: 0.84rem;
}

.wengine-bar-hint {
  font-size: 0.74rem;
  color: #7d8796;
  margin-left: auto;
}

.wengine-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 0.5rem;
}

.wengine-cell {
  border: 1px solid #2d323a;
  border-radius: 10px;
  background: #10141a;
  color: #e4e8ef;
  padding: 0.45rem 0.35rem 0.4rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
}

.wengine-cell.off-spec {
  opacity: 0.72;
}

.wengine-cell.active {
  border-color: #c9a55c;
  box-shadow: inset 0 0 0 1px rgba(201, 165, 92, 0.35);
}

.wengine-placeholder {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #1a1f27;
  color: #7d8796;
  font-size: 1.2rem;
}

.wengine-avatar :deep(.calculator-avatar) {
  width: 56px;
  height: 56px;
  border-radius: 10px;
}

.wengine-avatar :deep(.calculator-avatar img),
.wengine-avatar :deep(.fallback) {
  border-radius: 10px;
}

.wengine-name {
  width: 100%;
  font-size: 0.72rem;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-panel {
  margin: 0;
  padding: 2rem 1rem;
  text-align: center;
  color: #8f96a3;
  font-size: 0.88rem;
}

@media (max-width: 980px) {
  .team-slots {
    grid-template-columns: 1fr;
  }

  .section-header,
  .wengine-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .search-input {
    width: 100%;
  }
}

@media (max-width: 768px) {
  .section-header h2 {
    font-size: 0.98rem;
  }

  .section-desc {
    font-size: 0.72rem;
    line-height: 1.4;
  }

  .search-input {
    font-size: 0.85rem;
  }

  .section-card {
    padding: 0.75rem;
  }

  .team-slots {
    gap: 0.65rem;
  }

  .agent-grid {
    grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
    gap: 0.4rem;
  }

  .wengine-grid {
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: 0.4rem;
  }

  .chip {
    min-height: 2rem;
    font-size: 0.74rem;
  }

  .wengine-toolbar {
    gap: 0.45rem;
  }
}
</style>
