/**
 * nanoka 招式（技能倍率）映射（`src/services/nanoka/nanokaSkillMapper.js`）自测。
 *
 * 运行：node --test scripts/nanoka-skill-mapper.test.mjs
 *
 * 夹具：开发目录缓存的 **nanoka 真实响应**（不联网）：
 *   D:/WB_agent_out/ZZZ-HP/artifacts/nanoka-probe/cache/char-<tag>-<id>.json
 * 缓存目录不存在时，依赖夹具的用例会跳过（可用 `NANOKA_CACHE` 指定目录）；纯函数用例恒跑。
 *
 * 断言里的 segment 数与 baseMult 已与参照实现的 dry-run 逐条对齐：
 *   node scripts/import-nanoka-skills.mjs --agent soldier11   → segs=21
 *   node scripts/import-nanoka-skills.mjs --agent claret      → segs=25
 * 缓存夹具的 build tag（`3.3.12_19566749`）比 dry-run 时的线上 build（`3.3.12+19629936`）旧，
 * 但同一个角色的倍率逐位相同（该字段是游戏常量，不随 build 变）。
 *
 * 本文件**不连库、不写库**：`planAgentSkillImport` 是纯函数，`existingSkills` 由用例自己造。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildDisplayName,
  computeBaseMultPercent,
  extractDamageSegments,
  mapSkillTypes,
  normalizeSkillName,
  parseCalFormula,
  parseDescDamageDivisor,
  planAgentSkillImport,
  resolveParamDamageType,
  sameOptionalNumber,
  sameSkillTypes,
  shortParamLabel,
  stableSkillId,
  stripSkillTitlePrefix,
} from '../src/services/nanoka/nanokaSkillMapper.js'
import { resolveLocalAgentForNanoka } from '../src/services/nanokaBasicsService.js'
import nanokaBasicsRoutes from '../src/routes/nanokaBasicsRoutes.js'
import { requireAdmin } from '../src/middleware/requireAdmin.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const CACHE =
  process.env.NANOKA_CACHE ?? path.resolve(here, '../../../../ZZZ-HP/artifacts/nanoka-probe/cache')

const cacheNames = fs.existsSync(CACHE) ? fs.readdirSync(CACHE) : []
const SKIP = cacheNames.length ? false : `未找到 nanoka 缓存夹具：${CACHE}`

/** 夹具文件名带 build tag（`char-3.3.12_19566749-1041.json`），tag 会变，所以按前缀 + id 找 */
function readFixture(prefix, id) {
  const name = cacheNames.find((f) => f.startsWith(`${prefix}-`) && f.endsWith(`-${id}.json`))
  assert.ok(name, `缺少夹具 ${prefix}-*-${id}.json（${CACHE}）`)
  return JSON.parse(fs.readFileSync(path.join(CACHE, name), 'utf8'))
}

/** 段列表 → { displayName: baseMult }，便于按名字取断言值 */
function baseMultByName(segments) {
  const map = new Map()
  for (const seg of segments) map.set(seg.displayName, seg.baseMult)
  return map
}

// ---------------------------------------------------------------- 纯函数：倍率口径

test('computeBaseMultPercent：(pct + growth*(L-1))/100，四舍五入到 3 位', () => {
  // CLI 文件头注释里的例子：克拉蕾「锻星·一段」L12
  assert.equal(computeBaseMultPercent(10770, 980, 12), 215.5)
  // L1 就是万分比 ÷ 100
  assert.equal(computeBaseMultPercent(10770, 980, 1), 107.7)
  // 省略 level → 12
  assert.equal(computeBaseMultPercent(3440, 320), 69.6)
  // 脏输入按 0 处理，level 至少 1
  assert.equal(computeBaseMultPercent(null, undefined, 12), 0)
  assert.equal(computeBaseMultPercent(3120, 0, 0), 31.2)
})

test('normalizeSkillName / shortParamLabel / buildDisplayName / stripSkillTitlePrefix', () => {
  // 全角括号与冒号统一、空白去掉（同 displayName 去重就靠它）
  assert.equal(normalizeSkillName('普通攻击：血锻四式·一段'), '普通攻击：血锻四式·一段')
  assert.equal(normalizeSkillName('普通攻击: 血锻四式·一段'), '普通攻击：血锻四式·一段')
  assert.equal(normalizeSkillName('强化特殊技（血华誓）'), '强化特殊技(血华誓)')
  assert.equal(normalizeSkillName(null), '')

  assert.equal(shortParamLabel('伤害倍率'), '')
  assert.equal(shortParamLabel('一段伤害倍率'), '一段')
  assert.equal(shortParamLabel('毁伤伤害倍率'), '毁伤')

  assert.equal(buildDisplayName('普通攻击：血锻四式', '一段伤害倍率'), '普通攻击：血锻四式·一段')
  assert.equal(buildDisplayName('普通攻击：血锻四式', '伤害倍率'), '普通攻击：血锻四式')

  assert.equal(stripSkillTitlePrefix('强化特殊技：盛燃烈火'), '盛燃烈火')
  assert.equal(stripSkillTitlePrefix('烬火追魂'), '烬火追魂')
})

test('stableSkillId：sk-<agent>-nk-<nanokaSkillId>-<slug>，空参名回落 main', () => {
  assert.equal(stableSkillId('severian', '1631001', '伤害倍率'), 'sk-severian-nk-1631001-main')
  assert.equal(stableSkillId('severian', '1631001', '一段伤害倍率'), 'sk-severian-nk-1631001-一段')
  // 参数名里的标点变成 `-`，长度截断到 24，整体不超过 64
  const long = stableSkillId('severian', '1631001', '强化普攻第五段额外伤害倍率')
  assert.match(long, /^sk-severian-nk-1631001-/)
  assert.ok(long.length <= 64)
  assert.ok(!long.includes(' '))
})

test('mapSkillTypes：终结技挂 chain 下按名纠正，强化特殊技带小类', () => {
  assert.deepEqual(mapSkillTypes('chain', '终结技：轰鸣烈焰'), ['ultimate'])
  assert.deepEqual(mapSkillTypes('chain', '连携技：昂扬烈焰'), ['chain'])
  assert.deepEqual(mapSkillTypes('special', '强化特殊技：盛燃烈火'), ['special', 'specialEnhanced'])
  assert.deepEqual(mapSkillTypes('special', '特殊技：烈火'), ['special', 'specialBasic'])
  assert.deepEqual(mapSkillTypes('dodge', '闪避反击：逆火'), ['dodge', 'dodgeCounter'])
  assert.deepEqual(mapSkillTypes('dodge', '冲刺攻击：炽火'), ['dodge', 'dash'])
  assert.deepEqual(mapSkillTypes('basic', '普通攻击：热身火花'), ['basic'])
  assert.deepEqual(mapSkillTypes('assist', '快速支援：火力掩护'), ['assist'])
  assert.deepEqual(mapSkillTypes('unknown-category', '没见过的招'), ['basic'])
})

test('sameSkillTypes / sameOptionalNumber：忽略顺序，空值等价', () => {
  assert.equal(sameSkillTypes(['basic', 'dash'], ['dash', 'basic']), true)
  assert.equal(sameSkillTypes(['basic'], ['basic', 'dash']), false)
  assert.equal(sameSkillTypes(null, []), true)
  assert.equal(sameOptionalNumber(215.5, 215.5), true)
  assert.equal(sameOptionalNumber(null, undefined), true)
  assert.equal(sameOptionalNumber(null, 0), false)
  assert.equal(sameOptionalNumber(undefined, ''), true)
  assert.equal(sameOptionalNumber(1, 1.0000001), true)
  assert.equal(sameOptionalNumber(1, 2), false)
})

// ---------------------------------------------------------------- 异常类倍率（CAL 模板）

test('resolveParamDamageType：异放/耀变/紊乱/乱流 → 对应异常类型', () => {
  assert.equal(resolveParamDamageType('伤害倍率'), 'direct')
  assert.equal(resolveParamDamageType('一段伤害倍率'), 'direct')
  assert.equal(resolveParamDamageType('失衡倍率'), null)
  assert.equal(resolveParamDamageType('异放倍率'), 'anomalyRelease')
  assert.equal(resolveParamDamageType('耀变倍率'), 'radiance')
  assert.equal(resolveParamDamageType('紊乱倍率'), 'disorder')
  assert.equal(resolveParamDamageType('乱流倍率'), 'turbulence')
  assert.equal(resolveParamDamageType('异放伤害倍率'), 'anomalyRelease')
  assert.equal(resolveParamDamageType('能量消耗'), null)
  assert.equal(resolveParamDamageType(''), null)
  // 未识别的异常类参数不能当直伤导入
  assert.equal(resolveParamDamageType('属性异常伤害倍率'), null)
})

test('parseCalFormula：只解析 {CAL:...}，拒绝非四则运算', () => {
  // 菲欧妮「焚罪」异放：225+20*(L-1) → L1 225 / L12 445
  const release = parseCalFormula('{CAL:225+20*(AvatarSkillLevel(0)-1),1,2}%')
  assert.equal(release.evaluate(1), 225)
  assert.equal(release.evaluate(12), 445)
  assert.equal(release.evaluate(14), 485)
  // 蕾米埃尔「垂虹」耀变：200+L*10 → L12 320
  const radiance = parseCalFormula('{CAL:200+AvatarSkillLevel(0)*10,1,2}%')
  assert.equal(radiance.evaluate(1), 210)
  assert.equal(radiance.evaluate(12), 320)
  // 非 CAL / 非法字符
  assert.equal(parseCalFormula('40点'), null)
  assert.equal(parseCalFormula('{CAL:alert(1),1,2}'), null)
})

test('parseDescDamageDivisor：只认整段的 /N 缩放，其它写法保守按 1', () => {
  assert.equal(parseDescDamageDivisor('{Skill:1431018, Prop:1001}'), 1)
  assert.equal(parseDescDamageDivisor('{{Skill:1431018, Prop:1001}/6}'), 6)
  assert.equal(parseDescDamageDivisor('{{Skill:1431018, Prop:1001} / 6}'), 6)
  // 乘号、多个模板、夹其它文字都不是「同 id 多档」的口径，不做缩放
  assert.equal(parseDescDamageDivisor('{Skill:1431018, Prop:1001}*2'), 1)
  assert.equal(parseDescDamageDivisor('共6段{Skill:1431018, Prop:1001}'), 1)
  assert.equal(parseDescDamageDivisor('{CAL:225+20*(AvatarSkillLevel(0)-1),1,2}%'), 1)
  assert.equal(parseDescDamageDivisor(''), 1)
})

test('extractDamageSegments：叶瞬光「明心境·飞光」1 点档按 desc ÷6，与 6 点档不同', () => {
  // 真实 nanoka 形状：两档共用同一个 Skill id 与同一组数值，档位差别只在 desc 的 /6
  const sharedStats = { damage_percentage: 105800, damage_percentage_growth: 9620 }
  const detail = {
    skill: {
      special: {
        description: [
          {
            name: '强化特殊技：明心境·飞光',
            param: [
              {
                name: '消耗1点青溟剑势伤害倍率',
                desc: '{{Skill:1431018, Prop:1001}/6}',
                param: { 1431018: sharedStats },
              },
              {
                name: '消耗6点青溟剑势伤害倍率',
                desc: '{Skill:1431018, Prop:1001}',
                param: { 1431018: sharedStats },
              },
            ],
          },
        ],
      },
    },
  }
  const segments = extractDamageSegments(detail, { level: 12 })
  assert.equal(segments.length, 2)
  const onePoint = segments.find((s) => s.paramName.includes('1点'))
  const sixPoints = segments.find((s) => s.paramName.includes('6点'))
  assert.equal(onePoint.displayName, '强化特殊技：明心境·飞光·消耗1点青溟剑势')
  assert.equal(sixPoints.displayName, '强化特殊技：明心境·飞光·消耗6点青溟剑势')
  assert.equal(sixPoints.baseMult, 2116.2)
  assert.equal(onePoint.baseMult, 352.7)
  assert.equal(onePoint.damagePercentage, 17633.333)
  assert.equal(onePoint.damagePercentageGrowth, 1603.333)
  assert.deepEqual(onePoint.skillTypes, ['special', 'specialEnhanced'])
})

test('extractDamageSegments：直伤 + 异放双段，异常段沿用招式名并带 talentKey', () => {
  const detail = {
    skill: {
      basic: {
        description: [
          {
            name: '普通攻击：焚罪',
            param: [
              {
                name: '伤害倍率',
                desc: '{Skill:1641005, Prop:1001}',
                param: {
                  1641005: { damage_percentage: 54730, damage_percentage_growth: 4980 },
                },
              },
              {
                name: '失衡倍率',
                desc: '{Skill:1641005, Prop:1002}',
                param: { 1641005: { main: 27500, growth: 1250 } },
              },
              { name: '异放倍率', desc: '{CAL:225+20*(AvatarSkillLevel(0)-1),1,2}%', param: {} },
            ],
          },
        ],
      },
    },
  }
  const segments = extractDamageSegments(detail, { level: 12 })
  assert.equal(segments.length, 2)
  const direct = segments.find((s) => s.damageType === 'direct')
  assert.equal(direct.displayName, '普通攻击：焚罪')
  assert.equal(direct.baseMult, 1095.1)
  assert.deepEqual(direct.skillTypes, ['basic'])
  const release = segments.find((s) => s.damageType === 'anomalyRelease')
  assert.equal(release.displayName, '普通攻击：焚罪')
  assert.equal(release.baseMult, 445)
  assert.equal(release.damagePercentage, 22500)
  assert.equal(release.damagePercentageGrowth, 2000)
  assert.deepEqual(release.skillTypes, [])
  assert.equal(release.talentKey, 'basic')
  assert.equal(release.calExpression, '225+20*(AvatarSkillLevel(0)-1)')
})

test('planAgentSkillImport：异常段不覆盖人工行；缺失时按类型新建', () => {
  const detail = {
    skill: {
      basic: {
        description: [
          {
            name: '普通攻击：焚罪',
            param: [
              { name: '异放倍率', desc: '{CAL:225+20*(AvatarSkillLevel(0)-1),1,2}%', param: {} },
            ],
          },
        ],
      },
    },
  }
  const subcategories = [{ id: 'sub-basic', agentId: 'pheony', name: '普通攻击：焚罪' }]
  const manual = {
    id: 'manual-rel',
    agentId: 'pheony',
    name: '普通攻击：焚罪·异放',
    damageType: 'anomalyRelease',
    buffAnchorId: 'sub-basic',
    baseMult: 205,
    multSource: null,
  }
  const withManual = planAgentSkillImport({
    agent: { id: 'pheony', element: '火' },
    detail,
    existingSkills: [manual],
    subcategories,
  })
  assert.equal(withManual.create.length, 0)
  assert.equal(withManual.overwrite.length, 0)
  assert.equal(withManual.existingManual.length, 1)
  assert.equal(withManual.existingManual[0].id, 'manual-rel')
  assert.equal(withManual.existingManual[0].importedBaseMult, 445)

  const created = planAgentSkillImport({
    agent: { id: 'pheony', element: '火' },
    detail,
    existingSkills: [],
    subcategories,
  })
  assert.equal(created.create.length, 1)
  const doc = created.create[0]
  assert.equal(doc.damageType, 'anomalyRelease')
  assert.equal(doc.name, '普通攻击：焚罪')
  assert.equal(doc.baseMult, 445)
  assert.equal(doc.buffAnchorId, 'sub-basic')
  assert.equal(doc.radianceTalentKey, 'basic')
})

// ---------------------------------------------------------------- 段抽取（本地缓存夹具）

test('extractDamageSegments：1041「11号」21 段，倍率与 CLI dry-run 逐条对齐', { skip: SKIP }, () => {
  const segments = extractDamageSegments(readFixture('char', '1041'), { level: 12 })
  // CLI：`--agent soldier11` → segs=21
  assert.equal(segments.length, 21)

  const byName = baseMultByName(segments)
  assert.equal(byName.get('普通攻击：热身火花·一段'), 69.6)
  assert.equal(byName.get('普通攻击：热身火花·四段'), 426.8)
  assert.equal(byName.get('普通攻击：火力镇压·五段'), 883.9)
  assert.equal(byName.get('普通攻击：火力镇压·强化普攻第五段额外'), 166.4)
  assert.equal(byName.get('冲刺攻击：炽火'), 137.6)
  assert.equal(byName.get('闪避反击：逆火'), 524.9)
  assert.equal(byName.get('强化特殊技：盛燃烈火'), 1350.4)
  assert.equal(byName.get('连携技：昂扬烈焰'), 1265)
  assert.equal(byName.get('终结技：轰鸣烈焰'), 4206.2)
  assert.equal(byName.get('支援突击：重燃'), 767.6)

  const first = segments[0]
  assert.equal(first.category, 'basic')
  assert.equal(first.paramName, '一段伤害倍率')
  assert.equal(first.nanokaSkillId, '1041001')
  assert.equal(first.damagePercentage, 3440)
  assert.equal(first.damagePercentageGrowth, 320)
  assert.deepEqual(first.skillTypes, ['basic'])
  assert.equal(first.titleCore, '热身火花')
})

test('extractDamageSegments：只取「伤害倍率」且跳过失衡；同名段去重保留首条', { skip: SKIP }, () => {
  const segments = extractDamageSegments(readFixture('char', '1041'), { level: 12 })
  for (const seg of segments) {
    assert.ok(seg.paramName.includes('伤害倍率'), `${seg.paramName} 应含「伤害倍率」`)
    assert.ok(!seg.paramName.includes('失衡'), `${seg.paramName} 不应是失衡段`)
  }
  const names = segments.map((seg) => normalizeSkillName(seg.displayName))
  assert.equal(new Set(names).size, names.length, 'displayName 归一化后不应重复')
})

test('extractDamageSegments：1611 克拉蕾 25 段（与 CLI dry-run 一致）', { skip: SKIP }, () => {
  const segments = extractDamageSegments(readFixture('char', '1611'), { level: 12 })
  assert.equal(segments.length, 25)
  const byName = baseMultByName(segments)
  // CLI 注释里的例子：锻星·一段 = 215.5
  assert.equal(byName.get('普通攻击：血华誓·锻星·一段'), 215.5)
  assert.equal(byName.get('普通攻击：血锻四式·一段'), 109.4)
  assert.equal(byName.get('特殊技：血华誓·斩金断铁·毁伤'), 1625.6)
  assert.equal(byName.get('终结技：血华誓·千锤百炼'), 4504.8)
  assert.equal(byName.get('支援突击：血华誓·琢形'), 1713.2)
})

test('extractDamageSegments：赛维里安 17 段 / 菲欧妮 19 段（含 2 条异放）', { skip: SKIP }, () => {
  const severian = extractDamageSegments(readFixture('char', '1631'), { level: 12 })
  assert.equal(severian.length, 17)
  const sevByName = baseMultByName(severian)
  assert.equal(sevByName.get('普通攻击：疾锋·一段'), 131.4)
  assert.equal(sevByName.get('普通攻击：苍风影猎'), 4056.1)
  assert.equal(sevByName.get('终结技：戮灭的风灾'), 5353.8)
  assert.equal(sevByName.get('登场技：清场时刻'), 309.2)

  const pheony = extractDamageSegments(readFixture('char', '1641'), { level: 12 })
  assert.equal(pheony.length, 19)
  const pheByName = baseMultByName(pheony)
  assert.equal(pheByName.get('普通攻击：裁生·一段'), 32.1)
  assert.equal(pheByName.get('终结技：万死重明'), 3627.8)
  assert.equal(pheByName.get('支援突击：再生疗法'), 853.3)
  // 异常类段：异放倍率来自 desc 的 CAL 模板（L12：焚罪 445 / 烬火追魂 597）
  const release = pheony.filter((seg) => seg.damageType === 'anomalyRelease')
  assert.equal(release.length, 2)
  assert.deepEqual(release.map((seg) => seg.baseMult).sort((a, b) => a - b), [445, 597])
  assert.ok(release.every((seg) => seg.skillTypes.length === 0))
  assert.ok(release.every((seg) => seg.talentKey === 'basic' || seg.talentKey === 'chainUltimate'))
})

test('extractDamageSegments：detail 缺失 / 空对象返回空数组（不抛）', () => {
  assert.deepEqual(extractDamageSegments(null), [])
  assert.deepEqual(extractDamageSegments({}), [])
  assert.deepEqual(extractDamageSegments({ skill: { basic: {} } }), [])
})

// ---------------------------------------------------------------- planAgentSkillImport

test('planAgentSkillImport：本地 0 条的 severian → 全新建、不覆盖', { skip: SKIP }, () => {
  const detail = readFixture('char', '1631')
  const plan = planAgentSkillImport({
    agent: { id: 'severian', name: '赛维里安', element: '风' },
    detail,
    existingSkills: [],
    subcategories: [],
  })

  assert.ok(plan.create.length > 0, 'severian 应全部走新建')
  assert.equal(plan.overwrite.length, 0)
  assert.equal(plan.skipSame.length, 0)
  assert.equal(plan.unmatchedLocal.length, 0)
  assert.equal(plan.create.length, 17)

  const doc = plan.create[0]
  assert.equal(doc.id, 'sk-severian-nk-1631001-一段')
  assert.equal(doc.agentId, 'severian')
  assert.equal(doc.name, '普通攻击：疾锋·一段')
  assert.equal(doc.damageType, 'direct')
  assert.deepEqual(doc.skillTypes, ['basic'])
  assert.equal(doc.buffAnchorId, null) // 没有小类 → 不新建小类，锚点为空
  assert.equal(doc.baseMult, 131.4)
  assert.equal(doc.baseMultFactor, 100)
  assert.equal(doc.settlementMult, 0)
  assert.equal(doc.multSource, 'nanoka')
  assert.equal(doc.element, '风')
  assert.equal(doc.ownerGroupId, null)
  assert.equal(doc.note, '')
  assert.equal(doc.damagePercentage, 6540)
  assert.equal(doc.damagePercentageGrowth, 600)

  const ids = plan.create.map((item) => item.id)
  assert.equal(new Set(ids).size, ids.length, '新建 id 不应重复')
  for (const item of plan.create) assert.match(item.id, /^sk-severian-nk-\d+-/)
})

test('planAgentSkillImport：覆盖只改倍率，overwrite 项不带 element（保护手工修正）', { skip: SKIP }, () => {
  const detail = readFixture('char', '1041')
  // 造一条既有招式：名字与 nanoka 段一致，但倍率是旧的、element 是人工改过的「电」
  // （真实本地 element 是「火」——这里就是要验证不会被 agent.element 冲掉）
  const existing = {
    id: 'sk-soldier11-nk-1041001-一段',
    agentId: 'soldier11',
    name: '普通攻击：热身火花·一段',
    damageType: 'direct',
    skillTypes: ['basic', 'manualTag'],
    buffAnchorId: 'sub-manual-anchor',
    baseMult: 1,
    baseMultFactor: 55,
    settlementMult: 7,
    element: '电',
    ownerGroupId: 'group-manual',
    note: '人工备注',
    multSource: null,
  }

  const plan = planAgentSkillImport({
    agent: { id: 'soldier11', name: '「11号」', element: '火' },
    detail,
    existingSkills: [existing],
    subcategories: [],
  })

  assert.equal(plan.overwrite.length, 1)
  assert.equal(plan.create.length, 20) // 21 段 - 1 段命中既有
  assert.equal(plan.skipSame.length, 0)

  const item = plan.overwrite[0]
  // 条目本身只描述倍率变化，**不含** element / skillTypes / buffAnchorId
  assert.ok(!('element' in item), 'overwrite 项不应带 element')
  assert.ok(!('skillTypes' in item))
  assert.ok(!('buffAnchorId' in item))
  assert.equal(item.id, existing.id)
  assert.equal(item.from, 1)
  assert.equal(item.to, 69.6)
  assert.deepEqual(item.changed, {
    baseMult: true,
    damagePercentage: true,
    damagePercentageGrowth: true,
    multSource: true,
  })

  // 写库载荷（策略 B）保留本库字段：element / skillTypes / buffAnchorId / note / settlement / factor
  const doc = item.doc
  assert.equal(doc.element, '电', '手工修正的 element 必须保留')
  assert.deepEqual(doc.skillTypes, ['basic', 'manualTag'])
  assert.equal(doc.buffAnchorId, 'sub-manual-anchor')
  assert.equal(doc.note, '人工备注')
  assert.equal(doc.settlementMult, 7)
  assert.equal(doc.baseMultFactor, 55)
  assert.equal(doc.ownerGroupId, 'group-manual')
  assert.equal(doc.name, existing.name)
  assert.equal(doc.multSource, 'nanoka')
  assert.equal(doc.baseMult, 69.6)
  assert.equal(doc.damagePercentage, 3440)
  assert.equal(doc.damagePercentageGrowth, 320)
})

test('planAgentSkillImport：倍率与来源都一致 → skipSame；本库残留进 unmatchedLocal', { skip: SKIP }, () => {
  const detail = readFixture('char', '1041')
  const segments = extractDamageSegments(detail, { level: 12 })
  const existingSkills = segments.map((seg) => ({
    id: stableSkillId('soldier11', seg.nanokaSkillId, seg.paramName),
    agentId: 'soldier11',
    name: seg.displayName,
    baseMult: seg.baseMult,
    damagePercentage: seg.damagePercentage,
    damagePercentageGrowth: seg.damagePercentageGrowth,
    multSource: 'nanoka',
    element: '火',
  }))
  existingSkills.push({
    id: 'sk-soldier11-disorder-xxxx',
    agentId: 'soldier11',
    name: '紊乱',
    baseMult: 0,
    element: '火',
  })
  // 别的角色的招式不该被算进来
  existingSkills.push({ id: 'sk-claret-1', agentId: 'claret', name: '紊乱', baseMult: 0 })

  const plan = planAgentSkillImport({
    agent: { id: 'soldier11', name: '「11号」', element: '火' },
    detail,
    existingSkills,
    subcategories: [],
  })

  assert.equal(plan.skipSame.length, 21)
  assert.equal(plan.overwrite.length, 0)
  assert.equal(plan.create.length, 0)
  assert.deepEqual(plan.unmatchedLocal, [
    { id: 'sk-soldier11-disorder-xxxx', name: '紊乱', baseMult: 0 },
  ])
})

test('planAgentSkillImport：既有小类命中时 create 带 buffAnchorId，但不新建小类', { skip: SKIP }, () => {
  const detail = readFixture('char', '1641')
  const plan = planAgentSkillImport({
    agent: { id: 'pheony', name: '菲欧妮', element: '火' },
    detail,
    existingSkills: [],
    subcategories: [
      { id: 'sub-other-agent', agentId: 'claret', name: '坠阳' },
      { id: 'sub-pheony-zhu', agentId: 'pheony', name: '坠阳' },
    ],
  })
  const hit = plan.create.find((doc) => doc.name === '强化特殊技：坠阳')
  assert.ok(hit, '应包含「强化特殊技：坠阳」')
  assert.equal(hit.buffAnchorId, 'sub-pheony-zhu')
  // 别的角色的小类不会被借用
  for (const doc of plan.create) {
    if (doc.name === '强化特殊技：眩焰') assert.equal(doc.buffAnchorId, null)
  }
})

test('planAgentSkillImport：缺少 agent.id 直接报错', () => {
  assert.throws(() => planAgentSkillImport({ agent: {}, detail: {} }), /角色 id/)
})

// ---------------------------------------------------------------- 本地角色解析（纯函数）

test('resolveLocalAgentForNanoka：code 归一化对本地 id，再对中文名', () => {
  const agents = [
    { id: 'soldier11', name: '「11号」', element: '火' },
    { id: 'claret', name: '克拉蕾', element: '电' },
    { id: 'severian', name: '赛维里安', element: '风' },
  ]
  // 「Soldier 11」→ 去空格小写 = soldier11（code 与本地 id 不同形也能命中）
  assert.equal(
    resolveLocalAgentForNanoka({ agents, meta: { code: 'Soldier 11', zh: '「11号」' } })?.id,
    'soldier11',
  )
  assert.equal(resolveLocalAgentForNanoka({ agents, meta: { code: 'Claret' } })?.id, 'claret')
  // code 对不上时回落中文名
  assert.equal(
    resolveLocalAgentForNanoka({ agents, meta: { code: 'WhoKnows', zh: '赛维里安' } })?.id,
    'severian',
  )
  // 都对不上 → null（接口层报 400，不猜）
  assert.equal(resolveLocalAgentForNanoka({ agents, meta: { code: 'Nobody', zh: '查无此人' } }), null)
  assert.equal(resolveLocalAgentForNanoka({ agents: [], meta: { code: 'Claret' } }), null)
})

// ---------------------------------------------------------------- 接口接线与入参校验

test('招式三件套的首个中间件都必须是 requireAdmin', () => {
  const expected = [
    { method: 'get', path: '/agent-skill-gaps' },
    { method: 'post', path: '/collect-skills' },
    { method: 'post', path: '/apply-skills' },
  ]
  for (const { method, path } of expected) {
    const layer = nanokaBasicsRoutes.stack.find(
      (entry) => entry.route && entry.route.path === path && Boolean(entry.route.methods[method]),
    )
    assert.ok(layer, `缺少路由 ${method.toUpperCase()} ${path}`)
    const handlers = layer.route.stack.map((item) => item.handle)
    assert.equal(handlers[0], requireAdmin, `${method.toUpperCase()} ${path} 的首个中间件应为 requireAdmin`)
    assert.equal(handlers.length, 2, `${method.toUpperCase()} ${path} 应只有 requireAdmin + 处理函数`)
  }
})

test('既有 /preview /apply /scan /collect 仍是 requireAdmin（没被改动）', () => {
  for (const path of ['/preview', '/apply', '/scan', '/collect']) {
    const layer = nanokaBasicsRoutes.stack.find(
      (entry) => entry.route && entry.route.path === path && Boolean(entry.route.methods.post),
    )
    assert.ok(layer, `缺少路由 POST ${path}`)
    assert.equal(layer.route.stack[0].handle, requireAdmin)
  }
})
