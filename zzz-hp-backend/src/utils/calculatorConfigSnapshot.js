/**
 * 乘区定义 / 乘区方案 / 计算链路：快照结构（导出与导入共用一份口径）。
 *
 * 字段口径对齐公共只读接口（`src/routes/calculatorZonePublicRoutes.js`），
 * 额外带 `enabled`：公共接口只返回启用行，而快照要能整份还原，
 * 否则禁用行导入后会被默认值重新启用。管理字段（`updatedBy` / `updatedAt` /
 * 自增 `id`）不入快照：导入按唯一键 upsert，id 由库重新分配。
 *
 * 这里的函数都是纯函数，不读写库，便于脚本与用例直接复用。
 */

/** 快照里的三块键；顺序即导入顺序（定义必须先于方案，方案里的自定义键要能查到） */
export const ZONE_CONFIG_SNAPSHOT_KEYS = Object.freeze([
  'zoneDefinitions',
  'zoneSchemes',
  'damageChains',
])

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 乘区定义：按 `zone_key` 唯一 */
export function toZoneDefinitionSnapshot(definition) {
  return {
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
    enabled: definition.enabled,
  }
}

/** 乘区方案：按 `scope + target_id` 唯一 */
export function toZoneSchemeSnapshot(scheme) {
  return {
    scope: scheme.scope,
    targetId: scheme.targetId,
    name: scheme.name,
    priority: scheme.priority,
    enabled: scheme.enabled,
    version: scheme.version,
    rules: scheme.rules,
  }
}

/** 计算链路：按 `chain_key + scope + target_id` 唯一 */
export function toDamageChainSnapshot(chain) {
  return {
    chainKey: chain.chainKey,
    label: chain.label,
    appliesTo: chain.appliesTo,
    scope: chain.scope,
    targetId: chain.targetId,
    priority: chain.priority,
    enabled: chain.enabled,
    version: chain.version,
    stages: chain.stages,
  }
}

/** 组装导出用的三块键；空数组照常输出，避免下游缺键 */
export function buildZoneConfigSnapshot({ definitions = [], schemes = [], chains = [] } = {}) {
  return {
    zoneDefinitions: (definitions ?? []).map(toZoneDefinitionSnapshot),
    zoneSchemes: (schemes ?? []).map(toZoneSchemeSnapshot),
    damageChains: (chains ?? []).map(toDamageChainSnapshot),
  }
}

/**
 * 读快照里的三块键（旧包没有这些键时返回空数组且 `present` 为 false）。
 * `present` 供导入脚本区分「包里有这一块（哪怕是空数组）」与「旧包没有」：
 * 前者在 `--replace` 下允许清表，后者一律跳过、不动库。
 */
export function readZoneConfigSnapshot(source) {
  const data = isPlainObject(source) ? source : {}
  const read = (key) =>
    Array.isArray(data[key]) ? data[key].filter((item) => isPlainObject(item)) : []
  const present = {}
  for (const key of ZONE_CONFIG_SNAPSHOT_KEYS) present[key] = Array.isArray(data[key])
  return {
    present,
    zoneDefinitions: read('zoneDefinitions'),
    zoneSchemes: read('zoneSchemes'),
    damageChains: read('damageChains'),
  }
}
