import type { DefenseEnemy, DefenseFrontier, DefenseRoom, DefenseSeason } from '@/types/defense'
import { formatHp, formatHpExpansionPercent, parseHpString } from '@/utils/gameData'

export type DefenseHpOptionKind = 'frontier' | 'room'

export interface DefenseRoomHpOption {
  id: string
  kind: DefenseHpOptionKind
  frontierId?: string
  roomId?: string
  title: string
  subtitle?: string
  rawHp: number
  rawHpText: string
}

const CHINESE_STAGE_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
}

export function parseFrontierStage(title: string): number {
  const match = String(title).match(/第([一二三四五六七八九十\d]+)防线/)
  if (!match?.[1]) return 0

  const token = match[1]
  if (/^\d+$/.test(token)) return Number(token)
  return CHINESE_STAGE_MAP[token] ?? 0
}

export function computeDefenseRoomTotalHp(room: DefenseRoom): number {
  let total = 0

  for (const battleRoom of room.battleRooms) {
    for (const wave of battleRoom.waves) {
      for (const enemy of wave.enemies) {
        const hp = enemy.hpValue ?? parseHpString(enemy.hp) ?? 0
        const count = enemy.count ?? 1
        total += hp * count
      }
    }
  }

  return total
}

export function computeDefenseFrontierTotalHp(frontier: DefenseFrontier): number {
  return frontier.rooms.reduce((sum, room) => sum + computeDefenseRoomTotalHp(room), 0)
}

export function getLastDefenseFrontier(season: DefenseSeason): DefenseFrontier | null {
  if (!season.frontiers.length) return null

  return [...season.frontiers].sort(
    (a, b) => parseFrontierStage(b.title) - parseFrontierStage(a.title),
  )[0] ?? null
}

export function formatDefenseRoomHpTitle(frontierTitle: string, roomLabel: string) {
  return `${frontierTitle}·${roomLabel.replace(/\s+/g, '')}`
}

export function buildDefenseRoomHpOptions(season: DefenseSeason): DefenseRoomHpOption[] {
  const options: DefenseRoomHpOption[] = []
  const lastFrontier = getLastDefenseFrontier(season)

  for (const frontier of season.frontiers) {
    const rawHp = computeDefenseFrontierTotalHp(frontier)
    options.push({
      id: `frontier-${frontier.id}`,
      kind: 'frontier',
      frontierId: frontier.id,
      title: frontier.title,
      subtitle: '防线总血量',
      rawHp,
      rawHpText: formatHp(rawHp),
    })

    if (lastFrontier && frontier.id === lastFrontier.id) {
      for (const room of frontier.rooms) {
        const roomHp = computeDefenseRoomTotalHp(room)
        options.push({
          id: `room-${room.id}`,
          kind: 'room',
          frontierId: frontier.id,
          roomId: room.id,
          title: formatDefenseRoomHpTitle(frontier.title, room.label),
          subtitle: '单房间总血量',
          rawHp: roomHp,
          rawHpText: formatHp(roomHp),
        })
      }
    }
  }

  return options
}

export function getDefenseHpOptionKey(option: DefenseRoomHpOption) {
  return `${option.kind}:${option.title}`
}

export function findMatchingDefenseHpOption(
  options: DefenseRoomHpOption[],
  template: DefenseRoomHpOption,
): DefenseRoomHpOption | null {
  if (template.kind === 'frontier') {
    return options.find((option) => option.kind === 'frontier' && option.title === template.title) ?? null
  }
  return options.find((option) => option.kind === 'room' && option.title === template.title) ?? null
}

export function findDefenseRoomHpOption(
  season: DefenseSeason,
  optionId?: string,
): DefenseRoomHpOption | null {
  const options = buildDefenseRoomHpOptions(season)
  if (!optionId) return options[0] ?? null
  return options.find((option) => option.id === optionId) ?? null
}

export interface HpComparison {
  diff: number
  expansion: string | null
}

export function buildHpComparison(currentHp: number, previousHp: number): HpComparison | null {
  const diff = currentHp - previousHp
  if (diff === 0) return null

  return {
    diff,
    expansion: formatHpExpansionPercent(currentHp, previousHp),
  }
}

export function findEnemyHpInSeason(season: DefenseSeason, bossName: string): number | null {
  for (const frontier of season.frontiers) {
    for (const room of frontier.rooms) {
      for (const battleRoom of room.battleRooms) {
        for (const wave of battleRoom.waves) {
          for (const enemy of wave.enemies) {
            if (enemy.name !== bossName) continue
            return enemy.hpValue ?? parseHpString(enemy.hp)
          }
        }
      }
    }
  }

  return null
}

export function findDefenseRoomHpComparison(
  seasons: DefenseSeason[],
  seasonIndex: number,
  currentOption: DefenseRoomHpOption,
): HpComparison | null {
  if (seasonIndex <= 0) return null

  const currentHp = currentOption.rawHp

  for (let index = seasonIndex - 1; index >= 0; index -= 1) {
    const season = seasons[index]
    if (!season) continue

    const matched = findMatchingDefenseHpOption(buildDefenseRoomHpOptions(season), currentOption)
    if (!matched) continue

    return buildHpComparison(currentHp, matched.rawHp)
  }

  return null
}

export function findDefenseEnemyHpComparison(
  seasons: DefenseSeason[],
  seasonIndex: number,
  enemy: Pick<DefenseEnemy, 'name' | 'hp' | 'hpValue'>,
): HpComparison | null {
  const currentHp = enemy.hpValue ?? parseHpString(enemy.hp)
  if (currentHp == null) return null

  for (let index = seasonIndex - 1; index >= 0; index -= 1) {
    const season = seasons[index]
    if (!season) continue

    const previousHp = findEnemyHpInSeason(season, enemy.name)
    if (previousHp == null) continue

    return buildHpComparison(currentHp, previousHp)
  }

  return null
}
