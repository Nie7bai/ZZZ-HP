/**
 * Create calculator buff tables and import Edge localStorage cache.
 * Source: scripts/data/zzz-hp-calculator-buffs.json
 *
 * Usage:
 *   node scripts/import-calculator-buffs.mjs
 *   node scripts/import-calculator-buffs.mjs --file path/to/cache.json
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import mysql from 'mysql2/promise'
import {
  normalizeAgentBasePanel,
  normalizeTwoPieceMods,
  normalizeWengineAdvancedStats,
} from '../src/utils/calculatorBuffFields.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

const filePath =
  readArg('--file') || path.join(__dirname, 'data', 'zzz-hp-calculator-buffs.json')

const CREATE_SQL = fs.readFileSync(
  path.join(__dirname, '..', 'create_calculator_buff_tables.sql'),
  'utf8',
)

function asJson(value) {
  return JSON.stringify(value ?? null)
}

function normalizeAgent(item) {
  const mindscapeNotes = Array.isArray(item.mindscapeNotes)
    ? [0, 1, 2, 3, 4, 5, 6].map((index) =>
        typeof item.mindscapeNotes[index] === 'string' ? item.mindscapeNotes[index] : '',
      )
    : ['', '', '', '', '', '', '']
  return {
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    profession: String(item.profession ?? item.role ?? ''),
    element: String(item.element ?? ''),
    support_needs: Array.isArray(item.supportNeeds) ? item.supportNeeds : [],
    avatar_image: item.avatar_image ?? item.avatar ?? null,
    note: typeof item.note === 'string' ? item.note : '',
    base_panel: normalizeAgentBasePanel(item.basePanel),
    mindscape_notes: mindscapeNotes,
    mindscape_buffs: item.mindscapeBuffs ?? [],
    raw_json: { ...item, basePanel: normalizeAgentBasePanel(item.basePanel) },
  }
}

function normalizeBangboo(item) {
  return {
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    avatar_image: item.avatar_image ?? item.avatar ?? null,
    fixed_mods: item.fixedMods ?? item.fixedBuffs ?? {},
    refinement_mods: item.refinementMods ?? item.refinementBuffs ?? [],
    raw_json: item,
  }
}

function normalizeDriveDisc(item) {
  return {
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    avatar_image: item.avatar_image ?? item.avatar ?? null,
    two_piece_note:
      typeof item.twoPieceNote === 'string'
        ? item.twoPieceNote
        : typeof item.note === 'string'
          ? item.note
          : '',
    four_piece_note: typeof item.fourPieceNote === 'string' ? item.fourPieceNote : '',
    two_piece_mods: normalizeTwoPieceMods(item.twoPieceMods ?? item.twoPiece ?? {}),
    four_piece_buffs: item.fourPieceBuffs ?? item.fourPieceMods ?? item.fourPiece ?? {},
    raw_json: {
      ...item,
      twoPieceMods: normalizeTwoPieceMods(item.twoPieceMods ?? item.twoPiece ?? {}),
    },
  }
}

function normalizeWengine(item) {
  const advancedStats = normalizeWengineAdvancedStats(item.advancedStats)
  const baseAtk = Number(item.baseAtk) || 0
  return {
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    profession: String(item.profession ?? item.role ?? ''),
    rarity: String(item.rarity ?? 'A'),
    avatar_image: item.avatar_image ?? item.avatar ?? null,
    note: typeof item.note === 'string' ? item.note : '',
    base_atk: baseAtk,
    advanced_stats: advancedStats,
    fixed_buffs: item.fixedBuffs ?? {},
    refinement_buffs: item.refinementBuffs ?? [],
    raw_json: { ...item, baseAtk, advancedStats, note: typeof item.note === 'string' ? item.note : '' },
  }
}

async function upsertMany(conn, sql, rows, mapParams) {
  let inserted = 0
  for (const row of rows) {
    await conn.execute(sql, mapParams(row))
    inserted += 1
  }
  return inserted
}

async function main() {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Cache file not found: ${filePath}`)
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const agents = (data.agents ?? []).map(normalizeAgent).filter((x) => x.id)
  const bangboos = (data.bangboos ?? []).map(normalizeBangboo).filter((x) => x.id)
  const driveDiscs = (data.driveDiscs ?? []).map(normalizeDriveDisc).filter((x) => x.id)
  const wengines = (data.wengines ?? []).map(normalizeWengine).filter((x) => x.id)

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '123456',
    database: process.env.DB_NAME || 'zzz',
    multipleStatements: true,
  })

  try {
    await conn.query(CREATE_SQL)

    await conn.beginTransaction()

    const agentCount = await upsertMany(
      conn,
      `INSERT INTO \`character\`
        (id, name, profession, element, support_needs, avatar_image, note, base_panel, mindscape_notes, mindscape_buffs, raw_json)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         profession = VALUES(profession),
         element = VALUES(element),
         support_needs = VALUES(support_needs),
         avatar_image = VALUES(avatar_image),
         note = VALUES(note),
         base_panel = VALUES(base_panel),
         mindscape_notes = VALUES(mindscape_notes),
         mindscape_buffs = VALUES(mindscape_buffs),
         raw_json = VALUES(raw_json)`,
      agents,
      (row) => [
        row.id,
        row.name,
        row.profession,
        row.element,
        asJson(row.support_needs),
        row.avatar_image,
        row.note,
        asJson(row.base_panel),
        asJson(row.mindscape_notes),
        asJson(row.mindscape_buffs),
        asJson(row.raw_json),
      ],
    )

    const bangbooCount = await upsertMany(
      conn,
      `INSERT INTO \`bangboo\`
        (id, name, avatar_image, fixed_mods, refinement_mods, raw_json)
       VALUES (?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         avatar_image = VALUES(avatar_image),
         fixed_mods = VALUES(fixed_mods),
         refinement_mods = VALUES(refinement_mods),
         raw_json = VALUES(raw_json)`,
      bangboos,
      (row) => [
        row.id,
        row.name,
        row.avatar_image,
        asJson(row.fixed_mods),
        asJson(row.refinement_mods),
        asJson(row.raw_json),
      ],
    )

    const discCount = await upsertMany(
      conn,
      `INSERT INTO \`drive_disc\`
        (id, name, avatar_image, two_piece_note, four_piece_note, two_piece_mods, four_piece_buffs, raw_json)
       VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         avatar_image = VALUES(avatar_image),
         two_piece_note = VALUES(two_piece_note),
         four_piece_note = VALUES(four_piece_note),
         two_piece_mods = VALUES(two_piece_mods),
         four_piece_buffs = VALUES(four_piece_buffs),
         raw_json = VALUES(raw_json)`,
      driveDiscs,
      (row) => [
        row.id,
        row.name,
        row.avatar_image,
        row.two_piece_note,
        row.four_piece_note,
        asJson(row.two_piece_mods),
        asJson(row.four_piece_buffs),
        asJson(row.raw_json),
      ],
    )

    const wengineCount = await upsertMany(
      conn,
      `INSERT INTO \`W-Engine\`
        (id, name, profession, rarity, avatar_image, note, base_atk, advanced_stats, fixed_buffs, refinement_buffs, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         profession = VALUES(profession),
         rarity = VALUES(rarity),
         avatar_image = VALUES(avatar_image),
         note = VALUES(note),
         base_atk = VALUES(base_atk),
         advanced_stats = VALUES(advanced_stats),
         fixed_buffs = VALUES(fixed_buffs),
         refinement_buffs = VALUES(refinement_buffs),
         raw_json = VALUES(raw_json)`,
      wengines,
      (row) => [
        row.id,
        row.name,
        row.profession,
        row.rarity,
        row.avatar_image,
        row.note,
        row.base_atk,
        asJson(row.advanced_stats),
        asJson(row.fixed_buffs),
        asJson(row.refinement_buffs),
        asJson(row.raw_json),
      ],
    )

    await conn.commit()

    const [[c1]] = await conn.query('SELECT COUNT(*) AS c FROM `character`')
    const [[c2]] = await conn.query('SELECT COUNT(*) AS c FROM `bangboo`')
    const [[c3]] = await conn.query('SELECT COUNT(*) AS c FROM `drive_disc`')
    const [[c4]] = await conn.query('SELECT COUNT(*) AS c FROM `W-Engine`')

    // Round-trip check: raw_json equals source for a few samples
    const [[sampleAgent]] = await conn.query(
      'SELECT id, name, JSON_LENGTH(mindscape_buffs) AS mind_len, note FROM `character` WHERE id = ?',
      [agents[0]?.id],
    )
    const [[sampleDisc]] = await conn.query(
      'SELECT id, name, CHAR_LENGTH(two_piece_note) AS note2_len, CHAR_LENGTH(four_piece_note) AS note4_len FROM `drive_disc` WHERE four_piece_note <> "" LIMIT 1',
    )

    console.log(
      JSON.stringify(
        {
          sourceFile: filePath,
          imported: {
            character: agentCount,
            bangboo: bangbooCount,
            drive_disc: discCount,
            'W-Engine': wengineCount,
          },
          tableCounts: {
            character: c1.c,
            bangboo: c2.c,
            drive_disc: c3.c,
            'W-Engine': c4.c,
          },
          sampleAgent,
          sampleDisc,
        },
        null,
        2,
      ),
    )
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    await conn.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
