import { fetchRuntimeZoneConfig } from '@/api/zoneSchemes'
import { registerCustomBuffStatZones } from '@/utils/buffStatZones'
import { getRuntimeDamageChains } from './chainSource'
import { BUILT_IN_ZONE_SCHEMES, type ZoneScheme } from './scheme'
import { adaptZoneSchemes, type RemoteZoneDefinition } from './schemeAdapter'

/**
 * 运行时乘区方案（Phase 4e）。
 *
 * - 启动时从 `/api/calculator/zone-schemes` 拉取已启用方案（只读）；
 * - 失败/超时回落内置方案，用户端仍可正常计算；
 * - 定义表里 `stats` 登记的增益键同时注册为管理端「属性」下拉的自定义乘区；
 * - 测试可用 `setRuntimeZoneSchemes` / `setRuntimeZoneDefinitions` 注入。
 */
let runtimeSchemes: ZoneScheme[] = []
let runtimeDefinitions: RemoteZoneDefinition[] = []
let loading: Promise<void> | null = null

export function setRuntimeZoneSchemes(schemes: readonly ZoneScheme[] | null | undefined): void {
  runtimeSchemes = [...(schemes ?? [])]
}

export function getRuntimeZoneSchemes(): ZoneScheme[] {
  return runtimeSchemes
}

/** 公共接口返回的乘区定义（含 `stats` 增益键登记），供管理端与测试读取 */
export function getRuntimeZoneDefinitions(): RemoteZoneDefinition[] {
  return runtimeDefinitions
}

/**
 * 把定义表 `stats` 里登记的增益键转成「属性」下拉项。
 * `stats` 形如 `[{ key, label, valueType, sign }]`；脏数据（非对象 / 无 key）跳过。
 */
function customStatZoneInputsOf(
  definitions: readonly RemoteZoneDefinition[],
): Array<{ key: string; label: string | null }> {
  const inputs: Array<{ key: string; label: string | null }> = []
  for (const definition of definitions) {
    const stats = definition?.stats
    if (!Array.isArray(stats)) continue
    for (const stat of stats) {
      if (!stat || typeof stat !== 'object') continue
      const entry = stat as Record<string, unknown>
      const key = typeof entry.key === 'string' ? entry.key.trim() : ''
      if (!key) continue
      inputs.push({
        key,
        label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : null,
      })
    }
  }
  return inputs
}

/** 保存运行时定义并注册其 `stats` 为自定义 Buff 属性（幂等） */
export function setRuntimeZoneDefinitions(
  definitions: readonly RemoteZoneDefinition[] | null | undefined,
): void {
  runtimeDefinitions = [...(definitions ?? [])]
  registerCustomBuffStatZones(customStatZoneInputsOf(runtimeDefinitions))
}

export function getMergedZoneSchemes(): ZoneScheme[] {
  return [...BUILT_IN_ZONE_SCHEMES, ...runtimeSchemes]
}

export interface RuntimeConfigVersions {
  /** 运行时方案里的最高发布版本；没有任何运行时方案时为 undefined（纯内置口径） */
  zoneSchemeVersion?: number
  /** 运行时链路的发布版本（`chainId → version`）；内置链路不记录 */
  damageChainVersions: Record<string, number>
}

/**
 * 当前运行时配置版本（方案 + 链路），供方案保存时留痕。
 * 只读取已加载的运行时数据，不触发请求、不影响计算。
 */
export function getRuntimeConfigVersions(): RuntimeConfigVersions {
  const schemeVersions = runtimeSchemes
    .map((scheme) => scheme.version)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const damageChainVersions: Record<string, number> = {}
  for (const chain of getRuntimeDamageChains()) {
    if (typeof chain.version === 'number' && Number.isFinite(chain.version)) {
      damageChainVersions[chain.id] = chain.version
    }
  }
  return {
    zoneSchemeVersion: schemeVersions.length ? Math.max(...schemeVersions) : undefined,
    damageChainVersions,
  }
}

export async function loadRuntimeZoneSchemes(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    const config = await fetchRuntimeZoneConfig()
    runtimeSchemes = adaptZoneSchemes(config) as ZoneScheme[]
    setRuntimeZoneDefinitions(config?.definitions ?? [])
  })().catch(() => {
    // 失败只回退运行时数据；内置方案与内置属性目录不受影响
    runtimeSchemes = []
    runtimeDefinitions = []
  })
  return loading
}
