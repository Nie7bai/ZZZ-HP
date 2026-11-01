/**
 * 流程增益表（2026-09-22 定稿）的数据层。
 *
 * 把「流程招式 × 增益」组织成表格需要的**行 / 列 / 单元格状态**，并提供一个写回函数。
 * 全部是纯逻辑（除写回外），便于单测；UI 只管画。
 *
 * 定稿口径（用户逐条确认，见 dev-docs/skill-buff-per-row.md 第十/十一轮）：
 * - **一条增益 = 一列**：一个来源天生几条效果就出几列（同名靠圆圈数字区分）
 * - **列的分组 = 提供者**：角色1/2/3（按队伍顺序）→「其它」→「额外 Buff」
 * - **同名标记**：同一分组内第几次出现（只在重名时给）；招式行按全表编号
 * - **灰（不可点）的判据 = 受益者**：这条增益的受益者不在"这一行的受益者集合"里 → 灰
 * - **不参与的角色，其个人增益列不出现**（由页面传入的 items 保证，见 DamageCalcPage）
 * - 行级以**减法**为主（勾选）：与全局一致的不写；叠层 / 自行转模另可按行改数值
 *   （`stacksByEffectId` / `convertInputsByEffectId`，见 `dev-docs/row-buff-override-stacks-convert.md`）；
 *   四个键全空 = `null`（全部继承）
 * - 技能组：组行 = `entry.buffOverrides`，成员行 = `memberOverrides[].buffOverrides`（缺省继承整组）
 */
import type { SkillGroup } from '@/types/calculator'
import type { FlowBuffOverride, FlowEntry } from '@/types/damageCalcHistory'
import { isEffectEnabled, formatBuffEffectResultText } from '@/utils/buffEffect'
import {
  blockKeyOfCollected,
  getBuffEffectStacks,
  resolveCollectedEffectSourceSlot,
  type BuffSelectionState,
  type CollectedEffect,
} from '@/utils/panelBuffCalc'
import { BUFF_STAT_FIELDS, buffStatFieldLabel } from '@/utils/calculatorUi'
import type { ConvertResolveInputs, EffectParameterInputs, ResolvedEffectParameters, EventEffectSummary } from '@/utils/panelBuffCalc'
import { formatCalcSigned } from '@/utils/calcNumberFormat'

export interface FlowBuffTableRow {
  /** 唯一键：普通行 = 流程行 id；组成员 = `${行id}#${序号}:${skillId}` */
  key: string
  entryId: string
  label: string
  kind: 'skill' | 'group' | 'member'
  /** 同名招式第几次出现（圆圈数字用；不重名时为 null） */
  badge?: string | null
  memberKey?: string | null
  skillId?: string | null
}

export interface FlowBuffTableColumn {
  /** 唯一键 = `effect.id` */
  key: string
  /** 列名 = 来源名（blockName / sourceLabel） */
  label: string
  /** 同组内第几次出现（圆圈数字用；不重名时为 null） */
  badge?: string | null
  /** 提供者分组：`slot-<n>` / `other` / `extra` */
  groupKey: string
  /** 提供者分组名（角色名 / 其它 / 额外 Buff） */
  groupLabel: string
  /** 效果块键（判"整组关"的老数据用） */
  blockKey: string
  /** 提供者槽位（其它 / 额外 Buff = null） */
  providerSlotIndex: number | null
  /** 受益者槽位；null = 全队（所有行都吃） */
  beneficiarySlots: number[] | null
  /** 受益者文字（`全队` 或角色名）—— 界面显示用 */
  beneficiaryLabel: string
  /** 悬停卡片正文（列头与单元格**共用**）：数值 / 生效者 / 提供者 —— 都加粗显示 */
  details?: string[]
  /** 触发条件说明（长文本）—— 列头卡片里**默认收起**（点「说明」展开）；单元格卡片不带 */
  note?: string
  /** 卡片标题：能力块用**原始全名**（如「核心被动：风华盈袖」），其余用列头那个名字 */
  tipTitle?: string
}

export type FlowBuffCellState = 'on' | 'off' | 'na'

/**
 * 列名 → **短名**：去掉「核心被动：/额外能力：」这类**内容分类前缀**，留下有区分度的部分。
 *
 * 背景（2026-09-23 用户）：命名不规范，类别前缀占了大半列宽，而列头只有 96px。
 * 规则保守：只认中英文冒号，**只取最后一个分隔符之后**，且后面必须有内容才替换；
 * 全名不丢 —— 进悬停卡片。
 */
function shortBlockLabel(raw: string): string {
  const trimmed = raw.trim()
  const index = Math.max(trimmed.lastIndexOf('：'), trimmed.lastIndexOf(':'))
  if (index >= 0 && index < trimmed.length - 1) return trimmed.slice(index + 1).trim()
  return trimmed
}

/**
 * 列头名字：**按 `sourceKey` 分类型**给（2026-09-23 用户口径）。
 *
 * | 类型 | 识别 | 规则 |
 * |---|---|---|
 * | 角色能力块 | `agent-` | 去掉「核心被动：/额外能力：」这类类别前缀，留后半段 |
 * | 音擎 | `wengine-` | **音擎名 + 精炼** —— 只显示「精5」无法理解（用户原话） |
 * | 驱动盘 / 影画 / 邦布 / 场地 / 额外 Buff | 其余 | 原样不动（用户明确：2件套 与 影画 维持现状） |
 */
function columnLabelOf(
  sourceKey: string,
  fullLabel: string,
  blockName: string,
  providerName: string,
): string {
  if (sourceKey.startsWith('wengine-') && providerName && blockName) {
    return `${providerName} ${blockName}`
  }
  if (sourceKey.startsWith('agent-')) return shortBlockLabel(fullLabel)
  return fullLabel
}

function rawField(
  item: CollectedEffect,
  field: 'blockName' | 'sourceLabel' | 'blockNote' | 'providerName',
): string {
  const value = (item as unknown as Record<string, unknown>)[field]
  return typeof value === 'string' ? value.trim() : ''
}

/** 效果摘要：`增伤% +20` 这种（属性名走现有 label 表，取不到就退回 key）
 *  —— 顺序与 `formatBuffEffectResultText` 一致：属性名在前、数值在后 */
function effectSummary(item: CollectedEffect): string {
  const effect = item.effect
  const field = BUFF_STAT_FIELDS.find((entry) => entry.key === effect.stat)
  const label = field ? buffStatFieldLabel(field) : String(effect.stat ?? '')
  const value = typeof effect.value === 'number' && effect.value !== 0 ? formatCalcSigned(effect.value) : ''
  return `${label}${value ? ` ${value}` : ''}`.trim()
}

/**
 * 每条增益在界面上的显示文本（`+123 攻击力（数值）` 这种）。
 *
 * 与局内 Buff 勾选器**同一套取值口径**（否则转模效果会显示成 0）：
 * - 配置用途读取共享 configurationParameters.amount；
 * - 事件用途读取正式 effectSummaries / effectAmounts；
 * - 本文件只格式化数值，不解析默认值、层数或转模。
 *
 * 跨槽位来源由共享参数/正式记录的生产者解析，本文件不重新选择来源面板。
 */
export interface FlowBuffEffectTextOptions {
  configurationParameters?: Record<string, ResolvedEffectParameters>
  contextKind?: ConvertResolveInputs['contextKind']
  effectAmounts?: Record<string, number>
  /**
   * 逐效果投影（与 `ConvertResolveInputs.effectSummaries` 同名同义，Spec §2.3 第 2 项）。
   * 提供时**数值只从 summary 取**，不再回退到 UI 侧的层数/基数推导。
   */
  effectSummaries?: Record<string, EventEffectSummary>
  configurationOnly?: boolean
  /** **全队勾选对象**（不是单槽位解析结果）—— 与局内 Buff 勾选器传的是同一个东西 */
  selection: Parameters<typeof getBuffEffectStacks>[0] | null | undefined
  /** 当前槽位（叠层取值用） */
  slotIndex: number
  /** 槽位 → 角色 id（技能等级转模按效果所属角色取） */
  agentIdBySlot?: (string | null | undefined)[]
  attrDefaults?: EffectParameterInputs['attrValues']
  panelSourceValues?: EffectParameterInputs['panelSourceValues']
  panelSourceValuesBySlot?: Record<number, EffectParameterInputs['panelSourceValues']>
  /**
   * 全局（「选择局内 Buff」）手填的转模基数，按效果 id 取；缺省/返回 undefined = 按面板或默认值。
   * 与结算同一份输入：结算把 `BuffSelectionState.convertInputs` 作为覆盖值传给共同参数解析。
   */
  convertInputFor?: (effect: CollectedEffect['effect']) => number | undefined
  skillTalentLevelsByAgent?: Record<string, EffectParameterInputs['skillTalentLevels']>
  skillSubcategories?: NonNullable<
    Parameters<typeof formatBuffEffectResultText>[2]
  >['skillSubcategories']
}

/** 属性名（与单元格其它位置同一套标签，避免两处叫法不同） */
function summaryStatLabelFn(stat: Parameters<typeof buffStatFieldLabel>[0]['key'] | string): string {
  const field = BUFF_STAT_FIELDS.find((entry) => entry.key === stat)
  return field ? buffStatFieldLabel(field) : String(stat)
}

function summaryStatLabel(summary: EventEffectSummary): string {
  return summaryStatLabelFn(summary.stat)
}

/** 使用视图 → 展示名（Spec §5.2 第 2 项；不暴露内部键） */
const USE_VIEW_LABELS: Record<string, string> = {
  ownerPanel: '持有者面板',
  powerProviderPanel: '异常强度提供者',
  anomalyTriggerPanel: '异常类触发者',
  radianceSelfPanel: '本人耀变受限面板',
  mutationPanel: '异化面板',
  releaseMult: '异放倍率',
  convertSourcePanel: '转模来源面板',
}

function recipientLabel(summary: EventEffectSummary, recipient: EventEffectSummary['recipients'][number], sameSlotMultipleViews: boolean): string {
  if (!sameSlotMultipleViews) return recipient.label
  const views = recipient.usedViews.map((view) => USE_VIEW_LABELS[view] ?? String(view)).join('、')
  return views ? `${recipient.label}【${views}】` : recipient.label
}

/**
 * 来源/受益说明（Spec §2.3 第 2 项 / §5.2 第 2–3 项）。
 *
 * `displaySlotIndex` 是**本次预览调用显式传入的查看槽位**，不是事件持有者、也不是页面活动槽位；
 * 同一份 summary 在不同视角下文案不同，所以必须由调用方显式给。
 */
export function effectRecipientNote(
  summary: EventEffectSummary | undefined,
  displaySlotIndex: number,
): string {
  if (!summary) return ''
  const recipients = summary.recipients
  if (summary.state === 'inactive' || !recipients.length) {
    const candidates = summary.candidates
    if (candidates.length && candidates.every((item) => item.status === 'disabled')) return '已禁用'
    if (candidates.length && candidates.every((item) => item.status === 'not-enabled')) return '未启用'
    if (candidates.some((item) => item.status === 'applied' || item.status === 'zero')) {
      return '未被本事件采用'
    }
    return '未命中生效条件'
  }
  const sameSlotMultipleViews =
    new Set(recipients.map((item) => item.slotIndex)).size < recipients.length
  if (summary.state === 'single') {
    const only = recipients[0]
    if (!only) return ''
    if (only.slotIndex === displaySlotIndex) return ''
    return `来源：${recipientLabel(summary, only, sameSlotMultipleViews)}`
  }
  if (summary.state === 'same') {
    return `受益：${recipients.map((item) => recipientLabel(summary, item, sameSlotMultipleViews)).join('、')}`
  }
  // multiple：多受益，金额各自不同 —— 逐个列出，不取最大值/首项，也不求和
  return `多受益：${recipients
    .map((item) => `${recipientLabel(summary, item, sameSlotMultipleViews)} ${formatCalcSigned(item.amount)}`)
    .join('、')}`
}

/**
 * 单条效果的显示文本。
 *
 * `rowOverride` = **这一行**合并后的行级例外（组 + 成员）：叠层取它的层数、转模取它的基数，
 * 优先于全局选择器与默认值；传 null = 只看全局/面板（列级说明用）。
 */
export function buildFlowBuffEffectText(
  item: CollectedEffect,
  options: FlowBuffEffectTextOptions,
  rowOverride?: FlowBuffOverride | null,
): string {
  const effect = item.effect
  void rowOverride
  const kind = options.contextKind
  if (kind === 'group') return summaryStatLabelFn(effect.stat) + '（整组配置；数值见成员）'
  if (kind === 'unavailable') return summaryStatLabelFn(effect.stat) + '（配置参数；当前事件不可结算）'
  const summary = options.effectSummaries?.[effect.id]
  if (summary?.state === 'multiple') return summaryStatLabel(summary) + '（多受益角色，见来源）'
  const amount = kind === 'global' ? options.configurationParameters?.[effect.id]?.amount
    : summary ? summary.amount ?? 0 : options.effectAmounts?.[effect.id]
  if (amount == null) return summaryStatLabelFn(effect.stat) + ' —'

  // 与「行详情 / 覆盖弹窗 / 面板显示」统一：4 位四舍五入 + 千分位
  // （原先直接拼字符串，会把 2.0999999999999996 这种浮点噪声原样露出来）
  const amountText = formatCalcSigned(amount)
  return formatBuffEffectResultText(effect, amountText, {
    statLabelFn: (stat) => {
      const field = BUFF_STAT_FIELDS.find((entry) => entry.key === stat)
      return field ? buffStatFieldLabel(field) : String(stat)
    },
    skillSubcategories: options.skillSubcategories,
    // 与弹窗一致：非全局作用期加 [失衡期] / [非失衡期] 前缀（全局不加，避免噪音）
    applySituation: true,
  })
}

/**
 * 全表共用的一份文本（按效果 id）。
 *
 * ⚠️ 这是**列级说明**：只反映全局选择器/面板值，不含某一行的行级覆盖。
 * 单元格要显示"这一行的事件值"时用 `buildFlowBuffEffectText(item, options, rowOverride)`。
 */
export function buildFlowBuffEffectTexts(
  items: CollectedEffect[] | null | undefined,
  options: FlowBuffEffectTextOptions,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of items ?? []) {
    out[item.effect.id] = buildFlowBuffEffectText(item, options, null)
  }
  return out
}

/**
 * 从「适用槽位集合」里取唯一的受益槽位。
 * 恰好一个槽位 → 就是它；多个槽位（全队性质）→ null；缺字段（老调用）→ 退回按来源标记解析的那个。
 */
function pickSingleSlot(
  applicableSlots: number[] | undefined,
  parsedSlot: number | null,
  slotCount: number,
): number | null {
  if (Array.isArray(applicableSlots)) {
    if (applicableSlots.length !== 1) return null
    const only = applicableSlots[0]
    return only != null && only >= 0 && only < slotCount ? only : null
  }
  return parsedSlot != null && parsedSlot < slotCount ? parsedSlot : null
}

/**
 * 列 = **一条增益一列**，按提供者分组。
 *
 * `items` 由页面给出，已经是「所有人的 team 增益 + 参与角色的 self 增益」并集
 * （按 `effect.id` 去重），所以**不参与的角色，其个人增益天然不在这里**。
 */
export function buildFlowBuffTableColumns(input: {
  items: CollectedEffect[] | null | undefined
  slotLabels: string[]
  /**
   * 每条效果在悬停卡片里显示成什么（`+123 攻击力（数值）` 这种）。
   * 由页面给出（与局内 Buff 勾选器**同一套取值与格式化**，保证两边一致）；
   * 缺省退回 `effectSummary`（只有 `effect.value`，转模效果会显示成 0）。
   */
  textById?: Record<string, string> | null
}): FlowBuffTableColumn[] {
  const slotCount = input.slotLabels.length
  const groups = new Map<string, FlowBuffTableColumn[]>()
  for (const item of input.items ?? []) {
    const slotIndex = resolveCollectedEffectSourceSlot(item)
    const isExtra = item.sourceKey.startsWith('extra-')
    const groupKey = isExtra
      ? 'extra'
      : slotIndex != null && slotIndex < slotCount
        ? `slot-${slotIndex}`
        : 'other'
    const groupLabel = isExtra
      ? '额外 Buff'
      : groupKey === 'other'
        ? '其它'
        : (input.slotLabels[slotIndex ?? 0] ?? `角色${(slotIndex ?? 0) + 1}`)

    const blockName = rawField(item, 'blockName')
    const sourceLabel = rawField(item, 'sourceLabel')
    const providerName = rawField(item, 'providerName')
    const fullLabel = blockName || sourceLabel || '未命名增益'
    // 列头名字按类型给（音擎要带名字、能力块去前缀、其余原样），全名进悬停卡片
    const label = columnLabelOf(item.sourceKey, fullLabel, blockName, providerName)
    // 受益槽位（2026-09-24，施工规格 §2.1）：优先用收集器填好的「适用槽位集合」——
    // 恰好一个槽位 = 有明确受益者；多个槽位 = 全队性质；缺字段（老调用）退回按来源标记解析。
    const beneficiarySlot = pickSingleSlot(item.applicableSlots, slotIndex, slotCount)
    // `team` = 全队都吃（null）；否则受益者 = 这条增益所属槽位的角色
    const beneficiarySlots =
      item.effect.applyTarget === 'team' ? null : beneficiarySlot != null ? [beneficiarySlot] : null
    const beneficiaryLabel =
      beneficiarySlots == null
        ? '全队'
        : (input.slotLabels[beneficiarySlots[0] ?? 0] ?? `角色${(beneficiarySlots[0] ?? 0) + 1}`)
    const effectLine = input.textById?.[item.effect.id] || effectSummary(item)
    const providerLine = `提供者：${rawField(item, 'providerName') || sourceLabel || '未知'}`
    // 卡片正文（2026-09-23 用户口径）：数值 / 生效者 / 提供者，都加粗；归属分两行
    const details = [effectLine, `生效者：${beneficiaryLabel}`, providerLine].filter(Boolean)
    const note = rawField(item, 'blockNote')
    // 标题：能力块给**原始全名**（用户要求「全名显示在第一行，不要简写」）；其余给列头那个名字
    const tipTitle = item.sourceKey.startsWith('agent-') ? fullLabel : label

    const list = groups.get(groupKey) ?? []
    list.push({
      key: item.effect.id,
      label,
      badge: null,
      groupKey,
      groupLabel,
      blockKey: blockKeyOfCollected(item),
      providerSlotIndex: isExtra ? null : slotIndex,
      beneficiarySlots,
      beneficiaryLabel,
      details,
      note,
      tipTitle,
    })
    groups.set(groupKey, list)
  }

  // 分组顺序：角色1..N（按队伍顺序）→ 其它 → 额外 Buff
  const groupOrder = [
    ...[...Array(slotCount).keys()].map((index) => `slot-${index}`),
    'other',
    'extra',
  ]
  const out: FlowBuffTableColumn[] = []
  for (const groupKey of groupOrder) {
    const columns = groups.get(groupKey)
    if (!columns?.length) continue
    // 组内同名编号（不重名不给标记）
    const total = new Map<string, number>()
    for (const column of columns) total.set(column.label, (total.get(column.label) ?? 0) + 1)
    const seen = new Map<string, number>()
    for (const column of columns) {
      const nth = (seen.get(column.label) ?? 0) + 1
      seen.set(column.label, nth)
      column.badge = (total.get(column.label) ?? 0) > 1 ? String(nth) : null
      out.push(column)
    }
  }
  return out
}

/** 行 = 流程招式（与流程列表同源同序）；技能组展开为「组行 + 成员行」 */
export function buildFlowBuffTableRows(input: {
  flow: FlowEntry[]
  preparedName: (entry: FlowEntry) => string
  groupOf: (entry: FlowEntry) => SkillGroup | null
  memberKeyOf: (member: SkillGroup['members'][number]) => string
  sortMembers: (members: SkillGroup['members']) => SkillGroup['members']
  skillName: (skillId: string) => string | undefined
}): FlowBuffTableRow[] {
  const rows: FlowBuffTableRow[] = []
  const total = new Map<string, number>()
  for (const entry of input.flow) {
    const name = input.preparedName(entry)
    total.set(name, (total.get(name) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  for (const entry of input.flow) {
    const name = input.preparedName(entry)
    const nth = (seen.get(name) ?? 0) + 1
    seen.set(name, nth)
    // 重名才给标记：圆圈数字（2026-09-22 定稿，取代原来的「第 x 次」文字）
    const badge = (total.get(name) ?? 0) > 1 ? String(nth) : null
    const group = input.groupOf(entry)
    if (group) {
      rows.push({
        key: entry.id,
        entryId: entry.id,
        label: group.name?.trim() || '技能组',
        kind: 'group',
        badge,
      })
      input.sortMembers(group.members).forEach((member, memberIndex) => {
        rows.push({
          key: `${entry.id}#${memberIndex}:${member.skillId}`,
          entryId: entry.id,
          label: input.skillName(member.skillId) ?? '招式已删除',
          kind: 'member',
          memberKey: input.memberKeyOf(member),
          skillId: member.skillId,
        })
      })
      continue
    }
    rows.push({ key: entry.id, entryId: entry.id, label: name, kind: 'skill', badge })
  }
  return rows
}

/**
 * 这一段**自己写下**的例外（不含继承来的部分）。
 *
 * 写回时必须以它为基准：把继承来的内容实体化进这一段的存档，整组之后再改就传不到这一段了。
 */
export function ownRowOverride(
  entry: FlowEntry | null | undefined,
  memberKey: string | null | undefined,
): FlowBuffOverride | null {
  if (!entry) return null
  if (memberKey) {
    const found = (entry.memberOverrides ?? []).find((item) => item.memberKey === memberKey)
    return found?.buffOverrides ?? null
  }
  return entry.buffOverrides ?? null
}

/** 一份例外里什么都没写（四个键全空）= 全部继承（**空态判据只此一份**） */
export function isFlowBuffOverrideEmpty(
  override: FlowBuffOverride | null | undefined,
): boolean {
  if (!override) return true
  return (
    !override.disabledBlockIds?.length &&
    !override.disabledEffectIds?.length &&
    !Object.keys(override.stacksByEffectId ?? {}).length &&
    !Object.keys(override.convertInputsByEffectId ?? {}).length
  )
}

/**
 * 整组的例外 + 这一段的例外 → **合并**（2026-10-09 用户口径，取代原来的"整体替换"）。
 *
 * - 关闭项取**并集**：整组关的 + 这一段关的 —— 这一段不能把整组关掉的单独开回来
 * - 层数 / 自行转模**逐效果覆盖**：这一段写了的用这一段的，没写的继续继承整组
 * - 两边都空 → `null`
 *
 * 为什么要合并：原来"这一段有自己任何一条例外 → 整组那份全部失效"，
 * 于是"整组关了某条 + 这一段只是改了层数"会把那条增益**放回来**（用户 2026-10-09 反馈）。
 */
export function mergeFlowBuffOverride(
  group: FlowBuffOverride | null | undefined,
  member: FlowBuffOverride | null | undefined,
): FlowBuffOverride | null {
  if (!group) return isFlowBuffOverrideEmpty(member) ? null : (member ?? null)
  if (!member) return isFlowBuffOverrideEmpty(group) ? null : group
  const stacks = { ...(group.stacksByEffectId ?? {}), ...(member.stacksByEffectId ?? {}) }
  const converts = {
    ...(group.convertInputsByEffectId ?? {}),
    ...(member.convertInputsByEffectId ?? {}),
  }
  const merged: FlowBuffOverride = {
    disabledBlockIds: [
      ...new Set([...(group.disabledBlockIds ?? []), ...(member.disabledBlockIds ?? [])]),
    ],
    disabledEffectIds: [
      ...new Set([...(group.disabledEffectIds ?? []), ...(member.disabledEffectIds ?? [])]),
    ],
    stacksByEffectId: Object.keys(stacks).length ? stacks : null,
    convertInputsByEffectId: Object.keys(converts).length ? converts : null,
  }
  return isFlowBuffOverrideEmpty(merged) ? null : merged
}

/**
 * 这一段**真正生效**的例外 = 整组 + 自己（合并）——**读**的地方用它：
 * 结算（`resolvedHit`）与表格状态；**写**的地方用 `ownRowOverride`，两边别用混。
 */
export function effectiveRowOverride(
  entry: FlowEntry | null | undefined,
  memberKey: string | null | undefined,
): FlowBuffOverride | null {
  if (!entry) return null
  const own = ownRowOverride(entry, memberKey)
  if (!memberKey) return own
  return mergeFlowBuffOverride(entry.buffOverrides, own)
}

/**
 * 一份行级例外里有几条「与本行不同」的内容：禁用的块 / 单条 + 层数、转模的行级覆盖。
 *
 * **界面上的「例外 N」「增益 N」都用它** —— 各数各的最容易数漏，
 * 漏了用户就看不到"这一行/这一段改过"（层数、转模这类新版覆盖尤其容易漏）。
 */
export function flowBuffOverrideExceptionCount(
  override: FlowBuffOverride | null | undefined,
): number {
  if (!override) return 0
  return (
    (override.disabledBlockIds?.length ?? 0) +
    (override.disabledEffectIds?.length ?? 0) +
    Object.keys(override.stacksByEffectId ?? {}).length +
    Object.keys(override.convertInputsByEffectId ?? {}).length
  )
}

/** 行受益者计算的输入（结构性类型：传真实 hit 即可，utils 不依赖组件类型） */
export interface RowBeneficiaryHitInput {
  id: string
  ownerAgentId?: string | null
  anomalyPowerAgentId?: string | null
  triggerAgentId?: string | null
}

/**
 * 每一行的受益者槽位（持有者 + 异常强度提供者 + 触发者 → 槽位下标）；键 = 行键（`hit.id`）。
 *
 * ⚠️ 与「适用槽位集合」（`CollectedEffect.applicableSlots`）**不是一个东西**：这个是**行**长出来的，
 * 那个是**条目**的属性；判灰取两者交集。此前只在页面里算，2026-09-24 下沉到 utils（页面与 utils 共用、可单测）。
 */
export function resolveRowBeneficiarySlots(input: {
  hits: readonly RowBeneficiaryHitInput[]
  teamSlots: readonly { agentId?: string | null }[]
}): Map<string, number[]> {
  const indexOfAgent = (agentId?: string | null) =>
    agentId ? input.teamSlots.findIndex((slot) => slot.agentId === agentId) : -1
  const map = new Map<string, number[]>()
  for (const hit of input.hits) {
    const owner = indexOfAgent(hit.ownerAgentId)
    if (owner < 0) continue
    const slots = new Set<number>([owner])
    for (const agentId of [hit.anomalyPowerAgentId, hit.triggerAgentId]) {
      const index = indexOfAgent(agentId)
      if (index >= 0) slots.add(index)
    }
    map.set(hit.id, [...slots])
  }
  return map
}

/**
 * 单元格状态表：`${rowKey}|${columnKey}` → on / off / na
 *
 * `na`（不可点）三种来源：
 * ① 全局未启用（行级不能单独打开）
 * ② **这一行不吃这条**：受益者对不上（2026-09-22 定稿的灰法）
 * ③ 成员行：**整组已关**（合并语义下这一段同样不吃，也开不回来）
 */
export function buildFlowBuffTableStates(input: {
  rows: FlowBuffTableRow[]
  columns: FlowBuffTableColumn[]
  items: CollectedEffect[] | null | undefined
  flow: FlowEntry[]
  selection: BuffSelectionState | null | undefined
  /** 每一行的受益者槽位集合（持有者 / 强度提供者 / 触发者），按**行键**取 */
  beneficiarySlotsOf: (rowKey: string) => number[]
}): Record<string, FlowBuffCellState> {
  const itemByEffectId = new Map<string, CollectedEffect>()
  for (const item of input.items ?? []) itemByEffectId.set(item.effect.id, item)

  const entryById = new Map(input.flow.map((entry) => [entry.id, entry]))
  const out: Record<string, FlowBuffCellState> = {}
  for (const row of input.rows) {
    const entry = entryById.get(row.entryId) ?? null
    // 读：这一段真正生效的例外（整组 + 本段合并）
    const rowOverride = effectiveRowOverride(entry, row.memberKey ?? null)
    const groupOverride = row.kind === 'member' ? effectiveRowOverride(entry, null) : null
    const beneficiaries = input.beneficiarySlotsOf(row.key)
    for (const column of input.columns) {
      const cellKey = `${row.key}|${column.key}`
      const item = itemByEffectId.get(column.key)
      if (!item || !isEffectEnabled(item.effect, input.selection ?? null)) {
        out[cellKey] = 'na'
        continue
      }
      if (
        column.beneficiarySlots &&
        !column.beneficiarySlots.some((slot) => beneficiaries.includes(slot))
      ) {
        out[cellKey] = 'na'
        continue
      }
      // ③ 成员行「整组已关」：**整组关掉的这一段同样不吃**（合并语义，2026-10-09），
      //    表里灰、不能从这一段单独开回来 —— 与结算一致（`resolvedHit` 里合并整组 + 本段）。
      const groupOff =
        row.kind === 'member' &&
        (groupOverride?.disabledEffectIds?.includes(column.key) ||
          groupOverride?.disabledBlockIds?.includes(column.blockKey))
      if (groupOff) {
        out[cellKey] = 'na'
        continue
      }
      const off =
        rowOverride?.disabledEffectIds?.includes(column.key) ||
        rowOverride?.disabledBlockIds?.includes(column.blockKey)
      out[cellKey] = off ? 'off' : 'on'
    }
  }
  return out
}

/**
 * 写回一个单元格（就地改对象；由调用方换数组引用以触发上层重算）。
 *
 * 写**单条**（`disabledEffectIds`）。两处基准要说清：
 *
 * - 基准取**这一段自己写下的**例外（`ownRowOverride`）—— 继承来的部分不实体化进来，
 *   否则整组之后再改就传不到这一段了（合并语义下"继承"必须保持是继承）。
 * - 成员行只能**加**：整组关掉的这条，从这里点不出"开"（表格把它标成 `na`，根本点不到）；
 *   老数据里可能有"整组关"（`disabledBlockIds`）：这时把某一条**开回来** = 只留这一条。
 */
export function setFlowBuffEffectDisabled(input: {
  entry: FlowEntry
  effectId: string
  blockKey: string
  /** 同块其它效果 id（"只留这一条"的归一化用） */
  siblingEffectIds: string[]
  disabled: boolean
  memberKey?: string | null
  skillId?: string | null
}): void {
  const { entry, effectId, blockKey, siblingEffectIds, disabled, memberKey, skillId } = input
  const current = ownRowOverride(entry, memberKey ?? null)
  const blocks = new Set(current?.disabledBlockIds ?? [])
  const effects = new Set(current?.disabledEffectIds ?? [])

  if (disabled) {
    effects.add(effectId)
  } else {
    effects.delete(effectId)
    if (blocks.delete(blockKey)) {
      for (const id of siblingEffectIds) if (id !== effectId) effects.add(id)
    }
  }

  // 层数 / 转模的行级覆盖原样保留：这里是「勾选」那条线，不该顺手把数值覆盖清掉
  const merged: FlowBuffOverride = {
    disabledBlockIds: [...blocks],
    disabledEffectIds: [...effects],
    stacksByEffectId: current?.stacksByEffectId ?? null,
    convertInputsByEffectId: current?.convertInputsByEffectId ?? null,
  }
  const value: FlowBuffOverride | null = isFlowBuffOverrideEmpty(merged) ? null : merged

  if (memberKey) {
    const list = [...(entry.memberOverrides ?? [])]
    const index = list.findIndex((item) => item.memberKey === memberKey)
    const existing = index >= 0 ? list[index] : undefined
    if (existing) list[index] = { ...existing, buffOverrides: value }
    else list.push({ memberKey, skillId: skillId ?? '', buffOverrides: value })
    entry.memberOverrides = list
    return
  }
  entry.buffOverrides = value
}

/**
 * 从列名匹配搜索词（2026-09-23 用户要求）：**只比增益的名字** —— 列头显示的名字 + 全名
 * （能力块的原始全名放在 `tipTitle`；其余类型两者相同）。大小写与首尾空格不敏感。
 */
export function flowBuffColumnMatchesName(
  column: Pick<FlowBuffTableColumn, 'label' | 'tipTitle'>,
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  return `${column.label}\n${column.tipTitle ?? ''}`.toLowerCase().includes(q)
}

/** 一列里「可调整」的格子：`on` / `off` 才算；灰格（`na` = 全局未启用或该行不吃）不算 */
export function flowBuffColumnCounts(input: {
  rows: FlowBuffTableRow[]
  states: Record<string, FlowBuffCellState>
  columnKey: string
}): { on: number; off: number; total: number } {
  let on = 0
  let off = 0
  for (const row of input.rows) {
    const state = input.states[`${row.key}|${input.columnKey}`]
    if (state === 'on') on += 1
    else if (state === 'off') off += 1
  }
  return { on, off, total: on + off }
}

/**
 * 整列的开关状态（表头第三行那个三态框；2026-09-23 用户口径「全开／全关」）：
 * `on` = 这一列能调的格子都开着；`off` = 都关着；`mixed` = 各半；`na` = 一个能调的都没有。
 */
export function flowBuffColumnBulkState(input: {
  rows: FlowBuffTableRow[]
  states: Record<string, FlowBuffCellState>
  columnKey: string
}): 'on' | 'off' | 'mixed' | 'na' {
  const { on, off, total } = flowBuffColumnCounts(input)
  if (!total) return 'na'
  if (!off) return 'on'
  if (!on) return 'off'
  return 'mixed'
}
