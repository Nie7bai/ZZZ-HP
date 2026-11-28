/**
 * 异常条系数内置默认表与解析（boss_info 覆盖 > 内置默认 > null）
 * 末尾一组源码守卫：管理端「怪物基础库 → 导入/导出」的快照必须带上该列，
 * 漏列会让迁移到另一环境后所有手工配置的系数静默丢失。
 * 运行：node --test scripts/anomaly-bar-coefficient.test.mjs
 */
import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANOMALY_BAR_COEFFICIENT_BY_NAME,
  resolveAnomalyBarCoefficient,
} from '../src/utils/anomalyBarCoefficient.js'
import { normalizeAnomalyBarCoefficient } from '../src/utils/bossSchema.js'

test('默认表共 18 条，且均为有限正数', () => {
  const entries = Object.entries(ANOMALY_BAR_COEFFICIENT_BY_NAME)
  assert.equal(entries.length, 18)
  for (const [name, coefficient] of entries) {
    assert.ok(name.length > 0)
    assert.ok(Number.isFinite(coefficient) && coefficient > 0, `${name} 系数非法`)
  }
})

test('内置默认：带括号与不带括号两种写法都能命中「亵渎者」', () => {
  assert.equal(resolveAnomalyBarCoefficient('亵渎者', null), 1.32)
  assert.equal(resolveAnomalyBarCoefficient('「亵渎者」', null), 1.32)
})

test('内嵌括号名：自律强袭单位·提丰·破坏者型 ⇒ 1.1', () => {
  assert.equal(resolveAnomalyBarCoefficient('自律强袭单位·提丰·破坏者型', null), 1.1)
  assert.equal(resolveAnomalyBarCoefficient('自律强袭单位·「提丰·破坏者型」', null), 1.1)
})

test('默认表：猎血清道夫 ⇒ 1.0625', () => {
  assert.equal(resolveAnomalyBarCoefficient('猎血清道夫', null), 1.0625)
})

test('未知名称 ⇒ null（不按 1 兜底，由调用方决定）', () => {
  assert.equal(resolveAnomalyBarCoefficient('不存在的怪物', null), null)
  assert.equal(resolveAnomalyBarCoefficient('猎血清道夫·改', undefined), null)
})

test('空 / 空白名称 ⇒ null', () => {
  assert.equal(resolveAnomalyBarCoefficient(null, null), null)
  assert.equal(resolveAnomalyBarCoefficient(undefined, null), null)
  assert.equal(resolveAnomalyBarCoefficient('', null), null)
  assert.equal(resolveAnomalyBarCoefficient('　  ', null), null)
})

test('显式覆盖值优先于内置默认表', () => {
  assert.equal(resolveAnomalyBarCoefficient('亵渎者', 1.5), 1.5)
  assert.equal(resolveAnomalyBarCoefficient('不存在的怪物', 2.5), 2.5)
  assert.equal(resolveAnomalyBarCoefficient('死路屠夫', 1.75), 1.75)
})

test('非法显式值回退内置默认表', () => {
  for (const invalid of [0, -1, NaN, Infinity, -Infinity, '']) {
    assert.equal(
      resolveAnomalyBarCoefficient('亵渎者', invalid),
      1.32,
      `显式值 ${String(invalid)} 应回退默认表`,
    )
  }
  assert.equal(resolveAnomalyBarCoefficient('不存在的怪物', 0), null)
})

// DECIMAL 列经 mysql2 返回字符串，读路径先归一化再当显式覆盖值传入（bossInfoService / crisisAssaultService 同口径）
test('mysql2 字符串覆盖值：归一化后优先生效', () => {
  assert.equal(
    resolveAnomalyBarCoefficient('亵渎者', normalizeAnomalyBarCoefficient('1.5000')),
    1.5,
  )
  assert.equal(
    resolveAnomalyBarCoefficient('不存在的怪物', normalizeAnomalyBarCoefficient('1.2500')),
    1.25,
  )
  assert.equal(resolveAnomalyBarCoefficient('亵渎者', normalizeAnomalyBarCoefficient(null)), 1.32)
})

// 快照（管理端「怪物基础库 → 导入/导出」）漏列 anomaly_bar_coefficient 会让异环境导入后
// 手工配置的系数静默丢失；这里按仓库既有源码守卫口径读文本断言（同 zzz-hp/scripts/test-monster-resistance-table.mjs）。
// normalizeRow 是模块私有（bossInfoSnapshot.js 又依赖 DB 连接模块，测试内不连库），
// 所以「旧快照缺字段 ⇒ null」由字段表达式断言 + normalizeAnomalyBarCoefficient 行为用例共同覆盖。
const snapshotSource = readFileSync(
  new URL('../src/utils/bossInfoSnapshot.js', import.meta.url),
  'utf8',
)
/** 列清单 / 参数列表只差换行缩进，压平空白后再断言 */
const snap = snapshotSource.replace(/\s+/g, ' ')

const paramItems = (snap.match(/const params = \[(.*?)\]/)?.[1] ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
const updateColumns = snap.match(/UPDATE boss_info SET (.*?) WHERE id = \?`/)?.[1] ?? ''
const updateParamItems = (snap.match(/UPDATE boss_info[\s\S]*?WHERE id = \?`, \[(.*?)\],/)?.[1] ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
const insertStatements = [
  ...snap.matchAll(/INSERT INTO boss_info \( ([^)]*?) \) VALUES \(([^`]*?)\)`/g),
].map((match) => ({
  columns: match[1].split(',').map((column) => column.trim()),
  placeholders: match[2].split(',').length,
}))

test('快照导出：SELECT 与导出行都带 anomaly_bar_coefficient（紧随 stagger_time）', () => {
  const selectColumns = snap.match(/SELECT id, boss_name.*? FROM boss_info/)?.[0] ?? ''
  assert.ok(selectColumns.includes('stagger_time, anomaly_bar_coefficient,'), selectColumns)
  assert.ok(
    snap.includes(
      'staggerTime: normalizeStaggerTime(row.stagger_time), anomalyBarCoefficient: normalizeAnomalyBarCoefficient(row.anomaly_bar_coefficient),',
    ),
  )
})

test('快照导出与导入都调用 ensureBossAnomalySchema（目标库缺列时先补列再导/导）', () => {
  assert.equal((snap.match(/await ensureBossAnomalySchema\(\)/g) ?? []).length, 2)
  const [beforeImportFunction, importFunction = ''] = snap.split(
    'export async function importBossInfoSnapshot',
  )
  assert.ok(beforeImportFunction.includes('await ensureBossAnomalySchema()'))
  assert.ok(importFunction.includes('await ensureBossAnomalySchema()'))
})

test('快照导入：camelCase 与 snake_case 都接受，空 / 缺字段 ⇒ null（不拿 1 冒充）', () => {
  assert.ok(
    snap.includes(
      'anomalyBarCoefficient: normalizeAnomalyBarCoefficient( item.anomalyBarCoefficient ?? item.anomaly_bar_coefficient, )',
    ),
  )
  // 本次改动前导出的快照没有该字段 ⇒ undefined ⇒ null ⇒ DB NULL ⇒ 读路径回落内置默认
  assert.equal(normalizeAnomalyBarCoefficient(undefined), null)
  assert.equal(normalizeAnomalyBarCoefficient(null), null)
  assert.equal(normalizeAnomalyBarCoefficient(''), null)
  assert.equal(normalizeAnomalyBarCoefficient(0), null)
  assert.equal(normalizeAnomalyBarCoefficient(Number.NaN), null)
  assert.ok(!/(normalizeAnomalyBarCoefficient\(|item\.anomalyBarCoefficient)[^,]*(\?\?|\|\|) 1/.test(snap))
})

test('快照导入：params / UPDATE 参数在 stagger_time 之后同位置插入系数', () => {
  assert.equal(paramItems.length, 19)
  assert.deepEqual(paramItems.slice(8, 11), [
    'item.staggerMultiplier',
    'item.staggerTime',
    'item.anomalyBarCoefficient',
  ])
  assert.ok(updateColumns.includes('stagger_time = ?, anomaly_bar_coefficient = ?,'), updateColumns)
  assert.equal(updateParamItems.length, 20)
  assert.deepEqual(updateParamItems.slice(9, 12), [
    'item.staggerTime',
    'item.anomalyBarCoefficient',
    'item.fieldBuffName',
  ])
  assert.equal(updateParamItems[19], 'targetId')
  // UPDATE 的 SET 占位符数 = 参数数 - 1（末尾 targetId 对应 WHERE）
  assert.equal((updateColumns.match(/\?/g) ?? []).length, updateParamItems.length - 1)
})

test('快照导入：四条 INSERT 都带 anomaly_bar_coefficient / weakness_sets，占位符数与列数一致（现 19 / 20 列）', () => {
  assert.equal(insertStatements.length, 4)
  for (const { columns, placeholders } of insertStatements) {
    assert.equal(placeholders, columns.length, columns.join(','))
    assert.equal(columns.indexOf('anomaly_bar_coefficient'), columns.indexOf('stagger_time') + 1)
    assert.ok(columns.includes('weakness_sets'), 'INSERT 必须带 weakness_sets')
  }
  assert.deepEqual(
    insertStatements.map(({ columns }) => columns.length).sort((a, b) => a - b),
    [19, 19, 20, 20],
  )
  assert.ok(snap.includes('version: 1,'))
})
