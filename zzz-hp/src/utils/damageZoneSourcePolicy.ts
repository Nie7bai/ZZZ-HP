import type { AnomalyDamageSubKind, DamageCalcKind } from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'

/** 与 dual-agent-rules.md 一致。`computeDamageResult` 用本表选面板，公式本身不动。 */
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

export interface DamageZonePanels {
  owner: PanelStats
  powerProvider: PanelStats
  anomalyTrigger: PanelStats
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

export function pickZonePanel(
  panels: DamageZonePanels,
  zone: DamageZoneId,
  damageKind: DamageCalcKind | AnomalyDamageSubKind | string,
): PanelStats {
  return panels[zoneSourceRole(zone, damageKind)]
}

/**
 * 防御区混拼：穿透按表（直伤 owner / 异常 powerProvider）；
 * 减防/无视始终读 `anomalyTrigger` 这份面板。
 *
 * 表上「直伤减防 = owner」只在未传触发者面板（与 owner 同一引用）时成立。
 * 旧 `computeDamageResult` 的 mainParts 已是这种混拼，阶段 4 保持，不改数字。
 */
export function composeDefensePanel(
  panels: DamageZonePanels,
  damageKind: DamageCalcKind | AnomalyDamageSubKind | string,
): Pick<PanelStats, 'penRate' | 'pen' | 'ignoreDefense' | 'reduceDefense'> {
  const penPanel = pickZonePanel(panels, 'penRate', damageKind)
  const reducePanel = panels.anomalyTrigger
  return {
    penRate: penPanel.penRate,
    pen: penPanel.pen,
    ignoreDefense: reducePanel.ignoreDefense,
    reduceDefense: reducePanel.reduceDefense,
  }
}

/**
 * 抗穿选取。异常且调用方没传触发者面板时，旧引擎回落强度提供者，不是 owner。
 */
export function pickResPenPanel(
  panels: DamageZonePanels,
  damageKind: DamageCalcKind | AnomalyDamageSubKind | string,
  anomalyTriggerProvided: boolean,
): PanelStats {
  if (isAnomalyCalcKind(damageKind) && !anomalyTriggerProvided) {
    return panels.powerProvider
  }
  return pickZonePanel(panels, 'resPen', damageKind)
}
