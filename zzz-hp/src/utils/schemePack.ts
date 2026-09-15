/**
 * 方案包：收集引用、招式/组指纹、合并改写。
 * 不读写 localStorage；IO 在 damageCalcHistory.ts。
 */
import type { Skill, SkillGroup, SkillGroupMember } from '@/types/calculator'
import type {
  DamageCalcHistoryEntry,
  FlowEntry,
  FlowGroupMemberOverride,
  PreparedSkill,
  SchemeFolderMeta,
  SchemeStore,
} from '@/types/damageCalcHistory'
import { createCustomSkillId } from '@/utils/skillLibrary'
import { createCustomSkillGroupId, normalizeSkillGroup } from '@/utils/skillGroup'

const SCHEME_KEY_PREFIX = 's:'

function normFolder(folder: string): string {
  if (!folder) return ''
  let next = String(folder).replace(/\\/g, '/')
  if (next === '/' || next === '') return ''
  if (next[0] !== '/') next = '/' + next
  return next.replace(/\/+$/, '')
}

function schemePath(folder: string, name: string): string {
  const dir = normFolder(folder)
  const trimmed = (name || '').trim()
  if (dir === '') return '/' + trimmed
  return dir + '/' + trimmed
}

export function schemeStorageKey(folder: string, name: string): string {
  return SCHEME_KEY_PREFIX + schemePath(folder, name)
}

function schemeKeyToPath(key: string): string {
  let path = key || ''
  while (path.startsWith(SCHEME_KEY_PREFIX)) path = path.slice(SCHEME_KEY_PREFIX.length)
  return path.replace(/\/?s:\/?/g, '/')
}

function parentFolder(path: string): string {
  const i = String(path || '').lastIndexOf('/')
  if (i <= 0) return ''
  return path.slice(0, i)
}

function baseName(path: string): string {
  const i = String(path || '').lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

function stableJson(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
}

export function skillFingerprint(skill: Pick<Skill, 'name' | 'agentId' | 'element' | 'damageType' | 'skillTypes' | 'buffAnchorId' | 'baseMult' | 'settlementMult' | 'note' | 'baseMultFactor'>): string {
  const types = [...(skill.skillTypes ?? [])].map(String).sort()
  return stableJson({
    name: String(skill.name ?? '').trim(),
    agentId: String(skill.agentId ?? ''),
    element: String(skill.element ?? ''),
    damageType: String(skill.damageType ?? 'direct'),
    skillTypes: types,
    buffAnchorId: skill.buffAnchorId ?? null,
    baseMult: Number(skill.baseMult) || 0,
    baseMultFactor: Number.isFinite(Number(skill.baseMultFactor)) ? Number(skill.baseMultFactor) : null,
    settlementMult: Number.isFinite(Number(skill.settlementMult)) ? Number(skill.settlementMult) : null,
    note: String(skill.note ?? '').trim(),
  })
}

export function groupFingerprint(group: SkillGroup): string {
  const members = [...(group.members ?? [])]
    .map((item) => ({
      skillId: String(item.skillId ?? ''),
      order: Number(item.order) || 0,
      count: Number(item.count) || 1,
    }))
    .sort((a, b) => a.order - b.order || a.skillId.localeCompare(b.skillId))
  return stableJson({
    name: String(group.name ?? '').trim(),
    agentId: String(group.agentId ?? ''),
    note: String(group.note ?? '').trim(),
    members,
  })
}

export function schemeContentFingerprint(entry: DamageCalcHistoryEntry): string {
  const { id: _id, savedAt: _savedAt, order: _order, name: _name, ...rest } = entry
  return stableJson(rest)
}

export function parseSkillGroupList(raw: unknown): SkillGroup[] | null {
  if (raw == null) return []
  if (!Array.isArray(raw)) return null
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => normalizeSkillGroup(item))
    .filter((item): item is SkillGroup => item != null)
}

export function collectSchemeRefs(schemes: Record<string, DamageCalcHistoryEntry>): {
  skillIds: Set<string>
  groupIds: Set<string>
} {
  const skillIds = new Set<string>()
  const groupIds = new Set<string>()
  for (const entry of Object.values(schemes)) {
    if (!entry?.slots) continue
    for (const slot of entry.slots) {
      for (const prepared of slot.prepared ?? []) {
        const skillId = String(prepared.skillId ?? '').trim()
        const groupId = String(prepared.skillGroupId ?? '').trim()
        if (skillId) skillIds.add(skillId)
        if (groupId) groupIds.add(groupId)
        for (const member of prepared.memberAgents ?? []) {
          const memberSkillId = String(member.skillId ?? '').trim()
          if (memberSkillId) skillIds.add(memberSkillId)
        }
      }
      for (const flow of slot.flow ?? []) {
        for (const override of flow.memberOverrides ?? []) {
          const skillId = String(override.skillId ?? '').trim()
          if (skillId) skillIds.add(skillId)
        }
      }
    }
  }
  return { skillIds, groupIds }
}

export function collectExportWarnings(input: {
  schemes: Record<string, DamageCalcHistoryEntry>
  customSkills: Skill[]
  knownGroups: SkillGroup[]
}): string[] {
  const { skillIds, groupIds } = collectSchemeRefs(input.schemes)
  const customIds = new Set(input.customSkills.map((item) => item.id))
  const groupById = new Map(input.knownGroups.map((item) => [item.id, item]))
  const warnings: string[] = []
  for (const [path, entry] of Object.entries(input.schemes)) {
    const label = entry?.name || path
    for (const slot of entry?.slots ?? []) {
      for (const prepared of slot.prepared ?? []) {
        const skillId = String(prepared.skillId ?? '').trim()
        const groupId = String(prepared.skillGroupId ?? '').trim()
        if (prepared.skillSource === 'custom' && skillId && !customIds.has(skillId)) {
          warnings.push(`方案「${label}」引用自建招式 ${skillId}，本机库没有`)
        }
        if (groupId && !groupById.has(groupId)) {
          warnings.push(`方案「${label}」引用技能组 ${groupId}，本机找不到组文档`)
        }
      }
    }
  }
  for (const groupId of groupIds) {
    const group = groupById.get(groupId)
    if (!group) continue
    for (const member of group.members ?? []) {
      const skillId = String(member.skillId ?? '').trim()
      if (skillId) skillIds.add(skillId)
    }
  }
  return [...new Set(warnings)]
}

export function buildExportedSkillGroups(input: {
  customGroups: SkillGroup[]
  knownGroups: SkillGroup[]
  schemes: Record<string, DamageCalcHistoryEntry>
}): SkillGroup[] {
  const { groupIds } = collectSchemeRefs(input.schemes)
  const byId = new Map<string, SkillGroup>()
  for (const group of input.customGroups) byId.set(group.id, group)
  for (const group of input.knownGroups) {
    if (groupIds.has(group.id) && !byId.has(group.id)) byId.set(group.id, group)
  }
  return [...byId.values()]
}

function mintSkillId(used: Set<string>): string {
  let id = createCustomSkillId()
  while (used.has(id)) id = createCustomSkillId()
  used.add(id)
  return id
}

function mintGroupId(agentId: string, used: Set<string>): string {
  let id = createCustomSkillGroupId(agentId || 'all')
  let n = 0
  while (used.has(id)) {
    id = `${createCustomSkillGroupId(agentId || 'all')}-${n++}`.slice(0, 64)
  }
  used.add(id)
  return id
}

export function mergeCustomSkills(
  local: Skill[],
  incoming: Skill[],
): {
  skills: Skill[]
  idMap: Record<string, string>
  added: number
  remapped: number
  writtenIds: string[]
} {
  const idMap: Record<string, string> = {}
  const used = new Set(local.map((item) => item.id))
  const byFp = new Map<string, string>()
  const byId = new Map(local.map((item) => [item.id, item]))
  for (const skill of local) byFp.set(skillFingerprint(skill), skill.id)
  const next = [...local]
  const writtenIds: string[] = []
  let added = 0
  let remapped = 0
  for (const skill of incoming) {
    const incomingId = String(skill.id ?? '').trim()
    if (!incomingId) continue
    const fp = skillFingerprint(skill)
    const existingFpId = byFp.get(fp)
    if (existingFpId) {
      idMap[incomingId] = existingFpId
      continue
    }
    const occupant = byId.get(incomingId)
    if (occupant) {
      const newId = mintSkillId(used)
      const written = { ...skill, id: newId, source: 'custom' as const }
      next.push(written)
      byId.set(newId, written)
      byFp.set(fp, newId)
      idMap[incomingId] = newId
      writtenIds.push(newId)
      added++
      remapped++
      continue
    }
    const written = { ...skill, source: 'custom' as const }
    next.push(written)
    used.add(incomingId)
    byId.set(incomingId, written)
    byFp.set(fp, incomingId)
    idMap[incomingId] = incomingId
    writtenIds.push(incomingId)
    added++
  }
  return { skills: next, idMap, added, remapped, writtenIds }
}

function rewriteGroupMembers(group: SkillGroup, skillIdMap: Record<string, string>): SkillGroup {
  const members: SkillGroupMember[] = (group.members ?? []).map((item) => {
    const oldId = String(item.skillId ?? '')
    return { ...item, skillId: skillIdMap[oldId] || oldId }
  })
  return { ...group, members, source: 'custom' }
}

export function mergeCustomGroups(input: {
  local: SkillGroup[]
  incoming: SkillGroup[]
  skillIdMap: Record<string, string>
  presetIds: Set<string>
}): { groups: SkillGroup[]; idMap: Record<string, string>; added: number; remapped: number } {
  const idMap: Record<string, string> = {}
  const used = new Set([...input.local.map((item) => item.id), ...input.presetIds])
  const localOnly = input.local.filter((item) => !input.presetIds.has(item.id))
  const byFp = new Map<string, string>()
  const byId = new Map(localOnly.map((item) => [item.id, item]))
  for (const group of localOnly) byFp.set(groupFingerprint(group), group.id)
  for (const presetId of input.presetIds) idMap[presetId] = presetId
  const next = [...localOnly]
  let added = 0
  let remapped = 0
  for (const raw of input.incoming) {
    const incomingId = String(raw.id ?? '').trim()
    if (!incomingId) continue
    if (input.presetIds.has(incomingId)) {
      idMap[incomingId] = incomingId
      continue
    }
    const group = rewriteGroupMembers(raw, input.skillIdMap)
    const fp = groupFingerprint(group)
    const existingFpId = byFp.get(fp)
    if (existingFpId) {
      idMap[incomingId] = existingFpId
      continue
    }
    if (byId.has(incomingId) || used.has(incomingId)) {
      const newId = mintGroupId(group.agentId, used)
      const written = { ...group, id: newId, source: 'custom' as const }
      next.push(written)
      byId.set(newId, written)
      byFp.set(fp, newId)
      idMap[incomingId] = newId
      added++
      remapped++
      continue
    }
    const written = { ...group, source: 'custom' as const }
    next.push(written)
    used.add(incomingId)
    byId.set(incomingId, written)
    byFp.set(fp, incomingId)
    idMap[incomingId] = incomingId
    added++
  }
  return { groups: next, idMap, added, remapped }
}

function mapId(map: Record<string, string>, id: string | null | undefined): string {
  const raw = String(id ?? '').trim()
  if (!raw) return raw
  return map[raw] || raw
}

function rewriteMemberKey(memberKey: string | undefined, skillId: string): string {
  const order = String(memberKey ?? '').split(':')[0] || '0'
  return `${Number(order) || 0}:${skillId}`
}

function rewritePrepared(prepared: PreparedSkill, skillIdMap: Record<string, string>, groupIdMap: Record<string, string>): PreparedSkill {
  return {
    ...prepared,
    skillId: prepared.skillId ? mapId(skillIdMap, prepared.skillId) : prepared.skillId,
    skillGroupId: prepared.skillGroupId ? mapId(groupIdMap, prepared.skillGroupId) : prepared.skillGroupId,
    memberAgents: prepared.memberAgents
      ? prepared.memberAgents.map((item) => {
          const skillId = mapId(skillIdMap, item.skillId)
          return {
            ...item,
            skillId,
            memberKey: rewriteMemberKey(item.memberKey, skillId),
          }
        })
      : prepared.memberAgents,
  }
}

function rewriteOverride(
  override: FlowGroupMemberOverride,
  skillIdMap: Record<string, string>,
): FlowGroupMemberOverride {
  const skillId = mapId(skillIdMap, override.skillId)
  return {
    ...override,
    skillId,
    memberKey: rewriteMemberKey(override.memberKey, skillId),
  }
}

function rewriteFlow(flow: FlowEntry, skillIdMap: Record<string, string>): FlowEntry {
  return {
    ...flow,
    memberOverrides: flow.memberOverrides
      ? flow.memberOverrides.map((item) => rewriteOverride(item, skillIdMap))
      : flow.memberOverrides,
  }
}

export function rewriteScheme(
  entry: DamageCalcHistoryEntry,
  skillIdMap: Record<string, string>,
  groupIdMap: Record<string, string>,
): DamageCalcHistoryEntry {
  const slots = (entry.slots ?? []).map((slot) => ({
    prepared: (slot.prepared ?? []).map((item) => rewritePrepared(item, skillIdMap, groupIdMap)),
    flow: (slot.flow ?? []).map((item) => rewriteFlow(item, skillIdMap)),
  }))
  return { ...entry, slots }
}

export function uniqueSchemeName(existing: Set<string>, desired: string): string {
  if (!existing.has(desired)) return desired
  let candidate = `${desired}-复制`
  if (!existing.has(candidate)) return candidate
  let i = 2
  candidate = `${desired}-复制${i}`
  while (existing.has(candidate)) {
    i++
    candidate = `${desired}-复制${i}`
  }
  return candidate
}

export function mergeSchemeStores(input: {
  local: SchemeStore
  incomingDirs: Record<string, SchemeFolderMeta>
  incomingSchemes: Record<string, DamageCalcHistoryEntry>
  skillIdMap: Record<string, string>
  groupIdMap: Record<string, string>
}): { store: SchemeStore; added: number; renamed: number; skippedIdentical: number; skippedInvalid: number } {
  const store: SchemeStore = {
    version: input.local.version,
    dirs: { ...input.local.dirs },
    schemes: { ...input.local.schemes },
  }
  for (const [path, meta] of Object.entries(input.incomingDirs)) {
    const folder = normFolder(path)
    if (!folder) continue
    if (!store.dirs[folder]) store.dirs[folder] = meta
  }
  const namesByFolder = new Map<string, Set<string>>()
  const namesIn = (folder: string) => {
    let set = namesByFolder.get(folder)
    if (!set) {
      set = new Set(
        Object.values(store.schemes)
          .filter((item) => (item.folder || '') === folder)
          .map((item) => item.name),
      )
      namesByFolder.set(folder, set)
    }
    return set
  }
  let added = 0
  let renamed = 0
  let skippedIdentical = 0
  let skippedInvalid = 0
  for (const [rawKey, raw] of Object.entries(input.incomingSchemes)) {
    if (!raw || typeof raw !== 'object') {
      skippedInvalid++
      continue
    }
    const rewritten = rewriteScheme(raw, input.skillIdMap, input.groupIdMap)
    const path = schemeKeyToPath(rawKey)
    const folder = normFolder(rewritten.folder || parentFolder(path))
    let name = (rewritten.name || baseName(path)).trim()
    if (!name) {
      skippedInvalid++
      continue
    }
    const names = namesIn(folder)
    let key = schemeStorageKey(folder, name)
    const occupant = store.schemes[key]
    const incomingFp = schemeContentFingerprint({ ...rewritten, folder })
    const sameContent = Object.values(store.schemes).some(
      (item) => (item.folder || '') === folder && schemeContentFingerprint(item) === incomingFp,
    )
    if (sameContent) {
      skippedIdentical++
      continue
    }
    if (occupant) {
      name = uniqueSchemeName(names, name)
      key = schemeStorageKey(folder, name)
      renamed++
    }
    store.schemes[key] = {
      ...rewritten,
      id: key,
      folder,
      name,
      order: typeof rewritten.order === 'number' ? rewritten.order : 0,
    }
    names.add(name)
    added++
  }
  return { store, added, renamed, skippedIdentical, skippedInvalid }
}

export function applyOwnerGroupMap(
  skills: Skill[],
  groupIdMap: Record<string, string>,
  onlySkillIds?: Iterable<string>,
): Skill[] {
  const allow = onlySkillIds ? new Set([...onlySkillIds]) : null
  return skills.map((skill) => {
    if (allow && !allow.has(skill.id)) return skill
    const owner = skill.ownerGroupId
    if (!owner) return skill
    const mapped = groupIdMap[owner]
    if (!mapped || mapped === owner) return skill
    return { ...skill, ownerGroupId: mapped }
  })
}

export function groupsForCustomStore(groups: SkillGroup[], presetIds: Set<string>): SkillGroup[] {
  return groups
    .filter((item) => !presetIds.has(item.id))
    .map((item) => ({ ...item, source: 'custom' as const }))
}

export function countMissingCustomRefs(input: {
  schemes: Record<string, DamageCalcHistoryEntry>
  customSkills: Skill[]
  groups: SkillGroup[]
  presetGroupIds: Set<string>
}): { missingSkillCount: number; missingGroupCount: number } {
  const skillIds = new Set(input.customSkills.map((item) => item.id))
  const groupIds = new Set([...input.groups.map((item) => item.id), ...input.presetGroupIds])
  let missingSkillCount = 0
  let missingGroupCount = 0
  for (const entry of Object.values(input.schemes)) {
    for (const slot of entry.slots ?? []) {
      for (const prepared of slot.prepared ?? []) {
        const skillId = String(prepared.skillId ?? '').trim()
        const groupId = String(prepared.skillGroupId ?? '').trim()
        if (prepared.skillSource === 'custom' && skillId && !skillIds.has(skillId)) missingSkillCount++
        if (groupId && !groupIds.has(groupId)) missingGroupCount++
      }
    }
  }
  return { missingSkillCount, missingGroupCount }
}
