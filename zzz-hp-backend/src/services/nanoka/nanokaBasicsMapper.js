/**
 * nanoka 基础数据映射（**纯函数，不联网、不读库、不写库**）。
 *
 * 本文件把开发目录两份已验证工具里的映射口径**原样搬进仓库**，作为后端唯一参照：
 *   - `tools/nanoka-scan.mjs`（面板 / 音擎数值口径、索引比对、归一化）
 *   - `tools/nanoka-candidates.mjs`（候选条目形状、逐角色常量查表、音擎 id 建议）
 * 数值口径**不许另行发挥**：改动这里的公式前先回去核对那两份工具。
 *
 * 口径：
 *   角色面板(Lv60 满突破) = trunc(stats.<base> + stats.<base>_growth × 59/10000 + level[最后阶段].<base>) + extra_level 累计值
 *   音擎基础攻击(满级)   = floor(base_property.value × (1 + level[满级].rate/10000 + stars[满级].star_rate/10000))
 *   音擎副属性(满级)     = rand_property.value × (1 + stars[满级].rand_rate/10000) / 100   （百分比类，否则 Math.round 取整）
 *
 * 架构约束：**浏览器**负责抓 nanoka 原始 JSON（浏览器走用户系统代理），
 * 本模块只负责「算映射 + 与库 diff」，不做任何 HTTP 请求。
 */

/** 元素中文名归一化表（`风属性 → 风`） */
export const ELEMENT_MAP = {
  电属性: '电',
  冰属性: '冰',
  火属性: '火',
  物理属性: '物理',
  以太属性: '以太',
  风属性: '风',
}

/**
 * nanoka 索引里的数字元素 id → 中文（由缓存夹具里 62 个角色的
 * `character.json[].element` 与详情 `element_type` 逐一对齐归纳）。
 */
export const ELEMENT_ID_LABELS = {
  200: '物理',
  201: '火属性',
  202: '冰属性',
  203: '电属性',
  204: '风属性',
  205: '以太',
  300: '流明',
}

/**
 * nanoka 索引里的数字职业 id → 中文（同上，由 `type` 与详情 `weapon_type` 归纳）。
 */
export const PROFESSION_ID_LABELS = {
  1: '强攻',
  2: '击破',
  3: '异常',
  4: '支援',
  5: '防护',
  6: '命破',
  7: '锋御',
}

/** 元素中文名归一化：`风属性 → 风`（映射表命中则取映射，否则去掉「属性」后缀） */
export function normalizeElement(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  return ELEMENT_MAP[s] ?? s.replace(/属性$/, '')
}

/** 名字归一化：去「」、空格、`·`、`:`、`：` 并转小写（本地 id / 中文名匹配用） */
export function normalizeName(raw) {
  return String(raw ?? '')
    .replace(/[「」\s·:：]/g, '')
    .toLowerCase()
}

// 与开发目录工具同名的短别名，便于对照
export const normElement = normalizeElement
export const normName = normalizeName

/** 数字元素 id → 归一化后的中文元素名（索引里没有该 id 时返回空串） */
export function elementFromId(raw) {
  const label = ELEMENT_ID_LABELS[Number(raw)]
  return label === undefined ? '' : normalizeElement(label)
}

/** 数字职业 id → 中文职业名（索引里没有该 id 时返回空串） */
export function professionFromId(raw) {
  const label = PROFESSION_ID_LABELS[Number(raw)]
  return label === undefined ? '' : label
}

/** 去掉 nanoka 文案里的富文本标签（`<color=#FFFFFF>…</color>` → 纯文本） */
export function stripTags(raw) {
  return String(raw ?? '')
    .replace(/<[^>]*>/g, '')
    .trim()
}

/**
 * extra_level 的 prop → 仓库 stat 键（按中文名 + 单位判定；映射不到的返回 null）。
 * `unsupported: true` 表示中文名认识、但仓库 basePanel 没有对应字段（如冲击力）。
 */
export function propToStat(name, format) {
  const n = String(name ?? '')
  const percent = String(format ?? '').includes('%')
  if (n.includes('基础攻击力')) return { key: 'atk', percent }
  if (n === '攻击力') return percent ? { key: 'atkPercent', percent } : { key: 'atk', percent }
  if (n.includes('生命')) return percent ? { key: 'hpPercent', percent } : { key: 'hp', percent }
  if (n === '防御力') return percent ? { key: 'defPercent', percent } : { key: 'def', percent }
  if (n.includes('暴击率')) return { key: 'critRate', percent }
  if (n.includes('暴击伤害')) return { key: 'critDmg', percent }
  if (n.includes('异常精通')) return { key: 'mastery', percent }
  if (n.includes('异常掌控')) return { key: 'anomalyControl', percent }
  if (n.includes('穿透率')) return { key: 'penRate', percent }
  if (n.includes('能量自动回复') || n.includes('能量回复')) return { key: 'energyRegen', percent }
  if (n.includes('冲击力')) return { key: 'impact', percent, unsupported: true } // 仓库 basePanel 无 impact 字段
  return null
}

/**
 * 角色 Lv60 满突破面板。
 *
 * extra_level 的每个阶段 `extra` 是**累计值**（阶段推进只增不减），所以按 prop 取
 * 「所有阶段里的最大值」，等价于取最后一个阶段的值，**绝不跨阶段求和**。
 *
 * 返回 `{ panel, extras, unmapped }`：
 *   - `panel`：各 stat 的最终值（含 energyRegen，口径见 AGENT_ENERGY_REGEN_NOTE）
 *   - `extras`：命中的 extra prop（`{ value, percent, name, prop, unsupported }`）
 *   - `unmapped`：中文名都没认出来的 prop（原样返回，供界面提示）
 */
export function computeAgentPanel(detail) {
  const s = detail?.stats ?? {}
  const L = 60
  const phases = Object.values(detail?.level ?? {})
  const last = phases.length ? phases[phases.length - 1] : {}
  const growth = (base, g, add) =>
    Math.trunc(Number(base || 0) + (Number(g || 0) * (L - 1)) / 10000 + Number(add || 0))

  // extra_level：每阶段的 extra 是该阶段累计值 → 同 prop 取最大（= 最后阶段的值）
  const extras = {}
  const unmapped = []
  for (const phase of Object.values(detail?.extra_level ?? {})) {
    for (const e of Object.values(phase?.extra ?? {})) {
      const mapped = propToStat(e.name, e.format)
      const value = Number(e.value || 0)
      if (!mapped) {
        unmapped.push({ prop: e.prop, name: e.name, format: e.format, value })
        continue
      }
      // 累计值：取最大（阶段推进只增不减）
      if (!extras[mapped.key] || value > extras[mapped.key].value) {
        extras[mapped.key] = {
          value,
          percent: mapped.percent,
          name: e.name,
          prop: e.prop,
          unsupported: mapped.unsupported,
        }
      }
    }
  }
  const extraVal = (key) => {
    const e = extras[key]
    if (!e) return 0
    return e.percent ? e.value / 100 : e.value
  }
  const panel = {
    hp: growth(s.hp_max, s.hp_growth, last.hp_max) + extraVal('hp'),
    atk: growth(s.attack, s.attack_growth, last.attack) + extraVal('atk'),
    def: growth(s.defence, s.defence_growth, last.defence) + extraVal('def'),
    critRate: Number(s.crit || 0) / 100 + extraVal('critRate'),
    critDmg: Number(s.crit_damage || 0) / 100 + extraVal('critDmg'),
    mastery: Number(s.element_mystery || 0) + extraVal('mastery'),
    anomalyControl: Number(s.element_abnormal_power || 0) + extraVal('anomalyControl'),
    penRate: Number(s.pen_rate || 0) / 100 + extraVal('penRate'),
    energyRegen: 120 + extraVal('energyRegen'),
    sharpenCritDmgBonus: Number(s.sharp_critical_damage || 0) / 100,
  }
  return { panel, extras, unmapped }
}

/**
 * 音擎满级基础属性 / 副属性 / 精炼文案。
 * `indexEntry` 是 weapon.json 里那一条（只用它的 `atk`，留作核对证据）。
 */
export function computeWengineStats(indexEntry, detail) {
  const levels = Object.values(detail?.level ?? {})
  const lastLevel = levels.length ? levels[levels.length - 1] : {}
  const stars = Object.values(detail?.stars ?? {})
  const lastStar = stars.length ? stars[stars.length - 1] : {}
  const rate = Number(lastLevel.rate || 0) / 10000
  const starRate = Number(lastStar.star_rate || 0) / 10000
  const randRate = Number(lastStar.rand_rate || 0) / 10000

  const primary = String(detail?.base_property?.name ?? '')
  const primaryValue = Number(detail?.base_property?.value || 0)
  const primaryMax = Math.floor(primaryValue * (1 + rate + starRate))
  const subRaw = Number(detail?.rand_property?.value || 0)
  const subMax = (subRaw * (1 + randRate)) / 100
  const subName = String(detail?.rand_property?.name2 ?? detail?.rand_property?.name ?? '')
  const subPercent = String(detail?.rand_property?.format ?? '').includes('%')

  // 主属性是「基础防御力」的音擎落到 baseDef、baseAtk 记 0（既有约定）
  const isDefPrimary = primary.includes('防御')
  return {
    primaryName: primary,
    baseAtk: isDefPrimary ? null : primaryMax,
    baseDef: isDefPrimary ? primaryMax : null,
    indexAtk: Number(indexEntry?.atk || 0),
    subStat: {
      name: subName,
      percent: subPercent,
      max: subPercent ? subMax : Math.round(subRaw * (1 + randRate)),
    },
  }
}

/** 音擎副属性中文名 → 仓库 `advancedStats` 键（`null` = 仓库没有该字段） */
export const ADV_MAP = {
  攻击力百分比: 'externalAtkPercent',
  生命值百分比: 'externalHpPercent',
  防御力百分比: 'externalDefPercent',
  暴击率: 'critRate',
  暴击伤害: 'critDmg',
  异常掌控: 'anomalyControlPercent',
  异常精通: 'mastery',
  穿透率: 'penRate',
  能量自动回复: 'energyRegen',
  冲击力: null, // 仓库 advancedStats 无 impact
}

/** 音擎稀有度：nanoka rank → 仓库 rarity（2★→B / 3★→A / 4★→S，未收录按 A） */
export const WENGINE_RARITY = { 2: 'B', 3: 'A', 4: 'S' }

/** 逐角色「游戏常量」按元素查表（2026-10-16 由 60 个现有角色归纳；星见雅是冰系例外） */
export const ELEMENT_CONSTANTS = {
  火: {
    directDmgMult: 100,
    attributeAnomalyMult: 50,
    disorderBaseMult: 450,
    anomalyDuration: 10,
    disorderCompMult: 50,
    turbulenceBaseMult: 900,
    turbulenceCompMult: 50,
    specialMult: 100,
  },
  电: {
    directDmgMult: 100,
    attributeAnomalyMult: 125,
    disorderBaseMult: 450,
    anomalyDuration: 10,
    disorderCompMult: 125,
    turbulenceBaseMult: 650,
    turbulenceCompMult: 125,
    specialMult: 100,
  },
  以太: {
    directDmgMult: 100,
    attributeAnomalyMult: 62.5,
    disorderBaseMult: 450,
    anomalyDuration: 10,
    disorderCompMult: 62.5,
    turbulenceBaseMult: 650,
    turbulenceCompMult: 62.5,
    specialMult: 100,
  },
  冰: {
    directDmgMult: 100,
    attributeAnomalyMult: 500,
    disorderBaseMult: 450,
    anomalyDuration: 10,
    disorderCompMult: 7.5,
    turbulenceBaseMult: 1300,
    turbulenceCompMult: 7.5,
    specialMult: 100,
  },
  物理: {
    directDmgMult: 100,
    attributeAnomalyMult: 713,
    disorderBaseMult: 450,
    anomalyDuration: 10,
    disorderCompMult: 7.5,
    turbulenceBaseMult: 800,
    turbulenceCompMult: 7.5,
    specialMult: 100,
  },
  风: {
    directDmgMult: 100,
    attributeAnomalyMult: 1250,
    disorderBaseMult: 0,
    anomalyDuration: 30,
    disorderCompMult: 0,
    turbulenceBaseMult: 0,
    turbulenceCompMult: 0,
    specialMult: 100,
  },
  流明: {
    directDmgMult: 100,
    attributeAnomalyMult: 0,
    disorderBaseMult: 0,
    anomalyDuration: 10,
    disorderCompMult: 0,
    turbulenceBaseMult: 0,
    turbulenceCompMult: 0,
    specialMult: 100,
  },
}

/** 本地角色 basePanel 里恒为 0 的尾巴字段（照搬工具，避免漏键） */
export const ZERO_TAIL = {
  mutationCoeff: 0,
  radianceMult: 0,
  radianceDmgBonus: 0,
  radianceResPen: 0,
  attributeAnomalyCritRate: 0,
  attributeAnomalyCritDmg: 0,
  attributeAnomalyDmgBonus: 0,
  disorderDmgBonus: 0,
  turbulenceDmgBonus: 0,
  dmgBonus: 0,
  pen: 0,
}

/**
 * energyRegen 口径（2026-10-16 定）：**本地既有角色绝大多数为「120 + extra(能量自动回复)」**
 * （62 个角色里 52 个符合；例外 8 个是人工特值 200/100/20/0）。
 * 因此新角色按 `120 + extra` 写入（例：妮可 120+36=156、11号 120+0=120），
 * 预览里仍会带这条提醒，供管理员核对是否属于那 8 个特值之一。
 * 本字段只是注释，不参与写库。
 */
export const AGENT_ENERGY_REGEN_NOTE =
  '能量自动回复按「120（游戏基准）+ 突破附加」写入；本地 8 个角色是人工特值（200/100/20/0），若该角色属于特值请在录入前改掉'

/**
 * 角色详情 → 候选文档 `newAgents[]` 项（形状与 `nanoka-candidates-*.json` 完全一致）。
 * 未支持的项不在条目里，用 `collectAgentUnsupported(detail)` 单独取。
 */
export function mapAgentDetail({ detail, nanokaId, indexMeta } = {}) {
  if (!detail || typeof detail !== 'object') throw new Error('缺少角色详情 JSON')
  const meta = indexMeta && typeof indexMeta === 'object' ? indexMeta : {}
  const { panel } = computeAgentPanel(detail)
  const element = normalizeElement(Object.values(detail.element_type ?? {})[0])
  const constants = ELEMENT_CONSTANTS[element]
  return {
    id: normalizeName(meta.code),
    nanokaId,
    name: meta.zh ?? detail.name ?? '',
    element,
    profession: String(Object.values(detail.weapon_type ?? {})[0] ?? ''),
    rarity: detail.rarity ?? meta.rank ?? null,
    avatar_image: null,
    avatarNote: '待补：nanoka 角色图标（icon 字段）→ zzz-hp/public/character/<id>.webp',
    idNote:
      'id 由 nanoka code 归一化（去空格/标点、小写）而来；本地既有 id 有 9 例与 code 不同（benbigger/ben、alexandrina/rina、astrayao/astra、s0anby/soldier0-anby、panyinhu/yinhu、sbilly/starlight-billy、remiel/remielle、xigelide/sigrid、Roxy/roxy），录入前请核对',
    basePanel: { ...panel, ...(constants ?? {}), ...ZERO_TAIL },
    constantsSource: constants ? `按元素 ${element} 查表` : '未收录该元素，需人工定',
    energyRegenNote: AGENT_ENERGY_REGEN_NOTE,
    mindscapeNotes: ['', '', '', '', '', '', ''],
    mindscapeBuffs: [],
    mindscapeBuffsNote: '增益（核心被动/额外能力/影画 1-6）属另一条线，未采集',
  }
}

/** 被丢弃的角色 extra 项（如 basePanel 没有的 `impact`），供界面提示 */
export function collectAgentUnsupported(detail) {
  const { extras, unmapped } = computeAgentPanel(detail)
  const out = unmapped.map((u) => ({
    name: u.name,
    prop: u.prop ?? null,
    format: u.format ?? null,
    value: u.value,
    reason: 'basePanel 没有对应字段，未写入',
  }))
  for (const [key, e] of Object.entries(extras)) {
    if (!e.unsupported) continue
    out.push({
      name: e.name,
      prop: e.prop ?? null,
      format: null,
      value: e.value,
      reason: `basePanel 没有 ${key} 字段，未写入`,
    })
  }
  return out
}

/** 音擎 id 建议：英文名（无则中文名）去掉非字母数字后接 `_`（照搬工具的 suggestedId） */
export function suggestWengineId(en, zh) {
  return String(en ?? zh ?? '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

/**
 * 音擎详情 → 候选文档 `newWengines[]` 项（形状与 `nanoka-candidates-*.json` 一致，
 * 另附 `refinementTexts`：精炼 1-5 的纯文本文案）。
 */
export function mapWengineDetail({ detail, nanokaId, indexMeta } = {}) {
  if (!detail || typeof detail !== 'object') throw new Error('缺少音擎详情 JSON')
  const meta = indexMeta && typeof indexMeta === 'object' ? indexMeta : {}
  const stats = computeWengineStats(meta, detail)
  const advKeyRaw = ADV_MAP[stats.subStat.name]
  const advKey = advKeyRaw === undefined || advKeyRaw === null ? null : advKeyRaw
  const zh = meta.zh ?? detail.name ?? ''
  const en = meta.en ?? detail.code_name ?? zh
  const rank = Number(meta.rank ?? detail.rarity ?? 0)
  const refinementTexts = [1, 2, 3, 4, 5].map((level) =>
    stripTags(detail.talents?.[String(level)]?.desc ?? ''),
  )
  return {
    id: suggestWengineId(en, zh),
    idNote:
      '建议用英文名归一化；nanoka 的 code_name（如 Weapon_A_Common_22）也可，二选一（本地两种写法都有，存在重复 id 问题）',
    action: 'insert-new',
    duplicateOfExistingId: null,
    nanokaId,
    name: zh,
    en,
    rarity: WENGINE_RARITY[rank] ?? 'A',
    profession: String(Object.values(detail.weapon_type ?? {})[0] ?? ''),
    baseAtk: stats.baseDef === null ? stats.baseAtk : 0,
    baseDef: stats.baseDef ?? 0,
    primaryName: stats.primaryName,
    primaryNote: String(stats.primaryName ?? '').includes('防御')
      ? '主属性为防御力：nanoka 索引的 atk 字段实为主属性值；该武器的 baseAtk 是否另有数值待确认'
      : null,
    advancedStats: advKey ? { [advKey]: stats.subStat.max } : {},
    subStatNote: advKey
      ? null
      : `副属性「${stats.subStat.name}」在 advancedStats 里没有对应键，需人工定`,
    refinementTexts,
    avatar_image: null,
    avatarNote: '待补：nanoka 武器图标 → zzz-hp/public/wengine/<id>.webp',
    refinementBuffs: [],
    refinementBuffsNote: '精炼 1-5 效果属增益线，未采集（纯文本见 refinementTexts）',
  }
}

/** 被丢弃的音擎副属性项（如 `冲击力` → 仓库 advancedStats 无 impact） */
export function collectWengineUnsupported(detail) {
  const stats = computeWengineStats(null, detail)
  const advKeyRaw = ADV_MAP[stats.subStat.name]
  if (advKeyRaw !== undefined && advKeyRaw !== null) return []
  if (!stats.subStat.name || !stats.subStat.max) return []
  return [
    {
      name: stats.subStat.name,
      prop: null,
      format: null,
      value: stats.subStat.max,
      reason: 'advancedStats 没有对应键，未写入',
    },
  ]
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 用 nanoka 索引（浏览器抓来的 character.json / weapon.json 原文）与本地库比对。
 *
 * 匹配口径与 `tools/nanoka-scan.mjs --index-only` 完全一致：
 *   - 角色：`code` 小写 → 本地 `id`，或归一化中文名 → 本地 `name`（命中任一即算已有）
 *   - 音擎：归一化中文名 → 本地 `name`
 * 纯函数：`agents` / `wengines` 由调用方从库里读好后传进来（便于单测，不连库）。
 */
export function diffNanokaIndexAgainstLocal({ charIndex, weaponIndex, agents, wengines } = {}) {
  if (!isPlainObject(charIndex)) throw new Error('缺少角色索引（character.json）')
  if (!isPlainObject(weaponIndex)) throw new Error('缺少音擎索引（weapon.json）')
  const localAgents = Array.isArray(agents) ? agents : []
  const localWengines = Array.isArray(wengines) ? wengines : []

  // 本地角色索引（id / 中文名两种匹配）
  const agentById = new Map(localAgents.map((a) => [String(a.id).toLowerCase(), a]))
  const agentByZh = new Map(localAgents.map((a) => [normalizeName(a.name), a]))
  // 音擎：按中文名匹配（实测 8/8 命中）
  const wengineByZh = new Map(localWengines.map((w) => [normalizeName(w.name), w]))

  const missingAgents = []
  for (const [nanokaId, meta] of Object.entries(charIndex)) {
    if (!isPlainObject(meta)) continue
    const local =
      agentById.get(normalizeName(meta.code)) ?? agentByZh.get(normalizeName(meta.zh))
    if (local) continue
    // 索引里没有中文元素名，只有数字 id → 查表（详情里才有 element_type 中文）
    const elementRaw = meta.element ?? (Array.isArray(meta.elements) ? meta.elements[0] : null)
    missingAgents.push({
      nanokaId,
      code: meta.code ?? '',
      zh: meta.zh ?? '',
      element: elementFromId(elementRaw),
      profession: professionFromId(meta.type),
      rarity: meta.rank ?? null,
    })
  }

  const missingWengines = []
  for (const [nanokaId, meta] of Object.entries(weaponIndex)) {
    if (!isPlainObject(meta)) continue
    if (wengineByZh.get(normalizeName(meta.zh))) continue
    missingWengines.push({
      nanokaId,
      zh: meta.zh ?? '',
      en: meta.en ?? '',
      rank: meta.rank ?? null,
      atk: meta.atk ?? null,
      sub: meta.sub ?? '',
    })
  }

  // 本地有、nanoka 没有
  const nanokaAgentCodes = new Set(
    Object.values(charIndex)
      .filter(isPlainObject)
      .map((m) => normalizeName(m.code)),
  )
  const nanokaAgentZh = new Set(
    Object.values(charIndex)
      .filter(isPlainObject)
      .map((m) => normalizeName(m.zh)),
  )
  const extraLocalAgents = localAgents
    .filter(
      (a) =>
        !nanokaAgentCodes.has(normalizeName(a.id)) && !nanokaAgentZh.has(normalizeName(a.name)),
    )
    .map((a) => ({ id: a.id, name: a.name }))

  const nanokaWeaponZh = new Set(
    Object.values(weaponIndex)
      .filter(isPlainObject)
      .map((m) => normalizeName(m.zh)),
  )
  const extraLocalWengines = localWengines
    .filter((w) => w.id !== 'none' && !nanokaWeaponZh.has(normalizeName(w.name)))
    .map((w) => ({ id: w.id, name: w.name }))

  return {
    counts: {
      missingAgents: missingAgents.length,
      missingWengines: missingWengines.length,
      extraLocalAgents: extraLocalAgents.length,
      extraLocalWengines: extraLocalWengines.length,
    },
    missingAgents,
    missingWengines,
    extraLocalAgents,
    extraLocalWengines,
  }
}
