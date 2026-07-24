import multer from 'multer'
import { isValidAdminSession } from '../services/adminSessionService.js'
import { success, fail } from '../utils/response.js'
import { isOcrConfigured, recognizePanelImageAccurate } from '../services/tencentOcrService.js'
import { consumeOcrQuota, getOcrQuota } from '../services/ocrQuotaService.js'

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype)) {
      cb(new Error('仅支持 jpeg/png/gif/webp 图片'))
      return
    }
    cb(null, true)
  },
})

export const uploadPanelImage = uploadMemory.single('image')

export function handleOcrUploadError(err, _req, res, next) {
  if (!err) return next()
  if (err instanceof multer.MulterError) {
    return fail(res, err.code === 'LIMIT_FILE_SIZE' ? '图片过大（上限 8MB）' : err.message, 400)
  }
  return fail(res, err.message || '上传失败', 400)
}

function sanitizeClientId(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim().slice(0, 128)
  // 仅允许稳定可打印标识，避免脏数据撑爆配额文件
  if (!trimmed) return ''
  if (!/^[A-Za-z0-9:._\-]+$/.test(trimmed)) return ''
  return trimmed
}

function readOcrClientId(req) {
  const fromHeader = sanitizeClientId(req.headers['x-ocr-client-id'])
  if (fromHeader) return fromHeader

  const fromQuery = sanitizeClientId(req.query?.clientId)
  if (fromQuery) return fromQuery

  const fromBody = sanitizeClientId(req.body?.clientId)
  if (fromBody) return fromBody

  const forwarded = req.headers['x-forwarded-for']
  const ip =
    (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : '') ||
    req.socket?.remoteAddress ||
    req.ip ||
    ''
  if (ip) return sanitizeClientId(`ip:${ip}`) || `ip:${ip}`.slice(0, 128)
  return ''
}

function readIsAdmin(req) {
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim()
    if (isValidAdminSession(token)) return true
  }
  const headerToken = req.headers['x-admin-token']
  if (typeof headerToken === 'string' && isValidAdminSession(headerToken.trim())) {
    return true
  }
  return false
}

function ocrContext(req) {
  return {
    clientId: readOcrClientId(req),
    isAdmin: readIsAdmin(req),
  }
}

export async function recognizePanel(req, res) {
  try {
    if (!isOcrConfigured()) {
      return fail(res, '服务端未配置腾讯云 OCR 密钥', 503, { code: 'OCR_NOT_CONFIGURED' })
    }
    if (!req.file?.buffer?.length) {
      return fail(res, '请上传面板截图（字段名 image）', 400)
    }

    const ctx = ocrContext(req)

    let quota
    try {
      quota = consumeOcrQuota(1, ctx)
    } catch (quotaErr) {
      if (
        quotaErr?.code === 'OCR_QUOTA_EXCEEDED' ||
        quotaErr?.code === 'OCR_USER_QUOTA_EXCEEDED' ||
        quotaErr?.code === 'OCR_GLOBAL_QUOTA_EXCEEDED' ||
        quotaErr?.code === 'OCR_CLIENT_REQUIRED'
      ) {
        return fail(res, quotaErr.message, 429, {
          code: quotaErr.code,
          quota: quotaErr.quota,
        })
      }
      throw quotaErr
    }

    const ocr = await recognizePanelImageAccurate(req.file.buffer)
    return success(res, {
      Response: ocr,
      TextDetections: ocr?.TextDetections ?? [],
      RequestId: ocr?.RequestId ?? null,
      quota,
    })
  } catch (error) {
    if (error?.code === 'OCR_NOT_CONFIGURED') {
      return fail(res, error.message, 503, { code: 'OCR_NOT_CONFIGURED' })
    }
    const message = error?.message || '腾讯 OCR 调用失败'
    return fail(res, message, 502, {
      code: error?.code || 'OCR_FAILED',
      requestId: error?.requestId,
      quota: getOcrQuota(ocrContext(req)),
    })
  }
}

export async function ocrStatus(req, res) {
  const ctx = ocrContext(req)
  return success(res, {
    configured: isOcrConfigured(),
    quota: getOcrQuota(ctx),
    isAdmin: ctx.isAdmin,
  })
}
