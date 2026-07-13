import { AGENT_MINDSCAPE_RANKS, createEmptyMindscapeNotes } from './calculatorUi'

/**
 * Split legacy character note into per-rank mindscape notes.
 * Recognizes section headers: 本体, 0影 ... 6影
 */
export function parseAgentNoteToMindscapeNotes(note: string): {
  note: string
  mindscapeNotes: string[]
} {
  const mindscapeNotes = createEmptyMindscapeNotes()
  const trimmed = (note ?? '').trim()
  if (!trimmed) {
    return { note: '', mindscapeNotes }
  }

  const hasRankSections = /(?:^|\n)(?:本体|[0-6]影)\s*/m.test(trimmed)
  if (!hasRankSections) {
    mindscapeNotes[0] = trimmed
    return { note: '', mindscapeNotes }
  }

  let preamble = ''
  const segments = trimmed.split(/(?=(?:^|\n)(?:本体|[0-6]影)\s*)/m)

  for (const segment of segments) {
    const seg = segment.trim()
    if (!seg) continue

    const head = seg.match(/^(本体|[0-6]影)\s*/)
    if (!head) {
      preamble += (preamble ? '\n\n' : '') + seg
      continue
    }

    const rank = head[1] === '本体' ? 0 : Number(head[1]![0])
    const body = seg.slice(head[0].length).trim()
    if (!body) continue

    mindscapeNotes[rank] += (mindscapeNotes[rank] ? '\n\n' : '') + body
  }

  return {
    note: preamble.trim(),
    mindscapeNotes,
  }
}

export function mergeMindscapeNotes(
  existing: string[] | undefined,
  parsed: string[],
): string[] {
  return AGENT_MINDSCAPE_RANKS.map((rank) => {
    const current = existing?.[rank]?.trim() ?? ''
    const next = parsed[rank]?.trim() ?? ''
    if (current && next) return `${current}\n\n${next}`
    return current || next
  })
}
