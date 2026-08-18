/**
 * 从本地 MySQL 导出计算器数据到仓库 JSON 快照（含招式小类、追击规则、伤害事件模式）。
 *
 * Usage:
 *   node scripts/export-calculator-buffs.mjs
 *   node scripts/export-calculator-buffs.mjs --agents-only
 *   node scripts/export-calculator-buffs.mjs --file path/to/output.json
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pool from '../src/config/db.js'
import { listCalculatorBuffs } from '../src/services/calculatorBuffService.js'
import { listDamageEventModes } from '../src/services/damageEventModeService.js'
import { listSkills } from '../src/services/skillLibraryService.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

const agentsOnly = process.argv.includes('--agents-only')
const outPath =
  readArg('--file') || path.join(__dirname, 'data', 'zzz-hp-calculator-buffs.json')

try {
  const data = await listCalculatorBuffs()
  const damageEventModes = await listDamageEventModes()
  const skills = await listSkills()
  let out

  if (agentsOnly && fs.existsSync(outPath)) {
    out = JSON.parse(fs.readFileSync(outPath, 'utf8'))
    out.agents = data.agents
  } else {
    out = {
      agents: data.agents,
      wengines: data.wengines,
      bangboos: data.bangboos,
      driveDiscs: data.driveDiscs,
      skillSubcategories: data.skillSubcategories ?? [],
      followUpSkillRules: data.followUpSkillRules ?? [],
      damageEventModes,
      skills,
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
  console.log(`已导出 ${out.agents.length} 个角色 → ${outPath}`)
  if (!agentsOnly) {
    console.log(
      `音擎 ${out.wengines.length} · 邦布 ${out.bangboos.length} · 驱动盘 ${out.driveDiscs.length}`,
    )
    console.log(
      `招式小类 ${out.skillSubcategories.length} · 追击规则 ${out.followUpSkillRules.length} · 伤害事件模式 ${out.damageEventModes.length} · 招式 ${out.skills?.length ?? 0}`,
    )
  }
} finally {
  await pool.end()
}
