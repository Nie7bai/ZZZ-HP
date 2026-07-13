import { success, fail } from '../utils/response.js'

function buildImageUrl(type, filename) {
  return `/${type}_image/${filename}`
}

export function uploadBoss(req, res) {
  if (!req.file) {
    return fail(res, '请上传图片文件，字段名为 image', 400)
  }

  const url = buildImageUrl('boss', req.file.filename)
  return success(res, { url, filename: req.file.filename }, 'Boss 图片上传成功', 201)
}

export function uploadBuff(req, res) {
  if (!req.file) {
    return fail(res, '请上传图片文件，字段名为 image', 400)
  }

  const url = buildImageUrl('buff', req.file.filename)
  return success(res, { url, filename: req.file.filename }, 'Buff 图片上传成功', 201)
}

export function uploadCalculator(req, res) {
  if (!req.file) {
    return fail(res, '请上传图片文件，字段名为 image', 400)
  }

  const url = buildImageUrl('calculator', req.file.filename)
  return success(res, { url, filename: req.file.filename }, '计算器头像上传成功', 201)
}

export function handleUploadError(err, _req, res, next) {
  if (err) {
    return fail(res, err.message || '图片上传失败', 400)
  }
  next()
}
