<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import PanelScreenshotUploadSection from '@/components/calculator/PanelScreenshotUploadSection.vue'
import SlotPanelEntryForm from '@/components/calculator/SlotPanelEntryForm.vue'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc, DriveDiscBuffDoc, WengineBuffDoc } from '@/types/calculator'
import type { PanelScreenshotRecognition } from '@/types/panelScreenshot'
import {
  createDefaultAffixDriveDiscMainStats,
  createDefaultExternalPanel,
  createEmptyAffixCounts,
  createExternalPanelFromAgentBase,
  fillPanelStatsDefaults,
  type AffixCounts,
  type AffixDriveDiscMainStats,
  type PanelCalcMode,
  type PanelStats,
  type SlotPanelEntryMode,
} from '@/types/calculatorPanel'
import { inferAffixCountsFromExternalPanel, computeExternalPanelFromTeamSlot } from '@/utils/affixPanelCalc'
import {
  AGENT_ELEMENTS,
  AGENT_ROLES,
  WENGINE_RARITIES,
  createEmptyAgentBasePanel,
  createEmptyBuffStatModifiers,
  createEmptyRefinementMods,
  createEmptyWengineAdvancedStats,
  isWengineProfessionMatch,
} from '@/utils/calculatorUi'
import {
  collectConvertSourceMarksForSlot,
  type ConvertSourceMark,
} from '@/utils/panelBuffCalc'
import type { BangbooBuffDoc } from '@/types/calculator'

const EMPTY_BANGBOO: BangbooBuffDoc = {
  id: 'none',
  name: '未选择',
  avatar_image: null,
  effects: [],
  refinementEffects: createEmptyRefinementMods().map(() => []),
  fixedMods: createEmptyBuffStatModifiers(),
  refinementMods: createEmptyRefinementMods(),
}

export type UnifiedPresetConfirmPayload = {
  agentId: string
  rank: number
  wengineId: string
  wengineRefine: number
  twoPieceDriveDiscId: string
  fourPieceDriveDiscId: string
  externalPanel: PanelStats
  affixCounts: AffixCounts
  affixDriveDiscMainStats: AffixDriveDiscMainStats
  entryMode: SlotPanelEntryMode
}

const props = defineProps<{
  agents: AgentBuffDoc[]
  wengines: WengineBuffDoc[]
  driveDiscs: DriveDiscBuffDoc[]
  teamSlots: TeamSlot[]
  activeSlot: number
  /** 打开时默认用该槽位已选的录入方式 */
  preferredEntryMode?: Extract<PanelCalcMode, 'panel' | 'affix'>
  anomalySlotPanels?: Record<string, PanelStats>
  finalPanelPreview?: PanelStats | null
  /** 父级增益/邦布等签名：变化时重算局内预览 */
  finalPanelToken?: string
  /** 用当前草稿局外 + 页级增益上下文实时算局内 */
  resolveFinalPanel?: (external: PanelStats) => PanelStats | null
  hideTrigger?: boolean
}>()

const emit = defineEmits<{
  confirm: [payload: UnifiedPresetConfirmPayload]
}>()

const open = defineModel<boolean>('open', { default: false })

type Tab = 'agent' | 'wengine' | 'disc' | 'panel'
const activeTab = ref<Tab>('agent')

const selected = ref({
  agentId: '',
  rank: 0,
  wengineId: 'none',
  wengineRefine: 1,
  twoPieceId: 'none',
  fourPieceId: 'none',
})

const draftExternalPanel = reactive<PanelStats>(createDefaultExternalPanel())
const draftAffixCounts = reactive(createEmptyAffixCounts())
const draftAffixMains = reactive(createDefaultAffixDriveDiscMainStats())
/** 切到词条时把手当下手填冻一份，切回来/确定词条都用这份，不许被推导盘盖掉 */
let handPanelBackup: PanelStats | null = null
/** 面板 Tab：该角色选面板导入或词条计算，确定后记在槽位上 */
const entryMode = ref<Extract<PanelCalcMode, 'panel' | 'affix'>>(
  props.preferredEntryMode ?? 'panel',
)

/** 导入区局内：草稿局外/词条推导 + 当前增益实时结算（对齐改前内嵌面板） */
const liveFinalPanel = computed(() => {
  void props.finalPanelToken
  void entryMode.value
  void JSON.stringify(draftExternalPanel)
  void JSON.stringify(draftAffixCounts)
  void JSON.stringify(draftAffixMains)
  void selected.value.agentId
  void selected.value.wengineId
  void selected.value.twoPieceId
  void selected.value.fourPieceId
  if (!props.resolveFinalPanel) return props.finalPanelPreview ?? null
  const external =
    entryMode.value === 'affix'
      ? computeExternalPanelFromTeamSlot({
          slot: {
            agentId: selected.value.agentId,
            wengineId: selected.value.wengineId,
            twoPieceDriveDiscId: selected.value.twoPieceId,
            fourPieceDriveDiscId: selected.value.fourPieceId,
            affixCounts: { ...draftAffixCounts },
            affixDriveDiscMainStats: { ...draftAffixMains },
          },
          agents: props.agents,
          wengines: props.wengines,
          driveDiscs: props.driveDiscs,
        })
      : fillPanelStatsDefaults({ ...draftExternalPanel })
  return props.resolveFinalPanel(external) ?? props.finalPanelPreview ?? null
})

/** 按导入草稿装备，标出该槽位局外/局内转模会读哪些属性（不依赖 Buff 是否已勾选） */
const draftConvertSourceMarks = computed((): ConvertSourceMark[] => {
  if (!selected.value.agentId) return []
  const slots = props.teamSlots.map((slot, index) => {
    if (index !== props.activeSlot) return { ...slot }
    return {
      ...slot,
      agentId: selected.value.agentId,
      rank: selected.value.rank,
      wengineId: selected.value.wengineId,
      wengineRefine: selected.value.wengineRefine,
      twoPieceDriveDiscId: selected.value.twoPieceId,
      fourPieceDriveDiscId: selected.value.fourPieceId,
    }
  })
  return collectConvertSourceMarksForSlot(
    {
      teamSlots: slots,
      agents: props.agents,
      wengines: props.wengines,
      driveDiscs: props.driveDiscs,
      mainSlotIndex: props.activeSlot,
      bangboo: EMPTY_BANGBOO,
      bangbooRefine: 1,
    },
    props.activeSlot,
    { requireEnabled: false },
  )
})

function resetDraftPanelFromSlot() {
  const slot = props.teamSlots[props.activeSlot]
  const agentId = selected.value.agentId || slot?.agentId || ''
  const agent = props.agents.find((item) => item.id === agentId)
  Object.assign(draftAffixCounts, createEmptyAffixCounts(), slot?.affixCounts)
  Object.assign(
    draftAffixMains,
    createDefaultAffixDriveDiscMainStats(),
    slot?.affixDriveDiscMainStats,
  )
  const saved = agentId ? props.anomalySlotPanels?.[agentId] : undefined
  if (saved) {
    Object.assign(draftExternalPanel, createDefaultExternalPanel(), saved)
  } else if (agent) {
    Object.assign(draftExternalPanel, createExternalPanelFromAgentBase(agent.basePanel))
  } else {
    Object.assign(draftExternalPanel, createDefaultExternalPanel())
  }
  handPanelBackup = fillPanelStatsDefaults({ ...draftExternalPanel })
}

watch(entryMode, (mode, prev) => {
  if (!open.value || prev === mode) return
  if (prev === 'panel' && mode === 'affix') {
    handPanelBackup = fillPanelStatsDefaults({ ...draftExternalPanel })
    return
  }
  if (prev === 'affix' && mode === 'panel' && handPanelBackup) {
    Object.assign(draftExternalPanel, createDefaultExternalPanel(), handPanelBackup)
  }
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
    agentRoleFilter.value = ''
    agentElementFilter.value = ''
    wengineRoleFilter.value = ''
    wengineRarityFilter.value = ''
    agentSearch.value = ''
    wengineSearch.value = ''
    discSearch.value = ''
    activeTab.value = 'agent'
    resetDraftPanelFromSlot()
    entryMode.value = props.preferredEntryMode ?? 'panel'
  }
})

watch(
  () => selected.value.agentId,
  (newId, oldId) => {
    if (!open.value || !newId || newId === oldId) return
    const agent = props.agents.find((item) => item.id === newId)
    const saved = props.anomalySlotPanels?.[newId]
    if (saved) {
      Object.assign(draftExternalPanel, createDefaultExternalPanel(), saved)
    } else if (agent) {
      Object.assign(draftExternalPanel, createExternalPanelFromAgentBase(agent.basePanel))
    }
    handPanelBackup = fillPanelStatsDefaults({ ...draftExternalPanel })
  },
)

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

const wengineProfessionMatch = computed(() => {
  if (!selectedAgent.value || !selectedWengine.value || selectedWengine.value.id === 'none') {
    return true
  }
  return isWengineProfessionMatch(selectedAgent.value.profession, selectedWengine.value.profession)
})

const wengineChipGroups = computed(() => [
  {
    label: '特性',
    chips: AGENT_ROLES.map((r) => ({
      id: `role-${r}`,
      label: r,
      active: wengineRoleFilter.value === r,
      highlight: selectedAgent.value?.profession === r,
    })),
  },
  {
    label: '稀有度',
    chips: WENGINE_RARITIES.map((r) => ({
      id: `rar-${r}`,
      label: r,
      active: wengineRarityFilter.value === r,
      highlight: false,
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

const panelTabFilled = computed(() => {
  if (entryMode.value === 'affix') {
    return Object.values(draftAffixCounts).some((n) => Number(n) > 0)
  }
  return draftExternalPanel.hp > 0 || draftExternalPanel.atk > 0
})

const summary = computed(() => {
  const parts: string[] = []
  if (selectedAgent.value) parts.push(`${selectedAgent.value.name}（${selected.value.rank}影）`)
  if (selectedWengine.value && selectedWengine.value.id !== 'none') {
    const refineLabel = wengineProfessionMatch.value
      ? `精${selected.value.wengineRefine}`
      : '异职·仅基础'
    parts.push(`${selectedWengine.value.name}（${refineLabel}）`)
  } else {
    parts.push('未佩戴武器')
  }
  const discParts: string[] = []
  if (selectedFourPiece.value) discParts.push(`${selectedFourPiece.value.name}（4件）`)
  if (selectedTwoPiece.value && selectedTwoPiece.value.id !== 'none') {
    discParts.push(`${selectedTwoPiece.value.name}（2件）`)
  }
  parts.push(discParts.join(' + ') || '未佩戴驱动盘')
  if (entryMode.value === 'affix') {
    const total = Object.values(draftAffixCounts).reduce((sum, n) => sum + (Number(n) || 0), 0)
    parts.push(`词条 ${total} 条`)
  } else {
    parts.push(
      `局外 生命${Math.round(draftExternalPanel.hp)} / 攻击${Math.round(draftExternalPanel.atk)}`,
    )
  }
  return parts.join('  |  ')
})

function applyRecognitionToDraft(result: PanelScreenshotRecognition) {
  if (result.agentId) selected.value.agentId = result.agentId
  selected.value.rank = result.rank
  if (result.wengineId) selected.value.wengineId = result.wengineId
  selected.value.wengineRefine = result.wengineRefine
  if (result.twoPieceDriveDiscId) selected.value.twoPieceId = result.twoPieceDriveDiscId
  if (result.fourPieceDriveDiscId) selected.value.fourPieceId = result.fourPieceDriveDiscId

  Object.assign(
    draftExternalPanel,
    createDefaultExternalPanel(),
    fillPanelStatsDefaults(result.externalPanel),
  )

  const mains = result.driveDiscMainStats
  if (mains?.slot4MainStat) draftAffixMains.slot4MainStat = mains.slot4MainStat
  if (mains?.slot5MainStat) draftAffixMains.slot5MainStat = mains.slot5MainStat
  if (mains?.slot6MainStat) draftAffixMains.slot6MainStat = mains.slot6MainStat

  const agent = props.agents.find((item) => item.id === selected.value.agentId)
  const wengine = props.wengines.find((item) => item.id === selected.value.wengineId)
  const inferred = inferAffixCountsFromExternalPanel({
    target: result.externalPanel,
    agentBase: agent?.basePanel ?? createEmptyAgentBasePanel(),
    wengineBaseAtk: wengine?.baseAtk ?? 0,
    wengineAdvanced: wengine?.advancedStats ?? createEmptyWengineAdvancedStats(),
    driveDiscSelection: {
      twoPieceDriveDiscId: selected.value.twoPieceId,
      fourPieceDriveDiscId: selected.value.fourPieceId,
    },
    driveDiscMainStats: { ...draftAffixMains },
    driveDiscs: props.driveDiscs,
  })
  Object.assign(draftAffixCounts, createEmptyAffixCounts(), inferred.affixCounts)
  handPanelBackup = fillPanelStatsDefaults({ ...draftExternalPanel })
  activeTab.value = 'panel'
}

function confirm() {
  if (!selected.value.agentId) return
  emit('confirm', {
    agentId: selected.value.agentId,
    rank: selected.value.rank,
    wengineId: selected.value.wengineId,
    wengineRefine: selected.value.wengineRefine,
    twoPieceDriveDiscId: selected.value.twoPieceId,
    fourPieceDriveDiscId: selected.value.fourPieceId,
    // 只交手填局外。词条盘当场算，不许写进手填表。
    // 当前停在词条页时用切入前冻住的那份，避免草稿已被推导盘污染。
    externalPanel: fillPanelStatsDefaults({
      ...(entryMode.value === 'affix' && handPanelBackup
        ? handPanelBackup
        : draftExternalPanel),
    }),
    affixCounts: { ...draftAffixCounts },
    affixDriveDiscMainStats: { ...draftAffixMains },
    entryMode: entryMode.value,
  })
  open.value = false
}

const canConfirm = computed(() => !!selected.value.agentId)
</script>

<template>
  <!-- Summary trigger button -->
  <button v-if="!hideTrigger" type="button" class="unified-trigger" @click="open = true">
    <span class="trigger-label">导入</span>
    <span class="trigger-hint">选择角色/武器/驱动盘/面板</span>
  </button>

  <!-- Modal -->
  <Teleport to="body">
    <div
      v-if="open"
      class="unified-overlay"
      role="presentation"
      @click.self="open = false"
    >
      <div class="unified-modal" role="dialog" aria-modal="true" aria-label="导入预设">
        <!-- Header -->
        <header class="modal-header">
          <h2>导入预设</h2>
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
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'panel' }"
            @click="activeTab = 'panel'"
          >
            面板
            <span v-if="panelTabFilled" class="tab-check">&check;</span>
          </button>
        </nav>

        <!-- Tab: Agent -->
        <div v-if="activeTab === 'agent'" class="tab-panel">
          <div class="tab-filters">
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
            <!-- Rank selector (always rendered; visibility hidden when no agent to hold row height) -->
            <div class="rank-bar" :class="{ 'rank-bar-hidden': !selectedAgent }">
              <span class="rank-label">{{ selectedAgent ? selectedAgent.name + ' · ' : '' }}影画</span>
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
          <div class="tab-grid-wrap">
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
          </div>
        </div>

        <!-- Tab: Wengine -->
        <div v-if="activeTab === 'wengine'" class="tab-panel">
          <div class="tab-filters">
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
            <!-- Refine selector (always rendered; visibility hidden when no wengine) -->
            <div
              class="rank-bar"
              :class="{
                'rank-bar-hidden': !selectedWengine || selectedWengine.id === 'none',
                'rank-bar-off-spec': selectedWengine && !wengineProfessionMatch,
              }"
            >
              <span class="rank-label">
                {{ selectedWengine && selectedWengine.id !== 'none' ? selectedWengine.name + ' · ' : '' }}精炼
              </span>
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                class="rank-slider"
                :value="selected.wengineRefine"
                :disabled="!wengineProfessionMatch"
                @input="selected.wengineRefine = Number(($event.target as HTMLInputElement).value)"
              />
              <span class="rank-badge">
                {{ wengineProfessionMatch ? `精${selected.wengineRefine}` : '仅基础' }}
              </span>
            </div>
          </div>
          <div class="tab-grid-wrap">
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
                :class="{
                  active: selected.wengineId === item.id,
                  'off-spec-wengine': selectedAgent && !isWengineProfessionMatch(selectedAgent.profession, item.profession),
                }"
                @click="pickWengine(item.id)"
              >
                <CalculatorAvatar class="item-avatar" :avatar-image="item.avatar_image" :name="item.name" />
                <span class="item-name">{{ item.name }}</span>
              </button>
            </div>
            <p v-if="!filteredWengines.length" class="empty-hint">无匹配音擎</p>
          </div>
        </div>

        <!-- Tab: Drive Discs -->
        <div v-if="activeTab === 'disc'" class="tab-panel">
          <div class="tab-filters">
            <div class="tab-toolbar">
              <input v-model="discSearch" type="search" class="search" placeholder="搜索驱动盘…" />
            </div>
          </div>
          <div class="tab-grid-wrap">
            <div class="disc-stack">
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
            </div>
            <p v-if="!filteredDiscs.length" class="empty-hint">无匹配驱动盘</p>
          </div>
        </div>

        <!-- Tab: Panel -->
        <div v-if="activeTab === 'panel'" class="tab-panel tab-panel--panel">
          <div class="tab-grid-wrap tab-grid-wrap--panel">
            <PanelScreenshotUploadSection
              embedded
              :agents="agents"
              :wengines="wengines"
              :drive-discs="driveDiscs"
              @apply-recognition="applyRecognitionToDraft"
            />
            <SlotPanelEntryForm
              v-model:external-panel="draftExternalPanel"
              v-model:affix-counts="draftAffixCounts"
              v-model:affix-drive-disc-main-stats="draftAffixMains"
              v-model:calc-mode="entryMode"
              :agents="agents"
              :wengines="wengines"
              :drive-discs="driveDiscs"
              :agent-id="selected.agentId"
              :wengine-id="selected.wengineId"
              :two-piece-id="selected.twoPieceId"
              :four-piece-id="selected.fourPieceId"
              :final-panel="liveFinalPanel"
              :convert-source-marks="draftConvertSourceMarks"
            />
          </div>
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
/* === Layout + dark default === */
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
  width: 1100px;
  height: 780px;
  max-width: calc(100vw - 2rem);
  max-height: calc(100vh - 2rem);
  border: 1px solid #2d323a;
  border-radius: 14px;
  background: linear-gradient(180deg, #171a1f 0%, #12151a 100%);
  color: #e4e8ef;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid #2d323a;
  flex-shrink: 0;
}

.modal-header h2 {
  margin: 0;
  font-size: 1rem;
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

.close-btn:hover {
  color: #f0f2f6;
}

.tab-bar {
  display: flex;
  gap: 0;
  border-bottom: 1px solid #2d323a;
  flex-shrink: 0;
}

.tab-btn {
  flex: 1;
  padding: 0.55rem 0.75rem;
  border: none;
  background: transparent;
  color: #9aa3b0;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
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

/* Tab panel: split into fixed top (filters) + scrollable bottom (grid) */
.tab-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.tab-filters {
  flex-shrink: 0;
  padding: 0.95rem 1.1rem 0.7rem;
  border-bottom: 1px solid #2d323a;
}

.tab-grid-wrap {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 0.85rem 1rem 1rem;
}

.tab-grid-wrap--panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.tab-toolbar {
  margin-bottom: 0.55rem;
}

.search {
  width: 100%;
  border: 1px solid #343a44;
  border-radius: 8px;
  background: #0f1217;
  color: #edf0f5;
  padding: 0.6rem 0.8rem;
  font-size: 0.92rem;
}

.search:focus {
  outline: none;
  border-color: #c9a55c;
}

.chip-group {
  margin-bottom: 0.5rem;
}

.chip-group-label {
  margin: 0 0 0.25rem;
  font-size: 0.74rem;
  color: #9aa3b0;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.chip {
  border: 1px solid #343a44;
  border-radius: 999px;
  background: #12161d;
  color: #d5dae4;
  padding: 0.35rem 0.8rem;
  font-size: 0.82rem;
  line-height: 1;
  cursor: pointer;
}

.chip.active {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.14);
  color: #f0d7a2;
}
.chip.highlight {
  border: 1px dashed #4a90d9 !important;
}

/* Rank / Refine bar (now in top-fixed area, always visible) */
.rank-bar {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  margin-top: 0.2rem;
  margin-bottom: 0.2rem;
  padding: 0.4rem 0.7rem;
  border: 1px solid #34302a;
  border-radius: 8px;
  background: #14120f;
  width: auto;
}

.rank-bar-hidden {
  visibility: hidden;
  pointer-events: none;
}

.rank-label {
  font-size: 0.8rem;
  color: #d8c39a;
  font-weight: 600;
  white-space: nowrap;
}

.rank-slider {
  width: 110px;
  accent-color: #c9a55c;
}

.rank-bar-off-spec {
  border-color: #5a4a31;
}

.item-cell.off-spec-wengine:not(.active) {
  border-style: dashed;
  opacity: 0.92;
}

.rank-slider:disabled {
  opacity: 0.4;
}

.rank-badge {
  min-width: 2.4rem;
  text-align: center;
  border: 1px solid #5a4a31;
  border-radius: 999px;
  padding: 0.15rem 0.5rem;
  font-size: 0.76rem;
  color: #d8c39a;
  font-weight: 600;
  background: #1a1510;
}

/* Item grid (scrollable) */
.item-grid {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: 0.6rem;
}

.item-cell {
  border: 1px solid #2d323a;
  border-radius: 10px;
  background: #10141a;
  color: #e4e8ef;
  padding: 0.7rem 0.4rem 0.55rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 0.4rem;
}

.item-cell.active {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.08);
}

.item-avatar :deep(.calculator-avatar) {
  width: 72px;
  height: 72px;
  border-radius: 10px;
}

.item-placeholder {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #1a1f27;
  color: #7d8796;
  font-size: 0.75rem;
}

.item-name {
  font-size: 0.85rem;
  text-align: center;
  line-height: 1.2;
  max-width: 100px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-hint {
  margin: 0.6rem 0 0;
  font-size: 0.78rem;
  color: #9aa3b0;
  text-align: center;
}

/* Disc tab stack */
.disc-stack {
  display: flex;
  flex-direction: column;
  gap: 0.95rem;
}

.disc-col-header {
  margin-bottom: 0.4rem;
}

.disc-col-header h3 {
  margin: 0;
  font-size: 0.9rem;
  color: #f0f2f6;
  font-weight: 700;
}

.disc-col-header p {
  margin: 0.18rem 0 0;
  font-size: 0.72rem;
  color: #9aa3b0;
}

.modal-footer {
  border-top: 1px solid #2d323a;
  padding: 0.65rem 1rem;
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
  margin: 0 0 0.18rem;
  font-size: 0.72rem;
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
  padding: 0.42rem 1rem;
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
  padding: 0.42rem 1.25rem;
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

.unified-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  width: 100%;
  padding: 0.65rem 1rem;
  border: 1px dashed #3a3e47;
  border-radius: 12px;
  background: #12161d;
  cursor: pointer;
  font: inherit;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.unified-trigger:hover {
  border-color: #c9a55c;
  background: #1a1f27;
}

.trigger-label {
  font-size: 0.92rem;
  font-weight: 700;
  color: #c9a55c;
}

.trigger-hint {
  font-size: 0.78rem;
  color: #9aa3b0;
}

:global([data-theme='light']) .unified-overlay {
  background: rgba(40, 70, 95, 0.28);
}

:global([data-theme='light']) .unified-modal {
  border-color: #b7d3e8;
  background: linear-gradient(180deg, #f7fbfe 0%, #eaf4fb 100%);
  color: #16324a;
  box-shadow: 0 12px 36px rgba(22, 50, 74, 0.18);
}

:global([data-theme='light']) .modal-header,
:global([data-theme='light']) .tab-bar,
:global([data-theme='light']) .tab-filters,
:global([data-theme='light']) .modal-footer {
  border-color: #c5d7e8;
}

:global([data-theme='light']) .modal-header h2,
:global([data-theme='light']) .disc-col-header h3 {
  color: #16324a;
}

:global([data-theme='light']) .tab-btn {
  color: #4d6a80;
}

:global([data-theme='light']) .tab-btn.active {
  color: #8a6a2e;
  border-bottom-color: #c9a55c;
}

:global([data-theme='light']) .search,
:global([data-theme='light']) .item-cell,
:global([data-theme='light']) .chip,
:global([data-theme='light']) .cancel-btn {
  border-color: #b7d3e8;
  background: #ffffff;
  color: #16324a;
}

:global([data-theme='light']) .item-cell.active,
:global([data-theme='light']) .chip.active {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.14);
  color: #6a4e1d;
}

:global([data-theme='light']) .rank-bar {
  border-color: #e0c88a;
  background: #fff8ea;
}

:global([data-theme='light']) .rank-label,
:global([data-theme='light']) .rank-badge,
:global([data-theme='light']) .summary-title {
  color: #8a6a2e;
}

:global([data-theme='light']) .summary-text,
:global([data-theme='light']) .chip-group-label,
:global([data-theme='light']) .empty-hint,
:global([data-theme='light']) .disc-col-header p,
:global([data-theme='light']) .trigger-hint {
  color: #4d6a80;
}

:global([data-theme='light']) .modal-footer {
  background: #eef6fc;
}

:global([data-theme='light']) .unified-trigger {
  border-color: #b7d3e8;
  background: #f7fbfe;
}

:global([data-theme='light']) .unified-trigger:hover {
  border-color: #c9a55c;
  background: #fff8ea;
}

/* Responsive */
@media (max-width: 768px) {
  .unified-modal {
    width: 100vw;
    height: 100vh;
    max-width: 100vw;
    max-height: 100vh;
    border-radius: 0;
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