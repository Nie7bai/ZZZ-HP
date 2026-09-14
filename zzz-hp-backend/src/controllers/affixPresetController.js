import {
  createAffixPresetScheme,
  deleteAffixPresetScheme,
  listAffixPreset,
  listAffixSchemes,
  renameAffixPresetScheme,
  replaceAffixPreset,
} from '../services/affixPresetService.js'
import { buildAffixEffectTemplate, parseAffixEffectTemplate } from '../utils/affixEffectTemplate.js'
import { fail, failInternal, success } from '../utils/response.js'

/**
 * 官方预设词条库：读公开、写需管理员。
 *
 * 写入权威是 `effect_json`。列 `target` 仍 NOT NULL，值从模板 `legacyTarget` 派生，
 * 不再当独立编辑字段。只交旧 `target` 时仍编模板（兼容迁移器）。
 * 前缀闸门只拦明显不属于 `panel:` / `gain:` 的值 —— 完整字段表在前端。
 *
 * 写入口四个：整份替换一套方案、新建方案、重命名方案、删除方案。
 * 「改一条」这种粒度在管理页是**草稿 + 保存**（保存＝整份替换），所以没有逐条写接口 ——
 * 留着就是死接口，也会让「保存」出现半份中间状态。
 *
 * `gain:`（增益字段，2026-09-13 步骤 58）是局内落点：词条贡献按**增益口径**在转模之后
 * 施加（因而能被转模的 `panelSource: 'final'` 侧读到）。这里必须放行，否则管理页存不进去。
 */
const TARGET_PREFIXES = ['panel:', 'gain:']

function readOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function normalizeEntryPayload(body = {}) {
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  const perRoll = Number(body.perRoll)
  const cap = Number(body.cap ?? 0)
  const group = typeof body.group === 'string' ? body.group.trim() : ''
  const rollCost = Number(body.rollCost ?? 1)
  const sortOrder = Number(body.sortOrder ?? 0)

  if (!id) return { error: '条目 ID 为必填项' }
  if (id.length > 64) return { error: '条目 ID 过长（≤64）' }
  if (!label) return { error: '名称为必填项' }
  if (!Number.isFinite(perRoll) || perRoll <= 0) return { error: '每档数值须为正数' }
  if (!Number.isFinite(cap) || cap < 0) return { error: '上限须为非负数（0 = 不限）' }
  if (!Number.isFinite(rollCost) || rollCost < 0) return { error: '每档占用须为非负数' }

  const parsedTemplate = parseAffixEffectTemplate(
    body.effectJson && typeof body.effectJson === 'object' && !Array.isArray(body.effectJson)
      ? body.effectJson
      : undefined,
  )
  const targetFromBody = typeof body.target === 'string' ? body.target.trim() : ''
  const target = parsedTemplate?.legacyTarget || targetFromBody
  if (!target) return { error: '效果模板或目标为必填项' }
  if (!TARGET_PREFIXES.some((prefix) => target.startsWith(prefix))) {
    return { error: `目标须以 ${TARGET_PREFIXES.join(' 或 ')} 开头` }
  }

  const applySituation = readOptionalString(body.applySituation)
  const scope = readOptionalString(body.scope)
  const skillCategory = readOptionalString(body.skillCategory)
  const skillSubcategoryId =
    body.skillSubcategoryId === null ? null : readOptionalString(body.skillSubcategoryId)
  const appliesToAnomaly =
    typeof body.appliesToAnomaly === 'boolean' ? body.appliesToAnomaly : undefined
  const effectJson =
    parsedTemplate ??
    buildAffixEffectTemplate({
      target,
      applySituation,
      scope,
      skillCategory,
      skillSubcategoryId,
      appliesToAnomaly,
    })
  if (!effectJson) return { error: '无法编出效果模板' }

  return {
    id,
    label,
    target: effectJson.legacyTarget,
    perRoll,
    cap: Math.trunc(cap),
    group,
    rollCost: Math.trunc(rollCost),
    enabledByDefault: Boolean(body.enabledByDefault),
    sortOrder: Number.isFinite(sortOrder) ? Math.trunc(sortOrder) : 0,
    ...(applySituation ? { applySituation } : {}),
    ...(scope ? { scope } : {}),
    ...(skillCategory ? { skillCategory } : {}),
    ...(skillSubcategoryId !== undefined ? { skillSubcategoryId } : {}),
    ...(appliesToAnomaly !== undefined ? { appliesToAnomaly } : {}),
    effectJson,
  }
}

function normalizeGroupPayload(body = {}) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const cap = Number(body.cap ?? 0)
  const sortOrder = Number(body.sortOrder ?? 0)
  if (!name) return { error: '分组名为必填项' }
  if (name.length > 64) return { error: '分组名过长（≤64）' }
  if (!Number.isFinite(cap) || cap < 0) return { error: '组额度须为非负数（0 = 不限）' }
  return {
    name,
    cap: Math.trunc(cap),
    sortOrder: Number.isFinite(sortOrder) ? Math.trunc(sortOrder) : 0,
  }
}

/** 读：不带 `scheme` 回默认方案；两种情况下都把方案清单一起带上（管理页要画 chip） */
export async function getAffixPreset(req, res) {
  try {
    const [snapshot, schemes] = await Promise.all([
      listAffixPreset(req.query?.scheme),
      listAffixSchemes(),
    ])
    return success(res, { ...snapshot, schemes })
  } catch (err) {
    return failInternal(res, err, '获取官方预设词条库失败')
  }
}

/**
 * 整份替换（管理页「保存」）—— 只覆盖请求里那一套方案，其他方案不受影响。
 *
 * 排序值必须唯一（用户 2026-09-13「不允许重复保存」）：这里先给出**指明第几条**的
 * 友好报错；service 里还有一道闸门兜底（脚本等不经控制器的调用方也挡）。
 */
export async function replaceAffixPresetHandler(req, res) {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : null
  const groups = Array.isArray(req.body?.groups) ? req.body.groups : null
  if (!entries || !groups) return fail(res, '需要 entries 与 groups 两个数组', 400)
  const normalizedEntries = []
  const entryOrderSeen = new Map()
  for (const [index, entry] of entries.entries()) {
    const payload = normalizeEntryPayload(entry)
    if (payload.error) return fail(res, `第 ${index + 1} 条：${payload.error}`, 400)
    const seenAt = entryOrderSeen.get(payload.sortOrder)
    if (seenAt !== undefined) {
      return fail(
        res,
        `第 ${index + 1} 条：排序值 ${payload.sortOrder} 与第 ${seenAt} 条重复（同一套方案里排序值必须唯一）`,
        400,
      )
    }
    entryOrderSeen.set(payload.sortOrder, index + 1)
    normalizedEntries.push(payload)
  }
  const normalizedGroups = []
  const groupOrderSeen = new Map()
  for (const [index, group] of groups.entries()) {
    const payload = normalizeGroupPayload(group)
    if (payload.error) return fail(res, `第 ${index + 1} 个分组：${payload.error}`, 400)
    const seenAt = groupOrderSeen.get(payload.sortOrder)
    if (seenAt !== undefined) {
      return fail(
        res,
        `第 ${index + 1} 个分组：排序值 ${payload.sortOrder} 与第 ${seenAt} 个分组重复（同一套方案里排序值必须唯一）`,
        400,
      )
    }
    groupOrderSeen.set(payload.sortOrder, index + 1)
    normalizedGroups.push(payload)
  }
  try {
    const data = await replaceAffixPreset({
      scheme: req.body?.scheme,
      entries: normalizedEntries,
      groups: normalizedGroups,
    })
    const schemes = await listAffixSchemes()
    return success(
      res,
      { ...data, schemes },
      `已保存「${data.scheme}」：${data.entries.length} 条 / ${data.groups.length} 组`,
    )
  } catch (err) {
    // service 闸门抛出的排序值重复按 400 回（上面的循环正常应先拦下，这里是兜底）
    const message = err instanceof Error ? err.message : ''
    if (/排序值重复/.test(message)) return fail(res, message, 400)
    return failInternal(res, err, '保存官方预设词条库失败')
  }
}

/** 新建方案：`{ name, copyFrom? }`；`copyFrom` 给了就整份复制那套方案 */
export async function createAffixPresetSchemeHandler(req, res) {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const copyFrom = typeof req.body?.copyFrom === 'string' ? req.body.copyFrom.trim() : ''
  if (!name) return fail(res, '方案名为必填项', 400)
  try {
    const created = await createAffixPresetScheme({ name, copyFrom })
    const schemes = await listAffixSchemes()
    return success(
      res,
      { ...created, schemes },
      created.copiedFrom
        ? `已新建方案「${created.name}」（复制自「${created.copiedFrom}」：${created.entryCount} 条 / ${created.groupCount} 组）`
        : `已新建空方案「${created.name}」`,
    )
  } catch (err) {
    // 重名 / 源方案不存在这类是用户输入问题，按 400 回；其余按 500
    const message = err instanceof Error ? err.message : '新建方案失败'
    if (/已有同名方案|不存在|必填|过长/.test(message)) return fail(res, message, 400)
    return failInternal(res, err, '新建方案失败')
  }
}

/** 重命名方案（默认方案也能改：读取侧按 is_default 判默认，不看名字） */
export async function renameAffixPresetSchemeHandler(req, res) {
  const name = decodeURIComponent(String(req.params.name ?? '')).trim()
  const newName = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (!name) return fail(res, '缺少方案名', 400)
  if (!newName) return fail(res, '新方案名为必填项', 400)
  try {
    const renamed = await renameAffixPresetScheme(name, newName)
    const schemes = await listAffixSchemes()
    return success(res, { ...renamed, schemes }, `已重命名方案「${renamed.renamedFrom}」→「${renamed.name}」`)
  } catch (err) {
    // 校验类错误（不存在 / 撞名 / 同名 / 过长 / 必填）按 400 回；其余按 500
    const message = err instanceof Error ? err.message : '重命名方案失败'
    if (/不存在|已有同名方案|必填|过长|相同|缺少方案名/.test(message)) return fail(res, message, 400)
    return failInternal(res, err, '重命名方案失败')
  }
}

/** 删除方案（默认方案不许删） */
export async function removeAffixPresetScheme(req, res) {
  const name = decodeURIComponent(String(req.params.name ?? '')).trim()
  if (!name) return fail(res, '缺少方案名', 400)
  try {
    const result = await deleteAffixPresetScheme(name)
    const schemes = await listAffixSchemes()
    return success(res, { ...result, schemes }, `已删除方案「${name}」`)
  } catch (err) {
    const message = err instanceof Error ? err.message : '删除方案失败'
    if (/默认方案不能删除|不存在|缺少方案名/.test(message)) return fail(res, message, 400)
    return failInternal(res, err, '删除方案失败')
  }
}
