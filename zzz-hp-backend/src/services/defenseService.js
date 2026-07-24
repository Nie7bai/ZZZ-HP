import pool from '../config/db.js'
import {
  decodeDefenseBossId,
  decodeDefenseBuffId,
  isDefenseBossId,
  isDefenseBuffId,
} from '../utils/defenseId.js'
import { getDefenseSeasonMeta } from './nanoka/defenseSeasonCatalog.js'
import { versionPhaseToDisplayId } from '../utils/defenseSeasonId.js'
import { isSeasonPubliclyVisible, isSeasonUnreleased, SEASON_EARLY_RELEASE_DAYS } from '../utils/crisisRoom.js'

const CHINESE_STAGE = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

function compareSeason(a, b) {
  const versionDiff = Number(a.version) - Number(b.version)
  if (versionDiff !== 0) return versionDiff
  return Number(a.phaseNum) - Number(b.phaseNum)
}

function matchesVariant(version, variant) {
  const majorMinor = Number(version)
  if (variant === 'new') return majorMinor >= 2.4
  return majorMinor < 2.4
}

function formatPhaseLabel(phase) {
  const num = String(phase).replace(/\D/g, '')
  return num ? `第 ${num} 期` : String(phase)
}

function formatDateValue(value) {
  if (!value) return null
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  const text = String(value).slice(0, 10)
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!match) return text || null
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

function formatDotDate(value) {
  const normalized = formatDateValue(value)
  if (!normalized) return ''
  const [year, month, day] = normalized.split('-')
  return `${year}.${Number(month)}.${Number(day)}`
}

function formatDateRange(startDate, endDate) {
  if (!startDate || !endDate) return '日期待更新'
  return `${formatDotDate(startDate)} - ${formatDotDate(endDate)}`
}

function frontierTitle(stage) {
  const label = CHINESE_STAGE[stage] ?? String(stage)
  return `第${label}防线`
}

function splitTraitText(value) {
  if (!value) return []
  return String(value)
    .split(/[、,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function isMeaningfulResistanceTrait(value) {
  const trimmed = String(value ?? '').trim()
  return Boolean(trimmed && trimmed !== '无')
}

function normalizeResistanceText(value) {
  if (!value) return undefined
  const traits = splitTraitText(value).filter(isMeaningfulResistanceTrait)
  return traits.length ? traits.join('、') : undefined
}

function formatHpNumber(value) {
  return Number(value || 0).toLocaleString('en-US')
}

function seasonKey(version, phase) {
  return `${version}-${String(phase).replace(/\D/g, '')}`
}

function computeRoomTotalHp(room) {
  let total = 0
  for (const battleRoom of room.battleRooms) {
    for (const wave of battleRoom.waves) {
      for (const enemy of wave.enemies) {
        total += (enemy.hpValue || 0) * (enemy.count || 1)
      }
    }
  }
  return total
}

function computeFrontierTotalHp(frontier) {
  return frontier.rooms.reduce((sum, room) => sum + computeRoomTotalHp(room), 0)
}

function buildSeasonSkeleton(version, phase, dateInfo) {
  const phaseNum = String(phase).replace(/\D/g, '')
  const catalog = getDefenseSeasonMeta(version, phase)
  const startDate = catalog?.startDate ?? dateInfo?.start_date
  const endDate = catalog?.endDate ?? dateInfo?.end_date
  const computedDisplayId = versionPhaseToDisplayId(version, phase)
  const seasonId =
    catalog?.seasonId ??
    (computedDisplayId != null ? String(computedDisplayId) : `${String(version).replace(/\D/g, '')}${phaseNum}`)

  return {
    id: `sd-${version}-${phaseNum}`,
    version: String(version),
    phase: formatPhaseLabel(phase),
    phaseNum,
    startDateRaw: formatDateValue(startDate),
    dateRange: formatDateRange(startDate, endDate),
    seasonId,
    nodeType: '剧变节点',
    frontiers: new Map(),
  }
}

function ensureFrontier(season, stage) {
  if (!season.frontiers.has(stage)) {
    season.frontiers.set(stage, {
      id: `${season.seasonId}${String(stage).padStart(2, '0')}`,
      title: frontierTitle(stage),
      level: 0,
      rooms: new Map(),
    })
  }
  return season.frontiers.get(stage)
}

function ensureRoom(frontier, stage, roomInStage) {
  const roomKey = `${stage}-${roomInStage}`
  if (!frontier.rooms.has(roomKey)) {
    frontier.rooms.set(roomKey, {
      id: `${frontier.id}${roomInStage}`,
      label: `房间 ${roomInStage}`,
      level: 0,
      zoneBuffs: [],
      roomBuff: { name: '', lines: [] },
      battleRooms: new Map(),
    })
  }
  return frontier.rooms.get(roomKey)
}

function ensureBattleRoom(room, stage, roomInStage) {
  const battleRoomKey = `${stage}-${roomInStage}-1`
  if (!room.battleRooms.has(battleRoomKey)) {
    room.battleRooms.set(battleRoomKey, {
      id: `${room.id}-br1`,
      label: '战斗房间 1',
      waveCount: 0,
      weakness: [],
      resistance: [],
      waves: new Map(),
    })
  }
  return room.battleRooms.get(battleRoomKey)
}

function ensureWave(battleRoom, wave) {
  if (!battleRoom.waves.has(wave)) {
    battleRoom.waves.set(wave, {
      label: `WAVE ${wave}`,
      enemies: [],
    })
  }
  return battleRoom.waves.get(wave)
}

function finalizeBattleRoom(battleRoom) {
  const waves = [...battleRoom.waves.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, wave]) => wave)

  return {
    id: battleRoom.id,
    label: battleRoom.label,
    waveCount: waves.length,
    weakness: [...new Set(battleRoom.weakness)],
    resistance: [...new Set(battleRoom.resistance)].filter(isMeaningfulResistanceTrait),
    waves,
  }
}

function finalizeRoom(room) {
  const battleRooms = [...room.battleRooms.values()].map(finalizeBattleRoom)
  return {
    id: room.id,
    label: room.label,
    level: room.level,
    zoneBuffs: room.zoneBuffs,
    roomBuff: room.roomBuff.name
      ? room.roomBuff
      : { name: '—', lines: room.zoneBuffs.length ? [] : ['暂无 Buff 数据'] },
    battleRooms,
  }
}

function roomHasEnemies(room) {
  for (const battleRoom of room.battleRooms.values()) {
    for (const wave of battleRoom.waves.values()) {
      if (wave.enemies.length > 0) return true
    }
  }
  return false
}

function roomHasBuff(room) {
  if (String(room.roomBuff?.name ?? '').trim()) return true
  if (Array.isArray(room.zoneBuffs) && room.zoneBuffs.length > 0) return true
  return false
}

/** 防卫战：第5关 3 间均有怪物，且每间 buff 已填写 */
function isDefenseSeasonReadyForEarlyRelease(season) {
  const frontier = season.frontiers.get(5)
  if (!frontier) return false
  for (const roomInStage of [1, 2, 3]) {
    const room = frontier.rooms.get(`5-${roomInStage}`)
    if (!room) return false
    if (!roomHasEnemies(room)) return false
    if (!roomHasBuff(room)) return false
  }
  return true
}

function finalizeSeason(season) {
  const frontiers = [...season.frontiers.entries()]
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([, frontier]) => {
      const rooms = [...frontier.rooms.entries()]
        .sort(([, a], [, b]) => {
          const roomA = Number(a.label.replace(/\D/g, ''))
          const roomB = Number(b.label.replace(/\D/g, ''))
          return roomA - roomB
        })
        .map(([, room]) => finalizeRoom(room))

      const level = rooms.reduce((max, room) => Math.max(max, room.level || 0), 0)
      return {
        id: frontier.id,
        title: frontier.title,
        level,
        rooms,
      }
    })

  const totalHp = frontiers.reduce((sum, frontier) => sum + computeFrontierTotalHp(frontier), 0)
  const allowEarly = isDefenseSeasonReadyForEarlyRelease(season)
  const listed = isSeasonPubliclyVisible(season.startDateRaw, {
    allowEarly,
    earlyReleaseDays: SEASON_EARLY_RELEASE_DAYS,
  })
  const isHidden = isSeasonUnreleased(season.startDateRaw)

  return {
    id: season.id,
    version: season.version,
    phase: season.phase,
    dateRange: season.dateRange,
    seasonId: season.seasonId,
    nodeType: season.nodeType,
    isHidden,
    listed,
    rawHp: formatHpNumber(totalHp),
    totalHp,
    frontiers,
  }
}

function applyBuffToRoom(room, buff, decoded) {
  const lines = String(buff.buff ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (decoded.buffIndex <= 2) {
    if (lines.length) room.zoneBuffs.push(...lines)
    return
  }

  if (buff.buff_name) {
    room.roomBuff = {
      name: buff.buff_name,
      imageUrl: buff.buff_image,
      lines: lines.length ? lines : [buff.buff_name],
    }
  }
}

function applyRoomBuffFallback(room, buff, decoded) {
  if (room.roomBuff.name) return
  if (!buff.buff_name) return

  const lines = String(buff.buff ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  room.roomBuff = {
    name: buff.buff_name,
    imageUrl: buff.buff_image,
    lines: lines.length ? lines : [buff.buff_name],
  }
  void decoded
}

export async function getDefenseSeasons(variant = 'new', { includeHidden = false } = {}) {
  const [bossRows] = await pool.execute(
    `SELECT id, version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image
     FROM boss
     ORDER BY version, CAST(phase AS UNSIGNED), id`,
  )
  const [buffRows] = await pool.execute(
    `SELECT id, version, phase, buff_name, buff, buff_image
     FROM buff
     ORDER BY version, CAST(phase AS UNSIGNED), id`,
  )
  const [dateRows] = await pool.execute(
    `SELECT version, phase, start_date, end_date FROM \`date\` WHERE mode = 'defense'
     UNION ALL
     SELECT version, phase, start_date, end_date FROM \`date\`
     WHERE (mode = 'crisis' OR mode IS NULL OR mode = '')
       AND NOT EXISTS (
         SELECT 1 FROM \`date\` d2
         WHERE d2.mode = 'defense'
           AND d2.version = \`date\`.version
           AND d2.phase = \`date\`.phase
       )`,
  )

  const dateMap = new Map(
    dateRows.map((row) => [seasonKey(row.version, row.phase), row]),
  )

  const seasons = new Map()

  for (const boss of bossRows) {
    if (!isDefenseBossId(boss.id)) continue
    if (!matchesVariant(boss.version, variant)) continue

    let decoded
    try {
      decoded = decodeDefenseBossId(boss.id)
    } catch {
      continue
    }

    const key = seasonKey(boss.version, boss.phase)
    if (!seasons.has(key)) {
      seasons.set(key, buildSeasonSkeleton(boss.version, boss.phase, dateMap.get(key)))
    }
    const season = seasons.get(key)

    const frontier = ensureFrontier(season, decoded.stage)
    const room = ensureRoom(frontier, decoded.stage, decoded.roomInStage)
    room.level = Math.max(room.level, Number(boss.level) || 0)
    frontier.level = Math.max(frontier.level, room.level)

    const battleRoom = ensureBattleRoom(room, decoded.stage, decoded.roomInStage)
    splitTraitText(boss.weakness).forEach((item) => battleRoom.weakness.push(item))
    splitTraitText(boss.resistance)
      .filter(isMeaningfulResistanceTrait)
      .forEach((item) => battleRoom.resistance.push(item))

    const wave = ensureWave(battleRoom, decoded.wave)
    wave.enemies.push({
      id: boss.id,
      name: boss.boss_name,
      imageUrl: boss.boss_image,
      count: decoded.count > 1 ? decoded.count : undefined,
      hp: formatHpNumber(boss.hp),
      hpValue: Number(boss.hp),
      defense: Number(boss.defense),
      weakness: boss.weakness,
      resistance: normalizeResistanceText(boss.resistance),
      isBoss: decoded.monsterCategory === 'boss',
    })
  }

  for (const buff of buffRows) {
    if (!isDefenseBuffId(buff.id)) continue
    if (!matchesVariant(buff.version, variant)) continue

    let decoded
    try {
      decoded = decodeDefenseBuffId(buff.id)
    } catch {
      continue
    }

    const key = seasonKey(buff.version, buff.phase)
    if (!seasons.has(key)) continue

    const season = seasons.get(key)
    const frontier = ensureFrontier(season, decoded.stage)
    const room = ensureRoom(frontier, decoded.stage, decoded.roomInStage)
    applyBuffToRoom(room, buff, decoded)
  }

  for (const buff of buffRows) {
    if (!isDefenseBuffId(buff.id)) continue
    if (!matchesVariant(buff.version, variant)) continue

    let decoded
    try {
      decoded = decodeDefenseBuffId(buff.id)
    } catch {
      continue
    }

    const key = seasonKey(buff.version, buff.phase)
    if (!seasons.has(key)) continue

    const season = seasons.get(key)
    const frontier = season.frontiers.get(decoded.stage)
    if (!frontier) continue

    const room = frontier.rooms.get(`${decoded.stage}-${decoded.roomInStage}`)
    if (!room) continue
    applyRoomBuffFallback(room, buff, decoded)
  }

  return [...seasons.values()]
    .sort(compareSeason)
    .map((season) => finalizeSeason(season))
    .filter((season) => includeHidden || season.listed)
    .map(({ listed: _listed, ...season }) => season)
}
