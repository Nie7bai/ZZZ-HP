import type { BossOption, ChartBossPreview, ChartRoomBuffPreview, HpChartPoint } from '@/api/crisisAssault'
import type { MonsterDetailRecord } from '@/components/history/MonsterDetailStats.vue'
import type { DefenseEnemy, DefenseRoom, DefenseSeason } from '@/types/defense'
import type { BuffInfo, EnemySlot, PhaseData } from '@/types/history'
import { decodeDefenseBossId, isDefenseBossId, type DefenseMonsterCategory } from '@/utils/defenseId'
import {
  buildDefenseRoomHpOptions,
  getDefenseHpOptionKey,
  getLastDefenseFrontier,
  type HpComparison,
} from '@/utils/defenseHp'
import { formatHpDelta, parseHpString } from '@/utils/gameData'
import {
  ANOMALY_BAR_VERSION_MULTIPLIER_FROM,
  isVersionAtMost,
  type MonsterAnomalyBarCategory,
} from '@/utils/monsterResistanceTable'

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

/**
 * 详情弹窗用的完整类别解析：小怪也算（getDefenseMonsterCategory 只认精英/Boss）。
 * ID 可解 ⇒ 解码出的 minion | elite | boss；否则回落 isBoss ? 'boss' : null。
 */
export function resolveDefenseMonsterCategory(enemy: DefenseEnemy): DefenseMonsterCategory | null {
  if (enemy.id != null && isDefenseBossId(enemy.id)) {
    try {
      return decodeDefenseBossId(enemy.id).monsterCategory
    } catch {
      return enemy.isBoss ? 'boss' : null
    }
  }

  return enemy.isBoss ? 'boss' : null
}

/**
 * 防卫战怪物类别 → 基础异常条类别：小怪（minion）按「普通」取基础值。
 * 推不出类别（null / 未知）时返回 undefined，字段缺省由「弱点与抗性」表按「首领」兜底。
 */
export function defenseMonsterCategoryToTableCategory(
  category: DefenseMonsterCategory | null,
): MonsterAnomalyBarCategory | undefined {
  if (category === 'minion') return 'normal'
  if (category === 'elite') return 'elite'
  if (category === 'boss') return 'boss'
  return undefined
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

/** 折线图类别：精英 / Boss / 小怪都算（详情弹窗按 `resolveDefenseMonsterCategory` 传入） */
export type DefenseChartMonsterCategory = DefenseMonsterCategory

export function buildDefenseBossChart(
  seasons: DefenseSeason[],
  bossName: string,
  category: DefenseChartMonsterCategory,
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
              if (resolveDefenseMonsterCategory(enemy) !== category || enemy.name !== bossName) continue

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

/** boss_info 基础库为怪物详情行补的字段；`BossInfoRecord` 结构兼容，可直接传入 */
export interface DefenseMonsterDetailBossInfo {
  level?: number | null
  stagger_multiplier?: number | null
  stagger_time?: number | null
  /** 异常条系数（初始异常积蓄 = 基础异常条 × 系数）；缺省 / null 由表按 1 处理 */
  anomaly_bar_coefficient?: number | null
}

/** 第五防线（stage 5）：史实上怪物等级为 70 的那道防线 */
export const DEFENSE_FIFTH_FRONTIER_STAGE = 5
export const DEFENSE_FIFTH_FRONTIER_MONSTER_LEVEL = 70
/** 其余防线（第一 ~ 第四防线）的怪物默认等级 */
export const DEFENSE_OTHER_FRONTIER_MONSTER_LEVEL = 1

function hasKnownBossInfoLevel(level: number | null | undefined): level is number {
  return typeof level === 'number' && Number.isFinite(level) && level > 0
}

/**
 * 防线怪物默认等级（唯一出处）：第五防线 70，其余防线 1。
 *
 * 有真实 `boss_info` 记录就用记录，**等级恰好是 1 也照用**：该等级同时供计算器与危局弹窗取用
 * （还参与抗性 / 防御换算），没有任何依据能判定某个第五防线怪物记录里的 1 一定只是占位值，
 * 在详情里改写成 70 只会让同一个怪物在两处显示不同等级。
 * 只有「查无记录 / 记录未填等级（null、0、非有限数）」才落回防线规则。
 */
export function resolveDefenseMonsterDefaultLevel(
  stage: number | null | undefined,
  bossInfoLevel?: number | null,
): number {
  if (hasKnownBossInfoLevel(bossInfoLevel)) return bossInfoLevel
  return stage === DEFENSE_FIFTH_FRONTIER_STAGE
    ? DEFENSE_FIFTH_FRONTIER_MONSTER_LEVEL
    : DEFENSE_OTHER_FRONTIER_MONSTER_LEVEL
}

/**
 * 该怪物是否在「版本系数起算版本」（2.1，含）时就已存在 —— 版本系数的第二个条件。
 *
 * 首次出现不晚于 2.1 即为 true：老怪物与 2.1 才出的新怪物都算，2.2 起才出的不算。
 * 同一性键取怪物**名**（`DefenseEnemy.name`）：防卫战跨赛季唯一可比的键。
 * 怪物 ID 编码了期数 / 防线 / 波次（见 `defenseId`），同一只怪物在不同赛季 ID 不同，不能用来比历史；
 * 名字在实战数据里按槽位唯一，跨赛季同名即同一只怪物。
 * 赛季版本解析不出（缺段 / 空串 / 非数字）时不算出现，与表里 `isVersionAtMost` 同口径。
 */
export function hasDefenseMonsterExistedByMultiplierVersion(
  seasons: DefenseSeason[],
  monsterName: string | undefined,
): boolean {
  if (!monsterName) return false

  for (const season of seasons) {
    if (!isVersionAtMost(season.version, ANOMALY_BAR_VERSION_MULTIPLIER_FROM)) continue

    for (const frontier of season.frontiers) {
      for (const room of frontier.rooms) {
        for (const battleRoom of room.battleRooms) {
          for (const wave of battleRoom.waves) {
            if (wave.enemies.some((enemy) => enemy.name === monsterName)) return true
          }
        }
      }
    }
  }

  return false
}

/**
 * 防卫战怪物详情数据行组装（与危局弹窗同形状，共用 `MonsterDetailStats`）：
 * 血量 / 防御 / 失衡时间 / 弱点 / 抗性取自 `DefenseEnemy`，血量对比由面板按卡片同一口径算好传入；
 * 失衡易伤与等级里的 `DefenseEnemy` 不带，只能来自 boss_info 基础库（查无记录时为 null）；
 * 等级额外按防线规则补默认值（第五防线 70、其余防线 1）；传 `stage` 表示拿得到防线，
 * 为 null / 缺省表示拿不到，此时保持旧口径「只有 boss_info 有记录才渲染等级行」；
 * 基础异常条类别按防卫战怪物 ID 推导（小怪按「普通」、精英按「精英」、Boss 按「首领」，
 * 推不出时缺省由表按「首领」兜底），异常条系数取 boss_info（后端读取时已解析内置默认表，
 * 目录内怪物能拿到真实系数），缺省 / 非法值由表按 1 兜底；
 * 版本取所在赛季的 `season.version`，供表判「2.1 期起异常条 ×1.1」，缺省 / null 表示拿不到版本、
 * 由表按不乘处理；版本系数的第二个条件（该怪物是否在 2.1（含）之前就已存在）由
 * `hasDefenseMonsterExistedByMultiplierVersion` 扫全量赛季算出后传入，缺省按 false；
 * 危局专属的基础血量 / 血量系数不填，共享组件里本就不渲染这几行。
 */
export function buildDefenseMonsterDetailRecord(
  enemy: DefenseEnemy,
  hpComparison: HpComparison | null,
  bossInfo: DefenseMonsterDetailBossInfo | null,
  /** 该怪物所在防线（stage）；缺省 / null 表示拿不到防线，不套用防线规则 */
  stage?: number | null,
  /** 该怪物所在赛季的游戏版本（如 3.2）；缺省 / null 表示拿不到版本，不套用版本系数 */
  version?: string | null,
  /** 该怪物是否在 2.1（含）之前就已存在（首次出现不晚于 2.1）；缺省表示未算出，按 false（不乘版本系数） */
  bossExistedByMultiplierVersion?: boolean,
): MonsterDetailRecord {
  return {
    boss_name: enemy.name || null,
    hp: enemy.hp || null,
    hp_expansion: hpComparison?.expansion ?? null,
    hp_delta_label: hpComparison ? formatHpDelta(hpComparison.diff) : null,
    level:
      stage == null
        ? bossInfo?.level ?? null
        : resolveDefenseMonsterDefaultLevel(stage, bossInfo?.level),
    defense: enemy.defense ?? null,
    stagger_time: enemy.staggerTime ?? bossInfo?.stagger_time ?? null,
    stagger_multiplier: bossInfo?.stagger_multiplier ?? null,
    weakness: enemy.weakness ?? null,
    resistance: enemy.resistance ?? null,
    resistance_high: enemy.resistanceHigh ?? null,
    monster_category: defenseMonsterCategoryToTableCategory(resolveDefenseMonsterCategory(enemy)),
    anomaly_bar_coefficient: bossInfo?.anomaly_bar_coefficient ?? null,
    version: version ?? null,
    boss_existed_by_multiplier_version: bossExistedByMultiplierVersion === true,
  }
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
