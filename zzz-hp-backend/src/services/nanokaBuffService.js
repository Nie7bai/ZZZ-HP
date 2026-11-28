/**
 * nanoka 增益入库服务：**抽取（extract）/ 智能解析（parse）/ 写入（apply）**。
 *
 * 规格：`dev-docs/nanoka-buff-extract-spec-v2-2026-10-16.md`（v2 + 文末「v3 变更」）。
 *
 * 三条硬边界（用户口径）：
 *   1. **服务端不联网**：nanoka 详情一律由浏览器抓，经 `/extract` 传进来。
 *   2. **不写库的函数都是纯函数**：`planBuffApply` / `smartMergeParse` / `sanitizeEffect`…
 *      只吃普通对象、只吐计划；验证这些**不需要数据库**（`dryRun` 也只算不写）。
 *   3. 写库**只走既有唯一路径**：`upsertAgent` / `upsertWengine` / `upsertSkill`；
 *      读库沿用角色增益与招式库服务。
 *
 * v3 写入槽规则（**按来源判断 + 只按下标定位，绝不按块名匹配**）：
 *
 * | 来源 | 槽位 |
 * |---|---|
 * | `passive.core` / `passive.extra` / 招式文本 | `mindscapeBuffs[0]`（**复用该槽位已有的块**，没有块才新建） |
 * | `talent.i` | `mindscapeBuffs[i]`（影画 i） |
 * | `weapons.talents[j]`（j≥1） | `refinementBuffs[j-1]`（精炼 j） |
 * | 招式文本的「描述」 | 该技能行（`calculator_skills.note`）**追加**原文 + `[关键字]` 行 |
 *
 * 槽位内多条**按解析顺序追加**；每条增益在界面上标 `写入：<块位> · 新增/替换`
 * （计划里就是 `details[].effects[].writeLabel`）。
 */
import { BUFF_STAT_KEYS, isCustomBuffStatKey } from '../utils/calculatorBuffFields.js'
import {
  normalizeEffectApplyTarget,
  normalizeEffectConditionsForStat,
  normalizeGroupId,
  normalizeTeammateProfessions,
} from '../utils/buffEffectConditions.js'
import {
  buildRulesTable,
  CONVERT_FROM_LABELS,
  CONVERT_PANEL_SOURCE_LABELS,
  CONVERT_SLOT_HINTS,
  CONVERT_SLOT_LABELS,
  extractAgentBuffItems,
  extractWengineBuffItems,
  formatSourceBlock,
  mapKeywordsToEffect,
  simplifyText,
  SLOT_LABELS,
  SLOT_OPTIONS,
  STAT_LABELS,
  UNABLE,
  unableSlotsOf,
} from './nanoka/nanokaBuffExtractor.js'
import { normalizeSkillName } from './nanoka/nanokaSkillMapper.js'
import { listCalculatorBuffs, normalizeEffectList, upsertAgent, upsertWengine } from './calculatorBuffService.js'
import { listAgentSkills, listSkills, upsertSkill } from './skillLibraryService.js'
import { upsertSkillSubcategory } from './skillSubcategoryService.js'

const KIND_LABELS = { agent: '角色', wengine: '音擎' }

/** 角色容器是 `mindscapeBuffs[0..6]`（0 = 核心被动 + 额外能力 + 招式文本；1..6 = 影画） */
const AGENT_SLOT_COUNT = 7
/** 音擎容器是 `refinementBuffs[0..4]`（精炼 1–5） */
const REFINEMENT_COUNT = 5
const MINDSCAPE_NOTES_LENGTH = 7

const APPLY_SITUATION_VALUES = new Set(['global', 'stagger', 'non_stagger'])
const EFFECT_KINDS = new Set(['fixed', 'stacked', 'convert', 'additionalDamage'])
/** 与 `calculatorBuffService.normalizeConvert` 的 ATTRS 同源 */
const CONVERT_FROM_VALUES = new Set([
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
  'skillLevelBasic',
  'skillLevelDodge',
  'skillLevelAssist',
  'skillLevelSpecial',
  'skillLevelChainUltimate',
])
const CONVERT_PANEL_SOURCES = new Set(['external', 'final', 'manual'])
const STAT_KEY_SET = new Set(BUFF_STAT_KEYS)

// ================================================================== 小工具

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function normalizeNameKey(raw) {
  return String(raw ?? '')
    .replace(/[「」\s·:：]/g, '')
    .toLowerCase()
}

function wengineKey(raw) {
  return normalizeNameKey(raw).replace(/[_\-‐-―]/g, '')
}

/**
 * **解析规则对照表**（只读）：直接取抽取器的 `buildRulesTable()`（单一事实来源，
 * 前端「解析规则」弹窗与 `dev-docs/nanoka-buff-rules-*.md` 导出共用这一份）。
 */
export function nanokaRulesTable() {
  return buildRulesTable()
}

/** 去重（保留首次出现的顺序，按 key 函数） */
export function uniqueBy(list, keyOf) {
  const seen = new Set()
  const out = []
  for (const item of list) {
    const key = keyOf(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

// ================================================================== 本地记录匹配

/** 索引项 → 本地角色（`code_name` / `zh` / 本地 id 三路匹配，对不上就报错不猜） */
export function resolveLocalAgent({ agents, meta, detail, nanokaId } = {}) {
  const list = Array.isArray(agents) ? agents : []
  const candidates = [
    normalizeNameKey(meta?.code),
    normalizeNameKey(meta?.zh),
    normalizeNameKey(detail?.code_name),
    normalizeNameKey(detail?.name),
    normalizeNameKey(nanokaId),
  ].filter(Boolean)
  const hit =
    list.find((agent) => candidates.includes(normalizeNameKey(agent.id))) ??
    list.find((agent) => candidates.includes(normalizeNameKey(agent.name)))
  if (!hit) {
    throw new Error(
      `本地角色表里找不到对得上的记录（nanoka ${meta?.code ?? ''} / ${meta?.zh ?? detail?.name ?? ''}）；先在「nanoka 采集」面板确认本地名与 nanoka 名一致`,
    )
  }
  return hit
}

/** 索引项 → 本地音擎（`en` 吃掉下划线 / 连字符，`zh` / 本地名兜底） */
export function resolveLocalWengine({ wengines, meta, detail, nanokaId } = {}) {
  const list = Array.isArray(wengines) ? wengines : []
  const nameCandidates = [
    normalizeNameKey(meta?.zh),
    normalizeNameKey(detail?.name),
    normalizeNameKey(meta?.code),
  ].filter(Boolean)
  const keyCandidates = [wengineKey(meta?.en), wengineKey(nanokaId), wengineKey(detail?.code_name)].filter(
    Boolean,
  )
  const hit =
    list.find((wengine) => keyCandidates.includes(wengineKey(wengine.id))) ??
    list.find((wengine) => nameCandidates.includes(normalizeNameKey(wengine.name)))
  if (!hit) {
    throw new Error(
      `本地音擎表里找不到对得上的记录（nanoka ${meta?.en ?? detail?.name ?? ''}）；先在「nanoka 采集」面板确认本地名与 nanoka 名一致`,
    )
  }
  return hit
}

// ================================================================== 层C（增益块字段）整理

/** 一条效果 → 写库用的完整字段（**只保留 schema 内的键**，界面上的展示字段丢掉） */
export function sanitizeEffect(input, index = 0) {
  const raw = isPlainObject(input) ? input : {}
  const stat = raw.stat
  if (!STAT_KEY_SET.has(stat) && !isCustomBuffStatKey(stat)) {
    throw new Error(`第 ${index + 1} 条效果的「属性」不是合法增益字段：${stat ?? ''}`)
  }
  const kind = EFFECT_KINDS.has(raw.kind) ? raw.kind : 'fixed'
  const value = toNumber(raw.value)
  const maxStacks = Math.max(1, Math.round(toNumber(raw.maxStacks, 1) || 1))
  const valuePerStack = toNumber(raw.valuePerStack)
  const effect = {
    id: String(raw.id ?? `eff-${index}`).trim() || `eff-${index}`,
    origin: typeof raw.origin === 'string' ? raw.origin : '',
    applyTarget: normalizeEffectApplyTarget(raw.applyTarget),
    applySituation: APPLY_SITUATION_VALUES.has(raw.applySituation) ? raw.applySituation : 'global',
    applyProfession:
      raw.applyProfession == null || String(raw.applyProfession).trim() === ''
        ? null
        : String(raw.applyProfession).trim(),
    teammateProfessions: normalizeTeammateProfessions(raw.teammateProfessions),
    teamProfession:
      raw.teamProfession == null || String(raw.teamProfession).trim() === ''
        ? null
        : String(raw.teamProfession).trim(),
    teamProfessionValues: Array.isArray(raw.teamProfessionValues)
      ? [0, 1, 2].map((i) => {
          const item = raw.teamProfessionValues[i]
          if (item == null || item === '') return null
          const num = Number(item)
          return Number.isFinite(num) ? num : null
        })
      : null,
    teamProfessionMinCount:
      raw.teamProfessionMinCount == null || raw.teamProfessionMinCount === ''
        ? null
        : Math.min(3, Math.max(1, Math.round(toNumber(raw.teamProfessionMinCount, 1) || 1))),
    skillCategory: raw.skillCategory ? String(raw.skillCategory) : undefined,
    skillSubcategoryId:
      raw.skillSubcategoryId == null || raw.skillSubcategoryId === ''
        ? null
        : String(raw.skillSubcategoryId),
    skillTargets: Array.isArray(raw.skillTargets)
      ? raw.skillTargets
          .filter((item) => isPlainObject(item))
          .map((item) => ({
            category: String(item.category ?? 'basic'),
            subcategoryId:
              item.subcategoryId == null || item.subcategoryId === ''
                ? null
                : String(item.subcategoryId),
          }))
      : undefined,
    elementFilter:
      raw.elementFilter === 'all' || raw.elementFilter == null
        ? 'all'
        : Array.isArray(raw.elementFilter)
          ? raw.elementFilter.map((item) => String(item))
          : [String(raw.elementFilter)],
    kind,
    stat,
    value: (kind === 'fixed' || kind === 'additionalDamage') && !raw.stackable ? value : 0,
    stackable: Boolean(raw.stackable),
    maxStacks,
    valuePerStack: kind === 'stacked' ? valuePerStack || value : valuePerStack,
    defaultStacks: (() => {
      if (raw.defaultStacks == null || raw.defaultStacks === '') return 1
      const num = Number(raw.defaultStacks)
      return Number.isFinite(num) ? Math.max(0, num) : 1
    })(),
    enabledDefault: raw.enabledDefault === false ? false : true,
    note: typeof raw.note === 'string' ? raw.note : '',
  }
  if (kind === 'additionalDamage') {
    effect.additionalDamage = isPlainObject(raw.additionalDamage)
      ? {
          onlyPolarDisorder: raw.additionalDamage.onlyPolarDisorder === true,
          ...(['skillLevelBasic','skillLevelDodge','skillLevelAssist','skillLevelSpecial','skillLevelChainUltimate'].includes(String(raw.additionalDamage.ratioLevelSource ?? ''))
            ? { ratioLevelSource: String(raw.additionalDamage.ratioLevelSource) }
            : {}),
          ...(Number.isFinite(Number(raw.additionalDamage.ratioPercentPerLevel)) &&
          Number(raw.additionalDamage.ratioPercentPerLevel) !== 0
            ? { ratioPercentPerLevel: Number(raw.additionalDamage.ratioPercentPerLevel) }
            : {}),
        }
      : {}
  }
  if (kind === 'convert') {
    const convert = isPlainObject(raw.convert) ? raw.convert : {}
    const from = String(convert.from ?? '')
    if (!CONVERT_FROM_VALUES.has(from)) {
      throw new Error(`第 ${index + 1} 条转模效果的「来源属性」不合法：${from || '(空)'}`)
    }
    effect.convert = {
      from,
      panelSource: CONVERT_PANEL_SOURCES.has(convert.panelSource) ? convert.panelSource : 'external',
      ratioPercent: toNumber(convert.ratioPercent),
      ratioLevelSource: CONVERT_FROM_VALUES.has(String(convert.ratioLevelSource ?? ''))
        ? String(convert.ratioLevelSource)
        : undefined,
      ...(convert.ratioPercentPerLevel != null &&
      convert.ratioPercentPerLevel !== '' &&
      toNumber(convert.ratioPercentPerLevel) !== 0
        ? { ratioPercentPerLevel: toNumber(convert.ratioPercentPerLevel) }
        : {}),
      ...(convert.capPerLevel != null &&
      convert.capPerLevel !== '' &&
      toNumber(convert.capPerLevel) !== 0
        ? { capPerLevel: toNumber(convert.capPerLevel) }
        : {}),
      cap: convert.cap == null || convert.cap === '' ? null : toNumber(convert.cap),
      defaultBase:
        convert.defaultBase == null || convert.defaultBase === ''
          ? null
          : toNumber(convert.defaultBase),
      initialBase: convert.initialBase == null || convert.initialBase === '' ? 0 : toNumber(convert.initialBase),
    }
  } else {
    effect.convert = undefined
  }
  // `scope` 只作旧输入兼容；写库统一迁移为 conditions.damageTypes。
  const groupId = normalizeGroupId(raw.groupId)
  if (groupId) effect.groupId = groupId
  const conditions = normalizeEffectConditionsForStat(raw.conditions, raw.scope, stat)
  if (conditions) effect.conditions = conditions
  return effect
}

/** 同块判重：先按正式写库规则归一化；不比较 id、来源文案及展示分组。 */
function effectSignature(input) {
  const sanitized = sanitizeEffect(input)
  // 回读会清空无职业限制的人数档，比较时必须与写库规则一致，否则每次重试都会追加。
  const effect = normalizeEffectList([sanitized])[0] ?? sanitized
  const sorted = (values) => [...new Set(values ?? [])].sort()
  const skillTargets = effect.skillTargets?.length
    ? effect.skillTargets
    : effect.skillCategory
      ? [{ category: effect.skillCategory, subcategoryId: effect.skillSubcategoryId ?? null }]
      : []
  return JSON.stringify({
    stat: effect.stat, kind: effect.kind,
    applyTarget: effect.applyTarget, applySituation: effect.applySituation,
    applyProfession: effect.applyProfession, teammateProfessions: effect.teammateProfessions,
    teamProfession: effect.teamProfession,
    teamProfessionValues: effect.teamProfessionValues, teamProfessionMinCount: effect.teamProfessionMinCount,
    value: effect.value, valuePerStack: effect.valuePerStack,
    maxStacks: effect.maxStacks, defaultStacks: effect.defaultStacks, stackable: effect.stackable,
    elementFilter: Array.isArray(effect.elementFilter) ? sorted(effect.elementFilter) : effect.elementFilter,
    skillTargets: sorted(skillTargets.map((target) => JSON.stringify([target.category, target.subcategoryId ?? null]))),
    damageTypes: effect.conditions?.damageTypes ?? [],
    convert: effect.convert ?? null,
    enabledDefault: effect.enabledDefault,
  })
}

function sameEffect(a, b) {
  return effectSignature(a) === effectSignature(b)
}

/** 容器里所有 effect 的 id 去重（同一容器内不许重 id） */
function ensureUniqueEffectIds(effects) {
  const seen = new Set()
  return effects.map((effect, index) => {
    let id = String(effect.id ?? '').trim() || `eff-${index}`
    if (seen.has(id)) id = `${id}-${index}`
    seen.add(id)
    return { ...effect, id }
  })
}

// ================================================================== 槽位 ↔ 容器（只按下标）

/**
 * 来源 + 槽位下标 → 落点容器（**只按下标定位，绝不按块名匹配**）。
 * `ok:false` 表示这条来源在仓库里没有槽位（v3 里只有「找不到技能行」这一种，见 `planSkillDesc`）。
 */
export function resolveSlotTarget({ kind, source, containerIndex } = {}) {
  if (kind === 'wengine') {
    if (source === 'fixed') {
      return { ok: true, container: 'fixedBuffs', index: null, label: 'fixedBuffs（基础效果）' }
    }
    const index = Number(containerIndex)
    if (!Number.isFinite(index) || index < 0 || index >= REFINEMENT_COUNT) {
      return { ok: false, reason: `音擎没有 refinementBuffs[${containerIndex}] 这个槽位` }
    }
    return {
      ok: true,
      container: 'refinementBuffs',
      index,
      label: `refinementBuffs[${index}]（精炼 ${index + 1}）`,
    }
  }
  const index = Number(containerIndex)
  if (!Number.isFinite(index) || index < 0 || index >= AGENT_SLOT_COUNT) {
    return { ok: false, reason: `角色没有 mindscapeBuffs[${containerIndex}] 这个槽位` }
  }
  return {
    ok: true,
    container: 'mindscapeBuffs',
    index,
    label: index === 0 ? 'mindscapeBuffs[0]（核心被动 / 额外能力）' : `mindscapeBuffs[${index}]（影画 ${index}）`,
  }
}

/** 读一个「自增益容器」（`{ effectBlocks, effects, ... }`）里的块列表 */
function readBlockList(container) {
  if (isPlainObject(container) && Array.isArray(container.effectBlocks) && container.effectBlocks.length) {
    return container.effectBlocks.map((block, index) => ({
      id: String(block?.id ?? `blk-${index}`),
      name: String(block?.name ?? `效果块 ${index + 1}`),
      note: typeof block?.note === 'string' ? block.note : '',
      enabledDefault: block?.enabledDefault !== false,
      effects: Array.isArray(block?.effects) ? block.effects : [],
    }))
  }
  if (isPlainObject(container) && Array.isArray(container.effects) && container.effects.length) {
    return [
      {
        id: 'blk-1',
        name: '效果块 1',
        note: '',
        enabledDefault: true,
        effects: container.effects,
      },
    ]
  }
  return []
}

/** 把块列表写回容器（保持 `effectBlocks` / `effects` 两份同步的既有形状） */
function writeContainer(blocks) {
  const effectBlocks = blocks.map((block, index) => ({
    id: String(block.id ?? `blk-${index + 1}`),
    name: String(block.name ?? `效果块 ${index + 1}`),
    note: typeof block.note === 'string' ? block.note : '',
    effects: ensureUniqueEffectIds(block.effects ?? []),
    enabledDefault: block.enabledDefault !== false,
  }))
  return { effectBlocks, effects: effectBlocks.flatMap((block) => block.effects) }
}

/** 建议块名（**只是展示文字**，用于新建块；定位永远按下标） */
function suggestedBlockName({ container, index, blockHint }) {
  if (container === 'fixedBuffs') return '基础效果'
  if (container === 'refinementBuffs') return `精炼 ${index + 1}`
  if (index === 0) return blockHint || '核心被动 / 额外能力'
  return `${index} 影`
}

/**
 * 把一批效果追加进**该槽位已有的块**（复用第一个块，不看块名）；
 * 该槽位一个块都没有时才新建一个（用建议名）。
 *
 * @returns {{ blocks:Array, blockIndex:number, blockName:string, blockIsNew:boolean,
 *   added:number, duplicates:number, appendedEffects:Array }}
 */
export function mergeIntoSlot({ container, index, blocks, effects, blockHint }) {
  const list = blocks.map((block) => ({ ...block, effects: [...(block.effects ?? [])] }))
  let blockIsNew = false
  if (!list.length) {
    list.push({
      id: `blk-${container}-${index ?? 'fixed'}-1`,
      name: suggestedBlockName({ container, index, blockHint }),
      note: '',
      enabledDefault: true,
      effects: [],
    })
    blockIsNew = true
  }
  const target = list[0]
  let added = 0
  let duplicates = 0
  const appendedEffects = []
  for (const effect of effects) {
    if (target.effects.some((existing) => sameEffect(existing, effect))) {
      duplicates += 1
      continue
    }
    const withId = ensureUniqueEffectIds([...target.effects, effect]).pop()
    target.effects.push(withId)
    appendedEffects.push(withId)
    added += 1
  }
  return {
    blocks: list,
    blockIndex: 0,
    blockName: target.name,
    blockIsNew,
    added,
    duplicates,
    appendedEffects,
  }
}

/** 新编辑器按明确的块 id 保存；不同来源不再挤入槽内首块。 */
export function mergeEditorBlocksIntoSlot({ blocks, entries }) {
  const list = blocks.map((block) => ({ ...block, effects: [...(block.effects ?? [])] }))
  const appendedEffects = []
  let duplicates = 0
  let blockIsNew = false
  const blockNames = new Set()
  for (const { row, effect } of entries) {
    const metadata = row.block
    // 同一次采集可能遇到早期按角色命名的块，按同一原文来源和正式效果判重。
    if (metadata.id === `nanoka-${row.slot}` && effect.origin.startsWith('nanoka:')) {
      const recorded = list.find((item) => item.id !== metadata.id && item.effects.some((existing) =>
        existing.origin === effect.origin && sameEffect(existing, effect),
      ))
      if (recorded) {
        blockNames.add(recorded.name)
        duplicates += 1
        continue
      }
    }
    let block = list.find((item) => item.id === metadata.id)
    if (!block) {
      block = { id: metadata.id, name: metadata.name, note: metadata.note, enabledDefault: metadata.enabledDefault !== false, effects: [] }
      list.push(block)
      blockIsNew = true
    } else {
      block.name = String(metadata.name ?? block.name)
      block.note = String(metadata.note ?? '')
      block.enabledDefault = metadata.enabledDefault !== false
    }
    blockNames.add(block.name)
    if (block.effects.some((existing) => sameEffect(existing, effect))) {
      duplicates += 1
      continue
    }
    const withId = ensureUniqueEffectIds([...list.flatMap((item) => item.effects), effect]).pop()
    block.effects.push(withId)
    appendedEffects.push(withId)
  }
  return { blocks: list, blockIndex: 0, blockName: [...blockNames].join(' / '), blockIsNew, added: appendedEffects.length, duplicates, appendedEffects }
}

/** 原文 + `[关键字]` 行追加进块 note（**追加不覆盖**；已含则不重复），并同步 `mindscapeNotes[i]` */
export function appendSourceText(existing, text) {
  const current = typeof existing === 'string' ? existing.trim() : ''
  const block = String(text ?? '').trim()
  if (!block) return { note: current, appended: false, duplicate: false }
  if (current.includes(block)) return { note: current, appended: false, duplicate: true }
  return {
    note: current ? `${current}\n${block}` : block,
    appended: true,
    duplicate: false,
  }
}

/** 角色 `mindscapeNotes[i]`（追加，不覆盖） */
export function appendMindscapeNote(notes, index, text) {
  const list = [0, 1, 2, 3, 4, 5, 6].map((i) =>
    typeof (Array.isArray(notes) ? notes[i] : '') === 'string' ? notes[i] : '',
  )
  const target = Number(index)
  if (!Number.isFinite(target) || target < 0 || target >= MINDSCAPE_NOTES_LENGTH) {
    return { notes: list, appended: false, duplicate: false, index: null }
  }
  const result = appendSourceText(list[target], text)
  list[target] = result.note
  return { notes: list, appended: result.appended, duplicate: result.duplicate, index: target }
}

/** 原文比较口径：去掉 `原文：` 前缀、压缩空白 */
function normalizeSourceText(text) {
  return String(text ?? '')
    .replace(/^\s*原文[:：]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 采集写入的原文块形如 `原文：<正文>\n[关键字] …`：判重只看正文那一行 */
function sourceCoreText(source) {
  const firstLine = String(source ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  return normalizeSourceText(firstLine)
}

/** 该影画阶所有效果块注释 */
function collectContainerBlockNotes(container) {
  const blocks = Array.isArray(container?.effectBlocks) ? container.effectBlocks : []
  return blocks.map((block) => String(block?.note ?? '').trim()).filter(Boolean)
}

/**
 * 影画注释追加计划：**原文优先留在效果块注释里**（采集时块注释已写入原文 + 关键字行）。
 * 只有该阶没有任何块记录同一段原文（纯文字、无结构化增益）时，才补进 `mindscapeNotes[i]`，
 * 避免同一段文字在「影画注释」与「效果块注释」里各出现一次（用户 2026-11-28）。
 */
export function planMindscapeNoteAppends(doc = {}, groups = []) {
  let notes = [0, 1, 2, 3, 4, 5, 6].map((i) =>
    typeof doc.mindscapeNotes?.[i] === 'string' ? doc.mindscapeNotes[i] : '',
  )
  const skipped = []
  for (const group of groups) {
    if (group?.ok === false || group.container !== 'mindscapeBuffs') continue
    const index = Number(group.containerIndex)
    if (!Number.isFinite(index)) continue
    const blockNotes = collectContainerBlockNotes(doc.mindscapeBuffs?.[index])
    for (const source of group.sourceTexts ?? []) {
      const target = sourceCoreText(source)
      if (!target) continue
      if (blockNotes.some((note) => normalizeSourceText(note).includes(target))) {
        skipped.push(target)
        continue
      }
      const appended = appendMindscapeNote(notes, index, source)
      notes = appended.notes
    }
  }
  return { notes, skipped }
}

// ================================================================== 抽取结果统计

/**
 * 抽取结果统计（供接口消息用）：原文项 / 关键字 / 废原文 / 待补 / 招式锚点。
 */
export function summarizeItems(items = []) {
  const counts = {
    items: 0,
    buffItems: 0,
    wasteItems: 0,
    keywords: 0,
    recordable: 0,
    dropped: 0,
    blocked: 0,
    unableSlots: 0,
    wasteClauses: 0,
    skillAnchored: 0,
  }
  for (const item of items) {
    counts.items += 1
    if (item.verdict === 'buff') counts.buffItems += 1
    else counts.wasteItems += 1
    counts.wasteClauses += (item.waste ?? []).length
    for (const effect of item.effects ?? []) {
      counts.keywords += 1
      if (effect.recorded === false) {
        counts.dropped += 1
        continue
      }
      counts.recordable += 1
      if (effect.anchors?.labels?.length) counts.skillAnchored += 1
      if (effect.blocked) counts.blocked += 1
      counts.unableSlots += unableSlotsOf(effect).length
    }
  }
  return counts
}

/** 给界面的元数据（槽位标签 / 下拉选项 / 转模文案）——**字典唯一来源在后端** */
export function extractorMeta() {
  return {
    slotLabels: SLOT_LABELS,
    slotOptions: SLOT_OPTIONS,
    unable: UNABLE,
    convertSlotLabels: CONVERT_SLOT_LABELS,
    convertSlotHints: CONVERT_SLOT_HINTS,
    convertFromLabels: CONVERT_FROM_LABELS,
    convertPanelSourceLabels: CONVERT_PANEL_SOURCE_LABELS,
  }
}

// ================================================================== 阶段2 智能覆盖（字段级合并）

/**
 * 「增益块」可合并字段（= 层C 全字段；**手动改过的字段解析不覆盖**）。
 * `note` 单独处理（文字记录，不弹冲突）。
 */
export const MERGE_FIELD_LIST = [
  { id: 'stat', label: '属性' },
  { id: 'kind', label: '类型' },
  { id: 'value', label: '数值' },
  { id: 'valuePerStack', label: '每层值' },
  { id: 'maxStacks', label: '层数上限' },
  { id: 'defaultStacks', label: '默认层数' },
  { id: 'stackable', label: '可叠层' },
  { id: 'applyTarget', label: '生效目标' },
  { id: 'applySituation', label: '生效情形' },
  { id: 'applyProfession', label: '受益职业' },
  { id: 'teammateProfessions', label: '队友职业（满足任一）' },
  { id: 'teamProfession', label: '队伍职业条件' },
  { id: 'teamProfessionValues', label: '启用人数档' },
  { id: 'elementFilter', label: '元素过滤' },
  { id: 'conditions', label: '伤害类型条件' },
  { id: 'skillTargets', label: '招式目标' },
  { id: 'skillCategory', label: '招式大类' },
  { id: 'skillSubcategoryId', label: '招式小类' },
  { id: 'convert', label: '转模' },
  { id: 'enabledDefault', label: '默认启用' },
]

/** 转模条在阶段二要显示的**专用字段**（取代 数值 / 单位） */
export const CONVERT_FIELD_LIST = [
  { id: 'stat', label: '目标属性' },
  { id: 'convert.from', label: '来源属性' },
  { id: 'convert.panelSource', label: '取值层' },
  { id: 'convert.ratioPercent', label: '比例%' },
  { id: 'convert.defaultBase', label: '基础值' },
  { id: 'convert.initialBase', label: '初始值' },
  { id: 'convert.cap', label: '上限' },
]

function sameValue(a, b) {
  const normA = a === undefined ? null : a
  const normB = b === undefined ? null : b
  try {
    return JSON.stringify(normA) === JSON.stringify(normB)
  } catch {
    return normA === normB
  }
}

function toKeywordPayload(row) {
  const keyword = isPlainObject(row?.keyword) ? row.keyword : row
  return {
    slots: isPlainObject(keyword?.slots) ? keyword.slots : {},
    convert: isPlainObject(keyword?.convert) ? keyword.convert : null,
    stackMax: keyword?.stackMax ?? null,
    durationSeconds: keyword?.durationSeconds ?? null,
    anchors: isPlainObject(keyword?.anchors) ? keyword.anchors : null,
    id: String(row?.key ?? keyword?.id ?? ''),
    origin: String(keyword?.origin ?? ''),
    rawText: String(keyword?.rawText ?? row?.rawText ?? ''),
  }
}

/**
 * 「解析」= **智能覆盖**（纯函数，不联网不写库）。
 *
 * 规则（用户 2026-10-16 二次确认）：
 *   1. 逐字段记「手动改过」标记（`dirty`）；
 *   2. 解析**只回填未被手改的字段**；
 *   3. 新解析值 ≠ 手填值 → 记 `conflicts`（**绝不静默覆盖**），界面弹 `[保留我的] [用新解析]`；
 *   4. 关键字新增效果 → **追加**新行（`added: true`）；
 *   5. 关键字删掉 → 旧增益行**保留**并标 `stale`（「关键字里已无此条」）；
 *   6. 关键字 ↔ 增益 **一对一**（不做合并/拆分）。
 *
 * @param {object} params
 * @param {Array} params.rows 当前增益行 `[{ key, effect, dirty }]`（= 阶段二右栏）
 * @param {Array} params.keywords 关键字 `[{ key, slots, convert, stackMax, durationSeconds, anchors }]`
 * @returns {{ rows:Array, conflicts:Array, added:number, stale:number, blocked:number, filled:number, steps:Array }}
 */
export function smartMergeParse({ rows = [], keywords = [], anchors = null, agentId = '' } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const keywordList = Array.isArray(keywords) ? keywords : []
  const keywordByKey = new Map()
  for (const keyword of keywordList) {
    keywordByKey.set(String(keyword?.key ?? keyword?.id ?? ''), keyword)
  }

  const outRows = []
  const conflicts = []
  const steps = []
  let added = 0
  let stale = 0
  let blocked = 0
  let filled = 0

  for (const row of list) {
    const key = String(row?.key ?? '')
    const current = isPlainObject(row?.effect) ? { ...row.effect } : {}
    const dirty = isPlainObject(row?.dirty) ? row.dirty : {}
    const keyword = keywordByKey.get(key)

    if (!keyword) {
      stale += 1
      outRows.push({
        ...row,
        key,
        effect: current,
        dirty,
        conflicts: [],
        stale: true,
        staleLabel: '关键字里已无此条',
      })
      continue
    }
    keywordByKey.delete(key)

    const payload = toKeywordPayload({ ...keyword, key })
    if (!payload.anchors && isPlainObject(anchors)) payload.anchors = anchors
    if (payload.anchors && !payload.anchors.ok && agentId) {
      // 锚点判定属于阶段1；阶段2 只做查表，这里不重算，避免凭空造锚点
      void agentId
    }
    const mapped = mapKeywordsToEffect(payload)
    if (!mapped.ok || !mapped.effect) {
      blocked += 1
      outRows.push({
        ...row,
        key,
        effect: current,
        dirty,
        conflicts: [],
        blocked: true,
        blockReason: mapped.reason || '阶段2 映射不了（补齐关键字或补词表）',
      })
      continue
    }

    const parsed = sanitizeEffect(mapped.effect)
    const nextEffect = { ...current }
    delete nextEffect.scope
    const rowConflicts = []
    const filledFields = []
    for (const field of MERGE_FIELD_LIST) {
      const mine = current[field.id]
      const theirs = parsed[field.id]
      if (sameValue(mine, theirs)) continue
      if (dirty[field.id]) {
        rowConflicts.push({
          field: field.id,
          label: field.label,
          mine: mine === undefined ? null : mine,
          theirs: theirs === undefined ? null : theirs,
        })
        continue
      }
      nextEffect[field.id] = theirs
      filledFields.push(field.id)
    }

    // note 是文字记录：手改过就保留我的，把新解析的原文另存一行（不弹冲突）
    const parsedNote = String(parsed.note ?? '')
    if (dirty.note) {
      if (parsedNote && !String(current.note ?? '').includes(parsedNote)) {
        nextEffect.noteExtra = parsedNote
      }
    } else if (parsedNote !== String(current.note ?? '')) {
      nextEffect.note = parsedNote
      filledFields.push('note')
    }

    filled += filledFields.length
    outRows.push({
      ...row,
      key,
      blockReason: '',
      effect: nextEffect,
      dirty,
      conflicts: rowConflicts,
      filledFields,
      stale: false,
      blocked: false,
      mapping: { steps: mapped.steps, notices: mapped.notices ?? [] },
    })
    if (rowConflicts.length) conflicts.push({ key, conflicts: rowConflicts })
  }

  // 关键字新增效果 → 追加新行
  for (const [key, keyword] of keywordByKey) {
    const payload = toKeywordPayload({ ...keyword, key })
    if (!payload.anchors && isPlainObject(anchors)) payload.anchors = anchors
    const mapped = mapKeywordsToEffect(payload)
    if (!mapped.ok || !mapped.effect) {
      blocked += 1
      outRows.push({
        key,
        effect: null,
        dirty: {},
        conflicts: [],
        added: true,
        blocked: true,
        blockReason: mapped.reason || '阶段2 映射不了（补齐关键字或补词表）',
      })
      continue
    }
    added += 1
    outRows.push({
      key,
      effect: mapped.effect,
      dirty: {},
      conflicts: [],
      added: true,
      stale: false,
      blocked: false,
    })
  }

  steps.push(
    `解析：回填 ${filled} 个字段 / 冲突 ${conflicts.length} 条 / 追加 ${added} 行 / 保留失效 ${stale} 行 / 阻断 ${blocked} 行`,
  )
  return { rows: outRows, conflicts, added, stale, blocked, filled, steps }
}

/**
 * 冲突逐条裁决（纯函数）：`[保留我的]` → `'mine'`；`[用新解析]` → `'theirs'`。
 * 界面点按钮时用；返回新行（不改原对象），`conflicts` 里已裁决的字段被移除。
 */
export function resolveRowConflicts({ row, choices = {} } = {}) {
  const effect = isPlainObject(row?.effect) ? { ...row.effect } : {}
  const resolved = []
  const kept = []
  for (const conflict of row?.conflicts ?? []) {
    const choice = choices[conflict.field] === 'theirs' ? 'theirs' : 'mine'
    if (choice === 'theirs') {
      effect[conflict.field] = conflict.theirs
      resolved.push({ ...conflict, choice })
    } else {
      kept.push({ ...conflict, choice })
    }
  }
  return { ...row, effect, conflicts: kept, resolvedConflicts: resolved }
}

// ================================================================== 写入计划（纯函数）

/**
 * 招式锚点：把「关键字里限定、但技能库里没有同名小类」的招式**建出来**再关联
 * （用户 2026-10-16：匹配不上就按该技能名建立锚点；**建不出锚点 → 这条不录**）。
 *
 * 纯函数：只比对 + 产出计划；真正建小类在 `applyBuffItems` 里（走既有 `upsertSkillSubcategory`）。
 *
 * @returns {{ creations:Array<{agentId:string, categoryId:string, name:string, exists:boolean, id:string|null}>,
 *   unresolved:Array<{name:string, reason:string}> }}
 */
export function planAnchorCreations({ rows = [], subcategories = [] } = {}) {
  const list = Array.isArray(subcategories) ? subcategories : []
  const creations = []
  const unresolved = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const anchors = row?.anchors
    const pending = Array.isArray(anchors?.pendingCreates) ? anchors.pendingCreates : []
    for (const item of pending) {
      const agentId = String(item?.agentId ?? anchors?.agentId ?? '')
      const name = String(item?.name ?? '').trim()
      const categoryId = String(item?.categoryId ?? '').trim()
      if (!name || !categoryId) {
        unresolved.push({ name, reason: '招式名或大类读不出 → 锚点建不出来，这条不录' })
        continue
      }
      const existing = list.find(
        (sub) =>
          String(sub?.categoryId ?? '') === categoryId &&
          (!String(sub?.agentId ?? '') || !agentId || String(sub.agentId) === agentId) &&
          normalizeSkillName(sub?.name) === normalizeSkillName(name),
      )
      if (existing) {
        creations.push({
          agentId: String(existing.agentId ?? agentId),
          categoryId,
          name,
          exists: true,
          id: String(existing.id),
        })
        continue
      }
      creations.push({ agentId, categoryId, name, exists: false, id: null })
    }
  }
  // 去重（同一招式名只建一次）
  const seen = new Set()
  return {
    creations: creations.filter((item) => {
      const key = `${item.agentId}|${item.categoryId}|${normalizeSkillName(item.name)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
    unresolved,
  }
}

/**
 * 把「建好 / 已存在」的锚点 id 回填进 rows（把 `subcategoryId: null` 的整大类目标换成具体小类）。
 * 纯函数。
 */
export function applyAnchorPlanToRows({ rows = [], creations = [] } = {}) {
  const byKey = new Map()
  for (const item of creations) {
    if (!item?.id) continue
    byKey.set(
      `${item.categoryId}|${normalizeSkillName(item.name)}`,
      String(item.id),
    )
  }
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const pending = Array.isArray(row?.anchors?.pendingCreates) ? row.anchors.pendingCreates : []
    if (!pending.length) return row
    const resolvedIds = new Map()
    for (const item of pending) {
      const id = byKey.get(`${item.categoryId}|${normalizeSkillName(item.name)}`)
      if (id) resolvedIds.set(String(item.categoryId), id)
    }
    if (!resolvedIds.size) return row
    const patchTargets = (targets) =>
      Array.isArray(targets)
        ? targets.map((target) => {
            if (target?.subcategoryId) return target
            const id = resolvedIds.get(String(target?.category ?? ''))
            return id ? { ...target, subcategoryId: id } : target
          })
        : targets
    return {
      ...row,
      anchors: {
        ...row.anchors,
        skillTargets: patchTargets(row.anchors?.skillTargets),
        pendingCreates: [],
      },
      effect: isPlainObject(row.effect)
        ? { ...row.effect, skillTargets: patchTargets(row.effect.skillTargets) }
        : row.effect,
      keywordSlots: isPlainObject(row.keywordSlots)
        ? { ...row.keywordSlots }
        : row.keywordSlots,
    }
  })
}

/** 技能库里匹配「该技能的描述」落点（**只匹配既有招式，不新建**） */export function matchSkillDescTargets(skills = [], { agentId, skillName } = {}) {
  const want = normalizeSkillName(skillName)
  if (!want) return []
  const forAgent = (Array.isArray(skills) ? skills : []).filter(
    (skill) => String(skill?.agentId ?? '') === String(agentId ?? ''),
  )
  const exact = forAgent.filter((skill) => normalizeSkillName(skill?.name) === want)
  if (exact.length) return exact
  return forAgent.filter((skill) => normalizeSkillName(skill?.name).startsWith(`${want}·`))
}

/**
 * 写入计划（**纯函数**）：把阶段二确认过的增益行按槽位下标分组，
 * 复用该槽位已有的块（不看块名）、追加效果、追加原文 + `[关键字]` 行。
 *
 * @param {object} params
 * @param {'agent'|'wengine'} params.kind
 * @param {object} params.local `listCalculatorBuffs()` 里的那条本地记录
 * @param {Array} params.rows `[{ key, slot, slotLabel, source, containerIndex, rawText, effect, keywordSlots, convert, skillDesc }]`
 * @param {Array} [params.skills] `listSkills()`（招式文本要写「描述」时用）
 * @returns {{ groups:Array, skills:Array, updated:number, skipped:number, failed:number, invalid:Array }}
 */
export function planBuffApply({ kind, local, rows = [], skills = [], subcategories = [] } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const groups = new Map()
  const invalid = []
  const validRows = []
  let failed = 0

  const slotKeyOf = (row) => {
    const target = resolveSlotTarget({
      kind: row?.kind ?? kind,
      source: row?.source,
      containerIndex: row?.containerIndex,
    })
    return target.ok
      ? `${target.container}#${target.index ?? 'fixed'}`
      : `invalid#${row?.source ?? ''}#${row?.containerIndex ?? ''}`
  }

  for (const [index, row] of list.entries()) {
    let effect = null
    try {
      effect = sanitizeEffect(row?.effect, index)
    } catch (err) {
      failed += 1
      invalid.push({ key: String(row?.key ?? ''), reason: err.message })
      continue
    }
    validRows.push(row)
    const key = slotKeyOf(row)
    if (!groups.has(key)) groups.set(key, { row: row ?? {}, effects: [] })
    groups.get(key).effects.push({ row: row ?? {}, effect })
  }

  const outGroups = []
  let updated = 0
  let skipped = 0

  for (const group of groups.values()) {
    const sample = group.row
    const target = resolveSlotTarget({
      kind: sample?.kind ?? kind,
      source: sample?.source,
      containerIndex: sample?.containerIndex,
    })
    if (!target.ok) {
      skipped += group.effects.length
      outGroups.push({
        slot: String(sample?.slot ?? ''),
        slotLabel: String(sample?.slotLabel ?? ''),
        container: '',
        containerIndex: sample?.containerIndex ?? null,
        ok: false,
        reason: target.reason,
        added: 0,
        duplicates: group.effects.length,
        effects: [],
      })
      continue
    }

    const containerValue = isPlainObject(local?.[target.container])
      ? local[target.container]
      : Array.isArray(local?.[target.container])
        ? local[target.container][target.index ?? 0]
        : {}
    const blocks = readBlockList(containerValue)
    const hasEditorBlocks = group.effects.every((item) => isPlainObject(item.row.block) && String(item.row.block.id ?? '').trim())
    const merged = hasEditorBlocks
      ? mergeEditorBlocksIntoSlot({ blocks, entries: group.effects })
      : mergeIntoSlot({
          container: target.container,
          index: target.index,
          blocks,
          effects: group.effects.map((item) => item.effect),
          blockHint: sample?.blockHint,
        })

    // 原文 + `[关键字]` 行：**同一段原文只写一次**，该段的所有关键字行逐条列在后面（用户 2026-10-17：
    // 之前是按行追加，一段原文下 6 条关键字就把同一段原文重复贴了 6 遍，块备注全变成复读）。
    let noteState = { note: merged.blocks[merged.blockIndex].note, appended: false, duplicate: false }
    const sourceTexts = []
    const rowsByText = new Map()
    for (const item of group.effects) {
      const text = String(item.row?.rawText ?? item.row?.sourceText ?? '').trim()
      if (!text) continue
      const list = rowsByText.get(text) ?? []
      list.push(item)
      rowsByText.set(text, list)
    }
    for (const [text, items] of rowsByText) {
      const sourceText = items[0].row?.rawText
        ? formatSourceBlock({
            rawText: text,
            effects: items.map((item) => ({ slots: item.row.keywordSlots, convert: item.row.convert })),
          })
        : text
      if (!sourceText) continue
      sourceTexts.push(sourceText)
      const next = appendSourceText(noteState.note, sourceText)
      noteState = {
        note: next.note,
        appended: noteState.appended || next.appended,
        duplicate: noteState.duplicate || next.duplicate,
      }
    }
    if (!hasEditorBlocks) merged.blocks[merged.blockIndex].note = noteState.note

    const effectsDetail = merged.appendedEffects.map((effect, index) => ({
      id: effect.id,
      stat: effect.stat,
      statLabel: STAT_LABELS[effect.stat] ?? effect.stat,
      kind: effect.kind,
      value: effect.value,
      valuePerStack: effect.valuePerStack,
      maxStacks: effect.maxStacks,
      applyTarget: effect.applyTarget,
      applySituation: effect.applySituation,
      skillTargets: effect.skillTargets ?? null,
      convert: effect.convert ?? null,
      note: effect.note,
      writeLabel: `写入：${target.label} · 块「${merged.blockName}」${merged.blockIsNew ? '（新建）' : '（复用）'} · 新增`,
      order: index,
    }))
    const duplicateLabels = group.effects
      .filter((item) => !merged.appendedEffects.some((effect) => sameEffect(effect, item.effect)))
      .map((item) => ({
        id: item.effect.id,
        stat: item.effect.stat,
        statLabel: STAT_LABELS[item.effect.stat] ?? item.effect.stat,
        kind: item.effect.kind,
        value: item.effect.value,
        writeLabel: `写入：${target.label} · 块「${merged.blockName}」 · 已存在（重复，跳过）`,
      }))

    updated += merged.added
    skipped += merged.duplicates
    outGroups.push({
      slot: String(sample?.slot ?? ''),
      slotLabel: String(sample?.slotLabel ?? ''),
      container: target.container,
      containerIndex: target.index,
      label: target.label,
      ok: true,
      blockName: merged.blockName,
      blockIsNew: merged.blockIsNew,
      action: merged.added ? '新增' : '跳过（已存在）',
      added: merged.added,
      duplicates: merged.duplicates,
      effects: [...effectsDetail, ...duplicateLabels],
      note: { appended: noteState.appended, duplicate: noteState.duplicate },
      sourceTexts,
      blocks: merged.blocks,
    })
  }

  // —— 招式文本：原文 + 关键字写进该技能的「描述」字段（`calculator_skills.note`，追加不覆盖）
  const skillPlan = new Map()
  const skillRowsBySource = new Map()
  for (const row of validRows.filter((row) => isPlainObject(row?.skillDesc))) {
    const key = JSON.stringify([row.skillDesc.agentId, row.skillDesc.skillName, row.rawText])
    const entries = skillRowsBySource.get(key) ?? []
    entries.push(row)
    skillRowsBySource.set(key, entries)
  }
  for (const sourceRows of skillRowsBySource.values()) {
    const row = sourceRows[0]
    const targets = matchSkillDescTargets(skills, {
      agentId: row.skillDesc.agentId,
      skillName: row.skillDesc.skillName,
    })
    const sourceText = row.rawText
      ? formatSourceBlock({ rawText: row.rawText, effects: sourceRows.map((item) => ({ slots: item.keywordSlots, convert: item.convert })) })
      : ''
    if (!targets.length) {
      skillPlan.set(`missing:${row.skillDesc.agentId}:${row.skillDesc.skillName}`, {
        agentId: String(row.skillDesc.agentId ?? ''),
        skillName: String(row.skillDesc.skillName ?? ''),
        appended: false,
        duplicate: false,
        reason: `技能库里没有招式「${row.skillDesc.skillName}」→ 不改描述（**不新建挂载点**）`,
      })
      continue
    }
    for (const skill of targets) {
      const previous = skillPlan.get(String(skill.id))
      const next = appendSourceText(previous?.note ?? skill.note, sourceText)
      skillPlan.set(String(skill.id), {
        skillId: String(skill.id),
        skillName: String(skill.name ?? ''),
        appended: Boolean(previous?.appended || next.appended),
        duplicate: Boolean(previous?.duplicate || next.duplicate),
        note: next.note,
        reason: '',
      })
    }
  }

  return {
    groups: outGroups,
    skills: [...skillPlan.values()],
    anchors: planAnchorCreations({ rows: list, subcategories }).creations,
    unresolvedAnchors: planAnchorCreations({ rows: list, subcategories }).unresolved,
    updated,
    skipped,
    failed,
    invalid,
  }
}
/** 把计划合并进本地记录，得到可直接交给 `upsertAgent` / `upsertWengine` 的载荷 */
export function buildLocalDoc({ kind, local, groups = [] } = {}) {
  const doc = { ...local }
  if (kind === 'agent') {
    const slots = [0, 1, 2, 3, 4, 5, 6].map((index) =>
      isPlainObject(doc.mindscapeBuffs?.[index]) ? doc.mindscapeBuffs[index] : {},
    )
    for (const group of groups) {
      if (!group.ok || group.container !== 'mindscapeBuffs') continue
      const index = Number(group.containerIndex)
      if (!Number.isFinite(index)) continue
      slots[index] = writeContainer(group.blocks ?? readBlockList(slots[index]))
    }
    doc.mindscapeBuffs = slots
    if (Array.isArray(doc.mindscapeNotes)) doc.mindscapeNotes = [...doc.mindscapeNotes]
  } else {
    const refinements = [0, 1, 2, 3, 4].map((index) =>
      isPlainObject(doc.refinementBuffs?.[index]) ? doc.refinementBuffs[index] : {},
    )
    for (const group of groups) {
      if (!group.ok) continue
      if (group.container === 'refinementBuffs') {
        const index = Number(group.containerIndex)
        if (!Number.isFinite(index)) continue
        refinements[index] = writeContainer(group.blocks ?? readBlockList(refinements[index]))
      } else if (group.container === 'fixedBuffs') {
        doc.fixedBuffs = writeContainer(group.blocks ?? readBlockList(doc.fixedBuffs))
      }
    }
    doc.refinementBuffs = refinements
  }
  return doc
}

// ================================================================== 抽取（读库只为取本地记录 + 锚点）

/**
 * 抽取（**不写库**）：浏览器抓来的 nanoka 详情 → 原文项 + 关键字效果（层B/C）。
 * 读取角色和已有招式锚点，供按实际招式核对烬痕范围。
 */
export async function extractBuffItems({ kind, nanokaId, meta, detail, termNames } = {}) {
  const normalizedKind = kind === 'wengine' ? 'wengine' : kind === 'agent' ? 'agent' : ''
  if (!normalizedKind) throw new Error(`未知的增益来源类型：${kind ?? '(空)'}`)
  if (!isPlainObject(detail)) throw new Error('缺少 nanoka 详情 JSON（抓取在浏览器里做，服务端不联网）')

  const buffs = await listCalculatorBuffs()
  const local =
    normalizedKind === 'agent'
      ? resolveLocalAgent({ agents: buffs.agents, meta, detail, nanokaId })
      : resolveLocalWengine({ wengines: buffs.wengines, meta, detail, nanokaId })
  const extracted =
    normalizedKind === 'agent'
      ? extractAgentBuffItems({
          detail,
          nanokaId,
          termNames,
          anchors: buffs.skillSubcategories ?? [],
          agent: local,
          skills: await listAgentSkills(local.id),
        })
      : extractWengineBuffItems({ detail, nanokaId, termNames, anchors: [] })

  const items = extracted.items.map((item) => ({
    ...item,
    localId: local.id,
  }))

  return {
    kind: normalizedKind,
    nanokaId: String(nanokaId ?? ''),
    localId: String(local.id ?? ''),
    localName: String(local.name ?? ''),
    name: extracted.name,
    items,
    counts: summarizeItems(items),
    meta: extractorMeta(),
  }
}

/**
 * 「化简」（阶段一）：把（可能被编辑过的）原文重跑阶段1 → 关键字。
 * 纯计算 + 只读锚点；**不写库、不联网**。
 */
export async function simplifyBuffTexts({ kind, nanokaId, items = [], corePassiveText = '' } = {}) {
  const normalizedKind = kind === 'wengine' ? 'wengine' : 'agent'
  const list = Array.isArray(items) ? items : []
  const agentId = normalizedKind === 'agent' ? String(list[0]?.agentId ?? nanokaId ?? '') : ''
  const [buffs, skills] = await Promise.all([listCalculatorBuffs(), listAgentSkills(agentId)])
  const anchors = normalizedKind === 'agent' ? buffs.skillSubcategories ?? [] : []
  const agent = (buffs.agents ?? []).find((candidate) => String(candidate.id) === agentId)
  const emberMarkContext = {
    corePassiveText: list.find((item) => item?.slot === 'core')?.rawText ?? corePassiveText,
    profession: agent?.profession,
    skills,
  }
  return {
    kind: normalizedKind,
    items: list.map((item) => {
      const simplified = simplifyText({
        text: item?.rawText ?? '',
        origin: String(item?.origin ?? ''),
        selfNames: Array.isArray(item?.selfNames) ? item.selfNames : agent?.name ? [agent.name] : [],
        anchors,
        agentId: String(item?.agentId ?? agentId ?? ''),
        emberMarkContext,
      })
      const byId = new Map(simplified.effects.map((effect) => [effect.id, effect]))
      return {
        slot: String(item?.slot ?? ''),
        slotLabel: String(item?.slotLabel ?? ''),
        source: String(item?.source ?? ''),
        containerIndex: item?.containerIndex ?? null,
        rawText: simplified.rawText,
        effects: simplified.effects,
        /** 按句配对视图（界面左侧只显示 hasKeywords 的句子） */
        sentences: simplified.sentences.map((sentence) => {
          const keywords = sentence.keywords.map((effect) => byId.get(effect.id)).filter(Boolean)
          return {
            ...sentence,
            sourceKey: String(item?.slot ?? ''),
            sourceLabel: String(item?.slotLabel ?? ''),
            keywords,
            hasKeywords: keywords.length > 0,
          }
        }),
        waste: simplified.waste,
        landing: item?.landing ?? null,
        skillDesc: item?.skillDesc ?? null,
        verdict: simplified.effects.some((effect) => effect.recorded) ? 'buff' : 'waste',
      }
    }),
    meta: extractorMeta(),
  }
}

/**
 * 写入（**唯一写库入口**；`dryRun: true` 只算不写）。
 *
 * `rows` 是阶段二确认过的最终效果行；新版调用携带明确的 block，可由一个来源拆分出多条。
 */
export async function applyBuffItems({ kind, id, rows = [], dryRun = false } = {}) {
  const normalizedKind = kind === 'wengine' ? 'wengine' : kind === 'agent' ? 'agent' : ''
  if (!normalizedKind) throw new Error(`未知的增益来源类型：${kind ?? '(空)'}`)
  const localId = String(id ?? '').trim()
  if (!localId) throw new Error(`缺少本地${KIND_LABELS[normalizedKind]} id`)

  const buffs = await listCalculatorBuffs()
  const local =
    normalizedKind === 'agent'
      ? (buffs.agents ?? []).find((agent) => String(agent.id) === localId)
      : (buffs.wengines ?? []).find((wengine) => String(wengine.id) === localId)
  if (!local) {
    throw new Error(`本地${KIND_LABELS[normalizedKind]}表里没有 id=${localId} 的记录`)
  }

  const skills = normalizedKind === 'agent' ? await listSkills() : []
  const subcategories = Array.isArray(buffs.skillSubcategories) ? buffs.skillSubcategories : []

  // —— 招式锚点：匹配不上就按技能名建小类，再关联（建不出 → 这条不录）
  const anchorPlan = planAnchorCreations({ rows, subcategories })
  const createdAnchors = []
  let effectiveRows = rows
  if (normalizedKind === 'agent') {
    for (const item of anchorPlan.creations) {
      if (item.exists) {
        createdAnchors.push({ ...item, action: 'exists' })
        continue
      }
      if (dryRun) {
        createdAnchors.push({ ...item, action: 'create-pending' })
        continue
      }
      try {
        const created = await upsertSkillSubcategory({
          agentId: item.agentId,
          categoryId: item.categoryId,
          name: item.name,
        })
        createdAnchors.push({ ...item, id: String(created.id), action: 'create' })
        item.id = String(created.id)
      } catch (err) {
        createdAnchors.push({
          ...item,
          action: 'create-failed',
          reason: err instanceof Error ? err.message : String(err),
        })
      }
    }
    effectiveRows = applyAnchorPlanToRows({ rows, creations: anchorPlan.creations })
  }

  const plan = planBuffApply({
    kind: normalizedKind,
    local,
    rows: effectiveRows,
    skills,
    subcategories,
  })

  const result = {
    kind: normalizedKind,
    id: localId,
    name: String(local.name ?? ''),
    dryRun: Boolean(dryRun),
    updated: plan.updated,
    skipped: plan.skipped,
    failed: plan.failed,
    details: plan.groups.map((group) => ({
      slot: group.slot,
      slotLabel: group.slotLabel,
      container: group.container,
      containerIndex: group.containerIndex,
      ok: group.ok !== false,
      action: group.action ?? '',
      blockName: group.blockName,
      added: group.added ?? 0,
      duplicates: group.duplicates ?? 0,
      effects: group.effects ?? [],
      note: group.note ?? null,
      reason: group.reason ?? '',
    })),
    skillDescs: plan.skills,
    anchors: createdAnchors,
    unresolvedAnchors: plan.unresolvedAnchors,
    invalid: plan.invalid,
    /** 因效果块注释已含同一段原文而跳过的影画注释条数（0 = 全部按原样写入） */
    mindscapeNotesSkipped: 0,
    wouldWrite: !dryRun,
    writeError: '',
  }

  if (dryRun) return result

  try {
    if (normalizedKind === 'agent') {
      const doc = buildLocalDoc({ kind: 'agent', local, groups: plan.groups })
      // 原文优先留在效果块注释里；块里已有同一段原文时不再写 `mindscapeNotes[i]`
      const planned = planMindscapeNoteAppends(doc, plan.groups)
      doc.mindscapeNotes = planned.notes
      result.mindscapeNotesSkipped = planned.skipped.length
      await upsertAgent(doc)
    } else {
      const doc = buildLocalDoc({ kind: 'wengine', local, groups: plan.groups })
      await upsertWengine(doc)
    }

    for (const skill of plan.skills) {
      if (!skill.skillId || skill.appended !== true) continue
      const target = skills.find((item) => String(item.id) === String(skill.skillId))
      if (!target) continue
      await upsertSkill({ ...target, note: skill.note })
    }
  } catch (err) {
    result.writeError = err instanceof Error ? err.message : String(err)
  }

  return result
}

// ---------------------------------------------------------------- 「找空活干」：0 增益的目标

/** 数一个容器里的**增益条**（`effectBlocks[].effects` 的条数；note / 原文不算） */
function countContainerEffects(container) {
  if (!container || typeof container !== 'object') return 0
  const blocks = Array.isArray(container.effectBlocks) ? container.effectBlocks : []
  return blocks.reduce(
    (total, block) => total + (Array.isArray(block?.effects) ? block.effects.length : 0),
    0,
  )
}

/** 该目标所有增益容器里的 effect 条数（角色 = mindscapeBuffs[0..6]；音擎 = fixedBuffs + refinementBuffs[0..4]） */
export function countTargetEffects(kind, doc = {}) {
  if (kind === 'wengine') {
    return (
      countContainerEffects(doc.fixedBuffs) +
      (Array.isArray(doc.refinementBuffs) ? doc.refinementBuffs : []).reduce(
        (total, container) => total + countContainerEffects(container),
        0,
      )
    )
  }
  return (Array.isArray(doc.mindscapeBuffs) ? doc.mindscapeBuffs : []).reduce(
    (total, container) => total + countContainerEffects(container),
    0,
  )
}

/**
 * **列出「0 增益」的角色 / 音擎**（用户 2026-10-16：「找空活干」入口）——纯函数，**只读不写库**。
 *
 * 定义：该目标**所有增益容器里 effect 条数 = 0**（只数增益条，note / 原文不算）。
 *   - 角色 = `mindscapeBuffs[0..6]` 的全部 `effectBlocks[].effects`；
 *   - 音擎 = `fixedBuffs` + `refinementBuffs[0..4]`。
 * 顺带回「增益条很少（≤ fewThreshold）」的列表供参考。按名字排序。
 */
export function listEmptyBuffTargets({ kind = 'agent', buffs = {}, fewThreshold = 2 } = {}) {
  const normalizedKind = kind === 'wengine' ? 'wengine' : 'agent'
  const list = normalizedKind === 'wengine' ? buffs.wengines ?? [] : buffs.agents ?? []
  const rows = list.map((doc) => ({
    id: String(doc?.id ?? ''),
    name: String(doc?.name ?? ''),
    element: String(doc?.element ?? ''),
    profession: String(doc?.profession ?? ''),
    rarity: doc?.rarity ?? doc?.rank ?? null,
    effectCount: countTargetEffects(normalizedKind, doc),
  }))
  const byName = (left, right) =>
    left.name.localeCompare(right.name, 'zh-Hans-CN') || left.id.localeCompare(right.id)
  return {
    kind: normalizedKind,
    kindLabel: KIND_LABELS[normalizedKind],
    total: rows.length,
    fewThreshold,
    /** 0 增益（该目标一条增益都没有 → 可以「找空活干」） */
    empty: rows.filter((row) => row.effectCount === 0).sort(byName),
    /** 增益条很少（>0 且 ≤ fewThreshold，供参考） */
    few: rows
      .filter((row) => row.effectCount > 0 && row.effectCount <= fewThreshold)
      .sort((left, right) => left.effectCount - right.effectCount || byName(left, right)),
  }
}

/** 读库版本（**只读查询**，用既有 `listCalculatorBuffs()`；不写库） */
export async function findEmptyBuffTargets(options = {}) {
  const buffs = await listCalculatorBuffs()
  return { ...listEmptyBuffTargets({ ...options, buffs }), queriedAt: new Date().toISOString() }
}
