import { Router } from 'express'
import { requireAdmin } from '../middleware/requireAdmin.js'
import {
  createDeductionNode,
  createDeductionPeriod,
  deleteDeductionNode,
  deleteDeductionPeriod,
  listDeductionNodes,
  listDeductionPeriods,
  listPickBosses,
  listPickBuffs,
  listShiyuMinions,
  renameDeductionPeriod,
  updateDeductionNode,
} from '../services/deductionAdminService.js'
import { success, fail } from '../utils/response.js'

const router = Router()

router.use(requireAdmin)

// 下拉数据源（全局去重）
router.get('/picker/bosses', async (_req, res) => {
  try {
    success(res, await listPickBosses())
  } catch (err) {
    fail(res, err.message || '获取 Boss 数据源失败', 500)
  }
})

router.get('/picker/buffs', async (_req, res) => {
  try {
    success(res, await listPickBuffs())
  } catch (err) {
    fail(res, err.message || '获取 Buff 数据源失败', 500)
  }
})

// 小怪数据源（shiyu 防卫战怪物名单，供推演非 STAGE 小怪层编辑使用）
router.get('/picker/shiyu-minions', async (_req, res) => {
  try {
    success(res, await listShiyuMinions())
  } catch (err) {
    fail(res, err.message || '获取 shiyu 小怪数据源失败', 500)
  }
})

// 期数
router.get('/periods', async (_req, res) => {
  try {
    success(res, await listDeductionPeriods())
  } catch (err) {
    fail(res, err.message || '获取推演期数失败', 500)
  }
})

router.post('/periods', async (req, res) => {
  try {
    success(res, await createDeductionPeriod(req.body ?? {}), '已创建期数', 201)
  } catch (err) {
    fail(res, err.message || '创建期数失败', 400)
  }
})

router.put('/periods/:version', async (req, res) => {
  try {
    success(res, await renameDeductionPeriod(req.params.version, req.body?.periodName))
  } catch (err) {
    fail(res, err.message || '修改期数名失败', 400)
  }
})

router.delete('/periods/:version', async (req, res) => {
  try {
    success(res, await deleteDeductionPeriod(req.params.version))
  } catch (err) {
    fail(res, err.message || '删除期数失败', 400)
  }
})

// 节点
router.get('/periods/:version/nodes', async (req, res) => {
  try {
    success(res, await listDeductionNodes(req.params.version))
  } catch (err) {
    fail(res, err.message || '获取节点失败', 500)
  }
})

router.post('/periods/:version/nodes', async (req, res) => {
  try {
    success(res, await createDeductionNode(req.params.version, req.body ?? {}), '已创建节点', 201)
  } catch (err) {
    fail(res, err.message || '创建节点失败', 400)
  }
})

router.put('/nodes/:id', async (req, res) => {
  try {
    success(res, await updateDeductionNode(req.params.id, req.body ?? {}))
  } catch (err) {
    fail(res, err.message || '更新节点失败', 400)
  }
})

router.delete('/nodes/:id', async (req, res) => {
  try {
    success(res, await deleteDeductionNode(req.params.id))
  } catch (err) {
    fail(res, err.message || '删除节点失败', 400)
  }
})

export default router
