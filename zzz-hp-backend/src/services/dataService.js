import pool from '../config/db.js'
import { upsertBossInfo } from './bossInfoService.js'
import {
  encodeDefenseBossId,
  encodeDefenseBuffId,
  formatDefenseBossRoom,
  isCrisisBossId,
  isCrisisBuffId,
  isDefenseBossId,
  isDefenseBuffId,
} from '../utils/defenseId.js'

const MAX_UNSIGNED_INT = 4294967295

function normalizePhase(phase) {
  const digits = String(phase).replace(/\D/g, '')
  return digits || String(phase).trim()
}

function assertHpInRange(hp) {
  const value = Number(hp) || 0
  if (value < 0 || value > MAX_UNSIGNED_INT) {
    throw new Error(`血量须在 0 - ${MAX_UNSIGNED_INT.toLocaleString('en-US')} 之间`)
  }
  return value
}

function encodeCrisisBossId(version, phase, room) {
  const versionCode = String(version).trim().replace('.', '')
  const phaseCode = String(phase).replace(/\D/g, '')
  const roomCode = String(room).replace(/\D/g, '')
  if (!versionCode || !phaseCode || !roomCode) {
    throw new Error('版本、期数、房间为必填项')
  }
  return Number(`${versionCode}${phaseCode}${roomCode}`)
}

export async function createBoss(payload) {
  const {
    recordScheme = 'crisis',
    id = null,
    version,
    phase,
    boss_name,
    hp = 0,
    defense = 0,
    level = 1,
    room = null,
    weakness = null,
    resistance = null,
    boss_image = null,
    stage = null,
    roomInStage = null,
    wave = null,
    monsterCategory = null,
    monsterSubType = null,
    count = null,
  } = payload

  const versionValue = String(version).trim()
  const phaseValue = normalizePhase(phase)
  const hpValue = assertHpInRange(hp)

  let bossId = id
  let roomValue = room

  if (recordScheme === 'defense') {
    const encodedId = encodeDefenseBossId({
      version: versionValue,
      phase: phaseValue,
      stage,
      roomInStage,
      wave,
      monsterCategory,
      monsterSubType,
      count,
    })
    if (bossId != null && Number(bossId) !== encodedId) {
      throw new Error('怪物 ID 与填写信息不一致')
    }
    bossId = encodedId
    roomValue = formatDefenseBossRoom(stage, roomInStage)
  } else if (bossId == null && room != null) {
    bossId = encodeCrisisBossId(versionValue, phaseValue, room)
  }

  const bossInfoSync = await upsertBossInfo({
    boss_name,
    defense,
    level,
    weakness,
    resistance,
    boss_image,
  })

  const bossValues = [
    versionValue,
    phaseValue,
    boss_name,
    hpValue,
    defense,
    level,
    roomValue,
    weakness,
    resistance,
    boss_image,
  ]

  if (bossId) {
    const [existing] = await pool.execute('SELECT id FROM boss WHERE id = ? LIMIT 1', [bossId])
    if (existing.length) {
      await pool.execute(
        `UPDATE boss
         SET version = ?, phase = ?, boss_name = ?, hp = ?, defense = ?, level = ?,
             room = ?, weakness = ?, resistance = ?, boss_image = ?
         WHERE id = ?`,
        [...bossValues, bossId],
      )
      return {
        id: bossId,
        version: versionValue,
        phase: phaseValue,
        boss_name,
        hp: hpValue,
        defense,
        level,
        room: roomValue,
        weakness,
        resistance,
        boss_image,
        bossInfoSync,
        action: 'updated',
      }
    }

    await pool.execute(
      `INSERT INTO boss (id, version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bossId, ...bossValues],
    )
    return {
      id: bossId,
      version: versionValue,
      phase: phaseValue,
      boss_name,
      hp: hpValue,
      defense,
      level,
      room: roomValue,
      weakness,
      resistance,
      boss_image,
      bossInfoSync,
      action: 'created',
    }
  }

  const [result] = await pool.execute(
    `INSERT INTO boss (version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    bossValues,
  )

  return {
    id: result.insertId,
    version: versionValue,
    phase: phaseValue,
    boss_name,
    hp: hpValue,
    defense,
    level,
    room: roomValue,
    weakness,
    resistance,
    boss_image,
    bossInfoSync,
    action: 'created',
  }
}

export async function createBuff(payload) {
  const {
    recordScheme = 'crisis',
    id = null,
    version,
    phase,
    buff_name,
    buff = null,
    buff_image = null,
    stage = null,
    roomInStage = null,
    buffIndex = null,
  } = payload

  let buffId = id

  if (recordScheme === 'defense') {
    const encodedId = encodeDefenseBuffId({
      version,
      phase,
      stage,
      roomInStage,
      buffIndex,
    })
    if (buffId != null && Number(buffId) !== encodedId) {
      throw new Error('Buff ID 与填写信息不一致')
    }
    buffId = encodedId
  }

  const columns = buffId
    ? `(id, version, phase, buff_name, buff, buff_image)`
    : `(version, phase, buff_name, buff, buff_image)`
  const placeholders = buffId ? `(?, ?, ?, ?, ?, ?)` : `(?, ?, ?, ?, ?)`
  const values = buffId
    ? [buffId, version, phase, buff_name, buff, buff_image]
    : [version, phase, buff_name, buff, buff_image]

  const [result] = await pool.execute(
    `INSERT INTO buff ${columns} VALUES ${placeholders}`,
    values,
  )

  return {
    id: buffId ?? result.insertId,
    version,
    phase,
    buff_name,
    buff,
    buff_image,
  }
}

export async function upsertBoss(payload) {
  const {
    id,
    version,
    phase,
    boss_name,
    hp = 0,
    defense = 0,
    level = 1,
    room = null,
    weakness = null,
    resistance = null,
    boss_image = null,
  } = payload

  if (!id) {
    return createBoss({ ...payload, recordScheme: 'defense' })
  }

  await upsertBossInfo({
    boss_name,
    defense,
    level,
    weakness,
    resistance,
    boss_image,
  })

  const [existing] = await pool.execute('SELECT id FROM boss WHERE id = ? LIMIT 1', [id])

  if (existing.length) {
    await pool.execute(
      `UPDATE boss
       SET version = ?, phase = ?, boss_name = ?, hp = ?, defense = ?, level = ?,
           room = ?, weakness = ?, resistance = ?, boss_image = ?
       WHERE id = ?`,
      [version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image, id],
    )
    return { id, action: 'updated', ...payload }
  }

  await pool.execute(
    `INSERT INTO boss (id, version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image],
  )

  return { id, action: 'created', ...payload }
}

export async function upsertBuff(payload) {
  const {
    id,
    version,
    phase,
    buff_name,
    buff = null,
    buff_image = null,
  } = payload

  if (!id) {
    return createBuff({ ...payload, recordScheme: 'defense' })
  }

  const [existing] = await pool.execute('SELECT id FROM buff WHERE id = ? LIMIT 1', [id])

  if (existing.length) {
    await pool.execute(
      `UPDATE buff
       SET version = ?, phase = ?, buff_name = ?, buff = ?, buff_image = ?
       WHERE id = ?`,
      [version, phase, buff_name, buff, buff_image, id],
    )
    return { id, action: 'updated', ...payload }
  }

  await pool.execute(
    `INSERT INTO buff (id, version, phase, buff_name, buff, buff_image)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, version, phase, buff_name, buff, buff_image],
  )

  return { id, action: 'created', ...payload }
}

function clampLimit(limit, fallback = 50, max = 100) {
  return Math.min(Math.max(Number(limit) || fallback, 1), max)
}

function matchesRecordScheme(id, recordScheme) {
  if (!recordScheme || recordScheme === 'all') return true
  if (recordScheme === 'defense') return isDefenseBossId(id)
  if (recordScheme === 'crisis') return isCrisisBossId(id)
  return true
}

function matchesBuffRecordScheme(id, recordScheme) {
  if (!recordScheme || recordScheme === 'all') return true
  if (recordScheme === 'defense') return isDefenseBuffId(id)
  if (recordScheme === 'crisis') return isCrisisBuffId(id)
  return true
}

export async function searchBossRecords(filters = {}) {
  const { version, phase, keyword, limit = 50, recordScheme = null } = filters
  const conditions = []
  const params = []

  if (String(version ?? '').trim()) {
    conditions.push('version = ?')
    params.push(String(version).trim())
  }
  if (String(phase ?? '').trim()) {
    conditions.push('phase = ?')
    params.push(String(phase).trim())
  }
  if (String(keyword ?? '').trim()) {
    conditions.push('boss_name LIKE ?')
    params.push(`%${String(keyword).trim()}%`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const safeLimit = clampLimit(limit)

  const [rows] = await pool.execute(
    `SELECT id, version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image
     FROM boss
     ${where}
     ORDER BY version DESC, phase DESC, id DESC
     LIMIT ${safeLimit}`,
    params,
  )

  return rows.filter((row) => matchesRecordScheme(row.id, recordScheme))
}

export async function deleteBoss(id) {
  const bossId = Number(id)
  if (!Number.isInteger(bossId) || bossId <= 0) {
    throw new Error('无效的 Boss ID')
  }

  const [result] = await pool.execute('DELETE FROM boss WHERE id = ?', [bossId])
  if (result.affectedRows === 0) {
    throw new Error('Boss 不存在或已删除')
  }

  return { id: bossId }
}

export async function searchBuffRecords(filters = {}) {
  const { version, phase, keyword, limit = 50, recordScheme = null } = filters
  const conditions = []
  const params = []

  if (String(version ?? '').trim()) {
    conditions.push('version = ?')
    params.push(String(version).trim())
  }
  if (String(phase ?? '').trim()) {
    conditions.push('phase = ?')
    params.push(String(phase).trim())
  }
  if (String(keyword ?? '').trim()) {
    conditions.push('buff_name LIKE ?')
    params.push(`%${String(keyword).trim()}%`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const safeLimit = clampLimit(limit)

  const [rows] = await pool.execute(
    `SELECT id, version, phase, buff_name, buff, buff_image
     FROM buff
     ${where}
     ORDER BY version DESC, phase DESC, id DESC
     LIMIT ${safeLimit}`,
    params,
  )

  return rows.filter((row) => matchesBuffRecordScheme(row.id, recordScheme))
}

export async function deleteBuff(id) {
  const buffId = Number(id)
  if (!Number.isInteger(buffId) || buffId <= 0) {
    throw new Error('无效的 Buff ID')
  }

  const [result] = await pool.execute('DELETE FROM buff WHERE id = ?', [buffId])
  if (result.affectedRows === 0) {
    throw new Error('Buff 不存在或已删除')
  }

  return { id: buffId }
}

export async function deleteDefenseSeasonData(version, phase) {
  const versionStr = String(version).trim()
  const phaseStr = String(phase).trim()
  if (!versionStr || !phaseStr) {
    throw new Error('version 与 phase 为必填项')
  }

  const [bossResult] = await pool.execute(
    `DELETE FROM boss
     WHERE version = ? AND phase = ? AND CHAR_LENGTH(CAST(id AS CHAR)) = 9`,
    [versionStr, phaseStr],
  )
  const [buffResult] = await pool.execute(
    `DELETE FROM buff
     WHERE version = ? AND phase = ? AND CHAR_LENGTH(CAST(id AS CHAR)) = 7`,
    [versionStr, phaseStr],
  )

  return {
    version: versionStr,
    phase: phaseStr,
    bossesDeleted: bossResult.affectedRows,
    buffsDeleted: buffResult.affectedRows,
  }
}

export async function deleteAllDefenseData() {
  const [bossResult] = await pool.execute(
    `DELETE FROM boss
     WHERE CHAR_LENGTH(CAST(id AS CHAR)) = 9`,
  )
  const [buffResult] = await pool.execute(
    `DELETE FROM buff
     WHERE CHAR_LENGTH(CAST(id AS CHAR)) = 7`,
  )

  return {
    bossesDeleted: bossResult.affectedRows,
    buffsDeleted: buffResult.affectedRows,
  }
}
