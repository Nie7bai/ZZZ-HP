/** 流程伤害记录：全局一份，手点才写入。不跟方案、不跟工作草稿。 */

export const SKILL_FLOW_DAMAGE_RECORD_KEY = 'zzz-hp-skill-flow-damage-records'
export const MAX_SKILL_FLOW_DAMAGE_RECORDS = 10

export interface SkillFlowDamageRecord {
  id: string
  savedAt: number
  current: number
  team: number
  agentName: string
  schemeName: string
  /** 记录当时三人全名，按下标对齐编队 */
  agentNames: string[]
}

function isRecord(value: unknown): value is SkillFlowDamageRecord {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<SkillFlowDamageRecord>
  if (
    typeof item.id !== 'string' ||
    typeof item.savedAt !== 'number' ||
    typeof item.current !== 'number' ||
    typeof item.team !== 'number' ||
    typeof item.agentName !== 'string' ||
    typeof item.schemeName !== 'string'
  ) {
    return false
  }
  return true
}

function normalizeRecord(value: unknown): SkillFlowDamageRecord | null {
  if (!isRecord(value)) return null
  const agentNames = Array.isArray(value.agentNames)
    ? value.agentNames.map((name) => String(name ?? '').trim() || '未选')
    : value.agentName
      ? [value.agentName]
      : []
  return { ...value, agentNames }
}

export function loadSkillFlowDamageRecords(): SkillFlowDamageRecord[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(SKILL_FLOW_DAMAGE_RECORD_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeRecord).filter((item): item is SkillFlowDamageRecord => item != null).slice(0, MAX_SKILL_FLOW_DAMAGE_RECORDS)
  } catch {
    return []
  }
}

export function saveSkillFlowDamageRecords(list: SkillFlowDamageRecord[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      SKILL_FLOW_DAMAGE_RECORD_KEY,
      JSON.stringify(list.slice(0, MAX_SKILL_FLOW_DAMAGE_RECORDS)),
    )
  } catch {
    /* quota / private mode */
  }
}
