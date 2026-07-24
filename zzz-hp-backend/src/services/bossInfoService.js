import pool from '../config/db.js'
import { getCrisisBaseHpByName } from '../utils/crisisHpCoeff.js'

function normalizeBossInfo(payload) {
  const crisisBaseHpRaw = payload.crisis_base_hp
  let crisis_base_hp = null
  if (crisisBaseHpRaw != null && crisisBaseHpRaw !== '') {
    const n = Number(crisisBaseHpRaw)
    if (Number.isFinite(n) && n > 0) crisis_base_hp = n
  } else {
    const fromMap = getCrisisBaseHpByName(payload.boss_name)
    if (fromMap != null) crisis_base_hp = fromMap
  }

  return {
    boss_name: String(payload.boss_name ?? '').trim(),
    defense: Number(payload.defense ?? 0),
    level: Number(payload.level ?? 1),
    weakness: payload.weakness?.trim() || null,
    resistance: payload.resistance?.trim() || null,
    boss_image: payload.boss_image?.trim() || null,
    crisis_base_hp,
  }
}

function bossInfoDiffers(existing, incoming) {
  const existingBase =
    existing.crisis_base_hp == null ? null : Number(existing.crisis_base_hp)
  const incomingBase =
    incoming.crisis_base_hp == null ? null : Number(incoming.crisis_base_hp)
  return (
    Number(existing.defense) !== incoming.defense ||
    Number(existing.level) !== incoming.level ||
    (existing.weakness ?? '') !== (incoming.weakness ?? '') ||
    (existing.resistance ?? '') !== (incoming.resistance ?? '') ||
    (existing.boss_image ?? '') !== (incoming.boss_image ?? '') ||
    existingBase !== incomingBase
  )
}

export async function findBossInfoByName(bossName) {
  const name = String(bossName ?? '').trim()
  if (!name) return null

  const [rows] = await pool.execute(
    `SELECT id, boss_name, defense, level, boss_image, weakness, resistance, crisis_base_hp
     FROM boss_info
     WHERE boss_name = ?
     LIMIT 1`,
    [name],
  )

  const row = rows[0]
  if (!row) return null
  return {
    ...row,
    crisis_base_hp:
      row.crisis_base_hp == null ? getCrisisBaseHpByName(row.boss_name) : Number(row.crisis_base_hp),
  }
}

export async function searchBossInfoNames(keyword, limit = 20) {
  const query = String(keyword ?? '').trim()
  if (!query) return []

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50)

  const [rows] = await pool.execute(
    `SELECT boss_name
     FROM boss_info
     WHERE boss_name LIKE ?
     ORDER BY boss_name
     LIMIT ${safeLimit}`,
    [`%${query}%`],
  )

  return rows.map((row) => row.boss_name)
}

export async function upsertBossInfo(payload) {
  const info = normalizeBossInfo(payload)
  if (!info.boss_name) {
    throw new Error('boss_name 不能为空')
  }

  const existing = await findBossInfoByName(info.boss_name)

  if (!existing) {
    const [result] = await pool.execute(
      `INSERT INTO boss_info (boss_name, defense, level, boss_image, weakness, resistance, crisis_base_hp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        info.boss_name,
        info.defense,
        info.level,
        info.boss_image,
        info.weakness,
        info.resistance,
        info.crisis_base_hp,
      ],
    )

    return {
      action: 'created',
      id: result.insertId,
      ...info,
    }
  }

  // Keep existing base HP if incoming didn't provide one
  if (info.crisis_base_hp == null && existing.crisis_base_hp != null) {
    info.crisis_base_hp = Number(existing.crisis_base_hp)
  }

  if (!bossInfoDiffers(existing, info)) {
    return {
      action: 'unchanged',
      id: existing.id,
      ...info,
    }
  }

  await pool.execute(
    `UPDATE boss_info
     SET defense = ?, level = ?, boss_image = ?, weakness = ?, resistance = ?, crisis_base_hp = ?
     WHERE id = ?`,
    [
      info.defense,
      info.level,
      info.boss_image,
      info.weakness,
      info.resistance,
      info.crisis_base_hp,
      existing.id,
    ],
  )

  return {
    action: 'updated',
    id: existing.id,
    ...info,
  }
}
