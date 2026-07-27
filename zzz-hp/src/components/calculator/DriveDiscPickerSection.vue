<script setup lang="ts">
import { computed, ref } from 'vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import EquipPickerModal from '@/components/calculator/EquipPickerModal.vue'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc, DriveDiscBuffDoc } from '@/types/calculator'
import { collectTeamDriveDiscNoteLines } from '@/utils/driveDiscNotes'

const props = defineProps<{
  driveDiscs: DriveDiscBuffDoc[]
  agents: AgentBuffDoc[]
  teamSlots: TeamSlot[]
  activeSlot: number
  activeAgent?: AgentBuffDoc
}>()

const twoPiecePickerOpen = ref(false)
const fourPiecePickerOpen = ref(false)

const activeSlotData = computed(() => props.teamSlots[props.activeSlot]!)

const teamDriveDiscNotes = computed(() =>
  collectTeamDriveDiscNoteLines(props.teamSlots, props.agents, props.driveDiscs),
)

const selectedTwoPiece = computed(() =>
  props.driveDiscs.find((item) => item.id === activeSlotData.value.twoPieceDriveDiscId),
)

const selectedFourPiece = computed(() =>
  props.driveDiscs.find((item) => item.id === activeSlotData.value.fourPieceDriveDiscId),
)

function selectTwoPiece(id: string) {
  const slot = activeSlotData.value
  slot.twoPieceDriveDiscId = slot.twoPieceDriveDiscId === id ? 'none' : id
}

function selectFourPiece(id: string) {
  const slot = activeSlotData.value
  slot.fourPieceDriveDiscId = slot.fourPieceDriveDiscId === id ? 'none' : id
}
</script>

<template>
  <section id="damage-drive-disc" class="section-card damage-anchor">
    <header class="section-header">
      <div>
        <h2>驱动盘</h2>
        <p class="section-desc">为各槽位代理人选择 2 件套与 4 件套；4 件套已包含该套装的 2 件套增益</p>
      </div>
    </header>

    <div v-if="teamDriveDiscNotes.length" class="team-disc-notes">
      <h4>驱动盘注释</h4>
      <article v-for="item in teamDriveDiscNotes" :key="item.key" class="disc-note-item">
        <strong>{{ item.roleLabel }} · {{ item.label }}</strong>
        <p>{{ item.note }}</p>
      </article>
    </div>

    <template v-if="activeAgent">
      <div class="slot-toolbar">
        <CalculatorAvatar
          class="toolbar-avatar"
          :avatar-image="activeAgent.avatar_image"
          :name="activeAgent.name"
        />
        <div>
          <p class="editing-label">正在编辑槽位 {{ activeSlot + 1 }}</p>
          <h3>{{ activeAgent.name }}</h3>
        </div>
      </div>

      <div class="disc-groups">
        <div class="disc-group">
          <header class="disc-group-header">
            <h3>2 件套</h3>
            <p>额外 2 件套套装；与 4 件套同套时不重复计入</p>
          </header>
          <EquipPickerModal
            v-model:open="twoPiecePickerOpen"
            title="选择 2 件套"
            description="可不佩戴；与 4 件套同套时不重复计入"
            search-placeholder="搜索驱动盘…"
            :items="(driveDiscs as unknown as Array<Record<string, unknown>>)"
            allow-none
            none-label="不佩戴"
            :selected-id="activeSlotData.twoPieceDriveDiscId"
            :selected-label="selectedTwoPiece?.name"
            :selected-avatar="selectedTwoPiece?.avatar_image"
            @select="selectTwoPiece"
          />
        </div>

        <div class="disc-group">
          <header class="disc-group-header">
            <h3>4 件套</h3>
            <p>含该套装 2 件套；主C 取自身增益，队友取队友增益</p>
          </header>
          <EquipPickerModal
            v-model:open="fourPiecePickerOpen"
            title="选择 4 件套"
            description="可不佩戴；含该套装 2 件套效果"
            search-placeholder="搜索驱动盘…"
            :items="(driveDiscs as unknown as Array<Record<string, unknown>>)"
            allow-none
            none-label="不佩戴"
            :selected-id="activeSlotData.fourPieceDriveDiscId"
            :selected-label="selectedFourPiece?.name"
            :selected-avatar="selectedFourPiece?.avatar_image"
            @select="selectFourPiece"
          />
        </div>
      </div>
    </template>

    <p v-else class="empty-panel">请先选择代理人。选定后可为该槽位配置驱动盘。</p>
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
.slot-toolbar h3 {
  margin: 0;
  font-size: 1.05rem;
  color: #f0f2f6;
}

.section-desc {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: #9aa3b0;
}

.slot-toolbar {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin-bottom: 0.75rem;
  padding: 0.75rem;
  border: 1px solid #2d323a;
  border-radius: 12px;
  background: #10141a;
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

.team-disc-notes {
  margin-bottom: 0.85rem;
  padding: 0.75rem;
  border-radius: 10px;
  border: 1px solid #3a3428;
  background: linear-gradient(180deg, #1a1712 0%, #14120f 100%);
}

.team-disc-notes h4 {
  margin: 0 0 0.55rem;
  font-size: 0.84rem;
  color: #e8d4a8;
}

.disc-note-item + .disc-note-item {
  margin-top: 0.55rem;
  padding-top: 0.55rem;
  border-top: 1px solid #2d2820;
}

.disc-note-item strong {
  display: block;
  font-size: 0.8rem;
  color: #d8c39a;
  margin-bottom: 0.25rem;
}

.disc-note-item p {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.5;
  color: #c5cdd8;
  white-space: pre-wrap;
}

.disc-groups {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.disc-group-header h3 {
  margin: 0;
  font-size: 0.92rem;
  color: #e8ebf0;
}

.disc-group-header p {
  margin: 0.2rem 0 0.55rem;
  font-size: 0.76rem;
  color: #8f98a8;
}

.empty-panel {
  margin: 0;
  padding: 2rem 1rem;
  text-align: center;
  color: #8f96a3;
  font-size: 0.88rem;
}

@media (max-width: 768px) {
  .section-card {
    padding: 0.75rem;
  }

  .section-header h2 {
    font-size: 0.98rem;
  }

  .section-desc {
    font-size: 0.72rem;
    line-height: 1.4;
  }

  .slot-toolbar {
    flex-wrap: wrap;
    padding: 0.6rem;
  }
}
</style>
