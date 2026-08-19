<script setup lang="ts">
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc } from '@/types/calculator'
import { teamSlotDisplayLabel } from '@/utils/teamSlotLabel'

const props = defineProps<{
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  activeIndex: number
}>()

const emit = defineEmits<{
  select: [index: number]
}>()

function label(slot: TeamSlot, index: number) {
  return teamSlotDisplayLabel(slot, index, props.agents)
}

function agentOf(slot: TeamSlot) {
  if (!slot.agentId) return undefined
  return props.agents.find((item) => item.id === slot.agentId)
}
</script>

<template>
  <div class="team-slot-switcher" role="tablist" aria-label="编辑中角色">
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
</template>

<style scoped>
.team-slot-switcher {
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

@media (max-width: 720px) {
  .editing-dot {
    display: none;
  }
}
</style>
