import type { ZoneGroup } from './types'

/**
 * 乘区公式说明（管理端展示用）。
 *
 * 权威来源是仓库根目录的 `CALCULATOR_FORMULAS.md`（随代码一起核对）；
 * 这里只做「乘区 key → 可展示的公式文本」的映射，供管理端只读展示，
 * **不参与任何计算**，也不作为规范定义。
 *
 * 新增/修改乘区时：先改 `builtins.ts` / `damageCalc.ts` 与 `CALCULATOR_FORMULAS.md`，
 * 再同步这里；三者不一致以代码与文档为准。
 */
export interface ZoneFormulaNote {
  /** 公式正文（等宽显示） */
  formula: string
  /** 补充说明：口径、边界、适用条件 */
  note?: string
  /** `CALCULATOR_FORMULAS.md` 的章节号，便于核对 */
  docSection?: string
  /** 适用条件（角色专属 / 职业专属 / 失衡期等） */
  appliesWhen?: string
}

/** 全部内置乘区的公式说明；键与 `catalog.ts` 的 `key` 一一对应 */
export const ZONE_FORMULA_NOTES: Readonly<Record<string, ZoneFormulaNote>> = Object.freeze({
  // ---- 核心 ----
  baseDamage: {
    formula: [
      '攻击型基础伤害 = 局内攻击',
      '贯穿型基础伤害 = 0.1 × 局内生命 + 0.3 × 局内攻击 + 固定贯穿力',
    ].join('\n'),
    note: '命破招式持有者固定使用贯穿型基础伤害；锋御走防御力基础（见锐化伤害）。',
    docSection: '§5.1',
  },
  dmgMultiplier: {
    formula: '增伤区 = 1 + clamp(局内增伤% / 100, -0.95, 20)',
    note: '局内增伤% 含通用增伤、招式增伤（命中条件时）与弱点增伤。',
    docSection: '§5.2',
  },
  defenseMultiplier: {
    formula: [
      '穿透率 = clamp(局内穿透率% / 100, 0, 0.95)',
      '无视防御率 = clamp(无视防御% / 100, 0, 1)',
      '减防率 = clamp(减防% / 100, 0, 1)',
      '防御保留系数 = max(0, 1 - 无视防御率 - 减防率)',
      '有效防御 = max(0, max(0, 敌方防御 × 防御保留系数 × (1 - 穿透率)) - 穿透值)',
      '防御区 = 794 / (794 + 有效防御)',
    ].join('\n'),
    note: '防御区恒 ≤ 1；有效防御为 0 时防御区 = 1。命破招式持有者防御区固定为 1。',
    docSection: '§5.2',
  },
  resistanceMultiplier: {
    formula: '抗性区 = 1 - 敌方抗性 + 抗性穿透% / 100',
    note: '敌方抗性预设：弱点 -0.2 / 普通 0 / 抗性20% 0.2 / 抗性40% 0.4；抗性穿透按面板 resPen 加算。',
    docSection: '§5.2',
  },
  vulnerableMultiplier: {
    formula: [
      '直伤易伤区 = max(0, 敌人易伤基础 + 易伤%/100 + 直伤易伤%/100 − 减伤%/100 − 直伤减伤%/100)',
      '非直伤易伤区 = max(0, 敌人易伤基础 + 易伤%/100 + 非直伤易伤%/100 − 减伤%/100 − 非直伤减伤%/100)',
    ].join('\n'),
    note: '直伤 / 命破乘直伤易伤区；异常 / 紊乱 / 乱流 / 异放 / 耀变乘非直伤易伤区。',
    docSection: '§5.3',
  },
  staggerMultiplier: {
    formula: [
      '失衡期 = 敌方失衡基础 + 全局失衡易伤%/100 + (失衡易伤% + 仅失衡易伤%)/100',
      '非失衡期 = 1 + 全局失衡易伤% / 100',
    ].join('\n'),
    note: '叶瞬光等带「帷幕易伤」的招式改用帷幕乘区：帷幕易伤 = min(最终失衡易伤, 上限)，吃了全部失衡易伤类增益；上限 0–3 影 210%、4–6 影 300%，进失衡与否都乘帷幕、不再乘失衡。',
    docSection: '§5.3 / 帷幕条款',
    appliesWhen: '普通失衡期判定；帷幕易伤见对应招式',
  },
  generalMultiplier: {
    formula: [
      '通用乘区（不含易伤）= 基础伤害 × 增伤区 × 防御区 × 抗性区 × max(0, 失衡区)',
      '直伤链再乘直伤易伤区；异常基础再乘非直伤易伤区。',
    ].join('\n'),
    note: '自定义乘区（percentSum）在末尾连乘，未启用方案时因子恒为 1。',
    docSection: '§5.4',
  },

  // ---- 直伤 ----
  critMultiplier: {
    formula: [
      '暴击率 = clamp(局内暴击率% / 100, 0, 1)',
      '暴伤 = clamp(局内暴伤% / 100, 0, 20)',
      '暴击期望区 = 1 + 暴击率 × 暴伤',
    ].join('\n'),
    note: '流程选「不暴击」时区为 1；「必暴击」时区为 1 + 暴伤。',
    docSection: '§5.2',
  },
  sharpenCritZone: {
    formula: [
      '锐爆伤害 B = 1.2 + 锐爆伤害加成% / 100',
      '暴击率比值 r = clamp(局内暴击率% / 100, 0, 2)',
      '锐爆期望区 = r ≤ 1 ? 1 + r × B',
      '                     : (1 + B) × [1 + B × (r − 1)]',
    ].join('\n'),
    note: '首段必暴、超出部分再判一次；不使用常规暴伤区。',
    docSection: '§6.1',
    appliesWhen: '仅锋御职业或招式 damageType = sharpen',
  },
  directDmgMultZone: {
    formula: '直伤倍率区 = max(0, 局内直伤倍率% / 100) × 直伤倍率修正',
    note: '命中招式小类时优先采用小类配置；招式「最终倍率%」手填时直接作为加算区。',
    docSection: '§6',
  },
  settlementDmgMultZone: {
    formula: '决算倍率区 = max(0, 局内直伤倍率% / 100) × 直伤倍率修正（同直伤倍率区）',
    note: '作为独立分量加到直伤期望；与直伤倍率同口径。',
    docSection: '§6',
  },
  pierceDmgMultiplier: {
    formula: [
      '贯穿增伤区 = 基础伤害来源为贯穿力时：1 + 贯穿增伤% / 100',
      '             否则：1',
    ].join('\n'),
    note: '仅命破路径生效。',
    docSection: '§5.3',
    appliesWhen: '基础伤害来源 = 贯穿力',
  },
  sharpenDmgMultiplier: {
    formula: '锐化伤害提升区 = 1 + 锐化伤害提升% / 100',
    note: '独立乘区，对标命破贯穿增伤；不乘决算、不乘贯穿增伤。',
    docSection: '§6.1',
    appliesWhen: '仅锐化路径生效',
  },

  // ---- 异常通用 ----
  masteryZone: {
    formula: '精通区 = 异常精通 / 100',
    note: '注意不带 +1：与增伤区（1 + …）口径不同。异常精通取异常类触发者面板。',
    docSection: '§7.1',
  },
  levelZone: {
    formula: '等级区 = trunc(1 + (代理人等级 − 1) / 59, 4)',
    note: '保留 4 位小数截断；等级取异常类触发者。',
    docSection: '§7.1',
  },
  specialMultiplier: {
    formula: '特殊乘区 = 特殊区基础 + 特殊补充% / 100',
    note: '映射参考站「直接攻击伤害」一栏；负值时按 max(0, …) 参与连乘处取非负。',
    docSection: '§5.3',
  },
  specialMultZone: {
    formula: '特殊倍率乘区 = max(0, 特殊倍率% / 100) × 特殊倍率修正',
    note: '与特殊乘区（加算型）区分：这是独立倍率区，未配置时基准为 100%。',
    docSection: '§1.2 / §7.6',
  },

  // ---- 属性异常（文档称「普通异常」，§7.2） ----
  attributeAnomalyDmgBonusZone: {
    formula: '异常增伤区 = 1 + 异常增伤% / 100',
    note: '属性异常走普通异常公式；增伤读异常类触发者面板，异常基础读异常强度提供者。',
    docSection: '§7.2',
    appliesWhen: '仅属性异常',
  },
  attributeAnomalyMultZone: {
    formula: [
      '异常倍率区 = max(0, 异常倍率% / 100) × 异常倍率修正',
      '（异常倍率修正 = 小类异常倍率修正 × 面板异常倍率修正；面板为 100% 时乘 1）',
    ].join('\n'),
    docSection: '§7.2',
    appliesWhen: '仅属性异常',
  },
  attributeAnomalyCritZone: {
    formula: [
      '异常暴击区（期望）= 1 + (异常暴击率% / 100) × clamp(异常爆伤% / 100, 0, 20)',
      '暴击率 = 0 时区为 1；暴击率 = 1 时为 1 + clamp(异常爆伤% / 100, 0, 20)',
    ].join('\n'),
    note: '暴击率 / 爆伤取异常类触发者面板。',
    docSection: '§7.2',
    appliesWhen: '仅属性异常',
  },

  // ---- 异放 ----
  anomalyReleaseDmgBonusZone: {
    formula: '异放综合增伤区 = 1 + (异放增伤% + 普通异常增伤%) / 100',
    note: '异放增伤 / 倍率按异常强度提供者的属性，从异常类触发者面板汇总（含属性转模筛选）。',
    docSection: '§7.3',
    appliesWhen: '仅异放',
  },
  anomalyReleaseMultZone: {
    formula: '异放倍率区 = max(0, 异放倍率% / 100) × 异放倍率修正',
    docSection: '§7.3',
    appliesWhen: '仅异放',
  },
  anomalyReleaseCritZone: {
    formula: [
      '综合暴击率 = 异常暴击率% / 100 + 异放暴击率% / 100',
      '综合爆伤 = clamp(异常爆伤% / 100, 0, 20) + clamp(异放爆伤% / 100, 0, 20)',
      '异常综合暴击区（期望）= 1 + 综合暴击率 × 综合爆伤',
    ].join('\n'),
    note: '异放与普通异常共用「异常综合暴击区」：暴击率、爆伤分别相加后相乘。',
    docSection: '§7.3',
    appliesWhen: '仅异放',
  },

  // ---- 紊乱 ----
  disorderDmgBonusZone: {
    formula: '紊乱增伤区 = 1 + 紊乱增伤% / 100',
    note: '紊乱不额外乘普通异常增伤区 / 倍率区 / 暴击区，只吃自己的 disorderCritRate / disorderCritDmg。',
    docSection: '§7.4',
    appliesWhen: '仅紊乱',
  },
  disorderZone: {
    formula: [
      '火/以太有效持续时间 = floor(异常持续时间 / 0.5)，其他属性 = floor(异常持续时间)',
      '紊乱倍率区 = max(0, 紊乱基础倍率% / 100 + 有效持续时间 × 紊乱补偿倍率% / 100)',
      '            × 紊乱倍率修正',
    ].join('\n'),
    note: '有效持续时间按异常强度提供者属性判定。招式手填「最终倍率%」直接作为括号内结果，不再重复加时间 × 补偿；修正乘在倍率区整体上。',
    docSection: '§7.4',
    appliesWhen: '仅紊乱',
  },
  disorderCritZone: {
    formula: [
      '紊乱暴击区（期望）= 1 + (紊乱暴击率% / 100) × clamp(紊乱爆伤% / 100, 0, 20)',
      '暴击率 = 0 时区为 1；暴击率 = 1 时为 1 + clamp(紊乱爆伤% / 100, 0, 20)',
    ].join('\n'),
    note: '暴击率 / 爆伤取异常类触发者面板的 disorderCritRate / disorderCritDmg；暴击率不 clamp，未配置时区恒为 1。',
    docSection: '§7.4',
    appliesWhen: '仅紊乱',
  },

  // ---- 乱流 ----
  turbulenceDmgBonusZone: {
    formula: '乱流综合增伤区 = 1 + (乱流增伤% + 普通异常增伤%) / 100',
    docSection: '§7.5',
    appliesWhen: '仅乱流',
  },
  turbulenceZone: {
    formula: [
      '有效持续时间 = floor(异常持续时间)（火/以太按 / 0.5 折算）',
      '乱流倍率区 = max(0, 乱流基础倍率% / 100 + 有效持续时间 × 乱流补偿倍率% / 100)',
      '            × 乱流倍率修正',
    ].join('\n'),
    note: '招式手填「最终倍率%」直接作为括号内结果；修正乘在倍率区整体上。',
    docSection: '§7.5',
    appliesWhen: '仅乱流',
  },
  turbulenceCritZone: {
    formula: [
      '异常暴击区（期望）= 1 + (异常暴击率% / 100) × clamp(异常暴伤% / 100, 0, 20)',
      '无普通异常暴击时为 1',
    ].join('\n'),
    note: '乱流只吃普通异常暴击（turbulenceCrit* 不参与，与紊乱同构）。',
    docSection: '§7.5',
    appliesWhen: '仅乱流',
  },

  // ---- 耀变 ----
  radianceDmgBonusZone: {
    formula: '耀变综合增伤区 = 1 + (耀变增伤% + 普通异常增伤%) / 100',
    note: '耀变增伤读异常类触发者面板（含队友赋予的耀变增伤）。',
    docSection: '§7.6',
    appliesWhen: '仅耀变（含蕾米埃尔本人耀变）',
  },
  radianceMultZone: {
    formula: '耀变倍率区 = max(0, 耀变倍率% / 100) × 耀变倍率修正',
    docSection: '§7.6',
    appliesWhen: '仅耀变',
  },
  radianceCritZone: {
    formula: [
      '耀变暴击区（期望）= 1 + (耀变暴击率% / 100) × clamp(耀变爆伤% / 100, 0, 20)',
      '暴击率 = 0 时区为 1；暴击率 = 1 时为 1 + clamp(爆伤% / 100, 0, 20)',
    ].join('\n'),
    note: '耀变触发者无论是蕾米埃尔还是其他人都允许暴击；普通耀变链与本人耀变链乘同一个耀变暴击区。',
    docSection: '§7.6',
    appliesWhen: '仅耀变',
  },
  mutationZone: {
    formula: '异化系数区 = max(0, 1 + 异化系数% / 100) × 异化系数修正',
    note: '普通耀变链乘异化系数；蕾米埃尔本人耀变链使用自己的异化系数区（见下）。',
    docSection: '§7.6',
    appliesWhen: '仅普通耀变链（本人耀变另算）',
  },

  // ---- 蕾米埃尔本人耀变（角色专属） ----
  remielSelfInCombatAtk: {
    formula: '本人耀变局内攻击力 = 局外攻击 + 自身攻击转模',
    note: '仅在「异常强度提供者 = 蕾米埃尔」时启用；提供者是其他角色时异常基础走普通强度提供者面板。',
    docSection: '§7.6',
    appliesWhen: '角色专属：蕾米埃尔（流明）本人耀变',
  },
  remielSelfInCombatMasteryZone: {
    formula: '本人耀变局内精通区 = 局内异常精通 / 100',
    note: '局内精通 = 局外精通 + 四件套 / 音擎全局精通；同样不带 +1。',
    docSection: '§7.6',
    appliesWhen: '角色专属：蕾米埃尔本人耀变',
  },
  remielSelfSpecialLevelZone: {
    formula: '特殊等级区 = 1 + 0.025 × 等级',
    note: '等级 clamp 到有效范围（1–60）。这是本人耀变专属等级区，与标准等级区并存。',
    docSection: '§7.6',
    appliesWhen: '角色专属：蕾米埃尔本人耀变',
  },
  remielSelfMutationZone: {
    formula: '本人耀变异化系数区 = max(0, 异化系数区)',
    note: '与普通耀变链分别计算；参与异常基础连乘时取非负。',
    docSection: '§7.6',
    appliesWhen: '角色专属：蕾米埃尔本人耀变',
  },
  remielSelfStandardLevelZone: {
    formula: '标准等级区 = 1 + (等级 − 1) / 59',
    docSection: '§7.6',
    appliesWhen: '角色专属：蕾米埃尔本人耀变',
  },
  remielSelfDefenseMultiplier: {
    formula: '本人耀变防御区 = 794 / (794 + 有效防御)',
    note: '有效防御口径同 §5.2，取蕾米埃尔面板的穿透 / 减防。',
    docSection: '§7.6',
    appliesWhen: '角色专属：蕾米埃尔本人耀变',
  },
  remielSelfResistanceMultiplier: {
    formula: '本人耀变抗性区 = 1 - 敌方抗性 + 抗性穿透% / 100',
    docSection: '§7.6',
    appliesWhen: '角色专属：蕾米埃尔本人耀变',
  },
})

/** 本人耀变最终结算公式（不在单个乘区里，单独展示） */
export const RADIANCE_SELF_FINAL_FORMULA: ZoneFormulaNote = Object.freeze({
  formula: [
    '本人耀变异常基础 = 局内攻击 × 局内精通区 × 特殊等级区 × 异化系数区 × 标准等级区',
    '本人耀变最终 = 异常基础 × 防御区 × 抗性区 × 易伤区 × 失衡易伤区',
    '             × 耀变综合增伤 × 耀变倍率区 × 特殊倍率乘区',
    '             × 特殊乘区 × 耀变暴击区',
  ].join('\n'),
  note: '本人耀变的特殊攻/精公式仅在「异常强度提供者 = 蕾米埃尔」时启用；再乘次数。',
  docSection: '§7.6',
  appliesWhen: '角色专属：蕾米埃尔本人耀变',
})

/** 分组的公式总览（用于按链路查看） */
export const ZONE_GROUP_FORMULAS: Readonly<Record<ZoneGroup, ZoneFormulaNote>> = Object.freeze({
  core: {
    formula: [
      '通用乘区（不含易伤）= 基础伤害 × 增伤区 × 防御区 × 抗性区 × max(0, 失衡区)',
      '直伤链再乘直伤易伤区；异常基础再乘非直伤易伤区。',
    ].join('\n'),
    docSection: '§5.4',
  },
  direct: {
    formula: [
      '直伤期望 = 通用乘区（增伤区扣弱伤）',
      '         × 直伤易伤区 × 暴击期望区',
      '         × max(0, 特殊区) × max(0, 贯穿增伤区)',
      '         × 直伤倍率区（+ 决算倍率分量）',
    ].join('\n'),
    note: '增伤区 = 1 + clamp((局内增伤% − 弱伤%) / 100, -0.95, 20)；弱伤仅 Buff dmgPenalty，异常链不扣。',
    docSection: '§6',
  },
  anomaly: {
    formula: [
      '异常基础 = 通用乘区 × 非直伤易伤区 × 精通区 × 等级区 × max(0, 特殊区)',
      '异常伤害 = 异常基础 × 子类增伤区 × 子类倍率区 × 子类暴击区',
    ].join('\n'),
    note: '通用乘区中的基础伤害对所有职业一律取异常强度提供者的局内攻击力（命破/锋御也不例外）。',
    docSection: '§7.1 / §7.2',
  },
  radianceSelf: {
    formula: RADIANCE_SELF_FINAL_FORMULA.formula,
    note: RADIANCE_SELF_FINAL_FORMULA.note,
    docSection: '§7.6',
    appliesWhen: '角色专属：蕾米埃尔本人耀变',
  },
  special: {
    formula: '特殊乘区为独立乘数，在各类链路末尾参与连乘',
    docSection: '§5.3',
  },
  custom: {
    formula: [
      '自定义乘区（percentSum）= 1 + Σ(custom[statKey]) / 100',
      '可配置 cap / floor / allowNegative；providers 决定取哪些来源的加成',
    ].join('\n'),
    note: 'providers：owner = 仅乘区所有者来源，team = 队伍内全部来源，all = 含邦布 / 场地 / 环境。',
    docSection: '模块化方案 §10',
  },
})

export function getZoneFormulaNote(key: string): ZoneFormulaNote | null {
  return ZONE_FORMULA_NOTES[key] ?? null
}
