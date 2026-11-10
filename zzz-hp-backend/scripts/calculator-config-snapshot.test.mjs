/**
 * 乘区/链路配置快照：导出结构、旧包兼容、权威初始化 SQL 的纯结构用例。
 *
 * 不连数据库：只读 `src/utils/calculatorConfigSnapshot.js`（导出/导入共用的纯函数）、
 * `scripts/data/zzz-hp-calculator-buffs.json`（仓库快照）与 `init_schema.sql`（建表权威来源）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  ZONE_CONFIG_SNAPSHOT_KEYS,
  buildZoneConfigSnapshot,
  readZoneConfigSnapshot,
} from '../src/utils/calculatorConfigSnapshot.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.join(__dirname, '..')
const initSchemaSql = fs.readFileSync(path.join(backendRoot, 'init_schema.sql'), 'utf8')
const snapshotPath = path.join(__dirname, 'data', 'zzz-hp-calculator-buffs.json')

function definition(overrides = {}) {
  return {
    id: 7,
    zoneKey: 'custom:eliteBonus',
    label: '对精英增伤区',
    sortOrder: 120,
    appliesTo: { damageKinds: ['direct'], agents: [], skills: [] },
    providers: 'team',
    primitive: 'percentSum',
    params: { cap: 3 },
    stats: [{ key: 'dmgBonus', label: '增伤', valueType: 'percent', sign: 'increase' }],
    display: { panel: 'inCombat' },
    enabled: true,
    version: 4,
    updatedAt: '2026-11-10T00:00:00.000Z',
    ...overrides,
  }
}

function scheme(overrides = {}) {
  return {
    id: 3,
    scope: 'agent',
    targetId: 'remiel',
    name: '蕾米乘区',
    priority: 10,
    enabled: true,
    version: 2,
    rules: [{ key: 'stagger', action: 'replace', params: { mode: 'curtain' } }],
    updatedBy: 'admin',
    updatedAt: '2026-11-10T00:00:00.000Z',
    ...overrides,
  }
}

function chain(overrides = {}) {
  return {
    id: 5,
    chainKey: 'custom:remielRadiance',
    label: '蕾米耀变链路',
    appliesTo: { damageKinds: ['direct'], subKinds: ['radiance'] },
    scope: 'agent',
    targetId: 'remiel',
    priority: 5,
    enabled: true,
    version: 3,
    stages: [
      { id: 'base', kind: 'source', module: 'panel.atk', order: 10, inputs: [], params: {}, when: {}, enabled: true },
      { id: 'final', kind: 'final', module: 'product', order: 20, inputs: ['base'], params: {}, when: {}, enabled: true },
    ],
    updatedBy: 'admin',
    updatedAt: '2026-11-10T00:00:00.000Z',
    ...overrides,
  }
}

test('导出结构：三块键都在，字段对齐公共接口且不含管理字段', () => {
  const snapshot = buildZoneConfigSnapshot({
    definitions: [definition()],
    schemes: [scheme()],
    chains: [chain()],
  })

  assert.deepEqual(Object.keys(snapshot), [...ZONE_CONFIG_SNAPSHOT_KEYS])
  assert.deepEqual(
    [...ZONE_CONFIG_SNAPSHOT_KEYS],
    ['zoneDefinitions', 'zoneSchemes', 'damageChains'],
  )

  assert.deepEqual(Object.keys(snapshot.zoneDefinitions[0]), [
    'zoneKey',
    'label',
    'sortOrder',
    'appliesTo',
    'providers',
    'primitive',
    'params',
    'stats',
    'display',
    'version',
    'enabled',
  ])
  assert.deepEqual(Object.keys(snapshot.zoneSchemes[0]), [
    'scope',
    'targetId',
    'name',
    'priority',
    'enabled',
    'version',
    'rules',
  ])
  assert.deepEqual(Object.keys(snapshot.damageChains[0]), [
    'chainKey',
    'label',
    'appliesTo',
    'scope',
    'targetId',
    'priority',
    'enabled',
    'version',
    'stages',
  ])

  // 管理字段与自增 id 不入快照：导入按唯一键 upsert，id 由库重新分配
  for (const [key, rows] of Object.entries(snapshot)) {
    for (const row of rows) {
      assert.equal('id' in row, false, `${key} 不应包含 id`)
      assert.equal('updatedBy' in row, false, `${key} 不应包含 updatedBy`)
      assert.equal('updatedAt' in row, false, `${key} 不应包含 updatedAt`)
    }
  }
})

test('导出结构：空表输出空数组而不是缺键', () => {
  const snapshot = buildZoneConfigSnapshot()
  for (const key of ZONE_CONFIG_SNAPSHOT_KEYS) {
    assert.ok(Array.isArray(snapshot[key]), `${key} 必须是数组`)
    assert.equal(snapshot[key].length, 0)
  }
  const partial = buildZoneConfigSnapshot({ definitions: [definition()] })
  assert.equal(partial.zoneDefinitions.length, 1)
  assert.deepEqual(partial.zoneSchemes, [])
  assert.deepEqual(partial.damageChains, [])
})

test('导入兼容：旧包没有三块键时整块跳过且不报错', () => {
  const legacy = {
    agents: [{ id: 'remiel' }],
    wengines: [],
    skillGroups: [],
    affixPresets: { groups: [] },
  }
  const read = readZoneConfigSnapshot(legacy)
  assert.deepEqual(read.zoneDefinitions, [])
  assert.deepEqual(read.zoneSchemes, [])
  assert.deepEqual(read.damageChains, [])
  assert.deepEqual(read.present, {
    zoneDefinitions: false,
    zoneSchemes: false,
    damageChains: false,
  })

  // 脏输入（null / 非对象）同样退化成空快照
  for (const source of [null, undefined, 'oops', 42, []]) {
    const empty = readZoneConfigSnapshot(source)
    assert.deepEqual(empty.zoneDefinitions, [])
    assert.equal(empty.present.zoneDefinitions, false)
  }
})

test('导入兼容：新包三块键被识别，非对象条目被丢弃', () => {
  const snapshot = JSON.parse(
    JSON.stringify(
      buildZoneConfigSnapshot({
        definitions: [definition()],
        schemes: [scheme()],
        chains: [chain()],
      }),
    ),
  )
  const read = readZoneConfigSnapshot({
    ...snapshot,
    zoneDefinitions: [...snapshot.zoneDefinitions, null, 'bad'],
  })
  assert.deepEqual(read.present, {
    zoneDefinitions: true,
    zoneSchemes: true,
    damageChains: true,
  })
  assert.equal(read.zoneDefinitions.length, 1)
  assert.equal(read.zoneDefinitions[0].zoneKey, 'custom:eliteBonus')
  assert.equal(read.zoneSchemes[0].version, 2)
  assert.equal(read.damageChains[0].stages.length, 2)
})

test('仓库快照已带三块空数组（旧导入脚本仍兼容）', () => {
  const raw = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
  for (const key of ZONE_CONFIG_SNAPSHOT_KEYS) {
    assert.ok(Array.isArray(raw[key]), `快照缺少数组键 ${key}`)
  }
  const read = readZoneConfigSnapshot(raw)
  assert.deepEqual(read.present, {
    zoneDefinitions: true,
    zoneSchemes: true,
    damageChains: true,
  })
  // 旧脚本读的键必须还在，避免快照被新键挤掉
  for (const key of ['agents', 'wengines', 'bangboos', 'driveDiscs', 'skills', 'skillGroups']) {
    assert.ok(Array.isArray(raw[key]), `快照缺少既有键 ${key}`)
  }
})

test('init_schema.sql 含三张表的建表语句与唯一键', () => {
  const tables = [
    { name: 'calculator_zone_definitions', uniqueKey: 'uk_zone_key (zone_key)' },
    { name: 'calculator_zone_schemes', uniqueKey: 'uk_scope_target (scope, target_id)' },
    {
      name: 'calculator_damage_chains',
      uniqueKey: 'uk_chain_scope_target (chain_key, scope, target_id)',
    },
  ]
  for (const table of tables) {
    const createPattern = new RegExp(
      `CREATE TABLE IF NOT EXISTS\\s+${table.name}\\s*\\(`,
      'i',
    )
    assert.match(initSchemaSql, createPattern, `init_schema.sql 缺少 ${table.name} 建表语句`)
    assert.ok(
      initSchemaSql.includes(table.uniqueKey),
      `init_schema.sql 缺少唯一键 ${table.uniqueKey}`,
    )
  }
  // 三张表各只出现一次，避免重复定义漂移
  for (const table of tables) {
    const count = initSchemaSql.split(`CREATE TABLE IF NOT EXISTS ${table.name} `).length - 1
    assert.equal(count, 1, `${table.name} 建表语句应只出现一次，实际 ${count}`)
  }
})
