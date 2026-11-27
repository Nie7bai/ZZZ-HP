<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import IkModalShell from '@/components/common/IkModalShell.vue'
import DualLineChartView from '@/components/history/DualLineChartView.vue'
import RoomBuffTransitionPanel from '@/components/history/RoomBuffTransitionPanel.vue'
import TraitTransitionPanel from '@/components/history/TraitTransitionPanel.vue'
import BuffEffectBlocksDisplay from '@/components/calculator/BuffEffectBlocksDisplay.vue'
import BuffRichText from '@/components/calculator/BuffRichText.vue'
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
  /** 现场地 Buff 的逐行文本（由父组件按卡片同一口径拆好传入，避免对象引用差异） */
  currentFieldBuffLines?: string[] | null
  /** 现场地 Buff 的效果块注释（正文常放在 block note 里；与卡片同口径过滤） */
  currentFieldBuffBlocks?: import('@/types/calculator').BuffEffectBlock[] | null
  /** 上一期的得分机制（同 Boss + 房间）；无历史或内容相同由父组件判空 */
  previousScoringNote?: { note: string; phaseLabel: string } | null
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

/** 行首的项目符号（用户录入时常自带「· 」），展示时去掉，避免与列表样式重复 */
const NOTE_BULLETS = ['·', '•', '●', '▪', '◦']
function stripLeadingBullet(text: string): string {
  let out = text.trim()
  let changed = true
  while (changed) {
    changed = false
    for (const bullet of NOTE_BULLETS) {
      if (out.startsWith(bullet)) {
        out = out.slice(bullet.length).trimStart()
        changed = true
      }
    }
  }
  return out
}

/** 得分机制变化：上期与本期都有内容且不同 */
const splitLines = (text: string) =>
  text
    .split(String.fromCharCode(10))
    .map((line) => stripLeadingBullet(line.replace(String.fromCharCode(13), '')))
    .filter(Boolean)

const scoringNoteChange = computed(() => {
  const previous = props.previousScoringNote?.note?.trim() ?? ''
  const current = (props.enemy?.scoringNote ?? '').trim()
  if (!previous || !current || previous === current) return null
  return {
    previous,
    current,
    previousLines: splitLines(previous),
    currentLines: splitLines(current),
    previousLabel: props.previousScoringNote?.phaseLabel ?? '',
  }
})

/** 场地 Buff（当期）按行拆分：没构成转变时也在详情里平铺展示 */
const currentFieldBuffLines = computed(() => {
  // 父组件按卡片同一口径拆好行；缺省时再回落 enemy / currentFieldBuff 的正文
  const provided = (props.currentFieldBuffLines ?? []).filter((line) => String(line).trim())
  if (provided.length) return provided
  const text =
    props.enemy?.fieldBuff?.text?.trim() ?? props.currentFieldBuff?.fieldBuff?.text?.trim()
  return text ? splitLines(text) : []
})

/** 得分机制（纯文本，与怪物绑定）：按行拆分；空值时不渲染 */
const scoringNoteLines = computed(() => splitLines(props.enemy?.scoringNote ?? ''))

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
          <li v-for="(line, lineIndex) in scoringNoteLines" :key="lineIndex">
            <BuffRichText :text="line" />
          </li>
        </ul>
      </section>

      <TraitTransitionPanel
        v-if="traitTransition"
        class="monster-detail-buff-transition"
        :previous="traitTransition.previous"
        :current="traitTransition.current"
      />

      <div v-if="scoringNoteChange" class="note-transition">
        <p class="note-transition-title">得分机制变化</p>
        <div class="note-transition-columns">
          <div class="note-transition-column">
            <p class="note-transition-label">
              原<span v-if="scoringNoteChange.previousLabel" class="note-transition-phase">{{ scoringNoteChange.previousLabel }}</span>
            </p>
            <ul class="note-transition-lines">
              <li v-for="(line, lineIndex) in scoringNoteChange.previousLines" :key="`prev-${lineIndex}`">
                <BuffRichText :text="line" />
              </li>
            </ul>
          </div>
          <div class="note-transition-column">
            <p class="note-transition-label">
              现<span v-if="phaseLabel" class="note-transition-phase">{{ phaseLabel }}</span>
            </p>
            <ul class="note-transition-lines">
              <li v-for="(line, lineIndex) in scoringNoteChange.currentLines" :key="`cur-${lineIndex}`">
                <BuffRichText :text="line" />
              </li>
            </ul>
          </div>
        </div>
      </div>

      <RoomBuffTransitionPanel
        v-if="showRoomBuffTransition"
        class="monster-detail-buff-transition"
        :previous-field-buff="previousFieldBuff ?? null"
        :current-field-buff="currentFieldBuff ?? null"
      />

      <section
        v-if="!showRoomBuffTransition && (currentFieldBuffLines.length || currentFieldBuffBlocks?.length)"
        class="monster-detail-field-buff"
      >
        <p class="monster-detail-field-buff-title">场地 Buff{{ currentFieldBuff?.fieldBuff?.name && currentFieldBuff.fieldBuff.name !== '场地 Buff' ? `——${currentFieldBuff.fieldBuff.name}` : '' }}</p>
        <ul v-if="currentFieldBuffLines.length" class="monster-detail-field-buff-lines">
          <li v-for="(line, lineIndex) in currentFieldBuffLines" :key="lineIndex">
            <BuffRichText :text="line" />
          </li>
        </ul>
        <BuffEffectBlocksDisplay
          v-if="currentFieldBuffBlocks?.length"
          compact
          notes-only
          :blocks="currentFieldBuffBlocks"
          :title="currentFieldBuff?.fieldBuff?.name || '场地 Buff'"
          empty-text=""
        />
      </section>

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
.note-transition {
  margin: 0.35rem 0 0;
  padding: 0.5rem 0.6rem 0.55rem 0.7rem;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
  /* 与「得分机制」块同款（蓝色左边框），不再是场地 Buff 的橙色 */
  border-left: 3px solid color-mix(in srgb, #5f8fd8 75%, transparent);
  background: color-mix(in srgb, var(--color-background) 45%, transparent);
}

.note-transition-title {
  margin: 0 0 0.4rem;
  font-size: 0.78rem;
  font-weight: 700;
  color: color-mix(in srgb, #5f8fd8 80%, var(--color-text));
}

.note-transition-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
}

.note-transition-column {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0 0.75rem;
}

.note-transition-column + .note-transition-column {
  border-left: 1px solid var(--color-border);
}

.note-transition-column:first-child {
  padding-left: 0;
}

.note-transition-column:last-child {
  padding-right: 0;
}

.note-transition-label {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 700;
  color: #e85d4c;
}

.note-transition-phase {
  margin-left: 0.3rem;
  font-weight: 600;
  opacity: 0.72;
  color: var(--color-heading);
}

.note-transition-lines {
  margin: 0;
  padding-left: 0;
  list-style: none;
  font-size: 0.72rem;
  line-height: 1.45;
  opacity: 0.88;
}

/* 未变化的场地 Buff：沿用「场地 Buff 转变」那个框的样式 */
.monster-detail-field-buff {
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
  border-left: 3px solid color-mix(in srgb, #e8a838 75%, transparent);
  background: color-mix(in srgb, var(--color-background-soft) 75%, transparent);
}

.monster-detail-field-buff-title {
  margin: 0 0 0.4rem;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--color-heading);
}

.monster-detail-field-buff-lines {
  margin: 0;
  padding-left: 1rem;
  font-size: 0.72rem;
  line-height: 1.45;
  opacity: 0.88;
}

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

.monster-detail-scoring-phase {
  margin: 0.25rem 0 0.1rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--color-text-muted, #9aa3b0);
}

.monster-detail-scoring-phase-label {
  margin-left: 0.3rem;
  font-weight: 400;
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
