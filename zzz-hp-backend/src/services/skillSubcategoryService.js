import pool from '../config/db.js'

const TABLE = '`calculator_skill_subcategories`'
const FOLLOW_UP_TABLE = '`calculator_follow_up_rules`'

let ensured = false

async function ensureTable() {
  if (ensured) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS calculator_skill_subcategories (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      agent_id VARCHAR(64) NOT NULL DEFAULT '',
      category_id VARCHAR(32) NOT NULL,
      name VARCHAR(128) NOT NULL,
      counts_as_follow_up TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  try {
    await pool.query(
      `ALTER TABLE calculator_skill_subcategories ADD COLUMN agent_id VARCHAR(64) NOT NULL DEFAULT '' AFTER id`,
    )
  } catch {
    // column may already exist
  }
  try {
    await pool.query(
      `ALTER TABLE calculator_skill_subcategories ADD COLUMN counts_as_follow_up TINYINT(1) NOT NULL DEFAULT 0 AFTER name`,
    )
  } catch {
    // column may already exist
  }
  const multColumns = [
    ['direct_dmg_mult', 'DOUBLE NOT NULL DEFAULT 100'],
    ['settlement_dmg_mult', 'DOUBLE NOT NULL DEFAULT 0'],
    ['anomaly_release_mult', 'DOUBLE NOT NULL DEFAULT 0'],
    ['disorder_mult', 'DOUBLE NOT NULL DEFAULT 0'],
    ['direct_dmg_mult_factor', 'DOUBLE NOT NULL DEFAULT 1'],
    ['anomaly_release_mult_factor', 'DOUBLE NOT NULL DEFAULT 1'],
    ['disorder_mult_factor', 'DOUBLE NOT NULL DEFAULT 1'],
  ]
  for (const [col, def] of multColumns) {
    try {
      await pool.query(
        `ALTER TABLE calculator_skill_subcategories ADD COLUMN ${col} ${def}`,
      )
    } catch {
      // column may already exist
    }
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS calculator_follow_up_rules (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      agent_id VARCHAR(64) NOT NULL DEFAULT '',
      category_id VARCHAR(32) NOT NULL,
      subcategory_id VARCHAR(64) NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  ensured = true
}

function readNumber(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function rowToDoc(row) {
  return {
    id: String(row.id),
    agentId: String(row.agent_id ?? ''),
    categoryId: String(row.category_id),
    name: String(row.name ?? ''),
    countsAsFollowUp: Boolean(row.counts_as_follow_up),
    directDmgMult: readNumber(row.direct_dmg_mult, 100),
    settlementDmgMult: readNumber(row.settlement_dmg_mult, 0),
    anomalyReleaseMult: readNumber(row.anomaly_release_mult, 0),
    disorderMult: readNumber(row.disorder_mult, 0),
    directDmgMultFactor: readNumber(row.direct_dmg_mult_factor, 1),
    anomalyReleaseMultFactor: readNumber(row.anomaly_release_mult_factor, 1),
    disorderMultFactor: readNumber(row.disorder_mult_factor, 1),
  }
}

function rowToFollowUpRule(row) {
  return {
    id: String(row.id),
    agentId: String(row.agent_id ?? ''),
    categoryId: String(row.category_id),
    subcategoryId:
      row.subcategory_id == null || row.subcategory_id === ''
        ? null
        : String(row.subcategory_id),
  }
}

export async function listSkillSubcategories() {
  await ensureTable()
  const [rows] = await pool.query(
    `SELECT * FROM ${TABLE} ORDER BY agent_id ASC, category_id ASC, name ASC, id ASC`,
  )
  return rows.map(rowToDoc)
}

export async function listFollowUpSkillRules() {
  await ensureTable()
  const [rows] = await pool.query(
    `SELECT * FROM ${FOLLOW_UP_TABLE} ORDER BY agent_id ASC, category_id ASC, id ASC`,
  )
  return rows.map(rowToFollowUpRule)
}

export async function upsertSkillSubcategory(doc) {
  await ensureTable()
  let id = String(doc.id ?? '').trim()
  const agentId = String(doc.agentId ?? '').trim()
  const categoryId = String(doc.categoryId ?? '').trim()
  const name = String(doc.name ?? '').trim()
  const countsAsFollowUp = Boolean(doc.countsAsFollowUp)
  const directDmgMult = readNumber(doc.directDmgMult, 100)
  const settlementDmgMult = readNumber(doc.settlementDmgMult, 0)
  const anomalyReleaseMult = readNumber(doc.anomalyReleaseMult, 0)
  const disorderMult = readNumber(doc.disorderMult, 0)
  const directDmgMultFactor = readNumber(doc.directDmgMultFactor, 1)
  const anomalyReleaseMultFactor = readNumber(doc.anomalyReleaseMultFactor, 1)
  const disorderMultFactor = readNumber(doc.disorderMultFactor, 1)
  if (!categoryId || !name) {
    throw new Error('招式小类大类与名称为必填项')
  }
  if (!id) {
    const stamp = Date.now().toString(36)
    const prefix = agentId || 'all'
    id = `${prefix}-${categoryId}-${stamp}`.slice(0, 64)
  }

  await pool.query(
    `INSERT INTO calculator_skill_subcategories
      (id, agent_id, category_id, name, counts_as_follow_up,
       direct_dmg_mult, settlement_dmg_mult, anomaly_release_mult, disorder_mult,
       direct_dmg_mult_factor, anomaly_release_mult_factor, disorder_mult_factor,
       sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       agent_id = VALUES(agent_id),
       category_id = VALUES(category_id),
       name = VALUES(name),
       counts_as_follow_up = VALUES(counts_as_follow_up),
       direct_dmg_mult = VALUES(direct_dmg_mult),
       settlement_dmg_mult = VALUES(settlement_dmg_mult),
       anomaly_release_mult = VALUES(anomaly_release_mult),
       disorder_mult = VALUES(disorder_mult),
       direct_dmg_mult_factor = VALUES(direct_dmg_mult_factor),
       anomaly_release_mult_factor = VALUES(anomaly_release_mult_factor),
       disorder_mult_factor = VALUES(disorder_mult_factor)`,
    [
      id,
      agentId,
      categoryId,
      name,
      countsAsFollowUp ? 1 : 0,
      directDmgMult,
      settlementDmgMult,
      anomalyReleaseMult,
      disorderMult,
      directDmgMultFactor,
      anomalyReleaseMultFactor,
      disorderMultFactor,
    ],
  )

  const [rows] = await pool.query(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [id])
  return rowToDoc(rows[0])
}

export async function deleteSkillSubcategory(id) {
  await ensureTable()
  const safeId = String(id ?? '').trim()
  if (!safeId) throw new Error('缺少小类 ID')
  await pool.query(`DELETE FROM ${TABLE} WHERE id = ?`, [safeId])
  return { id: safeId }
}

export async function upsertFollowUpSkillRule(doc) {
  await ensureTable()
  let id = String(doc.id ?? '').trim()
  const agentId = String(doc.agentId ?? '').trim()
  const categoryId = String(doc.categoryId ?? '').trim()
  const subcategoryId =
    doc.subcategoryId == null || doc.subcategoryId === ''
      ? null
      : String(doc.subcategoryId).trim()
  if (!categoryId) {
    throw new Error('招式大类为必填项')
  }
  if (!id) {
    const stamp = Date.now().toString(36)
    const prefix = agentId || 'all'
    const sub = subcategoryId || 'whole'
    id = `fu-${prefix}-${categoryId}-${sub}-${stamp}`.slice(0, 64)
  }

  await pool.query(
    `INSERT INTO calculator_follow_up_rules
      (id, agent_id, category_id, subcategory_id)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       agent_id = VALUES(agent_id),
       category_id = VALUES(category_id),
       subcategory_id = VALUES(subcategory_id)`,
    [id, agentId, categoryId, subcategoryId],
  )

  const [rows] = await pool.query(`SELECT * FROM ${FOLLOW_UP_TABLE} WHERE id = ? LIMIT 1`, [id])
  return rowToFollowUpRule(rows[0])
}

export async function deleteFollowUpSkillRule(id) {
  await ensureTable()
  const safeId = String(id ?? '').trim()
  if (!safeId) throw new Error('缺少规则 ID')
  await pool.query(`DELETE FROM ${FOLLOW_UP_TABLE} WHERE id = ?`, [safeId])
  return { id: safeId }
}
