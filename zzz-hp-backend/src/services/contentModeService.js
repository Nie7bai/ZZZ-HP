/**
 * 版块字段（mode）保障与推断
 *
 * 背景：boss / buff 原先靠「ID 位数形状」区分危局（非 9/7 位）与防卫战（9/7 位），
 * 新增推演（deduction）后该排除法会把推演数据误判为危局。
 * 方案：boss / buff 增加 mode 列（与 date.mode 同构），显式标注版块归属。
 *
 * - ensureContentModeColumns：加列 + 按 ID 形状回填存量行（幂等，可重复执行）
 * - inferBossMode / inferBuffMode：对未显式传 mode 的写入按 ID 形状兜底（兼容旧调用方）
 */

const MODE_CRISIS = 'crisis'
const MODE_DEFENSE = 'defense'
const MODE_DEDUCTION = 'deduction'

export const CONTENT_MODES = [MODE_CRISIS, MODE_DEFENSE, MODE_DEDUCTION]

/** 存量回填规则与旧 isDefenseBossId / isDefenseBuffId 判定完全等价 */
export function inferBossMode(id, explicit) {
  if (explicit && CONTENT_MODES.includes(explicit)) return explicit
  const text = String(id ?? '')
  return /^\d{9}$/.test(text) ? MODE_DEFENSE : MODE_CRISIS
}

export function inferBuffMode(id, explicit) {
  if (explicit && CONTENT_MODES.includes(explicit)) return explicit
  const text = String(id ?? '')
  return /^\d{7}$/.test(text) ? MODE_DEFENSE : MODE_CRISIS
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column],
  )
  return Number(rows[0]?.c) > 0
}

async function ensureModeDefault(conn, table, actionsBucket) {
  const [cols] = await conn.query(`SHOW COLUMNS FROM \`${table}\` LIKE 'mode'`)
  const col = cols[0]
  if (!col) return
  if (col.Default == null || col.Default === '') {
    await conn.query(
      `ALTER TABLE \`${table}\`
       MODIFY COLUMN mode VARCHAR(20) NOT NULL DEFAULT 'crisis'
       COMMENT 'crisis|defense|deduction（版块归属）'`,
    )
    actionsBucket.push('restored-mode-default')
  }
}

let ensured = false
let ensuredPromise = null

/**
 * 幂等：确保 boss / buff 有 mode 列，并按 ID 形状回填存量行。
 * 返回本次实际执行的动作统计。
 */
export async function ensureContentModeColumns(conn) {
  if (ensured) return { boss: [], buff: [] }
  if (ensuredPromise) return ensuredPromise

  ensuredPromise = (async () => {
    const actions = { boss: [], buff: [] }

    if (!(await columnExists(conn, 'boss', 'mode'))) {
      await conn.query(
        `ALTER TABLE boss
         ADD COLUMN mode VARCHAR(20) NOT NULL DEFAULT 'crisis'
         COMMENT 'crisis|defense|deduction（版块归属）'`,
      )
      actions.boss.push('added-mode-column')
    } else {
      await ensureModeDefault(conn, 'boss', actions.boss)
    }

    if (!(await columnExists(conn, 'buff', 'mode'))) {
      await conn.query(
        `ALTER TABLE buff
         ADD COLUMN mode VARCHAR(20) NOT NULL DEFAULT 'crisis'
         COMMENT 'crisis|defense|deduction（版块归属）'`,
      )
      actions.buff.push('added-mode-column')
    } else {
      await ensureModeDefault(conn, 'buff', actions.buff)
    }

    // 回填：仅处理仍为默认 crisis 的存量行（新写入的行由应用层显式带 mode）
    const [bossBackfill] = await conn.query(
      `UPDATE boss SET mode = 'defense'
       WHERE mode = 'crisis' AND LENGTH(id) = 9`,
    )
    if (Number(bossBackfill.affectedRows) > 0) {
      actions.boss.push(`backfilled-defense=${bossBackfill.affectedRows}`)
    }

    const [buffBackfill] = await conn.query(
      `UPDATE buff SET mode = 'defense'
       WHERE mode = 'crisis' AND LENGTH(id) = 7`,
    )
    if (Number(buffBackfill.affectedRows) > 0) {
      actions.buff.push(`backfilled-defense=${buffBackfill.affectedRows}`)
    }

    ensured = true
    return actions
  })()

  try {
    return await ensuredPromise
  } catch (err) {
    ensuredPromise = null
    throw err
  }
}
