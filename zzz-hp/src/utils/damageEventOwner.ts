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

export function formatEventOwnerPrefix(agentName: string): string {
  const name = agentName.trim()
  return name ? `${name} · ` : ''
}

export interface DamageOwnerEventShare {
  eventId: string
  displayName: string
  total: number
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
  event: DamageEvent
  eventId: string
  displayName: string
  total: number
}

/** 按事件产生角色（owner）汇总可计算事件伤害占比 */
export function summarizeDamageByOwner(
  items: DamageOwnerShareInput[],
  mainAgentId: string,
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
    const { event, eventId, displayName, total } = item
    if (!(total > 0)) continue
    const ownerId = resolveEventOwnerAgentId(event, mainAgentId)
    const agent = resolveAgent(ownerId)
    const agentName = agent?.name?.trim() || ownerId
    const prev = bucket.get(ownerId) ?? { agentName, total: 0, events: [] }
    prev.total += total
    prev.events.push({
      eventId,
      displayName,
      total,
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
    return [{ id: 'direct', label: '直伤' }]
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

export const RADIANCE_SELF_TRIGGER_HINT =
  '本人耀变 = 蕾米埃尔异常基础 × 防御区 × 抗性区 × 耀变综合增伤 × 耀变倍率；异常基础 = 局内攻 × 局内精通区 × 特殊等级区 × 异化系数 × 等级区（局内攻/精不含队友增益）。'
