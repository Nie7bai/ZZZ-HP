/**
 * 乘区方案（Phase 3a）：把角色/招式特例从计算链路里挪到「方案 + 条件」。
 *
 * 纯函数、不依赖 Vue、不读写全局状态：解析只读调用方给的 `hit` 与 `panelContext`。
 * 本阶段只承接叶瞬光帷幕易伤，行为与改造前的硬编码判定完全一致（黄金对照把关）。
 *
 * 作用域覆盖顺序（后者覆盖前者，按条目 `key` 整条替换）：
 * `global < profession < agent < skillGroup < skill < priority`
 * —— 顺序只影响展示与处理顺序，不改变连乘语义。
 */

/** 方案作用域：越靠后越具体，覆盖越靠前的方案 */
export type ZoneScope = 'global' | 'profession' | 'agent' | 'skillGroup' | 'skill'

const ZONE_SCOPE_RANK: Record<ZoneScope, number> = {
  global: 0,
  profession: 1,
  agent: 2,
  skillGroup: 3,
  skill: 4,
}

/** 条件白名单变量：只暴露确定存在的字段，避免任意表达式 */
export type ZoneConditionVariable =
  | 'agentId'
  | 'profession'
  | 'mindscapeRank'
  | 'element'
  | 'skillId'
  | 'skillName'
  | 'skillTypes'
  | 'damageKind'
  | 'anomalySubKind'
  | 'directSubKind'
  | 'ownerAgentId'
  | 'anomalyPowerAgentId'
  | 'triggerAgentId'
  | 'isFollowUp'

/**
 * 条件运算白名单。
 *
 * `contains` 用于字符串包含（如 `skillName contains 明心境`）与数组包含；
 * 它仍是封闭的运算集合，不接受任何字符串表达式。
 */
export type ZoneCompareOperator = 'eq' | 'neq' | 'in' | 'contains' | 'gte' | 'lte'

export type ZoneConditionValue = string | number | boolean | null

/** 单个比较；`op` 缺省 = `eq` */
export interface ZoneComparison {
  var: ZoneConditionVariable
  op?: ZoneCompareOperator
  value: ZoneConditionValue | readonly ZoneConditionValue[]
}

/** 条件表达式：比较 / and / or / not（普通对象，可 JSON 落库） */
export type ZoneCondition =
  | ZoneComparison
  | { and: readonly ZoneCondition[] }
  | { or: readonly ZoneCondition[] }
  | { not: ZoneCondition }

/** 帷幕易伤上限规则（倍率口径：2.1 = 210%） */
export interface ZoneCurtainCapRule {
  /** 未达提升影画时的上限 */
  default: number
  /** 达到提升影画后的上限 */
  rank4: number
  /** 提升上限所需影画，缺省 4 */
  rankThreshold?: number
}

/** 模块参数：帷幕用 `mode`/`cap`；自定义乘区用 `statKeys`/`cap`/`floor`/`allowNegative` */
export interface ZoneSchemeParams {
  /** 求值模式；`stagger` 模块的 `curtain` = 帷幕易伤（不分阶段 + 上限） */
  mode?: string
  cap?: ZoneCurtainCapRule | number
  /** 自定义乘区：参与加总的增益键（`custom` 修饰表） */
  statKeys?: readonly string[]
  /** 自定义乘区下限（倍率） */
  floor?: number
  /** 是否允许负值；缺省 true */
  allowNegative?: boolean
  /** 展示/处理顺序 */
  order?: number
  [param: string]: unknown
}

export interface ZoneSchemeEntry {
  /** 乘区键，例如 `stagger`；同键后应用的方案整条覆盖前一条 */
  key: string
  /** 求值模块（白名单名，本阶段只用到 `stagger`；自定义乘区为 `percentSum`） */
  module: string
  /** 展示名；缺省回落到注册表或 key */
  label?: string
  params?: ZoneSchemeParams
  /** 附加条件；缺省 = 恒成立 */
  when?: ZoneCondition
}

export interface ZoneScheme {
  scope: ZoneScope
  /** global 为空；profession = 职业；agent = 角色 id；skillGroup = 技能组 id；skill = 招式 id */
  targetId: string
  /** 同作用域内的覆盖顺序：大的后应用（覆盖小的） */
  priority: number
  entries: readonly ZoneSchemeEntry[]
}

/** 方案解析读取的命中信息（`ResolvedHit` 的结构子集） */
export interface ZoneSchemeHit {
  skill: {
    id: string
    name: string
    agentId: string
    skillTypes?: readonly string[]
    ownerGroupId?: string | null
  }
  ownerAgentId?: string | null
  anomalyPowerAgentId?: string | null
  triggerAgentId?: string | null
  damageKind?: string
  anomalySubKind?: string
  directSubKind?: string
  isFollowUp?: boolean
  elementOverride?: string | null
}

/** 方案解析读取的面板上下文（`PanelCalcContext` 的结构子集） */
export interface ZoneSchemePanelContext {
  teamSlots: ReadonlyArray<{ agentId: string; rank?: number }>
  agents: ReadonlyArray<{ id: string; profession?: string | null; element?: string | null }>
}

/** 解析时快照的命中上下文，供上限计算与诊断使用 */
export interface ZoneResolvedContext {
  agentId: string
  profession: string | null
  element: string | null
  /** 招式归属角色在队伍槽位的影画，已 clamp 0–6 */
  mindscapeRank: number
  skillId: string
  skillName: string
  skillGroupId: string | null
}

export interface ResolvedZoneEntry extends ZoneSchemeEntry {
  /** 提供该条目的方案作用域（诊断/展示用，不参与求值） */
  sourceScope: ZoneScope
  sourceTargetId: string
  sourcePriority: number
}

export interface ResolvedZoneScheme {
  /** 按 key 合并后的条目；键插入顺序 = 首次定义顺序 */
  entries: Record<string, ResolvedZoneEntry>
  context: ZoneResolvedContext
}

/** 帷幕易伤所在的乘区键 */
export const CURTAIN_ZONE_KEY = 'stagger'

/** 叶瞬光：含「明心境」的招式 + 两个终结技 + 登场技，使用「帷幕易伤」而非普通失衡易伤 */
const YESHUNGUANG_CURTAIN_SKILL_NAME_KEYWORD = '明心境'
const YESHUNGUANG_CURTAIN_SKILL_NAMES: readonly string[] = [
  '终结技：逐云惊霆',
  '终结技：斩妄开天',
  '登场技：照影',
]

/**
 * 内置方案（零配置可用）。
 *
 * 与改造前的硬编码判定逐条对应：作用域限定叶瞬光，条件限定招式名；
 * 上限规则随影画变化，由 `resolveCurtainCap` 按解析时的影画取。
 */
export const BUILT_IN_ZONE_SCHEMES: readonly ZoneScheme[] = Object.freeze([
  {
    scope: 'agent',
    targetId: 'yeshunguang',
    priority: 10,
    entries: [
      {
        key: CURTAIN_ZONE_KEY,
        module: 'stagger',
        params: {
          mode: 'curtain',
          cap: { default: 2.1, rank4: 3, rankThreshold: 4 },
        },
        when: {
          or: [
            { var: 'skillName', op: 'contains', value: YESHUNGUANG_CURTAIN_SKILL_NAME_KEYWORD },
            { var: 'skillName', op: 'in', value: YESHUNGUANG_CURTAIN_SKILL_NAMES },
          ],
        },
      },
    ],
  },
])

function isZoneScope(value: string): value is ZoneScope {
  return Object.prototype.hasOwnProperty.call(ZONE_SCOPE_RANK, value)
}

function isConditionValueArray(value: unknown): value is readonly ZoneConditionValue[] {
  return Array.isArray(value)
}

/** 影画：四舍五入后 clamp 0–6（与改造前的槽位取法一致） */
export function clampZoneMindscapeRank(rank: number | null | undefined): number {
  const safe = Number(rank)
  const rounded = Number.isFinite(safe) ? Math.round(safe) : 0
  return Math.min(6, Math.max(0, rounded))
}

function resolveZoneMindscapeRank(
  teamSlots: ZoneSchemePanelContext['teamSlots'],
  agentId: string,
): number {
  const slot = teamSlots.find((item) => item.agentId === agentId)
  return clampZoneMindscapeRank(slot?.rank)
}

function buildResolvedContext(
  hit: ZoneSchemeHit,
  panelContext: ZoneSchemePanelContext,
): ZoneResolvedContext {
  const agentId = hit.skill.agentId
  const agent = panelContext.agents.find((item) => item.id === agentId)
  const elementOverride = hit.elementOverride?.trim()
  return {
    agentId,
    profession: agent?.profession ?? null,
    element: elementOverride || agent?.element || null,
    mindscapeRank: resolveZoneMindscapeRank(panelContext.teamSlots, agentId),
    skillId: hit.skill.id,
    skillName: hit.skill.name,
    skillGroupId: hit.skill.ownerGroupId?.trim() || null,
  }
}

function readConditionValue(
  variable: ZoneConditionVariable,
  hit: ZoneSchemeHit,
  context: ZoneResolvedContext,
): ZoneConditionValue | readonly string[] {
  switch (variable) {
    case 'agentId':
      return context.agentId
    case 'profession':
      return context.profession
    case 'mindscapeRank':
      return context.mindscapeRank
    case 'element':
      return context.element
    case 'skillId':
      return context.skillId
    case 'skillName':
      return context.skillName
    case 'skillTypes':
      return hit.skill.skillTypes ?? []
    case 'damageKind':
      return hit.damageKind ?? null
    case 'anomalySubKind':
      return hit.anomalySubKind ?? null
    case 'directSubKind':
      return hit.directSubKind ?? null
    case 'ownerAgentId':
      return hit.ownerAgentId ?? null
    case 'anomalyPowerAgentId':
      return hit.anomalyPowerAgentId ?? null
    case 'triggerAgentId':
      return hit.triggerAgentId ?? null
    case 'isFollowUp':
      return Boolean(hit.isFollowUp)
    default:
      return null
  }
}

/** 相等：数组按逐元素比较；标量与数组不相等 */
function isSameValue(
  actual: ZoneConditionValue | readonly string[],
  expected: ZoneConditionValue | readonly ZoneConditionValue[],
): boolean {
  if (isConditionValueArray(expected)) {
    if (!isConditionValueArray(actual)) return false
    return actual.length === expected.length
      && actual.every((value, index) => value === expected[index])
  }
  if (isConditionValueArray(actual)) return false
  return actual === expected
}

function compareCondition(
  actual: ZoneConditionValue | readonly string[],
  operator: ZoneCompareOperator,
  expected: ZoneConditionValue | readonly ZoneConditionValue[],
): boolean {
  switch (operator) {
    case 'eq':
      return isSameValue(actual, expected)
    case 'neq':
      return !isSameValue(actual, expected)
    case 'in': {
      const list = isConditionValueArray(expected) ? expected : [expected]
      return isConditionValueArray(actual)
        ? actual.some((value) => list.includes(value))
        : list.includes(actual)
    }
    case 'contains': {
      if (isConditionValueArray(actual)) {
        const list = isConditionValueArray(expected) ? expected : [expected]
        return list.some((value) => actual.some((item) => item === value))
      }
      if (isConditionValueArray(expected)) {
        return typeof actual === 'string' && expected.includes(actual)
      }
      return typeof actual === 'string' && typeof expected === 'string'
        ? actual.includes(expected)
        : false
    }
    case 'gte':
    case 'lte': {
      if (isConditionValueArray(actual) || isConditionValueArray(expected)) return false
      const left = Number(actual)
      const right = Number(expected)
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false
      return operator === 'gte' ? left >= right : left <= right
    }
    default:
      return false
  }
}

/**
 * 条件求值：只读 `hit` 与 `panelContext`。
 *
 * `context` 是已解析的上下文快照（缺省时现算，递归内部复用），不是全局状态。
 * 未知变量/未知运算一律判为不成立（宁可保持原行为，也不因脏配置误启用特例）。
 */
export function evaluateZoneCondition(
  condition: ZoneCondition | null | undefined,
  hit: ZoneSchemeHit,
  panelContext: ZoneSchemePanelContext,
  context: ZoneResolvedContext = buildResolvedContext(hit, panelContext),
): boolean {
  if (!condition) return true
  if ('and' in condition) {
    return condition.and.every((item) => evaluateZoneCondition(item, hit, panelContext, context))
  }
  if ('or' in condition) {
    return condition.or.some((item) => evaluateZoneCondition(item, hit, panelContext, context))
  }
  if ('not' in condition) {
    return !evaluateZoneCondition(condition.not, hit, panelContext, context)
  }

  const variable = condition.var
  if (!variable) return false
  const actual = readConditionValue(variable, hit, context)
  return compareCondition(actual, condition.op ?? 'eq', condition.value)
}

function schemeTargetMatches(
  scheme: ZoneScheme,
  context: ZoneResolvedContext,
): boolean {
  if (scheme.scope === 'global') return true
  // 空 targetId 只对 global 有意义：公共招式的 agentId 也是空串，不能让它误命中
  if (!scheme.targetId) return false
  switch (scheme.scope) {
    case 'profession':
      return context.profession === scheme.targetId
    case 'agent':
      return context.agentId === scheme.targetId
    case 'skillGroup':
      return context.skillGroupId === scheme.targetId
    case 'skill':
      return context.skillId === scheme.targetId
    default:
      return false
  }
}

interface SchemeCandidate {
  scheme: ZoneScheme
  rank: number
  index: number
}

/**
 * 解析命中生效的方案：按作用域 + priority 决定应用顺序，再按 `key` 合并条目。
 *
 * 未知 scope 直接忽略（脏配置不参与计算）。
 */
export function resolveZoneScheme(options: {
  hit: ZoneSchemeHit
  panelContext: ZoneSchemePanelContext
  schemes?: readonly ZoneScheme[]
}): ResolvedZoneScheme {
  const { hit, panelContext } = options
  const schemes = options.schemes ?? BUILT_IN_ZONE_SCHEMES
  const context = buildResolvedContext(hit, panelContext)

  const candidates: SchemeCandidate[] = []
  schemes.forEach((scheme, index) => {
    const scope = String(scheme.scope ?? '')
    if (!isZoneScope(scope)) return
    if (!schemeTargetMatches({ ...scheme, scope }, context)) return
    candidates.push({ scheme, rank: ZONE_SCOPE_RANK[scope], index })
  })
  candidates.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank
    if (a.scheme.priority !== b.scheme.priority) return a.scheme.priority - b.scheme.priority
    return a.index - b.index
  })

  const entries: Record<string, ResolvedZoneEntry> = {}
  for (const { scheme } of candidates) {
    for (const entry of scheme.entries) {
      if (!evaluateZoneCondition(entry.when, hit, panelContext, context)) continue
      entries[entry.key] = {
        ...entry,
        sourceScope: scheme.scope,
        sourceTargetId: scheme.targetId,
        sourcePriority: scheme.priority,
      }
    }
  }

  return { entries, context }
}

/**
 * 帷幕易伤上限：按解析时的影画取 `cap` 规则。
 *
 * 未命中方案、条目不是 `mode:'curtain'`、或没有 `cap` 规则 → `null`（走普通失衡易伤）。
 */
export function resolveCurtainCap(
  resolved: ResolvedZoneScheme | null | undefined,
  key: string = CURTAIN_ZONE_KEY,
): number | null {
  const entry = resolved?.entries[key]
  const params = entry?.params
  if (!params || params.mode !== 'curtain') return null
  const cap = params.cap
  if (!cap || typeof cap !== 'object') return null
  if (typeof cap.default !== 'number' || typeof cap.rank4 !== 'number') return null
  const threshold = typeof cap.rankThreshold === 'number' ? cap.rankThreshold : 4
  const rank = clampZoneMindscapeRank(resolved?.context.mindscapeRank)
  return rank >= threshold ? cap.rank4 : cap.default
}
