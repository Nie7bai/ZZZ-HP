<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import IkModalShell from '@/components/common/IkModalShell.vue'
import DualLineChartView from '@/components/history/DualLineChartView.vue'
import MonsterDetailStats, {
  type MonsterDetailRecord,
} from '@/components/history/MonsterDetailStats.vue'
import { lookupBossInfo } from '@/api/bossInfo'
import { fetchDefenseBossChart } from '@/api/defense'
import type { CrisisHpChartMode, HpChartPoint } from '@/api/crisisAssault'
import type { DefenseEnemy, DefenseVariant } from '@/types/defense'
import {
  buildDefenseMonsterDetailRecord,
  resolveDefenseMonsterCategory,
  type DefenseMonsterDetailBossInfo,
} from '@/utils/defenseCompare'
import type { HpComparison } from '@/utils/defenseHp'
import { createRequestEpoch } from '@/utils/requestEpoch'

const props = defineProps<{
  open: boolean
  enemy: DefenseEnemy | null
  /** 面板当前版本（旧/新）；折线图按 variant 取期数 */
  variant: DefenseVariant
  /** 如「3.2 第 2 期 · 房间 1 · WAVE 1」 */
  phaseLabel: string
  /** 血量与往期对比，由父面板按怪物卡片同一口径计算；无往期出现时为 null */
  hpComparison?: HpComparison | null
  /** 该槽位所在防线（第五防线 = 5）；无 boss_info 记录时按防线规则补默认等级 */
  stage?: number | null
  /** 该槽位所属赛季的游戏版本（如 3.2），由父面板从 currentSeason 取；判「2.1 起异常条 ×1.1」用 */
  version?: string | null
  /**
   * 该怪物是否在 2.1（含）之前就已存在（首次出现不晚于 2.1，含 2.1 才出的新怪物），
   * 由父面板扫全量赛季算好传入；与 `version ≥ 2.1` 同时成立才乘版本系数，缺省按 false
   */
  bossExistedByMultiplierVersion?: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

/**
 * 折线图与「怪物数据库」同口径：按「怪物类别 + 名称」取点。
 * 类别由怪物 ID 解码（小怪 minion 也算），旧数据回退 `isBoss`。
 */
const chartCategory = computed(() =>
  props.enemy ? resolveDefenseMonsterCategory(props.enemy) : null,
)

const bossInfo = ref<DefenseMonsterDetailBossInfo | null>(null)
const bossInfoLoadEpoch = createRequestEpoch()
const points = ref<HpChartPoint[]>([])
const chartLoadEpoch = createRequestEpoch()
const chartLoading = ref(false)
const chartError = ref('')
const hpMode = ref<CrisisHpChartMode>('normal')

const detailRecord = computed<MonsterDetailRecord | null>(() => {
  const enemy = props.enemy
  if (!enemy) return null
  return buildDefenseMonsterDetailRecord(
    enemy,
    props.hpComparison ?? null,
    bossInfo.value,
    props.stage ?? null,
    props.version ?? null,
    props.bossExistedByMultiplierVersion ?? false,
  )
})

/**
 * 等级 / 失衡易伤只能来自 boss_info；查无记录或请求失败时不阻断折线图。
 * 等级行仍在第五防线上按防线规则补 70（见 `buildDefenseMonsterDetailRecord`）。
 */
async function loadBossInfoRecord() {
  const bossName = props.enemy?.name
  if (!bossName) {
    bossInfo.value = null
    return
  }

  const token = bossInfoLoadEpoch.next()
  try {
    const record = await lookupBossInfo(bossName)
    if (!bossInfoLoadEpoch.isCurrent(token)) return
    bossInfo.value = record
  } catch {
    if (!bossInfoLoadEpoch.isCurrent(token)) return
    bossInfo.value = null
  }
}

async function loadBossChartPoints() {
  const enemy = props.enemy
  const category = chartCategory.value
  if (!enemy?.name || !category) {
    points.value = []
    chartError.value = ''
    chartLoading.value = false
    return
  }

  const token = chartLoadEpoch.next()
  chartLoading.value = true
  chartError.value = ''
  try {
    const data = await fetchDefenseBossChart(props.variant, enemy.name, category)
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
  () => [props.open, props.enemy?.name, props.enemy?.id, props.variant] as const,
  ([open]) => {
    if (!open) return
    hpMode.value = 'normal'
    void loadBossInfoRecord()
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
        :image-alt="enemy.name"
        :show-resistance-table="true"
      />

      <section v-if="chartCategory" class="monster-detail-chart">
        <p v-if="chartLoading" class="status-text">图表加载中...</p>
        <p v-else-if="chartError" class="status-text error">{{ chartError }}</p>
        <p v-else-if="!points.length" class="status-text">该怪物暂无历史数据</p>
        <DualLineChartView
          v-else
          class="monster-detail-chart-view"
          v-model:hp-mode="hpMode"
          :points="points"
          :hp-chart-title="`${enemy.name} 血量折线图`"
          :expansion-chart-title="`${enemy.name} 血量相对膨胀折线图`"
          :hp-aria-label="`${enemy.name} 血量折线图`"
          :expansion-aria-label="`${enemy.name} 血量相对膨胀折线图`"
          :enable-point-click="false"
          :enable-boss-preview="false"
          :enable-room-buff-preview="true"
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
.monster-detail-chart-view {
  flex: none;
  min-height: auto;
  overflow: visible;
  display: flex;
}
</style>
