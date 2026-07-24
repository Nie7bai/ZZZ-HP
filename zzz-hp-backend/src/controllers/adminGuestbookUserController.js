import {
  adminUpdateGuestbookUser,
  getGuestbookUserAdmin,
  listGuestbookUsers,
  setGuestbookUserBanned,
} from '../services/adminGuestbookUserService.js'
import { isValidAdminSession } from '../services/adminSessionService.js'
import { fail, success } from '../utils/response.js'

function readIsSiteAdmin(req) {
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

export async function getGuestbookUsers(req, res) {
  if (!readIsSiteAdmin(req)) return fail(res, '需要站点管理员权限', 403)
  try {
    const data = await listGuestbookUsers({
      q: typeof req.query?.q === 'string' ? req.query.q : '',
      banned: typeof req.query?.banned === 'string' ? req.query.banned : '',
      limit: req.query?.limit,
      offset: req.query?.offset,
    })
    return success(res, data)
  } catch (err) {
    return fail(res, '获取账号列表失败', 500, { error: err.message })
  }
}

export async function getGuestbookUser(req, res) {
  if (!readIsSiteAdmin(req)) return fail(res, '需要站点管理员权限', 403)
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效用户 ID', 400)
  try {
    const data = await getGuestbookUserAdmin(id)
    if (!data) return fail(res, '用户不存在', 404)
    return success(res, data)
  } catch (err) {
    return fail(res, '获取账号失败', 500, { error: err.message })
  }
}

export async function editGuestbookUser(req, res) {
  if (!readIsSiteAdmin(req)) return fail(res, '需要站点管理员权限', 403)
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
    patch.isSiteAdmin = req.body.isSiteAdmin
  }

  if (!Object.keys(patch).length) return fail(res, '没有可更新的字段', 400)

  try {
    const data = await adminUpdateGuestbookUser(id, patch)
    if (data?.error) return fail(res, data.error, 400)
    return success(res, data, '账号资料已更新')
  } catch (err) {
    return fail(res, '更新账号失败', 500, { error: err.message })
  }
}

export async function banGuestbookUser(req, res) {
  if (!readIsSiteAdmin(req)) return fail(res, '需要站点管理员权限', 403)
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
    return fail(res, '更新封禁状态失败', 500, { error: err.message })
  }
}
