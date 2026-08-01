/**
 * 修复 3.1 第1期危局 buff/boss 图片路径与缺失文件。
 *
 * 问题：管理后台上传写入随机文件名，buff 表路径与 id_buff 不一致，且磁盘无对应文件。
 *
 * 用法：node scripts/fix-phase-311-images.mjs [--dry-run]
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mysql from 'mysql2/promise'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.join(__dirname, '..')
const dryRun = process.argv.includes('--dry-run')

const BUFF_FIXES = [
  { id: 31101, file: '3111.webp', fallback: '2831.webp' },
  { id: 31102, file: '3112.webp', fallback: '3012.webp' },
  { id: 31103, file: '3113.webp', fallback: '3013.webp' },
]

const BOSS_FIXES = [
  {
    id: 3111,
    name: '基塔布鲁·滞变畸兽',
    file: '3111.webp',
    fallback: 'Monster_Gloomaron.webp',
  },
  {
    id: 3114,
    name: '异构·基塔布鲁',
    file: '3114.png',
    fallback: '18.png',
  },
]

function resolvePath(rel) {
  return path.join(backendRoot, String(rel).replace(/^\//, '').replace(/\//g, path.sep))
}

function ensureImage(destRel, fallbackRel) {
  const dest = resolvePath(destRel)
  if (fs.existsSync(dest)) {
    return { destRel, action: 'exists' }
  }
  const fallback = resolvePath(fallbackRel)
  if (!fs.existsSync(fallback)) {
    return { destRel, action: 'missing-fallback', fallbackRel }
  }
  if (!dryRun) {
    fs.copyFileSync(fallback, dest)
  }
  return { destRel, action: dryRun ? 'would-copy' : 'copied', fallbackRel }
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'zzz',
})

console.log(dryRun ? 'DRY RUN\n' : '')

for (const item of BUFF_FIXES) {
  const destRel = `/buff_image/${item.file}`
  const fileResult = ensureImage(destRel, `/buff_image/${item.fallback}`)
  console.log(`buff file ${item.id}:`, fileResult)

  const [rows] = await conn.query('SELECT buff_image FROM buff WHERE id = ?', [item.id])
  const current = rows[0]?.buff_image
  if (current !== destRel) {
    console.log(`  buff ${item.id}: ${current} -> ${destRel}`)
    if (!dryRun) {
      await conn.query('UPDATE buff SET buff_image = ? WHERE id = ?', [destRel, item.id])
      await conn.query('UPDATE id_buff SET buff_image = ? WHERE id = ?', [destRel, item.id])
    }
  }
}

for (const item of BOSS_FIXES) {
  const destRel = `/boss_image/${item.file}`
  const fileResult = ensureImage(destRel, `/boss_image/${item.fallback}`)
  console.log(`boss file ${item.id}:`, fileResult)

  const [rows] = await conn.query('SELECT boss_image FROM boss WHERE id = ?', [item.id])
  const current = rows[0]?.boss_image
  if (current !== destRel) {
    console.log(`  boss ${item.id}: ${current} -> ${destRel}`)
    if (!dryRun) {
      await conn.query('UPDATE boss SET boss_image = ? WHERE id = ?', [destRel, item.id])
      await conn.query('UPDATE boss_info SET boss_image = ? WHERE boss_name = ?', [
        destRel,
        item.name,
      ])
    }
  }
}

await conn.end()
console.log('\nDone.')
