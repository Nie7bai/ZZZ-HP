import {
  emptyStageBuckets,
  type EffectExecutionPlan,
  type EffectInstance,
  type EffectStage,
} from '@/types/effectSpec'
import { instantiateCollectedEffect } from '@/utils/effectAdapters'
import type { CollectedEffect } from '@/utils/panelBuffCalc'

export function compileEffectPlan(instances: EffectInstance[]): EffectExecutionPlan {
  const sorted = [...instances].sort((a, b) => a.instanceId.localeCompare(b.instanceId))
  const byStage = emptyStageBuckets()
  for (const instance of sorted) {
    byStage[instance.stage].push(instance)
  }
  const frozen: Record<EffectStage, readonly EffectInstance[]> = {
    external: Object.freeze([...byStage.external]),
    combatPreConvert: Object.freeze([...byStage.combatPreConvert]),
    convert: Object.freeze([...byStage.convert]),
    damageZone: Object.freeze([...byStage.damageZone]),
  }
  return {
    instances: Object.freeze(sorted),
    byStage: frozen,
  }
}

export function compileCollectedBuffs(collected: CollectedEffect[]): EffectExecutionPlan {
  return compileEffectPlan(collected.map(instantiateCollectedEffect))
}

export function planHasStage(plan: EffectExecutionPlan, stage: EffectStage): boolean {
  return plan.byStage[stage].length > 0
}
