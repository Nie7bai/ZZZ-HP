/**
 * 危局强袭战「分数与血量对应表」· 数据一致性回归测试。
 *
 * 覆盖 src/data/crisisScoreHpTable.ts 的两张表（正常 / 绝境）。
 *
 * 为什么需要：绝境表 bar 5–8 曾把 `scorePerHp` 停留在 bar 1–4 的值（0.548245），
 * 而该档分数已从 750 涨到 1000 → 「分数/血量」列比正确值低 25%，且
 * 「分数占比 ÷ 血量占比」再也算不出这一列。分数档位一改而 scorePerHp 忘了同步，
 * 是这类表最容易犯、又完全可用公式判定的错，所以在这里守住。
 *
 * 容差说明：`hpRatio` 是舍入后写入的（如 0.0137，真值 0.01372997），
 * 所以 `scorePerHp` 与 `scoreRatio / hpRatio` 之间有 ≤0.3% 的固有偏差，属正常；
 * 容差取 0.5% 既能容忍舍入，又能抓住 25% 这种真错误。
 *
 * 运行：npx vite-node scripts/test-crisis-score-hp-table.mjs
 */
import {
  CRISIS_SCORE_MAX,
  crisisScoreHpTableHard,
  crisisScoreHpTableNormal,
  getCrisisScoreTable,
} from '../src/data/crisisScoreHpTable.ts'

let failed = 0
let passed = 0

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const RATIO_TOLERANCE = 0.005 // 0.5%

function rel(a, b) {
  if (b === 0) return a === 0 ? 0 : Number.POSITIVE_INFINITY
  return Math.abs(a - b) / Math.abs(b)
}

console.log('\n[按模式取表]')
{
  check('normal → 正常表', getCrisisScoreTable('normal') === crisisScoreHpTableNormal)
  check('hard → 绝境表', getCrisisScoreTable('hard') === crisisScoreHpTableHard)
}

for (const [label, rows] of [
  ['正常', crisisScoreHpTableNormal],
  ['绝境', crisisScoreHpTableHard],
]) {
  console.log(`\n[${label}表 · 基础不变量]`)

  // scoreRatio 是「score / 满分」的舍入值：正常表存 6 位小数，绝境表存 4 位小数
  // （如 1000/60000 = 0.0166667 → 存 0.0167）。因此断言写「4 位小数以内舍入」
  // ——既容忍两种表的既有精度口径，又能抓住拿错档位那种量级（≥0.4%）的错误。
  const scoreRatioErrors = rows.map((row) => Math.abs(row.scoreRatio - row.score / CRISIS_SCORE_MAX))
  const maxScoreRatioError = Math.max(...scoreRatioErrors)
  check(
    '每行 scoreRatio 是 score / 满分 的 4 位小数以内舍入',
    maxScoreRatioError <= 5e-5,
    `最大偏差 ${maxScoreRatioError.toExponential(2)}`,
  )

  const last = rows[rows.length - 1]
  check('末行累计分数 === 满分', last.cumulativeScore === CRISIS_SCORE_MAX, `${last.cumulativeScore}`)
  check('末行累计血量 === 1', last.cumulativeHp === 1, `${last.cumulativeHp}`)

  let monotonicScore = true
  let monotonicHp = true
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].cumulativeScore < rows[i - 1].cumulativeScore) monotonicScore = false
    if (rows[i].cumulativeHp < rows[i - 1].cumulativeHp) monotonicHp = false
  }
  check('累计分数单调不减', monotonicScore)
  check('累计血量单调不减', monotonicHp)

  const withPerHp = rows.filter((row) => row.scorePerHp != null)
  check('存在分数字段的行都带 scorePerHp', withPerHp.length > 0, `${withPerHp.length} 行`)
  check(
    'scorePerHp 均为正数',
    withPerHp.every((row) => row.scorePerHp > 0),
  )

  console.log(`\n[${label}表 · 分数/血量 与 分数占比 ÷ 血量占比 必须一致]`)
  const offRatio = withPerHp
    .map((row) => ({ row, deviation: rel(row.scorePerHp, row.scoreRatio / row.hpRatio) }))
    .filter((item) => item.deviation > RATIO_TOLERANCE)
  check(
    `每行 scorePerHp ≈ scoreRatio / hpRatio（容差 ${RATIO_TOLERANCE * 100}%）`,
    offRatio.length === 0,
    offRatio.length === 0
      ? `${withPerHp.length} 行全部通过`
      : offRatio
          .map(
            (item) =>
              `bar=${item.row.bar} 存 ${item.row.scorePerHp} vs 算 ${(item.row.scoreRatio / item.row.hpRatio).toFixed(6)}（差 ${(item.deviation * 100).toFixed(2)}%）`,
          )
          .join('; '),
  )

  // 直击 A 的核心：同一血量段内，scorePerHp 必须随分数占比同比变化。
  // 分数档位改了而 scorePerHp 没跟着改，这条会立刻失败。
  console.log(`\n[${label}表 · 同一血量段内 分数/血量 必须与分数占比同比]`)
  const groups = new Map()
  for (const row of withPerHp) {
    const key = String(row.hpRatio)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  const badGroups = []
  for (const [hpRatio, group] of groups) {
    const factors = group.map((row) => row.scorePerHp / row.scoreRatio)
    const min = Math.min(...factors)
    const max = Math.max(...factors)
    if (rel(max, min) > RATIO_TOLERANCE) {
      badGroups.push(
        `hpRatio=${hpRatio}: ${group.map((row) => `bar${row.bar}=${row.scorePerHp}`).join(', ')}`,
      )
    }
  }
  check(
    '同血量段的 scorePerHp / scoreRatio 恒定',
    badGroups.length === 0,
    badGroups.join(' | ') || `${groups.size} 个血量段全部通过`,
  )
}

console.log('\n[绝境表 bar 5–8 显式回归（曾把 scorePerHp 停在 bar 1–4 的 0.548245）]')
{
  const staleValue = 0.548245
  const rows5to8 = crisisScoreHpTableHard.filter((row) => row.bar >= 5 && row.bar <= 8)
  check('取到 4 行', rows5to8.length === 4, `${rows5to8.length}`)
  check(
    '不再是陈旧值 0.548245',
    rows5to8.every((row) => row.scorePerHp !== staleValue),
    rows5to8.map((row) => row.scorePerHp).join(', '),
  )
  check(
    '等于 0.0167 / 0.0228 = 0.732456',
    rows5to8.every((row) => Math.abs(row.scorePerHp - 0.732456) < 1e-9),
    rows5to8.map((row) => row.scorePerHp).join(', '),
  )
  const bars1to4 = crisisScoreHpTableHard.filter((row) => row.bar >= 1 && row.bar <= 4)
  check(
    'bar 1–4 仍是 0.548245（未被误改）',
    bars1to4.every((row) => row.scorePerHp === staleValue),
    bars1to4.map((row) => row.scorePerHp).join(', '),
  )
  // 按表自身的口径比：scorePerHp 用的是**舍入后的** scoreRatio（0.0125 / 0.0167），
  // 不是原始分数比（1000/750）。bar 11 可验证这一口径：0.0583 / 0.0379 = 1.53825，
  // 与表里写的 1.53825 完全一致。
  check(
    '分数档位比一致（0.0167/0.0125 = 0.732456/0.548245）',
    rel(0.0167 / 0.0125, 0.732456 / staleValue) < 0.001,
    `${(0.0167 / 0.0125).toFixed(6)} vs ${(0.732456 / staleValue).toFixed(6)}`,
  )
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
