/**
 * 从 nanoka CDN 下载推演怪物图片到本地 boss_image/。
 *
 * URL 规律：https://static.nanoka.cc/assets/zzz/<Monster_英文名>.webp
 * 英文名取自 nanoka simul 数据里每个怪物的 image 字段 basename。
 *
 * 用法（在 zzz-hp-backend 目录）：
 *   node scripts/download-nanoka-boss-images.mjs          # 下载全部缺失
 *   node scripts/download-nanoka-boss-images.mjs --dry-run
 * 下载完成后重跑 scripts/enrich-deduction-images.mjs 回填 boss.boss_image。
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mysql from 'mysql2/promise'
import {
  fetchSimulDetail,
  fetchSimulIndex,
  resolveSimulBuildTag,
} from '../src/services/nanoka/nanokaSimulClient.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dryRun = process.argv.includes('--dry-run')
const imageDir = path.join(__dirname, '..', 'boss_image')
const CDN_BASE = 'https://static.nanoka.cc/assets/zzz'

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
})

// 推演怪物名
const [ded] = await conn.query(
  `SELECT DISTINCT boss_name FROM boss WHERE mode='deduction'`,
)
const names = ded.map((r) => r.boss_name)

// nanoka 怪物名 → 图片 basename（优先带全路径，取 basename）
const buildTag = await resolveSimulBuildTag()
const index = await fetchSimulIndex(buildTag)
const nameToBase = new Map()
for (const simulId of Object.keys(index)) {
  const detail = await fetchSimulDetail(buildTag, simulId, 'zh')
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return
    if (typeof obj.name === 'string' && typeof obj.image === 'string') {
      const base = obj.image.split('/').pop().replace(/\.(png|webp|jpg)$/i, '')
      if (!nameToBase.has(obj.name)) nameToBase.set(obj.name, base)
      return
    }
    for (const v of Object.values(obj)) walk(v)
  }
  walk(detail)
}

const existing = new Set(
  fs
    .readdirSync(imageDir)
    .filter((f) => /\.(webp|png|jpe?g)$/i.test(f))
    .map((f) => f.replace(/\.(webp|png|jpe?g)$/i, '')),
)

const toDownload = []
for (const name of names) {
  const base = nameToBase.get(name)
  if (!base) continue
  const safe = base.replace(/[^\w-]/g, '')
  if (!safe) continue
  if (existing.has(safe)) continue
  toDownload.push({ name, base: safe })
}

console.log(`待下载 ${toDownload.length} 张（本地已存在 ${names.length - toDownload.length} 个有 basename 的）`)

if (dryRun) {
  for (const item of toDownload) console.log(`  ${item.name} -> ${item.base}.webp`)
  process.exitCode = 0
} else {
  let ok = 0
  const failed = []
  for (const item of toDownload) {
    const url = `${CDN_BASE}/${item.base}.webp`
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'zzz-hp-importer/1.0' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const target = path.join(imageDir, `${item.base}.webp`)
      fs.writeFileSync(target, buf)
      existing.add(item.base)
      ok++
    } catch (err) {
      failed.push({ name: item.name, base: item.base, error: err.message })
    }
  }
  console.log(`下载成功 ${ok}，失败 ${failed.length}`)
  if (failed.length) {
    console.log('=== 失败名单 ===')
    for (const f of failed) console.log(`  ${f.name} [${f.base}] ${f.error}`)
  }
}

await conn.end()
