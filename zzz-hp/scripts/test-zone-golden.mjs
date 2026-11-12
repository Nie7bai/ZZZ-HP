/**
 * 乘区黄金对照（Phase 0 / 后续每个阶段都必须通过）。
 *
 * 基准：`fixtures/zone-golden.json`，由改造前的硬编码乘区生成。
 * 断言：同一批夹具的 `perHit`、`total` 与 `DamageCalcResult` 全部字段逐字段一致。
 *
 * 新增字段（`zones`、`zoneSchemeVersion`）属于模块化附加信息，比对时剔除；
 * 原有字段一个都不允许变化。
 *
 * 运行：npx vite-node scripts/test-zone-golden.mjs
 * 重建基线：npx vite-node scripts/test-zone-golden.mjs --write   （仅在确认代码与基线等价时使用）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildGoldenCases, dumpCase, stableJson } from './_zoneGoldenCases.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const baselinePath = path.join(here, '..', 'fixtures', 'zone-golden.json')
const writeMode = process.argv.includes('--write')

/** 模块化之后新增、不属于“原有硬编码结果”的字段 */
const ADDITIVE_RESULT_KEYS = new Set(['zones', 'zoneSchemeVersion', 'pipeline'])

function stripAdditive(result) {
  const next = { ...result }
  for (const key of ADDITIVE_RESULT_KEYS) delete next[key]
  return next
}

function firstDiff(a, b, pathText = '') {
  if (a === b) return null
  if (typeof a !== typeof b) return `${pathText}: 类型 ${typeof a} ≠ ${typeof b}`
  if (a === null || b === null) return `${pathText}: ${a} ≠ ${b}`
  if (typeof a !== 'object') return `${pathText}: ${a} ≠ ${b}`
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const diff = firstDiff(a[key], b[key], pathText ? `${pathText}.${key}` : key)
    if (diff) return diff
  }
  return null
}

const actual = {}
for (const testCase of buildGoldenCases()) {
  actual[testCase.name] = dumpCase(testCase)
}

const actualText = `${JSON.stringify(stableJson(actual), null, 2)}\n`

if (writeMode) {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true })
  fs.writeFileSync(baselinePath, actualText, 'utf8')
  console.log(`已重建基线：${baselinePath}（${Object.keys(actual).length} 个用例）`)
  process.exit(0)
}

if (!fs.existsSync(baselinePath)) {
  console.error(`缺少基线文件：${baselinePath}（先运行 --write）`)
  process.exit(1)
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
let failed = 0
const names = Object.keys(baseline)

if (Object.keys(actual).length !== names.length) {
  console.error(`用例数不一致：基线 ${names.length} / 当前 ${Object.keys(actual).length}`)
  failed += 1
}

for (const name of names) {
  const expected = baseline[name]
  const current = actual[name]
  if (!current) {
    console.error(`FAIL  ${name} — 当前缺少该用例`)
    failed += 1
    continue
  }
  for (const field of ['perHit', 'total']) {
    if (current[field] !== expected[field]) {
      console.error(`FAIL  ${name}.${field} — ${current[field]} ≠ ${expected[field]}`)
      failed += 1
    }
  }
  const diff = firstDiff(stripAdditive(current.result), expected.result)
  if (diff) {
    console.error(`FAIL  ${name}.result — ${diff}`)
    failed += 1
  }
}

// Phase 1a 附加检查：`zones` 映射必须存在、数值与原字段一致、顺序稳定
for (const name of names) {
  const result = actual[name]?.result
  const zones = result?.zones
  if (!zones) {
    console.error(`FAIL  ${name}.zones — 缺少乘区映射`)
    failed += 1
    continue
  }
  for (const key of ['dmgMultiplier', 'staggerMultiplier', 'generalMultiplier', 'defenseMultiplier']) {
    if (zones[key]?.value !== result[key]) {
      console.error(`FAIL  ${name}.zones.${key} — ${zones[key]?.value} ≠ ${result[key]}`)
      failed += 1
    }
  }
  const orderedKeys = ['dmgMultiplier', 'defenseMultiplier', 'resistanceMultiplier', 'staggerMultiplier', 'generalMultiplier']
  for (let index = 1; index < orderedKeys.length; index += 1) {
    const prev = zones[orderedKeys[index - 1]]?.order
    const next = zones[orderedKeys[index]]?.order
    if (!(prev < next)) {
      console.error(`FAIL  ${name}.zones — 顺序异常：${orderedKeys[index - 1]}=${prev} / ${orderedKeys[index]}=${next}`)
      failed += 1
    }
  }
  if (name.startsWith('curtain-')) {
    const stagger = zones.staggerMultiplier
    if (!stagger?.label.includes('帷幕易伤')) {
      console.error(`FAIL  ${name}.zones.staggerMultiplier — 标签应为帷幕易伤：${stagger?.label}`)
      failed += 1
    }
  }
}

// Phase 4c 附加检查：阶段轨迹存在、链路选择正确、final 阶段有值
for (const name of names) {
  const result = actual[name]?.result
  const pipeline = result?.pipeline
  if (!pipeline?.stages?.length) {
    console.error(`FAIL  ${name}.pipeline — 缺少阶段轨迹`)
    failed += 1
    continue
  }
  // 链路选择：直伤/锐化/帷幕走 direct、锋御走 sharpen、异常子类各自成链
  const expectedChain = name.startsWith('sharpen')
    ? 'sharpen'
    : name.startsWith('direct') || name.startsWith('curtain')
      ? 'direct'
      : name.startsWith('attributeAnomaly')
        ? 'attributeAnomaly'
        : name.startsWith('anomalyRelease')
          ? 'anomalyRelease'
          : name.startsWith('disorder')
            ? 'disorder'
            : name.startsWith('turbulence')
              ? 'turbulence'
              : 'anomaly'
  if (pipeline.chainId !== expectedChain) {
    console.error(`FAIL  ${name}.pipeline.chainId — ${pipeline.chainId} ≠ ${expectedChain}`)
    failed += 1
  }
  const finalStage = pipeline.stages.find((stage) => stage.kind === 'final')
  if (!finalStage || !Number.isFinite(finalStage.value)) {
    console.error(`FAIL  ${name}.pipeline — 缺少 final 阶段`)
    failed += 1
  }
}

if (failed) {
  console.error(`\n❌ 黄金对照失败：${failed} 处差异`)
  process.exit(1)
}

console.log(`✅ 黄金对照通过：${names.length} 个用例，perHit/total/全部原有结果字段一致`)
console.log(`✅ 乘区映射：${names.length} 个用例均含 zones，数值与旧字段一致、顺序升序`)
