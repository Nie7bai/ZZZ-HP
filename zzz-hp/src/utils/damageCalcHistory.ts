import type { AgentBuffDoc } from '@/types/calculator'
import type {
  DamageCalcHistoryEntry,
  DamageCalcTeamSlotSnapshot,
} from '@/types/damageCalcHistory'

const STORAGE_KEY = 'zzz-hp-damage-calc-history'
const MAX_ENTRIES = 40

function readEntries(): DamageCalcHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is DamageCalcHistoryEntry => {
      return (
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.savedAt === 'number' &&
        Array.isArray(item.teamSlots) &&
        item.panelState &&
        typeof item.panelState === 'object'
      )
    })
  } catch {
    return []
  }
}

function writeEntries(entries: DamageCalcHistoryEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

export function listDamageCalcHistory(): DamageCalcHistoryEntry[] {
  return readEntries().sort((a, b) => b.savedAt - a.savedAt)
}

export function saveDamageCalcHistory(entry: DamageCalcHistoryEntry): DamageCalcHistoryEntry[] {
  const entries = readEntries().filter((item) => item.id !== entry.id)
  const next = [entry, ...entries].slice(0, MAX_ENTRIES)
  writeEntries(next)
  return next
}

export function removeDamageCalcHistory(id: string): DamageCalcHistoryEntry[] {
  const next = readEntries().filter((item) => item.id !== id)
  writeEntries(next)
  return next
}

export function createHistoryEntryId() {
  return `damage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function formatDamageCalcAgentSelection(
  teamSlots: DamageCalcTeamSlotSnapshot[],
  agents: AgentBuffDoc[],
): string {
  const labels = teamSlots.map((slot, index) => {
    if (!slot.agentId) return `槽位${index + 1}未选`
    const agent = agents.find((item) => item.id === slot.agentId)
    const name = agent?.name ?? '未知角色'
    return slot.isMainC ? `${name}（主C）` : name
  })
  return labels.join(' / ')
}

export function formatDamageCalcHistoryTime(savedAt: number) {
  const date = new Date(savedAt)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
