/**
 * 迁移：为 boss / buff 增加 mode 列并按 ID 形状回填存量数据。
 *
 * 用法（在 zzz-hp-backend 目录，先配好 .env）：
 *   node scripts/migrate-add-content-mode.mjs
 *   node scripts/migrate-add-content-mode.mjs --dry-run   # 只检查，不改库
 *
 * 幂等：可重复执行，已加列/已回填则跳过。
 * 部署顺序：本脚本先于应用代码（mode 过滤版）与推演导入执行。
 */
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import { ensureContentModeColumns } from '../src/services/contentModeService.js'

dotenv.config()

const dryRun = process.argv.includes('--dry-run')

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: true,
})

try {
  if (dryRun) {
    const [boss] = await conn.query(
      `SELECT COUNT(*) AS c, SUM(LENGTH(id) = 9) AS defense FROM boss`,
    )
    const [buff] = await conn.query(
      `SELECT COUNT(*) AS c, SUM(LENGTH(id) = 7) AS defense FROM buff`,
    )
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          boss: { total: Number(boss[0].c), defenseShape: Number(boss[0].defense) },
          buff: { total: Number(buff[0].c), defenseShape: Number(buff[0].defense) },
          note: '执行后将按 ID 形状回填 mode（defenseShape 行 → defense，其余 → crisis）',
        },
        null,
        2,
      ),
    )
    process.exitCode = 0
  } else {
    const actions = await ensureContentModeColumns(conn)
    console.log(JSON.stringify({ actions }, null, 2))

    const [[boss]] = await conn.query(
      `SELECT mode, COUNT(*) AS c FROM boss GROUP BY mode ORDER BY mode`,
    )
    const [[buff]] = await conn.query(
      `SELECT mode, COUNT(*) AS c FROM buff GROUP BY mode ORDER BY mode`,
    )
    console.log('boss.mode 分布:', JSON.stringify(boss))
    console.log('buff.mode 分布:', JSON.stringify(buff))
  }
} catch (err) {
  console.error('迁移失败:', err.code || err.name, err.message)
  process.exitCode = 1
} finally {
  await conn.end()
}
