/**
 * 将危局旧写法统一为临界命名，保留危局 boss_info 数据（防御 / 基础血量 / 失衡时间 / 场地 Buff 等）。
 *
 * 映射：
 *   亵渎者 → 「亵渎者」
 *   太初梦魇·始主 → 太初梦魇·「始主」
 *   自律强袭单位·提丰·破坏者型 → 自律强袭单位·「提丰·破坏者型」
 *
 * Usage:
 *   node scripts/rename-crisis-to-deduction-boss-names.mjs
 *   node scripts/rename-crisis-to-deduction-boss-names.mjs --dry-run
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import pool from '../src/config/db.js'

dotenv.config()

const dryRun = process.argv.includes('--dry-run')

const RENAMES = [
  { oldName: '亵渎者', newName: '「亵渎者」' },
  { oldName: '太初梦魇·始主', newName: '太初梦魇·「始主」' },
  { oldName: '自律强袭单位·提丰·破坏者型', newName: '自律强袭单位·「提丰·破坏者型」' },
]

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const bossImageDir = path.resolve(__dirname, '../boss_image')

function asJsonColumn(value) {
  if (value == null) return null
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function imagePathFor(name) {
  return `/boss_image/${name}.png`
}

function ensureImageCopied(oldName, newName) {
  const oldFile = path.join(bossImageDir, `${oldName}.png`)
  const newFile = path.join(bossImageDir, `${newName}.png`)
  if (!fs.existsSync(oldFile)) {
    console.log(`  [image] skip copy, missing ${oldName}.png`)
    return
  }
  if (dryRun) {
    console.log(`  [image] would copy ${oldName}.png → ${newName}.png`)
    return
  }
  fs.copyFileSync(oldFile, newFile)
  console.log(`  [image] copied ${oldName}.png → ${newName}.png`)
}

async function mergeBossInfo(conn, oldName, newName) {
  const newImg = imagePathFor(newName)
  const [infos] = await conn.execute(`SELECT * FROM boss_info WHERE boss_name IN (?, ?)`, [
    oldName,
    newName,
  ])
  const rich = infos.find((r) => r.boss_name === oldName)
  const target = infos.find((r) => r.boss_name === newName)

  if (!rich && !target) {
    console.log(`  [boss_info] neither row exists`)
    return
  }

  if (!rich && target) {
    // 仅有临界名：补图片路径即可
    if (!dryRun) {
      await conn.execute(`UPDATE boss_info SET boss_image = COALESCE(boss_image, ?) WHERE id = ?`, [
        newImg,
        target.id,
      ])
    }
    console.log(`  [boss_info] keep existing ${newName} (#${target.id})`)
    return
  }

  if (rich && !target) {
    if (!dryRun) {
      await conn.execute(`UPDATE boss_info SET boss_name = ?, boss_image = ? WHERE id = ?`, [
        newName,
        newImg,
        rich.id,
      ])
    }
    console.log(`  [boss_info] rename #${rich.id} ${oldName} → ${newName}`)
    return
  }

  // 两行都在：危局数据合并进临界名，再删危局旧名行
  if (!dryRun) {
    await conn.execute(
      `UPDATE boss_info SET
         defense = ?,
         level = ?,
         boss_image = ?,
         weakness = ?,
         resistance = ?,
         crisis_base_hp = COALESCE(?, crisis_base_hp),
         stagger_multiplier = COALESCE(?, stagger_multiplier),
         stagger_time = COALESCE(?, stagger_time),
         field_buff_name = ?,
         field_buff_text = ?,
         field_buff_image = ?,
         field_buff_effect_blocks = ?,
         field_buff_sets = ?
       WHERE id = ?`,
      [
        rich.defense,
        rich.level,
        newImg,
        rich.weakness,
        rich.resistance,
        rich.crisis_base_hp,
        rich.stagger_multiplier,
        rich.stagger_time,
        rich.field_buff_name,
        rich.field_buff_text,
        rich.field_buff_image,
        asJsonColumn(rich.field_buff_effect_blocks),
        asJsonColumn(rich.field_buff_sets),
        target.id,
      ],
    )
    await conn.execute(`DELETE FROM boss_info WHERE id = ?`, [rich.id])
  }
  console.log(`  [boss_info] merge #${rich.id} → #${target.id} (${newName}), keep crisis stats`)
}

async function renameBossRows(conn, oldName, newName) {
  const newImg = imagePathFor(newName)
  if (dryRun) {
    const [rows] = await conn.execute(
      `SELECT mode, COUNT(*) AS c FROM boss WHERE boss_name = ? GROUP BY mode`,
      [oldName],
    )
    console.log(`  [boss] would rename`, rows)
    return
  }
  const [res] = await conn.execute(
    `UPDATE boss SET boss_name = ?, boss_image = ? WHERE boss_name = ?`,
    [newName, newImg, oldName],
  )
  console.log(`  [boss] renamed rows: ${res.affectedRows}`)

  const [dedRes] = await conn.execute(
    `UPDATE boss SET boss_image = ? WHERE mode = 'deduction' AND boss_name = ?`,
    [newImg, newName],
  )
  console.log(`  [boss] refreshed deduction images: ${dedRes.affectedRows}`)
}

async function alignDeductionStatsFromInfo(conn, newName) {
  const [infos] = await conn.execute(
    `SELECT defense, level, weakness, resistance, stagger_multiplier, stagger_time, boss_image
     FROM boss_info WHERE boss_name = ? LIMIT 1`,
    [newName],
  )
  const info = infos[0]
  if (!info) {
    console.log(`  [deduction stats] no boss_info for ${newName}`)
    return
  }
  if (dryRun) {
    console.log(`  [deduction stats] would align to defense=${info.defense}, stagger_time=${info.stagger_time}`)
    return
  }
  const [res] = await conn.execute(
    `UPDATE boss
     SET defense = ?, level = ?, weakness = ?, resistance = ?,
         stagger_multiplier = ?, stagger_time = ?, boss_image = ?
     WHERE mode = 'deduction' AND boss_name = ?`,
    [
      info.defense,
      info.level,
      info.weakness,
      info.resistance,
      info.stagger_multiplier,
      info.stagger_time,
      info.boss_image ?? imagePathFor(newName),
      newName,
    ],
  )
  console.log(
    `  [deduction stats] aligned rows=${res.affectedRows} defense=${info.defense} stagger_time=${info.stagger_time}`,
  )
}

function safeReplaceBossName(raw, oldName, newName) {
  if (!oldName || oldName === newName) return raw
  // 新名包含旧名时（如 「亵渎者」 含 亵渎者），先整段跳过新名再替换旧名
  if (newName.includes(oldName)) {
    let result = ''
    let i = 0
    while (i < raw.length) {
      if (raw.startsWith(newName, i)) {
        result += newName
        i += newName.length
        continue
      }
      if (raw.startsWith(oldName, i)) {
        result += newName
        i += oldName.length
        continue
      }
      result += raw[i]
      i += 1
    }
    return result
  }
  return raw.split(oldName).join(newName)
}

async function patchDeductionNodes(conn, oldName, newName) {
  const [nodes] = await conn.execute(
    `SELECT id, layers_json FROM deduction_node WHERE layers_json LIKE ?`,
    [`%${oldName}%`],
  )
  let patched = 0
  for (const row of nodes) {
    const raw =
      typeof row.layers_json === 'string' ? row.layers_json : JSON.stringify(row.layers_json)
    const next = safeReplaceBossName(raw, oldName, newName)
    if (next === raw) continue
    if (!dryRun) {
      await conn.execute(`UPDATE deduction_node SET layers_json = CAST(? AS JSON) WHERE id = ?`, [
        next,
        row.id,
      ])
    }
    patched += 1
    console.log(`  [deduction_node] patched #${row.id}`)
  }
  if (!patched) console.log(`  [deduction_node] no bare old-name occurrences`)
}

async function main() {
  console.log(dryRun ? '== dry-run ==' : '== apply ==')
  const conn = await pool.getConnection()
  try {
    if (!dryRun) await conn.beginTransaction()

    for (const { oldName, newName } of RENAMES) {
      console.log(`\n${oldName} → ${newName}`)
      ensureImageCopied(oldName, newName)
      await mergeBossInfo(conn, oldName, newName)
      await renameBossRows(conn, oldName, newName)
      await alignDeductionStatsFromInfo(conn, newName)
      await patchDeductionNodes(conn, oldName, newName)
    }

    if (!dryRun) await conn.commit()
    else console.log('\n(dry-run: no DB writes)')
  } catch (err) {
    if (!dryRun) await conn.rollback()
    throw err
  } finally {
    conn.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
