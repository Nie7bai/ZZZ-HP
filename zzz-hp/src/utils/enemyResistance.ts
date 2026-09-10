export type EnemyResistanceType = 'weak' | 'normal' | 'res20' | 'res40'

/** 可单独配置抗性的属性（不含流明） */
export const ENEMY_RESISTANCE_ELEMENTS = ['风', '火', '电', '物理', '以太', '冰', '霜'] as const

export type EnemyResistanceElement = (typeof ENEMY_RESISTANCE_ELEMENTS)[number]

export const RESISTANCE_VALUE_MAP: Record<EnemyResistanceType, number> = {
  weak: -0.2,
  normal: 0,
  res20: 0.2,
  res40: 0.4,
}

export const ENEMY_RESISTANCE_OPTIONS: { id: EnemyResistanceType; label: string }[] = [
  { id: 'weak', label: '有弱点（-0.2）' },
  { id: 'normal', label: '无弱点无抗性（0）' },
  { id: 'res20', label: '有抗性（0.2）' },
  { id: 'res40', label: '高抗性（0.4）' },
]

export type ElementResistanceMap = Partial<Record<EnemyResistanceElement, EnemyResistanceType>>

/** 敌方失衡易伤区默认 150% */
export const DEFAULT_ENEMY_STAGGER_MULTIPLIER = 1.5

export type EnemyBossSource = 'manual' | 'boss_info' | 'boss_record'

export interface DamageEnemyInput {
  defense: number
  /** @deprecated 兼容旧存档；未配置的属性回退到此值 */
  resistanceType?: EnemyResistanceType
  /** 按属性单独配置敌方抗性；缺省属性视为 normal */
  elementResistance?: ElementResistanceMap
  vulnerableMultiplier: number
  staggerMultiplier: number
  specialMultiplier: number
  level: number
  /** 敌方来源（选 Boss 时写入，便于展示与存档） */
  bossSource?: EnemyBossSource
  bossName?: string
  bossRecordId?: number
  bossRecordLabel?: string
  bossImage?: string | null
}

export function createDefaultElementResistance(): Record<
  EnemyResistanceElement,
  EnemyResistanceType
> {
  return {
    风: 'normal',
    火: 'normal',
    电: 'normal',
    物理: 'normal',
    以太: 'normal',
    冰: 'normal',
    霜: 'normal',
  }
}

/** 未选怪物时的默认敌方防御 */
export const DEFAULT_ENEMY_DEFENSE = 953

export function normalizeDamageEnemyInput(
  input: Partial<DamageEnemyInput> | null | undefined,
): DamageEnemyInput {
  const fallbackType = input?.resistanceType ?? 'normal'
  const base = createDefaultElementResistance()
  const merged = { ...base, ...input?.elementResistance }
  if (input?.resistanceType && !input?.elementResistance) {
    for (const el of ENEMY_RESISTANCE_ELEMENTS) {
      merged[el] = input.resistanceType
    }
  }
  return {
    defense: input?.defense ?? 0,
    resistanceType: fallbackType,
    elementResistance: merged,
    vulnerableMultiplier: input?.vulnerableMultiplier ?? 1,
    staggerMultiplier: input?.staggerMultiplier ?? DEFAULT_ENEMY_STAGGER_MULTIPLIER,
    specialMultiplier: input?.specialMultiplier ?? 1,
    level: input?.level ?? 60,
    bossSource: input?.bossSource,
    bossName: input?.bossName,
    bossRecordId: input?.bossRecordId,
    bossRecordLabel: input?.bossRecordLabel,
    bossImage: input?.bossImage,
  }
}

/** 未选怪物时的默认敌方基础参数（与计算器初始值一致） */
export function createDefaultDamageEnemyInput(): DamageEnemyInput {
  return normalizeDamageEnemyInput({
    defense: DEFAULT_ENEMY_DEFENSE,
    vulnerableMultiplier: 1,
    staggerMultiplier: DEFAULT_ENEMY_STAGGER_MULTIPLIER,
    specialMultiplier: 1,
    level: 60,
    bossSource: 'manual',
  })
}

export function isEnemyResistanceElement(
  element: string | null | undefined,
): element is EnemyResistanceElement {
  if (!element) return false
  return (ENEMY_RESISTANCE_ELEMENTS as readonly string[]).includes(element)
}

export function resolveEnemyResistanceForElement(
  enemyInput: DamageEnemyInput,
  element: string | null | undefined,
): number {
  const normalized = normalizeDamageEnemyInput(enemyInput)
  const type =
    (isEnemyResistanceElement(element)
      ? normalized.elementResistance?.[element]
      : undefined) ??
    normalized.resistanceType ??
    'normal'
  return RESISTANCE_VALUE_MAP[type]
}

export function resistanceTypeLabel(type: EnemyResistanceType): string {
  return ENEMY_RESISTANCE_OPTIONS.find((item) => item.id === type)?.label ?? type
}

export function agentElementToResistanceElement(
  element: string | null | undefined,
): EnemyResistanceElement | null {
  return isEnemyResistanceElement(element) ? element : null
}

/** 怪物库模式下仅展示有弱点或有抗性的属性 */
export function listActiveResistanceElements(
  input: DamageEnemyInput | null | undefined,
): EnemyResistanceElement[] {
  const normalized = normalizeDamageEnemyInput(input)
  return ENEMY_RESISTANCE_ELEMENTS.filter((element) => {
    const type = normalized.elementResistance?.[element] ?? 'normal'
    return type === 'weak' || type === 'res20' || type === 'res40'
  })
}

export type EnemyInputMode = 'manual' | 'database'
