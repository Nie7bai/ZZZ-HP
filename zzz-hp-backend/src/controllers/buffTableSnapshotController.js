import multer from 'multer'
import { fail, success, failInternal } from '../utils/response.js'
import {
  exportBuffTableSnapshot,
  importBuffTableSnapshot,
} from '../utils/buffTableSnapshot.js'

function parseMode(raw) {
  const value = String(raw || '').trim()
  if (value === 'crisis' || value === 'defense' || value === 'deduction') return value
  return null
}

export async function exportBuffTableHandler(req, res) {
  try {
    const mode = parseMode(req.query?.mode)
    if (req.query?.mode && !mode) {
      return fail(res, 'mode 须为 crisis / defense / deduction', 400)
    }
    const data = await exportBuffTableSnapshot(mode)
    return success(res, data)
  } catch (err) {
    return failInternal(res, err, '导出 Buff 表失败')
  }
}

export async function importBuffTableHandler(req, res) {
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
    const mode = parseMode(req.query?.mode ?? payload?.modeFilter)
    if ((req.query?.mode || payload?.modeFilter) && req.query?.mode && !parseMode(req.query.mode)) {
      return fail(res, 'mode 须为 crisis / defense / deduction', 400)
    }
    const summary = await importBuffTableSnapshot(payload, { replace, mode })
    return success(res, summary, 'Buff 表导入完成')
  } catch (err) {
    const message = err instanceof SyntaxError ? 'JSON 解析失败' : err.message
    return fail(res, message || '导入 Buff 表失败', 400, { error: err.message })
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

export function handleBuffTableUpload(req, res, next) {
  importUpload.single('file')(req, res, (err) => {
    if (err) return fail(res, err.message || '上传失败', 400)
    if (!req.file) return fail(res, '请选择 JSON 文件', 400)
    return next()
  })
}
