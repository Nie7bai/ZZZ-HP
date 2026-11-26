/**
 * nanoka「增益」抽取 —— **v3「关键字槽位」模型（纯函数：不联网、不读库、不写库）**。
 *
 * 规格：`dev-docs/nanoka-buff-extract-spec-v2-2026-10-16.md`（v2 仍然有效的部分 + 文末「v3 变更」）。
 *
 * 两阶段、三层：
 * ```
 * 层A 原文（nanoka 原文，只读，**无条件入库**）
 *   │  阶段1（本文件 extractKeywordEffects）：切句 → 抽 9 槽位 → 指代/省略/修饰词归一
 * 层B 关键字（9 槽位，可编辑；**人的主战场**，**也入库**，带 `[关键字]` 前缀便于检索）
 *   │  阶段2（本文件 mapKeywordsToEffect）：**纯查表**，确定性映射，规则各自单测
 * 层C 增益效果（= 「增益块」全字段）
 * ```
 *
 * v3 关键口径（与 v2 的差异都写在本文件里，规格文件另有一节）：
 *   1. **删掉「不解析（仅存原文）」开关**：原文无条件入库、关键字也入库，没有"选不选进"的开关。
 *   2. **招式限定 = 条件**（不是来源 / 落点）：文本限定某招式时，条件槽位记 `限定招式：X`，
 *      并复用技能库既有锚点机制（`skillSubcategoryId` / `skillTargets`）关联到该招式；
 *      **锚点关联不上 → 这条不录**（不新建挂载点、不动任何 schema）。
 *   3. 招式文本抽出的效果与其他效果一样进**角色增益块**（槽位 0 / 影画 i），只是带「限定招式」条件；
 *      原文 + 关键字写进该技能的「描述」字段（技能库 = `calculator_skills.note`）。
 *   4. 槽位显示规则（`无` 默认隐藏 / `无法提取` 用 ⚠X + [补]）是**界面**的事，本文件只保证
 *      9 槽位**不许缺格**，且 `无` 与 `无法提取` 严格区分。
 *
 * 四类来源（都扫）：核心被动 / 额外能力 / 影画 1–6 / 招式文本 / 音擎精炼 1–5。
 */
import { isCustomBuffStatKey } from '../../utils/calculatorBuffFields.js'
import { PROFESSION_ID_LABELS } from './nanokaBasicsMapper.js'
import { normalizeSkillName, stripSkillTitlePrefix } from './nanokaSkillMapper.js'

// ================================================================== 槽位定义

/** 该维度「这句话里没出现」 */
export const NONE = '无'
/** 该维度「出现了但归不了类」——**绝不能拿 `无` 糊过去**（用户铁律：解析不出来就是 `无法提取`） */
export const UNABLE = '无法提取'

/** 该维度缺失/读不出（给白名单校验用） */
export function isUNABLEValue(value) {
  if (Array.isArray(value)) return value.includes(UNABLE)
  return String(value ?? '').trim() === UNABLE
}

/**
 * 槽位 id（顺序即界面 / 文本里的顺序）。
 *
 * 常规 9 槽位 + **元素** + **生效范围**：
 *   - **元素**（用户 2026-10-16「元素不拆条」）：`elementFilter` 本来就是数组 → 允许复数；
 *   - **生效范围**（用户 2026-10-16 二次确认）：工具里**有**子类限定字段，就是编辑器「生效范围」下拉
 *     （`scope`）；原来的「限定招式」并进这一格。
 * **复数白名单 = 条件、元素**（其他槽位仍单值，多值即拆条）。
 */
export const SLOT_IDS = [
  'stat',
  'elements',
  'action',
  'value',
  'unit',
  'target',
  'conditions',
  'scope',
  'stacks',
  'duration',
  'object',
]

/** 允许复数的槽位（白名单） */
export const MULTI_SLOT_IDS = ['conditions', 'elements']

/** 槽位中文名（`关键字：属性=… 动作=…` 的标签） */
export const SLOT_LABELS = {
  stat: '属性',
  elements: '元素',
  action: '动作',
  value: '数值',
  unit: '单位',
  target: '目标',
  conditions: '条件',
  /** **作用域** = 编辑器里的 `scope`（用户口径：字段名就叫「作用域」）；「限定招式」也并进这一格 */
  scope: '作用域',
  stacks: '层数',
  duration: '时长',
  object: '对象',
}

/**
 * **生效范围**的取值（以源码为准）：`zzz-hp/src/types/calculator.ts:63` 的 `BUFF_SCOPE_OPTIONS`
 * `无` 表示通用。锐化写入 `conditions.damageTypes`，其余取值沿用原有 `scope`。
 */
export const SCOPE_OPTIONS = [NONE, '招式', '锐化', '属性异常', '紊乱', '乱流', '异放', '耀变', '异化系数']

/** 作用域槽位中文名对应的内部取值。 */
export const SCOPE_SLOT_TO_ID = {
  [NONE]: '',
  招式: 'skill',
  锐化: 'sharpen',
  属性异常: 'attributeAnomaly',
  紊乱: 'disorder',
  乱流: 'turbulence',
  异放: 'anomalyRelease',
  耀变: 'radiance',
  异化系数: 'mutation',
}

/**
 * 阶段1：从子句里认「生效范围」。先认**明确点名子类**的措辞（异放 / 耀变 / 乱流 / 紊乱 / 异化系数），
 * 再认**显式限定异常**的措辞（`仅对属性异常生效` 这类）；`招式` 由招式锚点那条路填（见 `detectSkillLimits`）。
 */
const SCOPE_RULES = [
  { id: '异放', re: /\[?异放\]?/ },
  { id: '耀变', re: /\[?耀变\]?/ },
  { id: '乱流', re: /\[?乱流\]?/ },
  { id: '紊乱', re: /\[?紊乱\]?/ },
  { id: '异化系数', re: /异化系数/ },
  {
    id: '属性异常',
    re: /(?:仅|只|限定)(?:对|对处于)?(?:属性)?异常(?:伤害)?(?:状态)?(?:生效|计入|计算|有效)|(?:属性)?异常伤害(?:计算|结算|生效)时/,
  },
]

/** 认一条子句的生效范围（没认出来 = `无` = 通用） */
export function detectScope(text) {
  const source = String(text ?? '')
  for (const rule of SCOPE_RULES) {
    if (rule.re.test(source)) return rule.id
  }
  return NONE
}

/** 关键字入库前缀（v3 变更 2：关键字入库，带前缀/索引便于检索） */
export const KEYWORD_PREFIX = '[关键字]'

/** 采集词表中的独立乘区属性与正式增益字段。 */
const INDEPENDENT_ZONE_PERCENT_STATS = {
  烬痕比例: 'custom:emberMarkRatio',
  最终伤害比例: 'custom:finalDamageRatio',
  一布之力比例: 'custom:bangbooMightRatio',
}

const SHARPEN_CRIT_DMG_LABEL = '锐爆伤害加成'

/** 阶段2 词表里的 stat 键对应的中文标签 */
export const STAT_LABELS = {
  ...Object.fromEntries(
    Object.entries(INDEPENDENT_ZONE_PERCENT_STATS).map(([label, stat]) => [stat, label]),
  ),
  hp: '生命值',
  inCombatHpPercent: '局内生命值',
  inCombatAtkPercent: '局内攻击力',
  inCombatDefPercent: '局内防御力',
  externalHpPercent: '局外生命值',
  externalAtkPercent: '局外攻击力',
  externalDefPercent: '局外防御力',
  atk: '攻击力（固定）',
  def: '防御力（固定）',
  dmgBonus: '增伤',
  skillDmgBonus: '招式增伤',
  skillMultiplierBonus: '招式倍率加成',
  critRate: '暴击率',
  critDmg: '暴击伤害',
  sharpenCritDmgBonus: SHARPEN_CRIT_DMG_LABEL,
  penRate: '穿透率',
  reduceDefense: '无视防御',
  resPen: '抗性穿透',
  mastery: '异常精通',
  anomalyControl: '异常掌控',
  anomalyControlPercent: '异常掌控%（局外）',
  energyRegen: '能量自动回复',
  energyRegenFlat: '能量回复（固定）',
  vulnerable: '失衡易伤',
  dmgReduction: '受到伤害降低',
  attributeAnomalyCritRate: '属性异常暴击率',
  attributeAnomalyCritDmg: '属性异常暴击伤害',
  attributeAnomalyDmgBonus: '属性异常增伤',
  anomalyReleaseDmgBonus: '异放增伤',
  disorderDmgBonus: '紊乱增伤',
  turbulenceDmgBonus: '乱流增伤',
  anomalyReleaseCritRate: '异放暴击率',
  anomalyReleaseCritDmg: '异放暴击伤害',
  radianceDmgBonus: '耀变增伤',
  turbulenceCritRate: '乱流暴击率',
  turbulenceCritDmg: '乱流暴击伤害',
  radianceCritRate: '耀变暴击率',
  radianceCritDmg: '耀变暴击伤害',
  disorderCritRate: '紊乱暴击率',
  disorderCritDmg: '紊乱暴击伤害',
  directVulnerable: '直伤易伤',
  anomalyVulnerable: '异常易伤',
  pierce: '穿透值',
  pierceDmgBonus: '穿透增伤',
  special: '特殊',
}

/** 属性槽位里的 `<元素>属性伤害`（旧字样，**仍然识别**；输出统一走「增伤 + 元素槽」） */
const ELEMENT_STAT_RE = /^(物理|火|冰|电|以太|风)属性伤害$/

/** 元素（属性槽位里的 `<元素>属性伤害` 用它拆 elementFilter） */
export const ELEMENTS = ['物理', '火', '冰', '电', '以太', '风']

/**
 * 属性槽位下拉的选项集（界面用控件而非打字；`无` / `无法提取` 是显式选项）。
 *
 * **结构性原则（用户 2026-10-16）**：阶段1 的 `属性` 槽位写的是**工具语义**（工具字段的中文语义名），
 * **不是游戏字面**——游戏描述不合理的措辞在阶段1 就改写成工具语义（见 `GAME_LITERAL_REWRITES`），
 * 阶段2 因此只是「属性 → 字段键」的一张表。
 */
export const STAT_OPTIONS = [
  '增伤',
  '招式增伤',
  '属性异常增伤',
  '异放增伤',
  '乱流增伤',
  '耀变增伤',
  '紊乱增伤',
  ...Object.keys(INDEPENDENT_ZONE_PERCENT_STATS),
  '异放暴击率',
  '异放暴击伤害',
  '乱流暴击率',
  '乱流暴击伤害',
  '耀变暴击率',
  '耀变暴击伤害',
  '紊乱暴击率',
  '紊乱暴击伤害',
  '属性异常暴击率',
  '属性异常暴击伤害',
  '异常精通',
  '异常掌控',
  '暴击率',
  '暴击伤害',
  SHARPEN_CRIT_DMG_LABEL,
  '攻击力（局外）',
  '攻击力（局内）',
  '攻击力（固定）',
  '生命值',
  '防御力',
  '减防',
  '抗性穿透',
  '穿透率',
  '穿透',
  '冲击力',
  '易伤',
  '失衡易伤',
  '失衡易伤（全局）',
  '直伤易伤',
  '异常易伤',
  '受到伤害降低',
  '能量自动回复',
  '持续时间',
  '技能等级',
]

/**
 * 动作槽位：**必须有**（缺即 `无法提取`，规格 §二）；`为/是/达到` 这类系词按 `提升` 归一。
 *
 * 用户 2026-10-16 二次确认（最终口径）：**动作表固定 4 个**：
 *   - `提升` / `降低` —— 作用于**目标**：易伤 `vulnerable` / `reduceDefense` / `resPen`；
 *   - `无视`           —— 无视防御 / 抗性 → `reduceDefense` / `resPen`；
 *   - `转化`           —— **转模，走专用槽位**（见 `CONVERT_SLOT_IDS`）：`kind='convert'`、`effect.value≡0`。
 * **「回复」已去掉**：`生命回复` / `立即回复 N 点能量` 这类既没有动作、阶段2 也查不到字段 →
 * 在阶段1 结束时按「可映射性预检」整条进**废原文**（见 `checkKeywordMappable`）。
 * 不进动作表的动词（`获得` / `视为` / `替代` / `进入…状态`）同样当条件用，或进废原文。
 * 除「转化」外，其余动作共用**常规 9 槽位**。
 */
export const ACTION_OPTIONS = ['提升', '降低', '无视', '转化']

/**
 * 转模（动作=`转化`）专用槽位（用户 2026-10-16 二次确认，字段对齐
 * `calculatorBuffService.normalizeConvert`）。`目标属性` 就是常规 `属性` 槽位（= `effect.stat`）；
 * 下面这 5 个是转模独有的，阶段二的字段区用它们**取代** 数值 / 单位。
 */
export const CONVERT_SLOT_IDS = [
  'convertFrom',
  'convertPanelSource',
  'convertRatio',
  'convertBase',
  'convertCap',
]

/** 转模专用槽位中文名（文案定稿，用户 2026-10-16；括号里是它对应的 `normalizeConvert` 字段） */
export const CONVERT_SLOT_LABELS = {
  convertFrom: '读取属性', // convert.from
  convertPanelSource: '取哪一层', // convert.panelSource
  convertRatio: '折算比例', // convert.ratioPercent
  convertBase: '基础值', // convert.defaultBase
  convertCap: '上限', // convert.cap
}

/** 转模槽位的悬浮提示（界面直接显示，字典唯一来源在这里） */
export const CONVERT_SLOT_HINTS = {
  convertFrom: '读取属性：它的值 × 折算比例 = 本条增益（如 特殊技等级 ×150% → 增伤）',
  convertPanelSource: '取哪一层：进战外面板 / 最终面板 / 手动值',
  convertRatio: '折算比例：百分数填法（150 = 150%）',
  convertBase: '基础值：只有超出它的部分参与折算（defaultBase）',
  convertCap: '上限：折算结果的绝对值上限（cap）',
}

/**
 * `convert.from` 取值（与 `normalizeConvert` 的 ATTRS 同源）。
 * **顺序即界面下拉顺序**（用户 2026-10-16）：常用属性在前 → `角色等级(level)`、`技能等级（特殊技）`
 * 在后（库里真有数据：蕾米埃尔 特殊技等级×150% → 增伤；希格莉德 等级×1200% → 攻击上限 720）→
 * 其余 4 个技能类别来源垫底保留。
 */
export const CONVERT_FROM_OPTIONS = [
  'hp',
  'atk',
  'def',
  'critRate',
  'critDmg',
  'mastery',
  'anomalyControl',
  'energyRegen',
  'penRate',
  'impact',
  'pierce',
  'level',
  'skillLevelSpecial',
  'skillLevelBasic',
  'skillLevelDodge',
  'skillLevelAssist',
  'skillLevelChainUltimate',
]

/** 读取属性中文名（阶段1 认词 + 界面下拉） */
export const CONVERT_FROM_LABELS = {
  hp: '生命值',
  atk: '攻击力',
  def: '防御力',
  critRate: '暴击率',
  critDmg: '暴击伤害',
  mastery: '异常精通',
  anomalyControl: '异常掌控',
  energyRegen: '能量自动回复',
  penRate: '穿透率',
  impact: '冲击力',
  pierce: '穿透值',
  level: '角色等级',
  skillLevelSpecial: '技能等级（特殊技）',
  skillLevelBasic: '技能等级（普通攻击）',
  skillLevelDodge: '技能等级（闪避）',
  skillLevelAssist: '技能等级（支援技）',
  skillLevelChainUltimate: '技能等级（连携技/终结技）',
}

/** 取哪一层（`convert.panelSource`） */
export const CONVERT_PANEL_SOURCE_OPTIONS = ['external', 'final', 'manual']

/** 取哪一层中文名 */
export const CONVERT_PANEL_SOURCE_LABELS = {
  external: '进战外面板',
  final: '最终面板',
  manual: '手动值',
}

/** 目标槽位：`无` = 默认自身（规格 §二） */
export const TARGET_OPTIONS = ['自身', '全队', '指定职业', '指定阵营']

/** 对象槽位（增益作用在谁 / 什么上） */
export const OBJECT_OPTIONS = ['当前招式', '装备者', '敌人', '能量']

/** 单位槽位：**只与数值成对**（`%` / `点`；纯数写 `无`） */
export const UNIT_OPTIONS = ['%', '点']

/** 层数槽位下拉（数值部分用 `stackMax` 数字输入，界面拼成 `最多 12 层`） */
export const STACK_OPTIONS = [NONE, UNABLE]

/** 时长槽位下拉（数值部分用 `durationSeconds` 数字输入，界面拼成 `15 秒`） */
export const DURATION_OPTIONS = [NONE, UNABLE]

const PROFESSIONS = Object.values(PROFESSION_ID_LABELS)
const beneficiaryProfessionCondition = (profession) => `仅${profession}代理人`
const PROFESSION_CONDITION_RE = new RegExp(`^仅(${PROFESSIONS.join('|')})代理人$`)
const MANUAL_STATE_CONDITION = '状态需手动启用'
const MANUAL_STATE_CONDITION_RE = new RegExp(`^${MANUAL_STATE_CONDITION}$`)
const TEAM_STATE_GRANT_RE = /^全队\[(?<profession>[^\]]+)\]代理人进入.*状态$/

/**
 * **条件能被阶段2落地判据**（唯一真源）：句子（或条件文本）命中这些正则，才允许落到
 * `applySituation`、职业条件或默认启用状态；其余记为 `无法提取`。
 * 放在这里是因为 `CONDITION_OPTIONS` 要用它**反向过滤**候选池（见下）。
 */
const MODELABLE_CONDITION_RES = [
  /(?:攻击)?(?:处于)?非失衡/,
  /(?:攻击)?(?:处于)?失衡/,
  /队伍中存在|队伍中有|队内|同阵营|同属性|其他\[?异常\]?角色/,
  PROFESSION_CONDITION_RE,
  MANUAL_STATE_CONDITION_RE,
]

/**
 * 条件下拉的**候选池**：只是"想提供的句式"，能不能进出下拉由 `MODELABLE_CONDITION_RES` 决定。
 * 阶段2 落不到的（触发时机 / 状态类）在这里被**自动过滤** —— 结构上保证「下拉里的每个选项
 * 阶段2 都能解析」，而不是靠人记得同步两张表（用户 2026-10-17：「解析不出来的根本不该出现」）。
 * 想让某个句式出现，先扩 `MODELABLE_CONDITION_RES` 和阶段2 的字段，它自己就会出现在下拉里。
 */
const CONDITION_OPTION_CANDIDATES = [
  '攻击失衡敌人时',
  '攻击非失衡敌人时',
  '发动强化特殊技时',
  '发动连携技或终结技时',
  '敌人处于属性异常状态时',
  '队伍中存在与自身属性或阵营相同的角色时',
  '队伍中存在其他异常角色或同阵营角色时',
  ...PROFESSIONS.map(beneficiaryProfessionCondition),
  MANUAL_STATE_CONDITION,
]

/**
 * 条件槽位下拉候选（**唯一允许复数**的槽位）。`无` = 无条件（全局），`无法提取` = 人工兜底。
 * 由候选池经白名单过滤而来；目前能出现的只有 失衡 / 非失衡 / 队伍职业条件 三类。
 */
export const CONDITION_OPTIONS = [
  NONE,
  ...CONDITION_OPTION_CANDIDATES.filter((text) => MODELABLE_CONDITION_RES.some((re) => re.test(text))),
  UNABLE,
]

/**
 * 给界面用的下拉选项集（含 `无` / `无法提取` 这些显式选项）——**唯一来源**，随接口下发。
 * `元素` 是**多选**（`ELEMENTS`），`条件` 也是多值；其余槽位单值。
 */
export const SLOT_OPTIONS = {
  stat: [...STAT_OPTIONS, NONE, UNABLE],
  elements: [...ELEMENTS, NONE],
  action: [...ACTION_OPTIONS, UNABLE],
  value: 'number',
  unit: [...UNIT_OPTIONS, NONE],
  target: [...TARGET_OPTIONS, NONE, UNABLE],
  conditions: CONDITION_OPTIONS,
  scope: SCOPE_OPTIONS,
  stacks: STACK_OPTIONS,
  duration: DURATION_OPTIONS,
  object: [...OBJECT_OPTIONS, NONE, UNABLE],
  // —— 转模（动作=转化）专用槽位
  convertFrom: [...CONVERT_FROM_OPTIONS, UNABLE],
  convertPanelSource: CONVERT_PANEL_SOURCE_OPTIONS,
  convertRatio: 'number',
  convertBase: 'number',
  convertCap: 'number',
}

/** 槽位取值是否「阻断」（`无法提取`） */
export function isUnable(value) {
  if (value === UNABLE) return true
  if (Array.isArray(value)) return value.includes(UNABLE)
  return false
}

/** 该条有哪些槽位标了 `无法提取` → 阻断自动映射（规格 §二硬规则 7） */
export function unableSlotsOf(effect) {
  const slots = effect?.slots ?? {}
  return SLOT_IDS.filter((id) => isUnable(slots[id]))
}

/** 该槽位是不是「无值」（`无` / 空）——**界面默认隐藏**的判据（v3 变更 1） */
export function isEmptySlot(value) {
  if (value === null || value === undefined) return true
  if (Array.isArray(value)) return value.every((item) => isEmptySlot(item))
  const text = String(value).trim()
  return !text || text === NONE
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// ================================================================== 文本工具

// 保留已核对的通用属性术语，供离线重跑旧详情或词表暂不可用时使用。
const NANOKA_TERM_FALLBACKS = {
  3000015: '锐暴伤害',
}

/** 展开空术语标签，再去富文本、运行时模板和图标占位。 */
export function cleanNanokaText(raw, termNames) {
  return String(raw ?? '')
    .replace(/<Term:(\d+)>\s*<\/Term>/g, (_, id) => {
      const name = termNames?.[id]
      return typeof name === 'string' && name.trim() ? name.trim() : NANOKA_TERM_FALLBACKS[id] ?? ''
    })
    .replace(/<IconMap:[^>]*>/g, '')
    .replace(/\{[^{}]*\}/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** 抽一个片段里的全部数值：`{ value, unit, percent }`（`12%` → 12） */
export function extractNumbers(text) {
  const out = []
  const re = /\d+(?:\.\d+)?%?/g
  let match
  while ((match = re.exec(String(text ?? ''))) !== null) {
    const raw = match[0]
    const percent = raw.endsWith('%')
    const value = Number(percent ? raw.slice(0, -1) : raw)
    if (!Number.isFinite(value)) continue
    out.push({ value, unit: percent ? '%' : '点', percent })
  }
  return out
}

/** 抬头句的「前提头」特征（用于把 `前提：效果` 这类写在同一个子句里的情况拆开） */
const PREMISE_HEAD_RE =
  /时|若|存在|触发|达到|大于|不足|处于|状态|条件|队伍|敌人|目标|持有|装备|发动|命中|持续|以上|以下|每/

/** 把 `前提：效果` 拆成两个子句（`：` 不在括号里、且前半句像前提时才拆） */
function splitClauseAtColon(clause) {
  const index = clause.search(/[：:]/)
  if (index <= 0) return [clause]
  const head = clause.slice(0, index)
  const tail = clause.slice(index + 1).trim()
  if (!tail) return [clause]
  if (/[「」[\]【】]/.test(head)) return [clause] // `[强化特殊技：眩焰]` 这类名字不许拆
  if (!PREMISE_HEAD_RE.test(head)) return [clause]
  return [`${head}：`, tail]
}

/**
 * 切句：先按 `。；\n` 切「句（unit）」，再按 `，,` 切「子句」。返回 `[{ text, clauses }]`。
 *
 * ⚠ **抬头句合并**（用户 2026-10-16 报的 bug）：以 `：` 结尾的「抬头句」（如
 * 「…时发动：」「…时触发：」）**并入下一句**，因为它的作用范围就是它引领的那句描述。
 * 不合并的话，抬头句会变成独立的一句并让 `prefix` 泄漏到后面**别的句子**上
 * （实例：烬火追魂第 4 句凭空多出「下一次普通换入、快速支援、招架支援换入前场时发动」，
 * 还因此误判出「限定招式：招架支援 + 快速支援」）。
 */
export function splitUnits(text) {
  const cleaned = cleanNanokaText(text)
  if (!cleaned) return []
  const raw = cleaned
    .split(/[。；\n]/)
    .map((unit) => unit.trim())
    .filter(Boolean)
  const merged = []
  for (const unit of raw) {
    const previous = merged[merged.length - 1]
    if (previous && /[：:]$/.test(previous)) {
      merged[merged.length - 1] = `${previous}${unit}`
      continue
    }
    merged.push(unit)
  }
  return merged.map((unit) => {
    const clauses = []
    for (const clause of unit
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter(Boolean)) {
      clauses.push(...splitClauseAtColon(clause))
    }
    return { text: unit, clauses }
  })
}

/** 判定用的文本：去掉角色 / 音擎自身名与 `N号` 这类名字里的数字（「11号」的 11 不是增益数值） */
export function numberSafeText(text, selfNames = []) {
  let out = String(text ?? '')
  for (const name of selfNames) {
    if (!name) continue
    out = out.split(name).join('')
  }
  return out.replace(/[「」]?\d+号[「」]?/g, '')
}

/**
 * 抽「增益数值」token：与 `extractNumbers` 同口径，但**剔掉自身名里的数字**
 * （「11号」的 11 不是增益数值；判定靠数字后面紧跟 `号`）。
 */
function gainNumbers(text) {
  const source = String(text ?? '')
  const out = []
  const re = /\d+(?:\.\d+)?%?/g
  let match
  while ((match = re.exec(source)) !== null) {
    const raw = match[0]
    if (source[match.index + raw.length] === '号') continue
    const percent = raw.endsWith('%')
    const value = Number(percent ? raw.slice(0, -1) : raw)
    if (!Number.isFinite(value)) continue
    out.push({ value, unit: percent ? '%' : '点', percent, index: match.index })
  }
  return out
}

/**
 * 层数：**`层` 不是单位**（规格 §二硬规则 1）。
 * 只认「叠层」语义（`最多(叠加) N 层` / `每层`）；`充能 / 资源层数` 不算（走「不产条」）。
 */
export function readStackInfo(text) {
  const source = String(text ?? '')
  if (/充能|资源/.test(source)) {
    return { maxStacks: null, perStack: false, mentioned: false }
  }
  let maxStacks = null
  let perStack = false
  const maxMatch = /(?:最多|至多|上限)(?:叠加)?\s*(\d+)\s*层/.exec(source)
  if (maxMatch) maxStacks = Number(maxMatch[1])
  if (maxStacks === null) {
    const plain = /叠加\s*(\d+)\s*层/.exec(source)
    if (plain) maxStacks = Number(plain[1])
  }
  if (/每层/.test(source)) perStack = true
  return { maxStacks, perStack, mentioned: maxStacks !== null || perStack }
}

/**
 * 时长：`持续 15 秒` → 15（`时长` 独立槽位：不进数值、阶段2 不转化，规格 §二硬规则 4）。
 * 「N 秒内最多触发一次」是**触发上限**（条件），不是时长，先剔掉再判。
 * 「该效果的**持续时间**提升 2 秒」里 `持续时间` 是**属性**（不是时长槽位）→ 不标 `无法提取`。
 */
export function readDurationInfo(text) {
  const source = String(text ?? '').replace(/\d+\s*秒内最多触发[^，。；]*/g, '')
  const match = /持续(?:时间)?\s*(\d+(?:\.\d+)?)\s*秒/.exec(source)
  const durationAsStat = /持续时间(?:提升|增加|延长|缩短|降低|减少)/.test(source)
  const vague = /持续(?:时间)?\s*(?:一段|数|若干)?\s*(?:秒|时间)/.test(source)
  const mentioned =
    match !== null || /时限|持续时间限制|限制时间/.test(source) || (vague && !durationAsStat)
  return {
    seconds: match ? Number(match[1]) : null,
    mentioned,
  }
}

/**
 * 来源属性词典（`convert.from`）：**顺序即优先级**（`攻击力` 之类长的先认）。
 * 只认 `normalizeConvert` 的 ATTRS 里的键，不自创。
 */
const CONVERT_FROM_RULES = [
  { from: 'critRate', re: /暴击率/ },
  { from: 'critDmg', re: /暴击伤害/ },
  { from: 'mastery', re: /异常精通/ },
  { from: 'anomalyControl', re: /异常掌控/ },
  { from: 'energyRegen', re: /能量(?:自动)?回复|回能/ },
  { from: 'penRate', re: /穿透率/ },
  { from: 'pierce', re: /穿透值/ },
  { from: 'impact', re: /冲击力/ },
  { from: 'atk', re: /攻击力/ },
  { from: 'hp', re: /生命值|生命上限/ },
  { from: 'def', re: /防御力/ },
  { from: 'level', re: /等级/ },
]

/**
 * 「转化」句判定（动作=`转化` = 转模）：
 *   1. 显式转化动词；2. 「每点 X 使得/提升 Y」这类**按点转模**（句子动词可能是「提升」，语义是转模）。
 */
const CONVERT_VERB_RE = /转化|转换为|换算为|转为/
const CONVERT_PER_POINT_RE =
  /每\s*(?:1|一)?\s*点[^，。；]{0,20}?(?:会?使得|转化为|换算为|提升|增加|提高)/

/** 按点转模的起手（`每点` / `每1点`） */
const CONVERT_PER_POINT_HEAD_RE = /每\s*(?:1|一)?\s*点/

/** 这条子句是不是转模（动作=`转化`） */
export function isConvertClause(text) {
  const source = String(text ?? '')
  return CONVERT_VERB_RE.test(source) || CONVERT_PER_POINT_RE.test(source)
}

/**
 * 读「转模」（动作=`转化`）的专用槽位：来源属性 / 取值层 / 比例% / 基础值 / 上限。
 * 读不出的槽位一律 `无法提取`（**不许拿 `无` 糊过去**；那条进阶段二等用户补）。
 *
 * 两种句式都认：
 *   1. 显式转化动词：`每1点攻击力转化为1.5点生命值`
 *   2. 按点转模：`每点超过的异常掌控会使得该效果的暴击率额外提升0.7%`
 *
 * @param {string} text 该条关键字所在的完整文本（本子句 + 条件前缀）
 * @returns {{ convertFrom:string, convertPanelSource:string, convertRatio:number|string,
 *   convertBase:number|null, convertCap:number|null, fromLabel:string, targetText:string, reason:string }}
 */
export function readConvertParts(text) {
  const source = String(text ?? '')
  // 显式转化动词优先；没有时按「每点 X（使得/提升）Y」的起手切
  const verbMatch = CONVERT_VERB_RE.exec(source)
  const marker = verbMatch ?? CONVERT_PER_POINT_HEAD_RE.exec(source)
  const before = marker ? source.slice(0, marker.index) : source
  const after = marker ? source.slice(marker.index + marker[0].length) : source
  // 「…会使得/使/令 X 提升 Y」：转模的目标属性在「使得」之后
  const pivot = /(?:会?使得|令|使)/.exec(after)
  const targetText = pivot ? after.slice(pivot.index + pivot[0].length) : after

  const fromHit = CONVERT_FROM_RULES.find((rule) => rule.re.test(before))
  const convertFrom = fromHit?.from ?? UNABLE

  let convertPanelSource = 'external'
  if (/手动|自行设置/.test(source)) convertPanelSource = 'manual'
  else if (/最终面板|局内面板|最终值/.test(source)) convertPanelSource = 'final'
  else if (/局外|战外面板|局外面板|面板/.test(source)) convertPanelSource = 'external'

  // 比例：取「转化」后面**第一个**数值（`1点攻击力转化为1.5点生命值` → 1.5）；
  // 「上限 / 基础值」那两个数字不算比例，先剔掉。
  const ratioSource = after
    .replace(/上限\s*(?:为)?\s*[:：]?\s*\d+(?:\.\d+)?\s*%?/g, '')
    .replace(/(?:基础值|初始值)\s*[:：]?\s*\d+(?:\.\d+)?\s*%?/g, '')
  const ratioTokens = gainNumbers(ratioSource)
  const convertRatio = ratioTokens.length ? ratioTokens[0].value : UNABLE

  const explicitBase = /(?:基础值|初始值)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%?/.exec(source)
  // 「每点**超过** X 的…」/「大于 X 的部分」/「超出部分」：X 是**基础值**（不参与折算的那部分），
  // 用户 2026-10-16 报的坑：不落基础值 → 阶段2 会把全部来源值都折算进去（多算 X）。
  const exceedBase =
    /(?:超过|大于|高于|超出|多于)\s*(\d+(?:\.\d+)?)\s*(?:点|%|层)?/.exec(source) ??
    /(?:超过|大于|高于|超出|多于)[^，。；]{0,8}?(\d+(?:\.\d+)?)/.exec(source)
  const capMatch = /上限\s*(?:为)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%?/.exec(source)

  return {
    convertFrom,
    convertPanelSource,
    convertRatio,
    convertBase: explicitBase ? Number(explicitBase[1]) : exceedBase ? Number(exceedBase[1]) : null,
    convertCap: capMatch ? Number(capMatch[1]) : null,
    fromLabel: CONVERT_FROM_LABELS[convertFrom] ?? '',
    targetText,
    reason: convertFrom === UNABLE && convertRatio === UNABLE ? '转模的来源属性与比例都读不出' : '',
  }
}

/** 层数槽位文本（`最多 12 层` / `无` / `无法提取`） */
export function formatStacks(maxStacks, value) {
  if (value === UNABLE || value === NONE) return value
  if (Number.isFinite(Number(maxStacks)) && Number(maxStacks) > 0) return `最多 ${maxStacks} 层`
  return UNABLE
}

/** 时长槽位文本（`15 秒` / `无` / `无法提取`） */
export function formatDuration(seconds, value) {
  if (value === UNABLE || value === NONE) return value
  if (Number.isFinite(Number(seconds)) && Number(seconds) > 0) return `${seconds} 秒`
  return UNABLE
}

/**
 * 关键字 → 一行人类可读文本：`属性=… 动作=… 数值=… 单位=… 目标=… 条件=… 层数=… 时长=… 对象=…`
 * 动作=`转化` 时，后面再补**转模专用槽位**（来源属性 / 取值层 / 比例% / 基础值 / 上限）。
 */
export function formatKeywordSlots(slots, convert = null) {
  const show = (value) => {
    if (Array.isArray(value)) return value.join(' + ')
    if (value === null || value === undefined || value === '') return NONE
    return String(value)
  }
  const parts = SLOT_IDS.map((id) => `${SLOT_LABELS[id]}=${show(slots?.[id])}`)
  if (convert) {
    for (const id of CONVERT_SLOT_IDS) {
      parts.push(`${CONVERT_SLOT_LABELS[id]}=${show(convert?.[id])}`)
    }
  }
  return parts.join(' ')
}

/**
 * 关键字入库行（v3 变更 2）：`[关键字] 属性=…`；一条原文有 N 条关键字时带**序号索引**便于检索。
 * 只有一条时写 `[关键字]`，多条时写 `[关键字 1]`、`[关键字 2]`…
 */
export function formatKeywordLine(slots, index = 0, total = 1, convert = null) {
  const prefix = total > 1 ? `[关键字 ${index + 1}]` : KEYWORD_PREFIX
  return `${prefix} ${formatKeywordSlots(slots, convert)}`
}
/**
 * 一段原文的入库文本：`原文：…` + N 行 `[关键字] …`（**追加不覆盖**，规格 §四）。
 * v3：原文与关键字**都**入库，没有"选不选进"的开关；**废原文不入库**（只管传本条的关键字）。
 */
export function formatSourceBlock({ rawText, effects } = {}) {
  const list = Array.isArray(effects) ? effects : []
  const lines = [`原文：${String(rawText ?? '').trim()}`]
  list.forEach((effect, index) => {
    const slots = effect?.slots ?? effect
    const convert =
      slots?.action === '转化' || effect?.convert ? (effect?.convert ?? null) : null
    lines.push(formatKeywordLine(slots, index, list.length, convert))
  })
  return lines.join('\n')
}

// ================================================================== 招式锚点（v3 变更 5 / 6）

/**
 * 招式名 → 招式大类（复用仓库 `SkillCategoryId` 口径）。
 * **顺序即优先级**：越具体的越靠前（`强化特殊技` 必须先于 `特殊技`）。
 */
export const SKILL_LIMIT_RULES = [
  { name: '强化特殊技', category: 'special' },
  { name: '特殊技', category: 'special' },
  { name: '普通攻击', category: 'basic' },
  { name: '冲刺攻击', category: 'dodge' },
  { name: '闪避反击', category: 'dodge' },
  { name: '闪避', category: 'dodge' },
  { name: '招架支援', category: 'assist' },
  { name: '快速支援', category: 'assist' },
  { name: '支援突击', category: 'assist' },
  { name: '支援技', category: 'assist' },
  { name: '连携技', category: 'chain' },
  { name: '终结技', category: 'ultimate' },
  { name: '追加攻击', category: 'follow_up' },
]

/** 招式限定句里容易出现、但不是招式名的词（防误判） */
const SKILL_LIMIT_STOPWORDS = ['招式', '技能', '伤害', '增益']

/**
 * 从一段文本里找出「被限定的招式」。
 * 判据：命中 `SKILL_LIMIT_RULES` 里的招式名（`[普通攻击]` / `强化特殊技` 都算）。
 * `招式` / `技能` 这类泛称**不算**限定（否则任何增益句都会被判成"限定招式"）。
 */
export function detectSkillLimits(text) {
  const source = String(text ?? '')
  if (!source) return []
  const found = []
  for (const rule of SKILL_LIMIT_RULES) {
    if (!source.includes(rule.name)) continue
    if (SKILL_LIMIT_STOPWORDS.includes(rule.name)) continue
    if (found.some((item) => item.name === rule.name)) continue
    found.push({ name: rule.name, category: rule.category })
  }
  // 更具体的招式名命中时，吃掉被它包含的泛称（同一个招式，不该算两条限定）
  const suppress = [
    ['强化特殊技', '特殊技'],
    ['闪避反击', '闪避'],
    ['招架支援', '支援技'],
    ['快速支援', '支援技'],
    ['支援突击', '支援技'],
  ]
  let out = found
  for (const [specific, generic] of suppress) {
    if (out.some((item) => item.name === specific)) {
      out = out.filter((item) => item.name !== generic)
    }
  }
  return out
}

/** 锚点候选名（小类名 / 去标题前缀 / 去「技」尾） */
function anchorNameCandidates(name) {
  const raw = String(name ?? '').replace(/[[\]]/g, '').trim()
  const out = new Set()
  const push = (value) => {
    const norm = normalizeSkillName(value)
    if (norm) out.add(norm)
  }
  push(raw)
  push(stripSkillTitlePrefix(raw))
  if (raw.endsWith('技')) push(raw.slice(0, -1))
  else push(`${raw}技`)
  return [...out]
}

/**
 * 招式限定 → 既有锚点（**只认技能库已有小类 / 大类，不新建挂载点**）。
 *
 * @param {object} params
 * @param {Array<{name:string, category:string}>} params.limits `detectSkillLimits` 的结果
 * @param {Array<object>|null} params.anchors 技能库小类（`listCalculatorBuffs().skillSubcategories`）；
 *   `null` = 调用方没给（**不猜** → 判为关联不上）
 * @param {string} params.agentId 角色 id（小类按角色过滤，空 = 只看通用小类）
 * @returns {{ ok:boolean, resolved:Array, skillTargets:Array, skillCategory:string,
 *   skillSubcategoryId:string|null, reason:string, labels:string[] }}
 */
export function resolveSkillAnchors({ limits = [], anchors = null, agentId = '' } = {}) {
  const list = Array.isArray(limits) ? limits : []
  const labels = list.map((item) => item.name)
  if (!list.length) {
    return {
      ok: true,
      resolved: [],
      skillTargets: [],
      skillCategory: '',
      skillSubcategoryId: null,
      reason: '',
      labels,
    }
  }
  if (!Array.isArray(anchors)) {
    return {
      ok: false,
      resolved: [],
      skillTargets: [],
      skillCategory: '',
      skillSubcategoryId: null,
      reason: '技能库小类未加载，锚点关联不上 → 按 v3 规则这条不录',
      labels,
    }
  }

  const id = String(agentId ?? '')
  const forAgent = anchors.filter((sub) => {
    const subAgent = String(sub?.agentId ?? '')
    return !subAgent || !id || subAgent === id
  })

  const resolved = []
  const pendingCreates = []
  for (const limit of list) {
    const candidates = anchorNameCandidates(limit.name)
    const hit = forAgent.find((sub) => candidates.includes(normalizeSkillName(sub?.name)))
    if (hit) {
      resolved.push({
        name: limit.name,
        category: String(hit.categoryId ?? limit.category),
        subcategoryId: String(hit.id ?? '') || null,
        level: 'subcategory',
        needsCreate: false,
      })
      continue
    }
    // 用户 2026-10-16：关键字里的招式名不一定和技能名完全一致 →
    // **匹配不上就按该技能名建立锚点**再关联（建不出锚点才不录）。
    resolved.push({
      name: limit.name,
      category: limit.category,
      subcategoryId: null,
      level: 'category',
      needsCreate: true,
    })
    pendingCreates.push({
      name: limit.name,
      categoryId: limit.category,
      agentId: id,
    })
  }

  const skillTargets = []
  for (const item of resolved) {
    const key = `${item.category}|${item.subcategoryId ?? ''}`
    if (skillTargets.some((t) => `${t.category}|${t.subcategoryId ?? ''}` === key)) continue
    skillTargets.push({ category: item.category, subcategoryId: item.subcategoryId })
  }
  // 同一大类里既有「整大类」又有具体小类时，丢掉整大类那条（小类更精确，且已被覆盖）
  const scoped = skillTargets.filter(
    (t) =>
      t.subcategoryId != null ||
      !skillTargets.some((other) => other.category === t.category && other.subcategoryId != null),
  )
  const first = scoped[0] ?? null
  const allSameCategory = scoped.length === 1
  return {
    ok: true,
    resolved,
    skillTargets: scoped,
    skillCategory: allSameCategory ? String(first?.category ?? '') : '',
    skillSubcategoryId: allSameCategory ? (first?.subcategoryId ?? null) : null,
    pendingCreates,
    reason: '',
    labels,
  }
}

// ================================================================== 阶段1：槽位抽取

/**
 * 强负信号（**有数值也不产增益条**）：这些句子看起来像增益，但仓库里没有对应字段
 * （或属于别的线：招式倍率 / 生命值回复 / 资源点数）。
 *
 * v3：这类句子统一进「**废原文**」区（带丢弃原因，**不入库**，确认写入后丢弃）。
 * 与我方减伤一起是「整条丢弃」；`无法提取` 只是**槽位级**标记，那条仍然进阶段二等用户补。
 */
const HARD_SKIP_RULES = [
  { re: /获取效率|充能效率/, reason: '资源获取效率（仓库无对应字段）' },
  { re: /获得\d+(?:\.\d+)?层充能|消耗\d+(?:\.\d+)?层充能/, reason: '充能资源（不是增益叠层）' },
  {
    re: /(?:回复|恢复|补充)[^，。；]{0,10}生命值|生命值(?:回复|恢复)/,
    reason: '生命值回复（仓库无对应字段）',
  },
  {
    re: /每\s*\d+(?:\.\d+)?\s*秒(?:受到|造成)|每\s*\d+(?:\.\d+)?\s*秒[^，。；]{0,6}伤害/,
    reason: '周期伤害（归招式 / 异常线）',
  },
  { re: /(?:达到|为)最(?:大|小)值/, reason: '阈值说明（无新增数值）' },
  { re: /倍率/, reason: '倍率（归招式线）' },
  { re: /获得\d+(?:\.\d+)?点|消耗\d+(?:\.\d+)?点|最多拥有\d+(?:\.\d+)?点/, reason: '资源点数（仓库无对应字段）' },
  { re: /(?:获得|消耗|上限(?:为)?)\s*\d+(?:\.\d+)?\s*次/,
    reason: '状态 / 次数（仓库无对应字段）' },
  // 「使某个既有机制的易伤上限提升至 X%」：工具没有「改上限」字段 → 废原文
  {
    re: /(?:易伤|增伤|加成|减伤|穿透)[^，。；]{0,12}上限\s*(?:提升|增加|提高|至|为)/,
    reason: '改既有机制的上限（工具无「改上限」字段）',
  },
]

/** 结构句：只描述层数 / 时长 / 刷新，本身不产效果（由 unit 级后处理消费） */
const STRUCTURAL_RE =
  /^(?:最多|至多|上限)?(?:叠加)?\d+层(?:效果)?$|^每层(?:效果)?|^持续\d+(?:\.\d+)?秒$|^(?:重复触发)?刷新|^\d+秒内最多触发/

/** 触发上限 / 冷却尾巴（跟在增益句后面 → 补进该条的「条件」槽位） */
const TRAILING_LIMIT_RE = /\d+\s*秒内最多触发|最多触发(?:一次|\d+次)|冷却时间|内置冷却|刷新持续时间/

/** 阈值句（`大于 155 点` / `达到 255 点` / `不足 40 点`）：**永远**当条件，不产数值 */
const THRESHOLD_RE =
  /(?:大于|小于|超过|不足|达到|至少|高于|低于|不小于|不少于|等于|至多|最多拥有)\s*(?:等于|超过)?\s*\d+(?:\.\d+)?\s*(?:点|%|层)?/

/** 条件句尾巴：`…时` / `…后` / `…期间` / `…触发` */
const CONDITION_TAIL_RE = /(?:时|后|期间|情况下|状态下|触发)[：:]?$|^(?:若|如果|当|在)[^，。；]*$/

/** 指代 / 修饰词（`该增益效果` / `额外提升` / `再次提升`）：阶段1 归一 */
const REFERENCE_RE =
  /该(?:增益)?效果|上述效果|该增益|此效果|该效果|同样|额外提升|额外增加|再次提升|继续提升|额外获得/

/**
 * **异常语境判定**（用户 2026-10-16 报的坑）：同一句/子句说的是「（属性）异常伤害」时，
 * 后面那个「暴击率 / 暴击伤害 / 增伤」属于**属性异常暴击区**，不能落成普通 `critRate` / `critDmg`。
 *   - 本句出现「属性异常伤害 / 异常伤害 / 异常暴击」→ 打开异常语境（**按句重置**）；
 *   - 同句后面的子句（含用「该效果 / 该增益效果」指代的那句）**继承**这个语境。
 * 对照正例（1641 额外能力）：`…受到属性异常伤害的暴击伤害提升15%` → `attributeAnomalyCritDmg=15`；
 * 反例守则（1041 额外能力）：本句没有异常词时，「该增益效果额外提升 22.5%」不许判成异常区。
 */
const ANOMALY_MARK_RE = /(?:属性)?异常伤害|异常暴击/

/** 异常语境下要改写的属性（工具语义 → 异常区字段名） */
const ANOMALY_STAT_MAP = {
  暴击率: '属性异常暴击率',
  暴击伤害: '属性异常暴击伤害',
  增伤: '属性异常增伤',
}

/** 队伍 / 自身 指代 */
const TEAM_RE = /全队|队伍全体|我方全体|我方所有|队伍中所有|队伍中全体/
const SELF_RE = /自身|自己|装备者|本角色|当前操作角色/

/**
 * **游戏字面 → 工具语义** 的改写表（用户 2026-10-16 的结构性原则，只作说明 + 单测锚点）。
 *
 * 阶段1 输出的关键字必须是**工具语义**，不是游戏字面：游戏描述不合理的措辞在这里就改写掉
 * （把改写结果直接写进关键字的 `属性` 槽位），阶段2 才能保持"纯查表"。
 * 实际改写逻辑就在下面的 `STAT_RULES_INTERNAL`（顺序即优先级）；这张表是它的**可读清单**，
 * 单测按这张表逐条钉住。
 */
export const GAME_LITERAL_REWRITES = [
  {
    literal: '（目标/敌人）受到的伤害提升 X%',
    stat: '增伤',
    note: '⚠ 游戏描述不合理：实为**增伤**（`dmgBonus`），**不是**易伤 `vulnerable`',
  },
  {
    literal: '（目标/敌人）受到的伤害降低 X%',
    stat: '增伤',
    note: '同上；动作=降低 → 阶段2 取负号',
  },
  {
    literal: '失衡状态下受到的伤害提升 X%',
    stat: '失衡易伤',
    note: '→ `staggerVulnerable`（仅失衡期计入），条件槽位同时记失衡',
  },
  {
    literal: '失衡期与非失衡期均…',
    stat: '失衡易伤（全局）',
    note: '→ `globalStaggerVulnerable`（扳机式）',
  },
  {
    literal: '无视目标 X% 防御力',
    stat: '减防',
    note: '→ `reduceDefense`（动作=无视）',
  },
  {
    literal: '目标防御力降低 X%',
    stat: '减防',
    note: '→ `reduceDefense`（动作=降低）',
  },
  {
    literal: '无视目标 X% 抗性',
    stat: '抗性穿透',
    note: '→ `resPen`',
  },
]

/** 属性词典（**顺序即优先级**；取值与 `STAT_OPTIONS` 一一对应，写**工具语义**） */
const STAT_RULES_INTERNAL = [
  ...Object.keys(INDEPENDENT_ZONE_PERCENT_STATS).map((keyword) => ({
    keyword,
    re: new RegExp(`${keyword}[」】\\]]?\\s*(?:额外)?(?:提升|增加|提高|降低|减少|下降|[+＋])`),
  })),
  // ① 失衡易伤家族（「失衡状态下受到的伤害提升」）：全局/均生效的版本在阶段1 由作用域文本判定
  {
    keyword: '失衡易伤',
    re: /(?:失衡(?:状态|期|阶段)?)[^，。；]{0,14}(?:受到的伤害|受到伤害)(?:提升|增加|提高|降低|减少|下降)|失衡易伤/,
  },
  // ② 限定过主语（直伤 / 异常）的易伤仍是各自字段
  {
    keyword: '直伤易伤',
    re: /(?:敌人|敌方|目标|对方)[^，。；]{0,10}受到的直(?:伤|击)伤害(?:提升|增加|提高|降低|减少|下降)|直伤易伤/,
  },
  {
    keyword: '异常易伤',
    re: /(?:敌人|敌方|目标|对方)[^，。；]{0,12}受到的(?:属性)?异常伤害(?:提升|增加|提高|降低|减少|下降)|异常易伤/,
  },
  // ③ ⚠ 游戏描述坑：「（目标/敌人）受到的伤害提升 / 降低 X%」= **增伤**（不是易伤）
  {
    keyword: '增伤',
    re: /(?:敌人|敌方|目标|对方)[^，。；]{0,10}(?:受到的伤害|受到伤害)(?:提升|增加|提高|降低|减少|下降)/,
  },
  // ④ 减防 / 抗性穿透（无视 / 降低 的落法）
  { keyword: '减防', re: /(?:无视|降低|减少)[^，。；]{0,8}防御力|防御力(?:降低|减少|下降)/ },
  { keyword: '抗性穿透', test: (t) => /抗性/.test(t) && /无视|降低|减少|穿透/.test(t) },
  { keyword: '招式增伤', re: /招式(?:造成的)?伤害|招式增伤|技能(?:造成的)?伤害|技能伤害/ },
  { keyword: '属性异常暴击伤害', re: /属性异常伤害(?:的)?暴击伤害|异常伤害(?:的)?暴击伤害|异常暴击伤害/ },
  { keyword: '属性异常暴击率', re: /属性异常伤害(?:的)?暴击率|异常伤害(?:的)?暴击率|异常暴击率/ },
  { keyword: '异常精通', re: /异常精通/ },
  { keyword: '异常掌控', re: /异常掌控/ },
  { keyword: '属性异常增伤', re: /属性异常伤害|异常伤害/ },
  { keyword: SHARPEN_CRIT_DMG_LABEL, re: /锐[爆暴]伤害/ },
  { keyword: '暴击率', re: /暴击率/ },
  { keyword: '暴击伤害', re: /暴击伤害/ },
  {
    keyword: '',
    test: (t) => /(?:物理|火|冰|电|以太|风)属性伤害/.test(t),
    keywordOf: (t) => `${/(物理|火|冰|电|以太|风)属性伤害/.exec(t)?.[1] ?? ''}属性伤害`,
  },
  { keyword: '全属性伤害', re: /全属性伤害/ },
  { keyword: '能量自动回复', re: /能量(?:自动)?(?:回复|恢复|回能)|回能(?:效率|速度)|能量(?:效率|速度)/ },
  // 「能量」本身没有工具字段（瞬时回能 = 废原文，见 v3.12/v3.13）
  { keyword: '攻击力', re: /攻击力|基础攻击力/ },
  { keyword: '生命值', re: /生命值|生命上限/ },
  { keyword: '防御力', re: /防御力/ },
  { keyword: '穿透率', re: /穿透率/ },
  { keyword: '穿透', re: /穿透值|穿透(?!率)/ },
  { keyword: '冲击力', re: /冲击力/ },
  { keyword: '持续时间', re: /持续时间(?:提升|增加|延长|缩短|降低|减少)/ },
  { keyword: '技能等级', re: /技能等级/ },
  // ⑤ 兜底增伤（最泛的「造成的伤害提升 / 增伤」）
  { keyword: '增伤', re: /造成的伤害|伤害(?:提升|增加|提高|加成)|增伤/ },
]

/**
 * 把「属性」再按上下文细化成工具语义：攻击力按局内 / 局外 / 固定拆开（用户点名的语义名）。
 * 返回新的属性取值。
 */
export function refineStatKeyword(keyword, { text = '', unit = '' } = {}) {
  const stat = String(keyword ?? '')
  if (stat !== '攻击力') return stat
  if (unit === '点') return '攻击力（固定）'
  if (/局内|最终面板|最终值/.test(String(text ?? ''))) return '攻击力（局内）'
  return '攻击力（局外）'
}

/**
 * 动作词典（**动作必须有**；`为/是/达到` 这类系词按 `提升` 归一）。
 * `回复` **不在表里**（用户 2026-10-16 最终口径）：回复类句子走可映射性预检 → 废原文。
 */
const ACTION_RULES_INTERNAL = [
  { keyword: '无视', re: /无视/ },
  { keyword: '降低', re: /降低|减少|下降|衰减|削减/ },
  { keyword: '转化', re: /转化|转换为|换算为|转为/ },
  { keyword: '提升', re: /提升|增加|提高|提供|加成|强化|增长/ },
]

const IMPLICIT_ACTION_RE = /(?:为|是|达到|达)\s*\d|[+＋]\s*\d/

/**
 * 我方减伤**不存在**（用户 2026-10-16 二次确认）：仓库里的 `dmgReduction` 等字段是
 * 「**目标**的减伤」语义（从输出里扣），不是角色自身减伤 → 这类句子进**废原文**。
 * 注意区分：**「敌方受到的伤害提升」= 易伤 `vulnerable`，是增益，要留**。
 */
const SELF_DAMAGE_REDUCTION_RE =
  /(?:受到(?:的)?伤害(?:降低|减少|下降)|伤害减免|减伤|受伤(?:降低|减少))/

/** 不进动作表的动词（`获得` / `视为` / `替代` / `进入…状态`）：当条件用，或进废原文 */
const NON_ACTION_VERB_RE = /获得|视为|替代|进入[^，。；]{0,8}状态/

/** 伤害描述句（`造成火属性伤害` 这类纯描述，不是增益） */
const DAMAGE_STATEMENT_RE = /造成[^，。；]{0,12}伤害|视为[^，。；]{0,12}伤害/

/** 增益动词（判定「这句是不是在说增益」用） */
const BUFF_VERB_RE = /提升|增加|提高|降低|减少|无视|回复|恢复|获得|提供|加成|强化|增长|转化/

/** 属性槽位：命中即返回具体 keyword（未命中返回 ''） */
function detectStatKeyword(text) {
  for (const rule of STAT_RULES_INTERNAL) {
    if (rule.test ? rule.test(text) : rule.re.test(text)) {
      return rule.keywordOf ? rule.keywordOf(text) : rule.keyword
    }
  }
  return ''
}

/** 动作槽位：`{ value, source }`（未命中 → `无法提取`） */
function detectAction(text) {
  for (const rule of ACTION_RULES_INTERNAL) {
    if (rule.re.test(text)) return { value: rule.keyword, source: 'literal' }
  }
  if (IMPLICIT_ACTION_RE.test(text)) return { value: '提升', source: 'implicit' }
  return { value: UNABLE, source: 'unable' }
}

/** 只把按实际伤害折算的积攒量翻成烬痕比例。 */
const EMBER_MARK_ACCUMULATION_RULES = [
  {
    type: 'named',
    pattern: /^(?<actor>[^，。；\s]+?)发动(?<names>\[[^\]]+\](?:、\[[^\]]+\])*)命中敌人造成伤害时，(?:均)?可使目标积攒(?:\[烬痕\])?，\[烬痕\]量等同于招式造成的实际伤害的(?<percent>\d+(?:\.\d+)?)%$/,
    description: '自身，按原文明列的招式锚点匹配',
  },
  {
    type: 'destruction',
    pattern: /^全队(?:代理人)?造成的\[毁伤\](?:也)?可使目标积攒等同于(?:该次)?实际伤害的?(?<percent>\d+(?:\.\d+)?)%的\[烬痕\]$/,
    description: '全队，招式类型限定毁伤',
  },
  {
    type: 'otherSharpen',
    pattern: /^(?<actor>[^，。；\s]+?)发动(?:其他|其余)招式命中敌人造成锐化伤害时，(?:也)?可使目标积攒(?<term>\[烬痕\])?，积攒量等同于(?:该次)?实际伤害的(?<percent>\d+(?:\.\d+)?)%$/,
    description: '自身，排除核心被动已列招式和毁伤段，其余锐化招式按锚点匹配',
  },
]

function readEmberMarkAccumulation(text, rule, selfNames) {
  const groups = rule.pattern.exec(text)?.groups
  if (!groups) return null
  if (groups.actor && selfNames.length && ![...selfNames, '自身', '自己'].includes(groups.actor)) return null
  const names = Array.from((groups.names ?? '').matchAll(/\[([^\]]+)\]/g), ([, name]) => name)
  return { type: rule.type, names, value: Number(groups.percent), explicit: Boolean(groups.term) }
}

function resolveEmberMarkTargets({ names, otherSharpen, agentId, profession, skills, anchors }) {
  const pending = (reason) => ({ ok: false, labels: names, resolved: [], skillTargets: [], reason })
  if (!names.length) return pending('缺少核心被动的烬痕招式名单，需手工确认其余锐化招式')

  const localSkills = skills.filter((skill) => String(skill.agentId) === agentId)
  const ordinaryDirectSkills = localSkills.filter((skill) =>
    ['direct', 'sharpen'].includes(skill.damageType) && !skill.skillTypes?.includes('destruction'),
  )
  const namedSkills = new Set()
  for (const name of names) {
    const normalized = normalizeSkillName(name)
    const matches = ordinaryDirectSkills.filter((skill) => {
      const skillName = normalizeSkillName(skill.name)
      return skillName === normalized || skillName.startsWith(`${normalized}·`)
    })
    if (!matches.length) return pending(`缺少招式「${name}」，请先采集招式或手工补范围`)
    for (const skill of matches) namedSkills.add(skill)
  }
  const selected = otherSharpen
    ? ordinaryDirectSkills.filter((skill) =>
        !namedSkills.has(skill) && profession !== '命破' &&
        (skill.damageType === 'sharpen' || profession === '锋御'),
      )
    : [...namedSkills]
  if (!selected.length) return pending('没有可绑定的其余锐化招式，需手工确认范围')

  const anchorsById = new Map((anchors ?? [])
    .filter((anchor) => String(anchor.agentId) === agentId)
    .map((anchor) => [String(anchor.id), anchor]))
  const selectedAnchors = new Map()
  for (const skill of selected) {
    const anchor = anchorsById.get(String(skill.buffAnchorId ?? ''))
    if (!anchor?.categoryId) return pending(`「${skill.name}」缺少本角色的增益锚点，请绑定后重试`)
    selectedAnchors.set(String(anchor.id), anchor)
  }
  const selectedSkills = new Set(selected)
  const shared = localSkills.find((skill) => !selectedSkills.has(skill) && selectedAnchors.has(String(skill.buffAnchorId ?? '')))
  if (shared) return pending(`「${shared.name}」与适用招式共用锚点，需先拆分锚点`)

  const resolved = [...selectedAnchors.values()].map((anchor) => ({
    name: anchor.name,
    category: anchor.categoryId,
    subcategoryId: String(anchor.id),
    level: 'subcategory',
  }))
  return {
    ok: true,
    labels: resolved.map((anchor) => anchor.name),
    resolved,
    skillTargets: resolved.map(({ category, subcategoryId }) => ({ category, subcategoryId })),
    reason: '',
  }
}

function extractEmberMarkKeyword({ text, unitIndex, index, origin, selfNames, anchors, agentId, emberMarkContext }) {
  const [namedRule] = EMBER_MARK_ACCUMULATION_RULES
  for (const rule of EMBER_MARK_ACCUMULATION_RULES) {
    const accumulation = readEmberMarkAccumulation(text, rule, selfNames)
    if (!accumulation) continue
    const { type, value } = accumulation
    const team = type === 'destruction'
    const otherSharpen = type === 'otherSharpen'
    const names = otherSharpen
      ? splitUnits(emberMarkContext.corePassiveText).flatMap(({ text: unit }) =>
          readEmberMarkAccumulation(unit, namedRule, selfNames)?.names ?? [],
        )
      : accumulation.names
    // 未展开的术语只有在同一角色核心被动明确记载烬痕时才可视为烬痕。
    if (otherSharpen && !accumulation.explicit && !names.length) continue
    const anchorInfo = team
      ? {
          ok: true,
          labels: ['毁伤'],
          resolved: [],
          skillTargets: [{ category: 'destruction', subcategoryId: null }],
          reason: '',
        }
      : resolveEmberMarkTargets({
          names, otherSharpen, agentId, anchors,
          profession: emberMarkContext.profession,
          skills: emberMarkContext.skills ?? [],
        })
    const slots = createSlots({
      stat: { value: '烬痕比例' }, action: { value: '提升' }, value: { value }, unit: { value: '%' },
      target: { value: team ? '全队' : '自身' }, scope: { value: otherSharpen ? '锐化' : '招式' },
    })
    const sources = createSources({
      stat: { source: 'literal' }, action: { source: 'implicit' }, value: { source: 'literal' },
      unit: { source: 'literal' }, target: { source: team ? 'literal' : 'implicit' }, scope: { source: 'literal' },
    })
    const first = anchorInfo.skillTargets[0]
    return {
      id: `${origin}#${index}`,
      origin,
      index,
      unitIndex,
      unitText: text,
      sentence: text,
      slots,
      sources,
      convert: null,
      stackMax: null,
      durationSeconds: null,
      anchors: {
        ...anchorInfo,
        skillCategory: anchorInfo.skillTargets.length === 1 ? first.category : '',
        skillSubcategoryId: anchorInfo.skillTargets.length === 1 ? first.subcategoryId : null,
      },
      recorded: anchorInfo.ok,
      dropReason: anchorInfo.reason,
    }
  }
  return null
}

/** 阈值短语（永远当条件，数值不进「数值」槽位） */
function extractThresholds(text) {
  const found = []
  const re = new RegExp(THRESHOLD_RE.source, 'g')
  let match
  while ((match = re.exec(String(text ?? ''))) !== null) found.push(match[0].trim())
  return found
}

/** 条件句判定：阈值句恒为条件；`…时/后/期间` 且（去掉自身名后）无数字时也是条件 */
function isConditionOnly(text, selfNames = []) {
  if (extractThresholds(text).length) return true
  if (!CONDITION_TAIL_RE.test(text)) return false
  return gainNumbers(numberSafeText(text, selfNames)).length === 0
}

/** `无` 条件（无条件 = 全局） */
function noCondition() {
  return [NONE]
}

function conditionList(parts) {
  const list = []
  for (const part of parts) {
    const text = String(part ?? '').trim()
    if (!text || text === NONE) continue
    if (!list.includes(text)) list.push(text)
  }
  return list.length ? list : noCondition()
}

/**
 * **槽位值白名单（结构性硬校验）** —— 用户铁律：*解析不出来就是 `无法提取`，
 * 绝不允许把原文粘进槽位*（把原句塞进条件槽等于伪造「可转换」）。
 *
 * 每个槽位的合法取值只有两类：
 *   a. 来自**该槽位的枚举 / 词表**（属性、动作、单位、目标、作用域、条件可选项、元素…）；
 *   b. 字面量 `无` 或 `无法提取`。
 * 其余任何值（原句片段、含标点的长文本、超长字符串…）→ **一律改写成 `无法提取`**，
 * 并在该条上记 `unmappableSlots`，**不写 note、不冒充条件**。
 */
const SLOT_VALUE_PREDICATES = {
  stat: (value) => STAT_OPTIONS.includes(value) || Object.prototype.hasOwnProperty.call(STAT_TABLE, value),
  elements: (value) => ELEMENTS.includes(value),
  action: (value) => ACTION_OPTIONS.includes(value),
  value: (value) => /^\d+(?:\.\d+)?%?$/.test(String(value).trim()),
  unit: (value) => UNIT_OPTIONS.includes(value),
  target: (value) => TARGET_OPTIONS.includes(value),
  conditions: (value) => MODELABLE_CONDITION_RES.some((re) => re.test(value)),
  scope: (value) => SCOPE_OPTIONS.includes(value),
  stacks: (value) => /^(?:最多\s*)?\d+\s*层$/.test(String(value).trim()),
  duration: (value) => /^\d+(?:\.\d+)?\s*秒$/.test(String(value).trim()),
  object: (value) => OBJECT_OPTIONS.includes(value),
}

/** 单值槽位：词表外 → `无法提取`；多值槽位（条件 / 元素）：词表外的项剔掉并追加 `无法提取` */
export function enforceSlotWhitelist(slots = {}) {
  const out = { ...slots }
  const violations = []
  const isAllowed = (id, value) => {
    const text = String(value ?? '').trim()
    if (!text || text === NONE || text === UNABLE) return true
    const predicate = SLOT_VALUE_PREDICATES[id]
    if (!predicate) return true
    // 硬护栏：任何含句读的长文本都不可能是枚举值
    if (text.length > 24 || /[。；：，、！？]/.test(text)) return false
    return predicate(text)
  }
  for (const id of SLOT_IDS) {
    const value = out[id]
    if (Array.isArray(value)) {
      const kept = []
      let hit = false
      for (const item of value) {
        if (isAllowed(id, item)) {
          if (!kept.includes(item)) kept.push(item)
          continue
        }
        hit = true
        violations.push({ slot: id, value: String(item), reason: 'unmappable-condition' })
      }
      if (hit) kept.push(UNABLE)
      out[id] = kept.length ? kept : [NONE]
      continue
    }
    if (!isAllowed(id, value)) {
      violations.push({ slot: id, value: String(value), reason: 'unmappable-condition' })
      out[id] = UNABLE
    }
  }
  return { slots: out, violations }
}

/**
 * **解析规则对照表**（用户 2026-10-16 欠账）：从本文件的词表 / 规则**自动导出**，
 * 单一事实来源（不许手写第二份）。前端「解析规则」弹窗与 `dev-docs/nanoka-buff-rules-*.md`
 * 都吃这一份数据。
 *
 * @returns {{ version:string, groups:Array<{ id:string, title:string, items:Array<{game:string, slot:string, field:string, note:string}> }> }}
 */
/**
 * **合集扇出**（**抽取层**映射表；用户 2026-10-16）⭐
 *
 * 游戏原文里有些词是「合集」：一个词在语义上覆盖多个子类，而工具字段是**分离**的
 * → 一句原文按这张表扇出成**多条独立效果**（每条可单独勾选/删除）。
 *
 * ⚠️ 边界（用户强调）：
 *   - 这张表**只决定"这句原文生成哪几条效果"**；生成出来的就是普通效果对象；
 *   - 合集信息（`collection`）**只用于抽取结果与界面回显**：写入库前剔除、
 *     **不进结算、不被字段定义 / scope 数组 / 迁移 / 校验引用**；
 *   - 界面徽章「合集：属性伤害」只是**来源提示**，不是数据层属性。
 *
 * 口径（用户给定）：属性伤害 = 异常 / 异放 / 乱流 / 耀变（**不含紊乱**）；
 * 属性暴击 / 属性暴击伤害同口径（不含紊乱）；紊乱以后可能补。
 * 单一目标词（「异放伤害」「异常精通」…）**不被合集吃掉** —— 它们解析出的 stat
 * 不在下表的 `primaryStats` 里，天然不匹配。
 */
export const COLLECTION_FANOUT_RULES = [
  {
    id: 'attribute-damage',
    title: '属性伤害',
    /** 原文匹配（**前面不能是元素字**，否则是「火属性伤害」= 元素增伤，不扇出） */
    re: /(?:^|[^物理火冰电以太风])属性(?:异常)?伤害/,
    /** 当前解析出的 stat（合集代表值） */
    primaryStats: new Set(['属性异常增伤', '增伤']),
    targets: [
      // 落**专用字段**（用户 2026-10-16：有专用字段就落专用字段，不要「共用字段 + scope」）→ 作用域槽位保持「无」
      { stat: '属性异常增伤', scopeSlot: '无' },
      { stat: '异放增伤', scopeSlot: '无' },
      { stat: '乱流增伤', scopeSlot: '无' },
      { stat: '耀变增伤', scopeSlot: '无' },
    ],
    note: '合集 = 属性异常 / 异放 / 乱流 / 耀变（不含紊乱）',
  },
  {
    id: 'attribute-crit-rate',
    title: '属性暴击',
    re: /(?:^|[^物理火冰电以太风])属性(?:异常)?暴击率|属性暴击(?!伤害)/,
    primaryStats: new Set(['属性异常暴击率', '暴击率']),
    targets: [
      { stat: '属性异常暴击率', scopeSlot: '无' },
      { stat: '异放暴击率', scopeSlot: '无' },
      { stat: '乱流暴击率', scopeSlot: '无' },
      { stat: '耀变暴击率', scopeSlot: '无' },
    ],
    note: '合集 = 属性异常 / 异放（不含紊乱；乱流 / 耀变等字段待建）',
  },
  {
    id: 'attribute-crit-dmg',
    title: '属性暴击伤害',
    re: /(?:^|[^物理火冰电以太风])属性(?:异常)?暴击伤害/,
    primaryStats: new Set(['属性异常暴击伤害', '暴击伤害']),
    targets: [
      { stat: '属性异常暴击伤害', scopeSlot: '无' },
      { stat: '异放暴击伤害', scopeSlot: '无' },
      { stat: '乱流暴击伤害', scopeSlot: '无' },
      { stat: '耀变暴击伤害', scopeSlot: '无' },
    ],
    note: '合集 = 属性异常 / 异放（不含紊乱；乱流 / 耀变等字段待建）',
  },
]

/** 命中合集规则（只看本句文本 + 当前 stat） */
function matchCollectionRule(clauseText, statKeyword, elementsSlot) {
  const text = String(clauseText ?? '')
  // 「全属性伤害」= 不限元素的元素增伤（单一目标词）→ 不按合集处理
  if (/全属性/.test(text) || String(statKeyword ?? '').startsWith('全属性')) return null
  for (const rule of COLLECTION_FANOUT_RULES) {
    if (!rule.re.test(text)) continue
    if (!rule.primaryStats.has(String(statKeyword ?? ''))) continue
    // 「火属性伤害」= 元素增伤（元素槽有值）→ 不是合集
    if (elementsSlot && elementsSlot !== NONE) continue
    return rule
  }
  return null
}

/**
 * 把一条关键字效果按合集规则扇出成多条（**纯函数**；不命中就原样返回 `[effect]`）。
 * 每条扇出项带 `collection` 元数据（抽取/界面用，入库前剔除）。
 */
export function planCollectionFanOut({ effect, clauseText, statKeyword, effectsLength = 0 }) {
  const elementsSlot = Array.isArray(effect?.slots?.elements)
    ? effect.slots.elements.find((item) => item && item !== NONE) ?? NONE
    : effect?.slots?.elements
  const rule = matchCollectionRule(clauseText, statKeyword, elementsSlot)
  if (!rule) return [effect]
  return rule.targets.map((target, offset) => ({
    ...effect,
    id: `${effect.origin}#${effectsLength + offset}`,
    index: effectsLength + offset,
    slots: { ...effect.slots, stat: target.stat, scope: target.scopeSlot },
    sources: { ...effect.sources, stat: 'literal', scope: 'literal' },
    /** 合集元数据（**不入库**）：界面徽章「合集：属性伤害」用它 */
    collection: { id: rule.id, title: rule.title, note: rule.note, targetStat: target.stat },
  }))
}

export function buildCollectionFanOutRulesTable() {
  return COLLECTION_FANOUT_RULES.map((rule) => ({
    id: rule.id,
    title: rule.title,
    targets: rule.targets.map((target) => `${target.stat}（作用域=${target.scopeSlot}）`),
    note: rule.note,
  }))
}

/**
 * **子类专用字段**（用户 2026-10-16 口径）：工具里**有专用字段**的子类就落专用字段，
 * **不要**「共用字段 + scope」（例：「异放伤害」→ `anomalyReleaseDmgBonus`，不是 `dmgBonus` + `scope:['anomalyRelease']`）。
 *
 * `scope` 只用于**没有专用字段**的场合（例：限定某子类的暴击 —— 等第 3 项把
 * `turbulence/radiance/disorder Crit*` 建好后，暴击类也一律落专用字段）。
 *
 * 判定：属性槽位是「增伤 / 属性异常增伤」这一族 + 本句或作用域槽出现子类词。
 */
const SUBKIND_DEDICATED = [
  { label: '异放', re: /异放/, damage: '异放增伤', critRate: '异放暴击率', critDmg: '异放暴击伤害' },
  { label: '乱流', re: /乱流/, damage: '乱流增伤', critRate: '乱流暴击率', critDmg: '乱流暴击伤害' },
  { label: '耀变', re: /耀变/, damage: '耀变增伤', critRate: '耀变暴击率', critDmg: '耀变暴击伤害' },
  { label: '紊乱', re: /紊乱/, damage: '紊乱增伤', critRate: '紊乱暴击率', critDmg: '紊乱暴击伤害' },
  // 「异常」放最后（最泛）：它本身就落在 attributeAnomalyDmgBonus / attributeAnomalyCritRate / attributeAnomalyCritDmg 这些专用字段上
  {
    label: '属性异常（强击）',
    re: /强击|属性异常|异常/,
    damage: '属性异常增伤',
    critRate: '属性异常暴击率',
    critDmg: '属性异常暴击伤害',
  },
]

/** 「增伤」族 */
const DAMAGE_FAMILY_STATS = new Set(['增伤', '属性异常增伤', '全属性伤害'])
/** 「暴击率」族 */
const CRIT_RATE_FAMILY_STATS = new Set(['暴击率', '属性异常暴击率'])
/** 「暴击伤害」族 */
const CRIT_DMG_FAMILY_STATS = new Set(['暴击伤害', '属性异常暴击伤害'])

/**
 * 命中子类专用字段（返回 `{ label, stat }`；不命中返回 null）。
 *
 * 覆盖三族：增伤 / 暴击率 / 暴击伤害 —— **有专用字段就落专用字段**（用户 2026-10-16）。
 */
export function detectSubkindDedicatedField({ statKeyword, scopeText = '' }) {
  const keyword = String(statKeyword ?? '')
  const family = DAMAGE_FAMILY_STATS.has(keyword)
    ? 'damage'
    : CRIT_RATE_FAMILY_STATS.has(keyword)
      ? 'critRate'
      : CRIT_DMG_FAMILY_STATS.has(keyword)
        ? 'critDmg'
        : ''
  if (!family) return null
  // 只看**作用域槽位**（它由本句解析而来）；绝不用整块原文，否则会误伤同一块里的其它句
  const haystack = String(scopeText ?? '')
  for (const rule of SUBKIND_DEDICATED) {
    if (rule.re.test(haystack)) return { label: rule.label, stat: rule[family] }
  }
  return null
}

export function buildRulesTable() {
  const items = (game, slot, field, note = '') => ({ game, slot, field, note })
  const reText = (value) => String(value)
  const groups = [
    {
      id: 'collection-fanout',
      title: '合集扇出（**抽取层映射**：原文合集词 → 生成哪几条效果；与"工具支持哪些字段"无关）',
      items: [
        ...COLLECTION_FANOUT_RULES.flatMap((rule) =>
          rule.targets.map((target) =>
            items(
              reText(rule.re),
              `属性=${target.stat}`,
              `作用域=${target.scopeSlot}`,
              `${rule.title}；${rule.note}`,
            ),
          ),
        ),
        items('单一目标词（「异放伤害」「异常精通」…）', '保持 1 条', '', '不被合集吃掉（stat 不在合集的 primaryStats 里）'),
        items('「火属性伤害」这类<元素>属性伤害', '保持 1 条（元素增伤）', '', '前一个字是元素字 → 不按合集处理'),
        items('合集信息（`collection`）', '不入库 / 不进结算', '', '只用于抽取结果与界面徽章「合集：…」来源提示'),
      ],
    },
    {
      id: 'stat',
      title: '属性/字段清单（**工具层**：游戏措辞 → 关键字「属性」槽位 → 阶段2 字段）',
      items: STAT_RULES_INTERNAL.map((rule) =>
        items(
          reText(rule.re),
          rule.keyword,
          Object.values(STAT_TABLE[rule.keyword] ?? {})[0] ?? '（词表里没有对应字段 → 废原文）',
          '',
        ),
      ),
    },
    {
      id: 'stat-alias',
      title: '属性别名（老数据 / 手动补词：属性值 → 阶段2 字段）',
      items: Object.entries(STAT_TABLE).map(([keyword, byUnit]) =>
        items('（手动 / 老字样）', keyword, Object.values(byUnit)[0] ?? '', `单位档：${Object.keys(byUnit).join(' / ')}`),
      ),
    },
    {
      id: 'ember-mark-accumulation',
      title: '烬痕积攒量',
      items: EMBER_MARK_ACCUMULATION_RULES.map(({ pattern, description }) =>
        items(reText(pattern), '烬痕比例', INDEPENDENT_ZONE_PERCENT_STATS.烬痕比例, description),
      ),
    },
    {
      id: 'action',
      title: '动作词表（→ 关键字「动作」槽位；无「回复」）',
      items: ACTION_RULES_INTERNAL.map((rule) => items(reText(rule.re), rule.keyword, '', '')),
    },
    {
      id: 'literal',
      title: '游戏字面改写规则（游戏原文 → 工具语义 → 阶段2 字段）',
      items: GAME_LITERAL_REWRITES.map((rule) =>
        items(
          rule.game ?? '',
          rule.tool ?? rule.keyword ?? '',
          rule.field ?? '',
          rule.note ?? `动作：${rule.action ?? ''}`,
        ),
      ),
    },
    {
      id: 'anomaly',
      title: '异常语境（本句有「属性异常伤害 / 异常暴击」时改写属性）',
      items: Object.entries(ANOMALY_STAT_MAP).map(([from, to]) =>
        items(`本句出现 ${reText(ANOMALY_MARK_RE)}`, to, Object.values(STAT_TABLE[to] ?? {})[0] ?? '', `原属性：${from}`),
      ),
    },
    {
      id: 'convert',
      title: '转模（动作=转化）专用槽位与吸收规则',
      items: [
        ...CONVERT_SLOT_IDS.map((id) => items(CONVERT_SLOT_HINTS[id] ?? '', CONVERT_SLOT_LABELS[id], '', '')),
        ...ABSORBED_CONDITION_RULES.map((rule) =>
          items(reText(rule.re), `条件被吸收 → ${rule.absorbed}`, 'convert.defaultBase', '不写「无法提取」'),
        ),
      ],
    },
    {
      id: 'scope',
      title: '作用域（= 编辑器 `scope`；「限定招式」并进这一格）',
      items: [
        ...SCOPE_RULES.map((rule) =>
          items(reText(rule.re), rule.id, SCOPE_SLOT_TO_ID[rule.id] ?? '', ''),
        ),
        items('该句明确限定某招式（锚点匹配 / 建锚点）', '招式', 'skill + skillTargets', '锚点建不出 → 这条不录'),
        items('（没认出来）', NONE, 'general（不写 scope）', ''),
      ],
    },
    {
      id: 'target',
      title: '目标判定（以主语为准：点名角色 → 自身；无主语 + 敌人状态 → 全队）',
      items: [
        // 规则① 最高优先：点名角色 / 自身类主语
        items('句子里点名角色（本角色名，如「菲欧妮…」「11号…」）', '自身', 'applyTarget=self', '规则① 最高优先（压过敌人状态→全队）'),
        items('句子写「自身 / 自己 / 装备者 / 该代理人 / 本角色」', '自身', 'applyTarget=self', '规则①'),
        // 规则② 无主语（泛指）+ 敌人状态限定
        items(
          '无主语（泛指）+ 敌人状态句式（「[X]状态下的敌人受到…」「对[X]状态下的敌人造成…」）',
          '全队',
          'applyTarget=team',
          `规则② **增伤与暴击族都适用**；note 写固定短语：${ENEMY_STATUS_TARGET_NOTE}`,
        ),
        ...ENEMY_STATUS_CRIT_STATS_LIST.map((stat) =>
          items(
            `属性=${stat} + 敌人状态句式（形如「[X]状态下的敌人受到…」）且未限定施放者`,
            '全队',
            'applyTarget=team',
            `note 写固定短语：${ENEMY_STATUS_TARGET_NOTE}`,
          ),
        ),
        // 规则③ 无主语、也不带敌人状态 → 不动
        items('无主语且**不带**敌人状态（例：「造成的伤害提升20%」）', '沿用既有默认', '', '规则③ 保持现状，不改成全队'),
        // 指回前句（放在规则②之前）
        items(
          '句中含「该增益效果 / 该效果 / 该增益 / 上述效果」且**同段前一条已有目标**',
          '沿用被指向那条的目标（通常 自身）',
          'sources.target=refer-back',
          '指回前句回落：不因为句中出现「…状态下的敌人」就翻成全队（条件仍用 applySituation 表达）',
        ),
        items('句中有指回词但**前一条没有自身增益可回落**', '按规则②判（无主语 + 敌人状态 → 全队）', '', '边界'),
        // 规则⑤ 敌人削弱族：按动作分（用户 2026-10-17）
        ...ENEMY_DEBUFF_STATS_LIST.flatMap((stat) => [
          items(
            `属性=${stat} + 动作=**无视**（形如「无视目标15%抗性 / 无视敌人40%防御力」）`,
            '自身',
            'applyTarget=self',
            '穿透是**施放者自己**的属性（2026-10-17 修正）；判成全队会让队友都吃这份穿透',
          ),
          items(
            `属性=${stat} + 动作=**降低 / 减少**（形如「防御力降低20%」）`,
            '全队',
            'applyTarget=team',
            '对敌削弱，队友同样受益；原文没写明给谁时界面标淡色「默认」',
          ),
        ]),
        items('原文明确写「全队 / 我方全体 / 队伍中所有…」', '全队', 'applyTarget=team', '字面写明的全队（最先判）'),
        items('其他属性没写明给谁', NONE, 'applyTarget=self', ''),
      ],
    },
    {
      id: 'condition',
      title: '条件判定（只取本句 / 同义反复丢弃 / 落不到字段写「无法提取」）',
      items: [
        items('条件只允许来自**它自己那句**（抬头句已并入下一句）', '本句条件', '', '跨句汇聚 = bug'),
        ...INTRINSIC_PREMISE_RULES.map((rule) =>
          items(reText(rule.re), '条件=无（同义反复，丢弃）', '', `属性自带的定义性前提：${rule.stats.join(' / ')}`),
        ),
        items(
          '全队指定职业进入状态，紧接着描述状态下的增益',
          '目标=全队 / 仅指定职业代理人 / 状态需手动启用',
          'applyProfession / enabledDefault=false',
          '进入状态的招式属于触发方式。增益应用到状态受益者，时长留作备注。',
        ),
        ...MODELABLE_CONDITION_RES.map((re) =>
          items(reText(re), '保留条件文本', 'applySituation / 职业条件 / 默认启用', ''),
        ),
        items('其余条件（未建模的触发器、周期等）', UNABLE, '', '标记待补，按软槽位规则映射'),
      ],
    },
    {
      id: 'slot-whitelist',
      title: '槽位白名单硬校验（词表外的值一律改写成「无法提取」）',
      items: SLOT_IDS.map((id) =>
        items('（结构性校验）', id, '', SLOT_WHITELIST_DESCRIPTIONS[id] ?? '词表 / 无 / 无法提取'),
      ),
    },
    {
      id: 'waste',
      title: '废原文判定（整条丢弃 · 带原因 · 不入库）',
      items: HARD_SKIP_RULES.map((rule) => items(reText(rule.re), '废原文', '', rule.reason)),
    },
    {
      id: 'mappable',
      title: '可映射性预检（阶段1 末：进阶段2 还是废原文）',
      items: [
        items('动作 / 属性 = 无法提取（或空）', '留阶段2', 'blocked / 待补', '等人补，不丢'),
        items('动作认得，但属性在词表里查不到字段', '废原文', '', '整条在阶段1 结束'),
        items('命中机制 / 舍弃模式（我方减伤、生命回复、回能、无敌…）', '废原文', '', '在更早的步骤就丢弃'),
      ],
    },
  ]
  return { version: '2026-10-16', groups }
}

/**
 * **属性自带的定义性前提**（同义反复）表（用户 2026-10-16）：
 * 属性是**暴伤族**时，「暴击时 / 触发暴击时」这类前提是该属性**自带的生效前提**，
 * 属于同义反复 → 条件**丢弃**（`无`），既不标 `无法提取`、也不进 note。
 * 反例守则：属性 = 增伤 / 攻击力 / 减防 / 异常精通… 时，「暴击时」**不是**同义反复
 * （工具是期望值计算，没有这个条件）→ `无法提取`，**绝不能**丢掉条件当无条件生效。
 */
const INTRINSIC_PREMISE_RULES = [
  { stats: ['暴击伤害', '属性异常暴击伤害', '异放暴击伤害'], re: /暴击/ },
]

/**
 * **被专用字段吸收的条件**（用户 2026-10-16）：条件本身没有对应字段，但它的**信息已经落到别的槽位**了
 * —— 那就不该再标 `无法提取`（也不是同义反复，是「已吸收」）：
 *   - 转模的「初始值 > X」阈值 → `基础值(defaultBase)`（`每点超过155点…`）。
 */
const ABSORBED_CONDITION_RULES = [
  { absorbed: '基础值', re: /(?:超过|大于|高于|超出|多于)\s*\d+(?:\.\d+)?/ },
]

/**
 * **结构句**（刷新口径 / 每层单独结算…）：根本不是条件，也不该标 `无法提取`
 * ——它只描述刷新与结算方式，原文照旧整段入库 → 从条件槽里丢掉。
 */
const STRUCTURAL_CONDITION_RE = /刷新|单独结算|独立结算|重复触发|再次触发/

/**
 * 工具**能表达**的条件（其余一律 `无法提取`）：
 *   - 失衡 / 非失衡 → `applySituation`
 *   - 队伍 / 职业条件 → `applyProfession` / `teamProfession*`
 *   - 手动启用状态 → `enabledDefault=false`
 * （元素限定走 `元素` 槽位、招式限定走 `作用域` + 锚点、层数走 `层数` 槽位，都不算「条件」）
 *
 * 判据本体在文件上方（`CONDITION_OPTIONS` 反向过滤要用它，所以定义提前了）。
 */

/**
 * 条件分类（阶段1，**按句**）：
 *   1. **同义反复**（属性自带前提）→ 丢弃（`droppedTautology`，界面可标淡色提示）；
 *   2. **被专用字段吸收**（转模的「初始值 > X」→ `基础值`）→ 丢弃（`absorbed`）；
 *   3. 工具能表达的 → 保留文本（阶段2 落 `applySituation` / 职业队伍条件）；
 *   4. 其余（触发器、状态、周期…）→ 该槽位写 `无法提取`（阻断自动映射、阶段2 标红待补）。
 *
 * @returns {{ value:string[], droppedTautology:string[], absorbed:string[], unable:string[] }}
 */
export function classifyConditions({ conditions = [], statValue = '', isConvert = false } = {}) {
  const kept = []
  const droppedTautology = []
  const absorbed = []
  const unable = []
  for (const raw of Array.isArray(conditions) ? conditions : []) {
    const text = String(raw ?? '').trim()
    if (!text || text === NONE) continue
    const intrinsic = INTRINSIC_PREMISE_RULES.find(
      (rule) => rule.stats.includes(String(statValue)) && rule.re.test(text),
    )
    if (intrinsic) {
      droppedTautology.push(text)
      continue
    }
    if (isConvert && ABSORBED_CONDITION_RULES.some((rule) => rule.re.test(text))) {
      absorbed.push(text)
      continue
    }
    if (STRUCTURAL_CONDITION_RE.test(text)) {
      absorbed.push(text)
      continue
    }
    if (MODELABLE_CONDITION_RES.some((re) => re.test(text))) {
      if (!kept.includes(text)) kept.push(text)
      continue
    }
    if (!unable.includes(text)) unable.push(text)
  }
  return {
    // 能表达的保留；落不到字段的写「无法提取」（两者混在一起时该条照样被阻断，等人补）
    value:
      kept.length || unable.length ? [...kept, ...(unable.length ? [UNABLE] : [])] : noCondition(),
    droppedTautology,
    absorbed,
    unable,
  }
}

/** 根据相邻子句的结构继承受益职业。状态名称按原文展示。 */
function readTeamStateProfession(grantClause, stateClause) {
  if (!/^(?:\[[^\]]+\]|该)?状态下$/.test(stateClause ?? '')) return ''
  const profession = TEAM_STATE_GRANT_RE.exec(grantClause ?? '')?.groups.profession
  return PROFESSIONS.includes(profession) ? profession : ''
}

/**
 * 目标槽位判定 —— **以主语为准**（用户 2026-10-16 定稿，覆盖"按属性分"的写法）：
 *
 * 1. 句子里**点名了角色**（本角色名 / `自身` / `自己` / `装备者` / `该代理人` / `本角色`）→ `自身`；
 * 2. 句子里**没有主语（泛指）**且带**敌人状态限定**（「[X]状态下的敌人受到…」「对[X]状态下的敌人造成…」）
 *    → `全队`（note 写固定短语；**增伤与暴击族都适用**）；
 * 3. 无主语、也不带敌人状态（例：「造成的伤害提升 20%」）→ **沿用既有默认**（不动）；
 * 4. 减防 / 抗穿 / 易伤族先按**动作**分（用户 2026-10-17 修正，见下「敌人削弱族」）：
 *    「无视…抗性 / 防御」= 施放者自己的穿透 → `自身`；「降低 / 减少…」= 敌人侧削弱 → `全队`。
 * 5. 原文明确写「全队 / 我方…」→ 字面 `全队`（最先判）。
 *
 * `unitText` = 整句：**敌人状态句式常写在抬头**（被 `，` 切成子句后子句里没有它）→ 这条看整句；
 * 而「点名角色 / 自身」按**子句**认（避免同句后半句提到角色名就把前面的泛指句判成自身，
 * 例：1641 核心被动「…暴击伤害为25%，若菲欧妮的初始异常掌控大于155点…」后半句有角色名，
 * 但前面两条暴击句仍是泛指 → 全队）。
 *
 * 附：**指回前句回落**（用户 2026-10-16，放在规则②之前）——句子含「该增益效果 / 该效果 / 该增益 /
 * 上述效果」这类指回前文的词，且**同段前一条已有目标**（通常是自身增益）→ 沿用那条的目标，
 * 不因为句中出现「…状态下的敌人」就翻成 `全队`。例：「…火属性伤害提升10%，攻击处于失衡状态下的
 * 敌人时，该增益效果额外提升22.5%」→ 22.5% 那条仍是 `自身`（条件用 `applySituation=stagger` 表达）。
 */
function detectTarget(clauseText, selfNames, inherited, statValue = '', unitText = '', prevTarget = '') {
  const text = String(clauseText ?? '')
  const sentence = String(unitText ?? '') || text
  if (TEAM_RE.test(text)) return { value: '全队', source: 'literal' }
  // 敌人削弱族（减防 / 抗穿 / 易伤家族）：先分**动作**再定目标（用户 2026-10-17 修正）——
  //   ① 明确写「自身 / 自己 / 装备者」→ 自身；
  //   ② **「无视…抗性 / 无视…防御」= 施放者自己的穿透属性**（动作是无视，不是给敌人挂 debuff）
  //      → 自身。例：「菲欧妮无视目标15%全属性伤害抗性」主语是她自己，不能算全队；
  //   ③ 「降低 / 减少 / 下降 / 削减…」= 挂在敌人身上的削弱 → 默认全队（原文没写明给谁时标「默认」）。
  if (ENEMY_DEBUFF_STATS.has(String(statValue ?? ''))) {
    if (/自身|自己|装备者/.test(text)) return { value: '自身', source: 'literal' }
    if (PENETRATION_RE.test(text) && !DEBUFF_ACTION_RE.test(text)) {
      return { value: '自身', source: 'literal' }
    }
    return { value: '全队', source: /敌人|敌方|目标|对方/.test(text) ? 'literal' : 'default-team' }
  }
  // ① 点名角色 / 自身类主语 → 自身（最高优先，压过「敌人状态 → 全队」）
  for (const name of selfNames) {
    if (name && text.includes(name)) return { value: '自身', source: 'literal' }
  }
  if (SELF_MARKER_RE.test(text) || SELF_RE.test(text)) return { value: '自身', source: 'literal' }
  // ①.5 指回前句：句中有「该增益效果 / 该效果 / 该增益 / 上述效果」且前一条已有目标 → 沿用它的目标
  if (BACKREF_RE.test(text) && prevTarget && prevTarget !== NONE && prevTarget !== UNABLE) {
    return { value: prevTarget, source: 'refer-back' }
  }
  // ② 无主语（泛指）+ 敌人状态限定 → 全队（增伤 / 暴击族都适用）
  if (ENEMY_STATUS_RE.test(sentence)) return { value: '全队', source: 'default-team-enemy-status' }
  // ③ 其余：沿用既有默认（继承 / `无`）
  if (inherited) return { value: inherited, source: 'inherited' }
  return { value: NONE, source: 'default' }
}

/** 指回前文的词（用户 2026-10-16：这类句子沿用被指向那条的目标，不按敌人状态翻全队） */
const BACKREF_RE = /该增益效果|该效果|该增益|上述效果|此增益效果/

/**
 * **穿透类动作**（用户 2026-10-17）：「无视…抗性 / 无视…防御 / …穿透」是**施放者自己**的属性，
 * 写在谁的句子里就只作用在谁身上 → 目标 `自身`。
 * 与之相对的是 `DEBUFF_ACTION_RE`（降低 / 减少 / 下降 / 削减）—— 那是给敌人挂的削弱，默认全队。
 */
const PENETRATION_RE = /无视|穿透/

/** **对敌削弱动作**：降低 / 减少 / 下降 / 削减 → 敌人侧 debuff，默认全队 */
const DEBUFF_ACTION_RE = /降低|减少|下降|削减/

/**
 * **敌人状态（泛指）→ 目标默认全队**（用户 2026-10-16 定稿）：
 * 句子没有主语（泛指）、带敌人状态限定（形如「[X]状态下的敌人受到…」）→ `目标 = 全队`，
 * note 写固定短语（不是原文）：`目标默认：条件为敌人状态、未限定施放者`。
 * 实例：1641 核心被动第 3 句 → `attributeAnomalyCritRate=30 / attributeAnomalyCritDmg=25`，两者都 team；
 * 一旦句子里点名角色（「菲欧妮对[灼蚀]状态下的敌人造成的伤害提升30%」）→ 回落 `自身`。
 */
const ENEMY_STATUS_CRIT_STATS = new Set(['属性异常暴击率', '属性异常暴击伤害', '暴击率', '暴击伤害'])

/** 「[X]状态下的敌人…」这类**敌人状态**主语句式 */
const ENEMY_STATUS_RE =
  /\(?[「【[]?[^」】\]]{1,12}[」】\]]?\)?状态下?的?敌[人方]|状态下的敌[人方]|处于[^，。；]{0,12}状态的敌[人方]/

/**
 * 「点名角色 / 自身类主语」的写法（用户 2026-10-16 规则①）：
 * 本角色名（`selfNames`，如「菲欧妮」「11号」）+ `自身 / 自己 / 装备者 / 该代理人 / 本角色`。
 */
const SELF_MARKER_RE = /自身|自己|装备者|该代理人|本角色/

/** 目标默认全队时的固定短语（结构化短语白名单，不粘原文） */
const ENEMY_STATUS_TARGET_NOTE = '目标默认：条件为敌人状态、未限定施放者'

/**
 * **敌人削弱族**（用户 2026-10-16 定族、2026-10-17 修判定）：
 *
 * 这族属性的目标**按动作分**，不按「属性名」一刀切：
 *   - 动作 = **无视**（`PENETRATION_RE`，「无视目标15%抗性 / 无视敌人40%防御力」）→ **自身**。
 *     语义：穿透是**施放者自己**打出去的属性，判成 team 会让三个队友都吃这份穿透（数值高估）。
 *     用户 2026-10-17 判例：「菲欧妮无视目标15%全属性伤害抗性」主语是菲欧妮自己 → 自身。
 *   - 动作 = **降低 / 减少 / 下降 / 削减**（`DEBUFF_ACTION_RE`）→ 挂在敌人身上的削弱，
 *     队友同样受益 → **默认全队**（原文没写明给谁时 `source=default-team`，界面标「默认」）。
 *   - 易伤族（失衡易伤 / 易伤）不受影响：人工记录一致用全队。
 *
 * 依据（全库人工记录）：`staggerVulnerable` team=13/self=0、`globalStaggerVulnerable` team=2/self=0、
 * `reduceDefense` team=19/self=26、`resPen` team=23/self=51 —— 减防 / 抗穿本来就是**多数自身**，
 * 旧规则「一律全队」把这些拧成了全队。
 * 只有原文明确写「自身 / 自己 / 装备者」时才走 literal 自身（那时 `detectTarget` 已判成 literal）。
 */
const ENEMY_DEBUFF_STATS = new Set([
  '减防',
  '抗性穿透',
  '失衡易伤',
  '失衡易伤（全局）',
  '易伤',
  '直伤易伤',
  '异常易伤',
])

/** 同上（数组形态，给规则表导出用） */
const ENEMY_DEBUFF_STATS_LIST = [...ENEMY_DEBUFF_STATS]

/** 敌人状态 + 暴击族（数组形态，给规则表导出用；判定在 `detectTarget`） */
const ENEMY_STATUS_CRIT_STATS_LIST = [...ENEMY_STATUS_CRIT_STATS]

/** 槽位白名单的说明文字（规则表导出用；真正的判定在 `SLOT_VALUE_PREDICATES`） */
const SLOT_WHITELIST_DESCRIPTIONS = {
  stat: '属性词表 / `无` / `无法提取`',
  elements: '元素词表（可多选：物理 / 火 / 冰 / 电 / 以太 / 风）/ `无`',
  action: '动作词表（提升 / 降低 / 无视 / 转化）/ `无法提取`',
  value: '纯数字 / `无` / `无法提取`',
  unit: '单位词表（% / 点）/ `无`',
  target: '目标词表（自身 / 全队 / 指定职业 / 指定阵营）/ `无`',
  conditions: '失衡、非失衡、职业条件、状态手动启用，其余为 `无法提取`',
  scope: '作用域词表（招式 / 异常 / 紊乱 / 乱流 / 异放 / 耀变 / 异化系数）/ `无`',
  stacks: '`最多 N 层` / `N 层` / `无` / `无法提取`',
  duration: '`N 秒` / `无` / `无法提取`',
  object: '对象词表（当前招式 / 装备者 / 敌人 / 能量）/ `无`',
}

/** 敌人削弱族的目标兜底已并入 `detectTarget`（`default-team` = 原文没写明给谁） */

/** 对象槽位判定（增益作用在谁 / 什么上） */
function detectObject(clauseText, action, inherited) {
  const text = String(clauseText ?? '')
  if (/当前招式|该招式|本招式|招式发动期间/.test(text)) {
    return { value: '当前招式', source: 'literal' }
  }
  if (/能量/.test(text) && /回复|恢复|回能/.test(text)) return { value: '能量', source: 'literal' }
  if (/敌人|目标/.test(text) && (action === '无视' || action === '降低')) {
    return { value: '敌人', source: 'literal' }
  }
  if (inherited) return { value: inherited, source: 'inherited' }
  return { value: NONE, source: 'default' }
}

/** 一条关键字的槽位（**不许缺格**） */
function createSlots({ stat, elements, action, value, unit, target, conditions, scope, stacks, duration, object }) {
  return {
    stat: stat?.value ?? NONE,
    elements: Array.isArray(elements) && elements.length ? [...elements] : [NONE],
    action: action?.value ?? UNABLE,
    value: value?.value ?? UNABLE,
    unit: unit?.value ?? NONE,
    target: target?.value ?? NONE,
    conditions: conditions?.value ?? noCondition(),
    scope: scope?.value ?? NONE,
    stacks: stacks ?? NONE,
    duration: duration ?? NONE,
    object: object?.value ?? NONE,
  }
}

/** 槽位取值的来源（界面用来区分「原文写的」/「继承来的」/「默认」/「读不出」） */
function createSources({ stat, elements, action, value, unit, target, conditions, scope, stacks, duration, object }) {
  return {
    stat: stat?.source ?? 'default',
    elements: Array.isArray(elements) && elements.length ? 'literal' : 'default',
    action: action?.source ?? 'unable',
    value: value?.source ?? 'unable',
    unit: unit?.source ?? 'default',
    target: target?.source ?? 'default',
    conditions: conditions?.source ?? 'default',
    scope: scope?.source ?? 'default',
    stacks: stacks?.source ?? 'default',
    duration: duration?.source ?? 'default',
    object: object?.source ?? 'default',
  }
}

/**
 * 把一条子句按「数值」切成若干段，凡是不带属性/动作词的尾段并回前一段
 * （避免把「[普通攻击]、[冲刺攻击]造成的伤害提升3%」这类定语拆错）。
 */
function splitClauseIntoGroups(clause) {
  const numbers = gainNumbers(clause)
  if (numbers.length <= 1) return [clause]
  const segments = []
  let start = 0
  for (const token of numbers) {
    const end = token.index + String(token.value).length + (token.percent ? 1 : 0)
    segments.push(clause.slice(start, end))
    start = end
  }
  if (start < clause.length) segments.push(clause.slice(start))
  const merged = []
  for (const segment of segments) {
    const hasStat = Boolean(detectStatKeyword(segment))
    const hasAction = detectAction(segment).value !== UNABLE
    if (merged.length && !hasStat && !hasAction) merged[merged.length - 1] += segment
    else merged.push(segment)
  }
  return merged.map((text) => text.trim()).filter(Boolean)
}

/** 机制句（**没有数值**时 → 废原文）：无敌 / 抗打断 / 段数衔接 / 状态与次数… */
const MECHANISM_PATTERNS = [
  /无敌/,
  /抗打断|霸体|韧性/,
  /不会战败|免于退场|致命伤害时不会/,
  /后撤动作|衔接|跳过|换入|换出|勘域模式/,
  /格挡|闪避反击|免疫该次伤害/,
  /视为\[?[^\]]*\]?伤害/,
]

/** 命中「机制句」？（无敌 / 抗打断 / 段数衔接…） */
export function isMechanismText(text) {
  return MECHANISM_PATTERNS.some((re) => re.test(String(text ?? '')))
}

/**
 * 阶段1：一段原文 → N 条「关键字效果」（N≥1；条件不是独立效果，只进槽位）。
 *
 * v3：不再有「不解析（仅存原文）」开关；判为无意义的句子进 `waste`（**废原文**）：
 * 带丢弃原因、不入库、阶段二确认写入后丢弃。
 *
 * @param {object} options
 * @param {string} options.text 原文（nanoka 原文或界面里编辑过的文字）
 * @param {string} [options.origin] 来源标记（写进关键字 `origin`）
 * @param {string[]} [options.selfNames] 自身名（判「自身」指代 / 剔名字里的数字）
 * @param {Array<object>|null} [options.anchors] 技能库小类（锚点）；`null` = 没加载 → 招式限定条不录
 * @param {string} [options.agentId] 角色 id（锚点按角色过滤）
 * @returns {{ effects:Array, waste:Array<{sentenceIndex:number, text:string, reason:string}>, sentences:Array }}
 *   `sentences` 是**按句配对**用的视图（用户 2026-10-16）：一句 → 该句抽出的关键字 + 该句的废原文，
 *   界面左侧只显示「产出过关键字」的句子（其余只在底部废原文区出现）；**入库口径不变**（见 `buildItem`）。
 */
export function extractKeywordEffects({
  text,
  origin = '',
  selfNames = [],
  anchors = null,
  agentId = '',
  emberMarkContext = {},
} = {}) {
  const units = splitUnits(text)
  const effects = []
  const waste = []
  let prefix = '' // 段落级前缀条件（`…：` 抬头，作用于整段）
  let pending = [] // 子句级条件（作用于紧随其后的那一条，用掉即清）
  let lastEffect = null // 指代继承的来源
  let currentSentence = 0 // 当前句下标（废原文按句归档）
  let anomalyContext = false // 本句是不是「异常语境」（见 ANOMALY_MARK_RE）

  const pushWaste = (clause, reason) => {
    const key = `${currentSentence}|${clause}|${reason}`
    if (!waste.some((item) => `${item.sentenceIndex}|${item.text}|${item.reason}` === key)) {
      waste.push({ sentenceIndex: currentSentence, text: clause, reason })
    }
  }

  units.forEach((unit, unitIndex) => {
    currentSentence = unitIndex
    anomalyContext = false // 异常语境**按句重置**
    // **条件只取本句**（用户 2026-10-16 修 1）：抬头条件（`…：`）只作用于它自己那句
    // （抬头句已与下一句合并，见 `splitUnits`），**不跨句泄漏**。
    prefix = ''
    pending = []
    const emberMark = extractEmberMarkKeyword({
      text: unit.text, unitIndex, index: effects.length, origin, selfNames, anchors, agentId, emberMarkContext,
    })
    if (emberMark) {
      effects.push(emberMark)
      lastEffect = null
      return
    }
    const unitText = unit.clauses.join('，')
    const stack = readStackInfo(unitText)
    const duration = readDurationInfo(unitText)
    const unitEffects = []

    for (const [clauseIndex, rawClause] of unit.clauses.entries()) {
      const clause = rawClause.trim()
      if (!clause) continue

      // 异常语境：**先**在本句任何 continue 之前打开（后面的「该效果」指代要继承它）
      if (ANOMALY_MARK_RE.test(clause)) anomalyContext = true

      // 0) 触发上限 / 冷却尾巴：补进上一条的「条件」（条件槽位是唯一允许复数的）
      //    只补**同一句**里的上一条（跨句汇聚是 bug），且最终由末尾的分类兜底再过滤一遍。
      if (TRAILING_LIMIT_RE.test(clause) && !gainNumbers(clause).length) {
        if (lastEffect && unitEffects.includes(lastEffect) && lastEffect.unitIndex === unitIndex) {
          lastEffect.slots.conditions = conditionList([...lastEffect.slots.conditions, clause])
          continue
        }
      }

      // 1) 抬头条件（`…：`）：作用于整段
      if (/[：:]$/.test(clause) && !gainNumbers(numberSafeText(clause, selfNames)).length) {
        prefix = clause.replace(/[：:]$/, '')
        continue
      }

      // 2) 结构句（层数 / 时长 / 刷新）：不产效果
      if (STRUCTURAL_RE.test(clause)) continue

      // 3) 条件句（阈值 / `…时` / `若…`）：**不是独立效果**，进「条件」槽位
      if (isConditionOnly(clause, selfNames)) {
        pending.push(clause)
        continue
      }

      // 4) 我方减伤 → 废原文（用户 2026-10-16：「减伤不存在」）。
      //    主语是**敌人**时不算：那是「敌方受到的伤害降低」= 易伤（取负号），归阶段2。
      if (
        SELF_DAMAGE_REDUCTION_RE.test(clause) &&
        !/(?:敌人|敌方|目标|对方)/.test(clause)
      ) {
        pushWaste(clause, '我方减伤不存在（dmgReduction 是目标减伤语义）')
        continue
      }

      // 5) 强负信号（资源 / 倍率 / 回血 / 周期伤害…）→ 废原文
      const hardSkip = HARD_SKIP_RULES.find((rule) => rule.re.test(clause))
      if (hardSkip) {
        pushWaste(clause, hardSkip.reason)
        continue
      }

      // 6) 机制句（无敌 / 抗打断 / 段数衔接…）：没有数值时 → 废原文
      const clauseNumbers = gainNumbers(clause)
      if (!clauseNumbers.length && isMechanismText(clause)) {
        pushWaste(clause, '机制句（无敌 / 抗打断 / 段数衔接…）')
        continue
      }

      const clauseAction = detectAction(clause)
      const isConvert = isConvertClause(clause)

      // 7) 与增益无关的描述句（没命中属性词典，也没转模，且没有数值 / 没有动作）
      if (
        !detectStatKeyword(clause) &&
        !isConvert &&
        (!clauseNumbers.length || clauseAction.value === UNABLE)
      ) {
        pushWaste(clause, '没命中属性词典（描述句 / 无可量数值）')
        continue
      }

      // 7.5) 不进动作表的动词（获得 / 视为 / 替代 / 进入…状态）：当条件用，或进废原文
      if (NON_ACTION_VERB_RE.test(clause) && clauseAction.value === UNABLE && !isConvert) {
        pushWaste(clause, '动词不在动作表（获得 / 视为 / 替代 / 进入状态）')
        continue
      }

      // 7.6) 动作不存在（没有动作动词，也没有数值）→ 废原文；
      //      有数值但没动作 → **保留**，动作槽位标 `无法提取`，进阶段二等用户补
      if (clauseAction.value === UNABLE && !clauseNumbers.length && !isConvert) {
        pushWaste(clause, '动作不存在（没有动作动词，也没有数值）')
        continue
      }

      // 7.7) 纯伤害描述（`造成火属性伤害` 这类没有增益动词的句子）
      if (DAMAGE_STATEMENT_RE.test(clause) && !BUFF_VERB_RE.test(clause) && !isConvert) {
        pushWaste(clause, '伤害描述（不是增益）')
        continue
      }

      // 8) 拆条：一条子句里出现多个「属性 + 数值」→ N 条效果（规格 §二硬规则 3）。
      //    转模句（动作=转化）**不拆**：`每1点攻击力转化为1.5点暴击率` 是一个效果。
      const groups = isConvert ? [clause] : splitClauseIntoGroups(clause)
      const thresholds = extractThresholds(clause)
      const stateProfession = readTeamStateProfession(
        unit.clauses[clauseIndex - 2],
        unit.clauses[clauseIndex - 1],
      )
      // 进入状态所需的招式属于触发方式。已授予的增益只读取效果子句里的招式限定。
      const effectPremises = stateProfession ? [] : pending
      const skillLimits = detectSkillLimits([...effectPremises, clause].join('，'))
      const anchorInfo = skillLimits.length
        ? resolveSkillAnchors({ limits: skillLimits, anchors, agentId })
        : resolveSkillAnchors({ limits: [], anchors, agentId })
      // **条件只取本句**（用户 2026-10-16 修 1）：抬头条件（`…：`）已被合并进本句，
      // 招式限定并进「作用域」槽位，不再塞进条件。
      const clauseConditions = stateProfession
        ? conditionList([beneficiaryProfessionCondition(stateProfession), MANUAL_STATE_CONDITION, ...thresholds])
        : conditionList([prefix, ...pending, ...thresholds])
      let emittedInClause = false

      for (const group of groups) {
        const contextText = stateProfession ? group : [prefix, ...pending, group].join('，')
        const groupIsConvert = isConvertClause(group) || isConvert
        const convertParts = groupIsConvert ? readConvertParts(contextText) : null
        const rawStatKeyword = groupIsConvert
          ? detectStatKeyword(convertParts?.targetText ?? group) || detectStatKeyword(group)
          : detectStatKeyword(group)
        // 「（失衡状态下）受到的伤害提升」：属失衡易伤家族 → 只有在**失衡**在作用域里时才这么判；
        // 否则按「游戏描述坑」当**增伤**（`增伤`）处理（用户 2026-10-16 纠正）。
        const damageTakenPhrase = /(?:受到的伤害|受到伤害)(?:提升|增加|提高|降低|减少|下降)/.test(group)
        const scopeText = stateProfession ? group : `${prefix}，${pending.join('，')}，${unitText}`
        const imbalanceInScope = /失衡/.test(scopeText)
        const globalImbalance = /(?:均|全局|常驻|非失衡期)[^，。；]{0,10}(?:生效|存在|计入)|均受到|都受到/.test(
          scopeText,
        )
        const statKeyword =
          damageTakenPhrase &&
          imbalanceInScope &&
          rawStatKeyword !== '直伤易伤' &&
          rawStatKeyword !== '异常易伤'
            ? globalImbalance
              ? '失衡易伤（全局）'
              : '失衡易伤'
            : rawStatKeyword
        const action = groupIsConvert
          ? { value: '转化', source: 'implicit' }
          : detectAction(group)
        const isReference = REFERENCE_RE.test(group)
        const inherited = lastEffect ?? null
        const inheritedSlots = inherited?.slots ?? null

        // 属性：本句认不出时按「指代 / 省略」继承（继承值写成具体词）
        let stat = { value: statKeyword || '', source: statKeyword ? 'literal' : 'default' }
        if (!statKeyword) {
          if (isReference && inheritedSlots) stat = { value: inheritedSlots.stat, source: 'inherited' }
          else {
            const fromContext = detectStatKeyword(contextText)
            if (fromContext) stat = { value: fromContext, source: 'inherited' }
          }
        }
        if (stat.value === NONE || !stat.value) stat = { value: UNABLE, source: 'unable' }

        // 异常语境（用户 2026-10-16）：**本句**出现过「（属性）异常伤害 / 异常暴击」（含同句前面的子句，
        // 以及后面用「该效果」指代的情况）→ 暴击率 / 暴击伤害 / 增伤落**异常区**
        // （attributeAnomalyCritRate / attributeAnomalyCritDmg / attributeAnomalyDmgBonus）。
        const anomalyInScope = anomalyContext || ANOMALY_MARK_RE.test(group)
        if (anomalyInScope && ANOMALY_STAT_MAP[stat.value]) {
          stat = { value: ANOMALY_STAT_MAP[stat.value], source: stat.source }
        }

        // 指代来源提示（用户 2026-10-16）：这条关键字靠**前文语义**（「该效果」指代 / 主语省略）
        // 才成立时标出来，免得它看起来像凭空冒出来的。例：`依赖上一句 · 增伤`。
        const inheritedInfo =
          stat.source === 'inherited' && inherited
            ? {
                from:
                  Number(inherited.unitIndex ?? -1) === Number(unitIndex) ? '前文' : '上一句',
                fields: ['属性'],
                label: `依赖${
                  Number(inherited.unitIndex ?? -1) === Number(unitIndex) ? '前文' : '上一句'
                } · ${stat.value}`,
              }
            : null
        // 作用域（编辑器 `scope`）：句中点名子类（异放 / 耀变 / 乱流 / 紊乱 / 异化系数）或
        // 显式限定异常（`仅对属性异常生效`）→ 填这一格；有招式限定 → `招式`（「限定招式」并进这一格）。
        // 判定范围含**本句的前置子句**（`[异放]效果触发暴击时，其暴击伤害额外提升40%` 这类）。
        let scopeValue = detectScope(contextText)
        if (stat.value === SHARPEN_CRIT_DMG_LABEL) scopeValue = '锐化'
        else if (skillLimits.length) scopeValue = '招式'
        let scope = {
          value: scopeValue,
          source: scopeValue === NONE ? 'default' : 'literal',
        }

        // 数值 / 单位（**层数、时长不进数值**；阈值不进数值；`技能等级+2` 这类纯数写 `无`）
        // 转模条：数值 / 单位**不适用**（比例% 走专用槽位），显式写 `无`（不是「无法提取」）。
        const valueTokens = gainNumbers(group)
        const plusOnly = /[+＋]\s*\d/.test(group) && !/%/.test(group)
        const unit = groupIsConvert
          ? { value: NONE, source: 'default' }
          : valueTokens.length
            ? {
                value: plusOnly ? NONE : valueTokens[valueTokens.length - 1].unit,
                source: plusOnly ? 'default' : 'literal',
              }
            : { value: NONE, source: 'default' }
        const value = groupIsConvert
          ? { value: NONE, source: 'default' }
          : valueTokens.length
            ? { value: valueTokens[valueTokens.length - 1].value, source: 'literal' }
            : { value: UNABLE, source: 'unable' }

        // 工具语义细化：攻击力按局内 / 局外 / 固定拆开（用户点名的语义名）
        const refinedStat = refineStatKeyword(stat.value, { text: group, unit: unit.value })
        if (refinedStat && refinedStat !== stat.value && stat.source !== 'unable') {
          stat = { value: refinedStat, source: stat.source }
        }

        // 元素**统一走元素槽**（用户 2026-10-16 二次确认）：单元素也写 `属性=增伤 / 元素=火`
        // → `elementFilter=['火']`；不再有「属性=火属性伤害」这第二种写法（旧字样仍能被识别，
        // 见 `STAT_TABLE` 里的别名与下面的 `ELEMENT_STAT_RE` 兜底）。多元素同样只出一条。
        const elementHits = ELEMENTS.filter((element) => group.includes(`${element}属性伤害`))
        let elements = elementHits
        const elementStatMatch = ELEMENT_STAT_RE.exec(String(stat.value))
        if (elementStatMatch) {
          stat = { value: '增伤', source: stat.source }
          if (!elements.length) elements = [elementStatMatch[1]]
        } else if (String(stat.value) === '全属性伤害') {
          // 「全属性伤害」= 不限元素 → 元素槽留空，阶段2 elementFilter 保持 all
          stat = { value: '增伤', source: stat.source }
          elements = []
        }

        // 目标：按原文认（敌人削弱族没写明给谁 → 默认 `全队`，source=`default-team`，界面标「默认」）
        // **敌人状态条件**（「[X]状态下的敌人受到…」）常写在**整句抬头**（被 `，` 切成子句后丢了）
        // → 目标判定要看「本句全文」（抬头 + 已并入的句子），用户 2026-10-16。
        // `prevTarget`：同段**前一条**的目标（给「该增益效果…」这类指回前句的句子回落用）。
        const prevTarget = unitEffects.length ? String(unitEffects[unitEffects.length - 1].slots.target ?? '') : ''
        const target = stateProfession
          ? { value: '全队', source: 'inherited' }
          : detectTarget(group, selfNames, inheritedSlots?.target, stat.value, unitText, prevTarget)
        const object = detectObject(group, action.value, inheritedSlots?.object)

        // 条件分类（按句 + 按属性）：同义反复丢弃 / 能表达的保留 / 落不到字段写「无法提取」
        const conditionInfo = classifyConditions({
          conditions: clauseConditions,
          statValue: stat.value,
          isConvert: groupIsConvert,
        })
        // **子类专用字段**（用户 2026-10-16）：阶段一就显示**最终落库**的词。
        // 例：`增伤 + 作用域=异放` → `属性=异放增伤` + `作用域=无`（有专用字段就不再用 scope 兜），
        // 避免"审阅面显示的和库里写的不一致"。
        const subkindSlotUpgrade = detectSubkindDedicatedField({
          statKeyword: stat.value,
          scopeText: String(scope.value ?? '').trim(),
        })
        if (subkindSlotUpgrade) {
          stat = { value: subkindSlotUpgrade.stat, source: stat.source === 'unable' ? 'literal' : stat.source }
          scope = { value: NONE, source: 'default' }
        }

        // **结构性硬校验**：任何槽位出现词表外的值（原文片段 / 长文本）→ 一律 `无法提取`
        const { slots: checkedSlots, violations: slotViolations } = enforceSlotWhitelist(
          createSlots({
            stat,
            elements,
            action,
            value,
            unit,
            target,
            conditions: { value: conditionInfo.value, source: 'literal' },
            scope,
            stacks: NONE,
            duration: NONE,
            object,
          }),
        )

        const recorded = !(skillLimits.length && anchorInfo.ok !== true)
        const effect = {
          id: `${origin}#${effects.length}`,
          origin,
          index: effects.length,
          unitIndex,
          unitText,
          sentence: group,
          slots: checkedSlots,
          sources: createSources({
            stat,
            elements,
            action,
            value,
            unit,
            target,
            conditions: { source: 'literal' },
            scope,
            stacks: { source: 'default' },
            duration: { source: 'default' },
            object,
          }),
          convert: convertParts,
          stackMax: null,
          durationSeconds: null,
          perStack: false,
          // —— v3 招式限定（并进「生效范围」这一格；具体招式仍走锚点 `skillTargets`）
          skillLimits,
          /** 指代来源提示（界面用，不入库）：`{ from, fields, label }`，如「依赖上一句 · 增伤」 */
          inherited: inheritedInfo,
          /** 同义反复被忽略的条件（界面用，不入库）：如暴伤族的「触发暴击时」 */
          tautologyDropped: conditionInfo.droppedTautology,
          /** 被硬校验改写成「无法提取」的槽位（界面用，不入库） */
          unmappableSlots: slotViolations,
          anchors: {
            ok: anchorInfo.ok,
            labels: anchorInfo.labels,
            resolved: anchorInfo.resolved,
            skillTargets: anchorInfo.skillTargets,
            skillCategory: anchorInfo.skillCategory,
            skillSubcategoryId: anchorInfo.skillSubcategoryId,
            /** 需要在技能库里**建立**的小类锚点（`{ name, categoryId, agentId }`） */
            pendingCreates: anchorInfo.pendingCreates ?? [],
            reason: anchorInfo.reason,
          },
          recorded,
          dropReason: recorded ? '' : anchorInfo.reason || '招式锚点关联不上 → 按 v3 规则这条不录',
        }
        // —— v3：可映射性预检（动作 + 属性 → 阶段2 词表反查）。查不到字段的**整条**进废原文，
        //    阶段1 就结束（不进阶段2）：「生命回复」「立即回复 N 点能量」都走这条。
        const mappable = checkKeywordMappable({
          slots: effect.slots,
          text: `${unitText}，${group}`,
        })
        if (!mappable.ok) {
          pushWaste(group, mappable.reason)
          continue
        }

        // —— **合集扇出**（抽取层；用户 2026-10-16）：「属性伤害 / 属性暴击 / 属性暴击伤害」
        //    这类合集词 → 扇出成多条**独立**效果（每条可单独勾选/删除；徽章标来源）。
        //    合集信息只进抽取结果与界面，**写入库前剔除、不进结算**。
        const fanOut = planCollectionFanOut({
          effect,
          clauseText: group,
          statKeyword: stat.value,
          effectsLength: effects.length,
        })
        if (fanOut.length > 1) {
          let pushedInClause = false
          for (const item of fanOut) {
            const itemMappable = checkKeywordMappable({
              slots: item.slots,
              text: `${unitText}，${group}`,
            })
            if (!itemMappable.ok) {
              pushWaste(group, itemMappable.reason)
              continue
            }
            effects.push(item)
            unitEffects.push(item)
            pushedInClause = true
          }
          if (pushedInClause) {
            lastEffect = unitEffects[unitEffects.length - 1] ?? lastEffect
            emittedInClause = true
          }
          continue
        }

        effects.push(effect)
        unitEffects.push(effect)
        lastEffect = effect
        emittedInClause = true
      }

      if (emittedInClause) pending = []
    }

    // unit 级后处理：层数 / 时长挂到本 unit 最后一条效果（**层、秒都不是单位**）
    const targetEffect = unitEffects[unitEffects.length - 1]
    if (targetEffect) {
      if (stack.mentioned) {
        targetEffect.stackMax = stack.maxStacks
        targetEffect.perStack = stack.perStack
        targetEffect.slots.stacks = stack.maxStacks ? formatStacks(stack.maxStacks, 'literal') : UNABLE
        targetEffect.sources.stacks = stack.maxStacks ? 'literal' : 'unable'
      }
      if (duration.mentioned) {
        targetEffect.durationSeconds = duration.seconds
        targetEffect.slots.duration = duration.seconds
          ? formatDuration(duration.seconds, 'literal')
          : UNABLE
        targetEffect.sources.duration = duration.seconds ? 'literal' : 'unable'
      }
    }
  })

  // —— 末尾兜底：所有条目的槽位再过一次「条件分类 + 白名单硬校验」
  //    （后置追加条件、以及任何漏网的原句片段都在这里被规范成 `无` / `无法提取`）
  for (const effect of effects) {
    const info = classifyConditions({
      conditions: effect.slots.conditions,
      statValue: effect.slots.stat,
      isConvert: effect.slots.action === '转化',
    })
    effect.slots.conditions = info.value
    effect.tautologyDropped = [
      ...new Set([...(effect.tautologyDropped ?? []), ...info.droppedTautology]),
    ]
    const checked = enforceSlotWhitelist(effect.slots)
    effect.slots = checked.slots
    effect.unmappableSlots = [...(effect.unmappableSlots ?? []), ...checked.violations]
  }

  // —— 按句配对视图（界面用；入库口径不变）
  const sentences = units.map((unit, index) => {
    const keywords = effects.filter((effect) => effect.unitIndex === index)
    return {
      sentenceIndex: index,
      rawSentence: unit.text,
      keywords,
      waste: waste.filter((item) => item.sentenceIndex === index),
      hasKeywords: keywords.length > 0,
    }
  })

  return { effects, waste, sentences }
}

// ================================================================== 阶段2：纯查表映射

/**
 * 属性词表（**阶段2 唯一入口**；`单位 → stat`）。
 * 键 = 阶段1 的属性槽位取值；值 = `{ '%': stat, '点': stat }`。
 *
 * ⚠ **游戏描述坑（用户 2026-10-16 纠正，别按字面翻译）**：
 * 「目标 / 敌人**受到的伤害提升** X%」在游戏文案里读起来像易伤，**实际是【增伤】** →
 * 阶段1 故意**不**产出 `易伤`，这句话被「伤害加成」接住 → `dmgBonus`。
 * 证据：全库 `vulnerable` 只有 1 条（莱卡恩影画 6）且值为 0，槽位备注写着「不知道是不是易伤区，
 * 目前按易伤区算」——是**存疑占位**，不是有效用法；家族实际用量是
 * `staggerVulnerable` 13 / `staggerVulnerableOnly` 2 / `globalStaggerVulnerable` 2 / `vulnerable` 1。
 * 所以：**抽取器不主动产出 `vulnerable`**（下拉里保留该取值，只有用户手动改才用）。
 * 保留的易伤类落法：失衡态 → `staggerVulnerable`；失衡期与非失衡期**均**生效 / 常驻失衡易伤 →
 * `globalStaggerVulnerable`（扳机核心被动 35、影画 1 20 就是实例，目标=全队）。
 */
const STAT_TABLE = {
  // —— 工具语义（阶段1 写进 `属性` 的值）
  ...Object.fromEntries(
    Object.entries(INDEPENDENT_ZONE_PERCENT_STATS).map(([label, stat]) => [label, { '%': stat }]),
  ),
  增伤: { '%': 'dmgBonus', 点: 'dmgBonus' },
  全属性伤害: { '%': 'dmgBonus', 点: 'dmgBonus' },
  招式增伤: { '%': 'skillDmgBonus', 点: 'skillDmgBonus' },
  属性异常增伤: { '%': 'attributeAnomalyDmgBonus', 点: 'attributeAnomalyDmgBonus' },
  异放增伤: { '%': 'anomalyReleaseDmgBonus', 点: 'anomalyReleaseDmgBonus' },
  乱流增伤: { '%': 'turbulenceDmgBonus', 点: 'turbulenceDmgBonus' },
  耀变增伤: { '%': 'radianceDmgBonus', 点: 'radianceDmgBonus' },
  紊乱增伤: { '%': 'disorderDmgBonus', 点: 'disorderDmgBonus' },
  异放暴击率: { '%': 'anomalyReleaseCritRate', 点: 'anomalyReleaseCritRate' },
  异放暴击伤害: { '%': 'anomalyReleaseCritDmg', 点: 'anomalyReleaseCritDmg' },
  乱流暴击率: { '%': 'turbulenceCritRate', 点: 'turbulenceCritRate' },
  乱流暴击伤害: { '%': 'turbulenceCritDmg', 点: 'turbulenceCritDmg' },
  耀变暴击率: { '%': 'radianceCritRate', 点: 'radianceCritRate' },
  耀变暴击伤害: { '%': 'radianceCritDmg', 点: 'radianceCritDmg' },
  紊乱暴击率: { '%': 'disorderCritRate', 点: 'disorderCritRate' },
  紊乱暴击伤害: { '%': 'disorderCritDmg', 点: 'disorderCritDmg' },
  属性异常暴击率: { '%': 'attributeAnomalyCritRate', 点: 'attributeAnomalyCritRate' },
  属性异常暴击伤害: { '%': 'attributeAnomalyCritDmg', 点: 'attributeAnomalyCritDmg' },
  异常精通: { 点: 'mastery', '%': 'mastery' },
  异常掌控: { '%': 'anomalyControlPercent', 点: 'anomalyControl' },
  暴击率: { '%': 'critRate', 点: 'critRate' },
  暴击伤害: { '%': 'critDmg', 点: 'critDmg' },
  [SHARPEN_CRIT_DMG_LABEL]: { '%': 'sharpenCritDmgBonus' },
  '攻击力（局外）': { '%': 'externalAtkPercent', 点: 'atk' },
  '攻击力（局内）': { '%': 'inCombatAtkPercent', 点: 'atk' },
  '攻击力（固定）': { '%': 'externalAtkPercent', 点: 'atk' },
  生命值: { '%': 'externalHpPercent', 点: 'hp' },
  防御力: { '%': 'externalDefPercent', 点: 'def' },
  减防: { '%': 'reduceDefense', 点: 'reduceDefense' },
  抗性穿透: { '%': 'resPen', 点: 'resPen' },
  穿透率: { '%': 'penRate', 点: 'penRate' },
  穿透: { 点: 'pierce', '%': 'pierce' },
  易伤: { '%': 'vulnerable', 点: 'vulnerable' }, // **只供手动**（抽取器不主动产出，见上面的「游戏描述坑」）
  失衡易伤: { '%': 'staggerVulnerable', 点: 'staggerVulnerable' },
  '失衡易伤（全局）': { '%': 'globalStaggerVulnerable', 点: 'globalStaggerVulnerable' },
  直伤易伤: { '%': 'directVulnerable', 点: 'directVulnerable' },
  异常易伤: { '%': 'anomalyVulnerable', 点: 'anomalyVulnerable' },
  // 我方减伤在阶段1 已进废原文；这里保留取值只为**手动补词**（界面下拉里还在）
  受到伤害降低: { '%': 'dmgReduction', 点: 'dmgReduction' },
  能量自动回复: { '%': 'energyRegen', 点: 'energyRegen' },
  // —— 旧取值别名（老关键字 / 手填内容仍能映射）
  伤害加成: { '%': 'dmgBonus', 点: 'dmgBonus' },
  招式伤害: { '%': 'skillDmgBonus', 点: 'skillDmgBonus' },
  异常伤害: { '%': 'attributeAnomalyDmgBonus', 点: 'attributeAnomalyDmgBonus' },
  攻击力: { '%': 'externalAtkPercent', 点: 'atk' },
  抗性: { '%': 'resPen', 点: 'resPen' },
  穿透值: { 点: 'pierce', '%': 'pierce' },
}

/** 易伤家族的字段（动作=`降低` 时取负号；失衡条件时优先走 `staggerVulnerable`） */
const VULNERABLE_STATS = new Set([
  'vulnerable',
  'directVulnerable',
  'anomalyVulnerable',
  'globalStaggerVulnerable',
  'staggerVulnerable',
  'staggerVulnerableOnly',
])

// `<元素>属性伤害` → 通用增伤 + elementFilter（阶段2 由 `mapKeywordsToEffect` 拆元素）
for (const element of ELEMENTS) {
  STAT_TABLE[`${element}属性伤害`] = { '%': 'dmgBonus', 点: 'dmgBonus' }
}

/**
 * 阶段2 的额外规则（**动作把属性改写**，用户 2026-10-16 最终口径「降低 / 无视 的落法」）：
 *   无视 + 抗性穿透 → `resPen`；无视 / 降低 + 减防 → `reduceDefense`；
 *   降低 + 易伤家族 → 取负号；失衡态 → `staggerVulnerable` 系列。
 * 注：`ignoreDefense` **不在 `BUFF_STAT_KEYS` 里**，这里绝不使用；`dmgReduction` 的语义是
 * 「**目标**减伤」（易伤区里的减项），我方「受到的伤害降低」在阶段1 已进废原文。
 */
const ACTION_STAT_OVERRIDES = {
  减防: { 无视: 'reduceDefense', 降低: 'reduceDefense' },
  抗性穿透: { 无视: 'resPen', 降低: 'resPen', 提升: 'resPen' },
  易伤: { 提升: 'vulnerable', 降低: 'vulnerable' },
  失衡易伤: { 提升: 'staggerVulnerable', 降低: 'staggerVulnerable' },
  '失衡易伤（全局）': {
    提升: 'globalStaggerVulnerable',
    降低: 'globalStaggerVulnerable',
  },
  直伤易伤: { 提升: 'directVulnerable', 降低: 'directVulnerable' },
  异常易伤: { 提升: 'anomalyVulnerable', 降低: 'anomalyVulnerable' },
  // 旧取值别名
  抗性: { 无视: 'resPen', 降低: 'resPen', 提升: 'resPen' },
}

/**
 * 动作 + 属性（+ 单位 / 条件 / 原文）→ 阶段2 的增益字段；查不到返回 `''`（**阶段1 预检与阶段2 同源**）。
 */
export function resolveStatField({ stat, action, unit = '%', conditions = [], text = '' } = {}) {
  const keyword = String(stat ?? '').trim()
  const act = String(action ?? '').trim()
  if (!keyword || !ACTION_OPTIONS.includes(act)) return ''
  let field = ACTION_STAT_OVERRIDES[keyword]?.[act] ?? ''
  if (!field) {
    const table = STAT_TABLE[keyword]
    const key = String(unit ?? '').trim()
    if (table) {
      const percentStat = table['%']
      if (isCustomBuffStatKey(percentStat)) {
        return key === '%' && (act === '提升' || act === '降低') ? percentStat : ''
      }
      field =
        act === '转化'
          ? (table['%'] ?? Object.values(table)[0] ?? '')
          : (table[key] ?? table['%'] ?? Object.values(table)[0] ?? '')
    }
  }
  if (!field) return ''
  const joined = `${(Array.isArray(conditions) ? conditions : []).join('，')}，${String(text ?? '')}`
  // 失衡易伤家族：显式「失衡易伤」或条件里带失衡 → staggerVulnerable；
  // 「失衡期与非失衡期**均**生效 / 常驻」→ globalStaggerVulnerable（扳机式）
  if (field === 'staggerVulnerable' || (field === 'vulnerable' && keyword === '易伤')) {
    if (/失衡/.test(joined)) {
      if (/(?:均|全局|常驻|非失衡期)[^，。；]{0,10}(?:生效|存在|计入)|均受到|都受到/.test(joined)) {
        field = 'globalStaggerVulnerable'
      } else if (field === 'vulnerable') {
        field = 'staggerVulnerable'
      }
    }
  }
  return field
}

/**
 * **可映射性预检**（用户 2026-10-16 最终口径）：阶段1 抽完关键字后，
 * 拿「动作 + 属性」去阶段2 词表反查；查不到对应字段的**整条**在阶段1 结束时归入**废原文**
 * （写明原因），**不进阶段2**。
 *
 * ⚠ 关键区分（用户 2026-10-16 二次确认）：**`无法提取` 是槽位级标记、留给人补，不是丢弃** ——
 * `动作=无法提取` 或 `属性=无法提取` 的条目**留在阶段2**（标 `blocked / 待补`，阻断自动映射，
 * 等用户补完再解析）。只有这两种才进废原文：
 *   1. 动作**认得**（在动作表内）但属性在阶段2 词表里查不到对应字段；
 *   2. 命中明确的机制 / 舍弃模式（我方减伤、生命回复、瞬时回能、无敌·抗打断、改上限…）——
 *      那些在更早的步骤里已经被 `pushWaste` 掉了。
 *
 * 例：「生命回复」「立即回复 N 点能量」「技能等级+2」= 废原文；「能量自动回复 +X%」= 正常。
 */
export function checkKeywordMappable({ slots, text = '' } = {}) {
  const value = isPlainObject(slots) ? slots : {}
  const action = String(value.action ?? '').trim()
  const stat = String(value.stat ?? '').trim()
  // —— 槽位级 `无法提取` → 留在阶段2 等补（**不丢**）
  if (isUnable(action) || !action || action === NONE) {
    return { ok: true, field: '', pending: true, reason: '' }
  }
  if (isUnable(stat) || !stat || stat === NONE) {
    return { ok: true, field: '', pending: true, reason: '' }
  }
  if (!ACTION_OPTIONS.includes(action)) {
    return {
      ok: false,
      field: '',
      reason: `动作「${action}」不在动作表（${ACTION_OPTIONS.join(' / ')}）→ 阶段2 查不到对应字段`,
    }
  }
  const field = resolveStatField({
    stat,
    action,
    unit: String(value.unit ?? '%'),
    conditions: value.conditions,
    text,
  })
  if (!field) {
    return {
      ok: false,
      field: '',
      reason: `属性=${stat} + 动作=${action}：阶段2 词表里没有对应字段（需补词表）`,
    }
  }
  return { ok: true, field, reason: '' }
}

function isPercentUnit(unit) {
  return unit === '%'
}

/** 转模专用槽位里哪些被标了 `无法提取` */
function unableConvertSlots(convert) {
  const out = []
  for (const id of CONVERT_SLOT_IDS) {
    if (id === 'convertBase' || id === 'convertCap') continue // 基础值 / 上限允许留空
    if (isUnable(convert?.[id])) out.push(id)
  }
  return out
}

/**
 * 阶段2：**纯查表**把一条关键字映射成层C 增益效果（不做语义理解）。
 *
 * @param {object} keyword `{ slots, convert, stackMax, durationSeconds, anchors, id, origin, rawText }`
 * @returns {{ ok:boolean, blocked:boolean, unableSlots:string[], unmapped:string[], notices:string[],
 *   steps:string[], stat:string, statLabel:string, effect:object|null, reason:string }}
 */
/**
 * **`无法提取` 分两类**（用户 2026-10-16 定稿）：
 *   - **硬槽位**：`属性` / `动作` / `数值`（+ 转模的读取属性 / 折算比例）—— 没有它们就**没有增益可写**、
 *     也没法查表 → **仍然阻断**（标红待补、不进「写入（准备）」）。
 *   - **软槽位**：条件 / 作用域 / 元素 / 目标 / 层数 / 时长 / 对象 —— 缺了只是**少个限定**
 *     → **不阻断**，按 `无` 处理继续映射（条件 → 常驻生效、不写条件、不写进 note），界面上给
 *     红字提示 + 淡色「按无处理」。
 */
export const HARD_UNABLE_SLOTS = ['stat', 'action', 'value']
export const SOFT_UNABLE_SLOTS = SLOT_IDS.filter((id) => !HARD_UNABLE_SLOTS.includes(id))

/**
 * 阶段2 映射（纯函数，**不联网不写库**）。
 *
 * 关键词槽位 → 增益块字段；`无` = 该维度没出现（按默认值落），`无法提取` 按上面分硬 / 软两类处理。
 */
export function mapKeywordsToEffect(keyword = {}) {
  const slots = isPlainObject(keyword.slots) ? keyword.slots : {}
  const steps = []
  const unmapped = []
  const notices = []
  const unableSlots = SLOT_IDS.filter((id) => isUnable(slots[id]))
  const hardUnable = unableSlots.filter((id) => HARD_UNABLE_SLOTS.includes(id))
  const softUnable = unableSlots.filter((id) => SOFT_UNABLE_SLOTS.includes(id))

  // 硬槽位标了「无法提取」→ 阻断该条自动映射（界面标红待补）
  if (hardUnable.length) {
    return {
      ok: false,
      blocked: true,
      unableSlots,
      hardUnable,
      softUnable,
      unmapped: [],
      notices,
      steps,
      stat: '',
      statLabel: '',
      effect: null,
      reason: `有 ${hardUnable.map((id) => SLOT_LABELS[id]).join(' / ')} 标了「${UNABLE}」，已阻断自动映射（补齐后重试）`,
    }
  }
  // 软槽位标了「无法提取」→ 只提示，按 `无` 继续映射（不算 blocked）
  for (const id of softUnable) {
    steps.push(`${SLOT_LABELS[id]}=${UNABLE} → 不阻断，按「${NONE}」处理（少一个限定，继续映射）`)
    notices.push(`${SLOT_LABELS[id]} 标了「${UNABLE}」→ 按「${NONE}」处理（要限定就补上再 [解析]）`)
  }
  const softUnableSet = new Set(softUnable)
  /** 取槽位值时把软槽位的 `无法提取` 当 `无` */
  const slotValue = (id) => {
    const value = slots[id]
    if (softUnableSet.has(id)) {
      if (Array.isArray(value)) return value.filter((item) => item !== UNABLE).length
        ? value.filter((item) => item !== UNABLE)
        : [NONE]
      return NONE
    }
    return value
  }

  // v3 招式锚点：关联不上 → 这条不录（不新建挂载点、不动 schema）
  if (keyword.anchors && keyword.anchors.ok === false) {
    return {
      ok: false,
      blocked: true,
      unableSlots: [],
      unmapped: [],
      notices,
      steps,
      stat: '',
      statLabel: '',
      effect: null,
      reason: keyword.anchors.reason || '招式锚点关联不上 → 按 v3 规则这条不录',
    }
  }

  const statKeyword = String(slots.stat ?? '').trim()
  const action = String(slots.action ?? '').trim()
  const unit = String(slots.unit ?? '').trim()
  // 软槽位读值：`无法提取` 一律当 `无`（用户 2026-10-16：不阻断，按各自默认走）
  const targetRaw = slotValue('target')
  const objectRaw = slotValue('object')
  const stacksRaw = slotValue('stacks')
  const durationRaw = slotValue('duration')
  const conditionsRaw = slotValue('conditions')
  const target = String(targetRaw ?? '').trim()
  const object = String(objectRaw ?? '').trim()
  const stacks = String(stacksRaw ?? '').trim()
  const duration = String(durationRaw ?? '').trim()
  const conditions = Array.isArray(conditionsRaw) && conditionsRaw.length ? conditionsRaw : [NONE]
  const value = Number(slots.value)
  const isConvert = action === '转化'

  // —— 数值（转模条不用「数值」：值由运行时折算，`effect.value ≡ 0`）
  if (!isConvert) {
    if (!Number.isFinite(value)) {
      unmapped.push(`数值「${slots.value}」不是数字，阶段2 无法映射`)
    }
    if (!unit || unit === NONE) {
      steps.push(`单位=${NONE}（纯数，按词表默认单位取键）`)
    }
  }

  // —— **子类专用字段**（用户 2026-10-16）：有专用字段就落专用字段，
  //    不要「共用字段 + scope」（「异放伤害」→ anomalyReleaseDmgBonus，而不是 dmgBonus + scope:['anomalyRelease']）。
  const subkindDedicated = detectSubkindDedicatedField({
    statKeyword,
    scopeText: String(slotValue('scope') ?? '').trim(),
  })
  const statKeywordForLookup = subkindDedicated ? subkindDedicated.stat : statKeyword
  if (subkindDedicated) {
    steps.push(
      `子类专用字段：属性=${statKeyword} + 子类（${subkindDedicated.label}）→ 属性=${subkindDedicated.stat}（有专用字段就不用 scope 兜）`,
    )
  }

  // —— 属性 + 动作 → stat（与阶段1 预检 `checkKeywordMappable` 同一个查表函数）
  const override = ACTION_STAT_OVERRIDES[statKeyword]?.[action]
  const stat = resolveStatField({
    stat: statKeywordForLookup,
    action,
    unit,
    conditions,
    text: String(keyword.rawText ?? ''),
  })
  if (!stat) {
    unmapped.push(
      `属性「${statKeyword || NONE}」+ 动作「${action || NONE}」在阶段2 词表里没有对应字段（需补词表）`,
    )
  } else if (override) {
    steps.push(`属性=${statKeyword} + 动作=${action} → stat=${stat}`)
  } else if (isConvert) {
    steps.push(`属性=${statKeyword}（转模目标属性）→ stat=${stat}`)
  } else {
    steps.push(
      `属性=${statKeyword} + 动作=${action} + 数值=${slots.value} + 单位=${unit || NONE} → stat=${stat}`,
    )
  }
  if (stat === 'staggerVulnerable' && statKeyword === '易伤') {
    steps.push('条件含失衡 → 走失衡易伤系列 staggerVulnerable')
  }
  if (stat && !isConvert && !isPercentUnit(unit) && unit === NONE && /Percent|Rate|Crit|Bonus|Pen/i.test(stat)) {
    steps.push(`单位=${NONE} 按百分比语义取值（${STAT_LABELS[stat] ?? stat}）`)
  }

  // —— 元素过滤：`元素` 槽位（**允许复数**）优先；没有该槽位时由属性里的 `<元素>属性伤害` 拆
  const elementSlotRaw = slotValue('elements')
  const elementSlot = Array.isArray(elementSlotRaw)
    ? elementSlotRaw.filter((item) => item && item !== NONE && item !== UNABLE)
    : []
  let elementFilter = 'all'
  if (elementSlot.length) {
    elementFilter = [...elementSlot]
    steps.push(`元素=${elementSlot.join(' + ')}（可多选）→ elementFilter=${JSON.stringify(elementFilter)}`)
  } else {
    const elementMatch = /^(物理|火|冰|电|以太|风)属性伤害$/.exec(statKeyword)
    if (elementMatch) {
      elementFilter = [elementMatch[1]]
      steps.push(`属性=${statKeyword} → elementFilter=['${elementMatch[1]}']`)
    }
    if (statKeyword === '全属性伤害') {
      steps.push('属性=全属性伤害 → elementFilter 留 all（不限元素）')
    }
  }

  // —— 条件 → applySituation（失衡 / 非失衡是工具字段；其余能表达的保留文本，落不到字段的
  //    在阶段1 就已经写成 `无法提取` —— 见 `classifyConditions`）
  const conditionTexts = conditions.filter((item) => item && item !== NONE && item !== UNABLE)
  const unableConditions = conditions.filter((item) => item === UNABLE)
  const beneficiaryProfessions = new Set(
    conditionTexts.map((text) => PROFESSION_CONDITION_RE.exec(text)?.[1]).filter(Boolean),
  )
  const [applyProfession = null] = beneficiaryProfessions
  if (beneficiaryProfessions.size > 1) unmapped.push('单条增益只能选择一个受益职业')
  const manualState = conditionTexts.includes(MANUAL_STATE_CONDITION)
  if (applyProfession) steps.push(`受益职业=${applyProfession} → applyProfession=${applyProfession}`)
  if (manualState) steps.push('状态需手动启用 → 默认关闭')
  let applySituation = 'global'
  if (!conditionTexts.length && !unableConditions.length) {
    steps.push(`条件=${NONE} → applySituation=global`)
  } else {
    const joined = conditionTexts.join('，')
    if (/非失衡/.test(joined)) applySituation = 'non_stagger'
    else if (/失衡/.test(joined)) applySituation = 'stagger'
    steps.push(
      `条件=${conditions.join(' + ')} → applySituation=${applySituation}` +
        (applySituation === 'global' ? '（工具是期望值计算，没建模的条件不许塞进 note）' : ''),
    )
  }

  // —— 目标 → applyTarget
  let applyTarget = 'self'
  if (target === '全队') {
    applyTarget = 'team'
    const targetSource = keyword.sources?.target
    steps.push(
      '目标=全队 → applyTarget=team' +
        (targetSource === 'default-team' ? '（原文没写明给谁，敌人削弱族默认全队）' : '') +
        (targetSource === 'default-team-enemy-status' ? '（敌人状态条件 + 暴击族、未限定施放者 → 默认全队）' : ''),
    )
  } else {
    steps.push(`目标=${target || NONE} → applyTarget=self`)
  }

  /** 目标默认兜底时写进 note 的**固定短语**（不粘原文；结构化短语白名单） */
  const targetDefaultNote =
    keyword.sources?.target === 'default-team-enemy-status' ? ENEMY_STATUS_TARGET_NOTE : ''

  // —— 作用域（`scope`，编辑器同名字段）→ `scope`；`无` = 通用（不写 scope 之外的值）
  const scopeSlot = subkindDedicated ? NONE : String(slotValue('scope') ?? NONE).trim()
  const scopeId = SCOPE_SLOT_TO_ID[scopeSlot] ?? ''
  const sharpenOnly = scopeId === 'sharpen'
  let scope = 'general'
  if (sharpenOnly) {
    steps.push('作用域=锐化 → conditions.damageTypes=[sharpen]')
  } else if (scopeId) {
    scope = scopeId
    steps.push(`作用域=${scopeSlot} → scope=${scopeId}`)
  } else {
    steps.push('作用域=无 → scope=general（通用）')
  }

  // —— 招式锚点（v3：并进「作用域=招式」；关联不上前面已 return）
  const anchors = keyword.anchors && isPlainObject(keyword.anchors) ? keyword.anchors : null
  const skillTargets = Array.isArray(anchors?.skillTargets) ? anchors.skillTargets : []
  if (skillTargets.length) {
    if (sharpenOnly) {
      scope = 'skill'
    } else if (!scopeId) {
      scope = 'skill'
      steps.push('有招式锚点但作用域槽位是「无」→ scope=skill（兜底）')
    }
    steps.push(
      `作用域=招式 + 限定招式=${anchors.labels.join(' + ')} → skillTargets=` +
        JSON.stringify(skillTargets),
    )
  }

  // —— 转模专用槽位
  const convert = isConvert ? (isPlainObject(keyword.convert) ? keyword.convert : {}) : null
  const unableConvert = isConvert ? unableConvertSlots(convert) : []
  if (isConvert) {
    if (unableConvert.length) {
      unmapped.push(
        `转模槽位 ${unableConvert.map((id) => CONVERT_SLOT_LABELS[id]).join(' / ')} 标了「${UNABLE}」（补齐后重试）`,
      )
    }
    const ratio = Number(convert?.convertRatio)
    if (!Number.isFinite(ratio)) unmapped.push('转模「折算比例」不是数字')
    steps.push(
      `动作=转化（转模）→ kind=convert / value≡0 / 读取属性=${convert?.convertFrom ?? UNABLE}` +
        ` / 取哪一层=${convert?.convertPanelSource ?? 'external'} / 折算比例=${convert?.convertRatio ?? UNABLE}` +
        ` / 上限=${convert?.convertCap ?? '不限'} / 基础值=${convert?.convertBase ?? '未填'}`,
    )
    if (Number.isFinite(Number(convert?.convertRatio))) {
      // 校验比例是数字（转模比例是「百分比」，如 150 = 150%）
      notices.push(`转模比例按百分数入库：${convert.convertRatio}`)
    }
  }

  // —— 加算乘区的「降低」按负值记录。
  const isNegativeZoneAdjustment =
    action === '降低' &&
    (VULNERABLE_STATS.has(stat) || stat === 'dmgBonus' || stat === 'sharpenCritDmgBonus' || isCustomBuffStatKey(stat))
  const effectValue = isNegativeZoneAdjustment && Number.isFinite(value) ? -Math.abs(value) : value
  if (isNegativeZoneAdjustment) {
    steps.push(`动作=降低 + ${STAT_LABELS[stat] ?? stat} → 取负号 ${effectValue}（加算区里的减项）`)
  }

  // —— 层数 → kind / valuePerStack / maxStacks（转模条恒为 `convert`，层数只进 note）
  const stackMax = Number(keyword.stackMax)
  let kind = isConvert ? 'convert' : 'fixed'
  let maxStacks = 1
  let valuePerStack = 0
  const stacked = !isConvert && stacks !== NONE && (Number.isFinite(stackMax) ? stackMax > 0 : /层/.test(stacks))
  if (stacked) {
    kind = 'stacked'
    maxStacks = Number.isFinite(stackMax) && stackMax > 0 ? stackMax : 1
    valuePerStack = effectValue
    steps.push(
      `数值=${slots.value} + 单位=${unit || NONE} + 层数=${stacks} → kind=stacked / valuePerStack=${valuePerStack} / maxStacks=${maxStacks} / defaultStacks=1`,
    )
    if (!(Number.isFinite(stackMax) && stackMax > 0)) {
      unmapped.push(`层数「${stacks}」读不出上限（maxStacks 暂按 1），请补齐`)
    }
  } else if (!isConvert) {
    steps.push(`层数=${NONE} → kind=fixed`)
  } else if (stacks !== NONE) {
    steps.push(`层数=${stacks} → 转模条只进 note（kind 恒为 convert）`)
  }

  // —— 时长：**不转化**，只进 note（规格 §三）
  if (duration && duration !== NONE) {
    steps.push(`时长=${duration} → 不转化，只进 note（后续再议）`)
  }

  // —— 对象：阶段2 不做转模自动判定（留空，界面可手改）
  if (object === '当前招式') {
    steps.push('对象=当前招式 → 阶段2 不做按招式锚点生效（skillTargets 留空），只进 note')
  } else if (object === '能量') {
    steps.push('对象=能量 → 按能量回复口径（energyRegenFlat）')
  }

  const convertNote = isConvert
    ? `转模：读取属性=${CONVERT_FROM_LABELS[convert?.convertFrom] ?? convert?.convertFrom ?? UNABLE} 折算比例=${convert?.convertRatio ?? UNABLE}`
    : ''
  // **note 只允许**（用户 2026-10-16）：用户手填的内容，或**枚举性 / 结构化**的固定短语
  // （时长、对象、转模说明、作用域、同义反复已忽略…）。**绝不自动粘原句 / 半句** ——
  // 原文照旧整块入库（`formatSourceBlock` 的 `原文：…`），不由 note 承担。
  void conditionTexts
  const scopeSlotLabel = String(keyword?.slots?.scope ?? NONE).trim()
  const tautologyDropped = Array.isArray(keyword?.tautologyDropped) ? keyword.tautologyDropped : []
  const noteParts = [
    scopeSlotLabel && scopeSlotLabel !== NONE && scopeSlotLabel !== UNABLE
      ? `作用域：${scopeSlotLabel}`
      : '',
    duration && duration !== NONE ? `时长：${duration}` : '',
    object === '当前招式' ? '对象：当前招式' : '',
    tautologyDropped.length ? `同义反复已忽略：${tautologyDropped.join(' / ')}` : '',
    targetDefaultNote,
    convertNote,
  ]
  const note = noteParts
    .filter(Boolean)
    .reduce((acc, part) => {
      if (!acc) return part
      if (acc.includes(part)) return acc
      return `${acc}，${part}`
    }, '')

  const ok = unmapped.length === 0 && Boolean(stat)
  const effect = ok
    ? {
        id: String(keyword.id ?? ''),
        origin: String(keyword.origin ?? ''),
        /**
         * 作用域（编辑器同名 `scope`，**数组口径**）：`无` → `['general']`。
         * 阶段1 一次只认一个子类 → 写成单元素数组；以后可多选。
         */
        scope: [scope],
        ...(sharpenOnly ? { conditions: { damageTypes: ['sharpen'] } } : {}),
        applyTarget,
        applySituation,
        applyProfession,
        teamProfession: null,
        teamProfessionValues: null,
        teamProfessionMinCount: null,
        elementFilter,
        kind,
        stat,
        statLabel: STAT_LABELS[stat] ?? stat,
        value: isConvert ? 0 : effectValue,
        stackable: false,
        maxStacks,
        valuePerStack,
        defaultStacks: 1,
        enabledDefault: !manualState,
        note,
        // 招式限定 = 条件（锚点关联到既有招式小类 / 大类）
        skillCategory: anchors?.skillCategory || undefined,
        skillSubcategoryId: anchors?.skillSubcategoryId ?? (skillTargets.length === 1 ? null : undefined),
        skillTargets: skillTargets.length ? skillTargets.map((item) => ({ ...item })) : undefined,
        // 转模（动作=转化）：字段对齐 `normalizeConvert`
        convert: isConvert
          ? {
              from: convert?.convertFrom,
              panelSource: convert?.convertPanelSource ?? 'external',
              ratioPercent: Number(convert?.convertRatio),
              cap: convert?.convertCap ?? null,
              defaultBase: convert?.convertBase ?? null,
              initialBase: 0,
            }
          : undefined,
        keywords: {
          slots: { ...slots, conditions: [...conditions] },
          convert: isConvert ? { ...convert } : null,
          stackMax: Number.isFinite(stackMax) ? stackMax : null,
          durationSeconds: Number.isFinite(Number(keyword.durationSeconds))
            ? Number(keyword.durationSeconds)
            : null,
        },
      }
    : null

  return {
    ok,
    blocked: false,
    unableSlots: [...unableSlots, ...unableConvert],
    unmapped,
    steps,
    stat,
    statLabel: STAT_LABELS[stat] ?? '',
    effect,
    reason: ok ? '' : unmapped.join('；'),
  }
}

// ================================================================== 原文项组装

/** 一条关键字效果 → 层C（阶段2 结果挂上去；`不录` 的条目照旧显示原因） */
function decorateEffect(effect, rawText) {
  const parsed = mapKeywordsToEffect({
    slots: effect.slots,
    convert: effect.convert,
    stackMax: effect.stackMax,
    durationSeconds: effect.durationSeconds,
    anchors: effect.anchors,
    // `sources` 要带过去：目标默认兜底的固定短语（note）靠它判断
    sources: effect.sources,
    id: effect.id,
    origin: effect.origin,
    rawText,
  })
  return {
    ...effect,
    unableSlots: parsed.unableSlots,
    blocked: parsed.blocked,
    layerC: parsed.effect,
    mapping: {
      ok: parsed.ok,
      blocked: parsed.blocked,
      steps: parsed.steps,
      unmapped: parsed.unmapped,
      reason: parsed.reason ?? '',
    },
  }
}

/**
 * 一段原文（阶段1 的公开入口）：原文 → 关键字效果（层B/C）+ 废原文。
 * `化简` 按钮、`buildItem`、单测都走这里，保证同源。
 */
export function simplifyText({ text, termNames, origin = '', selfNames = [], anchors = null, agentId = '', emberMarkContext } = {}) {
  const rawText = cleanNanokaText(text, termNames)
  if (!rawText) return { rawText: '', effects: [], waste: [], sentences: [] }
  const { effects, waste, sentences } = extractKeywordEffects({
    text: rawText,
    origin,
    selfNames,
    anchors,
    agentId,
    emberMarkContext,
  })
  return {
    rawText,
    effects: effects.map((effect) => decorateEffect(effect, effect.sentence)),
    waste,
    sentences,
  }
}

/**
 * 组装一个「原文项」：落点 + 原文 + **关键字效果（层B→层C）** + **废原文**清单。
 *
 * ⚠ 两种「单位」别混（用户 2026-10-16 界面口径）：
 *   - `rawText` / `effects` / `waste` = **入库单位**（整个来源块）：原文**完整入库**（含机制句）、
 *     `[关键字]` 行照旧；
 *   - `sentences` = **显示单位**（一句一个）：`{ sourceKey, sourceLabel, sentenceIndex, rawSentence,
 *     keywords, waste, hasKeywords }`；界面左侧**只显示 `hasKeywords === true` 的句子**，
 *     其余句子只进底部废原文区（**只改显示，不改入库**）。
 */
function buildItem({
  slot,
  slotLabel,
  containerIndex,
  source,
  title,
  text,
  termNames,
  origin,
  selfNames,
  landing,
  anchors,
  agentId,
  emberMarkContext,
  skillDesc,
}) {
  const simplified = simplifyText({ text, termNames, origin, selfNames, anchors, agentId, emberMarkContext })
  const rawText = simplified.rawText
  if (!rawText) return null
  const decorated = simplified.effects
  const waste = simplified.waste
  const recordable = decorated.filter((effect) => effect.recorded)
  const keywordsById = new Map(decorated.map((effect) => [effect.id, effect]))
  const sentences = simplified.sentences.map((sentence) => ({
    sourceKey: slot,
    sourceLabel: slotLabel,
    sentenceIndex: sentence.sentenceIndex,
    rawSentence: sentence.rawSentence,
    keywords: sentence.keywords
      .map((effect) => keywordsById.get(effect.id))
      .filter(Boolean),
    waste: sentence.waste,
    hasKeywords: sentence.keywords.length > 0,
  }))
  return {
    slot,
    slotLabel,
    containerIndex,
    source,
    title: title ? cleanNanokaText(title, termNames) : '',
    rawText,
    numbers: extractNumbers(rawText).map((item) => item.value),
    effects: decorated,
    /** 按句配对视图（界面用；左侧只显示 hasKeywords 的句子） */
    sentences,
    /** 废原文：不入库；阶段二确认写入后丢弃 */
    waste,
    landing: landing ?? null,
    /** 招式文本专用：原文 + 关键字还要写进该技能的「描述」字段（`calculator_skills.note`） */
    skillDesc: skillDesc ?? null,
    verdict: recordable.length ? 'buff' : 'waste',
    verdictReason: recordable.length
      ? ''
      : decorated.length
        ? decorated[0]?.dropReason || '招式锚点关联不上'
        : waste[0]?.reason ?? '没抓到可量的增益（机制句）',
  }
}

/** 取满级那条核心被动 / 额外能力（数值随被动等级爬） */
function pickMaxPassiveLevel(passive) {
  const level = passive?.level
  const list = Array.isArray(level) ? level : Object.values(level ?? {})
  const entries = list.filter(isPlainObject)
  if (!entries.length) return null
  return entries.reduce((best, item) =>
    Number(item.level ?? 0) >= Number(best.level ?? 0) ? item : best,
  )
}

const SKILL_SLOT_LABELS = {
  basic: '普通攻击',
  dodge: '闪避',
  special: '特殊技',
  chain: '连携技',
  assist: '支援技',
}

/**
 * 角色详情 → 原文项（层A）+ 关键字效果（层B/C）（**纯函数，不联网**）。
 *
 * 落点（v3）：
 *   - 核心被动 / 额外能力 → `mindscapeBuffs[0]`（**复用该槽位已有的块**，不管块名）
 *   - 影画 1–6            → `mindscapeBuffs[i]`
 *   - 招式文本            → **角色增益块**（槽位 0，与核心被动同槽）+ **该技能的「描述」字段**；
 *     文本里限定的招式只进「条件」（锚点 `skillTargets` / `skillSubcategoryId`）。
 *
 * @param {object} options
 * @param {object} options.detail nanoka 角色详情 JSON
 * @param {string|number} [options.nanokaId]
 * @param {Array<object>|null} [options.anchors] 技能库小类（锚点）
 * @param {object|null} [options.agent] 本地角色，提供锚点归属和职业
 * @param {Array<object>} [options.skills] 本地招式库，用于核对烬痕适用招式
 */
export function extractAgentBuffItems({ detail, nanokaId, termNames, anchors = null, agent = null, skills = [] } = {}) {
  if (!isPlainObject(detail)) throw new Error('缺少角色详情 JSON')
  const id = nanokaId === null || nanokaId === undefined ? '' : String(nanokaId)
  const agentId = String(agent?.id || id)
  const name = cleanNanokaText(detail.name)
  const selfNames = [name, cleanNanokaText(detail.code_name)].filter(Boolean)
  const items = []
  const slot0Landing = {
    container: 'mindscapeBuffs',
    index: 0,
    label: 'mindscapeBuffs[0]（核心被动 / 额外能力）',
  }

  // 来源 2：核心被动 + 额外能力（取满级）→ mindscapeBuffs[0]（复用该槽位已有的块）
  const passive = pickMaxPassiveLevel(detail.passive)
  const emberMarkContext = {
    corePassiveText: cleanNanokaText(passive?.desc?.[0], termNames),
    profession: agent?.profession,
    skills,
  }
  if (passive) {
    const names = Array.isArray(passive.name) ? passive.name : []
    const descs = Array.isArray(passive.desc) ? passive.desc : []
    const core = buildItem({
      slot: 'core',
      slotLabel: '核心被动',
      containerIndex: 0,
      source: 'passive.core',
      title: names[0] ?? '核心被动',
      text: descs[0] ?? '',
      termNames,
      origin: `nanoka:${id}:passive:core`,
      selfNames,
      anchors,
      agentId,
      emberMarkContext,
      landing: { ...slot0Landing, blockHint: '核心被动' },
    })
    if (core) items.push(core)
    const extra = buildItem({
      slot: 'extra',
      slotLabel: '额外能力',
      containerIndex: 0,
      source: 'passive.extra',
      title: names[1] ?? '额外能力',
      text: descs[1] ?? '',
      termNames,
      origin: `nanoka:${id}:passive:extra`,
      selfNames,
      anchors,
      agentId,
      emberMarkContext,
      landing: { ...slot0Landing, blockHint: '额外能力' },
    })
    if (extra) items.push(extra)
  }

  // 来源 3：影画 1–6 → mindscapeBuffs[i]
  const talents = Array.isArray(detail.talent)
    ? detail.talent
    : Object.keys(isPlainObject(detail.talent) ? detail.talent : {})
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => detail.talent[key])
  talents.forEach((talent, index) => {
    if (!isPlainObject(talent)) return
    const rank = index + 1
    const item = buildItem({
      slot: `talent-${rank}`,
      slotLabel: `影画 ${rank}`,
      containerIndex: rank,
      source: `talent.${rank}`,
      title: talent.name ?? '',
      text: talent.desc ?? '',
      termNames,
      origin: `nanoka:${id}:talent:${rank}`,
      selfNames,
      anchors,
      agentId,
      emberMarkContext,
      landing: {
        container: 'mindscapeBuffs',
        index: rank,
        label: `mindscapeBuffs[${rank}]（影画 ${rank}）`,
      },
    })
    if (item) items.push(item)
  })

  // 来源 1：招式文本 → 角色增益块（槽位 0）+ 该技能「描述」字段
  const skill = isPlainObject(detail.skill) ? detail.skill : {}
  for (const [key, label] of Object.entries(SKILL_SLOT_LABELS)) {
    const block = skill[key]
    if (!isPlainObject(block)) continue
    const descriptions = Array.isArray(block.description) ? block.description : []
    descriptions.forEach((entry, index) => {
      if (!isPlainObject(entry)) return
      const text = entry.desc ?? entry.description ?? ''
      const skillName = cleanNanokaText(entry.name ?? label)
      const item = buildItem({
        slot: `skill-${key}-${index}`,
        slotLabel: `招式文本（${label}）`,
        containerIndex: 0,
        source: `skill.${key}.${index}`,
        title: skillName,
        text,
        termNames,
        origin: `nanoka:${id}:skill:${key}.${index}`,
        selfNames,
        anchors,
        agentId,
        emberMarkContext,
        landing: { ...slot0Landing, blockHint: '核心被动' },
        skillDesc: { agentId, skillName, category: key },
      })
      if (item) items.push(item)
    })
  }

  return { kind: 'agent', nanokaId: id, name, items }
}

/**
 * 音擎详情 → 原文项 + 关键字效果（**纯函数，不联网**）。
 *
 * 落点：基础效果（`talents[0]`）→ `fixedBuffs`；精炼 j（`j>=1`）→ `refinementBuffs[j-1]`。
 */
export function extractWengineBuffItems({ detail, nanokaId, termNames, anchors = null } = {}) {
  if (!isPlainObject(detail)) throw new Error('缺少音擎详情 JSON')
  const id = nanokaId === null || nanokaId === undefined ? '' : String(nanokaId)
  const name = cleanNanokaText(detail.name)
  const selfNames = ['装备者', name].filter(Boolean)
  const talents = isPlainObject(detail.talents) ? detail.talents : {}
  const items = []

  // 基础说明（不随精炼变）：`talents[0]`；没有该键时退回顶层 `desc2`
  const baseText = talents['0']?.desc ?? detail.desc2 ?? ''
  const baseItem = buildItem({
    slot: 'fixed',
    slotLabel: '基础效果',
    containerIndex: null,
    source: 'fixed',
    title: talents['0']?.name ?? '基础效果',
    text: baseText,
    termNames,
    origin: `nanoka:${id}:fixed`,
    selfNames,
    anchors,
    agentId: '',
    landing: { container: 'fixedBuffs', index: null, label: 'fixedBuffs（基础效果）' },
  })
  if (baseItem && (baseItem.effects.length || talents['0']?.desc)) items.push(baseItem)

  // 精炼 1–5 → refinementBuffs[0..4]
  for (let level = 1; level <= 5; level += 1) {
    const talent = talents[String(level)]
    if (!isPlainObject(talent)) continue
    const item = buildItem({
      slot: `refinement-${level}`,
      slotLabel: `精炼 ${level}`,
      containerIndex: level - 1,
      source: `weapons.talents.${level}`,
      title: talent.name ?? '',
      text: talent.desc ?? '',
      termNames,
      origin: `nanoka:${id}:refinement:${level}`,
      selfNames,
      anchors,
      agentId: '',
      landing: {
        container: 'refinementBuffs',
        index: level - 1,
        label: `refinementBuffs[${level - 1}]（精炼 ${level}）`,
      },
    })
    if (item) items.push(item)
  }

  return { kind: 'wengine', nanokaId: id, name, items }
}

/**
 * 阶段2 的「解析」入口（纯函数）：把（界面里编辑过的）关键字重跑阶段2，拿到层C。
 * **不联网、不写库、不重新理解人话**（v2 规格 §六：不做「改人话→再理解一次」）。
 */
export function mapEditedKeywords({ effects, kind, nanokaId, origin, anchors } = {}) {
  const list = Array.isArray(effects) ? effects : []
  const id = nanokaId === null || nanokaId === undefined ? '' : String(nanokaId)
  const useOrigin = String(origin ?? '').trim() || `nanoka:${id || 'manual'}:manual`
  void kind
  return list.map((raw, index) => {
    const slots = isPlainObject(raw?.slots) ? raw.slots : {}
    const anchorsPayload = isPlainObject(raw?.anchors)
      ? raw.anchors
      : isPlainObject(anchors)
        ? anchors
        : null
    const mapped = mapKeywordsToEffect({
      slots,
      convert: raw?.convert,
      stackMax: raw?.stackMax,
      durationSeconds: raw?.durationSeconds,
      anchors: anchorsPayload,
      id: String(raw?.id ?? `${useOrigin}#${index}`),
      origin: String(raw?.origin ?? useOrigin),
      rawText: String(raw?.rawText ?? raw?.sentence ?? ''),
    })
    return {
      id: String(raw?.id ?? `${useOrigin}#${index}`),
      origin: String(raw?.origin ?? useOrigin),
      slots,
      convert: isPlainObject(raw?.convert) ? raw.convert : null,
      stackMax: raw?.stackMax ?? null,
      durationSeconds: raw?.durationSeconds ?? null,
      anchors: anchorsPayload,
      unableSlots: mapped.unableSlots,
      blocked: mapped.blocked,
      layerC: mapped.effect,
      mapping: {
        ok: mapped.ok,
        blocked: mapped.blocked,
        steps: mapped.steps,
        unmapped: mapped.unmapped,
        reason: mapped.reason ?? '',
      },
    }
  })
}

// ================================================================== 界面用的槽位视图（v3 显示规则）

/**
 * 关键字行要显示的槽位（v3 变更 1）：**只显示有值的槽位**；
 * `无` 默认隐藏，`详情` 展开全部 9 槽位；`无法提取` 用 ⚠X 表示（不铺开）。
 *
 * @returns {{ visible:Array<{id:string,label:string,value:any,source:string,unable:boolean}>,
 *   hidden:Array<{id:string,label:string,value:any}>, unable:Array<{id:string,label:string}> }}
 */
export function slotView(slots = {}, { expandAll = false } = {}) {
  const visible = []
  const hidden = []
  const unable = []
  for (const id of SLOT_IDS) {
    const value = slots?.[id]
    const entry = { id, label: SLOT_LABELS[id], value, source: '' }
    if (isUnable(value)) {
      unable.push({ id, label: SLOT_LABELS[id] })
      continue
    }
    if (isEmptySlot(value)) {
      hidden.push(entry)
      continue
    }
    visible.push(entry)
  }
  return { visible, hidden, unable, expandAll: Boolean(expandAll) }
}
