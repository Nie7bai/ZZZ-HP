/**
 * 自定义乘区增益键（`custom:<key>`）：前端 Buff 效果 → 后端扁平修饰表的纯函数口径。
 *
 * 覆盖：
 * - `effectsToFlatMods` 把 custom stat 写入 `custom` map（百分点加总）；
 * - `flatModsToEffects` 反向还原效果；
 * - `normalizeEffectList` 允许合法 `custom:<slug>`，非法前缀整条拒绝（不静默回落 dmgBonus）；
 * - 内置键行为不变。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUFF_STAT_KEYS,
  createEmptyBuffStatModifiers,
  isCustomBuffStatKey,
  normalizeBuffStatModifiers,
} from '../src/utils/calculatorBuffFields.js'
import {
  effectsToFlatMods,
  flatModsToEffects,
  normalizeEffectList,
} from '../src/services/calculatorBuffService.js'

function effect(overrides = {}) {
  return {
    id: 'eff-1',
    applyTarget: 'self',
    kind: 'fixed',
    stat: 'custom:eliteDmgBonus',
    value: 30,
    enabledDefault: true,
    ...overrides,
  }
}

test('isCustomBuffStatKey：合法 slug 通过，内置键与非法格式拒绝', () => {
  assert.equal(isCustomBuffStatKey('custom:eliteDmgBonus'), true)
  assert.equal(isCustomBuffStatKey('custom:elite_dmg-bonus.1'), true)
  assert.equal(isCustomBuffStatKey('custom:中文'), false)
  assert.equal(isCustomBuffStatKey('custom:'), false)
  assert.equal(isCustomBuffStatKey('custom:1abc'), false)
  assert.equal(isCustomBuffStatKey(`custom:${'a'.repeat(65)}`), false)
  assert.equal(isCustomBuffStatKey('dmgBonus'), false)
  assert.equal(isCustomBuffStatKey(''), false)
  assert.equal(isCustomBuffStatKey(null), false)
})

test('BUFF_STAT_KEYS 仍只含内置键', () => {
  assert.equal(BUFF_STAT_KEYS.includes('custom:eliteDmgBonus'), false)
  assert.equal(
    BUFF_STAT_KEYS.every((key) => !isCustomBuffStatKey(key)),
    true,
  )
})

test('effectsToFlatMods：custom stat → custom.eliteDmgBonus = 30', () => {
  const mods = effectsToFlatMods([effect()], 'self')
  assert.equal(mods.custom.eliteDmgBonus, 30)
  assert.equal(mods.dmgBonus, 0)
})

test('effectsToFlatMods：多条 custom 效果按 key 加总，内置键并行不受影响', () => {
  const mods = effectsToFlatMods(
    [
      effect(),
      effect({ id: 'eff-2', value: 12.5 }),
      effect({ id: 'eff-3', stat: 'dmgBonus', value: 5 }),
    ],
    'self',
  )
  assert.equal(mods.custom.eliteDmgBonus, 42.5)
  assert.equal(mods.dmgBonus, 5)
})

test('effectsToFlatMods：非本 applyTarget 不计入', () => {
  const mods = effectsToFlatMods([effect({ applyTarget: 'team' })], 'self')
  assert.equal(mods.custom?.eliteDmgBonus, undefined)
})

test('flatModsToEffects：custom map 还原为 `custom:<key>` 效果', () => {
  const mods = createEmptyBuffStatModifiers()
  mods.custom = { eliteDmgBonus: 30, atkPercentBonus: -8 }
  const effects = flatModsToEffects(mods, 'self')
  const byStat = Object.fromEntries(effects.map((item) => [item.stat, item.value]))
  assert.equal(byStat['custom:eliteDmgBonus'], 30)
  assert.equal(byStat['custom:atkPercentBonus'], -8)
  assert.equal(byStat.dmgBonus, undefined)
})

test('effectsToFlatMods → flatModsToEffects 往返保持 custom 值', () => {
  const mods = effectsToFlatMods([effect()], 'self')
  const effects = flatModsToEffects(mods, 'self')
  assert.equal(effects.find((item) => item.stat === 'custom:eliteDmgBonus')?.value, 30)
})

test('normalizeEffectList：合法 custom stat 保留，不回落 dmgBonus', () => {
  const [normalized] = normalizeEffectList([effect()])
  assert.equal(normalized.stat, 'custom:eliteDmgBonus')
  assert.equal(normalized.value, 30)
})

test('normalizeEffectList：非法 custom 前缀整条拒绝', () => {
  for (const stat of ['custom:', 'custom:中文', 'custom:1abc', 'custom:bad key']) {
    const list = normalizeEffectList([effect({ stat })])
    assert.deepEqual(list, [], `stat=${stat} 应被拒绝`)
  }
})

test('normalizeEffectList：未知内置键仍回落 dmgBonus（旧行为不变）', () => {
  const [normalized] = normalizeEffectList([effect({ stat: 'notARealStat' })])
  assert.equal(normalized.stat, 'dmgBonus')
})

test('normalizeBuffStatModifiers：合法 custom map 保留，非法键剔除', () => {
  const mods = normalizeBuffStatModifiers({
    dmgBonus: 10,
    custom: { eliteDmgBonus: 30, '中文': 5, bad: Number.NaN },
  })
  assert.equal(mods.dmgBonus, 10)
  assert.deepEqual(mods.custom, { eliteDmgBonus: 30 })
})

test('normalizeBuffStatModifiers：无 custom 时不落 custom 键', () => {
  const mods = normalizeBuffStatModifiers({ dmgBonus: 10 })
  assert.equal('custom' in mods, false)
})
