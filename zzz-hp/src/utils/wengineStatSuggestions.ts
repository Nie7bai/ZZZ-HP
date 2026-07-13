const STORAGE_KEY = 'zzz-hp-wengine-stat-suggestions'
const MAX_SUGGESTIONS = 40

type SuggestionMap = Record<string, number[]>

function readStore(): SuggestionMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: SuggestionMap = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue
      const numbers = value
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item))
      if (numbers.length) result[key] = numbers
    }
    return result
  } catch {
    return {}
  }
}

function writeStore(store: SuggestionMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

function normalizeValue(value: number) {
  return Math.round(value * 10000) / 10000
}

function sortValues(values: number[]) {
  return [...values].sort((a, b) => a - b)
}

export function getWengineStatSuggestions(fieldKey: string): number[] {
  const store = readStore()
  return sortValues(store[fieldKey] ?? [])
}

export function rememberWengineStatValue(fieldKey: string, value: unknown): number[] {
  if (value === '' || value == null) return getWengineStatSuggestions(fieldKey)
  const num = Number(value)
  if (!Number.isFinite(num)) return getWengineStatSuggestions(fieldKey)

  const normalized = normalizeValue(num)
  const store = readStore()
  const current = store[fieldKey] ?? []
  const next = sortValues(
    [normalized, ...current.filter((item) => normalizeValue(item) !== normalized)].slice(
      0,
      MAX_SUGGESTIONS,
    ),
  )
  store[fieldKey] = next
  writeStore(store)
  return next
}

export function removeWengineStatSuggestion(fieldKey: string, value: unknown): number[] {
  const num = Number(value)
  if (!Number.isFinite(num)) return getWengineStatSuggestions(fieldKey)

  const normalized = normalizeValue(num)
  const store = readStore()
  const current = store[fieldKey] ?? []
  const next = sortValues(current.filter((item) => normalizeValue(item) !== normalized))
  if (next.length) {
    store[fieldKey] = next
  } else {
    delete store[fieldKey]
  }
  writeStore(store)
  return next
}

export const WENGINE_BASE_ATK_FIELD_KEY = 'baseAtk'

export function wengineAdvancedStatFieldKey(key: string) {
  return `advancedStats.${key}`
}
