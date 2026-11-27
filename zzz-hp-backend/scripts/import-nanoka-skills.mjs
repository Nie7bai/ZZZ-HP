/**
 * 从 nanoka 角色页静态 JSON 导入招式伤害倍率到 calculator_skills（策略 B）。
 *
 * 倍率换算（技能等级 L，默认 12）：
 *   baseMult = (damage_percentage + damage_percentage_growth * (L - 1)) / 100
 * 例：克拉蕾「锻星·一段」L12：
 *   (10770 + 980 * 11) / 100 = 215.5
 *
 * 策略 B（现行）：匹配则只更新倍率相关（multSource / damagePercentage / growth / L12 baseMult）；
 * 保留已有 skillTypes / element / buffAnchorId / note 等。缺失则新建（含 types/element/anchor）。
 * 只导入「伤害倍率」段（跳过失衡）。同名段去重（保留首条）。
 *
 * Usage:
 *   node scripts/import-nanoka-skills.mjs --agent claret
 *   node scripts/import-nanoka-skills.mjs --agent claret --write
 *   node scripts/import-nanoka-skills.mjs --all
 *   node scripts/import-nanoka-skills.mjs --all --write
 *   node scripts/import-nanoka-skills.mjs --all --level 12 --write
 *
 * 默认 dry-run；显式 --write 才写入 MySQL。
 * 回滚：用 scripts/data/backups/ 下备份跑 import-calculator-buffs.mjs。
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pool from '../src/config/db.js'
import {
  fetchCharacterDetail,
  fetchCharacterIndex,
  findCharacterIndexEntry,
  resolveNanokaCharacterBuildTag,
} from '../src/services/nanoka/nanokaCharacterClient.js'
import { listSkills, upsertSkill } from '../src/services/skillLibraryService.js'
import { listSkillSubcategories } from '../src/services/skillSubcategoryService.js'
import {
  extractDamageSegments as extractDamageSegmentsFromMapper,
  normalizeSkillName,
  reserveNanokaSkillId,
  resolveBuffAnchorId,
  stableSkillId,
} from '../src/services/nanoka/nanokaSkillMapper.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 可选硬编码覆盖（自动匹配失败或需钉死 nanokaId 时用） */
const AGENT_NANOKA_LOOKUP = {
  claret: { code: 'Claret', zh: '克拉蕾', nanokaId: '1611' },
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

/**
 * 技能等级 L 时的伤害倍率%（本库 baseMult）。
 * nanoka 存万分比整数：3120 → 31.20% at L1；每级 +growth。
 */
export function computeBaseMultPercent(damagePercentage, growth, level = 12) {
  const base = Number(damagePercentage) || 0
  const g = Number(growth) || 0
  const lv = Math.max(1, Number(level) || 12)
  const raw = (base + g * (lv - 1)) / 100
  return Math.round(raw * 1000) / 1000
}

/**
 * 从角色详情拆出倍率候选段（含异常类：异放 / 耀变 / 紊乱 / 乱流）。
 *
 * 口径与 `src/services/nanoka/nanokaSkillMapper.js` 的 `extractDamageSegments` 同源，
 * 这里只做转出，避免 CLI 与管理端两套解析各改一半。
 */
export function extractDamageSegments(detail, { level = 12 } = {}) {
  return extractDamageSegmentsFromMapper(detail, { level })
}

/** 去掉本库备注括号，便于对 nanoka 中文名 */
function stripAgentNameNoise(name) {
  return String(name ?? '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .trim()
}

function sameSkillTypes(a, b) {
  const left = [...(a ?? [])].map(String).sort()
  const right = [...(b ?? [])].map(String).sort()
  if (left.length !== right.length) return false
  return left.every((v, i) => v === right[i])
}

function sameOptionalNumber(a, b, eps = 1e-6) {
  const left = a == null || a === '' ? null : Number(a)
  const right = b == null || b === '' ? null : Number(b)
  if (left == null && right == null) return true
  if (left == null || right == null) return false
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false
  return Math.abs(left - right) < eps
}

async function loadAgentRows(agentIdFilter = null) {
  if (agentIdFilter) {
    const [rows] = await pool.query(
      'SELECT id, name, element FROM `character` WHERE id = ? LIMIT 1',
      [agentIdFilter],
    )
    return rows
  }
  const [rows] = await pool.query('SELECT id, name, element FROM `character` ORDER BY name ASC, id ASC')
  return rows
}

/**
 * @param {{ id: string, name: string }} agent
 * @param {Record<string, any>} index nanoka character.json
 */
function resolveNanokaId(agent, index) {
  const override = AGENT_NANOKA_LOOKUP[agent.id]
  if (override?.nanokaId) {
    return { nanokaId: String(override.nanokaId), via: 'hardcoded', meta: override }
  }
  const candidates = [
    override ? { code: override.code, zh: override.zh } : null,
    { zh: agent.name },
    { zh: stripAgentNameNoise(agent.name) },
    { code: agent.id },
  ].filter(Boolean)

  for (const c of candidates) {
    const hit = findCharacterIndexEntry(index, c)
    if (hit) return { nanokaId: hit.id, via: 'index', meta: hit }
  }
  return null
}

function planAgentImport({
  agentId,
  agentElement,
  segments,
  existingSkills,
  subcategories,
}) {
  const agentSkills = existingSkills.filter((s) => String(s.agentId ?? '') === agentId)
  const usedIds = new Set(existingSkills.map((skill) => String(skill.id)))

  const report = {
    create: [],
    overwrite: [],
    skipSame: [],
    existingManual: [],
    unmatchedLocal: [],
  }
  const planned = []
  const matchedIds = new Set()

  const byTypeAndName = new Map()
  const byTypeAndAnchor = new Map()
  for (const skill of agentSkills) {
    const type = String(skill.damageType ?? 'direct')
    const nameKey = `${type}|${normalizeSkillName(skill.name)}`
    if (!byTypeAndName.has(nameKey)) byTypeAndName.set(nameKey, skill)
    const anchor = String(skill.buffAnchorId ?? '')
    if (anchor) {
      const anchorKey = `${type}|${anchor}`
      if (!byTypeAndAnchor.has(anchorKey)) byTypeAndAnchor.set(anchorKey, skill)
    }
  }

  for (const seg of segments) {
    const type = seg.damageType ?? 'direct'
    const norm = normalizeSkillName(seg.displayName)
    const resolvedAnchor = resolveBuffAnchorId(subcategories, agentId, seg)
    let existing = byTypeAndName.get(`${type}|${norm}`)
    if (!existing && type !== 'direct' && resolvedAnchor) {
      existing = byTypeAndAnchor.get(`${type}|${resolvedAnchor}`)
    }
    const buffAnchorId = resolvedAnchor ?? existing?.buffAnchorId ?? null
    const id = existing?.id ?? reserveNanokaSkillId(stableSkillId(agentId, seg.nanokaSkillId, seg.paramName), usedIds)
    if (existing) matchedIds.add(existing.id)
    const skillTypes = seg.skillTypes
    const element = agentElement
    const multFields = {
      multSource: 'nanoka',
      damagePercentage: seg.damagePercentage,
      damagePercentageGrowth: seg.damagePercentageGrowth,
      baseMult: seg.baseMult,
    }

    if (existing) {
      // 人工建/手工调过的异常类招式不覆盖（固定值 + 等级转模那类手工建模）
      if (type !== 'direct' && String(existing.multSource ?? '') !== 'nanoka') {
        report.existingManual.push({
          id,
          name: existing.name,
          damageType: type,
          localBaseMult: existing.baseMult,
          importedBaseMult: seg.baseMult,
        })
        continue
      }
      const sameMult = sameOptionalNumber(existing.baseMult, seg.baseMult)
      const samePercentage = sameOptionalNumber(existing.damagePercentage, seg.damagePercentage)
      const sameGrowth = sameOptionalNumber(
        existing.damagePercentageGrowth,
        seg.damagePercentageGrowth,
      )
      const sameSource = String(existing.multSource ?? '') === 'nanoka'
      if (sameMult && samePercentage && sameGrowth && sameSource) {
        report.skipSame.push({ id, name: existing.name, baseMult: existing.baseMult })
      } else {
        report.overwrite.push({
          id,
          name: existing.name,
          from: existing.baseMult,
          to: seg.baseMult,
          skillTypes: existing.skillTypes,
          element: existing.element,
          buffAnchorId: existing.buffAnchorId,
          changed: {
            baseMult: !sameMult,
            damagePercentage: !samePercentage,
            damagePercentageGrowth: !sameGrowth,
            multSource: !sameSource,
          },
        })
        // 重导入只更新倍率相关，保留 types/element/anchor/note/settlement 等
        planned.push({
          action: 'overwrite',
          doc: {
            ...existing,
            ...multFields,
          },
        })
      }
    } else {
      const doc = {
        id,
        agentId,
        name: seg.displayName,
        damageType: type,
        skillTypes,
        buffAnchorId,
        ...multFields,
        baseMultFactor: 100,
        settlementMult: 0,
        element,
      }
      if (seg.talentKey) doc.radianceTalentKey = seg.talentKey
      report.create.push({
        id,
        name: seg.displayName,
        damageType: type,
        baseMult: seg.baseMult,
        skillTypes,
        buffAnchorId,
        element,
      })
      planned.push({ action: 'create', doc })
    }
  }

  for (const skill of agentSkills) {
    if (!matchedIds.has(skill.id)) {
      report.unmatchedLocal.push({
        id: skill.id,
        name: skill.name,
        baseMult: skill.baseMult,
      })
    }
  }

  return { report, planned }
}

export { planAgentImport, sameSkillTypes, sameOptionalNumber }

function printDetailReport(report, { verbose }) {
  const printRows = (title, rows, fmt) => {
    console.log(`\n=== ${title} (${rows.length}) ===`)
    const limit = verbose ? 40 : 8
    for (const row of rows.slice(0, limit)) console.log(fmt(row))
    if (rows.length > limit) console.log(`  … 另有 ${rows.length - limit} 条`)
  }

  printRows(
    '新建',
    report.create,
    (r) =>
      `  + ${r.name}  damageType=${r.damageType || 'direct'}  baseMult=${r.baseMult}  types=${(r.skillTypes || []).join('+')}  el=${r.element || '-'}  anchor=${r.buffAnchorId || '-'}  id=${r.id}`,
  )
  printRows(
    '覆盖',
    report.overwrite,
    (r) =>
      `  ~ ${r.name}  ${r.from} → ${r.to}  types=${(r.skillTypes || []).join('+')}  el=${r.element || '-'}  anchor=${r.buffAnchorId || '-'}  changed=${Object.entries(r.changed || {})
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(',') || 'none'}  id=${r.id}`,
  )
  printRows('跳过(同值)', report.skipSame, (r) => `  = ${r.name}  ${r.baseMult}`)
  printRows(
    '跳过(人工异常招式，未覆盖)',
    report.existingManual,
    (r) =>
      `  = ${r.name}  damageType=${r.damageType}  本库=${r.localBaseMult}  nanoka=${r.importedBaseMult}  id=${r.id}`,
  )
  printRows(
    '本库未匹配残留(不删)',
    report.unmatchedLocal,
    (r) => `  ! ${r.name}  baseMult=${r.baseMult}  id=${r.id}`,
  )
}

async function backupCalculatorBuffsJson() {
  const src = path.join(__dirname, 'data', 'zzz-hp-calculator-buffs.json')
  const backupDir = path.join(__dirname, 'data', 'backups')
  fs.mkdirSync(backupDir, { recursive: true })
  const local = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const localStamp = `${local.getFullYear()}${pad(local.getMonth() + 1)}${pad(local.getDate())}-${pad(local.getHours())}${pad(local.getMinutes())}${pad(local.getSeconds())}`
  const dest = path.join(backupDir, `zzz-hp-calculator-buffs.${localStamp}.json`)
  fs.copyFileSync(src, dest)
  return dest
}

async function main() {
  const level = Number(readArg('--level') || 12)
  const doWrite = hasFlag('--write')
  const dryRun = !doWrite
  const allAgents = hasFlag('--all')
  const agentFilter = allAgents ? null : (readArg('--agent') || '').trim() || null
  const verbose = hasFlag('--verbose') || Boolean(agentFilter)

  if (!allAgents && !agentFilter) {
    console.error('请指定 --agent <id> 或 --all')
    process.exit(1)
  }

  console.log(
    `mode=${dryRun ? 'dry-run' : 'WRITE'} level=${level} scope=${allAgents ? 'ALL' : agentFilter}`,
  )

  const buildTag = await resolveNanokaCharacterBuildTag()
  console.log(`nanoka build=${buildTag}`)

  const index = await fetchCharacterIndex(buildTag)
  const agents = await loadAgentRows(agentFilter)
  if (!agents.length) {
    console.error(agentFilter ? `本库无角色：${agentFilter}` : '本库无角色')
    process.exit(1)
  }

  const [existingSkills, subcategories] = await Promise.all([
    listSkills(),
    listSkillSubcategories(),
  ])

  if (doWrite && allAgents) {
    const backupPath = await backupCalculatorBuffsJson()
    console.log(`已备份种子 JSON → ${backupPath}`)
  }

  const totals = {
    agents: 0,
    unresolved: [],
    create: 0,
    overwrite: 0,
    skipSame: 0,
    unmatchedLocal: 0,
    segments: 0,
    written: 0,
  }
  const allPlanned = []

  for (const agent of agents) {
    const resolved = resolveNanokaId(agent, index)
    if (!resolved) {
      totals.unresolved.push({ id: agent.id, name: agent.name })
      console.log(`\n## ${agent.name} (${agent.id})  ✗ nanoka 未匹配`)
      continue
    }

    const detail = await fetchCharacterDetail(buildTag, resolved.nanokaId, 'zh')
    const segments = extractDamageSegments(detail, { level })
    const agentElement = String(agent.element ?? '').trim()
    const { report, planned } = planAgentImport({
      agentId: agent.id,
      agentElement,
      segments,
      existingSkills,
      subcategories,
    })

    totals.agents += 1
    totals.segments += segments.length
    totals.create += report.create.length
    totals.overwrite += report.overwrite.length
    totals.skipSame += report.skipSame.length
    totals.unmatchedLocal += report.unmatchedLocal.length
    allPlanned.push(...planned)

    const line = `## ${agent.name} (${agent.id})  nanoka=${resolved.nanokaId}/${detail?.code_name || '?'}  segs=${segments.length}  +${report.create.length} ~${report.overwrite.length} =${report.skipSame.length} !${report.unmatchedLocal.length}  el=${agentElement || '-'}`
    console.log(`\n${line}`)
    if (verbose) printDetailReport(report, { verbose: true })
  }

  console.log('\n========== 汇总 ==========')
  console.log(
    `角色 ${totals.agents}/${agents.length} · 段 ${totals.segments} · 新建 ${totals.create} · 覆盖 ${totals.overwrite} · 跳过 ${totals.skipSame} · 残留 ${totals.unmatchedLocal}`,
  )
  if (totals.unresolved.length) {
    console.log('未匹配 nanoka：')
    for (const u of totals.unresolved) console.log(`  - ${u.name} (${u.id})`)
  }

  if (dryRun) {
    console.log('\n[dry-run] 未写入。加 --write 才落库。')
    return
  }

  for (const item of allPlanned) {
    await upsertSkill(item.doc)
    totals.written += 1
  }
  console.log(
    `\n已写入 ${totals.written} 条（新建 ${totals.create} · 覆盖 ${totals.overwrite}）`,
  )
}

const isDirectRun = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('import-nanoka-skills.mjs')

if (isDirectRun) {
  try {
    await main()
  } catch (err) {
    console.error(err)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
