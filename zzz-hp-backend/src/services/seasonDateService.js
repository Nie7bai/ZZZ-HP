import pool from '../config/db.js'

function formatDateValue(value) {
  if (!value) return null
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  return String(value).slice(0, 10)
}

function mapRow(row) {
  return {
    id: row.id,
    mode: row.mode === 'defense' ? 'defense' : 'crisis',
    version: String(row.version),
    phase: String(row.phase),
    startDate: formatDateValue(row.start_date),
    endDate: formatDateValue(row.end_date),
  }
}

function normalizeMode(mode) {
  return String(mode || 'crisis').trim() === 'defense' ? 'defense' : 'crisis'
}

function normalizePhase(phase) {
  const digits = String(phase ?? '').replace(/\D/g, '')
  return digits || String(phase ?? '').trim()
}

export async function listSeasonDates(mode) {
  const modeValue = normalizeMode(mode)
  const [rows] = await pool.query(
    `SELECT id, mode, version, phase, start_date, end_date
     FROM \`date\`
     WHERE mode = ?
     ORDER BY CAST(REPLACE(version, '.', '') AS UNSIGNED) DESC,
              CAST(phase AS UNSIGNED) DESC,
              id DESC`,
    [modeValue],
  )
  return rows.map(mapRow)
}

export async function getSeasonDateMap(mode = 'crisis') {
  const modeValue = normalizeMode(mode)
  try {
    const [rows] = await pool.query(
      `SELECT version, phase, start_date, end_date
       FROM \`date\`
       WHERE mode = ?`,
      [modeValue],
    )
    return new Map(
      rows.map((row) => [`${String(row.version).trim()}-${normalizePhase(row.phase)}`, row]),
    )
  } catch (err) {
    // 旧库尚无 mode 列时回退：取全部 date 行
    if (!String(err.message || '').includes('mode')) throw err
    const [rows] = await pool.query(
      `SELECT version, phase, start_date, end_date FROM \`date\``,
    )
    return new Map(
      rows.map((row) => [`${String(row.version).trim()}-${normalizePhase(row.phase)}`, row]),
    )
  }
}

export async function createSeasonDate(payload) {
  const mode = normalizeMode(payload.mode)
  const version = String(payload.version ?? '').trim()
  const phase = normalizePhase(payload.phase)
  const startDate = String(payload.startDate ?? '').trim()
  const endDate = String(payload.endDate ?? '').trim()

  if (!version || !phase) throw new Error('版本与期数为必填项')
  if (!startDate || !endDate) throw new Error('开始与结束日期为必填项')

  const [result] = await pool.execute(
    `INSERT INTO \`date\` (mode, version, phase, start_date, end_date)
     VALUES (?, ?, ?, ?, ?)`,
    [mode, version, phase, startDate, endDate],
  )

  const [rows] = await pool.query(
    `SELECT id, mode, version, phase, start_date, end_date FROM \`date\` WHERE id = ?`,
    [result.insertId],
  )
  return mapRow(rows[0])
}

export async function updateSeasonDate(id, payload) {
  const mode = normalizeMode(payload.mode)
  const version = String(payload.version ?? '').trim()
  const phase = normalizePhase(payload.phase)
  const startDate = String(payload.startDate ?? '').trim()
  const endDate = String(payload.endDate ?? '').trim()

  if (!version || !phase) throw new Error('版本与期数为必填项')
  if (!startDate || !endDate) throw new Error('开始与结束日期为必填项')

  const [existing] = await pool.query(`SELECT id FROM \`date\` WHERE id = ? LIMIT 1`, [id])
  if (!existing.length) throw new Error('记录不存在')

  await pool.execute(
    `UPDATE \`date\`
     SET mode = ?, version = ?, phase = ?, start_date = ?, end_date = ?
     WHERE id = ?`,
    [mode, version, phase, startDate, endDate, id],
  )

  const [rows] = await pool.query(
    `SELECT id, mode, version, phase, start_date, end_date FROM \`date\` WHERE id = ?`,
    [id],
  )
  return mapRow(rows[0])
}

export async function deleteSeasonDate(id) {
  const [result] = await pool.execute(`DELETE FROM \`date\` WHERE id = ?`, [id])
  if (!result.affectedRows) throw new Error('记录不存在')
  return { id: Number(id) }
}
