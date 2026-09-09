import type { SkillGroup, SkillGroupMember, SkillSource } from '@/types/calculator'
import type {
  FlowGroupMemberOverride,
  PreparedGroupMemberAgents,
} from '@/types/damageCalcHistory'

const CUSTOM_GROUPS_KEY = 'zzz-hp-skill-groups-custom'

/** 组成员稳定键，供流程覆盖与结算对齐 */
export function skillGroupMemberKey(member: Pick<SkillGroupMember, 'order' | 'skillId'>): string {
  return `${Number(member.order) || 0}:${String(member.skillId)}`
}

export function sortSkillGroupMembers(members: SkillGroupMember[]): SkillGroupMember[] {
  return [...members].sort(
    (a, b) => a.order - b.order || a.skillId.localeCompare(b.skillId),
  )
}

export function findMemberOverride(
  overrides: FlowGroupMemberOverride[] | null | undefined,
  member: SkillGroupMember,
): FlowGroupMemberOverride | null {
  const key = skillGroupMemberKey(member)
  return (
    (overrides ?? []).find(
      (item) =>
        item.memberKey === key ||
        (item.skillId === member.skillId && !item.memberKey),
    ) ?? null
  )
}

export function findMemberAgents(
  agents: PreparedGroupMemberAgents[] | null | undefined,
  member: SkillGroupMember,
): PreparedGroupMemberAgents | null {
  const key = skillGroupMemberKey(member)
  return (
    (agents ?? []).find(
      (item) =>
        item.memberKey === key ||
        (item.skillId === member.skillId && !item.memberKey),
    ) ?? null
  )
}

export function normalizeSkillGroup(raw: Record<string, unknown>): SkillGroup | null {
  const id = String(raw.id ?? '').trim()
  const name = String(raw.name ?? '').trim()
  if (!id || !name) return null
  const membersRaw = Array.isArray(raw.members) ? raw.members : []
  const members: SkillGroupMember[] = []
  membersRaw.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const row = item as Record<string, unknown>
    const skillId = String(row.skillId ?? '').trim()
    if (!skillId) return
    members.push({
      skillId,
      order: Number.isFinite(Number(row.order)) ? Number(row.order) : index,
      count: Math.max(0, Number(row.count) || 1),
      includeInFlow: true,
    })
  })
  const sourceRaw = String(raw.source ?? 'preset')
  const source: SkillSource = sourceRaw === 'custom' ? 'custom' : 'preset'
  return {
    id,
    agentId: String(raw.agentId ?? '').trim(),
    name,
    note: raw.note == null ? '' : String(raw.note),
    source,
    members: sortSkillGroupMembers(members),
  }
}

export function createCustomSkillGroupId(agentId: string): string {
  const stamp = Date.now().toString(36)
  const prefix = agentId || 'all'
  return `sg-custom-${prefix}-${stamp}`.slice(0, 64)
}

/** 计算页自建组：source=custom，或历史 id 前缀 */
export function isCustomSkillGroup(group: Pick<SkillGroup, 'id' | 'source'>): boolean {
  if ((group.source ?? '') === 'custom') return true
  return String(group.id ?? '').startsWith('sg-custom-')
}

export function loadCustomSkillGroups(): SkillGroup[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_GROUPS_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map(normalizeSkillGroup)
      .filter((item): item is SkillGroup => item != null)
      .map((item) => ({ ...item, source: 'custom' as const }))
  } catch {
    return []
  }
}

function saveCustomSkillGroups(list: SkillGroup[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(CUSTOM_GROUPS_KEY, JSON.stringify(list))
  } catch {
    /* 配额超限时静默 */
  }
}

export function upsertCustomSkillGroup(group: SkillGroup): SkillGroup[] {
  const normalized = normalizeSkillGroup({ ...group, source: 'custom' } as unknown as Record<string, unknown>)
  if (!normalized) return loadCustomSkillGroups()
  const next = loadCustomSkillGroups().filter((item) => item.id !== normalized.id)
  next.push({ ...normalized, source: 'custom' })
  next.sort((a, b) => a.name.localeCompare(b.name, 'zh') || a.id.localeCompare(b.id))
  saveCustomSkillGroups(next)
  return next
}

export function removeCustomSkillGroup(id: string): SkillGroup[] {
  const next = loadCustomSkillGroups().filter((item) => item.id !== id)
  saveCustomSkillGroups(next)
  return next
}

/** 流程行伤害：普通招式用 entryId；技能组用 entryId#… 子段求和。无数据返回 null。 */
export function sumHitDamagesForEntry(
  hitDamages: Record<string, number> | null | undefined,
  entryId: string,
): number | null {
  const map = hitDamages ?? {}
  if (Object.prototype.hasOwnProperty.call(map, entryId)) {
    const direct = Number(map[entryId])
    return Number.isFinite(direct) ? direct : 0
  }
  const prefix = `${entryId}#`
  let sum = 0
  let found = false
  for (const [id, value] of Object.entries(map)) {
    if (!id.startsWith(prefix)) continue
    found = true
    sum += Number(value) || 0
  }
  return found ? sum : null
}

export function hitBelongsToFlowEntry(hitId: string, entryId: string): boolean {
  return hitId === entryId || hitId.startsWith(`${entryId}#`)
}
