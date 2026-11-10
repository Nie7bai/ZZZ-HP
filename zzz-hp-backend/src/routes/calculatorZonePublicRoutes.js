import { Router } from 'express'
import { listRuntimeDamageChains } from '../services/calculatorChainService.js'
import { listZoneDefinitions, listZoneSchemes } from '../services/calculatorZoneService.js'
import { failInternal, success } from '../utils/response.js'

/**
 * 乘区方案 / 计算链路公共只读接口（Phase 4e / 4f）。
 *
 * 用户端计算器需要读取“已启用”的乘区定义、方案与计算链路；这里只暴露运行时必要字段：
 * - 定义：zoneKey / label / sortOrder / appliesTo / providers / primitive / params / stats / display / version
 * - 方案：id / scope / targetId / name / priority / version / rules
 * - 链路：id / chainKey / label / appliesTo / scope / targetId / priority / version / stages
 *
 * 不暴露 updatedBy / updatedAt 等管理信息，`enabled` 只用于过滤；写操作只在 `/api/admin/calculator`。
 */
const router = Router()

router.get('/zone-schemes', async (_req, res) => {
  try {
    const [definitions, schemes] = await Promise.all([
      listZoneDefinitions({ enabled: true }),
      listZoneSchemes({ enabled: true }),
    ])
    return success(res, {
      version: 1,
      definitions: definitions.map((definition) => ({
        zoneKey: definition.zoneKey,
        label: definition.label,
        sortOrder: definition.sortOrder,
        appliesTo: definition.appliesTo,
        providers: definition.providers,
        primitive: definition.primitive,
        params: definition.params,
        stats: definition.stats,
        display: definition.display,
        version: definition.version,
      })),
      schemes: schemes.map((scheme) => ({
        id: scheme.id,
        scope: scheme.scope,
        targetId: scheme.targetId,
        name: scheme.name,
        priority: scheme.priority,
        version: scheme.version,
        rules: scheme.rules,
      })),
    })
  } catch (err) {
    return failInternal(res, err, '获取乘区方案失败')
  }
})

/** 计算链路：只返回 enabled，payload 形如 `{ version: 1, chains: [...] }` */
router.get('/damage-chains', async (_req, res) => {
  try {
    const data = await listRuntimeDamageChains()
    return success(res, data)
  } catch (err) {
    return failInternal(res, err, '获取计算链路失败')
  }
})

export default router
