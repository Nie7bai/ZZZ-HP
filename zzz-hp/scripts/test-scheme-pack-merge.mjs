/**
 * 方案包：自包含导出、覆盖导入组库、合并导入改名/换号
 *
 * 运行：npm run test:scheme-pack-merge
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

const {
  exportDamageCalcHistory,
  importDamageCalcHistory,
  listAllDamageCalcHistory,
  getLoadedSchemeId,
  setLoadedSchemeId,
} = await import('../src/utils/damageCalcHistory.ts')
const { loadCustomSkills } = await import('../src/utils/skillLibrary.ts')
const { loadCustomSkillGroups } = await import('../src/utils/skillGroup.ts')

let failed = 0
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      期望 ${e}\n      实际 ${a}`}`)
}

const SCHEME_KEY = 'zzz-hp-damage-calc-history'
const GROUPS_KEY = 'zzz-hp-skill-groups-custom'
const DRAFT_KEY = 'zzz-hp-damage-calc-draft'

function reset() {
  storage.clear()
}

function readSchemeStore() {
  return JSON.parse(localStorage.getItem(SCHEME_KEY) || '{"dirs":{},"schemes":{}}')
}

function skill(id, extra = {}) {
  return {
    id,
    name: extra.name ?? '重击',
    agentId: extra.agentId ?? 'alice',
    source: 'custom',
    damageType: extra.damageType ?? 'direct',
    skillTypes: extra.skillTypes ?? ['basic'],
    buffAnchorId: extra.buffAnchorId ?? null,
    baseMult: extra.baseMult ?? 100,
    note: extra.note ?? '',
  }
}

function group(id, extra = {}) {
  return {
    id,
    agentId: extra.agentId ?? 'alice',
    name: extra.name ?? '连段',
    note: extra.note ?? '',
    source: extra.source ?? 'custom',
    members: extra.members ?? [
      { skillId: extra.memberSkillId ?? 'skill-a', order: 0, count: 1, includeInFlow: true },
    ],
  }
}

function scheme(name, extra = {}) {
  const folder = extra.folder ?? ''
  const path = folder ? `${folder}/${name}` : `/${name}`
  return {
    id: extra.id ?? `s:${path}`,
    name,
    savedAt: extra.savedAt ?? 1,
    teamSlots: extra.teamSlots ?? [{ agentId: 'alice' }],
    activeSlot: 0,
    selectedBangbooId: 'none',
    bangbooRefine: 1,
    panelCalcMode: 'panel',
    panelState: extra.panelState ?? {},
    directEventModeName: extra.tag ?? name,
    folder,
    order: extra.order ?? 0,
    slots: extra.slots ?? [
      {
        prepared: extra.prepared ?? [],
        flow: extra.flow ?? [],
      },
    ],
  }
}

function pack(extra = {}) {
  const body = {
    type: 'zzz-hp-schemes',
    version: 4,
    exportedAt: 1,
    dirs: extra.dirs ?? {},
    schemes: extra.schemes ?? {},
    currentId: extra.currentId ?? null,
    customSkills: extra.customSkills ?? [],
  }
  if (!extra.omitGroups) body.skillGroups = extra.skillGroups ?? []
  return JSON.stringify(body)
}

function names() {
  return listAllDamageCalcHistory()
    .map((item) => item.name)
    .sort()
}

function preparedSkillIds() {
  return listAllDamageCalcHistory().flatMap((entry) =>
    (entry.slots ?? []).flatMap((slot) =>
      (slot.prepared ?? []).map((row) => row.skillId).filter(Boolean),
    ),
  )
}

// ---------- 导出 ----------
reset()
importDamageCalcHistory(
  pack({
    dirs: { '/叶琉千': { createdAt: 1, order: 3 } },
    schemes: {
      's:/叶琉千/标准轴': scheme('标准轴', {
        folder: '/叶琉千',
        prepared: [{ id: 'prep-g', skillGroupId: 'sg-preset-1', skillSource: 'preset' }],
      }),
    },
  }),
)
const exported = JSON.parse(
  exportDamageCalcHistory([
    group('sg-preset-1', { name: '预设连段', source: 'preset', memberSkillId: 'dev-1' }),
  ]),
)
check(
  '导出包含被引用的预设组文档',
  exported.skillGroups?.some((item) => item.id === 'sg-preset-1' && item.name === '预设连段'),
  true,
)

reset()
importDamageCalcHistory(
  pack({
    schemes: {
      's:/缺招': scheme('缺招', {
        prepared: [{ id: 'prep-miss', skillId: 'dev-6_2019', skillSource: 'custom' }],
      }),
    },
  }),
)
const warned = JSON.parse(exportDamageCalcHistory())
check(
  '引用缺失出现在 warnings',
  warned.warnings?.some((line) => String(line).includes('dev-6_2019') && String(line).includes('本机库没有')),
  true,
)

// ---------- 覆盖 ----------
reset()
localStorage.setItem(
  GROUPS_KEY,
  JSON.stringify([group('sg-leftover', { name: '旧组' })]),
)
const overwrite = importDamageCalcHistory(
  pack({
    schemes: { 's:/新方案': scheme('新方案') },
    customSkills: [skill('skill-pack')],
    skillGroups: [
      group('sg-pack', { name: '包内组' }),
      group('sg-preset-1', { name: '预设连段', source: 'preset' }),
    ],
  }),
  { presetGroupIds: ['sg-preset-1'] },
)
check('覆盖导入成功', overwrite.errors, [])
check(
  '覆盖后自建组库等于包（预设 id 不重复写入）',
  loadCustomSkillGroups().map((item) => item.id).sort(),
  ['sg-pack'],
)
check('覆盖后旧自建组被清掉', loadCustomSkillGroups().some((item) => item.id === 'sg-leftover'), false)

reset()
localStorage.setItem(GROUPS_KEY, JSON.stringify([group('sg-keep-legacy', { name: '旧包保留' })]))
const legacy = importDamageCalcHistory(
  pack({
    schemes: { 's:/旧包': scheme('旧包') },
    omitGroups: true,
  }),
)
check('旧包无 skillGroups 仍能覆盖导入', legacy.errors, [])
check(
  '旧包覆盖不碰自建组库',
  loadCustomSkillGroups().map((item) => item.id),
  ['sg-keep-legacy'],
)

// ---------- 合并：方案重名 ----------
reset()
importDamageCalcHistory(
  pack({
    dirs: { '/叶琉千': { createdAt: 1, order: 5 } },
    schemes: {
      's:/叶琉千/标准轴': scheme('标准轴', { folder: '/叶琉千', tag: 'local', order: 2, savedAt: 10 }),
    },
    currentId: 's:/叶琉千/标准轴',
  }),
)
setLoadedSchemeId('s:/叶琉千/标准轴')
localStorage.setItem(DRAFT_KEY, '{"savedAt":1}')
const firstMerge = importDamageCalcHistory(
  pack({
    dirs: {
      '/叶琉千': { createdAt: 9, order: 99 },
      '/外来': { createdAt: 2, order: 1 },
    },
    schemes: {
      's:/叶琉千/标准轴': scheme('标准轴', { folder: '/叶琉千', tag: 'incoming', order: 8 }),
    },
    customSkills: [skill('skill-in')],
  }),
  { mode: 'merge' },
)
check('合并重名改成「标准轴-复制」', names(), ['标准轴', '标准轴-复制'])
check('本机原方案仍在', listAllDamageCalcHistory().some((item) => item.name === '标准轴' && item.directEventModeName === 'local'), true)
check('合并改名计数', firstMerge.renamed, 1)
check('合并不改当前打开的方案', getLoadedSchemeId(), 's:/叶琉千/标准轴')
check('合并不删工作草稿', localStorage.getItem(DRAFT_KEY) != null, true)
check('目录并集写入外来目录', Boolean(readSchemeStore().dirs['/外来']), true)
check('本机目录 order 不变', readSchemeStore().dirs['/叶琉千']?.order, 5)

const secondMerge = importDamageCalcHistory(
  pack({
    dirs: { '/叶琉千': { createdAt: 9, order: 99 } },
    schemes: {
      's:/叶琉千/标准轴': scheme('标准轴', { folder: '/叶琉千', tag: 'incoming', order: 8 }),
    },
    customSkills: [skill('skill-in')],
  }),
  { mode: 'merge' },
)
check('再合一次不复制', names(), ['标准轴', '标准轴-复制'])
check('再合一次 skippedIdentical', secondMerge.skipped >= 1, true)

// ---------- 合并：招式指纹 / 换号 ----------
reset()
importDamageCalcHistory(
  pack({
    schemes: { 's:/本机': scheme('本机') },
    customSkills: [skill('skill-local', { name: '同内容' })],
  }),
)
const reused = importDamageCalcHistory(
  pack({
    schemes: {
      's:/外来': scheme('外来', {
        prepared: [{ id: 'prep-1', skillId: 'skill-incoming', skillSource: 'custom' }],
      }),
    },
    customSkills: [skill('skill-incoming', { name: '同内容' })],
  }),
  { mode: 'merge' },
)
check('同内容不同 id 的招式复用本机', loadCustomSkills().map((item) => item.id), ['skill-local'])
check('复用后准备行改成本机 id', preparedSkillIds().includes('skill-local'), true)
check('复用后不保留外来 id', preparedSkillIds().includes('skill-incoming'), false)
check('同内容招式不新增', reused.customSkillCount, 0)

reset()
importDamageCalcHistory(
  pack({
    schemes: { 's:/本机': scheme('本机') },
    customSkills: [skill('skill-same', { name: '本机招', baseMult: 10 })],
  }),
)
const remapped = importDamageCalcHistory(
  pack({
    schemes: {
      's:/外来': scheme('外来', {
        prepared: [{ id: 'prep-2', skillId: 'skill-same', skillSource: 'custom' }],
        flow: [
          {
            id: 'flow-1',
            ownerAgentId: 'alice',
            preparedId: 'prep-2',
            count: 1,
            staggerPhase: 'normal',
            critMode: 'avg',
            memberOverrides: [{ memberKey: '0:skill-same', skillId: 'skill-same' }],
          },
        ],
      }),
    },
    customSkills: [skill('skill-same', { name: '外来招', baseMult: 99 })],
  }),
  { mode: 'merge' },
)
const incomingPreparedId = listAllDamageCalcHistory()
  .find((item) => item.name === '外来')
  ?.slots?.[0]?.prepared?.[0]?.skillId
const incomingOverride = listAllDamageCalcHistory()
  .find((item) => item.name === '外来')
  ?.slots?.[0]?.flow?.[0]?.memberOverrides?.[0]
check('同 id 不同内容的招式换号', remapped.remappedSkills, 1)
check('换号后准备行跟着改', incomingPreparedId !== 'skill-same' && Boolean(incomingPreparedId), true)
check('换号后流程覆盖跟着改', incomingOverride?.skillId === incomingPreparedId, true)
check('换号后 memberKey 跟着改', incomingOverride?.memberKey === `0:${incomingPreparedId}`, true)
check('本机原招式仍在', loadCustomSkills().some((item) => item.id === 'skill-same' && item.baseMult === 10), true)

reset()
if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nall passed')
