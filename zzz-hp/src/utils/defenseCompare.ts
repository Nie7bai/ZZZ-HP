import type { BossOption, ChartBossPreview, ChartRoomBuffPreview, HpChartPoint } from '@/api/crisisAssault'
import type { DefenseEnemy, DefenseRoom, DefenseSeason } from '@/types/defense'
import type { BuffInfo, EnemySlot, PhaseData } from '@/types/history'
import { decodeDefenseBossId, isDefenseBossId, type DefenseMonsterCategory } from '@/utils/defenseId'
import {
  buildDefenseRoomHpOptions,
  getDefenseHpOptionKey,
  getLastDefenseFrontier,
} from '@/utils/defenseHp'
import { parseHpString } from '@/utils/gameData'

const EMPTY_ENEMY: EnemySlot = {
  label: '',
  subStats: '',
  hp: '',
  altHp: '',
  elements: [],
}

export type DefenseCompareMonsterCategory = Extract<DefenseMonsterCategory, 'elite' | 'boss'>

export function getDefenseMonsterCategory(enemy: DefenseEnemy): DefenseCompareMonsterCategory | null {
  if (enemy.id != null && isDefenseBossId(enemy.id)) {
    try {
      const decoded = decodeDefenseBossId(enemy.id)
      if (decoded.monsterCategory === 'elite' || decoded.monsterCategory === 'boss') {
        return decoded.monsterCategory
      }
    } catch {
      return null
    }
  }

  if (enemy.isBoss) return 'boss'
  return null
}

export function isDefenseEliteOrBoss(enemy: DefenseEnemy): boolean {
  return getDefenseMonsterCategory(enemy) != null
}

function formatSeasonPhaseLabel(season: DefenseSeason) {
  const phaseNum = season.phase.replace(/\D/g, '')
  return `${season.version}第${phaseNum}期`
}

export function getDefaultDefenseHpOptionKey(seasons: DefenseSeason[]): string {
  if (!seasons.length) return ''

  const options = buildDefenseRoomHpOptions(seasons[0]!)
  if (!options.length) return ''

  const lastFrontier = getLastDefenseFrontier(seasons[0]!)
  const lastFrontierOption = lastFrontier
    ? options.find((option) => option.kind === 'frontier' && option.frontierId === lastFrontier.id)
    : null

  return getDefenseHpOptionKey(lastFrontierOption ?? options[0]!)
}

export function findDefenseSeasonIndexFromChartPoint(
  seasons: DefenseSeason[],
  point: HpChartPoint,
): number {
  if (point.version && point.phase) {
    const targetPhase = String(Number(point.phase))
    const byVersionPhase = seasons.findIndex(
      (item) =>
        item.version === point.version &&
        String(Number(item.phase.replace(/\D/g, ''))) === targetPhase,
    )
    if (byVersionPhase >= 0) return byVersionPhase
  }

  return seasons.findIndex((item) => formatSeasonPhaseLabel(item) === point.label)
}

function formatDefenseRoomLabel(roomLabel: string) {
  const digits = roomLabel.match(/\d+/)?.[0]
  return digits ?? roomLabel.replace(/\s+/g, '')
}

export function buildDefenseLastFrontierBossPreviews(season: DefenseSeason): ChartBossPreview[] {
  const lastFrontier = getLastDefenseFrontier(season)
  if (!lastFrontier) return []

  const previewMap = new Map<string, ChartBossPreview>()

  for (const room of lastFrontier.rooms) {
    const roomCode = formatDefenseRoomLabel(room.label)

    for (const battleRoom of room.battleRooms) {
      for (const wave of battleRoom.waves) {
        for (const enemy of wave.enemies) {
          if (getDefenseMonsterCategory(enemy) !== 'boss' || !enemy.name) continue

          const key = `${roomCode}::${enemy.name}`
          const hpValue = enemy.hpValue ?? parseHpString(enemy.hp) ?? 0
          const existing = previewMap.get(key)

          if (!existing || hpValue > (parseHpString(existing.hp) ?? 0)) {
            previewMap.set(key, {
              room: roomCode,
              bossName: enemy.name,
              hp: enemy.hp,
              imageUrl: enemy.imageUrl,
            })
          }
        }
      }
    }
  }

  return [...previewMap.values()].sort((a, b) => {
    const roomDiff = Number(a.room) - Number(b.room)
    if (!Number.isNaN(roomDiff) && roomDiff !== 0) return roomDiff
    return a.room.localeCompare(b.room, 'zh-CN')
  })
}

export function extractDefenseBossList(
  seasons: DefenseSeason[],
  category: DefenseCompareMonsterCategory,
): BossOption[] {
  const bossMap = new Map<string, string | null>()

  for (const season of seasons) {
    for (const frontier of season.frontiers) {
      for (const room of frontier.rooms) {
        for (const battleRoom of room.battleRooms) {
          for (const wave of battleRoom.waves) {
            for (const enemy of wave.enemies) {
              if (!enemy.name || getDefenseMonsterCategory(enemy) !== category) continue
              if (!bossMap.has(enemy.name)) {
                bossMap.set(enemy.name, enemy.imageUrl ?? null)
              }
            }
          }
        }
      }
    }
  }

  return [...bossMap.entries()]
    .map(([boss_name, boss_image]) => ({ boss_name, boss_image }))
    .sort((a, b) => a.boss_name.localeCompare(b.boss_name, 'zh-CN'))
}

function isValidDefenseRoomBuff(buff: { name: string; lines: string[] }) {
  return Boolean(buff.name && buff.name !== '—' && !buff.name.startsWith('Buff '))
}

function toChartRoomBuffPreview(room: DefenseRoom): ChartRoomBuffPreview | undefined {
  if (!isValidDefenseRoomBuff(room.roomBuff)) return undefined

  return {
    room: formatDefenseRoomLabel(room.label),
    name: room.roomBuff.name,
    lines: room.roomBuff.lines.length ? room.roomBuff.lines : [room.roomBuff.name],
    imageUrl: room.roomBuff.imageUrl,
  }
}

export function buildDefenseBossChart(
  seasons: DefenseSeason[],
  bossName: string,
  category: DefenseCompareMonsterCategory,
): HpChartPoint[] {
  const points: HpChartPoint[] = []

  for (const season of seasons) {
    let bestHp: number | null = null
    let bestRoom: DefenseRoom | null = null

    for (const frontier of season.frontiers) {
      for (const room of frontier.rooms) {
        for (const battleRoom of room.battleRooms) {
          for (const wave of battleRoom.waves) {
            for (const enemy of wave.enemies) {
              if (getDefenseMonsterCategory(enemy) !== category || enemy.name !== bossName) continue

              const hp = enemy.hpValue ?? parseHpString(enemy.hp)
              if (hp == null) continue

              if (bestHp == null || hp > bestHp) {
                bestHp = hp
                bestRoom = room
              }
            }
          }
        }
      }
    }

    if (bestHp == null) continue

    const phaseNum = season.phase.replace(/\D/g, '')
    points.push({
      label: formatSeasonPhaseLabel(season),
      dateRange: season.dateRange,
      totalHp: bestHp,
      version: season.version,
      phase: phaseNum,
      roomBuff: bestRoom ? toChartRoomBuffPreview(bestRoom) : undefined,
    })
  }

  return points
}

export function defenseSeasonsToPhaseData(seasons: DefenseSeason[]): PhaseData[] {
  return seasons.map((season) => {
    const buffs: BuffInfo[] = []

    for (const frontier of season.frontiers) {
      for (const room of frontier.rooms) {
        const roomBuff = room.roomBuff
        if (!isValidDefenseRoomBuff(roomBuff)) continue

        buffs.push({
          name: roomBuff.name,
          icon: '✦',
          imageUrl: roomBuff.imageUrl,
          lines: roomBuff.lines.length ? roomBuff.lines : [roomBuff.name],
        })
      }
    }

    if (!buffs.length) {
      buffs.push({ name: 'Buff 1', icon: '✦', lines: ['暂无 Buff 数据'] })
    }

    return {
      id: season.id,
      version: season.version,
      phase: season.phase,
      dateRange: season.dateRange,
      tid: season.seasonId,
      rawHp: season.rawHp,
      totalHp: season.totalHp,
      buffs: buffs as [BuffInfo, BuffInfo, BuffInfo],
      enemies: [EMPTY_ENEMY, EMPTY_ENEMY, EMPTY_ENEMY],
    }
  })
}
