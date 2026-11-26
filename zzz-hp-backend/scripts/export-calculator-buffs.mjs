/**
 * 从本地 MySQL 导出计算器数据到仓库 JSON 快照
 * （含招式小类、追击规则、伤害事件模式、乘区定义/方案、计算链路）。
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
import { listSkillGroups } from '../src/services/skillGroupService.js'
import { listZoneDefinitions, listZoneSchemes } from '../src/services/calculatorZoneService.js'
import { listDamageChains } from '../src/services/calculatorChainService.js'
import { buildZoneConfigSnapshot } from '../src/utils/calculatorConfigSnapshot.js'

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
  const skillGroups = await listSkillGroups()
  let out

  if (agentsOnly && fs.existsSync(outPath)) {
    out = JSON.parse(fs.readFileSync(outPath, 'utf8'))
    out.agents = data.agents
  } else {
    // 乘区定义 / 方案 / 链路：字段口径见 utils/calculatorConfigSnapshot.js
    // （公共接口字段 + enabled，不带 updatedBy / updatedAt / 自增 id）
    const [zoneDefinitions, zoneSchemes, damageChains] = await Promise.all([
      listZoneDefinitions(),
      listZoneSchemes(),
      listDamageChains(),
    ])
    // 全量导出时保留已合并进文件的预设词条库（affixPresets 键），避免被冲掉
    const existing = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {}
    out = {
      agents: data.agents,
      wengines: data.wengines,
      bangboos: data.bangboos,
      driveDiscs: data.driveDiscs,
      skillSubcategories: data.skillSubcategories ?? [],
      followUpSkillRules: data.followUpSkillRules ?? [],
      damageEventModes,
      skills,
      skillGroups,
      affixPresets: existing.affixPresets,
      ...buildZoneConfigSnapshot({
        definitions: zoneDefinitions,
        schemes: zoneSchemes,
        chains: damageChains,
      }),
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
      `招式小类 ${out.skillSubcategories.length} · 追击规则 ${out.followUpSkillRules.length} · 伤害事件模式 ${out.damageEventModes.length} · 招式 ${out.skills?.length ?? 0} · 技能组 ${out.skillGroups?.length ?? 0}`,
    )
    console.log(
      `乘区定义 ${out.zoneDefinitions.length} · 乘区方案 ${out.zoneSchemes.length} · 计算链路 ${out.damageChains.length}`,
    )
  }
} finally {
  await pool.end()
}
