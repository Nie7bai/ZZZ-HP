import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { detectImageKind, extForImageKind } from './imageMagic.js'

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

/**
 * 实体 ID 可含 `&`（如 orphie&magus），但不宜直接作 URL/文件名：
 * `&` 在查询串与未编码路径里会被拆成参数。磁盘与对外 URL 使用安全化 basename。
 */
export function calculatorAvatarFileBaseName(entityId) {
  const id = normalizeCalculatorEntityId(entityId)
  return id.replace(/[&<>:"/\\|?*\x00-\x1f]/g, '_')
}

export function calculatorAvatarPublicUrl(kind, entityId, ext = '.webp') {
  const normalizedKind = normalizeCalculatorPublicKind(kind)
  const { urlPrefix } = CALCULATOR_PUBLIC_AVATAR_KINDS[normalizedKind]
  const safeExt = ALLOWED_EXT.has(String(ext || '').toLowerCase())
    ? String(ext).toLowerCase()
    : '.webp'
  return `${urlPrefix}/${calculatorAvatarFileBaseName(entityId)}${safeExt}`
}

const ALLOWED_URL_PREFIXES = [
  ...Object.values(CALCULATOR_PUBLIC_AVATAR_KINDS).map((item) => item.urlPrefix),
  '/calculator_image',
]

function getAllowedRoots() {
  const folders = Object.values(CALCULATOR_PUBLIC_AVATAR_KINDS).map((item) => item.folder)
  const roots = [
    publicRoot,
    distRoot,
    backendRoot,
    path.join(backendRoot, 'calculator_image'),
    ...folders.map((folder) => path.join(publicRoot, folder)),
    ...folders.map((folder) => path.join(distRoot, folder)),
    ...folders.map((folder) => path.join(backendRoot, folder)),
  ]
  return roots
}

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

function resolveExtension(originalName, mimetype, buffer) {
  if (Buffer.isBuffer(buffer)) {
    const kind = detectImageKind(buffer)
    const fromMagic = extForImageKind(kind)
    if (fromMagic) return fromMagic
  }
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
  if (!fs.existsSync(destDir)) {
    ensureDir(destDir)
  }
  if (!fs.existsSync(destDir)) return
  fs.copyFileSync(srcFile, path.join(destDir, path.basename(srcFile)))
}

function isPathInsideRoot(candidate, root) {
  const rel = path.relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** 规范化 avatar URL：拒绝 ..、反斜杠、NUL、未知前缀 */
export function normalizeAvatarSourceUrl(avatarUrl) {
  if (typeof avatarUrl !== 'string') return null
  let raw = avatarUrl.trim()
  if (!raw.startsWith('/')) return null
  try {
    raw = decodeURIComponent(raw)
  } catch {
    return null
  }
  if (raw.includes('\0') || raw.includes('\\') || raw.includes('..')) return null
  if (!ALLOWED_URL_PREFIXES.some((prefix) => raw === prefix || raw.startsWith(`${prefix}/`))) {
    return null
  }
  const parts = raw.split('/').filter(Boolean)
  if (!parts.length || parts.some((part) => part === '.' || part === '..')) return null
  return `/${parts.join('/')}`
}

function resolveContainedExistingFile(absoluteCandidate) {
  try {
    const real = fs.realpathSync(absoluteCandidate)
    if (!fs.statSync(real).isFile()) return null
    const allowed = getAllowedRoots().some((root) => {
      try {
        const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root)
        return isPathInsideRoot(real, realRoot)
      } catch {
        return false
      }
    })
    return allowed ? real : null
  } catch {
    return null
  }
}

/**
 * 保存计算器实体头像：
 * - 前端 public / dist（本地 vite / 静态站点）
 * - 后端同名目录（生产 IIS 把 /character 等反代到 Node，与 boss_image 一致）
 */
export async function saveCalculatorPublicAvatar(kind, entityId, file) {
  if (!file?.buffer && !file?.path) {
    throw new Error('缺少图片文件')
  }

  const buffer = file.buffer
    ? file.buffer
    : fs.readFileSync(file.path)
  if (!detectImageKind(buffer)) {
    throw new Error('仅支持真实的 jpg、png、gif、webp 图片')
  }

  const normalizedKind = normalizeCalculatorPublicKind(kind)
  const normalizedId = normalizeCalculatorEntityId(entityId)
  const { folder, urlPrefix } = CALCULATOR_PUBLIC_AVATAR_KINDS[normalizedKind]
  const ext = resolveExtension(file.originalname, file.mimetype, buffer)
  const fileBase = calculatorAvatarFileBaseName(normalizedId)
  const filename = `${fileBase}${ext}`
  const relativePath = `${folder}/${filename}`

  const publicDir = path.join(publicRoot, folder)
  ensureDir(publicDir)
  const publicFile = path.join(publicDir, filename)
  fs.writeFileSync(publicFile, buffer)

  const distDir = path.join(distRoot, folder)
  ensureDir(distDir)
  fs.copyFileSync(publicFile, path.join(distDir, filename))

  const backendDir = path.join(backendRoot, folder)
  ensureDir(backendDir)
  fs.copyFileSync(publicFile, path.join(backendDir, filename))

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

/** 根据 avatar URL 在允许根目录内查找已有文件（防路径穿越） */
export function resolveExistingAvatarFile(avatarUrl) {
  const safeUrl = normalizeAvatarSourceUrl(avatarUrl)
  if (!safeUrl) return null

  const rel = safeUrl.replace(/^\//, '').replace(/\//g, path.sep)
  const basename = path.basename(rel)
  const candidates = [
    path.join(publicRoot, rel),
    path.join(distRoot, rel),
    path.join(backendRoot, rel),
    path.join(backendRoot, 'calculator_image', basename),
    path.join(backendRoot, 'character', basename),
  ]

  for (const file of candidates) {
    const contained = resolveContainedExistingFile(file)
    if (contained) return contained
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
  const fileBase = calculatorAvatarFileBaseName(normalizedId)
  const { folder, urlPrefix } = CALCULATOR_PUBLIC_AVATAR_KINDS[normalizedKind]

  const source =
    resolveExistingAvatarFile(avatarUrl) ||
    resolveExistingAvatarFile(`${urlPrefix}/${fileBase}.webp`) ||
    resolveExistingAvatarFile(`${urlPrefix}/${fileBase}.png`) ||
    // 兼容旧文件名（ID 含 & 时曾直接当文件名）
    resolveExistingAvatarFile(`${urlPrefix}/${normalizedId}.webp`) ||
    resolveExistingAvatarFile(`${urlPrefix}/${normalizedId}.png`)

  if (!source || !fs.existsSync(source)) {
    return { url: avatarUrl ?? null, action: 'missing' }
  }

  const ext = extFromUrlOrFile(source)
  const filename = `${fileBase}${ext}`
  const targetUrl = `${urlPrefix}/${filename}`
  const publicDir = path.join(publicRoot, folder)
  const publicFile = path.join(publicDir, filename)

  ensureDir(publicDir)
  if (!fs.existsSync(publicFile) || fs.statSync(publicFile).mtimeMs < fs.statSync(source).mtimeMs) {
    fs.copyFileSync(source, publicFile)
  }

  copyIfDirExists(publicFile, path.join(distRoot, folder))
  copyIfDirExists(publicFile, path.join(backendRoot, folder))

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
