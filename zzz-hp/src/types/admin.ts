export type AdminScope =
  | 'crisis-assault'
  | 'defense-old'
  | 'defense-new'
  | 'deduction'

export type AdminPanel =
  | 'monster'
  | 'delete-monster'
  | 'buff'
  | 'delete-buff'
  | 'season-date'

export type DefenseMonsterCategory = 'minion' | 'elite' | 'boss'

export type RecordScheme = 'crisis' | 'defense'

export function isDefenseScope(scope: AdminScope): boolean {
  return scope === 'defense-old' || scope === 'defense-new'
}

export function recordSchemeFromScope(scope: AdminScope): RecordScheme | null {
  if (scope === 'crisis-assault') return 'crisis'
  if (isDefenseScope(scope)) return 'defense'
  return null
}

export const adminScopeTitles: Record<AdminScope, string> = {
  'crisis-assault': '危局强袭战',
  'defense-old': '旧·式舆防卫战',
  'defense-new': '新·式舆防卫战',
  deduction: '临界推演',
}
