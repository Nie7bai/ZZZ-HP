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
  '异常基础乘区（含等级区）取蕾米埃尔进入战斗那一刻的面板；耀变倍率/增伤/穿透仍按耀变规则结算。'
