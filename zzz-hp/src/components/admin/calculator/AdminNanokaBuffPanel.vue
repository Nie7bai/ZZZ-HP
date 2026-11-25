<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import {
  applyNanokaBuffs,
  extractNanokaBuffs,
  fetchNanokaEmptyTargets,
  fetchNanokaRules,
  isNanokaBuffsAuthError,
  parseNanokaBuffs,
  simplifyNanokaBuffs,
  type NanokaApplyResult,
  type NanokaApplyRow,
  type NanokaBuffItem,
  type NanokaBuffKind,
  type NanokaBuffSentence,
  type NanokaEmptyTarget,
  type NanokaEmptyTargets,
  type NanokaExtractResult,
  type NanokaExtractorMeta,
  type NanokaKeywordAnchors,
  type NanokaKeywordConvert,
  type NanokaKeywordEffect,
  type NanokaKeywordSlots,
  type NanokaLayerCEffect,
  type NanokaParseConflict,
  type NanokaParseResultRow,
  type NanokaRulesTable,
} from '@/api/nanokaBuffs'
import AdminConfirmDialog from '@/components/admin/AdminConfirmDialog.vue'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import { useMaskClose } from '@/composables/useMaskClose'
import { clearAdminAuthenticated } from '@/utils/adminAuth'
import AdminBuffEffectEditor from '@/components/admin/calculator/AdminBuffEffectEditor.vue'
import type { BuffEffect, BuffEffectBlock } from '@/types/calculator'
import { normalizeBuffEffect } from '@/utils/buffEffect'
import { validateEffectGroups } from '@/utils/buffEffectRows'
import { createNanokaBuffDraft, nanokaDraftApplyRows, refreshNanokaBuffDraft, rememberNanokaDraftEdits, type NanokaDraftSlots } from '@/utils/nanokaBuffDraft'

/**
 * nanoka 增益：阶段一校对原文/关键字，阶段二复用正式库的效果块编辑器。
 * 来源信息只用于重解析与写入定位；阶段二允许合并、拆分和人工增删效果。
 * 写库仍只在准备结果确认后发生。规格见开发手册的 2026-10-21 对齐记录。
 */

const router = useRouter()
const store = useCalculatorBuffStore()
const { agents, wengines } = storeToRefs(store)
/** nanoka 静态站：响应带 `Access-Control-Allow-Origin: *`，浏览器可直接 fetch */
const NANOKA_STATIC = 'https://static.nanoka.cc'
const INDEX_TIMEOUT_MS = 25000
const DETAIL_TIMEOUT_MS = 20000
const NANOKA_NETWORK_HINT =
  '浏览器访问不到 static.nanoka.cc；如果你靠代理上网，请确认代理已开（服务端不抓 nanoka，抓取一律在浏览器里）'

const UNABLE = '无法提取'
const NONE = '无'

type Page = 'stage1' | 'stage2'

/** 一条「关键字 ↔ 增益」行（一对一；两页共用同一份状态） */
interface KeywordRow {
  key: string
  itemKey: string
  itemSlot: string
  itemSlotLabel: string
  source: string
  containerIndex: number | null
  blockHint: string
  title: string
  rawText: string
  origin: string
  sentence: string
  /** 该关键字所属的**句序号**（按句配对用；切句口径 = 阶段1 的 `。；\n`） */
  sentenceIndex: number
  slots: NanokaKeywordSlots
  convert: NanokaKeywordConvert | null
  stackMax: number | null
  durationSeconds: number | null
  anchors: NanokaKeywordAnchors
  /** 招式限定（`[普通攻击]` 这类）：条件，不是来源 / 落点 */
  skillLimits: { name: string; category: string }[]
  /** 指代来源提示（界面用）：`依赖上一句 · 增伤`，没有则 null */
  inherited: { from: string; fields: string[]; label: string } | null
  /** 同义反复被忽略的条件原文（界面标淡色提示，不入库） */
  tautologyDropped: string[]
  /** 合集扇出来源（**界面提示用，不入库**）：{ id, title, note, targetStat } */
  collection?: { id: string; title: string; note: string; targetStat: string }
  /** 槽位取值来源（`default-team` / `default-team-enemy-status` = 目标按规则兜底成全队） */
  sources: Record<string, string>
  recorded: boolean
  dropReason: string
  unableSlots: string[]
  skillDesc: NanokaBuffItem['skillDesc']
  /** 面板状态（不入库） */
  detailOpen: boolean
  /** 阶段二：是否加入（默认加入；取消勾选 → 标灰、不参与写入准备） */
  included: boolean
  keywordDirty: boolean
  /** 阶段二：实际增益（增益块全字段） */
  gain: BuffEffect | null
  dirty: Record<string, boolean>
  conflicts: NanokaParseConflict[]
  stale: boolean
  blocked: boolean
  blockReason: string
  added: boolean
  writeLabel: string
}

/** 「增益块」全字段（阶段二右栏的控件直接绑这些） */
/** 底部「废原文」区（按来源块 · 整段原文；解析不出的句子只做淡色/下划线标记） */

// ---------------------------------------------------------------- 顶部选择 / 状态

const kind = ref<NanokaBuffKind>('agent')
const selectedId = ref('')
const localQuery = ref('')

const page = ref<Page>('stage1')
const meta = ref<NanokaExtractorMeta | null>(null)
const items = ref<NanokaBuffItem[]>([])
const rows = ref<KeywordRow[]>([])
const localName = ref('')
const nanokaName = ref('')
const nanokaId = ref('')
const buildTag = ref('')

const fetching = ref(false)
const extracting = ref(false)
const simplifying = ref(false)
const parsing = ref(false)
const writing = ref(false)
const busy = computed(() => fetching.value || extracting.value || simplifying.value || parsing.value || writing.value)

const message = ref('')
const messageKind = ref<'ok' | 'err'>('ok')
const statusLine = ref('')
const authDialogVisible = ref(false)

const writePlan = ref<NanokaApplyResult | null>(null)
const writeMessage = ref('')
const confirmVisible = ref(false)

const kindLabel = computed(() => (kind.value === 'agent' ? '角色' : '音擎'))

interface LocalOption {
  id: string
  name: string
  meta: string
}

const localOptions = computed<LocalOption[]>(() => {
  if (kind.value === 'agent') {
    return agents.value.map((agent) => ({
      id: agent.id,
      name: agent.name,
      meta: [agent.element, agent.profession].filter(Boolean).join(' · '),
    }))
  }
  return wengines.value.map((wengine) => ({
    id: wengine.id,
    name: wengine.name,
    meta: [wengine.rarity, wengine.profession].filter(Boolean).join(' · '),
  }))
})

const filteredOptions = computed(() => {
  const query = localQuery.value.trim().toLowerCase()
  if (!query) return localOptions.value
  return localOptions.value.filter(
    (option) => option.name.toLowerCase().includes(query) || option.id.toLowerCase().includes(query),
  )
})

const selectOptions = computed(() => {
  const list = filteredOptions.value
  if (!selectedId.value || list.some((option) => option.id === selectedId.value)) return list
  const current = localOptions.value.find((option) => option.id === selectedId.value)
  return current ? [current, ...list] : list
})

const selectedLocal = computed(
  () => localOptions.value.find((option) => option.id === selectedId.value) ?? null,
)

// ---------------------------------------------------------------- 字典（下拉选项唯一来源在后端）

const FALLBACK_SLOT_OPTIONS: Record<string, string[]> = {
  stat: ['增伤', '招式增伤', '属性异常增伤', '属性异常暴击率', '属性异常暴击伤害', '异常精通', '异常掌控', '暴击率', '暴击伤害', '攻击力（局外）', '攻击力（固定）', '生命值', '防御力', '减防', '抗性穿透', '穿透率', '穿透', '失衡易伤', '失衡易伤（全局）', '能量自动回复', NONE, UNABLE],
  elements: ['物理', '火', '冰', '电', '以太', '风', NONE],
  action: ['提升', '降低', '无视', '转化', UNABLE],
  unit: ['%', '点', NONE],
  target: ['自身', '全队', '指定职业', '指定阵营', NONE, UNABLE],
  conditions: [NONE, '攻击失衡敌人时', '攻击非失衡敌人时', '队伍中存在与自身属性或阵营相同的角色时', '队伍中存在其他异常角色或同阵营角色时', UNABLE],
  scope: [NONE, '招式', '异常', '紊乱', '乱流', '异放', '耀变', '异化系数'],
  stacks: [NONE, UNABLE],
  duration: [NONE, UNABLE],
  object: ['当前招式', '装备者', '敌人', NONE, UNABLE],
  convertFrom: ['hp', 'atk', 'def', 'critRate', 'critDmg', 'mastery', 'anomalyControl', 'energyRegen', 'penRate', 'impact', 'pierce', 'level', UNABLE],
  convertPanelSource: ['external', 'final', 'manual'],
}

const SLOT_ORDER = [
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
] as const

/** 允许复数的槽位（用户 2026-10-16：复数白名单 = 条件 / 元素） */
const MULTI_SLOT_IDS = ['conditions', 'elements']

const SLOT_LABELS: Record<string, string> = {
  stat: '属性',
  elements: '元素',
  action: '动作',
  value: '数值',
  unit: '单位',
  target: '目标',
  conditions: '条件',
  /** 作用域 = 编辑器里的 `scope`（用户 2026-10-16：字段名就叫「作用域」）；「限定招式」并进这一格 */
  scope: '作用域',
  stacks: '层数',
  duration: '时长',
  object: '对象',
  // 转模文案定稿（用户 2026-10-16；括号里是它对应的 normalizeConvert 字段）
  convertFrom: '读取属性', // convert.from
  convertPanelSource: '取哪一层', // convert.panelSource
  convertRatio: '折算比例', // convert.ratioPercent
  convertBase: '基础值', // convert.defaultBase
  convertCap: '上限', // convert.cap
}

const CONVERT_SLOT_ORDER = [
  'convertFrom',
  'convertPanelSource',
  'convertRatio',
  'convertBase',
  'convertCap',
] as const

/** 转模槽位悬浮提示（后端 meta 优先，下面这份是兜底） */
const FALLBACK_CONVERT_HINTS: Record<string, string> = {
  convertFrom: '读取属性：它的值 × 折算比例 = 本条增益',
  convertPanelSource: '取哪一层：进战外面板 / 最终面板 / 手动值',
  convertRatio: '折算比例：百分数填法（150 = 150%）',
  convertBase: '基础值：只有超出它的部分参与折算',
  convertCap: '上限：折算结果的绝对值上限',
}

const CONVERT_FROM_LABELS: Record<string, string> = {
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

const CONVERT_PANEL_SOURCE_LABELS: Record<string, string> = {
  external: '进战外面板',
  final: '最终面板',
  manual: '手动值',
}

function optionsOf(slotId: string): string[] {
  const fromMeta = meta.value?.slotOptions?.[slotId]
  if (Array.isArray(fromMeta) && fromMeta.length) return fromMeta
  return FALLBACK_SLOT_OPTIONS[slotId] ?? []
}

function slotLabel(slotId: string): string {
  return (
    meta.value?.convertSlotLabels?.[slotId] ??
    meta.value?.slotLabels?.[slotId] ??
    SLOT_LABELS[slotId] ??
    slotId
  )
}

function slotHint(slotId: string): string {
  return meta.value?.convertSlotHints?.[slotId] ?? FALLBACK_CONVERT_HINTS[slotId] ?? ''
}

/** 槽位取值的展示文案（转模的读取属性 / 取哪一层要翻成中文） */
function displaySlotValue(slotId: string, value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  if (slotId === 'convertFrom') {
    return meta.value?.convertFromLabels?.[text] ?? CONVERT_FROM_LABELS[text] ?? text
  }
  if (slotId === 'convertPanelSource') {
    return meta.value?.convertPanelSourceLabels?.[text] ?? CONVERT_PANEL_SOURCE_LABELS[text] ?? text
  }
  return text
}

/** 该槽位是不是「无值」（`无` / 空）——`无` 默认隐藏（v3.1） */
function isEmptySlotValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (Array.isArray(value)) return value.every((entry) => isEmptySlotValue(entry))
  const text = String(value).trim()
  return !text || text === NONE
}

/** 数字槽位（渲染成 `type=number`，不走下拉） */
const NUMBER_SLOT_IDS = ['value', 'convertRatio', 'convertBase', 'convertCap']

/** 单值文本槽位（下拉 / 输入框直接写回 `row.slots[id]`） */
const SINGLE_TEXT_SLOT_IDS = ['stat', 'action', 'unit', 'target', 'scope', 'stacks', 'duration', 'object']

function isNumberSlot(slotId: string): boolean {
  return NUMBER_SLOT_IDS.includes(slotId)
}

/** 这些槽位**永远**要能选到 `无` / `无法提取`（后端词表已含，这里兜底，防止旧数据没得选） */
const SLOT_ALWAYS_OPTIONS: Record<string, string[]> = {
  conditions: [NONE, UNABLE],
  scope: [NONE],
}

/**
 * 下拉选项 = 白名单（后端 meta 唯一来源）+ **当前值兼容**（用户 2026-10-21 报的 bug）。
 *
 * 当前值可能是 `无法提取`、`无`、或者历史遗留的旧 scope 字符串（例如条件里存过 `异放`），
 * 这些**不在词表里也不许显示成「请选择…」**：一律补进选项，用户改得动、也看得见原值。
 */
function slotOptionsFor(slotId: string, ...current: unknown[]): string[] {
  const list = [...optionsOf(slotId)]
  for (const extra of SLOT_ALWAYS_OPTIONS[slotId] ?? []) {
    if (!list.includes(extra)) list.push(extra)
  }
  for (const item of current) {
    for (const raw of Array.isArray(item) ? item : [item]) {
      const text = raw === null || raw === undefined ? '' : String(raw).trim()
      if (text && !list.includes(text)) list.push(text)
    }
  }
  return list
}

/** 单值槽位控件的当前值（数组 → `a + b` 展示；空 → `无`，保证下拉永远有选中项） */
function slotEditValue(entry: SlotEntry): string {
  if (Array.isArray(entry.value)) return entry.value.map((item) => String(item)).join(' + ')
  const text = entry.value === null || entry.value === undefined ? '' : String(entry.value)
  return text || NONE
}

/**
 * 该槽位是不是**锁定**（用户 2026-10-21）：
 * - 整条不录（招式锚点关联不上）→ 全部槽位锁；
 * - 该条被阻断（属性 / 动作 / 数值标了 `无法提取`）→ 软槽位先锁，硬槽位仍可改（补完自动解锁）。
 * 锁定态显示**当前值 + 禁用**，而不是一个空的「请选择…」。
 */
function slotLockReason(row: KeywordRow, slotId: string): string {
  if (!row.recorded) {
    return `锁定：这条不录（${row.dropReason || '招式锚点关联不上'}），改这里也不会入库`
  }
  if (row.blocked && !isHardUnable(slotId)) {
    return '锁定：这条被阻断（属性 / 动作 / 数值待补），先补硬槽位'
  }
  return ''
}

function isSlotLocked(row: KeywordRow, slotId: string): boolean {
  return Boolean(slotLockReason(row, slotId))
}

/** 关键字行要显示的槽位（只显示有值；`无` 进 hidden；`无法提取` 进 unable） */
function slotBuckets(row: KeywordRow) {
  const visible: { id: string; label: string; value: unknown; unable: boolean }[] = []
  const hidden: { id: string; label: string; value: unknown; unable: boolean }[] = []
  const unable: { id: string; label: string; value: unknown; unable: boolean }[] = []
  for (const id of SLOT_ORDER) {
    if (row.slots.action === '转化' && (id === 'value' || id === 'unit')) continue
    const value = row.slots[id]
    const entry = { id, label: slotLabel(id), value, unable: isUnableValue(value) }
    if (entry.unable) unable.push(entry)
    else if (isEmptySlotValue(value)) hidden.push(entry)
    else visible.push(entry)
  }
  if (row.slots.action === '转化') {
    for (const id of CONVERT_SLOT_ORDER) {
      const value = row.convert?.[id as keyof NanokaKeywordConvert] ?? null
      const entry = { id, label: SLOT_LABELS[id] ?? id, value, unable: isUnableValue(value) }
      if (entry.unable) unable.push(entry)
      else if (isEmptySlotValue(value)) hidden.push(entry)
      else visible.push(entry)
    }
  }
  return { visible, hidden, unable }
}

/** 一行里要渲染的槽位（`无法提取` 优先 → 有值 → 无值（仅 [详情] 展开时）） */
interface SlotEntry {
  id: string
  label: string
  value: unknown
  unable: boolean
  hidden: boolean
}

function slotEntries(row: KeywordRow): SlotEntry[] {
  const buckets = slotBuckets(row)
  const entries: SlotEntry[] = [
    ...buckets.unable.map((entry) => ({ ...entry, hidden: false })),
    ...buckets.visible.map((entry) => ({ ...entry, hidden: false })),
  ]
  if (row.detailOpen) {
    entries.push(...buckets.hidden.map((entry) => ({ ...entry, hidden: true })))
  }
  return entries
}

/** 槽位值是不是槽位级 `无法提取`（详情里要标 ⚠X，别当普通值） */
function isUnableValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.includes(UNABLE)
  return String(value ?? '').trim() === UNABLE
}

/**
 * `无法提取` 分软硬（用户 2026-10-16）：`属性 / 动作 / 数值` 缺失 → **阻断待补**；
 * 其余槽位缺失 → **按「无」处理**（红字提示 + 淡色「按无处理」，不阻断）。
 */
const HARD_UNABLE_SLOT_IDS = ['stat', 'action', 'value']

function isHardUnable(slotId: string): boolean {
  return HARD_UNABLE_SLOT_IDS.includes(slotId)
}

// ---------------------------------------------------------------- 按句配对（v3.24）

/** 左侧主视图只显示**产出过关键字**的句子（用户 2026-10-16） */
function keywordSentences(item: NanokaBuffItem): NanokaBuffSentence[] {
  return (item.sentences ?? []).filter((sentence) => sentence.hasKeywords)
}

/** 某句（某来源块内）的关键字行 —— 左右按句配对 */
function rowsForSentence(itemKey: string, sentenceIndex: number): KeywordRow[] {
  return rows.value.filter(
    (row) => row.itemKey === itemKey && row.sentenceIndex === sentenceIndex,
  )
}

/** 左侧要显示哪些来源块（整块抽不出关键字 → 不显示，只在废原文区出现） */
const visibleItems = computed(() => items.value.filter((item) => keywordSentences(item).length > 0))

// —— 「整块原文」弹窗（用户 2026-10-16）：弹窗里同样剔除完全解析不出来的句子，并高亮当前句
const originalVisible = ref(false)
const originalItem = ref<NanokaBuffItem | null>(null)
const originalHighlight = ref(0)

/** 「解析规则」弹窗（只读；数据来自后端 `/rules`，界面不手写规则） */
const rulesVisible = ref(false)
const rulesLoading = ref(false)
const rules = ref<NanokaRulesTable | null>(null)
const rulesMessage = ref('')

async function openRules() {
  rulesVisible.value = true
  if (rules.value || rulesLoading.value) return
  rulesLoading.value = true
  try {
    const { result, message: serverMessage } = await fetchNanokaRules()
    rules.value = result
    rulesMessage.value = serverMessage
  } catch (err) {
    rulesMessage.value = describeError(err)
  } finally {
    rulesLoading.value = false
  }
}

/** 「找空活干」：0 增益的角色 / 音擎（只读查询；点一项 = 直接选中，**不自动抓取**，避免误触） */
const emptyVisible = ref(false)
const emptyLoading = ref(false)
const emptyData = ref<NanokaEmptyTargets | null>(null)
const emptyMessage = ref('')
const emptyQuery = ref('')

/** 本地兜底口径（与后端 `listEmptyBuffTargets` 同一条规则）：数 `effectBlocks[].effects` 条数 */
function countLocalEffects(container: unknown): number {
  const blocks = (container as { effectBlocks?: { effects?: unknown[] }[] } | null)?.effectBlocks
  if (!Array.isArray(blocks)) return 0
  return blocks.reduce(
    (total, block) => total + (Array.isArray(block?.effects) ? block.effects.length : 0),
    0,
  )
}

const localEmptyTargets = computed<NanokaEmptyTarget[]>(() => {
  if (kind.value === 'wengine') {
    return wengines.value
      .map((doc) => {
        const items = (doc as { refinementBuffs?: unknown[] }).refinementBuffs ?? []
        const count =
          countLocalEffects((doc as { fixedBuffs?: unknown }).fixedBuffs) +
          items.reduce<number>((total, container) => total + countLocalEffects(container), 0)
        return {
          id: String(doc.id),
          name: String(doc.name ?? ''),
          element: '',
          profession: String((doc as { profession?: string }).profession ?? ''),
          rarity: (doc as { rarity?: string | number }).rarity ?? null,
          effectCount: count,
        }
      })
      .filter((row) => row.effectCount === 0)
  }
  return agents.value
    .map((doc) => {
      const items = (doc as { mindscapeBuffs?: unknown[] }).mindscapeBuffs ?? []
      const count = items.reduce<number>((total, container) => total + countLocalEffects(container), 0)
      return {
        id: String(doc.id),
        name: String(doc.name ?? ''),
        element: String((doc as { element?: string }).element ?? ''),
        profession: String((doc as { profession?: string }).profession ?? ''),
        rarity: null,
        effectCount: count,
      }
    })
    .filter((row) => row.effectCount === 0)
})

const emptyButtonLabel = computed(() => {
  if (emptyLoading.value) return '查询中…'
  const count = (emptyData.value?.empty ?? localEmptyTargets.value).length
  return `列出 0 增益的${kindLabel.value}（${count}）`
})

const emptyRows = computed(() => {
  const list = emptyData.value?.empty ?? localEmptyTargets.value
  const query = emptyQuery.value.trim().toLowerCase()
  if (!query) return list
  return list.filter(
    (row) => row.name.toLowerCase().includes(query) || row.id.toLowerCase().includes(query),
  )
})

const emptyFewRows = computed(() => emptyData.value?.few ?? [])

/** 拉一次 0 增益列表（**只读**；每次打开都重新查，处理完（写入后）的条目自然会消失） */
async function loadEmptyTargets() {
  emptyLoading.value = true
  try {
    const { result, message: serverMessage } = await fetchNanokaEmptyTargets(kind.value)
    emptyData.value = result
    emptyMessage.value = serverMessage
  } catch (err) {
    // 后端不可用时退回本地口径（同一规则，界面照常能用）
    emptyData.value = null
    emptyMessage.value = `${describeError(err)}（已退回本地口径：${localEmptyTargets.value.length} 条）`
  } finally {
    emptyLoading.value = false
  }
}

async function openEmptyTargets() {
  emptyVisible.value = true
  emptyQuery.value = ''
  await loadEmptyTargets()
}

/** 点一项 = 等价于在「本地角色 / 本地音擎」下拉里选中它（停在可点 [抓取增益] 的状态） */
function pickEmptyTarget(row: NanokaEmptyTarget) {
  selectedId.value = row.id
  localQuery.value = ''
  emptyVisible.value = false
  messageKind.value = 'ok'
  message.value = `已选中${kindLabel.value}「${row.name}」（ID ${row.id}）—— 现在可以直接点 [抓取增益]`
}

function openOriginal(item: NanokaBuffItem, sentenceIndex = -1) {
  originalItem.value = item
  const keywordSentencesOfItem = keywordSentences(item)
  originalHighlight.value =
    sentenceIndex >= 0
      ? sentenceIndex
      : (keywordSentencesOfItem[0]?.sentenceIndex ?? 0)
  originalVisible.value = true
}

function closeOriginal() {
  originalVisible.value = false
  originalItem.value = null
}

// 遮罩点击关闭：只有「按下 + 松开都在遮罩上」才关，拖选文字出界松手不误关。
// 本组件有三个遮罩弹窗，各用一个独立实例，按下态不会互相串。
const { onMaskPointerDown, onMaskClick } = useMaskClose(closeOriginal)
const { onMaskPointerDown: onRulesMaskPointerDown, onMaskClick: onRulesMaskClick } = useMaskClose(
  () => {
    rulesVisible.value = false
  },
)
const { onMaskPointerDown: onEmptyMaskPointerDown, onMaskClick: onEmptyMaskClick } = useMaskClose(
  () => {
    emptyVisible.value = false
  },
)

/**
 * 弹窗里显示的句子：**这一段（整块）的完整原文**，一句都不删（用户 2026-10-17：
 * 之前只列「产出过关键字」的句子，块里只有一句时弹窗与左侧那句一模一样 → 没意义）。
 * 没抽出关键字的句子照样列出，标淡色 + 「无关键字」（它们同时也在底部废原文区）。
 */
const originalSentences = computed<NanokaBuffSentence[]>(() =>
  originalItem.value ? originalItem.value.sentences : [],
)

// ---------------------------------------------------------------- 废原文（按来源块 · 整段原文）

/**
 * 底部「废原文」区（用户 2026-10-16 改造）：**按来源块展示原封不动的整块原文**，
 * 不删字、不逐句拆条；解析不出的句子只做**淡色 / 下划线**标记，可切「整段 / 仅废句」。
 * 排序与主视图一致（核心被动 → 额外能力 → 招式文本 → 影画 1..6；音擎：基础 → 精炼 1..5）。
 */
const wasteOnlySentences = ref(false) // false = 整段（默认）；true = 只看废句

interface WasteBlockRow {
  itemKey: string
  sourceTag: string
  rawText: string
  wasteSentences: { sentenceIndex: number; text: string; reasons: string[] }[]
  segments: { text: string; waste: boolean }[]
}

const wasteBlocks = computed<WasteBlockRow[]>(() => {
  const blocks: WasteBlockRow[] = []
  for (const item of items.value) {
    // **整块 0 条关键字 → 直接不显示**（既不在主视图、也不在废原文区）：
    // 例「招式文本（支援技）· 快速支援：急救」整块都是机制描述，一条增益都产不出。
    if (!(item.sentences ?? []).some((sentence) => sentence.hasKeywords)) continue
    const wasteSentences = (item.sentences ?? [])
      .filter((sentence) => !sentence.hasKeywords)
      .map((sentence) => ({
        sentenceIndex: sentence.sentenceIndex,
        text: sentence.rawSentence,
        reasons: [...new Set(sentence.waste.map((entry) => entry.reason))],
      }))
    if (!wasteSentences.length) continue
    // 在整块原文里给「废句」打标（顺序扫描，避免重复文本错位）
    const segments: { text: string; waste: boolean }[] = []
    let cursor = 0
    for (const sentence of wasteSentences) {
      const index = item.rawText.indexOf(sentence.text, cursor)
      if (index < 0) continue
      if (index > cursor) segments.push({ text: item.rawText.slice(cursor, index), waste: false })
      segments.push({ text: sentence.text, waste: true })
      cursor = index + sentence.text.length
    }
    if (cursor < item.rawText.length) segments.push({ text: item.rawText.slice(cursor), waste: false })
    blocks.push({
      itemKey: item.slot,
      sourceTag: item.title ? `${item.slotLabel} · ${item.title}` : item.slotLabel,
      rawText: item.rawText,
      wasteSentences,
      segments: segments.length ? segments : [{ text: item.rawText, waste: false }],
    })
  }
  return blocks.sort((left, right) => {
    const a = slotSortKey(left.itemKey)
    const b = slotSortKey(right.itemKey)
    if (a[0] !== b[0]) return a[0] - b[0]
    if (a[1] !== b[1]) return a[1] - b[1]
    return a[2].localeCompare(b[2])
  })
})

// ---------------------------------------------------------------- Row 组装

function defaultGain(effect: NanokaLayerCEffect): BuffEffect | null {
  return normalizeBuffEffect(effect)
}

function toRow(effect: NanokaKeywordEffect, item: NanokaBuffItem, index: number): KeywordRow {
  const key = `${item.slot}#${index}`
  return {
    key,
    itemKey: item.slot,
    itemSlot: item.slot,
    itemSlotLabel: item.slotLabel,
    source: item.source,
    containerIndex: item.containerIndex,
    blockHint: item.landing?.blockHint ?? '',
    title: item.title,
    rawText: item.rawText,
    origin: effect.origin,
    sentence: effect.sentence,
    sentenceIndex: Number(effect.unitIndex ?? 0),
    slots: {
      stat: String(effect.slots.stat ?? NONE),
      elements: Array.isArray(effect.slots.elements) ? [...effect.slots.elements] : [NONE],
      action: String(effect.slots.action ?? NONE),
      value: effect.slots.value,
      unit: String(effect.slots.unit ?? NONE),
      target: String(effect.slots.target ?? NONE),
      conditions: Array.isArray(effect.slots.conditions) ? [...effect.slots.conditions] : [NONE],
      scope: String(effect.slots.scope ?? NONE),
      stacks: String(effect.slots.stacks ?? NONE),
      duration: String(effect.slots.duration ?? NONE),
      object: String(effect.slots.object ?? NONE),
    },
    convert: effect.convert ? { ...effect.convert } : null,
    stackMax: effect.stackMax,
    durationSeconds: effect.durationSeconds,
    anchors: effect.anchors,
    skillLimits: Array.isArray(effect.skillLimits) ? effect.skillLimits.map((item) => ({ ...item })) : [],
    inherited: effect.inherited ?? null,
    tautologyDropped: Array.isArray(effect.tautologyDropped) ? [...effect.tautologyDropped] : [],
    collection: effect.collection ? { ...effect.collection } : undefined,
    sources: { ...effect.sources },
    recorded: effect.recorded,
    dropReason: effect.dropReason,
    unableSlots: [...(effect.unableSlots ?? [])],
    skillDesc: item.skillDesc,
    detailOpen: false,
    // 默认全部加入（可写条目全勾选）；用户可在阶段二把不想加入的去掉
    included: true,
    keywordDirty: false,
    gain: effect.layerC ? defaultGain(effect.layerC) : null,
    dirty: {},
    conflicts: [],
    stale: false,
    blocked: false,
    blockReason: '',
    added: false,
    writeLabel: '',
  }
}

function applyExtractResult(result: NanokaExtractResult) {
  items.value = result.items
  meta.value = result.meta
  localName.value = result.localName
  nanokaName.value = result.name
  nanokaId.value = result.nanokaId
  rows.value = result.items.flatMap((item) =>
    item.effects.map((effect, index) => toRow(effect, item, index)),
  )
  draftSlots.value = createNanokaBuffDraft(kind.value, rows.value)
  activeDraftSlot.value = kind.value === 'agent' ? '0' : 'fixed'
  page.value = 'stage1'
  writePlan.value = null
  writeMessage.value = ''
}

function resetAll() {
  if (autoParseTimer) clearTimeout(autoParseTimer)
  draftSlots.value = {}
  confirmVisible.value = false
  items.value = []
  rows.value = []
  meta.value = null
  localName.value = ''
  nanokaName.value = ''
  nanokaId.value = ''
  writePlan.value = null
  writeMessage.value = ''
  page.value = 'stage1'
  message.value = ''
  statusLine.value = ''
}

// ---------------------------------------------------------------- 错误 / 会话

function handleAuthError() {
  authDialogVisible.value = true
  messageKind.value = 'err'
  message.value = '管理员会话无效或已过期，请重新登录后再抓取 / 写入'
}

function handleError(err: unknown, fallback: string) {
  if (isNanokaBuffsAuthError(err)) {
    handleAuthError()
    return
  }
  messageKind.value = 'err'
  message.value = err instanceof Error ? err.message : fallback
}

function goRelogin() {
  authDialogVisible.value = false
  clearAdminAuthenticated()
  void router.push({
    path: '/admin/login',
    query: { redirect: router.currentRoute.value.fullPath },
  })
}

// ---------------------------------------------------------------- 浏览器抓 nanoka

interface IndexEntry {
  code?: string
  zh?: string
  en?: string
}

let indexMap: Record<string, IndexEntry> = {}
let indexKind: NanokaBuffKind | '' = ''

function nanokaUrl(path: string) {
  return `${NANOKA_STATIC}${path}`
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return '请求超时'
    return err.message
  }
  return String(err)
}

async function fetchNanokaJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}（${url}）`)
    const text = await response.text()
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new Error(`${url} 返回的不是合法 JSON`)
    }
  } finally {
    window.clearTimeout(timer)
  }
}

function readBuildTag(manifest: unknown): string {
  if (!manifest || typeof manifest !== 'object') return ''
  const zzz = (manifest as { zzz?: unknown }).zzz
  if (!zzz || typeof zzz !== 'object') return ''
  const latest = (zzz as { latest?: unknown }).latest
  return typeof latest === 'string' ? latest : ''
}

function normName(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[「」\s·:：]/g, '')
    .toLowerCase()
}

function normKey(raw: unknown): string {
  return normName(raw).replace(/[_\-‐-―]/g, '')
}

async function loadIndex(): Promise<string> {
  if (indexKind === kind.value && Object.keys(indexMap).length) return buildTag.value
  const manifest = await fetchNanokaJson(nanokaUrl('/manifest.json'), INDEX_TIMEOUT_MS)
  const tag = readBuildTag(manifest)
  if (!tag) throw new Error('manifest.json 里没有 zzz.latest，拿不到 build tag')
  const file = kind.value === 'agent' ? 'character.json' : 'weapon.json'
  const raw = await fetchNanokaJson(nanokaUrl(`/zzz/${tag}/${file}`), INDEX_TIMEOUT_MS)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${file} 不是对象，拿不到索引`)
  }
  indexMap = raw as Record<string, IndexEntry>
  indexKind = kind.value
  buildTag.value = tag
  return tag
}

function resolveNanokaRef(): { nanokaId: string; meta: IndexEntry } {
  const wantId = kind.value === 'agent' ? normName(selectedId.value) : normKey(selectedId.value)
  const wantName = normName(selectedLocal.value?.name ?? '')
  const entries = Object.entries(indexMap)
  const hit =
    kind.value === 'agent'
      ? (entries.find(([, item]) => wantId && normName(item.code) === wantId) ??
        entries.find(([, item]) => wantName && normName(item.zh) === wantName))
      : (entries.find(([, item]) => wantName && normName(item.zh) === wantName) ??
        entries.find(([, item]) => wantId && normKey(item.en) === wantId))
  if (!hit) {
    throw new Error(
      `nanoka 索引里没有这个${kindLabel.value}（${kind.value === 'agent' ? 'code / zh' : 'zh / en'} 都没对上）；先在「nanoka 采集」面板确认本地名与 nanoka 名是否一致`,
    )
  }
  return { nanokaId: hit[0], meta: hit[1] }
}

async function fetchAndExtract() {
  if (busy.value) return
  if (!selectedId.value) {
    messageKind.value = 'err'
    message.value = `请先选一个本地${kindLabel.value}`
    return
  }
  fetching.value = true
  message.value = ''
  statusLine.value = ''
  writePlan.value = null
  try {
    const tag = await loadIndex()
    const resolved = resolveNanokaRef()
    statusLine.value = `build ${tag} · nanoka #${resolved.nanokaId} · 正在抓详情…`
    const detail = await fetchNanokaJson(
      nanokaUrl(`/zzz/${tag}/zh/${kind.value === 'agent' ? 'character' : 'weapon'}/${resolved.nanokaId}.json`),
      DETAIL_TIMEOUT_MS,
    )
    fetching.value = false
    extracting.value = true
    statusLine.value = `build ${tag} · nanoka #${resolved.nanokaId} · 已抓到详情，正在抽取关键字…`
    const { result, message: serverMessage } = await extractNanokaBuffs({
      kind: kind.value,
      nanokaId: resolved.nanokaId,
      meta: resolved.meta,
      detail,
    })
    applyExtractResult(result)
    messageKind.value = 'ok'
    message.value = serverMessage
    statusLine.value = `build ${tag} · nanoka #${resolved.nanokaId}（${result.name}）→ 本地 ${result.localId}`
  } catch (err) {
    if (isNanokaBuffsAuthError(err)) {
      handleAuthError()
      return
    }
    messageKind.value = 'err'
    message.value = `${NANOKA_NETWORK_HINT}（${describeError(err)}）`
    statusLine.value = ''
  } finally {
    fetching.value = false
    extracting.value = false
  }
}

function onKindChange() {
  selectedId.value = ''
  localQuery.value = ''
  indexMap = {}
  indexKind = ''
  buildTag.value = ''
  resetAll()
}

// ---------------------------------------------------------------- [化简]（阶段一）

function mergeSimplified(
  slot: string,
  simplified: {
    effects: NanokaKeywordEffect[]
    sentences: NanokaBuffSentence[]
    waste: { sentenceIndex?: number; text: string; reason: string }[]
  },
) {
  const item = items.value.find((entry) => entry.slot === slot)
  if (!item) return
  item.effects = simplified.effects
  item.waste = simplified.waste
  item.verdict = simplified.effects.some((effect) => effect.recorded) ? 'buff' : 'waste'
  rows.value = rows.value.filter((row) => row.itemKey !== slot)
  simplified.effects.forEach((effect, index) => {
    rows.value.push(toRow(effect, item, index))
  })
  for (const blocks of Object.values(draftSlots.value)) {
    const index = blocks.findIndex((block) => block.id === `nanoka-${slot}`)
    if (index >= 0) blocks.splice(index, 1)
  }
  refreshNanokaBuffDraft(kind.value, draftSlots.value, rows.value)
  // 按句配对视图跟着刷新（废原文区由 wasteSentences 计算，不必另存）
  item.sentences = simplified.sentences ?? []
  item.waste = simplified.waste ?? []
  item.effects = simplified.effects
}

async function simplifyOne(slot: string) {
  if (busy.value) return
  const item = items.value.find((entry) => entry.slot === slot)
  if (!item) return
  simplifying.value = true
  message.value = ''
  try {
    const { result, message: serverMessage } = await simplifyNanokaBuffs({
      kind: kind.value,
      nanokaId: nanokaId.value,
      corePassiveText: items.value.find((entry) => entry.slot === 'core')?.rawText,
      items: [
        {
          slot: item.slot,
          slotLabel: item.slotLabel,
          source: item.source,
          containerIndex: item.containerIndex,
          rawText: item.rawText,
          origin: `nanoka:${nanokaId.value}:resimplify:${item.slot}`,
          agentId: kind.value === 'agent' ? selectedId.value : '',
          landing: item.landing,
          skillDesc: item.skillDesc,
        },
      ],
    })
    const simplified = result.items[0]
    if (simplified) {
      mergeSimplified(slot, {
        effects: simplified.effects,
        sentences: simplified.sentences ?? [],
        waste: simplified.waste,
      })
      messageKind.value = 'ok'
      message.value = `${item.slotLabel}：${serverMessage}`
    }
  } catch (err) {
    handleError(err, '化简失败')
  } finally {
    simplifying.value = false
  }
}

async function simplifyAll() {
  if (busy.value || !items.value.length) return
  simplifying.value = true
  message.value = ''
  try {
    const { result, message: serverMessage } = await simplifyNanokaBuffs({
      kind: kind.value,
      nanokaId: nanokaId.value,
      items: items.value.map((item) => ({
        slot: item.slot,
        slotLabel: item.slotLabel,
        source: item.source,
        containerIndex: item.containerIndex,
        rawText: item.rawText,
        origin: `nanoka:${nanokaId.value}:resimplify:${item.slot}`,
        agentId: kind.value === 'agent' ? selectedId.value : '',
        landing: item.landing,
        skillDesc: item.skillDesc,
      })),
    })
    for (const simplified of result.items) {
      mergeSimplified(simplified.slot, {
        effects: simplified.effects,
        sentences: simplified.sentences ?? [],
        waste: simplified.waste,
      })
    }
    messageKind.value = 'ok'
    message.value = `全部化简完成：${serverMessage}`
  } catch (err) {
    handleError(err, '全部化简失败')
  } finally {
    simplifying.value = false
  }
}

// ---------------------------------------------------------------- 关键字编辑

/**
 * 关键字一改就**自动重算这一行的阶段二**（用户 2026-10-17：不该再有「点 [解析]」这一步）。
 * 控件都是离散的（下拉 / 按钮 / change），一次改动触发一次；250ms 合并连点。
 */
let autoParseTimer: ReturnType<typeof setTimeout> | undefined
function scheduleAutoParse(row: KeywordRow) {
  const key = row.key
  if (autoParseTimer) clearTimeout(autoParseTimer)
  autoParseTimer = setTimeout(() => {
    autoParseTimer = undefined
    if (!rows.value.some((item) => item.key === key)) return
    void runParse([key])
  }, 250)
}

function markKeywordDirty(row: KeywordRow) {
  row.keywordDirty = true
  row.writeLabel = ''
  scheduleAutoParse(row)
}

function setSlot(row: KeywordRow, slotId: string, value: unknown) {
  if (isNumberSlot(slotId)) {
    const num = Number(value)
    const numeric = Number.isFinite(num) ? num : String(value)
    if (slotId === 'value') row.slots.value = numeric
    else if (row.convert) {
      if (slotId === 'convertRatio') row.convert.convertRatio = numeric
      if (slotId === 'convertBase') row.convert.convertBase = Number.isFinite(num) ? num : null
      if (slotId === 'convertCap') row.convert.convertCap = Number.isFinite(num) ? num : null
    }
  } else if (slotId === 'convertFrom' && row.convert) {
    row.convert.convertFrom = String(value)
  } else if (slotId === 'convertPanelSource' && row.convert) {
    row.convert.convertPanelSource = String(value)
  } else if (slotId === 'conditions') {
    // 多值槽位也能整槽写入（条件下拉在「无法提取」态走这里，别再静默丢掉）
    row.slots.conditions = Array.isArray(value) ? value.map((item) => String(item)) : [String(value)]
  } else if (slotId === 'elements') {
    row.slots.elements = Array.isArray(value) ? value.map((item) => String(item)) : [String(value)]
  } else if (SINGLE_TEXT_SLOT_IDS.includes(slotId)) {
    ;(row.slots as unknown as Record<string, string>)[slotId] = String(value)
  } else {
    // 没接的槽位 id **必须炸出来**：用户 2026-10-21 报的「条件改了不保存」就是这里少了分支、被静默吞掉
    throw new Error(`setSlot: 槽位 ${slotId} 没有写入分支`)
  }
  syncUnableSlot(row, slotId, (row.slots as unknown as Record<string, unknown>)[slotId])
  markKeywordDirty(row)
}

/**
 * 槽位改完同步 `unableSlots`：值里还有 `无法提取` → 记上（阶段二的「按无处理」提示才准）；
 * 改成真值 / `无` 了 → 摘掉（不然提示会残留成假话）。
 */
function syncUnableSlot(row: KeywordRow, slotId: string, value: unknown) {
  const hasUnable = Array.isArray(value) ? value.includes(UNABLE) : String(value ?? '').trim() === UNABLE
  const listed = row.unableSlots.includes(slotId)
  if (hasUnable && !listed) row.unableSlots = [...row.unableSlots, slotId]
  if (!hasUnable && listed) row.unableSlots = row.unableSlots.filter((id) => id !== slotId)
}

function multiValues(row: KeywordRow, slotId: string): string[] {
  if (slotId === 'conditions') return row.slots.conditions
  if (slotId === 'elements') return row.slots.elements
  return []
}

function addMulti(row: KeywordRow, slotId: string) {
  const list = multiValues(row, slotId).filter((item) => item !== NONE && item !== '')
  list.push('')
  if (slotId === 'conditions') row.slots.conditions = list.length ? list : [NONE]
  else row.slots.elements = list.length ? list : [NONE]
  syncUnableSlot(row, slotId, multiValues(row, slotId))
  markKeywordDirty(row)
}

function setMulti(row: KeywordRow, slotId: string, index: number, value: string) {
  const list = [...multiValues(row, slotId)]
  list[index] = value
  if (slotId === 'conditions') row.slots.conditions = list
  else row.slots.elements = list
  syncUnableSlot(row, slotId, list)
  markKeywordDirty(row)
}

function removeMulti(row: KeywordRow, slotId: string, index: number) {
  const list = multiValues(row, slotId).filter((_, i) => i !== index)
  const next = list.length ? list : [NONE]
  if (slotId === 'conditions') row.slots.conditions = next
  else row.slots.elements = next
  syncUnableSlot(row, slotId, next)
  markKeywordDirty(row)
}

function removeRow(row: KeywordRow) {
  rows.value = rows.value.filter((entry) => entry.key !== row.key)
  for (const blocks of Object.values(draftSlots.value)) {
    for (const block of blocks) block.effects = block.effects.filter((effect) => effect.origin !== row.key)
  }
  messageKind.value = 'ok'
  message.value = `已删除该条关键字及其待录入效果`
}

// ---------------------------------------------------------------- 增益编辑（阶段二）

// ---------------------------------------------------------------- [解析]（智能覆盖）

function keywordPayload() {
  return rows.value.map((row) => ({
    key: row.key,
    slots: { ...row.slots, conditions: [...row.slots.conditions] },
    convert: row.convert ? { ...row.convert } : null,
    stackMax: row.stackMax,
    durationSeconds: row.durationSeconds,
    anchors: row.anchors,
    rawText: row.sentence,
    origin: row.origin,
  }))
}

function mergeParseRows(parsed: NanokaParseResultRow[]) {
  const byKey = new Map(parsed.map((row) => [row.key, row]))
  const next: KeywordRow[] = []
  const usedKeys = new Set<string>()
  for (const row of rows.value) {
    const result = byKey.get(row.key)
    if (!result) {
      next.push(row)
      continue
    }
    usedKeys.add(row.key)
    next.push({
      ...row,
      gain:
        result.effect == null
          ? row.gain
          : defaultGain(result.effect as NanokaLayerCEffect),
      conflicts: result.conflicts ?? [],
      stale: Boolean(result.stale),
      blocked: Boolean(result.blocked),
      blockReason: result.blockReason ?? '',
      added: Boolean(result.added),
      keywordDirty: false,
    })
  }
  // 关键字新增 → 追加新行
  for (const result of parsed) {
    if (usedKeys.has(result.key)) continue
    const keyword = rows.value.find((row) => row.key === result.key)
    if (result.effect == null || !keyword) continue
    next.push({
      ...keyword,
      gain: defaultGain(result.effect as NanokaLayerCEffect),
      conflicts: result.conflicts ?? [],
      added: true,
      stale: false,
      blocked: false,
    })
  }
  rows.value = next
}

async function runParse(targetKeys?: string[]) {
  if (busy.value || !rows.value.length) return
  const selectedRows = targetKeys?.length
    ? rows.value.filter((row) => targetKeys.includes(row.key))
    : rows.value
  if (!selectedRows.length) return
  rememberNanokaDraftEdits(draftSlots.value, rows.value)
  parsing.value = true
  message.value = ''
  try {
    const { result, message: serverMessage } = await parseNanokaBuffs({
      rows: selectedRows.map((row) => ({
        key: row.key,
        effect: row.gain ? ({ ...row.gain } as Partial<NanokaLayerCEffect>) : null,
        dirty: { ...row.dirty },
      })),
      keywords: keywordPayload().filter((keyword) => selectedRows.some((row) => row.key === keyword.key)),
      agentId: kind.value === 'agent' ? selectedId.value : '',
    })
    mergeParseRows(result.rows)
    refreshNanokaBuffDraft(kind.value, draftSlots.value, rows.value)
    messageKind.value = 'ok'
    message.value = serverMessage
    // 切页**只能由用户点页签**（用户 2026-10-21 报的 bug：改完条件下拉就被甩到阶段二）：
    // 这里以前有一句 `if (page === 'stage1') page = 'stage2'`，而「关键字一改就自动重算」走的也是
    // 这个函数 —— 于是任何一次编辑都会顺手把用户踢到阶段二。去掉它：编辑不换页、重算不换页。
  } catch (err) {
    handleError(err, '解析失败')
  } finally {
    parsing.value = false
  }
}

/**
 * 切页（用户 2026-10-17）：切到阶段二时**自动重算**，不再单独放一个「全部解析」按钮 ——
 * 这点计算量不值得多按一次。只有关键字被改过（`keywordDirty`）才重算，没改就是纯切页。
 */
async function switchPage(next: Page) {
  page.value = next
  if (next !== 'stage2') return
  if (!rows.value.some((row) => row.keywordDirty)) return
  await runParse()
}

function resolveConflict(row: KeywordRow, conflict: NanokaParseConflict, choice: 'mine' | 'theirs') {
  if (!row.gain) return
  if (choice === 'theirs') {
    const field = conflict.field as keyof BuffEffect
    row.gain = { ...row.gain, [field]: conflict.theirs } as BuffEffect
    row.dirty = { ...row.dirty, [conflict.field]: false }
  } else {
    row.dirty = { ...row.dirty, [conflict.field]: true }
  }
  row.conflicts = row.conflicts.filter((item) => item.field !== conflict.field)
  if (choice === 'theirs') {
    for (const blocks of Object.values(draftSlots.value)) {
      for (const block of blocks) {
        for (const effect of block.effects) {
          if (effect.origin === row.key) Object.assign(effect, { [conflict.field]: conflict.theirs })
        }
      }
    }
  }
}

// ---------------------------------------------------------------- 阶段二：左选右看（主从布局）

/**
 * **清单排序**（用户 2026-10-16）：`核心被动 → 额外能力 → 招式文本（按类别 / 招式）→ 影画 1..6`；
 * 音擎 = `基础(fixed) → 精炼 1..5`。**影画固定最后**，不许混在中间。下拉选项顺序与清单一致。
 */
const SLOT_SORT_GROUPS: Record<string, number> = { core: 0, extra: 1, fixed: 0 }
const SKILL_CATEGORY_ORDER = ['basic', 'dodge', 'assist', 'special', 'chain', 'ultimate']

function slotSortKey(slot: string): [number, number, string] {
  if (slot in SLOT_SORT_GROUPS) return [SLOT_SORT_GROUPS[slot] ?? 0, 0, slot]
  if (slot.startsWith('skill-')) {
    const category = slot.split('-')[1] ?? ''
    const index = SKILL_CATEGORY_ORDER.indexOf(category)
    return [2, index < 0 ? 99 : index, slot]
  }
  const talent = /^talent-(\d+)$/.exec(slot)
  if (talent) return [3, Number(talent[1]), slot] // 影画 1..6 固定最后
  const refinement = /^refinement-(\d+)$/.exec(slot)
  if (refinement) return [1, Number(refinement[1]), slot] // 音擎：基础 → 精炼 1..5
  return [9, 0, slot]
}

/** 阶段二清单 / 下拉都用这个顺序（影画最后） */
const orderedRows = computed(() =>
  [...rows.value].sort((left, right) => {
    const a = slotSortKey(left.itemSlot)
    const b = slotSortKey(right.itemSlot)
    if (a[0] !== b[0]) return a[0] - b[0]
    if (a[1] !== b[1]) return a[1] - b[1]
    if (a[2] !== b[2]) return a[2].localeCompare(b[2])
    return left.sentenceIndex - right.sentenceIndex || left.key.localeCompare(right.key)
  }),
)

const draftSlots = ref<NanokaDraftSlots>({})
const activeDraftSlot = ref('0')
const draftSlotOptions = computed(() => kind.value === 'agent'
  ? Array.from({ length: 7 }, (_, index) => ({ id: String(index), label: `${index}影` }))
  : [{ id: 'fixed', label: '基础' }, ...Array.from({ length: 5 }, (_, index) => ({ id: String(index), label: `精${index + 1}` }))])
const activeDraftBlocks = computed<BuffEffectBlock[]>({
  get: () => draftSlots.value[activeDraftSlot.value] ?? [],
  set: (blocks) => { draftSlots.value[activeDraftSlot.value] = blocks },
})
const conflictRows = computed(() => orderedRows.value.filter((row) => row.conflicts.length || row.blocked))
watch(draftSlots, () => {
  writePlan.value = null
  writeMessage.value = ''
  confirmVisible.value = false
}, { deep: true })
watch(selectedId, () => resetAll())
onBeforeUnmount(() => { if (autoParseTimer) clearTimeout(autoParseTimer) })

// ---------------------------------------------------------------- 写入（准备 → 确认写入）

function buildApplyRows(): NanokaApplyRow[] {
  return nanokaDraftApplyRows(kind.value, draftSlots.value, rows.value)
}

async function runApply(dryRun: boolean) {
  if (busy.value) return
  if (!selectedId.value) {
    messageKind.value = 'err'
    message.value = `请先选一个本地${kindLabel.value}`
    return
  }
  rememberNanokaDraftEdits(draftSlots.value, rows.value)
  const validation = Object.values(draftSlots.value).flatMap((blocks) => validateEffectGroups(blocks).errors)
  if (validation.length || conflictRows.value.some((row) => row.conflicts.length)) {
    messageKind.value = 'err'
    message.value = validation.join('；') || '请先处理解析冲突，再准备写入'
    return
  }
  if (!buildApplyRows().length) {
    messageKind.value = 'err'
    message.value = '没有可写入的增益行（招式锚点关联不上的条目不录；被阻断的条目先补关键字）'
    return
  }
  writing.value = true
  message.value = ''
  try {
    const { result, message: serverMessage } = await applyNanokaBuffs({
      kind: kind.value,
      id: selectedId.value,
      rows: buildApplyRows(),
      dryRun,
    })
    writePlan.value = result
    const labelByKey = new Map<string, string>()
    for (const detail of result.details) {
      for (const effect of detail.effects) labelByKey.set(String(effect.id), effect.writeLabel)
    }
    for (const row of rows.value) {
      const label = labelByKey.get(row.key)
      if (label) row.writeLabel = label
    }
    messageKind.value = result.writeError ? 'err' : 'ok'
    message.value = serverMessage
    writeMessage.value = serverMessage
    if (dryRun) confirmVisible.value = true
    else {
      confirmVisible.value = false
      // 真的写进去了 → 0 增益列表要重新查（处理完的条目从列表消失；只读查询）
      if (!result.writeError) {
        await store.loadAll(true)
        void loadEmptyTargets()
      }
    }
  } catch (err) {
    handleError(err, '写入失败')
  } finally {
    writing.value = false
  }
}

function closeConfirm() {
  if (writing.value) return
  confirmVisible.value = false
}

const confirmMessage = computed(() => {
  const plan = writePlan.value
  if (!plan) return '还没有写入准备结果。'
  const blocks = plan.details
    .filter((detail) => detail.ok)
    .map(
      (detail) =>
        `${detail.container}[${detail.containerIndex ?? '-'}] · 块「${detail.blockName ?? ''}」：新增 ${detail.added} / 重复跳过 ${detail.duplicates}`,
    )
  const skills = plan.skillDescs.map(
    (item) =>
      `招式「${item.skillName}」描述：${item.appended ? '追加' : item.duplicate ? '已含' : '未改'}${item.reason ? `（${item.reason}）` : ''}`,
  )
  return [`将新增 ${plan.updated} 条增益 / 重复跳过 ${plan.skipped}`, ...blocks, ...skills]
    .filter(Boolean)
    .join('\n')
})

const canWrite = computed(() => buildApplyRows().length > 0 && !busy.value)

const wasteOpen = ref(true)
const wasteCount = computed(() =>
  wasteBlocks.value.reduce((total, block) => total + block.wasteSentences.length, 0),
)
</script>

<template>
  <section class="editor-panel nanoka-buff-panel">
    <header class="panel-header">
      <h2 class="panel-title">nanoka 增益（关键字 → 增益块）</h2>
      <p class="panel-desc">
        阶段一：校对原文与关键字。阶段二：按效果块编辑实际增益，录入方式与正式增益库一致。
        抓取在浏览器里做，写入只在点「确认写入」时发生；`无法提取` 是槽位级标记，废原文整条不入库。
      </p>
    </header>

    <div class="nbf-toolbar">
      <div class="nbf-kind-tabs">
        <button
          type="button"
          class="nbf-tab"
          :disabled="busy"
          :class="{ active: kind === 'agent' }"
          @click="kind = 'agent'; onKindChange()"
        >
          角色
        </button>
        <button
          type="button"
          class="nbf-tab"
          :disabled="busy"
          :class="{ active: kind === 'wengine' }"
          @click="kind = 'wengine'; onKindChange()"
        >
          音擎
        </button>
      </div>
      <label class="field nbf-field">
        <span class="field-label">搜索本地{{ kindLabel }}</span>
        <input v-model="localQuery" type="text" class="field-input" placeholder="名称 / ID" />
      </label>
      <label class="field nbf-field nbf-field-wide">
        <span class="field-label">本地{{ kindLabel }}</span>
        <select v-model="selectedId" class="field-input" :disabled="busy">
          <option value="">请选择…</option>
          <option v-for="option in selectOptions" :key="option.id" :value="option.id">
            {{ option.name }}{{ option.meta ? `（${option.meta}）` : '' }}
          </option>
        </select>
      </label>
      <button type="button" class="primary-btn" :disabled="busy || !selectedId" @click="fetchAndExtract">
        {{ fetching ? '抓取中…' : extracting ? '抽取中…' : '抓取增益' }}
      </button>
      <!-- 「找空活干」：列出 0 增益的目标，点一项直接选中（不自动抓取，避免误触） -->
      <button
        type="button"
        class="secondary-btn nbf-empty-btn"
        :disabled="emptyLoading"
        @click="openEmptyTargets"
      >
        {{ emptyButtonLabel }}
      </button>
      <button type="button" class="secondary-btn" @click="openRules">解析规则</button>
    </div>

    <p v-if="statusLine" class="nbf-status">{{ statusLine }}</p>
    <p v-if="message" :class="messageKind === 'ok' ? 'form-success' : 'form-error'">{{ message }}</p>

    <div v-if="items.length" class="nbf-page-tabs">
      <button
        type="button"
        class="nbf-tab"
        :class="{ active: page === 'stage1' }"
        @click="switchPage('stage1')"
      >
        阶段一 · 原文 → 关键字
      </button>
      <button
        type="button"
        class="nbf-tab"
        :class="{ active: page === 'stage2' }"
        @click="switchPage('stage2')"
      >
        阶段二 · 关键字 → 增益
      </button>
      <span class="nbf-count">
        关键字 {{ rows.length }} 条 · 待录入 {{ buildApplyRows().length }} 条 ·
        废句 {{ wasteCount }} 句（{{ wasteBlocks.length }} 个有增益的块）
      </span>
    </div>

    <!-- ============================================================ 阶段一 -->
    <div v-show="page === 'stage1'" class="nbf-stage">
      <header class="nbf-stage-head">
        <h3>阶段一 · 原文 → 关键字</h3>
        <div class="nbf-stage-actions">
          <button
            type="button"
            class="secondary-btn"
            :disabled="busy || !items.length"
            @click="simplifyAll"
          >
            {{ simplifying ? '化简中…' : '全部化简' }}
          </button>
        </div>
      </header>

      <!-- 一句原文 ↔ 该句的关键字：按句配对（v3.24）。抽不出关键字的句子不进这里，只在底部废原文区 -->
      <p v-if="!items.length" class="empty-hint">还没有抽取结果：先选本地记录 → [抓取增益]。</p>
      <p v-else-if="!visibleItems.length" class="empty-hint">
        这次抽取没有任何句子产出关键字（全部进了底部「废原文」）。
      </p>
      <article v-for="item in visibleItems" :key="item.slot" class="nbf-item">
        <header class="nbf-item-head">
          <span class="nbf-chip">{{ item.slotLabel }}</span>
          <span class="nbf-item-title">{{ item.title }}</span>
          <span class="nbf-badge nbf-badge-ok">有增益 {{ keywordSentences(item).length }} 句</span>
          <span v-if="item.landing" class="nbf-sub">写入槽位：{{ item.landing.label }}</span>
          <button type="button" class="nbf-mini-btn" @click="openOriginal(item)">整块原文</button>
          <button type="button" class="nbf-mini-btn" :disabled="busy" @click="simplifyOne(item.slot)">
            化简
          </button>
        </header>
        <p v-if="item.skillDesc" class="nbf-sub">
          技能「描述」落点：{{ item.skillDesc.skillName }}
        </p>

        <!-- 一句一对：左 = 该句原文（约 1/3），右 = 该句的关键字（摘要行 + 展开区）；每对独立成块 -->
        <div
          v-for="sentence in keywordSentences(item)"
          :key="`${item.slot}-${sentence.sentenceIndex}`"
          class="nbf-pair"
        >
          <div class="nbf-pair-raw">
            <div class="nbf-pair-raw-head">
              <span class="nbf-chip">第 {{ sentence.sentenceIndex + 1 }} 句</span>
              <button
                type="button"
                class="nbf-mini-btn"
                @click="openOriginal(item, sentence.sentenceIndex)"
              >
                整块原文
              </button>
            </div>
            <p class="nbf-raw-text">{{ sentence.rawSentence }}</p>
          </div>
          <div class="nbf-pair-kw">
            <div
              v-for="(row, rowIndex) in rowsForSentence(item.slot, sentence.sentenceIndex)"
              :key="row.key"
              class="nbf-kw-row"
              :class="{ 'nbf-kw-row-off': !row.recorded }"
            >
                <header class="nbf-kw-head">
                  <span class="nbf-kw-index">B{{ rowIndex + 1 }}</span>
                  <span class="nbf-kw-summary">
                    属性={{ displaySlotValue('stat', row.slots.stat) }} · 动作={{ row.slots.action }}
                    <template v-if="row.slots.action !== '转化'">
                      · 数值={{ row.slots.value }}{{ row.slots.unit === '无' ? '' : row.slots.unit }}
                    </template>
                    <template v-else>· 转模</template>
                  </span>
                  <span v-if="row.skillLimits.length" class="nbf-badge nbf-badge-anchor">
                    限定招式（锚点）：{{ row.skillLimits.map((item) => item.name).join(' + ') }}
                  </span>
                  <span v-if="row.tautologyDropped.length" class="nbf-badge nbf-badge-muted">
                    同义反复已忽略
                  </span>
                  <!-- 合集扇出：只标来源（抽取层），不入库、不进结算 -->
                  <span
                    v-if="row.collection"
                    class="nbf-badge nbf-badge-collection"
                    :title="row.collection.note"
                  >
                    合集：{{ row.collection.title }}
                  </span>
                  <span v-if="row.inherited" class="nbf-badge nbf-badge-inherit">
                    {{ row.inherited.label }}
                  </span>
                  <span v-if="!row.recorded" class="nbf-badge nbf-badge-drop">
                    这条不录 · {{ row.dropReason }}
                  </span>
                  <span v-if="row.keywordDirty" class="nbf-badge nbf-badge-warn">已改，正在按新关键字重算…</span>
                  <button type="button" class="nbf-mini-btn" @click="row.detailOpen = !row.detailOpen">
                    {{ row.detailOpen ? '收起' : '详情' }}
                  </button>
                  <button type="button" class="nbf-mini-btn nbf-danger" @click="removeRow(row)">删</button>
                </header>

                <p v-if="row.anchors.labels.length" class="nbf-sub">
                  招式锚点：{{ row.anchors.ok ? `已关联（${row.anchors.skillTargets.length} 个目标）` : '关联不上 → 不录' }}
                </p>

                <div class="nbf-slots">
                  <!--
                    槽位格子（用户 2026-10-21 报的 bug 修法）：
                    `无法提取` / `无` / 遗留旧值**一律有下拉**，选项里包含当前值 → 不再出现「请选择…」；
                    不录 / 被阻断的条显示**锁定态（禁用 + 当前值）**。
                    `无值` 槽位仍默认隐藏，[详情] 才铺开。
                  -->
                  <div
                    v-for="entry in slotEntries(row)"
                    :key="`s-${entry.id}`"
                    class="nbf-slot"
                    :class="{
                      'nbf-slot-unable': entry.unable,
                      'nbf-slot-empty': entry.hidden,
                      'nbf-slot-locked': isSlotLocked(row, entry.id),
                    }"
                    :title="isSlotLocked(row, entry.id) ? slotLockReason(row, entry.id) : slotHint(entry.id)"
                  >
                    <span class="nbf-slot-label" :title="slotHint(entry.id)">
                      <template v-if="entry.unable">⚠X {{ entry.label }}</template>
                      <template v-else>{{ entry.label }}</template>
                      <!-- 敌人削弱族的目标默认值是「全队」（原文没写明给谁）→ 淡色「默认」提示，方便一眼改 -->
                      <em
                        v-if="!entry.unable && String(row.sources[entry.id] ?? '').startsWith('default-team')"
                        class="nbf-default-mark"
                        >默认</em
                      >
                    </span>
                    <em v-if="entry.unable" class="nbf-unable-tag" :class="isHardUnable(entry.id) ? 'is-hard' : 'is-soft'">
                      {{ isHardUnable(entry.id) ? '待补（阻断）' : '按无处理' }}
                    </em>

                    <!-- 锁定态：禁用下拉，只显示当前值（不是「请选择…」） -->
                    <select
                      v-if="isSlotLocked(row, entry.id)"
                      class="field-input nbf-slot-input"
                      disabled
                      :title="slotLockReason(row, entry.id)"
                    >
                      <option :value="slotEditValue(entry)">{{ displaySlotValue(entry.id, slotEditValue(entry)) }}</option>
                    </select>

                    <!-- 多值槽位（条件 / 元素）：逐条列下拉，选项里含该条当前值 -->
                    <template v-else-if="MULTI_SLOT_IDS.includes(entry.id)">
                      <div class="nbf-conditions">
                        <div
                          v-for="(value, valueIndex) in multiValues(row, entry.id)"
                          :key="`m-${valueIndex}`"
                          class="nbf-condition"
                        >
                          <select
                            class="field-input nbf-slot-input"
                            :value="value"
                            @change="setMulti(row, entry.id, valueIndex, ($event.target as HTMLSelectElement).value)"
                          >
                            <option v-for="option in slotOptionsFor(entry.id, value)" :key="option" :value="option">
                              {{ displaySlotValue(entry.id, option) }}
                            </option>
                          </select>
                          <button
                            type="button"
                            class="nbf-mini-btn nbf-danger"
                            @click="removeMulti(row, entry.id, valueIndex)"
                          >
                            ×
                          </button>
                        </div>
                        <button type="button" class="nbf-multi-add" @click="addMulti(row, entry.id)">
                          ＋ 再加一条{{ entry.label }}（{{ entry.label }}可多选）
                        </button>
                      </div>
                    </template>

                    <!-- 数字槽位 -->
                    <input
                      v-else-if="isNumberSlot(entry.id)"
                      type="number"
                      class="field-input nbf-slot-input"
                      :value="entry.value"
                      @change="setSlot(row, entry.id, ($event.target as HTMLInputElement).value)"
                    />

                    <!-- 单值下拉：选项 = 白名单 + 当前值（`无法提取` / `无` / 遗留旧值都能显示、能改） -->
                    <select
                      v-else
                      class="field-input nbf-slot-input"
                      :value="slotEditValue(entry)"
                      @change="setSlot(row, entry.id, ($event.target as HTMLSelectElement).value)"
                    >
                      <option v-for="option in slotOptionsFor(entry.id, entry.value)" :key="option" :value="option">
                        {{ displaySlotValue(entry.id, option) }}
                      </option>
                    </select>
                  </div>
                </div>
              </div>
          </div>
        </div>
      </article>

      <section class="nbf-waste">
        <header class="nbf-stage-head">
          <h3>
            废原文（{{ wasteCount }} 句 · 来自 {{ wasteBlocks.length }} 个有增益的来源块 · 不入库）
          </h3>
          <div class="nbf-waste-actions">
            <div class="nbf-toggle">
              <button
                type="button"
                class="nbf-mini-btn"
                :class="{ active: !wasteOnlySentences }"
                @click="wasteOnlySentences = false"
              >
                整段
              </button>
              <button
                type="button"
                class="nbf-mini-btn"
                :class="{ active: wasteOnlySentences }"
                @click="wasteOnlySentences = true"
              >
                只看废句
              </button>
            </div>
            <button type="button" class="nbf-mini-btn" @click="wasteOpen = !wasteOpen">
              {{ wasteOpen ? '收起' : '展开' }}
            </button>
          </div>
        </header>
        <div v-if="wasteOpen" class="nbf-waste-blocks">
          <article v-for="block in wasteBlocks" :key="`wb-${block.itemKey}`" class="nbf-waste-block">
            <header class="nbf-waste-block-head">
              <span class="nbf-chip">{{ block.sourceTag }}</span>
              <span class="nbf-sub">{{ block.wasteSentences.length }} 句解析不出</span>
            </header>
            <!-- 整段：原封不动；解析不出的句子只做淡色 + 下划线标记（不删字、不拆条） -->
            <p v-if="!wasteOnlySentences" class="nbf-waste-raw">
              <template v-for="(segment, index) in block.segments" :key="`seg-${index}`">
                <span :class="{ 'nbf-waste-mark': segment.waste }">{{ segment.text }}</span>
              </template>
            </p>
            <!-- 只看废句：逐句列出（默认折叠原因） -->
            <ul v-else class="nbf-waste-lines">
              <li v-for="sentence in block.wasteSentences" :key="`wl-${sentence.sentenceIndex}`">
                <span class="nbf-chip">第 {{ sentence.sentenceIndex + 1 }} 句</span>
                <span class="nbf-waste-mark">{{ sentence.text }}</span>
              </li>
            </ul>
            <details v-if="block.wasteSentences.some((sentence) => sentence.reasons.length)" class="nbf-waste-reasons">
              <summary>丢弃原因（{{ block.wasteSentences.length }} 句）</summary>
              <ul>
                <li v-for="sentence in block.wasteSentences" :key="`wr-${sentence.sentenceIndex}`">
                  <span class="nbf-sub">第 {{ sentence.sentenceIndex + 1 }} 句</span>
                  <span class="nbf-waste-reason">{{ sentence.reasons.join(' / ') || '没抓到可量的增益' }}</span>
                </li>
              </ul>
            </details>
          </article>
        </div>
        <p v-if="wasteOpen && !wasteBlocks.length" class="empty-hint">没有废原文。</p>
      </section>

      <!-- 「整块原文」弹窗：这一段（整块）的完整原文，一句不删，并高亮当前句。
           没抽出关键字的句子标淡色（用户 2026-10-17）。
           **Teleport 到 body**：面板外层容器可能有 transform / overflow，会裁掉 position:fixed 的弹窗 -->
      <Teleport to="body">
        <div
          v-if="originalVisible && originalItem"
          class="nbf-modal-mask"
          @pointerdown="onMaskPointerDown"
          @click="onMaskClick"
        >
          <div class="nbf-modal">
            <header class="nbf-modal-head">
              <h4>{{ originalItem.slotLabel }} · {{ originalItem.title || '（无标题）' }} · 整块原文</h4>
              <button type="button" class="nbf-mini-btn" @click="closeOriginal">关闭</button>
            </header>
            <p class="nbf-sub">
              写入槽位：{{ originalItem.landing?.label ?? '—' }} ·
              这一段共 {{ originalSentences.length }} 句，原文一句不删；淡色句 = 没抽出关键字（同属废原文）
            </p>
            <ol class="nbf-original-list">
              <li
                v-for="sentence in originalSentences"
                :key="`o-${sentence.sentenceIndex}`"
                :class="{
                  'nbf-original-current': sentence.sentenceIndex === originalHighlight,
                  'nbf-original-nokw': !sentence.hasKeywords,
                }"
              >
                <span class="nbf-chip">第 {{ sentence.sentenceIndex + 1 }} 句</span>
                <span class="nbf-original-text">{{ sentence.rawSentence }}</span>
                <span class="nbf-sub">
                  {{ sentence.hasKeywords ? `${sentence.keywords.length} 条关键字` : '无关键字' }}
                </span>
              </li>
            </ol>
          </div>
        </div>

        <!-- 「解析规则」弹窗：数据全部来自后端 `/rules`（抽取器词表自动导出），界面不手写 -->
        <div
          v-if="rulesVisible"
          class="nbf-modal-mask"
          @pointerdown="onRulesMaskPointerDown"
          @click="onRulesMaskClick"
        >
          <div class="nbf-modal nbf-rules-modal">
            <header class="nbf-modal-head">
              <h4>解析规则对照表{{ rules ? ` · v${rules.version}` : '' }}</h4>
              <button type="button" class="nbf-mini-btn" @click="rulesVisible = false">关闭</button>
            </header>
            <p class="nbf-sub">
              {{ rulesLoading ? '读取中…' : rulesMessage }}
              · 由后端从抽取器词表**自动导出**（单一事实来源），界面不手写
            </p>
            <section v-for="group in rules?.groups ?? []" :key="group.id" class="nbf-rules-group">
              <h5>{{ group.title }}（{{ group.items.length }} 条）</h5>
              <ul class="nbf-rules-list">
                <li v-for="(item, index) in group.items.slice(0, 40)" :key="`r-${group.id}-${index}`">
                  <code>{{ item.game }}</code>
                  <span class="nbf-rules-arrow">→</span>
                  <span>{{ item.slot }}</span>
                  <template v-if="item.field">
                    <span class="nbf-rules-arrow">→</span>
                    <code>{{ item.field }}</code>
                  </template>
                  <span v-if="item.note" class="nbf-sub">{{ item.note }}</span>
                </li>
              </ul>
              <p v-if="group.items.length > 40" class="nbf-sub">…还有 {{ group.items.length - 40 }} 条（完整清单见 dev-docs 导出的 md）</p>
            </section>
          </div>
        </div>

        <!-- 「找空活干」弹窗：0 增益的角色 / 音擎；点一项 = 直接选中（不自动抓取） -->
        <div
          v-if="emptyVisible"
          class="nbf-modal-mask"
          @pointerdown="onEmptyMaskPointerDown"
          @click="onEmptyMaskClick"
        >
          <div class="nbf-modal nbf-empty-modal">
            <header class="nbf-modal-head">
              <h4>0 增益的{{ kindLabel }}（{{ emptyRows.length }} / {{ emptyData?.empty.length ?? localEmptyTargets.length }}）</h4>
              <button type="button" class="nbf-mini-btn" @click="emptyVisible = false">关闭</button>
            </header>
            <p class="nbf-sub">
              {{ emptyLoading ? '查询中…' : emptyMessage }}
              · 口径：该{{ kindLabel }}**所有增益容器里 effect 条数 = 0**（只数增益条，note / 原文不算）
              · 点一项 = 直接选中（不自动抓取）
            </p>
            <label class="field nbf-field">
              <span class="field-label">搜索</span>
              <input v-model="emptyQuery" type="text" class="field-input" placeholder="名称 / ID" />
            </label>
            <ul v-if="emptyRows.length" class="nbf-empty-list">
              <li v-for="row in emptyRows" :key="`et-${row.id}`">
                <button type="button" class="nbf-empty-item" @click="pickEmptyTarget(row)">
                  <span class="nbf-empty-name">{{ row.name }}</span>
                  <span class="nbf-chip">ID {{ row.id }}</span>
                  <span v-if="row.element || row.profession" class="nbf-sub">
                    {{ [row.element, row.profession].filter(Boolean).join(' · ') }}
                  </span>
                  <span v-if="row.rarity" class="nbf-sub">{{ row.rarity }}</span>
                </button>
              </li>
            </ul>
            <p v-else class="empty-hint">
              {{ emptyLoading ? '查询中…' : `没有 0 增益的${kindLabel}了（这个列表里的都处理完了）。` }}
            </p>
            <details v-if="emptyFewRows.length" class="nbf-empty-few">
              <summary>增益条很少的（≤ {{ emptyData?.fewThreshold ?? 2 }} 条 · {{ emptyFewRows.length }} 个，供参考）</summary>
              <ul class="nbf-empty-list">
                <li v-for="row in emptyFewRows" :key="`ef-${row.id}`">
                  <button type="button" class="nbf-empty-item" @click="pickEmptyTarget(row)">
                    <span class="nbf-empty-name">{{ row.name }}</span>
                    <span class="nbf-chip">ID {{ row.id }}</span>
                    <span class="nbf-sub">现有 {{ row.effectCount }} 条增益</span>
                  </button>
                </li>
              </ul>
            </details>
          </div>
        </div>
      </Teleport>
    </div>

    <!-- ============================================================ 阶段二 -->
    <div v-show="page === 'stage2'" class="nbf-stage">
      <header class="nbf-stage-head">
        <h3>阶段二 · 关键字 → 实际增益</h3>
        <div class="nbf-stage-actions">
          <button type="button" class="secondary-btn" @click="switchPage('stage1')">← 退回阶段一</button>
          <button type="button" class="primary-btn" :disabled="!canWrite" @click="runApply(true)">
            {{ writing ? '准备中…' : '写入（准备）' }}
          </button>
        </div>
      </header>

      <AdminBuffEffectEditor
        :key="`${kind}-${selectedId}-${activeDraftSlot}`"
        v-model="activeDraftBlocks"
        :agent-id="kind === 'agent' ? selectedId : undefined"
        :owner-kind="kind"
        :owner-label="localName || selectedLocal?.name"
        :default-first-block-name="kind === 'agent' ? `${activeDraftSlot} 影` : activeDraftSlot === 'fixed' ? '基础效果' : `精炼 ${Number(activeDraftSlot) + 1}`"
        :save-state="writing ? 'saving' : writePlan && !writePlan.dryRun && !writePlan.writeError ? 'saved' : 'dirty'"
      >
        <template #toolbar-extra>
          <div class="mindscape-tabs">
            <button v-for="slot in draftSlotOptions" :key="slot.id" type="button" class="mindscape-tab"
              :class="{ active: activeDraftSlot === slot.id }" @click="activeDraftSlot = slot.id">{{ slot.label }}</button>
          </div>
        </template>
      </AdminBuffEffectEditor>
      <p class="nbf-sub">删除效果或块即取消本次录入；已有增益保持保留。确认写入前可在上方切换影画／精炼检查各槽。</p>
      <section v-if="conflictRows.length" class="nbf-conflicts">
        <h4 class="nbf-col-title">解析校对</h4>
        <div v-for="row in conflictRows" :key="row.key">
          <p>{{ row.itemSlotLabel }} · {{ row.sentence }}</p>
          <p v-if="row.blocked" class="form-error">{{ row.blockReason }}</p>
          <div v-for="conflict in row.conflicts" :key="conflict.field" class="nbf-conflict">
            <span>{{ conflict.label }}：我的 {{ conflict.mine ?? '（空）' }} · 新解析 {{ conflict.theirs ?? '（空）' }}</span>
            <button type="button" class="nbf-mini-btn" @click="resolveConflict(row, conflict, 'mine')">保留我的</button>
            <button type="button" class="nbf-mini-btn" @click="resolveConflict(row, conflict, 'theirs')">用新解析</button>
          </div>
        </div>
      </section>

      <section v-if="writePlan" class="nbf-plan">
        <h4 class="nbf-col-title">{{ writePlan.dryRun ? '写入（准备）结果 —— 未写入' : writePlan.writeError ? '写入未完成' : '写入结果 —— 已写入' }}</h4>
        <ul class="nbf-plan-list">
          <li v-for="(detail, index) in writePlan.details" :key="`d-${index}`">
            <span class="nbf-chip">{{ detail.slotLabel }}</span>
            <span>{{ detail.container }}[{{ detail.containerIndex ?? '-' }}] · 块「{{ detail.blockName }}」</span>
            <span class="nbf-sub">新增 {{ detail.added }} / 重复跳过 {{ detail.duplicates }}</span>
            <span v-if="detail.reason" class="nbf-waste-reason">{{ detail.reason }}</span>
          </li>
          <li v-for="(anchor, index) in writePlan.anchors" :key="`an-${index}`">
            <span class="nbf-chip">招式锚点</span>
            <span>{{ anchor.categoryId }} · {{ anchor.name }}：{{ anchor.action === 'create' ? '新建小类并关联' : anchor.action === 'exists' ? '已有关联' : anchor.action === 'create-pending' ? '将新建（未写入）' : '建失败' }}</span>
            <span v-if="anchor.reason" class="nbf-waste-reason">{{ anchor.reason }}</span>
          </li>
          <li v-for="(anchor, index) in writePlan.unresolvedAnchors" :key="`ua-${index}`">
            <span class="nbf-chip">锚点不录</span>
            <span>{{ anchor.name }}</span>
            <span class="nbf-waste-reason">{{ anchor.reason }}</span>
          </li>
          <li v-for="(skill, index) in writePlan.skillDescs" :key="`sd-${index}`">
            <span class="nbf-chip">技能描述</span>
            <span>{{ skill.skillName }}：{{ skill.appended ? '追加' : skill.duplicate ? '已含' : '未改' }}</span>
            <span v-if="skill.reason" class="nbf-waste-reason">{{ skill.reason }}</span>
          </li>
        </ul>
        <p v-if="writeMessage" class="nbf-status">{{ writeMessage }}</p>
      </section>
    </div>

    <AdminConfirmDialog
      :visible="confirmVisible"
      title="确认写入 nanoka 增益"
      :message="confirmMessage"
      confirm-text="确认写入"
      :danger="true"
      :loading="writing"
      @confirm="runApply(false)"
      @cancel="closeConfirm"
    />
    <AdminConfirmDialog
      :visible="authDialogVisible"
      title="需要重新登录"
      message="当前后台会话无效或已过期，无法抓取 / 写入。请重新登录管理员账号后再试。"
      confirm-text="去登录"
      cancel-text="稍后"
      @confirm="goRelogin"
      @cancel="authDialogVisible = false"
    />
  </section>
</template>

<style scoped src="./adminCalculatorPanel.css"></style>
<style scoped>
.nanoka-buff-panel {
  max-width: none;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.nbf-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
}

.nbf-field {
  min-width: 12rem;
}

.nbf-field-wide {
  min-width: 100%;
}

.nbf-kind-tabs,
.nbf-page-tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.nbf-tab {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  padding: 0.5rem 0.9rem;
  font-size: 0.88rem;
  cursor: pointer;
}

.nbf-tab.active {
  border-color: hsla(160, 100%, 37%, 0.6);
  background: hsla(160, 100%, 37%, 0.12);
  font-weight: 600;
}

.nbf-status {
  margin: 0;
  font-size: 0.82rem;
  color: var(--color-text);
  opacity: 0.8;
}

.nbf-count {
  font-size: 0.82rem;
  opacity: 0.75;
}

.nbf-stage {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.nbf-stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.nbf-stage-head h3 {
  margin: 0;
  font-size: 1rem;
  color: var(--color-heading);
}

.nbf-stage-actions {
  display: flex;
  gap: 0.5rem;
}

.nbf-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
}

@media (max-width: 1200px) {
  .nbf-columns {
    grid-template-columns: minmax(0, 1fr);
  }
}

.nbf-col {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
}

.nbf-col-title {
  margin: 0;
  font-size: 0.85rem;
  letter-spacing: 0.04em;
  color: var(--color-heading);
  opacity: 0.85;
}

/* 按句配对：左 = 该句原文（约 1/3），右 = 该句关键字（约 2/3）；**每对独立成块**，行高按较长一侧撑开 */
.nbf-pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: 0.75rem;
  align-items: stretch;
  margin-top: 0.5rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft, rgba(250, 248, 242, 0.6));
}

.nbf-pair + .nbf-pair {
  margin-top: 0.7rem;
}

@media (max-width: 1100px) {
  .nbf-pair {
    grid-template-columns: minmax(0, 1fr);
  }
}

.nbf-pair-raw {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  overflow-wrap: anywhere;
}

.nbf-pair-raw-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}

.nbf-pair-kw {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

/* 「整块原文」弹窗 */
.nbf-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: rgba(20, 18, 12, 0.42);
}

.nbf-modal {
  width: min(920px, 100%);
  max-height: 78vh;
  overflow: auto;
  padding: 1rem 1.1rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background);
  box-shadow: 0 18px 48px rgba(20, 18, 12, 0.28);
}

.nbf-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  margin-bottom: 0.4rem;
}

.nbf-modal-head h4 {
  margin: 0;
  font-size: 0.95rem;
  color: var(--color-heading);
}

.nbf-original-list {
  margin: 0.6rem 0 0;
  padding-left: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.nbf-original-list li {
  padding: 0.35rem 0.45rem;
  border-radius: 8px;
  line-height: 1.5;
}

.nbf-original-current {
  border: 1px solid var(--color-border-hover);
  background: var(--color-background-mute, rgba(232, 229, 218, 0.7));
  font-weight: 600;
}

.nbf-original-text {
  margin: 0 0.4rem;
}

/* 没抽出关键字的句子：淡色（仍要显示 —— 用户 2026-10-17：整块原文一句不删） */
.nbf-original-nokw > .nbf-original-text {
  color: var(--color-text-muted, rgba(90, 88, 78, 0.62));
}

/* 阶段二：左选右看（左侧窄 = 选择器 + 详情，右侧宽 = 当前这条的实际增益） */
.nbf-master {
  display: grid;
  grid-template-columns: minmax(0, 340px) minmax(0, 1fr);
  gap: 0.9rem;
  align-items: start;
}

@media (max-width: 1100px) {
  .nbf-master {
    grid-template-columns: minmax(0, 1fr);
  }
}

.nbf-master-left {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft, rgba(250, 248, 242, 0.6));
}

.nbf-master-right {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.nbf-master-select {
  width: 100%;
}

.nbf-include {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.82rem;
}

.nbf-include-title {
  margin-top: 0.5rem;
}

.nbf-include-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  max-height: 24rem;
  overflow: auto;
  font-size: 0.78rem;
}

/* 条目：统一行高 / 缩进 / 分隔；三种状态各不一样（选中 / hover / 不加入） */
.nbf-list-item {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  padding: 0.35rem 0.45rem 0.35rem 0.5rem;
  border: 1px solid var(--color-border);
  border-left: 3px solid transparent;
  border-radius: 8px;
  background: var(--color-background-soft, #fff);
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease;
}

.nbf-list-item + .nbf-list-item {
  margin-top: 0.2rem;
}

.nbf-list-item:hover {
  border-color: var(--color-border-hover);
}

.nbf-list-item:focus-visible {
  outline: 2px solid #b8860b;
  outline-offset: 1px;
}

/* 选中态：白底 + 强调色左边框 + 极浅底色（不做大面积金/棕底，避免糊成一片） */
.nbf-list-item.is-current {
  border-color: var(--color-border-hover);
  border-left-color: #b8860b;
  background: #fffdf7;
  box-shadow: inset 0 0 0 1px rgba(184, 134, 11, 0.14);
}

.nbf-list-check {
  margin-top: 0.15rem;
  cursor: pointer;
}

.nbf-list-label {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
}

.nbf-list-body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  cursor: pointer;
}

.nbf-list-line1 {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.72rem;
  opacity: 0.8;
}

.nbf-list-item.is-current .nbf-list-line1 {
  opacity: 1;
  font-weight: 700;
}

.nbf-list-current {
  padding: 0 0.25rem;
  border: 1px solid rgba(184, 134, 11, 0.55);
  border-radius: 4px;
  background: #fff;
  color: #8a5a12;
  font-size: 0.66rem;
  font-weight: 700;
}

.nbf-list-off-tag {
  padding: 0 0.25rem;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 0.66rem;
}

.nbf-list-line2 {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
}

.nbf-chip-stat,
.nbf-chip-value {
  padding: 0.05rem 0.3rem;
  border-radius: 6px;
  font-size: 0.74rem;
  font-weight: 600;
  white-space: nowrap;
}

.nbf-chip-stat {
  background: rgba(60, 90, 150, 0.16);
  color: #2f4c86;
}

.nbf-chip-value {
  background: rgba(30, 120, 80, 0.16);
  color: #1f6b4a;
}

/* 第三行：动作 / 作用域 / 条件，超长省略号 + 悬浮显示全文 */
.nbf-list-line3 {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.7rem;
  opacity: 0.7;
}

/* 不加入：文字标灰划掉（与「选中」并存时仍保留强调色左边框） */
.nbf-include-off .nbf-list-body {
  opacity: 0.5;
  text-decoration: line-through;
}

.nbf-include-off .nbf-chip-stat,
.nbf-include-off .nbf-chip-value {
  filter: grayscale(1);
  opacity: 0.75;
}

.nbf-link-btn {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.nbf-link-btn:hover {
  text-decoration: underline;
}

.nbf-detail {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.5rem 0.55rem;
  border: 1px dashed var(--color-border);
  border-radius: 8px;
}

.nbf-detail-sentence {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.5;
}

.nbf-detail-slots {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.78rem;
}

.nbf-detail-slots li {
  display: flex;
  gap: 0.4rem;
}

.nbf-detail-slots .nbf-slot-label {
  flex: 0 0 4.6rem;
}

.nbf-detail-value {
  min-width: 0;
  overflow-wrap: anywhere;
}

.nbf-detail-unable {
  color: #b23b2e;
  font-weight: 600;
}

.nbf-excluded {
  padding: 0.5rem 0.6rem;
  border: 1px dashed var(--color-border-hover);
  border-radius: 8px;
  font-size: 0.82rem;
  opacity: 0.85;
}

.nbf-badge-inherit {
  border-color: rgba(150, 110, 30, 0.45);
  color: #8a5a12;
}

/* 废原文：按来源块整段展示（解析不出的句子只做淡色 + 下划线标记，不删字不拆条） */
.nbf-waste-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.nbf-toggle {
  display: inline-flex;
  gap: 0.2rem;
}

.nbf-toggle .nbf-mini-btn.active {
  border-color: #b8860b;
  color: #8a5a12;
  font-weight: 700;
}

.nbf-waste-blocks {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-top: 0.4rem;
}

.nbf-waste-block {
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft, rgba(250, 248, 242, 0.6));
}

.nbf-waste-block-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.3rem;
}

.nbf-waste-raw {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.nbf-waste-mark {
  color: var(--color-text);
  opacity: 0.55;
  text-decoration: underline dotted;
}

.nbf-waste-lines {
  margin: 0;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.8rem;
}

.nbf-waste-reasons {
  margin-top: 0.35rem;
  font-size: 0.76rem;
}

.nbf-waste-reasons summary {
  cursor: pointer;
  opacity: 0.8;
}

.nbf-waste-reasons ul {
  margin: 0.25rem 0 0;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

/* 无法提取的两种状态：软（按无处理）vs 硬（待补 · 阻断） */
.nbf-unable-tag {
  padding: 0 0.25rem;
  border-radius: 4px;
  font-size: 0.66rem;
  font-style: normal;
}

.nbf-unable-tag.is-soft {
  background: rgba(120, 120, 100, 0.16);
  color: var(--color-text);
  opacity: 0.85;
}

.nbf-unable-tag.is-hard {
  background: rgba(178, 59, 46, 0.16);
  color: #b23b2e;
  font-weight: 700;
}

/* 「找空活干」：0 增益列表 */
.nbf-empty-modal {
  width: min(760px, 94vw);
  max-height: 82vh;
  overflow: auto;
}

.nbf-empty-list {
  margin: 0.4rem 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.nbf-empty-item {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft, #fff);
  text-align: left;
  cursor: pointer;
}

.nbf-empty-item:hover {
  border-color: var(--color-border-hover);
}

.nbf-empty-name {
  font-weight: 600;
}

.nbf-empty-few {
  margin-top: 0.5rem;
  font-size: 0.8rem;
}

.nbf-empty-few summary {
  cursor: pointer;
  opacity: 0.85;
}

.nbf-empty-btn {
  white-space: nowrap;
}

/* 淡色「默认」标记：目标值是按规则兜底的（敌人削弱族 → 全队），一眼能改 */
.nbf-default-mark {
  margin-left: 0.3rem;
  padding: 0 0.25rem;
  font-size: 0.68rem;
  font-style: normal;
  border-radius: 4px;
  background: rgba(120, 120, 100, 0.16);
  color: var(--color-text);
  opacity: 0.75;
}

.nbf-badge-collection {
  border-color: rgba(120, 90, 160, 0.45);
  color: #6b4f96;
}

.nbf-badge-muted {
  border-color: rgba(120, 120, 100, 0.35);
  color: var(--color-text);
  opacity: 0.8;
}

/* 「解析规则」弹窗 */
.nbf-rules-modal {
  width: min(1080px, 100%);
}

.nbf-rules-group {
  margin-top: 0.7rem;
}

.nbf-rules-group h5 {
  margin: 0 0 0.3rem;
  font-size: 0.85rem;
  color: var(--color-heading);
}

.nbf-rules-list {
  margin: 0;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.8rem;
}

.nbf-rules-list code {
  padding: 0 0.2rem;
  border-radius: 4px;
  background: var(--color-background-mute, rgba(232, 229, 218, 0.7));
}

.nbf-rules-arrow {
  margin: 0 0.3rem;
  opacity: 0.6;
}

.nbf-item,
.nbf-kw-row,
.nbf-gain,
.nbf-plan {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft);
  padding: 0.6rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.nbf-item-head,
.nbf-kw-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.nbf-item-title {
  font-size: 0.85rem;
  color: var(--color-heading);
}

.nbf-chip {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 0.05rem 0.5rem;
  font-size: 0.72rem;
  opacity: 0.85;
}

.nbf-badge {
  border-radius: 999px;
  padding: 0.05rem 0.5rem;
  font-size: 0.72rem;
}

.nbf-badge-ok {
  background: hsla(160, 100%, 37%, 0.16);
}

.nbf-badge-waste,
.nbf-badge-warn {
  background: hsla(45, 90%, 50%, 0.18);
}

.nbf-badge-drop {
  background: hsla(0, 70%, 50%, 0.2);
}

.nbf-badge-anchor {
  background: hsla(210, 80%, 55%, 0.18);
}

.nbf-sub {
  font-size: 0.75rem;
  opacity: 0.7;
}

.nbf-raw-text {
  margin: 0;
  white-space: pre-wrap;
  font-size: 0.82rem;
  line-height: 1.55;
}

.nbf-kw-group-head {
  margin: 0.5rem 0 0.25rem;
  font-size: 0.8rem;
  color: var(--color-heading);
}

.nbf-kw-row-off {
  opacity: 0.55;
}

.nbf-kw-index {
  font-size: 0.72rem;
  opacity: 0.7;
}

.nbf-kw-summary {
  font-size: 0.8rem;
}

.nbf-kw-sentence {
  margin: 0;
  font-size: 0.75rem;
  opacity: 0.7;
}

.nbf-slots {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.nbf-slot {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.2rem 0.4rem;
  background: var(--color-background);
}

.nbf-slot-label {
  font-size: 0.72rem;
  opacity: 0.8;
  white-space: nowrap;
}

.nbf-slot-input {
  min-width: 7rem;
  padding: 0.15rem 0.35rem;
  font-size: 0.78rem;
}

.nbf-slot-unable {
  border-color: hsla(0, 70%, 50%, 0.5);
}

.nbf-slot-empty {
  opacity: 0.6;
}

/* 锁定态（这条不录 / 被阻断）：禁用下拉 + 当前值，鼠标提示写原因 */
.nbf-slot-locked {
  border-style: dashed;
  opacity: 0.75;
}

.nbf-slot-locked .nbf-slot-input {
  cursor: not-allowed;
}

.nbf-conditions {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.nbf-condition {
  display: flex;
  gap: 0.2rem;
}

/* 条件 / 元素：多选入口做成整行虚线按钮，一眼能看出"还能再加"（用户 2026-10-17） */
.nbf-multi-add {
  margin-top: 0.15rem;
  width: 100%;
  border: 1px dashed var(--color-border-hover, #c9c4b6);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted, rgba(90, 88, 78, 0.75));
  font-size: 0.72rem;
  padding: 0.15rem 0.4rem;
  cursor: pointer;
  text-align: left;
}
.nbf-multi-add:hover {
  color: var(--color-heading);
  border-color: var(--color-heading);
}

.nbf-mini-btn {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  font-size: 0.72rem;
  padding: 0.1rem 0.4rem;
  cursor: pointer;
}

.nbf-mini-btn.nbf-danger {
  color: #c45c5c;
}

.nbf-waste {
  border: 1px dashed var(--color-border);
  border-radius: 10px;
  padding: 0.6rem 0.75rem;
}

.nbf-waste-list {
  margin: 0.4rem 0 0;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.78rem;
}

.nbf-waste-text {
  margin-right: 0.4rem;
}

.nbf-waste-reason {
  color: #c98a3a;
  font-size: 0.74rem;
}

.nbf-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.nbf-fields .nbf-field {
  min-width: 9rem;
  flex: 1 1 9rem;
}

.nbf-target {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
}

.nbf-conflicts {
  border: 1px solid hsla(45, 90%, 50%, 0.5);
  border-radius: 8px;
  padding: 0.4rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.nbf-conflict {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
}

.nbf-mine {
  color: hsl(160, 100%, 40%);
}

.nbf-theirs {
  color: #c98a3a;
}

.nbf-write-label {
  font-size: 0.75rem;
  color: hsl(160, 100%, 42%);
}

.nbf-plan-list {
  margin: 0.4rem 0 0;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.78rem;
}
</style>

