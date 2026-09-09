import { reactive } from 'vue'

const STORAGE_KEY = 'zzz-hp-skill-note-overrides'

/** skillId → 用户本机备注；有键即视为已覆盖管理端/库备注（可为空串） */
const state = reactive({
  map: {} as Record<string, string>,
  ready: false,
})

function readStorage(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const id = String(key ?? '').trim()
      if (!id || typeof value !== 'string') continue
      next[id] = value.trim()
    }
    return next
  } catch {
    return {}
  }
}

function writeStorage(map: Record<string, string>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* 配额超限时静默，与方案库一致 */
  }
}

function ensureLoaded(): void {
  if (state.ready) return
  state.map = readStorage()
  state.ready = true
}

/** 是否存在用户覆盖（含空备注） */
export function hasSkillNoteOverride(skillId: string): boolean {
  ensureLoaded()
  return Object.prototype.hasOwnProperty.call(state.map, skillId)
}

/**
 * 展示用备注：有本机覆盖用覆盖，否则用库/管理端备注。
 * 读取 reactive map，便于模板自动刷新。
 */
export function resolveSkillNote(skillId: string, baseNote?: string | null): string {
  ensureLoaded()
  if (Object.prototype.hasOwnProperty.call(state.map, skillId)) {
    return state.map[skillId] ?? ''
  }
  return (baseNote ?? '').trim()
}

/** 写入本机覆盖；传 null 删除覆盖（恢复库备注） */
export function setSkillNoteOverride(skillId: string, note: string | null): void {
  const id = skillId.trim()
  if (!id) return
  ensureLoaded()
  if (note === null) {
    if (!Object.prototype.hasOwnProperty.call(state.map, id)) return
    delete state.map[id]
  } else {
    state.map[id] = note.trim()
  }
  writeStorage({ ...state.map })
}

export function clearSkillNoteOverride(skillId: string): void {
  setSkillNoteOverride(skillId, null)
}
