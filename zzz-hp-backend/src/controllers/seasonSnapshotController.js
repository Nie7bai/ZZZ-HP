import multer from 'multer'
import { fail, success } from '../utils/response.js'
import {
  exportSeasonSnapshot,
  importSeasonSnapshot,
} from '../services/seasonSnapshotService.js'

function parseScheme(raw) {
  const value = String(raw || '').trim()
  if (value === 'defense' || value === 'crisis') return value
  return null
}

function parseVariant(raw) {
  const value = String(raw || '').trim()
  if (value === 'old' || value === 'new') return value
  return null
}

export async function exportSeasonSnapshotHandler(req, res) {
  try {
    const scheme = parseScheme(req.query?.scheme)
    if (!scheme) return fail(res, 'scheme 须为 crisis 或 defense', 400)
    const data = await exportSeasonSnapshot(scheme, parseVariant(req.query?.variant))
    return success(res, data)
  } catch (err) {
    const status = /须为|必填/i.test(err.message) ? 400 : 500
    return fail(res, err.message || '导出失败', status, { error: err.message })
  }
}

export async function importSeasonSnapshotHandler(req, res) {
  try {
    let payload = req.body
    if (req.file?.buffer) {
      const text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '')
      payload = JSON.parse(text)
    }
    const summary = await importSeasonSnapshot(payload)
    return success(res, summary, '危局 / 防卫战快照导入完成')
  } catch (err) {
    const message = err instanceof SyntaxError ? 'JSON 解析失败' : err.message
    return fail(res, message || '导入失败', 400, { error: err.message })
  }
}

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
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

export function handleSeasonSnapshotUpload(req, res, next) {
  importUpload.single('file')(req, res, (err) => {
    if (err) return fail(res, err.message || '上传失败', 400)
    if (!req.file) return fail(res, '请选择 JSON 文件', 400)
    return next()
  })
}
