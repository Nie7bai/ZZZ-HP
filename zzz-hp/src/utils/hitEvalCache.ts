import type { DamageCalcResult } from '@/utils/damageCalc'
import type { OptimalEventEvalDetail } from '@/utils/optimalAffixAlloc'
import type { ResolvedHit } from '@/utils/resolvedHit'
import type { PanelStats } from '@/types/calculatorPanel'

/**
 * 招式结算的共享记忆表。
 *
 * 为什么是**一张**表：`evaluateOptimalEventDetail` 是纯函数 —— 输入相同必然结果相同。
 * 「面板计算」与「最优词条分配」只是**喂进去的局外面板不同**，即同一个函数的两组输入；
 * 两组输入各占表里的一行，互不覆盖。键里带「用的是哪份面板」，于是：
 *
 * - 同一份输入再问一次 → 命中，不重算；
 * - 换一份面板再问 → 键不同，写成新的一行。
 *
 * 合并前各有一张表、各自一套作废规则（面板侧「挂起恢复就全清 + 逐条比签名」、
 * 最优侧「上下文签名变了整表清」）。键既已包含全部输入，这些启发式不再需要，
 * 也就不存在「该清没清 / 不该清却清了」。
 *
 * 之所以**不**按 hitId 清理：两个消费者都写这张表，按 id 清会误删另一条链路刚写入的结果。
 * 容量上限负责回收（超限淘汰最早写入的）。
 */
export interface HitEvalCacheEntry {
  /** 回指流程条目（排查用，不参与判等） */
  hitId: string
  perHit: number
  total: number
  result: DamageCalcResult
  /**
   * 完整带记录结果（计算链路收敛 Spec §3.4 第 2 项）：只在 detail 轴保存。
   * 数字条目不带它；只有 summary/投影而没有面板、来源与路由的半成品也不许写在这里。
   */
  evaluation?: OptimalEventEvalDetail
}

const HIT_EVAL_CACHE_LIMIT = 500

const hitEvalCache = new Map<string, HitEvalCacheEntry>()
const hitEvalCacheStats = { hits: 0, misses: 0 }

export function readHitEvalCache(key: string): HitEvalCacheEntry | null {
  const cached = hitEvalCache.get(key)
  if (cached) {
    hitEvalCacheStats.hits += 1
    return cached
  }
  hitEvalCacheStats.misses += 1
  return null
}

export function writeHitEvalCache(key: string, entry: HitEvalCacheEntry): void {
  if (hitEvalCache.size >= HIT_EVAL_CACHE_LIMIT) {
    const oldest = hitEvalCache.keys().next().value
    if (oldest != null) hitEvalCache.delete(oldest)
  }
  hitEvalCache.set(key, entry)
}

export function clearHitEvalCache(): void {
  hitEvalCache.clear()
  hitEvalCacheStats.hits = 0
  hitEvalCacheStats.misses = 0
  // 指纹复用状态与这张表同生命周期（Spec §4.2 第 4/5 项：清理后不得再提供过期身份）
  resetHitEvalFingerprintReuseState()
}

/** 供测试脚本与排查用：当前条目数 / 命中次数 / 未命中次数 */
export function hitEvalCacheDebugStats(): {
  size: number
  hits: number
  misses: number
  limit: number
} {
  return {
    size: hitEvalCache.size,
    hits: hitEvalCacheStats.hits,
    misses: hitEvalCacheStats.misses,
    limit: HIT_EVAL_CACHE_LIMIT,
  }
}

/**
 * 稳定的 JSON 序列化：对象键按字典序排列后再序列化。
 *
 * 为什么需要：两份面板可能**值相同、键的插入顺序不同**（一份由「角色配置」直接给出、
 * 另一份由「基准面板叠加词条」算出来），而 `JSON.stringify` 对键序敏感 —— 不排序就会
 * 给同一份面板算出两个不同的键，记忆表便无法跨来源复用（实测：不排序时 140 条 = 两边各 70 条，
 * 排序后同一份面板共用一条）。
 */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      )
    }
    return v
  })
}

/**
 * 指纹复用的调试计数（**只数真实执行路径**，不含计时）。
 *
 * 为什么需要：词条评估的上下文身份链要回答「这一批事件指纹是不是又重算了一遍」，
 * 只能靠真实序列化次数观察 —— 常量、预设计数或 mock 都不算证据。
 * 与 `hitEvalCacheDebugStats` 同性质，只供测试与排查读取。
 */
const hitFingerprintDebug = { serializations: 0, reuses: 0, externalBuilds: 0 }

/** 复用层真实重建指纹的次数 / 复用次数 / 纯函数入口被调用的次数 */
export function hitFingerprintReuseDebugStats(): {
  serializations: number
  reuses: number
  externalBuilds: number
} {
  return { ...hitFingerprintDebug }
}

export function resetHitFingerprintDebugStats(): void {
  hitFingerprintDebug.serializations = 0
  hitFingerprintDebug.reuses = 0
  hitFingerprintDebug.externalBuilds = 0
}

/**
 * 指纹读取的字段集合 —— **唯一来源**：`buildHitEvalFingerprint`（纯函数）与
 * `buildHitEvalFingerprintReused`（跨候选复用）都从这里取，避免两张字段表各自漂移。
 *
 * **整条命中参与指纹，不维护字段白名单**（2026-11-04 收紧）：
 * 一次单条求值的输入就是「这条命中 + 计算上下文」，而上下文另有令牌。任何一条命中字段漏在
 * 指纹之外，症状都是「数字看着对但是旧的」且不报错。人工白名单曾漏掉 `coords` / `isFollowUp` /
 * `directSubKind` / `damageKind` 与招式的多个字段（改追击规则、改小类打标后不重算），
 * 所以改为整条序列化：将来 `ResolvedHit` 加字段，指纹自动带上。
 *
 * 代价只是「多算几个字节」：多算原文只可能让缓存多失效（更慢），不会更错。
 */
function hitEvalFingerprintFields(hit: ResolvedHit): Record<string, unknown> {
  // 顶层 `undefined` 统一成 `null`：同一份命中的 `buffOverride` 既可能是 undefined（字段存在但没值），
  // 也可能被调用方补成 null（`getHitBuffPreview` 的行级例外）。JSON 会丢掉 undefined 键、保留 null 键，
  // 不归一化就会给同一份内容算出两个指纹 —— 同一视图被重复求值，bench「逐视图阶段恰好一次」会 FAIL。
  // 只统一顶层（旧白名单也只对 `buffOverride` / `elementOverride` 做过 `?? null`），嵌套内容按原样参与比较。
  const fields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(hit)) fields[key] = value === undefined ? null : value
  return fields
}

/**
 * 单条招式的指纹：整条命中的规范化 JSON（见 `hitEvalFingerprintFields`）。
 *
 * 只要命中内容有任何变化，指纹必变；内容相同必得同一指纹。**不依赖人工字段表**，
 * 因此不存在「加了新字段却忘了进指纹」的漏网。
 */
export function buildHitEvalFingerprint(hit: ResolvedHit): string {
  hitFingerprintDebug.externalBuilds += 1
  return stableJson(hitEvalFingerprintFields(hit))
}

/**
 * 逐条招式的事件指纹复用状态（A：跨词条候选复用）。
 *
 * ## 为什么需要
 * 词条求解会对**同一个 `ctx`** 反复评估成百上千个候选词条。上下文身份里含「整批事件指纹」，
 * 而事件内容在这批候选之间完全不变 —— 每评估一个候选就把同一批指纹重算一遍，纯属浪费。
 *
 * ## 为什么不能只比对象引用
 * `ctx.hits`、`hit`、`hit.buffOverride` 都可能在**引用不变**的情况下被就地修改
 * （如 `hit.count = 2`、`buffOverride.disabledEffectIds.push(id)`、
 * `multOverrides.directDmgMult = 200`、`elementOverride = '火'`）。
 * 「引用没变」不等于「内容没变」，资格判定与缓存键都会因此读到过期结果。
 *
 * ## 做法：内容级校验 + 序列化结果复用
 * 每条指纹旁边存一份**深拷贝内容快照**（就地修改打不到它），每次询问按内容深比较：
 * - 内容一致 → 直接返回上次生成的指纹字符串（不重新序列化）；
 * - 内容有任何差异 → 按当前真实内容重新生成并刷新快照。
 *
 * 比较范围与指纹字段表**完全一致**（同一份 `hitEvalFingerprintFields`），因此识别强度不低于指纹本身；
 * 快照是深拷贝，所以数组 / 对象嵌套字段的就地修改同样会被识别。
 */
interface HitFingerprintReuseEntry {
  /** 生成指纹时的字段内容快照（深拷贝） */
  snapshot: Record<string, unknown>
  fingerprint: string
}

let hitFingerprintReuseState = new WeakMap<ResolvedHit, HitFingerprintReuseEntry>()

export interface HitFingerprintReuseResult {
  fingerprint: string
  /** 本次是否直接复用了已生成指纹（false = 按当前内容重建） */
  reused: boolean
}

/**
 * 取一条招式的指纹，**按真实内容**复用上一次生成结果。
 *
 * 纯函数语义不变：相同内容必得相同指纹；内容变了必得新指纹。
 * 与 `buildHitEvalFingerprint` 的唯一差别是不重复做序列化。
 */
export function buildHitEvalFingerprintReused(hit: ResolvedHit): HitFingerprintReuseResult {
  const fields = hitEvalFingerprintFields(hit)
  const memo = hitFingerprintReuseState.get(hit)
  if (memo && sameJsonContent(fields, memo.snapshot)) {
    hitFingerprintDebug.reuses += 1
    return { fingerprint: memo.fingerprint, reused: true }
  }
  const fingerprint = stableJson(fields)
  hitFingerprintDebug.serializations += 1
  hitFingerprintReuseState.set(hit, { snapshot: cloneJsonContent(fields) as Record<string, unknown>, fingerprint })
  return { fingerprint, reused: false }
}

/**
 * 丢弃全部指纹复用状态。
 *
 * 调用点：`clearHitEvalCache()`（本模块既有清理入口）与
 * `clearAffixEvalCache()`（词条评估既有清理入口，Spec §4.2 第 4 项要求清理后不得再提供过期身份）。
 * 复用状态本身按内容校验，丢弃只是保守收口，不改变任何结果。
 */
export function resetHitEvalFingerprintReuseState(): void {
  hitFingerprintReuseState = new WeakMap<ResolvedHit, HitFingerprintReuseEntry>()
}

function isPlainJsonContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return true
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * 内容深比较（不构造字符串）。
 *
 * 比 `stableJson` 等价更**严格**：`undefined` 自成一档、对象键集合必须一致、
 * 非纯对象（Map / 类实例等）一律判为「不同」。
 * 严格只会导致「多重建一次指纹」，绝不会漏掉变化 —— 这正是 Spec §4.2 第 3 项要的方向。
 */
function sameJsonContent(a: unknown, b: unknown): boolean {
  /**
   * 非纯对象（Map / Set / 类实例…）不进入「引用相同即相等」的快路：
   * 它们的内容无法用字段遍历核对，快照也只能留引用 —— 一律判为「不同」，
   * 于是每次都按真实内容重建指纹。宁可多算一次，不能读到过期身份。
   */
  if (typeof a === 'object' && a !== null && !isPlainJsonContainer(a)) return false
  if (typeof b === 'object' && b !== null && !isPlainJsonContainer(b)) return false
  if (a === b) return true
  // NaN 只可能来自数值字段；按内容相等处理，避免每次都判成变化
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b)
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const aIsArray = Array.isArray(a)
  if (aIsArray !== Array.isArray(b)) return false
  if (aIsArray) {
    const left = a as unknown[]
    const right = b as unknown[]
    if (left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) {
      if (!sameJsonContent(left[index], right[index])) return false
    }
    return true
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const leftKeys = Object.keys(left)
  if (leftKeys.length !== Object.keys(right).length) return false
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false
    if (!sameJsonContent(left[key], right[key])) return false
  }
  return true
}

/** 内容快照：深拷贝纯容器；非纯对象原样留下（比较时必判不同 → 每次重建，绝不stale） */
function cloneJsonContent(value: unknown): unknown {
  if (!isPlainJsonContainer(value)) return value
  if (Array.isArray(value)) return value.map(cloneJsonContent)
  const copy: Record<string, unknown> = {}
  for (const key of Object.keys(value)) copy[key] = cloneJsonContent((value as Record<string, unknown>)[key])
  return copy
}

/**
 * 上下文签名的**令牌表**：把长签名换成短令牌，并让「同内容 → 同令牌」。
 *
 * 为什么要换：键是「每条招式一份」，若把整段签名（各槽位面板 + 配置，约 10 KB）拼进每条键，
 * 500 条上限下光键就是数 MB；令牌表让同一份上下文在整张记忆表里只留一份正文（键降到约 1.3 KB）。
 *
 * 为什么需要「同内容 → 同令牌」：面板侧与最优侧若给出**同一份上下文**，就应共用同一行结果
 * （实测：不这样做时两边各写 70 条、互不共用）。
 *
 * 注意：签名必须由**响应式来源**拼出（在各自组件里维护）。曾经试图从 `ctx` 直接取，
 * 但 ctx 里是深解包后的原始对象，读它不建立依赖 —— 改了参数签名也不变，会命中过期结果。
 */
const contextTokenBySignature = new Map<string, string>()
const CONTEXT_TOKEN_LIMIT = 50
let contextTokenSeq = 0

export function internHitEvalContext(signature: string): string {
  const existing = contextTokenBySignature.get(signature)
  if (existing) return existing
  const token = `ctx-${++contextTokenSeq}`
  if (contextTokenBySignature.size >= CONTEXT_TOKEN_LIMIT) {
    const oldest = contextTokenBySignature.keys().next().value
    if (oldest != null) contextTokenBySignature.delete(oldest)
  }
  contextTokenBySignature.set(signature, token)
  return token
}

/**
 * 一条结算结果的键：招式指纹 + 上下文令牌 + 主 C 局外面板 + 是否带明细。
 *
 * 主 C 的局外面板单独进键（而不是只靠上面的签名）：它正是「用哪份面板」这根轴
 * —— 角色配置那份 / 基准 + 最优词条 / 基准 + 当前点击柱，三种输入各占一行。
 */
export function hitEvalCacheKey(
  fingerprint: string,
  contextToken: string,
  mainExternal: PanelStats,
  withDetails: boolean,
): string {
  return createHitEvalKeyBuilder(contextToken, mainExternal)(fingerprint, withDetails)
}

/**
 * 固定的「上下文令牌 + 主 C 面板」键前缀工厂。
 *
 * 同一份运行时里令牌与主 C 面板都不会变，而面板序列化（`stableJson`）与令牌查找原来要
 * **每条命中各做一次**。工厂把这两段算一次，键格式仍由这里单点维护
 * （`hitEvalCacheKey` 也走它），调用方只负责拼指纹与明细轴。
 */
export function createHitEvalKeyBuilder(
  contextToken: string,
  mainExternal: PanelStats,
): (fingerprint: string, withDetails: boolean) => string {
  const prefix = `${contextToken}|${stableJson(mainExternal)}`
  return (fingerprint, withDetails) => `${fingerprint}|${prefix}|${withDetails ? 'detail' : 'numbers'}`
}
