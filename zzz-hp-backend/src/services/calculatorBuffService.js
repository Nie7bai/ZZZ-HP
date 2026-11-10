import pool from '../config/db.js'
import { migrateAttributeAnomalyNamingDeep } from '../utils/attributeAnomalyMigration.js'
import {
  BUFF_STAT_KEYS,
  BUFF_MULT_FACTOR_KEYS,
  createEmptyBuffStatModifiers,
  customBuffStatFieldOf,
  isCustomBuffStatKey,
  normalizeCustomBuffStatModifiers,
  normalizeAgentBasePanel,
  normalizeBuffMultFactorDelta,
  normalizeBuffStatModifiers,
  normalizeTwoPieceMods,
  normalizeWengineAdvancedStats,
  readNumber,
} from '../utils/calculatorBuffFields.js'
import {
  effectHasGenericConditions,
  normalizeEffectConditionsForStat,
  normalizeGroupId,
} from '../utils/buffEffectConditions.js'
import { listFollowUpSkillRules, listSkillSubcategories } from './skillSubcategoryService.js'

const WENGINE_TABLE = '`W-Engine`'

const BUFF_SCOPE_VALUES = new Set([
  'general',
  'skill',
  'attributeAnomaly',
  'disorder',
  'turbulence',
  'anomalyRelease',
  'radiance',
  'mutation',
])

/** 作用域（**数组口径**）；顺序与前端 `BUFF_SCOPE_OPTIONS` 一致 */
const BUFF_SCOPE_ORDER = [
  'general',
  'skill',
  'attributeAnomaly',
  'disorder',
  'turbulence',
  'anomalyRelease',
  'radiance',
  'mutation',
]

/**
 * 作用域归一化（**与前端 `zzz-hp/src/utils/buffScope.ts` 同源规则**）：
 * 1. 非法值剔除、去重、按固定顺序输出；
 * 2. 缺省 / null / 空数组 / 全非法 → `['general']`；
 * 3. **含 `general` → 只留 `['general']`**（通用覆盖全部）；
 * 4. `skill` 可与其它成员并存（招式锚点仍需 `skillTargets`）；
 * 5. 读时兼容单值字符串，写时统一数组。
 */
export function normalizeBuffScopes(value) {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value]
  const picked = new Set()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const text = item.trim()
    if (!BUFF_SCOPE_VALUES.has(text)) continue
    if (text === 'general') return ['general']
    picked.add(text)
  }
  if (!picked.size) return ['general']
  return BUFF_SCOPE_ORDER.filter((id) => picked.has(id))
}

/**
 * 旧扁平 mods → fixed effects。
 * 2026-10-20 起 BuffEffect 不再写 `scope`（`scope` 只作读入兼容；词条库另有一套 scope）。
 */
export function flatModsToEffects(mods, applyTarget) {
  const effects = []
  for (const key of BUFF_STAT_KEYS) {
    let value = readNumber(mods?.[key])
    if (BUFF_MULT_FACTOR_KEYS.includes(key)) {
      value = normalizeBuffMultFactorDelta(value)
    }
    if (!value) continue
    effects.push({
      id: `legacy-${applyTarget}-${key}`,
      applyTarget,
      kind: 'fixed',
      stat: key,
      value,
      enabledDefault: true,
    })
  }
  // 自定义乘区增益键：`custom[key]` → `custom:<key>` 效果（与前端 flatModsToEffects 同口径）
  for (const [key, raw] of Object.entries(normalizeCustomBuffStatModifiers(mods?.custom))) {
    if (!raw) continue
    const stat = `custom:${key}`
    if (!isCustomBuffStatKey(stat)) continue
    effects.push({
      id: `legacy-${applyTarget}-${key}`,
      applyTarget,
      kind: 'fixed',
      stat,
      value: raw,
      enabledDefault: true,
    })
  }
  return effects
}

export function effectsToFlatMods(effects, applyTarget) {
  const result = createEmptyBuffStatModifiers()
  for (const effect of effects || []) {
    if (applyTarget && effect.applyTarget !== applyTarget) continue
    // 旧口径：只有「通用」效果进扁平增量表。带伤害类型 / 招式条件的不进。
    if (!effectHasGenericConditions(effect)) continue
    let amount = readNumber(effect.value ?? effect.valuePerStack)
    // 自定义乘区键写 `custom[key]`（百分点加总），内置键仍写强类型字段
    const customField = customBuffStatFieldOf(effect.stat)
    if (customField) {
      if (!amount) continue
      result.custom = result.custom ?? {}
      result.custom[customField] = readNumber(result.custom[customField]) + amount
      continue
    }
    if (!BUFF_STAT_KEYS.includes(effect.stat)) continue
    if (BUFF_MULT_FACTOR_KEYS.includes(effect.stat)) {
      amount = normalizeBuffMultFactorDelta(amount)
    }
    if (!amount) continue
    result[effect.stat] += amount
  }
  return result
}

/** 两袋内置字段逐键相加，`custom` map 按 key 加总（非法键 / 非有限值丢弃） */
function mergeModsBags(left, right) {
  const merged = createEmptyBuffStatModifiers()
  for (const key of BUFF_STAT_KEYS) {
    merged[key] = readNumber(left?.[key]) + readNumber(right?.[key])
  }
  const custom = normalizeCustomBuffStatModifiers(left?.custom)
  for (const [key, value] of Object.entries(normalizeCustomBuffStatModifiers(right?.custom))) {
    custom[key] = readNumber(custom[key]) + value
  }
  if (Object.keys(custom).length) merged.custom = custom
  return merged
}

function normalizeConvert(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const LEGACY = {
    externalHp: { from: 'hp', panelSource: 'external' },
    inCombatHp: { from: 'hp', panelSource: 'final' },
    externalAtk: { from: 'atk', panelSource: 'external' },
    inCombatAtk: { from: 'atk', panelSource: 'final' },
  }
  const ATTRS = [
    'hp',
    'atk',
    'critRate',
    'critDmg',
    'mastery',
    'anomalyControl',
    'energyRegen',
    'penRate',
    'impact',
    'def',
    'pierce',
    'level',
    // 技能等级转模来源（与前端 ConvertFromKey 对齐）
    'skillLevelBasic',
    'skillLevelDodge',
    'skillLevelAssist',
    'skillLevelSpecial',
    'skillLevelChainUltimate',
  ]
  const rawFrom = value.from
  if (typeof rawFrom !== 'string') return undefined
  let from = rawFrom
  let panelSource =
    value.panelSource === 'final'
      ? 'final'
      : value.panelSource === 'manual'
        ? 'manual'
        : 'external'
  if (LEGACY[rawFrom]) {
    from = LEGACY[rawFrom].from
    if (
      value.panelSource !== 'external' &&
      value.panelSource !== 'final' &&
      value.panelSource !== 'manual'
    ) {
      panelSource = LEGACY[rawFrom].panelSource
    }
  } else if (!ATTRS.includes(rawFrom)) {
    return undefined
  }
  return {
    from,
    panelSource,
    ratioPercent: readNumber(value.ratioPercent),
    cap: value.cap == null || value.cap === '' ? null : readNumber(value.cap),
    defaultBase:
      value.defaultBase == null || value.defaultBase === ''
        ? null
        : readNumber(value.defaultBase),
    initialBase:
      value.initialBase == null || value.initialBase === ''
        ? 0
        : readNumber(value.initialBase),
  }
}

export function normalizeEffectList(rawValue) {
  // 旧个人/旧备份效果（属性异常字段旧名、旧子类类型值）在白名单校验前转换（Spec §4.4.3，幂等）。
  const value = Array.isArray(rawValue) ? migrateAttributeAnomalyNamingDeep(rawValue) : rawValue
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const teamProfession =
        item.teamProfession == null || String(item.teamProfession).trim() === ''
          ? null
          : String(item.teamProfession).trim()
      const teamProfessionMinCount =
        !teamProfession ||
        item.teamProfessionMinCount == null ||
        item.teamProfessionMinCount === ''
          ? null
          : Math.min(3, Math.max(1, Math.round(readNumber(item.teamProfessionMinCount) || 1)))
      let teamProfessionValues = null
      if (teamProfession && Array.isArray(item.teamProfessionValues)) {
        teamProfessionValues = [null, null, null]
        for (let i = 0; i < 3; i += 1) {
          const raw = item.teamProfessionValues[i]
          if (raw == null || raw === '') {
            teamProfessionValues[i] = null
            continue
          }
          const n = Number(raw)
          teamProfessionValues[i] = Number.isFinite(n) ? n : null
        }
      }
      // 无有效人数档时：用旧 minCount 迁成恰好 N 人一档；否则保留全空（不生效）
      if (teamProfession) {
        const hasTier =
          Array.isArray(teamProfessionValues) &&
          teamProfessionValues.some((v) => v != null && Number.isFinite(Number(v)))
        if (!hasTier) {
          teamProfessionValues = [null, null, null]
          if (teamProfessionMinCount != null) {
            teamProfessionValues[teamProfessionMinCount - 1] = 0
          }
        }
      }
      const applyProfession =
        item.applyProfession == null || String(item.applyProfession).trim() === ''
          ? null
          : String(item.applyProfession).trim()

      // 乘区定义登记的自定义键原样保留；`custom:` 前缀但格式非法 → 整条丢弃（不静默回落 dmgBonus）
      let stat
      if (typeof item.stat === 'string' && item.stat.startsWith('custom:')) {
        if (!isCustomBuffStatKey(item.stat)) return null
        stat = item.stat
      } else {
        stat = BUFF_STAT_KEYS.includes(item.stat) ? item.stat : 'dmgBonus'
      }
      const effect = {
        id: typeof item.id === 'string' && item.id ? item.id : `eff-${index}`,
        origin: typeof item.origin === 'string' ? item.origin : '',
        applyTarget: item.applyTarget === 'team' ? 'team' : 'self',
        applySituation:
          item.applySituation === 'stagger' || item.applySituation === 'non_stagger'
            ? item.applySituation
            : 'global',
        applyProfession,
        teamProfession,
        teamProfessionValues,
        teamProfessionMinCount,
        skillCategory: item.skillCategory || undefined,
        skillSubcategoryId: item.skillSubcategoryId ?? null,
        skillTargets: Array.isArray(item.skillTargets)
          ? item.skillTargets
              .filter((t) => t && typeof t === 'object')
              .map((t) => ({
                category: t.category || 'basic',
                subcategoryId: t.subcategoryId ?? null,
              }))
          : undefined,
        elementFilter: item.elementFilter ?? 'all',
        kind:
          item.kind === 'stacked' || item.kind === 'convert' ? item.kind : 'fixed',
        stat,
        value: readNumber(item.value),
        stackable: Boolean(item.stackable),
        maxStacks: Math.max(1, readNumber(item.maxStacks) || 1),
        valuePerStack: readNumber(item.valuePerStack),
        defaultStacks: (() => {
          if (item.defaultStacks == null || item.defaultStacks === '') return 1
          const n = Number(item.defaultStacks)
          if (!Number.isFinite(n)) return 1
          return Math.max(0, n)
        })(),

        convert: normalizeConvert(item.convert),
        enabledDefault: item.enabledDefault === false ? false : true,
        note: typeof item.note === 'string' ? item.note : '',
      }
      // 同源行分组键：只在管理侧用于聚合，引擎不读；空值不落库。
      const groupId = normalizeGroupId(item.groupId)
      if (groupId) effect.groupId = groupId
      // 伤害类型条件：新字段优先，旧 scope 兼容读入；15 个子类 stat 不写冗余条件。
      const conditions = normalizeEffectConditionsForStat(item.conditions, item.scope, stat)
      if (conditions) effect.conditions = conditions
      if (BUFF_MULT_FACTOR_KEYS.includes(effect.stat)) {
        effect.value = normalizeBuffMultFactorDelta(effect.value)
        effect.valuePerStack = normalizeBuffMultFactorDelta(effect.valuePerStack)
        // 转模（convert）的数值在运行时由来源属性折算，value 本就为 0，
        // 不能按脏条目丢弃（否则会删掉蕾米埃尔「精通 → 耀变倍率修正」等核心被动）
        if (
          effect.kind !== 'convert' &&
          Math.abs(effect.value) < 1e-12 &&
          (effect.kind !== 'stacked' || Math.abs(effect.valuePerStack) < 1e-12)
        ) {
          return null
        }
      }
      return effect
    })
    .filter(Boolean)
}

export function normalizeSelfTeamBuffs(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (Array.isArray(value.effectBlocks) && value.effectBlocks.length > 0) {
      const effectBlocks = value.effectBlocks
        .filter((item) => item && typeof item === 'object')
        .map((item, index) => ({
          id: typeof item.id === 'string' && item.id ? item.id : `blk-${index}`,
          name: typeof item.name === 'string' && item.name ? item.name : `效果块 ${index + 1}`,
          note: typeof item.note === 'string' ? item.note : '',
          effects: normalizeEffectList(item.effects),
          enabledDefault: item.enabledDefault === false ? false : true,
        }))
      const effects = effectBlocks.flatMap((block) => block.effects)
      return {
        effectBlocks,
        effects,
        selfMods: effectsToFlatMods(effects, 'self'),
        teamMods: effectsToFlatMods(effects, 'team'),
      }
    }
    if (Array.isArray(value.effects) && value.effects.length > 0) {
      const effects = normalizeEffectList(value.effects)
      return {
        effectBlocks: [
          {
            id: 'blk-legacy',
            name: '效果块 1',
            note: '',
            effects,
            enabledDefault: true,
          },
        ],
        effects,
        selfMods: effectsToFlatMods(effects, 'self'),
        teamMods: effectsToFlatMods(effects, 'team'),
      }
    }
    const selfMods = normalizeBuffStatModifiers(value.selfMods)
    const teamMods = normalizeBuffStatModifiers(value.teamMods)
    const effects = [
      ...flatModsToEffects(selfMods, 'self'),
      ...flatModsToEffects(teamMods, 'team'),
    ]
    return {
      effectBlocks: effects.length
        ? [
            {
              id: 'blk-legacy',
              name: '效果块 1',
              note: '',
              effects,
              enabledDefault: true,
            },
          ]
        : [],
      effects,
      selfMods,
      teamMods,
    }
  }
  return {
    effectBlocks: [],
    effects: [],
    selfMods: createEmptyBuffStatModifiers(),
    teamMods: createEmptyBuffStatModifiers(),
  }
}

/**
 * 音擎精炼能量回复统一为百分比语义（1.2 填 120）。
 * 载入时把旧 energyRegenFlat 迁回 energyRegen。
 */
function normalizeWengineRefinementBuffs(value) {
  const pack = normalizeSelfTeamBuffs(value)
  const migrateEffect = (effect) => {
    if (effect.stat !== 'energyRegenFlat') return effect
    const raw = readNumber(effect.value ?? effect.valuePerStack)
    const asPercent = raw !== 0 && Math.abs(raw) < 10 ? raw * 100 : raw
    return {
      ...effect,
      stat: 'energyRegen',
      value: effect.kind === 'stacked' ? effect.value : asPercent,
      valuePerStack:
        effect.kind === 'stacked' || effect.stackable ? asPercent : effect.valuePerStack,
    }
  }
  const effectBlocks = (pack.effectBlocks ?? []).map((block) => ({
    ...block,
    effects: (block.effects ?? []).map(migrateEffect),
  }))
  const effects = effectBlocks.length
    ? effectBlocks.flatMap((block) => block.effects)
    : (pack.effects ?? []).map(migrateEffect)
  return {
    effectBlocks,
    effects,
    selfMods: effectsToFlatMods(effects, 'self'),
    teamMods: effectsToFlatMods(effects, 'team'),
  }
}

/* =====================================================================
 * 保存并发保护（乐观锁）
 * ---------------------------------------------------------------------
 * 事故（2026-10-18）：管理端「角色增益」面板打开时把角色整份装进表单，保存时提交
 * 整份 7 档 `mindscapeBuffs`。面板打开期间库里若被别的东西改过（批量导入脚本、
 * AI 用 SQL 落库），保存就会拿旧副本整份覆盖，悄悄丢掉别人的改动
 * —— 菲欧妮因此丢了一整天的四批数据（核心被动 18 条效果被写回 6 条、转模参数回退）。
 *
 * 规则：客户端保存时带上「加载该行时拿到的 updated_at」（`baseUpdatedAt`）；
 * 服务端在写库前重新读一次该行的 updated_at，与原值不一致就抛 `STALE_WRITE`，
 * 一律不写库，由控制器回 409 让前端提示刷新。
 * ===================================================================== */

/** 表名白名单形态：`character` / `W-Engine` 这类（本函数只由服务内部调用，仍做一次防御） */
const SAFE_TABLE_PATTERN = /^`?[A-Za-z0-9_-]+`?$/

function runPoolQuery(sql, params) {
  return pool.query(sql, params)
}

/**
 * 把各种来源的时间统一成 **ISO/UTC、秒级** 字符串（形如 `2026-10-18T15:22:09.000Z`）。
 *
 * - 库侧：mysql2 把 TIMESTAMP 读成 Date（已按会话时区换回真实瞬时），直接 toISOString 即可，
 *   与本机 UNIX_TIMESTAMP 验证过一致（本机 MySQL `@@session.time_zone = SYSTEM` = +08:00）；
 * - 客户端侧：回传的是本函数上一次发出去的 ISO 字符串；
 * - 兜底字符串（如 `2026-10-18 15:22:09`）：交给 Date 解析，无时区后缀时按本机时区，
 *   与 MySQL 会话时区（SYSTEM）口径一致，不会凭空偏移。
 *
 * 精度压到秒：列是 `TIMESTAMP`（无小数秒），比较时不能被毫秒残差绊倒。
 */
export function normalizeUpdatedAt(value) {
  if (value == null || value === '') return null
  let ms
  if (value instanceof Date) {
    ms = value.getTime()
  } else if (typeof value === 'number') {
    ms = value
  } else if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return null
    ms = new Date(text).getTime()
  } else {
    return null
  }
  if (!Number.isFinite(ms)) return null
  return new Date(Math.floor(ms / 1000) * 1000).toISOString()
}

/**
 * 乐观锁校验（**可复用**）：库里该行的 updated_at 与加载时拿到的值不一致即抛 STALE_WRITE。
 *
 * - `baseUpdatedAt` 为空（老客户端 / 新建）→ 不校验，行为与加保护之前完全一致；
 * - 该行不存在 → 视为新建，不校验；
 * - 本次只接到 `upsertAgent`；音擎(`W-Engine`)/邦布/驱动盘/招式这些对象后续可直接复用本函数。
 *
 * @param {string} tableSql 已加反引号的表名，如 '`character`'
 * @param {string} id 主键值
 * @param {string | undefined} baseUpdatedAt 加载该行时拿到的 updated_at（ISO 字符串）
 * @param {(sql: string, params: unknown[]) => Promise<unknown>} [runQuery] 查询执行器（测试注入用）
 * @returns {Promise<{ currentUpdatedAt: string } | null>} 校验通过时返回库里的当前值（可能为 null）
 */
export async function assertNotStale(tableSql, id, baseUpdatedAt, runQuery = runPoolQuery) {
  if (!SAFE_TABLE_PATTERN.test(tableSql)) {
    throw new Error(`assertNotStale: 非法表名 ${tableSql}`)
  }
  const base = normalizeUpdatedAt(baseUpdatedAt)
  if (!base) return null
  const [[row]] = await runQuery(`SELECT updated_at FROM ${tableSql} WHERE id = ?`, [id])
  if (!row) return null
  const currentUpdatedAt = normalizeUpdatedAt(row.updated_at ?? row.updatedAt)
  if (!currentUpdatedAt || currentUpdatedAt === base) {
    return currentUpdatedAt ? { currentUpdatedAt } : null
  }
  throw Object.assign(new Error('数据已被其它操作更新'), {
    code: 'STALE_WRITE',
    currentUpdatedAt,
  })
}

function parseJson(value, fallback) {
  if (value == null) return fallback
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return fallback
    }
  }
  return fallback
}

/**
 * 空 avatar 保存时保留库里已有路径，避免管理端未选文件就把头像冲掉。
 * 仅当 clearAvatar === true 时允许写成 null。
 */
async function resolveAvatarImageForUpsert(tableSql, id, incoming, clearAvatar) {
  if (clearAvatar === true) return null
  const trimmed = typeof incoming === 'string' ? incoming.trim() : ''
  if (trimmed) return trimmed
  const [[row]] = await pool.query(`SELECT avatar_image FROM ${tableSql} WHERE id = ?`, [id])
  return row?.avatar_image ?? null
}

function rowToAgent(row) {
  const raw = parseJson(row.raw_json, {})
  const mindscapeBuffsRaw = parseJson(row.mindscape_buffs, raw.mindscapeBuffs)
  return {
    ...raw,
    id: row.id,
    name: row.name,
    // 乐观锁基准：读取侧必须带出去，否则前端保存时没有可比对的 updated_at
    updatedAt: normalizeUpdatedAt(row.updated_at) ?? undefined,
    profession: row.profession ?? '',
    element: row.element ?? '',
    supportNeeds: parseJson(row.support_needs, raw.supportNeeds ?? []),
    avatar_image: row.avatar_image ?? raw.avatar_image ?? null,
    note: row.note ?? raw.note ?? '',
    basePanel: normalizeAgentBasePanel(parseJson(row.base_panel, raw.basePanel)),
    mindscapeNotes: parseJson(
      row.mindscape_notes,
      normalizeMindscapeNotesArray(raw.mindscapeNotes),
    ),
    mindscapeBuffs: [0, 1, 2, 3, 4, 5, 6].map((index) =>
      normalizeSelfTeamBuffs(
        Array.isArray(mindscapeBuffsRaw) ? mindscapeBuffsRaw[index] ?? {} : {},
      ),
    ),
  }
}

function normalizeMindscapeNotesArray(value) {
  if (!Array.isArray(value)) return ['', '', '', '', '', '', '']
  return [0, 1, 2, 3, 4, 5, 6].map((index) =>
    typeof value[index] === 'string' ? value[index] : '',
  )
}

function rowToBangboo(row) {
  const raw = parseJson(row.raw_json, {})
  const effectBlocks = Array.isArray(raw.effectBlocks)
    ? raw.effectBlocks
        .filter((item) => item && typeof item === 'object')
        .map((item, index) => ({
          id: typeof item.id === 'string' && item.id ? item.id : `blk-${index}`,
          name:
            typeof item.name === 'string' && item.name
              ? item.name
              : `效果块 ${index + 1}`,
          note: typeof item.note === 'string' ? item.note : '',
          effects: normalizeEffectList(item.effects),
          enabledDefault: item.enabledDefault === false ? false : true,
        }))
    : []

  let effects = effectBlocks.length
    ? effectBlocks.flatMap((block) => block.effects)
    : normalizeEffectList(raw.effects ?? raw.fixedEffects ?? null)

  const refinementEffectBlocks = Array.isArray(raw.refinementEffectBlocks)
    ? raw.refinementEffectBlocks.map((blocks, rankIndex) =>
        Array.isArray(blocks)
          ? blocks
              .filter((item) => item && typeof item === 'object')
              .map((item, index) => ({
                id: typeof item.id === 'string' && item.id ? item.id : `blk-r${rankIndex}-${index}`,
                name:
                  typeof item.name === 'string' && item.name
                    ? item.name
                    : index === 0
                      ? `精${rankIndex + 1}`
                      : `效果块 ${index + 1}`,
                note: typeof item.note === 'string' ? item.note : '',
                effects: normalizeEffectList(item.effects),
                enabledDefault: item.enabledDefault === false ? false : true,
              }))
          : [],
      )
    : null

  const refinementEffects = refinementEffectBlocks
    ? refinementEffectBlocks.map((blocks) => blocks.flatMap((block) => block.effects))
    : Array.isArray(raw.refinementEffects)
      ? raw.refinementEffects.map((list) => normalizeEffectList(list))
      : null

  let fixedMods = normalizeBuffStatModifiers(
    parseJson(row.fixed_mods, raw.fixedMods ?? {}),
  )
  let refinementMods = Array.isArray(parseJson(row.refinement_mods, raw.refinementMods))
    ? parseJson(row.refinement_mods, raw.refinementMods).map((item) =>
        normalizeBuffStatModifiers(item),
      )
    : []

  if (effects.length) {
    fixedMods = mergeModsBags(
      effectsToFlatMods(effects, 'team'),
      effectsToFlatMods(effects, 'self'),
    )
  } else if (Object.values(fixedMods).some((v) => v)) {
    effects.push(...flatModsToEffects(fixedMods, 'team'))
  }

  if (refinementEffects) {
    refinementMods = refinementEffects.map((list) => {
      return mergeModsBags(
        effectsToFlatMods(list, 'team'),
        effectsToFlatMods(list, 'self'),
      )
    })
  }

  return {
    id: row.id,
    name: row.name,
    avatar_image: row.avatar_image ?? null,
    effectBlocks,
    effects,
    refinementEffectBlocks: refinementEffectBlocks ?? undefined,
    refinementEffects:
      refinementEffects ??
      refinementMods.map((mods) => flatModsToEffects(mods, 'team')),
    fixedMods,
    refinementMods,
  }
}

function normalizeEffectBlocks(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      id: typeof item.id === 'string' && item.id ? item.id : `blk-${index}`,
      name:
        typeof item.name === 'string' && item.name
          ? item.name
          : `效果块 ${index + 1}`,
      note: typeof item.note === 'string' ? item.note : '',
      effects: normalizeEffectList(item.effects),
      enabledDefault: item.enabledDefault === false ? false : true,
    }))
}

function rowToDriveDisc(row) {
  const raw = parseJson(row.raw_json, {})
  const fourPieceBuffs = normalizeSelfTeamBuffs(
    parseJson(row.four_piece_buffs, raw.fourPieceBuffs ?? {}),
  )
  const twoPieceEffectBlocks = normalizeEffectBlocks(raw.twoPieceEffectBlocks)
  let twoPieceEffects = twoPieceEffectBlocks.length
    ? twoPieceEffectBlocks.flatMap((block) => block.effects)
    : normalizeEffectList(raw.twoPieceEffects)
  let twoPieceMods = normalizeTwoPieceMods(
    parseJson(row.two_piece_mods, raw.twoPieceMods ?? {}),
  )
  if (twoPieceEffects.length) {
    twoPieceMods = normalizeTwoPieceMods(
      mergeModsBags(
        effectsToFlatMods(twoPieceEffects, 'team'),
        effectsToFlatMods(twoPieceEffects, 'self'),
      ),
    )
  } else if (Object.values(twoPieceMods).some((v) => v)) {
    twoPieceEffects = flatModsToEffects(twoPieceMods, 'self')
  }

  return {
    id: row.id,
    name: row.name,
    avatar_image: row.avatar_image ?? null,
    twoPieceNote: row.two_piece_note ?? raw.twoPieceNote ?? '',
    fourPieceNote: row.four_piece_note ?? raw.fourPieceNote ?? '',
    twoPieceEffectBlocks: twoPieceEffectBlocks.length
      ? twoPieceEffectBlocks
      : undefined,
    twoPieceEffects,
    twoPieceMods,
    fourPieceBuffs,
  }
}

function rowToWengine(row) {
  const raw = parseJson(row.raw_json, {})
  const refinementRaw = parseJson(row.refinement_buffs, raw.refinementBuffs)
  return {
    id: row.id,
    name: row.name,
    profession: row.profession ?? '',
    rarity: row.rarity ?? 'A',
    avatar_image: row.avatar_image ?? null,
    note: row.note ?? raw.note ?? '',
    baseAtk: readNumber(row.base_atk ?? raw.baseAtk),
    baseDef: readNumber(row.base_def ?? raw.baseDef),
    advancedStats: normalizeWengineAdvancedStats(
      parseJson(row.advanced_stats, raw.advancedStats),
    ),
    fixedBuffs: normalizeSelfTeamBuffs(parseJson(row.fixed_buffs, raw.fixedBuffs ?? {})),
    refinementBuffs: [0, 1, 2, 3, 4].map((index) =>
      normalizeWengineRefinementBuffs(
        Array.isArray(refinementRaw) ? refinementRaw[index] ?? {} : {},
      ),
    ),
  }
}

function toJson(value) {
  return JSON.stringify(value ?? null)
}

export async function listCalculatorBuffs() {
  const [agents] = await pool.query(
    'SELECT * FROM `character` ORDER BY name ASC, id ASC',
  )
  const [bangboos] = await pool.query('SELECT * FROM `bangboo` ORDER BY name ASC, id ASC')
  const [driveDiscs] = await pool.query(
    'SELECT * FROM `drive_disc` ORDER BY name ASC, id ASC',
  )
  const [wengines] = await pool.query(
    `SELECT * FROM ${WENGINE_TABLE} ORDER BY name ASC, id ASC`,
  )
  const skillSubcategories = await listSkillSubcategories()
  const followUpSkillRules = await listFollowUpSkillRules()

  return {
    agents: agents.map(rowToAgent),
    bangboos: bangboos.map(rowToBangboo),
    driveDiscs: driveDiscs.map(rowToDriveDisc),
    wengines: wengines.map(rowToWengine),
    skillSubcategories,
    followUpSkillRules,
  }
}

export async function upsertAgent(doc) {
  const id = String(doc.id ?? '').trim()
  const name = String(doc.name ?? '').trim()
  if (!id || !name) {
    throw new Error('角色 ID 与名称为必填项')
  }

  // 乐观锁：客户端带了「加载时拿到的 updated_at」就先校验，库里的行已经变了就直接抛 STALE_WRITE，
  // 一个字节都不写（管理端整份 mindscapeBuffs 覆盖就是这样悄悄吃掉别人改动的）。
  const baseUpdatedAt = typeof doc.baseUpdatedAt === 'string' ? doc.baseUpdatedAt : ''
  await assertNotStale('`character`', id, baseUpdatedAt)

  const avatar_image = await resolveAvatarImageForUpsert(
    '`character`',
    id,
    doc.avatar_image,
    doc.clearAvatar,
  )

  const payload = {
    id,
    name,
    profession: String(doc.profession ?? ''),
    element: String(doc.element ?? ''),
    supportNeeds: Array.isArray(doc.supportNeeds) ? doc.supportNeeds : [],
    avatar_image,
    note: typeof doc.note === 'string' ? doc.note : '',
    basePanel: normalizeAgentBasePanel(doc.basePanel),
    mindscapeNotes: normalizeMindscapeNotesArray(doc.mindscapeNotes),
    mindscapeBuffs: Array.isArray(doc.mindscapeBuffs)
      ? [0, 1, 2, 3, 4, 5, 6].map((index) =>
          normalizeSelfTeamBuffs(doc.mindscapeBuffs[index] ?? {}),
        )
      : [0, 1, 2, 3, 4, 5, 6].map(() => normalizeSelfTeamBuffs({})),
  }

  await pool.execute(
    `INSERT INTO \`character\`
      (id, name, profession, element, support_needs, avatar_image, note, base_panel, mindscape_notes, mindscape_buffs, raw_json)
     VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       profession = VALUES(profession),
       element = VALUES(element),
       support_needs = VALUES(support_needs),
       avatar_image = VALUES(avatar_image),
       note = VALUES(note),
       base_panel = VALUES(base_panel),
       mindscape_notes = VALUES(mindscape_notes),
       mindscape_buffs = VALUES(mindscape_buffs),
       raw_json = VALUES(raw_json)`,
    [
      payload.id,
      payload.name,
      payload.profession,
      payload.element,
      toJson(payload.supportNeeds),
      payload.avatar_image,
      payload.note,
      toJson(payload.basePanel),
      toJson(payload.mindscapeNotes),
      toJson(payload.mindscapeBuffs),
      toJson(payload),
    ],
  )

  // 保存后回读整行：rowToAgent 会带上最新的 updatedAt（前端拿它作为下一次保存的基准）
  const [[row]] = await pool.query('SELECT * FROM `character` WHERE id = ?', [id])
  return rowToAgent(row)
}

export async function deleteAgent(id) {
  const [result] = await pool.execute('DELETE FROM `character` WHERE id = ?', [id])
  if (result.affectedRows === 0) {
    throw new Error('角色不存在')
  }
  return { id }
}

export async function upsertBangboo(doc) {
  const id = String(doc.id ?? '').trim()
  const name = String(doc.name ?? '').trim()
  if (!id || !name) {
    throw new Error('邦布 ID 与名称为必填项')
  }

  const avatar_image = await resolveAvatarImageForUpsert(
    '`bangboo`',
    id,
    doc.avatar_image,
    doc.clearAvatar,
  )

  const payload = {
    id,
    name,
    avatar_image,
    effectBlocks: normalizeEffectBlocks(doc.effectBlocks),
    effects: normalizeEffectList(doc.effects),
    refinementEffectBlocks: Array.isArray(doc.refinementEffectBlocks)
      ? [0, 1, 2, 3, 4].map((index) =>
          normalizeEffectBlocks(doc.refinementEffectBlocks[index] ?? []),
        )
      : [],
    refinementEffects: Array.isArray(doc.refinementEffects)
      ? doc.refinementEffects.map((list) => normalizeEffectList(list))
      : [],
    fixedMods: normalizeBuffStatModifiers(doc.fixedMods ?? {}),
    refinementMods: Array.isArray(doc.refinementMods) ? doc.refinementMods : [],
  }
  if (payload.effectBlocks.length) {
    payload.effects = payload.effectBlocks.flatMap((block) =>
      normalizeEffectList(block?.effects),
    )
  }
  if (payload.refinementEffectBlocks.length) {
    payload.refinementEffects = payload.refinementEffectBlocks.map((blocks) =>
      Array.isArray(blocks)
        ? blocks.flatMap((block) => normalizeEffectList(block?.effects))
        : [],
    )
  }
  if (payload.effects.length) {
    payload.fixedMods = mergeModsBags(
      effectsToFlatMods(payload.effects, 'team'),
      effectsToFlatMods(payload.effects, 'self'),
    )
  }
  if (payload.refinementEffects.length) {
    payload.refinementMods = payload.refinementEffects.map((list) => {
      return mergeModsBags(
        effectsToFlatMods(list, 'team'),
        effectsToFlatMods(list, 'self'),
      )
    })
  }

  await pool.execute(
    `INSERT INTO \`bangboo\`
      (id, name, avatar_image, fixed_mods, refinement_mods, raw_json)
     VALUES (?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       avatar_image = VALUES(avatar_image),
       fixed_mods = VALUES(fixed_mods),
       refinement_mods = VALUES(refinement_mods),
       raw_json = VALUES(raw_json)`,
    [
      payload.id,
      payload.name,
      payload.avatar_image,
      toJson(payload.fixedMods),
      toJson(payload.refinementMods),
      toJson(payload),
    ],
  )

  const [[row]] = await pool.query('SELECT * FROM `bangboo` WHERE id = ?', [id])
  return rowToBangboo(row)
}

export async function deleteBangboo(id) {
  const [result] = await pool.execute('DELETE FROM `bangboo` WHERE id = ?', [id])
  if (result.affectedRows === 0) {
    throw new Error('邦布不存在')
  }
  return { id }
}

export async function upsertDriveDisc(doc) {
  const id = String(doc.id ?? '').trim()
  const name = String(doc.name ?? '').trim()
  if (!id || !name) {
    throw new Error('驱动盘 ID 与名称为必填项')
  }

  const fourPieceBuffs = normalizeSelfTeamBuffs(doc.fourPieceBuffs ?? {})
  const twoPieceEffectBlocks = normalizeEffectBlocks(doc.twoPieceEffectBlocks)
  let twoPieceEffects = twoPieceEffectBlocks.length
    ? twoPieceEffectBlocks.flatMap((block) => block.effects)
    : normalizeEffectList(doc.twoPieceEffects)
  let twoPieceMods = normalizeTwoPieceMods(doc.twoPieceMods ?? {})
  if (twoPieceEffects.length) {
    twoPieceMods = normalizeTwoPieceMods(
      mergeModsBags(
        effectsToFlatMods(twoPieceEffects, 'team'),
        effectsToFlatMods(twoPieceEffects, 'self'),
      ),
    )
  }

  const avatar_image = await resolveAvatarImageForUpsert(
    '`drive_disc`',
    id,
    doc.avatar_image,
    doc.clearAvatar,
  )

  const payload = {
    id,
    name,
    avatar_image,
    twoPieceNote: typeof doc.twoPieceNote === 'string' ? doc.twoPieceNote : '',
    fourPieceNote: typeof doc.fourPieceNote === 'string' ? doc.fourPieceNote : '',
    twoPieceEffectBlocks: twoPieceEffectBlocks.length
      ? twoPieceEffectBlocks
      : undefined,
    twoPieceEffects,
    twoPieceMods,
    fourPieceBuffs,
  }

  await pool.execute(
    `INSERT INTO \`drive_disc\`
      (id, name, avatar_image, two_piece_note, four_piece_note, two_piece_mods, four_piece_buffs, raw_json)
     VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       avatar_image = VALUES(avatar_image),
       two_piece_note = VALUES(two_piece_note),
       four_piece_note = VALUES(four_piece_note),
       two_piece_mods = VALUES(two_piece_mods),
       four_piece_buffs = VALUES(four_piece_buffs),
       raw_json = VALUES(raw_json)`,
    [
      payload.id,
      payload.name,
      payload.avatar_image,
      payload.twoPieceNote,
      payload.fourPieceNote,
      toJson(payload.twoPieceMods),
      toJson(payload.fourPieceBuffs),
      toJson(payload),
    ],
  )

  const [[row]] = await pool.query('SELECT * FROM `drive_disc` WHERE id = ?', [id])
  return rowToDriveDisc(row)
}

export async function deleteDriveDisc(id) {
  const [result] = await pool.execute('DELETE FROM `drive_disc` WHERE id = ?', [id])
  if (result.affectedRows === 0) {
    throw new Error('驱动盘不存在')
  }
  return { id }
}

export async function upsertWengine(doc) {
  const id = String(doc.id ?? '').trim()
  const name = String(doc.name ?? '').trim()
  if (!id || !name) {
    throw new Error('音擎 ID 与名称为必填项')
  }

  const avatar_image = await resolveAvatarImageForUpsert(
    WENGINE_TABLE,
    id,
    doc.avatar_image,
    doc.clearAvatar,
  )

  const payload = {
    id,
    name,
    profession: String(doc.profession ?? ''),
    rarity: String(doc.rarity ?? 'A'),
    avatar_image,
    note: typeof doc.note === 'string' ? doc.note : '',
    baseAtk: readNumber(doc.baseAtk),
    baseDef: readNumber(doc.baseDef),
    advancedStats: normalizeWengineAdvancedStats(doc.advancedStats),
    fixedBuffs: normalizeSelfTeamBuffs(doc.fixedBuffs ?? {}),
    refinementBuffs: Array.isArray(doc.refinementBuffs)
      ? [0, 1, 2, 3, 4].map((index) =>
          normalizeWengineRefinementBuffs(doc.refinementBuffs[index] ?? {}),
        )
      : [0, 1, 2, 3, 4].map(() => normalizeWengineRefinementBuffs({})),
  }

  await pool.execute(
    `INSERT INTO ${WENGINE_TABLE}
      (id, name, profession, rarity, avatar_image, note, base_atk, base_def, advanced_stats, fixed_buffs, refinement_buffs, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       profession = VALUES(profession),
       rarity = VALUES(rarity),
       avatar_image = VALUES(avatar_image),
       note = VALUES(note),
       base_atk = VALUES(base_atk),
       base_def = VALUES(base_def),
       advanced_stats = VALUES(advanced_stats),
       fixed_buffs = VALUES(fixed_buffs),
       refinement_buffs = VALUES(refinement_buffs),
       raw_json = VALUES(raw_json)`,
    [
      payload.id,
      payload.name,
      payload.profession,
      payload.rarity,
      payload.avatar_image,
      payload.note,
      payload.baseAtk,
      payload.baseDef,
      toJson(payload.advancedStats),
      toJson(payload.fixedBuffs),
      toJson(payload.refinementBuffs),
      toJson(payload),
    ],
  )

  const [[row]] = await pool.query(`SELECT * FROM ${WENGINE_TABLE} WHERE id = ?`, [id])
  return rowToWengine(row)
}

export async function deleteWengine(id) {
  const [result] = await pool.execute(`DELETE FROM ${WENGINE_TABLE} WHERE id = ?`, [id])
  if (result.affectedRows === 0) {
    throw new Error('音擎不存在')
  }
  return { id }
}
