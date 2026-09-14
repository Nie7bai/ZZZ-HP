import type { AnomalyDamageSubKind, DamageCalcKind } from '@/types/calculator'

/** 与 dual-agent-rules.md 一致。phase 3 只锁表；phase 4 才改 damageCalc 读取。 */
export type DamageActorRole = 'owner' | 'powerProvider' | 'anomalyTrigger'

export type DamageZoneId =
  | 'baseAtk'
  | 'dmgBonus'
  | 'penRate'
  | 'pen'
  | 'mastery'
  | 'resPen'
  | 'reduceDefense'
  | 'anomalyTypeBonus'
  | 'anomalyCrit'
  | 'element'

export interface DamageActorRoles {
  owner: string
  powerProvider: string
  anomalyTrigger: string
}

const ANOMALY_KINDS = new Set<string>([
  'anomaly',
  'disorder',
  'turbulence',
  'anomalyRelease',
  'radiance',
])

export function isAnomalyCalcKind(
  damageKind: DamageCalcKind | AnomalyDamageSubKind | string,
): boolean {
  return damageKind !== 'direct' && damageKind !== 'sharpen' && ANOMALY_KINDS.has(String(damageKind))
}

/**
 * 乘区 → 角色身份。直伤全部 owner。
 * 异常：攻击/通用增伤/精通/穿透 → powerProvider；
 * 抗穿/类型增伤/异常暴击/减防 → anomalyTrigger；
 * 元素（查表用）→ powerProvider。
 */
export const DAMAGE_ZONE_SOURCE_POLICY: Record<
  DamageZoneId,
  { direct: DamageActorRole; anomaly: DamageActorRole }
> = {
  baseAtk: { direct: 'owner', anomaly: 'powerProvider' },
  dmgBonus: { direct: 'owner', anomaly: 'powerProvider' },
  penRate: { direct: 'owner', anomaly: 'powerProvider' },
  pen: { direct: 'owner', anomaly: 'powerProvider' },
  mastery: { direct: 'owner', anomaly: 'powerProvider' },
  resPen: { direct: 'owner', anomaly: 'anomalyTrigger' },
  reduceDefense: { direct: 'owner', anomaly: 'anomalyTrigger' },
  anomalyTypeBonus: { direct: 'owner', anomaly: 'anomalyTrigger' },
  anomalyCrit: { direct: 'owner', anomaly: 'anomalyTrigger' },
  element: { direct: 'owner', anomaly: 'powerProvider' },
}

export function zoneSourceRole(
  zone: DamageZoneId,
  damageKind: DamageCalcKind | AnomalyDamageSubKind | string,
): DamageActorRole {
  const row = DAMAGE_ZONE_SOURCE_POLICY[zone]
  return isAnomalyCalcKind(damageKind) ? row.anomaly : row.direct
}

export function pickActorId(
  roles: DamageActorRoles,
  zone: DamageZoneId,
  damageKind: DamageCalcKind | AnomalyDamageSubKind | string,
): string {
  return roles[zoneSourceRole(zone, damageKind)]
}
