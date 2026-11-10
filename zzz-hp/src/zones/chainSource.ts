import { fetchRuntimeDamageChains } from '@/api/damageChains'
import {
  BUILT_IN_DAMAGE_CHAINS,
  registerRuntimeDamageChains,
  resolveDamageChain,
  resolveDamageChainId,
  type DamageChainDefinition,
  type DamageChainResolveContext,
  type ResolvedDamageChain,
} from './pipeline'
import { adaptDamageChains } from './chainAdapter'

/**
 * 运行时计算链路（Phase 4f）。
 *
 * - 启动时从 `/api/calculator/damage-chains` 拉取已启用链路（只读）；
 * - 失败/超时回落内置链路，用户端仍可正常计算；
 * - 测试可用 `setRuntimeDamageChains` 注入。
 */
let runtimeChains: DamageChainDefinition[] = []
let loading: Promise<void> | null = null

export function setRuntimeDamageChains(chains: readonly DamageChainDefinition[] | null | undefined): void {
  runtimeChains = [...(chains ?? [])]
  registerRuntimeDamageChains(runtimeChains)
}

export function getRuntimeDamageChains(): DamageChainDefinition[] {
  return runtimeChains
}

/** 内置链路在前、运行时链路在后；解析器按作用域/优先级合并。 */
export function getMergedDamageChains(): DamageChainDefinition[] {
  return [...BUILT_IN_DAMAGE_CHAINS, ...runtimeChains]
}

/** 链路展示名：运行时覆盖优先，其次内置，最后回落到 null（调用方给默认名）。 */
export function getDamageChainLabel(chainId: string | null | undefined): string | null {
  if (!chainId) return null
  const chains = getMergedDamageChains()
  for (let index = chains.length - 1; index >= 0; index -= 1) {
    const chain = chains[index]
    if (chain && chain.id === chainId && chain.label) return chain.label
  }
  return null
}

/** 按伤害类型选链路并解析（内置 + 运行时覆盖） */
export function resolveCurrentDamageChain(options: {
  damageKind: string
  isSelfRadiance?: boolean
  baseDamageSource?: string | null
  context?: Omit<DamageChainResolveContext, 'damageKind' | 'baseDamageSource'>
  chains?: readonly DamageChainDefinition[]
}): ResolvedDamageChain {
  const chainId = resolveDamageChainId({
    damageKind: options.damageKind,
    isSelfRadiance: options.isSelfRadiance,
    baseDamageSource: options.baseDamageSource,
  })
  return resolveDamageChain(
    chainId,
    { ...options.context, damageKind: options.damageKind, baseDamageSource: options.baseDamageSource },
    options.chains ?? getMergedDamageChains(),
  )
}

export async function loadRuntimeDamageChains(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    const config = await fetchRuntimeDamageChains()
    setRuntimeDamageChains(adaptDamageChains(config))
  })().catch(() => {
    setRuntimeDamageChains([])
  })
  return loading
}
