import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.join(__dirname, '../..')
const repoRoot = path.join(backendRoot, '..')
const frontRoot = path.join(repoRoot, 'zzz-hp')
const publicRoot = path.join(frontRoot, 'public')
const distRoot = path.join(frontRoot, 'dist')

/** 计算器实体头像：写入前端 public（随 build 进 dist），URL 与目录对应 */
export const CALCULATOR_PUBLIC_AVATAR_KINDS = {
  agent: { folder: 'character', urlPrefix: '/character' },
  wengine: { folder: 'wengine', urlPrefix: '/wengine' },
  drive_disc: { folder: 'drive_disc', urlPrefix: '/drive_disc' },
  bangboo: { folder: 'bangboo', urlPrefix: '/bangboo' },
}

const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._&'-]*$/
const ALLOWED_EXT = new Set(['.webp', '.jpg', '.jpeg', '.png', '.gif'])

export function normalizeCalculatorPublicKind(raw) {
  const key = typeof raw === 'string' ? raw.trim() : ''
  if (!Object.hasOwn(CALCULATOR_PUBLIC_AVATAR_KINDS, key)) {
    throw new Error('无效的资源类型 kind')
  }
  return key
}

export function normalizeCalculatorEntityId(raw) {
  const id = typeof raw === 'string' ? raw.trim() : ''
  if (!id || !SAFE_ID_RE.test(id)) {
    throw new Error('无效的实体 ID')
  }
  return id
}

function resolveExtension(originalName, mimetype) {
  const ext = path.extname(originalName || '').toLowerCase()
  if (ALLOWED_EXT.has(ext)) return ext
  if (mimetype === 'image/webp') return '.webp'
  if (mimetype === 'image/png') return '.png'
  if (mimetype === 'image/jpeg') return '.jpg'
  if (mimetype === 'image/gif') return '.gif'
  return '.webp'
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function copyIfDirExists(srcFile, destDir) {
  if (!fs.existsSync(destDir)) return
  ensureDir(destDir)
  fs.copyFileSync(srcFile, path.join(destDir, path.basename(srcFile)))
}

/**
 * 保存计算器实体头像到 public/{folder}/{id}.ext，并尽量同步到 dist/{folder}/。
 * @returns {Promise<{ url: string, filename: string, relativePath: string }>}
 */
export async function saveCalculatorPublicAvatar(kind, entityId, file) {
  if (!file?.buffer && !file?.path) {
    throw new Error('缺少图片文件')
  }

  const normalizedKind = normalizeCalculatorPublicKind(kind)
  const normalizedId = normalizeCalculatorEntityId(entityId)
  const { folder, urlPrefix } = CALCULATOR_PUBLIC_AVATAR_KINDS[normalizedKind]
  const ext = resolveExtension(file.originalname, file.mimetype)
  const filename = `${normalizedId}${ext}`
  const relativePath = `${folder}/${filename}`

  const publicDir = path.join(publicRoot, folder)
  ensureDir(publicDir)
  const publicFile = path.join(publicDir, filename)

  if (file.buffer) {
    fs.writeFileSync(publicFile, file.buffer)
  } else {
    fs.copyFileSync(file.path, publicFile)
  }

  copyIfDirExists(publicFile, path.join(distRoot, folder))

  return {
    url: `${urlPrefix}/${filename}`,
    filename,
    relativePath,
  }
}

export function isCalculatorPublicAvatarUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('/')) return false
  return Object.values(CALCULATOR_PUBLIC_AVATAR_KINDS).some(({ urlPrefix }) =>
    url.startsWith(`${urlPrefix}/`),
  )
}

function extFromUrlOrFile(urlOrName) {
  const ext = path.extname(urlOrName || '').toLowerCase()
  return ALLOWED_EXT.has(ext) ? ext : '.webp'
}

/** 根据 avatar URL 在仓库内查找已有文件 */
export function resolveExistingAvatarFile(avatarUrl) {
  if (typeof avatarUrl !== 'string' || !avatarUrl.startsWith('/')) return null

  const rel = avatarUrl.replace(/^\//, '').replace(/\//g, path.sep)
  const candidates = [
    path.join(publicRoot, rel),
    path.join(backendRoot, rel),
    path.join(backendRoot, 'character', path.basename(rel)),
  ]

  for (const file of candidates) {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file
  }
  return null
}

/**
 * 将实体头像统一为 public 固定路径；返回新 URL（已统一则原样返回）。
 */
export function syncEntityAvatarToPublic(kind, entityId, avatarUrl) {
  if (!entityId?.trim()) return { url: avatarUrl ?? null, action: 'skip' }

  const normalizedKind = normalizeCalculatorPublicKind(kind)
  const normalizedId = normalizeCalculatorEntityId(entityId)
  const { folder, urlPrefix } = CALCULATOR_PUBLIC_AVATAR_KINDS[normalizedKind]

  const source =
    resolveExistingAvatarFile(avatarUrl) ||
    resolveExistingAvatarFile(`${urlPrefix}/${normalizedId}.webp`) ||
    resolveExistingAvatarFile(`${urlPrefix}/${normalizedId}.png`) ||
    path.join(backendRoot, 'character', `${normalizedId}.webp`)

  if (!source || !fs.existsSync(source)) {
    return { url: avatarUrl ?? null, action: 'missing' }
  }

  const ext = extFromUrlOrFile(source)
  const filename = `${normalizedId}${ext}`
  const targetUrl = `${urlPrefix}/${filename}`
  const publicDir = path.join(publicRoot, folder)
  const publicFile = path.join(publicDir, filename)

  ensureDir(publicDir)
  if (!fs.existsSync(publicFile) || fs.statSync(publicFile).mtimeMs < fs.statSync(source).mtimeMs) {
    fs.copyFileSync(source, publicFile)
  }

  copyIfDirExists(publicFile, path.join(distRoot, folder))

  if (avatarUrl === targetUrl) return { url: targetUrl, action: 'ok' }
  return { url: targetUrl, action: 'updated' }
}

export const EXPORT_ENTITY_COLLECTIONS = [
  { key: 'agents', kind: 'agent' },
  { key: 'wengines', kind: 'wengine' },
  { key: 'driveDiscs', kind: 'drive_disc' },
  { key: 'bangboos', kind: 'bangboo' },
]

/** 规范化 export JSON 内全部计算器实体头像路径，并复制文件到 public */
export function syncCalculatorExportAvatars(exportDoc) {
  const stats = { ok: 0, updated: 0, missing: 0, skip: 0 }
  const missing = []

  for (const { key, kind } of EXPORT_ENTITY_COLLECTIONS) {
    const list = exportDoc[key]
    if (!Array.isArray(list)) continue

    for (const item of list) {
      const result = syncEntityAvatarToPublic(kind, item.id, item.avatar_image)
      item.avatar_image = result.url

      if (result.action === 'ok') stats.ok += 1
      else if (result.action === 'updated') stats.updated += 1
      else if (result.action === 'missing') {
        stats.missing += 1
        if (item.avatar_image) {
          missing.push({ kind, id: item.id, name: item.name, avatar: item.avatar_image })
        }
      } else stats.skip += 1
    }
  }

  return { stats, missing }
}
