import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(path.join(__dirname, '../..'))

const ALLOWED_PREFIXES = ['boss_image/', 'buff_image/', 'calculator_image/', 'guestbook_image/']

/**
 * 将库内相对路径（如 /boss_image/a.webp）解析为本地绝对路径；非法路径返回 null。
 */
export function resolveLocalImageAbsolutePath(url) {
  const text = String(url ?? '').trim()
  if (!text || /^https?:\/\//i.test(text)) return null

  const rel = text.replace(/^\/+/, '').replace(/\\/g, '/')
  if (!ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix))) return null
  if (rel.includes('..')) return null

  const absolute = path.resolve(projectRoot, rel.split('/').join(path.sep))
  const rootWithSep = projectRoot.endsWith(path.sep) ? projectRoot : `${projectRoot}${path.sep}`
  if (absolute !== projectRoot && !absolute.startsWith(rootWithSep)) return null
  return absolute
}

/** 本地磁盘上是否存在该相对图片路径对应的文件 */
export function localImageExists(url) {
  const absolute = resolveLocalImageAbsolutePath(url)
  return Boolean(absolute && fs.existsSync(absolute))
}

/**
 * 写入图片路径时优先用「磁盘上真实存在」的路径，避免 JSON 导入把已修好的图覆盖成裂图。
 * - incoming 文件存在 → 用 incoming
 * - 否则 existing 文件存在 → 用 existing
 * - 否则保留非空 existing（兼容偶发外链）
 * - 否则用 incoming（可能仍为空/裂图，留给后续补图）
 */
export function preferExistingImage(incoming, existing) {
  const next = incoming == null || incoming === '' ? null : String(incoming).trim() || null
  const prev = existing == null || existing === '' ? null : String(existing).trim() || null
  return pickBestImagePath(next, prev)
}

/** 在多个候选路径中选：优先磁盘存在，其次本地托管路径，再次第一个非空（跳过游戏包 /UI/） */
export function pickBestImagePath(...candidates) {
  const normalized = candidates.map((value) => {
    if (value == null || value === '') return null
    const text = String(value).trim()
    return text || null
  })
  for (const value of normalized) {
    if (localImageExists(value)) return value
  }
  for (const value of normalized) {
    if (value && isLocalHostedImagePath(value)) return value
  }
  for (const value of normalized) {
    if (value && !isGamePackageImagePath(value)) return value
  }
  for (const value of normalized) {
    if (value) return value
  }
  return null
}

/** 本地静态站托管的相对路径 */
export function isLocalHostedImagePath(url) {
  const text = String(url ?? '').trim().replace(/^\/+/, '')
  return ALLOWED_PREFIXES.some((prefix) => text.startsWith(prefix))
}

/** 游戏包内路径（前端静态站无法直接托管） */
export function isGamePackageImagePath(url) {
  const text = String(url ?? '').trim()
  return text.startsWith('/UI/') || text.startsWith('UI/')
}
