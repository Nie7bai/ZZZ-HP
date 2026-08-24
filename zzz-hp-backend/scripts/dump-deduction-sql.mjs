/**
 * 从库中导出推演（mode='deduction'）数据，反向生成 insert_deduction_*.sql。
 *
 * 用途：在 NAS 执行 import-nanoka-simul.mjs 之后运行本脚本，
 * 把库里的推演数据落成 SQL 文件，更新到 zzz-hp-backend 目录（新环境一条命令预录入）。
 *
 * 用法（在 zzz-hp-backend 目录，配好 .env）：
 *   node scripts/dump-deduction-sql.mjs
 *   node scripts/dump-deduction-sql.mjs --out ../dump     # 输出到其它目录
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mysql from 'mysql2/promise'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

const outDir = readArg('--out') ?? path.join(__dirname, '..')

function sqlString(value) {
  if (value == null) return 'NULL'
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

function renderInsert(table, columns, rows) {
  const header = `USE zzz;\n\nINSERT INTO ${table} (${columns.join(', ')}) VALUES\n`
  const body = rows
    .map((row, index) => {
      const values = columns.map((col) => sqlString(row[col])).join(', ')
      const suffix = index === rows.length - 1 ? ';' : ','
      return `(${values})${suffix}`
    })
    .join('\n')
  return header + body + '\n'
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
})

try {
  // 跳过乱码/测试期数（如 ????2）：推演期数为纯数字（101/102/201）
  const isCleanVersion = (version) => /^\d+$/.test(String(version ?? '').trim())

  const [bossRows] = await conn.execute(
    `SELECT id, version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image, mode
     FROM boss WHERE mode = 'deduction' ORDER BY version, phase, id`,
  )
  const [buffRows] = await conn.execute(
    `SELECT id, version, phase, buff_name, buff, buff_image, mode
     FROM buff WHERE mode = 'deduction' ORDER BY version, phase, id`,
  )
  const [nodeRows] = await conn.execute(
    `SELECT id, version, phase, node_id, node_name, node_type, prev_node, story_text, story_options_json, layers_json, buffs_json, sort_order, period_name
     FROM deduction_node ORDER BY version, sort_order, id`,
  )
  const cleanBoss = bossRows.filter((row) => isCleanVersion(row.version))
  const cleanBuff = buffRows.filter((row) => isCleanVersion(row.version))
  const cleanNodes = nodeRows.filter((row) => isCleanVersion(row.version))

  const normalizedNodes = cleanNodes.map((row) => ({
    ...row,
    story_options_json:
      typeof row.story_options_json === 'string'
        ? row.story_options_json
        : JSON.stringify(row.story_options_json ?? []),
    layers_json:
      typeof row.layers_json === 'string' ? row.layers_json : JSON.stringify(row.layers_json),
    buffs_json:
      typeof row.buffs_json === 'string' ? row.buffs_json : JSON.stringify(row.buffs_json),
  }))

  if (!cleanBoss.length && !cleanBuff.length && !cleanNodes.length) {
    console.log('没有 mode=deduction 的数据，跳过生成（请先执行 import-nanoka-simul.mjs）')
    process.exitCode = 1
  } else {
    const bossSql = renderInsert(
      'boss',
      ['id', 'version', 'phase', 'boss_name', 'hp', 'defense', 'level', 'room', 'weakness', 'resistance', 'boss_image', 'mode'],
      cleanBoss,
    )
    const buffSql = renderInsert(
      'buff',
      ['id', 'version', 'phase', 'buff_name', 'buff', 'buff_image', 'mode'],
      cleanBuff,
    )
    const nodeSql = renderInsert(
      'deduction_node',
      ['id', 'version', 'phase', 'node_id', 'node_name', 'node_type', 'prev_node', 'story_text', 'story_options_json', 'layers_json', 'buffs_json', 'sort_order', 'period_name'],
      normalizedNodes,
    )

    const bossFile = path.join(outDir, 'insert_deduction_boss.sql')
    const buffFile = path.join(outDir, 'insert_deduction_buff.sql')
    const nodeFile = path.join(outDir, 'insert_deduction_node.sql')
    fs.writeFileSync(bossFile, bossSql, 'utf8')
    fs.writeFileSync(buffFile, buffSql, 'utf8')
    fs.writeFileSync(nodeFile, nodeSql, 'utf8')

    console.log(
      JSON.stringify(
        {
          boss: { rows: cleanBoss.length, file: bossFile },
          buff: { rows: cleanBuff.length, file: buffFile },
          deduction_node: { rows: cleanNodes.length, file: nodeFile },
          skipped: {
            boss: bossRows.length - cleanBoss.length,
            buff: buffRows.length - cleanBuff.length,
            node: nodeRows.length - cleanNodes.length,
          },
        },
        null,
        2,
      ),
    )
  }
} catch (err) {
  console.error('导出失败:', err.code || err.name, err.message)
  process.exitCode = 1
} finally {
  await conn.end()
}
