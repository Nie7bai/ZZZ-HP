/**
 * 转模「比例 / 上限随技能等级」回归。
 *
 * 口径：
 *   有效比例 = ratioPercent + ratioPercentPerLevel × (等级 − 1)
 *   有效上限 = cap + capPerLevel × (等级 − 1)（cap 为空则不设上限）
 * 缺省 ratioLevelSource = 固定比例，行为与旧数据一致。
 *
 * 运行：npx vite-node scripts/test-convert-skill-level.mjs
 */
import {
  normalizeBuffEffect,
  resolveConvertValue,
  resolveConvertValueDetail,
} from '../src/utils/buffEffect.ts'

let passed = 0
let failed = 0

function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}

function near(actual, expected, tolerance = 1e-6) {
  return Math.abs(actual - expected) <= tolerance
}

function makeConvertEffect(overrides = {}) {
  return {
    id: 'robin-defense',
    kind: 'convert',
    stat: 'def',
    value: 0,
    applyTarget: 'team',
    convert: {
      from: 'hp',
      panelSource: 'manual',
      defaultBase: 26000,
      initialBase: 16000,
      ratioPercent: 4.7,
      ratioPercentPerLevel: 0.3,
      cap: 470,
      capPerLevel: 30,
      ratioLevelSource: 'skillLevelSpecial',
      ...overrides,
    },
  }
}

const levels = (special) => ({ special })

const l12 = resolveConvertValueDetail(makeConvertEffect(), {}, null, undefined, levels(12))
check('L12：比例 4.7 + 0.3×11 = 8%', near(l12.ratioPercent, 8), `${l12.ratioPercent}`)
check('L12：上限 470 + 30×11 = 800', l12.cap === 800, `${l12.cap}`)
check('L12：26000 生命 → 10000×8% = 800（恰好触顶）', near(l12.amount, 800), `${l12.amount}`)

const l16 = resolveConvertValueDetail(makeConvertEffect(), {}, null, undefined, levels(16))
check('L16：比例 9.2%', near(l16.ratioPercent, 9.2), `${l16.ratioPercent}`)
check('L16：上限 920 且结果 920', l16.cap === 920 && near(l16.amount, 920), `${l16.cap}/${l16.amount}`)

const l1 = resolveConvertValueDetail(makeConvertEffect(), {}, null, undefined, levels(1))
check('L1：比例 4.7% / 上限 470 / 结果 470', near(l1.ratioPercent, 4.7) && l1.cap === 470 && near(l1.amount, 470), JSON.stringify(l1))

const mid = resolveConvertValueDetail(
  makeConvertEffect({ defaultBase: 20000 }),
  {},
  null,
  undefined,
  levels(12),
)
check('L12：20000 生命 → 4000×8% = 320（未触顶）', near(mid.amount, 320), `${mid.amount}`)

const fixed = resolveConvertValueDetail(
  makeConvertEffect({ ratioLevelSource: undefined, ratioPercentPerLevel: 0, capPerLevel: 0 }),
  {},
  null,
  undefined,
  levels(16),
)
check('缺省等级来源：固定 4.7% / 上限 470', near(fixed.ratioPercent, 4.7) && fixed.cap === 470 && near(fixed.amount, 470), JSON.stringify(fixed))

check(
  'resolveConvertValue 与 detail.amount 一致',
  near(resolveConvertValue(makeConvertEffect(), {}, null, undefined, levels(12)), l12.amount),
)

const normalized = normalizeBuffEffect(makeConvertEffect())
check(
  '归一化保留比例等级字段',
  normalized?.convert?.ratioLevelSource === 'skillLevelSpecial' &&
    normalized?.convert?.ratioPercentPerLevel === 0.3 &&
    normalized?.convert?.capPerLevel === 30,
  JSON.stringify(normalized?.convert ?? null),
)

const legacyNormalized = normalizeBuffEffect(
  makeConvertEffect({
    ratioLevelSource: undefined,
    ratioPercentPerLevel: 0,
    capPerLevel: 0,
  }),
)
check(
  '旧数据（无等级来源）归一化后仍是固定比例',
  legacyNormalized?.convert?.ratioLevelSource === undefined,
  JSON.stringify(legacyNormalized?.convert ?? null),
)

console.log(`\n=== 结果：passed = ${passed}, failed = ${failed} ===`)
if (failed > 0) process.exit(1)
