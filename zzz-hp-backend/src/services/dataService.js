import pool from '../config/db.js'
import { findBossInfoByName, upsertBossInfo } from './bossInfoService.js'
import { ensureContentModeColumns } from './contentModeService.js'
import {
  DEFAULT_BOSS_STAGGER_MULTIPLIER,
  ensureBossStaggerSchema,
  normalizeStaggerMultiplier,
  normalizeStaggerTime,
} from '../utils/bossSchema.js'
import {
  ensureEnvironmentBuffSchema,
  parseEffectBlocksJson,
  serializeEffectBlocks,
} from '../utils/environmentBuffSchema.js'
import {
  loadGlobalBuffEffectMap,
  propagateSameNameEffectBlocks,
  resolveEffectBlocksForName,
} from '../utils/sameNameBuffEffects.js'
import {
  encodeCrisisBuffId,
  encodeDefenseBossId,
  encodeDefenseBuffId,
  formatDefenseBossRoom,
  isDefenseBossId,
  isDefenseBuffId,
} from '../utils/defenseId.js'
import { resolveCrisisHpCoeff } from '../utils/crisisHpCoeff.js'
import { normalizeCrisisRoomCode } from '../utils/crisisRoom.js'
import { pickBestImagePath } from '../utils/localImagePath.js'

let contentModeEnsured = false

async function ensureContentModeSchema() {
  if (contentModeEnsured) return
  await ensureContentModeColumns(pool)
  contentModeEnsured = true
}

const MAX_UNSIGNED_INT = 4294967295

function normalizePhase(phase) {
  const digits = String(phase).replace(/\D/g, '')
  if (!digits) return String(phase).trim()
  // 去掉前导零，避免 "01" 与 "1" 分成两期导致加完看不见
  return String(Number(digits))
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
  await ensureContentModeSchema()
  await ensureEnvironmentBuffSchema()
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
    stagger_time = null,
    mode = null,
    field_buff_set_id = null,
  } = payload

  const versionValue = String(version).trim()
  const phaseValue = normalizePhase(phase)
  const modeValue = resolveContentMode({ mode, recordScheme, id, kind: 'boss' })
  const hpValue = assertHpInRange(hp)
  const manualCoeff =
    modeValue === 'crisis' && (hp_coeff_manual === true || hp_coeff_manual === 'true')
      ? normalizeManualCoeff(hp_coeff_percent)
      : null
  const fieldBuffSetId =
    modeValue === 'crisis' && field_buff_set_id != null && String(field_buff_set_id).trim()
      ? String(field_buff_set_id).trim()
      : null

  let bossId = id
  let roomValue = room

  if (recordScheme === 'defense' || modeValue === 'defense') {
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
  } else if (recordScheme === 'deduction' || modeValue === 'deduction') {
    // 临界：允许自增 id；显式 id 保留（不走危局/防卫编码）
    if (bossId != null && bossId !== '') {
      bossId = Number(bossId)
      if (!Number.isInteger(bossId) || bossId <= 0) {
        throw new Error('无效的临界怪物 ID')
      }
    }
  } else if (bossId == null && room != null) {
    bossId = encodeCrisisBossId(versionValue, phaseValue, room)
    roomValue = normalizeCrisisRoomCode(room)
  } else if (room != null) {
    roomValue = normalizeCrisisRoomCode(room) || room
  }

  let existingBossImage = null
  if (bossId) {
    const [existingImageRows] = await pool.execute(
      'SELECT boss_image FROM boss WHERE id = ? LIMIT 1',
      [bossId],
    )
    existingBossImage = existingImageRows[0]?.boss_image ?? null
  }
  const catalogImage = (await findBossInfoByName(boss_name))?.boss_image ?? null
  const resolvedBossImage = pickBestImagePath(boss_image, existingBossImage, catalogImage)

  const staggerTimeValue = normalizeStaggerTime(stagger_time)

  const bossInfoSync = await upsertBossInfo({
    boss_name,
    defense,
    level,
    weakness,
    resistance,
    boss_image: resolvedBossImage,
    crisis_base_hp,
    stagger_multiplier:
      stagger_multiplier != null && stagger_multiplier !== ''
        ? normalizeStaggerMultiplier(stagger_multiplier)
        : DEFAULT_BOSS_STAGGER_MULTIPLIER,
    stagger_time: staggerTimeValue,
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
    resolvedBossImage,
    staggerValue,
    staggerTimeValue,
    fieldBuffSetId,
  ]

  if (bossId) {
    const [existing] = await pool.execute('SELECT id FROM boss WHERE id = ? LIMIT 1', [bossId])
    if (existing.length) {
      await pool.execute(
        `UPDATE boss
         SET version = ?, phase = ?, boss_name = ?, hp = ?, hp_coeff_percent = ?, defense = ?, level = ?,
             room = ?, weakness = ?, resistance = ?, boss_image = ?, stagger_multiplier = ?, stagger_time = ?,
             field_buff_set_id = ?, mode = ?
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
        boss_image: resolvedBossImage,
        stagger_multiplier: staggerValue,
        stagger_time: staggerTimeValue,
        field_buff_set_id: fieldBuffSetId,
        bossInfoSync,
        action: 'updated',
      }
    }

    await pool.execute(
      `INSERT INTO boss (id, version, phase, boss_name, hp, hp_coeff_percent, defense, level, room, weakness, resistance, boss_image, stagger_multiplier, stagger_time, field_buff_set_id, mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      boss_image: resolvedBossImage,
      stagger_multiplier: staggerValue,
      stagger_time: staggerTimeValue,
      field_buff_set_id: fieldBuffSetId,
      bossInfoSync,
      action: 'created',
    }
  }

  const [result] = await pool.execute(
    `INSERT INTO boss (version, phase, boss_name, hp, hp_coeff_percent, defense, level, room, weakness, resistance, boss_image, stagger_multiplier, stagger_time, field_buff_set_id, mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    boss_image: resolvedBossImage,
    stagger_multiplier: staggerValue,
    stagger_time: staggerTimeValue,
    field_buff_set_id: fieldBuffSetId,
    bossInfoSync,
    action: 'created',
  }
}

/** 危局 / 防卫战录入：按名称在既有 Buff 行里找模板（跨期、跨模式） */
function buffTemplateModesForScheme(recordScheme) {
  if (recordScheme === 'defense') return ['defense', 'crisis']
  if (recordScheme === 'crisis') return ['crisis', 'defense']
  if (recordScheme === 'deduction') return ['deduction', 'crisis', 'defense']
  return ['crisis', 'defense', 'deduction']
}

async function findBuffTemplateByName(buffName, options = {}) {
  const name = String(buffName ?? '').trim()
  if (!name) return null
  const modes = options.modes ?? ['crisis', 'defense']
  const placeholders = modes.map(() => '?').join(', ')
  const params = [name, ...modes]
  let excludeClause = ''
  if (options.excludeId != null) {
    excludeClause = ' AND id <> ?'
    params.push(Number(options.excludeId))
  }
  const [rows] = await pool.execute(
    `SELECT buff, buff_image, effect_blocks
     FROM buff
     WHERE buff_name = ? AND mode IN (${placeholders})${excludeClause}
     ORDER BY
       (effect_blocks IS NOT NULL AND JSON_LENGTH(effect_blocks) > 0) DESC,
       (buff IS NOT NULL AND TRIM(buff) <> '') DESC,
       (buff_image IS NOT NULL AND TRIM(buff_image) <> '') DESC,
       id DESC
     LIMIT 1`,
    params,
  )
  if (!rows.length) return null
  const row = rows[0]
  return {
    buff: row.buff ?? null,
    buff_image: row.buff_image ?? null,
    effect_blocks: parseEffectBlocksJson(row.effect_blocks),
  }
}

/** 管理端 Buff 名称候选：同名去重，优先带结构化效果 / 正文 / 图片的记录 */
export async function listBuffNameTemplates(recordScheme = null) {
  await ensureEnvironmentBuffSchema()
  await ensureContentModeSchema()
  const modes =
    recordScheme === 'defense' || recordScheme === 'crisis'
      ? ['crisis', 'defense']
      : recordScheme === 'deduction'
        ? ['deduction', 'crisis', 'defense']
        : ['crisis', 'defense', 'deduction']
  const placeholders = modes.map(() => '?').join(', ')
  const [rows] = await pool.execute(
    `SELECT buff_name, buff, buff_image, effect_blocks
     FROM buff
     WHERE buff_name IS NOT NULL AND TRIM(buff_name) <> '' AND mode IN (${placeholders})
     ORDER BY buff_name ASC,
       (effect_blocks IS NOT NULL AND JSON_LENGTH(effect_blocks) > 0) DESC,
       (buff IS NOT NULL AND TRIM(buff) <> '') DESC,
       (buff_image IS NOT NULL AND TRIM(buff_image) <> '') DESC,
       id DESC`,
    modes,
  )
  const byName = new Map()
  for (const row of rows) {
    const name = String(row.buff_name).trim()
    if (!name || byName.has(name)) continue
    byName.set(name, {
      name,
      desc: row.buff ?? null,
      buff_image: row.buff_image ?? null,
      effect_blocks: parseEffectBlocksJson(row.effect_blocks),
    })
  }
  return [...byName.values()]
}

export async function createBuff(payload) {
  await ensureEnvironmentBuffSchema()
  await ensureContentModeSchema()
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
  let buffValue = buff
  let effectBlocksJson = serializeEffectBlocks(effect_blocks)
  const modeValue = resolveContentMode({ mode, recordScheme, id, kind: 'buff' })
  let buffId = id != null && id !== '' ? Number(id) : null
  let action = 'created'

  if (recordScheme === 'defense' || modeValue === 'defense') {
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
  } else if (recordScheme === 'deduction' || modeValue === 'deduction') {
    // 临界：允许自增 id；显式 id 保留（不走危局/防卫编码）
    if (buffId != null) {
      if (!Number.isInteger(buffId) || buffId <= 0) {
        throw new Error('无效的临界 Buff ID')
      }
    }
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

  const clientProvidedBlocks = Boolean(effectBlocksJson)
  let existingBuffImage = null
  let existingEffectBlocksJson = null
  if (buffId) {
    const [existingRows] = await pool.execute(
      'SELECT id, buff_image, effect_blocks FROM buff WHERE id = ? LIMIT 1',
      [buffId],
    )
    if (existingRows.length) {
      existingBuffImage = existingRows[0].buff_image ?? null
      existingEffectBlocksJson = serializeEffectBlocks(
        parseEffectBlocksJson(existingRows[0].effect_blocks),
      )
    }
  }
  let resolvedBuffImage = pickBestImagePath(buff_image, existingBuffImage)

  const [existing] = await pool.execute('SELECT id FROM buff WHERE id = ? LIMIT 1', [buffId])
  let reusedFromName = false

  // 新建或本行仍无结构时：从同名模板（危局/防卫/临界）补齐
  const needsTemplateBlocks = !effectBlocksJson && !existingEffectBlocksJson
  const needsTemplateText = buffValue == null || String(buffValue).trim() === ''
  const needsTemplateImage = buff_image == null || String(buff_image).trim() === ''
  if (!existing.length || needsTemplateBlocks || needsTemplateText || needsTemplateImage) {
    const template = await findBuffTemplateByName(buff_name, {
      excludeId: buffId,
      modes: buffTemplateModesForScheme(recordScheme),
    })
    if (template) {
      if (needsTemplateText && template.buff) {
        buffValue = template.buff
        reusedFromName = true
      }
      if (needsTemplateBlocks && template.effect_blocks?.length) {
        effectBlocksJson = serializeEffectBlocks(template.effect_blocks)
        reusedFromName = true
      }
      if (needsTemplateImage && template.buff_image) {
        resolvedBuffImage = pickBestImagePath(template.buff_image, resolvedBuffImage)
        reusedFromName = true
      }
    }
  }

  if (existing.length) {
    // effect_blocks 传入 null 时保留原结构化效果，避免临界节点同步把已模块化增益冲掉
    await pool.execute(
      `UPDATE buff
       SET version = ?, phase = ?, buff_name = ?, buff = ?, buff_image = ?,
           effect_blocks = COALESCE(?, effect_blocks), mode = ?
       WHERE id = ?`,
      [
        versionValue,
        phaseValue,
        buff_name,
        buffValue,
        resolvedBuffImage,
        effectBlocksJson,
        modeValue,
        buffId,
      ],
    )
    action = 'updated'
  } else {
    const [insertResult] = await pool.execute(
      `INSERT INTO buff (id, version, phase, buff_name, buff, buff_image, effect_blocks, mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [buffId, versionValue, phaseValue, buff_name, buffValue, resolvedBuffImage, effectBlocksJson, modeValue],
    )
    if (buffId == null) buffId = insertResult.insertId
  }

  let finalBlocks = parseEffectBlocksJson(effectBlocksJson)
  if (!finalBlocks?.length && buffId) {
    const [cur] = await pool.execute('SELECT effect_blocks FROM buff WHERE id = ? LIMIT 1', [buffId])
    finalBlocks = parseEffectBlocksJson(cur[0]?.effect_blocks)
  }
  // 本次显式写入结构 → 同名全库对齐；仅复用补齐 → 只填空行
  if (finalBlocks?.length) {
    await propagateSameNameEffectBlocks(buff_name, finalBlocks, {
      overwrite: clientProvidedBlocks,
    })
  }

  return {
    id: buffId,
    version: versionValue,
    phase: phaseValue,
    buff_name,
    buff: buffValue,
    buff_image: resolvedBuffImage,
    effect_blocks: finalBlocks,
    action,
    reusedFromName,
  }
}

export async function upsertBoss(payload) {
  await ensureBossStaggerSchema()
  await ensureContentModeSchema()
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
    stagger_time = null,
    mode = null,
  } = payload

  if (!id) {
    return createBoss({ ...payload, recordScheme: 'defense' })
  }

  const modeValue = resolveContentMode({ mode, id, kind: 'boss' })

  const [existing] = await pool.execute('SELECT id, boss_image FROM boss WHERE id = ? LIMIT 1', [id])
  const catalogImage = (await findBossInfoByName(boss_name))?.boss_image ?? null
  const resolvedBossImage = pickBestImagePath(
    boss_image,
    existing[0]?.boss_image ?? null,
    catalogImage,
  )

  const staggerTimeValue = normalizeStaggerTime(stagger_time)

  await upsertBossInfo({
    boss_name,
    defense,
    level,
    weakness,
    resistance,
    boss_image: resolvedBossImage,
    stagger_multiplier,
    stagger_time: staggerTimeValue,
  })

  const staggerValue =
    stagger_multiplier != null && stagger_multiplier !== ''
      ? normalizeStaggerMultiplier(stagger_multiplier)
      : null

  if (existing.length) {
    await pool.execute(
      `UPDATE boss
       SET version = ?, phase = ?, boss_name = ?, hp = ?, defense = ?, level = ?,
           room = ?, weakness = ?, resistance = ?, boss_image = ?, stagger_multiplier = ?, stagger_time = ?, mode = ?
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
        resolvedBossImage,
        staggerValue,
        staggerTimeValue,
        modeValue,
        id,
      ],
    )
    return { id, action: 'updated', ...payload, boss_image: resolvedBossImage }
  }

  await pool.execute(
    `INSERT INTO boss (id, version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image, stagger_multiplier, stagger_time, mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      resolvedBossImage,
      staggerValue,
      staggerTimeValue,
      modeValue,
    ],
  )

  return { id, action: 'created', ...payload, boss_image: resolvedBossImage }
}

export async function upsertBuff(payload) {
  await ensureEnvironmentBuffSchema()
  await ensureContentModeSchema()
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

  const modeValue = resolveContentMode({ mode, id, kind: 'buff' })
  const clientProvidedBlocks = Boolean(serializeEffectBlocks(effect_blocks))
  let effectBlocksJson = serializeEffectBlocks(effect_blocks)
  const [existing] = await pool.execute(
    'SELECT id, buff_image, effect_blocks FROM buff WHERE id = ? LIMIT 1',
    [id],
  )
  const resolvedBuffImage = pickBestImagePath(buff_image, existing[0]?.buff_image ?? null)

  if (!effectBlocksJson) {
    const existingBlocks = parseEffectBlocksJson(existing[0]?.effect_blocks)
    if (existingBlocks?.length) {
      effectBlocksJson = serializeEffectBlocks(existingBlocks)
    } else {
      const template = await findBuffTemplateByName(buff_name, {
        excludeId: id,
        modes: buffTemplateModesForScheme(
          modeValue === 'deduction' ? 'deduction' : modeValue === 'defense' ? 'defense' : 'crisis',
        ),
      })
      if (template?.effect_blocks?.length) {
        effectBlocksJson = serializeEffectBlocks(template.effect_blocks)
      }
    }
  }

  const finalBlocks = parseEffectBlocksJson(effectBlocksJson)

  if (existing.length) {
    await pool.execute(
      `UPDATE buff
       SET version = ?, phase = ?, buff_name = ?, buff = ?, buff_image = ?, effect_blocks = ?, mode = ?
       WHERE id = ?`,
      [version, phase, buff_name, buff, resolvedBuffImage, effectBlocksJson, modeValue, id],
    )
    if (finalBlocks?.length) {
      await propagateSameNameEffectBlocks(buff_name, finalBlocks, {
        overwrite: clientProvidedBlocks,
      })
    }
    return {
      id,
      action: 'updated',
      ...payload,
      buff_image: resolvedBuffImage,
      effect_blocks: finalBlocks,
    }
  }

  await pool.execute(
    `INSERT INTO buff (id, version, phase, buff_name, buff, buff_image, effect_blocks, mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, version, phase, buff_name, buff, resolvedBuffImage, effectBlocksJson, modeValue],
  )

  if (finalBlocks?.length) {
    await propagateSameNameEffectBlocks(buff_name, finalBlocks, {
      overwrite: clientProvidedBlocks,
    })
  }

  return {
    id,
    action: 'created',
    ...payload,
    buff_image: resolvedBuffImage,
    effect_blocks: finalBlocks,
  }
}

function resolveContentMode({ mode = null, recordScheme = null, id = null, kind = 'boss' } = {}) {
  if (mode === 'defense' || mode === 'crisis' || mode === 'deduction') return mode
  if (recordScheme === 'defense' || recordScheme === 'crisis' || recordScheme === 'deduction') {
    return recordScheme
  }
  if (kind === 'buff') {
    return isDefenseBuffId(id) ? 'defense' : 'crisis'
  }
  return isDefenseBossId(id) ? 'defense' : 'crisis'
}

function bossModeSql(mode) {
  if (mode === 'defense') return `mode = 'defense'`
  if (mode === 'deduction') return `mode = 'deduction'`
  // 危局：兼容旧库空 mode，且绝不碰 defense / deduction
  return `(mode = 'crisis' OR mode IS NULL OR mode = '')`
}

function buffModeSql(mode) {
  return bossModeSql(mode)
}

function clampLimit(limit, fallback = 50, max = 1000) {
  return Math.min(Math.max(Number(limit) || fallback, 1), max)
}

function matchesRecordScheme(row, recordScheme) {
  if (!recordScheme || recordScheme === 'all') return true
  const mode = row.mode ?? (isDefenseBossId(row.id) ? 'defense' : 'crisis')
  if (recordScheme === 'defense') return mode === 'defense'
  if (recordScheme === 'crisis') return mode === 'crisis'
  if (recordScheme === 'deduction') return mode === 'deduction'
  return true
}

function matchesBuffRecordScheme(row, recordScheme) {
  if (!recordScheme || recordScheme === 'all') return true
  const mode = row.mode ?? (isDefenseBuffId(row.id) ? 'defense' : 'crisis')
  if (recordScheme === 'defense') return mode === 'defense'
  if (recordScheme === 'crisis') return mode === 'crisis'
  if (recordScheme === 'deduction') return mode === 'deduction'
  return true
}

export async function searchBossRecords(filters = {}) {
  await ensureBossStaggerSchema()
  await ensureContentModeSchema()
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
  // 按版块在 SQL 层过滤，避免推演/危局互相挤掉 limit 名额
  if (recordScheme === 'crisis' || recordScheme === 'defense' || recordScheme === 'deduction') {
    conditions.push(bossModeSql(recordScheme))
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const safeLimit = clampLimit(limit)

  const [rows] = await pool.execute(
    `SELECT id, version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image, stagger_multiplier, stagger_time, mode
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
  await ensureContentModeSchema()
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
  // 按版块在 SQL 层过滤，避免推演/危局互相挤掉 limit 名额
  if (recordScheme === 'crisis' || recordScheme === 'defense' || recordScheme === 'deduction') {
    conditions.push(buffModeSql(recordScheme))
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

  const globalEffectMap = await loadGlobalBuffEffectMap()
  return rows
    .filter((row) => matchesBuffRecordScheme(row, recordScheme))
    .map((row) => ({
      ...row,
      effect_blocks: resolveEffectBlocksForName(row.effect_blocks, row.buff_name, globalEffectMap),
    }))
}

export async function deleteBuff(id) {
  const buffId = Number(id)
  if (!Number.isInteger(buffId) || buffId <= 0) {
    throw new Error('无效的 Buff ID')
  }

  const [rows] = await pool.execute(
    `SELECT id, buff_name, version, phase, mode FROM buff WHERE id = ? LIMIT 1`,
    [buffId],
  )
  if (!rows.length) {
    throw new Error('Buff 不存在或已删除')
  }
  const row = rows[0]
  const buffName = String(row.buff_name ?? '').trim()
  const version = String(row.version ?? '').trim()
  const phase = String(row.phase ?? '').trim()
  const mode = String(row.mode ?? '').trim()

  const [result] = await pool.execute('DELETE FROM buff WHERE id = ?', [buffId])
  if (result.affectedRows === 0) {
    throw new Error('Buff 不存在或已删除')
  }

  let cleanedNodes = 0
  // 临界：从同期节点 buffs_json 按名摘掉，避免表删了节点还挂着
  if (mode === 'deduction' && buffName && version) {
    const [nodes] = await pool.execute(
      `SELECT id, buffs_json FROM deduction_node WHERE version = ? AND phase = ?`,
      [version, phase || '1'],
    )
    for (const node of nodes) {
      let buffs = node.buffs_json
      if (typeof buffs === 'string') {
        try {
          buffs = JSON.parse(buffs)
        } catch {
          continue
        }
      }
      if (!Array.isArray(buffs) || !buffs.length) continue
      const next = buffs.filter((b) => String(b?.title ?? '').trim() !== buffName)
      if (next.length === buffs.length) continue
      await pool.execute(
        `UPDATE deduction_node SET buffs_json = CAST(? AS JSON) WHERE id = ?`,
        [JSON.stringify(next), node.id],
      )
      cleanedNodes += 1
    }
  }

  return { id: buffId, buff_name: buffName, mode, cleanedNodes }
}

export async function deleteDefenseSeasonData(version, phase) {
  const versionStr = String(version).trim()
  const phaseStr = String(phase).trim()
  if (!versionStr || !phaseStr) {
    throw new Error('version 与 phase 为必填项')
  }

  const [bossResult] = await pool.execute(
    `DELETE FROM boss
     WHERE version = ? AND phase = ? AND mode = 'defense'`,
    [versionStr, phaseStr],
  )
  const [buffResult] = await pool.execute(
    `DELETE FROM buff
     WHERE version = ? AND phase = ? AND mode = 'defense'`,
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

/** 危局：同 version/phase，仅删除危局 mode（不含防卫/临界） */
export async function deleteCrisisSeasonData(version, phase) {
  const versionStr = String(version).trim()
  const phaseStr = String(phase).trim()
  if (!versionStr || !phaseStr) {
    throw new Error('version 与 phase 为必填项')
  }

  const [bossResult] = await pool.execute(
    `DELETE FROM boss
     WHERE version = ? AND phase = ? AND ${bossModeSql('crisis')}`,
    [versionStr, phaseStr],
  )
  const [buffResult] = await pool.execute(
    `DELETE FROM buff
     WHERE version = ? AND phase = ? AND ${buffModeSql('crisis')}`,
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

  const [[bossCount]] = await pool.execute(
    `SELECT COUNT(*) AS cnt FROM boss WHERE version = ? AND phase = ? AND ${bossModeSql(mode)}`,
    [versionStr, phaseStr],
  )
  const [[buffCount]] = await pool.execute(
    `SELECT COUNT(*) AS cnt FROM buff WHERE version = ? AND phase = ? AND ${buffModeSql(mode)}`,
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
  const [bossResult] = await pool.execute(`DELETE FROM boss WHERE mode = 'defense'`)
  const [buffResult] = await pool.execute(`DELETE FROM buff WHERE mode = 'defense'`)

  return {
    bossesDeleted: bossResult.affectedRows,
    buffsDeleted: buffResult.affectedRows,
  }
}
