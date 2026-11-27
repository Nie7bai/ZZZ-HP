/**
 * 得分机制多套存储（与场地 Buff 的「套」同构，但不带图片/效果块）。
 *
 * - 怪物库 `boss_info.scoring_note_sets`：JSON 数组，每套 `{ id, label, name, text }`；
 * - 期数行 `boss.scoring_note_set_id`：本期绑定哪一套；空 = 第一套（自动）；
 * - 旧单列 `boss_info.scoring_note` 继续镜像第一套文本，兼容旧读路径。
 */

let seq = 0

export function makeScoringNoteSetId() {
  seq += 1
  return `sn_${Date.now().toString(36)}_${seq}`
}

/** 单套归一化：只保留 label / name / text；全空视为无效 */
export function normalizeScoringNoteSet(raw, fallbackId = 'legacy') {
  if (!raw || typeof raw !== 'object') return null
  const label = String(raw.label ?? '').trim() || null
  const name = String(raw.name ?? '').trim()
  const text = String(raw.text ?? '').trim()
  if (!name && !text) return null
  return {
    id: String(raw.id ?? '').trim() || fallbackId,
    label,
    name: name || '得分机制',
    text,
  }
}

export function parseScoringNoteSetsJson(value) {
  if (value == null || value === '') return []
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []
  const out = []
  const seen = new Set()
  parsed.forEach((entry, index) => {
    const set = normalizeScoringNoteSet(entry, `sn_${index + 1}`)
    if (!set) return
    let id = set.id
    let suffix = 2
    while (seen.has(id)) {
      id = `${set.id}_${suffix}`
      suffix += 1
    }
    seen.add(id)
    out.push({ ...set, id })
  })
  return out
}

export function serializeScoringNoteSets(sets) {
  return JSON.stringify(Array.isArray(sets) ? sets : [])
}

/** 旧单列文本 → 单套（读路径兼容） */
export function scoringNoteSetsFromLegacy(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return []
  return [{ id: 'legacy', label: null, name: '得分机制', text: trimmed }]
}

/** 第一套文本镜像回旧单列 */
export function mirrorScoringNoteLegacy(sets) {
  const first = Array.isArray(sets) ? sets[0] : null
  return first?.text?.trim() || null
}

/** 按绑定 id 取套；空/找不到回落第一套 */
export function resolveScoringNoteSet(sets, setId) {
  if (!Array.isArray(sets) || !sets.length) return null
  const id = String(setId ?? '').trim()
  if (id) {
    const match = sets.find((set) => set.id === id)
    if (match) return match
  }
  return sets[0]
}
