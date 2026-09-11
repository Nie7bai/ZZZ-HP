import pool from '../config/db.js'

/** 危局显示 ID（tid）正常落在此区间；种子笔误 690421 等会被排除在 MAX 之外 */
const CRISIS_TID_MIN = 69000
const CRISIS_TID_MAX = 69999

const KNOWN_TID_TYPO_FIXES = [
  { id: 311, wrong: 690421, right: 69042 },
  { id: 312, wrong: 690431, right: 69043 },
  { id: 313, wrong: 690441, right: 69044 },
]

export function crisisPhaseNumericId(version, phase) {
  const phaseNum = String(phase ?? '').replace(/\D/g, '')
  const normalizedPhase = phaseNum ? String(Number(phaseNum)) : String(phase ?? '').trim()
  const versionKey = String(version ?? '').trim().replace(/\./g, '')
  const id = Number(`${versionKey}${normalizedPhase}`)
  return Number.isFinite(id) ? id : null
}

export async function repairCrisisIdTableTypos() {
  for (const item of KNOWN_TID_TYPO_FIXES) {
    await pool.query('UPDATE id_table SET tid = ? WHERE id = ? AND tid = ?', [
      item.right,
      item.id,
      item.wrong,
    ])
  }
}

async function nextCrisisTid() {
  const [rows] = await pool.query(
    `SELECT MAX(tid) AS maxTid FROM id_table WHERE tid BETWEEN ? AND ?`,
    [CRISIS_TID_MIN, CRISIS_TID_MAX],
  )
  const maxTid = Number(rows[0]?.maxTid)
  if (Number.isFinite(maxTid) && maxTid >= CRISIS_TID_MIN) return maxTid + 1
  return CRISIS_TID_MIN
}

/**
 * 为危局 version+phase 确保 id_table 有 tid；缺失则取当前最大 tid+1 写入。
 * @returns {Promise<number|null>}
 */
export async function ensureCrisisTid(version, phase) {
  const id = crisisPhaseNumericId(version, phase)
  if (id == null) return null

  await repairCrisisIdTableTypos()

  const [existing] = await pool.query('SELECT tid FROM id_table WHERE id = ? LIMIT 1', [id])
  if (existing.length) {
    const tid = Number(existing[0].tid)
    return Number.isFinite(tid) ? tid : null
  }

  const tid = await nextCrisisTid()
  await pool.query(
    `INSERT INTO id_table (id, tid) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE tid = IF(tid BETWEEN ? AND ?, tid, VALUES(tid))`,
    [id, tid, CRISIS_TID_MIN, CRISIS_TID_MAX],
  )
  return tid
}

/**
 * 批量解析期数 tid：已有用表值；缺失的按排序后相对上一期 +1，并写回 id_table。
 * @param {Array<{ version: string, phase: string }>} phases 已按时间排序
 * @returns {Promise<Map<number, number>>} phaseNumericId → tid
 */
export async function resolveCrisisTidMap(phases) {
  await repairCrisisIdTableTypos()

  const [idRows] = await pool.query('SELECT id, tid FROM id_table')
  const tidMap = new Map(
    idRows.map((row) => [Number(row.id), Number(row.tid)]).filter(([, tid]) => Number.isFinite(tid)),
  )

  let lastTid = null
  for (const phase of phases) {
    const id = crisisPhaseNumericId(phase.version, phase.phase)
    if (id == null) continue

    let tid = tidMap.get(id)
    const tidInRange =
      tid != null && Number.isFinite(tid) && tid >= CRISIS_TID_MIN && tid <= CRISIS_TID_MAX

    if (!tidInRange) {
      if (lastTid != null && lastTid >= CRISIS_TID_MIN && lastTid <= CRISIS_TID_MAX) {
        tid = lastTid + 1
      } else {
        tid = await nextCrisisTid()
      }
      await pool.query(
        `INSERT INTO id_table (id, tid) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE tid = VALUES(tid)`,
        [id, tid],
      )
      tidMap.set(id, tid)
    }

    lastTid = tid
  }

  return tidMap
}
