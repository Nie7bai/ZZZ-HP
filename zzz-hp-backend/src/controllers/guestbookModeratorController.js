import {
  addGuestbookModerator,
  listGuestbookModerators,
  removeGuestbookModerator,
  setGuestbookModeratorEnabled,
} from '../services/guestbookModeratorService.js'
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

export async function getGuestbookModerators(req, res) {
  if (!readIsSiteAdmin(req)) return fail(res, '需要站点管理员权限', 403)
  try {
    const data = await listGuestbookModerators()
    return success(res, data)
  } catch (err) {
    return fail(res, '获取留言板管理员失败', 500, { error: err.message })
  }
}

export async function createGuestbookModerator(req, res) {
  if (!readIsSiteAdmin(req)) return fail(res, '需要站点管理员权限', 403)
  const mihoyoAid = typeof req.body?.mihoyoAid === 'string' ? req.body.mihoyoAid.trim() : ''
  const mihoyoMid = typeof req.body?.mihoyoMid === 'string' ? req.body.mihoyoMid.trim() : ''
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''

  try {
    const result = await addGuestbookModerator({ mihoyoAid, mihoyoMid, note })
    if (result?.error) return fail(res, result.error, 400)
    return success(res, result, '已添加留言板管理员')
  } catch (err) {
    return fail(res, '添加留言板管理员失败', 500, { error: err.message })
  }
}

export async function deleteGuestbookModerator(req, res) {
  if (!readIsSiteAdmin(req)) return fail(res, '需要站点管理员权限', 403)
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效 ID', 400)

  try {
    const ok = await removeGuestbookModerator(id)
    if (!ok) return fail(res, '管理员不存在', 404)
    return success(res, { id }, '已移除留言板管理员')
  } catch (err) {
    return fail(res, '移除留言板管理员失败', 500, { error: err.message })
  }
}

export async function toggleGuestbookModerator(req, res) {
  if (!readIsSiteAdmin(req)) return fail(res, '需要站点管理员权限', 403)
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) return fail(res, '无效 ID', 400)

  const enabled = req.body?.enabled
  if (typeof enabled !== 'boolean') return fail(res, '请提供 enabled 布尔值', 400)

  try {
    const data = await setGuestbookModeratorEnabled(id, enabled)
    if (!data) return fail(res, '管理员不存在', 404)
    return success(res, data, enabled ? '管理员已启用' : '管理员已停用')
  } catch (err) {
    return fail(res, '更新管理员状态失败', 500, { error: err.message })
  }
}
