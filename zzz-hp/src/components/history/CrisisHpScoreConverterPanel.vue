<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  fetchBossChart,
  fetchBossList,
  type BossOption,
  type HpChartPoint,
} from '@/api/crisisAssault'
import { fetchDeductionBossChart, fetchDeductionBossList } from '@/api/deduction'
import {
  CRISIS_OPERATION_SCORE_DEFAULT,
  CRISIS_OPERATION_SCORE_MAX,
  CRISIS_SCORE_MAX,
  CRISIS_TOTAL_SCORE_MAX,
  convertHpRatioToScore,
  convertScoreToHpRatio,
  describeConvertSegment,
  formatCrisisScoreBarLabel,
  formatPercent,
  formatScorePerHp,
  getConvertContextTableRows,
  getScoreMarkers,
  scaleHpByRatio,
  type CrisisHpScoreConvertResult,
  type CrisisScoreMarker,
  type CrisisScoreTableMode,
} from '@/data/crisisScoreHpTable'
import { modeTitles, type ModeKey } from '@/types/history'
import { formatHp, resolveAssetUrl } from '@/utils/gameData'

type EditSource = 'hp' | 'score' | 'scorePct' | 'abs'
type HpAbsField = 'total' | 'dealt' | null

interface ConvertRecord {
  id: number
  dealtHp: number | null
  hpRatio: number
  scoreRatio: number
  score: number
}

interface ModeDraft {
  editing: EditSource
  lastHpAbs: HpAbsField
  hpPercentInput: string
  scorePercentInput: string
  scoreInput: string
  operationScoreInput: string
  totalHpInput: string
  dealtHpInput: string
  selectedBoss: string
  selectedPhaseLabel: string
  records: ConvertRecord[]
  keptHpRatio: number | null
  totalMultiplierInput: string
}

function emptyDraft(): ModeDraft {
  return {
    editing: 'hp',
    lastHpAbs: null,
    hpPercentInput: '',
    scorePercentInput: '',
    scoreInput: '',
    operationScoreInput: String(CRISIS_OPERATION_SCORE_DEFAULT),
    totalHpInput: '',
    dealtHpInput: '',
    selectedBoss: '',
    selectedPhaseLabel: '',
    records: [],
    keptHpRatio: null,
    totalMultiplierInput: '1',
  }
}

const props = withDefaults(
  defineProps<{
    /** 危局 / 临界：换算表相同，怪物数据源不同 */
    mode?: ModeKey
  }>(),
  { mode: 'crisis-assault' },
)

const isDeductionMode = computed(() => props.mode === 'deduction')
const pageTitle = computed(() =>
  isDeductionMode.value
    ? `${modeTitles.deduction} · 血量分数转换器`
    : `${modeTitles['crisis-assault']} · 血量分数转换器`,
)

const tableMode = ref<CrisisScoreTableMode>('normal')
/** 临界无正常/绝境之分，换算表固定用正常曲线 */
const convertTableMode = computed<CrisisScoreTableMode>(() =>
  isDeductionMode.value ? 'normal' : tableMode.value,
)
const editing = ref<EditSource>('hp')
const lastHpAbs = ref<HpAbsField>(null)
const hpPercentInput = ref('')
const scorePercentInput = ref('')
const scoreInput = ref('')
const operationScoreInput = ref(String(CRISIS_OPERATION_SCORE_DEFAULT))
/** 临界：前战/选战累计总倍率；操作分填写/展示为已乘倍率后的值 */
const totalMultiplierInput = ref('1')
const lastTotalMultiplier = ref(1)
const totalHpInput = ref('')
const dealtHpInput = ref('')
const keptHpRatio = ref<number | null>(null)
const records = ref<ConvertRecord[]>([])
const recordSeq = ref(0)
const processOpen = ref(true)
const restoringMode = ref(false)
const modeDrafts: Record<CrisisScoreTableMode, ModeDraft> = {
  normal: emptyDraft(),
  hard: emptyDraft(),
}

const bossList = ref<BossOption[]>([])
const selectedBoss = ref('')
const phasePoints = ref<HpChartPoint[]>([])
const selectedPhaseLabel = ref('')
const bossListLoading = ref(false)
const bossChartLoading = ref(false)
const bossError = ref('')
const applyingBossHp = ref(false)

const markers = computed(() => getScoreMarkers(convertTableMode.value))

/** 转换器快捷键：仅危局；临界无正常/绝境区分，不提供快捷 */
const converterMarkers = computed((): CrisisScoreMarker[] => {
  if (isDeductionMode.value) return []
  if (tableMode.value === 'hard') {
    return [
      {
        id: '10k',
        score: 10000,
        label: '1w分（总分含操作分）',
        shortLabel: '1w',
        hpRatio: 0,
        color: '#6bbf7a',
      },
      {
        id: '20k',
        score: 20000,
        label: '2w分（总分含操作分）',
        shortLabel: '2w',
        hpRatio: 0,
        color: '#5b9bd5',
      },
      {
        id: '30k',
        score: 30000,
        label: '3w分（总分含操作分）',
        shortLabel: '3w',
        hpRatio: 0,
        color: '#e8a838',
      },
    ]
  }
  return [
    {
      id: '20k',
      score: 20000,
      label: '均2w分（总分含操作分）',
      shortLabel: '均2w',
      hpRatio: 0.2196,
      color: '#e8a838',
    },
  ]
})
const selectedBossInfo = computed(() =>
  bossList.value.find((boss) => boss.boss_name === selectedBoss.value),
)

async function loadBossList(options?: { preserveSelection?: boolean }) {
  bossListLoading.value = true
  bossError.value = ''
  const preservedBoss = options?.preserveSelection ? selectedBoss.value : ''
  if (!options?.preserveSelection) {
    selectedBoss.value = ''
    phasePoints.value = []
    selectedPhaseLabel.value = ''
  }
  try {
    bossList.value = isDeductionMode.value
      ? await fetchDeductionBossList('boss')
      : await fetchBossList(tableMode.value)
    if (preservedBoss && bossList.value.some((boss) => boss.boss_name === preservedBoss)) {
      selectedBoss.value = preservedBoss
    } else if (options?.preserveSelection) {
      selectedBoss.value = ''
      phasePoints.value = []
      selectedPhaseLabel.value = ''
    }
  } catch (error) {
    bossList.value = []
    bossError.value = error instanceof Error ? error.message : '加载怪物列表失败'
  } finally {
    bossListLoading.value = false
  }
}

async function loadBossPhases(options?: { preservePhase?: boolean }) {
  if (!selectedBoss.value) {
    phasePoints.value = []
    selectedPhaseLabel.value = ''
    return
  }
  bossChartLoading.value = true
  bossError.value = ''
  try {
    const points = isDeductionMode.value
      ? await fetchDeductionBossChart(selectedBoss.value)
      : await fetchBossChart(selectedBoss.value, tableMode.value)
    phasePoints.value = [...points].reverse()
    if (options?.preservePhase) {
      const match = phasePoints.value.find((item) => item.label === selectedPhaseLabel.value)
      if (!match) selectedPhaseLabel.value = phasePoints.value[0]?.label ?? ''
      return
    }
    const latest = phasePoints.value[0]
    selectedPhaseLabel.value = latest?.label ?? ''
    if (latest) applyTotalHpFromBoss(latest.totalHp)
  } catch (error) {
    phasePoints.value = []
    selectedPhaseLabel.value = ''
    bossError.value = error instanceof Error ? error.message : '加载怪物期数失败'
  } finally {
    bossChartLoading.value = false
  }
}

function formatHpAmount(value: number): string {
  return formatHp(Math.round(value))
}

function normalizeHpInput(raw: string): string {
  if (!raw.trim()) return ''
  const value = parseLocaleNumber(raw)
  if (value == null) return raw
  return formatHpAmount(value)
}

function restoreHpCaret(input: HTMLInputElement, formatted: string, digitsBefore: number) {
  nextTick(() => {
    if (digitsBefore <= 0) {
      input.setSelectionRange(0, 0)
      return
    }
    let seen = 0
    for (let i = 0; i < formatted.length; i += 1) {
      if (/\d/.test(formatted[i]!)) {
        seen += 1
        if (seen >= digitsBefore) {
          input.setSelectionRange(i + 1, i + 1)
          return
        }
      }
    }
    input.setSelectionRange(formatted.length, formatted.length)
  })
}

function applyHpInputFormat(event: Event | undefined, model: { value: string }) {
  const input = event?.target instanceof HTMLInputElement ? event.target : null
  const digitsBefore = input
    ? input.value.slice(0, input.selectionStart ?? input.value.length).replace(/\D/g, '').length
    : null
  model.value = normalizeHpInput(model.value)
  if (input && digitsBefore != null) restoreHpCaret(input, model.value, digitsBefore)
}

function applyTotalHpFromBoss(hp: number) {
  if (!Number.isFinite(hp) || hp <= 0) return
  applyingBossHp.value = true
  lastHpAbs.value = 'total'
  totalHpInput.value = formatHpAmount(hp)
  onTotalEdit()
  applyingBossHp.value = false
}

function onPhaseChange() {
  const point = phasePoints.value.find((item) => item.label === selectedPhaseLabel.value)
  if (point) applyTotalHpFromBoss(point.totalHp)
}

onMounted(() => {
  loadRecordColWidths()
  loadBossList()
})
watch(selectedBoss, () => {
  if (restoringMode.value) return
  loadBossPhases()
})

function parseLocaleNumber(raw: string): number | null {
  const text = raw.trim().replace(/,/g, '')
  if (!text) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

function formatHpPercent(ratio: number): string {
  return String(Number((ratio * 100).toFixed(4)))
}

function clampPercentField(raw: string): string {
  const value = parseLocaleNumber(raw)
  if (value == null) return raw
  if (value < 0) return '0'
  if (value > 100) return '100'
  return raw
}

function clampOperationScoreField(raw: string): string {
  const value = parseLocaleNumber(raw)
  if (value == null) return raw
  const max = operationScoreFieldMax()
  if (value < 0) return '0'
  if (value > max) return String(Math.round(max))
  return raw
}

/** 操作分填写上限：危局=基础满分；临界=基础满分×总倍率（填写乘完后的值） */
function operationScoreFieldMax(): number {
  return CRISIS_OPERATION_SCORE_MAX * currentTotalMultiplier()
}

/** 操作分填写默认：危局=基础默认；临界=默认×总倍率 */
function operationScoreFieldDefault(): number {
  return Math.round(CRISIS_OPERATION_SCORE_DEFAULT * currentTotalMultiplier())
}

/**
 * 当前操作分（填写框原值）。
 * 危局：未乘倍率的基础操作分；临界：已乘总倍率后的操作分贡献。
 */
function currentOperationScore(): number {
  const value = parseLocaleNumber(operationScoreInput.value)
  const fallback = operationScoreFieldDefault()
  const max = operationScoreFieldMax()
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(0, value))
}

/** 临界总倍率（危局固定为 1） */
function currentTotalMultiplier(): number {
  if (!isDeductionMode.value) return 1
  const value = parseLocaleNumber(totalMultiplierInput.value)
  if (value == null || !Number.isFinite(value) || value <= 0) return 1
  return Math.min(99, Math.max(0.01, value))
}

/** 填写总分上限 = 战斗满分×倍率 + 操作分上限（临界操作分上限已含倍率） */
function clampScoreField(raw: string): string {
  const value = parseLocaleNumber(raw)
  if (value == null) return raw
  const max = CRISIS_SCORE_MAX * currentTotalMultiplier() + operationScoreFieldMax()
  if (value < 0) return '0'
  if (value > max) return String(Math.round(max))
  return raw
}

function clampTotalMultiplierField(raw: string): string {
  const value = parseLocaleNumber(raw)
  if (value == null) return raw
  if (value < 0.01) return '0.01'
  if (value > 99) return '99'
  return raw
}

/**
 * 填写框分数 → 战斗分。
 * 危局：最终 = 战斗 + 操作 → 战斗 = 最终 − 操作
 * 临界：最终 = 战斗×倍率 + 操作(已乘倍率) → 战斗 = (最终 − 操作) / 倍率
 */
function combatScoreFromTotal(totalScore: number): number {
  if (isDeductionMode.value) {
    const mult = currentTotalMultiplier()
    const combat = (totalScore - currentOperationScore()) / mult
    return Math.min(CRISIS_SCORE_MAX, Math.max(0, combat))
  }
  return Math.min(CRISIS_SCORE_MAX, Math.max(0, totalScore - currentOperationScore()))
}

/**
 * 战斗分 → 填写框分数。
 * 危局 = 战斗 + 操作；临界 = 战斗×倍率 + 操作(填写已是乘完后)
 */
function totalScoreFromCombat(combatScore: number): number {
  if (isDeductionMode.value) {
    return Math.round(Math.round(combatScore) * currentTotalMultiplier() + currentOperationScore())
  }
  return Math.round(combatScore) + currentOperationScore()
}

function rememberHpRatio(ratio: number | null) {
  if (ratio == null || !Number.isFinite(ratio) || ratio < 0) return
  keptHpRatio.value = ratio
}

function onHpPercentEdit() {
  editing.value = 'hp'
  hpPercentInput.value = clampPercentField(hpPercentInput.value)
  const percent = parseLocaleNumber(hpPercentInput.value)
  if (percent != null) rememberHpRatio(percent / 100)
}

function onScorePercentEdit() {
  editing.value = 'scorePct'
  scorePercentInput.value = clampPercentField(scorePercentInput.value)
  const percent = parseLocaleNumber(scorePercentInput.value)
  if (percent != null) {
    rememberHpRatio(convertScoreToHpRatio(convertTableMode.value, (percent / 100) * CRISIS_SCORE_MAX).hpRatio)
  }
}

function onScoreEdit() {
  editing.value = 'score'
  scoreInput.value = clampScoreField(scoreInput.value)
  const score = parseLocaleNumber(scoreInput.value)
  if (score != null) {
    rememberHpRatio(convertScoreToHpRatio(convertTableMode.value, combatScoreFromTotal(score)).hpRatio)
  }
}

function onOperationScoreEdit() {
  operationScoreInput.value = clampOperationScoreField(operationScoreInput.value)
  // 操作分变更：若正在填总分，按新操作分重算；否则用当前占比反推总分
  if (editing.value === 'score') {
    onScoreEdit()
    return
  }
  if (result.value) {
    scoreInput.value = String(totalScoreFromCombat(result.value.score))
  }
}

function onTotalMultiplierEdit() {
  const prevMult = lastTotalMultiplier.value
  // 先记下当前战斗分，倍率/操作分变化后用它重算最终分，避免「锁死旧最终分」反推错战斗分
  const combatBefore =
    result.value && Number.isFinite(result.value.score) ? Math.round(result.value.score) : null
  totalMultiplierInput.value = clampTotalMultiplierField(totalMultiplierInput.value)
  const nextMult = currentTotalMultiplier()
  lastTotalMultiplier.value = nextMult
  // 倍率变化：按比例把「已乘完」的操作分跟着缩放，再按新上限夹紧
  if (isDeductionMode.value && prevMult > 0 && nextMult !== prevMult) {
    const scaled = parseLocaleNumber(operationScoreInput.value)
    if (scaled != null) {
      operationScoreInput.value = clampOperationScoreField(
        String(Math.round((scaled * nextMult) / prevMult)),
      )
    } else {
      operationScoreInput.value = String(operationScoreFieldDefault())
    }
  } else {
    operationScoreInput.value = clampOperationScoreField(operationScoreInput.value)
  }
  if (combatBefore != null) {
    scoreInput.value = String(totalScoreFromCombat(combatBefore))
    if (editing.value === 'score') {
      rememberHpRatio(
        convertScoreToHpRatio(convertTableMode.value, combatBefore).hpRatio,
      )
    }
    return
  }
  if (editing.value === 'score') {
    onScoreEdit()
  }
}

const result = computed<CrisisHpScoreConvertResult | null>(() => {
  if (editing.value === 'score') {
    const score = parseLocaleNumber(scoreInput.value)
    if (score == null) return null
    return convertScoreToHpRatio(convertTableMode.value, combatScoreFromTotal(score))
  }
  if (editing.value === 'scorePct') {
    const percent = parseLocaleNumber(scorePercentInput.value)
    if (percent == null) return null
    return convertScoreToHpRatio(convertTableMode.value, (percent / 100) * CRISIS_SCORE_MAX)
  }
  if (editing.value === 'abs') {
    const total = parseLocaleNumber(totalHpInput.value)
    const dealt = parseLocaleNumber(dealtHpInput.value)
    if (total == null || total <= 0 || dealt == null) return null
    return convertHpRatioToScore(convertTableMode.value, dealt / total)
  }
  const percent = parseLocaleNumber(hpPercentInput.value)
  if (percent == null) return null
  return convertHpRatioToScore(convertTableMode.value, percent / 100)
})

watch(result, (next) => {
  if (restoringMode.value || !next) return
  if (editing.value !== 'hp') {
    hpPercentInput.value = formatHpPercent(next.hpRatio)
  }
  if (editing.value !== 'score') {
    scoreInput.value = String(totalScoreFromCombat(next.score))
  }
  if (editing.value !== 'scorePct') {
    scorePercentInput.value = formatHpPercent(next.score / CRISIS_SCORE_MAX)
  }
  if (editing.value !== 'abs') {
    syncActualHpFromRatio(next.hpRatio)
  }
})

function hpRatioFromLeft(): number | null {
  if (editing.value === 'score') {
    const score = parseLocaleNumber(scoreInput.value)
    if (score == null) return null
    return convertScoreToHpRatio(convertTableMode.value, combatScoreFromTotal(score)).hpRatio
  }
  if (editing.value === 'scorePct') {
    const percent = parseLocaleNumber(scorePercentInput.value)
    if (percent == null) return null
    return convertScoreToHpRatio(convertTableMode.value, (percent / 100) * CRISIS_SCORE_MAX).hpRatio
  }
  const hpPercent = parseLocaleNumber(hpPercentInput.value)
  if (hpPercent == null) return null
  return hpPercent / 100
}

function syncActualHpFromRatio(hpRatio: number) {
  if (!Number.isFinite(hpRatio) || hpRatio < 0) return
  const total = parseLocaleNumber(totalHpInput.value)
  const dealt = parseLocaleNumber(dealtHpInput.value)
  if (total != null && total > 0) {
    dealtHpInput.value = formatHpAmount(scaleHpByRatio(total, hpRatio))
    return
  }
  if (hpRatio <= 0) return
  if (dealt != null) {
    totalHpInput.value = formatHpAmount(dealt / hpRatio)
  }
}

function clearBossSelection() {
  selectedBoss.value = ''
  phasePoints.value = []
  selectedPhaseLabel.value = ''
}

function onDealtEdit(event?: Event) {
  lastHpAbs.value = 'dealt'
  applyHpInputFormat(event, dealtHpInput)
  const total = parseLocaleNumber(totalHpInput.value)
  let dealt = parseLocaleNumber(dealtHpInput.value)
  if (total != null && total > 0 && dealt != null && dealt > total) {
    dealtHpInput.value = formatHpAmount(total)
    dealt = total
  }
  if (total != null && total > 0 && dealt != null) {
    editing.value = 'abs'
    rememberHpRatio(dealt / total)
    return
  }
  if (editing.value === 'abs') return
  if (result.value) syncActualHpFromRatio(result.value.hpRatio)
}

function onTotalEdit(event?: Event) {
  lastHpAbs.value = 'total'
  const ratio = keptHpRatio.value ?? hpRatioFromLeft()
  if (editing.value === 'abs' && ratio != null && ratio > 0) editing.value = 'hp'
  applyHpInputFormat(event, totalHpInput)
  if (!applyingBossHp.value) clearBossSelection()
  const total = parseLocaleNumber(totalHpInput.value)
  const dealt = parseLocaleNumber(dealtHpInput.value)
  if (total != null && total > 0 && ratio != null && ratio > 0) {
    dealtHpInput.value = formatHpAmount(scaleHpByRatio(total, ratio))
    return
  }
  if (total != null && total > 0 && dealt != null) {
    editing.value = 'abs'
    rememberHpRatio(dealt / total)
  }
}

function clearInputs() {
  editing.value = 'hp'
  lastHpAbs.value = null
  keptHpRatio.value = null
  hpPercentInput.value = ''
  scorePercentInput.value = ''
  scoreInput.value = ''
  totalMultiplierInput.value = '1'
  lastTotalMultiplier.value = 1
  operationScoreInput.value = String(operationScoreFieldDefault())
  totalHpInput.value = ''
  dealtHpInput.value = ''
  selectedBoss.value = ''
  phasePoints.value = []
  selectedPhaseLabel.value = ''
}

const reachedMarkers = computed(() => {
  if (!result.value) return []
  return markers.value.filter((marker) => result.value!.hpRatio + 1e-9 >= marker.hpRatio)
})

const nextMarker = computed(() => {
  if (!result.value) return null
  return markers.value.find((marker) => result.value!.hpRatio + 1e-9 < marker.hpRatio) ?? null
})

/** 战斗分（表插值结果，不含操作分） */
const roundedCombatScore = computed(() => (result.value ? Math.round(result.value.score) : null))

/** 操作分贡献：临界填写框已是乘完后的值；危局为原值 */
const scaledOperationScore = computed(() => Math.round(currentOperationScore()))

const scaledOperationScoreLabel = computed(() =>
  scaledOperationScore.value.toLocaleString('zh-CN'),
)

const operationScoreMaxLabel = computed(() =>
  Math.round(operationScoreFieldMax()).toLocaleString('zh-CN'),
)

/** 战斗分 × 总倍率 */
const scaledCombatScore = computed(() =>
  roundedCombatScore.value == null
    ? null
    : Math.round(roundedCombatScore.value * currentTotalMultiplier()),
)

/** 填写/展示总分：危局=战斗+操作；临界=战斗×倍率 + 已乘倍率的操作分 */
const roundedTotalScore = computed(() =>
  roundedCombatScore.value == null ? null : totalScoreFromCombat(roundedCombatScore.value),
)

const scoreFieldMaxLabel = computed(() =>
  Math.round(
    CRISIS_SCORE_MAX * currentTotalMultiplier() + operationScoreFieldMax(),
  ).toLocaleString('zh-CN'),
)

const formulaText = computed(() => {
  const current = result.value
  if (!current || !current.row) return ''
  const t = current.progressInSegment
  const scoreDelta = current.nextScore - current.prevScore
  return `${current.prevScore.toLocaleString('zh-CN')} + ${t.toFixed(4)} × ${scoreDelta.toLocaleString('zh-CN')} = ${current.score.toFixed(2)}`
})

/** 对应表当前插值附近最多 3 管（含节点行） */
const contextTable = computed(() => getConvertContextTableRows(convertTableMode.value, result.value))

function applyMarker(marker: CrisisScoreMarker) {
  // 危局快捷：marker.score 为含操作分的总分
  editing.value = 'score'
  scoreInput.value = String(marker.score)
  rememberHpRatio(
    convertScoreToHpRatio(convertTableMode.value, combatScoreFromTotal(marker.score)).hpRatio,
  )
}

const RECORD_LIMIT = 10
const RECORD_EMPTY_ROWS = 5
const RECORD_COL_LABELS = ['#', '已打血量', '分数占比', '伤害占比', '具体分数', '较上一条', '较下一条', '']
const RECORD_COL_DEFAULTS = [36, 140, 80, 80, 80, 220, 220, 52]
const RECORD_COL_MIN = [28, 72, 56, 56, 56, 108, 108, 44]
const RECORD_COL_WIDTH_KEY = 'zzz-crisis-record-col-widths'

const recordColWidths = ref<number[]>([...RECORD_COL_DEFAULTS])
const recordColResizing = ref(false)
let recordColDrag: { index: number; startX: number; startWidth: number } | null = null

function clampRecordColWidth(index: number, width: number) {
  return Math.max(RECORD_COL_MIN[index] ?? 48, Math.round(width))
}

function loadRecordColWidths() {
  try {
    const raw = localStorage.getItem(RECORD_COL_WIDTH_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length !== RECORD_COL_DEFAULTS.length) return
    if (!parsed.every((value) => typeof value === 'number' && Number.isFinite(value))) return
    recordColWidths.value = parsed.map((value, index) => clampRecordColWidth(index, value))
  } catch {
    /* keep defaults */
  }
}

function saveRecordColWidths() {
  localStorage.setItem(RECORD_COL_WIDTH_KEY, JSON.stringify(recordColWidths.value))
}

function onRecordColResizeStart(index: number, event: PointerEvent) {
  event.preventDefault()
  event.stopPropagation()
  recordColDrag = {
    index,
    startX: event.clientX,
    startWidth: recordColWidths.value[index] ?? RECORD_COL_DEFAULTS[index]!,
  }
  recordColResizing.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onRecordColResizeMove(event: PointerEvent) {
  if (!recordColDrag) return
  const next = recordColDrag.startWidth + (event.clientX - recordColDrag.startX)
  const widths = recordColWidths.value.slice()
  widths[recordColDrag.index] = clampRecordColWidth(recordColDrag.index, next)
  recordColWidths.value = widths
}

function onRecordColResizeEnd() {
  if (!recordColDrag) return
  recordColDrag = null
  recordColResizing.value = false
  saveRecordColWidths()
}

function resetRecordColWidth(index: number) {
  const widths = recordColWidths.value.slice()
  widths[index] = RECORD_COL_DEFAULTS[index]!
  recordColWidths.value = widths
  saveRecordColWidths()
}

const recordTableWidth = computed(() => recordColWidths.value.reduce((sum, width) => sum + width, 0))

type DeltaKind = 'up' | 'down' | 'zero' | 'empty'

function snapshotCurrent(): ModeDraft {
  return {
    editing: editing.value,
    lastHpAbs: lastHpAbs.value,
    hpPercentInput: hpPercentInput.value,
    scorePercentInput: scorePercentInput.value,
    scoreInput: scoreInput.value,
    operationScoreInput: operationScoreInput.value,
    totalHpInput: totalHpInput.value,
    dealtHpInput: dealtHpInput.value,
    selectedBoss: selectedBoss.value,
    selectedPhaseLabel: selectedPhaseLabel.value,
    records: records.value.map((row) => ({ ...row })),
    keptHpRatio: keptHpRatio.value,
    totalMultiplierInput: totalMultiplierInput.value,
  }
}

function applyDraft(draft: ModeDraft) {
  editing.value = draft.editing
  lastHpAbs.value = draft.lastHpAbs
  hpPercentInput.value = draft.hpPercentInput
  scorePercentInput.value = draft.scorePercentInput
  scoreInput.value = draft.scoreInput
  operationScoreInput.value =
    draft.operationScoreInput?.trim() || String(operationScoreFieldDefault())
  totalMultiplierInput.value = draft.totalMultiplierInput?.trim() || '1'
  lastTotalMultiplier.value = currentTotalMultiplier()
  totalHpInput.value = draft.totalHpInput
  dealtHpInput.value = draft.dealtHpInput
  selectedBoss.value = draft.selectedBoss
  selectedPhaseLabel.value = draft.selectedPhaseLabel
  records.value = draft.records.map((row) => ({ ...row }))
  keptHpRatio.value = draft.keptHpRatio
  if (keptHpRatio.value == null) {
    const percent = parseLocaleNumber(draft.hpPercentInput)
    if (percent != null) keptHpRatio.value = percent / 100
  }
}

async function setTableMode(next: CrisisScoreTableMode) {
  if (next === tableMode.value) return
  modeDrafts[tableMode.value] = snapshotCurrent()
  restoringMode.value = true
  tableMode.value = next
  applyDraft(modeDrafts[next])
  try {
    await loadBossList({ preserveSelection: true })
    if (selectedBoss.value) await loadBossPhases({ preservePhase: true })
  } finally {
    restoringMode.value = false
  }
}

function recordNow() {
  if (!result.value || records.value.length >= RECORD_LIMIT) return
  recordSeq.value += 1
  records.value.push({
    id: recordSeq.value,
    dealtHp: parseLocaleNumber(dealtHpInput.value),
    hpRatio: result.value.hpRatio,
    scoreRatio: result.value.score / CRISIS_SCORE_MAX,
    score: totalScoreFromCombat(result.value.score),
  })
}

function removeRecord(id: number) {
  records.value = records.value.filter((row) => row.id !== id)
}

function clearRecords() {
  records.value = []
}

function formatDealtDelta(
  current: number | null,
  other: number | null | undefined,
): { text: string; kind: DeltaKind } {
  if (current == null || other == null) return { text: '—', kind: 'empty' }
  const delta = current - other
  if (delta === 0) return { text: '0', kind: 'zero' }
  const sign = delta > 0 ? '+' : '-'
  let text = `${sign}${formatHpAmount(Math.abs(delta))}`
  if (other > 0) {
    const value = (delta / other) * 100
    const pctSign = value >= 0 ? '+' : ''
    text = `${text}（${pctSign}${value.toFixed(2)}%）`
  }
  return { text, kind: delta > 0 ? 'up' : 'down' }
}

function prevCompare(index: number) {
  return formatDealtDelta(records.value[index]!.dealtHp, records.value[index - 1]?.dealtHp)
}

function nextCompare(index: number) {
  return formatDealtDelta(records.value[index]!.dealtHp, records.value[index + 1]?.dealtHp)
}

const recordRows = computed(() =>
  records.value.map((rec, index) => ({
    rec,
    index,
    prev: prevCompare(index),
    next: nextCompare(index),
  })),
)

const emptyRecordCount = computed(() => Math.max(0, RECORD_EMPTY_ROWS - records.value.length))

const panelDesc = computed(() => {
  if (isDeductionMode.value) {
    return `临界单一换算：战斗分满分 ${CRISIS_SCORE_MAX.toLocaleString('zh-CN')}；操作分填写乘总倍率后的值（基础默认 ${CRISIS_OPERATION_SCORE_DEFAULT.toLocaleString('zh-CN')}）；最终分 = 战斗分×总倍率 + 操作分；怪物仅接入临界 Boss`
  }
  return tableMode.value === 'hard'
    ? `绝境：战斗分满分 ${CRISIS_SCORE_MAX.toLocaleString('zh-CN')} + 操作分（最高 ${CRISIS_OPERATION_SCORE_MAX.toLocaleString('zh-CN')}）＝总分最高 ${CRISIS_TOTAL_SCORE_MAX.toLocaleString('zh-CN')}；1w/2w/3w 为含操作分的总分快捷`
    : `战斗分满分 ${CRISIS_SCORE_MAX.toLocaleString('zh-CN')} + 操作分（默认 ${CRISIS_OPERATION_SCORE_DEFAULT.toLocaleString('zh-CN')}）＝总分最高 ${CRISIS_TOTAL_SCORE_MAX.toLocaleString('zh-CN')}；均2w 为含操作分的总分（满星 S）`
})
</script>

<template>
  <div class="score-convert-panel">
    <header class="panel-header">
      <h1 class="page-title">{{ pageTitle }}</h1>
      <p class="panel-desc">{{ panelDesc }}</p>
      <div class="header-actions">
        <div
          v-if="!isDeductionMode"
          class="mode-toggle"
          role="group"
          aria-label="转换器模式"
        >
          <button
            type="button"
            class="mode-btn"
            :class="{ active: tableMode === 'normal' }"
            @click="setTableMode('normal')"
          >
            正常
          </button>
          <button
            type="button"
            class="mode-btn"
            :class="{ active: tableMode === 'hard' }"
            @click="setTableMode('hard')"
          >
            绝境
          </button>
        </div>
        <button type="button" class="clear-btn" @click="clearInputs">清空</button>
      </div>
    </header>

    <div class="convert-grid">
      <section class="convert-card">
        <h2 class="card-title">占比</h2>
        <label class="field">
          <span>血量占比</span>
          <span class="field-input percent-short">
            <input
              v-model="hpPercentInput"
              type="text"
              inputmode="decimal"
              aria-label="血量占比"
              @focus="onHpPercentEdit"
              @input="onHpPercentEdit"
            />
            <span class="suffix">%</span>
          </span>
        </label>
        <label class="field">
          <span>分数占比</span>
          <span class="field-input percent-short">
            <input
              v-model="scorePercentInput"
              type="text"
              inputmode="decimal"
              aria-label="分数占比"
              @focus="onScorePercentEdit"
              @input="onScorePercentEdit"
            />
            <span class="suffix">%</span>
          </span>
        </label>
        <label v-if="isDeductionMode" class="field">
          <span>总倍率</span>
          <span class="field-input score-short">
            <input
              v-model="totalMultiplierInput"
              class="score-input-short"
              type="text"
              inputmode="decimal"
              maxlength="6"
              aria-label="总倍率"
              @focus="onTotalMultiplierEdit"
              @input="onTotalMultiplierEdit"
            />
            <span class="suffix">×</span>
          </span>
        </label>
        <label class="field">
          <span>{{ isDeductionMode ? '操作分（已×倍率）' : '操作分' }}</span>
          <span class="field-input score-short">
            <input
              v-model="operationScoreInput"
              class="score-input-short"
              type="text"
              inputmode="numeric"
              :maxlength="isDeductionMode ? 7 : 4"
              :aria-label="isDeductionMode ? '操作分（已乘总倍率）' : '操作分'"
              @focus="onOperationScoreEdit"
              @input="onOperationScoreEdit"
            />
            <span class="suffix">/ {{ operationScoreMaxLabel }}</span>
          </span>
        </label>
        <p class="field-hint">
          <template v-if="isDeductionMode">
            操作分直接填乘完总倍率后的值；最终分 = 战斗分×倍率 + 操作分
          </template>
          <template v-else>
            操作分额外计入总分，不参与分数占比；换算时先加减操作分再插值
          </template>
        </p>
        <label class="field">
          <span>{{ isDeductionMode ? '最终分数' : '分数' }}</span>
          <div class="score-line">
            <span class="field-input score-short">
              <input
                v-model="scoreInput"
                class="score-input-short"
                type="text"
                inputmode="numeric"
                :maxlength="isDeductionMode ? 7 : 5"
                :aria-label="isDeductionMode ? '最终分数' : '分数'"
                @focus="onScoreEdit"
                @input="onScoreEdit"
              />
              <span class="suffix">/ {{ scoreFieldMaxLabel }}</span>
            </span>
            <div
              v-if="converterMarkers.length"
              class="marker-row"
              role="group"
              aria-label="快捷填入节点分数"
            >
              <button
                v-for="marker in converterMarkers"
                :key="marker.id"
                type="button"
                class="marker-chip"
                :style="{ '--marker-color': marker.color }"
                @click="applyMarker(marker)"
              >
                {{ marker.shortLabel }}
              </button>
            </div>
          </div>
        </label>
        <p class="field-hint">
          占比三项填 1
          <template v-if="isDeductionMode">
            ；分数为最终分（战斗×倍率 + 已乘倍率的操作分）
          </template>
          <template v-else>；分数为总分（战斗分+操作分）</template>
        </p>
      </section>

      <section class="convert-card">
        <h2 class="card-title">实际血量</h2>
        <label class="field">
          <span>怪物</span>
          <span class="field-input">
            <img
              v-if="selectedBossInfo?.boss_image"
              :src="resolveAssetUrl(selectedBossInfo.boss_image)"
              :alt="selectedBoss"
              class="boss-thumb"
            />
            <select
              v-model="selectedBoss"
              class="boss-select"
              :aria-label="isDeductionMode ? '选择临界 Boss' : '从数据库选择怪物'"
              :disabled="bossListLoading || !bossList.length"
            >
              <option value="">
                {{
                  bossListLoading
                    ? '加载中…'
                    : isDeductionMode
                      ? '选择临界 Boss'
                      : '从数据库选择'
                }}
              </option>
              <option v-for="boss in bossList" :key="boss.boss_name" :value="boss.boss_name">
                {{ boss.boss_name }}
              </option>
            </select>
          </span>
        </label>
        <label class="field">
          <span>{{ isDeductionMode ? '出现期数' : '期数' }}</span>
          <select
            v-model="selectedPhaseLabel"
            class="boss-select"
            :aria-label="isDeductionMode ? '选择 Boss 出现期数' : '选择怪物出现期数'"
            :disabled="!phasePoints.length || bossChartLoading"
            @change="onPhaseChange"
          >
            <option value="">{{ bossChartLoading ? '加载中…' : '选择期数' }}</option>
            <option v-for="point in phasePoints" :key="point.label" :value="point.label">
              {{ point.label }} · {{ formatHp(point.totalHp) }}
            </option>
          </select>
        </label>
        <p v-if="bossError" class="boss-error">{{ bossError }}</p>
        <div class="hp-row">
          <label class="field">
            <span>已打血量</span>
            <input
              v-model="dealtHpInput"
              type="text"
              inputmode="numeric"
              aria-label="已打血量"
              @focus="onDealtEdit"
              @input="onDealtEdit"
            />
          </label>
          <label class="field">
            <span>总血量</span>
            <input
              v-model="totalHpInput"
              type="text"
              inputmode="numeric"
              aria-label="总血量"
              @focus="onTotalEdit"
              @input="onTotalEdit"
            />
          </label>
        </div>
        <p class="field-hint">总血量优先。改占比时已打血量跟着变；改已打血量时占比跟着变。</p>
      </section>
    </div>

    <section class="status-card">
      <div class="record-head">
        <h2 class="card-title">计算过程</h2>
        <button
          type="button"
          class="record-btn"
          :aria-expanded="processOpen"
          @click="processOpen = !processOpen"
        >
          {{ processOpen ? '收起' : '展开' }}
        </button>
      </div>
      <template v-if="processOpen">
      <template v-if="result">
        <p class="status-main">{{ describeConvertSegment(result) }}</p>
        <p class="status-line">
          已打血量 {{ formatPercent(result.hpRatio, 4) }} · 战斗
          {{ (roundedCombatScore ?? 0).toLocaleString('zh-CN') }} 分
          <template v-if="isDeductionMode">
            · 总倍率 {{ currentTotalMultiplier() }} · 战斗×倍率
            {{ (scaledCombatScore ?? 0).toLocaleString('zh-CN') }} · 操作分
            {{ scaledOperationScoreLabel }} · 最终
            {{ (roundedTotalScore ?? 0).toLocaleString('zh-CN') }} 分
          </template>
          <template v-else>
            · 总分 {{ (roundedTotalScore ?? 0).toLocaleString('zh-CN') }} 分
          </template>
          <template v-if="result.row">
            · 本段进度 {{ (result.progressInSegment * 100).toFixed(2) }}%
          </template>
        </p>
        <p class="status-line">
          插值区间：{{ formatPercent(result.prevHp, 4) }} / {{ result.prevScore.toLocaleString('zh-CN') }} 分
          → {{ formatPercent(result.nextHp, 4) }} / {{ result.nextScore.toLocaleString('zh-CN') }} 分
        </p>
        <p v-if="formulaText" class="status-formula">{{ formulaText }}</p>
        <div v-if="contextTable.rows.length" class="context-table-wrap">
          <p class="status-line context-table-title">对应表 · 附近三管</p>
          <div class="context-table-scroll">
            <table class="context-table">
              <colgroup>
                <col class="col-bar" />
                <col class="col-score" />
                <col class="col-score-ratio" />
                <col class="col-hp-ratio" />
                <col class="col-eff" />
                <col class="col-cum-score" />
                <col class="col-cum-hp" />
              </colgroup>
              <thead>
                <tr>
                  <th>第几管血</th>
                  <th>分数</th>
                  <th>分数占比</th>
                  <th>血量占比</th>
                  <th>分数/血量</th>
                  <th>已得分数</th>
                  <th>已打血量</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, index) in contextTable.rows"
                  :key="`${convertTableMode}-${formatCrisisScoreBarLabel(row)}-${row.cumulativeScore}-${index}`"
                  :class="{
                    'is-current': index === contextTable.currentIndex,
                    'is-milestone': row.isMilestone,
                  }"
                >
                  <td>{{ formatCrisisScoreBarLabel(row) }}</td>
                  <td>{{ row.score.toLocaleString('zh-CN') }}</td>
                  <td>{{ formatPercent(row.scoreRatio) }}</td>
                  <td>{{ formatPercent(row.hpRatio) }}</td>
                  <td>{{ formatScorePerHp(row.scorePerHp) }}</td>
                  <td :class="{ 'is-node-score': row.isMilestone }">
                    {{ row.cumulativeScore.toLocaleString('zh-CN') }}
                  </td>
                  <td>{{ formatPercent(row.cumulativeHp) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p v-if="reachedMarkers.length" class="status-line">
          已过节点：{{ reachedMarkers.map((marker) => marker.label).join('、') }}
        </p>
        <p v-else class="status-line">尚未到达分数节点</p>
        <p v-if="nextMarker" class="status-line">
          下一节点：{{ nextMarker.label }}（还需
          {{ formatPercent(nextMarker.hpRatio - result.hpRatio, 4) }} 血量）
        </p>
      </template>
      <p v-else class="status-line">等待填入数据</p>
      </template>
    </section>

    <section class="status-card record-card">
      <div class="record-head">
        <h2 class="card-title">换算记录</h2>
        <div class="record-actions">
          <button
            type="button"
            class="record-btn"
            :disabled="!result || records.length >= RECORD_LIMIT"
            @click="recordNow"
          >
            记录
          </button>
          <button
            type="button"
            class="record-btn danger"
            :disabled="!records.length"
            @click="clearRecords"
          >
            清空
          </button>
        </div>
      </div>
      <p class="record-hint">最多记录 10 条。较上一条 / 较下一条以已打血量为基准。表头竖线可拖动调整列宽。</p>
      <div class="record-table-wrap">
        <table
          class="record-table"
          :class="{ 'is-resizing': recordColResizing }"
          :style="{ width: `${recordTableWidth}px` }"
        >
          <colgroup>
            <col v-for="(width, index) in recordColWidths" :key="index" :style="{ width: `${width}px` }" />
          </colgroup>
          <thead>
            <tr>
              <th v-for="(label, index) in RECORD_COL_LABELS" :key="index">
                {{ label }}
                <span
                  v-if="index < RECORD_COL_LABELS.length - 1"
                  class="col-resizer"
                  aria-hidden="true"
                  @pointerdown="onRecordColResizeStart(index, $event)"
                  @pointermove="onRecordColResizeMove"
                  @pointerup="onRecordColResizeEnd"
                  @pointercancel="onRecordColResizeEnd"
                  @dblclick.stop.prevent="resetRecordColWidth(index)"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in recordRows" :key="row.rec.id">
              <td>{{ row.index + 1 }}</td>
              <td>{{ row.rec.dealtHp == null ? '—' : formatHpAmount(row.rec.dealtHp) }}</td>
              <td>{{ formatPercent(row.rec.scoreRatio, 2) }}</td>
              <td>{{ formatPercent(row.rec.hpRatio, 2) }}</td>
              <td>{{ row.rec.score.toLocaleString('zh-CN') }}</td>
              <td class="delta-cell" :class="`delta-${row.prev.kind}`">{{ row.prev.text }}</td>
              <td class="delta-cell" :class="`delta-${row.next.kind}`">{{ row.next.text }}</td>
              <td>
                <button type="button" class="row-del-btn" aria-label="删除这条记录" @click="removeRecord(row.rec.id)">
                  删除
                </button>
              </td>
            </tr>
            <tr v-for="n in emptyRecordCount" :key="`empty-${n}`" class="record-empty">
              <td>{{ records.length + n }}</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.score-convert-panel {
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: 0.5rem 0.35rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  box-sizing: border-box;
}

.panel-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  text-align: center;
}

.page-title {
  font-size: clamp(1.15rem, 2.6vw, 1.7rem);
  font-weight: 700;
  color: var(--color-heading);
  letter-spacing: 0.03em;
}

.panel-desc {
  font-size: 0.82rem;
  color: var(--color-text);
  opacity: 0.72;
  line-height: 1.45;
  white-space: nowrap;
}

.mode-toggle {
  display: inline-flex;
  padding: 0.15rem;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background);
}

.mode-btn {
  min-width: 4.5rem;
  padding: 0.35rem 0.85rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}

.mode-btn:hover {
  background: var(--color-background-mute);
}

.mode-btn.active {
  background: var(--color-background-soft);
  color: var(--color-heading);
  box-shadow: inset 0 0 0 1px var(--color-border);
}

.header-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  flex-wrap: wrap;
}

.clear-btn {
  min-width: 4.5rem;
  padding: 0.35rem 0.85rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
}

.clear-btn:hover {
  background: var(--color-background-mute);
}

.marker-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.35rem;
  margin-left: auto;
}

.marker-chip {
  padding: 0.28rem 0.7rem;
  border: 1px solid color-mix(in srgb, var(--marker-color, #e8a838) 55%, var(--color-border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--marker-color, #e8a838) 16%, transparent);
  color: var(--color-heading);
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}

.marker-chip:hover {
  background: color-mix(in srgb, var(--marker-color, #e8a838) 28%, transparent);
}

.convert-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem;
}

.convert-card,
.status-card {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 0.95rem 1rem 1.05rem;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.card-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 800;
  color: var(--color-heading);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text);
  opacity: 0.88;
}

.field--grow {
  flex: 1;
  min-width: 0;
}

.field-input {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.field input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  font-size: 1rem;
  font-weight: 700;
}

.field input:focus {
  outline: 2px solid color-mix(in srgb, #e8a838 55%, transparent);
  outline-offset: 1px;
}

.boss-select {
  flex: 1;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  font-size: 0.92rem;
  font-weight: 700;
}

.boss-select:focus {
  outline: 2px solid color-mix(in srgb, #e8a838 55%, transparent);
  outline-offset: 1px;
}

.boss-thumb {
  width: 2.1rem;
  height: 2.1rem;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--color-border);
}

.boss-error {
  margin: 0;
  font-size: 0.75rem;
  color: #c62828;
}

.suffix {
  font-size: 0.9rem;
  font-weight: 800;
  color: var(--color-heading);
}

.hp-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.55rem;
}

.score-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  width: 100%;
}

.score-short {
  flex: 0 0 auto;
}

.percent-short {
  width: fit-content;
}

.percent-short input {
  width: 10ch;
  min-width: 10ch;
  flex: none;
}

.score-input-short,
.score-short input {
  width: 9ch;
  min-width: 9ch;
  flex: none;
}

.field-hint {
  margin: 0;
  padding: 0.4rem 0.55rem;
  border-radius: 8px;
  background: color-mix(in srgb, #e8a838 18%, transparent);
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1.4;
  color: #b57914;
  opacity: 1;
}

.status-main {
  margin: 0;
  font-size: 1.02rem;
  font-weight: 800;
  color: var(--color-heading);
}

.status-line {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.45;
  color: var(--color-text);
  opacity: 0.82;
}

.status-formula {
  margin: 0.15rem 0 0;
  font-family: var(--zzz-font-mono, ui-monospace, monospace);
  font-size: 0.8rem;
  color: var(--color-heading);
}

.context-table-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-top: 0.15rem;
}

.context-table-title {
  font-weight: 700;
  opacity: 0.9;
}

.context-table-scroll {
  width: 100%;
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft);
}

.context-table {
  width: 100%;
  min-width: 0;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 0.78rem;
}

.context-table .col-bar {
  width: 11%;
}
.context-table .col-score {
  width: 11%;
}
.context-table .col-score-ratio,
.context-table .col-hp-ratio {
  width: 13%;
}
.context-table .col-eff {
  width: 15%;
}
.context-table .col-cum-score {
  width: 14%;
}
.context-table .col-cum-hp {
  width: 13%;
}

.context-table th,
.context-table td {
  padding: 0.38rem 0.35rem;
  border-bottom: 1px solid var(--color-border);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}

.context-table thead th {
  font-weight: 700;
  color: var(--color-heading);
  background: color-mix(in srgb, var(--color-background) 55%, transparent);
}

.context-table tbody tr:last-child td {
  border-bottom: none;
}

.context-table tbody tr.is-current {
  background: color-mix(in srgb, #c9a55c 18%, transparent);
}

.context-table tbody tr.is-milestone td {
  color: var(--color-heading);
}

.context-table td.is-node-score {
  font-weight: 800;
  color: #c9a55c;
}

.record-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.record-actions {
  display: flex;
  gap: 0.35rem;
}

.record-btn {
  min-width: 3.6rem;
  padding: 0.28rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}

.record-btn:hover:not(:disabled) {
  background: var(--color-background-mute);
}

.record-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.record-btn.danger {
  color: #c62828;
  border-color: color-mix(in srgb, #c62828 35%, var(--color-border));
}

.record-hint {
  margin: 0;
  font-size: 0.78rem;
  color: var(--color-text);
  opacity: 0.72;
}

.record-table-wrap {
  overflow-x: auto;
}

.record-table {
  table-layout: fixed;
  width: max-content;
  border-collapse: collapse;
  font-size: 0.78rem;
  color: var(--color-heading);
}

.record-table.is-resizing {
  user-select: none;
}

.record-table th {
  position: relative;
}

.col-resizer {
  position: absolute;
  top: 0;
  right: -5px;
  width: 10px;
  height: 100%;
  cursor: col-resize;
  z-index: 2;
}

.col-resizer::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background: var(--color-border);
}

.col-resizer:hover::before,
.col-resizer:active::before {
  width: 2px;
  background: #e8a838;
}

.record-table th,
.record-table td {
  padding: 0.38rem 0.4rem;
  border-bottom: 1px solid var(--color-border);
  text-align: left;
  white-space: nowrap;
  overflow: visible;
  font-variant-numeric: tabular-nums;
  vertical-align: middle;
}

.record-table th {
  font-weight: 700;
  color: color-mix(in srgb, var(--color-text) 78%, transparent);
}

.record-empty td {
  color: var(--color-text);
  opacity: 0.38;
  font-weight: 500;
}

.row-del-btn {
  padding: 0.12rem 0.35rem;
  border: 1px solid color-mix(in srgb, #c62828 35%, var(--color-border));
  border-radius: 6px;
  background: transparent;
  color: #c62828;
  font-size: 0.7rem;
  font-weight: 700;
  cursor: pointer;
}

.row-del-btn:hover {
  background: color-mix(in srgb, #c62828 12%, transparent);
}

.delta-up {
  color: #2e7d32;
  font-weight: 700;
}

.delta-down {
  color: #c62828;
  font-weight: 700;
}

.delta-zero,
.delta-empty {
  color: var(--color-text);
  opacity: 0.7;
}

@media (max-width: 768px) {
  .score-convert-panel {
    padding: 0.25rem 0.1rem 0.9rem;
  }

  .convert-grid {
    grid-template-columns: 1fr;
  }

  .score-line {
    flex-wrap: wrap;
  }
}
</style>
