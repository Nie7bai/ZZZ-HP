import { extractBearerToken, getUserByToken } from '../services/userAuthService.js'
import { fail, failInternal } from '../utils/response.js'

/**
 * 登录用户鉴权（Multer 之前使用，避免未登录先落盘）。
 * 成功时写入 req.user；失败时已写响应。
 */
export async function requireUser(req, res, next) {
  const token = extractBearerToken(req)
  if (!token) {
    return fail(res, '未登录', 401)
  }
  try {
    const user = await getUserByToken(token)
    if (!user) {
      return fail(res, '登录已失效，请重新登录', 401)
    }
    req.user = user
    return next()
  } catch (err) {
    if (err?.code === 'USER_BANNED') {
      return fail(res, err.message || '账号已被封禁', 403)
    }
    return failInternal(res, err, '获取用户信息失败')
  }
}
