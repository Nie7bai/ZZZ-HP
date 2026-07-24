import type { BossOption, HpChartPoint } from '@/api/crisisAssault'
import { filterChartPointsByLabels } from '@/api/crisisAssault'
import { getDefenseSeasons as getMockDefenseSeasons } from '@/data/defenseData'
import type { DefenseSeason, DefenseVariant } from '@/types/defense'
import type { DefenseSeasonIdRow } from '@/utils/defenseSeasonId'
import {
  buildDefenseBossChart,
  buildDefenseLastFrontierBossPreviews,
  extractDefenseBossList,
  getDefaultDefenseHpOptionKey,
  type DefenseCompareMonsterCategory,
} from '@/utils/defenseCompare'
import { resolveAssetUrl } from '@/utils/gameData'
import {
  buildDefenseRoomHpOptions,
  findMatchingDefenseHpOption,
  getDefenseHpOptionKey,
  type DefenseRoomHpOption,
} from '@/utils/defenseHp'
import { getAdminToken, isAdminAuthenticated } from '@/utils/adminAuth'

export { filterChartPointsByLabels }

interface ApiDefenseSeason extends DefenseSeason {}

interface ApiResponse {
  code: number
  message: string
  data: ApiDefenseSeason[]
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

function normalizeSeason(season: DefenseSeason): DefenseSeason {
  return {
    ...season,
    isHidden: Boolean(season.isHidden),
    frontiers: season.frontiers.map((frontier) => ({
      ...frontier,
      rooms: frontier.rooms.map((room) => ({
        ...room,
        roomBuff: {
          ...room.roomBuff,
          imageUrl: resolveAssetUrl(room.roomBuff.imageUrl),
        },
        battleRooms: room.battleRooms.map((battleRoom) => ({
          ...battleRoom,
          waves: battleRoom.waves.map((wave) => ({
            ...wave,
            enemies: wave.enemies.map((enemy) => ({
              ...enemy,
              imageUrl: resolveAssetUrl(enemy.imageUrl),
            })),
          })),
        })),
      })),
    })),
  }
}

export async function fetchDefenseSeasons(variant: DefenseVariant): Promise<DefenseSeason[]> {
  const response = await fetch(`/api/defense/seasons?variant=${variant}`, {
    headers: adminAuthHeaders(),
  })
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }

  const json = (await response.json()) as ApiResponse
  if (json.code !== 200 || !Array.isArray(json.data)) {
    throw new Error(json.message || '获取式舆防卫战数据失败')
  }

  if (json.data.length) {
    return json.data.map(normalizeSeason)
  }

  return getMockDefenseSeasons(variant)
}

function formatSeasonPhaseLabel(season: DefenseSeason) {
  const phaseNum = season.phase.replace(/\D/g, '')
  return `${season.version}第${phaseNum}期`
}

export function getDefenseHpChartOptions(seasons: DefenseSeason[]): DefenseRoomHpOption[] {
  if (!seasons.length) return []
  return buildDefenseRoomHpOptions(seasons[0]!)
}

export function formatDefenseHpOptionLabel(option: DefenseRoomHpOption) {
  if (option.kind === 'frontier') {
    return `${option.title}（防线总血量）`
  }
  return option.title
}

export function buildDefenseHpChartPoints(
  seasons: DefenseSeason[],
  optionKey: string,
): HpChartPoint[] {
  if (!seasons.length) return []

  const templateOptions = buildDefenseRoomHpOptions(seasons[0]!)
  const template = templateOptions.find((option) => getDefenseHpOptionKey(option) === optionKey)
  if (!template) return []

  const points: HpChartPoint[] = []

  for (const season of seasons) {
    const seasonOptions = buildDefenseRoomHpOptions(season)
    const matched = findMatchingDefenseHpOption(seasonOptions, template)
    if (!matched) continue

    points.push({
      label: formatSeasonPhaseLabel(season),
      dateRange: season.dateRange,
      totalHp: matched.rawHp,
      version: season.version,
      phase: season.phase.replace(/\D/g, ''),
      bosses: buildDefenseLastFrontierBossPreviews(season),
    })
  }

  return points
}

interface SeasonIdMapResponse {
  code: number
  message: string
  data: DefenseSeasonIdRow[]
}

export async function fetchDefensePhaseCompareChart(variant: DefenseVariant): Promise<HpChartPoint[]> {
  const seasons = await fetchDefenseSeasons(variant)
  const optionKey = getDefaultDefenseHpOptionKey(seasons)
  if (!optionKey) return []
  return buildDefenseHpChartPoints(seasons, optionKey)
}

export async function fetchDefenseBossList(
  variant: DefenseVariant,
  category: DefenseCompareMonsterCategory,
): Promise<BossOption[]> {
  const seasons = await fetchDefenseSeasons(variant)
  return extractDefenseBossList(seasons, category)
}

export async function fetchDefenseBossChart(
  variant: DefenseVariant,
  bossName: string,
  category: DefenseCompareMonsterCategory,
): Promise<HpChartPoint[]> {
  const seasons = await fetchDefenseSeasons(variant)
  return buildDefenseBossChart(seasons, bossName, category)
}

export async function fetchDefenseSeasonIdMap(): Promise<DefenseSeasonIdRow[]> {
  const response = await fetch('/api/defense/season-id-map')
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }

  const json = (await response.json()) as SeasonIdMapResponse
  if (json.code !== 200 || !Array.isArray(json.data)) {
    throw new Error(json.message || '获取防卫战 ID 转换表失败')
  }

  return json.data
}
