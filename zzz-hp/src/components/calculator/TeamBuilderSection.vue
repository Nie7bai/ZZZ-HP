<script setup lang="ts">
import { computed, ref } from 'vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import TeamSlotCard from '@/components/calculator/TeamSlotCard.vue'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc, DriveDiscBuffDoc, WengineBuffDoc } from '@/types/calculator'
import { AGENT_ELEMENTS, AGENT_ROLES, WENGINE_RARITIES, isWengineProfessionMatch } from '@/utils/calculatorUi'

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

const agentSearch = ref('')
const agentRoleFilter = ref('')
const agentElementFilter = ref('')
const wengineSearch = ref('')
const wengineRoleFilter = ref('')
const wengineRarityFilter = ref('')

const filteredAgents = computed(() =>
  props.agents.filter((agent) => {
    const keyword = agentSearch.value.trim()
    const bySearch = !keyword || `${agent.name}${agent.profession}${agent.element}`.includes(keyword)
    const byRole = !agentRoleFilter.value || agent.profession === agentRoleFilter.value
    const byElement = !agentElementFilter.value || agent.element === agentElementFilter.value
    return bySearch && byRole && byElement
  }),
)

const selectableWengines = computed(() =>
  props.wengines.filter((item) => item.id !== 'none'),
)

const filteredWengines = computed(() =>
  selectableWengines.value.filter((wengine) => {
    const keyword = wengineSearch.value.trim()
    const bySearch = !keyword || `${wengine.name}${wengine.profession}`.includes(keyword)
    const byRarity = !wengineRarityFilter.value || wengine.rarity === wengineRarityFilter.value
    const byRole = !wengineRoleFilter.value || wengine.profession === wengineRoleFilter.value
    return bySearch && byRarity && byRole
  }),
)

const activeSlotData = computed(() => props.teamSlots[props.activeSlot]!)

const selectedWengine = computed(() =>
  props.wengines.find((item) => item.id === activeSlotData.value.wengineId),
)

const wengineBuffsDisabled = computed(() => {
  if (!props.activeAgent || !selectedWengine.value || selectedWengine.value.id === 'none') {
    return false
  }
  return !isWengineProfessionMatch(props.activeAgent.profession, selectedWengine.value.profession)
})

function isOffSpecWengine(wengine: WengineBuffDoc) {
  if (!props.activeAgent) return false
  return !isWengineProfessionMatch(props.activeAgent.profession, wengine.profession)
}

function toggleAgentRoleFilter(role: string) {
  agentRoleFilter.value = agentRoleFilter.value === role ? '' : role
}

function toggleAgentElementFilter(element: string) {
  agentElementFilter.value = agentElementFilter.value === element ? '' : element
}

function toggleWengineRoleFilter(role: string) {
  wengineRoleFilter.value = wengineRoleFilter.value === role ? '' : role
}

function toggleWengineRarityFilter(rarity: string) {
  wengineRarityFilter.value = wengineRarityFilter.value === rarity ? '' : rarity
}

function updateSlotRank(index: number, rank: number) {
  props.teamSlots[index]!.rank = rank
}

function updateSlotRefine(value: number) {
  activeSlotData.value.wengineRefine = value
}

function agentById(id: string) {
  return props.agents.find((item) => item.id === id)
}

function wengineNameById(id: string) {
  return props.wengines.find((item) => item.id === id)?.name
}

function driveDiscNameById(id: string) {
  if (id === 'none') return undefined
  return props.driveDiscs.find((item) => item.id === id)?.name
}

function driveDiscSummary(slot: TeamSlot) {
  const fourName = driveDiscNameById(slot.fourPieceDriveDiscId)
  const twoName = driveDiscNameById(slot.twoPieceDriveDiscId)
  if (!fourName && !twoName) return '未选择'
  const parts: string[] = []
  if (fourName) parts.push(`4件：${fourName}`)
  if (twoName && twoName !== fourName) parts.push(`2件：${twoName}`)
  return parts.join(' · ')
}
</script>

<template>
  <section id="damage-team" class="section-card agent-section damage-anchor">
    <header class="section-header">
      <h2>搜索代理人</h2>
      <input
        v-model="agentSearch"
        class="search-input"
        type="text"
        placeholder="搜索代理人..."
      />
    </header>

    <div class="team-slots">
      <TeamSlotCard
        v-for="(slot, index) in teamSlots"
        :key="index"
        :index="index"
        :slot="slot"
        :agent="slot.agentId ? agentById(slot.agentId) : undefined"
        :wengine-name="slot.wengineId !== 'none' ? wengineNameById(slot.wengineId) : undefined"
        :drive-disc-summary="driveDiscSummary(slot)"
        :is-active="activeSlot === index"
        @select="emit('selectSlot', index)"
        @remove="emit('clearSlot', index)"
        @toggle-main-c="emit('toggleMainC', index)"
        @update:rank="updateSlotRank(index, $event)"
      />
    </div>

    <div class="filter-block">
      <p class="filter-label">特性</p>
      <div class="chip-row">
        <button
          v-for="role in AGENT_ROLES"
          :key="role"
          type="button"
          class="chip"
          :class="{ active: agentRoleFilter === role }"
          @click="toggleAgentRoleFilter(role)"
        >
          {{ role }}
        </button>
      </div>
    </div>

    <div class="filter-block">
      <p class="filter-label">属性</p>
      <div class="chip-row">
        <button
          v-for="element in AGENT_ELEMENTS"
          :key="element"
          type="button"
          class="chip"
          :class="{ active: agentElementFilter === element }"
          @click="toggleAgentElementFilter(element)"
        >
          {{ element }}
        </button>
      </div>
    </div>

    <div class="agent-grid">
      <button
        v-for="agent in filteredAgents"
        :key="agent.id"
        type="button"
        class="agent-cell"
        :class="{ active: activeSlotData.agentId === agent.id }"
        @click="emit('assignAgent', agent.id)"
      >
        <CalculatorAvatar class="agent-avatar" :avatar-image="agent.avatar_image" :name="agent.name" />
        <span class="agent-name">{{ agent.name }}</span>
      </button>
    </div>
  </section>

  <section id="damage-wengine" class="section-card wengine-section damage-anchor">
    <header class="section-header">
      <div>
        <h2>音擎选择</h2>
        <p class="section-desc">为当前槽位代理人选择音擎；可不佩戴</p>
      </div>
      <input
        v-model="wengineSearch"
        class="search-input"
        type="text"
        placeholder="搜索音擎..."
        :disabled="!activeAgent"
      />
    </header>

    <template v-if="activeAgent">
      <div class="wengine-toolbar">
        <div class="toolbar-left">
          <CalculatorAvatar
            class="toolbar-avatar"
            :avatar-image="activeAgent.avatar_image"
            :name="activeAgent.name"
          />
          <div>
            <p class="editing-label">正在编辑槽位 {{ activeSlot + 1 }}</p>
            <h3>{{ activeAgent.name }} | 全部音擎</h3>
          </div>
        </div>
        <div class="refine-row">
          <span>精</span>
          <input
            class="refine-slider"
            type="range"
            min="1"
            max="5"
            step="1"
            :value="activeSlotData.wengineRefine"
            @input="updateSlotRefine(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="refine-badge">精{{ activeSlotData.wengineRefine }}</span>
        </div>
      </div>

      <div class="filter-block">
        <p class="filter-label">按特性筛选</p>
        <div class="chip-row">
          <button
            v-for="role in AGENT_ROLES"
            :key="`w-${role}`"
            type="button"
            class="chip"
            :class="{
              active: wengineRoleFilter === role,
              highlight: activeAgent.profession === role && !wengineRoleFilter,
            }"
            @click="toggleWengineRoleFilter(role)"
          >
            {{ role }}
          </button>
        </div>
      </div>

      <div class="filter-block">
        <p class="filter-label">按稀有度筛选</p>
        <div class="chip-row">
          <button
            v-for="rarity in WENGINE_RARITIES"
            :key="rarity"
            type="button"
            class="chip rarity"
            :class="{ active: wengineRarityFilter === rarity }"
            @click="toggleWengineRarityFilter(rarity)"
          >
            {{ rarity }}
          </button>
        </div>
      </div>

      <p class="selected-bar">
        已选音擎 {{ selectedWengine && selectedWengine.id !== 'none' ? selectedWengine.name : '未佩戴' }}
        <span v-if="wengineBuffsDisabled" class="off-spec-hint">
          · 异职音擎：仅基础属性生效，音擎增益不生效
        </span>
      </p>

      <div class="wengine-grid">
        <button
          type="button"
          class="wengine-cell"
          :class="{ active: activeSlotData.wengineId === 'none' }"
          @click="emit('selectWengine', 'none')"
        >
          <span class="wengine-placeholder">—</span>
          <span class="wengine-name">不佩戴</span>
        </button>
        <button
          v-for="wengine in filteredWengines"
          :key="wengine.id"
          type="button"
          class="wengine-cell"
          :class="{
            active: activeSlotData.wengineId === wengine.id,
            'off-spec': isOffSpecWengine(wengine),
          }"
          @click="emit('selectWengine', wengine.id)"
        >
          <CalculatorAvatar
            class="wengine-avatar"
            :avatar-image="wengine.avatar_image"
            :name="wengine.name"
          />
          <span class="wengine-name">{{ wengine.name }}</span>
        </button>
      </div>
    </template>

    <p v-else class="empty-panel">请先选择代理人。选定代理人后，此处会显示完整音擎列表。</p>
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
