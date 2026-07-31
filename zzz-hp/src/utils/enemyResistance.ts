import type { AgentElement } from '@/utils/calculatorUi'

export type EnemyResistanceType = 'weak' | 'normal' | 'res20' | 'res40'

/** 可单独配置抗性的属性（不含流明） */
export const ENEMY_RESISTANCE_ELEMENTS = ['风', '火', '电', '物理', '以太', '冰'] as const

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
  }
}

export function normalizeDamageEnemyInput(
  input: Partial<DamageEnemyInput> | null | undefined,
): DamageEnemyInput {
  const fallbackType = input?.resistanceType ?? 'normal'
  const base = createDefaultElementResistance()
  const merged = { ...base, ...(input?.elementResistance ?? {}) }
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
    staggerMultiplier: input?.staggerMultiplier ?? 1,
    specialMultiplier: input?.specialMultiplier ?? 1,
    level: input?.level ?? 60,
  }
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
