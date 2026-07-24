import type { EnemySlot, PhaseData } from '@/types/history'
import {
  formatCrisisRoomLabel,
  isCrisisHardRoom,
  supportsCrisisHardRoom,
} from '@/utils/crisisRoom'
import { isCrisisBossId, isCrisisBuffId } from '@/utils/defenseId'
import { getAdminToken, isAdminAuthenticated } from '@/utils/adminAuth'
import { formatDateRange, formatHp, parseWeaknessElements, resolveAssetUrl, splitBuffLines } from '@/utils/gameData'

export type CrisisHpChartMode = 'normal' | 'hard'
export type CrisisBossRoomType = 'normal' | 'hard' | 'all'

interface ApiBoss {
  id: number
  boss_name: string
  hp: number
  hp_converted_953?: number
  defense: number
  level: number
  room: string
  weakness: string | null
  resistance: string | null
  boss_image: string | null
  crisis_base_hp?: number | null
  hp_coeff_percent?: number | null
  hp_coeff_manual?: boolean
  hp_coeff_label?: string | null
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
  isHidden?: boolean
  totalHp: number
  totalHpConverted953?: number
  hardTotalHp?: number
  hardTotalHpConverted953?: number
  tid: number | null
  bosses: ApiBoss[]
  buffs: ApiBuff[]
}

interface ApiResponse {
  code: number
  message: string
  data: ApiPhase[]
}

function adminAuthHeaders(): HeadersInit {
  if (!isAdminAuthenticated()) return {}
  const token = getAdminToken()
  if (!token) return {}
  return {
    Authorization: `Bearer ${token}`,
    'X-Admin-Token': token,
  }
}

const emptyBuff = (index: number) => ({
  name: `Buff ${index + 1}`,
  icon: '✦',
  lines: ['暂无 Buff 数据'],
})

function emptyEnemySlot(label: string, isHardRoom = false): EnemySlot {
  return {
    label,
    subStats: '暂无数据',
    hp: '—',
    altHp: '—',
    elements: [],
    isHardRoom,
  }
}

function crisisRoomSortKey(room: string | number | null | undefined): number {
  if (isCrisisHardRoom(room)) return 4
  const digits = String(room ?? '').replace(/\D/g, '')
  return Number(digits) || 0
}

function mapBossToEnemy(boss: ApiBoss): EnemySlot {
  const hard = isCrisisHardRoom(boss.room)
  const converted =
    boss.hp_converted_953 ??
    Math.round((boss.hp * (794 + Number(boss.defense || 0))) / (794 + 953))

  return {
    label: hard
      ? `困难 Lv${boss.level}`
      : `房间 ${formatCrisisRoomLabel(boss.room)} Lv${boss.level}`,
    subStats: boss.boss_name,
    bossName: boss.boss_name,
    imageUrl: resolveAssetUrl(boss.boss_image),
    hp: formatHp(boss.hp),
    hpValue: boss.hp,
    hpConverted953: formatHp(converted),
    hpConverted953Value: converted,
    altHp: formatHp(boss.hp),
    defense: boss.defense,
    elements: parseWeaknessElements(boss.weakness),
    weakness: boss.weakness || undefined,
    resistance: boss.resistance || undefined,
    crisisBaseHp: boss.crisis_base_hp ?? null,
    hpCoeffPercent: boss.hp_coeff_percent ?? null,
    hpCoeffLabel: boss.hp_coeff_label ?? null,
    isHardRoom: hard,
  }
}

function toPhaseData(phase: ApiPhase): PhaseData {
  const bosses = [...phase.bosses]
    .filter((boss) => isCrisisBossId(boss.id))
    .sort((a, b) => crisisRoomSortKey(a.room) - crisisRoomSortKey(b.room))
  const buffs = [...phase.buffs].filter((buff) => isCrisisBuffId(buff.id))

  while (buffs.length < 3) {
    buffs.push({
      id: 0,
      buff_name: '',
      buff: null,
      buff_image: null,
    })
  }

  const normalBosses = bosses.filter((boss) => !isCrisisHardRoom(boss.room))
  const hardBoss = bosses.find((boss) => isCrisisHardRoom(boss.room))
  const enemies: EnemySlot[] = [0, 1, 2].map((index) => {
    const boss = normalBosses[index]
    if (!boss) return emptyEnemySlot(`房间 ${index + 1}`)
    return mapBossToEnemy(boss)
  })

  if (supportsCrisisHardRoom(phase.version)) {
    enemies.push(hardBoss ? mapBossToEnemy(hardBoss) : emptyEnemySlot('困难', true))
  }

  return {
    id: phase.id,
    version: phase.version,
    phase: phase.phaseLabel,
    dateRange: formatDateRange(phase.startDate, phase.endDate),
    tid: phase.tid != null ? String(phase.tid) : '—',
    isHidden: Boolean(phase.isHidden),
    rawHp: formatHp(phase.totalHp),
    totalHp: phase.totalHp,
    rawHpConverted953: formatHp(phase.totalHpConverted953 ?? phase.totalHp),
    totalHpConverted953: phase.totalHpConverted953 ?? phase.totalHp,
    rawHardHp: formatHp(phase.hardTotalHp ?? 0),
    hardTotalHp: phase.hardTotalHp ?? 0,
    rawHardHpConverted953: formatHp(phase.hardTotalHpConverted953 ?? phase.hardTotalHp ?? 0),
    hardTotalHpConverted953: phase.hardTotalHpConverted953 ?? phase.hardTotalHp ?? 0,
    buffs: [0, 1, 2].map((index) => {
      const buff = buffs[index]
      if (!buff?.buff_name) return emptyBuff(index)
      return {
        name: buff.buff_name,
        icon: '✦',
        imageUrl: resolveAssetUrl(buff.buff_image),
        lines: splitBuffLines(buff.buff),
      }
    }),
    enemies,
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
  /** 953 防御换算血量（有则额外显示） */
  hpConverted953?: string
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
  /** 换算到 953 防御的总血量 */
  totalHpConverted953?: number
  /** 危局血量系数整数百分比（单独怪物对比用） */
  hpCoeffPercent?: number | null
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

export async function fetchCrisisAssaultHpChart(
  mode: CrisisHpChartMode = 'normal',
): Promise<HpChartPoint[]> {
  const json = await fetchCrisisAssaultApi()
  return json.data
    .map((phase) => {
      const isHard = mode === 'hard'
      const totalHp = isHard ? (phase.hardTotalHp ?? 0) : phase.totalHp
      const totalHpConverted953 = isHard
        ? (phase.hardTotalHpConverted953 ?? phase.hardTotalHp ?? 0)
        : (phase.totalHpConverted953 ?? phase.totalHp)
      const bosses = [...phase.bosses]
        .filter((boss) => (isHard ? isCrisisHardRoom(boss.room) : !isCrisisHardRoom(boss.room)))
        .sort((a, b) => crisisRoomSortKey(a.room) - crisisRoomSortKey(b.room))
        .map((boss) => {
          const converted =
            boss.hp_converted_953 ??
            Math.round((boss.hp * (794 + Number(boss.defense || 0))) / (794 + 953))
          const showConverted = Number(boss.defense) !== 953 && converted !== boss.hp
          return {
            room: formatCrisisRoomLabel(boss.room),
            bossName: boss.boss_name,
            hp: formatHp(boss.hp),
            hpConverted953: showConverted ? formatHp(converted) : undefined,
            imageUrl: resolveAssetUrl(boss.boss_image),
          }
        })

      return {
        label: `${phase.version}第${phase.phase}期`,
        dateRange: formatDateRange(phase.startDate, phase.endDate),
        totalHp,
        totalHpConverted953,
        version: phase.version,
        phase: phase.phase,
        bosses,
      }
    })
    .filter((point) => (mode === 'hard' ? point.totalHp > 0 : true))
}

export interface BossOption {
  boss_name: string
  boss_image: string | null
  roomType?: 'normal' | 'hard'
}

export async function fetchBossList(
  roomType: CrisisBossRoomType = 'normal',
): Promise<BossOption[]> {
  const response = await fetch(
    `/api/crisis-assault/bosses?roomType=${encodeURIComponent(roomType)}`,
    { headers: adminAuthHeaders() },
  )
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }

  const json = (await response.json()) as { code: number; message: string; data: BossOption[] }
  if (json.code !== 200 || !Array.isArray(json.data)) {
    throw new Error(json.message || '获取 Boss 列表失败')
  }

  return json.data
}

export async function fetchBossChart(
  bossName: string,
  roomType: CrisisBossRoomType = 'normal',
): Promise<HpChartPoint[]> {
  const response = await fetch(
    `/api/crisis-assault/boss-chart?boss_name=${encodeURIComponent(bossName)}&roomType=${encodeURIComponent(roomType)}`,
    { headers: adminAuthHeaders() },
  )
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }

  const json = (await response.json()) as {
    code: number
    message: string
    data: Array<
      HpChartPoint & {
        hpCoeffPercent?: number | null
        crisisBaseHp?: number | null
      }
    >
  }
  if (json.code !== 200 || !Array.isArray(json.data)) {
    throw new Error(json.message || '获取 Boss 折线图数据失败')
  }

  return json.data.map((row) => ({
    label: row.label,
    dateRange: row.dateRange,
    totalHp: row.totalHp,
    totalHpConverted953: row.totalHpConverted953,
    hpCoeffPercent: row.hpCoeffPercent ?? null,
    version: row.version,
    phase: row.phase,
    bosses: row.bosses,
    roomBuff: row.roomBuff,
  }))
}

async function fetchCrisisAssaultApi(): Promise<ApiResponse> {
  const response = await fetch('/api/crisis-assault/phases', {
    headers: adminAuthHeaders(),
  })
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }

  const json = (await response.json()) as ApiResponse
  if (json.code !== 200 || !Array.isArray(json.data)) {
    throw new Error(json.message || '获取危局强袭战数据失败')
  }

  return json
}
