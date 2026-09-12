import type {
  AgentBuffDoc,
  BuffEffect,
  SkillDamageType,
  SkillSubcategory,
} from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import { collectEffectsFromPack, getEffectSkillTargets } from '@/utils/buffEffect'
import {
  defaultAnomalyMultByElement,
  defaultDisorderStats,
  defaultTurbulenceStats,
} from '@/utils/calculatorUi'
import { multFactorPercentToRatio } from '@/utils/multFactorPercent'

export interface ResolvedSkillMults {
  directDmgMultZone: number
  /** 决算倍率区（直伤大类下的独立伤害分量） */
  settlementDmgMultZone: number
  anomalyReleaseMultZone: number
  /** 紊乱倍率区（不含持续时间补偿；与 disorderZone 中基础部分一致） */
  disorderMultZone: number
  hasPolarDisorder: boolean
}

function readFactor(value: number | undefined | null, fallback = 1): number {
  return multFactorPercentToRatio(value) || fallback
}

export function unsetSkillMult(value: number | undefined | null): boolean {
  return !Number.isFinite(Number(value)) || Number(value) === 0
}

/** 伤害类型 → 招式限定 Buff 上常见的倍率 stat */
function skillMultStatForDamageType(
  damageType: SkillDamageType,
): BuffEffect['stat'] | null {
  switch (damageType) {
    case 'direct':
      return 'directDmgMult'
    case 'anomaly':
      return 'anomalyMult'
    case 'anomalyRelease':
      return 'anomalyReleaseMult'
    case 'disorder':
      return 'disorderBaseMult'
    case 'turbulence':
      return 'turbulenceBaseMult'
    case 'radiance':
      return 'radianceMult'
    default:
      return null
  }
}

/** 招式填写倍率为 0 时，增益锚点小类表字段能提供的对应倍率% */
export function resolveAnchorSkillMultPercent(
  damageType: SkillDamageType,
  subcategory: SkillSubcategory | null | undefined,
): number | null {
  if (!subcategory) return null
  const sub = normalizeSkillSubcategoryMultFields(subcategory)
  switch (damageType) {
    case 'direct':
      return unsetSkillMult(sub.directDmgMult) ? null : sub.directDmgMult
    case 'anomalyRelease':
      return unsetSkillMult(sub.anomalyReleaseMult) ? null : sub.anomalyReleaseMult
    case 'disorder':
      return unsetSkillMult(sub.disorderMult) ? null : sub.disorderMult
    // 属性异常 / 乱流 / 耀变：小类表无对应字段
    default:
      return null
  }
}

/**
 * 蕾米埃尔等：倍率录在「限定某锚点」的角色 Buff 上（如 radianceMult + skillTargets），
 * 不在小类表字段里。按锚点从角色影画/效果块里取固有倍率%。
 */
export function resolveAnchorSkillBoundMultPercent(options: {
  damageType: SkillDamageType
  buffAnchorId?: string | null
  subcategory?: SkillSubcategory | null
  agent?: AgentBuffDoc | null
}): number | null {
  const anchorId = options.buffAnchorId?.trim()
  const agent = options.agent
  const stat = skillMultStatForDamageType(options.damageType)
  if (!anchorId || !agent || !stat) return null

  const anchorCategory = options.subcategory?.categoryId ?? null
  let best: number | null = null

  for (const pack of agent.mindscapeBuffs ?? []) {
    for (const effect of collectEffectsFromPack(pack)) {
      if (effect.stat !== stat) continue
      if (effect.scope !== 'skill') continue
      const value = Number(effect.value)
      if (unsetSkillMult(value)) continue
      const targets = getEffectSkillTargets(effect)
      const hit = targets.some((target) => {
        if (target.subcategoryId) return target.subcategoryId === anchorId
        // 整大类限定：锚点所属大类一致才算挂上
        return Boolean(anchorCategory) && target.category === anchorCategory
      })
      if (!hit) continue
      best = best == null ? value : Math.max(best, value)
    }
  }
  return best
}

/** 展示用：小类表固有 → 角色招式限定 Buff 固有 */
export function resolveDisplayedAnchorMultPercent(options: {
  damageType: SkillDamageType
  buffAnchorId?: string | null
  subcategory?: SkillSubcategory | null
  agent?: AgentBuffDoc | null
}): number | null {
  const fromSub = resolveAnchorSkillMultPercent(options.damageType, options.subcategory)
  if (fromSub != null) return fromSub
  return resolveAnchorSkillBoundMultPercent(options)
}

/**
 * 展示/回填用固有倍率%：小类表 → 招式限定 Buff → 属性默认（异常/紊乱/乱流）。
 * 异放无固有时返回 null（等属性转模）。
 */
export function resolveInherentSkillMultPercent(options: {
  damageType: SkillDamageType
  buffAnchorId?: string | null
  subcategory?: SkillSubcategory | null
  agent?: AgentBuffDoc | null
  /** 公共属性异常等：招式自带元素，优先于角色元素 */
  element?: string | null
}): number | null {
  const fromAnchor = resolveDisplayedAnchorMultPercent(options)
  if (fromAnchor != null) return fromAnchor

  const element = (options.element || options.agent?.element || '').trim()
  const agentKey = options.agent?.id || options.agent?.name || ''

  switch (options.damageType) {
    case 'anomaly': {
      const value = defaultAnomalyMultByElement(element)
      return unsetSkillMult(value) ? null : value
    }
    case 'disorder': {
      const value = defaultDisorderStats(element, agentKey).disorderBaseMult
      return unsetSkillMult(value) ? null : value
    }
    case 'turbulence': {
      const value = defaultTurbulenceStats(element, agentKey).turbulenceBaseMult
      return unsetSkillMult(value) ? null : value
    }
    default:
      return null
  }
}

/**
 * 未填写、锚点也无固有倍率时，是否依赖异常强度提供者属性（异放转模等）。
 * 此类展示「待选择 / 等待选择异常强度提供者」，不展示「面板」。
 */
export function skillMultNeedsAnomalyPowerProvider(damageType: SkillDamageType): boolean {
  return damageType === 'anomalyRelease'
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
 * 招式倍率覆写并入小类：只合并「倍率%」数值，不合并倍率修正。
 * 招式 baseMultFactor 只应写到面板一侧；若同时写入小类，resolveSkillMults
 * 会再乘 panelFactor，造成同一修正平方。
 */
export function mergeSkillSubcategoryMultOverrides(
  sub: SkillSubcategory,
  overrides: {
    directDmgMult?: number | null
    settlementDmgMult?: number | null
    directDmgMultFactor?: number | null
    anomalyReleaseMult?: number | null
    anomalyReleaseMultFactor?: number | null
    disorderBaseMult?: number | null
    disorderBaseMultFactor?: number | null
  },
): SkillSubcategory {
  return {
    ...sub,
    directDmgMult: overrides.directDmgMult ?? sub.directDmgMult,
    settlementDmgMult: overrides.settlementDmgMult ?? sub.settlementDmgMult,
    anomalyReleaseMult: overrides.anomalyReleaseMult ?? sub.anomalyReleaseMult,
    disorderMult: overrides.disorderBaseMult ?? sub.disorderMult,
  }
}

/**
 * 解析招式小类倍率：小类倍率（百分点）× 小类修正 × 面板倍率区 × 面板修正。
 * 直伤 / 异放 / 紊乱倍率为 0 表示未设置，回落对应面板字段。
 * 增益锚点小类经常把 directDmgMult 留空，不回落的话直伤区会变成 0、主行不出伤害。
 */
export function resolveSkillMults(
  panel: PanelStats,
  subcategory?: SkillSubcategory | null,
): ResolvedSkillMults {
  const sub = normalizeSkillSubcategoryMultFields(subcategory ?? undefined)

  const panelDirectFactor = readFactor(panel.directDmgMultFactor)
  const directMult = unsetSkillMult(sub.directDmgMult)
    ? panel.directDmgMult
    : sub.directDmgMult
  const directDmgMultZone =
    Math.max(0, directMult / 100) * sub.directDmgMultFactor * panelDirectFactor
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
