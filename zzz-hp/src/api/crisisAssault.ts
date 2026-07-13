import type { PhaseData } from '@/types/history'
import { isCrisisBossId, isCrisisBuffId } from '@/utils/defenseId'
import { formatDateRange, formatHp, parseWeaknessElements, resolveAssetUrl, splitBuffLines } from '@/utils/gameData'

interface ApiBoss {
  id: number
  boss_name: string
  hp: number
  defense: number
  level: number
  room: string
  weakness: string | null
  resistance: string | null
  boss_image: string | null
}

interface ApiBuff {
  id: number
  buff_name: string
  buff: string | null
  buff_image: string | null
}

interface ApiPhase {
  id: string
  version: string
  phase: string
  phaseLabel: string
  startDate: string | null
  endDate: string | null
  totalHp: number
  tid: number | null
  bosses: ApiBoss[]
  buffs: ApiBuff[]
}

interface ApiResponse {
  code: number
  message: string
  data: ApiPhase[]
}

const emptyBuff = (index: number) => ({
  name: `Buff ${index + 1}`,
  icon: '✦',
  lines: ['暂无 Buff 数据'],
})

function toPhaseData(phase: ApiPhase): PhaseData {
  const bosses = [...phase.bosses]
    .filter((boss) => isCrisisBossId(boss.id))
    .sort((a, b) => Number(a.room) - Number(b.room))
  const buffs = [...phase.buffs].filter((buff) => isCrisisBuffId(buff.id))

  while (buffs.length < 3) {
    buffs.push({
      id: 0,
      buff_name: '',
      buff: null,
      buff_image: null,
    })
  }

  return {
    id: phase.id,
    version: phase.version,
    phase: phase.phaseLabel,
    dateRange: formatDateRange(phase.startDate, phase.endDate),
    tid: phase.tid != null ? String(phase.tid) : '—',
    rawHp: formatHp(phase.totalHp),
    totalHp: phase.totalHp,
    buffs: [0, 1, 2].map((index) => {
      const buff = buffs[index]
      if (!buff?.buff_name) return emptyBuff(index) as PhaseData['buffs'][number]
      return {
        name: buff.buff_name,
        icon: '✦',
        imageUrl: resolveAssetUrl(buff.buff_image),
        lines: splitBuffLines(buff.buff),
      }
    }) as PhaseData['buffs'],
    enemies: [0, 1, 2].map((index) => {
      const boss = bosses[index]
      if (!boss) {
        return {
          label: `房间 ${index + 1}`,
          subStats: '暂无数据',
          hp: '—',
          altHp: '—',
          elements: [],
        } as PhaseData['enemies'][number]
      }

      return {
        label: `房间 ${boss.room} Lv${boss.level}`,
        subStats: boss.boss_name,
        bossName: boss.boss_name,
        imageUrl: resolveAssetUrl(boss.boss_image),
        hp: formatHp(boss.hp),
        hpValue: boss.hp,
        altHp: formatHp(boss.hp),
        defense: boss.defense,
        elements: parseWeaknessElements(boss.weakness),
        weakness: boss.weakness || undefined,
        resistance: boss.resistance || undefined,
      }
    }) as PhaseData['enemies'],
  }
}

export async function fetchCrisisAssaultPhases(): Promise<PhaseData[]> {
  const json = await fetchCrisisAssaultApi()
  return json.data.map(toPhaseData)
}

export interface ChartBossPreview {
  room: string
  bossName: string
  hp: string
  imageUrl?: string
}

export interface ChartRoomBuffPreview {
  room: string
  name: string
  lines: string[]
  imageUrl?: string
}

export interface HpChartPoint {
  label: string
  dateRange: string
  totalHp: number
  version?: string
  phase?: string
  bosses?: ChartBossPreview[]
  roomBuff?: ChartRoomBuffPreview
}

export function getChartPointPhaseKey(point: HpChartPoint): string {
  const version = point.version ?? parseVersionFromChartLabel(point.label)
  const phase = point.phase ?? point.label.match(/第(\d+)期/)?.[1]
  if (version && phase) return `${version}-${Number(phase)}`
  return point.label
}

export function parseVersionFromChartLabel(label: string): string | null {
  const match = label.match(/^([\d.]+)第/)
  return match?.[1] ?? null
}

export function getChartPointVersion(point: HpChartPoint): string | null {
  return point.version ?? parseVersionFromChartLabel(point.label)
}

export function filterChartPointsByLabels(
  points: HpChartPoint[],
  labels: string[],
): HpChartPoint[] {
  if (!labels.length) return []
  const labelSet = new Set(labels)
  return points.filter((point) => labelSet.has(point.label))
}

function findChartPointByVersionPhase(
  points: HpChartPoint[],
  version: string,
  phase: string,
): HpChartPoint | null {
  const normalizedPhase = String(Number(phase))
  return (
    points.find(
      (point) => point.version === version && String(Number(point.phase)) === normalizedPhase,
    ) ?? null
  )
}

function findFirstPhaseOfVersion(points: HpChartPoint[], version: string): HpChartPoint | null {
  return (
    points.find((point) => point.version === version && String(Number(point.phase)) === '1') ??
    points.find((point) => point.version === version) ??
    null
  )
}

function getKnownVersions(points: HpChartPoint[]): string[] {
  const versions = new Set<string>()
  for (const point of points) {
    if (point.version) versions.add(point.version)
  }
  return [...versions].sort((a, b) => Number(a) - Number(b))
}

export function formatPhaseCompactCode(point: HpChartPoint): string {
  if (point.version && point.phase) {
    return `${point.version}${point.phase}`
  }
  return point.label
}

export function findPhaseIndexFromChartPoint(
  phases: PhaseData[],
  point: HpChartPoint,
): number {
  if (point.version && point.phase) {
    const targetPhase = String(Number(point.phase))
    const byVersionPhase = phases.findIndex(
      (item) =>
        item.version === point.version &&
        String(Number(item.phase.match(/\d+/)?.[0] ?? '')) === targetPhase,
    )
    if (byVersionPhase >= 0) return byVersionPhase
  }

  return phases.findIndex((item) => {
    const phaseNum = item.phase.match(/\d+/)?.[0]
    if (!phaseNum) return false
    return point.label === `${item.version}第${phaseNum}期`
  })
}

export function resolvePhaseFromInput(
  points: HpChartPoint[],
  rawInput: string,
): HpChartPoint | null {
  const input = rawInput.trim().replace(/\s+/g, '')
  if (!input || !points.length) return null

  const exact = points.find((point) => point.label === input || point.label === `${input}期`)
  if (exact) return exact

  const labeledMatch = input.match(/^([\d.]+)第(\d+)期?$/)
  if (labeledMatch) {
    const found = findChartPointByVersionPhase(points, labeledMatch[1]!, labeledMatch[2]!)
    if (found) return found
  }

  const spacedLabelMatch = rawInput.trim().match(/^([\d.]+)\s*第\s*(\d+)\s*期?$/)
  if (spacedLabelMatch) {
    const found = findChartPointByVersionPhase(
      points,
      spacedLabelMatch[1]!,
      spacedLabelMatch[2]!,
    )
    if (found) return found
  }

  const separatedMatch = input.match(/^([\d.]+)[\-_.](\d+)$/)
  if (separatedMatch) {
    const found = findChartPointByVersionPhase(points, separatedMatch[1]!, separatedMatch[2]!)
    if (found) return found
  }

  const compactInput = input.replace(/\s/g, '')
  const versions = getKnownVersions(points).sort((a, b) => b.length - a.length)
  for (const version of versions) {
    if (!compactInput.startsWith(version)) continue
    const remainder = compactInput.slice(version.length)
    if (/^\d+$/.test(remainder)) {
      const found = findChartPointByVersionPhase(points, version, remainder)
      if (found) return found
    }
  }

  if (/^[\d.]+$/.test(compactInput)) {
    return findFirstPhaseOfVersion(points, compactInput)
  }

  return null
}

export interface BossOption {
  boss_name: string
  boss_image: string | null
}

export async function fetchCrisisAssaultHpChart(): Promise<HpChartPoint[]> {
  const json = await fetchCrisisAssaultApi()
  return json.data.map((phase) => ({
    label: `${phase.version}第${phase.phase}期`,
    dateRange: formatDateRange(phase.startDate, phase.endDate),
    totalHp: phase.totalHp,
    version: phase.version,
    phase: phase.phase,
    bosses: [...phase.bosses]
      .sort((a, b) => Number(a.room) - Number(b.room))
      .map((boss) => ({
        room: String(boss.room),
        bossName: boss.boss_name,
        hp: formatHp(boss.hp),
        imageUrl: resolveAssetUrl(boss.boss_image),
      })),
  }))
}

export async function fetchBossList(): Promise<BossOption[]> {
  const response = await fetch('/api/crisis-assault/bosses')
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }

  const json = (await response.json()) as { code: number; message: string; data: BossOption[] }
  if (json.code !== 200 || !Array.isArray(json.data)) {
    throw new Error(json.message || '获取 Boss 列表失败')
  }

  return json.data
}

export async function fetchBossChart(bossName: string): Promise<HpChartPoint[]> {
  const response = await fetch(
    `/api/crisis-assault/boss-chart?boss_name=${encodeURIComponent(bossName)}`,
  )
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }

  const json = (await response.json()) as {
    code: number
    message: string
    data: HpChartPoint[]
  }
  if (json.code !== 200 || !Array.isArray(json.data)) {
    throw new Error(json.message || '获取 Boss 折线图数据失败')
  }

  return json.data
}

async function fetchCrisisAssaultApi(): Promise<ApiResponse> {
  const response = await fetch('/api/crisis-assault/phases')
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }

  const json = (await response.json()) as ApiResponse
  if (json.code !== 200 || !Array.isArray(json.data)) {
    throw new Error(json.message || '获取危局强袭战数据失败')
  }

  return json
}
