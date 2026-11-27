<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import IkModalShell from '@/components/common/IkModalShell.vue'
import DualLineChartView from '@/components/history/DualLineChartView.vue'
import RoomBuffTransitionPanel from '@/components/history/RoomBuffTransitionPanel.vue'
import TraitTransitionPanel from '@/components/history/TraitTransitionPanel.vue'
import MonsterDetailStats, {
  type MonsterDetailRecord,
} from '@/components/history/MonsterDetailStats.vue'
import { fetchBossChart, type CrisisBossRoomType, type CrisisHpChartMode, type HpChartPoint } from '@/api/crisisAssault'
import type { EnemySlot, ModeKey } from '@/types/history'
import { formatHpDelta } from '@/utils/gameData'
import {
  isFieldBuffChanged,
  type BossHpCoeffComparison,
  type BossHpComparison,
  type MonsterFieldBuffSnapshot,
} from '@/utils/historyMonsterDetail'
import { createRequestEpoch } from '@/utils/requestEpoch'

const props = defineProps<{
  open: boolean
  enemy: EnemySlot | null
  /** 目前仅危局模式接入了图表数据源 */
  mode: ModeKey
  /** 如「3.2 第4期 · 房间 2」 */
  phaseLabel: string
  /** 当前期数的游戏版本（如 3.2），由父组件从 phases 取；判「2.1 起异常条 ×1.1」用 */
  version?: string | null
  /**
   * 该 Boss 是否在 2.1（含）之前就已存在（首次出现不晚于 2.1，含 2.1 才出的新 Boss），
   * 由父组件按其出现历史计算；与 `version ≥ 2.1` 同时成立才乘版本系数，缺省按 false
   */
  bossExistedByMultiplierVersion?: boolean
  /** 原场地 Buff（较早一期），由父组件从 phases 解析 */
  previousFieldBuff?: MonsterFieldBuffSnapshot | null
  /** 现场地 Buff（当期），由父组件从 phases 解析 */
  currentFieldBuff?: MonsterFieldBuffSnapshot | null
  /** 弱点/抗性转变（原 / 现两侧），无变化时为 null */
  traitTransition?: {
    previous: {
      phaseLabel: string
      weakness?: string
      resistance?: string
      resistanceHigh?: string
    }
    current: {
      phaseLabel: string
      weakness?: string
      resistance?: string
      resistanceHigh?: string
    }
  } | null
  /** 血量与往期对比，由父组件用与怪物卡片相同的口径计算；无往期出现时为 null */
  hpComparison?: BossHpComparison | null
  /** 危局血量系数与往期对比；无往期出现时为 null */
  hpCoeffComparison?: BossHpCoeffComparison | null
}>()

const emit = defineEmits<{
  close: []
}>()

const points = ref<HpChartPoint[]>([])
const chartLoadEpoch = createRequestEpoch()
const chartLoading = ref(false)
const chartError = ref('')
const hpMode = ref<CrisisHpChartMode>('normal')

const chartRoomType = computed<CrisisBossRoomType>(() => (props.enemy?.isHardRoom ? 'hard' : 'normal'))

/** 得分机制（纯文本，与怪物绑定）：按行拆分；空值时不渲染 */
const scoringNoteLines = computed(() =>
  (props.enemy?.scoringNote ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean),
)

/** 详情数据块按共享数据行形状组装（与怪物数据库、后续防卫战详情同构） */
const detailRecord = computed<MonsterDetailRecord | null>(() => {
  const enemy = props.enemy
  if (!enemy) return null
  return {
    boss_name: enemy.bossName ?? null,
    hp: enemy.hp || null,
    hp_expansion: props.hpComparison?.expansion ?? null,
    hp_delta_label: props.hpComparison ? formatHpDelta(props.hpComparison.diff) : null,
    crisis_base_hp: enemy.crisisBaseHp ?? null,
    hp_coeff_label: enemy.hpCoeffLabel ?? null,
    hp_coeff_delta_label: props.hpCoeffComparison?.deltaLabel ?? null,
    defense: enemy.defense ?? null,
    stagger_time: enemy.staggerTime ?? null,
    stagger_multiplier: enemy.staggerMultiplier ?? null,
    weakness: enemy.weakness ?? null,
    resistance: enemy.resistance ?? null,
    resistance_high: enemy.resistanceHigh ?? null,
    // 危局怪按首领敌人取基础异常条；系数由 phases API 随 boss 下发（内置默认表后端已解析），缺失按 1
    monster_category: 'boss',
    anomaly_bar_coefficient: enemy.anomalyBarCoefficient ?? null,
    version: props.version ?? null,
    boss_existed_by_multiplier_version: props.bossExistedByMultiplierVersion === true,
  }
})

const showRoomBuffTransition = computed(() =>
  isFieldBuffChanged(props.previousFieldBuff?.fieldBuff ?? null, props.currentFieldBuff?.fieldBuff ?? null),
)

async function loadBossChartPoints() {
  const bossName = props.enemy?.bossName
  if (!bossName || props.mode !== 'crisis-assault') {
    points.value = []
    chartError.value = ''
    chartLoading.value = false
    return
  }

  const token = chartLoadEpoch.next()
  chartLoading.value = true
  chartError.value = ''
  try {
    const data = await fetchBossChart(bossName, chartRoomType.value)
    if (!chartLoadEpoch.isCurrent(token)) return
    points.value = data
  } catch (error) {
    if (!chartLoadEpoch.isCurrent(token)) return
    chartError.value = error instanceof Error ? error.message : '加载折线图失败'
    points.value = []
  } finally {
    if (!chartLoadEpoch.isCurrent(token)) return
    chartLoading.value = false
  }
}

watch(
  () => [props.open, props.enemy?.bossName, props.enemy?.isHardRoom] as const,
  ([open]) => {
    if (!open) return
    hpMode.value = props.enemy?.isHardRoom ? 'hard' : 'normal'
    void loadBossChartPoints()
  },
  { immediate: true },
)
</script>

<template>
  <IkModalShell :open="open" size="wide" @close="emit('close')">
    <template #header>
      <div class="monster-detail-header">
        <h2 class="monster-detail-title">怪物详情</h2>
        <span v-if="phaseLabel" class="monster-detail-phase">{{ phaseLabel }}</span>
      </div>
    </template>

    <div v-if="enemy" class="monster-detail-body">
      <MonsterDetailStats
        :record="detailRecord"
        :image-url="enemy.imageUrl"
        :image-alt="enemy.bossName || enemy.label"
        :show-resistance-table="true"
      />

      <section v-if="scoringNoteLines.length" class="monster-detail-scoring">
        <p class="monster-detail-scoring-title">得分机制</p>
        <ul class="monster-detail-scoring-lines">
          <li v-for="(line, lineIndex) in scoringNoteLines" :key="lineIndex">{{ line }}</li>
        </ul>
      </section>

      <TraitTransitionPanel
        v-if="traitTransition"
        class="monster-detail-buff-transition"
        :previous="traitTransition.previous"
        :current="traitTransition.current"
      />

      <RoomBuffTransitionPanel
        v-if="showRoomBuffTransition"
        class="monster-detail-buff-transition"
        :previous-field-buff="previousFieldBuff ?? null"
        :current-field-buff="currentFieldBuff ?? null"
      />

      <section v-if="enemy.bossName" class="monster-detail-chart">
        <p v-if="chartLoading" class="status-text">图表加载中...</p>
        <p v-else-if="chartError" class="status-text error">{{ chartError }}</p>
        <p v-else-if="!points.length" class="status-text">该怪物暂无历史数据</p>
        <DualLineChartView
          v-else
          class="monster-detail-chart-view"
          v-model:hp-mode="hpMode"
          :points="points"
          :hp-chart-title="`${enemy.bossName} 血量折线图`"
          :expansion-chart-title="`${enemy.bossName} 血量相对膨胀折线图`"
          :hp-aria-label="`${enemy.bossName} 血量折线图`"
          :expansion-aria-label="`${enemy.bossName} 血量相对膨胀折线图`"
          :enable-point-click="false"
          :enable-boss-preview="false"
          :enable-room-buff-preview="false"
          :enable-hp-converted953-toggle="true"
          :enable-hp-coeff-charts="true"
          :page-scroll="true"
        />
      </section>
    </div>
  </IkModalShell>
</template>

<style scoped>
.monster-detail-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
  flex: 1;
}

.monster-detail-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
  color: #fff;
  letter-spacing: 0.04em;
}

.monster-detail-phase {
  min-width: 0;
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.72);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.monster-detail-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1rem 1.15rem 1.25rem;
  background: var(--color-background-soft);
}

.status-text {
  min-height: 4rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  opacity: 0.75;
}

.status-text.error {
  color: #e85d4c;
  opacity: 1;
}

/* `page-scroll` 形态下图表高度以窗口为基准、容器高度交给内容，不能被 flex 压缩 */
.monster-detail-scoring {
  margin: 0.35rem 0 0;
  padding: 0.5rem 0.6rem 0.55rem 0.7rem;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
  border-left: 3px solid color-mix(in srgb, #5f8fd8 75%, transparent);
  background: color-mix(in srgb, var(--color-background) 45%, transparent);
}

.monster-detail-scoring-title {
  margin: 0 0 0.2rem;
  font-size: 0.78rem;
  font-weight: 700;
  color: color-mix(in srgb, #5f8fd8 80%, var(--color-text));
}

.monster-detail-scoring-lines {
  margin: 0;
  padding-left: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.78rem;
  line-height: 1.45;
}

.monster-detail-chart-view {
  flex: none;
  min-height: auto;
  overflow: visible;
  display: flex;
}
</style>
