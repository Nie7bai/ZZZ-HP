import { fetchRuntimeZoneConfig } from '@/api/zoneSchemes'
import { BUILT_IN_ZONE_SCHEMES, type ZoneScheme } from './scheme'
import { adaptZoneSchemes } from './schemeAdapter'

/**
 * 运行时乘区方案（Phase 4e）。
 *
 * - 启动时从 `/api/calculator/zone-schemes` 拉取已启用方案（只读）；
 * - 失败/超时回落内置方案，用户端仍可正常计算；
 * - 测试可用 `setRuntimeZoneSchemes` 注入。
 */
let runtimeSchemes: ZoneScheme[] = []
let loading: Promise<void> | null = null

export function setRuntimeZoneSchemes(schemes: readonly ZoneScheme[] | null | undefined): void {
  runtimeSchemes = [...(schemes ?? [])]
}

export function getRuntimeZoneSchemes(): ZoneScheme[] {
  return runtimeSchemes
}

/** 内置方案在前、运行时方案在后；解析器按作用域/优先级合并。 */
export function getMergedZoneSchemes(): ZoneScheme[] {
  return [...BUILT_IN_ZONE_SCHEMES, ...runtimeSchemes]
}

export async function loadRuntimeZoneSchemes(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    const config = await fetchRuntimeZoneConfig()
    runtimeSchemes = adaptZoneSchemes(config) as ZoneScheme[]
  })().catch(() => {
    runtimeSchemes = []
  })
  return loading
}
