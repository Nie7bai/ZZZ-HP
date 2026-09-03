<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { HpChartPoint } from '@/api/crisisAssault'
import { fetchDefenseSeasons } from '@/api/defense'
import type { DefenseEnemy, DefenseSeason, DefenseVariant } from '@/types/defense'
import type { AdminBuffSlotContext, AdminMonsterSlotContext } from '@/types/admin'
import { decodeDefenseBossId } from '@/utils/defenseId'
import {
  buildDefenseRoomHpOptions,
  findDefenseEnemyHpComparison,
  findDefenseRoomHpComparison,
  formatDefenseRoomHpTitle,
} from '@/utils/defenseHp'
import { findDefenseSeasonIndexFromChartPoint } from '@/utils/defenseCompare'
import { formatHpDelta } from '@/utils/gameData'
import { createRequestEpoch } from '@/utils/requestEpoch'

const props = defineProps<{
  embedded?: boolean
  chartPoint?: HpChartPoint | null
  /** 管理端覆盖 old/new（不依赖路由） */
  variantOverride?: DefenseVariant
  adminMode?: boolean
}>()

const emit = defineEmits<{
  'admin-monster': [context: AdminMonsterSlotContext]
  'admin-delete-monster': [recordId: number, label: string]
  'admin-buff': [context: AdminBuffSlotContext]
  /** 从本期移除该条（本期槽位），不是环境 Buff 管理里的「删除 Buff 本身」 */
  'admin-remove-period-buff': [recordId: number, label: string]
}>()

const route = useRoute()

const defenseVariant = computed<DefenseVariant>(() =>
  props.variantOverride ?? (route.meta.defenseVariant === 'new' ? 'new' : 'old'),
)

const seasons = ref<DefenseSeason[]>([])
const seasonsLoadEpoch = createRequestEpoch()
const loading = ref(false)
const loadError = ref('')
const currentIndex = ref(0)
const roomHpIndex = ref(0)
const showPicker = ref(false)

function defaultPublicSeasonIndex(list: DefenseSeason[]): number {
  if (!list.length) return 0
  for (let index = list.length - 1; index >= 0; index--) {
    if (!list[index]?.isHidden) return index
  }
  return list.length - 1
}

function seasonSelectionKey(season: DefenseSeason) {
  const phaseNum = season.phase.replace(/\D/g, '')
  return `${season.version}-${phaseNum || season.phase}`
}

async function loadSeasons() {
  const token = seasonsLoadEpoch.next()
  loading.value = true
  loadError.value = ''
  const previousKey =
    props.adminMode && currentSeason.value ? seasonSelectionKey(currentSeason.value) : null
  const previousRoomHpIndex = props.adminMode ? roomHpIndex.value : 0
  try {
    const data = await fetchDefenseSeasons(defenseVariant.value)
    if (!seasonsLoadEpoch.isCurrent(token)) return
    seasons.value = data
    if (props.chartPoint) {
      applyChartPointSelection()
      roomHpIndex.value = 0
    } else if (previousKey) {
      const restoredIndex = data.findIndex((item) => seasonSelectionKey(item) === previousKey)
      currentIndex.value = restoredIndex >= 0 ? restoredIndex : defaultPublicSeasonIndex(data)
      const options = buildDefenseRoomHpOptions(data[currentIndex.value] ?? data[0]!)
      roomHpIndex.value = options.length
        ? Math.min(previousRoomHpIndex, options.length - 1)
        : 0
    } else {
      currentIndex.value = defaultPublicSeasonIndex(data)
      roomHpIndex.value = 0
    }
  } catch (error) {
    if (!seasonsLoadEpoch.isCurrent(token)) return
    loadError.value = error instanceof Error ? error.message : '加载失败'
    seasons.value = []
    currentIndex.value = 0
  } finally {
    if (!seasonsLoadEpoch.isCurrent(token)) return
    loading.value = false
  }
}

onMounted(loadSeasons)

watch(defenseVariant, () => {
  loadSeasons()
})

function applyChartPointSelection() {
  if (!props.chartPoint || !seasons.value.length) return
  const index = findDefenseSeasonIndexFromChartPoint(seasons.value, props.chartPoint)
  if (index >= 0) currentIndex.value = index
}

watch(
  () => props.chartPoint,
  () => {
    applyChartPointSelection()
  },
)

const currentSeason = computed(() => seasons.value[currentIndex.value])

const roomHpOptions = computed(() => {
  if (!currentSeason.value) return []
  return buildDefenseRoomHpOptions(currentSeason.value)
})

const currentRoomHpOption = computed(() => {
  const options = roomHpOptions.value
  if (!options.length) return null
  const safeIndex = Math.min(Math.max(roomHpIndex.value, 0), options.length - 1)
  return options[safeIndex] ?? options[0]!
})

watch(currentIndex, () => {
  roomHpIndex.value = 0
})

watch(roomHpOptions, (options) => {
  if (roomHpIndex.value > options.length - 1) {
    roomHpIndex.value = 0
  }
})

const pageTitle = computed(() =>
  defenseVariant.value === 'new' ? '新·式舆防卫战' : '旧·式舆防卫战',
)

const roomHpComparison = computed(() => {
  const currentOption = currentRoomHpOption.value
  if (!currentOption) return null

  return findDefenseRoomHpComparison(seasons.value, currentIndex.value, currentOption)
})

function getEnemyHpComparison(enemy: DefenseEnemy) {
  return findDefenseEnemyHpComparison(seasons.value, currentIndex.value, enemy)
}

function prevRoomHp() {
  if (roomHpIndex.value > 0) roomHpIndex.value--
}

function nextRoomHp() {
  if (roomHpIndex.value < roomHpOptions.value.length - 1) roomHpIndex.value++
}

function prevSeason() {
  if (currentIndex.value > 0) currentIndex.value--
}

function nextSeason() {
  if (currentIndex.value < seasons.value.length - 1) currentIndex.value++
}

function onNavZoneClick(direction: 'prev' | 'next') {
  if (direction === 'prev') prevSeason()
  else nextSeason()
}

function selectSeason(index: number) {
  currentIndex.value = index
  showPicker.value = false
}

function filterMeaningfulResistanceTraits(items: string[]) {
  return items.filter((item) => {
    const trimmed = item.trim()
    return trimmed && trimmed !== '无'
  })
}

function formatWeaknessText(items: string[]) {
  return items.filter(Boolean).join('、')
}

function formatResistanceTraitText(items: string[]) {
  return filterMeaningfulResistanceTraits(items).join('、')
}

function parseDefensePhaseNumber(phaseLabel: string) {
  return (phaseLabel.match(/\d+/)?.[0] ?? phaseLabel.replace(/\D/g, '')) || '1'
}

function parseWaveNumber(waveLabel: string, fallbackIndex: number) {
  const matched = waveLabel.match(/\d+/)?.[0]
  return matched ?? String(fallbackIndex)
}

function resolveDefenseSlotParts(
  frontier: { id: string },
  room: { id: string },
  wave: { label: string },
  waveIndex: number,
) {
  const season = currentSeason.value
  if (!season) return null
  const seasonId = season.seasonId
  const stageText = frontier.id.startsWith(seasonId)
    ? frontier.id.slice(seasonId.length)
    : frontier.id.slice(-2)
  const stage = Number(stageText) || 0
  const roomInStage = Number(room.id.slice(frontier.id.length)) || 0
  const waveNum = Number(parseWaveNumber(wave.label, waveIndex + 1)) || 0
  if (!stage || !roomInStage || Number.isNaN(waveNum)) return null
  return { stage, roomInStage, wave: waveNum }
}

function buildDefenseMonsterContext(
  enemy: DefenseEnemy | null,
  slot: ReturnType<typeof resolveDefenseSlotParts>,
  mode: 'create' | 'edit',
): AdminMonsterSlotContext | null {
  const season = currentSeason.value
  if (!season || !slot) return null
  const phaseNum = parseDefensePhaseNumber(season.phase)
  const base: AdminMonsterSlotContext = {
    mode,
    version: season.version,
    phase: phaseNum,
    stage: slot.stage,
    roomInStage: slot.roomInStage,
    wave: slot.wave,
    monsterCategory: 'boss',
    monsterSubType: 1,
    count: 1,
  }
  if (!enemy?.id) return base
  try {
    const decoded = decodeDefenseBossId(enemy.id)
    return {
      ...base,
      mode,
      recordId: enemy.id,
      monsterCategory: decoded.monsterCategory,
      monsterSubType: decoded.monsterSubType,
      count: decoded.count,
      bossName: enemy.name,
      hp: enemy.hpValue ?? enemy.hp,
      defense: enemy.defense,
      level: '1',
      weakness: enemy.weakness ?? '',
      resistance: enemy.resistance ?? '',
      bossImage: enemy.imageUrl ?? null,
    }
  } catch {
    return {
      ...base,
      mode,
      recordId: enemy.id,
      bossName: enemy.name,
      hp: enemy.hpValue ?? enemy.hp,
      defense: enemy.defense,
      level: '1',
      weakness: enemy.weakness ?? '',
      resistance: enemy.resistance ?? '',
      bossImage: enemy.imageUrl ?? null,
    }
  }
}

const DEFAULT_ADMIN_DEFENSE_STAGE = 5

function resolveFrontierStage(frontier: { id: string }) {
  const season = currentSeason.value
  if (!season) return null
  const seasonId = season.seasonId
  const stageText = frontier.id.startsWith(seasonId)
    ? frontier.id.slice(seasonId.length)
    : frontier.id.slice(-2)
  const stage = Number(stageText) || 0
  return stage || null
}

function maxRoomsForDefenseStage(stage: number) {
  return stage === 5 ? 3 : 2
}

function buildDefenseMonsterContextFromSlot(
  slot: { stage: number; roomInStage: number; wave: number },
): AdminMonsterSlotContext | null {
  const season = currentSeason.value
  if (!season) return null
  return {
    mode: 'create',
    version: season.version,
    phase: parseDefensePhaseNumber(season.phase),
    stage: slot.stage,
    roomInStage: slot.roomInStage,
    wave: slot.wave,
    monsterCategory: 'boss',
    monsterSubType: 1,
    count: 1,
  }
}

function onAdminAddDefenseFrontier() {
  const season = currentSeason.value
  if (!season) return
  const usedStages = new Set(
    season.frontiers
      .map((frontier) => resolveFrontierStage(frontier))
      .filter((stage): stage is number => Boolean(stage)),
  )
  let nextStage = DEFAULT_ADMIN_DEFENSE_STAGE
  if (usedStages.has(nextStage)) {
    for (let stage = 1; stage <= 9; stage += 1) {
      if (!usedStages.has(stage)) {
        nextStage = stage
        break
      }
    }
  }
  const ctx = buildDefenseMonsterContextFromSlot({
    stage: nextStage,
    roomInStage: 1,
    wave: 1,
  })
  if (ctx) emit('admin-monster', ctx)
}

function onAdminAddDefenseRoom(frontier: { id: string; rooms: Array<{ label: string }> }) {
  const stage = resolveFrontierStage(frontier)
  if (!stage) return
  const used = new Set(
    frontier.rooms.map((room) => Number(room.label.replace(/\D/g, '')) || 0),
  )
  const max = maxRoomsForDefenseStage(stage)
  let nextRoom = 0
  for (let roomNum = 1; roomNum <= max; roomNum += 1) {
    if (!used.has(roomNum)) {
      nextRoom = roomNum
      break
    }
  }
  if (!nextRoom) return
  const ctx = buildDefenseMonsterContextFromSlot({
    stage,
    roomInStage: nextRoom,
    wave: 1,
  })
  if (ctx) emit('admin-monster', ctx)
}

function onAdminAddDefenseWave(
  frontier: { id: string },
  room: { id: string },
  battleRoom: { waves: Array<{ label: string }> },
) {
  const roomParts = resolveDefenseRoomParts(frontier, room)
  if (!roomParts) return
  const usedWaves = new Set(
    battleRoom.waves.map((wave, index) => Number(parseWaveNumber(wave.label, index + 1))),
  )
  let nextWave = 0
  for (let waveNum = 1; waveNum <= 9; waveNum += 1) {
    if (!usedWaves.has(waveNum)) {
      nextWave = waveNum
      break
    }
  }
  if (!nextWave) return
  const ctx = buildDefenseMonsterContextFromSlot({
    stage: roomParts.stage,
    roomInStage: roomParts.roomInStage,
    wave: nextWave,
  })
  if (ctx) emit('admin-monster', ctx)
}

function onAdminEditDefenseEnemy(
  enemy: DefenseEnemy,
  frontier: { id: string },
  room: { id: string },
  wave: { label: string },
  waveIndex: number,
) {
  const slot = resolveDefenseSlotParts(frontier, room, wave, waveIndex)
  const ctx = buildDefenseMonsterContext(enemy, slot, 'edit')
  if (ctx) emit('admin-monster', ctx)
}

function onAdminAddDefenseEnemy(
  frontier: { id: string },
  room: { id: string },
  wave: { label: string },
  waveIndex: number,
) {
  const slot = resolveDefenseSlotParts(frontier, room, wave, waveIndex)
  const ctx = buildDefenseMonsterContext(null, slot, 'create')
  if (ctx) emit('admin-monster', ctx)
}

function onAdminDeleteDefenseEnemy(enemy: DefenseEnemy) {
  if (!enemy.id) return
  emit('admin-delete-monster', enemy.id, enemy.name)
}

function resolveDefenseRoomParts(frontier: { id: string }, room: { id: string }) {
  const season = currentSeason.value
  if (!season) return null
  const seasonId = season.seasonId
  const stageText = frontier.id.startsWith(seasonId)
    ? frontier.id.slice(seasonId.length)
    : frontier.id.slice(-2)
  const stage = Number(stageText) || 0
  const roomInStage = Number(room.id.slice(frontier.id.length)) || 0
  if (!stage || !roomInStage) return null
  return { stage, roomInStage }
}

function buildDefenseBuffContext(
  slot: { stage: number; roomInStage: number },
  buffIndex: number,
  source: {
    recordId?: number
    buffName?: string
    buffText?: string
    imageUrl?: string
    lines?: string[]
    effectBlocks?: import('@/types/calculator').BuffEffectBlock[] | null
  } | null,
  mode: 'create' | 'edit',
): AdminBuffSlotContext | null {
  const season = currentSeason.value
  if (!season) return null
  return {
    mode,
    recordId: source?.recordId,
    version: season.version,
    phase: parseDefensePhaseNumber(season.phase),
    buffIndex,
    stage: slot.stage,
    roomInStage: slot.roomInStage,
    buffName: source?.buffName ?? '',
    buffText: source?.buffText ?? source?.lines?.join('\n') ?? '',
    buffImage: source?.imageUrl ?? null,
    effectBlocks: source?.effectBlocks ?? null,
  }
}

function onAdminEditRoomBuff(
  frontier: { id: string },
  room: { id: string; roomBuff: { recordId?: number; buffIndex?: number; name: string; buffText?: string; imageUrl?: string; lines: string[]; effectBlocks?: import('@/types/calculator').BuffEffectBlock[] | null } },
) {
  const slot = resolveDefenseRoomParts(frontier, room)
  if (!slot) return
  const buffIndex = room.roomBuff.buffIndex ?? 1
  const ctx = buildDefenseBuffContext(
    slot,
    buffIndex,
    {
      recordId: room.roomBuff.recordId,
      buffName: room.roomBuff.name,
      buffText: room.roomBuff.buffText,
      imageUrl: room.roomBuff.imageUrl,
      lines: room.roomBuff.lines,
      effectBlocks: room.roomBuff.effectBlocks,
    },
    room.roomBuff.recordId ? 'edit' : 'create',
  )
  if (ctx) emit('admin-buff', ctx)
}

function onAdminRemovePeriodBuff(recordId: number, label: string) {
  emit('admin-remove-period-buff', recordId, label)
}

defineExpose({
  reload: loadSeasons,
  getCurrentMeta: () => {
    const season = currentSeason.value
    if (!season?.version) return null
    const phaseNum = String(season.phase ?? '').replace(/\D/g, '') || String(season.phase ?? '')
    return {
      version: String(season.version),
      phase: phaseNum,
    }
  },
})

function formatEnemyResistance(value?: string) {
  if (!value?.trim() || value.trim() === '无') return ''
  return filterMeaningfulResistanceTraits(
    value.split(/[、,，]/).map((item) => item.trim()),
  ).join('、')
}
</script>

<template>
  <div class="defense-panel-wrapper" :class="{ 'defense-panel-wrapper--embedded': embedded }">
    <p v-if="loading" class="defense-status">加载中...</p>
    <p v-else-if="loadError" class="defense-status defense-status--error">{{ loadError }}</p>
    <p v-else-if="!currentSeason" class="defense-status">暂无式舆防卫战数据</p>

    <div
      v-if="currentSeason && !embedded"
      class="nav-zone nav-zone--left"
      :class="{ 'nav-zone--disabled': currentIndex === 0 }"
      role="button"
      aria-label="上一期"
      tabindex="0"
      @click="onNavZoneClick('prev')"
      @keydown.enter="onNavZoneClick('prev')"
      @keydown.space.prevent="onNavZoneClick('prev')"
    />

    <div class="defense-panel" :class="{ 'defense-panel--embedded': embedded }">
      <header class="panel-header">
        <h1 v-if="!embedded" class="page-title">{{ pageTitle }}</h1>

        <template v-if="currentSeason">
          <div v-if="!embedded" class="mobile-phase-stepper">
            <button
              type="button"
              class="mobile-step-btn"
              :disabled="currentIndex === 0"
              @click="prevSeason"
            >
              上一期
            </button>
            <button type="button" class="mobile-step-btn mobile-step-btn--primary" @click="showPicker = true">
              选期
            </button>
            <button
              type="button"
              class="mobile-step-btn"
              :disabled="currentIndex >= seasons.length - 1"
              @click="nextSeason"
            >
              下一期
            </button>
          </div>

          <div class="header-info-row">
            <div class="phase-selector">
              <button type="button" class="phase-btn" @click="showPicker = true">
                <span class="phase-version">
                  {{ currentSeason.version }} {{ currentSeason.phase }}
                  <span v-if="currentSeason.pendingCleanup" class="phase-trash-badge">已删除未清理</span>
                  <span v-else-if="currentSeason.isHidden" class="phase-hidden-badge">未公开</span>
                </span>
                <span class="phase-date">{{ currentSeason.dateRange }}</span>
                <span class="phase-id">ID: {{ currentSeason.seasonId }} · {{ currentSeason.nodeType }}</span>
              </button>
            </div>

            <div v-if="currentRoomHpOption" class="hp-summary">
              <div class="hp-room-nav">
                <button
                  type="button"
                  class="hp-room-btn"
                  :disabled="roomHpIndex === 0"
                  aria-label="上一项"
                  @click="prevRoomHp"
                >
                  ‹
                </button>
                <div class="hp-room-label">
                  <span class="hp-room-title">{{ currentRoomHpOption.title }}</span>
                  <span v-if="currentRoomHpOption.subtitle" class="hp-room-subtitle">
                    {{ currentRoomHpOption.subtitle }}
                  </span>
                  <span class="hp-room-index">{{ roomHpIndex + 1 }} / {{ roomHpOptions.length }}</span>
                </div>
                <button
                  type="button"
                  class="hp-room-btn"
                  :disabled="roomHpIndex >= roomHpOptions.length - 1"
                  aria-label="下一项"
                  @click="nextRoomHp"
                >
                  ›
                </button>
              </div>

              <span class="hp-label">总血量</span>
              <div class="hp-metrics">
                <div class="hp-metric-row">
                  <span class="hp-tag">Raw</span>
                  <span class="hp-number">{{ currentRoomHpOption.rawHpText }}</span>
                  <span v-if="roomHpComparison?.expansion" class="hp-expansion">
                    {{ roomHpComparison.expansion }}
                  </span>
                </div>
                <div v-if="roomHpComparison" class="hp-metric-row">
                  <span class="hp-tag hp-tag--ghost" aria-hidden="true">Raw</span>
                  <span class="hp-delta">{{ formatHpDelta(roomHpComparison.diff) }}</span>
                </div>
              </div>
            </div>
          </div>

          <Teleport to="body">
            <div v-if="showPicker" class="phase-modal-overlay" @click.self="showPicker = false">
              <div class="phase-modal">
                <button
                  type="button"
                  class="phase-modal-close"
                  aria-label="关闭"
                  @click="showPicker = false"
                >
                  ×
                </button>
                <h2 class="phase-modal-title">{{ pageTitle }}</h2>
                <div class="phase-grid-scroll">
                  <div class="phase-grid">
                    <button
                      v-for="(season, index) in seasons"
                      :key="season.id"
                      type="button"
                      class="phase-card"
                      :class="{
                        active: index === currentIndex,
                        'phase-card--hidden': season.isHidden,
                        'phase-card--trash': season.pendingCleanup,
                      }"
                      @click="selectSeason(index)"
                    >
                      <span class="phase-card-version">
                        {{ season.version }} {{ season.phase }}
                        <span v-if="season.pendingCleanup" class="phase-trash-badge">已删除未清理</span>
                        <span v-else-if="season.isHidden" class="phase-hidden-badge">未公开</span>
                      </span>
                      <span class="phase-card-date">{{ season.dateRange }}</span>
                      <span class="phase-card-id">ID: {{ season.seasonId }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Teleport>
        </template>
      </header>

      <div v-if="currentSeason" class="frontier-scroll">
        <div v-if="adminMode" class="defense-admin-toolbar">
          <button
            type="button"
            class="enemy-admin-btn enemy-admin-btn--primary"
            @click="onAdminAddDefenseFrontier"
          >
            + 添加防线
          </button>
          <p class="defense-admin-hint">新建期数默认展示第五防线；可先添加房间与波次，再填入怪物。</p>
        </div>

        <p
          v-if="adminMode && !currentSeason.frontiers.length"
          class="defense-admin-empty"
        >
          本期尚无防线结构，点击「添加防线」从第五防线开始编辑。
        </p>

        <section
          v-for="frontier in currentSeason.frontiers"
          :key="frontier.id"
          class="frontier-section"
        >
          <header class="frontier-header">
            <div class="frontier-title-wrap">
              <h2 class="frontier-title">{{ frontier.title }}</h2>
              <p class="frontier-meta">Lv.{{ frontier.level }} · ID {{ frontier.id }}</p>
            </div>
            <div v-if="adminMode" class="enemy-admin-bar enemy-admin-bar--inline">
              <button
                type="button"
                class="enemy-admin-btn enemy-admin-btn--primary"
                @click="onAdminAddDefenseRoom(frontier)"
              >
                + 添加房间
              </button>
            </div>
          </header>

          <div class="room-list">
            <article
              v-for="room in frontier.rooms"
              :key="room.id"
              class="room-card"
            >
              <header class="room-card-header">
                <div>
                  <h3 class="room-title">{{ formatDefenseRoomHpTitle(frontier.title, room.label) }}</h3>
                  <p class="room-meta">Lv.{{ room.level }} · ID {{ room.id }}</p>
                </div>
                <div v-if="room.rankRequirements" class="rank-block">
                  <p class="rank-line">S: {{ room.rankRequirements.s }}</p>
                  <p class="rank-line">A: {{ room.rankRequirements.a }}</p>
                  <p class="rank-line">B: {{ room.rankRequirements.b }}</p>
                </div>
              </header>

              <div class="room-buff-section">
                <div class="block-label-row">
                  <p class="block-label">关卡增益</p>
                  <div v-if="adminMode" class="enemy-admin-bar enemy-admin-bar--inline">
                    <button
                      v-if="room.roomBuff.recordId || (room.roomBuff.name && room.roomBuff.name !== '—')"
                      type="button"
                      class="enemy-admin-btn"
                      @click="onAdminEditRoomBuff(frontier, room)"
                    >
                      编辑
                    </button>
                    <button
                      v-if="room.roomBuff.recordId"
                      type="button"
                      class="enemy-admin-btn enemy-admin-btn--danger"
                      @click="onAdminRemovePeriodBuff(room.roomBuff.recordId!, room.roomBuff.name)"
                    >
                      从本期移除
                    </button>
                    <button
                      v-if="!room.roomBuff.recordId"
                      type="button"
                      class="enemy-admin-btn enemy-admin-btn--primary"
                      @click="onAdminEditRoomBuff(frontier, room)"
                    >
                      添加
                    </button>
                  </div>
                </div>
                <div
                  v-if="room.roomBuff.name || room.roomBuff.lines.length"
                  class="room-buff-card"
                >
                  <h4 v-if="room.roomBuff.name && room.roomBuff.name !== '—'" class="buff-name">
                    {{ room.roomBuff.name }}
                  </h4>
                  <ul v-if="room.roomBuff.lines.length" class="buff-lines">
                    <li v-for="(line, index) in room.roomBuff.lines" :key="index">{{ line }}</li>
                  </ul>
                </div>
                <p v-else-if="adminMode" class="room-buff-empty">暂无关卡增益</p>
              </div>

              <section
                v-for="battleRoom in room.battleRooms"
                :key="battleRoom.id"
                class="battle-room"
              >
                <header class="battle-room-header">
                  <div>
                    <h4 class="battle-room-title">{{ battleRoom.label }}</h4>
                    <p class="battle-room-meta">波次 {{ battleRoom.waveCount }}</p>
                  </div>
                  <div v-if="adminMode" class="enemy-admin-bar enemy-admin-bar--inline">
                    <button
                      type="button"
                      class="enemy-admin-btn enemy-admin-btn--primary"
                      @click="onAdminAddDefenseWave(frontier, room, battleRoom)"
                    >
                      + 添加波次
                    </button>
                  </div>
                  <div
                    v-if="
                      battleRoom.weakness.length ||
                      filterMeaningfulResistanceTraits(battleRoom.resistance ?? []).length
                    "
                    class="trait-row"
                  >
                    <p v-if="battleRoom.weakness.length" class="trait-line">
                      <span class="trait-label">弱点</span>
                      {{ formatWeaknessText(battleRoom.weakness) }}
                    </p>
                    <p
                      v-if="filterMeaningfulResistanceTraits(battleRoom.resistance ?? []).length"
                      class="trait-line"
                    >
                      <span class="trait-label">抗性</span>
                      {{ formatResistanceTraitText(battleRoom.resistance ?? []) }}
                    </p>
                  </div>
                </header>

                <div
                  v-for="(wave, waveIndex) in battleRoom.waves"
                  :key="`${battleRoom.id}-${wave.label}`"
                  class="wave-block"
                >
                  <p class="wave-label">{{ wave.label }}</p>
                  <div class="enemy-grid">
                    <article
                      v-for="(enemy, enemyIndex) in wave.enemies"
                      :key="`${battleRoom.id}-${wave.label}-${enemyIndex}`"
                      class="enemy-chip"
                      :class="{
                        'enemy-chip--boss': enemy.isBoss,
                        'enemy-chip--admin': adminMode,
                      }"
                    >
                      <div v-if="adminMode" class="enemy-admin-bar">
                        <button
                          type="button"
                          class="enemy-admin-btn"
                          @click.stop="
                            onAdminEditDefenseEnemy(enemy, frontier, room, wave, waveIndex)
                          "
                        >
                          编辑
                        </button>
                        <button
                          v-if="enemy.id"
                          type="button"
                          class="enemy-admin-btn enemy-admin-btn--danger"
                          @click.stop="onAdminDeleteDefenseEnemy(enemy)"
                        >
                          删除
                        </button>
                      </div>
                      <div class="enemy-chip-image">
                        <img v-if="enemy.imageUrl" :src="enemy.imageUrl" :alt="enemy.name" />
                        <span v-else class="image-placeholder">{{ enemy.isBoss ? 'Boss' : '怪' }}</span>
                      </div>
                      <div class="enemy-chip-body">
                        <p class="enemy-chip-name">
                          <span v-if="enemy.isBoss" class="boss-mark">✦</span>
                          {{ enemy.name }}
                          <span v-if="enemy.count && enemy.count > 1" class="enemy-count">x{{ enemy.count }}</span>
                        </p>
                        <div class="enemy-chip-hp-block">
                          <p class="enemy-chip-hp-row">
                            <span class="enemy-hp-prefix">血量：</span>
                            <span class="enemy-chip-hp">{{ enemy.hp }}</span>
                            <span
                              v-if="getEnemyHpComparison(enemy)?.expansion"
                              class="enemy-hp-expansion"
                            >
                              {{ getEnemyHpComparison(enemy)!.expansion }}
                            </span>
                          </p>
                          <p
                            v-if="getEnemyHpComparison(enemy)"
                            class="enemy-chip-hp-row enemy-chip-hp-row--diff"
                          >
                            <span class="enemy-hp-prefix enemy-hp-prefix--ghost" aria-hidden="true">血量：</span>
                            <span class="enemy-hp-delta">
                              {{ formatHpDelta(getEnemyHpComparison(enemy)!.diff) }}
                            </span>
                          </p>
                        </div>
                        <p v-if="enemy.defense !== undefined" class="enemy-chip-def">防御 {{ enemy.defense }}</p>
                        <p v-if="enemy.weakness" class="enemy-chip-trait">
                          <span class="trait-label">弱点</span>{{ enemy.weakness }}
                        </p>
                        <p v-if="formatEnemyResistance(enemy.resistance)" class="enemy-chip-trait">
                          <span class="trait-label">抗性</span>{{ formatEnemyResistance(enemy.resistance) }}
                        </p>
                        <p v-if="enemy.staggerTime != null" class="enemy-chip-trait">
                          <span class="trait-label">失衡时间</span>{{ enemy.staggerTime }} 秒
                        </p>
                      </div>
                    </article>
                  </div>
                  <button
                    v-if="adminMode"
                    type="button"
                    class="enemy-admin-add"
                    @click="onAdminAddDefenseEnemy(frontier, room, wave, waveIndex)"
                  >
                    + 在此波次添加怪物
                  </button>
                </div>
              </section>
            </article>
          </div>
        </section>
      </div>
    </div>

    <div
      v-if="currentSeason && !embedded"
      class="nav-zone nav-zone--right"
      :class="{ 'nav-zone--disabled': currentIndex === seasons.length - 1 }"
      role="button"
      aria-label="下一期"
      tabindex="0"
      @click="onNavZoneClick('next')"
      @keydown.enter="onNavZoneClick('next')"
      @keydown.space.prevent="onNavZoneClick('next')"
    />
  </div>
</template>

<style scoped>
.defense-status {
  width: 100%;
  min-height: 40vh;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  opacity: 0.75;
}

.defense-status--error {
  color: #e85d4c;
  opacity: 1;
}

.defense-panel-wrapper {
  display: flex;
  align-items: stretch;
  width: 100%;
  min-height: 100%;
}

.defense-panel-wrapper--embedded {
  min-height: auto;
  height: auto;
  overflow: visible;
}

.defense-panel--embedded {
  padding: 0;
  height: auto;
  overflow: visible;
}

.defense-panel--embedded .panel-header {
  padding-top: 0;
}

.defense-panel {
  flex: 1;
  min-width: 0;
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 1.5rem 1.25rem 2.5rem;
}

.nav-zone {
  flex: 0 0 clamp(48px, 6vw, 96px);
  min-width: 48px;
  max-width: 96px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.nav-zone:hover:not(.nav-zone--disabled) {
  background: color-mix(in srgb, var(--color-background-mute) 60%, transparent);
}

.nav-zone--disabled {
  cursor: default;
  pointer-events: none;
}

.panel-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.25rem;
  margin-bottom: 1.25rem;
  flex-shrink: 0;
}

.page-title {
  font-size: clamp(1.75rem, 4vw, 2.25rem);
  font-weight: 700;
  color: var(--color-heading);
  letter-spacing: 0.04em;
}

.header-info-row {
  display: flex;
  align-items: stretch;
  justify-content: center;
  gap: 1rem;
  width: 100%;
  max-width: min(1200px, 100%);
}

.phase-selector {
  display: flex;
  flex: 1;
  min-width: 0;
}

.phase-btn {
  width: 100%;
  min-width: 280px;
  min-height: 108px;
  padding: 1rem 1.5rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  transition: background-color 0.2s;
}

.phase-btn:hover {
  background: var(--color-background-mute);
}

.phase-version {
  font-weight: 700;
  font-size: clamp(1.05rem, 2.2vw, 1.25rem);
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  justify-content: center;
}

.phase-hidden-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.08rem 0.4rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #f5c451;
  background: color-mix(in srgb, #f5c451 18%, transparent);
  border: 1px solid color-mix(in srgb, #f5c451 45%, transparent);
}

.phase-trash-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.08rem 0.4rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #e85d4c;
  background: color-mix(in srgb, #e85d4c 18%, transparent);
  border: 1px solid color-mix(in srgb, #e85d4c 45%, transparent);
}

.phase-date,
.phase-id {
  font-size: clamp(0.82rem, 1.6vw, 0.92rem);
  opacity: 0.72;
  text-align: center;
}

.hp-summary {
  flex: 1;
  min-width: 0;
  min-height: 108px;
  max-width: 400px;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
}

.hp-room-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  width: 100%;
}

.hp-room-btn {
  flex-shrink: 0;
  width: 1.75rem;
  height: 1.75rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  font-size: 1.15rem;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.2s, opacity 0.2s;
}

.hp-room-btn:hover:not(:disabled) {
  background: var(--color-background-mute);
}

.hp-room-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.hp-room-label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
}

.hp-room-title {
  font-size: clamp(0.82rem, 1.6vw, 0.92rem);
  font-weight: 700;
  color: var(--color-heading);
  line-height: 1.3;
}

.hp-room-subtitle {
  font-size: clamp(0.72rem, 1.4vw, 0.8rem);
  opacity: 0.72;
  line-height: 1.3;
}

.hp-room-index {
  font-size: 0.68rem;
  opacity: 0.55;
  line-height: 1.2;
}

.hp-label {
  font-size: clamp(0.9rem, 1.8vw, 1rem);
  color: #e85d4c;
  font-weight: 700;
}

.hp-metrics {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  margin-top: 0.35rem;
  width: fit-content;
}

.hp-metric-row {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
}

.hp-metric-row--sub {
  opacity: 0.88;
}

.hp-number {
  font-size: clamp(0.92rem, 1.8vw, 1.05rem);
  color: var(--color-heading);
  font-weight: 600;
}

.hp-number--sub {
  font-size: clamp(0.82rem, 1.5vw, 0.92rem);
}

.hp-delta {
  font-size: clamp(0.72rem, 1.4vw, 0.82rem);
  color: #e85d4c;
  font-weight: 600;
}

.hp-expansion {
  font-size: clamp(0.78rem, 1.5vw, 0.9rem);
  color: #4d9fff;
  font-weight: 600;
}

.hp-tag {
  flex-shrink: 0;
  min-width: 2rem;
  color: #e85d4c;
  font-weight: 600;
  font-size: clamp(0.82rem, 1.6vw, 0.95rem);
}

.hp-tag--ghost {
  visibility: hidden;
}

.hp-tag--aoe {
  color: #4d9fff;
}

.hp-tag--alt {
  color: #e8a838;
}

.phase-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(4px);
}

.phase-modal {
  position: relative;
  width: min(1120px, 96vw);
  max-height: min(90vh, 860px);
  padding: 2.75rem 1.75rem 1.25rem;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-background);
  overflow: hidden;
}

.phase-modal-close {
  position: absolute;
  top: 0.85rem;
  right: 0.85rem;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
}

.phase-modal-title {
  margin: 0 0 1.35rem;
  text-align: center;
  font-size: clamp(1.55rem, 3.2vw, 2rem);
  font-weight: 700;
  color: var(--color-heading);
}

.phase-grid-scroll {
  max-height: min(62vh, 640px);
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.phase-grid-scroll::-webkit-scrollbar {
  display: none;
}

.phase-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.85rem;
}

.phase-card {
  min-height: 102px;
  padding: 0.85rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  text-align: center;
}

.phase-card:hover,
.phase-card.active {
  border-color: #e8a838;
  background: var(--color-background-mute);
}

.phase-card--hidden {
  border-style: dashed;
  border-color: color-mix(in srgb, #f5c451 55%, var(--color-border));
}

.phase-card--trash {
  border-style: dashed;
  border-color: color-mix(in srgb, #e85d4c 55%, var(--color-border));
  opacity: 0.92;
}

.phase-card-version {
  font-size: 0.98rem;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.phase-card-date,
.phase-card-id {
  font-size: 0.74rem;
  opacity: 0.72;
}

.frontier-scroll {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: 100%;
}

.frontier-section {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 1rem;
}

.frontier-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.65rem;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.defense-admin-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem 1rem;
  margin-bottom: 1rem;
  padding: 0.65rem 0.75rem;
  border: 1px dashed var(--color-border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.defense-admin-hint {
  margin: 0;
  font-size: 0.78rem;
  opacity: 0.72;
}

.defense-admin-empty {
  margin: 0 0 1rem;
  padding: 0.75rem;
  border-radius: 8px;
  border: 1px dashed var(--color-border);
  font-size: 0.84rem;
  opacity: 0.8;
}

.frontier-title {
  margin: 0;
  font-size: clamp(1.15rem, 2.4vw, 1.4rem);
  font-weight: 700;
  color: var(--color-heading);
}

.frontier-meta {
  margin: 0.25rem 0 0;
  font-size: 0.82rem;
  opacity: 0.72;
}

.room-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.room-card {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background);
  padding: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.room-card-header {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: flex-start;
}

.room-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-heading);
}

.room-meta {
  margin: 0.2rem 0 0;
  font-size: 0.76rem;
  opacity: 0.72;
}

.rank-block {
  flex-shrink: 0;
  padding: 0.35rem 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  font-size: 0.72rem;
  line-height: 1.45;
}

.rank-line {
  margin: 0;
  opacity: 0.85;
}

.block-label {
  margin: 0 0 0.35rem;
  font-size: 0.76rem;
  font-weight: 600;
  color: #e8a838;
}

.room-buff-section {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.room-buff-card {
  padding: 0.75rem 0.85rem;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
}

.buff-name {
  margin: 0 0 0.4rem;
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--color-heading);
}

.buff-name:only-child {
  margin-bottom: 0;
}

.buff-lines {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.76rem;
  line-height: 1.5;
  opacity: 0.9;
}

.battle-room {
  border-top: 1px dashed var(--color-border);
  padding-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.battle-room-header {
  display: flex;
  justify-content: space-between;
  gap: 0.65rem;
  align-items: flex-start;
}

.battle-room-title {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--color-heading);
}

.battle-room-meta {
  margin: 0.15rem 0 0;
  font-size: 0.74rem;
  opacity: 0.72;
}

.trait-row {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  flex-shrink: 0;
  text-align: right;
}

.trait-line {
  margin: 0;
  font-size: 0.74rem;
  line-height: 1.45;
  color: var(--color-heading);
}

.trait-label {
  margin-right: 0.35rem;
  font-size: 0.72rem;
  opacity: 0.7;
}

.wave-block {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.wave-label {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 700;
  color: #e8a838;
  letter-spacing: 0.04em;
}

.enemy-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
}

.enemy-chip {
  flex: 1 1 220px;
  max-width: 100%;
  display: flex;
  gap: 0.55rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
}

.enemy-chip--boss {
  border-color: rgba(232, 168, 56, 0.45);
  background: color-mix(in srgb, #e8a838 8%, var(--color-background-soft));
}

.enemy-chip-image {
  width: 52px;
  height: 64px;
  flex-shrink: 0;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-background);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.enemy-chip-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.image-placeholder {
  font-size: 0.72rem;
  opacity: 0.55;
}

.enemy-chip-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.enemy-chip-name {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-heading);
  line-height: 1.35;
}

.boss-mark {
  color: #e8a838;
  margin-right: 0.15rem;
}

.enemy-count {
  margin-left: 0.25rem;
  font-size: 0.76rem;
  opacity: 0.8;
}

.enemy-chip-hp-block {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.enemy-chip-hp-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.2rem;
  margin: 0;
  line-height: 1.4;
}

.enemy-chip-hp-row--diff {
  margin-top: 0.05rem;
}

.enemy-hp-prefix {
  font-size: 0.76rem;
  color: var(--color-heading);
  opacity: 0.82;
}

.enemy-hp-prefix--ghost {
  visibility: hidden;
}

.enemy-chip-hp {
  margin: 0;
  font-size: 0.8rem;
  color: #e85d4c;
  font-weight: 600;
}

.enemy-hp-delta {
  font-size: clamp(0.64rem, 1.15vw, 0.72rem);
  font-weight: 500;
  color: #e85d4c;
  opacity: 0.92;
}

.enemy-hp-expansion {
  font-size: clamp(0.78rem, 1.5vw, 0.9rem);
  font-weight: 600;
  color: #4d9fff;
}

.enemy-chip-def {
  margin: 0;
  font-size: 0.74rem;
  opacity: 0.8;
}

.enemy-chip-trait {
  margin: 0;
  font-size: 0.74rem;
  line-height: 1.4;
  color: var(--color-heading);
  opacity: 0.88;
}

@media (max-width: 900px) {
  .header-info-row {
    flex-direction: column;
    align-items: stretch;
  }

  .hp-summary {
    max-width: none;
  }

  .phase-btn {
    min-width: 0;
  }
}

.mobile-phase-stepper {
  display: none;
}

@media (max-width: 768px) {
  .defense-panel-wrapper {
    flex-direction: column;
    min-height: auto;
  }

  .nav-zone {
    display: none;
  }

  .mobile-phase-stepper {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 0.45rem;
    width: 100%;
    max-width: 420px;
  }

  .mobile-step-btn {
    min-height: 2.4rem;
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--color-border-hover);
    border-radius: 8px;
    background: var(--color-background-soft);
    color: var(--color-heading);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }

  .mobile-step-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .mobile-step-btn--primary {
    border-color: color-mix(in srgb, #e8a838 55%, var(--color-border));
    background: color-mix(in srgb, #e8a838 14%, var(--color-background));
  }

  .defense-panel {
    padding: 0.75rem 0.55rem 1.25rem;
  }

  .page-title {
    font-size: 1.2rem;
  }

  .panel-header {
    gap: 0.65rem;
    margin-bottom: 0.85rem;
  }

  .header-info-row {
    gap: 0.55rem;
  }

  .phase-btn {
    min-height: 72px;
    padding: 0.65rem 0.85rem;
  }

  .phase-version {
    font-size: 0.95rem;
  }

  .phase-date,
  .phase-id {
    font-size: 0.72rem;
  }

  .hp-summary {
    width: 100%;
    min-height: 72px;
    padding: 0.65rem 0.75rem;
  }

  .hp-room-btn {
    width: 2.1rem;
    height: 2.1rem;
  }

  .hp-number {
    font-size: 0.9rem;
  }

  .phase-modal-overlay {
    padding: 0.75rem;
  }

  .phase-modal {
    width: min(100vw - 1rem, 1120px);
    max-height: min(88dvh, 860px);
    padding: 2.1rem 0.85rem 0.85rem;
  }

  .phase-modal-title {
    font-size: 1.15rem;
    margin-bottom: 0.85rem;
  }

  .phase-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 0.45rem;
  }

  .phase-card {
    min-height: 84px;
    padding: 0.55rem 0.4rem;
  }

  .phase-card-version {
    font-size: 0.82rem;
  }

  .phase-card-date,
  .phase-card-id {
    font-size: 0.66rem;
  }

  .frontier-scroll {
    gap: 0.85rem;
  }

  .frontier-section {
    padding: 0.75rem;
  }

  .frontier-title {
    font-size: 1.05rem;
  }

  .room-card {
    padding: 0.7rem;
    gap: 0.6rem;
  }

  .room-card-header {
    flex-direction: column;
    align-items: stretch;
  }

  .rank-block {
    align-self: flex-start;
  }

  .battle-room-header {
    flex-direction: column;
    align-items: stretch;
  }

  .trait-row {
    text-align: left;
  }

  .enemy-grid {
    flex-direction: column;
    flex-wrap: nowrap;
  }

  .enemy-chip {
    flex: none;
    width: 100%;
  }

  .buff-lines {
    font-size: 0.7rem;
  }

  .defense-panel-wrapper--embedded {
    height: auto;
    min-height: auto;
  }

  .defense-panel--embedded {
    height: auto;
    overflow: visible;
    padding: 0.45rem 0.55rem 0.85rem;
  }

  .defense-panel--embedded .header-info-row {
    flex-direction: column;
    align-items: stretch;
  }

  .defense-panel--embedded .phase-btn,
  .defense-panel--embedded .hp-summary {
    min-width: 0;
    width: 100%;
    max-width: 100%;
  }
}

.enemy-chip--admin {
  position: relative;
}

.enemy-admin-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-bottom: 0.35rem;
}

.enemy-admin-btn {
  border: 1px solid #3a424f;
  border-radius: 6px;
  background: rgba(15, 18, 23, 0.85);
  color: #d5dae4;
  padding: 0.15rem 0.45rem;
  font-size: 0.68rem;
  cursor: pointer;
}

.enemy-admin-btn--primary {
  border-color: hsla(160, 100%, 37%, 0.55);
  color: #9ad0b8;
}

.enemy-admin-btn--danger {
  border-color: #5a3434;
  color: #e8a8a8;
}

.enemy-admin-add {
  margin-top: 0.35rem;
  border: 1px dashed hsla(160, 100%, 37%, 0.45);
  border-radius: 8px;
  background: transparent;
  color: #9ad0b8;
  padding: 0.35rem 0.65rem;
  font-size: 0.75rem;
  cursor: pointer;
  width: 100%;
}

.block-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.35rem;
}

.enemy-admin-bar--inline {
  margin-bottom: 0;
}

.room-buff-empty {
  margin: 0;
  font-size: 0.78rem;
  color: #8f96a3;
}
</style>
