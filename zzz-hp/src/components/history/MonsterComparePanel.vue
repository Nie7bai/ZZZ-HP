<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import BuffEffectBlocksDisplay from '@/components/calculator/BuffEffectBlocksDisplay.vue'
import BuffRichText from '@/components/calculator/BuffRichText.vue'
import DualLineChartView from '@/components/history/DualLineChartView.vue'
import PhaseDetailModal from '@/components/history/PhaseDetailModal.vue'
import {
  fetchBossChart,
  fetchBossList,
  type BossOption,
  type HpChartPoint,
} from '@/api/crisisAssault'
import { fetchDefenseBossChart, fetchDefenseBossList } from '@/api/defense'
import {
  fetchDeductionBossChart,
  fetchDeductionBossList,
} from '@/api/deduction'
import { fetchBossInfoList, lookupBossInfo, type BossInfoRecord } from '@/api/bossInfo'
import BossPickerModal from '@/components/history/BossPickerModal.vue'
import MonsterDetailStats, {
  type MonsterDetailRecord,
} from '@/components/history/MonsterDetailStats.vue'
import { usePhaseDetailModal } from '@/composables/usePhaseDetailModal'
import type { DefenseVariant } from '@/types/defense'
import { modeTitles, type ModeKey } from '@/types/history'
import type { DefenseCompareMonsterCategory } from '@/utils/defenseCompare'
import { joinBossOptionsWithInfo } from '@/utils/bossPickerItems'
import { resolveAssetUrl } from '@/utils/gameData'
import {
  ANOMALY_BAR_VERSION_MULTIPLIER_FROM,
  isVersionAtLeast,
  isVersionAtMost,
} from '@/utils/monsterResistanceTable'
import { createRequestEpoch } from '@/utils/requestEpoch'
import { noteBlocksForDisplay, splitNoteLines } from '@/utils/historyNoteText'

const props = defineProps<{
  mode: ModeKey
}>()

const route = useRoute()
const bossList = ref<BossOption[]>([])
const selectedBoss = ref('')
const selectedCategory = ref<DefenseCompareMonsterCategory>('elite')
const crisisRoomType = ref<'normal' | 'hard'>('normal')
const points = ref<HpChartPoint[]>([])
const bossListLoadEpoch = createRequestEpoch()
const bossChartLoadEpoch = createRequestEpoch()
const bossInfoLoadEpoch = createRequestEpoch()
const bossDetailLoadEpoch = createRequestEpoch()
const listLoading = ref(false)
const chartLoading = ref(false)
const listError = ref('')
const chartError = ref('')
const bossInfoRecords = ref<BossInfoRecord[]>([])
const selectedBossDetail = ref<BossInfoRecord | null>(null)
/** 怪物库多套弱点/抗性的当前查看套（默认第一套） */
const selectedWeaknessSetId = ref('')
const pickerModalOpen = ref(false)
const { visible: detailVisible, point: detailPoint, open: openPhaseDetail, close: closePhaseDetail } =
  usePhaseDetailModal()

const defenseVariant = computed<DefenseVariant>(() =>
  route.meta.defenseVariant === 'new' ? 'new' : 'old',
)

const isDefenseMode = computed(() => props.mode === 'defense')
const isDeductionMode = computed(() => props.mode === 'deduction')

const pageTitle = computed(() => modeTitles[props.mode])

const panelDesc = computed(() => {
  if (isDeductionMode.value) {
    return '选择终局 Boss，查看其在各期出现的总血量与相对膨胀变化'
  }
  if (isDefenseMode.value) {
    return '先选择精英或 Boss，再选择怪物，查看其在各期出现时的血量与相对膨胀变化'
  }
  return crisisRoomType.value === 'hard'
    ? '选择绝境模式 Boss 后，查看其在各期出现时的血量、危局血量系数与相对变化'
    : '选择正常模式 Boss（房间 1/2/3）后，查看其在各期出现时的血量、危局血量系数与相对变化'
})

const selectedBossItem = computed(() =>
  pickerItems.value.find((item) => item.bossName === selectedBoss.value) ?? null,
)

const selectedBossImageUrl = computed(() => resolveAssetUrl(selectedBossItem.value?.bossImage))

/** 基础异常条按敌人类别取：危局按首领、推演只选终局 Boss 也按首领，防卫战直接映射页面上的「怪物类型」 */
const detailMonsterCategory = computed<DefenseCompareMonsterCategory>(() =>
  isDefenseMode.value ? selectedCategory.value : 'boss',
)

/** 版本号是否可解析：`isVersionAtLeast` 对缺失 / 非法 / 不可比一律返回 false，自比成立即格式可解析 */
function isParseableVersion(version: string | null | undefined): version is string {
  if (!version) return false
  return isVersionAtLeast(version, version)
}

/**
 * 数据行的版本：**本页没有「当期」概念，取图上最新版本作为现状口径**，
 * 供「弱点与抗性」表判「该版本 ≥ 2.1 才乘版本系数」。
 * 不依赖 `points` 顺序（逐点用 `isVersionAtLeast` 比较取最大）；版本缺失 / 解析不出的点跳过，
 * 全都解析不出时保持 null（表侧保守按不乘版本系数处理）。
 */
const chartLatestVersion = computed<string | null>(() => {
  let latest: string | null = null
  for (const point of points.value) {
    const version = point.version
    if (!isParseableVersion(version)) continue
    if (latest === null || isVersionAtLeast(version, latest)) latest = version
  }
  return latest
})

/**
 * 该 Boss 是否在 2.1（含）之前就已存在（版本系数的另一个条件）：
 * 本页图表只画这一只 Boss，图上任一期版本 ≤ 2.1 即为真，无「出现过的期数」可筛选；
 * 版本解析不出的点不算出现（与 `isVersionAtMost` 同口径）。
 */
const bossExistedByMultiplierVersion = computed(() =>
  points.value.some((point) => isVersionAtMost(point.version, ANOMALY_BAR_VERSION_MULTIPLIER_FROM)),
)

/** 怪物库多套弱点/抗性：有配置才提供切换 */
const weaknessSetOptions = computed(() => selectedBossDetail.value?.weakness_sets ?? [])

const selectedWeaknessSet = computed(() => {
  const sets = weaknessSetOptions.value
  if (!sets.length) return null
  return sets.find((set) => set.id === selectedWeaknessSetId.value) ?? sets[0] ?? null
})

/** 选中套对应的期数：每期实际属性由 boss-chart 按当期绑定解析后下发 */
const markedPhaseLabels = computed(() => {
  const set = selectedWeaknessSet.value
  if (!set || weaknessSetOptions.value.length < 2) return []
  const norm = (value?: string | null) => (value ?? '').trim()
  return points.value
    .filter((point) => {
      if (point.weaknessSetId) return point.weaknessSetId === set.id
      return (
        norm(point.weakness) === norm(set.weakness) &&
        norm(point.resistance) === norm(set.resistance) &&
        norm(point.resistanceHigh) === norm(set.resistanceHigh)
      )
    })
    .map((point) => point.label)
})

/** 怪物库的得分机制多套 / 场地 Buff 多套：与弱点套同款，可切换查看 */
const scoringNoteSetOptions = computed(() => selectedBossDetail.value?.scoring_note_sets ?? [])
const selectedScoringNoteSetId = ref('')
const selectedScoringNoteSet = computed(() => {
  const sets = scoringNoteSetOptions.value
  if (!sets.length) return null
  return sets.find((set) => set.id === selectedScoringNoteSetId.value) ?? sets[0] ?? null
})

const scoringNoteLines = computed(() => splitNoteLines(selectedScoringNoteSet.value?.text))

const fieldBuffSetOptions = computed(() => selectedBossDetail.value?.field_buff_sets ?? [])
const selectedFieldBuffSetId = ref('')
const selectedFieldBuffSet = computed(() => {
  const sets = fieldBuffSetOptions.value
  if (!sets.length) return null
  return sets.find((set) => set.id === selectedFieldBuffSetId.value) ?? sets[0] ?? null
})
const fieldBuffNoteBlocks = computed(
  () =>
    noteBlocksForDisplay(selectedFieldBuffSet.value?.effectBlocks, selectedFieldBuffSet.value?.text ?? '') ??
    [],
)

const fieldBuffLines = computed(() => splitNoteLines(selectedFieldBuffSet.value?.text))

/**
 * 场地 Buff 区块标题：套名本身可能已带「场地 Buff——xxx」前缀，
 * 只在名称不含该前缀时补上类别名，避免出现「场地 Buff——场地 Buff——减防」。
 */
const fieldBuffTitle = computed(() => {
  const name = selectedFieldBuffSet.value?.name?.trim() ?? ''
  if (!name) return '场地 Buff'
  return name.startsWith('场地 Buff') ? name : `场地 Buff——${name}`
})

/**
 * 选中套对应的期数（图表标记）：与弱点套同口径——只有多套时才标记，
 * 每期实际生效的套 id 由 boss-chart 按时绑定解析后下发。
 */
function labelsOfSet(
  setId: string | null | undefined,
  setCount: number,
  pickSetId: (point: HpChartPoint) => string | null | undefined,
): string[] {
  if (!setId || setCount < 2) return []
  return points.value
    .filter((point) => (pickSetId(point) ?? '') === setId)
    .map((point) => point.label)
}

const markedScoringPhaseLabels = computed(() =>
  labelsOfSet(selectedScoringNoteSet.value?.id, scoringNoteSetOptions.value.length, (point) =>
    point.scoringNoteSetId,
  ),
)
const markedFieldBuffPhaseLabels = computed(() =>
  labelsOfSet(selectedFieldBuffSet.value?.id, fieldBuffSetOptions.value.length, (point) =>
    point.fieldBuffSetId,
  ),
)
/** 图表标记分组：弱点蓝底纹、得分机制紫框、场地 Buff 橙框；连续期数各自合并成一个框 */
const markedGroups = computed(() => [
  { labels: markedPhaseLabels.value },
  { labels: markedScoringPhaseLabels.value, tone: 'scoring' as const },
  { labels: markedFieldBuffPhaseLabels.value, tone: 'field-buff' as const },
])

/** 切换怪物后默认看第一套 */
watch(selectedBossDetail, (detail) => {
  selectedWeaknessSetId.value = detail?.weakness_sets?.[0]?.id ?? ''
  selectedScoringNoteSetId.value = detail?.scoring_note_sets?.[0]?.id ?? ''
  selectedFieldBuffSetId.value = detail?.field_buff_sets?.[0]?.id ?? ''
})

/**
 * 名称已在数据块上方单独展示，数据行不再重复 boss_name；
 * 类别 / 版本 / 「2.1 前已存在」三项基础库不带，由本页按图表与选择器算出后补进数据行。
 */
const detailRecord = computed<MonsterDetailRecord | null>(() => {
  const detail = selectedBossDetail.value
  if (!detail) return null
  const set = selectedWeaknessSet.value
  return {
    ...detail,
    // 多套弱点/抗性：按当前选中的那套展示（无多套时沿用基础三列）
    weakness: set ? (set.weakness ?? null) : detail.weakness,
    resistance: set ? (set.resistance ?? null) : detail.resistance,
    resistance_high: set ? (set.resistanceHigh ?? null) : detail.resistance_high,
    boss_name: null,
    monster_category: detailMonsterCategory.value,
    version: chartLatestVersion.value,
    boss_existed_by_multiplier_version: bossExistedByMultiplierVersion.value,
  }
})

/** 换怪入口改为点击图片后必须显式提示；空态（未选择 / 无图）同样展示，避免无从下手 */
const monsterImageChangeHint = '点击怪物图片可更换怪物'

const categoryLabel = computed(() => (selectedCategory.value === 'elite' ? '精英' : 'Boss'))

const bossSelectLabel = computed(() =>
  isDeductionMode.value
    ? '选择 Boss'
    : isDefenseMode.value
      ? `选择${categoryLabel.value}`
      : crisisRoomType.value === 'hard'
        ? '选择绝境 Boss'
        : '选择 boss',
)

/** 多套下拉的选项文案：备注（或套序号）+ 弱点/抗性摘要；空套标注「空」 */
function weaknessSetOptionLabel(
  set: {
    id: string
    label?: string | null
    weakness?: string | null
    resistance?: string | null
  },
  index: number,
) {
  const title = set.label?.trim() || `套 ${index + 1}`
  const traits = [
    set.weakness?.trim() ? `弱 ${set.weakness.trim()}` : '',
    set.resistance?.trim() ? `抗 ${set.resistance.trim()}` : '',
  ].filter(Boolean)
  return traits.length ? `${title} · ${traits.join(' / ')}` : `${title}（空）`
}

const pickerItems = computed(() => joinBossOptionsWithInfo(bossList.value, bossInfoRecords.value))

async function loadBossList() {
  const token = bossListLoadEpoch.next()
  if (props.mode !== 'crisis-assault' && props.mode !== 'defense' && props.mode !== 'deduction') return

  listLoading.value = true
  listError.value = ''
  try {
    const list = isDeductionMode.value
      ? await fetchDeductionBossList()
      : isDefenseMode.value
        ? await fetchDefenseBossList(defenseVariant.value, selectedCategory.value)
        : await fetchBossList(crisisRoomType.value)
    if (!bossListLoadEpoch.isCurrent(token)) return

    bossList.value = list
    if (bossList.value.some((boss) => boss.boss_name === selectedBoss.value)) return
    selectedBoss.value = bossList.value[0]?.boss_name ?? ''
  } catch (error) {
    if (!bossListLoadEpoch.isCurrent(token)) return
    listError.value = error instanceof Error ? error.message : '加载怪物列表失败'
    bossList.value = []
    selectedBoss.value = ''
  } finally {
    if (!bossListLoadEpoch.isCurrent(token)) return
    listLoading.value = false
  }
}

async function loadBossChart() {
  const token = bossChartLoadEpoch.next()
  if (!selectedBoss.value) {
    points.value = []
    return
  }

  chartLoading.value = true
  chartError.value = ''
  try {
    const chartPoints = isDeductionMode.value
      ? await fetchDeductionBossChart(selectedBoss.value)
      : isDefenseMode.value
        ? await fetchDefenseBossChart(
            defenseVariant.value,
            selectedBoss.value,
            selectedCategory.value,
          )
        : await fetchBossChart(selectedBoss.value, crisisRoomType.value)
    if (!bossChartLoadEpoch.isCurrent(token)) return
    points.value = chartPoints
  } catch (error) {
    if (!bossChartLoadEpoch.isCurrent(token)) return
    chartError.value = error instanceof Error ? error.message : '加载折线图失败'
    points.value = []
  } finally {
    if (!bossChartLoadEpoch.isCurrent(token)) return
    chartLoading.value = false
  }
}

/**
 * 拉取 boss_info 基础库全量（后端单页上限 500），按 boss_name 给选择卡片补展示字段。
 * 加载失败只降级为卡片少字段，不阻断怪物列表与图表。
 */
async function loadBossInfoCatalog() {
  const token = bossInfoLoadEpoch.next()
  try {
    const collected: BossInfoRecord[] = []
    let offset = 0
    while (offset < 2000) {
      const result = await fetchBossInfoList({ limit: 500, offset })
      if (!bossInfoLoadEpoch.isCurrent(token)) return
      collected.push(...result.items)
      offset += result.items.length
      if (!result.items.length || offset >= result.total) break
    }
    bossInfoRecords.value = collected
  } catch {
    if (!bossInfoLoadEpoch.isCurrent(token)) return
    bossInfoRecords.value = []
  }
}

/** 选中怪物后拉取基础库详情用于数据块；快切时丢弃过期响应，查无记录时整块隐藏 */
async function loadSelectedBossDetail() {
  const bossName = selectedBoss.value
  if (!bossName) {
    selectedBossDetail.value = null
    return
  }

  const token = bossDetailLoadEpoch.next()
  try {
    const record = await lookupBossInfo(bossName)
    if (!bossDetailLoadEpoch.isCurrent(token)) return
    selectedBossDetail.value = record
  } catch {
    if (!bossDetailLoadEpoch.isCurrent(token)) return
    selectedBossDetail.value = null
  }
}

function handleBossPicked(bossName: string) {
  selectedBoss.value = bossName
  pickerModalOpen.value = false
}

onMounted(() => {
  loadBossList()
  loadBossInfoCatalog()
})

watch(defenseVariant, () => {
  if (isDefenseMode.value) {
    selectedBoss.value = ''
    loadBossList()
  }
})

watch(selectedCategory, () => {
  if (!isDefenseMode.value) return
  selectedBoss.value = ''
  loadBossList()
})

watch(crisisRoomType, () => {
  if (isDefenseMode.value) return
  selectedBoss.value = ''
  loadBossList()
})

watch(selectedBoss, () => {
  loadBossChart()
  loadSelectedBossDetail()
})
</script>

<template>
  <div class="monster-compare-panel">
    <header class="panel-header">
      <h1 class="page-title">{{ pageTitle }} · 怪物数据库</h1>
      <p class="panel-desc">{{ panelDesc }}</p>
    </header>

    <p v-if="listLoading" class="status-text">加载怪物列表中...</p>
    <p v-else-if="listError" class="status-text error">{{ listError }}</p>

    <template v-else>
      <div v-if="isDefenseMode" class="selector-toolbar selector-toolbar--defense">
        <div class="selector-field">
          <label class="selector-label" for="category-select">怪物类型</label>
          <select id="category-select" v-model="selectedCategory" class="boss-select">
            <option value="elite">精英</option>
            <option value="boss">Boss</option>
          </select>
        </div>
      </div>

      <p class="boss-selected-name" :class="{ 'boss-selected-name--empty': !selectedBoss }">
        {{ selectedBoss || '未选择' }}
      </p>

      <div v-if="weaknessSetOptions.length > 1" class="weakness-set-toolbar">
        <label class="selector-label" for="weakness-set-select">弱点 / 抗性套</label>
        <select id="weakness-set-select" v-model="selectedWeaknessSetId" class="boss-select">
          <option v-for="(set, setIndex) in weaknessSetOptions" :key="set.id" :value="set.id">
            {{ weaknessSetOptionLabel(set, setIndex) }}
          </option>
        </select>
      </div>
      <p v-if="weaknessSetOptions.length > 1" class="weakness-set-hint">
        蓝色底纹 = 该套对应期数<span v-if="markedPhaseLabels.length">：{{ markedPhaseLabels.join('、') }}</span>
      </p>

      <MonsterDetailStats
        class="monster-compare-stats"
        :record="detailRecord"
        :image-url="selectedBossImageUrl"
        :image-alt="selectedBoss"
        image-clickable
        :show-resistance-table="true"
        :image-hint="monsterImageChangeHint"
        @image-click="pickerModalOpen = true"
      />

      <!-- 得分机制（多套，可切换；与「弱点 / 抗性套」同款交互） -->
      <section v-if="scoringNoteSetOptions.length" class="monster-db-note">
        <header class="monster-db-note-head">
          <h3 class="monster-db-note-title">得分机制</h3>
          <select
            v-if="scoringNoteSetOptions.length > 1"
            v-model="selectedScoringNoteSetId"
            class="boss-select"
          >
            <option v-for="(set, setIndex) in scoringNoteSetOptions" :key="set.id" :value="set.id">
              {{ set.label || `第 ${setIndex + 1} 套` }}
            </option>
          </select>
          <span v-else-if="selectedScoringNoteSet?.label" class="monster-db-note-label">
            {{ selectedScoringNoteSet.label }}
          </span>
        </header>
        <p v-if="scoringNoteSetOptions.length > 1" class="monster-db-note-hint">
          紫色框 = 该套对应期数<span v-if="markedScoringPhaseLabels.length"
            >：{{ markedScoringPhaseLabels.join('、') }}</span
          >
        </p>
        <ul v-if="scoringNoteLines.length" class="monster-db-note-lines">
          <li v-for="(line, lineIndex) in scoringNoteLines" :key="lineIndex">
            <BuffRichText :text="line" />
          </li>
        </ul>
        <p v-else class="status-text">该套暂无内容</p>
      </section>

      <!-- 场地 Buff（多套，可切换） -->
      <section v-if="fieldBuffSetOptions.length" class="monster-db-note monster-db-note--buff">
        <header class="monster-db-note-head">
          <h3 class="monster-db-note-title">{{ fieldBuffTitle }}</h3>
          <select
            v-if="fieldBuffSetOptions.length > 1"
            v-model="selectedFieldBuffSetId"
            class="boss-select"
          >
            <option v-for="(set, setIndex) in fieldBuffSetOptions" :key="set.id" :value="set.id">
              {{ set.label || set.name || `第 ${setIndex + 1} 套` }}
            </option>
          </select>
          <span v-else-if="selectedFieldBuffSet?.label" class="monster-db-note-label">
            {{ selectedFieldBuffSet.label }}
          </span>
        </header>
        <p v-if="fieldBuffSetOptions.length > 1" class="monster-db-note-hint">
          橙色框 = 该套对应期数<span v-if="markedFieldBuffPhaseLabels.length"
            >：{{ markedFieldBuffPhaseLabels.join('、') }}</span
          >
        </p>
        <ul v-if="fieldBuffLines.length" class="monster-db-note-lines">
          <li v-for="(line, lineIndex) in fieldBuffLines" :key="lineIndex">
            <BuffRichText :text="line" />
          </li>
        </ul>
        <BuffEffectBlocksDisplay
          v-if="fieldBuffNoteBlocks.length"
          compact
          notes-only
          :blocks="fieldBuffNoteBlocks"
          :title="fieldBuffTitle"
          empty-text=""
        />
        <p v-if="!fieldBuffLines.length && !fieldBuffNoteBlocks.length" class="status-text">
          该套暂无内容
        </p>
      </section>

      <p v-if="chartLoading" class="status-text">图表加载中...</p>
      <p v-else-if="chartError" class="status-text error">{{ chartError }}</p>
      <p v-else-if="selectedBoss && !points.length" class="status-text">该怪物暂无历史数据</p>

      <DualLineChartView
        v-else-if="points.length"
        class="chart-view"
        v-model:hp-mode="crisisRoomType"
        :show-hp-mode-toggle="!isDefenseMode && !isDeductionMode"
        :enable-hp-coeff-charts="!isDefenseMode && !isDeductionMode"
        :points="points"
        :hp-chart-title="`${selectedBoss} 血量折线图`"
        :expansion-chart-title="`${selectedBoss} 血量相对膨胀折线图`"
        :hp-aria-label="`${selectedBoss} 血量折线图`"
        :expansion-aria-label="`${selectedBoss} 血量相对膨胀折线图`"
        :enable-point-click="!isDefenseMode && !isDeductionMode"
        :enable-boss-preview="false"
        :enable-room-buff-preview="isDefenseMode"
        :enable-hp-converted953-toggle="!isDefenseMode"
        :marked-groups="markedGroups"
        :page-scroll="true"
        @point-click="openPhaseDetail"
      />

      <BossPickerModal
        :open="pickerModalOpen"
        :items="pickerItems"
        :title="bossSelectLabel"
        :selected-name="selectedBoss"
        @select="handleBossPicked"
        @close="pickerModalOpen = false"
      />

      <PhaseDetailModal
        v-if="!isDefenseMode && !isDeductionMode"
        :visible="detailVisible"
        :point="detailPoint"
        :mode="mode"
        @close="closePhaseDetail"
      />
    </template>
  </div>
</template>

<style scoped>
.monster-compare-panel {
  width: 100%;
  max-width: none;
  height: auto;
  min-height: 100%;
  margin: 0;
  padding: 0.35rem 0.25rem 0.5rem;
  display: flex;
  flex-direction: column;
  overflow: visible;
  box-sizing: border-box;
}

.panel-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.65rem;
  flex-shrink: 0;
}

.page-title {
  font-size: clamp(1.5rem, 3.5vw, 2rem);
  font-weight: 700;
  color: var(--color-heading);
  letter-spacing: 0.04em;
  text-align: center;
}

.panel-desc {
  font-size: 0.85rem;
  opacity: 0.7;
  color: var(--color-text);
  text-align: center;
}

.category-selector,
.boss-selector,
.selector-toolbar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.65rem;
  margin-bottom: 0.75rem;
  flex-shrink: 0;
}

.selector-toolbar--defense {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: center;
  gap: 1rem 1.25rem;
}

.selector-field {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.selector-label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-heading);
}

.boss-select {
  min-width: 240px;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 0.95rem;
}

.boss-selected-name {
  min-width: 0;
  max-width: 320px;
  margin: 0 auto 0.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-heading);
  text-align: center;
}

.boss-selected-name--empty {
  font-weight: 500;
  opacity: 0.6;
}

/* 多套弱点/抗性切换：只在库里有 2 套以上时出现 */
.weakness-set-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin: 0 auto 0.5rem;
  flex-shrink: 0;
}

.weakness-set-toolbar .boss-select {
  min-width: 220px;
  padding: 0.4rem 0.6rem;
  font-size: 0.88rem;
}

.weakness-set-hint {
  margin: -0.15rem auto 0.6rem;
  font-size: 0.74rem;
  color: var(--color-text);
  opacity: 0.7;
  text-align: center;
}

.monster-db-note {
  margin: 0.6rem 0 0;
  padding: 0.55rem 0.65rem 0.6rem 0.7rem;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
  border-left: 3px solid color-mix(in srgb, #5f8fd8 75%, transparent);
  background: color-mix(in srgb, var(--color-background) 45%, transparent);
}

.monster-db-note--buff {
  border-left-color: color-mix(in srgb, #e8a838 75%, transparent);
}

.monster-db-note-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-bottom: 0.35rem;
}

.monster-db-note-title {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--color-heading);
}

.monster-db-note-label {
  font-size: 0.72rem;
  color: var(--color-text-muted, #9aa3b0);
}

.monster-db-note-hint {
  margin: 0 0 0.3rem;
  font-size: 0.72rem;
  color: var(--color-text-muted, #9aa3b0);
}

.monster-db-note-lines {
  margin: 0;
  padding-left: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.76rem;
  line-height: 1.5;
}

.monster-compare-stats {
  flex-shrink: 0;
  /* 与怪物详情弹窗同宽（弹窗是 min(1100px, 88vw)）：三列布局（图 21% / 数据 / 表 53%）
     需要这个宽度才不挤，640px 会把数据列压到 ~110px */
  width: min(1100px, 100%);
  margin: 0 auto 0.85rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft);
  box-sizing: border-box;
}

.status-text {
  min-height: 30vh;
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

/* `DualLineChartView` 根节点就是 `.charts-panel`：整页形态下高度必须交给内容，
   否则 `flex: 1`/`min-height: 0` 会把图表容器压扁（与 `.charts-panel--page` 取值一致，避免层叠顺序之争） */
.chart-view {
  flex: none;
  min-height: auto;
  overflow: visible;
  display: flex;
}

@media (max-width: 768px) {
  .monster-compare-panel {
    min-height: auto;
    padding: 0.35rem 0.15rem 0.55rem;
  }

  .page-title {
    font-size: 1.05rem;
  }

  .panel-desc {
    font-size: 0.72rem;
    padding-inline: 0.35rem;
  }

  .selector-toolbar--defense {
    flex-direction: column;
    align-items: stretch;
    gap: 0.55rem;
  }

  .selector-field {
    align-items: stretch;
    width: 100%;
  }

  .boss-select {
    min-width: 0;
    flex: 1;
    width: 100%;
  }

  .boss-selected-name {
    max-width: none;
  }

  .monster-compare-stats {
    width: 100%;
  }
}
</style>
