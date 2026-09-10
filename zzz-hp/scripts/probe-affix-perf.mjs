/**
 * 词条分配性能剖析：用真实方案（丹方案）离线复现，定位单次评估的时间去向。
 *
 * 数据来源：
 * - 增益库：zzz-hp-backend/scripts/data/zzz-hp-calculator-buffs.json
 * - 方案：artifacts/profiles/scheme-dan.json（由用户导出的方案库 JSON，已转 ASCII 文件名）
 *
 * 用法：npx vite-node scripts/probe-affix-perf.mjs
 * 产出：控制台报告 + artifacts/affix-perf-<时间>.cpuprofile
 *
 * 说明：本脚本只做只读的离线复现与计时，不改任何业务状态。
 * 需要更细的函数级计数时，可临时在 panelBuffCalc.ts 里插桩后复用本脚本。
 */
import fs from 'node:fs'
import path from 'node:path'
import inspector from 'node:inspector'

import { resolveFlow } from '../src/utils/resolvedHit.ts'
import {
  buildOptimalEvalContext,
  evaluateAffixCounts,
  evaluateOptimalEventDetail,
  clearAffixEvalCache,
} from '../src/utils/optimalAffixAlloc.ts'
import { computeAffixBenefitTable } from '../src/utils/affixBenefitAnalysis.ts'
import { createEmptyAffixCounts } from '../src/types/calculatorPanel.ts'
import { createDefaultAffixLibrary } from '../src/utils/affixLibrary.ts'

const BUFFS = 'D:/WB_agent_out/applications/ZZZ-HP/zzz-hp-backend/scripts/data/zzz-hp-calculator-buffs.json'
const ARTIFACTS = 'D:/WB_agent_out/ZZZ-HP/artifacts'
/** 用户导出的方案库 JSON（放在工作区 artifacts/profiles 下）；可用 argv[2] 覆盖 */
const SCHEME = process.argv[2] ?? `${ARTIFACTS}/profiles/scheme-dan.json`

const buffs = JSON.parse(fs.readFileSync(BUFFS, 'utf8'))
const schemePack = JSON.parse(fs.readFileSync(SCHEME, 'utf8'))
const scheme = Object.values(schemePack.schemes)[0]

const skillById = new Map(
  [...(buffs.skills ?? []), ...(schemePack.customSkills ?? [])].map((s) => [s.id, s]),
)

// ---------- 1. 解析流程 → hits ----------
const flowResult = resolveFlow({
  slots: scheme.slots,
  teamSlots: scheme.teamSlots.map((s) => ({ agentId: s.agentId })),
  findSkill: (id) => skillById.get(id) ?? null,
  skillSubcategories: buffs.skillSubcategories,
})
const hits = flowResult.hits

console.log('=== 复现结果 ===')
console.log(`  招式数: ${hits.length}`)
console.log(`  缺失招式: ${flowResult.missingSkillIds.length}`)
console.log(`  队伍: ${scheme.teamSlots.map((s) => s.agentId).join(', ')}`)

// ---------- 2. 组装上下文（与组件 evalCtx 同构）----------
const mainSlotIndex = Number(scheme.activeSlot ?? 0)
const mainSlot = scheme.teamSlots[mainSlotIndex]
const agents = buffs.agents
const mainAgent = agents.find((a) => a.id === mainSlot.agentId)

const ctx = buildOptimalEvalContext({
  isMb: mainAgent?.profession === '命破',
  isFengYu: mainAgent?.profession === '锋御',
  teamSlots: scheme.teamSlots,
  agents,
  wengines: buffs.wengines,
  bangboo: {
    id: 'none', name: 'none', avatar_image: null, effects: [],
    refinementEffects: [], fixedMods: {}, refinementMods: {},
  },
  bangbooRefine: 1,
  driveDiscs: buffs.driveDiscs,
  mainSlotIndex,
  driveDiscMainStats: mainSlot.affixDriveDiscMainStats ?? {
    slot4MainStat: 'mastery', slot5MainStat: 'dmgBonus', slot6MainStat: 'energyRegen',
  },
  enemyInput: {
    level: 60, defense: 953, resistanceType: 'normal',
    vulnerableMultiplier: 1, staggerMultiplier: 1.5, specialMultiplier: 1,
  },
  baseDamageSource:
    mainAgent?.profession === '命破' ? 'pierce' : mainAgent?.profession === '锋御' ? 'def' : 'atk',
  buffSelection: null,
  slotBuffSelections: scheme.multiSlotBuffSelection ?? null,
  anomalySlotPanels: scheme.anomalySlotPanels ?? undefined,
  convertSlotPanels: scheme.convertSlotPanels ?? undefined,
  hits,
  resolveSubcategory: (id) => buffs.skillSubcategories.find((x) => x.id === id) ?? null,
  skillSubcategories: buffs.skillSubcategories,
  followUpSkillRules: buffs.followUpSkillRules,
})

console.log(`  主 C: ${ctx.mainAgentId}（${ctx.mainAgentName}）`)

// ---------- 3. 单次评估 ----------
const counts = { ...createEmptyAffixCounts(), atkPercent: 10 }

clearAffixEvalCache()
let t0 = performance.now()
const r0 = evaluateAffixCounts(ctx, counts)
const coldMs = performance.now() - t0

clearAffixEvalCache()
evaluateAffixCounts(ctx, counts)
t0 = performance.now()
evaluateAffixCounts(ctx, { ...createEmptyAffixCounts(), critRate: 10 })
const warmMs = performance.now() - t0

console.log('\n=== 单次评估 ===')
console.log(`  冷（清缓存后）: ${coldMs.toFixed(1)} ms`)
console.log(`  热（同上下文）: ${warmMs.toFixed(1)} ms`)
console.log(`  总伤: ${r0.grandTotal.toFixed(0)}`)

// ---------- 4. 连续 20 次评估（求解器稳态）----------
clearAffixEvalCache()
const t20 = performance.now()
for (let i = 0; i < 20; i += 1) {
  evaluateAffixCounts(ctx, { ...createEmptyAffixCounts(), atkPercent: 20 + i, critDmg: i })
}
const ms20 = performance.now() - t20
console.log('\n=== 连续评估（求解器稳态）===')
console.log(`  20 次合计 ${ms20.toFixed(0)} ms → ${(ms20 / 20).toFixed(1)} ms/次`)
console.log(`  推算 200 次评估（30 词条分配）≈ ${((ms20 / 20) * 200 / 1000).toFixed(1)} s`)

// ---------- 5. 逐招式耗时 ----------
const external = r0.external
const perHit = []
for (const hit of hits) {
  const a = performance.now()
  try {
    evaluateOptimalEventDetail(ctx, external, hit, { includeDetails: false })
  } catch {
    /* 跳过无法评估的招式 */
  }
  perHit.push({ id: hit.id, ms: performance.now() - a, owner: hit.ownerAgentId })
}
console.log('\n=== 逐招式耗时（热状态）===')
console.log(`  合计 ${perHit.reduce((s, h) => s + h.ms, 0).toFixed(1)} ms`)
console.log('  最慢 5 个:')
for (const h of [...perHit].sort((a, b) => b.ms - a.ms).slice(0, 5)) {
  console.log(`    ${h.ms.toFixed(2)}ms  ${h.owner.padEnd(8)} ${h.id}`)
}

// ---------- 6. 收益表首屏成本 ----------
console.log('\n=== 收益表首屏成本（用户报的「词条 +1 很慢」）===')
{
  const entries = createDefaultAffixLibrary()

  clearAffixEvalCache()
  let t = performance.now()
  const fast = computeAffixBenefitTable({
    ctx, baseCounts: createEmptyAffixCounts(), entries, rollsPerStep: 1, includeSeries: false,
  })
  const fastMs = performance.now() - t

  clearAffixEvalCache()
  t = performance.now()
  const full = computeAffixBenefitTable({
    ctx, baseCounts: createEmptyAffixCounts(), entries, rollsPerStep: 1,
  })
  const fullMs = performance.now() - t

  console.log(`  只算「+1 档」表（includeSeries:false）: ${fastMs.toFixed(0)} ms  ← 现在的首屏`)
  console.log(`  连曲线一起算（旧行为）: ${fullMs.toFixed(0)} ms  ← 其中曲线占 ${(fullMs - fastMs).toFixed(0)} ms`)
  console.log(`  行数 ${fast.rows.length}，曲线 ${full.series.length} 条`)
}

// ---------- 7. CPU 剖析 ----------
const session = new inspector.Session()
session.connect()
const post = (m, p) => new Promise((res, rej) => session.post(m, p, (e, x) => (e ? rej(e) : res(x))))

const PROFILED = 25
await post('Profiler.enable')
await post('Profiler.setSamplingInterval', { interval: 200 })
await post('Profiler.start')
for (let i = 0; i < PROFILED; i += 1) {
  evaluateAffixCounts(ctx, { ...createEmptyAffixCounts(), atkPercent: 20 + i, critDmg: i })
}
const { profile } = await post('Profiler.stop')
session.disconnect()

const profPath = path.join(ARTIFACTS, `affix-perf-${Date.now()}.cpuprofile`)
fs.writeFileSync(profPath, JSON.stringify(profile))
console.log(`\n=== CPU 剖析 ===`)
console.log(`  已写入: ${profPath}（采样 ${profile.samples.length}）`)
console.log('  用 node artifacts/analyze-cpuprofile.mjs <file> 查看热点')
