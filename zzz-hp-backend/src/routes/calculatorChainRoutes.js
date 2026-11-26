import { Router } from 'express'
import { requireAdmin } from '../middleware/requireAdmin.js'
import {
  deleteDamageChain,
  getDamageChain,
  listDamageChains,
  upsertDamageChain,
} from '../services/calculatorChainService.js'
import { fail, failInternal, success } from '../utils/response.js'

/**
 * 计算链路（Damage Chain）管理端 CRUD（Phase 4f）。
 *
 * 全部接口 `requireAdmin`：链路的阶段顺序直接决定结算口径，用户端只读计算器结果，
 * 不提供任何匿名读写入口（与乘区定义/方案同一口径）。
 *
 * 写路径语义：
 * - POST：按 UNIQUE(chain_key, scope, target_id) upsert，管理端「保存」用；
 * - PUT `/:id`：同一套校验，语义上明确是覆盖保存（body 是整条链路）。
 * 删除只放开 `custom:*`；内置链路请改用 enabled=false。
 */

const router = Router()

router.use(requireAdmin)

/** 业务错误（校验 400 / 不存在 404 / 冲突 409）走 fail，其余归为 500 */
function handleError(res, err, fallbackMessage) {
  const status = Number(err?.status)
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return fail(res, err.message || fallbackMessage, status, err?.code ? { code: err.code } : null)
  }
  return failInternal(res, err, fallbackMessage)
}

router.get('/damage-chains', async (req, res) => {
  try {
    const data = await listDamageChains({
      chainKey: req.query.chainKey ?? req.query.chain_key,
      scope: req.query.scope,
      targetId: req.query.targetId ?? req.query.target_id,
      enabled: req.query.enabled,
    })
    return success(res, data)
  } catch (err) {
    return handleError(res, err, '获取计算链路失败')
  }
})

router.get('/damage-chains/:id', async (req, res) => {
  try {
    const chain = await getDamageChain(req.params.id)
    if (!chain) return fail(res, '计算链路不存在', 404, { code: 'DAMAGE_CHAIN_NOT_FOUND' })
    return success(res, chain)
  } catch (err) {
    return handleError(res, err, '获取计算链路失败')
  }
})

router.post('/damage-chains', async (req, res) => {
  try {
    const { created, chain } = await upsertDamageChain(req.body ?? {})
    return success(res, chain, created ? '已创建计算链路' : '已更新计算链路', created ? 201 : 200)
  } catch (err) {
    return handleError(res, err, '保存计算链路失败')
  }
})

router.put('/damage-chains/:id', async (req, res) => {
  try {
    const { chain } = await upsertDamageChain({ ...(req.body ?? {}), id: req.params.id })
    return success(res, chain, '已更新计算链路')
  } catch (err) {
    return handleError(res, err, '保存计算链路失败')
  }
})

router.delete('/damage-chains/:id', async (req, res) => {
  try {
    const data = await deleteDamageChain(req.params.id)
    return success(res, data, '已删除计算链路')
  } catch (err) {
    return handleError(res, err, '删除计算链路失败')
  }
})

export default router
