/**
 * 将已存在的 boss/buff 图片重命名为稳定文件名，并回写数据库路径。
 *
 * boss：/boss_image/{怪物名}.{ext}
 * buff：/buff_image/{id}.{ext}
 *
 * 用法：
 *   node scripts/rename-stable-images.mjs          # dry-run
 *   node scripts/rename-stable-images.mjs --apply  # 真正改名 + 更新库
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mysql from 'mysql2/promise'
import { sanitizeStableBase } from '../src/middleware/upload.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.join(__dirname, '..')
const apply = process.argv.includes('--apply')

function resolveAbs(url) {
  const text = String(url ?? '').trim()
  if (!text || /^https?:\/\//i.test(text)) return null
  const rel = text.replace(/^\/+/, '').replace(/\\/g, '/')
  if (!rel.startsWith('boss_image/') && !rel.startsWith('buff_image/')) return null
  if (rel.includes('..')) return null
  return path.join(backendRoot, ...rel.split('/'))
}

function toUrl(kind, filename) {
  return `/${kind}/${filename}`
}

function extOf(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) ? ext : '.webp'
}

function ensureCopy(absOld, absNew) {
  if (absOld === absNew) return 'same'
  if (fs.existsSync(absNew)) return 'target-exists'
  fs.mkdirSync(path.dirname(absNew), { recursive: true })
  fs.copyFileSync(absOld, absNew)
  return 'copied'
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'zzz',
})

const summary = {
  mode: apply ? 'apply' : 'dry-run',
  boss: { planned: 0, updatedRows: 0, copied: 0, skipped: 0, missing: 0 },
  buff: { planned: 0, updatedRows: 0, copied: 0, skipped: 0, missing: 0 },
  samples: [],
}

// —— Boss：按怪物名聚合，优先 boss_info 路径 ——
const [bossInfoRows] = await conn.query(
  `SELECT boss_name, boss_image FROM boss_info
   WHERE boss_name IS NOT NULL AND boss_name <> ''
     AND boss_image IS NOT NULL AND boss_image <> ''`,
)
const [bossRows] = await conn.query(
  `SELECT boss_name, boss_image FROM boss
   WHERE boss_name IS NOT NULL AND boss_name <> ''
     AND boss_image IS NOT NULL AND boss_image <> ''`,
)

/** @type {Map<string, string>} */
const nameToPath = new Map()
for (const row of bossInfoRows) {
  const name = String(row.boss_name).trim()
  const image = String(row.boss_image).trim()
  if (!name || !image) continue
  if (!nameToPath.has(name) && resolveAbs(image) && fs.existsSync(resolveAbs(image))) {
    nameToPath.set(name, image)
  }
}
for (const row of bossRows) {
  const name = String(row.boss_name).trim()
  const image = String(row.boss_image).trim()
  if (!name || !image) continue
  if (!nameToPath.has(name) && resolveAbs(image) && fs.existsSync(resolveAbs(image))) {
    nameToPath.set(name, image)
  }
}

for (const [bossName, oldUrl] of nameToPath) {
  const base = sanitizeStableBase(bossName)
  if (!base) {
    summary.boss.skipped += 1
    continue
  }
  const absOld = resolveAbs(oldUrl)
  if (!absOld || !fs.existsSync(absOld)) {
    summary.boss.missing += 1
    continue
  }

  const filename = `${base}${extOf(absOld)}`
  const newUrl = toUrl('boss_image', filename)
  const absNew = resolveAbs(newUrl)

  if (path.normalize(absOld) === path.normalize(absNew)) {
    summary.boss.skipped += 1
    continue
  }

  summary.boss.planned += 1
  if (summary.samples.length < 25) {
    summary.samples.push({ kind: 'boss', bossName, from: oldUrl, to: newUrl })
  }

  if (!apply) continue

  const copyAction = ensureCopy(absOld, absNew)
  if (copyAction === 'copied') summary.boss.copied += 1

  const [r1] = await conn.execute(`UPDATE boss SET boss_image = ? WHERE boss_name = ?`, [
    newUrl,
    bossName,
  ])
  const [r2] = await conn.execute(`UPDATE boss_info SET boss_image = ? WHERE boss_name = ?`, [
    newUrl,
    bossName,
  ])
  summary.boss.updatedRows += Number(r1.affectedRows || 0) + Number(r2.affectedRows || 0)
}

// —— Buff：按 ID ——
const [buffRows] = await conn.query(
  `SELECT id, buff_name, buff_image FROM buff
   WHERE buff_image IS NOT NULL AND buff_image <> ''`,
)

for (const row of buffRows) {
  const id = Number(row.id)
  if (!Number.isInteger(id) || id <= 0) {
    summary.buff.skipped += 1
    continue
  }
  const oldUrl = String(row.buff_image).trim()
  const absOld = resolveAbs(oldUrl)
  if (!absOld || !fs.existsSync(absOld)) {
    summary.buff.missing += 1
    continue
  }

  const base = sanitizeStableBase(String(id))
  const filename = `${base}${extOf(absOld)}`
  const newUrl = toUrl('buff_image', filename)
  const absNew = resolveAbs(newUrl)

  if (path.normalize(absOld) === path.normalize(absNew)) {
    summary.buff.skipped += 1
    continue
  }

  summary.buff.planned += 1
  if (summary.samples.length < 40) {
    summary.samples.push({
      kind: 'buff',
      id,
      buffName: row.buff_name,
      from: oldUrl,
      to: newUrl,
    })
  }

  if (!apply) continue

  const copyAction = ensureCopy(absOld, absNew)
  if (copyAction === 'copied') summary.buff.copied += 1

  const [r] = await conn.execute(`UPDATE buff SET buff_image = ? WHERE id = ?`, [newUrl, id])
  summary.buff.updatedRows += Number(r.affectedRows || 0)
}

await conn.end()

console.log(JSON.stringify(summary, null, 2))
if (!apply) {
  console.log('\nDry-run only. Re-run with --apply to rename and update DB.')
}
