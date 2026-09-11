import type { AffixCounts, AffixDriveDiscMainStats, PanelStats } from '@/types/calculatorPanel'
import type { AgentPanelSources } from '@/types/damageCalcHistory'
import type { BaseDamageSource } from '@/types/calculator'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'

/**
 * 招式流程「用哪份面板」的三态。
 *
 * ```
 * 主 C 局外面板 = 角色配置面板 + 叠加( 无 | 最优分配的词条数 | 当前点击柱的词条数 )
 * ```
 *
 * 三个选项的差别全在「叠不叠、叠哪一组」，除此之外没有第二套算法
 * （见 dev-docs/skill-flow-unification.md 步骤④）。
 */
export type SkillFlowPanelSourceMode = 'config' | 'allocation' | 'sweep'

/** 词条分析侧上报的候选来源（`config` 不需要上报：它就是角色配置面板） */
export interface SkillFlowPanelOption {
  mode: 'allocation' | 'sweep'
  /**
   * 该来源的主 C 局外面板（已由词条分析自己算出）。
   *
   * 传「算好的面板」而不是「词条数」：两个消费者拿到的必须是同一份数值，
   * 各自再叠一次会引入分叉（`computeExternalForEval` 的上下文在两侧并不完全相同）。
   */
  mainExternal: PanelStats
  /** 展示用摘要，如「最优分配 30 条」「柱图 · 大攻击 12 + 爆伤 18」 */
  label: string
  /** 算出这份面板时的上下文签名；与当前页级签名不一致 = 过期 */
  signature: string
  /** 算出这份面板时用的基础伤害来源（展示/排查用；它已含在页级签名里） */
  baseDamageSource: BaseDamageSource
}

/**
 * 页级上下文签名：**由页级能看到、且影响招式结算结果的输入拼成**。
 *
 * 用途只有一个：判断词条分析上报的那份面板是否还能代表「当前配置」。
 * 宁可多判过期（禁用选项），不可拿过期数字当有效 —— 后者会静默显示错的伤害。
 *
 * 逐字段从**响应式来源**读取：读取本身就是依赖收集，配置一变签名就变。
 * （曾经试过从深解包后的 ctx 取字段：那样读不建立依赖，配置变了签名也不变，
 * 会命中过期结果，实测踩过。）
 *
 * 刻意不放进签名的：`agents` / `wengines` / `driveDiscs` 文档本体（体积以 MB 计，
 * 且页面加载后不变）；逐条招式的差异由招式指纹承担。
 */
export function buildSkillFlowPageSignature(input: {
  teamSlots: TeamSlot[]
  slotPanels?: Record<string, AgentPanelSources>
  activeSlotPanels: Record<string, PanelStats>
  convertSlotPanels?: Record<string, Partial<Record<string, number>>>
  mainSlotIndex: number
  selectedBangbooId: string
  bangbooRefine: number
  slotBuffSelections?: unknown
  environmentBuffIds: readonly string[]
  extraGains: unknown
  enemyInput: unknown
  staggerPhase?: string
  damageKind?: string
  anomalySubKind?: string
  skillCategoryId?: string
  skillSubcategoryId?: string | null
  triggerAnomalyAgentId?: string | null
  /** 基础伤害来源（页级唯一一份，2026-09-11 起收到页级） */
  baseDamageSource?: string
  /** 4/5/6 主属性随来源记录走，这里带出全部记录即可覆盖 */
  driveDiscMainStatsByAgent?: unknown
}): string {
  return serializeSignatureFields({
    v: 1,
    src: input.baseDamageSource ?? null,
    main: input.mainSlotIndex,
    slots: input.teamSlots.map((slot) => [
      slot.agentId,
      slot.rank,
      slot.wengineId,
      slot.wengineRefine,
      slot.twoPieceDriveDiscId,
      slot.fourPieceDriveDiscId,
    ]),
    // 来源记录（含各份面板与 4/5/6 主属性）与已解析的激活面板都要进：任一改动都影响结果
    sources: input.slotPanels ?? null,
    panels: input.activeSlotPanels,
    convert: input.convertSlotPanels ?? null,
    bangboo: [input.selectedBangbooId, input.bangbooRefine],
    buffs: input.slotBuffSelections ?? null,
    env: [...input.environmentBuffIds],
    extra: input.extraGains,
    enemy: input.enemyInput,    stagger: input.staggerPhase ?? null,
    kind: [
      input.damageKind ?? null,
      input.anomalySubKind ?? null,
      input.skillCategoryId ?? null,
      input.skillSubcategoryId ?? null,
      input.triggerAnomalyAgentId ?? null,
    ],
  })
}

/**
 * 逐字段序列化：任何一个字段序列化失败（最常见的是**误传了 ref 而不是 `.value`** ——
 * ref 内部有 `dep` → `ReactiveEffect`，会成环）都直接抛出并把字段名带出来。
 *
 * 为什么不静默跳过出问题的字段：那是缓存键，少一个字段 = 配置变了反而命中旧结果
 * —— 数字看着对但是错的。宁可当场炸掉。
 */
function serializeSignatureFields(fields: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(fields)) {
    let encoded: string
    try {
      encoded = JSON.stringify(value ?? null)
    } catch (error) {
      throw new Error(
        `[skillFlowPanelSource] 签名字段 ${key} 无法序列化（是否误传 ref 而不是 .value？）：${String(error)}`,
      )
    }
    parts.push(`${key}=${encoded ?? 'null'}`)
  }
  return parts.join('|')
}

/** 一份可用来源的判定结果 */
export interface ResolvedSkillFlowPanelSource {
  /** 实际要用的主 C 局外面板；null = 用角色配置面板（选项①） */
  mainExternal: PanelStats | null
  /** 当前选项在这份配置下是否仍然有效 */
  active: boolean
  /** 失效原因（给界面提示用） */
  reason: string | null
}

/**
 * 从「当前选择 + 页级签名 + 词条分析上报的候选」解出实际要用的面板。
 *
 * 规则：选 ① 直接用配置面板；选 ②③ 但候选缺失或签名过期 → **回落到配置面板**
 * （不得显示 0 或旧值），并把原因回传给界面。
 */
export function resolveSkillFlowPanelSource(input: {
  mode: SkillFlowPanelSourceMode
  options: Partial<Record<'allocation' | 'sweep', SkillFlowPanelOption | null>>
  currentSignature: string
}): ResolvedSkillFlowPanelSource {
  if (input.mode === 'config') {
    return { mainExternal: null, active: true, reason: null }
  }
  const option = input.options[input.mode] ?? null
  if (!option) {
    return { mainExternal: null, active: false, reason: '尚未计算，先到「最优词条分配」里算一次' }
  }
  if (option.signature !== input.currentSignature) {
    return { mainExternal: null, active: false, reason: '配置已改动，请重新计算词条分析' }
  }
  return { mainExternal: option.mainExternal, active: true, reason: null }
}

/** 词条数的可读摘要（用于选项②③的标签） */
export function formatAffixCountsSummary(
  counts: AffixCounts,
  labels: Record<string, string>,
): string {
  const parts = Object.entries(counts)
    .filter(([, value]) => typeof value === 'number' && value > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([key, value]) => `${labels[key] ?? key} ${value}`)
  return parts.length ? parts.join(' + ') : '零词条'
}

export type { AffixDriveDiscMainStats }
