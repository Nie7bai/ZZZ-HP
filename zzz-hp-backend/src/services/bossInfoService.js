import pool from '../config/db.js'

function normalizeBossInfo(payload) {
  return {
    boss_name: String(payload.boss_name ?? '').trim(),
    defense: Number(payload.defense ?? 0),
    level: Number(payload.level ?? 1),
    weakness: payload.weakness?.trim() || null,
    resistance: payload.resistance?.trim() || null,
    boss_image: payload.boss_image?.trim() || null,
  }
}

function bossInfoDiffers(existing, incoming) {
  return (
    Number(existing.defense) !== incoming.defense ||
    Number(existing.level) !== incoming.level ||
    (existing.weakness ?? '') !== (incoming.weakness ?? '') ||
    (existing.resistance ?? '') !== (incoming.resistance ?? '') ||
    (existing.boss_image ?? '') !== (incoming.boss_image ?? '')
  )
}

export async function findBossInfoByName(bossName) {
  const name = String(bossName ?? '').trim()
  if (!name) return null

  const [rows] = await pool.execute(
    `SELECT id, boss_name, defense, level, boss_image, weakness, resistance
     FROM boss_info
     WHERE boss_name = ?
     LIMIT 1`,
    [name],
  )

  return rows[0] ?? null
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
      `INSERT INTO boss_info (boss_name, defense, level, boss_image, weakness, resistance)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [info.boss_name, info.defense, info.level, info.boss_image, info.weakness, info.resistance],
    )

    return {
      action: 'created',
      id: result.insertId,
      ...info,
    }
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
     SET defense = ?, level = ?, boss_image = ?, weakness = ?, resistance = ?
     WHERE id = ?`,
    [info.defense, info.level, info.boss_image, info.weakness, info.resistance, existing.id],
  )

  return {
    action: 'updated',
    id: existing.id,
    ...info,
  }
}
