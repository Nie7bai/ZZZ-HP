import pool from '../config/db.js'
import { buildAffixEffectTemplate, parseAffixEffectTemplate } from '../utils/affixEffectTemplate.js'

/**
 * 官方预设词条库（服务端唯一来源）
 *
 * 口径（用户 2026-09-12 / 2026-09-13）：
 * - 官方预设由**管理员在管理端维护**，用户侧只读、只能「复制一份」到自己浏览器里改；
 * - 用户一旦复制走，那份就是**冻结的副本** —— 这里怎么改都影响不到它
 *   （前端 `convertAffixLibraryStateToCopy`，见 `dev-docs/affix-optimizer-impl-log.md` 步骤 35 / 44），
 *   改动只对**之后新建**的库生效；
 * - 用户自己的词条库仍在 localStorage，**不上服务器**，管理员侧看不到也不管理；
 * - 不做离线兜底（离线了就别用）。
 *
 * ## 方案（多套官方预设）
 *
 * 条目表 / 分组表各带一个 `scheme` 列，主键都是 `(scheme, …)` —— 一套方案一份内容。
 * 另有 `affix_preset_scheme` 登记方案本身：空方案（刚从零建、还没加条目）也要能存在，
 * 光靠条目表反推不出它。`is_default = 1` 的那套是用户侧不带参数时拿到的默认方案。
 *
 * 老库（没有 `scheme` 列）走 `information_schema` 检查后 `ALTER` 迁移，幂等、不依赖手工 SQL；
 * 现有内容全部归入默认方案。
 *
 * ⚠️ `id` 是条目的对外身份（导出、复制方案、用户新建库时按它复制），
 *    发布后改它会让「之后新建的库」用新 id —— 已经复制走的库是冻结副本，不受影响。
 */

const ENTRY_TABLE = 'affix_preset_entry'
const GROUP_TABLE = 'affix_preset_group'
const SCHEME_TABLE = 'affix_preset_scheme'

/** 默认方案的键名：用户侧 `fetchAffixPreset()` 不带参数拿到的就是它 */
export const DEFAULT_AFFIX_PRESET_SCHEME = '默认'

let ensured = false

/** 建表 / 迁移幂等（与 skillGroupService 同一套做法：不依赖手工跑 SQL） */
async function ensureTables() {
  if (ensured) return

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEME_TABLE} (
      name VARCHAR(64) NOT NULL PRIMARY KEY,
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${ENTRY_TABLE} (
      scheme VARCHAR(64) NOT NULL DEFAULT '',
      id VARCHAR(64) NOT NULL,
      label VARCHAR(255) NOT NULL,
      target VARCHAR(64) NOT NULL,
      per_roll DECIMAL(12, 2) NOT NULL DEFAULT 0,
      cap INT NOT NULL DEFAULT 0,
      group_name VARCHAR(64) NOT NULL DEFAULT '',
      roll_cost INT NOT NULL DEFAULT 1,
      enabled_by_default TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      raw_json JSON NOT NULL,
      effect_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (scheme, id),
      KEY idx_group_sort (scheme, group_name, sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${GROUP_TABLE} (
      scheme VARCHAR(64) NOT NULL DEFAULT '',
      name VARCHAR(64) NOT NULL,
      cap INT NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      raw_json JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (scheme, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  await migrateToSchemeSchema()
  await migrateToEffectJsonColumn()
  await ensureDefaultScheme()

  ensured = true
}

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  )
  return readInt(rows[0]?.n, 0) > 0
}

async function indexExists(table, indexName) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName],
  )
  return readInt(rows[0]?.n, 0) > 0
}

/**
 * 老库迁移：给两张表补 `scheme` 列、把主键换成 `(scheme, …)`。
 *
 * 判据是「`scheme` 列不存在」——迁移只会在老库上跑一次；新建的库建表时就已经带它。
 * 现有内容全部归入默认方案（之前只有一套，就是这套）。
 */
async function migrateToSchemeSchema() {
  if (!(await columnExists(ENTRY_TABLE, 'scheme'))) {
    await pool.query(
      `ALTER TABLE ${ENTRY_TABLE} ADD COLUMN scheme VARCHAR(64) NOT NULL DEFAULT '' AFTER id`,
    )
    await pool.query(`UPDATE ${ENTRY_TABLE} SET scheme = ? WHERE scheme = ''`, [
      DEFAULT_AFFIX_PRESET_SCHEME,
    ])
    await pool.query(`ALTER TABLE ${ENTRY_TABLE} DROP PRIMARY KEY, ADD PRIMARY KEY (scheme, id)`)
    // 老索引只含 (group_name, sort_order)，补上 scheme 才认得出「本方案内按组排序」
    if (await indexExists(ENTRY_TABLE, 'idx_group_sort')) {
      await pool.query(`ALTER TABLE ${ENTRY_TABLE} DROP INDEX idx_group_sort`)
    }
    await pool.query(
      `ALTER TABLE ${ENTRY_TABLE} ADD KEY idx_group_sort (scheme, group_name, sort_order)`,
    )
  }

  if (!(await columnExists(GROUP_TABLE, 'scheme'))) {
    await pool.query(`ALTER TABLE ${GROUP_TABLE} ADD COLUMN scheme VARCHAR(64) NOT NULL DEFAULT '' FIRST`)
    await pool.query(`UPDATE ${GROUP_TABLE} SET scheme = ? WHERE scheme = ''`, [
      DEFAULT_AFFIX_PRESET_SCHEME,
    ])
    await pool.query(`ALTER TABLE ${GROUP_TABLE} DROP PRIMARY KEY, ADD PRIMARY KEY (scheme, name)`)
  }
}

/**
 * 加 `effect_json`，并把空列从旧 `target` + raw 条件回填。幂等。
 * 写库前须已有 `scripts/data/backups/` 快照（见 restore-affix-preset.mjs）。
 */
async function migrateToEffectJsonColumn() {
  if (!(await columnExists(ENTRY_TABLE, 'effect_json'))) {
    await pool.query(`ALTER TABLE ${ENTRY_TABLE} ADD COLUMN effect_json JSON NULL AFTER raw_json`)
  }
  const [rows] = await pool.query(
    `SELECT scheme, id, target, raw_json FROM ${ENTRY_TABLE} WHERE effect_json IS NULL`,
  )
  for (const row of rows) {
    const raw = parseRawJson(row.raw_json) ?? {}
    const template = buildAffixEffectTemplate({
      target: row.target,
      applySituation: raw.applySituation,
      scope: raw.scope,
      skillCategory: raw.skillCategory,
      skillSubcategoryId: raw.skillSubcategoryId,
      appliesToAnomaly: raw.appliesToAnomaly,
    })
    if (!template) continue
    await pool.query(`UPDATE ${ENTRY_TABLE} SET effect_json = ? WHERE scheme = ? AND id = ?`, [
      JSON.stringify(template),
      row.scheme,
      row.id,
    ])
  }
}

/**
 * 默认方案那一行必须存在（用户侧不带参数时要能取到它）。
 *
 * 判据是「表里没有任何 `is_default = 1` 的行」而**不是**「有没有叫『默认』的行」——
 * 默认方案可以改名（步骤 50），按名字判会凭空补出一行第二个默认方案。
 */
async function ensureDefaultScheme() {
  const [rows] = await pool.query(`SELECT name FROM ${SCHEME_TABLE} WHERE is_default = 1 LIMIT 1`)
  if (rows.length) return
  await pool.query(
    `INSERT IGNORE INTO ${SCHEME_TABLE} (name, is_default, sort_order) VALUES (?, 1, 0)`,
    [DEFAULT_AFFIX_PRESET_SCHEME],
  )
}

function readNumber(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function readInt(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.trunc(num) : fallback
}

/**
 * 找出一组排序值里的**第一处重复**（0 基下标）。
 *
 * 用户 2026-09-13 口径：排序值「不允许重复保存」—— 同号会让「谁先谁后」
 * 没有唯一答案（只能拿 ID 兜底），所以写库前必须拦掉。
 * 返回 `{ value, firstIndex, secondIndex }` 或 `null`（无重复）。
 */
export function findDuplicateSortValue(values) {
  const seen = new Map()
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) return { value, firstIndex: seen.get(value), secondIndex: index }
    seen.set(value, index)
  }
  return null
}

/**
 * 写库前闸门：排序值必须唯一。
 *
 * 校验的是**入库后的值**（缺省按列表下标兜底，与下面 INSERT 的取值规则一致），
 * 所以脚本直接灌、或值缺省的情况都算得对。不唯一就整体拒绝，半份都不会写进去。
 */
function assertUniqueSortValues(list, kind, unit) {
  const duplicate = findDuplicateSortValue(list.map((doc, index) => readInt(doc?.sortOrder, index)))
  if (!duplicate) return
  throw new Error(
    `${kind}排序值重复：第 ${duplicate.firstIndex + 1} ${unit}与第 ${duplicate.secondIndex + 1} ${unit}` +
      `同为 ${duplicate.value}（同一套方案里排序值必须唯一）`,
  )
}

function parseRawJson(raw) {
  if (raw == null) return null
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return null
  }
}

function effectJsonForDoc(doc) {
  const parsed = parseAffixEffectTemplate(doc?.effectJson ?? doc?.effectTemplate)
  if (parsed) return parsed
  return buildAffixEffectTemplate(doc)
}

function rowToEntry(row) {
  const raw = parseRawJson(row.raw_json)
  const effectJson =
    parseAffixEffectTemplate(parseRawJson(row.effect_json)) ??
    parseAffixEffectTemplate(raw?.effectJson) ??
    parseAffixEffectTemplate(raw?.effectTemplate)
  const specCond = effectJson?.allocation === 'effect' ? effectJson.spec?.conditions ?? {} : {}
  const skillFromSpec = Array.isArray(specCond.skillTargets) ? specCond.skillTargets[0] : undefined
  return {
    id: String(row.id),
    label: String(row.label ?? ''),
    target: String(row.target ?? ''),
    perRoll: Number(row.per_roll) || 0,
    cap: readInt(row.cap, 0),
    group: String(row.group_name ?? ''),
    rollCost: readInt(row.roll_cost, 1),
    enabledByDefault: Boolean(Number(row.enabled_by_default)),
    sortOrder: readInt(row.sort_order, 0),
    applySituation:
      typeof raw?.applySituation === 'string' ? raw.applySituation : specCond.applySituation,
    scope: typeof raw?.scope === 'string' ? raw.scope : specCond.scope,
    skillCategory:
      typeof raw?.skillCategory === 'string'
        ? raw.skillCategory
        : typeof skillFromSpec?.category === 'string'
          ? skillFromSpec.category
          : undefined,
    skillSubcategoryId:
      raw?.skillSubcategoryId === null || typeof raw?.skillSubcategoryId === 'string'
        ? raw.skillSubcategoryId
        : skillFromSpec && 'subcategoryId' in skillFromSpec
          ? skillFromSpec.subcategoryId
          : undefined,
    appliesToAnomaly:
      typeof raw?.appliesToAnomaly === 'boolean' ? raw.appliesToAnomaly : specCond.appliesToAnomaly,
    effectJson: effectJson ?? null,
    raw: raw && typeof raw === 'object' ? raw : null,
  }
}

function rowToGroup(row) {
  const raw = parseRawJson(row.raw_json)
  return {
    name: String(row.name ?? ''),
    cap: readInt(row.cap, 0),
    sortOrder: readInt(row.sort_order, 0),
    raw: raw && typeof raw === 'object' ? raw : null,
  }
}

/**
 * 方案名归一：空值 → **当前默认方案的真实名字**。
 *
 * 为什么不是写死 `'默认'`（用户 2026-09-13「方案允许重命名」）：
 * 默认方案也能改名，写死字面量会让用户侧那条路（不带 `scheme` 的读）
 * 在改名后查一个不存在的名字、取到空。改成按 `is_default` 查名，
 * 改名对用户侧就完全无感；表里查不到默认行时（全新库）才回落常量。
 */
async function resolveSchemeName(name) {
  const trimmed = String(name ?? '').trim()
  if (trimmed) return trimmed
  const [rows] = await pool.query(
    `SELECT name FROM ${SCHEME_TABLE} WHERE is_default = 1 ORDER BY name ASC LIMIT 1`,
  )
  return rows.length ? String(rows[0].name) : DEFAULT_AFFIX_PRESET_SCHEME
}

/** 全部方案（默认的排最前），带条目数 —— 管理页的 chip 与「复制自哪套」都用它 */
export async function listAffixSchemes() {
  await ensureTables()
  const [rows] = await pool.query(
    `SELECT s.name, s.is_default, s.sort_order,
            (SELECT COUNT(*) FROM ${ENTRY_TABLE} e WHERE e.scheme = s.name) AS entry_count
       FROM ${SCHEME_TABLE} s
      ORDER BY s.is_default DESC, s.sort_order ASC, s.name ASC`,
  )
  return rows.map((row) => ({
    name: String(row.name),
    isDefault: Boolean(Number(row.is_default)),
    sortOrder: readInt(row.sort_order, 0),
    entryCount: readInt(row.entry_count, 0),
  }))
}

/**
 * 某套方案的全量内容（条目 + 分组），按分组与排序号返回。
 *
 * 不带 `scheme` 时返回默认方案 —— 用户侧 `fetchAffixPreset()` 就是这个调用。
 */
export async function listAffixPreset(schemeName) {
  await ensureTables()
  const scheme = await resolveSchemeName(schemeName)
  const [entryRows] = await pool.query(
    `SELECT * FROM ${ENTRY_TABLE} WHERE scheme = ? ORDER BY sort_order ASC, id ASC`,
    [scheme],
  )
  const [groupRows] = await pool.query(
    `SELECT * FROM ${GROUP_TABLE} WHERE scheme = ? ORDER BY sort_order ASC, name ASC`,
    [scheme],
  )
  return {
    scheme,
    entries: entryRows.map(rowToEntry),
    groups: groupRows.map(rowToGroup),
  }
}

/**
 * 整份替换**一套方案**的内容（管理端「保存」用）。
 *
 * 语义是**覆盖**：这套方案现有的条目与分组全部清掉，换成传入的那份；
 * 其他方案不受影响。用事务保证「清空 + 写入」要么都成、要么都不成 ——
 * 中途失败留下半份数据会让前端拿到残缺预设，比整体失败更难排查。
 */
export async function replaceAffixPreset({ scheme, entries, groups }) {
  const entryList = Array.isArray(entries) ? entries : []
  const groupList = Array.isArray(groups) ? groups : []

  // 排序值唯一性（用户 2026-09-13「不允许重复保存」）：闸门放在写库之前，
  // 不经过控制器的调用方（脚本直接调 service）同样挡得住。
  assertUniqueSortValues(entryList, '条目', '条')
  assertUniqueSortValues(groupList, '分组', '个分组')

  await ensureTables()
  const schemeName = await resolveSchemeName(scheme)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 方案登记行兜底：调用方给的方案名若还没登记（例如脚本直接灌），这里补上
    const [registered] = await conn.query(
      `SELECT name FROM ${SCHEME_TABLE} WHERE name = ? LIMIT 1`,
      [schemeName],
    )
    if (!registered.length) {
      const [maxRow] = await conn.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM ${SCHEME_TABLE}`,
      )
      await conn.query(
        `INSERT INTO ${SCHEME_TABLE} (name, is_default, sort_order) VALUES (?, 0, ?)`,
        [schemeName, readInt(maxRow[0]?.next_order, 0)],
      )
    }
    await conn.query(`DELETE FROM ${ENTRY_TABLE} WHERE scheme = ?`, [schemeName])
    await conn.query(`DELETE FROM ${GROUP_TABLE} WHERE scheme = ?`, [schemeName])
    for (const [index, doc] of entryList.entries()) {
      const effectJson = effectJsonForDoc(doc)
      const raw = doc.raw && typeof doc.raw === 'object' ? { ...doc.raw, ...doc, effectJson } : { ...doc, effectJson }
      delete raw.raw
      await conn.query(
        `INSERT INTO ${ENTRY_TABLE}
          (scheme, id, label, target, per_roll, cap, group_name, roll_cost, enabled_by_default, sort_order, raw_json, effect_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          schemeName,
          String(doc.id ?? '').trim(),
          String(doc.label ?? '').trim(),
          String(doc.target ?? '').trim(),
          readNumber(doc.perRoll, 0),
          Math.max(0, readInt(doc.cap, 0)),
          String(doc.group ?? '').trim(),
          Math.max(0, readInt(doc.rollCost, 1)),
          doc.enabledByDefault ? 1 : 0,
          readInt(doc.sortOrder, index),
          JSON.stringify(raw),
          effectJson ? JSON.stringify(effectJson) : null,
        ],
      )
    }
    for (const [index, doc] of groupList.entries()) {
      const raw = doc.raw && typeof doc.raw === 'object' ? doc.raw : doc
      await conn.query(
        `INSERT INTO ${GROUP_TABLE} (scheme, name, cap, sort_order, raw_json) VALUES (?, ?, ?, ?, ?)`,
        [
          schemeName,
          String(doc.name ?? '').trim(),
          Math.max(0, readInt(doc.cap, 0)),
          readInt(doc.sortOrder, index),
          JSON.stringify(raw),
        ],
      )
    }
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
  return listAffixPreset(schemeName)
}

/**
 * 新建一套方案。
 *
 * `copyFrom` 给了就整份复制那套方案的条目与分组（用 `INSERT … SELECT`，一次一条 SQL），
 * 不给就是空方案（一套方案可以从零搭）。**新方案永远不是默认方案** ——
 * 默认方案决定用户侧拿到哪一份，不能因为新建就被顶掉。
 */
export async function createAffixPresetScheme({ name, copyFrom }) {
  await ensureTables()
  const schemeName = String(name ?? '').trim()
  if (!schemeName) throw new Error('方案名为必填项')
  if (schemeName.length > 64) throw new Error('方案名过长（≤64）')

  const [duplicated] = await pool.query(
    `SELECT name FROM ${SCHEME_TABLE} WHERE name = ? LIMIT 1`,
    [schemeName],
  )
  if (duplicated.length) throw new Error(`已有同名方案「${schemeName}」`)

  const sourceName = copyFrom ? String(copyFrom).trim() : ''
  if (sourceName) {
    const [source] = await pool.query(
      `SELECT name FROM ${SCHEME_TABLE} WHERE name = ? LIMIT 1`,
      [sourceName],
    )
    if (!source.length) throw new Error(`要复制的方案「${sourceName}」不存在`)
  }

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [maxRow] = await conn.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM ${SCHEME_TABLE}`,
    )
    await conn.query(`INSERT INTO ${SCHEME_TABLE} (name, is_default, sort_order) VALUES (?, 0, ?)`, [
      schemeName,
      readInt(maxRow[0]?.next_order, 0),
    ])
    if (sourceName) {
      await conn.query(
        `INSERT INTO ${ENTRY_TABLE}
          (scheme, id, label, target, per_roll, cap, group_name, roll_cost, enabled_by_default, sort_order, raw_json, effect_json)
         SELECT ?, id, label, target, per_roll, cap, group_name, roll_cost, enabled_by_default, sort_order, raw_json, effect_json
           FROM ${ENTRY_TABLE} WHERE scheme = ?`,
        [schemeName, sourceName],
      )
      await conn.query(
        `INSERT INTO ${GROUP_TABLE} (scheme, name, cap, sort_order, raw_json)
         SELECT ?, name, cap, sort_order, raw_json FROM ${GROUP_TABLE} WHERE scheme = ?`,
        [schemeName, sourceName],
      )
    }
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  const [counts] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM ${ENTRY_TABLE} WHERE scheme = ?) AS entry_count,
       (SELECT COUNT(*) FROM ${GROUP_TABLE} WHERE scheme = ?) AS group_count`,
    [schemeName, schemeName],
  )
  return {
    name: schemeName,
    copiedFrom: sourceName || null,
    entryCount: readInt(counts[0]?.entry_count, 0),
    groupCount: readInt(counts[0]?.group_count, 0),
  }
}

/**
 * 给一套方案改名（用户 2026-09-13「方案允许重命名」）。
 *
 * 方案名是**三张表的外键**（方案登记行 + 条目表 `scheme` 列 + 分组表 `scheme` 列），
 * 所以改名必须一次事务把三处都改掉 —— 漏一处就会留下一套「孤儿」内容。
 * `is_default` / `sort_order` / `raw_json` 一律不动：改名只换标签，不换身份。
 *
 * **默认方案也能改名**：用户侧那条路（不带 `scheme` 的读）按 `is_default` 查名
 * （见 `resolveSchemeName`），所以改名对用户侧无感；删默认才是不允许的。
 */
export async function renameAffixPresetScheme(name, newName) {
  await ensureTables()
  const from = String(name ?? '').trim()
  const to = String(newName ?? '').trim()
  if (!from) throw new Error('缺少方案名')
  if (!to) throw new Error('新方案名为必填项')
  if (to.length > 64) throw new Error('方案名过长（≤64）')
  if (to === from) throw new Error('新方案名与原方案名相同，没有需要改的')

  const [rows] = await pool.query(
    `SELECT name, is_default FROM ${SCHEME_TABLE} WHERE name = ? LIMIT 1`,
    [from],
  )
  if (!rows.length) throw new Error('方案不存在')
  const [duplicated] = await pool.query(
    `SELECT name FROM ${SCHEME_TABLE} WHERE name = ? LIMIT 1`,
    [to],
  )
  if (duplicated.length) throw new Error(`已有同名方案「${to}」`)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(`UPDATE ${SCHEME_TABLE} SET name = ? WHERE name = ?`, [to, from])
    await conn.query(`UPDATE ${ENTRY_TABLE} SET scheme = ? WHERE scheme = ?`, [to, from])
    await conn.query(`UPDATE ${GROUP_TABLE} SET scheme = ? WHERE scheme = ?`, [to, from])
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
  return {
    name: to,
    renamedFrom: from,
    isDefault: Boolean(Number(rows[0].is_default)),
  }
}

/**
 * 删掉一套方案（连同它的条目与分组）。
 *
 * **默认方案不许删**：用户侧不带参数拿的就是它，删了等于把用户侧的预设抽掉。
 * `replaceAffixPreset` 会给未知方案名补登记行，所以删除必须是一次事务，别留下半套。
 */
export async function deleteAffixPresetScheme(name) {
  await ensureTables()
  const schemeName = String(name ?? '').trim()
  if (!schemeName) throw new Error('缺少方案名')

  const [rows] = await pool.query(
    `SELECT name, is_default FROM ${SCHEME_TABLE} WHERE name = ? LIMIT 1`,
    [schemeName],
  )
  if (!rows.length) throw new Error('方案不存在')
  if (Number(rows[0].is_default)) throw new Error('默认方案不能删除')

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(`DELETE FROM ${ENTRY_TABLE} WHERE scheme = ?`, [schemeName])
    await conn.query(`DELETE FROM ${GROUP_TABLE} WHERE scheme = ?`, [schemeName])
    await conn.query(`DELETE FROM ${SCHEME_TABLE} WHERE name = ?`, [schemeName])
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
  return { name: schemeName, deleted: true }
}
