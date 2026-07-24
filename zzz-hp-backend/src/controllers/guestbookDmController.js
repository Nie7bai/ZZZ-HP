import {
  getConversationById,
  getOrCreateConversation,
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
} from '../services/guestbookDmService.js'
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

export async function getMyDmConversations(req, res) {
  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  try {
    const data = await listConversations(authUser.id)
    return success(res, data)
  } catch (err) {
    return fail(res, '获取会话失败', 500, { error: err.message })
  }
}

export async function createMyDmConversation(req, res) {
  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  const peerUserId = Number(req.body?.peerUserId ?? req.body?.peerId)
  if (!Number.isFinite(peerUserId) || peerUserId <= 0) return fail(res, '无效的用户 ID', 400)
  if (peerUserId === authUser.id) return fail(res, '不能与自己聊天', 400)

  try {
    const result = await getOrCreateConversation(authUser.id, peerUserId)
    if (result?.error === 'not_found') return fail(res, '用户不存在', 404)
    if (result?.error === 'blocked') return fail(res, '无法与该用户聊天', 403)
    if (result?.error === 'invalid') return fail(res, '无效的用户 ID', 400)
    return success(res, result, '会话已创建')
  } catch (err) {
    return fail(res, '创建会话失败', 500, { error: err.message })
  }
}

export async function getMyDmMessages(req, res) {
  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  const conversationId = Number(req.params.id)
  if (!Number.isFinite(conversationId) || conversationId <= 0) return fail(res, '无效的会话 ID', 400)

  try {
    const result = await listMessages(conversationId, authUser.id)
    if (result?.error === 'not_found') return fail(res, '会话不存在', 404)
    await markConversationRead(conversationId, authUser.id)
    return success(res, result)
  } catch (err) {
    return fail(res, '获取消息失败', 500, { error: err.message })
  }
}

export async function sendMyDmMessage(req, res) {
  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  const conversationId = Number(req.params.id)
  if (!Number.isFinite(conversationId) || conversationId <= 0) return fail(res, '无效的会话 ID', 400)

  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : ''
  const images = Array.isArray(req.body?.images)
    ? req.body.images.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).slice(0, 3)
    : []
  if (!content && !images.length) return fail(res, '消息不能为空', 400)

  try {
    const result = await sendMessage(conversationId, authUser.id, { content, images })
    if (result?.error === 'not_found') return fail(res, '会话不存在', 404)
    if (result?.error === 'blocked') return fail(res, '无法发送消息', 403)
    if (result?.error === 'empty') return fail(res, '消息不能为空', 400)
    if (result?.error === 'too_long') return fail(res, '消息过长', 400)
    return success(res, result, '已发送')
  } catch (err) {
    return fail(res, '发送失败', 500, { error: err.message })
  }
}

export async function markMyDmConversationRead(req, res) {
  const authUser = await resolveAuthUser(req)
  if (failAuth(res, authUser)) return

  const conversationId = Number(req.params.id)
  if (!Number.isFinite(conversationId) || conversationId <= 0) return fail(res, '无效的会话 ID', 400)

  try {
    const updated = await markConversationRead(conversationId, authUser.id)
    const conversation = await getConversationById(conversationId, authUser.id)
    return success(res, { updated, conversation })
  } catch (err) {
    return fail(res, '标记已读失败', 500, { error: err.message })
  }
}
