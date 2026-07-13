import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

dotenv.config()

const MINDSCAPE_RANKS = [0, 1, 2, 3, 4, 5, 6]

function createEmptyMindscapeNotes() {
  return MINDSCAPE_RANKS.map(() => '')
}

function parseAgentNoteToMindscapeNotes(note) {
  const mindscapeNotes = createEmptyMindscapeNotes()
  const trimmed = String(note ?? '').trim()
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

    const rank = head[1] === '本体' ? 0 : Number(head[1][0])
    const body = seg.slice(head[0].length).trim()
    if (!body) continue

    mindscapeNotes[rank] += (mindscapeNotes[rank] ? '\n\n' : '') + body
  }

  return {
    note: preamble.trim(),
    mindscapeNotes,
  }
}

function mergeMindscapeNotes(existing, parsed) {
  return MINDSCAPE_RANKS.map((rank) => {
    const current = String(existing?.[rank] ?? '').trim()
    const next = String(parsed[rank] ?? '').trim()
    if (current && next) return `${current}\n\n${next}`
    return current || next
  })
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'zzz',
})

const [rows] = await conn.query(
  'SELECT id, name, note, mindscape_notes, raw_json FROM `character`',
)

let updated = 0
for (const row of rows) {
  const legacyNote = String(row.note ?? '').trim()
  if (!legacyNote) continue

  const existingNotes = Array.isArray(row.mindscape_notes)
    ? row.mindscape_notes
    : typeof row.mindscape_notes === 'string'
      ? JSON.parse(row.mindscape_notes)
      : []

  const parsed = parseAgentNoteToMindscapeNotes(legacyNote)
  const mindscapeNotes = mergeMindscapeNotes(existingNotes, parsed.mindscapeNotes)
  const raw =
    row.raw_json && typeof row.raw_json === 'object'
      ? { ...row.raw_json }
      : typeof row.raw_json === 'string'
        ? JSON.parse(row.raw_json)
        : {}

  raw.note = parsed.note
  raw.mindscapeNotes = mindscapeNotes

  await conn.execute(
    `UPDATE \`character\`
     SET note = ?, mindscape_notes = CAST(? AS JSON), raw_json = CAST(? AS JSON)
     WHERE id = ?`,
    [parsed.note, JSON.stringify(mindscapeNotes), JSON.stringify(raw), row.id],
  )

  updated += 1
  const filled = mindscapeNotes
    .map((n, i) => (String(n).trim() ? i : null))
    .filter((n) => n !== null)
    .join(',')
  console.log(
    `[ok] ${row.name}: preamble=${parsed.note ? 'yes' : 'no'}, ranks=[${filled}]`,
  )
}

console.log(`Updated ${updated} / ${rows.length} characters`)
await conn.end()
