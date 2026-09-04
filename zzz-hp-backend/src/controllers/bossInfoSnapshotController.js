import multer from 'multer'
import { fail, success, failInternal } from '../utils/response.js'
import {
  exportBossInfoSnapshot,
  importBossInfoSnapshot,
} from '../utils/bossInfoSnapshot.js'

export async function exportBossInfoHandler(_req, res) {
  try {
    const data = await exportBossInfoSnapshot()
    return success(res, data)
  } catch (err) {
    return failInternal(res, err, '导出怪物基础库失败')
  }
}

export async function importBossInfoHandler(req, res) {
  try {
    let payload = req.body
    if (req.file?.buffer) {
      const text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '')
      payload = JSON.parse(text)
    }
    if (payload && typeof payload === 'object' && payload.data && !payload.rows) {
      payload = payload.data
    }
    const replace =
      req.query?.replace === '1' ||
      req.query?.replace === 'true' ||
      payload?.replace === true
    const summary = await importBossInfoSnapshot(payload, { replace })
    return success(res, summary, '怪物基础库导入完成')
  } catch (err) {
    const message = err instanceof SyntaxError ? 'JSON 解析失败' : err.message
    return fail(res, message || '导入怪物基础库失败', 400, { error: err.message })
  }
}

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 32 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase()
    const type = String(file.mimetype || '')
    if (name.endsWith('.json') || type.includes('json') || type === 'application/octet-stream') {
      cb(null, true)
      return
    }
    cb(new Error('请上传 JSON 文件'))
  },
})

export function handleBossInfoUpload(req, res, next) {
  importUpload.single('file')(req, res, (err) => {
    if (err) return fail(res, err.message || '上传失败', 400)
    if (!req.file) return fail(res, '请选择 JSON 文件', 400)
    return next()
  })
}
