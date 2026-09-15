/**
 * 官方预设词条库：来源优先级与脏数据防护（步骤 33）、新建库起点与冻结（步骤 35）。
 *
 * 口径（用户 2026-09-12 拍板）：官方预设的唯一来源＝数据库，用户侧只读；
 * 用户自己的词条库仍在 localStorage。代码里的构造器**暂时**留作兜底
 *（用户原话「丢掉等会再说」），故这里同时钉住两条路。
 * 2026-09-13（步骤 35）：新建的库把官方预设**复制**进来（独立，此后官方更新不影响它）；
 * 「跟随」只留给历史库。
 *
 * 运行：npx vite-node scripts/test-affix-preset-source.mjs
 */
import {
  AFFIX_PRESET_GROUPS,
  activeAffixLibrarySet,
  addCustomAffixLibraryEntry,
  coerceAffixLibraryState,
  convertAffixLibraryStateToCopy,
  createAffixLibrarySet,
  createAffixLibraryStateForOrigin,
  createDefaultAffixLibraryState,
  createDefaultAffixLibraryStore,
  createPresetAffixLibraryEntries,
  exportAffixLibrarySet,
  freezePendingAffixLibrarySets,
  importAffixLibrarySet,
  isUsingServerAffixPreset,
  loadAffixLibraryStore,
  normalizeAffixLibraryStateForSave,
  presetAffixEntriesBase,
  presetAffixGroupsBase,
  resolveAffixLibrary,
  resolveAffixLibraryAll,
  restoreAffixLibraryDefaults,
  saveAffixLibraryStore,
  setAffixLibraryEntryEnabled,
  setServerAffixPreset,
  skippedServerPresetEntries,
  stripRetiredHiddenPanelAffixFromDefaultCopy,
  updateAffixLibraryEntry,
} from '../src/utils/affixLibrary.ts'

/**
 * localStorage 桩：本文件要验证「冻结 / 写盘归一」这些真的落盘的行为（node 里没有 localStorage，
 * 没有桩的话读写会静默失败，测的就成了另一条路径）。只在进程内有效，各测试文件各自独立。
 */
const memoryStorage = new Map()
globalThis.localStorage = {
  getItem: (key) => (memoryStorage.has(key) ? memoryStorage.get(key) : null),
  setItem: (key, value) => void memoryStorage.set(key, String(value)),
  removeItem: (key) => void memoryStorage.delete(key),
  clear: () => memoryStorage.clear(),
  key: (index) => [...memoryStorage.keys()][index] ?? null,
  get length() {
    return memoryStorage.size
  },
}

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
      { id: 'srv:2', label: '服务端条目乙', target: 'panel:critRate', perRoll: 5, cap: 0, group: '副词条', rollCost: 1, enabledByDefault: false },
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

// ---------- 5. 新建即独立（复制预设）+ 过渡态自动冻结 ----------
console.log('\n[5] 新建即独立 + 过渡态冻结')
{
  // 官方那份到手后，新建「预设词条方案」= 把当时那份整份复制进本库
  setServerAffixPreset({
    entries: [
      { id: 'off:1', label: '官方甲', target: 'panel:dmgBonus', perRoll: 12, cap: 1, group: '副词条', rollCost: 1, enabledByDefault: true },
      { id: 'off:2', label: '官方乙', target: 'panel:critRate', perRoll: 5, cap: 0, group: '副词条', rollCost: 1, enabledByDefault: false },
    ],
    groups: [
      { name: '副词条', cap: 0 },
      { name: '官方专属组', cap: 2 },
    ],
  })
  const fromCopy = createAffixLibraryStateForOrigin('copy')
  check('起点「预设词条方案」：origin = copy', fromCopy.origin === 'copy')
  check('起点「预设词条方案」：条目整份进本库（可直接改，不是覆盖层）',
    fromCopy.customEntries.length === 2 &&
      resolveAffixLibraryAll(fromCopy).length === 2 &&
      Object.keys(fromCopy.overrides).length === 0,
    `${fromCopy.customEntries.length} 条 copy / ${resolveAffixLibraryAll(fromCopy).length} 条可见`)
  check('起点「预设词条方案」：分组一并复制',
    fromCopy.groups.length === 2,
    fromCopy.groups.map((g) => g.name).join(', '))

  // 冻结的关键断言：官方改 / 增条目与分组，独立库一条都不动
  setServerAffixPreset({
    entries: [
      { id: 'off:9', label: '官方后加的', target: 'panel:dmgBonus', perRoll: 9, cap: 1, group: '副词条', rollCost: 1, enabledByDefault: true },
    ],
    groups: [{ name: '副词条', cap: 0 }],
  })
  check('独立库：官方条目变了，本库一条不变（也不是"官方后加的"）',
    resolveAffixLibraryAll(fromCopy).length === 2 &&
      !resolveAffixLibraryAll(fromCopy).some((e) => e.id === 'off:9'),
    resolveAffixLibraryAll(fromCopy).map((e) => e.id).join(', '))
  check('独立库：官方分组变了也不动',
    fromCopy.groups.length === 2 && fromCopy.groups.some((g) => g.name === '官方专属组'),
    fromCopy.groups.map((g) => g.name).join(', '))

  // 时机不对：官方那份还没到时**不建**（拿代码兜底冒充官方复制一份，之后就再也纠正不回来）
  setServerAffixPreset(null)
  let tooEarlyError = ''
  try {
    createAffixLibraryStateForOrigin('copy')
  } catch (error) {
    tooEarlyError = String(error && error.message)
  }
  check('官方那份没到 → 拒绝新建（不拿兜底冒充官方）',
    tooEarlyError.includes('官方预设还没取到'), tooEarlyError || '(没有抛错)')
  check('官方那份没到 → 空配置照建不误（不依赖官方数据）',
    createAffixLibraryStateForOrigin('empty').origin === 'empty')
  check('官方那份没到 → 冻结服务不动手', freezePendingAffixLibrarySets() === null)

  // 老存档里那种「跟随」的库：官方那份一到就自动冻成独立（不再跟随）
  setServerAffixPreset(null)
  let legacyStore = createDefaultAffixLibraryStore()
  legacyStore = createAffixLibrarySet(legacyStore, '老库', createDefaultAffixLibraryState())
  check('老库起步是过渡态（还没法冻）',
    activeAffixLibrarySet(legacyStore).state.origin === 'follow')
  setServerAffixPreset({
    entries: [
      { id: 'off:real', label: '官方真数据', target: 'panel:dmgBonus', perRoll: 7, cap: 1, group: '副词条', rollCost: 1, enabledByDefault: true },
    ],
    groups: [{ name: '副词条', cap: 0 }],
  })
  const frozenStore = freezePendingAffixLibrarySets()
  const frozenSet = frozenStore ? activeAffixLibrarySet(frozenStore) : null
  check('官方那份到达 → 老库被冻成独立',
    frozenSet != null && frozenSet.state.origin === 'copy',
    frozenSet ? frozenSet.state.origin : 'null')
  check('冻的是官方那份真数据（不是代码兜底）',
    frozenSet != null &&
      resolveAffixLibraryAll(frozenSet.state).length === 1 &&
      resolveAffixLibraryAll(frozenSet.state)[0].id === 'off:real',
    frozenSet ? resolveAffixLibraryAll(frozenSet.state).map((e) => e.id).join(', ') : 'null')
  check('冻过之后没有可冻的库 → 不动手', freezePendingAffixLibrarySets() === null)

  // 写盘归一：老库那份「官方还没到」时读进来的状态，写回去时不该退化成「跟随」
  setServerAffixPreset(null)
  const stale = createDefaultAffixLibraryState() // 过渡态（官方那份还没到）
  check('写盘归一：官方那份没到 → 原样写（仍是过渡态）',
    normalizeAffixLibraryStateForSave(stale).origin === 'follow')
  setServerAffixPreset({
    entries: [
      { id: 'off:3', label: '官方丙', target: 'panel:dmgBonus', perRoll: 6, cap: 1, group: '副词条', rollCost: 1, enabledByDefault: true },
    ],
    groups: [{ name: '副词条', cap: 0 }],
  })
  const savedNorm = normalizeAffixLibraryStateForSave(stale)
  check('写盘归一：官方那份到了 → 写回去时冻成独立（否则会静默撤销冻结）',
    savedNorm.origin === 'copy' &&
      savedNorm.customEntries.length === 1 &&
      resolveAffixLibraryAll(savedNorm)[0].id === 'off:3',
    `${savedNorm.origin} / ${savedNorm.customEntries.length} 条`)

  // 空配置：一条预设都不加载
  const fromEmpty = createAffixLibraryStateForOrigin('empty')
  check('起点「空配置」：origin = empty', fromEmpty.origin === 'empty')
  check('起点「空配置」：0 条条目', resolveAffixLibraryAll(fromEmpty).length === 0,
    String(resolveAffixLibraryAll(fromEmpty).length))
  check('起点「空配置」：0 个分组（预设组不得凭空出现）',
    fromEmpty.groups.length === 0, fromEmpty.groups.map((g) => g.name).join(', '))

  // 写盘后再读回来（补组发生在读盘路径上）：自建的组出现，预设组仍不出现
  const withCustom = addCustomAffixLibraryEntry(fromEmpty, {
    label: '自建一条',
    target: 'panel:dmgBonus',
    perRoll: 12,
    cap: 1,
    group: '我的组',
    rollCost: 1,
    enabledByDefault: true,
  })
  const reread = coerceAffixLibraryState(withCustom)
  check('空配置 + 自建 → 全部 1 条', resolveAffixLibraryAll(withCustom).length === 1,
    resolveAffixLibraryAll(withCustom).map((e) => e.label).join(', '))
  check('自建的组被补进组表，预设组仍不出现',
    reread.groups.length === 1 && reread.groups[0].name === '我的组',
    reread.groups.map((g) => `${g.name}:${g.cap}`).join(', '))
  check('空配置照样读盘不丢标记', reread.origin === 'empty')

  // 老存档（步骤 35 之前）没有 origin，只有 includePreset → 按它推断
  const legacy = coerceAffixLibraryState({
    customEntries: [],
    enabledOverride: {},
    overrides: {},
    removedEntryIds: [],
    groups: [],
  })
  check('老存档（两个字段都没有）→ 跟随官方，条目数 = 预设数',
    legacy.origin === 'follow' &&
      resolveAffixLibraryAll(legacy).length === presetAffixEntriesBase().length,
    `origin=${legacy.origin} 条数=${resolveAffixLibraryAll(legacy).length}`)
  const legacyEmpty = coerceAffixLibraryState({
    includePreset: false,
    customEntries: [],
    enabledOverride: {},
    overrides: {},
    removedEntryIds: [],
    groups: [],
  })
  check('老存档 includePreset: false → 空配置',
    legacyEmpty.origin === 'empty' && resolveAffixLibraryAll(legacyEmpty).length === 0,
    `origin=${legacyEmpty.origin} 条数=${resolveAffixLibraryAll(legacyEmpty).length}`)

  // 恢复默认保留起点
  check('恢复默认：空配置库仍是空配置',
    restoreAffixLibraryDefaults('empty').origin === 'empty' &&
      resolveAffixLibraryAll(restoreAffixLibraryDefaults('empty')).length === 0)
  check('恢复默认：独立库按当前官方预设重新复制一份',
    restoreAffixLibraryDefaults('copy').origin === 'copy' &&
      resolveAffixLibraryAll(restoreAffixLibraryDefaults('copy')).length === 1,
    String(resolveAffixLibraryAll(restoreAffixLibraryDefaults('copy')).length))

  // 冻成独立：把当前生效那份复制进本库，条目与勾选保持原样
  const followWithEdits = setAffixLibraryEntryEnabled(
    updateAffixLibraryEntry(createAffixLibraryStateForOrigin('follow'), 'off:3', { label: '我改过的名字' }),
    'off:3',
    true,
  )
  const beforeCount = resolveAffixLibraryAll(followWithEdits).length
  const frozen = convertAffixLibraryStateToCopy(followWithEdits)
  check('冻成独立：origin = copy', frozen.origin === 'copy')
  check('冻成独立：条目数与转换前一致',
    resolveAffixLibraryAll(frozen).length === beforeCount,
    `${resolveAffixLibraryAll(frozen).length} vs ${beforeCount}`)
  check('冻成独立：改过的名字保住',
    resolveAffixLibraryAll(frozen).some((e) => e.label === '我改过的名字'))
  check('冻成独立：勾选状态保住（那条仍参与）',
    resolveAffixLibrary(frozen).length === 1, String(resolveAffixLibrary(frozen).length))
  check('冻成独立：覆盖与删除记录已清空（条目归本库）',
    Object.keys(frozen.overrides).length === 0 && frozen.removedEntryIds.length === 0)
  setServerAffixPreset({
    entries: [
      { id: 'off:6', label: '官方己', target: 'panel:dmgBonus', perRoll: 8, cap: 1, group: '副词条', rollCost: 1, enabledByDefault: true },
    ],
    groups: [{ name: '副词条', cap: 0 }],
  })
  check('冻成独立后：官方再变也不影响它',
    resolveAffixLibraryAll(frozen).length === beforeCount &&
      resolveAffixLibraryAll(frozen).some((e) => e.id === 'off:3'))

  // 导出 → 导入 round-trip：独立库的导出是自足的（带条目），origin 不丢
  let store = createDefaultAffixLibraryStore()
  store = createAffixLibrarySet(store, '独立库', createAffixLibraryStateForOrigin('copy'))
  const exported = exportAffixLibrarySet(store)
  setServerAffixPreset({
    entries: [
      { id: 'off:8', label: '导出之后官方才加的', target: 'panel:dmgBonus', perRoll: 7, cap: 1, group: '副词条', rollCost: 1, enabledByDefault: true },
    ],
    groups: [{ name: '副词条', cap: 0 }],
  })
  const imported = importAffixLibrarySet(createDefaultAffixLibraryStore(), exported, 'new')
  const importedState = activeAffixLibrarySet(imported.store).state
  check('导出/导入 round-trip：origin = copy 不丢',
    !imported.error && importedState.origin === 'copy',
    imported.error ?? 'ok')
  check('导出/导入 round-trip：条目自带（导出时那份 off:6，导出后官方加的 off:8 不在）',
    resolveAffixLibraryAll(importedState).length === 1 &&
      resolveAffixLibraryAll(importedState)[0].id === 'off:6',
    resolveAffixLibraryAll(importedState).map((e) => e.id).join(', '))
}

console.log('\n[6] 用户侧「默认」副本同步去掉隐藏局外条目')
{
  const keep = {
    id: 'substat:atkPercent',
    label: '局外攻击力%',
    target: 'panel:atkPercent',
    perRoll: 3,
    cap: 0,
    group: '副词条',
    rollCost: 1,
    enabledByDefault: true,
  }
  const dropReduce = {
    id: 'panel:reduceDefense',
    label: '减防%',
    target: 'panel:reduceDefense',
    perRoll: 30,
    cap: 1,
    group: '副词条',
    rollCost: 1,
    enabledByDefault: false,
  }
  const dropResPen = {
    id: 'panel:resPen',
    label: '抗性穿透%',
    target: 'panel:resPen',
    perRoll: 24,
    cap: 1,
    group: '副词条',
    rollCost: 1,
    enabledByDefault: false,
  }
  const copyState = {
    origin: 'copy',
    customEntries: [keep, dropReduce, dropResPen],
    enabledOverride: { 'panel:reduceDefense': true },
    overrides: {},
    removedEntryIds: [],
    groups: [{ name: '副词条', cap: 0 }],
    removedGroupNames: [],
  }
  const store = {
    version: 2,
    activeId: 'set:1',
    sets: [
      {
        id: 'set:1',
        name: '默认',
        state: copyState,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'set:2',
        name: '我的配装',
        state: { ...copyState, customEntries: [dropReduce] },
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  }
  const synced = stripRetiredHiddenPanelAffixFromDefaultCopy(store)
  const defaultIds = resolveAffixLibraryAll(synced.sets[0].state).map((entry) => entry.id)
  check(
    '默认副本去掉减防和抗穿，留下攻击%',
    defaultIds.length === 1 && defaultIds[0] === 'substat:atkPercent',
    defaultIds.join(', '),
  )
  check(
    '其它库名不改',
    resolveAffixLibraryAll(synced.sets[1].state).some((entry) => entry.id === 'panel:reduceDefense'),
  )
  saveAffixLibraryStore(store)
  const loaded = loadAffixLibraryStore()
  const loadedDefault = loaded.sets.find((set) => set.name === '默认')
  check(
    '载入写盘后默认副本已同步',
    loadedDefault != null &&
      resolveAffixLibraryAll(loadedDefault.state).every((entry) => entry.id === 'substat:atkPercent') &&
      !resolveAffixLibraryAll(loadedDefault.state).some((entry) => entry.id === 'panel:reduceDefense'),
    loadedDefault ? resolveAffixLibraryAll(loadedDefault.state).map((entry) => entry.id).join(', ') : 'missing',
  )
}

// ---------- 收尾：清空，别把状态带给后续 import ----------
setServerAffixPreset(null)

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
