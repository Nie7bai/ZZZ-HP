/**
 * 新乘区 ± 增益键：自定义 Buff 属性（`custom:<key>`）全链路纯函数用例。
 *
 * 覆盖：
 * - `isCustomBuffStatKey` 格式校验；
 * - `addStat` 写 `mods.custom[key]`（缺失初始化、按值累加），内置键不受影响；
 * - `registerCustomBuffStatZones` 把乘区定义登记的键追加为「属性」下拉项（幂等）；
 * - 带 custom stat 的 `BuffEffect` 走一次效果应用，产出 `mods.custom.eliteDmgBonus = 30`；
 * - 读写 `BuffEffect` 时 custom stat 不被重置为 `dmgBonus`；
 * - 运行时乘区定义的 `stats` 经 `setRuntimeZoneDefinitions` 注册为「属性」下拉项。
 *
 * 运行：ZZZ_DEV_ROOT=E:/zzz_HP npx vite-node scripts/test-custom-buff-stat-keys.mjs
 */
import assert from 'node:assert/strict'

import {
  BUFF_STAT_KEYS,
  addStat,
  createEmptyBuffEffect,
  isCustomBuffStatKey,
  normalizeBuffEffect,
  resolveEffectsToMods,
} from '../src/utils/buffEffect.ts'
import {
  BUFF_STAT_ZONES,
  buffStatLabelOf,
  buffStatUnitOf,
  buffStatZoneOf,
  findBuffStatZoneById,
  registerCustomBuffStatZones,
} from '../src/utils/buffStatZones.ts'
import { createEmptyBuffStatModifiers } from '../src/utils/calculatorUi.ts'
import {
  getRuntimeZoneDefinitions,
  setRuntimeZoneDefinitions,
} from '../src/zones/schemeSource.ts'

let passed = 0
let failed = 0
function check(name, run) {
  try {
    run()
    passed += 1
    console.log(`  PASS  ${name}`)
  } catch (error) {
    failed += 1
    console.log(`  FAIL  ${name} — ${error instanceof Error ? error.message : String(error)}`)
  }
}

console.log('[1] 自定义键格式')

check('合法 slug 通过', () => {
  assert.equal(isCustomBuffStatKey('custom:eliteDmgBonus'), true)
  assert.equal(isCustomBuffStatKey('custom:elite_dmg-bonus.1'), true)
})

check('中文 / 空 slug / 数字开头 / 超长拒绝', () => {
  assert.equal(isCustomBuffStatKey('custom:中文'), false)
  assert.equal(isCustomBuffStatKey('custom:'), false)
  assert.equal(isCustomBuffStatKey('custom:1abc'), false)
  assert.equal(isCustomBuffStatKey(`custom:${'a'.repeat(65)}`), false)
})

check('内置键不是 custom', () => {
  assert.equal(isCustomBuffStatKey('dmgBonus'), false)
  assert.equal(isCustomBuffStatKey(undefined), false)
  assert.equal(BUFF_STAT_KEYS.some((key) => isCustomBuffStatKey(key)), false)
})

console.log('[2] addStat')

check('custom 缺失时初始化并写入', () => {
  const mods = addStat(createEmptyBuffStatModifiers(), 'custom:eliteDmgBonus', 30)
  assert.equal(mods.custom.eliteDmgBonus, 30)
})

check('custom 同键累加', () => {
  let mods = addStat(createEmptyBuffStatModifiers(), 'custom:eliteDmgBonus', 30)
  mods = addStat(mods, 'custom:eliteDmgBonus', -12.5)
  assert.equal(mods.custom.eliteDmgBonus, 17.5)
})

check('内置键写入不受 custom 影响', () => {
  let mods = addStat(createEmptyBuffStatModifiers(), 'dmgBonus', 40)
  mods = addStat(mods, 'custom:eliteDmgBonus', 30)
  assert.equal(mods.dmgBonus, 40)
  assert.equal(mods.custom.eliteDmgBonus, 30)
  assert.equal(mods.critRate, 0)
})

check('custom 键不影响内部内置键计数', () => {
  assert.equal(
    BUFF_STAT_KEYS.every((key) => key !== 'eliteDmgBonus'),
    true,
    '自定义键不应出现在内置键列表里',
  )
})

console.log('[3] 自定义乘区注册')

const builtinZoneCount = BUFF_STAT_ZONES.length

check('注册后 BUFF_STAT_ZONES 包含自定义 zone', () => {
  registerCustomBuffStatZones([{ key: 'eliteDmgBonus', label: '对精英增伤' }])
  assert.equal(BUFF_STAT_ZONES.length, builtinZoneCount + 1)
  const zone = findBuffStatZoneById('zone:custom:eliteDmgBonus')
  assert.ok(zone, '未找到自定义 zone')
  assert.deepEqual(
    { label: zone.label, tier: zone.tier, stat: zone.stat },
    { label: '对精英增伤', tier: 3, stat: 'custom:eliteDmgBonus' },
  )
})

check('buffStatZoneOf 命中 custom 前缀反查', () => {
  const zone = buffStatZoneOf('custom:eliteDmgBonus')
  assert.equal(zone?.id, 'zone:custom:eliteDmgBonus')
})

check('重复注册幂等（含带前缀写法）', () => {
  registerCustomBuffStatZones([{ key: 'eliteDmgBonus', label: '重复' }])
  registerCustomBuffStatZones([{ key: 'custom:eliteDmgBonus', label: '重复' }])
  assert.equal(BUFF_STAT_ZONES.length, builtinZoneCount + 1)
  assert.equal(buffStatZoneOf('custom:eliteDmgBonus')?.label, '对精英增伤')
})

check('非法 slug 不注册', () => {
  registerCustomBuffStatZones([{ key: '中文' }, { key: '' }])
  assert.equal(BUFF_STAT_ZONES.length, builtinZoneCount + 1)
})

check('custom 键的 label / unit 回落注册表与 %', () => {
  assert.equal(buffStatLabelOf('custom:eliteDmgBonus'), '对精英增伤')
  assert.equal(buffStatUnitOf('custom:eliteDmgBonus'), 'percent')
  assert.equal(buffStatLabelOf('dmgBonus'), '增伤')
})

console.log('[4] 效果应用')

check('custom stat 的效果写入 mods.custom.eliteDmgBonus = 30', () => {
  const effect = createEmptyBuffEffect({
    id: 'eff-custom-1',
    applyTarget: 'self',
    kind: 'fixed',
    stat: 'custom:eliteDmgBonus',
    value: 30,
  })
  const mods = resolveEffectsToMods([effect], { applyTarget: 'self' })
  assert.equal(mods.custom.eliteDmgBonus, 30)
  assert.equal(mods.dmgBonus, 0)
})

check('内置效果与 custom 效果并行加总', () => {
  const custom = createEmptyBuffEffect({
    id: 'eff-custom-2',
    applyTarget: 'team',
    kind: 'fixed',
    stat: 'custom:eliteDmgBonus',
    value: 15,
  })
  const builtin = createEmptyBuffEffect({
    id: 'eff-builtin-1',
    applyTarget: 'team',
    kind: 'fixed',
    stat: 'dmgBonus',
    value: 20,
  })
  const mods = resolveEffectsToMods([custom, builtin], { applyTarget: 'team' })
  assert.equal(mods.custom.eliteDmgBonus, 15)
  assert.equal(mods.dmgBonus, 20)
})

console.log('[5] 读写不丢 custom stat')

check('normalizeBuffEffect 保留 custom stat', () => {
  const effect = normalizeBuffEffect({
    id: 'eff-custom-3',
    applyTarget: 'self',
    kind: 'fixed',
    stat: 'custom:eliteDmgBonus',
    value: 30,
  })
  assert.equal(effect?.stat, 'custom:eliteDmgBonus')
  assert.equal(effect?.value, 30)
})

check('非法 custom 前缀回落 dmgBonus（旧兼容口径）', () => {
  const effect = normalizeBuffEffect({
    id: 'eff-custom-4',
    applyTarget: 'self',
    kind: 'fixed',
    stat: 'custom:中文',
    value: 30,
  })
  assert.equal(effect?.stat, 'dmgBonus')
})

console.log('[6] 运行时乘区定义 → 属性注册')

check('定义表 stats 登记后进入「属性」下拉，getRuntimeZoneDefinitions 保留定义', () => {
  const before = BUFF_STAT_ZONES.length
  const definition = {
    zoneKey: 'custom:eliteBonus',
    label: '对精英增伤区',
    sortOrder: 10,
    primitive: 'percentSum',
    params: { statKeys: ['eliteDmgBonus'] },
    stats: [{ key: 'eliteDmgBonus', label: '对精英增伤', valueType: 'percent', sign: 'both' }],
    version: 1,
  }
  setRuntimeZoneDefinitions([definition])
  assert.equal(getRuntimeZoneDefinitions().length, 1)
  assert.equal(BUFF_STAT_ZONES.length, before, '同一增益键已注册，保持幂等')
  const zone = buffStatZoneOf('custom:eliteDmgBonus')
  assert.equal(zone?.id, 'zone:custom:eliteDmgBonus')
  assert.equal(zone?.label, '对精英增伤')
})

check('定义表 stats 为空 / 脏数据不影响内置目录', () => {
  const builtinCount = BUFF_STAT_ZONES.length
  setRuntimeZoneDefinitions([
    { zoneKey: 'custom:empty', label: '无增益键', sortOrder: 0, primitive: 'percentSum', stats: null, version: 1 },
    {
      zoneKey: 'custom:dirty',
      label: '脏数据',
      sortOrder: 0,
      primitive: 'percentSum',
      stats: [{ label: '缺 key' }, { key: '中文' }],
      version: 1,
    },
  ])
  assert.equal(BUFF_STAT_ZONES.length, builtinCount)
})

console.log(`\n${failed === 0 ? '✅ all passed' : '❌ failed'}（${passed} passed / ${failed} failed）`)
if (failed) process.exit(1)
