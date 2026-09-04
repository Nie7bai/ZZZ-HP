import {
  previewSeasonContent,
  softDeleteSeasonContent,
  restoreSeasonContent,
  cleanupSeasonContent,
} from '../services/dataService.js'
import { fail, success } from '../utils/response.js'

function parseScheme(raw) {
  const value = String(raw || '').trim()
  if (value === 'defense') return 'defense'
  if (value === 'crisis') return 'crisis'
  return null
}

function expectedConfirm(scheme, version, phase) {
  return `${scheme}:${String(version).trim()}:${String(phase).trim()}`
}

export async function previewSeasonContentHandler(req, res) {
  try {
    const scheme = parseScheme(req.body?.scheme ?? req.query?.scheme)
    if (!scheme) return fail(res, 'scheme 须为 defense 或 crisis', 400)
    const version = typeof req.body?.version === 'string' ? req.body.version : req.query?.version
    const phase = typeof req.body?.phase === 'string' ? req.body.phase : req.query?.phase
    const data = await previewSeasonContent(scheme, version, phase)
    return success(res, data)
  } catch (err) {
    if (/必填|须为/i.test(err.message)) {
      return fail(res, err.message || '预览失败', 400)
    }
    return failInternal(res, err, '预览失败')
  }
}

export async function softDeleteSeasonContentHandler(req, res) {
  try {
    const scheme = parseScheme(req.body?.scheme)
    if (!scheme) return fail(res, 'scheme 须为 defense 或 crisis', 400)
    const version = typeof req.body?.version === 'string' ? req.body.version : ''
    const phase = typeof req.body?.phase === 'string' ? req.body.phase : ''
    const confirmText =
      typeof req.body?.confirmText === 'string' ? req.body.confirmText.trim() : ''

    const expected = expectedConfirm(scheme, version, phase)
    if (confirmText !== expected) {
      return fail(
        res,
        `请确认删除：confirmText 须为「${expected}」`,
        400,
        { code: 'CONFIRM_MISMATCH' },
      )
    }

    const data = await softDeleteSeasonContent(scheme, version, phase)
    const label = scheme === 'defense' ? '防卫战' : '危局'
    const msg =
      data.action === 'already_soft_deleted'
        ? `${label} ${data.version} 第 ${data.phase} 期已是「已删除未清理」`
        : `已标记删除 ${label} ${data.version} 第 ${data.phase} 期（前台隐藏，数据保留至清理）`
    return success(res, data, msg)
  } catch (err) {
    if (/必填|须为|没有可/i.test(err.message)) {
      return fail(res, err.message || '软删除失败', 400)
    }
    return failInternal(res, err, '软删除失败')
  }
}

/** @deprecated 兼容旧前端：改为软删除 */
export async function purgeSeasonContentHandler(req, res) {
  return softDeleteSeasonContentHandler(req, res)
}

export async function restoreSeasonContentHandler(req, res) {
  try {
    const scheme = parseScheme(req.body?.scheme)
    if (!scheme) return fail(res, 'scheme 须为 defense 或 crisis', 400)
    const version = typeof req.body?.version === 'string' ? req.body.version : ''
    const phase = typeof req.body?.phase === 'string' ? req.body.phase : ''
    const confirmText =
      typeof req.body?.confirmText === 'string' ? req.body.confirmText.trim() : ''

    const expected = expectedConfirm(scheme, version, phase)
    if (confirmText !== expected) {
      return fail(
        res,
        `请确认恢复：confirmText 须为「${expected}」`,
        400,
        { code: 'CONFIRM_MISMATCH' },
      )
    }

    const data = await restoreSeasonContent(scheme, version, phase)
    const label = scheme === 'defense' ? '防卫战' : '危局'
    return success(
      res,
      data,
      `已恢复 ${label} ${data.version} 第 ${data.phase} 期（取消「已删除未清理」）`,
    )
  } catch (err) {
    if (/必填|须为|无需恢复|不在/i.test(err.message)) {
      return fail(res, err.message || '恢复失败', 400)
    }
    return failInternal(res, err, '恢复失败')
  }
}

export async function cleanupSeasonContentHandler(req, res) {
  try {
    const scheme = parseScheme(req.body?.scheme)
    if (!scheme) return fail(res, 'scheme 须为 defense 或 crisis', 400)
    const version = typeof req.body?.version === 'string' ? req.body.version : ''
    const phase = typeof req.body?.phase === 'string' ? req.body.phase : ''
    const alsoDeleteDates = req.body?.alsoDeleteDates !== false
    const confirmText =
      typeof req.body?.confirmText === 'string' ? req.body.confirmText.trim() : ''

    const expected = expectedConfirm(scheme, version, phase)
    if (confirmText !== expected) {
      return fail(
        res,
        `请确认清理：confirmText 须为「${expected}」`,
        400,
        { code: 'CONFIRM_MISMATCH' },
      )
    }

    const data = await cleanupSeasonContent(scheme, version, phase, { alsoDeleteDates })
    const label = scheme === 'defense' ? '防卫战' : '危局'
    return success(
      res,
      data,
      `已清理 ${label} ${data.version} 第 ${data.phase} 期（怪物 ${data.bossesDeleted} · Buff ${data.buffsDeleted}${alsoDeleteDates ? ` · 日期 ${data.datesDeleted}` : ''}）`,
    )
  } catch (err) {
    if (/必填|须为/i.test(err.message)) {
      return fail(res, err.message || '清理失败', 400)
    }
    return failInternal(res, err, '清理失败')
  }
}
