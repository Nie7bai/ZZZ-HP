import type { Skill, SkillConvertFromKey, SkillTypeId } from '@/types/calculator'

/** 面板导入配置的五大类技能等级（连携/终结共用一档） */
export type SkillTalentLevelKey =
  | 'basic'
  | 'dodge'
  | 'assist'
  | 'special'
  | 'chainUltimate'

export type SkillTalentLevels = Record<SkillTalentLevelKey, number>

/** 转模来源「技能等级键」→ 五大类等级键（buffEffect.resolveConvertValue 用） */
export const SKILL_CONVERT_FROM_TO_TALENT_KEY: Record<
  SkillConvertFromKey,
  SkillTalentLevelKey
> = {
  skillLevelBasic: 'basic',
  skillLevelDodge: 'dodge',
  skillLevelAssist: 'assist',
  skillLevelSpecial: 'special',
  skillLevelChainUltimate: 'chainUltimate',
}

export function isSkillConvertFromKey(value: string): value is SkillConvertFromKey {
  return value in SKILL_CONVERT_FROM_TO_TALENT_KEY
}

export const SKILL_TALENT_LEVEL_KEYS: SkillTalentLevelKey[] = [
  'basic',
  'dodge',
  'assist',
  'special',
  'chainUltimate',
]

export const SKILL_TALENT_LEVEL_LABELS: Record<SkillTalentLevelKey, string> = {
  basic: '普通攻击',
  dodge: '闪避',
  assist: '支援攻击',
  special: '特殊技',
  chainUltimate: '连携/终结',
}

export const DEFAULT_SKILL_TALENT_LEVEL = 12

/** 影画档位对应的技能等级上下限 */
export function skillTalentLevelBoundsForRank(rank: number | null | undefined): {
  min: number
  max: number
} {
  const r = Math.max(0, Math.min(6, Math.round(Number(rank) || 0)))
  if (r >= 5) return { min: 5, max: 16 }
  if (r >= 3) return { min: 3, max: 14 }
  return { min: 1, max: 12 }
}

/** 未配置时默认取该影画档位上限 */
export function defaultSkillTalentLevelForRank(rank: number | null | undefined): number {
  return skillTalentLevelBoundsForRank(rank).max
}

export function clampSkillTalentLevel(
  level: number,
  rank: number | null | undefined,
): number {
  const { min, max } = skillTalentLevelBoundsForRank(rank)
  const n = Number(level)
  if (!Number.isFinite(n)) return max
  return Math.max(min, Math.min(max, Math.round(n)))
}

export function createDefaultSkillTalentLevels(
  rank: number | null | undefined = 0,
): SkillTalentLevels {
  const level = defaultSkillTalentLevelForRank(rank)
  return {
    basic: level,
    dodge: level,
    assist: level,
    special: level,
    chainUltimate: level,
  }
}

export function fillSkillTalentLevels(
  raw?: Partial<SkillTalentLevels> | null,
  rank: number | null | undefined = 0,
): SkillTalentLevels {
  const base = createDefaultSkillTalentLevels(rank)
  if (!raw) return base
  for (const key of SKILL_TALENT_LEVEL_KEYS) {
    const value = Number(raw[key])
    if (Number.isFinite(value)) base[key] = clampSkillTalentLevel(value, rank)
  }
  return base
}

const TYPE_TO_TALENT_KEY: Record<SkillTypeId, SkillTalentLevelKey | null> = {
  basic: 'basic',
  dodge: 'dodge',
  dash: 'dodge',
  dodgeCounter: 'dodge',
  assist: 'assist',
  special: 'special',
  specialBasic: 'special',
  specialEnhanced: 'special',
  chain: 'chainUltimate',
  ultimate: 'chainUltimate',
  followUp: null,
}

/** 按 skillTypes 顺序取第一个可映射大类；仅 followUp 等 → null（不按等级缩放） */
export function resolveSkillTalentLevelKey(
  skillTypes: SkillTypeId[] | null | undefined,
): SkillTalentLevelKey | null {
  for (const type of skillTypes ?? []) {
    const key = TYPE_TO_TALENT_KEY[type]
    if (key) return key
  }
  return null
}

/**
 * nanoka A2：baseMult(L) = (percentage + growth × (L − 1)) / 100，保留 3 位小数。
 * 与 import-nanoka-skills `computeBaseMultPercent` 一致。
 */
export function computeNanokaBaseMultPercent(
  damagePercentage: number,
  growth: number,
  level: number,
): number {
  const base = Number(damagePercentage) || 0
  const g = Number(growth) || 0
  const lv = Math.max(1, Number(level) || DEFAULT_SKILL_TALENT_LEVEL)
  const raw = (base + g * (lv - 1)) / 100
  return Math.round(raw * 1000) / 1000
}

/**
 * 招式倍率来源标注（等级公式）：如「普通攻击 Lv.16：200% + 10% × 16 = 360%」。
 * nanoka 参数缺失（非等级公式招式）或等级为空时返回 null（调用方不展示该组）。
 * 数据侧 damagePercentage 为万分比且按 L1 = base + growth 折算，因此 base = dp/100 − growth。
 */
export function buildSkillBaseMultNote(
  skill: Pick<
    Skill,
    'damagePercentage' | 'damagePercentageGrowth' | 'radianceTalentKey' | 'skillTypes'
  >,
  talentLevel: number | null | undefined,
): string | null {
  if (talentLevel == null || !Number.isFinite(Number(talentLevel))) return null
  const key = skill.radianceTalentKey ?? resolveSkillTalentLevelKey(skill.skillTypes)
  if (!key) return null
  const dp = Number(skill.damagePercentage)
  if (!Number.isFinite(dp) || dp === 0) return null
  // dp / growth 均为万分比（3120 = 31.20%），换算成百分数展示
  const growthPercent = (Number(skill.damagePercentageGrowth) || 0) / 100
  const basePercent = Math.round((dp / 100 - growthPercent) * 1000) / 1000
  const level = Math.max(1, Math.round(Number(talentLevel)))
  const total = Math.round((basePercent + growthPercent * level) * 1000) / 1000
  const label = SKILL_TALENT_LEVEL_LABELS[key]
  const growthText = growthPercent > 0 ? ` + ${growthPercent}% × ${level}` : ''
  return `招式倍率：${label} Lv.${level} → ${basePercent}%${growthText} = ${total}%`
}

/**
 * 结算/展示用有效基础倍率%。
 * 仅 nanoka 直伤（含锐爆）/ 耀变且能映射到五大类时按等级重算；否则用库内 baseMult。
 * 耀变招式用 `radianceTalentKey` 显式指定等级类别（不依赖 skillTypes，避免 buff 匹配副作用）。
 */
export function resolveEffectiveBaseMult(
  skill: Pick<
    Skill,
    | 'baseMult'
    | 'damageType'
    | 'skillTypes'
    | 'multSource'
    | 'damagePercentage'
    | 'damagePercentageGrowth'
    | 'radianceTalentKey'
  >,
  levels?: Partial<SkillTalentLevels> | null,
  rank: number | null | undefined = 0,
): { baseMult: number; talentLevel: number | null; talentKey: SkillTalentLevelKey | null } {
  const talentKey =
    skill.radianceTalentKey ?? resolveSkillTalentLevelKey(skill.skillTypes)
  const talentLevel = talentKey ? fillSkillTalentLevels(levels, rank)[talentKey] : null
  const canScale =
    skill.multSource === 'nanoka' &&
    (skill.damageType === 'direct' ||
      skill.damageType === 'sharpen' ||
      skill.damageType === 'radiance') &&
    talentKey != null &&
    Number.isFinite(Number(skill.damagePercentage))

  if (canScale) {
    return {
      baseMult: computeNanokaBaseMultPercent(
        Number(skill.damagePercentage),
        Number(skill.damagePercentageGrowth) || 0,
        talentLevel ?? defaultSkillTalentLevelForRank(rank),
      ),
      talentLevel,
      talentKey,
    }
  }

  return {
    baseMult: Number(skill.baseMult) || 0,
    talentLevel,
    talentKey,
  }
}
