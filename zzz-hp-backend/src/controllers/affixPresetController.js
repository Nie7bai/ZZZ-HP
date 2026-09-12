import {
  deleteAffixPresetEntry,
  deleteAffixPresetGroup,
  listAffixPreset,
  replaceAffixPreset,
  upsertAffixPresetEntry,
  upsertAffixPresetGroup,
} from '../services/affixPresetService.js'
import { fail, failInternal, success } from '../utils/response.js'

/**
 * 官方预设词条库：读公开、写需管理员。
 *
 * `target` 的强校验在前端（`isAffixLibraryEntryTarget`，那份字段表是唯一事实来源）；
 * 后端只拦明显不属于该命名空间的值 —— 两端都写死一份完整字段表迟早会分叉。
 */
const TARGET_PREFIXES = ['stat:', 'panel:']

function normalizeEntryPayload(body = {}) {
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  const target = typeof body.target === 'string' ? body.target.trim() : ''
  const perRoll = Number(body.perRoll)
  const cap = Number(body.cap ?? 0)
  const group = typeof body.group === 'string' ? body.group.trim() : ''
  const rollCost = Number(body.rollCost ?? 1)
  const sortOrder = Number(body.sortOrder ?? 0)

  if (!id) return { error: '条目 ID 为必填项' }
  if (id.length > 64) return { error: '条目 ID 过长（≤64）' }
  if (!label) return { error: '名称为必填项' }
  if (!target) return { error: '目标为必填项' }
  if (!TARGET_PREFIXES.some((prefix) => target.startsWith(prefix))) {
    return { error: `目标须以 ${TARGET_PREFIXES.join(' 或 ')} 开头` }
  }
  if (!Number.isFinite(perRoll) || perRoll <= 0) return { error: '每档数值须为正数' }
  if (!Number.isFinite(cap) || cap < 0) return { error: '上限须为非负数（0 = 不限）' }
  if (!Number.isFinite(rollCost) || rollCost < 0) return { error: '每档占用须为非负数' }

  return {
    id,
    label,
    target,
    perRoll,
    cap: Math.trunc(cap),
    group,
    rollCost: Math.trunc(rollCost),
    enabledByDefault: Boolean(body.enabledByDefault),
    sortOrder: Number.isFinite(sortOrder) ? Math.trunc(sortOrder) : 0,
  }
}

function normalizeGroupPayload(body = {}) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const cap = Number(body.cap ?? 0)
  const sortOrder = Number(body.sortOrder ?? 0)
  if (!name) return { error: '分组名为必填项' }
  if (name.length > 64) return { error: '分组名过长（≤64）' }
  if (!Number.isFinite(cap) || cap < 0) return { error: '组额度须为非负数（0 = 不限）' }
  return { name, cap: Math.trunc(cap), sortOrder: Number.isFinite(sortOrder) ? Math.trunc(sortOrder) : 0 }
}

export async function getAffixPreset(_req, res) {
  try {
    return success(res, await listAffixPreset())
  } catch (err) {
    return failInternal(res, err, '获取官方预设词条库失败')
  }
}

export async function saveAffixPresetEntry(req, res) {
  const payload = normalizeEntryPayload(req.body)
  if (payload.error) return fail(res, payload.error, 400)
  try {
    return success(res, await upsertAffixPresetEntry(payload), '条目已保存')
  } catch (err) {
    return failInternal(res, err, '保存词条失败')
  }
}

export async function removeAffixPresetEntry(req, res) {
  const id = String(req.params.id ?? '').trim()
  if (!id) return fail(res, '缺少条目 ID', 400)
  try {
    const result = await deleteAffixPresetEntry(id)
    if (!result.deleted) return fail(res, '条目不存在', 404)
    return success(res, result, '条目已删除')
  } catch (err) {
    return failInternal(res, err, '删除词条失败')
  }
}

export async function saveAffixPresetGroup(req, res) {
  const payload = normalizeGroupPayload(req.body)
  if (payload.error) return fail(res, payload.error, 400)
  try {
    return success(res, await upsertAffixPresetGroup(payload), '分组已保存')
  } catch (err) {
    return failInternal(res, err, '保存分组失败')
  }
}

export async function removeAffixPresetGroup(req, res) {
  const name = decodeURIComponent(String(req.params.name ?? '')).trim()
  if (!name) return fail(res, '缺少分组名', 400)
  try {
    const result = await deleteAffixPresetGroup(name)
    if (!result.deleted) return fail(res, '分组不存在', 404)
    return success(res, result, '分组已删除')
  } catch (err) {
    return failInternal(res, err, '删除分组失败')
  }
}

/** 整份替换（灌种子 / 管理端导入）—— 覆盖式，事务保证不留半份数据 */
export async function replaceAffixPresetHandler(req, res) {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : null
  const groups = Array.isArray(req.body?.groups) ? req.body.groups : null
  if (!entries || !groups) return fail(res, '需要 entries 与 groups 两个数组', 400)
  for (const [index, entry] of entries.entries()) {
    const payload = normalizeEntryPayload(entry)
    if (payload.error) return fail(res, `第 ${index + 1} 条：${payload.error}`, 400)
  }
  for (const [index, group] of groups.entries()) {
    const payload = normalizeGroupPayload(group)
    if (payload.error) return fail(res, `第 ${index + 1} 个分组：${payload.error}`, 400)
  }
  try {
    const data = await replaceAffixPreset({ entries, groups })
    return success(res, data, `已替换为 ${data.entries.length} 条 / ${data.groups.length} 组`)
  } catch (err) {
    return failInternal(res, err, '替换官方预设词条库失败')
  }
}
