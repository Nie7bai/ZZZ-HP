import type { DamageCalcResult } from '@/utils/damageCalc'
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
 * 单条招式的指纹：只要这些字段有一个变了，这条招式的伤害就可能不同。
 *
 * 取两份旧指纹（面板侧 `buildResolvedHitSignature` 与最优侧 `hitFingerprint`）的**并集**：
 * 两份原本逐字相同，只差 `anomalySubKind`（它由 `damageType` 推出，属冗余字段，仍然带上）。
 */
export function buildHitEvalFingerprint(hit: ResolvedHit): string {
  return stableJson({
    id: hit.id,
    ownerAgentId: hit.ownerAgentId,
    anomalyPowerAgentId: hit.anomalyPowerAgentId,
    triggerAgentId: hit.triggerAgentId,
    count: hit.count,
    staggerPhase: hit.staggerPhase,
    critMode: hit.critMode,
    anomalySubKind: hit.anomalySubKind,
    skillId: hit.skill.id,
    damageType: hit.skill.damageType,
    baseMult: hit.skill.baseMult,
    effectiveBaseMult: hit.effectiveBaseMult,
    skillTalentLevel: hit.skillTalentLevel,
    baseMultFactor: hit.skill.baseMultFactor,
    settlementMult: hit.skill.settlementMult,
    skillTypes: hit.skill.skillTypes,
    buffAnchorId: hit.skill.buffAnchorId,
    multOverrides: hit.multOverrides,
    panelMods: hit.panelMods,
  })
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
  return `${fingerprint}|${contextToken}|${stableJson(mainExternal)}|${withDetails ? 'detail' : 'numbers'}`
}
