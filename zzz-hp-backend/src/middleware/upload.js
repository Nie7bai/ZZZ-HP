import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import multer from 'multer'
import { detectImageKind, extForImageKind } from '../utils/imageMagic.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '../..')

const imageDirs = {
  boss: path.join(projectRoot, 'boss_image'),
  buff: path.join(projectRoot, 'buff_image'),
  calculator: path.join(projectRoot, 'calculator_image'),
  guestbook: path.join(projectRoot, 'guestbook_image'),
}

const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/** 稳定文件名片段：保留中文/字母数字，去掉路径非法字符 */
export function sanitizeStableBase(raw) {
  const text = String(raw ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
  const clipped = text.slice(0, 100)
  return clipped || null
}

function readUploadMeta(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const query = req.query && typeof req.query === 'object' ? req.query : {}
  const pick = (...keys) => {
    for (const key of keys) {
      const value = body[key] ?? query[key]
      if (value == null) continue
      const text = String(value).trim()
      if (text) return text
    }
    return null
  }
  return {
    id: pick('id'),
    bossName: pick('bossName', 'boss_name', 'name'),
    buffName: pick('buffName', 'buff_name', 'name'),
  }
}

/**
 * boss：优先怪物名（跨期共用），否则 ID
 * buff：优先 ID（含版本期数编码），否则 Buff 名
 */
export function resolveStableUploadBase(type, req) {
  const meta = readUploadMeta(req)
  if (type === 'boss') {
    return sanitizeStableBase(meta.bossName) || sanitizeStableBase(meta.id)
  }
  if (type === 'buff') {
    return sanitizeStableBase(meta.id) || sanitizeStableBase(meta.buffName)
  }
  return null
}

function createMemoryUploader() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true)
      } else {
        cb(new Error('仅支持 jpg、png、gif、webp 格式图片'))
      }
    },
  })
}

/**
 * 将已校验的上传 buffer 落到稳定文件名；同名覆盖，便于跨环境路径对齐。
 * @returns {{ filename: string, absolutePath: string, stable: boolean }}
 */
export function persistTypedImageBuffer(type, req, file) {
  if (!file?.buffer) {
    throw new Error('请上传图片文件，字段名为 image')
  }
  const kind = detectImageKind(file.buffer)
  const ext = extForImageKind(kind)
  if (!ext) {
    throw new Error('仅支持真实的 jpg、png、gif、webp 图片')
  }

  const destDir = imageDirs[type]
  if (!destDir) throw new Error(`未知图片类型：${type}`)
  ensureDir(destDir)

  const stableBase = resolveStableUploadBase(type, req)
  const base =
    stableBase || `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
  const filename = `${base}${ext}`
  const absolutePath = path.join(destDir, filename)
  fs.writeFileSync(absolutePath, file.buffer)
  return { filename, absolutePath, stable: Boolean(stableBase) }
}

const memoryUploader = createMemoryUploader()

export const uploadBossImage = memoryUploader.single('image')
export const uploadBuffImage = memoryUploader.single('image')
export const uploadCalculatorImage = memoryUploader.single('image')
/** 留言 / 头像：先入内存，校验魔数后再落盘 */
export const uploadGuestbookImage = memoryUploader.single('image')
/** 计算器实体头像 → 前端 public 固定路径（kind、entityId 走 query） */
export const uploadCalculatorPublicImage = memoryUploader.single('image')

export { imageDirs }
