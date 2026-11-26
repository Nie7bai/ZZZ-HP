import { Router } from 'express'
import { requireAdmin } from '../middleware/requireAdmin.js'
import {
  deleteZoneDefinition,
  deleteZoneScheme,
  getZoneDefinition,
  getZoneScheme,
  listZoneDefinitions,
  listZoneSchemes,
  upsertZoneDefinition,
  upsertZoneScheme,
} from '../services/calculatorZoneService.js'
import { fail, failInternal, success } from '../utils/response.js'

/**
 * 乘区定义 / 乘区方案（管理端）。
 *
 * 全部接口 `requireAdmin`：乘区方案决定计算口径，用户侧只读计算器结果，
 * 不提供任何匿名读写入口（与方案文档 Phase 4「只允许管理端调用」一致）。
 *
 * 提供两种写路径：
 * - POST：按唯一键 upsert（定义按 zone_key，方案按 scope+target_id），管理端「保存」用；
 * - PUT：同一套校验，语义上明确是覆盖保存（定义按 body.zone_key，方案按路径 :id）。
 */

const router = Router()

router.use(requireAdmin)

/** 业务错误（校验 400 / 不存在 404 / 冲突 409）走 fail，其余归为 500 */
function handleError(res, err, fallbackMessage) {
  const status = Number(err?.status)
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    const data = err?.code ? { code: err.code } : null
    if (data && err?.details && typeof err.details === 'object') {
      Object.assign(data, err.details)
    }
    return fail(res, err.message || fallbackMessage, status, data)
  }
  return failInternal(res, err, fallbackMessage)
}

// ---- 乘区定义 ----

router.get('/zone-definitions', async (req, res) => {
  try {
    const data = await listZoneDefinitions({
      enabled: req.query.enabled,
      primitive: req.query.primitive,
    })
    return success(res, data)
  } catch (err) {
    return handleError(res, err, '获取乘区定义失败')
  }
})

router.get('/zone-definitions/:zoneKey', async (req, res) => {
  try {
    const definition = await getZoneDefinition(req.params.zoneKey)
    if (!definition) return fail(res, '乘区定义不存在', 404, { code: 'ZONE_DEFINITION_NOT_FOUND' })
    return success(res, definition)
  } catch (err) {
    return handleError(res, err, '获取乘区定义失败')
  }
})

router.post('/zone-definitions', async (req, res) => {
  try {
    const { created, definition } = await upsertZoneDefinition(req.body ?? {})
    return success(
      res,
      definition,
      created ? '已创建乘区定义' : '已更新乘区定义',
      created ? 201 : 200,
    )
  } catch (err) {
    return handleError(res, err, '保存乘区定义失败')
  }
})

router.put('/zone-definitions', async (req, res) => {
  try {
    const { created, definition } = await upsertZoneDefinition(req.body ?? {})
    return success(
      res,
      definition,
      created ? '已创建乘区定义' : '已更新乘区定义',
      created ? 201 : 200,
    )
  } catch (err) {
    return handleError(res, err, '保存乘区定义失败')
  }
})

router.delete('/zone-definitions/:zoneKey', async (req, res) => {
  try {
    const data = await deleteZoneDefinition(req.params.zoneKey)
    return success(res, data, '已删除乘区定义')
  } catch (err) {
    return handleError(res, err, '删除乘区定义失败')
  }
})

// ---- 乘区方案 ----

router.get('/zone-schemes', async (req, res) => {
  try {
    const data = await listZoneSchemes({
      scope: req.query.scope,
      targetId: req.query.targetId ?? req.query.target_id,
      enabled: req.query.enabled,
    })
    return success(res, data)
  } catch (err) {
    return handleError(res, err, '获取乘区方案失败')
  }
})

router.get('/zone-schemes/:id', async (req, res) => {
  try {
    const scheme = await getZoneScheme(req.params.id)
    if (!scheme) return fail(res, '乘区方案不存在', 404, { code: 'ZONE_SCHEME_NOT_FOUND' })
    return success(res, scheme)
  } catch (err) {
    return handleError(res, err, '获取乘区方案失败')
  }
})

router.post('/zone-schemes', async (req, res) => {
  try {
    const { created, scheme } = await upsertZoneScheme(req.body ?? {})
    return success(res, scheme, created ? '已创建乘区方案' : '已更新乘区方案', created ? 201 : 200)
  } catch (err) {
    return handleError(res, err, '保存乘区方案失败')
  }
})

router.put('/zone-schemes/:id', async (req, res) => {
  try {
    const { created, scheme } = await upsertZoneScheme({ ...(req.body ?? {}), id: req.params.id })
    return success(res, scheme, created ? '已创建乘区方案' : '已更新乘区方案', created ? 201 : 200)
  } catch (err) {
    return handleError(res, err, '保存乘区方案失败')
  }
})

router.delete('/zone-schemes/:id', async (req, res) => {
  try {
    const data = await deleteZoneScheme(req.params.id)
    return success(res, data, '已删除乘区方案')
  } catch (err) {
    return handleError(res, err, '删除乘区方案失败')
  }
})

export default router
