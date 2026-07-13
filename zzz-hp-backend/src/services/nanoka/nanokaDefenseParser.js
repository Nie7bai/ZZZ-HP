import {
  encodeDefenseBossId,
  encodeDefenseBuffId,
  formatDefenseBossRoom,
} from '../../utils/defenseId.js'

const ELEMENT_LABELS = {
  physical: '物理',
  fire: '火',
  ice: '冰',
  electric: '电',
  ether: '以太',
  wind: '风',
}

const ELEMENT_ICONS = {
  physical: '⚔️',
  fire: '🔥',
  ice: '❄️',
  electric: '⚡',
  ether: '🌀',
  wind: '💨',
}

function stripColorTags(text) {
  return String(text ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/\\n/g, '\n')
    .trim()
}

function categoryFromImage(imagePath) {
  const path = String(imagePath ?? '')
  if (path.includes('BossCardLv03') || path.includes('MonsterLv03')) return 'boss'
  if (path.includes('BossCardLv02') || path.includes('MonsterLv02')) return 'elite'
  return 'minion'
}

function tryDecodeTypeCode(key) {
  const typeCode = Number(String(key).slice(1, 3))
  const tens = Math.floor(typeCode / 10)
  const ones = typeCode % 10
  if (ones < 1 || ones > 9) return null
  if (tens === 0) return { monsterCategory: 'minion', monsterSubType: ones }
  if (tens === 1) return { monsterCategory: 'elite', monsterSubType: ones }
  if (tens === 2) return { monsterCategory: 'boss', monsterSubType: ones }
  return null
}

function assignNonBossWaves(entries, wavesNum, output) {
  const sorted = [...entries].sort((a, b) => a.spawnKey.localeCompare(b.spawnKey))
  const safeWaves = Math.max(1, wavesNum)
  if (!sorted.length) return

  if (sorted.length <= safeWaves) {
    sorted.forEach((entry, index) => {
      output.push({ ...entry, wave: index + 1 })
    })
    return
  }

  const clusters = []
  for (const entry of sorted) {
    const rawWave = Number(entry.spawnKey[3]) || 1
    const last = clusters[clusters.length - 1]
    if (!last || last.rawWave !== rawWave) {
      clusters.push({ rawWave, entries: [entry] })
    } else {
      last.entries.push(entry)
    }
  }

  if (clusters.length <= safeWaves) {
    clusters.forEach((cluster, index) => {
      cluster.entries.forEach((entry) => {
        output.push({ ...entry, wave: index + 1 })
      })
    })
    return
  }

  clusters[0].entries.forEach((entry) => {
    output.push({ ...entry, wave: 1 })
  })
  clusters.slice(1).flatMap((cluster) => cluster.entries).forEach((entry) => {
    output.push({ ...entry, wave: safeWaves })
  })
}

function resolveWaves(entries, wavesNum) {
  const safeWaves = Math.max(1, Number(wavesNum) || 1)
  const sorted = [...entries].sort((a, b) => a.spawnKey.localeCompare(b.spawnKey))
  const bosses = sorted.filter((entry) => categoryFromImage(entry.imagePath) === 'boss')
  const others = sorted.filter((entry) => categoryFromImage(entry.imagePath) !== 'boss')
  const output = []

  if (bosses.length > 0 && safeWaves > 1) {
    assignNonBossWaves(others, safeWaves - 1, output)
    bosses.forEach((entry) => {
      output.push({ ...entry, wave: safeWaves })
    })
    return output
  }

  assignNonBossWaves(sorted, safeWaves, output)
  return output
}

function formatWeakness(monsterWeakness = {}, element = {}) {
  const labels = new Set()
  const weaknessMap = {
    Physical: '物理',
    Fire: '火',
    Ice: '冰',
    Electric: '电',
    Ether: '以太',
    Wind: '风',
  }

  for (const value of Object.values(monsterWeakness)) {
    if (!value) continue
    labels.add(weaknessMap[value] ?? value)
  }
  for (const [key, value] of Object.entries(element)) {
    if (Number(value) > 0 && ELEMENT_LABELS[key]) {
      labels.add(ELEMENT_LABELS[key])
    }
  }
  return [...labels].join('、') || null
}

function formatResistance(element = {}) {
  const labels = []
  for (const [key, value] of Object.entries(element)) {
    if (Number(value) < 0 && ELEMENT_LABELS[key]) {
      labels.push(ELEMENT_LABELS[key])
    }
  }
  return labels.join('、') || null
}

function parseRoomInStage(zoneKey, zoneMeta = {}) {
  const roomMatch = String(zoneMeta.name ?? '').match(/房间\s*(\d+)/i)
  if (roomMatch) return Number(roomMatch[1])
  const enMatch = String(zoneMeta.name ?? '').match(/Room\s*(\d+)/i)
  if (enMatch) return Number(enMatch[1])
  return Number(String(zoneKey).slice(-1))
}

function parseBattleRoomMonsters({
  version,
  phase,
  stage,
  roomInStage,
  battleRoomKey,
  battleRoom,
  zoneMeta,
}) {
  const monsterList = battleRoom.monster_list ?? {}
  const wavesNum = Number(battleRoom.waves_num) || 1
  const level = Number(zoneMeta.monster_level) || 1

  const entries = Object.entries(monsterList).map(([spawnKey, monster]) => ({
    spawnKey,
    battleRoomKey,
    boss_name: monster.name,
    hp: Math.round(Number(monster.stats?.hp ?? 0)),
    defense: Math.round(Number(monster.stats?.defence ?? monster.stats?.def ?? 0)),
    level,
    weakness: formatWeakness(battleRoom.monster_weakness, monster.element),
    resistance: formatResistance(monster.element),
    boss_image: monster.image ? `/${String(monster.image).replace(/^\/+/, '')}` : null,
    imagePath: monster.image ?? '',
    count: Number(String(spawnKey).slice(-1)) || 1,
    decodedType: tryDecodeTypeCode(spawnKey),
    categoryFallback: categoryFromImage(monster.image),
  }))

  const withWaves = resolveWaves(entries, wavesNum)
  const subtypeCounters = new Map()

  return withWaves.map((entry) => {
    const categoryInfo = entry.decodedType ?? {
      monsterCategory: entry.categoryFallback,
      monsterSubType: 1,
    }
    const counterKey = `${entry.wave}:${categoryInfo.monsterCategory}`
    const nextSubType = (subtypeCounters.get(counterKey) ?? 0) + 1
    subtypeCounters.set(counterKey, nextSubType)

    const monsterCategory = categoryInfo.monsterCategory
    const monsterSubType = entry.decodedType
      ? categoryInfo.monsterSubType
      : Math.min(nextSubType, 9)

    const id = encodeDefenseBossId({
      version,
      phase,
      stage,
      roomInStage,
      wave: entry.wave,
      monsterCategory,
      monsterSubType,
      count: Math.min(Math.max(entry.count, 1), 9),
    })

    return {
      id,
      version,
      phase,
      boss_name: entry.boss_name,
      hp: entry.hp,
      defense: entry.defense,
      level: entry.level,
      room: formatDefenseBossRoom(stage, roomInStage),
      weakness: entry.weakness,
      resistance: entry.resistance,
      boss_image: entry.boss_image,
      stage,
      roomInStage,
      wave: entry.wave,
      monsterCategory,
      monsterSubType,
      count: Math.min(Math.max(entry.count, 1), 9),
      spawnKey: entry.spawnKey,
      battleRoomKey: entry.battleRoomKey,
    }
  })
}

function parseBuffRecords({ version, phase, stage, roomInStage, layerBuff = {} }) {
  const records = []
  const entries = Object.entries(layerBuff)
    .filter(([, buff]) => stripColorTags(buff.desc) || stripColorTags(buff.title))
    .sort(([a], [b]) => a.localeCompare(b))

  entries.forEach(([buffKey, buff], index) => {
    const buffIndex = index + 1
    const buffText = stripColorTags(buff.desc)
    const buffName = stripColorTags(buff.title) || `关卡效果 ${buffIndex}`

    records.push({
      id: encodeDefenseBuffId({
        version,
        phase,
        stage,
        roomInStage,
        buffIndex,
      }),
      version,
      phase,
      buff_name: buffName,
      buff: buffText,
      buff_image: null,
      stage,
      roomInStage,
      buffIndex,
      sourceKey: buffKey,
    })
  })

  return records
}

function collectZoneBattleRooms(zoneKey, zoneMeta) {
  const stage = Number(zoneMeta.stage_num) || Number(String(zoneKey).slice(-1))
  const roomInStage = parseRoomInStage(zoneKey, zoneMeta)
  const battleRooms = []

  for (const [battleRoomKey, battleRoom] of Object.entries(zoneMeta.layer_room ?? {})) {
    if (!battleRoom?.monster_list || !Object.keys(battleRoom.monster_list).length) continue
    battleRooms.push({
      stage,
      roomInStage: parseRoomInStage(battleRoomKey, zoneMeta) || roomInStage,
      battleRoomKey,
      battleRoom,
      zoneMeta,
    })
  }

  return battleRooms
}

export function parseNanokaDefenseSeason(season, meta) {
  const { version, phase } = meta
  const bosses = []
  const buffs = []
  const seenBoss = new Set()
  const seenBuff = new Set()

  for (const [zoneKey, zoneMeta] of Object.entries(season.zone ?? {})) {
    const battleRooms = collectZoneBattleRooms(zoneKey, zoneMeta)
    for (const room of battleRooms) {
      const roomBuffs = parseBuffRecords({
        version,
        phase,
        stage: room.stage,
        roomInStage: room.roomInStage,
        layerBuff: zoneMeta.layer_buff,
      })
      for (const buff of roomBuffs) {
        if (seenBuff.has(buff.id)) continue
        seenBuff.add(buff.id)
        buffs.push(buff)
      }

      const monsters = parseBattleRoomMonsters({
        version,
        phase,
        stage: room.stage,
        roomInStage: room.roomInStage,
        battleRoomKey: room.battleRoomKey,
        battleRoom: room.battleRoom,
        zoneMeta: room.zoneMeta,
      })
      for (const boss of monsters) {
        if (seenBoss.has(boss.id)) continue
        seenBoss.add(boss.id)
        bosses.push(boss)
      }
    }
  }

  return {
    seasonId: String(season.id),
    seasonName: season.name ?? '',
    beginTime: season.begin_time ?? null,
    endTime: season.end_time ?? null,
    version,
    phase,
    bosses,
    buffs,
  }
}

export { ELEMENT_LABELS, ELEMENT_ICONS, stripColorTags }
