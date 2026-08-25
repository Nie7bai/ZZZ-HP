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
import { ensureBossStaggerSchema, normalizeStaggerMultiplier } from './bossSchema.js'
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
  return {
    id: id != null && id > 0 ? id : null,
    bossName: String(item.bossName ?? item.boss_name ?? '').trim(),
    defense: Number(item.defense ?? 0) || 0,
    level: Number(item.level ?? 1) || 1,
    bossImage: item.bossImage ?? item.boss_image ?? null,
    weakness: item.weakness ?? null,
    resistance: item.resistance ?? null,
    crisisBaseHp: normalizeCrisisBaseHp(item),
    staggerMultiplier: normalizeStaggerMultiplier(
      item.staggerMultiplier ?? item.stagger_multiplier,
    ),
    fieldBuffSets: serializeFieldBuffSets(sets),
    fieldBuffName: legacy.field_buff_name,
    fieldBuffText: legacy.field_buff_text,
    fieldBuffImage: legacy.field_buff_image,
    fieldBuffEffectBlocks: legacy.field_buff_effect_blocks,
  }
}

export async function exportBossInfoSnapshot() {
  await ensureBossStaggerSchema()
  await ensureEnvironmentBuffSchema()
  const [rows] = await pool.query(`
    SELECT id, boss_name, defense, level, boss_image, weakness, resistance,
           crisis_base_hp, stagger_multiplier,
           field_buff_name, field_buff_text, field_buff_image, field_buff_effect_blocks, field_buff_sets
    FROM boss_info
    ORDER BY boss_name, id
  `)

  return {
    kind: BOSS_INFO_SNAPSHOT_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    count: rows.length,
    rows: rows.map((row) => ({
      id: Number(row.id),
      bossName: String(row.boss_name ?? ''),
      defense: Number(row.defense) || 0,
      level: Number(row.level) || 1,
      bossImage: row.boss_image ?? null,
      weakness: row.weakness ?? null,
      resistance: row.resistance ?? null,
      crisisBaseHp: row.crisis_base_hp == null ? null : Number(row.crisis_base_hp),
      staggerMultiplier: normalizeStaggerMultiplier(row.stagger_multiplier),
      fieldBuffSets: parseFieldBuffSetsJson(row.field_buff_sets),
      fieldBuffName: row.field_buff_name ?? null,
      fieldBuffText: row.field_buff_text ?? null,
      fieldBuffImage: row.field_buff_image ?? null,
      fieldBuffEffectBlocks: parseEffectBlocksJson(row.field_buff_effect_blocks),
    })),
  }
}

/**
 * @param {object} payload
 * @param {{ replace?: boolean }} [options]
 */
export async function importBossInfoSnapshot(payload, options = {}) {
  await ensureBossStaggerSchema()
  await ensureEnvironmentBuffSchema()
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
        crisisBase,
        item.staggerMultiplier,
        item.fieldBuffName,
        item.fieldBuffText,
        item.fieldBuffImage,
        asJsonColumn(item.fieldBuffEffectBlocks),
        item.fieldBuffSets,
      ]

      if (replaceAll) {
        if (item.id != null) {
          await conn.execute(
            `INSERT INTO boss_info (
               id, boss_name, defense, level, boss_image, weakness, resistance, crisis_base_hp, stagger_multiplier,
               field_buff_name, field_buff_text, field_buff_image, field_buff_effect_blocks, field_buff_sets
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [item.id, ...params],
          )
        } else {
          await conn.execute(
            `INSERT INTO boss_info (
               boss_name, defense, level, boss_image, weakness, resistance, crisis_base_hp, stagger_multiplier,
               field_buff_name, field_buff_text, field_buff_image, field_buff_effect_blocks, field_buff_sets
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params,
          )
        }
        summary.inserted += 1
        continue
      }

      let targetId = null
      if (item.id != null) {
        const [byId] = await conn.execute(`SELECT id FROM boss_info WHERE id = ? LIMIT 1`, [item.id])
        if (byId[0]?.id != null) targetId = Number(byId[0].id)
      }
      if (targetId == null) {
        const [byName] = await conn.execute(
          `SELECT id FROM boss_info WHERE boss_name = ? LIMIT 1`,
          [item.bossName],
        )
        if (byName[0]?.id != null) targetId = Number(byName[0].id)
      }

      if (targetId != null) {
        const [cur] = await conn.execute(`SELECT boss_image FROM boss_info WHERE id = ? LIMIT 1`, [
          targetId,
        ])
        const mergedImage = preferExistingImage(item.bossImage, cur[0]?.boss_image)
        await conn.execute(
          `UPDATE boss_info
           SET boss_name = ?, defense = ?, level = ?, boss_image = ?, weakness = ?, resistance = ?,
               crisis_base_hp = ?, stagger_multiplier = ?,
               field_buff_name = ?, field_buff_text = ?, field_buff_image = ?, field_buff_effect_blocks = ?,
               field_buff_sets = ?
           WHERE id = ?`,
          [
            item.bossName,
            item.defense,
            item.level,
            mergedImage,
            item.weakness,
            item.resistance,
            crisisBase,
            item.staggerMultiplier,
            item.fieldBuffName,
            item.fieldBuffText,
            item.fieldBuffImage,
            asJsonColumn(item.fieldBuffEffectBlocks),
            item.fieldBuffSets,
            targetId,
          ],
        )
        summary.updated += 1
        continue
      }

      if (item.id != null) {
        await conn.execute(
          `INSERT INTO boss_info (
             id, boss_name, defense, level, boss_image, weakness, resistance, crisis_base_hp, stagger_multiplier,
             field_buff_name, field_buff_text, field_buff_image, field_buff_effect_blocks, field_buff_sets
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [item.id, ...params],
        )
      } else {
        await conn.execute(
          `INSERT INTO boss_info (
             boss_name, defense, level, boss_image, weakness, resistance, crisis_base_hp, stagger_multiplier,
             field_buff_name, field_buff_text, field_buff_image, field_buff_effect_blocks, field_buff_sets
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
