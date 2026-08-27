/**
 * 临界推演管理端（deduction_node CRUD）
 * - 期数：列表 / 新建 / 改名 / 删除（含该期 boss/buff 平铺行）
 * - 节点：列表 / 新建 / 编辑（剧情、层、增益 JSON）/ 删除
 * 推演不用危局 ID 编码：节点自增 id，期数用 version + phase 定位。
 */
import pool from '../config/db.js'
import { ensureDeductionStoryOptionsColumn } from './deductionSchemaService.js'
import { createBuff } from './dataService.js'
import { ensureEnvironmentBuffSchema } from '../utils/environmentBuffSchema.js'
import { parseEffectBlocksJson } from '../utils/environmentBuffSchema.js'
import {
  loadGlobalBuffEffectMap,
  resolveEffectBlocksForName,
} from '../utils/sameNameBuffEffects.js'
import {
  attachFieldBuffToDeductionLayers,
  loadBossFieldBuffSetsMap,
} from '../utils/bossFieldBuff.js'
import { upsertBossInfo } from './bossInfoService.js'
import { applyBossFallbackToPeriodNodes } from '../utils/deductionLayerFallback.js'
import { decodeDefenseBossId, isDefenseBossId } from '../utils/defenseId.js'

const DEFENSE_MINIONS_TTL_MS = 10 * 60 * 1000
let defenseMinionsCache = null
let defenseMinionsCachedAt = 0

function normalizePhase(phase) {
  const digits = String(phase ?? '').replace(/\D/g, '')
  return digits || String(phase ?? '').trim() || '1'
}

function parseJson(value) {
  if (value == null) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }
  return value
}

function parseJsonArray(value) {
  const parsed = parseJson(value)
  return Array.isArray(parsed) ? parsed : []
}

function toJson(value) {
  return value == null ? null : JSON.stringify(value)
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deduction_node (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      version VARCHAR(50) NOT NULL,
      phase VARCHAR(50) NOT NULL DEFAULT '1',
      node_id VARCHAR(20) NOT NULL,
      node_name VARCHAR(100) NOT NULL DEFAULT '',
      node_type INT NOT NULL DEFAULT 0,
      prev_node VARCHAR(20) NOT NULL DEFAULT '',
      story_text TEXT NULL,
      story_options_json JSON NULL,
      layers_json JSON NULL,
      buffs_json JSON NULL,
      sort_order INT NOT NULL DEFAULT 0,
      period_name VARCHAR(100) NOT NULL DEFAULT '' COMMENT '期数显示名，如 临界推演：歧路回响',
      PRIMARY KEY (id),
      UNIQUE KEY uk_dd_node (version, phase, node_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='临界推演节点（剧情/战斗）'
  `)
  await ensureDeductionStoryOptionsColumn(pool)
}

// ── 下拉数据源（全局去重，不按期数挂钩） ──────────────────

/** 全部 Boss 去重（与危局一致：boss_info 怪物基础库为规范身份，boss 表补充缺失名字与 HP） */
export async function listPickBosses() {
  await ensureTable()
  const [infoRows] = await pool.execute(
    `SELECT boss_name, defense, level, boss_image, weakness, resistance
     FROM boss_info
     WHERE boss_name IS NOT NULL AND boss_name <> ''
     ORDER BY boss_name`,
  )
  const [bossRows] = await pool.execute(
    `SELECT boss_name,
            MAX(hp) AS hp,
            MAX(defense) AS defense,
            MAX(level) AS level,
            MAX(weakness) AS weakness,
            MAX(resistance) AS resistance,
            MAX(boss_image) AS boss_image
     FROM boss
     WHERE boss_name IS NOT NULL AND boss_name <> ''
     GROUP BY boss_name`,
  )

  const byName = new Map()
  for (const info of infoRows) {
    byName.set(info.boss_name, {
      name: info.boss_name,
      defense: Number(info.defense) || 0,
      level: Number(info.level) || 0,
      weakness: info.weakness ?? null,
      resistance: info.resistance ?? null,
      boss_image: info.boss_image ?? null,
      hp: 0,
    })
  }
  for (const b of bossRows) {
    const existing = byName.get(b.boss_name)
    if (existing) {
      // 基础库无 HP，从 boss 表补；其余字段基础库优先，缺失才回退
      existing.hp = Number(b.hp) || existing.hp
      if (!existing.defense) existing.defense = Number(b.defense) || 0
      if (!existing.level) existing.level = Number(b.level) || 0
      if (!existing.weakness) existing.weakness = b.weakness
      if (!existing.resistance) existing.resistance = b.resistance
      if (!existing.boss_image) existing.boss_image = b.boss_image
    } else {
      byName.set(b.boss_name, {
        name: b.boss_name,
        defense: Number(b.defense) || 0,
        level: Number(b.level) || 0,
        weakness: b.weakness ?? null,
        resistance: b.resistance ?? null,
        boss_image: b.boss_image ?? null,
        hp: Number(b.hp) || 0,
      })
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

/**
 * 防卫战小怪候选：供推演「前战」层编辑。优先读本地 boss 表 mode=defense（与式舆防卫战同源），
 * 不含防卫战 Boss 关大怪；无防卫数据时回退 boss_info + 全模式 boss 聚合。
 */
async function attachBossImagesToMinionMap(byName) {
  await ensureTable()
  const [infoRows] = await pool.execute(
    `SELECT DISTINCT boss_name, boss_image
     FROM boss_info
     WHERE boss_image IS NOT NULL AND boss_image <> ''`,
  )
  for (const row of infoRows) {
    const target = byName.get(row.boss_name)
    if (target && !target.boss_image) target.boss_image = row.boss_image
  }
  const [bossRows] = await pool.execute(
    `SELECT boss_name, MAX(boss_image) AS boss_image
     FROM boss
     WHERE boss_image IS NOT NULL AND boss_image <> ''
     GROUP BY boss_name`,
  )
  for (const row of bossRows) {
    const target = byName.get(row.boss_name)
    if (target && !target.boss_image) target.boss_image = row.boss_image
  }
}

async function listShiyuMinionsFromLocal() {
  const byName = new Map()
  const [infoRows] = await pool.execute(
    `SELECT boss_name, defense, level, boss_image, weakness, resistance
     FROM boss_info
     WHERE boss_name IS NOT NULL AND TRIM(boss_name) <> ''`,
  )
  for (const info of infoRows) {
    byName.set(info.boss_name, {
      name: info.boss_name,
      hp: 0,
      defense: Number(info.defense) || 0,
      level: Number(info.level) || 0,
      weakness: info.weakness ?? null,
      resistance: info.resistance ?? null,
      boss_image: info.boss_image ?? null,
    })
  }
  const [bossRows] = await pool.execute(
    `SELECT boss_name,
            MAX(hp) AS hp,
            MAX(defense) AS defense,
            MAX(level) AS level,
            MAX(weakness) AS weakness,
            MAX(resistance) AS resistance,
            MAX(boss_image) AS boss_image
     FROM boss
     WHERE boss_name IS NOT NULL AND TRIM(boss_name) <> ''
     GROUP BY boss_name`,
  )
  for (const b of bossRows) {
    const existing = byName.get(b.boss_name)
    if (existing) {
      if (!existing.hp) existing.hp = Math.round(Number(b.hp) || 0)
      if (!existing.defense) existing.defense = Number(b.defense) || 0
      if (!existing.level) existing.level = Number(b.level) || 0
      if (!existing.weakness) existing.weakness = b.weakness
      if (!existing.resistance) existing.resistance = b.resistance
      if (!existing.boss_image) existing.boss_image = b.boss_image
    } else {
      byName.set(b.boss_name, {
        name: b.boss_name,
        hp: Math.round(Number(b.hp) || 0),
        defense: Number(b.defense) || 0,
        level: Number(b.level) || 0,
        weakness: b.weakness ?? null,
        resistance: b.resistance ?? null,
        boss_image: b.boss_image ?? null,
      })
    }
  }
  await attachBossImagesToMinionMap(byName)
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

/** 本地式舆防卫战小怪/精英（boss 表 mode=defense，按 ID 解码排除 Boss 关大怪） */
async function listDefenseMinionsFromDb() {
  await ensureTable()
  const [rows] = await pool.execute(
    `SELECT id, boss_name, hp, defense, level, weakness, resistance, boss_image
     FROM boss
     WHERE mode = 'defense'`,
  )
  const byName = new Map()
  for (const row of rows) {
    const id = Number(row.id)
    if (!isDefenseBossId(id)) continue
    try {
      const decoded = decodeDefenseBossId(id)
      if (decoded.monsterCategory === 'boss') continue
    } catch {
      continue
    }
    const name = String(row.boss_name).trim()
    if (!name) continue
    const hp = Math.round(Number(row.hp) || 0)
    const defense = Number(row.defense) || 0
    const level = Number(row.level) || 0
    const existing = byName.get(name)
    if (existing) {
      if (!existing.hp || hp > existing.hp) existing.hp = hp
      if (!existing.defense) existing.defense = defense
      if (!existing.level) existing.level = level
      if (!existing.weakness) existing.weakness = row.weakness
      if (!existing.resistance) existing.resistance = row.resistance
      if (!existing.boss_image) existing.boss_image = row.boss_image
    } else {
      byName.set(name, {
        name,
        hp,
        defense,
        level,
        weakness: row.weakness ?? null,
        resistance: row.resistance ?? null,
        boss_image: row.boss_image ?? null,
      })
    }
  }
  await attachBossImagesToMinionMap(byName)
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

export async function listShiyuMinions() {
  const now = Date.now()
  if (defenseMinionsCache && now - defenseMinionsCachedAt < DEFENSE_MINIONS_TTL_MS) {
    return defenseMinionsCache
  }
  const defenseRows = await listDefenseMinionsFromDb()
  if (defenseRows.length > 0) {
    defenseMinionsCache = defenseRows
    defenseMinionsCachedAt = now
    return defenseRows
  }
  console.warn('[deduction] 本地防卫战小怪为空，回退通用怪物库')
  const fallback = await listShiyuMinionsFromLocal()
  defenseMinionsCache = fallback
  defenseMinionsCachedAt = now
  return fallback
}

/** 全部 Buff 去重（所有版块，供推演增益选择） */
export async function listPickBuffs() {
  await ensureTable()
  await ensureEnvironmentBuffSchema()
  const [rows] = await pool.execute(
    `SELECT buff_name, buff, buff_image, effect_blocks
     FROM buff
     WHERE buff_name IS NOT NULL AND TRIM(buff_name) <> ''
     ORDER BY buff_name ASC,
       (effect_blocks IS NOT NULL AND JSON_LENGTH(effect_blocks) > 0) DESC,
       (buff IS NOT NULL AND TRIM(buff) <> '') DESC,
       id DESC`,
  )
  const byName = new Map()
  for (const row of rows) {
    const name = String(row.buff_name).trim()
    if (!name || byName.has(name)) continue
    byName.set(name, {
      name,
      desc: row.buff ?? null,
      buff_image: row.buff_image ?? null,
      effect_blocks: parseEffectBlocksJson(row.effect_blocks),
    })
  }

  // 节点 buffs_json 里已模块化、但尚未同步进 buff 表的条目也纳入复用
  const [nodeRows] = await pool.execute(
    `SELECT buffs_json FROM deduction_node WHERE buffs_json IS NOT NULL`,
  )
  for (const row of nodeRows) {
    let buffs = row.buffs_json
    if (typeof buffs === 'string') {
      try {
        buffs = JSON.parse(buffs)
      } catch {
        continue
      }
    }
    if (!Array.isArray(buffs)) continue
    for (const buff of buffs) {
      const name = String(buff?.title ?? '').trim()
      if (!name) continue
      const blocks = parseEffectBlocksJson(buff.effect_blocks)
      const existing = byName.get(name)
      if (!existing) {
        byName.set(name, {
          name,
          desc: buff.desc ?? null,
          buff_image: buff.buff_image ?? null,
          effect_blocks: blocks,
        })
        continue
      }
      if (!existing.effect_blocks?.length && blocks?.length) {
        existing.effect_blocks = blocks
        if (!existing.desc && buff.desc) existing.desc = buff.desc
        if (!existing.buff_image && buff.buff_image) existing.buff_image = buff.buff_image
      }
    }
  }

  return [...byName.values()]
}

/** 危局/防卫/临界 Buff 模板（同名去重，供推演增益复用） */
export async function listPickBuffTemplates() {
  // 与全库 picker 同源：含节点 buffs_json 中已模块化、表内尚未同步的条目
  return listPickBuffs()
}

async function sanitizeLayersForSave(layers) {
  if (!Array.isArray(layers)) return []
  return layers.map((layer) => ({
    name: String(layer?.name ?? '').trim() || '未命名层',
    isBoss: layer?.isBoss === true,
    ending: layer?.ending == null || layer?.ending === '' ? null : String(layer.ending),
    fieldBuffSetId:
      layer?.fieldBuffSetId == null || String(layer.fieldBuffSetId).trim() === ''
        ? null
        : String(layer.fieldBuffSetId).trim(),
    monsters: Array.isArray(layer?.monsters)
      ? layer.monsters
          .map((m) => ({
            name: String(m?.name ?? '').trim(),
            hp: Number(m?.hp) || 0,
            defense: Number(m?.defense) || 0,
            level: Number(m?.level) || 0,
            weakness: m?.weakness == null ? null : String(m.weakness),
            resistance: m?.resistance == null ? null : String(m.resistance),
            boss_image: m?.boss_image == null ? null : String(m.boss_image),
          }))
          .filter((m) => m.name)
      : [],
  }))
}

/** 节点 layers 中的怪物同步到 boss_info 与 boss 表（mode=deduction），供下拉与回退层使用 */
async function syncDeductionMonstersToTables(version, phase, layers) {
  const versionValue = String(version ?? '').trim()
  const phaseValue = normalizePhase(phase)
  if (!versionValue) return

  const sanitized = await sanitizeLayersForSave(layers)
  for (const layer of sanitized) {
    const room = String(layer.name ?? '').trim()
    if (!room) continue
    for (const monster of layer.monsters) {
      const name = String(monster.name ?? '').trim()
      if (!name) continue
      try {
        await upsertBossInfo({
          boss_name: name,
          defense: monster.defense,
          level: monster.level || 1,
          weakness: monster.weakness,
          resistance: monster.resistance,
          boss_image: monster.boss_image,
        })
        const [existing] = await pool.execute(
          `SELECT id FROM boss
           WHERE mode = 'deduction' AND version = ? AND phase = ? AND room = ? AND boss_name = ?
           LIMIT 1`,
          [versionValue, phaseValue, room, name],
        )
        const bossValues = [
          versionValue,
          phaseValue,
          name,
          monster.hp,
          monster.defense,
          monster.level || 1,
          room,
          monster.weakness,
          monster.resistance,
          monster.boss_image,
        ]
        if (existing.length) {
          await pool.execute(
            `UPDATE boss
             SET version = ?, phase = ?, boss_name = ?, hp = ?, defense = ?, level = ?,
                 room = ?, weakness = ?, resistance = ?, boss_image = ?, mode = 'deduction'
             WHERE id = ?`,
            [...bossValues, existing[0].id],
          )
        } else {
          await pool.execute(
            `INSERT INTO boss (version, phase, boss_name, hp, defense, level, room, weakness, resistance, boss_image, mode)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'deduction')`,
            bossValues,
          )
        }
      } catch (err) {
        console.warn(`[deduction] 同步怪物「${name}」到 boss 表失败:`, err?.message ?? err)
      }
    }
  }
}

function sanitizeBuffsForSave(buffs) {
  if (!Array.isArray(buffs)) return []
  return buffs
    .map((buff) => ({
      title: String(buff?.title ?? '').trim(),
      desc: buff?.desc == null ? null : String(buff.desc),
      buff_image: buff?.buff_image == null ? null : String(buff.buff_image),
      effect_blocks: buff?.effect_blocks ?? null,
    }))
    .filter((buff) => buff.title)
}

async function enrichBuffsWithSameNameEffects(buffs) {
  const sanitized = sanitizeBuffsForSave(buffs)
  if (!sanitized.length) return sanitized
  const map = await loadGlobalBuffEffectMap()
  return sanitized.map((buff) => {
    const blocks = resolveEffectBlocksForName(buff.effect_blocks, buff.title, map)
    return {
      ...buff,
      effect_blocks: blocks?.length ? blocks : null,
    }
  })
}

async function syncDeductionBuffsToTable(version, phase, buffs) {
  if (!Array.isArray(buffs)) return
  const versionValue = String(version ?? '').trim()
  const phaseValue = normalizePhase(phase)
  if (!versionValue) return
  for (let i = 0; i < buffs.length; i++) {
    const title = String(buffs[i]?.title ?? '').trim()
    if (!title) continue
    try {
      const [existing] = await pool.execute(
        `SELECT id, effect_blocks FROM buff WHERE mode = 'deduction' AND version = ? AND phase = ? AND buff_name = ? LIMIT 1`,
        [versionValue, phaseValue, title],
      )
      const existingId = existing[0]?.id != null ? Number(existing[0].id) : null
      let effectBlocks = parseEffectBlocksJson(buffs[i].effect_blocks)
      if (!effectBlocks?.length && existing[0]?.effect_blocks != null) {
        effectBlocks = parseEffectBlocksJson(existing[0].effect_blocks)
      }
      if (!effectBlocks?.length) {
        // 同名危局/防卫/其他期临界已有结构化效果时一并带上
        const [named] = await pool.execute(
          `SELECT effect_blocks FROM buff
           WHERE buff_name = ?
             AND effect_blocks IS NOT NULL AND JSON_LENGTH(effect_blocks) > 0
           ORDER BY mode = 'deduction' DESC, id DESC
           LIMIT 1`,
          [title],
        )
        if (named[0]?.effect_blocks != null) {
          effectBlocks = parseEffectBlocksJson(named[0].effect_blocks)
        }
      }
      await createBuff({
        recordScheme: 'deduction',
        mode: 'deduction',
        id: existingId,
        version: versionValue,
        phase: phaseValue,
        buff_name: title,
        buff: buffs[i].desc ?? null,
        buff_image: buffs[i].buff_image ?? null,
        effect_blocks: effectBlocks,
        buffIndex: i + 1,
      })
    } catch (err) {
      console.warn(`[deduction] 同步 Buff「${title}」到 buff 表失败:`, err?.message ?? err)
    }
  }
}

// ── 期数 ──────────────────────────────────────────────

export async function listDeductionPeriods() {
  await ensureTable()
  const [rows] = await pool.execute(
    `SELECT version, phase, MAX(period_name) AS period_name, COUNT(*) AS node_count
     FROM deduction_node
     GROUP BY version, phase
     ORDER BY CAST(version AS UNSIGNED), CAST(phase AS UNSIGNED)`,
  )
  return rows.map((row) => ({
    version: String(row.version),
    phase: String(row.phase),
    periodName: String(row.period_name ?? '').trim() || null,
    nodeCount: Number(row.node_count) || 0,
  }))
}

export async function createDeductionPeriod({ version, phase, periodName = '' }) {
  await ensureTable()
  const versionValue = String(version ?? '').trim()
  if (!versionValue) throw new Error('期数编号（version）必填')
  const phaseValue = normalizePhase(phase)
  const name = String(periodName ?? '').trim()

  const [existing] = await pool.execute(
    'SELECT id FROM deduction_node WHERE version = ? AND phase = ? LIMIT 1',
    [versionValue, phaseValue],
  )
  if (existing.length) throw new Error(`期数 ${versionValue} 已存在`)

  // 期数由节点行定义：建一个占位 INTRO 节点让期数存在
  const nodeId = `${versionValue}${phaseValue}0001`
  await pool.execute(
    `INSERT INTO deduction_node
       (version, phase, node_id, node_name, node_type, prev_node, story_text, layers_json, buffs_json, sort_order, period_name)
     VALUES (?, ?, ?, 'INTRO', 4, '0', '', '[]', '[]', 0, ?)`,
    [versionValue, phaseValue, nodeId, name],
  )
  return { version: versionValue, phase: phaseValue, periodName: name || null, nodeCount: 1 }
}

export async function renameDeductionPeriod(version, periodName) {
  const versionValue = String(version ?? '').trim()
  if (!versionValue) throw new Error('期数编号（version）必填')
  const name = String(periodName ?? '').trim()
  const [res] = await pool.execute(
    'UPDATE deduction_node SET period_name = ? WHERE version = ?',
    [name, versionValue],
  )
  if (!res.affectedRows) throw new Error(`期数 ${versionValue} 不存在`)
  return { version: versionValue, periodName: name || null }
}

export async function deleteDeductionPeriod(version) {
  const versionValue = String(version ?? '').trim()
  if (!versionValue) throw new Error('期数编号（version）必填')
  await pool.query('START TRANSACTION')
  try {
    await pool.execute('DELETE FROM deduction_node WHERE version = ?', [versionValue])
    await pool.execute(
      "DELETE FROM boss WHERE mode = 'deduction' AND version = ?",
      [versionValue],
    )
    await pool.execute(
      "DELETE FROM buff WHERE mode = 'deduction' AND version = ?",
      [versionValue],
    )
    await pool.query('COMMIT')
  } catch (err) {
    await pool.query('ROLLBACK')
    throw err
  }
  return { version: versionValue }
}

// ── 节点 ──────────────────────────────────────────────

export async function listDeductionNodes(version) {
  await ensureTable()
  const versionValue = String(version ?? '').trim()
  const [rows] = await pool.execute(
    `SELECT id, version, phase, node_id, node_name, node_type, prev_node, story_text, story_options_json, layers_json, buffs_json, sort_order, period_name
     FROM deduction_node
     WHERE version = ?
     ORDER BY sort_order, id`,
    [versionValue],
  )
  const nodes = rows.map((row) => ({
    id: Number(row.id),
    version: String(row.version),
    phase: String(row.phase),
    nodeId: String(row.node_id),
    name: String(row.node_name ?? ''),
    type: Number(row.node_type) || 0,
    prevNode: row.prev_node || null,
    storyText: row.story_text || null,
    storyOptions: parseJsonArray(row.story_options_json),
    layers: parseJsonArray(row.layers_json),
    buffs: parseJsonArray(row.buffs_json),
    sortOrder: Number(row.sort_order) || 0,
    periodName: String(row.period_name ?? '').trim() || null,
  }))

  const [bossStatRows] = await pool.execute(
    `SELECT room, boss_name, hp, defense, level, weakness, resistance, boss_image
     FROM boss
     WHERE mode = 'deduction' AND version = ?`,
    [versionValue],
  )
  applyBossFallbackToPeriodNodes(nodes, bossStatRows)

  const globalBuffEffectMap = await loadGlobalBuffEffectMap()
  const fieldBuffMap = await loadBossFieldBuffSetsMap()
  for (const node of nodes) {
    if (Array.isArray(node.layers)) {
      attachFieldBuffToDeductionLayers(node.layers, fieldBuffMap)
    }
    if (!Array.isArray(node.buffs)) continue
    node.buffs = node.buffs.map((buff) => {
      const title = String(buff?.title ?? '').trim()
      const blocks = resolveEffectBlocksForName(buff?.effect_blocks, title, globalBuffEffectMap)
      return {
        ...buff,
        effect_blocks: blocks?.length ? blocks : buff?.effect_blocks ?? null,
      }
    })
  }

  return nodes
}

export async function createDeductionNode(version, payload) {
  await ensureTable()
  const versionValue = String(version ?? '').trim()
  const phaseValue = normalizePhase(payload.phase)
  if (!versionValue) throw new Error('期数编号（version）必填')

  // 期数名跟随该期已有节点
  const [[period]] = await pool.execute(
    'SELECT period_name FROM deduction_node WHERE version = ? LIMIT 1',
    [versionValue],
  )
  const periodName = String(period?.period_name ?? '').trim()

  // node_id：期内的数字 id 递增（避开与导入的 nanoka 节点冲突前缀）
  const [[maxRow]] = await pool.execute(
    'SELECT COALESCE(MAX(CAST(node_id AS UNSIGNED)), 0) AS m FROM deduction_node WHERE version = ?',
    [versionValue],
  )
  const base = Math.max(Number(maxRow?.m) || 0, 900000)
  const nodeId = String(base + 1)

  const [[maxSort]] = await pool.execute(
    'SELECT COALESCE(MAX(sort_order), -1) AS m FROM deduction_node WHERE version = ?',
    [versionValue],
  )
  const sortOrder = Number(maxSort?.m) + 1
  const enrichedBuffs = await enrichBuffsWithSameNameEffects(payload.buffs)
  const sanitizedLayers = await sanitizeLayersForSave(payload.layers)

  const [res] = await pool.execute(
    `INSERT INTO deduction_node
       (version, phase, node_id, node_name, node_type, prev_node, story_text, layers_json, buffs_json, sort_order, period_name)
     VALUES (?, ?, ?, ?, ?, '0', ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?)`,
    [
      versionValue,
      phaseValue,
      nodeId,
      String(payload.name ?? '').trim() || '未命名节点',
      Number(payload.type) || 0,
      payload.storyText ?? '',
      toJson(sanitizedLayers),
      toJson(enrichedBuffs),
      sortOrder,
      periodName,
    ],
  )
  if (enrichedBuffs.length) {
    await syncDeductionBuffsToTable(versionValue, phaseValue, enrichedBuffs)
  }
  await syncDeductionMonstersToTables(versionValue, phaseValue, sanitizedLayers)
  return { id: Number(res.insertId), nodeId, sortOrder }
}

export async function updateDeductionNode(id, payload) {
  await ensureTable()
  const nodeId = Number(id)
  if (!Number.isInteger(nodeId) || nodeId <= 0) throw new Error('无效的节点 ID')
  const sortOrder = Number.isFinite(Number(payload.sortOrder)) ? Number(payload.sortOrder) : 0
  const sanitizedLayers = await sanitizeLayersForSave(payload.layers)
  const layersJson = toJson(sanitizedLayers)
  const enrichedBuffs = await enrichBuffsWithSameNameEffects(payload.buffs)
  const buffsJson = toJson(enrichedBuffs)
  const [res] = await pool.execute(
    `UPDATE deduction_node
     SET node_name = ?, node_type = ?, prev_node = ?, story_text = ?, story_options_json = CAST(? AS JSON),
         layers_json = CAST(? AS JSON), buffs_json = CAST(? AS JSON), sort_order = ?
     WHERE id = ?`,
    [
      String(payload.name ?? '').trim() || '未命名节点',
      Number(payload.type) || 0,
      String(payload.prevNode ?? '').trim(),
      payload.storyText ?? '',
      toJson(payload.storyOptions ?? []),
      layersJson,
      buffsJson,
      sortOrder,
      nodeId,
    ],
  )
  if (!res.affectedRows) throw new Error(`节点 ${nodeId} 不存在`)
  const [meta] = await pool.execute('SELECT version, phase FROM deduction_node WHERE id = ? LIMIT 1', [
    nodeId,
  ])
  if (meta[0]) {
    await syncDeductionBuffsToTable(meta[0].version, meta[0].phase, enrichedBuffs)
    await syncDeductionMonstersToTables(meta[0].version, meta[0].phase, sanitizedLayers)
  }
  return { id: nodeId }
}

export async function deleteDeductionNode(id) {
  const nodeId = Number(id)
  if (!Number.isInteger(nodeId) || nodeId <= 0) throw new Error('无效的节点 ID')
  const [res] = await pool.execute('DELETE FROM deduction_node WHERE id = ?', [nodeId])
  if (!res.affectedRows) throw new Error(`节点 ${nodeId} 不存在`)
  return { id: nodeId }
}

/** 整期节点重排：按 nodeIds 顺序重写 sort_order（nodeIds 为管理端自增 id） */
export async function reorderDeductionNodes(version, orderedIds) {
  const versionValue = String(version ?? '').trim()
  if (!versionValue) throw new Error('期数编号（version）必填')
  if (!Array.isArray(orderedIds) || !orderedIds.length) throw new Error('排序列表不能为空')
  const ids = orderedIds.map((v) => Number(v))
  if (ids.some((v) => !Number.isInteger(v) || v <= 0)) throw new Error('无效的节点 ID')

  await pool.query('START TRANSACTION')
  try {
    for (let i = 0; i < ids.length; i++) {
      const [res] = await pool.execute(
        'UPDATE deduction_node SET sort_order = ? WHERE id = ? AND version = ?',
        [i, ids[i], versionValue],
      )
      if (!res.affectedRows) throw new Error(`节点 ${ids[i]} 不存在或不属于该期数`)
    }
    await pool.query('COMMIT')
  } catch (err) {
    await pool.query('ROLLBACK')
    throw err
  }
  return { version: versionValue, count: ids.length }
}

/**
 * 前战(小怪)怪物：仅登记到 boss_info 基础库（按名 upsert），不写 boss 表。
 * 与危局（boss）走 createBoss（写 boss 表）区分。
 */
export async function createDeductionBossInfo(payload) {
  const name = String(payload?.boss_name ?? '').trim()
  if (!name) throw new Error('怪物名称不能为空')
  return upsertBossInfo({
    boss_name: name,
    defense: Number(payload.defense) || 0,
    level: Number(payload.level) || 1,
    weakness: payload.weakness ?? null,
    resistance: payload.resistance ?? null,
    boss_image: payload.boss_image ?? null,
  })
}
