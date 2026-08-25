/**
 * 从 nanoka 导入临界推演（simul）数据到 zzz 库（版块 mode='deduction'）。
 *
 * 用法（在 zzz-hp-backend 目录，先配好 .env；需先执行 migrate-add-content-mode.mjs）：
 *   node scripts/import-nanoka-simul.mjs --all                # 导入 simul.json 全部期数
 *   node scripts/import-nanoka-simul.mjs --ids 101,102        # 只导入指定期数
 *   node scripts/import-nanoka-simul.mjs --ids 101 --dry-run  # 只抓取解析，不写库
 *   node scripts/import-nanoka-simul.mjs --all --locale en    # 英文数据（默认 zh）
 *
 * 期数 key：推演用自己的期数 id（version=期数id，phase 默认 '1'）。
 * 写入语义：每期「DELETE 该期 → INSERT」（整期刷新），幂等可重复执行；
 * 会保留该期既有的 period_name 与图片回填（boss_image/buff_image，enrich 脚本单独维护）。
 */
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import {
  fetchSimulDetail,
  fetchSimulIndex,
  resolveSimulBuildTag,
} from '../src/services/nanoka/nanokaSimulClient.js'
import { parseSimulPeriod } from '../src/services/nanoka/nanokaSimulParser.js'
import { ensureContentModeColumns } from '../src/services/contentModeService.js'
import { ensureDeductionStoryOptionsColumn } from '../src/services/deductionSchemaService.js'
import { resolveLayerIsBoss } from '../src/utils/deductionLayerFallback.js'
import {
  parseEffectBlocksJson,
  serializeEffectBlocks,
} from '../src/utils/environmentBuffSchema.js'

dotenv.config()

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

const idsArg = readArg('--ids')
const all = process.argv.includes('--all')
const dryRun = process.argv.includes('--dry-run')
const locale = readArg('--locale') ?? 'zh'
const phase = readArg('--phase') ?? '1'

if (!all && !idsArg) {
  console.error('用法：--all 或 --ids 101,102（可加 --dry-run / --locale zh|en）')
  process.exit(1)
}

const buildTag = await resolveSimulBuildTag()
const simulIndex = await fetchSimulIndex(buildTag)

let simulIds
if (all) {
  simulIds = Object.keys(simulIndex).sort()
} else {
  simulIds = String(idsArg)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

if (!simulIds.length) {
  console.error('未解析到期数 id')
  process.exit(1)
}

const CREATE_NODE_SQL = `
CREATE TABLE IF NOT EXISTS deduction_node (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  version VARCHAR(50) NOT NULL,
  phase VARCHAR(50) NOT NULL DEFAULT '1',
  node_id VARCHAR(20) NOT NULL,
  node_name VARCHAR(100) NOT NULL DEFAULT '',
  node_type INT NOT NULL DEFAULT 0,
  prev_node VARCHAR(20) NOT NULL DEFAULT '',
  story_text TEXT NULL,
  story_options_json JSON NULL,
  layers_json JSON NULL,
  buffs_json JSON NULL,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_dd_node (version, phase, node_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='临界推演节点（剧情/战斗）';
`

const results = []
for (const simulId of simulIds) {
  const detail = await fetchSimulDetail(buildTag, simulId, locale)
  const parsed = parseSimulPeriod(detail, { phase })
  results.push({ simulId, ...parsed })
}

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        dryRun: true,
        buildTag,
        locale,
        periods: results.map((item) => ({
          periodId: item.periodId,
          bosses: item.bosses.length,
          buffs: item.buffs.length,
          nodes: item.nodes.map((n) => ({
            nodeId: n.nodeId,
            name: n.name,
            type: n.type,
            layers: n.layers.length,
            buffs: n.buffs.length,
            story: n.storyText ? n.storyText.slice(0, 30) : null,
          })),
          bossSamples: item.bosses.slice(0, 3).map((b) => ({
            name: b.boss_name,
            hp: b.hp,
            defense: b.defense,
            level: b.level,
            room: b.room,
            weakness: b.weakness,
            resistance: b.resistance,
          })),
          buffSamples: item.buffs.slice(0, 3).map((b) => ({ name: b.buff_name, text: b.buff?.slice(0, 40) })),
        })),
      },
      null,
      2,
    ),
  )
  process.exitCode = 0
} else {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
    charset: 'utf8mb4',
  })

  try {
    const actions = await ensureContentModeColumns(conn)
    console.log('mode 列保障:', JSON.stringify(actions))

    await conn.query(CREATE_NODE_SQL)
    await ensureDeductionStoryOptionsColumn(conn)
    console.log('deduction_node 表已就绪')

    const summary = []
    for (const item of results) {
      await conn.query('START TRANSACTION')
      try {
        // 保留该期既有的 period_name（手动维护的期数名，不随 nanoka 数据刷新）
        const [existingPeriods] = await conn.execute(
          'SELECT period_name FROM deduction_node WHERE version = ? AND phase = ? LIMIT 1',
          [item.version, item.phase],
        )
        const preservedPeriodName = String(existingPeriods[0]?.period_name ?? '').trim()

        // 保留该期既有的图片回填（boss_image / buff_image 由 enrich 脚本单独维护，
        // DELETE+INSERT 会清空，这里按同名快照并在插入后恢复）
        const [imgRows] = await conn.execute(
          `SELECT boss_name, boss_image FROM boss
            WHERE mode = 'deduction' AND version = ? AND phase = ?
              AND boss_image IS NOT NULL AND boss_image <> ''`,
          [item.version, item.phase],
        )
        const preservedBossImages = new Map(
          imgRows.map((row) => [String(row.boss_name).trim(), row.boss_image]),
        )
        const [buffPreserveRows] = await conn.execute(
          `SELECT buff_name, buff_image, effect_blocks FROM buff
            WHERE mode = 'deduction' AND version = ? AND phase = ?`,
          [item.version, item.phase],
        )
        const preservedBuffImages = new Map()
        const preservedBuffBlocks = new Map()
        for (const row of buffPreserveRows) {
          const name = String(row.buff_name ?? '').trim()
          if (!name) continue
          if (row.buff_image != null && String(row.buff_image).trim() !== '') {
            preservedBuffImages.set(name, row.buff_image)
          }
          const blocks = parseEffectBlocksJson(row.effect_blocks)
          if (blocks?.length) preservedBuffBlocks.set(name, blocks)
        }

        const [nodeBuffRows] = await conn.execute(
          `SELECT buffs_json FROM deduction_node
            WHERE version = ? AND phase = ? AND buffs_json IS NOT NULL`,
          [item.version, item.phase],
        )
        for (const row of nodeBuffRows) {
          let buffs = row.buffs_json
          if (typeof buffs === 'string') {
            try {
              buffs = JSON.parse(buffs)
            } catch {
              continue
            }
          }
          if (!Array.isArray(buffs)) continue
          for (const buff of buffs) {
            const name = String(buff?.title ?? '').trim()
            if (!name || preservedBuffBlocks.has(name)) continue
            const blocks = parseEffectBlocksJson(buff.effect_blocks)
            if (blocks?.length) preservedBuffBlocks.set(name, blocks)
            if (!preservedBuffImages.has(name) && buff.buff_image) {
              preservedBuffImages.set(name, buff.buff_image)
            }
          }
        }

        const [delBoss] = await conn.execute(
          "DELETE FROM boss WHERE mode = 'deduction' AND version = ? AND phase = ?",
          [item.version, item.phase],
        )
        const [delBuff] = await conn.execute(
          "DELETE FROM buff WHERE mode = 'deduction' AND version = ? AND phase = ?",
          [item.version, item.phase],
        )
        const [delNode] = await conn.execute(
          'DELETE FROM deduction_node WHERE version = ? AND phase = ?',
          [item.version, item.phase],
        )

        let bossInserted = 0
        for (const boss of item.bosses) {
          const preservedImage = preservedBossImages.get(String(boss.boss_name).trim()) ?? null
          await conn.execute(
            `INSERT INTO boss (version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image, mode)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'deduction')`,
            [
              boss.version,
              boss.phase,
              boss.boss_name,
              boss.hp,
              boss.defense,
              boss.level,
              boss.room,
              boss.weakness,
              boss.resistance,
              preservedImage,
            ],
          )
          bossInserted += 1
        }

        let buffInserted = 0
        for (const buff of item.buffs) {
          const name = String(buff.buff_name).trim()
          const preservedImage = preservedBuffImages.get(name) ?? null
          const preservedBlocks = preservedBuffBlocks.get(name) ?? null
          const effectBlocksJson = serializeEffectBlocks(preservedBlocks)
          await conn.execute(
            `INSERT INTO buff (version, phase, buff_name, buff, buff_image, effect_blocks, mode)
             VALUES (?, ?, ?, ?, ?, ?, 'deduction')`,
            [buff.version, buff.phase, buff.buff_name, buff.buff, preservedImage, effectBlocksJson],
          )
          buffInserted += 1
        }

        let nodeInserted = 0
        for (const [index, node] of item.nodes.entries()) {
          const nodeBuffs = (node.buffs ?? []).map((buff) => {
            const title = String(buff?.title ?? '').trim()
            const blocks = preservedBuffBlocks.get(title) ?? parseEffectBlocksJson(buff?.effect_blocks)
            return {
              title,
              desc: buff?.desc ?? null,
              buff_image: preservedBuffImages.get(title) ?? buff?.buff_image ?? null,
              effect_blocks: blocks?.length ? blocks : null,
            }
          })
          await conn.execute(
            `INSERT INTO deduction_node
               (version, phase, node_id, node_name, node_type, prev_node, story_text, story_options_json, layers_json, buffs_json, sort_order, period_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?, ?)`,
            [
              item.version,
              item.phase,
              node.nodeId,
              node.name,
              node.type,
              node.prevNode,
              node.storyText,
              JSON.stringify(node.storyOptions ?? []),
              JSON.stringify(
                node.layers.map((l) => ({
                  name: l.name,
                  isBoss: resolveLayerIsBoss(l),
                  ending: l.ending ?? null,
                  monsters: l.monsters ?? [],
                })),
              ),
              JSON.stringify(nodeBuffs),
              index,
              preservedPeriodName,
            ],
          )
          nodeInserted += 1
        }

        await conn.query('COMMIT')
        summary.push({
          periodId: item.periodId,
          bosses: { deleted: delBoss.affectedRows, inserted: bossInserted },
          buffs: { deleted: delBuff.affectedRows, inserted: buffInserted },
          nodes: { deleted: delNode.affectedRows, inserted: nodeInserted },
        })
      } catch (err) {
        await conn.query('ROLLBACK')
        throw err
      }
    }

    console.log(JSON.stringify({ buildTag, locale, summary }, null, 2))
  } catch (err) {
    console.error('导入失败:', err.code || err.name, err.message)
    process.exitCode = 1
  } finally {
    await conn.end()
  }
}
