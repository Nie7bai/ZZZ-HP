import { listCalculatorBuffs, upsertAgent, upsertBangboo, upsertDriveDisc, upsertWengine } from './calculatorBuffService.js'
import { listDamageEventModes, upsertDamageEventMode } from './damageEventModeService.js'
import { listSkills, upsertSkill } from './skillLibraryService.js'
import { listFollowUpSkillRules, listSkillSubcategories, upsertFollowUpSkillRule, upsertSkillSubcategory } from './skillSubcategoryService.js'

const SNAPSHOT_KEYS = [
  'agents',
  'wengines',
  'bangboos',
  'driveDiscs',
  'skillSubcategories',
  'followUpSkillRules',
  'damageEventModes',
  'skills',
]

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function itemId(item) {
  return String(item?.id ?? '').trim()
}

export async function exportCalculatorBuffSnapshot() {
  const data = await listCalculatorBuffs()
  const [damageEventModes, skills] = await Promise.all([listDamageEventModes(), listSkills()])
  return {
    exportedAt: new Date().toISOString(),
    agents: data.agents,
    wengines: data.wengines,
    bangboos: data.bangboos,
    driveDiscs: data.driveDiscs,
    skillSubcategories: data.skillSubcategories ?? [],
    followUpSkillRules: data.followUpSkillRules ?? [],
    damageEventModes,
    skills,
  }
}

export function coerceCalculatorBuffSnapshot(raw) {
  if (raw == null) throw new Error('文件内容为空')
  if (Array.isArray(raw)) {
    throw new Error('请使用对象格式的增益快照，而不是数组')
  }
  if (typeof raw !== 'object') throw new Error('JSON 须为对象')

  const hasKnownKey = SNAPSHOT_KEYS.some((key) => Array.isArray(raw[key]))
  if (hasKnownKey) return raw

  const doc = raw
  if (!itemId(doc)) {
    throw new Error(
      '无法识别的增益 JSON。请使用本页导出的快照，或包含 agents / wengines 等字段的对象。',
    )
  }

  if (Array.isArray(doc.mindscapeBuffs) || doc.basePanel) return { agents: [doc] }
  if (doc.twoPieceMods || doc.fourPieceBuffs || doc.twoPieceNote != null || doc.fourPieceNote != null) {
    return { driveDiscs: [doc] }
  }
  if (doc.baseAtk != null || doc.advancedStats || doc.refinementBuffs || doc.fixedBuffs) {
    return { wengines: [doc] }
  }
  if (doc.fixedMods || doc.refinementMods) return { bangboos: [doc] }
  if (doc.categoryId && doc.name && doc.agentId != null && doc.countsAsFollowUp != null) {
    return { skillSubcategories: [doc] }
  }
  if (Array.isArray(doc.events) || doc.modeType) return { damageEventModes: [doc] }
  if (doc.damageType != null && (doc.baseMult != null || doc.skillTypes)) return { skills: [doc] }
  if (doc.agentId && doc.categoryId) return { followUpSkillRules: [doc] }
  if (doc.profession || doc.element) return { agents: [doc] }

  throw new Error('无法识别的单条增益 JSON，请改用完整快照文件。')
}

function emptyTypeResult() {
  return { created: 0, updated: 0, skipped: 0, errors: [] }
}

async function importDocs(items, existingIds, upsertFn) {
  const result = emptyTypeResult()
  for (const item of items) {
    const id = itemId(item)
    if (!id) {
      result.skipped += 1
      continue
    }
    try {
      await upsertFn(item)
      if (existingIds.has(id)) result.updated += 1
      else result.created += 1
    } catch (err) {
      result.errors.push({
        id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return result
}

export async function importCalculatorBuffSnapshot(raw) {
  const snapshot = coerceCalculatorBuffSnapshot(raw)
  const current = await exportCalculatorBuffSnapshot()
  const idSet = (list) => new Set(asArray(list).map(itemId).filter(Boolean))

  const summary = {
    agents: emptyTypeResult(),
    wengines: emptyTypeResult(),
    bangboos: emptyTypeResult(),
    driveDiscs: emptyTypeResult(),
    skillSubcategories: emptyTypeResult(),
    followUpSkillRules: emptyTypeResult(),
    damageEventModes: emptyTypeResult(),
    skills: emptyTypeResult(),
  }

  if (Array.isArray(snapshot.agents)) {
    summary.agents = await importDocs(snapshot.agents, idSet(current.agents), upsertAgent)
  }
  if (Array.isArray(snapshot.wengines)) {
    summary.wengines = await importDocs(snapshot.wengines, idSet(current.wengines), upsertWengine)
  }
  if (Array.isArray(snapshot.bangboos)) {
    summary.bangboos = await importDocs(snapshot.bangboos, idSet(current.bangboos), upsertBangboo)
  }
  if (Array.isArray(snapshot.driveDiscs)) {
    summary.driveDiscs = await importDocs(
      snapshot.driveDiscs,
      idSet(current.driveDiscs),
      upsertDriveDisc,
    )
  }
  if (Array.isArray(snapshot.skillSubcategories)) {
    summary.skillSubcategories = await importDocs(
      snapshot.skillSubcategories,
      idSet(current.skillSubcategories),
      upsertSkillSubcategory,
    )
  }
  if (Array.isArray(snapshot.followUpSkillRules)) {
    summary.followUpSkillRules = await importDocs(
      snapshot.followUpSkillRules,
      idSet(current.followUpSkillRules),
      upsertFollowUpSkillRule,
    )
  }
  if (Array.isArray(snapshot.damageEventModes)) {
    summary.damageEventModes = await importDocs(
      snapshot.damageEventModes,
      idSet(current.damageEventModes),
      upsertDamageEventMode,
    )
  }
  if (Array.isArray(snapshot.skills)) {
    summary.skills = await importDocs(snapshot.skills, idSet(current.skills), upsertSkill)
  }

  const hasAny =
    SNAPSHOT_KEYS.some((key) => Array.isArray(snapshot[key]) && snapshot[key].length > 0)
  if (!hasAny) {
    throw new Error('文件中没有可导入的增益条目')
  }

  return summary
}
