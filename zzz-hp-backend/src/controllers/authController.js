import {
  createMihoyoQr,
  pollMihoyoQr,
} from '../services/mihoyoQrService.js'
import {
  extractBearerToken,
  getUserByToken,
  logoutByToken,
  updateUserProfile,
} from '../services/userAuthService.js'
import { revokeOtherSessionsForUser } from '../services/userSessionService.js'
import {
  bindPhone,
  getSecurityByUserId,
  loginWithPhonePassword,
  sendPhoneCode,
  setPassword,
} from '../services/accountSecurityService.js'
import { fail, success, failInternal } from '../utils/response.js'
import { persistGuestbookBuffer } from './uploadController.js'

function buildImageUrl(filename) {
  return `/guestbook_image/${filename}`
}

async function requireUser(req, res) {
  if (req.user) return req.user
  const token = extractBearerToken(req)
  if (!token) {
    fail(res, '未登录', 401)
    return null
  }
  try {
    const user = await getUserByToken(token)
    if (!user) {
      fail(res, '登录已失效，请重新登录', 401)
      return null
    }
    return user
  } catch (err) {
    if (err?.code === 'USER_BANNED') {
      fail(res, err.message || '账号已被封禁', 403)
      return null
    }
    failInternal(res, err, '获取用户信息失败')
    return null
  }
}

export async function createQr(req, res) {
  try {
    const data = await createMihoyoQr()
    return success(res, data)
  } catch (err) {
    return failInternal(res, err, '创建二维码失败')
  }
}

export async function pollQr(req, res) {
  const ticket = typeof req.body?.ticket === 'string' ? req.body.ticket.trim() : ''
  if (!ticket) return fail(res, '缺少 ticket', 400)

  try {
    const data = await pollMihoyoQr(ticket)
    return success(res, data)
  } catch (err) {
    if (err?.code === 'USER_BANNED' || /封禁/.test(err?.message || '')) {
      return fail(res, err.message || '账号已被封禁', 403)
    }
    return failInternal(res, err, '查询二维码状态失败')
  }
}

export async function getMe(req, res) {
  const user = await requireUser(req, res)
  if (!user) return
  return success(res, user)
}

export async function updateMe(req, res) {
  const current = await requireUser(req, res)
  if (!current) return

  try {
    const patch = {}
    if (typeof req.body?.nickname === 'string') patch.nickname = req.body.nickname
    if (typeof req.body?.bio === 'string') patch.bio = req.body.bio
    if (typeof req.body?.avatar === 'string') patch.avatar = req.body.avatar
    if (typeof req.body?.banner === 'string') patch.banner = req.body.banner
    if (typeof req.body?.profilePublicSocial === 'boolean') {
      patch.profilePublicSocial = req.body.profilePublicSocial
    }
    if (Array.isArray(req.body?.profileShowTabs)) {
      patch.profileShowTabs = req.body.profileShowTabs
    }

    if (!Object.keys(patch).length) {
      return fail(res, '没有可更新的字段', 400)
    }

    const user = await updateUserProfile(current.id, patch)
    return success(res, user, '资料已更新')
  } catch (err) {
    const msg = err.message || '更新资料失败'
    if (/不能|无效|不存在/.test(msg)) {
      return fail(res, msg, 400)
    }
    return failInternal(res, err, '更新资料失败')
  }
}

export async function uploadAvatar(req, res) {
  const current = await requireUser(req, res)
  if (!current) return

  try {
    const filename = persistGuestbookBuffer(req.file)
    const url = buildImageUrl(filename)
    const field = req.body?.field === 'banner' ? 'banner' : 'avatar'
    const user = await updateUserProfile(current.id, { [field]: url })
    return success(res, { url, filename, user }, '上传成功', 201)
  } catch (err) {
    const msg = err.message || '上传失败'
    if (/满|支持|上传图片/.test(msg)) {
      return fail(res, msg, 400)
    }
    return failInternal(res, err, '上传失败')
  }
}

export async function getSecurity(req, res) {
  const current = await requireUser(req, res)
  if (!current) return
  try {
    const data = await getSecurityByUserId(current.id)
    return success(res, data)
  } catch (err) {
    return failInternal(res, err, '获取账号安全信息失败')
  }
}

export async function sendBindPhoneCode(req, res) {
  const current = await requireUser(req, res)
  if (!current) return
  try {
    const phone = typeof req.body?.phone === 'string' ? req.body.phone : ''
    const purpose = req.body?.purpose === 'password' ? 'password' : 'bind'
    const data = await sendPhoneCode({ userId: current.id, phone, purpose })
    return success(res, data, '验证码已发送')
  } catch (err) {
    const msg = err.message || '发送失败'
    if (/请|正确|已被|秒/.test(msg)) {
      return fail(res, msg, 400)
    }
    return failInternal(res, err, '发送失败')
  }
}

export async function bindPhoneHandler(req, res) {
  const current = await requireUser(req, res)
  if (!current) return
  try {
    const phone = typeof req.body?.phone === 'string' ? req.body.phone : ''
    const code = typeof req.body?.code === 'string' ? req.body.code : ''
    const data = await bindPhone({ userId: current.id, phone, code })
    return success(res, data, '手机号绑定成功')
  } catch (err) {
    const msg = err.message || '绑定失败'
    if (/请|正确|已被|过期|错误/.test(msg)) {
      return fail(res, msg, 400)
    }
    return failInternal(res, err, '绑定失败')
  }
}

export async function setPasswordHandler(req, res) {
  const current = await requireUser(req, res)
  if (!current) return
  try {
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    const oldPassword = typeof req.body?.oldPassword === 'string' ? req.body.oldPassword : ''
    const code = typeof req.body?.code === 'string' ? req.body.code : ''
    const phone = typeof req.body?.phone === 'string' ? req.body.phone : ''
    const data = await setPassword({
      userId: current.id,
      password,
      oldPassword,
      code,
      phone,
    })
    // 改密后踢掉其它设备会话，保留当前 token
    const token = extractBearerToken(req)
    revokeOtherSessionsForUser(current.id, token)
    return success(res, data, '密码已保存')
  } catch (err) {
    const msg = err.message || '设置密码失败'
    if (/请|正确|长度|过期|错误/.test(msg)) {
      return fail(res, msg, 400)
    }
    return failInternal(res, err, '设置密码失败')
  }
}

export async function loginPassword(req, res) {
  try {
    const phone = typeof req.body?.phone === 'string' ? req.body.phone : ''
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    const data = await loginWithPhonePassword(phone, password)
    return success(res, data, '登录成功')
  } catch (err) {
    const msg = err.message || '登录失败'
    if (err?.code === 'USER_BANNED' || /封禁/.test(msg)) {
      return fail(res, msg, 403)
    }
    if (/请|正确|错误/.test(msg)) {
      return fail(res, msg, 400)
    }
    return failInternal(res, err, '登录失败')
  }
}

export async function logout(req, res) {
  const token = extractBearerToken(req)
  if (token) logoutByToken(token)
  return success(res, null, '已退出登录')
}
