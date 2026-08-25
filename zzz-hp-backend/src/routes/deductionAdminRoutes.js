import { Router } from 'express'
import { requireAdmin } from '../middleware/requireAdmin.js'
import {
  createDeductionBossInfo,
  createDeductionNode,
  createDeductionPeriod,
  deleteDeductionNode,
  deleteDeductionPeriod,
  listDeductionNodes,
  listDeductionPeriods,
  listPickBosses,
  listPickBuffs,
  listPickBuffTemplates,
  listShiyuMinions,
  renameDeductionPeriod,
  reorderDeductionNodes,
  updateDeductionNode,
} from '../services/deductionAdminService.js'
import { importNanokaSimulPeriods } from '../services/nanokaSimulImportService.js'
import { success, fail } from '../utils/response.js'

const router = Router()

router.use(requireAdmin)

// 从 nanoka 拉取 simul 更新临界推演（整期刷新，保留期数名与已回填图片）
router.post('/import/nanoka', async (req, res) => {
  try {
    const { simulIds = 'all', locale = 'zh', phase = '1', dryRun = false, buildTag = null } =
      req.body ?? {}
    const data = await importNanokaSimulPeriods({
      simulIds,
      locale,
      phase,
      dryRun: Boolean(dryRun),
      buildTag,
    })
    const message = data.dryRun ? 'nanoka 临界数据解析完成（未写入）' : 'nanoka 临界推演更新完成'
    return success(res, data, message, data.dryRun ? 200 : 201)
  } catch (err) {
    fail(res, err.message || 'nanoka 临界导入失败', 500)
  }
})

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

router.get('/picker/buff-templates', async (_req, res) => {
  try {
    success(res, await listPickBuffTemplates())
  } catch (err) {
    fail(res, err.message || '获取 Buff 模板失败', 500)
  }
})

// 小怪数据源（本地式舆防卫战小怪，供推演前战层编辑）
router.get('/picker/shiyu-minions', async (_req, res) => {
  try {
    success(res, await listShiyuMinions())
  } catch (err) {
    fail(res, err.message || '获取防卫战小怪数据源失败', 500)
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

// 整期节点重排
router.put('/periods/:version/reorder', async (req, res) => {
  try {
    success(res, await reorderDeductionNodes(req.params.version, req.body?.nodeIds))
  } catch (err) {
    fail(res, err.message || '节点排序失败', 400)
  }
})

// 前战(小怪)怪物：仅登记 boss_info 基础库
router.post('/boss-info', async (req, res) => {
  try {
    success(res, await createDeductionBossInfo(req.body ?? {}), '已登记怪物基础库')
  } catch (err) {
    fail(res, err.message || '登记怪物基础库失败', 400)
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
