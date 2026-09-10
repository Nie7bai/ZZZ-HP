/**
 * 探针：面板导入时「反推词条数」到底靠不靠谱。
 *
 * 反推 = 把 computeExternalPanelFromTeamSlot 逆用：已知局外面板，反解出词条条数。
 * 本脚本用三组实验回答两个问题：
 *   [A] 往返保真：条数 → 面板 → 反推条数，能否还原？
 *   [B] 扰动敏感：面板里混入一点点「模型没覆盖的来源」，反推会错成什么样？
 *   [C] 多解性：同一份面板是否对应多组条数（无唯一解）？
 *
 * 用法：npx vite-node scripts/probe-affix-inference.mjs
 */
import { createEmptyAgentBasePanel, createEmptyWengineAdvancedStats } from '../src/utils/calculatorUi.ts'
import { createEmptyAffixCounts } from '../src/types/calculatorPanel.ts'
import {
  computeExternalPanelFromTeamSlot,
  inferAffixCountsFromExternalPanel,
  AFFIX_VALUE_PER_COUNT,
} from '../src/utils/affixPanelCalc.ts'

const out = []
const log = (...a) => {
  const line = a.join(' ')
  out.push(line)
  console.log(line)
}
const n = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : String(v))

const AGENT_BASE = {
  ...createEmptyAgentBasePanel(),
  hp: 7672,
  atk: 610,
  def: 600,
  critRate: 5,
  critDmg: 50,
  mastery: 92,
  anomalyControl: 100,
  energyRegen: 100,
  directDmgMult: 100,
}
const WENGINE_BASE_ATK = 594
/** 音擎加成留空，避免混淆「反推的是词条而不是音擎」 */
const WENGINE_ADV = createEmptyWengineAdvancedStats()
const TWO_PIECE = { twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' }
const MAINS = {
  slot4MainStat: 'critDmg',
  slot5MainStat: 'externalAtkPercent',
  slot6MainStat: 'externalHpPercent',
}

const buildPanel = (counts) =>
  computeExternalPanelFromTeamSlot({
    slot: {
      agentId: 'tester',
      wengineId: 'weng',
      twoPieceDriveDiscId: 'none',
      fourPieceDriveDiscId: 'none',
      affixCounts: counts,
      affixDriveDiscMainStats: MAINS,
    },
    agents: [{ id: 'tester', name: '测试', element: '电', profession: '强攻', basePanel: AGENT_BASE }],
    wengines: [{ id: 'weng', name: '音擎', baseAtk: WENGINE_BASE_ATK, advancedStats: WENGINE_ADV }],
    driveDiscs: [],
  })

const infer = (panel) =>
  inferAffixCountsFromExternalPanel({
    target: panel,
    agentBase: AGENT_BASE,
    wengineBaseAtk: WENGINE_BASE_ATK,
    wengineAdvanced: WENGINE_ADV,
    driveDiscSelection: TWO_PIECE,
    driveDiscMainStats: MAINS,
    driveDiscs: [],
  })

const keys = ['hpFlat', 'hpPercent', 'atkFlat', 'atkPercent', 'critRate', 'critDmg', 'pen', 'mastery']

log('='.repeat(80))
log('[A] 往返保真：条数 → 面板 → 反推条数')
log('')

const cases = [
  { name: '零词条', counts: {} },
  { name: '典型攻暴', counts: { atkPercent: 12, atkFlat: 6, critRate: 10, critDmg: 8 } },
  { name: '暴击拉满', counts: { critRate: 24, critDmg: 6 } },
  { name: '精通为主', counts: { mastery: 20, atkPercent: 10 } },
  { name: '穿透混合', counts: { pen: 9, atkPercent: 9, critRate: 6, mastery: 6 } },
  { name: '生命+攻击', counts: { hpPercent: 10, hpFlat: 4, atkPercent: 10, atkFlat: 4 } },
]

let roundTripOk = 0
for (const c of cases) {
  const counts = { ...createEmptyAffixCounts(), ...c.counts }
  const panel = buildPanel(counts)
  const { affixCounts: back, warnings } = infer(panel)
  const diffs = keys.filter((k) => (counts[k] ?? 0) !== (back[k] ?? 0))
  const ok = diffs.length === 0
  if (ok) roundTripOk += 1
  log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.name}`)
  log(`        输入 ${JSON.stringify(c.counts)}`)
  log(
    `        反推 ${JSON.stringify(
          Object.fromEntries(keys.filter((k) => back[k]).map((k) => [k, back[k]])),
        )}`,
  )
  if (!ok) {
    log(
      `        差异 ${diffs
        .map((k) => `${k}: ${counts[k] ?? 0} → ${back[k] ?? 0}`)
        .join(', ')}`,
    )
    log(`        面板 ${JSON.stringify({ hp: panel.hp, atk: panel.atk, crit: panel.critRate, cd: panel.critDmg, pen: panel.pen, m: panel.mastery })}`)
  }
  if (warnings.length) log(`        警告 ${warnings.join(' / ')}`)
}
log('')
log(`  往返全对：${roundTripOk}/${cases.length}`)

log('')
log('='.repeat(80))
log('[B] 扰动敏感：面板里混入模型没覆盖的来源')
log('')

const baseCounts = { ...createEmptyAffixCounts(), atkPercent: 12, critRate: 10, critDmg: 8, mastery: 6 }
const cleanPanel = buildPanel(baseCounts)
const perturb = (label, delta) => {
  const panel = { ...cleanPanel }
  for (const [k, v] of Object.entries(delta)) panel[k] = (panel[k] ?? 0) + v
  const { affixCounts: back, warnings } = infer(panel)
  log(`  ${label}`)
  log(`        反推 ${JSON.stringify(Object.fromEntries(keys.filter((k) => back[k]).map((k) => [k, back[k]])))}`)
  log(
    `        与真值差异 ${keys
      .filter((k) => (baseCounts[k] ?? 0) !== (back[k] ?? 0))
      .map((k) => `${k}: ${baseCounts[k] ?? 0} → ${back[k] ?? 0}`)
      .join(', ') || '（无）'}`,
  )
  if (warnings.length) log(`        警告 ${warnings.join(' / ')}`)
  else log('        警告 （无 — 静默给出错误条数）')
}

log('  真值：' + JSON.stringify({ atkPercent: 12, critRate: 10, critDmg: 8, mastery: 6 }))
log('')
perturb('① 暴击率 +2.4（相当于游戏里一条未建模的来源）', { critRate: 2.4 })
perturb('② 暴击伤害 +4.8', { critDmg: 4.8 })
perturb('③ 精通 +18', { mastery: 18 })
perturb('④ 攻击力 +19', { atk: 19 })

log('')
log('='.repeat(80))
log('[D] 关键后果：面板导入后再从「词条导入」页点确定，面板会变成什么')
log('')

/**
 * 真实链路：导入弹窗里两个子页共用同一次「确定导入」。
 * `confirm()` 在 `entryMode === 'affix'` 时用**词条推导**覆盖面板；
 * 而词条数正是上一次面板导入时反推出来的 —— 带残差的近似值。
 * 于是「面板导入 → 再打开、切到词条页 → 确定」会静默改写面板。
 */
const realPanel = buildPanel({ ...createEmptyAffixCounts(), critRate: 10, atkPercent: 12 })
// 游戏里这条面板还含模型没覆盖的 1.0 点暴击（不是整档）
const realPanelWithExtra = { ...realPanel, critRate: realPanel.critRate + 1 }
const inferred = infer(realPanelWithExtra).affixCounts
const rebuilt = buildPanel(inferred)
log(`  ① 面板导入时用户填的暴击率      = ${n(realPanelWithExtra.critRate, 1)}%（含 1.0 点模型外来源）`)
log(`  ② 当时反推出的暴击条数          = ${inferred.critRate}`)
log(`  ③ 再开弹窗、切到词条页、点确定  → 面板按②重算`)
log(`     结果暴击率                    = ${n(rebuilt.critRate, 1)}%（比①少了 ${n(realPanelWithExtra.critRate - rebuilt.critRate, 1)} 点）`)
log(`     是否给出任何提示              = 否`)
log('')
log('  同一份操作在「面板页」点确定则不会改写（面板原样存回）：')
log(`     ${n(realPanelWithExtra.critRate, 1)}% → ${n(realPanelWithExtra.critRate, 1)}%`)

log('')
log('='.repeat(80))
log('[C] 多解性：同一份面板能否对应多组条数')
log('')

const target = buildPanel({ ...createEmptyAffixCounts(), atkPercent: 8, atkFlat: 6 })
log(`  目标面板 atk = ${n(target.atk, 2)}（由 局外大攻击 8 条 + 攻击力 6 条 生成）`)
log('')
log('  满足「面板数值几乎相同」的多组条数（穷举 局外大攻击 × 攻击力）：')
const matches = []
for (let pct = 0; pct <= 24; pct++) {
  for (let flat = 0; flat <= 20; flat++) {
    const p = buildPanel({ ...createEmptyAffixCounts(), atkPercent: pct, atkFlat: flat })
    const err = Math.abs(p.atk - target.atk)
    if (err <= 0.05) matches.push({ pct, flat, atk: p.atk, err })
  }
}
for (const m of matches.slice(0, 12)) {
  log(`     局外大攻击 ${String(m.pct).padStart(2)} + 攻击力 ${String(m.flat).padStart(2)} → atk=${n(m.atk, 2)}（差 ${n(m.err, 3)}）`)
}
log(`  共 ${matches.length} 组条数能产出同一份面板（单条档值 ${AFFIX_VALUE_PER_COUNT.atkPercent}% / ${AFFIX_VALUE_PER_COUNT.atkFlat}）`)
log('')
log('  反推函数实际选的是（按「条数最少」打破平局）：')
const chosen = infer(target).affixCounts
log(`     局外大攻击 ${chosen.atkPercent} + 攻击力 ${chosen.atkFlat}`)

import fs from 'node:fs'
fs.writeFileSync(
  'D:/WB_agent_out/applications/ZZZ-HP/artifacts/probe-affix-inference.txt',
  out.join('\n') + '\n',
  'utf8',
)
