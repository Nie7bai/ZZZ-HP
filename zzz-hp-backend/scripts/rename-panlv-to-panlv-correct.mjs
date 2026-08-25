/**
 * 将危局「判律孤歌·薇斯珀」统一改名为临界正确写法「叛律孤歌·薇斯珀」，
 * 保留危局 boss_info 场地 Buff / 图片等数据。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pool from '../src/config/db.js'

const OLD = '判律孤歌·薇斯珀'
const NEW = '叛律孤歌·薇斯珀'
const OLD_IMG = `/boss_image/${OLD}.png`
const NEW_IMG = `/boss_image/${NEW}.png`

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const bossImageDir = path.resolve(__dirname, '../boss_image')

async function main() {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const [infos] = await conn.execute(
      `SELECT * FROM boss_info WHERE boss_name IN (?, ?)`,
      [OLD, NEW],
    )
    const rich = infos.find((r) => r.boss_name === OLD)
    const emptyish = infos.find((r) => r.boss_name === NEW)

    if (!rich) {
      console.log('未找到旧名 boss_info，可能已改过')
    } else if (emptyish) {
      // 把危局完整数据合并进正确名行，再删旧名行
      await conn.execute(
        `UPDATE boss_info SET
           defense = ?,
           level = ?,
           boss_image = ?,
           weakness = ?,
           resistance = ?,
           crisis_base_hp = COALESCE(?, crisis_base_hp),
           stagger_multiplier = COALESCE(?, stagger_multiplier),
           field_buff_name = ?,
           field_buff_text = ?,
           field_buff_image = ?,
           field_buff_effect_blocks = ?,
           field_buff_sets = ?
         WHERE id = ?`,
        [
          rich.defense,
          rich.level,
          NEW_IMG,
          rich.weakness,
          rich.resistance,
          rich.crisis_base_hp,
          rich.stagger_multiplier,
          rich.field_buff_name,
          rich.field_buff_text,
          rich.field_buff_image,
          rich.field_buff_effect_blocks
            ? typeof rich.field_buff_effect_blocks === 'string'
              ? rich.field_buff_effect_blocks
              : JSON.stringify(rich.field_buff_effect_blocks)
            : null,
          rich.field_buff_sets
            ? typeof rich.field_buff_sets === 'string'
              ? rich.field_buff_sets
              : JSON.stringify(rich.field_buff_sets)
            : null,
          emptyish.id,
        ],
      )
      await conn.execute(`DELETE FROM boss_info WHERE id = ?`, [rich.id])
      console.log('merged boss_info', rich.id, '→', emptyish.id, NEW)
    } else {
      await conn.execute(`UPDATE boss_info SET boss_name = ?, boss_image = ? WHERE id = ?`, [
        NEW,
        NEW_IMG,
        rich.id,
      ])
      console.log('renamed boss_info', rich.id, OLD, '→', NEW)
    }

    const [bossRes] = await conn.execute(
      `UPDATE boss SET boss_name = ?, boss_image = ? WHERE boss_name = ?`,
      [NEW, NEW_IMG, OLD],
    )
    console.log('renamed boss rows', bossRes.affectedRows)

    // 临界同名行：图片改用危局中文名图（仍保留危局数据）
    const [dedRes] = await conn.execute(
      `UPDATE boss SET boss_image = ? WHERE mode = 'deduction' AND boss_name = ?`,
      [NEW_IMG, NEW],
    )
    console.log('updated deduction boss image', dedRes.affectedRows)

    // layers_json 里若仍有旧名则替换（一般没有）
    const [nodes] = await conn.execute(
      `SELECT id, layers_json FROM deduction_node WHERE layers_json LIKE ?`,
      [`%${OLD}%`],
    )
    for (const row of nodes) {
      const raw =
        typeof row.layers_json === 'string'
          ? row.layers_json
          : JSON.stringify(row.layers_json)
      const next = raw.split(OLD).join(NEW)
      if (next === raw) continue
      await conn.execute(`UPDATE deduction_node SET layers_json = CAST(? AS JSON) WHERE id = ?`, [
        next,
        row.id,
      ])
      console.log('patched deduction_node', row.id)
    }

    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  // 重命名图片文件（保留危局原图内容）
  const oldPath = path.join(bossImageDir, `${OLD}.png`)
  const newPath = path.join(bossImageDir, `${NEW}.png`)
  if (fs.existsSync(oldPath)) {
    if (fs.existsSync(newPath)) fs.unlinkSync(newPath)
    fs.renameSync(oldPath, newPath)
    console.log('renamed image file →', NEW_IMG)
  } else if (fs.existsSync(newPath)) {
    console.log('image already at', NEW_IMG)
  } else {
    console.warn('image file not found:', oldPath)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
