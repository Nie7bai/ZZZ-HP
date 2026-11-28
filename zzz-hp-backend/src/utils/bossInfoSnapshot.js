/**
 * boss_info 怪物基础库快照导出 / 导入
 */
import pool from '../config/db.js'
import {
  ensureEnvironmentBuffSchema,
  parseEffectBlocksJson,
  parseFieldBuffSetsJson,
  serializeFieldBuffSets,
  mirrorFieldBuffLegacyColumns,
} from './environmentBuffSchema.js'
import {
  ensureBossAnomalySchema,
  ensureBossResistanceSchema,
  ensureBossScoringNoteSchema,
  ensureBossStaggerSchema,
  normalizeAnomalyBarCoefficient,
  normalizeStaggerMultiplier,
  normalizeStaggerTime,
} from './bossSchema.js'
import { parseWeaknessSetsJson, serializeWeaknessSets, weaknessSetsFromLegacy, mirrorWeaknessLegacyColumns } from './bossWeaknessSets.js'
import {
  mirrorScoringNoteLegacy,
  parseScoringNoteSetsJson,
  scoringNoteSetsFromLegacy,
  serializeScoringNoteSets,
} from './bossScoringNoteSets.js'
import { preferExistingImage } from './localImagePath.js'

export const BOSS_INFO_SNAPSHOT_KIND = 'zzz-hp-boss-info'

function asJsonColumn(value) {
  if (value == null) return null
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function normalizeCrisisBaseHp(item) {
  const raw = item.crisisBaseHp ?? item.crisis_base_hp
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function normalizeRow(item) {
  const idRaw = item.id
  const id =
    idRaw == null || idRaw === ''
      ? null
      : Number.isFinite(Number(idRaw))
        ? Number(idRaw)
        : null
  const sets = Array.isArray(item.fieldBuffSets)
    ? item.fieldBuffSets
    : Array.isArray(item.field_buff_sets)
      ? item.field_buff_sets
      : parseFieldBuffSetsJson(item.field_buff_sets)
  const legacy = mirrorFieldBuffLegacyColumns(sets)
  const weaknessSetsRaw = parseWeaknessSetsJson(item.weaknessSets ?? item.weakness_sets)
  const weaknessSets = weaknessSetsRaw.length
    ? weaknessSetsRaw
    : weaknessSetsFromLegacy(item)
  const mirroredWeakness = mirrorWeaknessLegacyColumns(weaknessSets)
  // 得分机制（多套）：快照既带多套数组，也把第一套镜像回旧单列，老版本导入仍能读到文本
  const scoringSetsRaw = parseScoringNoteSetsJson(
    item.scoringNoteSets ?? item.scoring_note_sets,
  )
  const scoringNoteSets = scoringSetsRaw.length
    ? scoringSetsRaw
    : scoringNoteSetsFromLegacy(item.scoringNote ?? item.scoring_note)
  return {
    id: id != null && id > 0 ? id : null,
    bossName: String(item.bossName ?? item.boss_name ?? '').trim(),
    defense: Number(item.defense ?? 0) || 0,
    level: Number(item.level ?? 1) || 1,
    bossImage: item.bossImage ?? item.boss_image ?? null,
    weakness: weaknessSets.length ? mirroredWeakness.weakness : (item.weakness ?? null),
    resistance: weaknessSets.length
      ? mirroredWeakness.resistance
      : (item.resistance ?? null),
    resistanceHigh: weaknessSets.length
      ? mirroredWeakness.resistance_high
      : (item.resistanceHigh ?? item.resistance_high ?? null),
    crisisBaseHp: normalizeCrisisBaseHp(item),
    staggerMultiplier: normalizeStaggerMultiplier(
      item.staggerMultiplier ?? item.stagger_multiplier,
    ),
    staggerTime: normalizeStaggerTime(item.staggerTime ?? item.stagger_time),
    anomalyBarCoefficient: normalizeAnomalyBarCoefficient(
      item.anomalyBarCoefficient ?? item.anomaly_bar_coefficient,
    ),
    fieldBuffSets: serializeFieldBuffSets(sets),
    weaknessSets: serializeWeaknessSets(item.weaknessSets ?? item.weakness_sets),
    scoringNote: mirrorScoringNoteLegacy(scoringNoteSets),
    scoringNoteSets: serializeScoringNoteSets(scoringNoteSets),
    fieldBuffName: legacy.field_buff_name,
    fieldBuffText: legacy.field_buff_text,
    fieldBuffImage: legacy.field_buff_image,
    fieldBuffEffectBlocks: legacy.field_buff_effect_blocks,
  }
}

export async function exportBossInfoSnapshot() {
  await ensureBossStaggerSchema()
  await ensureBossResistanceSchema()
  await ensureBossAnomalySchema()
  await ensureEnvironmentBuffSchema()
  await ensureBossScoringNoteSchema()
  const [rows] = await pool.query(`
    SELECT id, boss_name, defense, level, boss_image, weakness, resistance, resistance_high,
           crisis_base_hp, stagger_multiplier, stagger_time, anomaly_bar_coefficient,
           field_buff_name, field_buff_text, field_buff_image, field_buff_effect_blocks, field_buff_sets, weakness_sets,
           scoring_note, scoring_note_sets
    FROM boss_info
    ORDER BY boss_name, id
  `)

  return {
    kind: BOSS_INFO_SNAPSHOT_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    count: rows.length,
    rows: rows.map((row) => {
      const scoringNoteSets = exportedScoringNoteSets(row)
      return {
        id: Number(row.id),
        bossName: String(row.boss_name ?? ''),
        defense: Number(row.defense) || 0,
        level: Number(row.level) || 1,
        bossImage: row.boss_image ?? null,
        weakness: row.weakness ?? null,
        resistance: row.resistance ?? null,
        resistanceHigh: row.resistance_high ?? null,
        crisisBaseHp: row.crisis_base_hp == null ? null : Number(row.crisis_base_hp),
        staggerMultiplier: normalizeStaggerMultiplier(row.stagger_multiplier),
        staggerTime: normalizeStaggerTime(row.stagger_time),
        anomalyBarCoefficient: normalizeAnomalyBarCoefficient(row.anomaly_bar_coefficient),
        fieldBuffSets: parseFieldBuffSetsJson(row.field_buff_sets),
        weaknessSets: parseWeaknessSetsJson(row.weakness_sets),
        fieldBuffName: row.field_buff_name ?? null,
        fieldBuffText: row.field_buff_text ?? null,
        fieldBuffImage: row.field_buff_image ?? null,
        fieldBuffEffectBlocks: parseEffectBlocksJson(row.field_buff_effect_blocks),
        scoringNote: mirrorScoringNoteLegacy(scoringNoteSets) ?? row.scoring_note ?? null,
        scoringNoteSets,
      }
    }),
  }
}

/** 导出用得分机制多套：多套优先，没有套时用旧单列兜底成一套（与读路径同口径） */
function exportedScoringNoteSets(row) {
  const sets = parseScoringNoteSetsJson(row.scoring_note_sets)
  return sets.length ? sets : scoringNoteSetsFromLegacy(row.scoring_note)
}

/**
 * @param {object} payload
 * @param {{ replace?: boolean }} [options]
 */
export async function importBossInfoSnapshot(payload, options = {}) {
  await ensureBossStaggerSchema()
  await ensureBossResistanceSchema()
  await ensureBossAnomalySchema()
  await ensureEnvironmentBuffSchema()
  await ensureBossScoringNoteSchema()
  const replaceAll = Boolean(options.replace)
  const items = Array.isArray(payload?.rows)
    ? payload.rows
    : Array.isArray(payload)
      ? payload
      : []

  const summary = {
    total: items.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    replaced: replaceAll,
  }

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    if (replaceAll) {
      await conn.query(`DELETE FROM boss_info`)
    }

    for (const raw of items) {
      const item = normalizeRow(raw)
      if (!item.bossName) {
        summary.skipped += 1
        continue
      }

      const crisisBase = item.crisisBaseHp
      const params = [
        item.bossName,
        item.defense,
        item.level,
        item.bossImage,
        item.weakness,
        item.resistance,
        item.resistanceHigh,
        crisisBase,
        item.staggerMultiplier,
        item.staggerTime,
        item.anomalyBarCoefficient,
        item.fieldBuffName,
        item.fieldBuffText,
        item.fieldBuffImage,
        asJsonColumn(item.fieldBuffEffectBlocks),
        item.fieldBuffSets,
        item.weaknessSets,
        item.scoringNote,
        item.scoringNoteSets,
      ]

      if (replaceAll) {
        if (item.id != null) {
          await conn.execute(
            `INSERT INTO boss_info (
               id, boss_name, defense, level, boss_image, weakness, resistance, resistance_high, crisis_base_hp, stagger_multiplier, stagger_time, anomaly_bar_coefficient,
               field_buff_name, field_buff_text, field_buff_image, field_buff_effect_blocks, field_buff_sets, weakness_sets,
               scoring_note, scoring_note_sets
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [item.id, ...params],
          )
        } else {
          await conn.execute(
            `INSERT INTO boss_info (
               boss_name, defense, level, boss_image, weakness, resistance, resistance_high, crisis_base_hp, stagger_multiplier, stagger_time, anomaly_bar_coefficient,
               field_buff_name, field_buff_text, field_buff_image, field_buff_effect_blocks, field_buff_sets, weakness_sets,
               scoring_note, scoring_note_sets
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params,
          )
        }
        summary.inserted += 1
        continue
      }

      // 名字是业务键：先按名字匹配（对齐 upsertBossInfo 语义），
      // 避免按 id 改名时撞上 uk_boss_name（目标库已存在同名老行）
      let targetId = null
      const [byName] = await conn.execute(
        `SELECT id FROM boss_info WHERE boss_name = ? LIMIT 1`,
        [item.bossName],
      )
      if (byName[0]?.id != null) targetId = Number(byName[0].id)
      if (targetId == null && item.id != null) {
        const [byId] = await conn.execute(`SELECT id FROM boss_info WHERE id = ? LIMIT 1`, [item.id])
        if (byId[0]?.id != null) targetId = Number(byId[0].id)
      }

      if (targetId != null) {
        const [cur] = await conn.execute(`SELECT boss_image FROM boss_info WHERE id = ? LIMIT 1`, [
          targetId,
        ])
        const mergedImage = preferExistingImage(item.bossImage, cur[0]?.boss_image)
        await conn.execute(
          `UPDATE boss_info
           SET boss_name = ?, defense = ?, level = ?, boss_image = ?, weakness = ?, resistance = ?, resistance_high = ?,
               crisis_base_hp = ?, stagger_multiplier = ?, stagger_time = ?, anomaly_bar_coefficient = ?,
               field_buff_name = ?, field_buff_text = ?, field_buff_image = ?, field_buff_effect_blocks = ?,
               field_buff_sets = ?, weakness_sets = ?,
               scoring_note = ?, scoring_note_sets = ?
           WHERE id = ?`,
          [
            item.bossName,
            item.defense,
            item.level,
            mergedImage,
            item.weakness,
            item.resistance,
            item.resistanceHigh,
            crisisBase,
            item.staggerMultiplier,
            item.staggerTime,
            item.anomalyBarCoefficient,
            item.fieldBuffName,
            item.fieldBuffText,
            item.fieldBuffImage,
            asJsonColumn(item.fieldBuffEffectBlocks),
            item.fieldBuffSets,
            item.weaknessSets,
            item.scoringNote,
            item.scoringNoteSets,
            targetId,
          ],
        )
        summary.updated += 1
        continue
      }

      if (item.id != null) {
        await conn.execute(
          `INSERT INTO boss_info (
             id, boss_name, defense, level, boss_image, weakness, resistance, resistance_high, crisis_base_hp, stagger_multiplier, stagger_time, anomaly_bar_coefficient,
             field_buff_name, field_buff_text, field_buff_image, field_buff_effect_blocks, field_buff_sets, weakness_sets,
             scoring_note, scoring_note_sets
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [item.id, ...params],
        )
      } else {
        await conn.execute(
          `INSERT INTO boss_info (
             boss_name, defense, level, boss_image, weakness, resistance, resistance_high, crisis_base_hp, stagger_multiplier, stagger_time, anomaly_bar_coefficient,
             field_buff_name, field_buff_text, field_buff_image, field_buff_effect_blocks, field_buff_sets, weakness_sets,
             scoring_note, scoring_note_sets
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params,
        )
      }
      summary.inserted += 1
    }

    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }

  return summary
}
