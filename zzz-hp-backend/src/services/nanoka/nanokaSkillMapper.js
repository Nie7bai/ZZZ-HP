/**
 * nanoka 招式（技能倍率）映射（**纯函数，不联网、不读库、不写库**）。
 *
 * 本文件把命令行参照实现 `scripts/import-nanoka-skills.mjs` 的口径**原样搬进仓库**，
 * 供管理端「③ 招式」一键录入复用（浏览器抓详情 → 后端算 plan → 按 plan 写库）。
 * 数值口径**不许另行发挥**：改动公式前先回去核对那份 CLI。
 *
 * 倍率换算（技能等级 L，默认 12）：
 *   baseMult = (damage_percentage + damage_percentage_growth * (L - 1)) / 100
 * 例：克拉蕾「锻星·一段」L12：
 *   (10770 + 980 * 11) / 100 = 215.5
 *
 * 策略 B（现行）：匹配则只更新倍率相关（multSource / damagePercentage / growth / L12 baseMult）；
 * 保留已有 skillTypes / element / buffAnchorId / note / settlementMult / baseMultFactor 等。
 * 缺失则新建（含 types / element / anchor）。只取「伤害倍率」段（跳过失衡）。同名段去重（保留首条）。
 *
 * 与 CLI 的差别（有意为之，见任务口径）：
 *   - 不搬 CLI 里那张硬编码 `AGENT_NANOKA_LOOKUP`（只钉了 claret）；`nanokaId` 由调用方传入；
 *   - 不创建招式小类（小类由人工按需建）；`resolveBuffAnchorId` 只在既有小类里找锚点。
 */

const NANOKA_CATEGORY_TO_SKILL_TYPES = {
  basic: ['basic'],
  dodge: ['dodge'],
  special: ['special'],
  chain: ['chain'],
  assist: ['assist'],
}

/** 名字归一化：NFKC、去空白、全角括号/冒号统一（匹配既有招式用） */
export function normalizeSkillName(name) {
  return String(name ?? '')
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[：:]/g, '：')
    .trim()
}

/** 去掉「普通攻击：」这类技能标题前缀（锚点候选用） */
export function stripSkillTitlePrefix(skillName) {
  return String(skillName ?? '').replace(
    /^(普通攻击|闪避|冲刺攻击|支援技|特殊技|强化特殊技|连携技|终结技)[:：]/,
    '',
  )
}

/** 「一段伤害倍率」→「一段」；纯「伤害倍率」→ '' */
export function shortParamLabel(paramName) {
  const raw = String(paramName ?? '').trim()
  if (raw === '伤害倍率') return ''
  return raw.replace(/伤害倍率$/, '').trim()
}

export function buildDisplayName(skillName, paramName) {
  const short = shortParamLabel(paramName)
  if (!short) return skillName
  return `${skillName}·${short}`
}

/** 稳定 id，便于反复导入：sk-{agent}-nk-{nanokaSkillId}-{slug} */
export function stableSkillId(agentId, nanokaSkillId, paramName) {
  const slug = shortParamLabel(paramName) || 'main'
  const safeSlug = slug
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  const id = `sk-${agentId}-nk-${nanokaSkillId}-${safeSlug || 'main'}`
  return id.slice(0, 64)
}

/**
 * 大类 + 小类一并写入（管理端勾选要看得见）。
 * nanoka 把终结技挂在 chain 下，按名称纠正为 ultimate。
 */
export function mapSkillTypes(category, skillName) {
  const name = String(skillName ?? '')
  if (/终结技/.test(name)) return ['ultimate']
  if (/连携技/.test(name)) return ['chain']
  if (/强化特殊技/.test(name) || (category === 'special' && /强化/.test(name))) {
    return ['special', 'specialEnhanced']
  }
  if (category === 'special' || /^特殊技/.test(name)) {
    return ['special', 'specialBasic']
  }
  if (/闪避反击/.test(name) || (category === 'dodge' && /反击/.test(name))) {
    return ['dodge', 'dodgeCounter']
  }
  if (/冲刺攻击/.test(name)) return ['dodge', 'dash']
  if (category === 'basic' || /普通攻击/.test(name)) return ['basic']
  if (category === 'assist') return ['assist']
  if (category === 'dodge') return ['dodge']
  if (category === 'chain') return ['chain']
  return [...(NANOKA_CATEGORY_TO_SKILL_TYPES[category] ?? ['basic'])]
}

/** 大类 → 技能等级表键（异放/耀变的等级转模按本招所属大类取） */
const CATEGORY_TO_TALENT_KEY = {
  basic: 'basic',
  dodge: 'dodge',
  assist: 'assist',
  special: 'special',
  chain: 'chainUltimate',
}

/** 异常类倍率参数名 → 本库 damageType（值可能不在 param 里，而在 desc 的 `{CAL:...}` 模板） */
const ANOMALY_PARAM_DAMAGE_TYPES = [
  { pattern: /异放.*倍率/, damageType: 'anomalyRelease' },
  { pattern: /耀变.*倍率/, damageType: 'radiance' },
  { pattern: /紊乱.*倍率/, damageType: 'disorder' },
  { pattern: /乱流.*倍率/, damageType: 'turbulence' },
]

/**
 * 参数名 → damageType：
 * - `xx伤害倍率`（非失衡）→ `direct`
 * - `异放/耀变/紊乱/乱流倍率` → 对应异常类
 * - 其它（能量消耗等）→ `null`（不采集）
 */
export function resolveParamDamageType(paramName) {
  const name = String(paramName ?? '').trim()
  if (!name) return null
  for (const rule of ANOMALY_PARAM_DAMAGE_TYPES) {
    if (rule.pattern.test(name)) return rule.damageType
  }
  if (name.includes('伤害倍率') && !name.includes('失衡')) {
    // 未识别的异常类参数不能当直伤导入（否则异常数值会被挂到直伤行）
    if (name.includes('异常')) return null
    return 'direct'
  }
  return null
}

const CAL_EXPRESSION_PATTERN = /\{CAL:([^{}]+)\}/

/**
 * 解析 nanoka 的运行时模板 `{CAL:225+20*(AvatarSkillLevel(0)-1),1,2}%`。
 * 返回 `{ expression, evaluate(level) }`；不是 CAL 或含非法字符时返回 null。
 *
 * 等级占位（`AvatarSkillLevel(n)`）统一按**本招所属大类**的等级代入——各招式段的
 * CAL 角标与所在大类一致，用大类取等级比猜 n 的含义更稳。
 */
export function parseCalFormula(desc) {
  const text = String(desc ?? '')
  const match = text.match(CAL_EXPRESSION_PATTERN)
  if (!match) return null
  // `{CAL:<expr>,<精度>,<模式>}`：只取第一段算式，后面是格式化参数
  const expression = match[1].split(',')[0].trim()
  if (!expression) return null
  const staticExpression = expression.replace(/AvatarSkillLevel\(\s*\d+\s*\)/g, '0')
  // 只允许数字、小数点、四则运算与括号；远程数据不接受其它写法
  if (!/^[\d.\s+\-*/()]+$/.test(staticExpression)) return null
  return {
    expression,
    evaluate(level) {
      const filled = expression.replace(
        /AvatarSkillLevel\(\s*\d+\s*\)/g,
        String(Math.max(0, Number(level) || 0)),
      )
      return evaluateArithmeticExpression(filled)
    },
  }
}

/** 安全的四则运算求值（递归下降；不 eval） */
function evaluateArithmeticExpression(expression) {
  const source = String(expression ?? '').replace(/\s+/g, '')
  let index = 0
  const peek = () => source[index]
  const parseNumber = () => {
    const start = index
    while (index < source.length && /[0-9.]/.test(source[index])) index += 1
    if (start === index) return null
    const value = Number(source.slice(start, index))
    return Number.isFinite(value) ? value : null
  }
  const parseFactor = () => {
    if (peek() === '+') {
      index += 1
      return parseFactor()
    }
    if (peek() === '-') {
      index += 1
      const value = parseFactor()
      return value == null ? null : -value
    }
    if (peek() === '(') {
      index += 1
      const value = parseSum()
      if (value == null || peek() !== ')') return null
      index += 1
      return value
    }
    return parseNumber()
  }
  const parseProduct = () => {
    let value = parseFactor()
    if (value == null) return null
    while (peek() === '*' || peek() === '/') {
      const operator = source[index]
      index += 1
      const right = parseFactor()
      if (right == null) return null
      value = operator === '*' ? value * right : value / right
    }
    return value
  }
  const parseSum = () => {
    let value = parseProduct()
    if (value == null) return null
    while (peek() === '+' || peek() === '-') {
      const operator = source[index]
      index += 1
      const right = parseProduct()
      if (right == null) return null
      value = operator === '+' ? value + right : value - right
    }
    return value
  }
  const result = parseSum()
  if (result == null || index !== source.length || !Number.isFinite(result)) return null
  return result
}

/**
 * 同一 `Skill:<id>` 的多档参数在 nanoka 里共用一组数值，档位差别写在 `desc` 的除法上：
 * 例如叶瞬光「明心境·飞光·消耗1点青溟剑势」的 desc 是
 * `{{Skill:1431018, Prop:1001}/6}`（总倍率 ÷6），而 6 点档是 `{Skill:1431018, Prop:1001}`（不除）。
 *
 * 只认「整段只有一个模板 + 一个 `/N`」的写法；带乘号、多个模板、夹其它文字等一律按 1 处理，
 * 避免把远程数据的未知格式误当成缩放。
 */
export function parseDescDamageDivisor(desc) {
  const text = String(desc ?? '').replace(/\s+/g, '')
  const match = text.match(/^\{?\{Skill:[^{}]+\}(?:\/(\d+(?:\.\d+)?))?\}?%?$/)
  if (!match?.[1]) return 1
  const divisor = Number(match[1])
  return Number.isFinite(divisor) && divisor > 0 ? divisor : 1
}

/**
 * 技能等级 L 时的伤害倍率%（本库 baseMult）。
 * nanoka 存万分比整数：3120 → 31.20% at L1；每级 +growth。
 */
export function computeBaseMultPercent(damagePercentage, growth, level = 12) {
  const base = Number(damagePercentage) || 0
  const g = Number(growth) || 0
  const lv = Math.max(1, Number(level) || 12)
  const raw = (base + g * (lv - 1)) / 100
  return Math.round(raw * 1000) / 1000
}

/**
 * 从角色详情拆出倍率候选段（同名同类型去重，保留首条）。
 *
 * - 直伤：`xx伤害倍率`（非失衡），数值取 `param` 里的 `damage_percentage` / `growth`；
 *   `desc` 若对该参数带 `/N`（同 id 多档共用数值，如叶瞬光 1 点/6 点青溟剑势），先按 N 缩放
 * - 异常类（异放 / 耀变 / 紊乱 / 乱流）：参数名命中后，数值优先取 `param`；
 *   没有 `param` 时解析 `desc` 里的 `{CAL:...}` 模板（nanoka 的异放/耀变只写在 desc）
 *
 * 异常类段的 `displayName` 直接沿用直伤招式名（用户口径：命名可以一致），
 * 由 `damageType` 区分；`talentKey` 用于按等级缩放（写入 `radianceTalentKey`）。
 *
 * @param {Record<string, any>} detail `zh/character/<id>.json` 原文
 * @param {{ level?: number }} [options] 技能等级，默认 12
 */
export function extractDamageSegments(detail, { level = 12 } = {}) {
  const skillRoot = detail?.skill ?? {}
  const segments = []
  const seenNorm = new Set()
  for (const [category, block] of Object.entries(skillRoot)) {
    const descriptions = Array.isArray(block?.description) ? block.description : []
    for (const entry of descriptions) {
      const skillName = String(entry?.name ?? '').trim()
      if (!skillName) continue
      const params = Array.isArray(entry?.param) ? entry.param : []
      let parentParamId = null
      for (const p of params) {
        const paramMap = p?.param && typeof p.param === 'object' ? p.param : {}
        const paramId = Object.keys(paramMap)[0]
        if (paramId) {
          parentParamId = paramId
          break
        }
      }
      for (const p of params) {
        const paramName = String(p?.name ?? '').trim()
        const damageType = resolveParamDamageType(paramName)
        if (!damageType) continue

        const paramMap = p?.param && typeof p.param === 'object' ? p.param : {}
        const nanokaSkillId = Object.keys(paramMap)[0]
        let damagePercentage
        let damagePercentageGrowth
        let baseMult
        let calExpression = null
        if (nanokaSkillId) {
          const stats = paramMap[nanokaSkillId] ?? {}
          // 同 id 的多档参数共用数值，档位缩放写在 desc 的 `/N`（见 parseDescDamageDivisor）
          const divisor = parseDescDamageDivisor(p?.desc)
          const rawPercentage = Number(stats.damage_percentage ?? stats.main) || 0
          const rawGrowth = Number(stats.damage_percentage_growth ?? stats.growth) || 0
          damagePercentage = Math.round((rawPercentage / divisor) * 1000) / 1000
          damagePercentageGrowth = Math.round((rawGrowth / divisor) * 1000) / 1000
          baseMult = computeBaseMultPercent(rawPercentage / divisor, rawGrowth / divisor, level)
        } else {
          // 异常类倍率（异放 / 耀变等）只写在 desc 的 CAL 模板里，没有 param 数值
          const cal = parseCalFormula(p?.desc)
          if (!cal) continue
          const valueAt1 = cal.evaluate(1)
          const valueAt12 = cal.evaluate(12)
          const valueAtLevel = cal.evaluate(level)
          if (![valueAt1, valueAt12, valueAtLevel].every((v) => Number.isFinite(v))) continue
          damagePercentage = Math.round(valueAt1 * 100 * 1000) / 1000
          damagePercentageGrowth =
            Math.round(((valueAt12 - valueAt1) / 11) * 100 * 1000) / 1000
          baseMult = Math.round(valueAtLevel * 1000) / 1000
          calExpression = cal.expression
        }

        const displayName =
          damageType === 'direct' ? buildDisplayName(skillName, paramName) : skillName
        const norm = `${damageType}|${normalizeSkillName(displayName)}`
        if (seenNorm.has(norm)) continue
        seenNorm.add(norm)
        const talentKey = CATEGORY_TO_TALENT_KEY[category] ?? null
        segments.push({
          category,
          skillName,
          paramName,
          nanokaSkillId: String(nanokaSkillId ?? parentParamId ?? `cal-${category}-${skillName}`),
          displayName,
          baseMult,
          damagePercentage,
          damagePercentageGrowth,
          skillTypes: damageType === 'direct' ? mapSkillTypes(category, skillName) : [],
          titleCore: stripSkillTitlePrefix(skillName),
          damageType,
          talentKey: damageType === 'direct' ? null : talentKey,
          calExpression,
        })
      }
    }
  }
  return segments
}

/** 去掉本库备注括号，便于对 nanoka 中文名（本地角色匹配用） */
export function stripAgentNameNoise(name) {
  return String(name ?? '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .trim()
}

/**
 * 段 → 既有招式小类 id（锚点）。
 * 优先短参名（如「毁伤伤害倍率」→「毁伤」），再回落到技能标题核心；找不到返回 null。
 * **只匹配既有小类**，不新建小类。
 */
export function resolveBuffAnchorId(subcategories, agentId, segment) {
  const forAgent = (Array.isArray(subcategories) ? subcategories : []).filter(
    (s) => String(s.agentId ?? '') === String(agentId ?? ''),
  )
  const candidates = [
    shortParamLabel(segment?.paramName),
    segment?.titleCore,
    stripSkillTitlePrefix(segment?.displayName),
    segment?.skillName,
    segment?.displayName,
  ]
    .map(normalizeSkillName)
    .filter(Boolean)
  for (const sub of forAgent) {
    const n = normalizeSkillName(sub.name)
    if (candidates.includes(n)) return sub.id
  }
  return null
}

export function sameSkillTypes(a, b) {
  const left = [...(a ?? [])].map(String).sort()
  const right = [...(b ?? [])].map(String).sort()
  if (left.length !== right.length) return false
  return left.every((v, i) => v === right[i])
}

export function sameOptionalNumber(a, b, eps = 1e-6) {
  const left = a == null || a === '' ? null : Number(a)
  const right = b == null || b === '' ? null : Number(b)
  if (left == null && right == null) return true
  if (left == null || right == null) return false
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false
  return Math.abs(left - right) < eps
}

/**
 * 生成一个角色的招式录入计划（**不写库**）。
 *
 * @param {object} params
 * @param {{ id: string, name?: string, element?: string }} params.agent 本地角色
 * @param {Record<string, any>} params.detail nanoka 角色详情原文
 * @param {Array<Record<string, any>>} [params.existingSkills] 本库全部招式（`listSkills()`）
 * @param {Array<Record<string, any>>} [params.subcategories] 本库招式小类（人工按需建的）
 * @param {number} [params.level] 技能等级，默认 12
 * @returns {{ create: object[], overwrite: object[], skipSame: object[], existingManual: object[], unmatchedLocal: object[] }}
 *   - `create`：可直接交给 `upsertSkill` 的完整招式文档
 *   - `overwrite`：只改倍率字段；`doc` 是「保留其余字段」的写库载荷（策略 B：`{...existing, ...multFields}`），
 *     条目本身**不带** `element` / `skillTypes` / `buffAnchorId`，避免手工修正的元素被 nanoka 值冲掉
 *   - `skipSame`：倍率与来源都一致，无需动作
 *   - `existingManual`：命中人工建/手工调过的异常类招式（`multSource ≠ nanoka`）——只提示，不覆盖
 *   - `unmatchedLocal`：本库有、nanoka 没有的招式（只提示，不删）
 */
export function planAgentSkillImport({
  agent,
  detail,
  existingSkills = [],
  subcategories = [],
  level = 12,
} = {}) {
  const agentId = String(agent?.id ?? '').trim()
  if (!agentId) throw new Error('缺少角色 id，无法生成招式录入计划')
  const agentElement = String(agent?.element ?? '').trim()
  const segments = extractDamageSegments(detail, { level })

  const agentSkills = (Array.isArray(existingSkills) ? existingSkills : []).filter(
    (s) => String(s.agentId ?? '') === agentId,
  )

  const create = []
  const overwrite = []
  const skipSame = []
  const existingManual = []
  const matchedIds = new Set()

  const byTypeAndName = new Map()
  const byTypeAndAnchor = new Map()
  for (const skill of agentSkills) {
    const type = String(skill.damageType ?? 'direct')
    const norm = normalizeSkillName(skill.name)
    const nameKey = `${type}|${norm}`
    if (!byTypeAndName.has(nameKey)) byTypeAndName.set(nameKey, skill)
    const anchor = String(skill.buffAnchorId ?? '')
    if (anchor) {
      const anchorKey = `${type}|${anchor}`
      if (!byTypeAndAnchor.has(anchorKey)) byTypeAndAnchor.set(anchorKey, skill)
    }
  }

  for (const seg of segments) {
    const type = seg.damageType ?? 'direct'
    const norm = normalizeSkillName(seg.displayName)
    const resolvedAnchor = resolveBuffAnchorId(subcategories, agentId, seg)
    // 异常类段与直伤同名：先按「类型 + 名字」找，再回落「类型 + 锚点」（人工命名的 ·异放 行）
    let existing = byTypeAndName.get(`${type}|${norm}`)
    if (!existing && type !== 'direct' && resolvedAnchor) {
      existing = byTypeAndAnchor.get(`${type}|${resolvedAnchor}`)
    }
    const buffAnchorId = resolvedAnchor ?? existing?.buffAnchorId ?? null
    const id = existing?.id ?? stableSkillId(agentId, seg.nanokaSkillId, seg.paramName)
    if (existing) matchedIds.add(existing.id)
    const skillTypes = seg.skillTypes
    const multFields = {
      multSource: 'nanoka',
      damagePercentage: seg.damagePercentage,
      damagePercentageGrowth: seg.damagePercentageGrowth,
      baseMult: seg.baseMult,
    }

    if (existing) {
      // 人工建/手工调过的异常类招式不覆盖（如菲欧妮「·异放」的固定值 + 等级转模组合）
      if (type !== 'direct' && String(existing.multSource ?? '') !== 'nanoka') {
        existingManual.push({
          id,
          name: existing.name,
          damageType: type,
          localBaseMult: existing.baseMult,
          importedBaseMult: seg.baseMult,
        })
        continue
      }
      const sameMult = sameOptionalNumber(existing.baseMult, seg.baseMult)
      const samePercentage = sameOptionalNumber(existing.damagePercentage, seg.damagePercentage)
      const sameGrowth = sameOptionalNumber(
        existing.damagePercentageGrowth,
        seg.damagePercentageGrowth,
      )
      const sameSource = String(existing.multSource ?? '') === 'nanoka'
      if (sameMult && samePercentage && sameGrowth && sameSource) {
        skipSame.push({ id, name: existing.name, baseMult: existing.baseMult })
      } else {
        overwrite.push({
          id,
          name: existing.name,
          from: existing.baseMult,
          to: seg.baseMult,
          expect: {
            baseMult: existing.baseMult ?? null,
            damagePercentage: existing.damagePercentage ?? null,
            damagePercentageGrowth: existing.damagePercentageGrowth ?? null,
            multSource: existing.multSource ?? null,
          },
          changed: {
            baseMult: !sameMult,
            damagePercentage: !samePercentage,
            damagePercentageGrowth: !sameGrowth,
            multSource: !sameSource,
          },
          // 策略 B：重导入只更新倍率相关，保留 element / skillTypes / buffAnchorId / note / settlementMult 等
          doc: { ...existing, ...multFields },
        })
      }
    } else {
      const doc = {
        id,
        agentId,
        name: seg.displayName,
        damageType: type,
        skillTypes,
        buffAnchorId,
        baseMult: seg.baseMult,
        baseMultFactor: 100,
        settlementMult: 0,
        multSource: 'nanoka',
        element: agentElement,
        ownerGroupId: null,
        note: '',
        damagePercentage: seg.damagePercentage,
        damagePercentageGrowth: seg.damagePercentageGrowth,
      }
      if (seg.talentKey) doc.radianceTalentKey = seg.talentKey
      create.push(doc)
    }
  }

  const unmatchedLocal = []
  for (const skill of agentSkills) {
    if (matchedIds.has(skill.id)) continue
    unmatchedLocal.push({ id: skill.id, name: skill.name, baseMult: skill.baseMult })
  }

  return { create, overwrite, skipSame, existingManual, unmatchedLocal }
}
