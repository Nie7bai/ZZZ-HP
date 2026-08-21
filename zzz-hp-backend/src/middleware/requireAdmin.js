import { isValidAdminSession } from '../services/adminSessionService.js'
import { fail } from '../utils/response.js'

function readBearerToken(req) {
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim()
  }
  return ''
}

function readHeaderAdminToken(req) {
  const headerToken = req.headers['x-admin-token']
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim()
  }
  return ''
}

/**
 * 读取有效的管理员会话 token。
 * 优先 X-Admin-Token（专用）；Authorization 可能是留言板用户 JWT，不能未校验就当成管理员。
 */
export function readAdminToken(req) {
  const headerToken = readHeaderAdminToken(req)
  if (headerToken && isValidAdminSession(headerToken)) return headerToken
  const bearer = readBearerToken(req)
  if (bearer && isValidAdminSession(bearer)) return bearer
  return ''
}

export function isAdminRequest(req) {
  return Boolean(readAdminToken(req))
}

/** 管理端写接口鉴权：未登录或不带有效 token 返回 401 */
export function requireAdmin(req, res, next) {
  if (!isAdminRequest(req)) {
    return fail(res, '管理员会话无效或已过期，请重新登录', 401, { code: 'ADMIN_AUTH_REQUIRED' })
  }
  return next()
}
