/**
 * 官方预设词条库：来源优先级与脏数据防护（步骤 33）。
 *
 * 口径（用户 2026-09-12 拍板）：官方预设的唯一来源＝数据库，用户侧只读；
 * 用户自己的词条库仍在 localStorage。代码里的构造器**暂时**留作兜底
 *（用户原话「丢掉等会再说」），故这里同时钉住两条路。
 *
 * 运行：npx vite-node scripts/test-affix-preset-source.mjs
 */
import {
  AFFIX_PRESET_GROUPS,
  createDefaultAffixLibraryState,
  createPresetAffixLibraryEntries,
  isUsingServerAffixPreset,
  presetAffixEntriesBase,
  presetAffixGroupsBase,
  resolveAffixLibrary,
  resolveAffixLibraryAll,
  setServerAffixPreset,
  skippedServerPresetEntries,
} from '../src/utils/affixLibrary.ts'

let passed = 0
let failed = 0

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// ---------- 1. 没有服务端数据时：回落代码构造器 ----------
console.log('\n[1] 服务端为空 → 代码兜底')
{
  setServerAffixPreset(null)
  const entries = presetAffixEntriesBase()
  const byConstructor = createPresetAffixLibraryEntries()
  check('回落构造器：条数与构造器一致', entries.length === byConstructor.length,
    `${entries.length} vs ${byConstructor.length}`)
  check('回落构造器：分组与常量一致',
    JSON.stringify(presetAffixGroupsBase()) === JSON.stringify(AFFIX_PRESET_GROUPS),
    presetAffixGroupsBase().map((g) => `${g.name}:${g.cap}`).join(', '))
  check('isUsingServerAffixPreset() = false', isUsingServerAffixPreset() === false)
}

// ---------- 2. 有服务端数据时：以服务端为准（哪怕内容与构造器不同） ----------
console.log('\n[2] 服务端有数据 → 以服务端为准')
{
  setServerAffixPreset({
    entries: [
      { id: 'srv:1', label: '服务端条目甲', target: 'panel:dmgBonus', perRoll: 12, cap: 2, group: '副词条', rollCost: 1, enabledByDefault: true },
      { id: 'srv:2', label: '服务端条目乙', target: 'stat:critRate', perRoll: 5, cap: 0, group: '副词条', rollCost: 1, enabledByDefault: false },
    ],
    groups: [
      { name: '副词条', cap: 0 },
      { name: '服务端新组', cap: 2 },
    ],
  })
  const entries = presetAffixEntriesBase()
  check('用服务端条目（id 全部来自服务端）',
    entries.length === 2 && entries.every((e) => e.id.startsWith('srv:')),
    entries.map((e) => e.id).join(', '))
  check('用服务端分组（含代码里没有的新组）',
    presetAffixGroupsBase().some((g) => g.name === '服务端新组'),
    presetAffixGroupsBase().map((g) => `${g.name}:${g.cap}`).join(', '))
  check('isUsingServerAffixPreset() = true', isUsingServerAffixPreset() === true)

  // 用户库的解析结果跟着换：默认启用只算服务端那条 true
  const state = createDefaultAffixLibraryState()
  const all = resolveAffixLibraryAll(state)
  const enabled = resolveAffixLibrary(state)
  check('词条库全量 = 服务端 2 条', all.length === 2, String(all.length))
  check('参与计算的 = 服务端里 enabledByDefault 的那条',
    enabled.length === 1 && enabled[0].id === 'srv:1',
    enabled.map((e) => e.id).join(', '))
  check('新建库的默认分组来自服务端',
    state.groups.some((g) => g.name === '服务端新组'),
    state.groups.map((g) => g.name).join(', '))
}

// ---------- 3. 脏数据：认不出的 target 必须跳过并计数 ----------
console.log('\n[3] 脏数据防护')
{
  const skipped = setServerAffixPreset({
    entries: [
      { id: 'ok:1', label: '好条目', target: 'panel:dmgBonus', perRoll: 10, cap: 1, group: '副词条', rollCost: 1, enabledByDefault: true },
      { id: 'bad:target', label: '前端不认识的字段', target: 'panel:不存在的字段', perRoll: 10, cap: 1, group: '副词条', rollCost: 1, enabledByDefault: true },
      { id: 'bad:target2', label: '连前缀都不对', target: 'weird:thing', perRoll: 10, cap: 1, group: '副词条', rollCost: 1, enabledByDefault: true },
      { label: '没有 id', target: 'panel:dmgBonus', perRoll: 10, cap: 1, group: '副词条', rollCost: 1, enabledByDefault: true },
    ],
    groups: [{ name: '副词条', cap: 0 }, { bad: true }],
  })
  check('跳过 3 条脏条目并计数', skipped === 3, `skipped=${skipped}`)
  check('skippedServerPresetEntries 暴露同一个数',
    skippedServerPresetEntries.value === 3, String(skippedServerPresetEntries.value))
  check('只有合法那条进了预设',
    presetAffixEntriesBase().length === 1 && presetAffixEntriesBase()[0].id === 'ok:1',
    presetAffixEntriesBase().map((e) => e.id).join(', '))
  check('脏分组被跳过（只留合法组）',
    presetAffixGroupsBase().length === 1 && presetAffixGroupsBase()[0].name === '副词条',
    presetAffixGroupsBase().map((g) => g.name).join(', '))
}

// ---------- 4. 服务端条目全不合法 → 回落构造器（不能变成空库） ----------
console.log('\n[4] 全不合法 → 回落构造器')
{
  setServerAffixPreset({
    entries: [{ id: 'x', label: 'x', target: 'panel:不存在', perRoll: 1, cap: 1, group: '', rollCost: 1, enabledByDefault: true }],
    groups: [],
  })
  check('条目为空时不采用服务端快照', isUsingServerAffixPreset() === false)
  check('回落到构造器（不是空库）',
    presetAffixEntriesBase().length === createPresetAffixLibraryEntries().length,
    String(presetAffixEntriesBase().length))
}

// ---------- 5. 收尾：清空，别把状态带给后续 import ----------
setServerAffixPreset(null)

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
