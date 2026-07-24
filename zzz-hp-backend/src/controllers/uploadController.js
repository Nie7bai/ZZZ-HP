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

export function uploadGuestbook(req, res) {
  if (!req.file) {
    return fail(res, '请上传图片文件，字段名为 image', 400)
  }

  const url = buildImageUrl('guestbook', req.file.filename)
  return success(res, { url, filename: req.file.filename }, '留言板图片上传成功', 201)
}

export function handleUploadError(err, _req, res, next) {
  if (!err) return next()

  if (err.code === 'LIMIT_FILE_SIZE') {
    return fail(res, '图片不能超过 5MB', 400)
  }
  if (err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'EPERM') {
    return fail(res, '服务器图片目录不可写，请检查 guestbook_image 权限', 500)
  }
  return fail(res, err.message || '图片上传失败', 400)
}
