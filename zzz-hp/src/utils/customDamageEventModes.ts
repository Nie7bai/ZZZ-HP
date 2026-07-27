import type { DamageEvent, DamageEventMode, DamageEventModeType } from '@/types/calculator'

const STORAGE_KEY = 'zzz-hp-custom-damage-event-modes'

function safeParse(raw: string | null): DamageEventMode[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item) => normalizeMode(item as Record<string, unknown>))
      .filter((item) => item.id && item.name)
  } catch {
    return []
  }
}

function normalizeMode(item: Record<string, unknown>): DamageEventMode {
  const events = Array.isArray(item.events) ? item.events : []
  const modeType: DamageEventModeType = item.modeType === 'anomaly' ? 'anomaly' : 'direct'
  return {
    id: String(item.id ?? ''),
    agentId: String(item.agentId ?? ''),
    name: String(item.name ?? ''),
    modeType,
    events: events.map((raw, index) => {
      const entry = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
      return {
        id: String(entry.id ?? `evt-${index}`),
        kind: (entry.kind as DamageEvent['kind']) ?? (modeType === 'anomaly' ? 'anomaly' : 'direct'),
        categoryId: (entry.categoryId as DamageEvent['categoryId']) || 'basic',
        skillSubcategoryId:
          entry.skillSubcategoryId == null || entry.skillSubcategoryId === ''
            ? null
            : String(entry.skillSubcategoryId),
        count: Math.max(0, Number(entry.count) || 1),
        staggerPhase: entry.staggerPhase === 'normal' ? 'normal' : 'stagger',
        critMode:
          entry.critMode === 'noCrit' || entry.critMode === 'fullCrit'
            ? entry.critMode
            : 'expected',
        triggerAgentId:
          entry.triggerAgentId == null || entry.triggerAgentId === ''
            ? null
            : String(entry.triggerAgentId),
        skillBound: entry.skillBound === false ? false : entry.skillBound === true ? true : undefined,
        multOverrides: (entry.multOverrides as DamageEvent['multOverrides']) ?? null,
      }
    }),
  }
}

export function loadCustomModes(): DamageEventMode[] {
  if (typeof localStorage === 'undefined') return []
  return safeParse(localStorage.getItem(STORAGE_KEY))
}

export function saveCustomModes(modes: DamageEventMode[]) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(modes))
}

export function upsertCustomMode(mode: DamageEventMode): DamageEventMode[] {
  const list = loadCustomModes()
  const index = list.findIndex((item) => item.id === mode.id)
  if (index >= 0) list[index] = mode
  else list.push(mode)
  saveCustomModes(list)
  return list
}

export function removeCustomMode(id: string): DamageEventMode[] {
  const list = loadCustomModes().filter((item) => item.id !== id)
  saveCustomModes(list)
  return list
}

export function createCustomModeId() {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}
