import {
  blockUser,
  followUser,
  getPublicUserProfile,
  listBlockedUsers,
  listFollowers,
  listFollowing,
  searchUsers,
  unblockUser,
  unfollowUser,
} from '../services/guestbookSocialService.js'
import { extractBearerToken, getUserByToken } from '../services/userAuthService.js'
import { fail, success } from '../utils/response.js'

async function resolveAuthUser(req) {
  const token = extractBearerToken(req)
  if (!token) return null
  try {
    return await getUserByToken(token)
  } catch (err) {
    if (err?.code === 'USER_BANNED') {
      return { id: null, __banMessage: err.message || '账号已被封禁' }
    }
    return null
  }
}

function failAuth(res, authUser, loginMessage = '请先登录') {
  if (authUser?.__banMessage) {
    fail(res, authUser.__banMessage, 403)
    return true
  }
  if (!authUser?.id) {
    fail(res, loginMessage, 401)
    return true
  }
  return false
}

export async function getGuestbookUserProfile(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的用户 ID', 400)

  const authUser = await resolveAuthUser(req)
  if (authUser?.__banMessage) return fail(res, authUser.__banMessage, 403)
  try {
    const data = await getPublicUserProfile(id, authUser?.id || null)
    if (!data) return fail(res, '用户不存在', 404)
    if (data.error === 'blocked') return fail(res, '无法查看该用户主页', 403)
    return success(res, data)
  } catch (err) {
    return fail(res, '获取用户主页失败', 500, { error: err.message })
  }
}

export async function getGuestbookUserFollowers(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的用户 ID', 400)

  const authUser = await resolveAuthUser(req)
  if (authUser?.__banMessage) return fail(res, authUser.__banMessage, 403)
  try {
    const profile = await getPublicUserProfile(id, authUser?.id || null)
    if (!profile) return fail(res, '用户不存在', 404)
    if (profile.error === 'blocked') return fail(res, '无法查看该用户粉丝', 403)
    if (!profile.isSelf && !profile.profilePublicSocial) {
      return fail(res, '该用户未公开粉丝列表', 403)
    }
    const data = await listFollowers(id)
    return success(res, data)
  } catch (err) {
    return fail(res, '获取粉丝列表失败', 500, { error: err.message })
  }
}

export async function getGuestbookUserFollowing(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的用户 ID', 400)

  const authUser = await resolveAuthUser(req)
  if (authUser?.__banMessage) return fail(res, authUser.__banMessage, 403)
  try {
    const profile = await getPublicUserProfile(id, authUser?.id || null)
    if (!profile) return fail(res, '用户不存在', 404)
    if (profile.error === 'blocked') return fail(res, '无法查看该用户关注', 403)
    if (!profile.isSelf && !profile.profilePublicSocial) {
      return fail(res, '该用户未公开关注列表', 403)
    }
    const data = await listFollowing(id)
    return success(res, data)
  } catch (err) {
    return fail(res, '获取关注列表失败', 500, { error: err.message })
  }
}

export async function followGuestbookUser(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的用户 ID', 400)

  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  try {
    const result = await followUser(authUser.id, id)
    if (result?.error === 'not_found') return fail(res, '用户不存在', 404)
    if (result?.error === 'self') return fail(res, '不能关注自己', 400)
    if (result?.error === 'blocked') return fail(res, '无法关注该用户', 403)
    return success(res, result, '已关注')
  } catch (err) {
    return fail(res, '关注失败', 500, { error: err.message })
  }
}

export async function unfollowGuestbookUser(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的用户 ID', 400)

  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  try {
    const result = await unfollowUser(authUser.id, id)
    return success(res, result, '已取消关注')
  } catch (err) {
    return fail(res, '取消关注失败', 500, { error: err.message })
  }
}

export async function blockGuestbookUser(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的用户 ID', 400)

  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  try {
    const result = await blockUser(authUser.id, id)
    if (result?.error === 'not_found') return fail(res, '用户不存在', 404)
    if (result?.error === 'self') return fail(res, '不能拉黑自己', 400)
    return success(res, result, '已拉黑')
  } catch (err) {
    return fail(res, '拉黑失败', 500, { error: err.message })
  }
}

export async function unblockGuestbookUser(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的用户 ID', 400)

  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  try {
    const result = await unblockUser(authUser.id, id)
    return success(res, result, '已取消拉黑')
  } catch (err) {
    return fail(res, '取消拉黑失败', 500, { error: err.message })
  }
}

export async function getMyBlockedUsers(req, res) {
  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  try {
    const data = await listBlockedUsers(authUser.id)
    return success(res, data)
  } catch (err) {
    return fail(res, '获取黑名单失败', 500, { error: err.message })
  }
}

export async function searchGuestbookUsers(req, res) {
  const q = typeof req.query?.q === 'string' ? req.query.q.trim() : ''
  if (!q) return fail(res, '请输入 UID 或昵称', 400)
  if (q.length > 40) return fail(res, '搜索关键词过长', 400)

  try {
    const data = await searchUsers(q, 20)
    return success(res, data)
  } catch (err) {
    return fail(res, '搜索用户失败', 500, { error: err.message })
  }
}
