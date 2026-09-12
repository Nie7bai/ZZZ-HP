/** 敌方防御常用档位 */
export const ENEMY_DEFENSE_PRESETS = [477, 953, 1588] as const

/** 失衡易伤区（基础）常用档位 */
export const STAGGER_MULTIPLIER_PRESETS = [1, 1.25, 1.5, 1.8, 2.1] as const

export type EnemyDefensePreset = (typeof ENEMY_DEFENSE_PRESETS)[number] | 'custom'
export type StaggerMultiplierPreset = (typeof STAGGER_MULTIPLIER_PRESETS)[number] | 'custom'

