<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc, DriveDiscBuffDoc, WengineBuffDoc } from '@/types/calculator'
import { AGENT_ELEMENTS, AGENT_ROLES, WENGINE_RARITIES, isWengineProfessionMatch } from '@/utils/calculatorUi'

const props = defineProps<{
  agents: AgentBuffDoc[]
  wengines: WengineBuffDoc[]
  driveDiscs: DriveDiscBuffDoc[]
  teamSlots: TeamSlot[]
  activeSlot: number
}>()

const open = defineModel<boolean>('open', { default: false })

type Tab = 'agent' | 'wengine' | 'disc'
const activeTab = ref<Tab>('agent')

// --- Local selection state (pre-fill from current slot) ---
const selected = ref({
  agentId: '',
  rank: 0,
  wengineId: 'none',
  wengineRefine: 1,
  twoPieceId: 'none',
  fourPieceId: 'none',
})

watch(open, (isOpen) => {
  if (isOpen) {
    const slot = props.teamSlots[props.activeSlot]
    if (!slot) return
    selected.value = {
      agentId: slot.agentId || '',
      rank: slot.rank,
      wengineId: slot.wengineId,
      wengineRefine: slot.wengineRefine,
      twoPieceId: slot.twoPieceDriveDiscId,
      fourPieceId: slot.fourPieceDriveDiscId,
    }
    // Reset filters and search
    agentRoleFilter.value = ''
    agentElementFilter.value = ''
    wengineRoleFilter.value = ''
    wengineRarityFilter.value = ''
    agentSearch.value = ''
    wengineSearch.value = ''
    discSearch.value = ''
    activeTab.value = 'agent'
  }
})

// --- Agent tab ---
const agentSearch = ref('')
const agentRoleFilter = ref('')
const agentElementFilter = ref('')

const filteredAgents = computed(() => {
  const kw = agentSearch.value.trim().toLowerCase()
  return props.agents.filter((a) => {
    const byRole = !agentRoleFilter.value || a.profession === agentRoleFilter.value
    const byElement = !agentElementFilter.value || a.element === agentElementFilter.value
    const byKw = !kw || a.name.includes(kw) || a.profession.includes(kw) || a.element.includes(kw)
    return byRole && byElement && byKw
  })
})

const agentChipGroups = computed(() => [
  {
    label: '特性',
    chips: AGENT_ROLES.map((r) => ({ id: `role-${r}`, label: r, active: agentRoleFilter.value === r })),
  },
  {
    label: '属性',
    chips: AGENT_ELEMENTS.map((e) => ({ id: `el-${e}`, label: e, active: agentElementFilter.value === e })),
  },
])

function onAgentChip(id: string) {
  if (id.startsWith('role-')) {
    const v = id.slice(5)
    agentRoleFilter.value = agentRoleFilter.value === v ? '' : v
  } else if (id.startsWith('el-')) {
    const v = id.slice(3)
    agentElementFilter.value = agentElementFilter.value === v ? '' : v
  }
}

function pickAgent(id: string) {
  selected.value.agentId = id
  selected.value.rank = 0
}

// --- Wengine tab ---
const wengineSearch = ref('')
const wengineRoleFilter = ref('')
const wengineRarityFilter = ref('')

const selectableWengines = computed(() => props.wengines.filter((w) => w.id !== 'none'))

const filteredWengines = computed(() => {
  const kw = wengineSearch.value.trim().toLowerCase()
  return selectableWengines.value.filter((w) => {
    const byRarity = !wengineRarityFilter.value || w.rarity === wengineRarityFilter.value
    const byRole = !wengineRoleFilter.value || w.profession === wengineRoleFilter.value
    const byKw = !kw || w.name.includes(kw)
    return byRarity && byRole && byKw
  })
})

function isOffSpecWengine(w: WengineBuffDoc) {
  const agent = selectedAgent.value
  if (!agent) return false
  return !isWengineProfessionMatch(agent.profession, w.profession)
}

const wengineChipGroups = computed(() => [
  {
    label: '特性',
    chips: AGENT_ROLES.map((r) => ({
      id: `role-${r}`,
      label: r,
      active: wengineRoleFilter.value === r,
      highlight: selectedAgent.value?.profession === r && !wengineRoleFilter.value,
    })),
  },
  {
    label: '稀有度',
    chips: WENGINE_RARITIES.map((r) => ({
      id: `rar-${r}`,
      label: r,
      active: wengineRarityFilter.value === r,
    })),
  },
])

function onWengineChip(id: string) {
  if (id.startsWith('role-')) {
    const v = id.slice(5)
    wengineRoleFilter.value = wengineRoleFilter.value === v ? '' : v
  } else if (id.startsWith('rar-')) {
    const v = id.slice(4)
    wengineRarityFilter.value = wengineRarityFilter.value === v ? '' : v
  }
}

function pickWengine(id: string) {
  if (id !== 'none' && selected.value.wengineId === id) {
    selected.value.wengineId = 'none'
    selected.value.wengineRefine = 1
    return
  }
  selected.value.wengineId = id
  if (id !== 'none') {
    const we = props.wengines.find((w) => w.id === id)
    if (we && we.rarity !== 'S') {
      selected.value.wengineRefine = 5
    }
  }
}

// --- Disc tab ---
const discSearch = ref('')

const filteredDiscs = computed(() => {
  const kw = discSearch.value.trim().toLowerCase()
  return props.driveDiscs.filter((d) => !kw || d.name.includes(kw))
})

function pickTwoPiece(id: string) {
  selected.value.twoPieceId = selected.value.twoPieceId === id ? 'none' : id
}

function pickFourPiece(id: string) {
  selected.value.fourPieceId = selected.value.fourPieceId === id ? 'none' : id
}

// --- Summary ---
const selectedAgent = computed(() => props.agents.find((a) => a.id === selected.value.agentId))
const selectedWengine = computed(() => props.wengines.find((w) => w.id === selected.value.wengineId))
const selectedTwoPiece = computed(() => props.driveDiscs.find((d) => d.id === selected.value.twoPieceId))
const selectedFourPiece = computed(() => props.driveDiscs.find((d) => d.id === selected.value.fourPieceId))

const summary = computed(() => {
  const parts: string[] = []
  if (selectedAgent.value) parts.push(`${selectedAgent.value.name}（${selected.value.rank}影）`)
  if (selectedWengine.value && selectedWengine.value.id !== 'none') {
    parts.push(`${selectedWengine.value.name}（精${selected.value.wengineRefine}）`)
  } else {
    parts.push('未佩戴武器')
  }
  const discParts: string[] = []
  if (selectedFourPiece.value) discParts.push(`${selectedFourPiece.value.name}（4件）`)
  if (selectedTwoPiece.value && selectedTwoPiece.value.id !== 'none') discParts.push(`${selectedTwoPiece.value.name}（2件）`)
  parts.push(discParts.join(' + ') || '未佩戴驱动盘')
  return parts.join('  |  ')
})

// --- Confirm ---
function confirm() {
  const slot = props.teamSlots[props.activeSlot]
  if (!slot) return
  slot.agentId = selected.value.agentId
  slot.rank = selected.value.rank
  slot.wengineId = selected.value.wengineId
  slot.wengineRefine = selected.value.wengineRefine
  slot.twoPieceDriveDiscId = selected.value.twoPieceId
  slot.fourPieceDriveDiscId = selected.value.fourPieceId
  open.value = false
}

const canConfirm = computed(() => !!selected.value.agentId)
</script>

<template>
  <!-- Summary trigger button -->
  <button type="button" class="unified-trigger" @click="open = true">
    <span class="trigger-label">快速导入</span>
    <span class="trigger-hint">一次性完成角色/武器/驱动盘选择</span>
  </button>

  <!-- Modal -->
  <Teleport to="body">
    <div v-if="open" class="unified-overlay" role="presentation" @click.self="open = false">
      <div class="unified-modal" role="dialog" aria-modal="true" aria-label="快速导入预设">
        <!-- Header -->
        <header class="modal-header">
          <h2>快速导入预设</h2>
          <button type="button" class="close-btn" aria-label="关闭" @click="open = false">&times;</button>
        </header>

        <!-- Tabs -->
        <nav class="tab-bar">
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'agent' }"
            @click="activeTab = 'agent'"
          >
            角色
            <span v-if="selectedAgent" class="tab-check">&check;</span>
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'wengine' }"
            @click="activeTab = 'wengine'"
          >
            武器
            <span v-if="selectedWengine && selectedWengine.id !== 'none'" class="tab-check">&check;</span>
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'disc' }"
            @click="activeTab = 'disc'"
          >
            驱动盘
            <span v-if="selectedTwoPiece || selectedFourPiece" class="tab-check">&check;</span>
          </button>
        </nav>

        <!-- Tab: Agent -->
        <div v-if="activeTab === 'agent'" class="tab-panel">
          <div class="tab-toolbar">
            <input v-model="agentSearch" type="search" class="search" placeholder="搜索代理人…" />
          </div>
          <div v-for="group in agentChipGroups" :key="group.label" class="chip-group">
            <p class="chip-group-label">{{ group.label }}</p>
            <div class="chip-row">
              <button
                v-for="chip in group.chips"
                :key="chip.id"
                type="button"
                class="chip"
                :class="{ active: chip.active }"
                @click="onAgentChip(chip.id)"
              >
                {{ chip.label }}
              </button>
            </div>
          </div>
          <!-- Agent grid -->
          <div class="item-grid">
            <button
              v-for="item in filteredAgents"
              :key="item.id"
              type="button"
              class="item-cell"
              :class="{ active: selected.agentId === item.id }"
              @click="pickAgent(item.id)"
            >
              <CalculatorAvatar class="item-avatar" :avatar-image="item.avatar_image" :name="item.name" />
              <span class="item-name">{{ item.name }}</span>
            </button>
          </div>
          <p v-if="!filteredAgents.length" class="empty-hint">无匹配角色</p>
          <!-- Rank selector -->
          <div v-if="selectedAgent" class="rank-bar">
            <span class="rank-label">{{ selectedAgent.name }} · 影画</span>
            <input
              type="range"
              min="0"
              max="6"
              step="1"
              class="rank-slider"
              :value="selected.rank"
              @input="selected.rank = Number(($event.target as HTMLInputElement).value)"
            />
            <span class="rank-badge">{{ selected.rank }}影</span>
          </div>
        </div>

        <!-- Tab: Wengine -->
        <div v-if="activeTab === 'wengine'" class="tab-panel">
          <div class="tab-toolbar">
            <input v-model="wengineSearch" type="search" class="search" placeholder="搜索音擎…" />
          </div>
          <div v-for="group in wengineChipGroups" :key="group.label" class="chip-group">
            <p class="chip-group-label">{{ group.label }}</p>
            <div class="chip-row">
              <button
                v-for="chip in group.chips"
                :key="chip.id"
                type="button"
                class="chip"
                :class="{ active: chip.active, highlight: chip.highlight }"
                @click="onWengineChip(chip.id)"
              >
                {{ chip.label }}
              </button>
            </div>
          </div>
          <div class="item-grid">
            <button
              type="button"
              class="item-cell"
              :class="{ active: !selected.wengineId || selected.wengineId === 'none' }"
              @click="pickWengine('none')"
            >
              <span class="item-placeholder">—</span>
              <span class="item-name">不佩戴</span>
            </button>
            <button
              v-for="item in filteredWengines"
              :key="item.id"
              type="button"
              class="item-cell"
              :class="{ active: selected.wengineId === item.id, 'off-spec': isOffSpecWengine(item) }"
              @click="pickWengine(item.id)"
            >
              <CalculatorAvatar class="item-avatar" :avatar-image="item.avatar_image" :name="item.name" />
              <span class="item-name">{{ item.name }}</span>
            </button>
          </div>
          <p v-if="!filteredWengines.length" class="empty-hint">无匹配音擎</p>
          <!-- Refine selector -->
          <div v-if="selectedWengine && selectedWengine.id !== 'none'" class="rank-bar">
            <span class="rank-label">{{ selectedWengine.name }} · 精炼</span>
            <input
              type="range"
              min="1"
              max="5"
              step="1"
              class="rank-slider"
              :value="selected.wengineRefine"
              @input="selected.wengineRefine = Number(($event.target as HTMLInputElement).value)"
            />
            <span class="rank-badge">精{{ selected.wengineRefine }}</span>
          </div>
        </div>

        <!-- Tab: Drive Discs -->
        <div v-if="activeTab === 'disc'" class="tab-panel">
          <div class="tab-toolbar">
            <input v-model="discSearch" type="search" class="search" placeholder="搜索驱动盘…" />
          </div>
          <div class="disc-columns">
            <div class="disc-col">
              <header class="disc-col-header">
                <h3>2 件套</h3>
                <p>额外 2 件套套装；与 4 件套同套时不重复计入</p>
              </header>
              <div class="item-grid">
                <button
                  type="button"
                  class="item-cell"
                  :class="{ active: !selected.twoPieceId || selected.twoPieceId === 'none' }"
                  @click="pickTwoPiece('none')"
                >
                  <span class="item-placeholder">—</span>
                  <span class="item-name">不佩戴</span>
                </button>
                <button
                  v-for="item in filteredDiscs"
                  :key="item.id"
                  type="button"
                  class="item-cell"
                  :class="{ active: selected.twoPieceId === item.id }"
                  @click="pickTwoPiece(item.id)"
                >
                  <CalculatorAvatar class="item-avatar" :avatar-image="item.avatar_image" :name="item.name" />
                  <span class="item-name">{{ item.name }}</span>
                </button>
              </div>
            </div>
            <div class="disc-col">
              <header class="disc-col-header">
                <h3>4 件套</h3>
                <p>含该套装 2 件套效果</p>
              </header>
              <div class="item-grid">
                <button
                  type="button"
                  class="item-cell"
                  :class="{ active: !selected.fourPieceId || selected.fourPieceId === 'none' }"
                  @click="pickFourPiece('none')"
                >
                  <span class="item-placeholder">—</span>
                  <span class="item-name">不佩戴</span>
                </button>
                <button
                  v-for="item in filteredDiscs"
                  :key="item.id"
                  type="button"
                  class="item-cell"
                  :class="{ active: selected.fourPieceId === item.id }"
                  @click="pickFourPiece(item.id)"
                >
                  <CalculatorAvatar class="item-avatar" :avatar-image="item.avatar_image" :name="item.name" />
                  <span class="item-name">{{ item.name }}</span>
                </button>
              </div>
            </div>
          </div>
          <p v-if="!filteredDiscs.length" class="empty-hint">无匹配驱动盘</p>
        </div>

        <!-- Bottom bar -->
        <footer class="modal-footer">
          <div class="footer-summary">
            <p class="summary-title">导入预览</p>
            <p class="summary-text">{{ summary }}</p>
          </div>
          <div class="footer-actions">
            <button type="button" class="cancel-btn" @click="open = false">取消</button>
            <button type="button" class="confirm-btn" :disabled="!canConfirm" @click="confirm">
              确定导入
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Trigger button */
.unified-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  width: 100%;
  padding: 0.65rem 1rem;
  border: 1px dashed #c9a55c;
  border-radius: 12px;
  background: linear-gradient(180deg, #1a1713 0%, #14110e 100%);
  cursor: pointer;
  font: inherit;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.unified-trigger:hover {
  border-color: #e8b84c;
  background: linear-gradient(180deg, #1f1b16 0%, #191510 100%);
}

.trigger-label {
  font-size: 0.92rem;
  font-weight: 700;
  color: #e8b84c;
}

.trigger-hint {
  font-size: 0.78rem;
  color: #9aa3b0;
}

/* Modal overlay */
.unified-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(0, 0, 0, 0.55);
  display: grid;
  place-items: center;
  padding: 1rem;
}

.unified-modal {
  width: min(800px, 100%);
  max-height: min(90vh, 780px);
  overflow: auto;
  border: 1px solid #2d323a;
  border-radius: 14px;
  background: linear-gradient(180deg, #171a1f 0%, #12151a 100%);
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1rem 0;
  flex-shrink: 0;
}

.modal-header h2 {
  margin: 0;
  font-size: 1.05rem;
  color: #f0f2f6;
}

.close-btn {
  border: none;
  background: transparent;
  color: #9aa3b0;
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
}

/* Tab bar */
.tab-bar {
  display: flex;
  gap: 0;
  border-bottom: 2px solid #2d323a;
  margin: 0.75rem 1rem 0;
  flex-shrink: 0;
}

.tab-btn {
  flex: 1;
  padding: 0.55rem 0.75rem;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #9aa3b0;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
  margin-bottom: -2px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
}

.tab-btn.active {
  color: #c9a55c;
  border-bottom-color: #c9a55c;
}

.tab-check {
  color: #4caf50;
  font-size: 0.75rem;
}

/* Tab panel */
.tab-panel {
  padding: 0.75rem 1rem;
  overflow-y: auto;
}

.tab-toolbar {
  margin-bottom: 0.65rem;
}

.search {
  width: 100%;
  border: 1px solid #313640;
  border-radius: 10px;
  background: #0f1217;
  color: #edf0f5;
  padding: 0.55rem 0.75rem;
  font-size: 0.88rem;
}

.chip-group {
  margin-bottom: 0.65rem;
}

.chip-group-label {
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

/* Item grid */
.item-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(78px, 1fr));
  gap: 0.45rem;
}

.item-cell {
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

.item-cell.active {
  border-color: #c9a55c;
  box-shadow: inset 0 0 0 1px rgba(201, 165, 92, 0.35);
}

.item-cell.off-spec {
  opacity: 0.72;
}

.item-avatar :deep(.calculator-avatar) {
  width: 56px;
  height: 56px;
  border-radius: 10px;
}

.item-placeholder {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #1a1f27;
  color: #7d8796;
  font-size: 1.2rem;
}

.item-name {
  font-size: 0.72rem;
  text-align: center;
  line-height: 1.2;
}

.empty-hint {
  margin: 0.75rem 0 0;
  font-size: 0.8rem;
  color: #9aa3b0;
  text-align: center;
}

/* Rank / Refine bar */
.rank-bar {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin-top: 0.85rem;
  padding: 0.65rem 0.85rem;
  border: 1px solid #34302a;
  border-radius: 10px;
  background: #14120f;
}

.rank-label {
  font-size: 0.82rem;
  color: #d8c39a;
  font-weight: 600;
  white-space: nowrap;
}

.rank-slider {
  flex: 1;
  accent-color: #c9a55c;
}

.rank-badge {
  min-width: 2.6rem;
  text-align: center;
  border: 1px solid #5a4a31;
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  font-size: 0.78rem;
  color: #d8c39a;
  font-weight: 600;
}

/* Disc columns */
.disc-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.disc-col-header {
  margin-bottom: 0.55rem;
}

.disc-col-header h3 {
  margin: 0;
  font-size: 0.92rem;
  color: #e8ebf0;
}

.disc-col-header p {
  margin: 0.2rem 0 0;
  font-size: 0.74rem;
  color: #8f98a8;
}

/* Footer */
.modal-footer {
  border-top: 1px solid #2d323a;
  padding: 0.75rem 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-shrink: 0;
  background: #14171d;
}

.footer-summary {
  min-width: 0;
  flex: 1;
}

.summary-title {
  margin: 0 0 0.2rem;
  font-size: 0.74rem;
  color: #c9a55c;
  font-weight: 600;
}

.summary-text {
  margin: 0;
  font-size: 0.8rem;
  color: #d5dae4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.cancel-btn {
  padding: 0.45rem 1rem;
  border: 1px solid #3a3e47;
  border-radius: 8px;
  background: #12161d;
  color: #d5dae4;
  font-size: 0.84rem;
  cursor: pointer;
}

.cancel-btn:hover {
  background: #1a1f27;
}

.confirm-btn {
  padding: 0.45rem 1.25rem;
  border: none;
  border-radius: 8px;
  background: linear-gradient(180deg, #c9a55c 0%, #a8863e 100%);
  color: #1a1510;
  font-size: 0.84rem;
  font-weight: 700;
  cursor: pointer;
}

.confirm-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.confirm-btn:not(:disabled):hover {
  background: linear-gradient(180deg, #d8b56c 0%, #b8964e 100%);
}

/* Responsive */
@media (max-width: 768px) {
  .unified-modal {
    max-height: 95vh;
    border-radius: 0;
  }

  .disc-columns {
    grid-template-columns: 1fr;
  }

  .modal-footer {
    flex-direction: column;
    align-items: stretch;
  }

  .footer-actions {
    justify-content: flex-end;
  }
}
</style>
