import pool from '../config/db.js'
import { upsertBossInfo } from './bossInfoService.js'
import {
  DEFAULT_BOSS_STAGGER_MULTIPLIER,
  ensureBossStaggerSchema,
  normalizeStaggerMultiplier,
} from '../utils/bossSchema.js'
import {
  ensureEnvironmentBuffSchema,
  parseEffectBlocksJson,
  serializeEffectBlocks,
} from '../utils/environmentBuffSchema.js'
import {
  encodeCrisisBuffId,
  encodeDefenseBossId,
  encodeDefenseBuffId,
  formatDefenseBossRoom,
  isCrisisBossId,
  isCrisisBuffId,
  isDefenseBossId,
  isDefenseBuffId,
} from '../utils/defenseId.js'
import { resolveCrisisHpCoeff } from '../utils/crisisHpCoeff.js'
import { normalizeCrisisRoomCode } from '../utils/crisisRoom.js'

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
  const roomCode = normalizeCrisisRoomCode(room)
  if (!versionCode || !phaseCode || !roomCode) {
    throw new Error('版本、期数、房间为必填项')
  }
  return Number(`${versionCode}${phaseCode}${roomCode}`)
}

function normalizeManualCoeff(raw) {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return Math.round(n)
}

export async function createBoss(payload) {
  await ensureBossStaggerSchema()
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
    crisis_base_hp = null,
    hp_coeff_percent = null,
    hp_coeff_manual = false,
    stagger_multiplier = null,
    mode = null,
  } = payload

  const versionValue = String(version).trim()
  const phaseValue = normalizePhase(phase)
  const modeValue = mode ?? (recordScheme === 'defense' ? 'defense' : 'crisis')
  const hpValue = assertHpInRange(hp)
  const manualCoeff =
    recordScheme === 'crisis' && (hp_coeff_manual === true || hp_coeff_manual === 'true')
      ? normalizeManualCoeff(hp_coeff_percent)
      : null

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
    roomValue = normalizeCrisisRoomCode(room)
  } else if (room != null) {
    roomValue = normalizeCrisisRoomCode(room) || room
  }

  const bossInfoSync = await upsertBossInfo({
    boss_name,
    defense,
    level,
    weakness,
    resistance,
    boss_image,
    crisis_base_hp,
    stagger_multiplier:
      stagger_multiplier != null && stagger_multiplier !== ''
        ? normalizeStaggerMultiplier(stagger_multiplier)
        : DEFAULT_BOSS_STAGGER_MULTIPLIER,
  })

  const staggerValue =
    stagger_multiplier != null && stagger_multiplier !== ''
      ? normalizeStaggerMultiplier(stagger_multiplier)
      : null

  const coeffResolved = resolveCrisisHpCoeff({
    bossHp: hpValue,
    baseHp: bossInfoSync.crisis_base_hp,
    manualPercent: manualCoeff,
  })

  const bossValues = [
    versionValue,
    phaseValue,
    boss_name,
    hpValue,
    manualCoeff,
    defense,
    level,
    roomValue,
    weakness,
    resistance,
    boss_image,
    staggerValue,
  ]

  if (bossId) {
    const [existing] = await pool.execute('SELECT id FROM boss WHERE id = ? LIMIT 1', [bossId])
    if (existing.length) {
      await pool.execute(
        `UPDATE boss
         SET version = ?, phase = ?, boss_name = ?, hp = ?, hp_coeff_percent = ?, defense = ?, level = ?,
             room = ?, weakness = ?, resistance = ?, boss_image = ?, stagger_multiplier = ?, mode = ?
         WHERE id = ?`,
        [...bossValues, modeValue, bossId],
      )
      return {
        id: bossId,
        version: versionValue,
        phase: phaseValue,
        boss_name,
        hp: hpValue,
        hp_coeff_percent: coeffResolved.percent,
        hp_coeff_manual: coeffResolved.manual,
        crisis_base_hp: bossInfoSync.crisis_base_hp,
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
      `INSERT INTO boss (id, version, phase, boss_name, hp, hp_coeff_percent, defense, level, room, weakness, resistance, boss_image, stagger_multiplier, mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bossId, ...bossValues, modeValue],
    )
    return {
      id: bossId,
      version: versionValue,
      phase: phaseValue,
      boss_name,
      hp: hpValue,
      hp_coeff_percent: coeffResolved.percent,
      hp_coeff_manual: coeffResolved.manual,
      crisis_base_hp: bossInfoSync.crisis_base_hp,
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
    `INSERT INTO boss (version, phase, boss_name, hp, hp_coeff_percent, defense, level, room, weakness, resistance, boss_image, stagger_multiplier, mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [...bossValues, modeValue],
  )

  return {
    id: result.insertId,
    version: versionValue,
    phase: phaseValue,
    boss_name,
    hp: hpValue,
    hp_coeff_percent: coeffResolved.percent,
    hp_coeff_manual: coeffResolved.manual,
    crisis_base_hp: bossInfoSync.crisis_base_hp,
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
  await ensureEnvironmentBuffSchema()
  const {
    recordScheme = 'crisis',
    id = null,
    version,
    phase,
    buff_name,
    buff = null,
    buff_image = null,
    effect_blocks = null,
    stage = null,
    roomInStage = null,
    buffIndex = null,
    mode = null,
  } = payload

  const versionValue = String(version).trim()
  const phaseValue = normalizePhase(phase)
  const effectBlocksJson = serializeEffectBlocks(effect_blocks)
  const modeValue = mode ?? (recordScheme === 'defense' ? 'defense' : 'crisis')
  let buffId = id != null && id !== '' ? Number(id) : null
  let action = 'created'

  if (recordScheme === 'defense') {
    const encodedId = encodeDefenseBuffId({
      version: versionValue,
      phase: phaseValue,
      stage,
      roomInStage,
      buffIndex,
    })
    if (buffId != null && Number(buffId) !== encodedId) {
      throw new Error('Buff ID 与填写信息不一致')
    }
    buffId = encodedId
  } else {
    // 危局必须按 31101 规则编码，禁止自增落入防卫战 7 位 ID 区间
    const index = buffIndex != null && buffIndex !== '' ? Number(buffIndex) : 1
    const encodedId = encodeCrisisBuffId({
      version: versionValue,
      phase: phaseValue,
      buffIndex: index,
    })
    if (buffId != null && Number(buffId) !== encodedId) {
      throw new Error('Buff ID 与填写信息不一致')
    }
    buffId = encodedId
  }

  const [existing] = await pool.execute('SELECT id FROM buff WHERE id = ? LIMIT 1', [buffId])
  if (existing.length) {
    await pool.execute(
      `UPDATE buff
       SET version = ?, phase = ?, buff_name = ?, buff = ?, buff_image = ?, effect_blocks = ?, mode = ?
       WHERE id = ?`,
      [versionValue, phaseValue, buff_name, buff, buff_image, effectBlocksJson, modeValue, buffId],
    )
    action = 'updated'
  } else {
    await pool.execute(
      `INSERT INTO buff (id, version, phase, buff_name, buff, buff_image, effect_blocks, mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [buffId, versionValue, phaseValue, buff_name, buff, buff_image, effectBlocksJson, modeValue],
    )
  }

  return {
    id: buffId,
    version: versionValue,
    phase: phaseValue,
    buff_name,
    buff,
    buff_image,
    effect_blocks: parseEffectBlocksJson(effectBlocksJson),
    action,
  }
}

export async function upsertBoss(payload) {
  await ensureBossStaggerSchema()
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
    stagger_multiplier = null,
    mode = null,
  } = payload

  if (!id) {
    return createBoss({ ...payload, recordScheme: 'defense' })
  }

  const modeValue = mode ?? (isDefenseBossId(id) ? 'defense' : 'crisis')

  await upsertBossInfo({
    boss_name,
    defense,
    level,
    weakness,
    resistance,
    boss_image,
    stagger_multiplier,
  })

  const staggerValue =
    stagger_multiplier != null && stagger_multiplier !== ''
      ? normalizeStaggerMultiplier(stagger_multiplier)
      : null

  const [existing] = await pool.execute('SELECT id FROM boss WHERE id = ? LIMIT 1', [id])

  if (existing.length) {
    await pool.execute(
      `UPDATE boss
       SET version = ?, phase = ?, boss_name = ?, hp = ?, defense = ?, level = ?,
           room = ?, weakness = ?, resistance = ?, boss_image = ?, stagger_multiplier = ?, mode = ?
       WHERE id = ?`,
      [
        version,
        phase,
        boss_name,
        hp,
        defense,
        level,
        room,
        weakness,
        resistance,
        boss_image,
        staggerValue,
        modeValue,
        id,
      ],
    )
    return { id, action: 'updated', ...payload }
  }

  await pool.execute(
    `INSERT INTO boss (id, version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image, stagger_multiplier, mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      version,
      phase,
      boss_name,
      hp,
      defense,
      level,
      room,
      weakness,
      resistance,
      boss_image,
      staggerValue,
      modeValue,
    ],
  )

  return { id, action: 'created', ...payload }
}

export async function upsertBuff(payload) {
  await ensureEnvironmentBuffSchema()
  const {
    id,
    version,
    phase,
    buff_name,
    buff = null,
    buff_image = null,
    effect_blocks = null,
    mode = null,
  } = payload

  if (!id) {
    return createBuff({ ...payload, recordScheme: 'defense' })
  }

  const modeValue = mode ?? (isDefenseBuffId(id) ? 'defense' : 'crisis')
  const effectBlocksJson = serializeEffectBlocks(effect_blocks)
  const [existing] = await pool.execute('SELECT id FROM buff WHERE id = ? LIMIT 1', [id])

  if (existing.length) {
    await pool.execute(
      `UPDATE buff
       SET version = ?, phase = ?, buff_name = ?, buff = ?, buff_image = ?, effect_blocks = ?, mode = ?
       WHERE id = ?`,
      [version, phase, buff_name, buff, buff_image, effectBlocksJson, modeValue, id],
    )
    return {
      id,
      action: 'updated',
      ...payload,
      effect_blocks: parseEffectBlocksJson(effectBlocksJson),
    }
  }

  await pool.execute(
    `INSERT INTO buff (id, version, phase, buff_name, buff, buff_image, effect_blocks, mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, version, phase, buff_name, buff, buff_image, effectBlocksJson, modeValue],
  )

  return {
    id,
    action: 'created',
    ...payload,
    effect_blocks: parseEffectBlocksJson(effectBlocksJson),
  }
}

function clampLimit(limit, fallback = 50, max = 100) {
  return Math.min(Math.max(Number(limit) || fallback, 1), max)
}

function matchesRecordScheme(row, recordScheme) {
  if (!recordScheme || recordScheme === 'all') return true
  const mode = row.mode ?? (isDefenseBossId(row.id) ? 'defense' : 'crisis')
  if (recordScheme === 'defense') return mode === 'defense'
  if (recordScheme === 'crisis') return mode === 'crisis'
  return true
}

function matchesBuffRecordScheme(row, recordScheme) {
  if (!recordScheme || recordScheme === 'all') return true
  const mode = row.mode ?? (isDefenseBuffId(row.id) ? 'defense' : 'crisis')
  if (recordScheme === 'defense') return mode === 'defense'
  if (recordScheme === 'crisis') return mode === 'crisis'
  return true
}

export async function searchBossRecords(filters = {}) {
  await ensureBossStaggerSchema()
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
    `SELECT id, version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image, stagger_multiplier, mode
     FROM boss
     ${where}
     ORDER BY version DESC, phase DESC, id DESC
     LIMIT ${safeLimit}`,
    params,
  )

  return rows.filter((row) => matchesRecordScheme(row, recordScheme))
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
  await ensureEnvironmentBuffSchema()
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
    `SELECT id, version, phase, buff_name, buff, buff_image, effect_blocks, mode
     FROM buff
     ${where}
     ORDER BY version DESC, phase DESC, id DESC
     LIMIT ${safeLimit}`,
    params,
  )

  return rows
    .filter((row) => matchesBuffRecordScheme(row, recordScheme))
    .map((row) => ({
      ...row,
      effect_blocks: parseEffectBlocksJson(row.effect_blocks),
    }))
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
    scheme: 'defense',
    bossesDeleted: bossResult.affectedRows,
    buffsDeleted: buffResult.affectedRows,
  }
}

/** 危局：同 version/phase，且排除防卫战专用 ID 长度（boss 9 位 / buff 7 位） */
export async function deleteCrisisSeasonData(version, phase) {
  const versionStr = String(version).trim()
  const phaseStr = String(phase).trim()
  if (!versionStr || !phaseStr) {
    throw new Error('version 与 phase 为必填项')
  }

  const [bossResult] = await pool.execute(
    `DELETE FROM boss
     WHERE version = ? AND phase = ? AND CHAR_LENGTH(CAST(id AS CHAR)) <> 9`,
    [versionStr, phaseStr],
  )
  const [buffResult] = await pool.execute(
    `DELETE FROM buff
     WHERE version = ? AND phase = ? AND CHAR_LENGTH(CAST(id AS CHAR)) <> 7`,
    [versionStr, phaseStr],
  )

  return {
    version: versionStr,
    phase: phaseStr,
    scheme: 'crisis',
    bossesDeleted: bossResult.affectedRows,
    buffsDeleted: buffResult.affectedRows,
  }
}

/**
 * @param {'defense'|'crisis'} scheme
 */
export async function previewSeasonContent(scheme, version, phase) {
  const versionStr = String(version).trim()
  const phaseStr = String(phase).trim().replace(/\D/g, '') || String(phase).trim()
  if (!versionStr || !phaseStr) {
    throw new Error('version 与 phase 为必填项')
  }
  const mode = scheme === 'defense' ? 'defense' : 'crisis'

  const bossFilter =
    mode === 'defense'
      ? 'CHAR_LENGTH(CAST(id AS CHAR)) = 9'
      : 'CHAR_LENGTH(CAST(id AS CHAR)) <> 9'
  const buffFilter =
    mode === 'defense'
      ? 'CHAR_LENGTH(CAST(id AS CHAR)) = 7'
      : 'CHAR_LENGTH(CAST(id AS CHAR)) <> 7'

  const [[bossCount]] = await pool.execute(
    `SELECT COUNT(*) AS cnt FROM boss WHERE version = ? AND phase = ? AND ${bossFilter}`,
    [versionStr, phaseStr],
  )
  const [[buffCount]] = await pool.execute(
    `SELECT COUNT(*) AS cnt FROM buff WHERE version = ? AND phase = ? AND ${buffFilter}`,
    [versionStr, phaseStr],
  )
  const [[dateCount]] = await pool.execute(
    mode === 'defense'
      ? `SELECT COUNT(*) AS cnt FROM \`date\`
         WHERE mode = 'defense' AND version = ? AND phase = ?`
      : `SELECT COUNT(*) AS cnt FROM \`date\`
         WHERE version = ? AND phase = ?
           AND (mode = 'crisis' OR mode IS NULL OR mode = '')`,
    [versionStr, phaseStr],
  )

  const { getSeasonContentTrashEntry } = await import('./seasonContentTrashService.js')
  const trash = await getSeasonContentTrashEntry(mode, versionStr, phaseStr)

  const bossN = Number(bossCount?.cnt || 0)
  const buffN = Number(buffCount?.cnt || 0)
  const dateN = Number(dateCount?.cnt || 0)

  const warnings = []
  if (bossN > 0 || buffN > 0) {
    warnings.push(`将标记删除怪物 ${bossN} 条、Buff ${buffN} 条（数据会保留，直到执行清理）。`)
  }
  if (dateN > 0) {
    warnings.push(`本期有 ${dateN} 条版本日期；软删除后前台不再展示，清理时才会真正删掉日期。`)
  }
  if (bossN === 0 && buffN === 0 && dateN > 0) {
    warnings.push('怪物/Buff 已空，但仍有版本日期或空骨架。软删除后显示「已删除未清理」，清理后本期消失。')
  }
  if (trash) {
    warnings.push('本期已处于「已删除未清理」状态，可恢复，或清理永久删除。')
  }

  return {
    version: versionStr,
    phase: phaseStr,
    scheme: mode,
    bossCount: bossN,
    buffCount: buffN,
    dateCount: dateN,
    pendingCleanup: Boolean(trash),
    deletedAt: trash?.deletedAt ?? null,
    warnings,
    canSoftDelete: !trash && (bossN > 0 || buffN > 0 || dateN > 0),
    canRestore: Boolean(trash),
    canCleanup: Boolean(trash) || bossN > 0 || buffN > 0 || dateN > 0,
  }
}

/** 软删除：写入回收标记，不立刻删库内容 */
export async function softDeleteSeasonContent(scheme, version, phase) {
  const preview = await previewSeasonContent(scheme, version, phase)
  if (preview.pendingCleanup) {
    return {
      ...preview,
      action: 'already_soft_deleted',
    }
  }
  if (!preview.canSoftDelete) {
    throw new Error('没有可标记删除的内容')
  }

  const { softDeleteSeasonContent: markTrash } = await import('./seasonContentTrashService.js')
  const trash = await markTrash(preview.scheme, preview.version, preview.phase, {
    bossCount: preview.bossCount,
    buffCount: preview.buffCount,
    dateCount: preview.dateCount,
    note: 'admin soft delete',
  })

  return {
    version: preview.version,
    phase: preview.phase,
    scheme: preview.scheme,
    action: 'soft_deleted',
    bossCount: preview.bossCount,
    buffCount: preview.buffCount,
    dateCount: preview.dateCount,
    pendingCleanup: true,
    deletedAt: trash?.deletedAt ?? null,
  }
}

/** 恢复：移除回收标记，前台重新可见 */
export async function restoreSeasonContent(scheme, version, phase) {
  const preview = await previewSeasonContent(scheme, version, phase)
  if (!preview.pendingCleanup) {
    throw new Error('本期不在「已删除未清理」状态，无需恢复')
  }

  const { removeSeasonContentTrashEntry } = await import('./seasonContentTrashService.js')
  await removeSeasonContentTrashEntry(preview.scheme, preview.version, preview.phase)

  return {
    version: preview.version,
    phase: preview.phase,
    scheme: preview.scheme,
    action: 'restored',
    bossCount: preview.bossCount,
    buffCount: preview.buffCount,
    dateCount: preview.dateCount,
    pendingCleanup: false,
    deletedAt: null,
  }
}

/** 清理：永久删除 boss/buff/日期，并移除回收标记 */
export async function cleanupSeasonContent(scheme, version, phase, options = {}) {
  const alsoDeleteDates = options.alsoDeleteDates !== false
  const mode = scheme === 'defense' ? 'defense' : 'crisis'
  const versionStr = String(version).trim()
  const phaseStr = String(phase).trim().replace(/\D/g, '') || String(phase).trim()

  const content =
    mode === 'defense'
      ? await deleteDefenseSeasonData(versionStr, phaseStr)
      : await deleteCrisisSeasonData(versionStr, phaseStr)

  let datesDeleted = 0
  if (alsoDeleteDates) {
    const [dateResult] = await pool.execute(
      mode === 'defense'
        ? `DELETE FROM \`date\` WHERE mode = 'defense' AND version = ? AND phase = ?`
        : `DELETE FROM \`date\`
           WHERE version = ? AND phase = ?
             AND (mode = 'crisis' OR mode IS NULL OR mode = '')`,
      [content.version, content.phase],
    )
    datesDeleted = dateResult.affectedRows
  }

  const { removeSeasonContentTrashEntry } = await import('./seasonContentTrashService.js')
  await removeSeasonContentTrashEntry(mode, content.version, content.phase)

  return {
    ...content,
    datesDeleted,
    alsoDeleteDates,
    action: 'cleaned',
  }
}

/**
 * @deprecated 兼容旧调用：改为软删除
 */
export async function purgeSeasonContent(scheme, version, phase, _options = {}) {
  return softDeleteSeasonContent(scheme, version, phase)
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
