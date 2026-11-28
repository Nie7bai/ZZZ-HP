<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  DAMAGE_CHAIN_SCOPES,
  DAMAGE_CHAIN_SCOPE_LABELS,
  fetchDamageChains,
  isAdminDamageChainAuthError,
  type DamageChainDoc,
  type DamageChainScope,
} from '@/api/adminDamageChains'
import {
  fetchZoneSchemes,
  type ZoneSchemeDoc,
  type ZoneSchemeRule,
} from '@/api/adminZones'
import { clearAdminAuthenticated } from '@/utils/adminAuth'
import {
  BUILT_IN_DAMAGE_CHAINS,
  STAGE_KIND_LABELS,
  getDamageChain,
  resolveDamageChain,
  resolveDamageChainId,
  type DamageChainDefinition,
  type StageDefinition,
} from '@/zones/pipeline'
import { adaptDamageChain } from '@/zones/chainAdapter'
import { mergeSchemeStagesIntoChain, schemeEntriesToStages } from '@/zones/chainDisplay'
import { getDamageChainLabel, resolveCurrentDamageChain } from '@/zones/chainSource'
import { resolveBaseDamageSourceForProfession } from '@/utils/damageCalc'
import { skillCalcZoneGroup } from '@/utils/skillCalcZones'
import {
  BUILT_IN_ZONE_SCHEMES,
  buildZoneResolvedContext,
  evaluateZoneCondition,
  type ZoneCondition,
  type ZoneScope,
} from '@/zones/scheme'
import { DAMAGE_CHAIN_SAMPLE_HITS, previewDamageChain, type DamageChainPreview } from '@/zones/preview'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import '@/components/admin/calculator/adminCalculatorPanel.css'

/**
 * 管理端 → 角色计算器 → 计算链路（只读展示）。
 *
 * 列出全部链路（代码内置 + 数据库里的作用域覆盖），选中一条查看它的乘区顺序；
 * 不提供新建 / 编辑 / 删除 / 排序等写操作 —— 链路内容由代码与数据库维护，
 * 本面板只回答「这条链路有哪些乘区、按什么顺序」。
 *
 * 作用域筛选（二级多选）：先选作用域层级（全局 / 职业 / 角色 / 技能组 / 招式，可多选），
 * 选了「角色」或「招式」后出现第二级目标多选（角色 / 招式 id），用于只看对特定角色
 * 或特定角色招式生效的链路；「全局」没有后续层级。
 */

const router = useRouter()
const calculatorBuffStore = useCalculatorBuffStore()

const chains = ref<DamageChainDoc[]>([])
const loading = ref(false)
const error = ref('')
const authDialogVisible = ref(false)

/** 选中行：`builtin:<id>` / `db:<id>` */
const selectedRowKey = ref('')

const previewResult = ref<DamageChainPreview | null>(null)
const previewError = ref('')
const previewSampleId = ref(DAMAGE_CHAIN_SAMPLE_HITS[0]!.id)

// ---- 作用域筛选（一级：层级多选；二级：角色；三级：该角色的技能组 / 招式） ----

const scopeFilter = ref<DamageChainScope[]>([])
/** 二级：角色多选（agent / skill_group / skill 三个层级共用） */
const agentFilter = ref<string[]>([])
const skillGroupFilter = ref<string[]>([])
const skillFilter = ref<string[]>([])

const scopeOptions = computed(() =>
  DAMAGE_CHAIN_SCOPES.map((scope) => ({
    id: scope,
    label: DAMAGE_CHAIN_SCOPE_LABELS[scope],
  })),
)

function toggleScopeFilter(scope: DamageChainScope) {
  const index = scopeFilter.value.indexOf(scope)
  if (index >= 0) scopeFilter.value.splice(index, 1)
  else scopeFilter.value.push(scope)
  // 换层级时清掉下级选择，避免残留不属于当前层级的目标
  agentFilter.value = []
  skillGroupFilter.value = []
  skillFilter.value = []
}

function toggleAgentFilter(agentId: string) {
  const index = agentFilter.value.indexOf(agentId)
  if (index >= 0) agentFilter.value.splice(index, 1)
  else agentFilter.value.push(agentId)
  // 角色变了，已选招式 / 技能组可能不属于新角色集合，统一清掉
  skillFilter.value = []
  skillGroupFilter.value = []
}

function toggleSkillGroupFilter(groupId: string) {
  const index = skillGroupFilter.value.indexOf(groupId)
  if (index >= 0) skillGroupFilter.value.splice(index, 1)
  else skillGroupFilter.value.push(groupId)
}

function toggleSkillFilter(skillId: string) {
  const index = skillFilter.value.indexOf(skillId)
  if (index >= 0) skillFilter.value.splice(index, 1)
  else skillFilter.value.push(skillId)
}

/** 有特殊链路的角色集合：只列「确实存在角色 / 技能组 / 招式专属链路」的角色 */
const specialAgentIds = computed(() => {
  const ids = new Set<string>()
  for (const row of chainRows.value) {
    if (!isSpecialRow(row)) continue
    if (row.scope === 'agent' && row.targetId) {
      ids.add(row.targetId)
      continue
    }
    if (row.scope === 'skillGroup') {
      const group = calculatorBuffStore.skillGroups.find((item) => item.id === row.targetId)
      if (group) ids.add(group.agentId)
      continue
    }
    if (row.scope === 'skill') {
      const skill = calculatorBuffStore.skills.find((item) => item.id === row.targetId)
      if (skill) ids.add(skill.agentId)
      continue
    }
    if (row.scope === 'profession') {
      for (const agent of calculatorBuffStore.agents) {
        if (agent.profession === row.targetId) ids.add(agent.id)
      }
    }
  }
  // 某些特殊链路挂在角色作用域上，但只对特定招式生效（如叶瞬光帷幕）：
  // 从「实际覆盖的招式」把所属角色补进来
  for (const row of chainRows.value) {
    if (!isSpecialRow(row)) continue
    for (const skillId of row.appliesToSkillIds) {
      const skill = calculatorBuffStore.skills.find((item) => item.id === skillId)
      if (skill) ids.add(skill.agentId)
    }
  }
  return ids
})

/** 二级候选：只列有特殊链路的角色（技能组 / 招式都挂在角色下面） */
const filterAgentOptions = computed(() =>
  calculatorBuffStore.agents.filter((agent) => specialAgentIds.value.has(agent.id)),
)

/** 三级候选：只列有特殊链路的技能组；选了角色时再按角色收窄 */
const filterSkillGroupOptions = computed(() => {
  const ids = new Set(
    chainRows.value
      .filter((row) => isSpecialRow(row) && row.scope === 'skillGroup')
      .map((row) => row.targetId),
  )
  // 组里含有被特殊链路覆盖的招式 → 该组也算「有特殊链路」
  const coveredSkillIds = new Set<string>()
  for (const row of chainRows.value) {
    if (!isSpecialRow(row)) continue
    for (const skillId of row.appliesToSkillIds) coveredSkillIds.add(skillId)
  }
  for (const group of calculatorBuffStore.skillGroups) {
    if (group.members.some((member) => coveredSkillIds.has(member.skillId))) ids.add(group.id)
  }
  return calculatorBuffStore.skillGroups.filter(
    (group) =>
      ids.has(group.id) &&
      (!agentFilter.value.length || agentFilter.value.includes(group.agentId)),
  )
})

/** 三级候选：只列有特殊链路的招式；选了角色时再按角色收窄 */
const filterSkillOptions = computed(() => {
  const ids = new Set<string>()
  for (const row of chainRows.value) {
    if (!isSpecialRow(row)) continue
    // 招式作用域的链路直接按 targetId 收；其余特殊链路按「实际覆盖的招式」收
    if (row.scope === 'skill') ids.add(row.targetId)
    for (const skillId of row.appliesToSkillIds) ids.add(skillId)
  }
  return calculatorBuffStore.skills.filter(
    (skill) =>
      ids.has(skill.id) &&
      (!agentFilter.value.length || agentFilter.value.includes(skill.agentId)),
  )
})

const needsAgentTargets = computed(
  () => scopeFilter.value.includes('agent') || scopeFilter.value.includes('skill_group') || scopeFilter.value.includes('skill'),
)
const needsSkillGroupTargets = computed(() => scopeFilter.value.includes('skill_group'))
const needsSkillTargets = computed(() => scopeFilter.value.includes('skill'))

function resetScopeFilter() {
  scopeFilter.value = []
  agentFilter.value = []
  skillGroupFilter.value = []
  skillFilter.value = []
}

const scopeFilterActive = computed(() => scopeFilter.value.length > 0)

/** 行目标是否命中「角色 → 技能组 / 招式」三级筛选 */
function rowMatchesAgentScope(row: ChainRow): boolean {
  if (!agentFilter.value.length) return true
  return agentFilter.value.includes(row.targetId)
}

function rowMatchesSkillGroupScope(row: ChainRow): boolean {
  if (skillGroupFilter.value.length) return skillGroupFilter.value.includes(row.targetId)
  if (!agentFilter.value.length) return true
  return calculatorBuffStore.skillGroups.some(
    (group) => group.id === row.targetId && agentFilter.value.includes(group.agentId),
  )
}

function rowMatchesSkillScope(row: ChainRow): boolean {
  if (skillFilter.value.length) return skillFilter.value.includes(row.targetId)
  if (!agentFilter.value.length) return true
  return calculatorBuffStore.skills.some(
    (skill) => skill.id === row.targetId && agentFilter.value.includes(skill.agentId),
  )
}

function handleAuthError(err: unknown): boolean {
  if (!isAdminDamageChainAuthError(err)) return false
  authDialogVisible.value = true
  return true
}

function goRelogin() {
  clearAdminAuthenticated()
  authDialogVisible.value = false
  void router.push('/admin/login')
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

function scopeLabel(value: string): string {
  return DAMAGE_CHAIN_SCOPE_LABELS[value as DamageChainScope] || value
}

/** 后端 scope 枚举（`skill_group`）→ 前端 ZoneScope（`skillGroup`） */
function toZoneScope(value: string): ZoneScope {
  return value === 'skill_group' ? 'skillGroup' : (value as ZoneScope)
}

// ---- 列表：内置链路 + 数据库覆盖 + 角色/招式专属乘区方案 ----

interface ChainRow {
  key: string
  /** chain = 整条计算链路；zoneScheme = 角色/招式专属乘区方案（只替换链路里的部分乘区） */
  kind: 'chain' | 'zoneScheme'
  /** 特殊链路：只对特定角色 / 招式生效（角色专属方案、数据库覆盖、蕾米本人耀变等） */
  special: boolean
  origin: 'builtin' | 'db' | 'zone-builtin' | 'zone-db'
  chainKey: string
  label: string
  scope: ZoneScope
  targetId: string
  priority: number
  enabled: boolean
  damageKinds: string[]
  /** 该链路解析后的生效阶段（内置链路就是内置定义，覆盖走合并规则）；乘区方案把条目转成阶段格 */
  stages: readonly StageDefinition[]
  /** 数据库覆盖行的元信息（内置行为空） */
  doc?: DamageChainDoc
  /** 乘区方案行的元信息 */
  zoneSchemeDoc?: ZoneSchemeDoc
  /** 是否有数据库覆盖（内置链路被覆盖时提示） */
  overridden: boolean
  /** 这条特殊链路实际覆盖的招式 id（用于「招式」筛选与方案完整链路） */
  appliesToSkillIds: string[]
  /** 乘区方案行：套用本方案后的完整链路（按影响到的伤害类型各一份） */
  schemeChainViews?: SchemeChainView[]
}

interface SchemeOverlayStage extends StageDefinition {
  /** 该阶段被本乘区方案的条目覆盖 */
  overriddenByScheme?: boolean
}

interface SchemeChainView {
  chainId: string
  label: string
  stages: SchemeOverlayStage[]
}

function originLabel(row: ChainRow): string {
  switch (row.origin) {
    case 'builtin':
      return row.special ? '特殊链路（内置）' : '通用链路'
    case 'db':
      return '特殊链路（数据库覆盖）'
    case 'zone-builtin':
      return '特殊链路（内置）'
    default:
      return '特殊链路（数据库）'
  }
}

/** 是否特殊链路（筛选只列出有特殊链路的角色 / 技能组 / 招式） */
function isSpecialRow(row: ChainRow): boolean {
  return row.special || row.kind === 'zoneScheme' || row.origin === 'db'
}

/** 蕾米埃尔本人耀变链路：内置但只对蕾米生效，按角色级特殊链路处理 */
const REMIEL_SELF_CHAIN_ID = 'radiance-self'
const REMIEL_AGENT_ID = 'remiel'

function resolveStagesFor(doc: DamageChainDoc | undefined, chainKey: string): readonly StageDefinition[] {
  const builtin = BUILT_IN_DAMAGE_CHAINS.find((chain) => chain.id === chainKey)
  const extra: DamageChainDefinition[] = []
  if (doc) {
    const definition = adaptDamageChain(doc)
    if (definition) {
      extra.push({ ...definition, scope: 'global', targetId: '', enabled: true })
    }
  }
  const resolved = resolveDamageChain(chainKey, {}, builtin ? [builtin, ...extra] : extra)
  return resolved.stages
}

interface SchemeEntryLike {
  key: string
  label?: string
  module?: string
  params?: Record<string, unknown>
  when?: unknown
  enabled?: boolean
  action?: string
}

/** 乘区方案条目 → 阶段格（只读展示：一个条目就是一个乘区） */
const entriesToStages = schemeEntriesToStages


/** 方案作用域 → 受影响的招式（角色 / 职业 / 技能组 / 招式） */
function skillsForSchemeScope(scope: ZoneScope, targetId: string) {
  const skills = calculatorBuffStore.skills
  switch (scope) {
    case 'agent':
      return skills.filter((skill) => skill.agentId === targetId)
    case 'profession':
      return skills.filter(
        (skill) =>
          calculatorBuffStore.agents.find((agent) => agent.id === skill.agentId)?.profession ===
          targetId,
      )
    case 'skillGroup':
      return skills.filter((skill) => (skill.ownerGroupId ?? '') === targetId)
    case 'skill':
      return skills.filter((skill) => skill.id === targetId)
    default:
      return []
  }
}

/**
 * 乘区方案 → 完整计算链路视图。
 *
 * 方案本身只覆盖链路里的部分乘区（如 `stagger`），所以按受影响的招式把它们的链路解析出来，
 * 再把方案条目按阶段 id 覆盖到对应格子上（条目 key 不在链路上时补一格），
 * 这样详情里能看到「完整乘区 + 哪几格被方案覆盖」。
 */
function buildSchemeChainViews(
  scope: ZoneScope,
  targetId: string,
  entries: readonly SchemeEntryLike[],
): SchemeChainView[] {
  const entryByKey = new Map(entries.map((entry) => [entry.key, entry]))
  const seen = new Set<string>()
  const views: SchemeChainView[] = []
  for (const skill of skillsForSchemeScope(scope, targetId)) {
    const agent = calculatorBuffStore.agents.find((item) => item.id === skill.agentId)
    const baseDamageSource = resolveBaseDamageSourceForProfession(agent?.profession)
    const useSharpen = skill.damageType === 'sharpen' || agent?.profession === '锋御'
    const resolved = resolveCurrentDamageChain({
      damageKind: skill.damageType,
      baseDamageSource,
      useSharpen,
      context: {
        agentId: skill.agentId,
        profession: agent?.profession ?? null,
        skillGroupId: skill.ownerGroupId ?? null,
        skillId: skill.id,
      },
    })
    const viewKey = `${resolved.chainId}|${baseDamageSource}|${useSharpen ? 's' : ''}`
    if (seen.has(viewKey)) continue
    seen.add(viewKey)

    const stages: SchemeOverlayStage[] = resolved.stages.map((stage) => {
      const entry = entryByKey.get(stage.id)
      if (!entry) return { ...stage }
      return {
        ...stage,
        label: entry.label || stage.label,
        module: entry.module ?? stage.module,
        params: entry.params ?? stage.params,
        when: (entry.when as StageDefinition['when']) ?? stage.when,
        overriddenByScheme: true,
      }
    })
    const mappedIds = new Set(stages.map((stage) => stage.id))
    let maxOrder = stages.reduce((max, stage) => Math.max(max, stage.order), 0)
    for (const entry of entries) {
      if (mappedIds.has(entry.key)) continue
      maxOrder += 10
      stages.push({
        id: entry.key,
        kind: 'multiplier',
        label: entry.label || entry.key,
        group: 'scheme',
        order: maxOrder,
        module: entry.module ?? '',
        params: entry.params,
        when: entry.when as StageDefinition['when'],
        enabled: true,
        overriddenByScheme: true,
      })
    }
    views.push({
      chainId: resolved.chainId,
      label: getDamageChainLabel(resolved.chainId) ?? resolved.chainId,
      stages,
    })
  }
  return views
}

function agentOfSkill(skill: { agentId: string }) {
  return calculatorBuffStore.agents.find((agent) => agent.id === skill.agentId)
}

/** 作用域 + 目标是否命中某条招式 */
function scopeTargetMatchesSkill(
  scope: ZoneScope,
  targetId: string,
  skill: { id: string; agentId: string; ownerGroupId?: string | null },
): boolean {
  switch (scope) {
    case 'agent':
      return skill.agentId === targetId
    case 'profession':
      return (agentOfSkill(skill)?.profession ?? '') === targetId
    case 'skillGroup':
      return (skill.ownerGroupId ?? '') === targetId
    case 'skill':
      return skill.id === targetId
    default:
      return true
  }
}

/** 链路行实际覆盖的招式：作用域目标 + 伤害类型匹配 */
function chainAppliesToSkillIds(
  scope: ZoneScope,
  targetId: string,
  damageKinds: readonly string[],
): string[] {
  return calculatorBuffStore.skills
    .filter(
      (skill) =>
        (!damageKinds.length || damageKinds.includes(skill.damageType)) &&
        scopeTargetMatchesSkill(scope, targetId, skill),
    )
    .map((skill) => skill.id)
}

/** 乘区方案实际覆盖的招式：作用域目标匹配且至少一个条目的条件成立 */
function schemeAppliesToSkillIds(
  scope: ZoneScope,
  targetId: string,
  entries: readonly SchemeEntryLike[],
): string[] {
  const panelContext = {
    teamSlots: calculatorBuffStore.agents.map((agent) => ({ agentId: agent.id, rank: 6 })),
    agents: calculatorBuffStore.agents.map((agent) => ({
      id: agent.id,
      profession: agent.profession,
      element: agent.element,
    })),
  }
  return calculatorBuffStore.skills
    .filter((skill) => {
      if (!scopeTargetMatchesSkill(scope, targetId, skill)) return false
      const hit = {
        skill: {
          id: skill.id,
          name: skill.name,
          agentId: skill.agentId,
          skillTypes: skill.skillTypes,
          ownerGroupId: skill.ownerGroupId ?? null,
        },
      }
      const context = buildZoneResolvedContext(hit, panelContext)
      return entries.some(
        (entry) =>
          !entry.when ||
          evaluateZoneCondition(entry.when as ZoneCondition, hit, panelContext, context),
      )
    })
    .map((skill) => skill.id)
}

/** 覆盖招式 → 适用伤害类型（去重，保持招式库顺序） */
function damageKindsOfSkillIds(skillIds: readonly string[]): string[] {
  const ids = new Set(skillIds)
  const kinds: string[] = []
  for (const skill of calculatorBuffStore.skills) {
    if (!ids.has(skill.id)) continue
    if (!kinds.includes(skill.damageType)) kinds.push(skill.damageType)
  }
  return kinds
}

/** 目标 id → 展示名（角色 / 技能组 / 招式都能翻出名字） */
function targetLabelOf(targetId: string): string {
  if (!targetId) return '全局'
  const agent = calculatorBuffStore.agents.find((item) => item.id === targetId)
  if (agent) return agent.name
  const group = calculatorBuffStore.skillGroups.find((item) => item.id === targetId)
  if (group) return group.name
  const skill = calculatorBuffStore.skills.find((item) => item.id === targetId)
  if (skill) return skill.name
  return targetId
}

const chainRows = computed<ChainRow[]>(() => {
  const rows: ChainRow[] = []
  const dbByKey = new Map<string, DamageChainDoc[]>()
  for (const doc of chains.value) {
    const list = dbByKey.get(doc.chainKey) ?? []
    list.push(doc)
    dbByKey.set(doc.chainKey, list)
  }

  for (const builtin of BUILT_IN_DAMAGE_CHAINS) {
    const overrides = dbByKey.get(builtin.id) ?? []
    const isRemielSelf = builtin.id === REMIEL_SELF_CHAIN_ID
    rows.push({
      key: `builtin:${builtin.id}`,
      kind: 'chain',
      special: isRemielSelf,
      origin: 'builtin',
      chainKey: builtin.id,
      label: builtin.label,
      // 蕾米本人耀变只在蕾米自己身上生效，按角色级特殊链路展示
      scope: isRemielSelf ? 'agent' : (builtin.scope ?? 'global'),
      targetId: isRemielSelf ? REMIEL_AGENT_ID : (builtin.targetId ?? ''),
      priority: builtin.priority ?? 0,
      enabled: true,
      damageKinds: [...builtin.appliesTo.damageKinds],
      stages: builtin.stages,
      overridden: overrides.length > 0,
      appliesToSkillIds: isRemielSelf
        ? chainAppliesToSkillIds('agent', REMIEL_AGENT_ID, builtin.appliesTo.damageKinds)
        : [],
    })
  }

  for (const doc of chains.value) {
    rows.push({
      key: `chain-db:${doc.id}`,
      kind: 'chain',
      special: true,
      origin: 'db',
      chainKey: doc.chainKey,
      label: doc.label || doc.chainKey,
      scope: toZoneScope(doc.scope),
      targetId: doc.targetId,
      priority: doc.priority,
      enabled: doc.enabled,
      damageKinds: doc.appliesTo.damageKinds,
      stages: resolveStagesFor(doc, doc.chainKey),
      doc,
      overridden: false,
      appliesToSkillIds: chainAppliesToSkillIds(
        toZoneScope(doc.scope),
        doc.targetId,
        doc.appliesTo.damageKinds,
      ),
    })
  }

  // 角色 / 招式专属乘区方案作为「计算链路」一并列出（只列非全局作用域）
  BUILT_IN_ZONE_SCHEMES.forEach((scheme, index) => {
    if (scheme.scope === 'global') return
    const entries: SchemeEntryLike[] = scheme.entries.map((entry) => ({
      key: entry.key,
      module: entry.module,
      params: entry.params as Record<string, unknown> | undefined,
      when: entry.when,
      enabled: true,
    }))
    const appliesToSkillIds = schemeAppliesToSkillIds(scheme.scope, scheme.targetId, entries)
    rows.push({
      key: `zone-builtin:${scheme.scope}:${scheme.targetId}:${index}`,
      kind: 'zoneScheme',
      special: true,
      origin: 'zone-builtin',
      chainKey: scheme.targetId || 'global',
      label: `${targetLabelOf(scheme.targetId)} · 特殊链路（内置）`,
      scope: scheme.scope,
      targetId: scheme.targetId,
      priority: scheme.priority,
      enabled: true,
      damageKinds: damageKindsOfSkillIds(appliesToSkillIds),
      stages: entriesToStages(entries),
      schemeChainViews: buildSchemeChainViews(scheme.scope, scheme.targetId, entries),
      overridden: false,
      appliesToSkillIds,
    })
  })

  for (const doc of zoneSchemes.value) {
    if (doc.scope === 'global') continue
    if (!doc.enabled) continue
    const entries: SchemeEntryLike[] = doc.rules.map((rule: ZoneSchemeRule) => ({
      key: rule.key,
      label: rule.label,
      module: rule.module,
      params: rule.params,
      when: rule.when,
      enabled: rule.enabled !== false && rule.action !== 'disable',
      action: rule.action,
    }))
    const appliesToSkillIds = schemeAppliesToSkillIds(toZoneScope(doc.scope), doc.target_id, entries)
    rows.push({
      key: `zone-db:${doc.id}`,
      kind: 'zoneScheme',
      special: true,
      origin: 'zone-db',
      chainKey: doc.target_id || 'global',
      label: doc.name || `${targetLabelOf(doc.target_id)} · 特殊链路`,
      scope: toZoneScope(doc.scope),
      targetId: doc.target_id,
      priority: doc.priority,
      enabled: doc.enabled,
      damageKinds: damageKindsOfSkillIds(appliesToSkillIds),
      stages: entriesToStages(entries),
      schemeChainViews: buildSchemeChainViews(toZoneScope(doc.scope), doc.target_id, entries),
      zoneSchemeDoc: doc,
      overridden: false,
      appliesToSkillIds,
    })
  }

  return rows
})

/** 已选技能组里包含的招式 id（过滤时用来把「组内被覆盖的招式」算进命中） */
const groupSkillIds = computed(() => {
  const ids = new Set<string>()
  for (const group of calculatorBuffStore.skillGroups) {
    if (!skillGroupFilter.value.includes(group.id)) continue
    for (const member of group.members) ids.add(member.skillId)
  }
  return ids
})

const selectedRow = computed<ChainRow | null>(
  () => chainRows.value.find((row) => row.key === selectedRowKey.value) ?? null,
)

/**
 * 全局乘区方案里的「独立乘区」条目（烬痕 / 最终伤害 / 一布之力 …）。
 *
 * 事件结算时它们由 `customZoneStageEntries()` 编译成链路阶段、与阶段一起连乘；
 * 管理端链路面板按同一口径把它们并列展示（普通格子，不再单独区分虚线）。
 */
const globalSchemeStages = computed<StageDefinition[]>(() => {
  const entries: SchemeEntryLike[] = []
  for (const doc of zoneSchemes.value) {
    if (doc.scope !== 'global' || !doc.enabled) continue
    for (const rule of doc.rules) {
      if (rule.enabled === false || rule.action === 'disable') continue
      entries.push({
        key: rule.key,
        label: rule.label,
        module: rule.module,
        params: rule.params,
        when: rule.when,
        enabled: true,
        action: rule.action,
      })
    }
  }
  if (!entries.length) {
    for (const scheme of BUILT_IN_ZONE_SCHEMES) {
      if (scheme.scope !== 'global') continue
      for (const entry of scheme.entries) {
        entries.push({
          key: entry.key,
          label: entry.label,
          module: entry.module,
          params: entry.params as Record<string, unknown> | undefined,
          when: entry.when,
          enabled: true,
        })
      }
    }
  }
  return entriesToStages(entries)
})

/** 链路展示用阶段 = 链路自身阶段 + 全局独立乘区（同 id 不重复） */
function displayStagesOf(row: ChainRow): readonly StageDefinition[] {
  if (row.kind !== 'chain') return row.stages
  return mergeSchemeStagesIntoChain(row.stages, globalSchemeStages.value)
}

/**
 * 作用域筛选：一级选层级（多选），二级按层级挑具体目标（角色 / 招式，多选）。
 * 未选任何层级 = 全部显示；选了层级后只显示命中任一（层级 + 目标）组合的链路。
 * 选了「角色」但二级为空 → 显示该层级全部（所有角色）；「招式」同理。
 */
const filteredChainRows = computed<ChainRow[]>(() => {
  if (!scopeFilterActive.value) return chainRows.value
  return chainRows.value.filter((row) => {
    if (scopeFilter.value.includes('global') && row.scope === 'global') return true
    if (scopeFilter.value.includes('profession') && row.scope === 'profession') return true
    if (scopeFilter.value.includes('agent') && row.scope === 'agent' && rowMatchesAgentScope(row)) {
      return true
    }
    if (
      scopeFilter.value.includes('skill_group') &&
      row.scope === 'skillGroup' &&
      rowMatchesSkillGroupScope(row)
    ) {
      return true
    }
    if (scopeFilter.value.includes('skill') && row.scope === 'skill' && rowMatchesSkillScope(row)) {
      return true
    }
    // 选了具体招式：任何「实际覆盖这条招式」的特殊行都算命中
    if (skillFilter.value.length && row.appliesToSkillIds.some((id) => skillFilter.value.includes(id))) {
      return true
    }
    // 选了具体技能组：组内含有被这条特殊链路覆盖的招式也算命中
    if (skillGroupFilter.value.length && row.appliesToSkillIds.some((id) => groupSkillIds.value.has(id))) {
      return true
    }
    return false
  })
})

function selectRow(row: ChainRow) {
  selectedRowKey.value = row.key
  previewResult.value = null
  previewError.value = ''
}

// ---- 异常类乘区归属：异常强度提供者 / 异常类触发者 / 共用 ----

const ACTOR_LABELS = {
  producer: '异常强度提供者',
  trigger: '异常类触发者',
  mixed: '共用',
  result: '最终伤害',
} as const

type StageActorGroup = keyof typeof ACTOR_LABELS

/** 异常大类链路（含基础耀变、蕾米本人耀变之外的子类）才区分提供者 / 触发者 */
const ANOMALY_STAGE_GROUPS = new Set([
  'anomaly',
  'attributeAnomaly',
  'anomalyRelease',
  'disorder',
  'turbulence',
  'radiance',
])

function isAnomalyStage(stage: StageDefinition): boolean {
  return ANOMALY_STAGE_GROUPS.has(stage.group)
}

/** 乘区归属：沿用用户端「计算过程」同一套口径（skillCalcZoneGroup），source 阶段归提供者 */
function stageActor(stage: StageDefinition): StageActorGroup {
  if (stage.kind === 'source') return 'producer'
  return skillCalcZoneGroup(stage.label)
}

function hasAnomalyStages(stages: readonly StageDefinition[]): boolean {
  return stages.some(isAnomalyStage)
}

function schemeHasAnomalyStages(row: ChainRow): boolean {
  return (row.schemeChainViews ?? []).some((view) => hasAnomalyStages(view.stages))
}

/** 阶段条件摘要：只读展示，用来提示「这个阶段什么时候生效」 */
function formatWhen(stage: StageDefinition): string {
  if (stage.when === undefined) return ''
  try {
    return JSON.stringify(stage.when)
  } catch {
    return String(stage.when)
  }
}

/** 阶段参数摘要：只读展示（cap / floor / statKeys 等） */
function formatParams(stage: StageDefinition): string {
  if (!stage.params || !Object.keys(stage.params).length) return ''
  try {
    return JSON.stringify(stage.params)
  } catch {
    return String(stage.params)
  }
}

// ---- 链路一致性核查：全角色 × 全招式，列出链路解析结果与常规链路不一致的条目 ----

interface ChainAuditRow {
  agentId: string
  agentName: string
  profession: string
  skillId: string
  skillName: string
  damageType: string
  /** 命中上下文解析出的链路 id（含数据库覆盖优先） */
  resolvedChainId: string
  /** 不考虑数据库覆盖时按伤害类型 / 职业推导的常规链路 id */
  expectedChainId: string
  /** 常规链路的乘区顺序（expectedChainId 对应的内置阶段） */
  expectedStages: readonly StageDefinition[]
  /** 实际生效链路的乘区顺序（resolvedChainId 对应的内置 / 覆盖阶段） */
  resolvedStages: readonly StageDefinition[]
  /** 链路 id 本身与常规推导不一致（角色专属 / 招式专属覆盖） */
  chainMismatch: boolean
  /** 逐阶段的差异（新增 / 缺失 / 模块或条件或参数不同） */
  stageDiffs: StageDiff[]
}

interface StageDiff {
  stageId: string
  label: string
  kind: 'missing' | 'extra' | 'changed'
  detail: string
}

/** 按伤害类型 / 基础伤害来源推导常规链路 id（不考虑数据库覆盖） */
function expectedChainIdFor(damageType: string, baseDamageSource: string, useSharpen: boolean): string {
  return resolveDamageChainId({ damageKind: damageType, baseDamageSource, useSharpen })
}

/** 稳定序列化（键排序），用于比较 params / when */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      )
    }
    return item
  })
}

/** 读条件里的可读摘要（skillName 包含 / in、mindscapeRank 阈值等） */
function describeCondition(when: unknown): string {
  if (!when || (typeof when === 'object' && !Object.keys(when as object).length)) return ''
  if (!when || typeof when !== 'object') return String(when)
  const record = when as Record<string, unknown>
  if (Array.isArray(record.or)) {
    return '或（' + record.or.map((item) => describeCondition(item)).filter(Boolean).join(' / ') + '）'
  }
  if (Array.isArray(record.and)) {
    return '且（' + record.and.map((item) => describeCondition(item)).filter(Boolean).join(' / ') + '）'
  }
  if (typeof record.var === 'string') {
    const op = typeof record.op === 'string' ? record.op : ''
    const value = record.value
    const valueText = Array.isArray(value) ? value.join(' / ') : String(value ?? '')
    return `${record.var} ${op} ${valueText}`.trim()
  }
  return stableStringify(when)
}

/** 读参数里的可读摘要：cap 规则写成「默认 X / ≥N影 Y」 */
function describeParams(params: unknown): string {
  if (!params || typeof params !== 'object') return ''
  const record = params as Record<string, unknown>
  const parts: string[] = []
  if (typeof record.mode === 'string') parts.push(`mode=${record.mode}`)
  const cap = record.cap
  if (cap && typeof cap === 'object') {
    const capRecord = cap as Record<string, unknown>
    const defaultCap = Number(capRecord.default)
    const rank4 = Number(capRecord.rank4)
    const threshold = Number(capRecord.rankThreshold ?? 4)
    if (Number.isFinite(defaultCap)) {
      parts.push(
        Number.isFinite(rank4)
          ? `上限 ${Math.round(defaultCap * 100)}%（≥${threshold}影 ${Math.round(rank4 * 100)}%）`
          : `上限 ${Math.round(defaultCap * 100)}%`,
      )
    }
  }
  if (Array.isArray(record.statKeys)) parts.push(`字段 ${record.statKeys.join(' / ')}`)
  const rest = { ...record }
  delete rest.mode
  delete rest.cap
  delete rest.statKeys
  if (Object.keys(rest).length) parts.push(stableStringify(rest))
  return parts.join(' · ')
}

function stageSignatureWithDetail(stage: StageDefinition): string {
  return [
    `order=${stage.order}`,
    `module=${stage.module ?? ''}`,
    `label=${stage.label ?? ''}`,
    `params=${stableStringify(stage.params ?? {})}`,
    `when=${stableStringify(stage.when ?? {})}`,
    `enabled=${stage.enabled === false ? 'false' : 'true'}`,
  ].join('|')
}

/** 逐阶段对比：缺失 / 新增 / 顺序、模块、条件、参数变化 */
function diffStages(
  expected: readonly StageDefinition[],
  resolved: readonly StageDefinition[],
): StageDiff[] {
  const expectedEnabled = expected.filter((stage) => stage.enabled !== false)
  const resolvedEnabled = resolved.filter((stage) => stage.enabled !== false)
  const expectedById = new Map(expectedEnabled.map((stage) => [stage.id, stage]))
  const resolvedById = new Map(resolvedEnabled.map((stage) => [stage.id, stage]))
  const diffs: StageDiff[] = []

  for (const stage of resolvedEnabled) {
    const before = expectedById.get(stage.id)
    if (!before) {
      diffs.push({ stageId: stage.id, label: stage.label, kind: 'extra', detail: '常规链路没有这个阶段' })
      continue
    }
    if (stageSignatureWithDetail(before) === stageSignatureWithDetail(stage)) continue
    const changes: string[] = []
    if (before.order !== stage.order) changes.push(`顺序 ${before.order} → ${stage.order}`)
    if ((before.module ?? '') !== (stage.module ?? '')) {
      changes.push(`模块 ${before.module ?? '—'} → ${stage.module ?? '—'}`)
    }
    if ((before.label ?? '') !== (stage.label ?? '')) {
      changes.push(`名称 ${before.label ?? '—'} → ${stage.label ?? '—'}`)
    }
    if (stableStringify(before.params ?? {}) !== stableStringify(stage.params ?? {})) {
      changes.push(
        `参数 ${describeParams(before.params) || '空'} → ${describeParams(stage.params) || '空'}`,
      )
    }
    if (stableStringify(before.when ?? {}) !== stableStringify(stage.when ?? {})) {
      changes.push(
        `条件 ${describeCondition(before.when) || '无条件'} → ${describeCondition(stage.when) || '无条件'}`,
      )
    }
    if (changes.length) {
      diffs.push({ stageId: stage.id, label: stage.label, kind: 'changed', detail: changes.join('；') })
    }
  }

  for (const stage of expectedEnabled) {
    if (resolvedById.has(stage.id)) continue
    diffs.push({ stageId: stage.id, label: stage.label, kind: 'missing', detail: '实际链路里没有这个阶段' })
  }

  return diffs
}

/**
 * 核查思路：把每个角色按其职业推导基础伤害来源（命破 → pierce、锋御 → def、其余 atk），
 * 对其每条招式按伤害类型解析「常规链路」（无数据库覆盖时的推导结果），
 * 再按同一上下文跑一次真实解析（内置 + 数据库覆盖 + 运行时链路）。
 * 链路 id 不同或逐阶段（顺序 / 模块 / 条件 / 参数）不同的条目列为「角色/招式特定链路」。
 */
const chainAuditRows = computed<ChainAuditRow[]>(() => {
  const rows: ChainAuditRow[] = []
  for (const agent of calculatorBuffStore.agents) {
    const skills = calculatorBuffStore.skills.filter((skill) => skill.agentId === agent.id)
    const baseDamageSource = resolveBaseDamageSourceForProfession(agent.profession)
    for (const skill of skills) {
      const useSharpen = skill.damageType === 'sharpen' || agent.profession === '锋御'
      const expectedChainId = expectedChainIdFor(skill.damageType, baseDamageSource, useSharpen)
      const resolved = resolveCurrentDamageChain({
        damageKind: skill.damageType,
        baseDamageSource,
        useSharpen,
        context: {
          agentId: agent.id,
          profession: agent.profession,
          skillId: skill.id,
        },
      })
      // 常规链路取内置定义；实际链路取解析结果（已合并数据库覆盖、已剔除禁用与条件不成立的阶段）
      const expectedStages = getDamageChain(expectedChainId)?.stages ?? []
      const resolvedStages = resolved.stages
      const chainMismatch = resolved.chainId !== expectedChainId
      const stageDiffs = diffStages(expectedStages, resolvedStages)
      if (!chainMismatch && !stageDiffs.length) continue
      rows.push({
        agentId: agent.id,
        agentName: agent.name,
        profession: agent.profession,
        skillId: skill.id,
        skillName: skill.name,
        damageType: skill.damageType,
        resolvedChainId: resolved.chainId,
        expectedChainId,
        expectedStages,
        resolvedStages,
        chainMismatch,
        stageDiffs,
      })
    }
  }
  return rows
})

/** 汇总为「角色级」条目：该角色所有招式解析结果一致时合并成一行 */
const chainAuditSummary = computed(() => {
  const byAgent = new Map<string, ChainAuditRow[]>()
  for (const row of chainAuditRows.value) {
    const list = byAgent.get(row.agentId) ?? []
    list.push(row)
    byAgent.set(row.agentId, list)
  }
  return [...byAgent.entries()].map(([agentId, list]) => {
    const first = list[0]!
    const allSameChain = list.every((row) => row.resolvedChainId === first.resolvedChainId)
    return {
      agentId,
      agentName: first.agentName,
      profession: first.profession,
      skillCount: list.length,
      chainId: allSameChain ? first.resolvedChainId : null,
      chainMismatchCount: list.filter((row) => row.chainMismatch).length,
      stageDiffCount: list.reduce((total, row) => total + row.stageDiffs.length, 0),
      rows: list,
    }
  })
})

const auditExpandedAgentId = ref('')

function toggleAuditAgent(agentId: string) {
  auditExpandedAgentId.value = auditExpandedAgentId.value === agentId ? '' : agentId
}

function auditStageLabels(stages: readonly StageDefinition[]): string {
  return stages
    .filter((stage) => stage.enabled !== false)
    .map((stage) => stage.label)
    .join(' → ')
}

const zoneSchemes = ref<ZoneSchemeDoc[]>([])
const zoneSchemeError = ref('')

// ---- 预览：合成面板按当前链路的阶段顺序算一次，只读 ----

function runPreview() {
  previewError.value = ''
  previewResult.value = null
  const row = selectedRow.value
  if (!row || row.kind !== 'chain') {
    previewError.value = '乘区方案只替换链路里的对应乘区，不单独预览'
    return
  }
  const stages = displayStagesOf(row)
  if (!stages.length) {
    previewError.value = '该链路没有可用阶段'
    return
  }
  // 预览与展示同一份阶段顺序（含方案编译出的独立乘区；示例没有 custom 修饰时它们为 1.00）
  previewResult.value = previewDamageChain(row.chainKey, stages, {}, previewSampleId.value)
}

onMounted(async () => {
  loading.value = true
  error.value = ''
  zoneSchemeError.value = ''
  try {
    chains.value = await fetchDamageChains()
  } catch (err) {
    if (!handleAuthError(err)) error.value = errorText(err, '读取计算链路失败')
  }
  try {
    zoneSchemes.value = await fetchZoneSchemes()
  } catch (err) {
    if (!handleAuthError(err)) zoneSchemeError.value = errorText(err, '读取乘区方案失败')
  }
  loading.value = false
})
</script>

<template>
  <section class="zone-section">
    <header class="chain-header">
      <h3 class="chain-title">计算链路（只读）</h3>
      <span class="chain-count">
        {{ scopeFilterActive ? `${filteredChainRows.length} / ${chainRows.length} 条` : `${chainRows.length} 条` }}
      </span>
    </header>
    <p class="chain-hint">
      列出通用链路（按伤害类型）与特殊链路——只对特定角色 / 招式生效的乘区方案、数据库覆盖、
      蕾米本人耀变等。点击一条查看它的乘区顺序；本面板只读，内容由代码与数据库维护。
    </p>

    <div class="chain-filter-block">
      <div class="chain-filter-row">
        <span class="chain-filter-label">作用域</span>
        <button
          v-for="option in scopeOptions"
          :key="option.id"
          type="button"
          class="chip"
          :class="{ active: scopeFilter.includes(option.id) }"
          @click="toggleScopeFilter(option.id)"
        >
          {{ option.label }}
        </button>
        <button
          v-if="scopeFilterActive"
          type="button"
          class="secondary-btn small"
          @click="resetScopeFilter"
        >
          清除筛选
        </button>
      </div>
      <div v-if="needsAgentTargets" class="chain-filter-row">
        <span class="chain-filter-label">角色</span>
        <button
          v-for="agent in filterAgentOptions"
          :key="agent.id"
          type="button"
          class="chip"
          :class="{ active: agentFilter.includes(agent.id) }"
          @click="toggleAgentFilter(agent.id)"
        >
          {{ agent.name }}
        </button>
        <span v-if="!filterAgentOptions.length" class="chain-filter-empty">
          {{ calculatorBuffStore.loaded ? '当前没有角色级特殊链路' : '加载角色库中…' }}
        </span>
      </div>
      <div v-if="needsSkillGroupTargets" class="chain-filter-row">
        <span class="chain-filter-label">技能组</span>
        <button
          v-for="group in filterSkillGroupOptions"
          :key="group.id"
          type="button"
          class="chip"
          :class="{ active: skillGroupFilter.includes(group.id) }"
          @click="toggleSkillGroupFilter(group.id)"
        >
          {{ group.name }}
        </button>
        <span v-if="!agentFilter.length" class="chain-filter-empty">
          技能组挂在角色下面：先选角色，再挑组内含特殊链路招式的技能组
        </span>
        <span v-else-if="!filterSkillGroupOptions.length" class="chain-filter-empty">
          所选角色没有技能组级特殊链路
        </span>
      </div>
      <div v-if="needsSkillTargets" class="chain-filter-row">
        <span class="chain-filter-label">招式</span>
        <button
          v-for="skill in filterSkillOptions"
          :key="skill.id"
          type="button"
          class="chip"
          :class="{ active: skillFilter.includes(skill.id) }"
          @click="toggleSkillFilter(skill.id)"
        >
          {{ skill.name }}
        </button>
        <span v-if="!agentFilter.length" class="chain-filter-empty">
          招式挂在角色下面：先选角色，再挑被特殊链路覆盖的招式（如叶瞬光的明心境 / 终结技 / 登场技）
        </span>
        <span v-else-if="!filterSkillOptions.length" class="chain-filter-empty">
          所选角色没有招式级特殊链路
        </span>
      </div>
    </div>

    <p v-if="error" class="form-error">{{ error }}</p>
    <p v-if="zoneSchemeError" class="form-error">{{ zoneSchemeError }}</p>

    <div class="chain-display-layout">
      <div class="item-list list-scroll chain-list">
        <p v-if="loading" class="chain-empty">读取中…</p>
        <p v-else-if="!filteredChainRows.length" class="chain-empty">
          {{ scopeFilterActive ? '筛选条件下没有匹配的链路。' : '没有可展示的链路。' }}
        </p>
        <button
          v-for="row in filteredChainRows"
          :key="row.key"
          type="button"
          class="list-item"
          :class="{
            active: selectedRowKey === row.key,
            'is-builtin': row.origin === 'builtin' || row.origin === 'zone-builtin',
          }"
          @click="selectRow(row)"
        >
          <span class="list-name">{{ row.label }}</span>
          <span v-if="row.kind === 'chain'" class="list-meta mono">{{ row.chainKey }}</span>
          <span class="list-meta">
            {{ originLabel(row) }} · {{ scopeLabel(row.scope) }}
            <template v-if="row.targetId"> · {{ targetLabelOf(row.targetId) }}</template>
            · {{ displayStagesOf(row).length }} 个乘区
          </span>
          <span class="list-meta">
            <template v-if="row.kind === 'zoneScheme'">
              特殊链路 · {{ row.damageKinds.join(' / ') || '按条件' }} · 按条件替换乘区
            </template>
            <template v-else>{{ row.damageKinds.join(' / ') || '全部伤害类型' }}</template>
            <template v-if="row.origin === 'db' || row.origin === 'zone-db'">
              · {{ row.enabled ? '已启用' : '已停用' }}
            </template>
          </span>
        </button>
      </div>

      <div class="chain-display-detail">
        <template v-if="selectedRow">
          <header class="chain-header">
            <h4 class="chain-title">{{ selectedRow.label }}</h4>
            <span class="chain-count mono">
              {{ selectedRow.kind === 'chain' ? selectedRow.chainKey : originLabel(selectedRow) }}
            </span>
          </header>
          <p class="chain-hint">
            {{ scopeLabel(selectedRow.scope) }}
            <template v-if="selectedRow.targetId"> · 目标 {{ targetLabelOf(selectedRow.targetId) }}</template>
            <template v-if="selectedRow.damageKinds.length"> · 适用 {{ selectedRow.damageKinds.join(' / ') }}</template>
            · 优先级 {{ selectedRow.priority }}
            <template v-if="selectedRow.overridden"> · 该内置链路存在数据库覆盖行</template>
          </p>

          <!-- 整条链路：直接展示链路自身的乘区顺序 -->
          <template v-if="selectedRow.kind === 'chain'">
            <div class="chain-stage-grid">
              <div
                v-for="stage in displayStagesOf(selectedRow)"
                :key="`stage-${stage.id}`"
                class="chain-stage-cell"
                :class="`chain-stage-cell--${stage.kind}`"
              >
                <div class="cell-head">
                  <span class="cell-kind">{{ STAGE_KIND_LABELS[stage.kind] ?? stage.kind }}</span>
                  <span class="cell-order">{{ stage.order }}</span>
                </div>
                <span class="cell-label">{{ stage.label }}</span>
                <span
                  v-if="isAnomalyStage(stage)"
                  class="cell-actor"
                  :class="`cell-actor--${stageActor(stage)}`"
                >
                  {{ ACTOR_LABELS[stageActor(stage)] }}
                </span>
                <span class="cell-module mono">{{ stage.module || '—' }}</span>
                <span v-if="stage.params" class="cell-detail mono">{{ formatParams(stage) }}</span>
                <span v-if="stage.when" class="cell-detail mono">条件 {{ formatWhen(stage) }}</span>
              </div>
            </div>

            <p v-if="hasAnomalyStages(selectedRow.stages)" class="chain-actor-legend">
              乘区归属：
              <span class="cell-actor cell-actor--producer">异常强度提供者</span>
              <span class="cell-actor cell-actor--trigger">异常类触发者</span>
              <span class="cell-actor cell-actor--mixed">共用</span>
            </p>

            <div class="chain-preview">
              <div class="chain-preview-head">
                <strong>预览示例</strong>
                <select v-model="previewSampleId" class="field-input preview-sample-select">
                  <option v-for="sample in DAMAGE_CHAIN_SAMPLE_HITS" :key="sample.id" :value="sample.id">
                    {{ sample.label }}
                  </option>
                </select>
                <button type="button" class="secondary-btn small" @click="runPreview">计算</button>
              </div>
              <p v-if="previewError" class="form-error">{{ previewError }}</p>
              <template v-if="previewResult">
                <div class="chain-preview-grid">
                  <div v-for="stage in previewResult.stages" :key="`preview-${stage.id}`" class="preview-cell">
                    <span class="preview-kind">{{ STAGE_KIND_LABELS[stage.kind] ?? stage.kind }}</span>
                    <span class="preview-label">{{ stage.label }}</span>
                    <span class="preview-value">
                      {{ Number.isInteger(stage.value) ? stage.value.toLocaleString('en-US') : stage.value }}
                    </span>
                  </div>
                </div>
                <p class="chain-hint">
                  示例命中「{{ previewResult.sampleLabel }}」· 合成面板（攻击 3000 / 增伤 50% / 暴击 50%-100%），
                  与线上真实面板无关。示例最终伤害
                  {{ Math.round(previewResult.final).toLocaleString('en-US') }}。
                </p>
              </template>
            </div>
          </template>

          <!-- 乘区方案：展示受影响招式的完整链路乘区，被本方案覆盖的格子高亮 -->
          <template v-else>
            <p v-if="schemeHasAnomalyStages(selectedRow)" class="chain-actor-legend">
              乘区归属：
              <span class="cell-actor cell-actor--producer">异常强度提供者</span>
              <span class="cell-actor cell-actor--trigger">异常类触发者</span>
              <span class="cell-actor cell-actor--mixed">共用</span>
            </p>
            <p class="chain-hint">
              下面是受本特殊链路影响的招式所用链路（按伤害类型各列一份），
              完整乘区顺序取自链路自身；<span class="chain-hint-mark">橙色格子</span>为本特殊链路覆盖 / 新增的乘区。
            </p>
            <div
              v-for="view in selectedRow.schemeChainViews"
              :key="view.chainId"
              class="chain-scheme-view"
            >
              <p class="chain-scheme-view-head">
                链路：<strong>{{ view.label }}</strong>
                <span class="mono">{{ view.chainId }}</span>
              </p>
              <div class="chain-stage-grid">
                <div
                  v-for="stage in view.stages"
                  :key="`scheme-${view.chainId}-${stage.id}`"
                  class="chain-stage-cell"
                  :class="[
                    `chain-stage-cell--${stage.kind}`,
                    { 'is-scheme-override': stage.overriddenByScheme },
                  ]"
                >
                  <div class="cell-head">
                    <span class="cell-kind">{{ STAGE_KIND_LABELS[stage.kind] ?? stage.kind }}</span>
                    <span class="cell-order">{{ stage.order }}</span>
                  </div>
                  <span v-if="stage.overriddenByScheme" class="cell-scheme-badge">方案覆盖</span>
                  <span class="cell-label">{{ stage.label }}</span>
                  <span
                    v-if="isAnomalyStage(stage)"
                    class="cell-actor"
                    :class="`cell-actor--${stageActor(stage)}`"
                  >
                    {{ ACTOR_LABELS[stageActor(stage)] }}
                  </span>
                  <span class="cell-module mono">{{ stage.module || '—' }}</span>
                  <span v-if="stage.params" class="cell-detail mono">{{ describeParams(stage.params) }}</span>
                  <span v-if="stage.when" class="cell-detail mono">条件 {{ describeCondition(stage.when) }}</span>
                </div>
              </div>
            </div>
            <p v-if="!selectedRow.schemeChainViews?.length" class="chain-hint">
              目标下没有可套用的招式链路，只能看到方案条目本身。
            </p>
            <p class="chain-hint">
              特殊链路只替换对应乘区（按作用域与条件生效），不单独预览结算结果。
            </p>
          </template>
        </template>
        <p v-else class="chain-hint">选择左侧链路查看乘区顺序。</p>
      </div>
    </div>

    <!-- 链路一致性核查：全角色 × 全招式，链路解析结果与常规推导不一致的条目 -->
    <section class="chain-audit">
      <header class="chain-header">
        <h4 class="chain-title">链路一致性核查</h4>
        <span class="chain-count">
          {{ chainAuditSummary.length ? `${chainAuditSummary.length} 个角色存在差异` : '全部一致' }}
        </span>
      </header>
      <p class="chain-hint">
        按角色职业推导常规链路（命破 → 命破链路、锋御 → 锐化链路、其余 → 按伤害类型），
        再对每条招式跑真实解析（含数据库覆盖）。链路 id 或阶段（顺序 / 模块 / 条件 / 参数）
        与常规不一致的角色列在下面，展开可看具体是哪些招式、差在哪。
        条件类链路在管理端没有面板上下文，按「条件可能成立」参与比对；
        角色 / 招式专属特殊链路已并入上方链路列表。
      </p>
      <p v-if="!chainAuditSummary.length" class="chain-empty">所有角色的所有招式都走常规链路，没有角色专属 / 招式专属差异。</p>
      <div v-for="item in chainAuditSummary" :key="item.agentId" class="chain-audit-agent">
        <button
          type="button"
          class="chain-audit-head"
          :aria-expanded="auditExpandedAgentId === item.agentId"
          @click="toggleAuditAgent(item.agentId)"
        >
          <strong>{{ item.agentName }}</strong>
          <span class="list-meta">
            {{ item.profession || '无职业' }} · {{ item.skillCount }} 条招式
            <template v-if="item.chainId"> · 生效链路 {{ item.chainId }}</template>
            · 链路差异 {{ item.chainMismatchCount }} / 乘区差异 {{ item.stageDiffCount }}
          </span>
          <span class="chain-audit-toggle">{{ auditExpandedAgentId === item.agentId ? '收起' : '展开' }}</span>
        </button>
        <div v-if="auditExpandedAgentId === item.agentId" class="chain-audit-detail">
          <div v-for="row in item.rows" :key="row.skillId" class="chain-audit-row">
            <div class="chain-audit-row-head">
              <strong>{{ row.skillName }}</strong>
              <span class="list-meta mono">{{ row.damageType }}</span>
              <span class="list-meta">
                <template v-if="row.chainMismatch">
                  链路专属 · {{ row.expectedChainId }} → {{ row.resolvedChainId }}
                </template>
                <template v-else>链路相同，乘区有差异</template>
              </span>
            </div>
            <p class="chain-audit-stages">
              <span>常规（{{ row.expectedChainId }}）：{{ auditStageLabels(row.expectedStages) || '—' }}</span>
              <span>实际（{{ row.resolvedChainId }}）：{{ auditStageLabels(row.resolvedStages) || '—' }}</span>
            </p>
            <ul v-if="row.stageDiffs.length" class="chain-audit-diffs">
              <li v-for="diff in row.stageDiffs" :key="`${row.skillId}-${diff.stageId}`">
                <span class="chain-audit-diff-kind" :class="`is-${diff.kind}`">
                  {{ diff.kind === 'missing' ? '缺失' : diff.kind === 'extra' ? '新增' : '变化' }}
                </span>
                <strong>{{ diff.label }}</strong> · {{ diff.detail }}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="authDialogVisible" class="auth-mask">
        <div class="auth-card">
          <h3>管理员登录已失效</h3>
          <p>请重新登录后查看计算链路。</p>
          <button type="button" class="primary-btn" @click="goRelogin">去登录</button>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
/* 内置链路 / 内置乘区方案：用背景色与数据库行区分 */
.chain-list .list-item.is-builtin:not(.active) {
  background: color-mix(in srgb, #6f9fd0 12%, var(--color-background-soft));
  border-color: color-mix(in srgb, #6f9fd0 34%, var(--color-border));
}

/* 乘区归属徽标：提供者（蓝）/ 触发者（金）/ 共用（灰） */
.cell-actor {
  align-self: flex-start;
  padding: 0 0.4rem;
  border-radius: 999px;
  font-size: 0.62rem;
  font-weight: 700;
  white-space: nowrap;
}

.cell-actor--producer {
  background: rgba(111, 159, 208, 0.2);
  color: #9cc4ef;
}

.cell-actor--trigger {
  background: rgba(201, 165, 92, 0.2);
  color: #e8c97d;
}

.cell-actor--mixed {
  background: rgba(148, 163, 184, 0.2);
  color: #c3ccd8;
}

.cell-actor--result {
  background: rgba(127, 211, 164, 0.2);
  color: #b9f0cd;
}

.chain-actor-legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0.2rem 0 0.5rem;
  font-size: 0.72rem;
  color: var(--color-text);
  opacity: 0.9;
}

.chain-scheme-view {
  margin-bottom: 0.8rem;
}

.chain-scheme-view-head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0.2rem 0 0.35rem;
  font-size: 0.8rem;
  color: var(--color-heading);
}

.chain-scheme-view-head .mono {
  opacity: 0.7;
}

.chain-hint-mark {
  color: #b98a2e;
  font-weight: 700;
}

/* 被乘区方案覆盖 / 新增的格子：橙色底 + 描边，与链路自身乘区区分 */
.chain-stage-cell.is-scheme-override {
  background: color-mix(in srgb, #c9a55c 16%, var(--color-background-soft));
  border-color: color-mix(in srgb, #c9a55c 55%, var(--color-border));
}

.cell-scheme-badge {
  align-self: flex-start;
  padding: 0 0.4rem;
  border-radius: 999px;
  background: rgba(201, 165, 92, 0.24);
  color: #b98a2e;
  font-size: 0.64rem;
  font-weight: 700;
}

.chain-display-layout {
  display: grid;
  grid-template-columns: minmax(15rem, 20rem) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

.chain-list {
  max-height: none;
}

.chain-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.chain-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-heading);
}

.chain-count {
  font-size: 0.75rem;
  opacity: 0.7;
}

.chain-empty,
.chain-hint {
  font-size: 0.8rem;
  opacity: 0.75;
  margin: 0.3rem 0;
}

/* ---- 作用域筛选（一级层级 + 二级目标，多选 chips） ---- */

.chain-filter-block {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0.4rem 0;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft);
}

.chain-filter-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.chain-filter-label {
  flex: 0 0 auto;
  font-size: 0.74rem;
  font-weight: 700;
  color: var(--color-heading);
  opacity: 0.8;
  min-width: 2.6rem;
}

.chain-filter-empty {
  font-size: 0.72rem;
  opacity: 0.6;
}

.chip {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: transparent;
  color: var(--color-text);
  padding: 0.15rem 0.55rem;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.chip.active {
  border-color: hsla(160, 100%, 37%, 0.6);
  background: hsla(160, 100%, 37%, 0.12);
  color: var(--color-heading);
  font-weight: 700;
}

/* ---- 链路一致性核查 ---- */

.chain-audit {
  margin-top: 1rem;
  padding-top: 0.8rem;
  border-top: 1px solid var(--color-border);
}

.chain-audit-agent {
  margin-top: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft);
  overflow: hidden;
}

.chain-audit-head {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  width: 100%;
  padding: 0.5rem 0.7rem;
  border: none;
  background: transparent;
  color: var(--color-heading);
  font-size: 0.85rem;
  text-align: left;
  cursor: pointer;
}

.chain-audit-head:hover {
  background: color-mix(in srgb, var(--color-background-mute) 60%, transparent);
}

.chain-audit-toggle {
  margin-left: auto;
  font-size: 0.72rem;
  opacity: 0.7;
  text-decoration: underline;
  white-space: nowrap;
}

.chain-audit-detail {
  padding: 0.2rem 0.7rem 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.chain-audit-row {
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
}

.chain-audit-row-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.4rem 0.6rem;
}

.chain-audit-stages {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin: 0.3rem 0 0;
  font-size: 0.72rem;
  opacity: 0.78;
  word-break: break-all;
}

.chain-audit-diffs {
  margin: 0.3rem 0 0;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.72rem;
  line-height: 1.5;
  color: var(--color-text);
}

.chain-audit-diff-kind {
  display: inline-block;
  margin-right: 0.3rem;
  padding: 0 0.35rem;
  border-radius: 4px;
  font-size: 0.66rem;
  font-weight: 700;
}

.chain-audit-diff-kind.is-changed {
  background: rgba(201, 165, 92, 0.22);
  color: #f0d79a;
}

.chain-audit-diff-kind.is-extra {
  background: rgba(91, 141, 239, 0.24);
  color: #b9d2ff;
}

.chain-audit-diff-kind.is-missing {
  background: rgba(239, 108, 108, 0.2);
  color: #ffc1c1;
}

.chain-audit-chip {
  display: inline-block;
  padding: 0 0.4rem;
  border: 1px solid rgba(201, 165, 92, 0.5);
  border-radius: 999px;
  background: rgba(201, 165, 92, 0.12);
  color: #e8c97d;
  font-size: 0.68rem;
}

.chain-display-detail {
  min-width: 0;
}

.chain-stage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
  gap: 0.5rem;
  margin: 0.6rem 0 1rem;
}

.chain-stage-cell {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-left-width: 3px;
  border-radius: 0.5rem;
  background: var(--color-background-soft);
  min-height: 4.5rem;
}

/* 阶段类型分色：source 蓝、multiplier 金、combine 紫、final 绿；标签不再一律灰 */
.chain-stage-cell--source {
  border-left-color: #5b8def;
}

.chain-stage-cell--multiplier {
  border-left-color: #c9a55c;
}

.chain-stage-cell--combine {
  border-left-color: #a58be0;
}

.chain-stage-cell--final {
  border-color: rgba(250, 204, 21, 0.55);
  border-left-color: #7fd3a4;
}

.cell-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
}

.cell-kind {
  padding: 0 0.4rem;
  border-radius: 999px;
  font-size: 0.66rem;
  font-weight: 700;
}

.chain-stage-cell--source .cell-kind {
  background: rgba(91, 141, 239, 0.2);
  color: #b9d2ff;
}

.chain-stage-cell--multiplier .cell-kind {
  background: rgba(201, 165, 92, 0.2);
  color: #f0d79a;
}

.chain-stage-cell--combine .cell-kind {
  background: rgba(165, 139, 224, 0.2);
  color: #d9ccff;
}

.chain-stage-cell--final .cell-kind {
  background: rgba(127, 211, 164, 0.2);
  color: #b9f0cd;
}

.cell-order {
  font-size: 0.68rem;
  opacity: 0.85;
}

.cell-label {
  font-size: 0.85rem;
  font-weight: 600;
  line-height: 1.25;
  color: var(--color-heading);
}

.cell-module,
.cell-detail {
  font-size: 0.68rem;
  word-break: break-all;
}

.cell-module {
  color: var(--color-heading);
  opacity: 0.9;
}

.cell-detail {
  opacity: 0.75;
}

.chain-preview {
  margin-top: 0.8rem;
}

.chain-preview-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.45rem;
}

.preview-sample-select {
  flex: 1 1 auto;
  max-width: 14rem;
  min-width: 8rem;
}

.chain-preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
  gap: 0.4rem;
}

.preview-cell {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 0.4rem;
  background: var(--color-background-soft);
}

.preview-kind {
  font-size: 0.66rem;
  opacity: 0.7;
}

.preview-label {
  font-size: 0.78rem;
}

.preview-value {
  font-size: 0.85rem;
  font-weight: 600;
}

.auth-mask {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(2, 6, 23, 0.6);
  z-index: 60;
}

.auth-card {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 0.6rem;
  padding: 1.2rem 1.4rem;
  min-width: 16rem;
}

</style>

<style>
/*
 * 白天模式：阶段类型的彩色标签与差异徽标改深字（浅底可读）。
 * 卡片 / 格子底色统一走主题变量（--color-background-soft），与其它管理端面板同步；
 * 组件内 :global 选择器编译后不可靠，所以浅色覆盖写在这个非 scoped 块里。
 */
[data-theme='light'] .chain-stage-cell--source .cell-kind {
  color: #2f5fae;
}

[data-theme='light'] .chain-stage-cell--multiplier .cell-kind {
  color: #8a6a1f;
}

[data-theme='light'] .chain-stage-cell--combine .cell-kind {
  color: #5f4a9e;
}

[data-theme='light'] .chain-stage-cell--final .cell-kind {
  color: #2f7a52;
}

[data-theme='light'] .chain-audit-diff-kind.is-changed {
  color: #8a6a1f;
}

[data-theme='light'] .chain-audit-diff-kind.is-extra {
  color: #2f5fae;
}

[data-theme='light'] .chain-audit-diff-kind.is-missing {
  color: #a33b3b;
}

[data-theme='light'] .chain-audit-chip {
  color: #8a6a1f;
}

[data-theme='light'] .cell-actor--producer {
  color: #2f5fae;
}

[data-theme='light'] .cell-actor--trigger {
  color: #8a6a1f;
}

[data-theme='light'] .cell-actor--mixed {
  color: #5a6572;
}
</style>
