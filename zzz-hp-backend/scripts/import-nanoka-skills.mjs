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

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 可选硬编码覆盖（自动匹配失败或需钉死 nanokaId 时用） */
const AGENT_NANOKA_LOOKUP = {
  claret: { code: 'Claret', zh: '克拉蕾', nanokaId: '1611' },
}

const NANOKA_CATEGORY_TO_SKILL_TYPES = {
  basic: ['basic'],
  dodge: ['dodge'],
  special: ['special'],
  chain: ['chain'],
  assist: ['assist'],
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

function normalizeSkillName(name) {
  return String(name ?? '')
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[：:]/g, '：')
    .trim()
}

function stripSkillTitlePrefix(skillName) {
  return String(skillName ?? '').replace(
    /^(普通攻击|闪避|冲刺攻击|支援技|特殊技|强化特殊技|连携技|终结技)[:：]/,
    '',
  )
}

/**
 * 「一段伤害倍率」→「一段」；纯「伤害倍率」→ ''。
 */
function shortParamLabel(paramName) {
  const raw = String(paramName ?? '').trim()
  if (raw === '伤害倍率') return ''
  return raw.replace(/伤害倍率$/, '').trim()
}

function buildDisplayName(skillName, paramName) {
  const short = shortParamLabel(paramName)
  if (!short) return skillName
  return `${skillName}·${short}`
}

/**
 * 稳定 id，便于反复导入：sk-{agent}-nk-{nanokaSkillId}-{slug}
 */
function stableSkillId(agentId, nanokaSkillId, paramName) {
  const slug = shortParamLabel(paramName) || 'main'
  const safeSlug = slug
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  const id = `sk-${agentId}-nk-${nanokaSkillId}-${safeSlug || 'main'}`
  return id.slice(0, 64)
}

/**
 * 大类 + 小类一并写入（管理端勾选要看得见）。
 * nanoka 把终结技挂在 chain 下，按名称纠正为 ultimate。
 */
function mapSkillTypes(category, skillName) {
  const name = String(skillName ?? '')
  if (/终结技/.test(name)) return ['ultimate']
  if (/连携技/.test(name)) return ['chain']
  if (/强化特殊技/.test(name) || (category === 'special' && /强化/.test(name))) {
    return ['special', 'specialEnhanced']
  }
  if (category === 'special' || /^特殊技/.test(name)) {
    return ['special', 'specialBasic']
  }
  if (/闪避反击/.test(name) || (category === 'dodge' && /反击/.test(name))) {
    return ['dodge', 'dodgeCounter']
  }
  if (/冲刺攻击/.test(name)) return ['dodge', 'dash']
  if (category === 'basic' || /普通攻击/.test(name)) return ['basic']
  if (category === 'assist') return ['assist']
  if (category === 'dodge') return ['dodge']
  if (category === 'chain') return ['chain']
  return [...(NANOKA_CATEGORY_TO_SKILL_TYPES[category] ?? ['basic'])]
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
 * 从角色详情拆出伤害倍率候选段（同 displayName 去重，保留首条）。
 */
export function extractDamageSegments(detail, { level = 12 } = {}) {
  const skillRoot = detail?.skill ?? {}
  const segments = []
  const seenNorm = new Set()
  for (const [category, block] of Object.entries(skillRoot)) {
    const descriptions = Array.isArray(block?.description) ? block.description : []
    for (const entry of descriptions) {
      const skillName = String(entry?.name ?? '').trim()
      if (!skillName) continue
      const params = Array.isArray(entry?.param) ? entry.param : []
      for (const p of params) {
        const paramName = String(p?.name ?? '').trim()
        if (!paramName.includes('伤害倍率')) continue
        if (paramName.includes('失衡')) continue

        const paramMap = p?.param && typeof p.param === 'object' ? p.param : {}
        const nanokaSkillId = Object.keys(paramMap)[0]
        if (!nanokaSkillId) continue
        const stats = paramMap[nanokaSkillId] ?? {}
        const damagePercentage = Number(stats.damage_percentage ?? stats.main) || 0
        const damagePercentageGrowth = Number(stats.damage_percentage_growth ?? stats.growth) || 0
        const baseMult = computeBaseMultPercent(
          damagePercentage,
          damagePercentageGrowth,
          level,
        )
        const displayName = buildDisplayName(skillName, paramName)
        const norm = normalizeSkillName(displayName)
        if (seenNorm.has(norm)) continue
        seenNorm.add(norm)
        segments.push({
          category,
          skillName,
          paramName,
          nanokaSkillId: String(nanokaSkillId),
          displayName,
          baseMult,
          damagePercentage,
          damagePercentageGrowth,
          skillTypes: mapSkillTypes(category, skillName),
          titleCore: stripSkillTitlePrefix(skillName),
        })
      }
    }
  }
  return segments
}

/** 去掉本库备注括号，便于对 nanoka 中文名 */
function stripAgentNameNoise(name) {
  return String(name ?? '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .trim()
}

function resolveBuffAnchorId(subcategories, agentId, segment) {
  const forAgent = subcategories.filter((s) => String(s.agentId ?? '') === agentId)
  // 优先短参名（如「毁伤伤害倍率」→「毁伤」），再回落到技能标题核心
  const candidates = [
    shortParamLabel(segment.paramName),
    segment.titleCore,
    stripSkillTitlePrefix(segment.displayName),
    segment.skillName,
    segment.displayName,
  ]
    .map(normalizeSkillName)
    .filter(Boolean)
  for (const sub of forAgent) {
    const n = normalizeSkillName(sub.name)
    if (candidates.includes(n)) return sub.id
  }
  return null
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
  const byNormName = new Map()
  for (const skill of agentSkills) {
    byNormName.set(normalizeSkillName(skill.name), skill)
  }

  const report = {
    create: [],
    overwrite: [],
    skipSame: [],
    unmatchedLocal: [],
  }
  const planned = []

  for (const seg of segments) {
    const norm = normalizeSkillName(seg.displayName)
    const existing = byNormName.get(norm)
    const resolvedAnchor = resolveBuffAnchorId(subcategories, agentId, seg)
    const buffAnchorId = resolvedAnchor ?? existing?.buffAnchorId ?? null
    const id = existing?.id ?? stableSkillId(agentId, seg.nanokaSkillId, seg.paramName)
    const skillTypes = seg.skillTypes
    const element = agentElement
    const multFields = {
      multSource: 'nanoka',
      damagePercentage: seg.damagePercentage,
      damagePercentageGrowth: seg.damagePercentageGrowth,
      baseMult: seg.baseMult,
    }

    if (existing) {
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
      report.create.push({
        id,
        name: seg.displayName,
        baseMult: seg.baseMult,
        skillTypes,
        buffAnchorId,
        element,
      })
      planned.push({
        action: 'create',
        doc: {
          id,
          agentId,
          name: seg.displayName,
          damageType: 'direct',
          skillTypes,
          buffAnchorId,
          ...multFields,
          baseMultFactor: 100,
          settlementMult: 0,
          element,
        },
      })
    }
  }

  const matchedNorms = new Set(segments.map((s) => normalizeSkillName(s.displayName)))
  for (const skill of agentSkills) {
    if (!matchedNorms.has(normalizeSkillName(skill.name))) {
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
      `  + ${r.name}  baseMult=${r.baseMult}  types=${(r.skillTypes || []).join('+')}  el=${r.element || '-'}  anchor=${r.buffAnchorId || '-'}  id=${r.id}`,
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
