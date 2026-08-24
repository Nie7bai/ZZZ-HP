/**
 * 增量同步：为既存推演（deduction）剧情节点补充「选项」（story_options_json），
 * 数据源为 nanoka simul 的 story_event.choice。
 *
 * 只更新 story_options_json 一列，不触碰 story_text / layers / buffs / sort_order /
 * period_name 等（保留管理端手动编辑与 admin 自建节点）。
 *
 * 节点匹配：先按 node_id，未命中再按同期内 node_name 回退（兼容 admin 自建节点，
 * 如 101 期的 PLOT 03 以 node_id=900001 存在，而 nanoka 为 10107）。
 *
 * 用法（zzz-hp-backend 目录，需配好 .env）：
 *   node scripts/sync-deduction-story-options.mjs          # 同步所有与 nanoka 对齐的期数
 *   node scripts/sync-deduction-story-options.mjs --ids 101
 *   node scripts/sync-deduction-story-options.mjs --dry-run
 */
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import {
  fetchSimulDetail,
  fetchSimulIndex,
  resolveSimulBuildTag,
} from '../src/services/nanoka/nanokaSimulClient.js'
import { parseSimulPeriod } from '../src/services/nanoka/nanokaSimulParser.js'
import { ensureDeductionStoryOptionsColumn } from '../src/services/deductionSchemaService.js'

dotenv.config()

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

const idsArg = readArg('--ids')
const dryRun = process.argv.includes('--dry-run')
const locale = readArg('--locale') ?? 'zh'
const phase = readArg('--phase') ?? '1'

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
})

try {
  const addedColumn = await ensureDeductionStoryOptionsColumn(conn)
  if (addedColumn) console.log('已新增 story_options_json 列')

  const buildTag = await resolveSimulBuildTag()
  const simulIndex = await fetchSimulIndex(buildTag)

  // 处理期数：默认取 DB 中已存在且与 nanoka 对齐的期数；--ids 可指定
  let versions
  if (idsArg) {
    versions = String(idsArg)
      .split(',')
      .map((s) => s.trim())
      .filter((s) => simulIndex[s] !== undefined)
  } else {
    const [rows] = await conn.query(
      'SELECT DISTINCT version, phase FROM deduction_node ORDER BY CAST(version AS UNSIGNED)',
    )
    versions = rows
      .map((r) => r.version)
      .filter((v) => simulIndex[v] !== undefined)
  }

  if (!versions.length) {
    console.log('没有需要同步的期数（DB 期数均不在 nanoka simul 中）')
    process.exitCode = 0
  } else {
    const report = []
    for (const version of versions) {
      const detail = await fetchSimulDetail(buildTag, version, locale)
      const parsed = parseSimulPeriod(detail, { phase })
      const sourceByNodeId = new Map(parsed.nodes.map((n) => [n.nodeId, n]))
      const sourceByName = new Map()
      for (const n of parsed.nodes) {
        if (n.name && !sourceByName.has(n.name)) sourceByName.set(n.name, n)
      }

      const [rows] = await conn.query(
        'SELECT id, node_id, node_name, story_options_json FROM deduction_node WHERE version = ? AND phase = ?',
        [version, phase],
      )

      let updated = 0
      let skipped = 0
      const details = []
      for (const row of rows) {
        const source =
          sourceByNodeId.get(String(row.node_id)) ?? sourceByName.get(String(row.node_name).trim())
        if (!source) {
          skipped += 1
          continue
        }
        const options = source.storyOptions ?? []
        const next = JSON.stringify(options)
        const current = row.story_options_json ?? null
        if (current === next) {
          skipped += 1
          continue
        }
        if (!dryRun) {
          await conn.execute(
            'UPDATE deduction_node SET story_options_json = CAST(? AS JSON) WHERE id = ?',
            [next, row.id],
          )
        }
        updated += 1
        if (options.length) {
          details.push(`${row.node_id}(${row.node_name}) +${options.length}项`)
        } else {
          details.push(`${row.node_id}(${row.node_name}) 无选项`)
        }
      }
      report.push({ version, nodes: rows.length, updated, skipped, details })
    }

    console.log(
      JSON.stringify(
        { dryRun, buildTag, locale, report },
        null,
        2,
      ),
    )
    if (dryRun) console.log('（--dry-run：未写入数据库）')
  }
} catch (err) {
  console.error('同步失败:', err.code || err.name, err.message)
  process.exitCode = 1
} finally {
  await conn.end()
}
