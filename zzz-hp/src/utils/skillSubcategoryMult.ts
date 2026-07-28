import type { SkillSubcategory } from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'

export interface ResolvedSkillMults {
  directDmgMultZone: number
  /** 决算倍率区（直伤大类下的独立伤害分量） */
  settlementDmgMultZone: number
  anomalyReleaseMultZone: number
  /** 紊乱倍率区（不含持续时间补偿；与 disorderZone 中基础部分一致） */
  disorderMultZone: number
  hasPolarDisorder: boolean
}

import { multFactorPercentToRatio } from '@/utils/multFactorPercent'

function readFactor(value: number | undefined | null, fallback = 1): number {
  return multFactorPercentToRatio(value) || fallback
}

function unsetSkillMult(value: number | undefined | null): boolean {
  return !Number.isFinite(Number(value)) || Number(value) === 0
}

export function createDefaultSkillSubcategoryMults(): Pick<
  SkillSubcategory,
  | 'directDmgMult'
  | 'settlementDmgMult'
  | 'anomalyReleaseMult'
  | 'disorderMult'
  | 'directDmgMultFactor'
  | 'anomalyReleaseMultFactor'
  | 'disorderMultFactor'
> {
  return {
    directDmgMult: 100,
    settlementDmgMult: 0,
    anomalyReleaseMult: 0,
    disorderMult: 0,
    directDmgMultFactor: 100,
    anomalyReleaseMultFactor: 100,
    disorderMultFactor: 100,
  }
}

export function normalizeSkillSubcategoryMultFields(
  value: Partial<SkillSubcategory> | null | undefined,
): Pick<
  SkillSubcategory,
  | 'directDmgMult'
  | 'settlementDmgMult'
  | 'anomalyReleaseMult'
  | 'disorderMult'
  | 'directDmgMultFactor'
  | 'anomalyReleaseMultFactor'
  | 'disorderMultFactor'
> {
  const defaults = createDefaultSkillSubcategoryMults()
  if (!value || typeof value !== 'object') return defaults
  return {
    directDmgMult: Number.isFinite(Number(value.directDmgMult))
      ? Number(value.directDmgMult)
      : defaults.directDmgMult,
    settlementDmgMult: Number.isFinite(Number(value.settlementDmgMult))
      ? Number(value.settlementDmgMult)
      : defaults.settlementDmgMult,
    anomalyReleaseMult: Number.isFinite(Number(value.anomalyReleaseMult))
      ? Number(value.anomalyReleaseMult)
      : defaults.anomalyReleaseMult,
    disorderMult: Number.isFinite(Number(value.disorderMult))
      ? Number(value.disorderMult)
      : defaults.disorderMult,
    directDmgMultFactor: readFactor(value.directDmgMultFactor, 1),
    anomalyReleaseMultFactor: readFactor(value.anomalyReleaseMultFactor, 1),
    disorderMultFactor: readFactor(value.disorderMultFactor, 1),
  }
}

/**
 * 解析招式小类倍率：小类倍率（百分点）× 小类修正 × 面板倍率区 × 面板修正。
 * 异放/紊乱倍率为 0 表示未设置，回落面板 disorderBaseMult / anomalyReleaseMult。
 */
export function resolveSkillMults(
  panel: PanelStats,
  subcategory?: SkillSubcategory | null,
): ResolvedSkillMults {
  const sub = normalizeSkillSubcategoryMultFields(subcategory ?? undefined)

  const panelDirectFactor = readFactor(panel.directDmgMultFactor)
  const directDmgMultZone =
    Math.max(0, sub.directDmgMult / 100) * sub.directDmgMultFactor * panelDirectFactor
  const settlementDmgMultZone =
    Math.max(0, sub.settlementDmgMult / 100) * sub.directDmgMultFactor * panelDirectFactor

  const panelReleaseFactor = readFactor(panel.anomalyReleaseMultFactor)
  const anomalyReleaseMultZone = unsetSkillMult(sub.anomalyReleaseMult)
    ? Math.max(0, panel.anomalyReleaseMult / 100) *
        sub.anomalyReleaseMultFactor *
        panelReleaseFactor
    : Math.max(0, sub.anomalyReleaseMult / 100) *
        sub.anomalyReleaseMultFactor *
        panelReleaseFactor

  const panelDisorderFactor = readFactor(panel.disorderBaseMultFactor)
  const disorderMultZone = unsetSkillMult(sub.disorderMult)
    ? Math.max(0, panel.disorderBaseMult / 100) *
        sub.disorderMultFactor *
        panelDisorderFactor
    : Math.max(0, sub.disorderMult / 100) *
        sub.disorderMultFactor *
        panelDisorderFactor

  const hasPolarDisorder =
    !unsetSkillMult(sub.disorderMult) ||
    Math.abs(readFactor(sub.disorderMultFactor) - 1) > 1e-9

  return {
    directDmgMultZone,
    settlementDmgMultZone,
    anomalyReleaseMultZone,
    disorderMultZone,
    hasPolarDisorder,
  }
}
