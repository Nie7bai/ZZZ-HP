export interface GuestbookCustomSticker {
  id: string
  url: string
  createdAt: number
}

const STORAGE_KEY = 'zzz-hp-guestbook-stickers'
export const MAX_CUSTOM_STICKERS = 48

function readRaw(): GuestbookCustomSticker[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item.url === 'string' && item.url.trim())
      .map((item) => ({
        id: String(item.id || item.url),
        url: String(item.url).trim(),
        createdAt: Number(item.createdAt) || Date.now(),
      }))
      .slice(0, MAX_CUSTOM_STICKERS)
  } catch {
    return []
  }
}

function writeRaw(list: GuestbookCustomSticker[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_CUSTOM_STICKERS)))
}

export function loadCustomStickers() {
  return readRaw()
}

export function hasCustomSticker(url: string) {
  const normalized = String(url || '').trim()
  if (!normalized) return false
  return readRaw().some((item) => item.url === normalized)
}

export function addCustomSticker(url: string) {
  const normalized = String(url || '').trim()
  if (!normalized) return readRaw()
  const existing = readRaw().filter((item) => item.url !== normalized)
  const next: GuestbookCustomSticker = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url: normalized,
    createdAt: Date.now(),
  }
  writeRaw([next, ...existing])
  return readRaw()
}

export function removeCustomSticker(id: string) {
  writeRaw(readRaw().filter((item) => item.id !== id))
  return readRaw()
}
