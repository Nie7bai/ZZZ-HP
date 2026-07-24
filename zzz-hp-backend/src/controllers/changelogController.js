import {
  createChangelog,
  deleteChangelog,
  getChangelogById,
  listChangelogs,
  updateChangelog,
} from '../services/changelogService.js'
import { fail, success } from '../utils/response.js'

function normalizePayload(body = {}) {
  const version = typeof body.version === 'string' ? body.version.trim() : ''
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const publishedAt =
    typeof body.publishedAt === 'string' && body.publishedAt.trim()
      ? body.publishedAt.trim()
      : null

  if (!version) return { error: '版本号为必填项' }
  if (!title) return { error: '标题为必填项' }
  if (!content) return { error: '更新内容为必填项' }

  return { version, title, content, publishedAt }
}

export async function getChangelogs(_req, res) {
  try {
    const data = await listChangelogs()
    return success(res, data)
  } catch (err) {
    return fail(res, '获取更新日志失败', 500, { error: err.message })
  }
}

export async function getChangelog(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) {
    return fail(res, '无效的日志 ID', 400)
  }

  try {
    const data = await getChangelogById(id)
    if (!data) return fail(res, '更新日志不存在', 404)
    return success(res, data)
  } catch (err) {
    return fail(res, '获取更新日志失败', 500, { error: err.message })
  }
}

export async function addChangelog(req, res) {
  const payload = normalizePayload(req.body)
  if (payload.error) return fail(res, payload.error, 400)

  try {
    const data = await createChangelog(payload)
    return success(res, data, '更新日志已创建')
  } catch (err) {
    return fail(res, '创建更新日志失败', 500, { error: err.message })
  }
}

export async function editChangelog(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) {
    return fail(res, '无效的日志 ID', 400)
  }

  const payload = normalizePayload(req.body)
  if (payload.error) return fail(res, payload.error, 400)

  try {
    const data = await updateChangelog(id, payload)
    if (!data) return fail(res, '更新日志不存在', 404)
    return success(res, data, '更新日志已保存')
  } catch (err) {
    return fail(res, '保存更新日志失败', 500, { error: err.message })
  }
}

export async function removeChangelog(req, res) {
  const id = Number(req.params.id)
  if (!Number.isFinite(id) || id <= 0) {
    return fail(res, '无效的日志 ID', 400)
  }

  try {
    const ok = await deleteChangelog(id)
    if (!ok) return fail(res, '更新日志不存在', 404)
    return success(res, { id }, '更新日志已删除')
  } catch (err) {
    return fail(res, '删除更新日志失败', 500, { error: err.message })
  }
}
