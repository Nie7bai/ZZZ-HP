import { handleAdminSessionExpired, withAdminAuthHeaders } from '@/utils/adminAuth'
import type { BuffEffect, BuffScope } from '@/types/calculator'

/**
 * nanoka 增益（关键字 → 增益块）管理端接口。
 *
 * 后端：`zzz-hp-backend` 的 `/api/admin/nanoka-buffs/*`（挂载见 `src/app.js`）。
 * 抓 nanoka 一律由**浏览器**完成（浏览器走用户系统代理，服务端不联网）：
 *   - `POST /extract` ：吃浏览器抓来的 `zh/character/<id>.json` / `zh/weapon/<id>.json` + 索引项，
 *     返回「原文项 + 关键字效果（层B/C）」+ 本地记录匹配 + **字典（槽位标签 / 下拉选项）**；不写库。
 *   - `POST /simplify`：阶段一的 `[化简]` / `[全部化简]`；把（可编辑的）原文重跑阶段1；不写库。
 *   - `POST /parse`   ：阶段二的 `[解析]` = **智能覆盖**（逐字段回填 + 冲突清单 + 追加/失效）；不写库。
 *   - `POST /apply`   ：唯一写库入口（`dryRun: true` 只算不写；写库走既有 upsert）。
 *
 * v3 口径：原文与关键字**都入库**（没有"选不选进"的开关）；废原文**不入库**、确认写入后丢弃；
 * `无法提取` 是**槽位级**标记（该条仍进阶段二等补）；阶段二复用正式库编辑器，允许一个来源派生多条效果。
 */

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export type NanokaBuffKind = 'agent' | 'wengine'

/** 常规 9 槽位（**不许缺格**） */
export type NanokaSlotId =
  | 'stat'
  | 'action'
  | 'value'
  | 'unit'
  | 'target'
  | 'conditions'
  | 'stacks'
  | 'duration'
  | 'object'

/** 转模（动作=`转化`）专用槽位 */
export type NanokaConvertSlotId =
  | 'convertFrom'
  | 'convertPanelSource'
  | 'convertRatio'
  | 'convertBase'
  | 'convertCap'

/** 一条关键字的槽位取值（`无` = 该维度没出现；`无法提取` = 出现了但归不了类） */
export interface NanokaKeywordSlots {
  stat: string
  /** **元素（允许复数）**：一条关键字可直接带多个元素 → `elementFilter: ['火','冰']` */
  elements: string[]
  action: string
  value: number | string
  unit: string
  target: string
  /** **允许复数**的槽位之一（与 `elements` 一起构成复数白名单） */
  conditions: string[]
  /** **作用域**（= 编辑器 `scope`）：`招式 / 属性异常 / 紊乱 / 乱流 / 异放 / 耀变 / 异化系数` 或 `无` */
  scope: string
  stacks: string
  duration: string
  object: string
}

/** 转模专用槽位取值 */
export interface NanokaKeywordConvert {
  convertFrom: string
  convertPanelSource: string
  convertRatio: number | string
  convertBase: number | null
  convertCap: number | null
}

/** 招式限定 → 既有锚点（`skillSubcategoryId` / `skillTargets`） */
export interface NanokaKeywordAnchors {
  ok: boolean
  labels: string[]
  resolved: { name: string; category: string; subcategoryId: string | null; level: string }[]
  skillTargets: { category: string; subcategoryId: string | null }[]
  skillCategory: string
  skillSubcategoryId: string | null
  /** 技能库里没有同名小类时，按技能名**建立**锚点的计划（`{ name, categoryId, agentId }`） */
  pendingCreates?: { name: string; categoryId: string; agentId: string }[]
  reason: string
}

/** 层C：一条增益（= 「增益块」全字段；这里只列用得到的键） */
export type NanokaLayerCEffect = Omit<BuffEffect, 'scope'> & {
  /** 仅兼容旧抽取器；进入编辑器时迁移成 conditions.damageTypes。 */
  scope?: BuffScope | BuffScope[]
  statLabel?: string
}

/** 阶段1 的一条关键字效果（层B → 层C） */
export interface NanokaKeywordEffect {
  id: string
  origin: string
  index: number
  unitIndex: number
  unitText: string
  sentence: string
  slots: NanokaKeywordSlots
  sources: Record<string, string>
  convert: NanokaKeywordConvert | null
  stackMax: number | null
  durationSeconds: number | null
  perStack: boolean
  /** 招式限定（`[普通攻击]` 这类），不是来源 / 落点 */
  skillLimits: { name: string; category: string }[]
  /**
   * **指代来源提示**（界面用，不入库）：这条靠前文语义（「该效果」指代 / 主语省略）才成立时标出来，
   * 例 `{ from: '上一句', fields: ['属性'], label: '依赖上一句 · 增伤' }`
   */
  inherited: { from: string; fields: string[]; label: string } | null
  /** 同义反复被忽略的条件原文（界面标淡色提示；**不入库**） */
  tautologyDropped: string[]
  /** 被槽位白名单硬校验改写成「无法提取」的槽位（界面用；**不入库**） */
  unmappableSlots: { slot: string; value: string; reason: string }[]
  /**
   * **合集扇出元数据**（抽取层；界面徽章「合集：属性伤害」用它；**写入库前剔除、不进结算**）。
   * 形如 `{ id: 'attribute-damage', title: '属性伤害', note: '合集 = 属性异常 / 异放 / 乱流 / 耀变（不含紊乱）', targetStat: '属性异常增伤' }`
   */
  collection?: { id: string; title: string; note: string; targetStat: string }
  anchors: NanokaKeywordAnchors
  /** 锚点关联不上 → false（这条不录） */
  recorded: boolean
  dropReason: string
  unableSlots: string[]
  blocked: boolean
  layerC: NanokaLayerCEffect | null
  mapping: { ok: boolean; blocked: boolean; steps: string[]; unmapped: string[]; reason: string }
}

/** **废原文**：整条丢弃（不入库、确认写入后丢弃），带丢弃原因 */
export interface NanokaWasteClause {
  /** 属于哪一句（按句归档，界面底部按句显示） */
  sentenceIndex?: number
  text: string
  reason: string
}

interface NanokaStateMention {
  names: string[]
  text: string
  clauseIndex: number
}

export type NanokaStateReference = NanokaStateMention & (
  | { kind: 'grant'; trigger: string }
  | {
      kind: 'reference'
      resolution: 'linked' | 'ambiguous' | 'unresolved'
      grant: { sentenceIndex: number; clauseIndex: number } | null
    }
)

/** **按句配对**的显示单位（一句 → 该句抽出的关键字 + 该句的废原文） */
export interface NanokaBuffSentence {
  sourceKey: string
  sourceLabel: string
  /** 句序号（0 基；切句口径 = 阶段1 的 `。；\n`） */
  sentenceIndex: number
  rawSentence: string
  /** 原文状态名及指代来源，供复核和后续上下文关联。 */
  stateReferences?: NanokaStateReference[]
  keywords: NanokaKeywordEffect[]
  waste: NanokaWasteClause[]
  /** 左侧主视图**只显示** `hasKeywords === true` 的句子；其余只进底部废原文区 */
  hasKeywords: boolean
}

/** 一个「原文项」（四类来源之一段；**入库单位**是整块） */
export interface NanokaBuffItem {
  slot: string
  slotLabel: string
  containerIndex: number | null
  source: string
  title: string
  rawText: string
  numbers: number[]
  effects: NanokaKeywordEffect[]
  /** 按句配对视图（**显示单位**；入库仍按整块原文 `rawText`，机制句也照旧入库） */
  sentences: NanokaBuffSentence[]
  waste: NanokaWasteClause[]
  landing: {
    container: string
    index: number | null
    label: string
    blockHint?: string
  } | null
  skillDesc: { agentId: string; skillName: string; category: string } | null
  verdict: 'buff' | 'waste'
  verdictReason: string
  localId?: string
}

export interface NanokaBuffCounts {
  items: number
  buffItems: number
  wasteItems: number
  keywords: number
  recordable: number
  dropped: number
  blocked: number
  unableSlots: number
  wasteClauses: number
  skillAnchored: number
}

/** 字典：槽位标签 / 下拉选项 / 转模文案（**唯一来源在后端**） */
export interface NanokaExtractorMeta {
  slotLabels: Record<string, string>
  slotOptions: Record<string, string[] | 'number'>
  unable: string
  /** 转模专用槽位文案：读取属性 / 取哪一层 / 折算比例 / 基础值 / 上限 */
  convertSlotLabels?: Record<string, string>
  convertSlotHints?: Record<string, string>
  convertFromLabels?: Record<string, string>
  convertPanelSourceLabels?: Record<string, string>
}

export interface NanokaExtractResult {
  kind: NanokaBuffKind
  nanokaId: string
  localId: string
  localName: string
  name: string
  items: NanokaBuffItem[]
  counts: NanokaBuffCounts
  meta: NanokaExtractorMeta
}

export interface NanokaSimplifyResult {
  kind: NanokaBuffKind
  items: {
    slot: string
    slotLabel: string
    source: string
    containerIndex: number | null
    rawText: string
    effects: NanokaKeywordEffect[]
    sentences: NanokaBuffSentence[]
    waste: NanokaWasteClause[]
    landing: NanokaBuffItem['landing']
    skillDesc: NanokaBuffItem['skillDesc']
    verdict: 'buff' | 'waste'
  }[]
  meta: NanokaExtractorMeta
}

/** 阶段二的一行（关键字 ↔ 增益 **一对一**） */
export interface NanokaParseRow {
  key: string
  /** 当前增益（层C 全字段；`null` = 还没解析出来） */
  effect: Partial<NanokaLayerCEffect> | null
  /** 逐字段「手动改过」标记：解析**只回填没手改的字段** */
  dirty: Record<string, boolean>
}

export interface NanokaParseConflict {
  field: string
  label: string
  mine: unknown
  theirs: unknown
}

export interface NanokaParseResultRow extends NanokaParseRow {
  conflicts: NanokaParseConflict[]
  /** 关键字里已无此条（旧增益行保留） */
  stale?: boolean
  staleLabel?: string
  /** 关键字标了「无法提取」等 → 阻断，旧值原样保留 */
  blocked?: boolean
  blockReason?: string
  /** 关键字新增效果 → 追加的新行 */
  added?: boolean
  filledFields?: string[]
  mapping?: { steps: string[]; notices: string[] }
}

export interface NanokaParseResult {
  rows: NanokaParseResultRow[]
  conflicts: { key: string; conflicts: NanokaParseConflict[] }[]
  added: number
  stale: number
  blocked: number
  filled: number
  steps: string[]
}

/** `POST /apply` 提交的一行 = 一条最终效果；可携带来源关键字和明确的效果块。 */
export interface NanokaApplyRow {
  key: string
  slot: string
  slotLabel: string
  source: string
  containerIndex: number | null
  blockHint?: string
  rawText: string
  keywordSlots?: NanokaKeywordSlots
  convert: NanokaKeywordConvert | null
  effect: Partial<NanokaLayerCEffect>
  /** 共享编辑器确认后的效果块；未传时兼容旧版追加到首块的调用。 */
  block?: { id: string; name: string; note: string; enabledDefault: boolean }
  /** 招式锚点（含 `pendingCreates`：库里没有同名小类时要建） */
  anchors?: NanokaKeywordAnchors | null
  skillDesc?: { agentId: string; skillName: string; category: string } | null
}

export interface NanokaApplyEffectDetail {
  id: string
  stat: string
  statLabel: string
  kind: string
  value: number
  valuePerStack?: number
  maxStacks?: number
  writeLabel: string
}

export interface NanokaApplySlotDetail {
  slot: string
  slotLabel: string
  container: string
  containerIndex: number | null
  ok: boolean
  action: string
  blockName?: string
  added: number
  duplicates: number
  effects: NanokaApplyEffectDetail[]
  note: { appended: boolean; duplicate: boolean } | null
  reason?: string
}

export interface NanokaApplySkillDetail {
  skillId?: string
  skillName: string
  appended: boolean
  duplicate: boolean
  reason?: string
  note?: string
}

export interface NanokaApplyAnchorDetail {
  agentId: string
  categoryId: string
  name: string
  exists: boolean
  id: string | null
  action: string
  reason?: string
}

export interface NanokaApplyResult {
  kind: NanokaBuffKind
  id: string
  name: string
  dryRun: boolean
  updated: number
  skipped: number
  failed: number
  details: NanokaApplySlotDetail[]
  skillDescs: NanokaApplySkillDetail[]
  /** 招式锚点：建出来的 / 已存在的 / 建失败的 */
  anchors: NanokaApplyAnchorDetail[]
  /** 锚点建不出来的（这些条目不录） */
  unresolvedAnchors: { name: string; reason: string }[]
  invalid: { key: string; reason: string }[]
  wouldWrite: boolean
  writeError: string
}

export class NanokaBuffsApiError extends Error {
  status: number
  apiCode: string

  constructor(message: string, status: number, apiCode = '') {
    super(message)
    this.name = 'NanokaBuffsApiError'
    this.status = status
    this.apiCode = apiCode
  }
}

function readApiCode(data: unknown): string {
  if (!data || typeof data !== 'object' || !('code' in data)) return ''
  const code = (data as { code?: unknown }).code
  return typeof code === 'string' ? code : ''
}

async function requestApi<T>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<{ data: T; message: string }> {
  const headers = withAdminAuthHeaders(init?.headers)
  const response = await fetch(input, { ...init, headers })
  let json: ApiResponse<T>
  try {
    json = (await response.json()) as ApiResponse<T>
  } catch {
    throw new NanokaBuffsApiError(`请求失败: ${response.status}`, response.status)
  }
  if (!response.ok || json.code !== 200) {
    const apiCode = readApiCode(json.data)
    // 会话已被服务器判死：同步清掉本地登录态，路由守卫才不会拿旧标记拦人
    if (response.status === 401 || apiCode === 'ADMIN_AUTH_REQUIRED') {
      handleAdminSessionExpired()
    }
    throw new NanokaBuffsApiError(
      json.message || `请求失败: ${response.status}`,
      response.status,
      apiCode,
    )
  }
  return { data: json.data, message: json.message ?? '' }
}

export function isNanokaBuffsAuthError(err: unknown): boolean {
  return (
    err instanceof NanokaBuffsApiError &&
    (err.status === 401 || err.apiCode === 'ADMIN_AUTH_REQUIRED')
  )
}

/** 抽取：请求体是浏览器抓来的详情，返回原文项 + 关键字效果（不写库） */
export async function extractNanokaBuffs(payload: {
  kind: NanokaBuffKind
  nanokaId: string
  meta: unknown
  detail: unknown
  termNames?: Record<string, string>
}): Promise<{ result: NanokaExtractResult; message: string }> {
  const { data, message } = await requestApi<NanokaExtractResult>('/api/admin/nanoka-buffs/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { result: data, message }
}

/** 化简：阶段一按段重跑阶段1（`items` 里的原文可以是界面上编辑过的） */
export async function simplifyNanokaBuffs(payload: {
  kind: NanokaBuffKind
  nanokaId: string
  corePassiveText?: string
  items: {
    slot: string
    slotLabel?: string
    source?: string
    containerIndex?: number | null
    rawText: string
    origin?: string
    agentId?: string
    selfNames?: string[]
    landing?: NanokaBuffItem['landing']
    skillDesc?: NanokaBuffItem['skillDesc']
  }[]
}): Promise<{ result: NanokaSimplifyResult; message: string }> {
  const { data, message } = await requestApi<NanokaSimplifyResult>(
    '/api/admin/nanoka-buffs/simplify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
  return { result: data, message }
}

/** 解析 = 智能覆盖：只回填未手改字段，冲突逐条给出（绝不静默覆盖） */
export async function parseNanokaBuffs(payload: {
  rows: NanokaParseRow[]
  keywords: {
    key: string
    slots: NanokaKeywordSlots
    convert?: NanokaKeywordConvert | null
    stackMax?: number | null
    durationSeconds?: number | null
    anchors?: NanokaKeywordAnchors | null
    rawText?: string
    origin?: string
  }[]
  anchors?: NanokaKeywordAnchors | null
  agentId?: string
}): Promise<{ result: NanokaParseResult; message: string }> {
  const { data, message } = await requestApi<NanokaParseResult>('/api/admin/nanoka-buffs/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { result: data, message }
}

/** 写入：只写确认过的行（`dryRun: true` 只算不写） */
export async function applyNanokaBuffs(payload: {
  kind: NanokaBuffKind
  id: string
  rows: NanokaApplyRow[]
  dryRun?: boolean
}): Promise<{ result: NanokaApplyResult; message: string }> {
  const { data, message } = await requestApi<NanokaApplyResult>('/api/admin/nanoka-buffs/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { result: data, message }
}

/** 解析规则对照表（只读；后端从抽取器词表自动导出，界面不手写死） */
export interface NanokaRuleItem {
  game: string
  slot: string
  field: string
  note: string
}

export interface NanokaRulesTable {
  version: string
  groups: { id: string; title: string; items: NanokaRuleItem[] }[]
}

export async function fetchNanokaRules(): Promise<{ result: NanokaRulesTable; message: string }> {
  const { data, message } = await requestApi<NanokaRulesTable>('/api/admin/nanoka-buffs/rules')
  return { result: data, message }
}

/**
 * 「找空活干」：0 增益的角色 / 音擎（只读查询，后端用既有 `listCalculatorBuffs()`，不写库）。
 * 定义：所有增益容器里 effect 条数 = 0（角色 = mindscapeBuffs[0..6]；音擎 = fixedBuffs + refinementBuffs[0..4]）。
 */
export interface NanokaEmptyTarget {
  id: string
  name: string
  element: string
  profession: string
  rarity: string | number | null
  effectCount: number
}

export interface NanokaEmptyTargets {
  kind: 'agent' | 'wengine'
  kindLabel: string
  total: number
  fewThreshold: number
  /** 0 增益（一条增益都没有） */
  empty: NanokaEmptyTarget[]
  /** 增益条很少（>0 且 ≤ fewThreshold），供参考 */
  few: NanokaEmptyTarget[]
  queriedAt: string
}

export async function fetchNanokaEmptyTargets(
  kind: 'agent' | 'wengine',
  fewThreshold = 2,
): Promise<{ result: NanokaEmptyTargets; message: string }> {
  const query = `kind=${encodeURIComponent(kind)}&fewThreshold=${Number(fewThreshold) || 0}`
  const { data, message } = await requestApi<NanokaEmptyTargets>(
    `/api/admin/nanoka-buffs/empty-targets?${query}`,
  )
  return { result: data, message }
}
