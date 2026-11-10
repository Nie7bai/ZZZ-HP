import pool from '../config/db.js'

/**
 * 乘区定义 / 乘区方案（Phase 4a 数据层，口径见 dev-docs/zone-modularization-plan.md 第四、十节）。
 *
 * - 定义（definitions）：`zone_key` + 展示元数据 + 求值原语（白名单）+ 原语参数 + 可吃增益键；
 * - 方案（schemes）：某个作用域里对定义的引用顺序与覆盖，`rules` 即方案文档里的 zones 数组。
 *
 * 本文件只负责存取与校验，不做合并/计算：运行时按
 * global → profession → agent → skill_group → skill 合并（见方案文档第二节）。
 *
 * 建表由本服务惰性自愈（与 skillGroupService 同一模式），不改 init_schema.sql 里的既有表；
 * 表为空时计算侧仍走代码内置默认方案，因此这里没有种子数据。
 */

const DEFINITIONS_TABLE = 'calculator_zone_definitions'
const SCHEMES_TABLE = 'calculator_zone_schemes'

/** 作用域枚举；顺序即合并优先级（global 最弱，skill 最强） */
export const ZONE_SCOPES = Object.freeze([
  'global',
  'profession',
  'agent',
  'skill_group',
  'skill',
])

/**
 * 求值原语白名单（占位，与方案文档 10.5 一致）。
 * 与前端 `zzz-hp/src/zones/primitives.ts` 的 id 对齐，后续补齐原语时同步改这里。
 */
export const ZONE_PRIMITIVES = Object.freeze([
  'percentSum',
  'panel.percent',
  'stagger',
  'vulnerable',
])

/** 方案条目动作：inherit=继承定义（默认）、replace=整条替换、disable=禁用 */
export const ZONE_RULE_ACTIONS = Object.freeze(['inherit', 'replace', 'disable'])

/** 提供者范围（方案文档 10.5）：owner=仅所有者、team=所有者+队友（默认）、all=含邦布/场地 */
export const ZONE_PROVIDER_SCOPES = Object.freeze(['owner', 'team', 'all'])

/** 展示位置（方案文档 10.5 展示表） */
export const ZONE_PANEL_MODES = Object.freeze(['none', 'inCombat', 'outOfCombat', 'both'])

/** 条件变量白名单（方案文档第九节 C）：只允许这些变量，避免任意表达式 */
export const ZONE_CONDITION_VARIABLES = Object.freeze([
  'agentId',
  'profession',
  'mindscapeRank',
  'element',
  'skillId',
  'skillName',
  'skillTypes',
  'damageKind',
  'anomalySubKind',
  'directSubKind',
  'ownerAgentId',
  'anomalyPowerAgentId',
  'triggerAgentId',
  'isFollowUp',
  'staggerPhase',
  'monsterCategory',
  'resistanceType',
])

/** 条件比较运算 */
export const ZONE_CONDITION_COMPARATORS = Object.freeze(['==', '!=', 'in', '>=', '<='])

/** 条件运算全集（含逻辑组合） */
export const ZONE_CONDITION_OPERATORS = Object.freeze([
  '==',
  '!=',
  'in',
  '>=',
  '<=',
  'and',
  'or',
  'not',
])

const ZONE_KEY_MAX_LENGTH = 64
const LABEL_MAX_LENGTH = 100
const SCHEME_NAME_MAX_LENGTH = 100
const TARGET_ID_MAX_LENGTH = 64
const UPDATED_BY_MAX_LENGTH = 64
const DEFAULT_SORT_ORDER = 100
const DEFAULT_PRIORITY = 10
const SORT_ORDER_RANGE = Object.freeze({ min: 0, max: 100000 })
const PRIORITY_RANGE = Object.freeze({ min: 0, max: 1000 })
const VERSION_RANGE = Object.freeze({ min: 1, max: 1000000 })
const MAX_APPLIES_TO_ITEMS = 200
const MAX_RULES = 200
const MAX_CONDITION_DEPTH = 6
const MAX_CONDITION_NODES = 200
const MAX_CONDITION_ARRAY_ITEMS = 50
const MAX_CONDITION_TEXT_LENGTH = 128
const JSON_DEPTH_LIMIT = 6
const JSON_NODE_LIMIT = 500
const JSON_TEXT_LIMIT = 2000

const BUILTIN_ZONE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/
const CUSTOM_ZONE_KEY_PATTERN = /^custom:[A-Za-z0-9][A-Za-z0-9_-]*$/

const STAT_VALUE_TYPES = Object.freeze(['percent', 'flat', 'multiplier'])
const STAT_SIGNS = Object.freeze(['increase', 'decrease', 'both'])
const APPLIES_TO_KEYS = Object.freeze(['damageKinds', 'agents', 'skills', 'providers'])

const DEFINITION_INPUT_ALIASES = Object.freeze({
  zoneKey: ['zoneKey', 'zone_key', 'key'],
  sortOrder: ['sortOrder', 'sort_order'],
  appliesTo: ['appliesTo', 'applies_to'],
  primitive: ['primitive', 'module'],
  updatedBy: ['updatedBy', 'updated_by'],
  targetId: ['targetId', 'target_id'],
})

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function pick(input, aliasKey) {
  for (const name of DEFINITION_INPUT_ALIASES[aliasKey] || [aliasKey]) {
    if (input?.[name] !== undefined) return input[name]
  }
  return undefined
}

/** 可读的校验/冲突错误：`status` 供路由映射 HTTP 码，`code` 供前端区分分支 */
function zoneConfigError(message, { code = 'INVALID_ZONE_PAYLOAD', status = 400, details = null } = {}) {
  const err = new Error(message)
  err.code = code
  err.status = status
  err.details = details
  return err
}

function invalid(message, details = null) {
  return zoneConfigError(message, { details })
}

function parseJson(value, fallback) {
  if (value == null) return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(String(value))
  } catch {
    return fallback
  }
}

function readBoolean(value, field, fallback = false) {
  if (value == null || value === '') return fallback
  if (typeof value === 'boolean') return value
  if (value === 0 || value === 1) return value === 1
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (text === 'true' || text === '1') return true
    if (text === 'false' || text === '0') return false
  }
  throw invalid(`${field} 必须是布尔值`)
}

function readInteger(value, field, { min, max, fallback } = {}) {
  if (value == null || value === '') {
    if (fallback === undefined) throw invalid(`${field} 为必填项`)
    return fallback
  }
  const num = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isInteger(num)) throw invalid(`${field} 必须是整数`)
  if (min != null && num < min) throw invalid(`${field} 不能小于 ${min}`)
  if (max != null && num > max) throw invalid(`${field} 不能大于 ${max}`)
  return num
}

function readOptionalInteger(value, field, range) {
  if (value == null || value === '') return null
  return readInteger(value, field, range)
}

function readRequiredText(value, field, maxLength) {
  if (typeof value !== 'string') throw invalid(`${field} 必须是字符串`)
  const text = value.trim()
  if (!text) throw invalid(`${field} 不能为空`)
  if (maxLength && text.length > maxLength) throw invalid(`${field} 长度不能超过 ${maxLength}`)
  return text
}

function readOptionalText(value, field, maxLength) {
  if (value == null) return ''
  if (typeof value !== 'string') throw invalid(`${field} 必须是字符串`)
  const text = value.trim()
  if (maxLength && text.length > maxLength) throw invalid(`${field} 长度不能超过 ${maxLength}`)
  return text
}

/** JSON 列的安全网：拒绝 NaN/Infinity、函数/类实例与过深过大的结构（避免写库时抛类型错） */
function assertJsonSafeValue(value, field, { depth = 0, budget = { nodes: 0 } } = {}) {
  if (depth > JSON_DEPTH_LIMIT) throw invalid(`${field} 嵌套层级过深（上限 ${JSON_DEPTH_LIMIT}）`)
  budget.nodes += 1
  if (budget.nodes > JSON_NODE_LIMIT) throw invalid(`${field} 结构过于复杂（节点上限 ${JSON_NODE_LIMIT}）`)
  if (value == null) return
  const type = typeof value
  if (type === 'string') {
    if (value.length > JSON_TEXT_LIMIT) throw invalid(`${field} 含超长字符串（上限 ${JSON_TEXT_LIMIT}）`)
    return
  }
  if (type === 'number') {
    if (!Number.isFinite(value)) throw invalid(`${field} 含非法数字`)
    return
  }
  if (type === 'boolean') return
  if (Array.isArray(value)) {
    for (const item of value) {
      assertJsonSafeValue(item, field, { depth: depth + 1, budget })
    }
    return
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (!key || key.length > ZONE_KEY_MAX_LENGTH) {
        throw invalid(`${field} 含非法字段名（长度 1–${ZONE_KEY_MAX_LENGTH}）`)
      }
      assertJsonSafeValue(child, `${field}.${key}`, { depth: depth + 1, budget })
    }
    return
  }
  throw invalid(`${field} 含不支持的值类型：${type}`)
}

/** 自定义乘区键：必须先在定义表登记（内置键由代码目录提供，允许库里没有行） */
export function isCustomZoneKey(value) {
  return typeof value === 'string' && CUSTOM_ZONE_KEY_PATTERN.test(value.trim())
}

/**
 * zone_key 口径：内置键（如 `dmgMultiplier`、`stagger`）或 `custom:<slug>`
 * （如 `custom:eliteBonus`）。唯一性由 `uk_zone_key` 与写库前的存在性检查共同保证。
 */
export function isValidZoneKey(value) {
  if (typeof value !== 'string') return false
  const key = value.trim()
  if (!key || key.length > ZONE_KEY_MAX_LENGTH) return false
  // `custom` / `custom:*` 一律按自定义键校验，避免内置键与自定义前缀混淆
  if (key === 'custom' || key.startsWith('custom:')) return CUSTOM_ZONE_KEY_PATTERN.test(key)
  return BUILTIN_ZONE_KEY_PATTERN.test(key)
}

export function validateZoneKey(value, field = 'zone_key') {
  const key = readRequiredText(value, field, ZONE_KEY_MAX_LENGTH)
  if (!isValidZoneKey(key)) {
    throw invalid(
      `${field} 格式非法：内置键形如 dmgMultiplier，自定义键形如 custom:eliteBonus（仅字母/数字/下划线/连字符/点，最长 ${ZONE_KEY_MAX_LENGTH}）`,
    )
  }
  return key
}

export function validateZoneScope(value) {
  const scope = readRequiredText(value, 'scope', 32)
  if (!ZONE_SCOPES.includes(scope)) {
    throw invalid(`scope 非法：只允许 ${ZONE_SCOPES.join(' / ')}`)
  }
  return scope
}

export function validateZonePrimitive(value) {
  const primitive = readRequiredText(value, 'primitive', ZONE_KEY_MAX_LENGTH)
  if (!ZONE_PRIMITIVES.includes(primitive)) {
    throw invalid(`primitive 不在白名单：只允许 ${ZONE_PRIMITIVES.join(' / ')}`)
  }
  return primitive
}

function readStringList(value, field, { maxItems = MAX_APPLIES_TO_ITEMS } = {}) {
  if (value == null) return []
  if (!Array.isArray(value)) throw invalid(`${field} 必须是数组`)
  if (value.length > maxItems) throw invalid(`${field} 条目过多（上限 ${maxItems}）`)
  const seen = new Set()
  const list = []
  for (const item of value) {
    if (typeof item !== 'string') throw invalid(`${field} 的每一项必须是非空字符串`)
    const text = item.trim()
    if (!text) throw invalid(`${field} 的每一项必须是非空字符串`)
    if (text.length > ZONE_KEY_MAX_LENGTH) {
      throw invalid(`${field} 的每一项长度不能超过 ${ZONE_KEY_MAX_LENGTH}`)
    }
    if (seen.has(text)) continue
    seen.add(text)
    list.push(text)
  }
  return list
}

/**
 * 适用范围（方案文档 10.5）：可多选伤害类型/角色/招式，任一命中即生效（OR），
 * 都不选 = 全部生效。
 *
 * 兼容两种入参：旧式数组（等价于 `{ damageKinds: [...] }`）与对象；
 * 对象里的 `providers` 只作读入兼容，对外由 `normalizeZoneProviders` 单独给出
 * （定义表没有独立列，落库时再并回 applies_to）。
 */
export function normalizeZoneAppliesTo(value) {
  let source = {}
  if (value == null) {
    source = {}
  } else if (Array.isArray(value)) {
    source = { damageKinds: value }
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (!APPLIES_TO_KEYS.includes(key)) {
        throw invalid(`applies_to 含未知字段 ${key}：只允许 ${APPLIES_TO_KEYS.join(' / ')}`)
      }
    }
    source = value
  } else {
    throw invalid('applies_to 必须是对象或伤害类型数组')
  }

  return {
    damageKinds: readStringList(source.damageKinds, 'applies_to.damageKinds'),
    agents: readStringList(source.agents, 'applies_to.agents'),
    skills: readStringList(source.skills, 'applies_to.skills'),
  }
}

/** 提供者范围（方案文档 10.5）：默认 team */
export function normalizeZoneProviders(value) {
  if (value == null || value === '') return 'team'
  const text = readRequiredText(value, 'providers', 32)
  if (!ZONE_PROVIDER_SCOPES.includes(text)) {
    throw invalid(`providers 非法：只允许 ${ZONE_PROVIDER_SCOPES.join(' / ')}`)
  }
  return text
}

/**
 * 原语参数：必须是对象；已知字段做类型/范围校验（上限 > 0），其余字段按原语各自解释。
 *
 * `cap` / `floor` 允许两种形态（与方案文档示例一致）：
 * - 数字：全场景统一值；
 * - 对象：按维度取值（如 `{ rank4: 3, default: 2.1 }`）。
 */
export function normalizeZoneParams(value) {
  if (value == null) return {}
  if (!isPlainObject(value)) throw invalid('params 必须是对象')
  assertJsonSafeValue(value, 'params')
  const params = { ...value }

  if (params.cap != null) {
    validateBound(params.cap, 'params.cap', { requirePositive: true })
  }
  if (params.floor != null) {
    validateBound(params.floor, 'params.floor', { requirePositive: false })
  }
  if (params.allowNegative != null) {
    params.allowNegative = readBoolean(params.allowNegative, 'params.allowNegative')
  }
  if (params.mode != null) {
    params.mode = readRequiredText(params.mode, 'params.mode', ZONE_KEY_MAX_LENGTH)
  }
  if (params.field != null) {
    params.field = readRequiredText(params.field, 'params.field', ZONE_KEY_MAX_LENGTH)
  }
  if (params.buffKeys != null) {
    params.buffKeys = readStringList(params.buffKeys, 'params.buffKeys')
  }
  if (params.phaseIndependent != null) {
    params.phaseIndependent = readBoolean(params.phaseIndependent, 'params.phaseIndependent')
  }
  return params
}

function validateBound(value, field, { requirePositive }) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid(`${field} 必须是有限数字`)
    if (requirePositive && value <= 0) throw invalid(`${field} 必须大于 0`)
    return
  }
  if (!isPlainObject(value)) throw invalid(`${field} 必须是数字或「维度 → 数字」对象`)
  if (!Object.keys(value).length) throw invalid(`${field} 对象不能为空`)
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      throw invalid(`${field}.${key} 必须是有限数字`)
    }
    if (requirePositive && item <= 0) throw invalid(`${field}.${key} 必须大于 0`)
  }
}

/**
 * 该乘区可吃的增益键（方案文档 10.2）：增益编辑器与后端白名单按定义表动态生成。
 */
export function normalizeZoneStats(value) {
  if (value == null) return null
  if (!Array.isArray(value)) throw invalid('stats 必须是数组或 null')
  if (value.length > MAX_APPLIES_TO_ITEMS) throw invalid(`stats 条目过多（上限 ${MAX_APPLIES_TO_ITEMS}）`)
  const seen = new Set()
  const stats = value.map((item, index) => {
    const path = `stats[${index}]`
    if (!isPlainObject(item)) throw invalid(`${path} 必须是对象`)
    const key = readRequiredText(item.key, `${path}.key`, ZONE_KEY_MAX_LENGTH)
    if (!BUILTIN_ZONE_KEY_PATTERN.test(key)) {
      throw invalid(`${path}.key 格式非法：只允许字母开头的字母/数字/下划线/点/连字符`)
    }
    if (seen.has(key)) throw invalid(`stats 中增益键 ${key} 重复`)
    seen.add(key)
    const valueType = readRequiredText(item.valueType, `${path}.valueType`, 32)
    if (!STAT_VALUE_TYPES.includes(valueType)) {
      throw invalid(`${path}.valueType 非法：只允许 ${STAT_VALUE_TYPES.join(' / ')}`)
    }
    let sign = 'both'
    if (item.sign != null) {
      sign = readRequiredText(item.sign, `${path}.sign`, 32)
      if (!STAT_SIGNS.includes(sign)) {
        throw invalid(`${path}.sign 非法：只允许 ${STAT_SIGNS.join(' / ')}`)
      }
    }
    const stat = {
      key,
      label: readRequiredText(item.label, `${path}.label`, LABEL_MAX_LENGTH),
      valueType,
      sign,
    }
    for (const flag of ['appliesToPanel', 'supportsConvert', 'supportsFactor']) {
      if (item[flag] != null) stat[flag] = readBoolean(item[flag], `${path}.${flag}`)
    }
    return stat
  })
  return stats
}

/** 展示配置：已知字段做类型校验，未知字段保留（展示层扩展不需要改后端） */
export function normalizeZoneDisplay(value) {
  if (value == null) return null
  if (!isPlainObject(value)) throw invalid('display 必须是对象或 null')
  assertJsonSafeValue(value, 'display')
  const display = { ...value }
  if (display.panel != null) {
    const panel = readRequiredText(display.panel, 'display.panel', 32)
    if (!ZONE_PANEL_MODES.includes(panel)) {
      throw invalid(`display.panel 非法：只允许 ${ZONE_PANEL_MODES.join(' / ')}`)
    }
    display.panel = panel
  }
  for (const flag of ['showCap', 'showMinProcess']) {
    if (display[flag] != null) display[flag] = readBoolean(display[flag], `display.${flag}`)
  }
  return display
}

function readConditionScalar(value, field) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid(`${field} 必须是有限数字`)
    return value
  }
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) throw invalid(`${field} 不能为空字符串`)
    if (text.length > MAX_CONDITION_TEXT_LENGTH) {
      throw invalid(`${field} 长度不能超过 ${MAX_CONDITION_TEXT_LENGTH}`)
    }
    return text
  }
  throw invalid(`${field} 只允许字符串 / 数字 / 布尔值`)
}

function normalizeConditionLeaf(variable, value, path) {
  if (!ZONE_CONDITION_VARIABLES.includes(variable)) {
    throw invalid(`${path} 含未允许的条件变量 ${variable}：只允许 ${ZONE_CONDITION_VARIABLES.join(' / ')}`)
  }
  if (!isPlainObject(value)) {
    return { [variable]: readConditionScalar(value, path) }
  }
  const op = readRequiredText(value.op, `${path}.op`, 16)
  if (!ZONE_CONDITION_COMPARATORS.includes(op)) {
    throw invalid(`${path}.op 非法：只允许 ${ZONE_CONDITION_COMPARATORS.join(' / ')}`)
  }
  const rawValue = value.value
  if (rawValue === undefined) throw invalid(`${path}.value 为必填项`)

  if (op === 'in') {
    if (!Array.isArray(rawValue) || !rawValue.length) {
      throw invalid(`${path}.value 在 op=in 时必须是非空数组`)
    }
    if (rawValue.length > MAX_CONDITION_ARRAY_ITEMS) {
      throw invalid(`${path}.value 条目过多（上限 ${MAX_CONDITION_ARRAY_ITEMS}）`)
    }
    return {
      [variable]: {
        op,
        value: rawValue.map((item, index) =>
          readConditionScalar(item, `${path}.value[${index}]`),
        ),
      },
    }
  }
  if (op === '>=' || op === '<=') {
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
      throw invalid(`${path}.value 在 op=${op} 时必须是数字`)
    }
    return { [variable]: { op, value: rawValue } }
  }
  if (Array.isArray(rawValue)) {
    throw invalid(`${path}.value 在 op=${op} 时不能是数组（比较多个值请用 op=in）`)
  }
  return { [variable]: { op, value: readConditionScalar(rawValue, `${path}.value`) } }
}

/**
 * 条件（方案文档第九节 C）：只允许白名单变量与固定运算，不解析任意表达式。
 *
 * 支持三种写法：
 * 1. 组：`{ and: [...] }` / `{ or: [...] }` / `{ not: {...} }`
 * 2. 简写等值：`{ agentId: 'remiel' }`
 * 3. 带运算：`{ agentId: { op: 'in', value: ['a', 'b'] } }`
 *
 * 每个节点只能有一个键，避免 `{ agentId, skillId }` 这种「与还是或」的歧义。
 */
export function normalizeZoneCondition(value, context = {}) {
  const path = context.path || 'when'
  const depth = context.depth || 0
  const budget = context.budget || { nodes: 0 }
  budget.nodes += 1
  if (depth > MAX_CONDITION_DEPTH) {
    throw invalid(`${path} 嵌套层级过深（上限 ${MAX_CONDITION_DEPTH}）`)
  }
  if (budget.nodes > MAX_CONDITION_NODES) {
    throw invalid(`${path} 条件节点过多（上限 ${MAX_CONDITION_NODES}）`)
  }
  if (!isPlainObject(value)) throw invalid(`${path} 必须是对象`)

  const keys = Object.keys(value)
  if (keys.length !== 1) {
    throw invalid(`${path} 必须只有一个键（逻辑组用 and/or/not，条件用单个变量）`)
  }
  const key = keys[0]
  const child = value[key]

  if (key === 'and' || key === 'or') {
    if (!Array.isArray(child) || !child.length) {
      throw invalid(`${path}.${key} 必须是非空条件数组`)
    }
    if (child.length > MAX_CONDITION_ARRAY_ITEMS) {
      throw invalid(`${path}.${key} 条目过多（上限 ${MAX_CONDITION_ARRAY_ITEMS}）`)
    }
    return {
      [key]: child.map((item, index) =>
        normalizeZoneCondition(item, {
          path: `${path}.${key}[${index}]`,
          depth: depth + 1,
          budget,
        }),
      ),
    }
  }
  if (key === 'not') {
    return {
      not: normalizeZoneCondition(child, { path: `${path}.not`, depth: depth + 1, budget }),
    }
  }
  return normalizeConditionLeaf(key, child, path)
}

const ZONE_RULE_KEYS = Object.freeze([
  'key',
  'zoneKey',
  'zone_key',
  'label',
  'action',
  'module',
  'primitive',
  'params',
  'display',
  'when',
  'conditions',
  'order',
  'sortOrder',
  'sort_order',
  'enabled',
  'note',
])

function normalizeRuleAction(value) {
  if (value == null || value === '') return 'inherit'
  const action = readRequiredText(value, 'rules[].action', 16)
  if (!ZONE_RULE_ACTIONS.includes(action)) {
    throw invalid(`rules[].action 非法：只允许 ${ZONE_RULE_ACTIONS.join(' / ')}`)
  }
  return action
}

/**
 * 单条方案条目：只允许「继承 / 整条替换 / 禁用」三种动作，
 * 覆盖类字段（module/params/display）只在 action=replace 时允许，避免写了却被忽略。
 */
export function normalizeZoneRule(rule, { index = 0 } = {}) {
  const path = `rules[${index}]`
  if (!isPlainObject(rule)) throw invalid(`${path} 必须是对象`)
  for (const key of Object.keys(rule)) {
    if (!ZONE_RULE_KEYS.includes(key)) {
      throw invalid(`${path} 含未知字段 ${key}：只允许 ${ZONE_RULE_KEYS.join(' / ')}`)
    }
  }

  const key = validateZoneKey(pick(rule, 'zoneKey'), `${path}.key`)
  const action = normalizeRuleAction(rule.action)
  const module = rule.module == null && rule.primitive == null ? null : validateZonePrimitive(rule.primitive ?? rule.module)
  if (rule.module != null && rule.primitive != null && rule.module !== rule.primitive) {
    throw invalid(`${path} 的 module 与 primitive 不一致`)
  }
  const hasOverrides =
    module != null || rule.params != null || rule.display != null
  if (action !== 'replace' && hasOverrides) {
    throw invalid(`${path}：action=${action} 时不能带 module/params/display（覆盖请用 action=replace）`)
  }

  const normalized = { key, action }
  if (rule.label != null) normalized.label = readRequiredText(rule.label, `${path}.label`, LABEL_MAX_LENGTH)
  if (module != null) normalized.module = module
  if (rule.params != null) normalized.params = normalizeZoneParams(rule.params)
  if (rule.display != null) normalized.display = normalizeZoneDisplay(rule.display)
  if (rule.when != null && rule.conditions != null) {
    throw invalid(`${path} 的 when 与 conditions 只能选一个`)
  }
  const when = rule.when ?? rule.conditions
  if (when != null) normalized.when = normalizeZoneCondition(when, { path: `${path}.when` })
  const order = rule.order ?? rule.sortOrder ?? rule.sort_order
  if (order != null) {
    normalized.order = readInteger(order, `${path}.order`, SORT_ORDER_RANGE)
  }
  if (rule.enabled != null) normalized.enabled = readBoolean(rule.enabled, `${path}.enabled`)
  if (rule.note != null) normalized.note = readOptionalText(rule.note, `${path}.note`, 500)
  return normalized
}

/** 方案条目数组：必须为数组，且同一个 zone_key 只能出现一次（合并口径按 key） */
export function normalizeZoneRules(value) {
  if (!Array.isArray(value)) throw invalid('rules 必须是数组')
  if (value.length > MAX_RULES) throw invalid(`rules 条目过多（上限 ${MAX_RULES}）`)
  const rules = value.map((rule, index) => normalizeZoneRule(rule, { index }))
  const seen = new Set()
  for (const rule of rules) {
    if (seen.has(rule.key)) throw invalid(`rules 中乘区 ${rule.key} 重复`)
    seen.add(rule.key)
  }
  return rules
}

/**
 * 乘区定义校验 + 归一化（纯函数，不触库）。
 * 返回字段与表列一一对应（camelCase），`version` 为 null 表示「由服务端递增」。
 */
export function normalizeZoneDefinition(input) {
  if (!isPlainObject(input)) throw invalid('乘区定义必须是对象')

  const zoneKey = validateZoneKey(pick(input, 'zoneKey'))
  const label = readRequiredText(input.label, 'label', LABEL_MAX_LENGTH)
  const sortOrder = readInteger(pick(input, 'sortOrder'), 'sort_order', {
    ...SORT_ORDER_RANGE,
    fallback: DEFAULT_SORT_ORDER,
  })
  const appliesToInput = pick(input, 'appliesTo')
  const appliesTo = normalizeZoneAppliesTo(appliesToInput)
  // 顶层 providers 优先；`applies_to.providers` 只作旧数据读入兼容
  const providers = normalizeZoneProviders(
    input.providers ?? (isPlainObject(appliesToInput) ? appliesToInput.providers : undefined),
  )
  const primitive = validateZonePrimitive(pick(input, 'primitive'))
  const params = normalizeZoneParams(input.params)
  const stats = normalizeZoneStats(input.stats)
  const display = normalizeZoneDisplay(input.display)
  const enabled = readBoolean(input.enabled, 'enabled', true)
  const version = readOptionalInteger(input.version, 'version', VERSION_RANGE)

  return {
    zoneKey,
    label,
    sortOrder,
    appliesTo,
    providers,
    primitive,
    params,
    stats,
    display,
    enabled,
    version,
  }
}

/**
 * 乘区方案校验 + 归一化（纯函数，不触库）。
 * `target_id` 与 scope 绑定：global 必须为空，其余作用域必须非空。
 */
export function normalizeZoneScheme(input) {
  if (!isPlainObject(input)) throw invalid('乘区方案必须是对象')

  const scope = validateZoneScope(input.scope)
  const targetId = readOptionalText(pick(input, 'targetId'), 'target_id', TARGET_ID_MAX_LENGTH)
  if (scope === 'global' && targetId) {
    throw invalid('scope=global 时 target_id 必须为空')
  }
  if (scope !== 'global' && !targetId) {
    throw invalid(`scope=${scope} 时必须提供 target_id`)
  }

  const name = readRequiredText(input.name, 'name', SCHEME_NAME_MAX_LENGTH)
  const priority = readInteger(input.priority, 'priority', {
    ...PRIORITY_RANGE,
    fallback: DEFAULT_PRIORITY,
  })
  const enabled = readBoolean(input.enabled, 'enabled', true)
  const version = readOptionalInteger(input.version, 'version', VERSION_RANGE)
  const rules = normalizeZoneRules(input.rules)
  const updatedBy = readOptionalText(pick(input, 'updatedBy'), 'updated_by', UPDATED_BY_MAX_LENGTH)
  const id = readOptionalInteger(input.id, 'id', { min: 1, max: Number.MAX_SAFE_INTEGER })

  return {
    id,
    scope,
    targetId,
    name,
    priority,
    enabled,
    version,
    rules,
    updatedBy: updatedBy || null,
  }
}

let schemaReady = null

/**
 * 惰性建表（进程内只成功执行一次；失败不缓存，下次重试）。
 * 与 skillGroupService.ensureTable 同一模式：不依赖启动钩子，也不改既有表。
 */
export function ensureZoneSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${DEFINITIONS_TABLE} (
          id INT AUTO_INCREMENT PRIMARY KEY,
          zone_key VARCHAR(64) NOT NULL,
          label VARCHAR(100) NOT NULL,
          sort_order INT NOT NULL DEFAULT 100,
          applies_to JSON NOT NULL,
          primitive VARCHAR(64) NOT NULL,
          params JSON NOT NULL,
          stats JSON NULL,
          display JSON NULL,
          enabled TINYINT(1) NOT NULL DEFAULT 1,
          version INT NOT NULL DEFAULT 1,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_zone_key (zone_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${SCHEMES_TABLE} (
          id INT AUTO_INCREMENT PRIMARY KEY,
          scope ENUM('global','profession','agent','skill_group','skill') NOT NULL,
          target_id VARCHAR(64) NOT NULL DEFAULT '',
          name VARCHAR(100) NOT NULL,
          priority INT NOT NULL DEFAULT 10,
          enabled TINYINT(1) NOT NULL DEFAULT 1,
          version INT NOT NULL DEFAULT 1,
          rules JSON NOT NULL,
          updated_by VARCHAR(64) NULL,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_scope_target (scope, target_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `)
    })().catch((err) => {
      schemaReady = null
      throw err
    })
  }
  return schemaReady
}

function toIsoString(value) {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * 读库兼容：正常写入的 applies_to 是 `{ damageKinds, agents, skills, providers }`；
 * 旧数据可能是纯数组或缺少 providers，统一补成两个可见部分。
 */
function readStoredAppliesTo(value) {
  const parsed = parseJson(value, {})
  const fallback = { damageKinds: [], agents: [], skills: [], providers: 'team' }
  if (Array.isArray(parsed)) return { ...fallback, damageKinds: parsed }
  if (!isPlainObject(parsed)) return fallback
  return {
    damageKinds: Array.isArray(parsed.damageKinds) ? parsed.damageKinds : [],
    agents: Array.isArray(parsed.agents) ? parsed.agents : [],
    skills: Array.isArray(parsed.skills) ? parsed.skills : [],
    providers: ZONE_PROVIDER_SCOPES.includes(parsed.providers) ? parsed.providers : 'team',
  }
}

function rowToDefinition(row) {
  const appliesTo = readStoredAppliesTo(row.applies_to)
  return {
    id: Number(row.id),
    zoneKey: String(row.zone_key ?? ''),
    label: String(row.label ?? ''),
    sortOrder: Number(row.sort_order) || 0,
    appliesTo: {
      damageKinds: appliesTo.damageKinds,
      agents: appliesTo.agents,
      skills: appliesTo.skills,
    },
    providers: appliesTo.providers,
    primitive: String(row.primitive ?? ''),
    params: parseJson(row.params, {}),
    stats: parseJson(row.stats, null),
    display: parseJson(row.display, null),
    enabled: Boolean(Number(row.enabled)),
    version: Number(row.version) || 1,
    updatedAt: toIsoString(row.updated_at),
  }
}

function rowToScheme(row) {
  const rules = parseJson(row.rules, [])
  return {
    id: Number(row.id),
    scope: String(row.scope ?? ''),
    targetId: String(row.target_id ?? ''),
    name: String(row.name ?? ''),
    priority: Number(row.priority) || 0,
    enabled: Boolean(Number(row.enabled)),
    version: Number(row.version) || 1,
    rules: Array.isArray(rules) ? rules : [],
    updatedBy: row.updated_by == null ? null : String(row.updated_by),
    updatedAt: toIsoString(row.updated_at),
  }
}

function readRuleKey(rule) {
  if (!isPlainObject(rule)) return ''
  const raw = rule.key ?? rule.zoneKey ?? rule.zone_key
  return typeof raw === 'string' ? raw.trim() : ''
}

export async function listZoneDefinitions({ enabled, primitive } = {}) {
  await ensureZoneSchema()
  const clauses = []
  const params = []
  if (enabled != null && enabled !== '') {
    clauses.push('enabled = ?')
    params.push(readBoolean(enabled, 'enabled') ? 1 : 0)
  }
  if (primitive) {
    clauses.push('primitive = ?')
    params.push(String(primitive).trim())
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
  const [rows] = await pool.query(
    `SELECT * FROM ${DEFINITIONS_TABLE}${where} ORDER BY sort_order ASC, zone_key ASC`,
    params,
  )
  return rows.map(rowToDefinition)
}

/** 按 zone_key 取定义；不存在返回 null（路由层决定 404） */
export async function getZoneDefinition(zoneKey) {
  const key = validateZoneKey(zoneKey)
  await ensureZoneSchema()
  const [rows] = await pool.query(
    `SELECT * FROM ${DEFINITIONS_TABLE} WHERE zone_key = ? LIMIT 1`,
    [key],
  )
  return rows[0] ? rowToDefinition(rows[0]) : null
}

/**
 * 新增或更新乘区定义（按 zone_key upsert）。
 * `version` 未显式给出时：新建=1，更新=旧值+1（发布版本由服务端推进）。
 */
export async function upsertZoneDefinition(input) {
  const doc = normalizeZoneDefinition(input)
  await ensureZoneSchema()
  const existing = await getZoneDefinition(doc.zoneKey)
  const version = doc.version ?? (existing ? existing.version + 1 : 1)

  await pool.query(
    `INSERT INTO ${DEFINITIONS_TABLE}
       (zone_key, label, sort_order, applies_to, primitive, params, stats, display, enabled, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       label = VALUES(label),
       sort_order = VALUES(sort_order),
       applies_to = VALUES(applies_to),
       primitive = VALUES(primitive),
       params = VALUES(params),
       stats = VALUES(stats),
       display = VALUES(display),
       enabled = VALUES(enabled),
       version = VALUES(version)`,
    [
      doc.zoneKey,
      doc.label,
      doc.sortOrder,
      JSON.stringify({ ...doc.appliesTo, providers: doc.providers }),
      doc.primitive,
      JSON.stringify(doc.params),
      doc.stats == null ? null : JSON.stringify(doc.stats),
      doc.display == null ? null : JSON.stringify(doc.display),
      doc.enabled ? 1 : 0,
      version,
    ],
  )

  const saved = await getZoneDefinition(doc.zoneKey)
  return { created: !existing, definition: saved }
}

/**
 * 列出引用了某 zone_key 的方案（用于「有引用禁止硬删除」，方案文档 10.6）。
 * 方案表规模很小，整表读回按 key 扫描，比 JSON 路径查询更可控（rules 可能是旧形态）。
 */
export async function listZoneSchemeReferences(zoneKey) {
  const key = validateZoneKey(zoneKey)
  await ensureZoneSchema()
  const [rows] = await pool.query(
    `SELECT id, scope, target_id, name, rules FROM ${SCHEMES_TABLE} ORDER BY id ASC`,
  )
  const references = []
  for (const row of rows) {
    const rules = parseJson(row.rules, [])
    if (!Array.isArray(rules)) continue
    if (!rules.some((rule) => readRuleKey(rule) === key)) continue
    references.push({
      id: Number(row.id),
      scope: String(row.scope ?? ''),
      targetId: String(row.target_id ?? ''),
      name: String(row.name ?? ''),
    })
  }
  return references
}

/** 删除定义：有方案引用时回 409（方案文档 10.6：改为禁用，不硬删） */
export async function deleteZoneDefinition(zoneKey) {
  const key = validateZoneKey(zoneKey)
  await ensureZoneSchema()
  const existing = await getZoneDefinition(key)
  if (!existing) {
    throw zoneConfigError(`乘区定义不存在：${key}`, { code: 'ZONE_DEFINITION_NOT_FOUND', status: 404 })
  }
  const references = await listZoneSchemeReferences(key)
  if (references.length) {
    throw zoneConfigError(
      `乘区 ${key} 仍被 ${references.length} 个方案引用，请先解除引用或改为禁用`,
      { code: 'ZONE_IN_USE', status: 409, details: { references } },
    )
  }
  await pool.query(`DELETE FROM ${DEFINITIONS_TABLE} WHERE zone_key = ?`, [key])
  return { zoneKey: key, deleted: true }
}

export async function listZoneSchemes({ scope, targetId, enabled } = {}) {
  await ensureZoneSchema()
  const clauses = []
  const params = []
  if (scope) {
    clauses.push('scope = ?')
    params.push(validateZoneScope(scope))
  }
  if (targetId != null && targetId !== '') {
    clauses.push('target_id = ?')
    params.push(String(targetId).trim())
  }
  if (enabled != null && enabled !== '') {
    clauses.push('enabled = ?')
    params.push(readBoolean(enabled, 'enabled') ? 1 : 0)
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
  const [rows] = await pool.query(
    `SELECT * FROM ${SCHEMES_TABLE}${where}
     ORDER BY FIELD(scope, 'global', 'profession', 'agent', 'skill_group', 'skill'),
       priority DESC, id ASC`,
    params,
  )
  return rows.map(rowToScheme)
}

/** 按 id 取方案；不存在返回 null */
export async function getZoneScheme(id) {
  const schemeId = readInteger(id, 'id', { min: 1, max: Number.MAX_SAFE_INTEGER })
  await ensureZoneSchema()
  const [rows] = await pool.query(`SELECT * FROM ${SCHEMES_TABLE} WHERE id = ? LIMIT 1`, [schemeId])
  return rows[0] ? rowToScheme(rows[0]) : null
}

async function findZoneSchemeByScopeTarget(scope, targetId) {
  const [rows] = await pool.query(
    `SELECT * FROM ${SCHEMES_TABLE} WHERE scope = ? AND target_id = ? LIMIT 1`,
    [scope, targetId],
  )
  return rows[0] ? rowToScheme(rows[0]) : null
}

/**
 * 方案里的自定义乘区键必须已登记（内置键由代码目录提供，定义表允许没有对应行）。
 * 这样 `custom:*` 不会指向不存在的定义，而内置目录的键也不会因为还没种子化就被拦下。
 */
async function assertRuleZoneKeysRegistered(rules) {
  for (const rule of rules) {
    if (!isCustomZoneKey(rule.key)) continue
    const definition = await getZoneDefinition(rule.key)
    if (!definition) {
      throw invalid(`rules 引用了未登记的乘区 ${rule.key}：请先在乘区定义中创建`)
    }
  }
}

/**
 * 新增或更新乘区方案。
 *
 * - 带 `id`：按 id 更新（不存在回 404）；改了 scope/target_id 且与别的方案撞唯一键 → 409。
 * - 不带 `id`：按 UNIQUE(scope, target_id) upsert（管理端「保存」是整份覆盖）。
 * `version` 未显式给出时：新建=1，更新=旧值+1。
 */
export async function upsertZoneScheme(input) {
  const doc = normalizeZoneScheme(input)
  await ensureZoneSchema()
  await assertRuleZoneKeysRegistered(doc.rules)

  let existing = null
  if (doc.id != null) {
    existing = await getZoneScheme(doc.id)
    if (!existing) {
      throw zoneConfigError(`乘区方案不存在：${doc.id}`, {
        code: 'ZONE_SCHEME_NOT_FOUND',
        status: 404,
      })
    }
    const occupant = await findZoneSchemeByScopeTarget(doc.scope, doc.targetId)
    if (occupant && occupant.id !== existing.id) {
      throw zoneConfigError(
        `作用域 ${doc.scope}:${doc.targetId || '(空)'} 已有方案「${occupant.name}」（id=${occupant.id}），不能重复`,
        { code: 'ZONE_SCHEME_CONFLICT', status: 409 },
      )
    }
  } else {
    existing = await findZoneSchemeByScopeTarget(doc.scope, doc.targetId)
  }

  const version = doc.version ?? (existing ? existing.version + 1 : 1)
  const values = [
    doc.scope,
    doc.targetId,
    doc.name,
    doc.priority,
    doc.enabled ? 1 : 0,
    version,
    JSON.stringify(doc.rules),
    doc.updatedBy,
  ]

  if (existing) {
    await pool.query(
      `UPDATE ${SCHEMES_TABLE}
       SET scope = ?, target_id = ?, name = ?, priority = ?, enabled = ?, version = ?,
           rules = ?, updated_by = ?
       WHERE id = ?`,
      [...values, existing.id],
    )
    const saved = await getZoneScheme(existing.id)
    return { created: false, scheme: saved }
  }

  const [result] = await pool.query(
    `INSERT INTO ${SCHEMES_TABLE}
       (scope, target_id, name, priority, enabled, version, rules, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    values,
  )
  const saved = await getZoneScheme(result.insertId)
  return { created: true, scheme: saved }
}

export async function deleteZoneScheme(id) {
  const schemeId = readInteger(id, 'id', { min: 1, max: Number.MAX_SAFE_INTEGER })
  await ensureZoneSchema()
  const existing = await getZoneScheme(schemeId)
  if (!existing) {
    throw zoneConfigError(`乘区方案不存在：${schemeId}`, {
      code: 'ZONE_SCHEME_NOT_FOUND',
      status: 404,
    })
  }
  await pool.query(`DELETE FROM ${SCHEMES_TABLE} WHERE id = ?`, [schemeId])
  return { id: schemeId, deleted: true }
}
