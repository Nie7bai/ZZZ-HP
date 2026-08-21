export type AdminScope =
  | 'crisis-assault'
  | 'defense-old'
  | 'defense-new'
  | 'deduction'

export type AdminPanel =
  | 'monster'
  | 'monster-form'
  | 'buff-form'
  | 'season-date'
  | 'import-export'

/** 可视化编辑 Buff 时传入的槽位上下文 */
export interface AdminBuffSlotContext {
  mode: 'create' | 'edit'
  recordId?: number
  version: string
  phase: string
  buffIndex: number
  stage?: number
  roomInStage?: number
  buffName?: string
  buffText?: string
  buffImage?: string | null
  /** 计算器结构化效果块 */
  effectBlocks?: import('@/types/calculator').BuffEffectBlock[] | null
}

/** 可视化编辑怪物时传入的槽位上下文 */
export interface AdminMonsterSlotContext {
  mode: 'create' | 'edit'
  recordId?: number
  version: string
  /** 期数数字字符串，如 "1" */
  phase: string
  room?: string
  stage?: number
  roomInStage?: number
  wave?: number
  monsterCategory?: DefenseMonsterCategory
  monsterSubType?: number
  count?: number
  bossName?: string
  hp?: string | number
  defense?: string | number
  level?: string | number
  weakness?: string
  resistance?: string
  bossImage?: string | null
  crisisBaseHp?: string | number | null
  hpCoeffPercent?: string | number | null
  hpCoeffManual?: boolean
  /** 危局当期绑定的场地 Buff 套 id */
  fieldBuffSetId?: string | null
}

export type DefenseMonsterCategory = 'minion' | 'elite' | 'boss'

export type RecordScheme = 'crisis' | 'defense' | 'deduction'

export function isDefenseScope(scope: AdminScope): boolean {
  return scope === 'defense-old' || scope === 'defense-new'
}

export function isDeductionScope(scope: AdminScope): boolean {
  return scope === 'deduction'
}

export function recordSchemeFromScope(scope: AdminScope): RecordScheme | null {
  if (scope === 'crisis-assault') return 'crisis'
  if (isDefenseScope(scope)) return 'defense'
  if (scope === 'deduction') return 'deduction'
  return null
}

export const adminScopeTitles: Record<AdminScope, string> = {
  'crisis-assault': '危局强袭战',
  'defense-old': '旧·式舆防卫战',
  'defense-new': '新·式舆防卫战',
  deduction: '临界推演',
}
