import pool from '../config/db.js'
import { listSkillSubcategories } from './skillSubcategoryService.js'

const WENGINE_TABLE = '`W-Engine`'

const EMPTY_AGENT_BASE_PANEL = {
  hp: 0,
  atk: 0,
  def: 0,
  critRate: 0,
  critDmg: 0,
  mastery: 0,
  anomalyControl: 0,
  energyRegen: 0,
  penRate: 0,
  dmgBonus: 0,
  pen: 0,
  anomalyCritRate: 0,
  anomalyCritDmg: 0,
  anomalyDmgBonus: 0,
  directDmgMult: 100,
  anomalyMult: 0,
  disorderBaseMult: 0,
  anomalyDuration: 0,
  disorderCompMult: 0,
  turbulenceBaseMult: 0,
  turbulenceCompMult: 0,
  disorderDmgBonus: 0,
  turbulenceDmgBonus: 0,
}

const EMPTY_WENGINE_ADVANCED_STATS = {
  critRate: 0,
  critDmg: 0,
  energyRegen: 0,
  mastery: 0,
  externalAtkPercent: 0,
  externalHpPercent: 0,
  penRate: 0,
}

const BUFF_STAT_KEYS = [
  'hp',
  'inCombatHpPercent',
  'inCombatAtkPercent',
  'externalHpPercent',
  'externalAtkPercent',
  'atk',
  'dmgBonus',
  'critRate',
  'critDmg',
  'penRate',
  'reduceDefense',
  'resPen',
  'mastery',
  'anomalyControl',
  'energyRegen',
  'pierce',
  'pierceDmgBonus',
  'vulnerable',
  'globalStaggerVulnerable',
  'staggerVulnerable',
  'staggerVulnerableOnly',
  'special',
  'anomalyCritRate',
  'anomalyCritDmg',
  'anomalyDmgBonus',
  'anomalyReleaseDmgBonus',
  'anomalyReleaseCritRate',
  'anomalyReleaseCritDmg',
  'anomalyReleaseMult',
  'directDmgMult',
  'anomalyMult',
  'disorderBaseMult',
  'anomalyDuration',
  'disorderCompMult',
  'turbulenceBaseMult',
  'turbulenceCompMult',
  'disorderDmgBonus',
  'turbulenceDmgBonus',
  'skillDmgBonus',
  'skillMultiplierBonus',
]

function readNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function normalizeAgentBasePanel(value) {
  const empty = { ...EMPTY_AGENT_BASE_PANEL }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty
  return {
    hp: readNumber(value.hp),
    atk: readNumber(value.atk),
    def: readNumber(value.def),
    critRate: readNumber(value.critRate),
    critDmg: readNumber(value.critDmg),
    mastery: readNumber(value.mastery),
    anomalyControl: readNumber(value.anomalyControl),
    energyRegen: readNumber(value.energyRegen),
    penRate: readNumber(value.penRate),
    dmgBonus: readNumber(value.dmgBonus),
    pen: readNumber(value.pen),
    anomalyCritRate: readNumber(value.anomalyCritRate),
    anomalyCritDmg: readNumber(value.anomalyCritDmg),
    anomalyDmgBonus: readNumber(value.anomalyDmgBonus),
    directDmgMult: value.directDmgMult == null ? 100 : readNumber(value.directDmgMult),
    anomalyMult: readNumber(value.anomalyMult),
    disorderBaseMult: readNumber(value.disorderBaseMult),
    anomalyDuration: readNumber(value.anomalyDuration),
    disorderCompMult: readNumber(value.disorderCompMult),
    turbulenceBaseMult: readNumber(value.turbulenceBaseMult),
    turbulenceCompMult: readNumber(value.turbulenceCompMult),
    disorderDmgBonus: readNumber(value.disorderDmgBonus),
    turbulenceDmgBonus: readNumber(value.turbulenceDmgBonus),
  }
}

function normalizeWengineAdvancedStats(value) {
  const empty = { ...EMPTY_WENGINE_ADVANCED_STATS }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty
  return {
    critRate: readNumber(value.critRate),
    critDmg: readNumber(value.critDmg),
    energyRegen: readNumber(value.energyRegen),
    mastery: readNumber(value.mastery),
    externalAtkPercent: readNumber(value.externalAtkPercent),
    externalHpPercent: readNumber(value.externalHpPercent),
    penRate: readNumber(value.penRate),
  }
}

function createEmptyBuffStatModifiers() {
  return Object.fromEntries(BUFF_STAT_KEYS.map((key) => [key, 0]))
}

function flatModsToEffects(mods, applyTarget) {
  const effects = []
  for (const key of BUFF_STAT_KEYS) {
    const value = readNumber(mods?.[key])
    if (!value) continue
    effects.push({
      id: `legacy-${applyTarget}-${key}`,
      scope: 'general',
      applyTarget,
      kind: 'fixed',
      stat: key,
      value,
      enabledDefault: true,
    })
  }
  return effects
}

function effectsToFlatMods(effects, applyTarget) {
  const result = createEmptyBuffStatModifiers()
  for (const effect of effects || []) {
    if (applyTarget && effect.applyTarget !== applyTarget) continue
    if (effect.scope && effect.scope !== 'general') continue
    const amount = readNumber(effect.value ?? effect.valuePerStack)
    if (!amount || !BUFF_STAT_KEYS.includes(effect.stat)) continue
    result[effect.stat] += amount
  }
  return result
}

function normalizeConvert(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const LEGACY = {
    externalHp: { from: 'hp', panelSource: 'external' },
    inCombatHp: { from: 'hp', panelSource: 'final' },
    externalAtk: { from: 'atk', panelSource: 'external' },
    inCombatAtk: { from: 'atk', panelSource: 'final' },
  }
  const ATTRS = [
    'hp',
    'atk',
    'mastery',
    'anomalyControl',
    'energyRegen',
    'penRate',
    'impact',
    'def',
    'level',
  ]
  const rawFrom = value.from
  if (typeof rawFrom !== 'string') return undefined
  let from = rawFrom
  let panelSource =
    value.panelSource === 'final'
      ? 'final'
      : value.panelSource === 'manual'
        ? 'manual'
        : 'external'
  if (LEGACY[rawFrom]) {
    from = LEGACY[rawFrom].from
    if (
      value.panelSource !== 'external' &&
      value.panelSource !== 'final' &&
      value.panelSource !== 'manual'
    ) {
      panelSource = LEGACY[rawFrom].panelSource
    }
  } else if (!ATTRS.includes(rawFrom)) {
    return undefined
  }
  return {
    from,
    panelSource,
    ratioPercent: readNumber(value.ratioPercent),
    cap: value.cap == null || value.cap === '' ? null : readNumber(value.cap),
    defaultBase:
      value.defaultBase == null || value.defaultBase === ''
        ? null
        : readNumber(value.defaultBase),
  }
}

function normalizeEffectList(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      id: typeof item.id === 'string' && item.id ? item.id : `eff-${index}`,
      origin: typeof item.origin === 'string' ? item.origin : '',
      scope: item.scope === 'skill' ? 'skill' : 'general',
      applyTarget: item.applyTarget === 'team' ? 'team' : 'self',
      applySituation:
        item.applySituation === 'stagger' || item.applySituation === 'non_stagger'
          ? item.applySituation
          : 'global',
      skillCategory: item.skillCategory || undefined,
      skillSubcategoryId: item.skillSubcategoryId ?? null,
      elementFilter: item.elementFilter ?? 'all',
      kind:
        item.kind === 'stacked' || item.kind === 'convert' ? item.kind : 'fixed',
      stat: BUFF_STAT_KEYS.includes(item.stat) ? item.stat : 'dmgBonus',
      value: readNumber(item.value),
      stackable: Boolean(item.stackable),
      maxStacks: Math.max(1, readNumber(item.maxStacks) || 1),
      valuePerStack: readNumber(item.valuePerStack),
      defaultStacks: Math.max(0, readNumber(item.defaultStacks) || 1),
      convert: normalizeConvert(item.convert),
      appliesToAnomaly:
        item.appliesToAnomaly == null ? undefined : Boolean(item.appliesToAnomaly),
      enabledDefault: item.enabledDefault === false ? false : true,
      note: typeof item.note === 'string' ? item.note : '',
    }))
}

function normalizeSelfTeamBuffs(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (Array.isArray(value.effectBlocks) && value.effectBlocks.length > 0) {
      const effectBlocks = value.effectBlocks
        .filter((item) => item && typeof item === 'object')
        .map((item, index) => ({
          id: typeof item.id === 'string' && item.id ? item.id : `blk-${index}`,
          name: typeof item.name === 'string' && item.name ? item.name : `效果块 ${index + 1}`,
          note: typeof item.note === 'string' ? item.note : '',
          effects: normalizeEffectList(item.effects),
          enabledDefault: item.enabledDefault === false ? false : true,
        }))
      const effects = effectBlocks.flatMap((block) => block.effects)
      return {
        effectBlocks,
        effects,
        selfMods: effectsToFlatMods(effects, 'self'),
        teamMods: effectsToFlatMods(effects, 'team'),
      }
    }
    if (Array.isArray(value.effects) && value.effects.length > 0) {
      const effects = normalizeEffectList(value.effects)
      return {
        effectBlocks: [
          {
            id: 'blk-legacy',
            name: '效果块 1',
            note: '',
            effects,
            enabledDefault: true,
          },
        ],
        effects,
        selfMods: effectsToFlatMods(effects, 'self'),
        teamMods: effectsToFlatMods(effects, 'team'),
      }
    }
    const selfMods = normalizeBuffStatModifiers(value.selfMods)
    const teamMods = normalizeBuffStatModifiers(value.teamMods)
    const effects = [
      ...flatModsToEffects(selfMods, 'self'),
      ...flatModsToEffects(teamMods, 'team'),
    ]
    return {
      effectBlocks: effects.length
        ? [
            {
              id: 'blk-legacy',
              name: '效果块 1',
              note: '',
              effects,
              enabledDefault: true,
            },
          ]
        : [],
      effects,
      selfMods,
      teamMods,
    }
  }
  return {
    effectBlocks: [],
    effects: [],
    selfMods: createEmptyBuffStatModifiers(),
    teamMods: createEmptyBuffStatModifiers(),
  }
}

function normalizeBuffStatModifiers(value) {
  const result = createEmptyBuffStatModifiers()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const key of BUFF_STAT_KEYS) {
    result[key] = readNumber(value[key])
  }
  if (readNumber(value.externalAtkPercent) && !result.inCombatAtkPercent) {
    result.inCombatAtkPercent = readNumber(value.externalAtkPercent)
  }
  return result
}

function normalizeTwoPieceMods(value) {
  const mods = normalizeBuffStatModifiers(value)
  if (!mods.externalHpPercent && mods.inCombatHpPercent) {
    mods.externalHpPercent = mods.inCombatHpPercent
  }
  if (!mods.externalAtkPercent && mods.inCombatAtkPercent) {
    mods.externalAtkPercent = mods.inCombatAtkPercent
  }
  mods.inCombatHpPercent = 0
  mods.inCombatAtkPercent = 0
  return mods
}

function parseJson(value, fallback) {
  if (value == null) return fallback
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return fallback
    }
  }
  return fallback
}

function rowToAgent(row) {
  const raw = parseJson(row.raw_json, {})
  const mindscapeBuffsRaw = parseJson(row.mindscape_buffs, raw.mindscapeBuffs)
  return {
    ...raw,
    id: row.id,
    name: row.name,
    profession: row.profession ?? '',
    element: row.element ?? '',
    supportNeeds: parseJson(row.support_needs, raw.supportNeeds ?? []),
    avatar_image: row.avatar_image ?? raw.avatar_image ?? null,
    note: row.note ?? raw.note ?? '',
    basePanel: normalizeAgentBasePanel(parseJson(row.base_panel, raw.basePanel)),
    mindscapeNotes: parseJson(
      row.mindscape_notes,
      normalizeMindscapeNotesArray(raw.mindscapeNotes),
    ),
    mindscapeBuffs: [0, 1, 2, 3, 4, 5, 6].map((index) =>
      normalizeSelfTeamBuffs(
        Array.isArray(mindscapeBuffsRaw) ? mindscapeBuffsRaw[index] ?? {} : {},
      ),
    ),
  }
}

function normalizeMindscapeNotesArray(value) {
  if (!Array.isArray(value)) return ['', '', '', '', '', '', '']
  return [0, 1, 2, 3, 4, 5, 6].map((index) =>
    typeof value[index] === 'string' ? value[index] : '',
  )
}

function rowToBangboo(row) {
  const raw = parseJson(row.raw_json, {})
  const effectBlocks = Array.isArray(raw.effectBlocks)
    ? raw.effectBlocks
        .filter((item) => item && typeof item === 'object')
        .map((item, index) => ({
          id: typeof item.id === 'string' && item.id ? item.id : `blk-${index}`,
          name:
            typeof item.name === 'string' && item.name
              ? item.name
              : `效果块 ${index + 1}`,
          note: typeof item.note === 'string' ? item.note : '',
          effects: normalizeEffectList(item.effects),
          enabledDefault: item.enabledDefault === false ? false : true,
        }))
    : []

  let effects = effectBlocks.length
    ? effectBlocks.flatMap((block) => block.effects)
    : normalizeEffectList(raw.effects ?? raw.fixedEffects ?? null)

  const refinementEffectBlocks = Array.isArray(raw.refinementEffectBlocks)
    ? raw.refinementEffectBlocks.map((blocks, rankIndex) =>
        Array.isArray(blocks)
          ? blocks
              .filter((item) => item && typeof item === 'object')
              .map((item, index) => ({
                id: typeof item.id === 'string' && item.id ? item.id : `blk-r${rankIndex}-${index}`,
                name:
                  typeof item.name === 'string' && item.name
                    ? item.name
                    : index === 0
                      ? `精${rankIndex + 1}`
                      : `效果块 ${index + 1}`,
                note: typeof item.note === 'string' ? item.note : '',
                effects: normalizeEffectList(item.effects),
                enabledDefault: item.enabledDefault === false ? false : true,
              }))
          : [],
      )
    : null

  const refinementEffects = refinementEffectBlocks
    ? refinementEffectBlocks.map((blocks) => blocks.flatMap((block) => block.effects))
    : Array.isArray(raw.refinementEffects)
      ? raw.refinementEffects.map((list) => normalizeEffectList(list))
      : null

  let fixedMods = normalizeBuffStatModifiers(
    parseJson(row.fixed_mods, raw.fixedMods ?? {}),
  )
  let refinementMods = Array.isArray(parseJson(row.refinement_mods, raw.refinementMods))
    ? parseJson(row.refinement_mods, raw.refinementMods).map((item) =>
        normalizeBuffStatModifiers(item),
      )
    : []

  if (effects.length) {
    fixedMods = effectsToFlatMods(effects, 'team')
    const selfFlat = effectsToFlatMods(effects, 'self')
    for (const key of BUFF_STAT_KEYS) {
      fixedMods[key] += selfFlat[key]
    }
  } else if (Object.values(fixedMods).some((v) => v)) {
    effects.push(...flatModsToEffects(fixedMods, 'team'))
  }

  if (refinementEffects) {
    refinementMods = refinementEffects.map((list) => {
      const team = effectsToFlatMods(list, 'team')
      const self = effectsToFlatMods(list, 'self')
      const merged = createEmptyBuffStatModifiers()
      for (const key of BUFF_STAT_KEYS) merged[key] = team[key] + self[key]
      return merged
    })
  }

  return {
    id: row.id,
    name: row.name,
    avatar_image: row.avatar_image ?? null,
    effectBlocks,
    effects,
    refinementEffectBlocks: refinementEffectBlocks ?? undefined,
    refinementEffects:
      refinementEffects ??
      refinementMods.map((mods) => flatModsToEffects(mods, 'team')),
    fixedMods,
    refinementMods,
  }
}

function normalizeEffectBlocks(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      id: typeof item.id === 'string' && item.id ? item.id : `blk-${index}`,
      name:
        typeof item.name === 'string' && item.name
          ? item.name
          : `效果块 ${index + 1}`,
      note: typeof item.note === 'string' ? item.note : '',
      effects: normalizeEffectList(item.effects),
      enabledDefault: item.enabledDefault === false ? false : true,
    }))
}

function rowToDriveDisc(row) {
  const raw = parseJson(row.raw_json, {})
  const fourPieceBuffs = normalizeSelfTeamBuffs(
    parseJson(row.four_piece_buffs, raw.fourPieceBuffs ?? {}),
  )
  const twoPieceEffectBlocks = normalizeEffectBlocks(raw.twoPieceEffectBlocks)
  let twoPieceEffects = twoPieceEffectBlocks.length
    ? twoPieceEffectBlocks.flatMap((block) => block.effects)
    : normalizeEffectList(raw.twoPieceEffects)
  let twoPieceMods = normalizeTwoPieceMods(
    parseJson(row.two_piece_mods, raw.twoPieceMods ?? {}),
  )
  if (twoPieceEffects.length) {
    const team = effectsToFlatMods(twoPieceEffects, 'team')
    const self = effectsToFlatMods(twoPieceEffects, 'self')
    twoPieceMods = normalizeTwoPieceMods(
      Object.fromEntries(
        BUFF_STAT_KEYS.map((key) => [key, team[key] + self[key]]),
      ),
    )
  } else if (Object.values(twoPieceMods).some((v) => v)) {
    twoPieceEffects = flatModsToEffects(twoPieceMods, 'self')
  }

  return {
    id: row.id,
    name: row.name,
    avatar_image: row.avatar_image ?? null,
    twoPieceNote: row.two_piece_note ?? raw.twoPieceNote ?? '',
    fourPieceNote: row.four_piece_note ?? raw.fourPieceNote ?? '',
    twoPieceEffectBlocks: twoPieceEffectBlocks.length
      ? twoPieceEffectBlocks
      : undefined,
    twoPieceEffects,
    twoPieceMods,
    fourPieceBuffs,
  }
}

function rowToWengine(row) {
  const raw = parseJson(row.raw_json, {})
  const refinementRaw = parseJson(row.refinement_buffs, raw.refinementBuffs)
  return {
    id: row.id,
    name: row.name,
    profession: row.profession ?? '',
    rarity: row.rarity ?? 'A',
    avatar_image: row.avatar_image ?? null,
    note: row.note ?? raw.note ?? '',
    baseAtk: readNumber(row.base_atk ?? raw.baseAtk),
    advancedStats: normalizeWengineAdvancedStats(
      parseJson(row.advanced_stats, raw.advancedStats),
    ),
    fixedBuffs: normalizeSelfTeamBuffs(parseJson(row.fixed_buffs, raw.fixedBuffs ?? {})),
    refinementBuffs: [0, 1, 2, 3, 4].map((index) =>
      normalizeSelfTeamBuffs(Array.isArray(refinementRaw) ? refinementRaw[index] ?? {} : {}),
    ),
  }
}

function toJson(value) {
  return JSON.stringify(value ?? null)
}

export async function listCalculatorBuffs() {
  const [agents] = await pool.query(
    'SELECT * FROM `character` ORDER BY name ASC, id ASC',
  )
  const [bangboos] = await pool.query('SELECT * FROM `bangboo` ORDER BY name ASC, id ASC')
  const [driveDiscs] = await pool.query(
    'SELECT * FROM `drive_disc` ORDER BY name ASC, id ASC',
  )
  const [wengines] = await pool.query(
    `SELECT * FROM ${WENGINE_TABLE} ORDER BY name ASC, id ASC`,
  )
  const skillSubcategories = await listSkillSubcategories()

  return {
    agents: agents.map(rowToAgent),
    bangboos: bangboos.map(rowToBangboo),
    driveDiscs: driveDiscs.map(rowToDriveDisc),
    wengines: wengines.map(rowToWengine),
    skillSubcategories,
  }
}

export async function upsertAgent(doc) {
  const id = String(doc.id ?? '').trim()
  const name = String(doc.name ?? '').trim()
  if (!id || !name) {
    throw new Error('角色 ID 与名称为必填项')
  }

  const payload = {
    id,
    name,
    profession: String(doc.profession ?? ''),
    element: String(doc.element ?? ''),
    supportNeeds: Array.isArray(doc.supportNeeds) ? doc.supportNeeds : [],
    avatar_image: doc.avatar_image ?? null,
    note: typeof doc.note === 'string' ? doc.note : '',
    basePanel: normalizeAgentBasePanel(doc.basePanel),
    mindscapeNotes: normalizeMindscapeNotesArray(doc.mindscapeNotes),
    mindscapeBuffs: Array.isArray(doc.mindscapeBuffs)
      ? [0, 1, 2, 3, 4, 5, 6].map((index) =>
          normalizeSelfTeamBuffs(doc.mindscapeBuffs[index] ?? {}),
        )
      : [0, 1, 2, 3, 4, 5, 6].map(() => normalizeSelfTeamBuffs({})),
  }

  await pool.execute(
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
    [
      payload.id,
      payload.name,
      payload.profession,
      payload.element,
      toJson(payload.supportNeeds),
      payload.avatar_image,
      payload.note,
      toJson(payload.basePanel),
      toJson(payload.mindscapeNotes),
      toJson(payload.mindscapeBuffs),
      toJson(payload),
    ],
  )

  const [[row]] = await pool.query('SELECT * FROM `character` WHERE id = ?', [id])
  return rowToAgent(row)
}

export async function deleteAgent(id) {
  const [result] = await pool.execute('DELETE FROM `character` WHERE id = ?', [id])
  if (result.affectedRows === 0) {
    throw new Error('角色不存在')
  }
  return { id }
}

export async function upsertBangboo(doc) {
  const id = String(doc.id ?? '').trim()
  const name = String(doc.name ?? '').trim()
  if (!id || !name) {
    throw new Error('邦布 ID 与名称为必填项')
  }

  const payload = {
    id,
    name,
    avatar_image: doc.avatar_image ?? null,
    effectBlocks: normalizeEffectBlocks(doc.effectBlocks),
    effects: normalizeEffectList(doc.effects),
    refinementEffectBlocks: Array.isArray(doc.refinementEffectBlocks)
      ? [0, 1, 2, 3, 4].map((index) =>
          normalizeEffectBlocks(doc.refinementEffectBlocks[index] ?? []),
        )
      : [],
    refinementEffects: Array.isArray(doc.refinementEffects)
      ? doc.refinementEffects.map((list) => normalizeEffectList(list))
      : [],
    fixedMods: normalizeBuffStatModifiers(doc.fixedMods ?? {}),
    refinementMods: Array.isArray(doc.refinementMods) ? doc.refinementMods : [],
  }
  if (payload.effectBlocks.length) {
    payload.effects = payload.effectBlocks.flatMap((block) =>
      normalizeEffectList(block?.effects),
    )
  }
  if (payload.refinementEffectBlocks.length) {
    payload.refinementEffects = payload.refinementEffectBlocks.map((blocks) =>
      Array.isArray(blocks)
        ? blocks.flatMap((block) => normalizeEffectList(block?.effects))
        : [],
    )
  }
  if (payload.effects.length) {
    const team = effectsToFlatMods(payload.effects, 'team')
    const self = effectsToFlatMods(payload.effects, 'self')
    payload.fixedMods = createEmptyBuffStatModifiers()
    for (const key of BUFF_STAT_KEYS) {
      payload.fixedMods[key] = team[key] + self[key]
    }
  }
  if (payload.refinementEffects.length) {
    payload.refinementMods = payload.refinementEffects.map((list) => {
      const team = effectsToFlatMods(list, 'team')
      const self = effectsToFlatMods(list, 'self')
      const merged = createEmptyBuffStatModifiers()
      for (const key of BUFF_STAT_KEYS) merged[key] = team[key] + self[key]
      return merged
    })
  }

  await pool.execute(
    `INSERT INTO \`bangboo\`
      (id, name, avatar_image, fixed_mods, refinement_mods, raw_json)
     VALUES (?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       avatar_image = VALUES(avatar_image),
       fixed_mods = VALUES(fixed_mods),
       refinement_mods = VALUES(refinement_mods),
       raw_json = VALUES(raw_json)`,
    [
      payload.id,
      payload.name,
      payload.avatar_image,
      toJson(payload.fixedMods),
      toJson(payload.refinementMods),
      toJson(payload),
    ],
  )

  const [[row]] = await pool.query('SELECT * FROM `bangboo` WHERE id = ?', [id])
  return rowToBangboo(row)
}

export async function deleteBangboo(id) {
  const [result] = await pool.execute('DELETE FROM `bangboo` WHERE id = ?', [id])
  if (result.affectedRows === 0) {
    throw new Error('邦布不存在')
  }
  return { id }
}

export async function upsertDriveDisc(doc) {
  const id = String(doc.id ?? '').trim()
  const name = String(doc.name ?? '').trim()
  if (!id || !name) {
    throw new Error('驱动盘 ID 与名称为必填项')
  }

  const fourPieceBuffs = normalizeSelfTeamBuffs(doc.fourPieceBuffs ?? {})
  const twoPieceEffectBlocks = normalizeEffectBlocks(doc.twoPieceEffectBlocks)
  let twoPieceEffects = twoPieceEffectBlocks.length
    ? twoPieceEffectBlocks.flatMap((block) => block.effects)
    : normalizeEffectList(doc.twoPieceEffects)
  let twoPieceMods = normalizeTwoPieceMods(doc.twoPieceMods ?? {})
  if (twoPieceEffects.length) {
    const team = effectsToFlatMods(twoPieceEffects, 'team')
    const self = effectsToFlatMods(twoPieceEffects, 'self')
    twoPieceMods = normalizeTwoPieceMods(
      Object.fromEntries(BUFF_STAT_KEYS.map((key) => [key, team[key] + self[key]])),
    )
  }

  const payload = {
    id,
    name,
    avatar_image: doc.avatar_image ?? null,
    twoPieceNote: typeof doc.twoPieceNote === 'string' ? doc.twoPieceNote : '',
    fourPieceNote: typeof doc.fourPieceNote === 'string' ? doc.fourPieceNote : '',
    twoPieceEffectBlocks: twoPieceEffectBlocks.length
      ? twoPieceEffectBlocks
      : undefined,
    twoPieceEffects,
    twoPieceMods,
    fourPieceBuffs,
  }

  await pool.execute(
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
    [
      payload.id,
      payload.name,
      payload.avatar_image,
      payload.twoPieceNote,
      payload.fourPieceNote,
      toJson(payload.twoPieceMods),
      toJson(payload.fourPieceBuffs),
      toJson(payload),
    ],
  )

  const [[row]] = await pool.query('SELECT * FROM `drive_disc` WHERE id = ?', [id])
  return rowToDriveDisc(row)
}

export async function deleteDriveDisc(id) {
  const [result] = await pool.execute('DELETE FROM `drive_disc` WHERE id = ?', [id])
  if (result.affectedRows === 0) {
    throw new Error('驱动盘不存在')
  }
  return { id }
}

export async function upsertWengine(doc) {
  const id = String(doc.id ?? '').trim()
  const name = String(doc.name ?? '').trim()
  if (!id || !name) {
    throw new Error('音擎 ID 与名称为必填项')
  }

  const payload = {
    id,
    name,
    profession: String(doc.profession ?? ''),
    rarity: String(doc.rarity ?? 'A'),
    avatar_image: doc.avatar_image ?? null,
    note: typeof doc.note === 'string' ? doc.note : '',
    baseAtk: readNumber(doc.baseAtk),
    advancedStats: normalizeWengineAdvancedStats(doc.advancedStats),
    fixedBuffs: normalizeSelfTeamBuffs(doc.fixedBuffs ?? {}),
    refinementBuffs: Array.isArray(doc.refinementBuffs)
      ? [0, 1, 2, 3, 4].map((index) =>
          normalizeSelfTeamBuffs(doc.refinementBuffs[index] ?? {}),
        )
      : [0, 1, 2, 3, 4].map(() => normalizeSelfTeamBuffs({})),
  }

  await pool.execute(
    `INSERT INTO ${WENGINE_TABLE}
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
    [
      payload.id,
      payload.name,
      payload.profession,
      payload.rarity,
      payload.avatar_image,
      payload.note,
      payload.baseAtk,
      toJson(payload.advancedStats),
      toJson(payload.fixedBuffs),
      toJson(payload.refinementBuffs),
      toJson(payload),
    ],
  )

  const [[row]] = await pool.query(`SELECT * FROM ${WENGINE_TABLE} WHERE id = ?`, [id])
  return rowToWengine(row)
}

export async function deleteWengine(id) {
  const [result] = await pool.execute(`DELETE FROM ${WENGINE_TABLE} WHERE id = ?`, [id])
  if (result.affectedRows === 0) {
    throw new Error('音擎不存在')
  }
  return { id }
}
