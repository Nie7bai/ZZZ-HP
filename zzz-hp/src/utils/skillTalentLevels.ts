import type { Skill, SkillTypeId } from '@/types/calculator'

/** 面板导入配置的五大类技能等级（连携/终结共用一档） */
export type SkillTalentLevelKey =
  | 'basic'
  | 'dodge'
  | 'assist'
  | 'special'
  | 'chainUltimate'

export type SkillTalentLevels = Record<SkillTalentLevelKey, number>

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

export function createDefaultSkillTalentLevels(
  level = DEFAULT_SKILL_TALENT_LEVEL,
): SkillTalentLevels {
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
): SkillTalentLevels {
  const base = createDefaultSkillTalentLevels()
  if (!raw) return base
  for (const key of SKILL_TALENT_LEVEL_KEYS) {
    const value = Number(raw[key])
    if (Number.isFinite(value)) base[key] = Math.max(1, Math.min(16, Math.round(value)))
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

export function resolveSkillTalentLevel(
  skillTypes: SkillTypeId[] | null | undefined,
  levels?: Partial<SkillTalentLevels> | null,
): number | null {
  const key = resolveSkillTalentLevelKey(skillTypes)
  if (!key) return null
  const filled = fillSkillTalentLevels(levels)
  return filled[key]
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
 * 结算/展示用有效基础倍率%。
 * 仅 nanoka 直伤（含锐爆）且能映射到五大类时按等级重算；否则用库内 baseMult。
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
  >,
  levels?: Partial<SkillTalentLevels> | null,
): { baseMult: number; talentLevel: number | null; talentKey: SkillTalentLevelKey | null } {
  const talentKey = resolveSkillTalentLevelKey(skill.skillTypes)
  const talentLevel = talentKey ? fillSkillTalentLevels(levels)[talentKey] : null
  const canScale =
    skill.multSource === 'nanoka' &&
    (skill.damageType === 'direct' || skill.damageType === 'sharpen') &&
    talentKey != null &&
    Number.isFinite(Number(skill.damagePercentage))

  if (canScale) {
    return {
      baseMult: computeNanokaBaseMultPercent(
        Number(skill.damagePercentage),
        Number(skill.damagePercentageGrowth) || 0,
        talentLevel ?? DEFAULT_SKILL_TALENT_LEVEL,
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
