<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchCrisisAssaultPhases, findPhaseIndexFromChartPoint, type HpChartPoint } from '@/api/crisisAssault'
import {
  FS_HP_RATIO_NORMAL,
  HARD_SCORE_MARKERS,
  scaleHpByRatio,
} from '@/data/crisisScoreHpTable'
import { historyData } from '@/data/historyData'
import { modeTitles, type ModeKey, type PhaseData } from '@/types/history'
import {
  formatHp,
  formatHpDelta,
  formatHpExpansionPercent,
  parseHpString,
  splitBuffLines,
} from '@/utils/gameData'
import { CAPTURE_HIDE_CLASS } from '@/utils/panelImageExport'
import { createRequestEpoch } from '@/utils/requestEpoch'
import { DEFAULT_ENEMY_STAGGER_MULTIPLIER } from '@/utils/enemyResistance'
import {
  buildQueryWithValues,
  findIndexBySelectionKey,
  PANEL_QUERY_KEYS,
  periodSelectionKey,
  readSingleQueryValue,
} from '@/utils/panelUrlState'
import type { AdminBuffSlotContext, AdminMonsterSlotContext } from '@/types/admin'
import BuffEffectBlocksDisplay from '@/components/calculator/BuffEffectBlocksDisplay.vue'
import BuffRichText from '@/components/calculator/BuffRichText.vue'
import ElementTraitIcons from '@/components/shared/ElementTraitIcons.vue'
import MonsterDetailModal from '@/components/history/MonsterDetailModal.vue'
import PhasePickerModal from '@/components/history/PhasePickerModal.vue'
import {
  buildPhaseLabel,
  findPreviousFieldBuff,
  findPreviousMonsterTraits,
  getBossHpCoeffComparison,
  getBossHpComparison,
  isMonsterTraitsChanged,
  listMonsterAppearanceVersions,
  type MonsterFieldBuffSnapshot,
} from '@/utils/historyMonsterDetail'
import {
  ANOMALY_BAR_VERSION_MULTIPLIER_FROM,
  isVersionAtMost,
} from '@/utils/monsterResistanceTable'

const props = defineProps<{
  mode: ModeKey
  embedded?: boolean
  chartPoint?: HpChartPoint | null
  /** 管理端：在卡片上显示编辑/添加/删除 */
  adminMode?: boolean
}>()

const emit = defineEmits<{
  'admin-monster': [context: AdminMonsterSlotContext]
  'admin-delete-monster': [recordId: number, label: string]
  'admin-buff': [context: AdminBuffSlotContext]
  /** 从本期移除（不视为「删除 Buff 本身」；实际去掉本期该条记录） */
  'admin-remove-period-buff': [recordId: number, label: string]
}>()

const route = useRoute()
const router = useRouter()

const crisisPhases = ref<PhaseData[]>([])
const crisisLoadEpoch = createRequestEpoch()
const loading = ref(false)
const loadError = ref('')

const phases = computed(() =>
  props.mode === 'crisis-assault' ? crisisPhases.value : historyData[props.mode],
)

const currentIndex = ref(0)
const showPicker = ref(false)

const currentPhase = computed(() => phases.value[currentIndex.value])

/**
 * 期 ↔ URL（`?phase=<version>-<期数>`）。
 *
 * 管理端不参与：那边的选中项由 adminMode 的还原逻辑负责，写 URL 会污染后台地址。
 * 用 replace 而非 push：本期/上期按钮连点时不往历史里堆条目。
 */
function readPhaseIndexFromQuery(list: readonly PhaseData[]): number {
  return findIndexBySelectionKey(list, readSingleQueryValue(route.query, PANEL_QUERY_KEYS.phase))
}

function syncPhaseToQuery(phase: PhaseData | undefined) {
  if (!phase || props.adminMode) return
  const next = periodSelectionKey(phase)
  if (readSingleQueryValue(route.query, PANEL_QUERY_KEYS.phase) === next) return
  void router.replace({
    path: route.path,
    query: buildQueryWithValues(route.query, { [PANEL_QUERY_KEYS.phase]: next }),
    hash: route.hash,
  })
}

const pageTitle = computed(() => modeTitles[props.mode])

const phaseTotalHpComparison = computed(() => {
  const index = currentIndex.value
  if (index <= 0) return null

  const current = phases.value[index]
  const previous = phases.value[index - 1]
  if (!current || !previous) return null

  const currentHp = current.totalHp ?? parseHpString(current.rawHp)
  const previousHp = previous.totalHp ?? parseHpString(previous.rawHp)
  if (currentHp == null || previousHp == null) return null

  const diff = currentHp - previousHp
  if (diff === 0) return null

  return {
    diff,
    expansion: formatHpExpansionPercent(currentHp, previousHp),
  }
})

const showConvertedTotalHp = computed(() => {
  const phase = currentPhase.value
  if (!phase || props.mode !== 'crisis-assault') return false
  if (
    phase.enemies.some(
      (enemy) => !enemy.isHardRoom && enemy.defense != null && enemy.defense !== 953,
    )
  ) {
    return true
  }
  if (
    phase.totalHp != null &&
    phase.totalHpConverted953 != null &&
    phase.totalHpConverted953 !== phase.totalHp
  ) {
    return true
  }
  return Boolean(phase.rawHpConverted953 && phase.rawHpConverted953 !== phase.rawHp)
})

const showHardTotalHp = computed(() => {
  const phase = currentPhase.value
  if (!phase || props.mode !== 'crisis-assault') return false
  return (phase.hardTotalHp ?? 0) > 0
})

const showConvertedHardTotalHp = computed(() => {
  const phase = currentPhase.value
  if (!phase || !showHardTotalHp.value) return false
  if (
    phase.enemies.some(
      (enemy) => enemy.isHardRoom && enemy.defense != null && enemy.defense !== 953,
    )
  ) {
    return true
  }
  return (
    phase.hardTotalHp != null &&
    phase.hardTotalHpConverted953 != null &&
    phase.hardTotalHpConverted953 !== phase.hardTotalHp
  )
})

const phaseFsHp = computed(() => {
  const phase = currentPhase.value
  if (!phase || props.mode !== 'crisis-assault') return null
  const total = phase.totalHp ?? parseHpString(phase.rawHp)
  if (total == null || total <= 0) return null
  const hp = scaleHpByRatio(total, FS_HP_RATIO_NORMAL)
  const converted =
    phase.totalHpConverted953 != null && phase.totalHpConverted953 > 0
      ? scaleHpByRatio(phase.totalHpConverted953, FS_HP_RATIO_NORMAL)
      : null
  return { hp, converted }
})

const phaseHardScoreHps = computed(() => {
  const phase = currentPhase.value
  if (!phase || !showHardTotalHp.value) return []
  const total = phase.hardTotalHp ?? 0
  if (total <= 0) return []
  const convertedTotal = phase.hardTotalHpConverted953 ?? null
  return HARD_SCORE_MARKERS.map((marker) => ({
    ...marker,
    hp: scaleHpByRatio(total, marker.hpRatio),
    converted:
      convertedTotal != null && convertedTotal > 0
        ? scaleHpByRatio(convertedTotal, marker.hpRatio)
        : null,
  }))
})

const phaseHardTotalHpComparison = computed(() => {
  const index = currentIndex.value
  if (index <= 0 || props.mode !== 'crisis-assault') return null

  const current = phases.value[index]
  const previous = phases.value[index - 1]
  if (!current || !previous) return null

  const currentHp = current.hardTotalHp ?? 0
  const previousHp = previous.hardTotalHp ?? 0
  if (!currentHp && !previousHp) return null
  const diff = currentHp - previousHp
  if (diff === 0) return null

  return {
    diff,
    expansion: formatHpExpansionPercent(currentHp, previousHp),
  }
})

function shouldShowConvertedEnemyHp(enemy: PhaseData['enemies'][number]) {
  return (
    props.mode === 'crisis-assault' &&
    enemy.defense != null &&
    enemy.defense !== 953 &&
    Boolean(enemy.hpConverted953)
  )
}

const currentEnemyHpComparisons = computed(() => {
  const phase = currentPhase.value
  if (!phase) return []

  return phase.enemies.map((enemy) =>
    getBossHpComparison(phases.value, currentIndex.value, enemy.bossName, enemy.hpValue, enemy.hp),
  )
})

const currentEnemyHpCoeffComparisons = computed(() => {
  const phase = currentPhase.value
  if (!phase) return []

  return phase.enemies.map((enemy) =>
    getBossHpCoeffComparison(phases.value, currentIndex.value, enemy.bossName, enemy.hpCoeffPercent ?? null),
  )
})

const normalEnemyEntries = computed(() =>
  (currentPhase.value?.enemies ?? [])
    .map((enemy, index) => ({ enemy, index }))
    .filter(({ enemy }) => !enemy.isHardRoom),
)

const hardEnemyEntries = computed(() =>
  (currentPhase.value?.enemies ?? [])
    .map((enemy, index) => ({ enemy, index }))
    .filter(({ enemy }) => enemy.isHardRoom),
)

function parsePhaseNumber(phaseLabel: string) {
  return (phaseLabel.match(/\d+/)?.[0] ?? phaseLabel.replace(/\D/g, '')) || '1'
}

function fieldBuffLines(enemy: PhaseData['enemies'][number]) {
  const text = enemy.fieldBuff?.text?.trim()
  if (text) return splitBuffLines(text)
  return []
}

function fieldBuffTitle(enemy: PhaseData['enemies'][number]) {
  const name = enemy.fieldBuff?.name?.trim()
  if (name && name !== '场地 Buff') return name
  return '场地 Buff'
}

/** 得分机制（纯文本，与怪物绑定）：按行拆分，显示在场地 Buff 上方 */
function scoringNoteLines(enemy: PhaseData['enemies'][number]) {
  const text = enemy.scoringNote?.trim()
  return text ? splitBuffLines(text) : []
}

/** 失衡易伤展示：150%（1.5）；缺省按 1.5，与怪物详情弹窗同口径 */
function formatStaggerMultiplier(value: number | null | undefined) {
  const multiplier = value ?? DEFAULT_ENEMY_STAGGER_MULTIPLIER
  return `${Math.round(multiplier * 100)}%（${multiplier}）`
}

/** 往期详情场地 Buff：只保留效果块注释；与原文重复的注释去掉 */
function blocksForHistoryDisplay(
  blocks: NonNullable<PhaseData['buffs'][number]['effectBlocks']> | null | undefined,
  content: string,
) {
  if (!blocks?.length) return null
  const text = content.trim()
  const noteBlocks = blocks
    .map((block) => ({
      ...block,
      note: block.note?.trim() && block.note.trim() !== text ? block.note : '',
    }))
    .filter((block) => block.note)
  return noteBlocks.length ? noteBlocks : null
}

/** 场地 Buff 是否有可导出的注释（导出截图只带注释，原文仍隐藏） */
function hasFieldBuffNotes(enemy: PhaseData['enemies'][number]) {
  return Boolean(
    blocksForHistoryDisplay(enemy.fieldBuff?.effectBlocks, enemy.fieldBuff?.text ?? '')?.length,
  )
}

function buildCrisisMonsterContext(
  enemy: PhaseData['enemies'][number],
  mode: 'create' | 'edit',
): AdminMonsterSlotContext | null {
  const phase = currentPhase.value
  if (!phase?.version) return null
  const phaseNum = parsePhaseNumber(phase.phase)
  const room = enemy.room ?? (enemy.isHardRoom ? '4' : '')
  if (!room) return null
  return {
    mode,
    recordId: enemy.recordId,
    version: phase.version,
    phase: phaseNum,
    room,
    bossName: enemy.bossName ?? '',
    hp: enemy.hpValue ?? enemy.hp,
    defense: enemy.defense,
    level: enemy.label.match(/Lv(\d+)/)?.[1] ?? (enemy.isHardRoom ? '70' : '70'),
    weakness: enemy.weakness ?? '',
    resistance: enemy.resistance ?? '',
    resistanceHigh: enemy.resistanceHigh ?? '',
    bossImage: enemy.imageUrl ?? null,
    crisisBaseHp: enemy.crisisBaseHp,
    hpCoeffPercent: enemy.hpCoeffPercent,
    hpCoeffManual: enemy.hpCoeffPercent != null,
    fieldBuffSetId: enemy.fieldBuffSetId ?? null,
    weaknessSetId: enemy.weaknessSetId ?? null,
  }
}

function onAdminEditEnemy(enemy: PhaseData['enemies'][number]) {
  const ctx = buildCrisisMonsterContext(enemy, 'edit')
  if (ctx) emit('admin-monster', ctx)
}

function onAdminAddEnemy(enemy: PhaseData['enemies'][number]) {
  const ctx = buildCrisisMonsterContext(enemy, 'create')
  if (ctx) emit('admin-monster', { ...ctx, bossName: '', hp: '', defense: '', level: '70' })
}

function onAdminDeleteEnemy(enemy: PhaseData['enemies'][number]) {
  if (!enemy.recordId) return
  emit('admin-delete-monster', enemy.recordId, enemy.label)
}

function buildCrisisBuffContext(
  buff: PhaseData['buffs'][number],
  mode: 'create' | 'edit',
): AdminBuffSlotContext | null {
  const phase = currentPhase.value
  if (!phase?.version) return null
  const buffIndex = buff.buffIndex ?? 1
  return {
    mode,
    recordId: buff.recordId,
    version: phase.version,
    phase: parsePhaseNumber(phase.phase),
    buffIndex,
    buffName: buff.isEmpty ? '' : buff.name,
    buffText: buff.buffText ?? buff.lines.join('\n'),
    buffImage: buff.imageUrl ?? null,
    effectBlocks: buff.effectBlocks ?? null,
  }
}

function onAdminEditBuff(buff: PhaseData['buffs'][number]) {
  const ctx = buildCrisisBuffContext(buff, 'edit')
  if (ctx) emit('admin-buff', ctx)
}

function onAdminAddBuff(buff: PhaseData['buffs'][number]) {
  const ctx = buildCrisisBuffContext(buff, 'create')
  if (ctx) emit('admin-buff', { ...ctx, buffName: '', buffText: '' })
}

function onAdminRemovePeriodBuff(buff: PhaseData['buffs'][number]) {
  if (!buff.recordId) return
  emit('admin-remove-period-buff', buff.recordId, buff.name)
}

/** 怪物详情弹窗：仅危局、非管理端、有怪物名的槽位可点开 */
const monsterDetailOpen = ref(false)
const monsterDetailEnemy = ref<PhaseData['enemies'][number] | null>(null)

function canOpenMonsterDetail(enemy: PhaseData['enemies'][number]) {
  return props.mode === 'crisis-assault' && !props.adminMode && !enemy.isEmpty && Boolean(enemy.bossName)
}

function openMonsterDetail(enemy: PhaseData['enemies'][number]) {
  if (!canOpenMonsterDetail(enemy)) return
  monsterDetailEnemy.value = enemy
  monsterDetailOpen.value = true
}

function closeMonsterDetail() {
  monsterDetailOpen.value = false
  monsterDetailEnemy.value = null
}

function onMonsterDetailKeydown(event: KeyboardEvent, enemy: PhaseData['enemies'][number]) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  openMonsterDetail(enemy)
}

const monsterDetailPhaseLabel = computed(() => {
  const phase = currentPhase.value
  const enemy = monsterDetailEnemy.value
  if (!phase || !enemy) return ''
  return `${phase.version} ${phase.phase} · ${enemy.label}`.trim()
})

/** 该怪物所属期数的游戏版本：详情弹窗据此判「2.1 起异常条 ×1.1」，拿不到时为 null */
const monsterDetailPhaseVersion = computed(() => currentPhase.value?.version ?? null)

/**
 * 该 Boss 是否在 2.1（含）之前就已存在 —— 版本系数的第二个条件（与「当期 ≥ 2.1」同时成立才乘）。
 * 首次出现不晚于 2.1 即为 true：老 Boss 与 2.1 才出的新 Boss 都算，2.2 起才出的不算。
 * **只按 Boss 名匹配（不区分房间）**：这是 Boss 级属性，同一只 Boss 会跨期换房间，
 * 带房间匹配会把换了房间的老 Boss 误判成新怪（实测 2.1+ 的 82 张卡片里有 7 张会判错）。
 * 版本号解析不出的期数不算出现（与 `isVersionAtMost` 同口径）。
 */
const monsterDetailBossExistedByMultiplierVersion = computed(() => {
  const bossName = monsterDetailEnemy.value?.bossName
  if (!bossName) return false
  return listMonsterAppearanceVersions(phases.value, bossName).some((version) =>
    isVersionAtMost(version, ANOMALY_BAR_VERSION_MULTIPLIER_FROM),
  )
})

const monsterDetailCurrentFieldBuff = computed<MonsterFieldBuffSnapshot | null>(() => {
  const phase = currentPhase.value
  const enemy = monsterDetailEnemy.value
  if (!enemy) return null
  return {
    fieldBuff: enemy.fieldBuff ?? null,
    phaseLabel: phase ? buildPhaseLabel(phase) : '',
  }
})

const monsterDetailPreviousFieldBuff = computed(() => {
  const enemy = monsterDetailEnemy.value
  if (!enemy?.bossName) return null
  return findPreviousFieldBuff(phases.value, currentIndex.value, {
    bossName: enemy.bossName,
    room: enemy.room ?? '',
  })
})

/** 弱点 / 抗性转变：与场地 Buff 同口径，取同一 Boss + 房间的上一期出现 */
const monsterDetailTraitTransition = computed(() => {
  const enemy = monsterDetailEnemy.value
  const phase = currentPhase.value
  if (!enemy?.bossName || !phase) return null
  const previous = findPreviousMonsterTraits(phases.value, currentIndex.value, {
    bossName: enemy.bossName,
    room: enemy.room ?? '',
  })
  if (!previous) return null
  const current = {
    phaseLabel: buildPhaseLabel(phase),
    weakness: enemy.weakness,
    resistance: enemy.resistance,
    resistanceHigh: enemy.resistanceHigh,
  }
  return isMonsterTraitsChanged(previous, current) ? { previous, current } : null
})

// 与卡片同一口径的血量 / 系数对比，供详情弹窗展示增长
const monsterDetailHpComparison = computed(() => {
  const enemy = monsterDetailEnemy.value
  if (!enemy) return null
  return getBossHpComparison(phases.value, currentIndex.value, enemy.bossName, enemy.hpValue, enemy.hp)
})

const monsterDetailHpCoeffComparison = computed(() => {
  const enemy = monsterDetailEnemy.value
  if (!enemy) return null
  return getBossHpCoeffComparison(
    phases.value,
    currentIndex.value,
    enemy.bossName,
    enemy.hpCoeffPercent ?? null,
  )
})

defineExpose({
  reload: loadCrisisAssaultData,
  getCurrentMeta: () => {
    const phase = currentPhase.value
    if (!phase?.version) return null
    const phaseNum = String(phase.phase ?? '').replace(/\D/g, '') || String(phase.phase ?? '')
    return {
      version: String(phase.version),
      phase: phaseNum,
    }
  },
})

function defaultPublicPhaseIndex(list: { isHidden?: boolean }[]): number {
  if (!list.length) return 0
  for (let index = list.length - 1; index >= 0; index--) {
    if (!list[index]?.isHidden) return index
  }
  return list.length - 1
}

async function loadCrisisAssaultData() {
  const token = crisisLoadEpoch.next()
  if (props.mode !== 'crisis-assault') return

  loading.value = true
  loadError.value = ''
  const previousKey =
    props.adminMode && currentPhase.value ? periodSelectionKey(currentPhase.value) : null
  try {
    const data = await fetchCrisisAssaultPhases()
    if (!crisisLoadEpoch.isCurrent(token)) return
    crisisPhases.value = data
    const queryIndex = readPhaseIndexFromQuery(crisisPhases.value)
    if (props.chartPoint) {
      applyChartPointSelection()
    } else if (queryIndex >= 0) {
      // 深链优先：URL 明确指定了某一期就用它
      currentIndex.value = queryIndex
    } else if (previousKey) {
      const restoredIndex = crisisPhases.value.findIndex(
        (item) => periodSelectionKey(item) === previousKey,
      )
      currentIndex.value =
        restoredIndex >= 0 ? restoredIndex : defaultPublicPhaseIndex(crisisPhases.value)
    } else {
      currentIndex.value = defaultPublicPhaseIndex(crisisPhases.value)
    }
  } catch (error) {
    if (!crisisLoadEpoch.isCurrent(token)) return
    loadError.value = error instanceof Error ? error.message : '加载失败'
    crisisPhases.value = []
  } finally {
    if (!crisisLoadEpoch.isCurrent(token)) return
    loading.value = false
  }
}

function applyChartPointSelection() {
  if (!props.chartPoint || !phases.value.length) return
  const index = findPhaseIndexFromChartPoint(phases.value, props.chartPoint)
  if (index >= 0) currentIndex.value = index
}

onMounted(loadCrisisAssaultData)

watch(
  () => props.mode,
  () => {
    currentIndex.value = 0
    showPicker.value = false
    loadCrisisAssaultData()
  },
)

watch(
  () => props.chartPoint,
  () => {
    applyChartPointSelection()
  },
)

watch(phases, () => {
  applyChartPointSelection()
})

// 选中项变化（含列表刚加载完的默认/还原选中）→ 写入 URL
watch([currentIndex, phases], () => {
  syncPhaseToQuery(currentPhase.value)
})

// URL 变化（浏览器前进后退 / 直接改地址）→ 同步回面板状态
watch(
  () => route.query[PANEL_QUERY_KEYS.phase],
  () => {
    if (props.adminMode) return
    const index = readPhaseIndexFromQuery(phases.value)
    if (index >= 0 && index !== currentIndex.value) currentIndex.value = index
  },
)

function prevPhase() {
  if (currentIndex.value > 0) currentIndex.value--
}

function nextPhase() {
  if (currentIndex.value < phases.value.length - 1) currentIndex.value++
}

function onNavZoneClick(direction: 'prev' | 'next') {
  if (direction === 'prev') prevPhase()
  else nextPhase()
}

function selectPhase(index: number) {
  currentIndex.value = index
  showPicker.value = false
}

function openPhasePicker() {
  showPicker.value = true
}

function closePhasePicker() {
  showPicker.value = false
}
</script>

<template>
  <div class="history-panel-wrapper" :class="{ 'history-panel-wrapper--embedded': embedded }">
    <div
      v-if="currentPhase && !loading && !embedded"
      class="nav-zone nav-zone--left"
      :class="{ 'nav-zone--disabled': currentIndex === 0 }"
      role="button"
      aria-label="上一期"
      tabindex="0"
      @click="onNavZoneClick('prev')"
      @keydown.enter="onNavZoneClick('prev')"
      @keydown.space.prevent="onNavZoneClick('prev')"
    />

    <div class="history-panel" :class="{ 'history-panel--embedded': embedded }">
      <header class="panel-header">
        <h1 v-if="!embedded" class="page-title">{{ pageTitle }}</h1>

        <p v-if="loading" class="status-text">加载中...</p>
        <p v-else-if="loadError" class="status-text error">{{ loadError }}</p>

        <template v-else-if="currentPhase">
          <div v-if="!embedded" class="mobile-phase-stepper">
            <button
              type="button"
              class="mobile-step-btn"
              :disabled="currentIndex === 0"
              @click="prevPhase"
            >
              上一期
            </button>
            <button type="button" class="mobile-step-btn mobile-step-btn--primary" @click="openPhasePicker">
              选期
            </button>
            <button
              type="button"
              class="mobile-step-btn"
              :disabled="currentIndex >= phases.length - 1"
              @click="nextPhase"
            >
              下一期
            </button>
          </div>

          <div class="header-info-row">
            <div class="phase-selector">
              <button type="button" class="phase-btn" @click="openPhasePicker">
                <span class="phase-version">
                  {{ currentPhase.version }} {{ currentPhase.phase }}
                  <span v-if="currentPhase.pendingCleanup" class="phase-trash-badge">已删除未清理</span>
                  <span v-else-if="currentPhase.isHidden" class="phase-hidden-badge">未公开</span>
                </span>
                <span class="phase-date">{{ currentPhase.dateRange }}</span>
                <span class="phase-id">ID: {{ currentPhase.tid }}</span>
              </button>
            </div>

            <div class="hp-summary">
              <span class="hp-label">总血量</span>
              <div class="hp-metrics">
                <div class="hp-metric-row">
                  <span class="hp-tag">HP</span>
                  <span class="hp-number">{{ currentPhase.rawHp }}</span>
                  <span v-if="phaseTotalHpComparison?.expansion" class="hp-expansion">
                    {{ phaseTotalHpComparison.expansion }}
                  </span>
                </div>
                <div v-if="phaseTotalHpComparison" class="hp-metric-row">
                  <span class="hp-tag hp-tag--ghost" aria-hidden="true">HP</span>
                  <span class="hp-delta">{{ formatHpDelta(phaseTotalHpComparison.diff) }}</span>
                </div>
                <div
                  v-if="showConvertedTotalHp"
                  class="hp-metric-row"
                  :class="CAPTURE_HIDE_CLASS"
                >
                  <span class="hp-tag hp-tag--converted">953</span>
                  <span class="hp-number">{{ currentPhase.rawHpConverted953 }}</span>
                </div>
                <div
                  v-if="phaseFsHp"
                  class="hp-metric-row hp-metric-row--score"
                  :class="CAPTURE_HIDE_CLASS"
                >
                  <span class="hp-tag hp-tag--fs">FS</span>
                  <span class="hp-number">{{ formatHp(phaseFsHp.hp) }}</span>
                  <span class="hp-score-hint">2万满星S</span>
                </div>
                <div
                  v-if="phaseFsHp?.converted != null && showConvertedTotalHp"
                  class="hp-metric-row hp-metric-row--score"
                  :class="CAPTURE_HIDE_CLASS"
                >
                  <span class="hp-tag hp-tag--converted">953</span>
                  <span class="hp-number">{{ formatHp(phaseFsHp.converted) }}</span>
                  <span class="hp-score-hint">FS-HP</span>
                </div>
              </div>
            </div>

            <div v-if="showHardTotalHp" class="hp-summary hp-summary--hard">
              <span class="hp-label">绝境总血量</span>
              <div class="hp-metrics">
                <div class="hp-metric-row">
                  <span class="hp-tag hp-tag--hard">H-HP</span>
                  <span class="hp-number">{{ currentPhase.rawHardHp }}</span>
                  <span v-if="phaseHardTotalHpComparison?.expansion" class="hp-expansion">
                    {{ phaseHardTotalHpComparison.expansion }}
                  </span>
                </div>
                <div v-if="phaseHardTotalHpComparison" class="hp-metric-row">
                  <span class="hp-tag hp-tag--ghost" aria-hidden="true">H-HP</span>
                  <span class="hp-delta">{{ formatHpDelta(phaseHardTotalHpComparison.diff) }}</span>
                </div>
                <div
                  v-if="showConvertedHardTotalHp"
                  class="hp-metric-row"
                  :class="CAPTURE_HIDE_CLASS"
                >
                  <span class="hp-tag hp-tag--converted">953</span>
                  <span class="hp-number">{{ currentPhase.rawHardHpConverted953 }}</span>
                </div>
                <div
                  v-for="item in phaseHardScoreHps"
                  :key="item.id"
                  class="hp-metric-row hp-metric-row--score"
                  :class="CAPTURE_HIDE_CLASS"
                >
                  <span class="hp-tag hp-tag--star" :style="{ color: item.color }">{{ item.shortLabel }}</span>
                  <span class="hp-number">{{ formatHp(item.hp) }}</span>
                </div>
                <template v-if="showConvertedHardTotalHp">
                  <div
                    v-for="item in phaseHardScoreHps"
                    :key="`953-${item.id}`"
                    class="hp-metric-row hp-metric-row--score"
                    :class="CAPTURE_HIDE_CLASS"
                  >
                    <span class="hp-tag hp-tag--converted">953</span>
                    <span class="hp-number">{{ formatHp(item.converted ?? 0) }}</span>
                    <span class="hp-score-hint">{{ item.shortLabel }}</span>
                  </div>
                </template>
              </div>
            </div>
          </div>

          <PhasePickerModal
            :visible="showPicker"
            :phases="phases"
            :title="pageTitle"
            :model-value="currentIndex"
            @select="selectPhase"
            @close="closePhasePicker"
          />
        </template>
      </header>

        <div v-if="currentPhase && !loading" class="content-grid" :class="{ 'content-grid--embedded': embedded }">
        <div class="buff-row">
          <article
            v-for="(buff, index) in currentPhase.buffs"
            :key="`${currentPhase.id}-buff-${index}`"
            class="buff-card"
            :class="{ 'buff-card--empty': buff.isEmpty, 'buff-card--admin': adminMode }"
          >
            <div v-if="adminMode" class="enemy-admin-bar">
              <button
                v-if="!buff.isEmpty"
                type="button"
                class="enemy-admin-btn"
                @click.stop="onAdminEditBuff(buff)"
              >
                编辑
              </button>
              <button
                v-if="!buff.isEmpty && buff.recordId"
                type="button"
                class="enemy-admin-btn enemy-admin-btn--danger"
                @click.stop="onAdminRemovePeriodBuff(buff)"
              >
                从本期移除
              </button>
              <button
                v-if="buff.isEmpty"
                type="button"
                class="enemy-admin-btn enemy-admin-btn--primary"
                @click.stop="onAdminAddBuff(buff)"
              >
                添加 Buff
              </button>
            </div>
            <div class="buff-card-head">
              <div v-if="buff.imageUrl" class="buff-image">
                <img :src="buff.imageUrl" :alt="buff.name" />
              </div>
              <div v-else class="buff-icon">{{ buff.icon }}</div>
              <h3 class="buff-name">{{ buff.name }}</h3>
            </div>
            <ul v-if="buff.lines.length" class="buff-lines">
              <li v-for="(line, lineIndex) in buff.lines" :key="lineIndex">
                <BuffRichText :text="line" />
              </li>
            </ul>
          </article>
        </div>

        <div
          v-if="normalEnemyEntries.length"
          class="enemy-row enemy-row--normal"
        >
          <article
            v-for="{ enemy, index } in normalEnemyEntries"
            :key="`${currentPhase.id}-enemy-${index}`"
            class="enemy-card"
            :class="{
              'enemy-card--empty': enemy.isEmpty,
              'enemy-card--admin': adminMode,
              'enemy-card--clickable': canOpenMonsterDetail(enemy),
            }"
            :role="canOpenMonsterDetail(enemy) ? 'button' : undefined"
            :aria-label="canOpenMonsterDetail(enemy) ? `查看 ${enemy.bossName} 详情` : undefined"
            :tabindex="canOpenMonsterDetail(enemy) ? 0 : undefined"
            @click="openMonsterDetail(enemy)"
            @keydown="onMonsterDetailKeydown($event, enemy)"
          >
            <p class="enemy-label">{{ enemy.label }}</p>
            <div v-if="adminMode" class="enemy-admin-bar">
              <button
                v-if="!enemy.isEmpty"
                type="button"
                class="enemy-admin-btn"
                @click.stop="onAdminEditEnemy(enemy)"
              >
                编辑
              </button>
              <button
                v-if="!enemy.isEmpty && enemy.recordId"
                type="button"
                class="enemy-admin-btn enemy-admin-btn--danger"
                @click.stop="onAdminDeleteEnemy(enemy)"
              >
                删除
              </button>
              <button
                v-if="enemy.isEmpty"
                type="button"
                class="enemy-admin-btn enemy-admin-btn--primary"
                @click.stop="onAdminAddEnemy(enemy)"
              >
                添加怪物
              </button>
            </div>
            <div
              class="enemy-main"
              :class="{
                'enemy-main--with-field-buff':
                  enemy.fieldBuff?.name || enemy.fieldBuff?.text || enemy.fieldBuff?.effectBlocks?.length,
              }"
            >
              <div class="enemy-body">
                <div class="enemy-image">
                  <img v-if="enemy.imageUrl" :src="enemy.imageUrl" :alt="enemy.label" />
                  <span v-else class="image-placeholder">怪物图片</span>
                </div>
                <div class="enemy-info">
                  <h3 v-if="enemy.bossName" class="enemy-name">{{ enemy.bossName }}</h3>
                  <p v-else-if="enemy.subStats" class="enemy-stats">{{ enemy.subStats }}</p>
                  <div class="enemy-hp-block">
                    <p class="enemy-hp-row">
                      <span class="enemy-hp-prefix">血量：</span>
                      <span class="enemy-hp-number">{{ enemy.hp }}</span>
                      <span
                        v-if="currentEnemyHpComparisons[index]?.expansion"
                        class="enemy-hp-expansion"
                      >
                        {{ currentEnemyHpComparisons[index]!.expansion }}
                      </span>
                    </p>
                    <p v-if="currentEnemyHpComparisons[index]" class="enemy-hp-row enemy-hp-row--diff">
                      <span class="enemy-hp-prefix enemy-hp-prefix--ghost" aria-hidden="true">血量：</span>
                      <span class="enemy-hp-delta">
                        {{ formatHpDelta(currentEnemyHpComparisons[index]!.diff) }}
                      </span>
                    </p>
                    <p
                      v-if="shouldShowConvertedEnemyHp(enemy)"
                      class="enemy-hp-row enemy-hp-row--meta enemy-hp-row--converted"
                    >
                      <span class="enemy-hp-prefix">953防御换算：</span>
                      <span class="enemy-hp-number">{{ enemy.hpConverted953 }}</span>
                    </p>
                    <p v-if="enemy.crisisBaseHp != null" class="enemy-hp-row enemy-hp-row--meta" :class="CAPTURE_HIDE_CLASS">
                      <span class="enemy-hp-prefix">基础血量：</span>
                      <span class="enemy-hp-number">{{ formatHp(enemy.crisisBaseHp) }}</span>
                    </p>
                    <p v-if="enemy.hpCoeffLabel" class="enemy-hp-row enemy-hp-row--meta" :class="CAPTURE_HIDE_CLASS">
                      <span class="enemy-hp-prefix">危局血量系数：</span>
                      <span class="enemy-hp-number">{{ enemy.hpCoeffLabel }}</span>
                      <span
                        v-if="currentEnemyHpCoeffComparisons[index]?.deltaLabel"
                        class="enemy-hp-expansion"
                      >
                        {{ currentEnemyHpCoeffComparisons[index]!.deltaLabel }}
                      </span>
                    </p>
                  </div>
                  <div
                    v-if="
                      enemy.defense !== undefined ||
                      enemy.staggerTime != null ||
                      !enemy.isEmpty
                    "
                    class="enemy-traits"
                  >
                    <p v-if="enemy.defense !== undefined" class="enemy-defense">防御：{{ enemy.defense }}</p>
                    <p v-if="enemy.staggerTime != null" class="enemy-stagger-time">
                      失衡时间：{{ enemy.staggerTime }} 秒
                    </p>
                    <p class="enemy-stagger-multiplier">
                      失衡易伤：{{ formatStaggerMultiplier(enemy.staggerMultiplier) }}
                    </p>
                    <p v-if="enemy.weaknessSetLabel" class="enemy-trait-set-title">
                      弱点 / 抗性 · {{ enemy.weaknessSetLabel }}
                    </p>
                    <p class="enemy-weakness">
                      <ElementTraitIcons
                        :value="enemy.weakness"
                        label="弱点"
                        variant="weak"
                        show-percent
                        empty-text="无"
                      />
                    </p>
                    <p class="enemy-resistance">
                      <ElementTraitIcons
                        :value="enemy.resistance"
                        :high-value="enemy.resistanceHigh"
                        label="抗性"
                        variant="resist"
                        show-percent
                        empty-text="无"
                      />
                    </p>
                  </div>
                </div>
              </div>
              <div v-if="scoringNoteLines(enemy).length" class="enemy-scoring-note">
                <p class="enemy-scoring-note-title">得分机制</p>
                <ul class="enemy-scoring-note-lines">
                  <li v-for="(line, lineIndex) in scoringNoteLines(enemy)" :key="lineIndex">
                    <BuffRichText :text="line" />
                  </li>
                </ul>
              </div>
              <div
                v-if="enemy.fieldBuff?.name || enemy.fieldBuff?.text || enemy.fieldBuff?.effectBlocks?.length"
                class="enemy-field-buff"
                :class="hasFieldBuffNotes(enemy) ? '' : CAPTURE_HIDE_CLASS"
              >
                <p class="enemy-field-buff-title">{{ fieldBuffTitle(enemy) }}</p>
                <ul
                  v-if="fieldBuffLines(enemy).length"
                  class="enemy-field-buff-lines"
                  :class="CAPTURE_HIDE_CLASS"
                >
                  <li v-for="(line, lineIndex) in fieldBuffLines(enemy)" :key="lineIndex">
                    <BuffRichText :text="line" />
                  </li>
                </ul>
                <div
                  v-if="fieldBuffLines(enemy).length && blocksForHistoryDisplay(enemy.fieldBuff?.effectBlocks, enemy.fieldBuff?.text ?? '')?.length"
                  class="enemy-field-buff-divider"
                  :class="CAPTURE_HIDE_CLASS"
                  aria-hidden="true"
                />
                <BuffEffectBlocksDisplay
                  v-if="blocksForHistoryDisplay(enemy.fieldBuff?.effectBlocks, enemy.fieldBuff?.text ?? '')?.length"
                  compact
                  notes-only
                  :blocks="blocksForHistoryDisplay(enemy.fieldBuff?.effectBlocks, enemy.fieldBuff?.text ?? '')"
                  :title="enemy.fieldBuff?.name || '场地 Buff'"
                  empty-text="暂无场地 Buff 效果块"
                />
                <p
                  v-else-if="!fieldBuffLines(enemy).length && enemy.fieldBuff?.text"
                  class="enemy-field-buff-meta"
                  :class="CAPTURE_HIDE_CLASS"
                >
                  <BuffRichText :text="enemy.fieldBuff.text" />
                </p>
              </div>
            </div>
          </article>
        </div>

        <div v-if="hardEnemyEntries.length" class="enemy-row enemy-row--hard">
          <article
            v-for="{ enemy, index } in hardEnemyEntries"
            :key="`${currentPhase.id}-enemy-${index}`"
            class="enemy-card enemy-card--hard"
            :class="{
              'enemy-card--empty': enemy.isEmpty,
              'enemy-card--admin': adminMode,
              'enemy-card--clickable': canOpenMonsterDetail(enemy),
            }"
            :role="canOpenMonsterDetail(enemy) ? 'button' : undefined"
            :aria-label="canOpenMonsterDetail(enemy) ? `查看 ${enemy.bossName} 详情` : undefined"
            :tabindex="canOpenMonsterDetail(enemy) ? 0 : undefined"
            @click="openMonsterDetail(enemy)"
            @keydown="onMonsterDetailKeydown($event, enemy)"
          >
            <p class="enemy-label">{{ enemy.label }}</p>
            <div v-if="adminMode" class="enemy-admin-bar">
              <button
                v-if="!enemy.isEmpty"
                type="button"
                class="enemy-admin-btn"
                @click.stop="onAdminEditEnemy(enemy)"
              >
                编辑
              </button>
              <button
                v-if="!enemy.isEmpty && enemy.recordId"
                type="button"
                class="enemy-admin-btn enemy-admin-btn--danger"
                @click.stop="onAdminDeleteEnemy(enemy)"
              >
                删除
              </button>
              <button
                v-if="enemy.isEmpty"
                type="button"
                class="enemy-admin-btn enemy-admin-btn--primary"
                @click.stop="onAdminAddEnemy(enemy)"
              >
                添加怪物
              </button>
            </div>
            <div
              class="enemy-main"
              :class="{
                'enemy-main--with-field-buff':
                  enemy.fieldBuff?.name || enemy.fieldBuff?.text || enemy.fieldBuff?.effectBlocks?.length,
              }"
            >
              <div class="enemy-body">
                <div class="enemy-image">
                  <img v-if="enemy.imageUrl" :src="enemy.imageUrl" :alt="enemy.label" />
                  <span v-else class="image-placeholder">怪物图片</span>
                </div>
                <div class="enemy-info">
                  <h3 v-if="enemy.bossName" class="enemy-name">{{ enemy.bossName }}</h3>
                  <p v-else-if="enemy.subStats" class="enemy-stats">{{ enemy.subStats }}</p>
                  <div class="enemy-hp-block">
                    <p class="enemy-hp-row">
                      <span class="enemy-hp-prefix">血量：</span>
                      <span class="enemy-hp-number">{{ enemy.hp }}</span>
                      <span
                        v-if="currentEnemyHpComparisons[index]?.expansion"
                        class="enemy-hp-expansion"
                      >
                        {{ currentEnemyHpComparisons[index]!.expansion }}
                      </span>
                    </p>
                    <p v-if="currentEnemyHpComparisons[index]" class="enemy-hp-row enemy-hp-row--diff">
                      <span class="enemy-hp-prefix enemy-hp-prefix--ghost" aria-hidden="true">血量：</span>
                      <span class="enemy-hp-delta">
                        {{ formatHpDelta(currentEnemyHpComparisons[index]!.diff) }}
                      </span>
                    </p>
                    <p
                      v-if="shouldShowConvertedEnemyHp(enemy)"
                      class="enemy-hp-row enemy-hp-row--meta enemy-hp-row--converted"
                    >
                      <span class="enemy-hp-prefix">953防御换算：</span>
                      <span class="enemy-hp-number">{{ enemy.hpConverted953 }}</span>
                    </p>
                    <p v-if="enemy.crisisBaseHp != null" class="enemy-hp-row enemy-hp-row--meta" :class="CAPTURE_HIDE_CLASS">
                      <span class="enemy-hp-prefix">基础血量：</span>
                      <span class="enemy-hp-number">{{ formatHp(enemy.crisisBaseHp) }}</span>
                    </p>
                    <p v-if="enemy.hpCoeffLabel" class="enemy-hp-row enemy-hp-row--meta" :class="CAPTURE_HIDE_CLASS">
                      <span class="enemy-hp-prefix">危局血量系数：</span>
                      <span class="enemy-hp-number">{{ enemy.hpCoeffLabel }}</span>
                      <span
                        v-if="currentEnemyHpCoeffComparisons[index]?.deltaLabel"
                        class="enemy-hp-expansion"
                      >
                        {{ currentEnemyHpCoeffComparisons[index]!.deltaLabel }}
                      </span>
                    </p>
                  </div>
                  <div
                    v-if="
                      enemy.defense !== undefined ||
                      enemy.staggerTime != null ||
                      !enemy.isEmpty
                    "
                    class="enemy-traits"
                  >
                    <p v-if="enemy.defense !== undefined" class="enemy-defense">防御：{{ enemy.defense }}</p>
                    <p v-if="enemy.staggerTime != null" class="enemy-stagger-time">
                      失衡时间：{{ enemy.staggerTime }} 秒
                    </p>
                    <p class="enemy-stagger-multiplier">
                      失衡易伤：{{ formatStaggerMultiplier(enemy.staggerMultiplier) }}
                    </p>
                    <p v-if="enemy.weaknessSetLabel" class="enemy-trait-set-title">
                      弱点 / 抗性 · {{ enemy.weaknessSetLabel }}
                    </p>
                    <p class="enemy-weakness">
                      <ElementTraitIcons
                        :value="enemy.weakness"
                        label="弱点"
                        variant="weak"
                        show-percent
                        empty-text="无"
                      />
                    </p>
                    <p class="enemy-resistance">
                      <ElementTraitIcons
                        :value="enemy.resistance"
                        :high-value="enemy.resistanceHigh"
                        label="抗性"
                        variant="resist"
                        show-percent
                        empty-text="无"
                      />
                    </p>
                  </div>
                </div>
              </div>
              <div v-if="scoringNoteLines(enemy).length" class="enemy-scoring-note">
                <p class="enemy-scoring-note-title">得分机制</p>
                <ul class="enemy-scoring-note-lines">
                  <li v-for="(line, lineIndex) in scoringNoteLines(enemy)" :key="lineIndex">
                    <BuffRichText :text="line" />
                  </li>
                </ul>
              </div>
              <div
                v-if="enemy.fieldBuff?.name || enemy.fieldBuff?.text || enemy.fieldBuff?.effectBlocks?.length"
                class="enemy-field-buff"
                :class="hasFieldBuffNotes(enemy) ? '' : CAPTURE_HIDE_CLASS"
              >
                <p class="enemy-field-buff-title">{{ fieldBuffTitle(enemy) }}</p>
                <ul
                  v-if="fieldBuffLines(enemy).length"
                  class="enemy-field-buff-lines"
                  :class="CAPTURE_HIDE_CLASS"
                >
                  <li v-for="(line, lineIndex) in fieldBuffLines(enemy)" :key="lineIndex">
                    <BuffRichText :text="line" />
                  </li>
                </ul>
                <div
                  v-if="fieldBuffLines(enemy).length && blocksForHistoryDisplay(enemy.fieldBuff?.effectBlocks, enemy.fieldBuff?.text ?? '')?.length"
                  class="enemy-field-buff-divider"
                  :class="CAPTURE_HIDE_CLASS"
                  aria-hidden="true"
                />
                <BuffEffectBlocksDisplay
                  v-if="blocksForHistoryDisplay(enemy.fieldBuff?.effectBlocks, enemy.fieldBuff?.text ?? '')?.length"
                  compact
                  notes-only
                  :blocks="blocksForHistoryDisplay(enemy.fieldBuff?.effectBlocks, enemy.fieldBuff?.text ?? '')"
                  :title="enemy.fieldBuff?.name || '场地 Buff'"
                  empty-text="暂无场地 Buff 效果块"
                />
                <p
                  v-else-if="!fieldBuffLines(enemy).length && enemy.fieldBuff?.text"
                  class="enemy-field-buff-meta"
                  :class="CAPTURE_HIDE_CLASS"
                >
                  <BuffRichText :text="enemy.fieldBuff.text" />
                </p>
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>

    <div
      v-if="currentPhase && !loading && !embedded"
      class="nav-zone nav-zone--right"
      :class="{ 'nav-zone--disabled': currentIndex === phases.length - 1 }"
      role="button"
      aria-label="下一期"
      tabindex="0"
      @click="onNavZoneClick('next')"
      @keydown.enter="onNavZoneClick('next')"
      @keydown.space.prevent="onNavZoneClick('next')"
    />

    <MonsterDetailModal
      v-if="mode === 'crisis-assault'"
      :open="monsterDetailOpen"
      :enemy="monsterDetailEnemy"
      :mode="mode"
      :phase-label="monsterDetailPhaseLabel"
      :version="monsterDetailPhaseVersion"
      :boss-existed-by-multiplier-version="monsterDetailBossExistedByMultiplierVersion"
      :previous-field-buff="monsterDetailPreviousFieldBuff"
      :current-field-buff="monsterDetailCurrentFieldBuff"
      :trait-transition="monsterDetailTraitTransition"
      :hp-comparison="monsterDetailHpComparison"
      :hp-coeff-comparison="monsterDetailHpCoeffComparison"
      @close="closeMonsterDetail"
    />
  </div>
</template>

<style scoped>
.history-panel-wrapper {
  display: flex;
  align-items: stretch;
  width: 100%;
  min-height: 100%;
  height: auto;
  overflow: visible;
}

.history-panel-wrapper::-webkit-scrollbar {
  display: none;
}

.history-panel {
  flex: 1;
  min-width: 0;
  max-width: min(1440px, 100%);
  margin: 0 auto;
  padding: clamp(0.75rem, 1.5vh, 1.5rem) 0.75rem clamp(1.25rem, 2.5vh, 2rem);
  box-sizing: border-box;
}

.history-panel-wrapper--embedded {
  flex: none;
  height: auto;
  min-height: 100%;
  overflow: visible;
}

.history-panel--embedded {
  display: flex;
  flex-direction: column;
  height: auto;
  min-height: 100%;
  max-width: none;
  padding: 0.65rem 1.25rem 0.85rem;
  overflow: visible;
}

.history-panel--embedded .panel-header {
  flex-shrink: 0;
  margin-bottom: 0.65rem;
  gap: 0.65rem;
}

.history-panel--embedded .header-info-row {
  max-width: none;
  gap: 0.75rem;
}

.history-panel--embedded .phase-btn {
  min-height: 76px;
  min-width: 240px;
  padding: 0.6rem 1rem;
}

.history-panel--embedded .hp-summary {
  min-height: 76px;
  max-width: 340px;
  padding: 0.6rem 1rem;
}

.content-grid--embedded {
  flex: none;
  min-height: 0;
  overflow: visible;
  display: grid;
  grid-template-rows: auto auto;
  gap: 0.6rem;
}

.content-grid--embedded .buff-row {
  min-height: 0;
  overflow: visible;
  gap: 0.65rem;
}

.content-grid--embedded .buff-card {
  min-height: 0;
  overflow: visible;
  padding: 0.55rem 0.65rem;
}

.content-grid--embedded .buff-image,
.content-grid--embedded .buff-icon {
  width: 32px;
  height: 32px;
  margin: 0;
}

.content-grid--embedded .buff-name {
  font-size: 0.86rem;
  margin: 0;
}

.content-grid--embedded .buff-lines {
  font-size: clamp(0.62rem, 1.05vh, 0.72rem);
  line-height: 1.42;
  overflow: visible;
}

.content-grid--embedded .enemy-row--normal {
  min-height: 0;
  overflow: visible;
  align-items: stretch;
  gap: 0.75rem;
}

.content-grid--embedded .enemy-row--hard {
  margin-top: 0.75rem;
}

.content-grid--embedded .enemy-card {
  height: auto;
  min-height: 0;
  overflow: visible;
  padding: 0.55rem 0.75rem 0.65rem;
}

.content-grid--embedded .enemy-label {
  margin-bottom: 0.25rem;
  font-size: clamp(0.82rem, 1.4vh, 0.95rem);
}

.content-grid--embedded .enemy-body {
  flex: none;
  min-height: 0;
  align-items: center;
  gap: 0.55rem;
}

.content-grid--embedded .enemy-image {
  width: auto;
  height: auto;
  max-height: min(320px, 42vh);
  max-width: min(220px, 44%);
  aspect-ratio: 3 / 4;
}

.content-grid--embedded .enemy-name {
  font-size: clamp(0.82rem, 1.45vh, 0.98rem);
  padding: 0.28rem 0.65rem;
}

.content-grid--embedded .enemy-hp-prefix,
.content-grid--embedded .enemy-hp-number {
  font-size: clamp(0.88rem, 1.5vh, 1rem);
}

.content-grid--embedded .enemy-hp-row--meta .enemy-hp-prefix,
.content-grid--embedded .enemy-hp-row--meta .enemy-hp-number {
  font-size: clamp(0.72rem, 1.2vh, 0.84rem);
  font-weight: 600;
  color: var(--color-heading);
  opacity: 0.88;
}

.content-grid--embedded .enemy-hp-row--converted .enemy-hp-prefix,
.content-grid--embedded .enemy-hp-row--converted .enemy-hp-number {
  color: #4c8fe8;
  opacity: 1;
}

.content-grid--embedded .enemy-hp-delta,
.content-grid--embedded .enemy-hp-expansion {
  font-size: clamp(0.68rem, 1.15vh, 0.78rem);
}

.content-grid--embedded .enemy-defense,
.content-grid--embedded .enemy-weakness,
.content-grid--embedded .enemy-stagger-time,
.content-grid--embedded .enemy-stagger-multiplier,
.content-grid--embedded .enemy-resistance {
  font-size: clamp(0.72rem, 1.2vh, 0.84rem);
  line-height: 1.35;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.content-grid--embedded .enemy-field-buff-title,
.content-grid--embedded .enemy-field-buff-lines,
.content-grid--embedded .enemy-field-buff-meta {
  font-size: clamp(0.68rem, 1.15vh, 0.78rem);
}

.content-grid--embedded .enemy-info {
  gap: 0.28rem;
  overflow: visible;
}

.nav-zone {
  flex: 1;
  min-width: 56px;
  max-width: 140px;
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

.nav-zone:focus-visible {
  outline: 2px solid var(--color-border);
  outline-offset: -2px;
}

.panel-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.85rem;
  margin-bottom: 1.25rem;
  position: relative;
}

.page-title {
  font-size: clamp(1.35rem, 3vw, 1.75rem);
  font-weight: 700;
  color: var(--color-heading);
  letter-spacing: 0.04em;
}

.phase-selector {
  display: flex;
  align-items: stretch;
  justify-content: center;
  flex: 1;
  min-width: 0;
}

.header-info-row {
  display: flex;
  align-items: stretch;
  justify-content: center;
  gap: 1rem;
  width: 100%;
  max-width: 1100px;
  flex-wrap: wrap;
}

.phase-btn {
  width: 100%;
  min-width: 240px;
  min-height: 88px;
  padding: 0.75rem 1.15rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  transition: background-color 0.2s;
}

.phase-btn:hover {
  background: var(--color-background-mute);
}

.phase-version {
  font-weight: 700;
  font-size: clamp(0.92rem, 1.8vw, 1.08rem);
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
  font-size: clamp(0.72rem, 1.35vw, 0.82rem);
  opacity: 0.72;
}

.hp-summary {
  flex: 1;
  min-width: 0;
  min-height: 88px;
  max-width: 320px;
  padding: 0.75rem 1.15rem;
  border-radius: 12px;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.hp-summary--hard {
  border-color: color-mix(in srgb, #c084fc 45%, var(--color-border));
}

.hp-summary--hard .hp-label {
  color: #c084fc;
}

.hp-label {
  font-size: clamp(0.78rem, 1.5vw, 0.88rem);
  color: #e85d4c;
  font-weight: 700;
}

.hp-metrics {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  margin-top: 0.25rem;
  width: fit-content;
}

.hp-metric-row {
  display: flex;
  align-items: baseline;
  gap: 0.3rem;
}

.hp-number {
  font-size: clamp(0.88rem, 1.8vw, 1.05rem);
  color: var(--color-heading);
  font-weight: 600;
}

.hp-delta {
  font-size: clamp(0.66rem, 1.2vw, 0.74rem);
  color: #e85d4c;
  font-weight: 600;
  line-height: 1.4;
}

.hp-expansion {
  font-size: clamp(0.7rem, 1.3vw, 0.8rem);
  color: #4d9fff;
  font-weight: 600;
}

.hp-tag {
  flex-shrink: 0;
  min-width: 1.45rem;
  color: #e85d4c;
  font-weight: 600;
  font-size: clamp(0.88rem, 1.8vw, 1.02rem);
}

.hp-tag--ghost {
  visibility: hidden;
}

.hp-tag--converted {
  color: #4c8fe8;
}

.hp-tag--hard {
  color: #c084fc;
  font-size: clamp(0.72rem, 1.4vw, 0.82rem);
  min-width: 2.6rem;
}

.hp-tag--fs {
  color: #e8a838;
  font-size: clamp(0.72rem, 1.4vw, 0.82rem);
  min-width: 1.6rem;
}

.hp-tag--star {
  font-size: clamp(0.62rem, 1.2vw, 0.72rem);
  min-width: 2.4rem;
  font-weight: 700;
}

.hp-metric-row--score {
  margin-top: 0.12rem;
}

.hp-score-hint {
  font-size: clamp(0.62rem, 1.15vw, 0.7rem);
  opacity: 0.68;
  color: var(--color-text);
}

.status-text {
  font-size: 0.9rem;
  opacity: 0.75;
}

.status-text.error {
  color: #e85d4c;
  opacity: 1;
}

.content-grid {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.buff-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
  align-items: stretch;
}

.enemy-row--normal {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  width: 100%;
  margin-inline: auto;
  gap: 0.85rem;
  align-items: stretch;
  justify-content: center;
}

.enemy-row--hard {
  display: flex;
  justify-content: center;
  margin-top: 0.85rem;
  width: 100%;
}

.enemy-card--hard {
  width: 100%;
  max-width: 80%;
  min-width: 0;
  margin-inline: auto;
  border-width: 2px;
  border-style: solid;
  border-color: color-mix(in srgb, #e8a838 88%, #c47a10);
  box-shadow: 0 0 0 1px color-mix(in srgb, #e8a838 38%, transparent);
  background: color-mix(in srgb, #e8a838 5%, var(--color-background-soft));
}

[data-theme='dark'] .enemy-card--hard {
  border-width: 1.5px;
  border-color: color-mix(in srgb, #e8a838 48%, var(--color-border));
  box-shadow:
    0 0 0 1px color-mix(in srgb, #e8a838 14%, transparent),
    inset 0 1px 0 color-mix(in srgb, #e8a838 8%, transparent);
  background: color-mix(in srgb, #e8a838 6%, var(--color-background-soft));
}

.enemy-card--hard.enemy-card--empty {
  border-style: dashed;
}

/* 绝境 Boss 图（无场地 Buff 的单行布局）：3:4，约 200–280px 高 */
.enemy-card--hard .enemy-image {
  width: clamp(150px, 32%, 210px);
}

/* 绝境：图片 22% / 数据 28% / 场地 Buff 50% 同一行 */
.enemy-card--hard .enemy-main--with-field-buff {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.85rem;
  align-items: start;
}

.enemy-card--hard .enemy-main--with-field-buff .enemy-body {
  display: grid;
  /* 左半 50% 内再按 22:28 分，换算到整行即图片 22% / 数据 28% */
  grid-template-columns: minmax(0, 11fr) minmax(0, 14fr);
  gap: 0.85rem;
  align-items: start;
}

.enemy-card--hard .enemy-main--with-field-buff .enemy-image {
  width: 100%;
  max-width: none;
}

.enemy-card--hard .enemy-main--with-field-buff .enemy-field-buff {
  margin-top: 0;
  align-self: start;
}

.enemy-main {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  min-width: 0;
}

.buff-card {
  height: 100%;
  padding: 0.75rem 0.7rem;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.buff-card-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
}

.buff-icon {
  flex-shrink: 0;
  font-size: 1.05rem;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.buff-image {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  margin: 0;
}

.buff-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.buff-name {
  margin: 0;
  font-size: 0.84rem;
  font-weight: 700;
  color: var(--color-heading);
  text-align: left;
  line-height: 1.3;
  min-width: 0;
  flex: 1;
}

.buff-lines {
  list-style: disc;
  margin: 0;
  padding-left: 1rem;
  font-size: 0.7rem;
  line-height: 1.5;
  color: var(--color-text);
  flex: 1;
}

.enemy-card {
  display: flex;
  flex-direction: column;
  container-type: inline-size;
  container-name: enemy-card;
  padding: 0.75rem 0.85rem 0.9rem;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
}

.enemy-label {
  flex-shrink: 0;
  margin: 0 0 0.25rem;
  text-align: center;
  font-size: clamp(0.8rem, 1.5vw, 0.92rem);
  font-weight: 700;
  color: #e8a838;
}

.enemy-body {
  display: flex;
  align-items: flex-start;
  gap: clamp(0.75rem, 2vw, 1.15rem);
}

.enemy-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 0.45rem;
  text-align: left;
  padding-top: 0.15rem;
}

.enemy-name {
  margin: 0;
  padding: 0.28rem 0.7rem;
  max-width: 100%;
  font-size: clamp(0.82rem, 1.55vw, 0.95rem);
  font-weight: 700;
  line-height: 1.35;
  letter-spacing: 0.03em;
  color: #f0c060;
  text-shadow: 0 0 12px rgba(232, 168, 56, 0.35);
  border: 1px solid rgba(232, 168, 56, 0.45);
  border-radius: 999px;
  background: linear-gradient(
    180deg,
    rgba(232, 168, 56, 0.16) 0%,
    rgba(232, 168, 56, 0.05) 100%
  );
}

[data-theme='dark'] .enemy-name {
  color: #ffd98a;
  text-shadow: 0 0 14px rgba(255, 217, 138, 0.28);
  background: linear-gradient(
    180deg,
    rgba(255, 217, 138, 0.12) 0%,
    rgba(255, 217, 138, 0.03) 100%
  );
}

.enemy-stats {
  margin: 0;
  font-size: 0.74rem;
  opacity: 0.75;
}

.enemy-image {
  flex-shrink: 0;
  width: clamp(120px, 38%, 260px);
  aspect-ratio: 3 / 4;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-background-mute);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.enemy-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-placeholder {
  font-size: 0.85rem;
  opacity: 0.45;
  padding: 0.5rem;
  text-align: center;
}

.enemy-hp-block {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.enemy-hp-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.1rem 0.25rem;
  margin: 0;
  width: 100%;
  min-width: 0;
}

.enemy-hp-prefix {
  flex-shrink: 0;
  min-width: 0;
  font-size: clamp(0.84rem, 1.6vw, 0.95rem);
  font-weight: 700;
  color: #e85d4c;
}

.enemy-hp-prefix--ghost {
  visibility: hidden;
}

.enemy-hp-row--meta .enemy-hp-prefix,
.enemy-hp-row--meta .enemy-hp-number {
  font-size: clamp(0.74rem, 1.35vw, 0.84rem);
  font-weight: 600;
  color: var(--color-heading);
  opacity: 0.88;
  min-width: 0;
}

.enemy-hp-row--converted .enemy-hp-prefix,
.enemy-hp-row--converted .enemy-hp-number {
  color: #4c8fe8;
  opacity: 1;
}

.enemy-hp-number {
  font-size: clamp(0.84rem, 1.6vw, 0.95rem);
  font-weight: 700;
  color: #e85d4c;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-all;
}

.enemy-hp-delta {
  font-size: clamp(0.66rem, 1.2vw, 0.74rem);
  font-weight: 600;
  color: #e85d4c;
  line-height: 1.4;
  min-width: 0;
  overflow-wrap: anywhere;
}

.enemy-hp-expansion {
  margin-left: 0;
  font-size: clamp(0.7rem, 1.3vw, 0.8rem);
  font-weight: 600;
  color: #4d9fff;
  white-space: normal;
  overflow-wrap: anywhere;
}

.enemy-traits {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  width: 100%;
  min-width: 0;
}

.enemy-defense,
.enemy-weakness,
.enemy-stagger-time,
.enemy-stagger-multiplier,
.enemy-resistance {
  margin: 0;
  font-size: clamp(0.74rem, 1.35vw, 0.84rem);
  color: var(--color-heading);
  opacity: 0.88;
  line-height: 1.4;
  overflow-wrap: anywhere;
  word-break: break-word;
}

/* 危局多套弱点/抗性：卡片上标注当期绑定的套名 */
.enemy-trait-set-title {
  margin: 0 0 0.1rem;
  font-size: clamp(0.66rem, 1.2vw, 0.74rem);
  font-weight: 650;
  color: var(--color-heading);
  opacity: 0.75;
}

.enemy-field-buff {
  margin-top: 0.55rem;
  padding: 0.45rem 0.55rem 0.5rem 0.65rem;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
  border-left: 3px solid color-mix(in srgb, #e8a838 75%, transparent);
  background: color-mix(in srgb, var(--color-background) 55%, transparent);
}

.enemy-scoring-note {
  margin-top: 0.55rem;
  padding: 0.45rem 0.55rem 0.5rem 0.65rem;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
  border-left: 3px solid color-mix(in srgb, #5f8fd8 75%, transparent);
  background: color-mix(in srgb, var(--color-background) 45%, transparent);
}

.enemy-scoring-note-title {
  margin: 0 0 0.2rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: color-mix(in srgb, #5f8fd8 80%, var(--color-text));
}

.enemy-scoring-note-lines {
  margin: 0;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.72rem;
  line-height: 1.45;
  color: var(--color-text-muted, #9aa3b0);
}

.content-grid--embedded .enemy-scoring-note-title,
.content-grid--embedded .enemy-scoring-note-lines {
  font-size: clamp(0.68rem, 1.15vh, 0.78rem);
}

.enemy-field-buff-title {
  margin: 0 0 0.25rem;
  font-size: clamp(0.72rem, 1.3vw, 0.8rem);
  font-weight: 650;
  color: var(--color-heading);
}

.enemy-field-buff-lines {
  margin: 0;
  padding-left: 1rem;
  font-size: clamp(0.7rem, 1.25vw, 0.78rem);
  line-height: 1.4;
  opacity: 0.88;
}

.enemy-field-buff-meta {
  margin: 0;
  font-size: clamp(0.7rem, 1.25vw, 0.78rem);
  opacity: 0.7;
}

.enemy-field-buff-divider {
  margin: 0.4rem 0;
  border-top: 1px solid color-mix(in srgb, var(--color-border) 90%, transparent);
}

.enemy-field-buff :deep(.effect-blocks-display) {
  margin-top: 0;
}

@container enemy-card (max-width: 520px) {
  .enemy-body {
    flex-direction: column;
    align-items: center;
  }

  .enemy-image {
    width: min(200px, 72%);
    max-width: 220px;
  }

  .enemy-card--hard .enemy-image {
    width: min(180px, 60%);
  }

  .enemy-card--hard .enemy-main--with-field-buff {
    grid-template-columns: minmax(0, 1fr);
  }

  .enemy-card--hard .enemy-main--with-field-buff .enemy-body {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .enemy-card--hard .enemy-main--with-field-buff .enemy-image {
    width: min(180px, 60%);
  }

  .enemy-info {
    width: 100%;
    align-items: center;
    text-align: center;
  }

  .enemy-name {
    margin-inline: auto;
  }

  .enemy-hp-row {
    justify-content: center;
  }
}

@media (max-width: 1100px) {
  .enemy-row--normal {
    grid-template-columns: 1fr;
    width: 100%;
  }

  .enemy-card--hard {
    max-width: 100%;
  }

  .enemy-image {
    width: clamp(140px, 42vw, 220px);
  }
}

@media (max-height: 820px) {
  .history-panel {
    padding-top: 0.65rem;
    padding-bottom: 1rem;
  }

  .enemy-image {
    width: clamp(100px, 28%, 180px);
  }
}

.mobile-phase-stepper {
  display: none;
}

@media (max-width: 768px) {
  .history-panel-wrapper {
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

  .page-title {
    font-size: 1.2rem;
  }

  .panel-header {
    gap: 0.65rem;
    margin-bottom: 0.85rem;
  }

  .buff-row,
  .enemy-row--normal {
    grid-template-columns: 1fr;
    width: 100%;
    gap: 0.65rem;
  }

  .enemy-row--hard {
    margin-top: 0.65rem;
  }

  .enemy-body {
    flex-direction: column;
    align-items: center;
  }

  .enemy-info {
    width: 100%;
    align-items: center;
    text-align: center;
  }

  .enemy-image {
    width: min(200px, 58vw);
  }

  .enemy-name {
    margin-inline: auto;
  }

  .phase-btn {
    min-width: 0;
    min-height: 72px;
    padding: 0.65rem 0.85rem;
  }

  .header-info-row {
    flex-direction: column;
    align-items: stretch;
    max-width: 100%;
    gap: 0.55rem;
  }

  .hp-summary {
    width: 100%;
    max-width: 100%;
    min-height: 72px;
  }

  .buff-lines {
    font-size: 0.68rem;
  }

  /* 图表点开的嵌入详细：允许竖向滚动，避免被裁切 */
  .history-panel-wrapper--embedded {
    height: auto;
    overflow: visible;
  }

  .history-panel--embedded {
    height: auto;
    overflow: visible;
    padding: 0.45rem 0.55rem 0.85rem;
  }

  .history-panel--embedded .panel-header {
    margin-bottom: 0.55rem;
    gap: 0.5rem;
  }

  .history-panel--embedded .header-info-row {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }

  .history-panel--embedded .phase-btn {
    min-width: 0;
    width: 100%;
    min-height: 64px;
  }

  .history-panel--embedded .hp-summary {
    max-width: 100%;
    width: 100%;
    min-height: 64px;
  }

  .content-grid--embedded {
    display: flex;
    flex-direction: column;
    height: auto;
    overflow: visible;
    gap: 0.75rem;
  }

  .content-grid--embedded .buff-row,
  .content-grid--embedded .enemy-row--normal {
    grid-template-columns: 1fr;
    width: 100%;
    overflow: visible;
  }

  .content-grid--embedded .buff-card,
  .content-grid--embedded .enemy-card {
    height: auto;
    overflow: visible;
  }

  .content-grid--embedded .buff-lines {
    overflow: visible;
    font-size: 0.68rem;
  }

  .content-grid--embedded .enemy-body {
    flex-direction: column;
    align-items: center;
  }

  .content-grid--embedded .enemy-info {
    width: 100%;
    align-items: center;
    text-align: center;
    overflow: visible;
  }

  .content-grid--embedded .enemy-image {
    width: min(180px, 52vw);
    max-width: min(180px, 52vw);
    height: auto;
  }
}

.buff-card--admin {
  position: relative;
}

.buff-card--empty {
  border-style: dashed;
  opacity: 0.92;
}

.enemy-card--admin {
  position: relative;
}

.enemy-card--empty {
  border-style: dashed;
  opacity: 0.92;
}

.enemy-card--clickable {
  cursor: pointer;
}

.enemy-card--clickable:focus-visible {
  outline: 2px solid var(--color-border);
  outline-offset: 2px;
}

.enemy-admin-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.45rem;
}

.enemy-admin-btn {
  border: 1px solid #3a424f;
  border-radius: 6px;
  background: rgba(15, 18, 23, 0.85);
  color: #d5dae4;
  padding: 0.2rem 0.55rem;
  font-size: 0.72rem;
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
</style>
