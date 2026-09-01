import type { DamageEvent, DamageEventKind } from '@/types/calculator'
import { TRIGGER_AGENT_AT_CALC } from '@/types/calculator'
import { eventNeedsAnomalyProducer } from '@/utils/damageEvent'
import { findLuminousAgentInTeam, isLuminousAgent } from '@/utils/remielUtils'

export function resolveEventOwnerAgentId(
  event: DamageEvent,
  mainAgentId: string,
): string {
  const raw = event.ownerAgentId
  if (raw && raw !== TRIGGER_AGENT_AT_CALC) return raw
  return mainAgentId
}

export function collectParticipantAgentIds(
  events: DamageEvent[],
  mainAgentId: string,
): string[] {
  const ids = new Set<string>()
  for (const event of events) {
    const ownerId = resolveEventOwnerAgentId(event, mainAgentId)
    if (ownerId && ownerId !== mainAgentId) ids.add(ownerId)
    if (eventNeedsAnomalyProducer(event.kind)) {
      const triggerId = event.triggerAgentId
      if (triggerId && triggerId !== TRIGGER_AGENT_AT_CALC && triggerId !== mainAgentId) {
        ids.add(triggerId)
      }
    }
  }
  return [...ids]
}

/** 自定义伤害模式缓存键：主 C + 全部事件产生者/异常触发者（排序后拼接） */
export function collectDamageModeTeamAgentIds(
  events: DamageEvent[],
  mainAgentId: string,
): string[] {
  const ids = new Set<string>()
  if (mainAgentId) ids.add(mainAgentId)
  for (const event of events) {
    const ownerId = resolveEventOwnerAgentId(event, mainAgentId)
    if (ownerId) ids.add(ownerId)
    if (eventNeedsAnomalyProducer(event.kind)) {
      const triggerId = event.triggerAgentId
      if (triggerId && triggerId !== TRIGGER_AGENT_AT_CALC) ids.add(triggerId)
    }
  }
  return [...ids].sort()
}

export function buildDamageModeTeamKey(events: DamageEvent[], mainAgentId: string): string {
  return collectDamageModeTeamAgentIds(events, mainAgentId).join(',')
}

export function formatEventOwnerPrefix(agentName: string): string {
  const name = agentName.trim()
  return name ? `${name} · ` : ''
}

export interface DamageOwnerEventShare {
  eventId: string
  displayName: string
  total: number
  /** 单次期望（可选，用于明细展示） */
  perHit?: number
  /** 次数（可选） */
  count?: number
  /** 占全部可计算事件总伤的比例 */
  ratio: number
  /** 占该产生者合计伤害的比例 */
  ownerRatio: number
}

export interface DamageOwnerShare {
  agentId: string
  agentName: string
  total: number
  eventCount: number
  ratio: number
  events: DamageOwnerEventShare[]
}

export interface DamageOwnerShareSummary {
  shares: DamageOwnerShare[]
  grandTotal: number
}

export interface DamageOwnerShareInput {
  ownerAgentId: string
  eventId: string
  displayName: string
  total: number
  perHit?: number
  count?: number
}

/** 按归属者汇总可计算招式的伤害占比 */
export function summarizeDamageByOwner(
  items: DamageOwnerShareInput[],
  resolveAgent: (id: string) => { id: string; name: string } | undefined,
): DamageOwnerShareSummary {
  const bucket = new Map<
    string,
    {
      agentName: string
      total: number
      events: DamageOwnerEventShare[]
    }
  >()
  let grandTotal = 0
  for (const item of items) {
    const { ownerAgentId: ownerId, eventId, displayName, total } = item
    if (!(total > 0)) continue
    const agent = resolveAgent(ownerId)
    const agentName = agent?.name?.trim() || ownerId
    const prev = bucket.get(ownerId) ?? { agentName, total: 0, events: [] }
    prev.total += total
    prev.events.push({
      eventId,
      displayName,
      total,
      perHit: item.perHit,
      count: item.count,
      ratio: 0,
      ownerRatio: 0,
    })
    bucket.set(ownerId, prev)
    grandTotal += total
  }
  const shares = [...bucket.entries()]
    .map(([agentId, data]) => ({
      agentId,
      agentName: data.agentName,
      total: data.total,
      eventCount: data.events.length,
      ratio: grandTotal > 0 ? data.total / grandTotal : 0,
      events: data.events
        .map((event) => ({
          ...event,
          ratio: grandTotal > 0 ? event.total / grandTotal : 0,
          ownerRatio: data.total > 0 ? event.total / data.total : 0,
        }))
        .sort((a, b) => b.total - a.total),
    }))
    .sort((a, b) => b.total - a.total)
  return { shares, grandTotal }
}

export interface DamageEventKindOption {
  id: DamageEventKind
  label: string
  disabled?: boolean
  disabledReason?: string
}

export function getDamageEventKindOptionsForMode(
  modeType: 'direct' | 'anomaly',
  teamHasRemiel: boolean,
): DamageEventKindOption[] {
  if (modeType === 'direct') {
    return [
      { id: 'direct', label: '直伤' },
      { id: 'sharpen', label: '锐化' },
    ]
  }
  return [
    { id: 'anomaly', label: '异常' },
    { id: 'disorder', label: '紊乱' },
    { id: 'anomalyRelease', label: '异放' },
    { id: 'turbulence', label: '乱流' },
    {
      id: 'radiance',
      label: '耀变',
      disabled: !teamHasRemiel,
      disabledReason: '队伍需编入蕾米埃尔（流明）',
    },
  ]
}

export function resolveRadianceOwnerAgentId(
  teamSlots: Array<{ agentId: string }>,
  agents: Array<{ id: string; element: string }>,
): string | null {
  return findLuminousAgentInTeam(teamSlots, agents)?.id ?? null
}

export function isRadianceOwnerValid(
  event: DamageEvent,
  mainAgentId: string,
  agents: Array<{ id: string; element?: string | null }>,
): boolean {
  const ownerId = resolveEventOwnerAgentId(event, mainAgentId)
  const owner = agents.find((item) => item.id === ownerId)
  return isLuminousAgent(owner)
}

export type DamageEventAgentOption = {
  id: string
  name: string
  element?: string
}

/**
 * 队内选项 ∪ 事件已引用的产生者/异常触发者。
 * 已下阵角色仍保留展示（标注「未上阵」），不清空存储。
 */
export function mergeDamageEventAgentOptions(
  teamOptions: DamageEventAgentOption[],
  catalog: Array<{ id: string; name: string; element?: string | null }>,
  events: DamageEvent[],
  mainAgentId: string,
  formatName: (agent: { id: string; name: string; element?: string | null }, offTeam: boolean) => string = (
    agent,
    offTeam,
  ) => (offTeam ? `${agent.name}（未上阵）` : agent.name),
): DamageEventAgentOption[] {
  const map = new Map<string, DamageEventAgentOption>()
  for (const opt of teamOptions) {
    map.set(opt.id, opt)
  }

  const ensure = (agentId: string | null | undefined) => {
    if (!agentId || agentId === TRIGGER_AGENT_AT_CALC) return
    if (map.has(agentId)) return
    const agent = catalog.find((item) => item.id === agentId)
    if (!agent) {
      map.set(agentId, { id: agentId, name: `${agentId}（未上阵）` })
      return
    }
    map.set(agentId, {
      id: agent.id,
      name: formatName(agent, true),
      element: agent.element ?? undefined,
    })
  }

  for (const event of events) {
    if (event.ownerAgentId) ensure(event.ownerAgentId)
    ensure(resolveEventOwnerAgentId(event, mainAgentId))
    if (eventNeedsAnomalyProducer(event.kind)) ensure(event.triggerAgentId)
  }

  return [...map.values()]
}

export const RADIANCE_SELF_TRIGGER_HINT =
  '强度提供者为蕾米埃尔时启用本人耀变：异常基础 = 局内攻 × 局内精通区 × 特殊等级区 × 异化系数 × 等级区（局内攻 = 局外攻 + 自身攻击转模；局内精通 = 局外精通 + 四件套全局精通 + 音擎全局精通；攻/精不含队友增益；异化系数取最终局内面板）；最终 = 异常基础 × 防御区 × 抗性区 × 易伤区 × 失衡易伤区 × 耀变综合增伤 × 耀变倍率 × 特殊倍率乘区 × 特殊乘区。'
