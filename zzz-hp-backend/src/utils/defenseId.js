const MONSTER_CATEGORY_PREFIX = {
  minion: 0,
  elite: 1,
  boss: 2,
}

export function versionToCode(version) {
  const parts = String(version).trim().split('.')
  const major = parts[0]?.replace(/\D/g, '') || '0'
  const minor = parts[1]?.replace(/\D/g, '') || '0'
  return `${major}${minor}`.padStart(2, '0').slice(-2)
}

export function versionCodeToLabel(code) {
  const normalized = String(code).padStart(2, '0')
  return `${Number(normalized[0])}.${Number(normalized[1])}`
}

export function parsePhaseDigit(phase) {
  const value = Number(String(phase).replace(/\D/g, ''))
  if (!Number.isInteger(value) || value < 1 || value > 9) {
    throw new Error('期数须为 1-9 的单个数字')
  }
  return value
}

export function encodeMonsterTypeCode(category, subType) {
  if (!Number.isInteger(subType) || subType < 1 || subType > 9) {
    throw new Error('怪物序号须为 1-9')
  }
  return MONSTER_CATEGORY_PREFIX[category] * 10 + subType
}

export function decodeMonsterTypeCode(code) {
  const tens = Math.floor(code / 10)
  const ones = code % 10
  if (ones < 1 || ones > 9) {
    throw new Error('无效的怪物类型编码')
  }
  if (tens === 0) return { monsterCategory: 'minion', monsterSubType: ones }
  if (tens === 1) return { monsterCategory: 'elite', monsterSubType: ones }
  if (tens === 2) return { monsterCategory: 'boss', monsterSubType: ones }
  throw new Error('无效的怪物类型编码')
}

export function encodeDefenseBossId(parts) {
  const versionCode = versionToCode(parts.version)
  const phase = parsePhaseDigit(parts.phase)
  const stage = Number(parts.stage)
  const roomInStage = Number(parts.roomInStage)
  const wave = Number(parts.wave)
  const count = Number(parts.count)
  const typeCode = encodeMonsterTypeCode(parts.monsterCategory, parts.monsterSubType)

  if (!Number.isInteger(stage) || stage < 1 || stage > 9) {
    throw new Error('关卡须为 1-9')
  }
  if (!Number.isInteger(roomInStage) || roomInStage < 1 || roomInStage > 9) {
    throw new Error('房间须为 1-9')
  }
  if (!Number.isInteger(wave) || wave < 0 || wave > 9) {
    throw new Error('波次须为 0-9')
  }
  if (!Number.isInteger(count) || count < 1 || count > 9) {
    throw new Error('怪物数量须为 1-9')
  }

  const idText = `${versionCode}${phase}${stage}${roomInStage}${wave}${String(typeCode).padStart(2, '0')}${count}`
  if (idText.length !== 9) {
    throw new Error('怪物 ID 编码长度异常')
  }

  return Number(idText)
}

export function decodeDefenseBossId(id) {
  const idText = String(id).padStart(9, '0')
  if (!/^\d{9}$/.test(idText)) {
    throw new Error('怪物 ID 须为 9 位数字')
  }

  const typeCode = Number(idText.slice(6, 8))
  const { monsterCategory, monsterSubType } = decodeMonsterTypeCode(typeCode)

  return {
    version: versionCodeToLabel(idText.slice(0, 2)),
    phase: Number(idText[2]),
    stage: Number(idText[3]),
    roomInStage: Number(idText[4]),
    wave: Number(idText[5]),
    monsterCategory,
    monsterSubType,
    count: Number(idText[8]),
  }
}

export function encodeDefenseBuffId(parts) {
  const versionCode = versionToCode(parts.version)
  const phase = parsePhaseDigit(parts.phase)
  const stage = Number(parts.stage)
  const roomInStage = Number(parts.roomInStage)
  const buffIndex = Number(parts.buffIndex)

  if (!Number.isInteger(stage) || stage < 1 || stage > 99) {
    throw new Error('关卡须为 1-99')
  }
  if (!Number.isInteger(roomInStage) || roomInStage < 1 || roomInStage > 9) {
    throw new Error('房间须为 1-9')
  }
  if (!Number.isInteger(buffIndex) || buffIndex < 1 || buffIndex > 9) {
    throw new Error('Buff 序号须为 1-9')
  }

  const stageCode = String(stage).padStart(2, '0').slice(-2)
  const idText = `${versionCode}${phase}${stageCode}${roomInStage}${buffIndex}`
  if (idText.length !== 7) {
    throw new Error('Buff ID 编码长度异常')
  }

  return Number(idText)
}

/** 危局 Buff ID：版本去点 + 期数 + 两位序号，如 3.1 第1期第1条 → 31101 */
export function encodeCrisisBuffId(parts) {
  const versionCode = String(parts.version ?? '')
    .trim()
    .replace('.', '')
  const phase = parsePhaseDigit(parts.phase)
  const buffIndex = Number(parts.buffIndex)

  if (!versionCode) {
    throw new Error('版本为必填项')
  }
  if (!Number.isInteger(buffIndex) || buffIndex < 1 || buffIndex > 99) {
    throw new Error('Buff 序号须为 1-99')
  }

  const idText = `${versionCode}${phase}${String(buffIndex).padStart(2, '0')}`
  const id = Number(idText)
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('危局 Buff ID 编码异常')
  }
  if (isDefenseBuffId(id)) {
    throw new Error('危局 Buff ID 与防卫战 ID 规则冲突，请调整序号')
  }
  return id
}

export function decodeDefenseBuffId(id) {
  const idText = String(id).padStart(7, '0')
  if (!/^\d{7}$/.test(idText)) {
    throw new Error('Buff ID 须为 7 位数字')
  }

  return {
    version: versionCodeToLabel(idText.slice(0, 2)),
    phase: Number(idText[2]),
    stage: Number(idText.slice(3, 5)),
    roomInStage: Number(idText[5]),
    buffIndex: Number(idText[6]),
  }
}

export function formatDefenseBossRoom(stage, roomInStage) {
  return `${stage}-${roomInStage}`
}

export function isDefenseBossId(id) {
  return /^\d{9}$/.test(String(id))
}

export function isDefenseBuffId(id) {
  return /^\d{7}$/.test(String(id))
}

export function isCrisisBossId(id) {
  const text = String(id)
  if (!/^\d+$/.test(text)) return false
  return !isDefenseBossId(id)
}

export function isCrisisBuffId(id) {
  const text = String(id)
  if (!/^\d+$/.test(text)) return false
  return !isDefenseBuffId(id)
}
