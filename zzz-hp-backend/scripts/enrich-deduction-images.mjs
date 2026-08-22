/**
 * 为推演怪物（mode='deduction'）匹配本地 Boss 图片并回填 boss.boss_image。
 *
 * 匹配优先级：
 *   1. boss / boss_info 表中已指向本地 /boss_image/ 的精确同名
 *   2. 表内原始游戏路径（/UI/Sprite/...）的 basename → 本地 boss_image/ 同名文件
 *   3. nanoka 怪物 image 字段 basename → 本地 boss_image/ 同名文件
 *   4. 归一化名字（去「」/恶名·/秽息·/蓄能型/Ⅱ→2 等）模糊匹配本地表
 *
 * 用法（在 zzz-hp-backend 目录，配好 .env）：
 *   node scripts/enrich-deduction-images.mjs
 *   node scripts/enrich-deduction-images.mjs --dry-run
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
const folderFiles = new Set(
  fs
    .readdirSync(imageDir)
    .filter((f) => /\.(webp|png|jpe?g)$/i.test(f))
    .map((f) => f.replace(/\.(webp|png|jpe?g)$/i, '')),
)

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
})

// boss / boss_info 全量名字 → 图片（含 raw 路径）
const nameToAny = new Map()
for (const [table] of [['boss'], ['boss_info']]) {
  const [rows] = await conn.query(
    `SELECT DISTINCT boss_name, boss_image FROM \`${table}\`
     WHERE boss_image IS NOT NULL AND boss_image <> ''`,
  )
  for (const r of rows) if (!nameToAny.has(r.boss_name)) nameToAny.set(r.boss_name, r.boss_image)
}

// 推演怪物名单
const [ded] = await conn.query(
  `SELECT DISTINCT boss_name FROM boss WHERE mode='deduction'`,
)
const names = ded.map((r) => r.boss_name)

// nanoka 怪物名 → 图片 basename（抓取源数据）
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

function normalizeName(name) {
  return String(name)
    .replace(/[「」『』"']/g, '')
    .replace(/^恶名·/, '')
    .replace(/^秽息·/, '')
    .replace(/^秽蚀·/, '')
    .replace(/·蓄能型$/, '')
    .replace(/Ⅱ/g, '2')
    .replace(/Ⅲ/g, '3')
    .replace(/[ 　]/g, '')
    .toLowerCase()
}

function resolveServable(name) {
  const any = nameToAny.get(name)
  if (any && any.startsWith('/boss_image/')) return { path: any, how: 'exact-local' }
  if (any) {
    const base = any.split('/').pop().replace(/\.(png|webp|jpg)$/i, '')
    if (folderFiles.has(base)) return { path: `/boss_image/${base}.webp`, how: 'raw-basename' }
  }
  const nb = nameToBase.get(name)
  if (nb && folderFiles.has(nb)) return { path: `/boss_image/${nb}.webp`, how: 'nanoka-basename' }
  const n = normalizeName(name)
  for (const [k, v] of nameToAny) {
    if (v?.startsWith('/boss_image/') && normalizeName(k) === n) {
      return { path: v, how: 'fuzzy-local' }
    }
  }
  return null
}

const assigned = []
const missing = []
for (const name of names) {
  const r = resolveServable(name)
  if (r) assigned.push({ name, ...r })
  else missing.push(name)
}

console.log(`推演怪物去重 ${names.length}：可匹配 ${assigned.length}，缺图 ${missing.length}`)
const byHow = {}
for (const r of assigned) byHow[r.how] = (byHow[r.how] ?? 0) + 1
console.log('匹配方式:', JSON.stringify(byHow))

if (dryRun) {
  console.log('=== dry-run 预览（前 10）===')
  for (const r of assigned.slice(0, 10)) console.log(`  ${r.name} -> ${r.path} [${r.how}]`)
  console.log('=== 缺图名单 ===')
  for (const m of missing) console.log('  ' + m)
  process.exitCode = 0
} else {
  // 逐个名字回填（同名的多条 boss 行一起更新）
  let updatedRows = 0
  for (const r of assigned) {
    const [res] = await conn.execute(
      "UPDATE boss SET boss_image = ? WHERE mode = 'deduction' AND boss_name = ?",
      [r.path, r.name],
    )
    updatedRows += res.affectedRows
  }
  console.log(`已回填 boss 行数：${updatedRows}`)
  console.log('=== 缺图名单（未回填）===')
  for (const m of missing) console.log('  ' + m)
}

await conn.end()
