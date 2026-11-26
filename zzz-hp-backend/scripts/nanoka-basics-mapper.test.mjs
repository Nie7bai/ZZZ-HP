/**
 * nanoka 基础数据映射（`src/services/nanoka/nanokaBasicsMapper.js`）自测。
 *
 * 运行：node --test scripts/nanoka-basics-mapper.test.mjs
 *
 * 夹具：开发目录缓存的 **nanoka 真实响应**（不联网）：
 *   D:/WB_agent_out/ZZZ-HP/artifacts/nanoka-probe/cache/char-<tag>-<id>.json
 *   D:/WB_agent_out/ZZZ-HP/artifacts/nanoka-probe/cache/weapon-<tag>-<id>.json
 *   D:/WB_agent_out/ZZZ-HP/artifacts/nanoka-probe/cache/character-index-<tag>.json
 * 缓存目录不存在时，依赖夹具的用例会跳过（可用 `NANOKA_CACHE` 指定目录）；纯函数用例恒跑。
 *
 * 断言里的数值已人工核对，必须逐位相符（口径见 tools/nanoka-scan.mjs）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ADV_MAP,
  ELEMENT_CONSTANTS,
  collectAgentUnsupported,
  collectWengineUnsupported,
  diffNanokaIndexAgainstLocal,
  mapAgentDetail,
  mapWengineDetail,
  normalizeElement,
  normalizeName,
  propToStat,
  stripTags,
  suggestWengineId,
} from '../src/services/nanoka/nanokaBasicsMapper.js'
import { collectNanokaEntry } from '../src/services/nanokaBasicsService.js'
import nanokaBasicsRoutes from '../src/routes/nanokaBasicsRoutes.js'
import { requireAdmin } from '../src/middleware/requireAdmin.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const CACHE =
  process.env.NANOKA_CACHE ?? path.resolve(here, '../../../../ZZZ-HP/artifacts/nanoka-probe/cache')

const cacheNames = fs.existsSync(CACHE) ? fs.readdirSync(CACHE) : []
const SKIP = cacheNames.length ? false : `未找到 nanoka 缓存夹具：${CACHE}`

/** 夹具文件名带 build tag（`char-3.3.12_19566749-1041.json`），tag 会变，所以按前缀 + id 找 */
function findFixture(prefix, id) {
  const name = cacheNames.find((f) => f.startsWith(`${prefix}-`) && f.endsWith(`-${id}.json`))
  return name ? path.join(CACHE, name) : null
}

function readFixture(prefix, id) {
  const file = findFixture(prefix, id)
  assert.ok(file, `缺少夹具 ${prefix}-*-${id}.json（${CACHE}）`)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function readCharIndex() {
  const name = cacheNames.find((f) => f.startsWith('character-index-') && f.endsWith('.json'))
  assert.ok(name, `缺少夹具 character-index-*.json（${CACHE}）`)
  return JSON.parse(fs.readFileSync(path.join(CACHE, name), 'utf8'))
}

// ---------------------------------------------------------------- 纯函数

test('normalizeElement：去掉「属性」后缀，命中映射表', () => {
  assert.equal(normalizeElement('风属性'), '风')
  assert.equal(normalizeElement('电属性'), '电')
  assert.equal(normalizeElement('物理'), '物理')
  assert.equal(normalizeElement('流明'), '流明')
  assert.equal(normalizeElement(null), '')
})

test('normalizeName：去「」/空格/·/：并转小写', () => {
  assert.equal(normalizeName('「11号」'), '11号')
  assert.equal(normalizeName('卡吕冬 · 之子'), '卡吕冬之子')
  assert.equal(normalizeName('Soldier 11'), 'soldier11')
  assert.equal(normalizeName(null), '')
})

test('propToStat：按中文名 + 单位判定目标键', () => {
  assert.deepEqual(propToStat('基础攻击力', '{0:0.#}'), { key: 'atk', percent: false })
  assert.deepEqual(propToStat('攻击力', '{0:0.#%}'), { key: 'atkPercent', percent: true })
  assert.deepEqual(propToStat('生命值', '{0:0.#}'), { key: 'hp', percent: false })
  assert.deepEqual(propToStat('生命值', '{0:0.#%}'), { key: 'hpPercent', percent: true })
  assert.deepEqual(propToStat('防御力', '{0:0.#}'), { key: 'def', percent: false })
  assert.deepEqual(propToStat('暴击率', '{0:0.#%}'), { key: 'critRate', percent: true })
  assert.deepEqual(propToStat('暴击伤害', '{0:0.#%}'), { key: 'critDmg', percent: true })
  assert.deepEqual(propToStat('异常精通', '{0:0.#}'), { key: 'mastery', percent: false })
  assert.deepEqual(propToStat('异常掌控', '{0:0.#}'), { key: 'anomalyControl', percent: false })
  assert.deepEqual(propToStat('穿透率', '{0:0.#%}'), { key: 'penRate', percent: true })
  assert.deepEqual(propToStat('能量自动回复', '{0:0.#%}'), { key: 'energyRegen', percent: true })
  // 仓库 basePanel 没有 impact → 标 unsupported，不写进面板
  assert.deepEqual(propToStat('冲击力', '{0:0.#}'), {
    key: 'impact',
    percent: false,
    unsupported: true,
  })
  assert.equal(propToStat('不认识的属性', '{0:0.#}'), null)
})

test('stripTags / suggestWengineId', () => {
  assert.equal(
    stripTags('发动<color=#FFFFFF>[强化特殊技]</color>时，暴击率提升<color=#2BAD00>8%</color>。'),
    '发动[强化特殊技]时，暴击率提升8%。',
  )
  assert.equal(suggestWengineId('Candlelit Scheme', '烛光诡计'), 'Candlelit_Scheme')
  assert.equal(suggestWengineId('', '烛光诡计'), '')
})

test('ADV_MAP / ELEMENT_CONSTANTS 键位与工具一致', () => {
  assert.equal(ADV_MAP['防御力百分比'], 'externalDefPercent')
  assert.equal(ADV_MAP['异常掌控'], 'anomalyControlPercent')
  assert.equal(ADV_MAP['能量自动回复'], 'energyRegen')
  assert.equal(ADV_MAP['冲击力'], null)
  assert.equal(ELEMENT_CONSTANTS['火'].attributeAnomalyMult, 50)
  assert.equal(ELEMENT_CONSTANTS['风'].anomalyDuration, 30)
  assert.equal(ELEMENT_CONSTANTS['流明'].attributeAnomalyMult, 0)
})

// ---------------------------------------------------------------- 索引比对（不依赖夹具）

test('diffNanokaIndexAgainstLocal：匹配本地条目，排除「未选择」音擎并保留实际多出项', () => {
  const charIndex = {
    1041: { code: 'Soldier 11', zh: '「11号」', element: 201, type: 1, rank: 4 },
    1611: { code: 'Claret', zh: '克拉蕾', element: 203, type: 7, rank: 4 },
    1631: { code: 'Severian', zh: '赛维里安', element: 204, type: 1, rank: 4 },
  }
  const weaponIndex = {
    13022: { zh: '烛光诡计', en: 'Candlelit Scheme', rank: 3, atk: 24, sub: '防御力' },
    14143: { zh: '云霓孤光', en: 'Cloudcleave Radiance', rank: 4, atk: 743, sub: 'CRIT DMG' },
    99999: { zh: '假想音擎', en: 'Fake Wengine', rank: 4, atk: 48, sub: '暴击率' },
  }
  const diff = diffNanokaIndexAgainstLocal({
    charIndex,
    weaponIndex,
    // 1041 靠中文名归一化命中（code 是 "Soldier 11"，与本地 id soldier11 不同）；
    // 1611 靠 code 小写命中本地 id
    agents: [
      { id: 'soldier11', name: '「11号」' },
      { id: 'claret', name: '克拉蕾' },
      { id: 'ghost', name: '幽灵' },
    ],
    wengines: [
      { id: 'Candlelit_Scheme', name: '烛光诡计' },
      { id: 'cloudcleave-radiance', name: '云霓孤光' },
      { id: 'none', name: '未选择' },
      { id: 'Old_One', name: '过气音擎' },
    ],
  })

  assert.deepEqual(diff.counts, {
    missingAgents: 1,
    missingWengines: 1,
    extraLocalAgents: 1,
    extraLocalWengines: 1,
  })
  assert.deepEqual(diff.missingAgents, [
    { nanokaId: '1631', code: 'Severian', zh: '赛维里安', element: '风', profession: '强攻', rarity: 4 },
  ])
  assert.deepEqual(diff.missingWengines, [
    { nanokaId: '99999', zh: '假想音擎', en: 'Fake Wengine', rank: 4, atk: 48, sub: '暴击率' },
  ])
  assert.deepEqual(diff.extraLocalAgents, [{ id: 'ghost', name: '幽灵' }])
  assert.deepEqual(diff.extraLocalWengines, [{ id: 'Old_One', name: '过气音擎' }])
})

test('diffNanokaIndexAgainstLocal：索引缺失直接报错', () => {
  assert.throws(() => diffNanokaIndexAgainstLocal({ weaponIndex: {} }), /character\.json/)
  assert.throws(() => diffNanokaIndexAgainstLocal({ charIndex: {} }), /weapon\.json/)
})

// ---------------------------------------------------------------- 角色面板（本地缓存夹具）

test('角色面板 Lv60 满突破：1041「11号」', { skip: SKIP }, () => {
  const detail = readFixture('char', '1041')
  const indexMeta = readCharIndex()['1041']
  const entry = mapAgentDetail({ detail, nanokaId: '1041', indexMeta })
  assert.equal(entry.id, 'soldier11') // 归一化口径：indexMeta.code 去空格/标点后小写
  assert.equal(entry.name, '「11号」')
  assert.equal(entry.element, '火')
  assert.equal(entry.profession, '强攻')
  assert.equal(entry.basePanel.hp, 7673)
  assert.equal(entry.basePanel.atk, 888)
  assert.equal(entry.basePanel.def, 612)
  assert.equal(entry.basePanel.critRate, 19.4)
  assert.equal(entry.basePanel.critDmg, 50)
  assert.equal(entry.basePanel.mastery, 93)
  assert.equal(entry.basePanel.anomalyControl, 94)
  assert.equal(entry.basePanel.energyRegen, 120) // 120（游戏基准）+ extra 0
})

test('角色面板 energyRegen：120 + extra(能量自动回复)（1031 妮可 = 156）', { skip: SKIP }, () => {
  const detail = readFixture('char', '1031')
  const entry = mapAgentDetail({ detail, nanokaId: '1031', indexMeta: readCharIndex()['1031'] })
  assert.equal(entry.id, 'nicole')
  assert.equal(entry.basePanel.energyRegen, 156)
})

test('角色面板 Lv60 满突破：1611 克拉蕾（含初始锐爆伤害）', { skip: SKIP }, () => {
  const detail = readFixture('char', '1611')
  const entry = mapAgentDetail({ detail, nanokaId: '1611', indexMeta: readCharIndex()['1611'] })
  assert.equal(entry.id, 'claret')
  assert.equal(entry.element, '电')
  assert.equal(entry.profession, '锋御')
  assert.equal(entry.basePanel.hp, 5651)
  assert.equal(entry.basePanel.atk, 626)
  assert.equal(entry.basePanel.def, 441)
  assert.equal(entry.basePanel.critRate, 33.8)
  assert.equal(entry.basePanel.mastery, 79)
  assert.equal(entry.basePanel.anomalyControl, 80)
  assert.equal(entry.basePanel.sharpenCritDmgBonus, 150)
})

test('角色面板 Lv60 满突破：1631 赛维里安（高暴伤）', { skip: SKIP }, () => {
  const detail = readFixture('char', '1631')
  const entry = mapAgentDetail({ detail, nanokaId: '1631', indexMeta: readCharIndex()['1631'] })
  assert.equal(entry.id, 'severian')
  assert.equal(entry.element, '风')
  assert.equal(entry.basePanel.hp, 7826)
  assert.equal(entry.basePanel.atk, 933)
  assert.equal(entry.basePanel.def, 606)
  assert.equal(entry.basePanel.critRate, 5)
  assert.equal(entry.basePanel.critDmg, 78.8)
  assert.equal(entry.basePanel.mastery, 90)
  assert.equal(entry.basePanel.anomalyControl, 91)
})

test('角色面板 Lv60 满突破：1641 菲欧妮（高精通 / 高掌控）', { skip: SKIP }, () => {
  const detail = readFixture('char', '1641')
  const entry = mapAgentDetail({ detail, nanokaId: '1641', indexMeta: readCharIndex()['1641'] })
  assert.equal(entry.id, 'pheony')
  assert.equal(entry.element, '火')
  assert.equal(entry.basePanel.hp, 7673)
  assert.equal(entry.basePanel.atk, 872)
  assert.equal(entry.basePanel.def, 612)
  assert.equal(entry.basePanel.mastery, 118)
  assert.equal(entry.basePanel.anomalyControl, 152)
})

test('角色面板：逐元素常量按 element 查表，未收录元素标注人工定', { skip: SKIP }, () => {
  const detail = readFixture('char', '1011')
  const entry = mapAgentDetail({ detail, nanokaId: '1011', indexMeta: readCharIndex()['1011'] })
  assert.equal(entry.element, '电')
  assert.equal(entry.basePanel.attributeAnomalyMult, ELEMENT_CONSTANTS['电'].attributeAnomalyMult)
  assert.equal(entry.basePanel.turbulenceCompMult, ELEMENT_CONSTANTS['电'].turbulenceCompMult)
  assert.equal(entry.basePanel.mutationCoeff, 0)
  assert.match(entry.constantsSource, /按元素 电 查表/)
})

test('角色 extra：basePanel 没有的「冲击力」进 unsupported，不写进面板', { skip: SKIP }, () => {
  const detail = readFixture('char', '1011')
  const entry = mapAgentDetail({ detail, nanokaId: '1011', indexMeta: readCharIndex()['1011'] })
  assert.ok(!('impact' in entry.basePanel))
  const dropped = collectAgentUnsupported(detail)
  assert.equal(dropped.length, 1)
  assert.equal(dropped[0].name, '冲击力')
  assert.match(dropped[0].reason, /impact/)
})

// ---------------------------------------------------------------- 音擎（本地缓存夹具）

test('音擎满级：13022 烛光诡计（主属性防御 → baseDef，baseAtk 记 0）', { skip: SKIP }, () => {
  const detail = readFixture('weapon', '13022')
  const entry = mapWengineDetail({
    detail,
    nanokaId: '13022',
    indexMeta: { zh: detail.name, en: detail.code_name, rank: detail.rarity },
  })
  assert.equal(entry.name, '烛光诡计')
  assert.equal(entry.rarity, 'A')
  assert.equal(entry.profession, '锋御')
  assert.equal(entry.baseAtk, 0)
  assert.equal(entry.baseDef, 356)
  assert.deepEqual(entry.advancedStats, { externalDefPercent: 40 })
  assert.equal(collectWengineUnsupported(detail).length, 0)
  assert.equal(entry.refinementTexts.length, 5)
  assert.ok(!entry.refinementTexts[0].includes('<'))
  assert.match(entry.refinementTexts[0], /强化特殊技/)
})

test('音擎满级：14164 涅槃初翎（S 级，异常掌控 30）', { skip: SKIP }, () => {
  const detail = readFixture('weapon', '14164')
  const entry = mapWengineDetail({
    detail,
    nanokaId: '14164',
    indexMeta: { zh: detail.name, en: detail.code_name, rank: detail.rarity },
  })
  assert.equal(entry.name, '涅槃初翎')
  assert.equal(entry.rarity, 'S')
  assert.equal(entry.baseAtk, 713)
  assert.equal(entry.baseDef, 0)
  assert.deepEqual(entry.advancedStats, { anomalyControlPercent: 30 })
})

test('音擎满级：13005 人为刀俎（能量自动回复 50）', { skip: SKIP }, () => {
  const detail = readFixture('weapon', '13005')
  const entry = mapWengineDetail({
    detail,
    nanokaId: '13005',
    indexMeta: { zh: detail.name, en: detail.code_name, rank: detail.rarity },
  })
  assert.equal(entry.name, '人为刀俎')
  assert.equal(entry.baseAtk, 594)
  assert.equal(entry.baseDef, 0)
  assert.deepEqual(entry.advancedStats, { energyRegen: 50 })
})

test('音擎满级：14001 加农转子（暴击率 20）', { skip: SKIP }, () => {
  const detail = readFixture('weapon', '14001')
  const entry = mapWengineDetail({
    detail,
    nanokaId: '14001',
    indexMeta: { zh: detail.name, en: detail.code_name, rank: detail.rarity },
  })
  assert.equal(entry.name, '加农转子')
  assert.equal(entry.rarity, 'A')
  assert.equal(entry.baseAtk, 594)
  assert.equal(entry.baseDef, 0)
  assert.deepEqual(entry.advancedStats, { critRate: 20 })
})

// ---------------------------------------------------------------- 索引夹具整体比对（不连库）

test('真实 character-index 夹具：已收录角色不再算缺失', { skip: SKIP }, () => {
  const charIndex = readCharIndex()
  const diff = diffNanokaIndexAgainstLocal({
    charIndex,
    weaponIndex: {},
    agents: [
      { id: 'claret', name: '克拉蕾' },
      { id: 'severian', name: '赛维里安' },
      { id: 'pheony', name: '菲欧妮' },
      { id: 'soldier11', name: '「11号」' },
    ],
    wengines: [],
  })
  const missingIds = diff.missingAgents.map((m) => m.nanokaId)
  for (const id of ['1041', '1611', '1631', '1641']) {
    assert.ok(!missingIds.includes(id), `${id} 已收录，不应算缺失`)
  }
  assert.equal(diff.counts.missingAgents, Object.keys(charIndex).length - 4)
  assert.ok(diff.extraLocalAgents.length === 0)
})

// ---------------------------------------------------------------- /scan 与 /collect 的接线与入参

test('nanoka 四个接口的首个中间件都必须是 requireAdmin', () => {
  for (const path of ['/preview', '/apply', '/scan', '/collect']) {
    const layer = nanokaBasicsRoutes.stack.find(
      (entry) =>
        entry.route && entry.route.path === path && Boolean(entry.route.methods.post),
    )
    assert.ok(layer, `缺少路由 POST ${path}`)
    const handlers = layer.route.stack.map((item) => item.handle)
    assert.equal(handlers[0], requireAdmin, `POST ${path} 的首个中间件应为 requireAdmin`)
    assert.equal(handlers.length, 2, `POST ${path} 应只有 requireAdmin + 处理函数`)
  }
})

test('collectNanokaEntry：吃详情 → { entry, unsupported }（不连库）', { skip: SKIP }, () => {
  const detail = readFixture('char', '1611')
  const result = collectNanokaEntry({
    kind: 'agent',
    nanokaId: '1611',
    meta: readCharIndex()['1611'],
    detail,
  })
  assert.equal(result.entry.nanokaId, '1611')
  assert.equal(result.entry.basePanel.sharpenCritDmgBonus, 150)
  assert.deepEqual(result.unsupported, [])
})

test('collectNanokaEntry：kind / nanokaId / detail 缺失时明确报错', () => {
  assert.throws(() => collectNanokaEntry({ kind: 'bangboo' }), /kind/)
  assert.throws(() => collectNanokaEntry({ kind: 'agent', detail: {} }), /nanokaId/)
  assert.throws(() => collectNanokaEntry({ kind: 'agent', nanokaId: '1' }), /详情/)
})
