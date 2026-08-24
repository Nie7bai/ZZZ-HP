import pool from '../config/db.js'
import { listBossInfoByNames, upsertBossInfo } from './bossInfoService.js'
import { createBoss, createBuff } from './dataService.js'
import { upsertSeasonDate } from './seasonDateService.js'
import { ensureBossStaggerSchema } from '../utils/bossSchema.js'
import { ensureContentModeColumns } from './contentModeService.js'
import {
  decodeDefenseBossId,
  decodeDefenseBuffId,
  isDefenseBossId,
  isDefenseBuffId,
} from '../utils/defenseId.js'
import {
  ensureEnvironmentBuffSchema,
  parseEffectBlocksJson,
  parseFieldBuffSetsJson,
} from '../utils/environmentBuffSchema.js'

export const SEASON_SNAPSHOT_KIND = 'zzz-hp-season-snapshot'

function normalizeScheme(value) {
  const text = String(value || '').trim()
  if (text === 'defense') return 'defense'
  if (text === 'crisis') return 'crisis'
  if (text === 'deduction') return 'deduction'
  return null
}

function normalizeVariant(scheme, value) {
  if (scheme !== 'defense') return null
  const text = String(value || '').trim()
  if (text === 'old' || text === 'new') return text
  return null
}

function normalizePhase(phase) {
  const digits = String(phase ?? '').replace(/\D/g, '')
  return digits || String(phase ?? '').trim()
}

function seasonKey(version, phase) {
  return `${String(version).trim()}|${normalizePhase(phase)}`
}

function matchesVariant(version, variant) {
  if (!variant) return true
  const majorMinor = Number(version)
  if (!Number.isFinite(majorMinor)) return variant !== 'new'
  if (variant === 'new') return majorMinor >= 2.4
  if (variant === 'old') return majorMinor < 2.4
  return true
}

/** 危局 / 防卫战 / 推演导出：按 mode 归属 */
function bossScopeSql(scheme) {
  if (scheme === 'defense') return `mode = 'defense'`
  if (scheme === 'deduction') return `mode = 'deduction'`
  return `(mode = 'crisis' OR mode IS NULL OR mode = '')`
}

function buffScopeSql(scheme) {
  if (scheme === 'defense') return `mode = 'defense'`
  if (scheme === 'deduction') return `mode = 'deduction'`
  return `(mode = 'crisis' OR mode IS NULL OR mode = '')`
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function formatDateValue(value) {
  if (!value) return null
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  return String(value).slice(0, 10)
}

function mapBossRow(row) {
  const hpCoeff =
    row.hp_coeff_percent == null || row.hp_coeff_percent === ''
      ? null
      : Number(row.hp_coeff_percent)
  return {
    id: Number(row.id),
    version: String(row.version),
    phase: String(row.phase),
    boss_name: row.boss_name,
    hp: Number(row.hp) || 0,
    hp_coeff_percent: Number.isFinite(hpCoeff) ? hpCoeff : null,
    defense: Number(row.defense) || 0,
    level: Number(row.level) || 1,
    room: row.room ?? null,
    weakness: row.weakness ?? null,
    resistance: row.resistance ?? null,
    boss_image: row.boss_image ?? null,
    stagger_multiplier:
      row.stagger_multiplier == null || row.stagger_multiplier === ''
        ? null
        : Number(row.stagger_multiplier),
    field_buff_set_id: row.field_buff_set_id ? String(row.field_buff_set_id) : null,
    mode: row.mode === 'defense' || row.mode === 'deduction' || row.mode === 'crisis' ? row.mode : null,
  }
}

function mapBuffRow(row) {
  return {
    id: Number(row.id),
    version: String(row.version),
    phase: String(row.phase),
    buff_name: row.buff_name,
    buff: row.buff ?? null,
    buff_image: row.buff_image ?? null,
    effect_blocks: parseEffectBlocksJson(row.effect_blocks),
    mode: row.mode === 'defense' || row.mode === 'deduction' || row.mode === 'crisis' ? row.mode : null,
  }
}

function mapDateRow(row, scheme) {
  return {
    mode: scheme,
    version: String(row.version),
    phase: String(row.phase),
    startDate: formatDateValue(row.start_date),
    endDate: formatDateValue(row.end_date),
  }
}

function mapDeductionNodeRow(row) {
  const asJson = (value) => {
    if (value == null) return null
    return typeof value === 'string' ? value : JSON.stringify(value)
  }
  return {
    version: String(row.version),
    phase: String(row.phase),
    node_id: String(row.node_id),
    node_name: String(row.node_name ?? ''),
    node_type: Number(row.node_type) || 0,
    prev_node: row.prev_node || '',
    story_text: row.story_text ?? null,
    story_options_json: asJson(row.story_options_json),
    layers_json: asJson(row.layers_json),
    buffs_json: asJson(row.buffs_json),
    sort_order: Number(row.sort_order) || 0,
    period_name: row.period_name ?? '',
  }
}

function mapBossInfoExport(row) {
  if (!row) return null
  return {
    boss_name: row.boss_name,
    defense: Number(row.defense) || 0,
    level: Number(row.level) || 1,
    weakness: row.weakness ?? null,
    resistance: row.resistance ?? null,
    boss_image: row.boss_image ?? null,
    crisis_base_hp: row.crisis_base_hp == null ? null : Number(row.crisis_base_hp),
    stagger_multiplier: row.stagger_multiplier == null ? null : Number(row.stagger_multiplier),
    field_buff_name: row.field_buff_name ?? null,
    field_buff_text: row.field_buff_text ?? null,
    field_buff_image: row.field_buff_image ?? null,
    field_buff_effect_blocks: row.field_buff_effect_blocks ?? null,
    field_buff_sets: parseFieldBuffSetsJson(row.field_buff_sets),
  }
}

function buildSeasons(bosses, buffs, dates, nodes = []) {
  const map = new Map()
  const ensure = (version, phase) => {
    const key = seasonKey(version, phase)
    if (!map.has(key)) {
      map.set(key, {
        version: String(version).trim(),
        phase: normalizePhase(phase),
        bossCount: 0,
        buffCount: 0,
        dateCount: 0,
        nodeCount: 0,
      })
    }
    return map.get(key)
  }
  for (const row of bosses) {
    ensure(row.version, row.phase).bossCount += 1
  }
  for (const row of buffs) {
    ensure(row.version, row.phase).buffCount += 1
  }
  for (const row of dates) {
    ensure(row.version, row.phase).dateCount += 1
  }
  for (const row of nodes) {
    ensure(row.version, row.phase).nodeCount += 1
  }
  return [...map.values()].sort((a, b) => {
    const versionDiff = Number(b.version) - Number(a.version)
    if (versionDiff) return versionDiff
    return Number(b.phase) - Number(a.phase)
  })
}

function emptyTypeResult() {
  return { created: 0, updated: 0, skipped: 0, errors: [] }
}

function crisisBuffIndexFromId(id, version, phase) {
  const versionCode = String(version ?? '').trim().replace(/\./g, '')
  const phaseCode = normalizePhase(phase)
  const text = String(id)
  const prefix = `${versionCode}${phaseCode}`
  if (text.startsWith(prefix)) {
    const n = Number(text.slice(prefix.length))
    if (Number.isInteger(n) && n >= 1) return n
  }
  const last2 = Number(text.slice(-2))
  return Number.isInteger(last2) && last2 >= 1 ? last2 : 1
}

export async function exportSeasonSnapshot(scheme, variant = null) {
  const mode = normalizeScheme(scheme)
  if (!mode) throw new Error('scheme 须为 crisis / defense / deduction')
  const variantValue = normalizeVariant(mode, variant)

  await ensureBossStaggerSchema()
  await ensureEnvironmentBuffSchema()
  await ensureContentModeColumns(pool)

  const [bossRows] = await pool.query(
    `SELECT id, version, phase, boss_name, hp, hp_coeff_percent, defense, level, room,
            weakness, resistance, boss_image, stagger_multiplier, mode
     FROM boss
     WHERE ${bossScopeSql(mode)}
     ORDER BY CAST(REPLACE(version, '.', '') AS UNSIGNED) DESC,
              CAST(phase AS UNSIGNED) DESC,
              id ASC`,
  )
  const [buffRows] = await pool.query(
    `SELECT id, version, phase, buff_name, buff, buff_image, effect_blocks, mode
     FROM buff
     WHERE ${buffScopeSql(mode)}
     ORDER BY CAST(REPLACE(version, '.', '') AS UNSIGNED) DESC,
              CAST(phase AS UNSIGNED) DESC,
              id ASC`,
  )
  const dateSql =
    mode === 'defense'
      ? `SELECT version, phase, start_date, end_date
         FROM \`date\`
         WHERE mode = 'defense'
         ORDER BY CAST(REPLACE(version, '.', '') AS UNSIGNED) DESC,
                  CAST(phase AS UNSIGNED) DESC,
                  id DESC`
      : mode === 'deduction'
        ? `SELECT version, phase, start_date, end_date
           FROM \`date\`
           WHERE mode = 'deduction'
           ORDER BY CAST(REPLACE(version, '.', '') AS UNSIGNED) DESC,
                    CAST(phase AS UNSIGNED) DESC,
                    id DESC`
        : `SELECT version, phase, start_date, end_date
           FROM \`date\`
           WHERE mode = 'crisis' OR mode IS NULL OR mode = ''
           ORDER BY CAST(REPLACE(version, '.', '') AS UNSIGNED) DESC,
                    CAST(phase AS UNSIGNED) DESC,
                    id DESC`
  const [dateRows] = await pool.query(dateSql)

  let deductionNodes = []
  if (mode === 'deduction') {
    const [nodeRows] = await pool.query(
      `SELECT version, phase, node_id, node_name, node_type, prev_node, story_text, story_options_json,
              layers_json, buffs_json, sort_order, period_name
       FROM deduction_node
       ORDER BY CAST(version AS UNSIGNED), sort_order, id`,
    )
    deductionNodes = nodeRows.map(mapDeductionNodeRow)
  }

  const bosses = bossRows.map(mapBossRow).filter((row) => matchesVariant(row.version, variantValue))
  const buffs = buffRows.map(mapBuffRow).filter((row) => matchesVariant(row.version, variantValue))
  const dates = dateRows
    .map((row) => mapDateRow(row, mode))
    .filter((row) => matchesVariant(row.version, variantValue))
  const bossInfos = (await listBossInfoByNames(bosses.map((row) => row.boss_name)))
    .map(mapBossInfoExport)
    .filter(Boolean)

  return {
    kind: SEASON_SNAPSHOT_KIND,
    scheme: mode,
    variant: variantValue,
    exportedAt: new Date().toISOString(),
    seasons: buildSeasons(bosses, buffs, dates, deductionNodes),
    bosses,
    buffs,
    dates,
    bossInfos,
    deductionNodes,
  }
}

export function coerceSeasonSnapshot(raw) {
  if (raw == null) throw new Error('文件内容为空')
  if (Array.isArray(raw)) throw new Error('请使用对象格式的危局 / 防卫战快照')
  if (typeof raw !== 'object') throw new Error('JSON 须为对象')

  const data = raw.data && typeof raw.data === 'object' && !raw.bosses ? raw.data : raw
  const hasKnownKey =
    Array.isArray(data.bosses) ||
    Array.isArray(data.buffs) ||
    Array.isArray(data.dates) ||
    Array.isArray(data.bossInfos) ||
    Array.isArray(data.deductionNodes)
  if (hasKnownKey) {
    const inferred =
      normalizeScheme(data.scheme) ||
      (Array.isArray(data.deductionNodes) && data.deductionNodes.length
        ? 'deduction'
        : asArray(data.bosses).some((row) => isDefenseBossId(row?.id)) ||
            asArray(data.buffs).some((row) => isDefenseBuffId(row?.id))
          ? 'defense'
          : 'crisis')
    return {
      kind: SEASON_SNAPSHOT_KIND,
      scheme: inferred,
      variant: normalizeVariant(inferred, data.variant),
      bosses: asArray(data.bosses),
      buffs: asArray(data.buffs),
      dates: asArray(data.dates),
      bossInfos: asArray(data.bossInfos),
      deductionNodes: asArray(data.deductionNodes),
    }
  }

  const doc = data
  if (doc.boss_name && (doc.hp != null || doc.room != null || doc.monsterCategory)) {
    return { kind: SEASON_SNAPSHOT_KIND, scheme: isDefenseBossId(doc.id) ? 'defense' : 'crisis', bosses: [doc], buffs: [], dates: [], bossInfos: [] }
  }
  if (doc.buff_name && (doc.buff != null || doc.effect_blocks || doc.buffIndex != null)) {
    return { kind: SEASON_SNAPSHOT_KIND, scheme: isDefenseBuffId(doc.id) ? 'defense' : 'crisis', bosses: [], buffs: [doc], dates: [], bossInfos: [] }
  }
  if ((doc.startDate || doc.start_date) && doc.version && doc.phase) {
    return { kind: SEASON_SNAPSHOT_KIND, scheme: doc.mode === 'defense' ? 'defense' : 'crisis', bosses: [], buffs: [], dates: [doc], bossInfos: [] }
  }
  if (doc.field_buff_name != null || doc.field_buff_sets != null || doc.crisis_base_hp != null) {
    return { kind: SEASON_SNAPSHOT_KIND, scheme: 'crisis', bosses: [], buffs: [], dates: [], bossInfos: [doc] }
  }

  throw new Error('无法识别的 JSON。请使用本页导出的危局 / 防卫战快照。')
}

function recordAction(result, action) {
  if (action === 'updated') result.updated += 1
  else if (action === 'unchanged') result.skipped += 1
  else result.created += 1
}

function bossImportPayload(row) {
  const id = Number(row?.id)
  const version = String(row?.version ?? '').trim()
  const phase = normalizePhase(row?.phase)
  const bossName = String(row?.boss_name ?? '').trim()
  if (!version || !phase || !bossName) {
    throw new Error('怪物缺少 version / phase / boss_name')
  }

  const base = {
    id: Number.isInteger(id) && id > 0 ? id : undefined,
    version,
    phase,
    boss_name: bossName,
    hp: Number(row.hp) || 0,
    defense: Number(row.defense) || 0,
    level: Number(row.level) || 1,
    room: row.room ?? null,
    weakness: row.weakness ?? null,
    resistance: row.resistance ?? null,
    boss_image: row.boss_image ?? null,
    stagger_multiplier: row.stagger_multiplier ?? null,
    crisis_base_hp: row.crisis_base_hp ?? null,
    hp_coeff_percent: row.hp_coeff_percent ?? null,
    hp_coeff_manual: row.hp_coeff_percent != null && row.hp_coeff_percent !== '',
    field_buff_set_id: row.field_buff_set_id ?? null,
  }

  // 显式 mode / recordScheme 优先，避免临界 9 位 ID 被当成防卫战
  if (row.mode === 'deduction' || row.recordScheme === 'deduction') {
    return { ...base, recordScheme: 'deduction', mode: 'deduction' }
  }
  if (row.mode === 'crisis' || row.recordScheme === 'crisis') {
    return { ...base, recordScheme: 'crisis', mode: 'crisis' }
  }

  if (
    row.mode === 'defense' ||
    row.recordScheme === 'defense' ||
    row.monsterCategory ||
    (row.mode == null && isDefenseBossId(id))
  ) {
    const decoded = Number.isInteger(id) && isDefenseBossId(id) ? decodeDefenseBossId(id) : {}
    return {
      ...base,
      recordScheme: 'defense',
      mode: 'defense',
      stage: row.stage ?? decoded.stage,
      roomInStage: row.roomInStage ?? decoded.roomInStage,
      wave: row.wave ?? decoded.wave,
      monsterCategory: row.monsterCategory ?? decoded.monsterCategory,
      monsterSubType: row.monsterSubType ?? decoded.monsterSubType,
      count: row.count ?? decoded.count,
    }
  }

  return { ...base, recordScheme: 'crisis', mode: 'crisis' }
}

function buffImportPayload(row) {
  const id = Number(row?.id)
  const version = String(row?.version ?? '').trim()
  const phase = normalizePhase(row?.phase)
  const buffName = String(row?.buff_name ?? '').trim()
  if (!version || !phase || !buffName) {
    throw new Error('Buff 缺少 version / phase / buff_name')
  }

  const base = {
    id: Number.isInteger(id) && id > 0 ? id : undefined,
    version,
    phase,
    buff_name: buffName,
    buff: row.buff ?? null,
    buff_image: row.buff_image ?? null,
    effect_blocks: row.effect_blocks ?? null,
  }

  if (row.mode === 'deduction' || row.recordScheme === 'deduction') {
    return { ...base, recordScheme: 'deduction', mode: 'deduction' }
  }
  if (row.mode === 'crisis' || row.recordScheme === 'crisis') {
    return {
      ...base,
      recordScheme: 'crisis',
      mode: 'crisis',
      buffIndex: row.buffIndex ?? crisisBuffIndexFromId(id, version, phase),
    }
  }

  if (
    row.mode === 'defense' ||
    row.recordScheme === 'defense' ||
    row.stage != null ||
    (row.mode == null && isDefenseBuffId(id))
  ) {
    const decoded = Number.isInteger(id) && isDefenseBuffId(id) ? decodeDefenseBuffId(id) : {}
    return {
      ...base,
      recordScheme: 'defense',
      mode: 'defense',
      stage: row.stage ?? decoded.stage,
      roomInStage: row.roomInStage ?? decoded.roomInStage,
      buffIndex: row.buffIndex ?? decoded.buffIndex,
    }
  }

  return {
    ...base,
    recordScheme: 'crisis',
    mode: 'crisis',
    buffIndex: row.buffIndex ?? crisisBuffIndexFromId(id, version, phase),
  }
}

export async function importSeasonSnapshot(raw) {
  const snapshot = coerceSeasonSnapshot(raw)
  const summary = {
    scheme: snapshot.scheme,
    bosses: emptyTypeResult(),
    buffs: emptyTypeResult(),
    dates: emptyTypeResult(),
    bossInfos: emptyTypeResult(),
    deductionNodes: emptyTypeResult(),
  }

  const allowedMode =
    snapshot.scheme === 'defense' ? 'defense' : snapshot.scheme === 'deduction' ? 'deduction' : 'crisis'

  for (const item of snapshot.bossInfos) {
    const name = String(item?.boss_name ?? '').trim()
    if (!name) {
      summary.bossInfos.skipped += 1
      continue
    }
    try {
      const saved = await upsertBossInfo(item)
      recordAction(summary.bossInfos, saved.action)
    } catch (err) {
      summary.bossInfos.errors.push({
        id: name,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  for (const item of snapshot.bosses) {
    const id = item?.id ?? item?.boss_name ?? ''
    try {
      const payload = bossImportPayload(item)
      // 危局/防卫快照跳过临界条目，避免 9 位 ID 误入防卫
      if (
        allowedMode !== 'deduction' &&
        (payload.mode === 'deduction' || payload.recordScheme === 'deduction')
      ) {
        summary.bosses.skipped += 1
        continue
      }
      const saved = await createBoss(payload)
      recordAction(summary.bosses, saved.action)
    } catch (err) {
      summary.bosses.errors.push({
        id: String(id),
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  for (const item of snapshot.buffs) {
    const id = item?.id ?? item?.buff_name ?? ''
    try {
      const payload = buffImportPayload(item)
      if (allowedMode !== 'deduction' && (payload.mode === 'deduction' || payload.recordScheme === 'deduction')) {
        summary.buffs.skipped += 1
        continue
      }
      const saved = await createBuff(payload)
      recordAction(summary.buffs, saved.action)
    } catch (err) {
      summary.buffs.errors.push({
        id: String(id),
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  for (const item of snapshot.deductionNodes) {
    const version = String(item?.version ?? '').trim()
    const phase = normalizePhase(item?.phase)
    const nodeId = String(item?.node_id ?? '').trim()
    if (!version || !phase || !nodeId) {
      summary.deductionNodes.skipped += 1
      continue
    }
    try {
      const [existing] = await pool.execute(
        'SELECT 1 FROM deduction_node WHERE version = ? AND phase = ? AND node_id = ? LIMIT 1',
        [version, phase, nodeId],
      )
      const name = String(item.node_name ?? '')
      const nodeType = Number(item.node_type) || 0
      const prevNode = item.prev_node || ''
      const storyText = item.story_text ?? null
      const storyOptionsJson = item.story_options_json ?? null
      const layersJson = item.layers_json ?? null
      const buffsJson = item.buffs_json ?? null
      const sortOrder = Number(item.sort_order) || 0
      const periodName = item.period_name ?? ''
      if (existing.length) {
        await pool.execute(
          `UPDATE deduction_node
              SET node_name = ?, node_type = ?, prev_node = ?, story_text = ?,
                  story_options_json = ?, layers_json = ?, buffs_json = ?,
                  sort_order = ?, period_name = ?
            WHERE version = ? AND phase = ? AND node_id = ?`,
          [name, nodeType, prevNode, storyText, storyOptionsJson, layersJson, buffsJson, sortOrder, periodName, version, phase, nodeId],
        )
        summary.deductionNodes.updated += 1
      } else {
        await pool.execute(
          `INSERT INTO deduction_node
             (version, phase, node_id, node_name, node_type, prev_node, story_text, story_options_json, layers_json, buffs_json, sort_order, period_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [version, phase, nodeId, name, nodeType, prevNode, storyText, storyOptionsJson, layersJson, buffsJson, sortOrder, periodName],
        )
        summary.deductionNodes.created += 1
      }
    } catch (err) {
      summary.deductionNodes.errors.push({
        id: `${version}-${nodeId}`,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  for (const item of snapshot.dates) {
    const version = String(item?.version ?? '').trim()
    const phase = normalizePhase(item?.phase)
    if (!version || !phase) {
      summary.dates.skipped += 1
      continue
    }
    try {
      const mode =
        snapshot.scheme === 'deduction'
          ? 'deduction'
          : item.mode === 'defense' || snapshot.scheme === 'defense'
            ? 'defense'
            : 'crisis'
      const saved = await upsertSeasonDate({
        mode,
        version,
        phase,
        startDate: item.startDate ?? item.start_date,
        endDate: item.endDate ?? item.end_date,
      })
      recordAction(summary.dates, saved.action)
    } catch (err) {
      summary.dates.errors.push({
        id: seasonKey(version, phase),
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return summary
}
