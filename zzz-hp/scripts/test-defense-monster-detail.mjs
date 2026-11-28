/**
 * 防卫战往期详细 · 怪物详情弹窗：数据行组装口径 + 图表类别推导 + 接线守卫
 *
 * 运行：npx vite-node scripts/test-defense-monster-detail.mjs
 */
import { readFileSync } from 'node:fs'
import { encodeDefenseBossId } from '../src/utils/defenseId.ts'
import {
  buildDefenseBossChart,
  buildDefenseMonsterDetailRecord,
  DEFENSE_FIFTH_FRONTIER_MONSTER_LEVEL,
  getDefenseMonsterCategory,
  hasDefenseMonsterExistedByMultiplierVersion,
  isDefenseEliteOrBoss,
  resolveDefenseMonsterCategory,
  resolveDefenseMonsterDefaultLevel,
} from '../src/utils/defenseCompare.ts'

let passed = 0
let failed = 0
function check(name, ok, detail) {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function makeEnemy(overrides) {
  return {
    name: '霸主侵蚀体',
    hp: '1,423,183',
    hpValue: 1423183,
    defense: 683,
    staggerTime: 5,
    weakness: '冰、火',
    resistance: '电、无',
    resistanceHigh: '火',
    isBoss: true,
    ...overrides,
  }
}

function makeBossInfo(overrides) {
  return { level: 60, stagger_multiplier: 1.5, stagger_time: 5, ...overrides }
}

console.log('[1] buildDefenseMonsterDetailRecord：防卫战怪物 → 共享数据行')
const baseRecord = buildDefenseMonsterDetailRecord(makeEnemy(), null, makeBossInfo())
check(
  '怪物名 / 血量 / 防御 / 失衡时间 / 弱抗取自 DefenseEnemy',
  baseRecord.boss_name === '霸主侵蚀体' &&
    baseRecord.hp === '1,423,183' &&
    baseRecord.defense === 683 &&
    baseRecord.stagger_time === 5 &&
    baseRecord.weakness === '冰、火' &&
    baseRecord.resistance === '电、无' &&
    baseRecord.resistance_high === '火',
  JSON.stringify(baseRecord),
)
check(
  '等级 / 失衡易伤来自 boss_info（DefenseEnemy 不带）',
  baseRecord.level === 60 && baseRecord.stagger_multiplier === 1.5,
)
check(
  '危局专属字段不填（基础血量 / 血量系数不出现在防卫战数据行）',
  baseRecord.crisis_base_hp === undefined &&
    baseRecord.hp_coeff_label === undefined &&
    baseRecord.hp_coeff_delta_label === undefined,
)
check(
  '无往期出现时不渲染血量膨胀 / 增量行',
  baseRecord.hp_expansion === null && baseRecord.hp_delta_label === null,
)

const compared = buildDefenseMonsterDetailRecord(
  makeEnemy(),
  { diff: 300000, expansion: '+25.0%' },
  makeBossInfo(),
)
check(
  '有往期出现时膨胀与增量按对比结果渲染（与卡片同口径）',
  compared.hp_expansion === '+25.0%' && compared.hp_delta_label === '+300,000',
  `${compared.hp_expansion} / ${compared.hp_delta_label}`,
)
check(
  '负向差值保留负号',
  buildDefenseMonsterDetailRecord(makeEnemy(), { diff: -1200, expansion: '-3.0%' }, null)
    .hp_delta_label === '-1,200',
)

const noBossInfo = buildDefenseMonsterDetailRecord(makeEnemy({ staggerTime: null }), null, null)
check(
  'boss_info 查无记录（含请求失败）时等级 / 失衡易伤 / 失衡时间为 null ⇒ 行隐藏',
  noBossInfo.level === null &&
    noBossInfo.stagger_multiplier === null &&
    noBossInfo.stagger_time === null,
  JSON.stringify(noBossInfo),
)
check(
  '怪物自带失衡时间优先于 boss_info 的回退值',
  buildDefenseMonsterDetailRecord(
    makeEnemy({ staggerTime: 4 }),
    null,
    makeBossInfo({ stagger_time: 5 }),
  ).stagger_time === 4,
)
check(
  '怪物未带失衡时间时回退 boss_info',
  buildDefenseMonsterDetailRecord(
    makeEnemy({ staggerTime: undefined }),
    null,
    makeBossInfo({ stagger_time: 6 }),
  ).stagger_time === 6,
)

const sparse = buildDefenseMonsterDetailRecord(
  { name: '无名小怪', hp: '10,000' },
  null,
  null,
)
check(
  '字段缺失时统一落 null（而非 undefined），对应行不渲染',
  sparse.defense === null &&
    sparse.weakness === null &&
    sparse.resistance === null &&
    sparse.resistance_high === null &&
    sparse.level === null &&
    sparse.stagger_multiplier === null &&
    sparse.stagger_time === null,
  JSON.stringify(sparse),
)

console.log('[1b] resolveDefenseMonsterDefaultLevel：防线默认等级规则（唯一出处）')
check(
  '第五防线（stage 5）查无 boss_info 记录 ⇒ 70',
  resolveDefenseMonsterDefaultLevel(5, null) === DEFENSE_FIFTH_FRONTIER_MONSTER_LEVEL,
  `stage 5 → ${resolveDefenseMonsterDefaultLevel(5, null)}`,
)
check(
  '第一 ~ 第四防线查无记录 ⇒ 1',
  [1, 2, 3, 4].every((stage) => resolveDefenseMonsterDefaultLevel(stage, null) === 1),
  [1, 2, 3, 4]
    .map((stage) => `${stage} → ${resolveDefenseMonsterDefaultLevel(stage, null)}`)
    .join(' / '),
)
check(
  '真实 boss_info 等级优先：第五防线的 60 级怪物不被改写成 70',
  resolveDefenseMonsterDefaultLevel(5, 60) === 60,
)
check(
  '记录里等级恰好是 1 也信任记录（不臆造 70）',
  resolveDefenseMonsterDefaultLevel(5, 1) === 1,
)
check(
  '记录未填等级（0 / undefined）落回防线规则',
  resolveDefenseMonsterDefaultLevel(5, 0) === DEFENSE_FIFTH_FRONTIER_MONSTER_LEVEL &&
    resolveDefenseMonsterDefaultLevel(5, undefined) === DEFENSE_FIFTH_FRONTIER_MONSTER_LEVEL,
)
check(
  '拿不到防线（null / undefined）时按最保守的 1',
  resolveDefenseMonsterDefaultLevel(null, null) === 1 &&
    resolveDefenseMonsterDefaultLevel(undefined, null) === 1,
)
check(
  '详情行：第五防线无 boss_info 记录时补 70（等级行可见）',
  buildDefenseMonsterDetailRecord(makeEnemy(), null, null, 5).level ===
    DEFENSE_FIFTH_FRONTIER_MONSTER_LEVEL,
)
check(
  '详情行：第四防线无记录时按规则补 1（与防线规则同一处理）',
  buildDefenseMonsterDetailRecord(makeEnemy({ staggerTime: null }), null, null, 4).level === 1,
)
check(
  '详情行：拿不到防线时保持旧口径（无记录 ⇒ null，等级行隐藏）',
  buildDefenseMonsterDetailRecord(makeEnemy(), null, null).level === null &&
    buildDefenseMonsterDetailRecord(makeEnemy(), null, null, null).level === null,
)
check(
  '详情行：有记录时用记录等级，不套防线默认值',
  buildDefenseMonsterDetailRecord(makeEnemy(), null, makeBossInfo({ level: 60 }), 5).level === 60,
)

console.log('[1c] 版本透传：异常条版本系数（2.1 期起 ×1.1）按赛季版本判定')
check(
  '传赛季版本 ⇒ 数据行带上该版本（供表判定是否乘 1.1）',
  buildDefenseMonsterDetailRecord(makeEnemy(), null, makeBossInfo(), 5, '3.2').version === '3.2',
  String(buildDefenseMonsterDetailRecord(makeEnemy(), null, makeBossInfo(), 5, '3.2').version),
)
check(
  '2.1 之前的版本原样透传（乘不乘由表判定，数据行不预筛）',
  buildDefenseMonsterDetailRecord(makeEnemy(), null, makeBossInfo(), 5, '2.0').version === '2.0',
)
check(
  '回归守卫：拿不到版本（缺省 / null / undefined）时为 null ⇒ 表保守地不乘版本系数',
  buildDefenseMonsterDetailRecord(makeEnemy(), null, makeBossInfo(), 5).version === null &&
    buildDefenseMonsterDetailRecord(makeEnemy(), null, makeBossInfo(), 5, null).version === null &&
    buildDefenseMonsterDetailRecord(makeEnemy(), null, makeBossInfo(), 5, undefined).version === null,
)

console.log('[1d] 版本透传：存在历史标记（该怪物是否在 2.1（含）之前就已存在）')
check(
  '传 true ⇒ 数据行标记该怪物 2.1（含）前就已存在（表在 ≥2.1 期才据此乘 1.1）',
  buildDefenseMonsterDetailRecord(makeEnemy(), null, makeBossInfo(), 5, '3.2', true)
    .boss_existed_by_multiplier_version === true,
)
check(
  '回归守卫：拿不到该标记（缺省 / null / undefined）时显式 false ⇒ 表保守地不乘版本系数',
  buildDefenseMonsterDetailRecord(makeEnemy(), null, makeBossInfo(), 5, '3.2')
    .boss_existed_by_multiplier_version === false &&
    buildDefenseMonsterDetailRecord(makeEnemy(), null, makeBossInfo(), 5, '3.2', null)
      .boss_existed_by_multiplier_version === false &&
    buildDefenseMonsterDetailRecord(makeEnemy(), null, makeBossInfo(), 5, '3.2', undefined)
      .boss_existed_by_multiplier_version === false,
)
check(
  '2.2 起才出的新怪明确传 false ⇒ 数据行保留 false，不因 ≥2.1 版本误乘',
  buildDefenseMonsterDetailRecord(makeEnemy(), null, makeBossInfo(), 5, '3.2', false)
    .boss_existed_by_multiplier_version === false,
)
check(
  '旧 Boss 在 2.1 之前的期数：版本与标记都原样透传（两个条件由表判，数据行不预筛）',
  (() => {
    const record = buildDefenseMonsterDetailRecord(makeEnemy(), null, makeBossInfo(), 5, '2.0', true)
    return record.version === '2.0' && record.boss_existed_by_multiplier_version === true
  })(),
)

console.log('[2] getDefenseMonsterCategory：折线图类别推导')
const bossId = encodeDefenseBossId({
  version: '3.2',
  phase: 2,
  stage: 5,
  roomInStage: 1,
  wave: 2,
  monsterCategory: 'boss',
  monsterSubType: 1,
  count: 1,
})
const eliteId = encodeDefenseBossId({
  version: '3.2',
  phase: 2,
  stage: 5,
  roomInStage: 1,
  wave: 1,
  monsterCategory: 'elite',
  monsterSubType: 1,
  count: 1,
})
const minionId = encodeDefenseBossId({
  version: '3.2',
  phase: 2,
  stage: 5,
  roomInStage: 1,
  wave: 1,
  monsterCategory: 'minion',
  monsterSubType: 1,
  count: 3,
})
check(
  'ID 编码优先：Boss / 精英分别解出对应类别',
  getDefenseMonsterCategory(makeEnemy({ id: bossId })) === 'boss' &&
    getDefenseMonsterCategory(makeEnemy({ id: eliteId })) === 'elite',
)
check(
  '旧数据无 ID 时回退 isBoss',
  getDefenseMonsterCategory(makeEnemy({ id: undefined, isBoss: true })) === 'boss',
)
check(
  '对比列表口径：getDefenseMonsterCategory 仍只认精英/Boss（小怪不混进怪物列表）',
  getDefenseMonsterCategory(makeEnemy({ id: minionId, isBoss: false })) === null &&
    getDefenseMonsterCategory(makeEnemy({ id: undefined, isBoss: false })) === null &&
    getDefenseMonsterCategory({ name: '小怪布', hp: '1' }) === null,
)
check(
  '折线口径：resolveDefenseMonsterCategory 对 minion 解出 minion（弹窗渲染图表）',
  resolveDefenseMonsterCategory(makeEnemy({ id: minionId, isBoss: false })) === 'minion',
)
check(
  'isDefenseEliteOrBoss 与类别推导一致',
  isDefenseEliteOrBoss(makeEnemy({ id: bossId })) === true &&
    isDefenseEliteOrBoss({ name: '小怪布', hp: '1' }) === false,
)
check(
  '回归守卫：getDefenseMonsterCategory 对 minion 仍返回 null（折线图列表只认精英/Boss）',
  getDefenseMonsterCategory(makeEnemy({ id: minionId, isBoss: false })) === null,
)

console.log('[2b] resolveDefenseMonsterCategory：详情弹窗完整类别解析（小怪也算）')
function tableCategoryOf(enemy) {
  return buildDefenseMonsterDetailRecord(enemy, null, null).monster_category
}

check(
  'minion ID ⇒ 解出 minion，数据行类别取「普通敌人」',
  resolveDefenseMonsterCategory(makeEnemy({ id: minionId, isBoss: false })) === 'minion' &&
    tableCategoryOf(makeEnemy({ id: minionId, isBoss: false })) === 'normal',
  String(tableCategoryOf(makeEnemy({ id: minionId, isBoss: false }))),
)
check(
  'elite ID ⇒ 解出 elite，数据行类别取「精英」',
  resolveDefenseMonsterCategory(makeEnemy({ id: eliteId, isBoss: false })) === 'elite' &&
    tableCategoryOf(makeEnemy({ id: eliteId, isBoss: false })) === 'elite',
  String(tableCategoryOf(makeEnemy({ id: eliteId, isBoss: false }))),
)
check(
  'boss ID ⇒ 解出 boss，数据行类别取「首领」',
  resolveDefenseMonsterCategory(makeEnemy({ id: bossId, isBoss: false })) === 'boss' &&
    tableCategoryOf(makeEnemy({ id: bossId, isBoss: false })) === 'boss',
  String(tableCategoryOf(makeEnemy({ id: bossId, isBoss: false }))),
)
check(
  '无 ID 且 isBoss 为真 ⇒ 回落 boss（旧数据口径不变）',
  resolveDefenseMonsterCategory(makeEnemy({ id: undefined, isBoss: true })) === 'boss' &&
    tableCategoryOf(makeEnemy({ id: undefined, isBoss: true })) === 'boss',
)
check(
  '无 ID 且 isBoss 为假 ⇒ null，数据行类别 undefined（缺省由表按「首领」兜底）',
  resolveDefenseMonsterCategory({ name: '小怪布', hp: '1' }) === null &&
    resolveDefenseMonsterCategory(makeEnemy({ id: undefined, isBoss: false })) === null &&
    tableCategoryOf({ name: '小怪布', hp: '1' }) === undefined,
)
check(
  'ID 解不出（9 位但类型码非法）不抛错：isBoss 为真 ⇒ boss',
  resolveDefenseMonsterCategory(makeEnemy({ id: 999999999, isBoss: true })) === 'boss' &&
    tableCategoryOf(makeEnemy({ id: 999999999, isBoss: true })) === 'boss',
)
check(
  'ID 解不出且 isBoss 为假 ⇒ null ⇒ 数据行类别 undefined',
  resolveDefenseMonsterCategory(makeEnemy({ id: 999999999, isBoss: false })) === null &&
    tableCategoryOf(makeEnemy({ id: 999999999, isBoss: false })) === undefined,
)
check(
  '非 ID（位数不符）同样回落 isBoss 口径',
  resolveDefenseMonsterCategory(makeEnemy({ id: '小怪-1', isBoss: true })) === 'boss' &&
    resolveDefenseMonsterCategory(makeEnemy({ id: '小怪-1', isBoss: false })) === null,
)

console.log('[3] buildDefenseBossChart：按类别 + 名称取各期血量点')
function makeDefenseSeason(version, phase, enemies) {
  return {
    id: `${version}-${phase}`,
    version,
    phase,
    dateRange: '2026.6.26 - 2026.7.10',
    seasonId: '62051',
    nodeType: '剧变节点',
    rawHp: '1,000,000',
    frontiers: [
      {
        id: '6205105',
        title: '第五防线',
        level: 70,
        rooms: [
          {
            id: '62051051',
            label: '房间 1',
            level: 70,
            zoneBuffs: [],
            roomBuff: { name: '霜冻风暴', lines: ['效果'] },
            battleRooms: [
              {
                id: 'br1',
                label: '战斗房间 1',
                waveCount: 1,
                weakness: [],
                waves: [{ label: 'WAVE 1', enemies }],
              },
            ],
          },
        ],
      },
    ],
  }
}

const minionEnemy = {
  id: minionId,
  name: '特种抗暴布',
  hp: '1,423,183',
  hpValue: 1423183,
  count: 3,
}
const chartSeasons = [
  makeDefenseSeason('3.0', '第 1 期', [makeEnemy({ id: bossId, hpValue: 1000000, hp: '1,000,000' }), minionEnemy]),
  makeDefenseSeason('3.1', '第 2 期', [makeEnemy({ id: bossId, hpValue: 1200000, hp: '1,200,000' })]),
]
const bossPoints = buildDefenseBossChart(chartSeasons, '霸主侵蚀体', 'boss')
check(
  '同一 Boss 的各期血量点齐全（期数标签 + 数值）',
  bossPoints.length === 2 &&
    bossPoints[0].label === '3.0第1期' &&
    bossPoints[1].totalHp === 1200000,
  JSON.stringify(bossPoints.map((point) => [point.label, point.totalHp])),
)
check(
  '类别不匹配的同类怪物不串入折线',
  buildDefenseBossChart(chartSeasons, '霸主侵蚀体', 'elite').length === 0,
)
check(
  '无出场记录时返回空数组 ⇒ 弹窗显示「暂无历史数据」',
  buildDefenseBossChart(chartSeasons, '不存在怪物', 'boss').length === 0,
)
check(
  '小怪也能出折线：按 minion 类别取各期血量点',
  buildDefenseBossChart(chartSeasons, '特种抗暴布', 'minion').length === 1 &&
    buildDefenseBossChart(chartSeasons, '特种抗暴布', 'minion')[0].totalHp === 1423183,
  JSON.stringify(buildDefenseBossChart(chartSeasons, '特种抗暴布', 'minion')),
)

console.log('[3b] hasDefenseMonsterExistedByMultiplierVersion：扫全量赛季判定出现历史')
const historySeasons = [
  makeDefenseSeason('2.0', '第 1 期', [{ name: '霸主侵蚀体', hp: '1,000,000' }]),
  makeDefenseSeason('2.1', '第 1 期', [{ name: '新怪', hp: '1,000,000' }]),
  makeDefenseSeason('2.2', '第 1 期', [{ name: '后出的新怪', hp: '1,000,000' }]),
  makeDefenseSeason('3.2', '第 3 期', [
    { name: '霸主侵蚀体', hp: '1,200,000' },
    { name: '新怪', hp: '1,100,000' },
    { name: '后出的新怪', hp: '1,150,000' },
  ]),
]
check(
  '2.1 之前的赛季出现过 ⇒ true（旧 Boss 在 ≥2.1 期继续 ×1.1）',
  hasDefenseMonsterExistedByMultiplierVersion(historySeasons, '霸主侵蚀体') === true,
)
check(
  '首次出现在 2.1 的赛季 ⇒ true（2.1 才出的新怪也乘：条件是「首次出现不晚于 2.1」）',
  hasDefenseMonsterExistedByMultiplierVersion(historySeasons, '新怪') === true,
)
check(
  '首次出现在 2.2 的赛季 ⇒ false（2.2 起才出的新怪不乘）',
  hasDefenseMonsterExistedByMultiplierVersion(historySeasons, '后出的新怪') === false,
)
check(
  '从未出现过 ⇒ false',
  hasDefenseMonsterExistedByMultiplierVersion(historySeasons, '不存在怪物') === false,
)
check(
  '怪物名为空 / 缺省 ⇒ false（不被空名误判为出现过）',
  hasDefenseMonsterExistedByMultiplierVersion(historySeasons, '') === false &&
    hasDefenseMonsterExistedByMultiplierVersion(historySeasons, undefined) === false,
)
check('空赛季列表 ⇒ false', hasDefenseMonsterExistedByMultiplierVersion([], '霸主侵蚀体') === false)
check(
  '赛季版本缺失 / 解析不出（空串、缺次段）⇒ 该赛季不算出现，不给假阳性',
  hasDefenseMonsterExistedByMultiplierVersion(
    [
      makeDefenseSeason('', '第 1 期', [{ name: '霸主侵蚀体', hp: '1,000,000' }]),
      makeDefenseSeason('2', '第 2 期', [{ name: '另一怪物', hp: '1,000,000' }]),
    ],
    '霸主侵蚀体',
  ) === false,
)
check(
  '命中出现在深层（防线 → 房间 → 战斗房间 → 波次）也被扫到',
  hasDefenseMonsterExistedByMultiplierVersion(
    [makeDefenseSeason('1.4', '第 3 期', [{ name: '深藏怪物', hp: '999' }])],
    '深藏怪物',
  ) === true,
)
check(
  '回归守卫：当前赛季自身 ≥2.1 且该怪物 2.2 起才出 ⇒ false（两个条件缺一不可，由表统一判定）',
  buildDefenseMonsterDetailRecord(
    makeEnemy(),
    null,
    makeBossInfo(),
    5,
    '3.2',
    hasDefenseMonsterExistedByMultiplierVersion(historySeasons, '后出的新怪'),
  ).boss_existed_by_multiplier_version === false,
)

console.log('[4] 源码守卫：弹窗与面板接线')
const modalSource = readFileSync(
  new URL('../src/components/defense/DefenseMonsterDetailModal.vue', import.meta.url),
  'utf8',
)
check('弹窗复用共享数据块组件', modalSource.includes('MonsterDetailStats'))
check('弹窗外壳用 IkModalShell（Teleport 到 body，层级高于往期详细弹窗）', modalSource.includes('IkModalShell'))
check('折线图走防卫战接口 fetchDefenseBossChart', modalSource.includes('fetchDefenseBossChart'))
check('等级 / 失衡易伤取 boss_info 基础库', modalSource.includes('lookupBossInfo'))
check('快切用请求序号丢弃过期响应', modalSource.includes('createRequestEpoch'))
check('图表区块按类别推导结果决定是否渲染', modalSource.includes('v-if="chartCategory"'))
check('图表用 page-scroll 形态（图表自然高度、弹窗 body 滚动）', modalSource.includes(':page-scroll="true"'))
check('不传危局专属的系数图开关', !modalSource.includes('enable-hp-coeff-charts'))
check('等级按面板传入的防线补默认值', modalSource.includes('props.stage'))
check(
  '开启「弱点与抗性」表开关（表由另一工作流落地，此处只接线）',
  modalSource.includes(':show-resistance-table="true"'),
)

const panelSource = readFileSync(
  new URL('../src/components/defense/DefenseDetailPanel.vue', import.meta.url),
  'utf8',
)
check('可点击怪物卡片由 canOpenMonsterDetail 控制', panelSource.includes("'enemy-chip--clickable': canOpenMonsterDetail(enemy)"))
check('仅非管理端可点开', panelSource.includes('return !props.adminMode && Boolean(enemy.name)'))
check('卡片声明按钮语义 + 键盘可达', panelSource.includes("canOpenMonsterDetail(enemy) ? 'button' : undefined"))
check('卡片有手型光标与 focus-visible 轮廓', panelSource.includes('.enemy-chip--clickable:focus-visible'))
check('管理端编辑/删除按钮继续 @click.stop', (panelSource.match(/@click\.stop/g)?.length ?? 0) >= 2)
check('弹窗传当前版本以取对应期数', panelSource.includes(':variant="defenseVariant"'))
check(
  '管理端预填等级改由防线规则推导（不再硬编码 1）',
  panelSource.includes('resolveDefenseMonsterDefaultLevel') &&
    !panelSource.includes("level: '1'"),
)
check(
  '面板把点击槽位的防线传给详情弹窗',
  panelSource.includes(':stage="monsterDetailFrontierStage"'),
)
check('弹窗把面板传入的赛季版本透传给数据行', modalSource.includes('props.version'))
check(
  '面板把当前赛季版本传给详情弹窗',
  panelSource.includes(':version="currentSeason?.version ?? null"'),
)
check(
  '弹窗把面板传入的存在历史标记透传给数据行（与赛季版本一起判 1.1）',
  modalSource.includes('props.bossExistedByMultiplierVersion ?? false'),
)
check(
  '面板扫全量赛季算出「2.1（含）前是否已存在」并按怪物名匹配',
  panelSource.includes('hasDefenseMonsterExistedByMultiplierVersion') &&
    panelSource.includes('monsterDetailEnemy.value?.name'),
)
check(
  '面板把存在历史标记传给详情弹窗',
  panelSource.includes(
    ':boss-existed-by-multiplier-version="monsterDetailBossExistedByMultiplierVersion"',
  ),
)

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
