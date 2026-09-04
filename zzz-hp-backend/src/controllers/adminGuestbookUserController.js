import {
  adminUpdateGuestbookUser,
  getGuestbookUserAdmin,
  listGuestbookUsers,
  setGuestbookUserBanned,
} from '../services/adminGuestbookUserService.js'
import { isValidAdminSession } from '../services/adminSessionService.js'
import { extractBearerToken, getUserByToken } from '../services/userAuthService.js'
import { fail, success, failInternal } from '../utils/response.js'

async function readIsPasswordAdmin(req) {
  const headerToken = req.headers['x-admin-token']
  if (typeof headerToken === 'string' && isValidAdminSession(headerToken.trim())) {
    return true
  }
  const bearer = extractBearerToken(req)
  if (bearer && isValidAdminSession(bearer)) return true
  return false
}

async function readIsSiteAdmin(req) {
  if (await readIsPasswordAdmin(req)) return true
  const bearer = extractBearerToken(req)
  if (bearer) {
    try {
      const user = await getUserByToken(bearer)
      if (user?.isSiteAdmin) return true
    } catch {
      /* ignore */
    }
  }
  return false
}

export async function getGuestbookUsers(req, res) {
  if (!(await readIsSiteAdmin(req))) return fail(res, '需要站点管理员权限', 403)
  try {
    const data = await listGuestbookUsers({
      q: typeof req.query?.q === 'string' ? req.query.q : '',
      banned: typeof req.query?.banned === 'string' ? req.query.banned : '',
      limit: req.query?.limit,
      offset: req.query?.offset,
    })
    return success(res, data)
  } catch (err) {
    return failInternal(res, err, '获取账号列表失败')
  }
}

export async function getGuestbookUser(req, res) {
  if (!(await readIsSiteAdmin(req))) return fail(res, '需要站点管理员权限', 403)
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效用户 ID', 400)
  try {
    const data = await getGuestbookUserAdmin(id)
    if (!data) return fail(res, '用户不存在', 404)
    return success(res, data)
  } catch (err) {
    return failInternal(res, err, '获取账号失败')
  }
}

export async function editGuestbookUser(req, res) {
  if (!(await readIsSiteAdmin(req))) return fail(res, '需要站点管理员权限', 403)
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效用户 ID', 400)

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
  if (typeof req.body?.isSiteAdmin === 'boolean') {
    // 授标 / 撤标仅允许密码管理员会话，防止 is_site_admin 用户自我复制权限
    if (!(await readIsPasswordAdmin(req))) {
      return fail(res, '修改站点管理员标记需要密码管理员权限', 403)
    }
    patch.isSiteAdmin = req.body.isSiteAdmin
  }

  if (!Object.keys(patch).length) return fail(res, '没有可更新的字段', 400)

  try {
    const data = await adminUpdateGuestbookUser(id, patch)
    if (data?.error) return fail(res, data.error, 400)
    return success(res, data, '账号资料已更新')
  } catch (err) {
    return failInternal(res, err, '更新账号失败')
  }
}

export async function banGuestbookUser(req, res) {
  if (!(await readIsSiteAdmin(req))) return fail(res, '需要站点管理员权限', 403)
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效用户 ID', 400)

  const banned = req.body?.banned
  if (typeof banned !== 'boolean') return fail(res, '请提供 banned 布尔值', 400)
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : ''
  const durationHours =
    req.body?.durationHours == null || req.body?.durationHours === ''
      ? null
      : Number(req.body.durationHours)

  try {
    const data = await setGuestbookUserBanned(id, { banned, reason, durationHours })
    if (data?.error) return fail(res, data.error, 400)
    return success(res, data, banned ? '账号已封禁' : '账号已解封')
  } catch (err) {
    return failInternal(res, err, '更新封禁状态失败')
  }
}
