<script setup lang="ts">
import { computed, ref } from 'vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
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

const search = ref('')

const activeSlotData = computed(() => props.teamSlots[props.activeSlot]!)

const teamDriveDiscNotes = computed(() =>
  collectTeamDriveDiscNoteLines(props.teamSlots, props.agents, props.driveDiscs),
)

const filteredDriveDiscs = computed(() => {
  const keyword = search.value.trim()
  if (!keyword) return props.driveDiscs
  return props.driveDiscs.filter((item) => item.name.includes(keyword))
})

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
      <input
        v-model="search"
        class="search-input"
        type="text"
        placeholder="搜索驱动盘..."
        :disabled="!activeAgent"
      />
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

      <p class="selected-bar">
        已选 2 件 {{ selectedTwoPiece?.name ?? '未佩戴' }} · 4 件 {{ selectedFourPiece?.name ?? '未佩戴' }}
      </p>

      <div class="disc-groups">
        <div class="disc-group">
          <header class="disc-group-header">
            <h3>2 件套</h3>
            <p>额外 2 件套套装；与 4 件套同套时不重复计入</p>
          </header>
          <div class="disc-grid">
            <button
              type="button"
              class="disc-cell"
              :class="{ active: activeSlotData.twoPieceDriveDiscId === 'none' }"
              @click="activeSlotData.twoPieceDriveDiscId = 'none'"
            >
              <span class="disc-placeholder">—</span>
              <span class="disc-name">不佩戴</span>
            </button>
            <button
              v-for="disc in filteredDriveDiscs"
              :key="`two-${disc.id}`"
              type="button"
              class="disc-cell"
              :class="{ active: activeSlotData.twoPieceDriveDiscId === disc.id }"
              @click="selectTwoPiece(disc.id)"
            >
              <CalculatorAvatar
                class="disc-avatar"
                :avatar-image="disc.avatar_image"
                :name="disc.name"
              />
              <span class="disc-name">{{ disc.name }}</span>
            </button>
          </div>
        </div>

        <div class="disc-group">
          <header class="disc-group-header">
            <h3>4 件套</h3>
            <p>含该套装 2 件套；主C 取自身增益，队友取队友增益</p>
          </header>
          <div class="disc-grid">
            <button
              type="button"
              class="disc-cell"
              :class="{ active: activeSlotData.fourPieceDriveDiscId === 'none' }"
              @click="activeSlotData.fourPieceDriveDiscId = 'none'"
            >
              <span class="disc-placeholder">—</span>
              <span class="disc-name">不佩戴</span>
            </button>
            <button
              v-for="disc in filteredDriveDiscs"
              :key="`four-${disc.id}`"
              type="button"
              class="disc-cell"
              :class="{ active: activeSlotData.fourPieceDriveDiscId === disc.id }"
              @click="selectFourPiece(disc.id)"
            >
              <CalculatorAvatar
                class="disc-avatar"
                :avatar-image="disc.avatar_image"
                :name="disc.name"
              />
              <span class="disc-name">{{ disc.name }}</span>
            </button>
          </div>
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

.selected-bar {
  margin: 0 0 0.85rem;
  padding: 0.55rem 0.75rem;
  border-radius: 10px;
  background: #0f1217;
  border: 1px solid #2d323a;
  font-size: 0.84rem;
  color: #d5dae4;
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

.disc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 0.5rem;
}

.disc-cell {
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

.disc-cell.active {
  border-color: #c9a55c;
  box-shadow: inset 0 0 0 1px rgba(201, 165, 92, 0.35);
}

.disc-placeholder {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #1a1f27;
  color: #7d8796;
  font-size: 1.2rem;
}

.disc-avatar :deep(.calculator-avatar) {
  width: 56px;
  height: 56px;
  border-radius: 10px;
}

.disc-avatar :deep(.calculator-avatar img),
.disc-avatar :deep(.fallback) {
  border-radius: 10px;
}

.disc-name {
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
  .section-header {
    flex-direction: column;
    align-items: stretch;
  }

  .search-input {
    width: 100%;
  }
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

  .disc-grid {
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: 0.4rem;
  }

  .disc-group {
    padding: 0.65rem;
  }
}
</style>
