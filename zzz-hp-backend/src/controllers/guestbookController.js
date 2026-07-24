import {
  blockComment,
  createComment,
  createGuestbook,
  deleteCommentWithAuth,
  deleteGuestbook,
  getGuestbookById,
  getHideSensitivePosts,
  GUESTBOOK_CATEGORIES,
  ADMIN_ONLY_CATEGORIES,
  incrementGuestbookView,
  listComments,
  listCommentsByUser,
  listFavoritePosts,
  listGuestbook,
  listGuestbookManage,
  listLikedPosts,
  restoreGuestbook,
  requestRestoreGuestbook,
  setGuestbookHidden,
  setHideSensitivePosts,
  setGuestbookPinned,
  setGuestbookSensitive,
  setProfilePinned,
  toggleGuestbookFavorite,
  toggleGuestbookLike,
  toggleCommentLike,
  updateGuestbook,
} from '../services/guestbookService.js'
import {
  listGuestbookReports,
  markGuestbookReportHandled,
  submitGuestbookReport,
} from '../services/guestbookReportService.js'
import {
  countUnreadNotifications,
  listGuestbookNotifications,
  markNotificationsRead,
} from '../services/guestbookNotificationService.js'
import { isGuestbookModerator } from '../services/guestbookModeratorService.js'
import { checkInGuestbook } from '../services/guestbookExpService.js'
import { isValidAdminSession } from '../services/adminSessionService.js'
import { extractBearerToken, getUserByToken, assertUserCanPost } from '../services/userAuthService.js'
import { submitUnbanRequest } from '../services/guestbookBanService.js'
import { fail, success } from '../utils/response.js'

const NICKNAME_MAX = 40
const TITLE_MAX = 120
const POST_CONTENT_MAX = 10000
const COMMENT_CONTENT_MAX = 1000

async function resolveAuthUser(req) {
  const token = extractBearerToken(req)
  if (!token) return null
  try {
    return await getUserByToken(token)
  } catch {
    return null
  }
}

function failAuth(res, authUser, loginMessage = '请先登录') {
  if (!authUser?.id) {
    fail(res, loginMessage, 401)
    return true
  }
  return false
}

function failIfBannedPost(res, authUser) {
  try {
    assertUserCanPost(authUser)
    return false
  } catch (err) {
    fail(res, err.message || '账号处于封禁状态，暂时无法发帖或评论', 403)
    return true
  }
}

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

async function resolveGuestbookStaff(req, res) {
  const authUser = await resolveAuthUser(req)
  const isSiteAdmin = readIsSiteAdmin(req)
  let isModerator = false
  if (authUser?.mihoyoAid) {
    isModerator = await isGuestbookModerator(authUser.mihoyoAid, authUser.mihoyoMid || '')
  }
  return { authUser, isSiteAdmin, isModerator, canManagePosts: isSiteAdmin || isModerator }
}

function actorFromUser(user) {
  if (!user) return { label: '管理员' }
  return { id: user.id, nickname: user.nickname || '有人' }
}

function normalizePostPayload(body = {}, authUser = null, { canManagePosts = false } = {}) {
  const anonymous = Boolean(body.anonymous)
  const nicknameRaw = typeof body.nickname === 'string' ? body.nickname.trim() : ''
  const titleRaw = typeof body.title === 'string' ? body.title.trim() : ''
  const categoryRaw = typeof body.category === 'string' ? body.category.trim() : ''
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const images = Array.isArray(body.images)
    ? body.images.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
    : []
  const notifyRaw = body.notify
  const notify =
    notifyRaw === false || notifyRaw === 0 || notifyRaw === '0' || notifyRaw === 'false'
      ? false
      : true
  const isSensitive = Boolean(body.isSensitive)

  if (!titleRaw) return { error: '标题不能为空' }
  if (titleRaw.length > TITLE_MAX) return { error: `标题不能超过 ${TITLE_MAX} 字` }
  if (content.length > POST_CONTENT_MAX) return { error: `正文不能超过 ${POST_CONTENT_MAX} 字` }
  if (!content && images.length === 0) return { error: '请填写正文或至少上传一张图片' }
  if (images.length > 9) return { error: '最多上传 9 张图片' }

  const category = categoryRaw || '灌水'
  if (!GUESTBOOK_CATEGORIES.includes(category)) {
    return { error: `分类无效，可选：${GUESTBOOK_CATEGORIES.join('、')}` }
  }
  if (ADMIN_ONLY_CATEGORIES.includes(category) && !canManagePosts) {
    return { error: '公告与更新日志仅管理员可发布' }
  }

  let nickname = nicknameRaw || '匿名'
  const userId = authUser?.id || null
  if (authUser && !anonymous) {
    nickname = authUser.nickname || nickname
  } else if (anonymous) {
    nickname = '匿名'
  }

  if (nickname.length > NICKNAME_MAX) return { error: `昵称不能超过 ${NICKNAME_MAX} 字` }

  return {
    nickname,
    title: titleRaw,
    category,
    content,
    images,
    userId,
    notify,
    isSensitive,
    isAnonymous: anonymous,
  }
}

function normalizeCommentPayload(body = {}, authUser = null) {
  const anonymous = Boolean(body.anonymous)
  const nicknameRaw = typeof body.nickname === 'string' ? body.nickname.trim() : ''
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const images = Array.isArray(body.images)
    ? body.images.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).slice(0, 3)
    : []

  if (!content && !images.length) return { error: '评论内容不能为空' }
  if (content.length > COMMENT_CONTENT_MAX) {
    return { error: `评论内容不能超过 ${COMMENT_CONTENT_MAX} 字` }
  }

  let nickname = nicknameRaw || '匿名'
  const userId = authUser?.id || null
  if (authUser && !anonymous) {
    nickname = authUser.nickname || nickname
  } else if (anonymous) {
    nickname = '匿名'
  }

  if (nickname.length > NICKNAME_MAX) return { error: `昵称不能超过 ${NICKNAME_MAX} 字` }

  return { nickname, content, userId, images, isAnonymous: anonymous }
}

export async function getGuestbookEntries(req, res) {
  try {
    const authUser = await resolveAuthUser(req)
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : ''
    const keywordRaw = req.query.q ?? req.query.keyword
    const keyword = typeof keywordRaw === 'string' ? keywordRaw.trim() : ''
    const startDate =
      typeof req.query.startDate === 'string'
        ? req.query.startDate.trim()
        : typeof req.query.from === 'string'
          ? req.query.from.trim()
          : ''
    const endDate =
      typeof req.query.endDate === 'string'
        ? req.query.endDate.trim()
        : typeof req.query.to === 'string'
          ? req.query.to.trim()
          : ''
    const userIdRaw = req.query.userId ?? req.query.user
    const userId = Number(userIdRaw)
    const followingRaw = req.query.following
    const following =
      followingRaw === '1' ||
      followingRaw === 'true' ||
      followingRaw === true
    const anonymousOnly =
      req.query.anonymous === 'only' && Number.isFinite(userId) && userId > 0
    const data = await listGuestbook({
      category,
      keyword,
      startDate,
      endDate,
      userId: Number.isFinite(userId) && userId > 0 ? userId : null,
      viewerUserId: authUser?.id || null,
      anonymousOnly,
      following,
    })
    return success(res, data)
  } catch (err) {
    return fail(res, '获取留言失败', 500, { error: err.message })
  }
}

export async function getManageGuestbookEntries(req, res) {
  const staff = await resolveGuestbookStaff(req, res)
  if (!staff) return
  if (!staff.canManagePosts) return fail(res, '需要留言板管理员权限', 403)

  const statusRaw = typeof req.query.status === 'string' ? req.query.status.trim() : 'normal'
  const status = ['normal', 'hidden', 'deleted', 'sensitive'].includes(statusRaw)
    ? statusRaw
    : 'normal'

  try {
    const data = await listGuestbookManage({
      status,
      viewerUserId: staff.authUser?.id || null,
    })
    return success(res, data)
  } catch (err) {
    return fail(res, '获取管理列表失败', 500, { error: err.message })
  }
}

export async function getGuestbookSensitiveVisibility(req, res) {
  try {
    const hidden = await getHideSensitivePosts()
    return success(res, { hidden })
  } catch (err) {
    return fail(res, '获取敏感内容设置失败', 500, { error: err.message })
  }
}

export async function updateGuestbookSensitiveVisibility(req, res) {
  const staff = await resolveGuestbookStaff(req, res)
  if (!staff) return
  if (!staff.canManagePosts) return fail(res, '需要留言板管理员权限', 403)
  try {
    const hidden = await setHideSensitivePosts(Boolean(req.body?.hidden))
    return success(res, { hidden }, hidden ? '已屏蔽所有敏感内容' : '已恢复展示敏感内容')
  } catch (err) {
    return fail(res, '更新敏感内容设置失败', 500, { error: err.message })
  }
}

export async function getGuestbookEntry(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的留言 ID', 400)

  try {
    const staff = await resolveGuestbookStaff(req, res)
    if (!staff) return
    const data = await getGuestbookById(id, {
      includeHidden: true,
      viewerUserId: staff.authUser?.id || null,
      exposeAnonymousIdentity: staff.canManagePosts,
    })
    const isOwner = Boolean(data?.isMine)
    if (!data) return fail(res, '留言不存在', 404)
    if ((data.isDeleted || data.isHidden) && !staff.canManagePosts && !isOwner) {
      return fail(res, '留言不存在', 404)
    }
    let viewed = data
    if (!data.isDeleted) {
      viewed =
        (await incrementGuestbookView(
          id,
          staff.authUser?.id || null,
          staff.canManagePosts,
        )) || data
    }
    return success(res, viewed)
  } catch (err) {
    return fail(res, '获取留言失败', 500, { error: err.message })
  }
}

export async function addGuestbookEntry(req, res) {
  const staff = await resolveGuestbookStaff(req, res)
  if (!staff) return
  if (!staff.authUser?.id) return fail(res, '请先登录后再发布委托', 401)
  if (failIfBannedPost(res, staff.authUser)) return
  const payload = normalizePostPayload(req.body, staff.authUser, {
    canManagePosts: staff.canManagePosts,
  })
  if (payload.error) return fail(res, payload.error, 400)

  try {
    const data = await createGuestbook({
      ...payload,
      actor: actorFromUser(staff.authUser),
    })
    return success(res, data, '帖子已发布')
  } catch (err) {
    const detail = err?.message || ''
    if (detail.includes('Data too long')) {
      return fail(res, '标题或正文过长，请缩短后再试', 400, { error: detail })
    }
    return fail(res, detail ? `发布失败：${detail}` : '发布失败', 500, { error: detail })
  }
}

export async function editGuestbookEntry(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的留言 ID', 400)

  const staff = await resolveGuestbookStaff(req, res)
  if (!staff) return
  const payload = normalizePostPayload(req.body, staff.authUser, {
    canManagePosts: staff.canManagePosts,
  })
  if (payload.error) return fail(res, payload.error, 400)

  try {
    const result = await updateGuestbook(
      id,
      {
        title: payload.title,
        category: payload.category,
        content: payload.content,
        images: payload.images,
        isSensitive: payload.isSensitive,
        isAnonymous: payload.isAnonymous,
        nickname: payload.nickname,
      },
      { authUser: staff.authUser, isAdmin: staff.isSiteAdmin || staff.canManagePosts },
    )
    if (result?.error === 'not_found') return fail(res, '留言不存在', 404)
    if (result?.error === 'unauthorized') return fail(res, '请先登录', 401)
    if (result?.error === 'forbidden') return fail(res, '无权修改此帖子', 403)
    return success(res, result, '帖子已更新')
  } catch (err) {
    return fail(res, '更新帖子失败', 500, { error: err.message })
  }
}

export async function pinGuestbookEntry(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的留言 ID', 400)
  if (!readIsSiteAdmin(req)) return fail(res, '需要站点管理员权限', 403)

  const isPinned = Boolean(req.body?.isPinned)
  try {
    const data = await setGuestbookPinned(id, isPinned)
    if (!data) return fail(res, '留言不存在', 404)
    return success(res, data, isPinned ? '帖子已置顶' : '已取消置顶')
  } catch (err) {
    return fail(res, '置顶操作失败', 500, { error: err.message })
  }
}

export async function profilePinGuestbookEntry(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的留言 ID', 400)

  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  const isPinned = Boolean(req.body?.isPinned)
  try {
    const result = await setProfilePinned(id, authUser.id, isPinned)
    if (result?.error === 'not_found') return fail(res, '留言不存在', 404)
    if (result?.error === 'forbidden') return fail(res, '只能置顶自己的委托', 403)
    return success(res, result, isPinned ? '已在个人主页置顶' : '已取消个人置顶')
  } catch (err) {
    return fail(res, '个人置顶操作失败', 500, { error: err.message })
  }
}

export async function likeGuestbookEntry(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的留言 ID', 400)

  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  try {
    const result = await toggleGuestbookLike(authUser.id, id, actorFromUser(authUser))
    if (result?.error === 'not_found') return fail(res, '留言不存在', 404)
    return success(res, result, result.liked ? '已点赞' : '已取消点赞')
  } catch (err) {
    return fail(res, '点赞操作失败', 500, { error: err.message })
  }
}

export async function favoriteGuestbookEntry(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的留言 ID', 400)

  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  try {
    const result = await toggleGuestbookFavorite(authUser.id, id, actorFromUser(authUser))
    if (result?.error === 'not_found') return fail(res, '留言不存在', 404)
    return success(res, result, result.favorited ? '已收藏' : '已取消收藏')
  } catch (err) {
    return fail(res, '收藏操作失败', 500, { error: err.message })
  }
}

export async function getMyFavoriteEntries(req, res) {
  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  try {
    const data = await listFavoritePosts(authUser.id)
    return success(res, data)
  } catch (err) {
    return fail(res, '获取收藏失败', 500, { error: err.message })
  }
}

export async function getMyLikedEntries(req, res) {
  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  try {
    const data = await listLikedPosts(authUser.id)
    return success(res, data)
  } catch (err) {
    return fail(res, '获取点赞列表失败', 500, { error: err.message })
  }
}

export async function getMyCommentEntries(req, res) {
  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  try {
    const data = await listCommentsByUser(authUser.id)
    return success(res, data)
  } catch (err) {
    return fail(res, '获取评论列表失败', 500, { error: err.message })
  }
}

export async function hideGuestbookEntry(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的留言 ID', 400)

  const staff = await resolveGuestbookStaff(req, res)
  if (!staff) return
  if (!staff.canManagePosts) return fail(res, '需要留言板管理员权限', 403)

  const isHidden = Boolean(req.body?.isHidden)
  const message = typeof req.body?.message === 'string' ? req.body.message : ''
  try {
    const data = await setGuestbookHidden(id, isHidden, actorFromUser(staff.authUser), message)
    if (!data) return fail(res, '留言不存在', 404)
    return success(res, data, isHidden ? '留言已隐藏' : '留言已恢复展示')
  } catch (err) {
    return fail(res, '更新留言状态失败', 500, { error: err.message })
  }
}

export async function setGuestbookSensitiveEntry(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的留言 ID', 400)

  const staff = await resolveGuestbookStaff(req, res)
  if (!staff) return
  if (!staff.canManagePosts) return fail(res, '需要留言板管理员权限', 403)

  const isSensitive = Boolean(req.body?.isSensitive)
  try {
    const data = await setGuestbookSensitive(id, isSensitive)
    if (!data) return fail(res, '留言不存在', 404)
    return success(res, data, isSensitive ? '已标记为敏感内容' : '已取消敏感标记')
  } catch (err) {
    return fail(res, '更新敏感标记失败', 500, { error: err.message })
  }
}

export async function removeGuestbookEntry(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的留言 ID', 400)

  const staff = await resolveGuestbookStaff(req, res)
  if (!staff) return
  if (!staff.canManagePosts) return fail(res, '需要留言板管理员权限', 403)

  const message = typeof req.body?.message === 'string' ? req.body.message : ''
  try {
    const ok = await deleteGuestbook(id, actorFromUser(staff.authUser), message)
    if (!ok) return fail(res, '留言不存在', 404)
    return success(res, { id }, '留言已删除')
  } catch (err) {
    return fail(res, '删除留言失败', 500, { error: err.message })
  }
}

export async function getGuestbookComments(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的留言 ID', 400)

  try {
    const staff = await resolveGuestbookStaff(req, res)
    if (!staff) return
    const post = await getGuestbookById(id, {
      includeHidden: true,
      viewerUserId: staff.authUser?.id || null,
      exposeAnonymousIdentity: staff.canManagePosts,
    })
    if (!post) return fail(res, '留言不存在', 404)
    const isOwner = Boolean(post.isMine)
    if (post.isDeleted || (post.isHidden && !staff.canManagePosts)) {
      if (!isOwner) return fail(res, '留言不存在', 404)
    }
    const data = await listComments(id, {
      viewerUserId: staff.authUser?.id || null,
      postAuthorId: post._ownerUserId,
      exposeAnonymousIdentity: staff.canManagePosts,
    })
    return success(res, data)
  } catch (err) {
    return fail(res, '获取评论失败', 500, { error: err.message })
  }
}

export async function addGuestbookComment(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的留言 ID', 400)

  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser, '请先登录后再评论')) return
  if (failIfBannedPost(res, authUser)) return
  const payload = normalizeCommentPayload(req.body, authUser)
  if (payload.error) return fail(res, payload.error, 400)

  try {
    const data = await createComment(id, payload)
    if (!data) return fail(res, '留言不存在', 404)
    return success(res, data, '评论已发布')
  } catch (err) {
    return fail(res, '发布评论失败', 500, { error: err.message })
  }
}

export async function removeGuestbookComment(req, res) {
  const postId = Number(req.params.id)
  const id = Number(req.params.commentId)
  if (!Number.isFinite(postId) || postId <= 0) return fail(res, '无效的留言 ID', 400)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的评论 ID', 400)

  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  const staff = await resolveGuestbookStaff(req, res)
  if (!staff) return
  try {
    const result = await deleteCommentWithAuth(id, {
      authUser,
      isSiteAdmin: staff.isSiteAdmin,
      isModerator: staff.isModerator,
    })
    if (result?.error === 'not_found') return fail(res, '评论不存在', 404)
    if (result?.error === 'forbidden') return fail(res, '无权删除该评论', 403)
    return success(res, { id, postId: result.postId }, '评论已删除')
  } catch (err) {
    return fail(res, '删除评论失败', 500, { error: err.message })
  }
}

export async function blockGuestbookComment(req, res) {
  const postId = Number(req.params.id)
  const id = Number(req.params.commentId)
  if (!Number.isFinite(postId) || postId <= 0) return fail(res, '无效的留言 ID', 400)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的评论 ID', 400)

  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  try {
    const result = await blockComment(id, authUser)
    if (result?.error === 'not_found') return fail(res, '评论不存在', 404)
    if (result?.error === 'unauthorized') return fail(res, '请先登录', 401)
    if (result?.error === 'forbidden') return fail(res, '不能屏蔽自己的评论', 403)
    const msg =
      result.type === 'global'
        ? '评论已屏蔽'
        : result.blocked
          ? '已屏蔽该评论'
          : '已取消屏蔽'
    return success(res, result, msg)
  } catch (err) {
    return fail(res, '屏蔽评论失败', 500, { error: err.message })
  }
}

export async function requestRestoreGuestbookEntry(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的留言 ID', 400)

  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  try {
    const result = await requestRestoreGuestbook(id, authUser.id)
    if (result?.error === 'not_found') return fail(res, '留言不存在', 404)
    if (result?.error === 'forbidden') return fail(res, '只能申请恢复自己的委托', 403)
    if (result?.error === 'not_moderated') return fail(res, '该委托无需恢复', 400)
    const msg = result.alreadyRequested ? '已提交恢复申请，请等待管理员处理' : '恢复申请已提交'
    return success(res, result.post, msg)
  } catch (err) {
    return fail(res, '提交恢复申请失败', 500, { error: err.message })
  }
}

export async function restoreGuestbookEntry(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的留言 ID', 400)

  const staff = await resolveGuestbookStaff(req, res)
  if (!staff) return
  if (!staff.canManagePosts) return fail(res, '需要留言板管理员权限', 403)

  try {
    const data = await restoreGuestbook(id, actorFromUser(staff.authUser))
    if (!data) return fail(res, '留言不存在', 404)
    return success(res, data, '帖子已恢复')
  } catch (err) {
    return fail(res, '恢复帖子失败', 500, { error: err.message })
  }
}

export async function getMyNotifications(req, res) {
  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  try {
    const data = await listGuestbookNotifications(authUser.id)
    return success(res, data)
  } catch (err) {
    return fail(res, '获取通知失败', 500, { error: err.message })
  }
}

export async function getMyNotificationUnreadCount(req, res) {
  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  try {
    const count = await countUnreadNotifications(authUser.id)
    return success(res, { count })
  } catch (err) {
    return fail(res, '获取通知失败', 500, { error: err.message })
  }
}

export async function markMyNotificationsRead(req, res) {
  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null
  try {
    const updated = await markNotificationsRead(authUser.id, ids)
    return success(res, { updated }, '已标记为已读')
  } catch (err) {
    return fail(res, '更新通知失败', 500, { error: err.message })
  }
}

export async function likeGuestbookComment(req, res) {
  const postId = Number(req.params.id)
  const commentId = Number(req.params.commentId)
  if (!Number.isFinite(postId) || postId <= 0) return fail(res, '无效的留言 ID', 400)
  if (!Number.isFinite(commentId) || commentId <= 0) return fail(res, '无效的评论 ID', 400)

  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  try {
    const result = await toggleCommentLike(authUser.id, commentId)
    if (result?.error === 'not_found') return fail(res, '评论不存在', 404)
    return success(res, result, result.liked ? '已点赞' : '已取消点赞')
  } catch (err) {
    return fail(res, '点赞操作失败', 500, { error: err.message })
  }
}

export async function reportGuestbookEntry(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的留言 ID', 400)

  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  const reason = String(req.body?.reason || '').trim()
  try {
    const result = await submitGuestbookReport(
      authUser.id,
      { targetType: 'post', postId: id, reason },
      actorFromUser(authUser),
    )
    if (result?.error === 'invalid') return fail(res, '举报失败', 400)
    const msg = result.duplicate ? '今日已举报过该委托' : '举报已提交，管理员会尽快处理'
    return success(res, result, msg)
  } catch (err) {
    return fail(res, '举报失败', 500, { error: err.message })
  }
}

export async function reportGuestbookComment(req, res) {
  const postId = Number(req.params.id)
  const commentId = Number(req.params.commentId)
  if (!Number.isFinite(postId) || postId <= 0) return fail(res, '无效的留言 ID', 400)
  if (!Number.isFinite(commentId) || commentId <= 0) return fail(res, '无效的评论 ID', 400)

  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  const reason = String(req.body?.reason || '').trim()
  try {
    const result = await submitGuestbookReport(
      authUser.id,
      { targetType: 'comment', postId, commentId, reason },
      actorFromUser(authUser),
    )
    if (result?.error === 'invalid') return fail(res, '举报失败', 400)
    const msg = result.duplicate ? '今日已举报过该评论' : '举报已提交，管理员会尽快处理'
    return success(res, result, msg)
  } catch (err) {
    return fail(res, '举报失败', 500, { error: err.message })
  }
}

export async function getGuestbookReports(req, res) {
  const staff = await resolveGuestbookStaff(req, res)
  if (!staff) return
  if (!staff.canManagePosts) return fail(res, '无权查看举报', 403)

  try {
    const status = String(req.query.status || 'pending').trim()
    let targetType = String(req.query.targetType || 'all').trim()
    // 用户举报仅站点管理员可见
    if (targetType === 'user' && !staff.isSiteAdmin) {
      return fail(res, '需要站点管理员权限查看用户举报', 403)
    }
    const data = await listGuestbookReports({ status, targetType })
    const filtered =
      staff.isSiteAdmin || targetType === 'post' || targetType === 'comment'
        ? data
        : data.filter((r) => r.targetType !== 'user')
    return success(res, filtered)
  } catch (err) {
    return fail(res, '加载举报失败', 500, { error: err.message })
  }
}

export async function handleGuestbookReport(req, res) {
  const staff = await resolveGuestbookStaff(req, res)
  if (!staff) return
  if (!staff.canManagePosts) return fail(res, '无权处理举报', 403)

  const id = Number(req.params.reportId)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效的举报 ID', 400)

  try {
    const result = await markGuestbookReportHandled(
      id,
      actorFromUser(staff.authUser),
      String(req.body?.message || req.body?.handlerMessage || '').trim(),
    )
    if (result?.error === 'not_found') return fail(res, '举报不存在', 404)
    if (result?.error === 'already_handled') return fail(res, '该举报已处理', 400)
    if (!result.ok) return fail(res, '处理失败', 400)
    return success(res, { id }, '已标记为已处理，已通知举报人')
  } catch (err) {
    return fail(res, '处理举报失败', 500, { error: err.message })
  }
}

export async function reportGuestbookUser(req, res) {
  const userId = Number(req.params.id)
  if (!Number.isFinite(userId) || userId <= 0) return fail(res, '无效的用户 ID', 400)

  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  const reason = String(req.body?.reason || '').trim()
  try {
    const result = await submitGuestbookReport(
      authUser.id,
      { targetType: 'user', reportedUserId: userId, reason },
      actorFromUser(authUser),
    )
    if (result?.error === 'invalid') return fail(res, '举报失败', 400)
    if (result?.error === 'forbidden') return fail(res, '不能举报自己', 403)
    if (result?.error === 'not_found') return fail(res, '用户不存在', 404)
    const msg = result.duplicate ? '今日已举报过该用户' : '举报已提交，管理员会尽快处理'
    return success(res, result, msg)
  } catch (err) {
    return fail(res, '举报失败', 500, { error: err.message })
  }
}

export async function requestGuestbookUnban(req, res) {
  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  const reason = String(req.body?.reason || '').trim()
  try {
    const result = await submitUnbanRequest(authUser.id, reason)
    if (result?.error === 'not_banned') return fail(res, '当前账号未被封禁', 400)
    if (result?.error === 'empty') return fail(res, '请填写申请原因', 400)
    if (result?.error === 'duplicate') return fail(res, '已有待处理的解封申请', 400)
    if (result?.error) return fail(res, '申请失败', 400)
    return success(res, result, '解封申请已提交')
  } catch (err) {
    return fail(res, '申请解封失败', 500, { error: err.message })
  }
}

export async function checkInGuestbookEntry(req, res) {
  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  try {
    const result = await checkInGuestbook(authUser.id)
    if (result.error === 'already_checked_in') {
      return success(
        res,
        { ok: false, alreadyCheckedIn: true, progress: result.progress },
        '今日已打卡',
      )
    }
    if (result.error) return fail(res, '打卡失败', 400)
    return success(res, result, '打卡成功')
  } catch (err) {
    return fail(res, '打卡失败', 500, { error: err.message })
  }
}
