/** 危局强袭战：分数与血量对应表 */

export interface CrisisScoreHpRow {
  /** 第几管血；无编号的为阶段节点分 */
  bar: number | null
  /** 本段分数 */
  score: number
  /** 本段分数占比（相对满分） */
  scoreRatio: number
  /** 本段血量占比 */
  hpRatio: number
  /** 分数/血量效率；节点行可能为空 */
  scorePerHp: number | null
  /** 累计已得分数 */
  cumulativeScore: number
  /** 累计已打血量占比 */
  cumulativeHp: number
  /** 是否为阶段节点（无管数） */
  isMilestone: boolean
}

export type CrisisScoreTableMode = 'normal' | 'hard'

export interface CrisisScoreMarker {
  id: string
  score: number
  /** 图表/详情完整说明 */
  label: string
  /** 图例短标签 */
  shortLabel: string
  /** 累计已打血量占比 */
  hpRatio: number
  color: string
}

export const CRISIS_SCORE_MAX = 60000

/** 操作分上限 / 默认（额外分，不计入分数占比与血量表插值） */
export const CRISIS_OPERATION_SCORE_MAX = 5000
export const CRISIS_OPERATION_SCORE_DEFAULT = 5000

/** 填写总分上限 = 战斗分满分 + 操作分上限 */
export const CRISIS_TOTAL_SCORE_MAX = CRISIS_SCORE_MAX + CRISIS_OPERATION_SCORE_MAX

/** 正常模式：满星 S（2 万分战斗分）所需累计血量占比 → FS-HP */
export const FS_HP_RATIO_NORMAL = 0.2812

export const crisisScoreHpTableNormal: CrisisScoreHpRow[] = [
  { bar: 1, score: 1000, scoreRatio: 0.016667, hpRatio: 0.0137, scorePerHp: 1.21389, cumulativeScore: 1000, cumulativeHp: 0.01372997, isMilestone: false },
  { bar: 2, score: 1000, scoreRatio: 0.016667, hpRatio: 0.0137, scorePerHp: 1.21389, cumulativeScore: 2000, cumulativeHp: 0.0274, isMilestone: false },
  { bar: 3, score: 1000, scoreRatio: 0.016667, hpRatio: 0.0137, scorePerHp: 1.21389, cumulativeScore: 3000, cumulativeHp: 0.0411, isMilestone: false },
  { bar: 4, score: 1000, scoreRatio: 0.016667, hpRatio: 0.0137, scorePerHp: 1.21389, cumulativeScore: 4000, cumulativeHp: 0.0548, isMilestone: false },
  { bar: 5, score: 1200, scoreRatio: 0.02, hpRatio: 0.0195, scorePerHp: 1.02823, cumulativeScore: 5200, cumulativeHp: 0.0743, isMilestone: false },
  { bar: 6, score: 1200, scoreRatio: 0.02, hpRatio: 0.0195, scorePerHp: 1.02823, cumulativeScore: 6400, cumulativeHp: 0.0938, isMilestone: false },
  { bar: 7, score: 1200, scoreRatio: 0.02, hpRatio: 0.0195, scorePerHp: 1.02823, cumulativeScore: 7600, cumulativeHp: 0.1133, isMilestone: false },
  { bar: 8, score: 1200, scoreRatio: 0.02, hpRatio: 0.0195, scorePerHp: 1.02823, cumulativeScore: 8800, cumulativeHp: 0.1328, isMilestone: false },
  { bar: 9, score: 1800, scoreRatio: 0.03, hpRatio: 0.0252, scorePerHp: 1.191818, cumulativeScore: 10600, cumulativeHp: 0.158, isMilestone: false },
  { bar: 10, score: 1800, scoreRatio: 0.03, hpRatio: 0.0252, scorePerHp: 1.191818, cumulativeScore: 12400, cumulativeHp: 0.1832, isMilestone: false },
  { bar: 11, score: 1800, scoreRatio: 0.03, hpRatio: 0.0252, scorePerHp: 1.191818, cumulativeScore: 14200, cumulativeHp: 0.2084, isMilestone: false },
  { bar: null, score: 800, scoreRatio: 800 / CRISIS_SCORE_MAX, hpRatio: 0.0112, scorePerHp: null, cumulativeScore: 15000, cumulativeHp: 0.2196, isMilestone: true },
  { bar: 12, score: 1800, scoreRatio: 0.03, hpRatio: 0.0252, scorePerHp: 1.191818, cumulativeScore: 16000, cumulativeHp: 0.2336, isMilestone: false },
  { bar: 13, score: 2400, scoreRatio: 0.04, hpRatio: 0.0286, scorePerHp: 1.3984, cumulativeScore: 18400, cumulativeHp: 0.2622, isMilestone: false },
  { bar: null, score: 1600, scoreRatio: 1600 / CRISIS_SCORE_MAX, hpRatio: 0.019, scorePerHp: null, cumulativeScore: 20000, cumulativeHp: 0.2812, isMilestone: true },
  { bar: 14, score: 2400, scoreRatio: 0.04, hpRatio: 0.0286, scorePerHp: 1.3984, cumulativeScore: 20800, cumulativeHp: 0.2908, isMilestone: false },
  { bar: 15, score: 2400, scoreRatio: 0.04, hpRatio: 0.0286, scorePerHp: 1.3984, cumulativeScore: 23200, cumulativeHp: 0.3194, isMilestone: false },
  { bar: 16, score: 2400, scoreRatio: 0.04, hpRatio: 0.0286, scorePerHp: 1.3984, cumulativeScore: 25600, cumulativeHp: 0.348, isMilestone: false },
  { bar: 17, score: 2600, scoreRatio: 0.04333334, hpRatio: 0.0343, scorePerHp: 1.2624445, cumulativeScore: 28200, cumulativeHp: 0.3823, isMilestone: false },
  { bar: 18, score: 2600, scoreRatio: 0.04333334, hpRatio: 0.0343, scorePerHp: 1.2624445, cumulativeScore: 30800, cumulativeHp: 0.4166, isMilestone: false },
  { bar: 19, score: 2600, scoreRatio: 0.04333334, hpRatio: 0.0343, scorePerHp: 1.2624445, cumulativeScore: 33400, cumulativeHp: 0.4509, isMilestone: false },
  { bar: 20, score: 2600, scoreRatio: 0.04333334, hpRatio: 0.0343, scorePerHp: 1.2624445, cumulativeScore: 36000, cumulativeHp: 0.4852, isMilestone: false },
  { bar: 21, score: 2600, scoreRatio: 0.04333334, hpRatio: 0.0572, scorePerHp: 0.7574698, cumulativeScore: 38600, cumulativeHp: 0.5424, isMilestone: false },
  { bar: 22, score: 2600, scoreRatio: 0.04333334, hpRatio: 0.0572, scorePerHp: 0.7574698, cumulativeScore: 41200, cumulativeHp: 0.5996, isMilestone: false },
  { bar: 23, score: 2600, scoreRatio: 0.04333334, hpRatio: 0.0572, scorePerHp: 0.7574698, cumulativeScore: 43800, cumulativeHp: 0.6568, isMilestone: false },
  { bar: 24, score: 2700, scoreRatio: 0.045, hpRatio: 0.0572, scorePerHp: 0.786603, cumulativeScore: 46500, cumulativeHp: 0.714, isMilestone: false },
  { bar: 25, score: 2700, scoreRatio: 0.045, hpRatio: 0.0572, scorePerHp: 0.786603, cumulativeScore: 49200, cumulativeHp: 0.7712, isMilestone: false },
  { bar: 26, score: 2700, scoreRatio: 0.045, hpRatio: 0.0572, scorePerHp: 0.786603, cumulativeScore: 51900, cumulativeHp: 0.8284, isMilestone: false },
  { bar: 27, score: 2700, scoreRatio: 0.045, hpRatio: 0.0572, scorePerHp: 0.786603, cumulativeScore: 54600, cumulativeHp: 0.8856, isMilestone: false },
  { bar: 28, score: 2700, scoreRatio: 0.045, hpRatio: 0.0572, scorePerHp: 0.786603, cumulativeScore: 57300, cumulativeHp: 0.9428, isMilestone: false },
  { bar: 29, score: 2700, scoreRatio: 0.045, hpRatio: 0.0572, scorePerHp: 0.786603, cumulativeScore: 60000, cumulativeHp: 1, isMilestone: false },
]

/** @deprecated 使用 crisisScoreHpTableNormal */
export const crisisScoreHpTable = crisisScoreHpTableNormal

/** 绝境模式：与《分数与血量.xlsx》「困难」表一致；折线节点仍为 0.5万 / 1.5万 / 2.5万 */
export const crisisScoreHpTableHard: CrisisScoreHpRow[] = [
  { bar: 1, score: 750, scoreRatio: 0.0125, hpRatio: 0.02278, scorePerHp: 0.548245, cumulativeScore: 750, cumulativeHp: 0.0228, isMilestone: false },
  { bar: 2, score: 750, scoreRatio: 0.0125, hpRatio: 0.02278, scorePerHp: 0.548245, cumulativeScore: 1500, cumulativeHp: 0.0456, isMilestone: false },
  { bar: 3, score: 750, scoreRatio: 0.0125, hpRatio: 0.02278, scorePerHp: 0.548245, cumulativeScore: 2250, cumulativeHp: 0.0684, isMilestone: false },
  { bar: 4, score: 750, scoreRatio: 0.0125, hpRatio: 0.02278, scorePerHp: 0.548245, cumulativeScore: 3000, cumulativeHp: 0.0912, isMilestone: false },
  { bar: 5, score: 1000, scoreRatio: 0.0167, hpRatio: 0.02278, scorePerHp: 0.548245, cumulativeScore: 4000, cumulativeHp: 0.114, isMilestone: false },
  { bar: 6, score: 1000, scoreRatio: 0.0167, hpRatio: 0.02278, scorePerHp: 0.548245, cumulativeScore: 5000, cumulativeHp: 0.1368, isMilestone: true },
  { bar: 7, score: 1000, scoreRatio: 0.0167, hpRatio: 0.02278, scorePerHp: 0.548245, cumulativeScore: 6000, cumulativeHp: 0.1596, isMilestone: false },
  { bar: 8, score: 1000, scoreRatio: 0.0167, hpRatio: 0.02278, scorePerHp: 0.548245, cumulativeScore: 7000, cumulativeHp: 0.1824, isMilestone: false },
  { bar: 9, score: 1500, scoreRatio: 0.025, hpRatio: 0.0228, scorePerHp: 1.0965, cumulativeScore: 8500, cumulativeHp: 0.2052, isMilestone: false },
  { bar: 10, score: 1500, scoreRatio: 0.025, hpRatio: 0.0228, scorePerHp: 1.0965, cumulativeScore: 10000, cumulativeHp: 0.228, isMilestone: false },
  { bar: 11, score: 3500, scoreRatio: 0.0583, hpRatio: 0.0379, scorePerHp: 1.53825, cumulativeScore: 13500, cumulativeHp: 0.2659, isMilestone: false },
  { bar: null, score: 1500, scoreRatio: 1500 / CRISIS_SCORE_MAX, hpRatio: 0.016242, scorePerHp: null, cumulativeScore: 15000, cumulativeHp: 0.2821, isMilestone: true },
  { bar: 12, score: 3500, scoreRatio: 0.0583, hpRatio: 0.0379, scorePerHp: 1.53825, cumulativeScore: 17000, cumulativeHp: 0.3038, isMilestone: false },
  { bar: 13, score: 3500, scoreRatio: 0.0583, hpRatio: 0.0379, scorePerHp: 1.53825, cumulativeScore: 20500, cumulativeHp: 0.3417, isMilestone: false },
  { bar: 14, score: 3500, scoreRatio: 0.0583, hpRatio: 0.0379, scorePerHp: 1.53825, cumulativeScore: 24000, cumulativeHp: 0.3796, isMilestone: false },
  { bar: null, score: 1000, scoreRatio: 1000 / CRISIS_SCORE_MAX, hpRatio: 0.0145, scorePerHp: null, cumulativeScore: 25000, cumulativeHp: 0.3941, isMilestone: true },
  { bar: 15, score: 3500, scoreRatio: 0.0583, hpRatio: 0.0507, scorePerHp: 1.149901, cumulativeScore: 27500, cumulativeHp: 0.4303, isMilestone: false },
  { bar: 16, score: 3500, scoreRatio: 0.0583, hpRatio: 0.06329, scorePerHp: 0.921011, cumulativeScore: 31000, cumulativeHp: 0.4936, isMilestone: false },
  { bar: 17, score: 3500, scoreRatio: 0.0583, hpRatio: 0.06329, scorePerHp: 0.921011, cumulativeScore: 34500, cumulativeHp: 0.5569, isMilestone: false },
  { bar: 18, score: 3500, scoreRatio: 0.0583, hpRatio: 0.06329, scorePerHp: 0.921011, cumulativeScore: 38000, cumulativeHp: 0.6202, isMilestone: false },
  { bar: 19, score: 3500, scoreRatio: 0.0583, hpRatio: 0.06329, scorePerHp: 0.921011, cumulativeScore: 41500, cumulativeHp: 0.6835, isMilestone: false },
  { bar: 20, score: 3500, scoreRatio: 0.0583, hpRatio: 0.06329, scorePerHp: 0.921011, cumulativeScore: 45000, cumulativeHp: 0.7468, isMilestone: false },
  { bar: 21, score: 3500, scoreRatio: 0.0583, hpRatio: 0.06329, scorePerHp: 0.921011, cumulativeScore: 48500, cumulativeHp: 0.8101, isMilestone: false },
  { bar: 22, score: 3500, scoreRatio: 0.0583, hpRatio: 0.06329, scorePerHp: 0.921011, cumulativeScore: 52000, cumulativeHp: 0.8734, isMilestone: false },
  { bar: 23, score: 4000, scoreRatio: 0.0667, hpRatio: 0.06329, scorePerHp: 1.05371, cumulativeScore: 56000, cumulativeHp: 0.9367, isMilestone: false },
  { bar: 24, score: 4000, scoreRatio: 0.0667, hpRatio: 0.06329, scorePerHp: 1.05371, cumulativeScore: 60000, cumulativeHp: 1, isMilestone: false },
]

/** 正常模式折线叠加：均 1.5w / 均 2w（FS）；转换器快捷键另有逻辑 */
export const NORMAL_SCORE_MARKERS: CrisisScoreMarker[] = [
  {
    id: '15k',
    score: 15000,
    label: '均1.5w分血量',
    shortLabel: '均1.5w',
    hpRatio: 0.2196,
    color: '#5b9bd5',
  },
  {
    id: '20k',
    score: 20000,
    label: '均2w分血量（FS-HP）',
    shortLabel: '均2w',
    hpRatio: FS_HP_RATIO_NORMAL,
    color: '#e8a838',
  },
]

/** 绝境折线叠加：0.5w / 1.5w / 2.5w（转换器快捷键另为 1w/2w/3w 总分） */
export const HARD_SCORE_MARKERS: CrisisScoreMarker[] = [
  {
    id: '5k',
    score: 5000,
    label: '0.5w分血量',
    shortLabel: '0.5w',
    hpRatio: 0.1368,
    color: '#6bbf7a',
  },
  {
    id: '15k',
    score: 15000,
    label: '1.5w分血量',
    shortLabel: '1.5w',
    hpRatio: 0.2821,
    color: '#5b9bd5',
  },
  {
    id: '25k',
    score: 25000,
    label: '2.5w分血量',
    shortLabel: '2.5w',
    hpRatio: 0.3941,
    color: '#e8a838',
  },
]

export function getCrisisScoreTable(mode: CrisisScoreTableMode): CrisisScoreHpRow[] {
  return mode === 'hard' ? crisisScoreHpTableHard : crisisScoreHpTableNormal
}

export function getScoreMarkers(mode: CrisisScoreTableMode): CrisisScoreMarker[] {
  return mode === 'hard' ? HARD_SCORE_MARKERS : NORMAL_SCORE_MARKERS
}

export function scaleHpByRatio(totalHp: number, ratio: number): number {
  if (!Number.isFinite(totalHp) || !Number.isFinite(ratio)) return 0
  return Math.round(totalHp * ratio)
}

export function formatPercent(ratio: number, digits = 2): string {
  return `${(ratio * 100).toFixed(digits)}%`
}

export function formatScorePerHp(value: number | null, digits = 4): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

export interface CrisisHpScoreConvertResult {
  hpRatio: number
  score: number
  row: CrisisScoreHpRow | null
  prevHp: number
  prevScore: number
  nextHp: number
  nextScore: number
  /** 当前段进度 0–1；hp=0 时为 0 */
  progressInSegment: number
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= CRISIS_SCORE_MAX) return CRISIS_SCORE_MAX
  return value
}

/**
 * 已打血量占比 → 分数。沿对应表累计拐点分段线性插值（节点切开下一管）。
 */
export function convertHpRatioToScore(
  mode: CrisisScoreTableMode,
  hpRatio: number,
): CrisisHpScoreConvertResult {
  const table = getCrisisScoreTable(mode)
  const last = table[table.length - 1]
  if (!last) {
    return {
      hpRatio: 0,
      score: 0,
      row: null,
      prevHp: 0,
      prevScore: 0,
      nextHp: 0,
      nextScore: 0,
      progressInSegment: 0,
    }
  }
  const hp = clamp01(hpRatio)
  if (hp <= 0) {
    return {
      hpRatio: 0,
      score: 0,
      row: null,
      prevHp: 0,
      prevScore: 0,
      nextHp: table[0]?.cumulativeHp ?? 0,
      nextScore: table[0]?.cumulativeScore ?? 0,
      progressInSegment: 0,
    }
  }

  let prevHp = 0
  let prevScore = 0
  for (const row of table) {
    if (hp <= row.cumulativeHp + 1e-12) {
      const span = row.cumulativeHp - prevHp
      const t = span <= 0 ? 1 : (hp - prevHp) / span
      return {
        hpRatio: hp,
        score: prevScore + t * (row.cumulativeScore - prevScore),
        row,
        prevHp,
        prevScore,
        nextHp: row.cumulativeHp,
        nextScore: row.cumulativeScore,
        progressInSegment: Math.min(1, Math.max(0, t)),
      }
    }
    prevHp = row.cumulativeHp
    prevScore = row.cumulativeScore
  }

  return {
    hpRatio: 1,
    score: last.cumulativeScore,
    row: last,
    prevHp: last.cumulativeHp,
    prevScore: last.cumulativeScore,
    nextHp: last.cumulativeHp,
    nextScore: last.cumulativeScore,
    progressInSegment: 1,
  }
}

/**
 * 分数 → 已打血量占比。对应表累计分数单调递增，可按同一折线反查。
 */
export function convertScoreToHpRatio(
  mode: CrisisScoreTableMode,
  score: number,
): CrisisHpScoreConvertResult {
  const table = getCrisisScoreTable(mode)
  const target = clampScore(score)
  if (target <= 0) return convertHpRatioToScore(mode, 0)

  let prevHp = 0
  let prevScore = 0
  for (const row of table) {
    if (target <= row.cumulativeScore + 1e-9) {
      const span = row.cumulativeScore - prevScore
      const t = span <= 0 ? 1 : (target - prevScore) / span
      const hp = prevHp + t * (row.cumulativeHp - prevHp)
      return {
        hpRatio: hp,
        score: target,
        row,
        prevHp,
        prevScore,
        nextHp: row.cumulativeHp,
        nextScore: row.cumulativeScore,
        progressInSegment: Math.min(1, Math.max(0, t)),
      }
    }
    prevHp = row.cumulativeHp
    prevScore = row.cumulativeScore
  }

  return convertHpRatioToScore(mode, 1)
}

export function describeConvertSegment(result: CrisisHpScoreConvertResult): string {
  if (!result.row) return '尚未造成伤害'
  const done = result.progressInSegment >= 1 - 1e-9
  if (result.row.isMilestone && result.row.bar == null) {
    return done ? '已到达分数节点' : '正在通过分数节点'
  }
  if (result.row.bar != null) {
    if (result.row.isMilestone) {
      return done ? `已打完第 ${result.row.bar} 管（节点）` : `正在打第 ${result.row.bar} 管（节点）`
    }
    return done ? `已打完第 ${result.row.bar} 管` : `正在打第 ${result.row.bar} 管`
  }
  return done ? '已到达分数节点' : '正在通过分数节点'
}

export function formatCrisisScoreBarLabel(row: CrisisScoreHpRow): string {
  if (row.isMilestone && row.bar != null) return `${row.bar}/节点`
  if (row.isMilestone || row.bar == null) return '节点'
  return String(row.bar)
}

function rowKey(row: CrisisScoreHpRow): string {
  return `${row.bar ?? 'm'}-${row.cumulativeScore}-${row.cumulativeHp}-${row.isMilestone ? 1 : 0}`
}

/**
 * 计算过程用：对应表当前插值终点附近最多 3 行（上一段 / 当前 / 下一段）。
 */
export function getConvertContextTableRows(
  mode: CrisisScoreTableMode,
  result: CrisisHpScoreConvertResult | null | undefined,
): { rows: CrisisScoreHpRow[]; currentIndex: number } {
  if (!result?.row) return { rows: [], currentIndex: -1 }
  const table = getCrisisScoreTable(mode)
  const targetKey = rowKey(result.row)
  let index = table.findIndex((row) => rowKey(row) === targetKey)
  if (index < 0) {
    index = table.findIndex(
      (row) =>
        row.cumulativeScore === result.row!.cumulativeScore &&
        Math.abs(row.cumulativeHp - result.row!.cumulativeHp) < 1e-9,
    )
  }
  if (index < 0) return { rows: [result.row], currentIndex: 0 }
  if (table.length <= 3) return { rows: table.slice(), currentIndex: index }
  if (index <= 0) return { rows: table.slice(0, 3), currentIndex: 0 }
  if (index >= table.length - 1) {
    return { rows: table.slice(-3), currentIndex: 2 }
  }
  return { rows: table.slice(index - 1, index + 2), currentIndex: 1 }
}
