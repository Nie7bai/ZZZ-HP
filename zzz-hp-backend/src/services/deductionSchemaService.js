/**
 * 临界推演（deduction）表结构保障
 *
 * deduction_node 逐步演进：早期只有 story_text，随后新增 story_options_json
 * 存放剧情「选项」（choice 列表，[{ name, desc }]）。存量库用信息表检查后 ALTER，
 * 幂等可重复执行，兼容 MySQL 8.x 任意小版本。
 */

/** 确保 deduction_node 有 story_options_json 列；返回是否本次新增 */
export async function ensureDeductionStoryOptionsColumn(conn) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'deduction_node'
       AND COLUMN_NAME = 'story_options_json'`,
  )
  if (Number(rows[0]?.c) > 0) return false
  await conn.query(
    `ALTER TABLE deduction_node
     ADD COLUMN story_options_json JSON NULL COMMENT '剧情选项（choice 列表，[{name,desc}]）'`,
  )
  return true
}
