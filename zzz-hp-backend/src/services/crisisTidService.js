import pool from '../config/db.js'

/** 旧号段（无绝境）：69001…69041，步长 +1 */
const LEGACY_CRISIS_TID_MIN = 69000
const LEGACY_CRISIS_TID_MAX = 690419

/**
 * 3.1 起有绝境危局：690421、690431、690441…，步长 +10
 * （不是 69042 笔误）
 */
export const HARD_CRISIS_TID_START = 690421
export const HARD_CRISIS_TID_STEP = 10
const HARD_CRISIS_TID_MAX = 9_999_999

/** 若本地曾被误修成 69042，读期时恢复为绝境号 */
const HARD_TID_RESTORE = [
  { id: 311, wrong: 69042, right: 690421 },
  { id: 312, wrong: 69043, right: 690431 },
  { id: 313, wrong: 69044, right: 690441 },
]

export function crisisPhaseNumericId(version, phase) {
  const phaseNum = String(phase ?? '').replace(/\D/g, '')
  const normalizedPhase = phaseNum ? String(Number(phaseNum)) : String(phase ?? '').trim()
  const versionKey = String(version ?? '').trim().replace(/\./g, '')
  const id = Number(`${versionKey}${normalizedPhase}`)
  return Number.isFinite(id) ? id : null
}

function parseVersionParts(version) {
  return String(version ?? '')
    .trim()
    .split('.')
    .map((part) => Number(part.replace(/\D/g, '')) || 0)
}

/** 3.1 起为绝境危局号段 */
export function isHardCrisisTidEra(version) {
  const parts = parseVersionParts(version)
  const major = parts[0] || 0
  const minor = parts[1] || 0
  return major > 3 || (major === 3 && minor >= 1)
}

export function isHardCrisisTid(tid) {
  const n = Number(tid)
  return Number.isFinite(n) && n >= HARD_CRISIS_TID_START && n <= HARD_CRISIS_TID_MAX
}

/**
 * 根据上一期 tid / 是否绝境号段，计算下一期 tid（纯函数，便于单测）
 */
export function computeNextCrisisTid(lastTid, { hardEra } = {}) {
  const last = Number(lastTid)
  if (hardEra) {
    if (Number.isFinite(last) && isHardCrisisTid(last)) return last + HARD_CRISIS_TID_STEP
    return HARD_CRISIS_TID_START
  }
  if (Number.isFinite(last) && last >= LEGACY_CRISIS_TID_MIN && last <= LEGACY_CRISIS_TID_MAX) {
    return last + 1
  }
  return LEGACY_CRISIS_TID_MIN + 1
}

export async function restoreHardCrisisTidsIfDowngraded() {
  for (const item of HARD_TID_RESTORE) {
    await pool.query('UPDATE id_table SET tid = ? WHERE id = ? AND tid = ?', [
      item.right,
      item.id,
      item.wrong,
    ])
  }
}

async function maxTidInRange(min, max) {
  const [rows] = await pool.query(
    `SELECT MAX(tid) AS maxTid FROM id_table WHERE tid BETWEEN ? AND ?`,
    [min, max],
  )
  const maxTid = Number(rows[0]?.maxTid)
  return Number.isFinite(maxTid) ? maxTid : null
}

async function nextCrisisTidForEra(hardEra) {
  if (hardEra) {
    const maxHard = await maxTidInRange(HARD_CRISIS_TID_START, HARD_CRISIS_TID_MAX)
    return computeNextCrisisTid(maxHard, { hardEra: true })
  }
  const maxLegacy = await maxTidInRange(LEGACY_CRISIS_TID_MIN, LEGACY_CRISIS_TID_MAX)
  return computeNextCrisisTid(maxLegacy, { hardEra: false })
}

/**
 * 为危局 version+phase 确保 id_table 有 tid；缺失则按号段规则续推并写入。
 * @returns {Promise<number|null>}
 */
export async function ensureCrisisTid(version, phase) {
  const id = crisisPhaseNumericId(version, phase)
  if (id == null) return null

  await restoreHardCrisisTidsIfDowngraded()

  const [existing] = await pool.query('SELECT tid FROM id_table WHERE id = ? LIMIT 1', [id])
  if (existing.length) {
    const tid = Number(existing[0].tid)
    return Number.isFinite(tid) ? tid : null
  }

  const hardEra = isHardCrisisTidEra(version)
  const tid = await nextCrisisTidForEra(hardEra)
  await pool.query(
    `INSERT INTO id_table (id, tid) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE tid = VALUES(tid)`,
    [id, tid],
  )
  return tid
}

/**
 * 批量解析期数 tid：已有用表值；缺失的按排序后相对上一期续推（旧号 +1 / 绝境 +10），并写回。
 * @param {Array<{ version: string, phase: string }>} phases 已按时间排序
 * @returns {Promise<Map<number, number>>} phaseNumericId → tid
 */
export async function resolveCrisisTidMap(phases) {
  await restoreHardCrisisTidsIfDowngraded()

  const [idRows] = await pool.query('SELECT id, tid FROM id_table')
  const tidMap = new Map(
    idRows.map((row) => [Number(row.id), Number(row.tid)]).filter(([, tid]) => Number.isFinite(tid)),
  )

  let lastLegacyTid = null
  let lastHardTid = null

  for (const phase of phases) {
    const id = crisisPhaseNumericId(phase.version, phase.phase)
    if (id == null) continue

    const hardEra = isHardCrisisTidEra(phase.version)
    let tid = tidMap.get(id)
    const tidOk = tid != null && Number.isFinite(tid) && (
      hardEra ? isHardCrisisTid(tid) : tid >= LEGACY_CRISIS_TID_MIN && tid <= LEGACY_CRISIS_TID_MAX
    )

    if (!tidOk) {
      if (hardEra) {
        tid = computeNextCrisisTid(lastHardTid, { hardEra: true })
      } else {
        tid = computeNextCrisisTid(lastLegacyTid, { hardEra: false })
      }
      await pool.query(
        `INSERT INTO id_table (id, tid) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE tid = VALUES(tid)`,
        [id, tid],
      )
      tidMap.set(id, tid)
    }

    if (isHardCrisisTid(tid)) lastHardTid = tid
    else if (tid >= LEGACY_CRISIS_TID_MIN && tid <= LEGACY_CRISIS_TID_MAX) lastLegacyTid = tid
  }

  return tidMap
}
