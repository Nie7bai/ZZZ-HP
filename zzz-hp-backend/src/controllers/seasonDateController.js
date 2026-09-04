import {
  createSeasonDate,
  deleteSeasonDate,
  listSeasonDates,
  updateSeasonDate,
} from '../services/seasonDateService.js'
import { fail, success, failInternal } from '../utils/response.js'

export async function getSeasonDates(req, res) {
  try {
    const mode =
      req.query.mode === 'defense'
        ? 'defense'
        : req.query.mode === 'deduction'
          ? 'deduction'
          : 'crisis'
    const data = await listSeasonDates(mode)
    return success(res, data)
  } catch (err) {
    return failInternal(res, err, '获取版本日期失败')
  }
}

export async function postSeasonDate(req, res) {
  try {
    const data = await createSeasonDate(req.body || {})
    return success(res, data, '版本日期已创建')
  } catch (err) {
    if (/必填|不存在|Duplicate/i.test(err.message)) {
      return fail(res, err.message || '创建失败', 400)
    }
    return failInternal(res, err, '创建失败')
  }
}

export async function putSeasonDate(req, res) {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return fail(res, '无效 ID', 400)
    const data = await updateSeasonDate(id, req.body || {})
    return success(res, data, '版本日期已更新')
  } catch (err) {
    if (/必填|不存在|Duplicate/i.test(err.message)) {
      return fail(res, err.message || '更新失败', 400)
    }
    return failInternal(res, err, '更新失败')
  }
}

export async function removeSeasonDate(req, res) {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return fail(res, '无效 ID', 400)
    const data = await deleteSeasonDate(id)
    return success(res, data, '版本日期已删除')
  } catch (err) {
    if (/不存在/i.test(err.message)) {
      return fail(res, err.message || '删除失败', 404)
    }
    return failInternal(res, err, '删除失败')
  }
}
