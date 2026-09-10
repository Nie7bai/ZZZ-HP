import pool from '../config/db.js'

const TABLE = '`calculator_skills`'

/** 与前端 `publicAnomalySkills.ts` 保持一致。这 7 条公共属性异常每次启动按表校正倍率/元素。 */
const PUBLIC_ANOMALY_SKILLS = [
  { id: 'sk-public-anomaly-wind', element: '风', name: '风属性异常', baseMult: 1250, sortOrder: 10 },
  { id: 'sk-public-anomaly-fire', element: '火', name: '火属性异常', baseMult: 50, sortOrder: 20 },
  { id: 'sk-public-anomaly-electric', element: '电', name: '电属性异常', baseMult: 125, sortOrder: 30 },
  { id: 'sk-public-anomaly-physical', element: '物理', name: '物理属性异常', baseMult: 713, sortOrder: 40 },
  { id: 'sk-public-anomaly-ether', element: '以太', name: '以太属性异常', baseMult: 62.5, sortOrder: 50 },
  { id: 'sk-public-anomaly-ice', element: '冰', name: '冰属性异常', baseMult: 500, sortOrder: 60 },
  { id: 'sk-public-anomaly-frost', element: '霜', name: '霜属性异常', baseMult: 500, sortOrder: 70 },
]

let ensured = false

async function ensureTable() {
  if (ensured) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS calculator_skills (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      agent_id VARCHAR(64) NOT NULL DEFAULT '',
      name VARCHAR(128) NOT NULL,
      damage_type VARCHAR(32) NOT NULL DEFAULT 'direct',
      skill_types TEXT NULL,
      buff_anchor_id VARCHAR(64) NULL,
      base_mult DOUBLE NOT NULL DEFAULT 0,
      base_mult_factor DOUBLE NOT NULL DEFAULT 100,
      settlement_mult DOUBLE NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      element VARCHAR(16) NOT NULL DEFAULT '',
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  try {
    await pool.query(
      `ALTER TABLE calculator_skills ADD COLUMN element VARCHAR(16) NOT NULL DEFAULT '' AFTER sort_order`,
    )
  } catch {
    // column may already exist
  }
  try {
    await pool.query(
      `ALTER TABLE calculator_skills ADD COLUMN owner_group_id VARCHAR(64) NULL AFTER element`,
    )
  } catch {
    // column may already exist
  }
  try {
    await pool.query(
      `ALTER TABLE calculator_skills ADD COLUMN note VARCHAR(255) NOT NULL DEFAULT '' AFTER owner_group_id`,
    )
  } catch {
    // column may already exist
  }
  try {
    await pool.query(
      `ALTER TABLE calculator_skills ADD COLUMN mult_source VARCHAR(16) NULL AFTER note`,
    )
  } catch {
    // column may already exist
  }
  try {
    await pool.query(
      `ALTER TABLE calculator_skills ADD COLUMN damage_percentage DOUBLE NULL AFTER mult_source`,
    )
  } catch {
    // column may already exist
  }
  try {
    await pool.query(
      `ALTER TABLE calculator_skills ADD COLUMN damage_percentage_growth DOUBLE NULL AFTER damage_percentage`,
    )
  } catch {
    // column may already exist
  }
  await ensurePublicAnomalySkills()
  ensured = true
}

async function ensurePublicAnomalySkills() {
  for (const skill of PUBLIC_ANOMALY_SKILLS) {
    await pool.query(
      `INSERT INTO calculator_skills
        (id, agent_id, name, damage_type, skill_types, buff_anchor_id,
         base_mult, base_mult_factor, settlement_mult, sort_order, element)
       VALUES (?, '', ?, 'anomaly', '[]', NULL, ?, 100, 0, ?, ?)
       ON DUPLICATE KEY UPDATE
         agent_id = '',
         name = VALUES(name),
         damage_type = 'anomaly',
         skill_types = '[]',
         buff_anchor_id = NULL,
         base_mult = VALUES(base_mult),
         element = VALUES(element),
         sort_order = VALUES(sort_order)`,
      [skill.id, skill.name, skill.baseMult, skill.sortOrder, skill.element],
    )
  }
}

function readNumber(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function parseSkillTypes(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
  } catch {
    return []
  }
}

function rowToDoc(row) {
  const multSource = String(row.mult_source ?? '').trim() === 'nanoka' ? 'nanoka' : null
  const damagePercentage =
    row.damage_percentage == null || row.damage_percentage === ''
      ? undefined
      : readNumber(row.damage_percentage, NaN)
  const damagePercentageGrowth =
    row.damage_percentage_growth == null || row.damage_percentage_growth === ''
      ? undefined
      : readNumber(row.damage_percentage_growth, NaN)
  return {
    id: String(row.id),
    agentId: String(row.agent_id ?? ''),
    name: String(row.name ?? ''),
    source: 'preset',
    damageType: String(row.damage_type ?? 'direct'),
    skillTypes: parseSkillTypes(row.skill_types),
    buffAnchorId:
      row.buff_anchor_id == null || row.buff_anchor_id === ''
        ? null
        : String(row.buff_anchor_id),
    baseMult: readNumber(row.base_mult, 0),
    baseMultFactor: readNumber(row.base_mult_factor, 100),
    settlementMult: readNumber(row.settlement_mult, 0),
    multSource,
    ...(Number.isFinite(damagePercentage) ? { damagePercentage } : {}),
    ...(Number.isFinite(damagePercentageGrowth) ? { damagePercentageGrowth } : {}),
    element: String(row.element ?? ''),
    ownerGroupId:
      row.owner_group_id == null || row.owner_group_id === ''
        ? null
        : String(row.owner_group_id),
    note: String(row.note ?? '').trim(),
  }
}

export async function listSkills() {
  await ensureTable()
  const [rows] = await pool.query(
    `SELECT * FROM ${TABLE} ORDER BY agent_id ASC, damage_type ASC, sort_order ASC, name ASC, id ASC`,
  )
  return rows.map(rowToDoc)
}

export async function upsertSkill(doc) {
  await ensureTable()
  let id = String(doc.id ?? '').trim()
  const agentId = String(doc.agentId ?? '').trim()
  const name = String(doc.name ?? '').trim()
  const damageType = String(doc.damageType ?? 'direct').trim()
  const skillTypes = Array.isArray(doc.skillTypes) ? doc.skillTypes.map((i) => String(i)) : []
  const buffAnchorId =
    doc.buffAnchorId == null || doc.buffAnchorId === '' ? null : String(doc.buffAnchorId).trim()
  const baseMult = readNumber(doc.baseMult, 0)
  const baseMultFactor = readNumber(doc.baseMultFactor, 100)
  const settlementMult = readNumber(doc.settlementMult, 0)
  const element = String(doc.element ?? '').trim()
  const ownerGroupId =
    doc.ownerGroupId == null || doc.ownerGroupId === ''
      ? null
      : String(doc.ownerGroupId).trim()
  const note = String(doc.note ?? '').trim()
  const multSource = String(doc.multSource ?? '').trim() === 'nanoka' ? 'nanoka' : null
  const damagePercentage =
    doc.damagePercentage == null || doc.damagePercentage === ''
      ? null
      : readNumber(doc.damagePercentage, NaN)
  const damagePercentageGrowth =
    doc.damagePercentageGrowth == null || doc.damagePercentageGrowth === ''
      ? null
      : readNumber(doc.damagePercentageGrowth, NaN)
  const damagePercentageValue = Number.isFinite(damagePercentage) ? damagePercentage : null
  const damagePercentageGrowthValue = Number.isFinite(damagePercentageGrowth)
    ? damagePercentageGrowth
    : null

  if (!name) throw new Error('招式名称为必填项')
  if (!damageType) throw new Error('伤害类型为必填项')
  if (!id) {
    const stamp = Date.now().toString(36)
    const prefix = agentId || 'all'
    id = `sk-${prefix}-${damageType}-${stamp}`.slice(0, 64)
  }

  await pool.query(
    `INSERT INTO calculator_skills
      (id, agent_id, name, damage_type, skill_types, buff_anchor_id,
       base_mult, base_mult_factor, settlement_mult, sort_order, element, owner_group_id, note,
       mult_source, damage_percentage, damage_percentage_growth)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       agent_id = VALUES(agent_id),
       name = VALUES(name),
       damage_type = VALUES(damage_type),
       skill_types = VALUES(skill_types),
       buff_anchor_id = VALUES(buff_anchor_id),
       base_mult = VALUES(base_mult),
       base_mult_factor = VALUES(base_mult_factor),
       settlement_mult = VALUES(settlement_mult),
       element = VALUES(element),
       owner_group_id = VALUES(owner_group_id),
       note = VALUES(note),
       mult_source = VALUES(mult_source),
       damage_percentage = VALUES(damage_percentage),
       damage_percentage_growth = VALUES(damage_percentage_growth)`,
    [
      id,
      agentId,
      name,
      damageType,
      JSON.stringify(skillTypes),
      buffAnchorId,
      baseMult,
      baseMultFactor,
      settlementMult,
      element,
      ownerGroupId,
      note,
      multSource,
      damagePercentageValue,
      damagePercentageGrowthValue,
    ],
  )

  const [rows] = await pool.query(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [id])
  return rowToDoc(rows[0])
}

export async function deleteSkill(id) {
  await ensureTable()
  const safeId = String(id ?? '').trim()
  if (!safeId) throw new Error('缺少招式 ID')
  await pool.query(`DELETE FROM ${TABLE} WHERE id = ?`, [safeId])
  return { id: safeId }
}
