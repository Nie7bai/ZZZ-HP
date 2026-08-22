/**
 * 运行时验证：方案库角色数与事件数统计
 *
 * 运行：npm run test:history-stats
 */

const storage = new Map()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    get length() {
      return storage.size
    },
    clear: () => storage.clear(),
    getItem: (key) => storage.get(String(key)) ?? null,
    key: (index) => [...storage.keys()][index] ?? null,
    removeItem: (key) => storage.delete(String(key)),
    setItem: (key, value) => storage.set(String(key), String(value)),
  },
})

const { importDamageCalcHistory, listDamageCalcHistory, schemeStats } =
  await import('../src/utils/damageCalcHistory.ts')

let failed = 0
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      期望 ${e}\n      实际 ${a}`}`)
}

check(
  'v3 方案按所有槽位的流程条目计数',
  schemeStats({
    teamSlots: [{ agentId: 'alice' }, { agentId: '' }, { agentId: 'carol' }],
    slots: [
      { prepared: [], flow: [{}, {}] },
      { prepared: [], flow: [] },
      { prepared: [], flow: [{}] },
    ],
  }),
  { charN: 2, skillN: 3 },
)

check(
  'v3 槽位存在时不再读取废弃事件字段',
  schemeStats({
    teamSlots: [],
    slots: [],
    directEvents: [{}, {}],
    anomalyEvents: [{}],
  }),
  { charN: 0, skillN: 0 },
)

check(
  '旧方案没有槽位数据时兼容废弃事件字段',
  schemeStats({
    teamSlots: [{ agentId: 'alice' }],
    directEvents: [{}, {}],
    anomalyEvents: [{}],
  }),
  { charN: 1, skillN: 3 },
)

const importAndReadStats = (entry) => {
  const importResult = importDamageCalcHistory(
    JSON.stringify({
      type: 'zzz-hp-schemes',
      version: 3,
      exportedAt: Date.now(),
      dirs: {},
      schemes: { [entry.id]: entry },
      currentId: entry.id,
      customSkills: [],
    }),
  )
  const importedEntries = listDamageCalcHistory()
  return {
    added: importResult.added,
    skipped: importResult.skipped,
    errors: importResult.errors,
    listed: importedEntries.length,
    stats: importedEntries[0] ? schemeStats(importedEntries[0]) : null,
  }
}

const partialEntryBase = {
  activeSlot: 0,
  selectedBangbooId: 'none',
  bangbooRefine: 1,
  panelCalcMode: 'panel',
  panelState: {},
}
const acceptedPartialStats = {
  added: 1,
  skipped: 0,
  errors: [],
  listed: 1,
  stats: { charN: 1, skillN: 0 },
}

check(
  '导入缺少 flow 的槽位后仍能统计摘要',
  importAndReadStats({
    ...partialEntryBase,
    id: 's:/partial',
    name: 'partial',
    savedAt: 1,
    teamSlots: [{ agentId: 'alice' }],
    slots: [{ prepared: [] }],
  }),
  acceptedPartialStats,
)

check(
  '导入含空角色槽的方案后仍能统计摘要',
  importAndReadStats({
    ...partialEntryBase,
    id: 's:/partial-team',
    name: 'partial-team',
    savedAt: 2,
    teamSlots: [null, { agentId: 'alice' }],
    slots: [],
  }),
  acceptedPartialStats,
)

console.log('')
console.log(failed === 0 ? '全部通过' : `${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
