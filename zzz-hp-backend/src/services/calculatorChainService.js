import pool from '../config/db.js'
import {
  ZONE_SCOPES,
  normalizeZoneCondition,
  normalizeZoneParams,
} from './calculatorZoneService.js'

/**
 * 计算链路（Damage Chain）定义存储（Phase 4f 后端）。
 *
 * 一条链路 = `chain_key`（直伤 / 异常 / 蕾米本人耀变 / 自定义）+ 作用域 + 有序阶段数组。
 * 作用域与乘区方案同口径（global → profession → agent → skill_group → skill），
 * 运行时由前端按「伤害类型命中 + 作用域优先级」挑一条链路，本服务只负责存取与校验。
 *
 * 与 calculatorZoneService 的分工：
 * - 乘区定义（zone）描述「一个乘数怎么算」；
 * - 链路（chain）描述「一次结算按什么顺序、用哪些模块串起来」。
 *
 * 建表由本服务惰性自愈（与 ensureZoneSchema 同一模式），不改既有表、不改 init_schema.sql；
 * 内置链路（direct / anomaly / radiance-self）由前端代码提供，表为空时照常工作。
 */

const CHAINS_TABLE = 'calculator_damage_chains'

/** 作用域枚举：与乘区方案共用同一份定义（global 最弱，skill 最强） */
export const DAMAGE_CHAIN_SCOPES = ZONE_SCOPES

/** 阶段类型：source=产生基础值、multiplier=连乘因子、combine=合并/截断、final=汇总 */
export const DAMAGE_CHAIN_STAGE_KINDS = Object.freeze([
  'source',
  'multiplier',
  'combine',
  'final',
])

/** 代码内置链路键：库里可以有覆盖行（如 radiance-self 的角色级覆盖），但删除仍受保护 */
export const BUILTIN_DAMAGE_CHAIN_KEYS = Object.freeze([
  'direct',
  'anomaly',
  'radiance-self',
])

const CHAIN_KEY_MAX_LENGTH = 64
const LABEL_MAX_LENGTH = 100
const MODULE_MAX_LENGTH = 64
const STAGE_ID_MAX_LENGTH = 64
const GROUP_MAX_LENGTH = 64
const TARGET_ID_MAX_LENGTH = 64
const UPDATED_BY_MAX_LENGTH = 64
const MAX_STAGES = 200
const MAX_STAGE_INPUTS = 50
const MAX_STRING_LIST_ITEMS = 100
const MAX_ORDER_ABS = 1000000
const PRIORITY_RANGE = Object.freeze({ min: 0, max: 1000 })
const VERSION_RANGE = Object.freeze({ min: 1, max: 1000000 })
const DEFAULT_PRIORITY = 0
const ORDER_STEP = 10

const BUILTIN_CHAIN_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/
const CUSTOM_CHAIN_KEY_PATTERN = /^custom:[A-Za-z0-9][A-Za-z0-9_-]*$/
const STAGE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/

const APPLIES_TO_KEYS = Object.freeze(['damageKinds', 'subKinds'])

const STAGE_KEYS = Object.freeze([
  'id',
  'kind',
  'module',
  'label',
  'group',
  'order',
  'inputs',
  'params',
  'when',
  'enabled',
])

/** 可读的校验/冲突错误：`status` 供路由映射 HTTP 码，`code` 供前端区分分支 */
function chainConfigError(message, { code = 'INVALID_DAMAGE_CHAIN_PAYLOAD', status = 400 } = {}) {
  const err = new Error(message)
  err.code = code
  err.status = status
  return err
}

function invalid(message) {
  return chainConfigError(message)
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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

function readNumber(value, field, { fallback, absMax } = {}) {
  if (value == null || value === '') {
    if (fallback === undefined) throw invalid(`${field} 为必填项`)
    return fallback
  }
  const num = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(num)) throw invalid(`${field} 必须是有限数字`)
  if (absMax != null && Math.abs(num) > absMax) {
    throw invalid(`${field} 绝对值不能超过 ${absMax}`)
  }
  return num
}

function readStringList(value, field, { maxItems = MAX_STRING_LIST_ITEMS } = {}) {
  if (value == null) return []
  if (!Array.isArray(value)) throw invalid(`${field} 必须是数组`)
  if (value.length > maxItems) throw invalid(`${field} 条目过多（上限 ${maxItems}）`)
  const seen = new Set()
  const list = []
  for (const item of value) {
    if (typeof item !== 'string') throw invalid(`${field} 的每一项必须是非空字符串`)
    const text = item.trim()
    if (!text) throw invalid(`${field} 的每一项必须是非空字符串`)
    if (text.length > CHAIN_KEY_MAX_LENGTH) {
      throw invalid(`${field} 的每一项长度不能超过 ${CHAIN_KEY_MAX_LENGTH}`)
    }
    if (seen.has(text)) continue
    seen.add(text)
    list.push(text)
  }
  return list
}

/** 自定义链路键：库里的自有链路一律用 `custom:<slug>`，删除也只放开这一类 */
export function isCustomChainKey(value) {
  return typeof value === 'string' && CUSTOM_CHAIN_KEY_PATTERN.test(value.trim())
}

/**
 * chain_key 口径：内置键（`direct` / `anomaly` / `radiance-self` 等代码提供的链路，
 * 也兼容 `anomaly:attributeAnomaly` 这类细分写法）或 `custom:<slug>`。
 * `custom` / `custom:*` 一律按自定义键校验，避免与内置键前缀混淆。
 */
export function isValidChainKey(value) {
  if (typeof value !== 'string') return false
  const key = value.trim()
  if (!key || key.length > CHAIN_KEY_MAX_LENGTH) return false
  if (key === 'custom' || key.startsWith('custom:')) return CUSTOM_CHAIN_KEY_PATTERN.test(key)
  return BUILTIN_CHAIN_KEY_PATTERN.test(key)
}

export function validateChainKey(value, field = 'chain_key') {
  const key = readRequiredText(value, field, CHAIN_KEY_MAX_LENGTH)
  if (!isValidChainKey(key)) {
    throw invalid(
      `${field} 格式非法：内置键形如 direct / anomaly / radiance-self，自定义键形如 custom:remielRadiance（仅字母/数字/下划线/连字符，最长 ${CHAIN_KEY_MAX_LENGTH}）`,
    )
  }
  return key
}

export function validateChainScope(value) {
  const scope = readRequiredText(value, 'scope', 32)
  if (!DAMAGE_CHAIN_SCOPES.includes(scope)) {
    throw invalid(`scope 非法：只允许 ${DAMAGE_CHAIN_SCOPES.join(' / ')}`)
  }
  return scope
}

export function validateChainStageKind(value) {
  const kind = readRequiredText(value, 'kind', 32)
  if (!DAMAGE_CHAIN_STAGE_KINDS.includes(kind)) {
    throw invalid(`kind 非法：只允许 ${DAMAGE_CHAIN_STAGE_KINDS.join(' / ')}`)
  }
  return kind
}

/**
 * 适用范围：`{ damageKinds: string[], subKinds?: string[] }`。
 * damageKinds 必填且非空（链路靠它命中伤害类型）；subKinds 可选，用于区分异常/直伤子类。
 * 兼容旧式数组写法（等价于 `{ damageKinds: [...] }`）。
 */
export function normalizeChainAppliesTo(value) {
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
    throw invalid('applies_to 必须是对象')
  }

  const damageKinds = readStringList(source.damageKinds, 'applies_to.damageKinds')
  if (!damageKinds.length) {
    throw invalid('applies_to.damageKinds 必须是非空数组')
  }
  const appliesTo = { damageKinds }
  const subKinds = readStringList(source.subKinds, 'applies_to.subKinds')
  if (subKinds.length) appliesTo.subKinds = subKinds
  return appliesTo
}

/**
 * 单个阶段校验 + 归一化（纯函数）。
 *
 * 只允许契约里的十个字段：拼错的字段会在保存时直接报错，而不是静默丢数据。
 * `order` 缺省按 `index * 10` 递增，保证不填顺序时也稳定；`when` 为空对象表示无条件。
 */
export function normalizeChainStage(stage, { index = 0 } = {}) {
  const path = `stages[${index}]`
  if (!isPlainObject(stage)) throw invalid(`${path} 必须是对象`)
  for (const key of Object.keys(stage)) {
    if (!STAGE_KEYS.includes(key)) {
      throw invalid(`${path} 含未知字段 ${key}：只允许 ${STAGE_KEYS.join(' / ')}`)
    }
  }

  const id = readRequiredText(stage.id, `${path}.id`, STAGE_ID_MAX_LENGTH)
  if (!STAGE_ID_PATTERN.test(id)) {
    throw invalid(`${path}.id 格式非法：只允许字母开头的字母/数字/下划线/点/连字符/冒号`)
  }
  const kind = validateChainStageKind(stage.kind)
  const module = readRequiredText(stage.module, `${path}.module`, MODULE_MAX_LENGTH)
  const label = readOptionalText(stage.label, `${path}.label`, LABEL_MAX_LENGTH)
  const group = readOptionalText(stage.group, `${path}.group`, GROUP_MAX_LENGTH)
  const order = readNumber(stage.order, `${path}.order`, {
    fallback: index * ORDER_STEP,
    absMax: MAX_ORDER_ABS,
  })
  const inputs = readStringList(stage.inputs, `${path}.inputs`, { maxItems: MAX_STAGE_INPUTS })
  const params = normalizeZoneParams(stage.params)
  const enabled = readBoolean(stage.enabled, `${path}.enabled`, true)

  let when = {}
  if (stage.when != null) {
    if (!isPlainObject(stage.when)) throw invalid(`${path}.when 必须是对象`)
    if (Object.keys(stage.when).length) {
      when = normalizeZoneCondition(stage.when, { path: `${path}.when` })
    }
  }

  return { id, kind, module, label, group, order, inputs, params, when, enabled }
}

/** 阶段数组：非空、id 必填且唯一；final 阶段最多一个（契约「汇总为单次伤害」） */
export function normalizeChainStages(value) {
  if (!Array.isArray(value)) throw invalid('stages 必须是数组')
  if (!value.length) throw invalid('stages 不能为空数组')
  if (value.length > MAX_STAGES) throw invalid(`stages 条目过多（上限 ${MAX_STAGES}）`)

  const stages = value.map((stage, index) => normalizeChainStage(stage, { index }))
  const seen = new Set()
  let finalCount = 0
  for (const stage of stages) {
    if (seen.has(stage.id)) throw invalid(`stages 中阶段 id ${stage.id} 重复`)
    seen.add(stage.id)
    if (stage.kind === 'final') finalCount += 1
  }
  if (finalCount > 1) throw invalid('stages 中 kind=final 的阶段最多一个')
  return stages
}

/**
 * 链路校验 + 归一化（纯函数，不触库）。
 * 返回字段与表列一一对应（camelCase）；`version` 为 null 表示「由服务端递增」。
 */
export function normalizeDamageChain(input) {
  if (!isPlainObject(input)) throw invalid('计算链路必须是对象')

  const chainKey = validateChainKey(input.chainKey ?? input.chain_key, 'chain_key')
  const label = readOptionalText(input.label, 'label', LABEL_MAX_LENGTH)
  const appliesTo = normalizeChainAppliesTo(input.appliesTo ?? input.applies_to)
  const scope = validateChainScope(input.scope)
  const targetId = readOptionalText(input.targetId ?? input.target_id, 'target_id', TARGET_ID_MAX_LENGTH)
  if (scope === 'global' && targetId) {
    throw invalid('scope=global 时 target_id 必须为空')
  }
  if (scope !== 'global' && !targetId) {
    throw invalid(`scope=${scope} 时必须提供 target_id`)
  }
  const priority = readInteger(input.priority, 'priority', {
    ...PRIORITY_RANGE,
    fallback: DEFAULT_PRIORITY,
  })
  const enabled = readBoolean(input.enabled, 'enabled', true)
  const version = readOptionalInteger(input.version, 'version', VERSION_RANGE)
  const stages = normalizeChainStages(input.stages)
  const updatedBy = readOptionalText(input.updatedBy ?? input.updated_by, 'updated_by', UPDATED_BY_MAX_LENGTH)
  const id = readOptionalInteger(input.id, 'id', { min: 1, max: Number.MAX_SAFE_INTEGER })

  return {
    id,
    chainKey,
    label,
    appliesTo,
    scope,
    targetId,
    priority,
    enabled,
    version,
    stages,
    updatedBy: updatedBy || null,
  }
}

let schemaReady = null

/**
 * 惰性建表（进程内只成功执行一次；失败不缓存，下次重试）。
 * 与 ensureZoneSchema 同一模式：不依赖启动钩子，也不改既有表。
 */
export function ensureChainSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${CHAINS_TABLE} (
          id INT AUTO_INCREMENT PRIMARY KEY,
          chain_key VARCHAR(64) NOT NULL,
          label VARCHAR(100) NULL,
          applies_to JSON NOT NULL,
          scope ENUM('global','profession','agent','skill_group','skill') NOT NULL,
          target_id VARCHAR(64) NOT NULL DEFAULT '',
          priority INT NOT NULL DEFAULT 0,
          enabled TINYINT(1) NOT NULL DEFAULT 1,
          version INT NOT NULL DEFAULT 1,
          stages JSON NOT NULL,
          updated_by VARCHAR(64) NULL,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_chain_scope_target (chain_key, scope, target_id)
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

function readStoredAppliesTo(value) {
  const parsed = parseJson(value, {})
  if (Array.isArray(parsed)) return { damageKinds: parsed.filter((item) => typeof item === 'string') }
  if (!isPlainObject(parsed)) return { damageKinds: [] }
  const appliesTo = {
    damageKinds: Array.isArray(parsed.damageKinds)
      ? parsed.damageKinds.filter((item) => typeof item === 'string')
      : [],
  }
  if (Array.isArray(parsed.subKinds) && parsed.subKinds.length) {
    appliesTo.subKinds = parsed.subKinds.filter((item) => typeof item === 'string')
  }
  return appliesTo
}

function rowToChain(row) {
  const stages = parseJson(row.stages, [])
  return {
    id: Number(row.id),
    chainKey: String(row.chain_key ?? ''),
    label: row.label == null ? '' : String(row.label),
    appliesTo: readStoredAppliesTo(row.applies_to),
    scope: String(row.scope ?? ''),
    targetId: String(row.target_id ?? ''),
    priority: Number(row.priority) || 0,
    enabled: Boolean(Number(row.enabled)),
    version: Number(row.version) || 1,
    stages: Array.isArray(stages) ? stages : [],
    updatedBy: row.updated_by == null ? null : String(row.updated_by),
    updatedAt: toIsoString(row.updated_at),
  }
}

export async function listDamageChains({ scope, targetId, enabled, chainKey } = {}) {
  await ensureChainSchema()
  const clauses = []
  const params = []
  if (chainKey) {
    clauses.push('chain_key = ?')
    params.push(validateChainKey(chainKey))
  }
  if (scope) {
    clauses.push('scope = ?')
    params.push(validateChainScope(scope))
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
    `SELECT * FROM ${CHAINS_TABLE}${where}
     ORDER BY chain_key ASC,
       FIELD(scope, 'global', 'profession', 'agent', 'skill_group', 'skill'),
       priority DESC, id ASC`,
    params,
  )
  return rows.map(rowToChain)
}

/** 按 id 取链路；不存在返回 null（路由层决定 404） */
export async function getDamageChain(id) {
  const chainId = readInteger(id, 'id', { min: 1, max: Number.MAX_SAFE_INTEGER })
  await ensureChainSchema()
  const [rows] = await pool.query(`SELECT * FROM ${CHAINS_TABLE} WHERE id = ? LIMIT 1`, [chainId])
  return rows[0] ? rowToChain(rows[0]) : null
}

async function findByChainScopeTarget(chainKey, scope, targetId) {
  const [rows] = await pool.query(
    `SELECT * FROM ${CHAINS_TABLE}
     WHERE chain_key = ? AND scope = ? AND target_id = ? LIMIT 1`,
    [chainKey, scope, targetId],
  )
  return rows[0] ? rowToChain(rows[0]) : null
}

/**
 * 新增或更新链路。
 *
 * - 带 `id`：按 id 更新（不存在回 404）；改了唯一键且与别的行相撞 → 409。
 * - 不带 `id`：按 UNIQUE(chain_key, scope, target_id) upsert（管理端「保存」是整份覆盖）。
 * `version` 未显式给出时：新建=1，更新=旧值+1（发布版本由服务端推进）。
 */
export async function upsertDamageChain(input) {
  const doc = normalizeDamageChain(input)
  await ensureChainSchema()

  let existing = null
  if (doc.id != null) {
    existing = await getDamageChain(doc.id)
    if (!existing) {
      throw chainConfigError(`计算链路不存在：${doc.id}`, {
        code: 'DAMAGE_CHAIN_NOT_FOUND',
        status: 404,
      })
    }
    const occupant = await findByChainScopeTarget(doc.chainKey, doc.scope, doc.targetId)
    if (occupant && occupant.id !== existing.id) {
      throw chainConfigError(
        `链路 ${doc.chainKey} 在作用域 ${doc.scope}:${doc.targetId || '(空)'} 已有定义（id=${occupant.id}），不能重复`,
        { code: 'DAMAGE_CHAIN_CONFLICT', status: 409 },
      )
    }
  } else {
    existing = await findByChainScopeTarget(doc.chainKey, doc.scope, doc.targetId)
  }

  const version = doc.version ?? (existing ? existing.version + 1 : 1)
  const values = [
    doc.chainKey,
    doc.label || null,
    JSON.stringify(doc.appliesTo),
    doc.scope,
    doc.targetId,
    doc.priority,
    doc.enabled ? 1 : 0,
    version,
    JSON.stringify(doc.stages),
    doc.updatedBy,
  ]

  if (existing) {
    await pool.query(
      `UPDATE ${CHAINS_TABLE}
       SET chain_key = ?, label = ?, applies_to = ?, scope = ?, target_id = ?,
           priority = ?, enabled = ?, version = ?, stages = ?, updated_by = ?
       WHERE id = ?`,
      [...values, existing.id],
    )
    const saved = await getDamageChain(existing.id)
    return { created: false, chain: saved }
  }

  const [result] = await pool.query(
    `INSERT INTO ${CHAINS_TABLE}
       (chain_key, label, applies_to, scope, target_id,
        priority, enabled, version, stages, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values,
  )
  const saved = await getDamageChain(result.insertId)
  return { created: true, chain: saved }
}

/**
 * 删除链路：只有 `custom:*` 可删。
 * 内置链路（direct / anomaly / radiance-self 等）由代码提供，库里那行只是覆盖配置，
 * 硬删会让「覆盖被悄悄撤掉」，因此要求改成 enabled=0。
 */
export async function deleteDamageChain(id) {
  const chainId = readInteger(id, 'id', { min: 1, max: Number.MAX_SAFE_INTEGER })
  await ensureChainSchema()
  const existing = await getDamageChain(chainId)
  if (!existing) {
    throw chainConfigError(`计算链路不存在：${chainId}`, {
      code: 'DAMAGE_CHAIN_NOT_FOUND',
      status: 404,
    })
  }
  if (!isCustomChainKey(existing.chainKey)) {
    throw chainConfigError(
      `链路 ${existing.chainKey} 是内置链路（由代码提供），不允许删除；如需停用请设 enabled=false`,
      { code: 'DAMAGE_CHAIN_BUILTIN_PROTECTED', status: 409 },
    )
  }
  await pool.query(`DELETE FROM ${CHAINS_TABLE} WHERE id = ?`, [chainId])
  return { id: chainId, chainKey: existing.chainKey, deleted: true }
}

/**
 * 公共只读运行时数据：只返回 enabled 的链路，字段按契约收窄
 * （不带 updatedBy / updatedAt / enabled）。
 */
export async function listRuntimeDamageChains() {
  const chains = await listDamageChains({ enabled: true })
  return {
    version: 1,
    chains: chains.map((chain) => ({
      id: chain.id,
      chainKey: chain.chainKey,
      label: chain.label,
      appliesTo: chain.appliesTo,
      scope: chain.scope,
      targetId: chain.targetId,
      priority: chain.priority,
      version: chain.version,
      stages: chain.stages,
    })),
  }
}
