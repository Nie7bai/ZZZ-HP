<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { AffixCounts } from '@/types/calculatorPanel'
import AdminConfirmDialog from '@/components/admin/AdminConfirmDialog.vue'
import { clearAdminAuthenticated } from '@/utils/adminAuth'
import {
  createAffixPresetScheme,
  deleteAffixPresetScheme,
  fetchAffixPreset,
  isAffixPresetAuthError,
  replaceAffixPreset,
  type AffixPresetEntryDoc,
  type AffixPresetGroupDoc,
  type AffixPresetSchemeDoc,
} from '@/api/affixPreset'
import {
  AFFIX_PANEL_DELTA_FIELD_LABELS,
  AFFIX_SUBSTAT_KEY_LABELS,
  DEFAULT_AFFIX_GROUP_CAP,
  affixPerRollUnit,
  affixTargetLabel,
  isAffixLibraryEntryTarget,
  panelTarget,
  statTarget,
  type AffixPanelDeltaField,
} from '@/utils/affixLibrary'
import '@/components/admin/calculator/adminCalculatorPanel.css'

/**
 * 官方预设词条库（管理侧唯一编辑入口）
 *
 * 口径（用户 2026-09-12 / 2026-09-13）：
 * - 官方预设的**唯一来源＝数据库**；用户侧只读，他们能复制一份到自己浏览器里改，改不回这里；
 * - 用户一旦复制走，那份就是**冻结的副本** —— 这里怎么改都影响不到它，改动只对
 *   **之后新建**的库生效（前端 `convertAffixLibraryStateToCopy`，见手册步骤 35 / 44）；
 * - 界面与用户侧那张表**同一套样子**（组管理 / 分组页 / 行内编辑 / 新增表单）——
 *   用户 2026-09-13「你就跟用户侧的差不多嘛」。用户侧那份是成品，**本目录之外不许动**；
 * - 管理侧**不设「高级编辑」开关**：管理员要用的字段一次全给（用户 2026-09-13「当然是全开的」）。
 *
 * ## 编辑模型：草稿 + 保存（用户 2026-09-13「要有保存按钮」）
 *
 * 编辑只改**内存里的工作副本**（`entries` / `groups`），一个请求都不发；
 * 有改动时底部出现保存条，点「保存」才把**整套方案**整份替换写库（后端事务，
 * 要么全成、要么全不成）。「放弃改动」把工作副本退回上次读取的内容。
 *
 * 为什么保存是整份替换：删除 / 改名 / 改 ID / 改组引用这些改动彼此关联，
 * 逐条写会在中途失败时留下半份状态；整份替换一次提交，没有中间态。
 * 代价是并发下**后写覆盖先写** —— 本工具只有一个管理员在用，记在手册里。
 *
 * 比用户侧多出来的字段（用户侧没有 / 改不了）：
 * `id`（对外身份）、`sortOrder`（条目与分组的展示顺序）、`rollCost`（每档占用）、
 * `enabledByDefault`（勾给新用户哪几条）、`target` 可填自由字段名。
 */

const TARGET_PREFIXES = ['stat:', 'panel:']

/** 条目 ID 上限，与后端 `normalizeEntryPayload` 同值 */
const ENTRY_ID_MAX = 64

/**
 * 条目 ID 的命名规范（从历史数据归纳，写在这里当唯一出处）。
 *
 * 规范本身不是新发明的 —— `utils/affixLibrary.ts` 的构造器就是这么发的 id
 * （`substat:${key}` / `panel:${field}` / `main:slot${slot}:${key}` / `set:${key}:${perRoll}`），
 * 库里现有的 50 条全部符合。之所以还要在管理页把它写出来：id 是条目的**对外身份**
 * （导出文件、方案复制、之后新建的库都按它走），按同一套规律起名，后面维护才不会变成一锅乱麻。
 *
 * 自动生成时按下面顺序判断（新条目优先用 id 生成器，别手写）：
 * 1. 组名是 `N号位` → `main:slotN:字段`
 * 2. 组名是 `2件套` → `set:字段:每档值`（**数值进 id**：同字段不同数值＝一条新条目）
 * 3. 其余（副词条 / 自建组）→ `stat:` 落点用 `substat:字段`，`panel:` 落点用 `panel:字段`
 */
const ENTRY_ID_RULES: { match: string; format: string; example: string }[] = [
  { match: '4 / 5 / 6 号位', format: 'main:slotN:字段', example: 'main:slot5:dmgBonus' },
  { match: '2 件套', format: 'set:字段:每档值', example: 'set:critDmg:16' },
  { match: '副词条（stat 落点）', format: 'substat:字段', example: 'substat:critRate' },
  { match: '副词条（panel 落点）', format: 'panel:字段', example: 'panel:resPen' },
]

/**
 * 主属性槽的历史别名：库里 `stat:atkPercent` 的 id 写作 `externalAtkPercent`
 * （`main:slot4:externalAtkPercent`），生成器沿用这个写法，免得新老条目两种风格。
 */
const MAIN_SLOT_FIELD_ALIASES: Record<string, string> = {
  atkPercent: 'externalAtkPercent',
  hpPercent: 'externalHpPercent',
  defPercent: 'externalDefPercent',
}

/** 目标字段的候选清单：按落点分两组给下拉用（管理员多数时候只需要从里面挑） */
const TARGET_OPTION_GROUPS = [
  {
    label: '词条计数桶（stat:）',
    options: (Object.keys(AFFIX_SUBSTAT_KEY_LABELS) as (keyof AffixCounts)[]).map((key) => ({
      id: statTarget(key),
      label: AFFIX_SUBSTAT_KEY_LABELS[key],
    })),
  },
  {
    label: '面板增量（panel:）',
    options: (Object.keys(AFFIX_PANEL_DELTA_FIELD_LABELS) as AffixPanelDeltaField[]).map(
      (field) => ({ id: panelTarget(field), label: AFFIX_PANEL_DELTA_FIELD_LABELS[field] }),
    ),
  },
]

/** 已知目标的集合（判断一个目标要不要走「自定义」输入）；按 `string` 收，界面上的值都是自由字符串 */
const KNOWN_TARGETS: ReadonlySet<string> = new Set<string>(
  TARGET_OPTION_GROUPS.flatMap((group) => group.options.map((option) => option.id)),
)

/** 下拉里的「自定义字段名…」哨兵值 */
const CUSTOM_TARGET = '__custom__'

/** 「复制现有方案」的哨兵值 */
const COPY_SOURCE = '__copy__'

/**
 * 条目行：`AffixPresetEntryDoc` + 两个**本地**字段。
 *
 * 为什么要本地字段：草稿里改过 ID 的行，得知道「它原来是谁」——
 * 保存时要能列出 旧→新 让人确认，diff 也要认得出「这是改过 ID 的同一行」而不是删一条加一条。
 */
interface EntryRow extends AffixPresetEntryDoc {
  /** 本地行键：值怎么改都不变，只用来认「还是同一行」 */
  _key: string
  /** 读进来时的 id；与 `id` 不同 = 改过 ID */
  _prevId: string
}

interface GroupRow extends AffixPresetGroupDoc {
  _key: string
  /** 上一次用过的组名；改名时要按它把组内条目的引用一起改 */
  _lastName: string
}

let keySeed = 0
function nextKey(): string {
  keySeed += 1
  return `row-${keySeed}`
}

function toEntryRows(list: AffixPresetEntryDoc[]): EntryRow[] {
  return list.map((entry) => ({ ...entry, _key: nextKey(), _prevId: entry.id }))
}

function toGroupRows(list: AffixPresetGroupDoc[]): GroupRow[] {
  return list.map((group) => ({ ...group, _key: nextKey(), _lastName: group.name }))
}

/** 工作副本 → 落地文档（剥掉本地字段，顺手把首尾空格去掉） */
function entryDoc(row: EntryRow): AffixPresetEntryDoc {
  return {
    id: row.id.trim(),
    label: row.label.trim(),
    target: row.target.trim(),
    perRoll: Number(row.perRoll),
    cap: Number(row.cap),
    group: row.group,
    rollCost: Number(row.rollCost),
    enabledByDefault: Boolean(row.enabledByDefault),
    sortOrder: Number(row.sortOrder ?? 0),
    raw: row.raw ?? null,
  }
}

function groupDoc(row: GroupRow): AffixPresetGroupDoc {
  return {
    name: row.name.trim(),
    cap: Number(row.cap),
    sortOrder: Number(row.sortOrder ?? 0),
    raw: row.raw ?? null,
  }
}

/** 比较用的签名：只含**业务字段**，本地字段不参与 */
function entrySignature(row: AffixPresetEntryDoc): string {
  return JSON.stringify([
    row.id.trim(),
    row.label.trim(),
    row.target.trim(),
    Number(row.perRoll),
    Number(row.cap),
    row.group,
    Number(row.rollCost),
    Boolean(row.enabledByDefault),
    Number(row.sortOrder ?? 0),
  ])
}

function groupSignature(row: AffixPresetGroupDoc): string {
  return JSON.stringify([row.name.trim(), Number(row.cap), Number(row.sortOrder ?? 0)])
}

// ---------- 状态 ----------

const schemes = ref<AffixPresetSchemeDoc[]>([])
const activeScheme = ref('')

/** 工作副本（草稿）：编辑只改这两份，不发请求 */
const entries = ref<EntryRow[]>([])
const groups = ref<GroupRow[]>([])

/** 上次读取 / 保存后的内容：「放弃改动」回到这里，diff 也以它为准 */
const baseline = ref<{ entries: AffixPresetEntryDoc[]; groups: AffixPresetGroupDoc[] }>({
  entries: [],
  groups: [],
})

const loaded = ref(false)
const loading = ref(false)
/** 正在写库：期间锁住编辑入口，避免保存到一半又改内容 */
const busy = ref(false)
const message = ref('')
const error = ref('')

// ---------- 会话过期（写接口 401） ----------

const router = useRouter()

/**
 * 「去登录」弹窗。
 *
 * 管理员会话是有期限的（服务端默认 12 小时，另有换密码等操作会作废全部会话）。
 * 过期后**页面还能打开**（前端只记了个「已登录」标记），但每次写都会被 401 顶回来 ——
 * 光甩一行红字用户不知道该干嘛，这里明确告诉他去登录，并带回跳地址。
 * 与 `AdminBuffImportExportPanel` 同一套做法。
 */
const authDialogVisible = ref(false)

/** 统一的失败处理：会话过期就走弹窗，其余照旧显示错误文本 */
function handleWriteError(err: unknown, fallback: string) {
  if (isAffixPresetAuthError(err)) {
    authDialogVisible.value = true
    error.value = ''
    return
  }
  error.value = err instanceof Error ? err.message : fallback
}

function goRelogin() {
  authDialogVisible.value = false
  clearAdminAuthenticated()
  void router.push({
    path: '/admin/login',
    query: { redirect: router.currentRoute.value.fullPath },
  })
}

// ---------- 草稿 diff ----------

/**
 * 未保存的改动：条目 / 分组分开数（新增 / 修改 / 删除各算一处；改 ID 算一处修改）。
 *
 * 分开数是因为保存条上要说清「改了什么」——只给一个总数，用户不知道是条目还是分组动了。
 */
const pendingEntryChanges = computed(() => {
  const baseById = new Map(baseline.value.entries.map((entry) => [entry.id, entrySignature(entry)]))
  const matched = new Set<string>()
  let count = 0
  for (const row of entries.value) {
    if (!row._prevId || !baseById.has(row._prevId)) {
      count += 1 // 草稿里新增的
      continue
    }
    matched.add(row._prevId)
    if (entrySignature(entryDoc(row)) !== baseById.get(row._prevId)) count += 1
  }
  count += [...baseById.keys()].filter((id) => !matched.has(id)).length // 被删掉的
  return count
})

const pendingGroupChanges = computed(() => {
  const baseByName = new Map(
    baseline.value.groups.map((group) => [group.name, groupSignature(group)]),
  )
  const matchedGroups = new Set<string>()
  let count = 0
  for (const row of groups.value) {
    if (!row._lastName || !baseByName.has(row._lastName)) {
      count += 1
      continue
    }
    matchedGroups.add(row._lastName)
    if (groupSignature(groupDoc(row)) !== baseByName.get(row._lastName)) count += 1
  }
  count += [...baseByName.keys()].filter((name) => !matchedGroups.has(name)).length
  return count
})

const pendingChanges = computed(() => pendingEntryChanges.value + pendingGroupChanges.value)

/** 保存条上的一句话：说清改的是条目还是分组 */
const pendingSummary = computed(() => {
  const parts: string[] = []
  if (pendingEntryChanges.value) parts.push(`条目 ${pendingEntryChanges.value} 处`)
  if (pendingGroupChanges.value) parts.push(`分组 ${pendingGroupChanges.value} 处`)
  return parts.join(' · ')
})

/** 改了 ID 的行（保存前要列出 旧→新 让人确认） */
const renamedIds = computed(() =>
  entries.value.filter((row) => row._prevId && row.id.trim() !== row._prevId),
)

const isDefaultScheme = computed(
  () => schemes.value.find((item) => item.name === activeScheme.value)?.isDefault ?? false,
)

// ---------- 读取 / 保存 ----------

/**
 * 草稿暂存：每次改动落到 sessionStorage（按方案分开存）。
 *
 * 为什么需要：会话过期时用户必须去登录页 —— 那是**整页跳转**，
 * 内存里的草稿会跟着没；刷新页面（F5）也一样。这些改动可能是几十条的细调，
 * 不该因为一次重新登录就白做。
 *
 * 存 sessionStorage 而不是 localStorage：它跟着这一次浏览会话走，
 * 换个标签页/关掉浏览器就该算「这次的活儿结束了」，不该留到下次吓人一跳。
 * 恢复时**必须**和刚从库里读到的那份比对（见 `restoreStashedDraft`）——
 * 内容一样就不提示，免得「一进页面就有未保存改动」。
 */
const DRAFT_STASH_PREFIX = 'zzz-hp-admin-affix-draft::'

function stashKey(scheme: string): string {
  return `${DRAFT_STASH_PREFIX}${scheme}`
}

function writeDraftStash() {
  if (!loaded.value || !activeScheme.value) return
  try {
    if (pendingChanges.value === 0) {
      sessionStorage.removeItem(stashKey(activeScheme.value))
      return
    }
    sessionStorage.setItem(
      stashKey(activeScheme.value),
      JSON.stringify({ entries: entries.value.map(entryDoc), groups: groups.value.map(groupDoc) }),
    )
  } catch {
    /* 存不下就只在本次会话生效（与词条库弹窗同一套兜底） */
  }
}

/** 读回暂存的草稿；形体不对就当没有 */
function readDraftStash(scheme: string): {
  entries: AffixPresetEntryDoc[]
  groups: AffixPresetGroupDoc[]
} | null {
  try {
    const raw = sessionStorage.getItem(stashKey(scheme))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { entries?: unknown; groups?: unknown }
    if (!Array.isArray(parsed.entries) || !Array.isArray(parsed.groups)) return null
    return {
      entries: parsed.entries as AffixPresetEntryDoc[],
      groups: parsed.groups as AffixPresetGroupDoc[],
    }
  } catch {
    return null
  }
}

function clearDraftStash(scheme: string) {
  try {
    sessionStorage.removeItem(stashKey(scheme))
  } catch {
    /* ignore */
  }
}

function adoptSnapshot(data: {
  scheme: string
  schemes: AffixPresetSchemeDoc[]
  entries: AffixPresetEntryDoc[]
  groups: AffixPresetGroupDoc[]
}) {
  activeScheme.value = data.scheme
  schemes.value = data.schemes ?? schemes.value
  entries.value = toEntryRows(data.entries)
  groups.value = toGroupRows(data.groups)
  baseline.value = {
    entries: data.entries.map((entry) => ({ ...entry })),
    groups: data.groups.map((group) => ({ ...group })),
  }
  newGroupSortOrder.value = nextGroupSortOrder()
  draft.value.sortOrder = nextEntrySortOrder()
}

async function loadScheme(name?: string) {
  loading.value = true
  error.value = ''
  try {
    const data = await fetchAffixPreset(name)
    adoptSnapshot(data)
    loaded.value = true
    activeTab.value = 'manage'
    restoreStashedDraft(data.scheme)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

/**
 * 把上次没存完的草稿接回来（重新登录 / 刷新页面之后）。
 *
 * 只在**确实与库里那份不同**时才接：否则一进页面就顶着「未保存改动」，
 * 用户会以为自己上周改的东西还没存（其实是他上次看完就走了）。
 */
function restoreStashedDraft(scheme: string) {
  const stashed = readDraftStash(scheme)
  if (!stashed) return
  const baselineEntries = baseline.value.entries
  const baselineGroups = baseline.value.groups
  const sameEntries =
    stashed.entries.length === baselineEntries.length &&
    stashed.entries.every(
      (entry, index) =>
        baselineEntries[index] && entrySignature(entry) === entrySignature(baselineEntries[index]),
    )
  const sameGroups =
    stashed.groups.length === baselineGroups.length &&
    stashed.groups.every(
      (group, index) =>
        baselineGroups[index] && groupSignature(group) === groupSignature(baselineGroups[index]),
    )
  if (sameEntries && sameGroups) {
    clearDraftStash(scheme)
    return
  }
  entries.value = toEntryRows(stashed.entries)
  groups.value = toGroupRows(stashed.groups)
  message.value = `已接回上次没保存完的改动（${pendingChanges.value} 处）—— 确认无误后点「保存」`
}

/** 有未保存改动时先问一句（切方案 / 重新读取 / 新建方案都会丢掉草稿） */
function confirmDiscard(): boolean {
  if (pendingChanges.value === 0) return true
  return window.confirm(
    `有 ${pendingChanges.value} 处改动还没保存，继续就会丢掉它们。\n（想留着就先点「保存」）`,
  )
}

function switchScheme(name: string) {
  if (name === activeScheme.value) return
  if (!confirmDiscard()) return
  void loadScheme(name)
}

function reload() {
  if (!confirmDiscard()) return
  void loadScheme(activeScheme.value)
}

function discardDraft() {
  entries.value = toEntryRows(baseline.value.entries)
  groups.value = toGroupRows(baseline.value.groups)
  error.value = ''
  clearDraftStash(activeScheme.value)
}

/**
 * 草稿有变就落暂存（重新登录 / 刷新页面时接回来用）。
 *
 * 直接 watch 整个 `pendingChanges`：它就是「与库里那份的差异数」，
 * 变 0 时顺手把暂存清掉，不用在各处手动维护。
 */
watch(pendingChanges, () => {
  writeDraftStash()
})

/**
 * 保存前把草稿检一遍：错误直接说清是第几条的哪个字段。
 *
 * 排序值要求**同一套方案内唯一**（用户 2026-09-13「不允许重复保存」）——
 * 同号会让「谁先谁后」没有唯一答案；这里先拦一道，后端还有一道。
 */
function validateDraft(): string | null {
  const ids = new Set<string>()
  const orders = new Map<number, string>()
  for (const [index, row] of entries.value.entries()) {
    const where = `第 ${index + 1} 条（${row.label.trim() || row.id.trim() || '未命名'}）`
    const id = row.id.trim()
    if (!id) return `${where}：ID 不能为空`
    if (id.length > ENTRY_ID_MAX) return `${where}：ID 过长（≤${ENTRY_ID_MAX}）`
    if (ids.has(id)) return `${where}：ID「${id}」和上面某条重复`
    ids.add(id)
    if (!row.label.trim()) return `${where}：名称不能为空`
    if (!TARGET_PREFIXES.some((prefix) => row.target.trim().startsWith(prefix))) {
      return `${where}：目标须以 ${TARGET_PREFIXES.join(' 或 ')} 开头`
    }
    if (!Number.isFinite(Number(row.perRoll)) || Number(row.perRoll) <= 0) {
      return `${where}：每档须为正数`
    }
    if (!Number.isFinite(Number(row.cap)) || Number(row.cap) < 0) {
      return `${where}：上限须为非负数（0 = 不限）`
    }
    if (!Number.isFinite(Number(row.rollCost)) || Number(row.rollCost) < 0) {
      return `${where}：每档占用须为非负数`
    }
    const order = Math.trunc(Number(row.sortOrder))
    if (String(row.sortOrder ?? '').trim() === '' || !Number.isFinite(order)) {
      return `${where}：排序值不能为空`
    }
    const takenBy = orders.get(order)
    if (takenBy) return `${where}：排序值 ${order} 与${takenBy}重复（同一套方案里必须唯一）`
    orders.set(order, where)
  }
  const names = new Set<string>()
  const groupOrders = new Map<number, string>()
  for (const [index, row] of groups.value.entries()) {
    const where = `第 ${index + 1} 个分组`
    const name = row.name.trim()
    if (!name) return `${where}：组名不能为空`
    if (names.has(name)) return `${where}：组名「${name}」和上面某个重复`
    names.add(name)
    if (!Number.isFinite(Number(row.cap)) || Number(row.cap) < 0) {
      return `${where}：组额度须为非负数（0 = 不限）`
    }
    const order = Math.trunc(Number(row.sortOrder))
    if (String(row.sortOrder ?? '').trim() === '' || !Number.isFinite(order)) {
      return `${where}：排序值不能为空`
    }
    const takenBy = groupOrders.get(order)
    if (takenBy) return `${where}：排序值 ${order} 与${takenBy}重复（同一套方案里必须唯一）`
    groupOrders.set(order, where)
  }
  return null
}

/**
 * 保存：整套方案整份替换（后端事务）。
 *
 * 改过 ID 的行会先列出来确认 —— id 是条目的**对外身份**（导出文件、方案复制、
 * 之后新建的库都按它走）。已经复制走的用户库是冻结副本，不受影响。
 */
async function saveDraft() {
  const invalid = validateDraft()
  if (invalid) {
    error.value = invalid
    return
  }
  const renames = renamedIds.value
  if (renames.length) {
    const list = renames.map((row) => `· ${row._prevId} → ${row.id.trim()}`).join('\n')
    const ok = window.confirm(
      `改条目 ID（对外身份：导出、复制方案、之后新建的库都按它走）：\n${list}\n\n` +
        `已经复制走的用户库是冻结副本，不受影响。确认改吗？`,
    )
    if (!ok) return
  }

  busy.value = true
  message.value = ''
  error.value = ''
  try {
    const data = await replaceAffixPreset({
      scheme: activeScheme.value,
      entries: entries.value.map(entryDoc),
      groups: groups.value.map(groupDoc),
    })
    adoptSnapshot(data)
    clearDraftStash(data.scheme)
    message.value = `已保存「${data.scheme}」：${data.entries.length} 条 / ${data.groups.length} 组`
  } catch (err) {
    // 存不进去时暂存留着：会话过期去登录、回来照样能接上（见 DRAFT_STASH_PREFIX）
    handleWriteError(err, '保存失败')
  } finally {
    busy.value = false
  }
}

// ---------- 方案（多套官方预设） ----------

const newSchemeOpen = ref(false)
const newSchemeName = ref('')
/** `''` = 空白方案；`COPY_SOURCE` = 复制现有方案 */
const newSchemeSource = ref('')
const copyFromScheme = ref('')
const schemeBusy = ref(false)

function openNewScheme() {
  newSchemeOpen.value = true
  newSchemeName.value = ''
  newSchemeSource.value = ''
  copyFromScheme.value = activeScheme.value
}

/**
 * 复制当前方案：与「新建方案」同一个面板，只是**先把答案填好**。
 *
 * 为什么要有这个按钮：从零搭一套 50 条是没人愿意干的事（用户 2026-09-13
 * 「从0建设太麻烦了」）。点进来时来源已经是「复制现有方案 · 当前这套」，
 * 名字也预填成「XX 副本」——确认一下就能建。
 */
function openCopyScheme() {
  openNewScheme()
  newSchemeSource.value = COPY_SOURCE
  copyFromScheme.value = activeScheme.value
  newSchemeName.value = `${activeScheme.value} 副本`.slice(0, 64)
  void nextTick(() => {
    const input = document.querySelector<HTMLInputElement>('.scheme-new input[type="text"]')
    input?.focus()
    input?.select()
  })
}

function cancelNewScheme() {
  newSchemeOpen.value = false
  newSchemeName.value = ''
  newSchemeSource.value = ''
}

async function createScheme() {
  const name = newSchemeName.value.trim()
  if (!name) {
    error.value = '请填写方案名'
    return
  }
  if (schemes.value.some((item) => item.name === name)) {
    error.value = `已有同名方案「${name}」`
    return
  }
  if (!confirmDiscard()) return
  schemeBusy.value = true
  message.value = ''
  error.value = ''
  try {
    const created = await createAffixPresetScheme({
      name,
      copyFrom: newSchemeSource.value === COPY_SOURCE ? copyFromScheme.value : undefined,
    })
    message.value = created.copiedFrom
      ? `已新建方案「${created.name}」（复制自「${created.copiedFrom}」：${created.entryCount} 条 / ${created.groupCount} 组）`
      : `已新建空方案「${created.name}」`
    newSchemeOpen.value = false
    newSchemeName.value = ''
    newSchemeSource.value = ''
    await loadScheme(name)
  } catch (err) {
    handleWriteError(err, '新建方案失败')
  } finally {
    schemeBusy.value = false
  }
}

async function removeActiveScheme() {
  if (isDefaultScheme.value) return
  const name = activeScheme.value
  const ok = window.confirm(
    `删掉方案「${name}」？\n这套方案的条目与分组会一起删掉，不能撤销。\n（已经复制走的用户库不受影响 —— 那是冻结的副本。）`,
  )
  if (!ok) return
  if (!confirmDiscard()) return
  schemeBusy.value = true
  message.value = ''
  error.value = ''
  try {
    await deleteAffixPresetScheme(name)
    message.value = `已删除方案「${name}」`
    await loadScheme()
  } catch (err) {
    handleWriteError(err, '删除方案失败')
  } finally {
    schemeBusy.value = false
  }
}

/** 新建方案时可以「复制现有方案」——来源清单里当前方案排最前（多数时候就是要复制它） */
const copySourceOptions = computed(() => {
  const list = [...schemes.value]
  const currentIndex = list.findIndex((item) => item.name === activeScheme.value)
  if (currentIndex <= 0) return list
  const current = list.splice(currentIndex, 1)[0]
  if (!current) return list
  return [current, ...list]
})

// ---------- 页签 ----------

const UNGROUPED_TAB = '__ungrouped__'
const activeTab = ref<string>('manage')

const activeGroupName = computed(() =>
  activeTab.value === 'manage' || activeTab.value === UNGROUPED_TAB ? '' : activeTab.value,
)

const visibleEntries = computed(() => {
  if (activeTab.value === 'manage') return []
  if (activeTab.value === UNGROUPED_TAB) return entries.value.filter((entry) => !entry.group)
  return entries.value.filter((entry) => entry.group === activeTab.value)
})

const activeGroup = computed(
  () => groups.value.find((group) => group.name === activeGroupName.value) ?? null,
)

/** 有未分组条目才给页签（删组或新增未选组的条目时它会冒出来） */
const hasUngrouped = computed(() => entries.value.some((entry) => !entry.group))

const enabledCount = computed(() => entries.value.filter((entry) => entry.enabledByDefault).length)

const allVisibleEnabled = computed(
  () =>
    visibleEntries.value.length > 0 &&
    visibleEntries.value.every((entry) => entry.enabledByDefault),
)

/** 当前页的组被删掉时退回组管理页，避免停在一个不存在的页上 */
watch(activeGroupName, (name) => {
  if (!name) return
  if (!groups.value.some((group) => group.name === name)) activeTab.value = 'manage'
})

/** 未分组页同理：最后一条未分组条目被删掉后，那个页签就没了 */
watch(hasUngrouped, (has) => {
  if (!has && activeTab.value === UNGROUPED_TAB) activeTab.value = 'manage'
})

/**
 * 切进某个组页时，新增表单的「分组」跟着预选该组。
 *
 * 只在草稿还没选组时填（`!draft.group`）—— 人家手动选过就尊重人家的选择。
 */
watch(activeTab, (tab) => {
  if (tab === 'manage' || tab === UNGROUPED_TAB) return
  if (!draft.value.group) draft.value.group = tab
})

// ---------- 条目编辑（只改草稿） ----------

function nextEntrySortOrder(): number {
  const orders = entries.value.map((entry) => Number(entry.sortOrder) || 0)
  return orders.length ? Math.max(...orders) + 1 : 0
}

function nextGroupSortOrder(): number {
  const orders = groups.value.map((group) => Number(group.sortOrder) || 0)
  return orders.length ? Math.max(...orders) + 1 : 0
}

/** 目标字段的中文名：管理员最常犯的错就是字段名拼错，这里当场给反馈（认不出＝计算页会跳过它） */
function targetHint(target: string): string {
  return isAffixLibraryEntryTarget(target)
    ? `→ ${affixTargetLabel(target)}`
    : '认不出这个字段名（计算页会跳过它）'
}

function targetRecognized(target: string): boolean {
  return isAffixLibraryEntryTarget(target)
}

/** 每档值的单位（百分比字段显示 `%`） */
function perRollUnit(target: string): string {
  return isAffixLibraryEntryTarget(target) && affixPerRollUnit(target) === 'percent' ? '%' : ''
}

/** ID 输入失焦时去掉首尾空格（改 ID 的确认留到保存时统一做） */
function trimEntryId(row: EntryRow) {
  row.id = row.id.trim()
}

/** 条目行是否走「自定义字段名」输入框（管理员手动切的，或草稿里本来就是个认不出的值） */
const customTargetIds = ref<string[]>([])

function isCustomTarget(row: EntryRow): boolean {
  return customTargetIds.value.includes(row._key) || !KNOWN_TARGETS.has(row.target)
}

function enterCustomTarget(key: string) {
  if (!customTargetIds.value.includes(key)) customTargetIds.value = [...customTargetIds.value, key]
}

function leaveCustomTarget(key: string) {
  customTargetIds.value = customTargetIds.value.filter((item) => item !== key)
}

/** 行内「目标」下拉：选已知字段直接进草稿；选「自定义」只切输入框 */
async function onPickTarget(row: EntryRow, event: Event) {
  const select = event.target as HTMLSelectElement
  if (select.value === CUSTOM_TARGET) {
    // 先抓住单元格：select 会被换成 input，等 nextTick 后它自己已经脱离 DOM
    const cell = select.parentElement
    enterCustomTarget(row._key)
    await nextTick()
    cell?.querySelector<HTMLInputElement>('.target-input')?.focus()
    return
  }
  leaveCustomTarget(row._key)
  row.target = select.value
}

/** 自定义输入框：值又变回已知字段时自动切回下拉（不用再点一次） */
function onCommitCustomTarget(row: EntryRow) {
  row.target = row.target.trim()
  if (KNOWN_TARGETS.has(row.target)) leaveCustomTarget(row._key)
}

function toggleAllVisible() {
  const next = !allVisibleEnabled.value
  for (const entry of visibleEntries.value) entry.enabledByDefault = next
}

function removeEntry(row: EntryRow) {
  const ok = window.confirm(
    `删掉条目「${row.label.trim() || row.id}」？\n（还没写库：点「保存」才生效，点「放弃改动」可以撤销）`,
  )
  if (!ok) return
  entries.value = entries.value.filter((entry) => entry._key !== row._key)
}

// ---------- 分组编辑（只改草稿） ----------

const groupError = ref<string | null>(null)

/**
 * 改组名：**连同组内条目的分组引用一起改**（都在草稿里改，保存时一次写库）。
 * 只改组名的话，组内条目会指向一个不存在的组 —— 那种条目在用户侧根本看不见。
 */
function onRenameGroup(row: GroupRow) {
  const next = row.name.trim()
  if (!next || next === row._lastName) {
    row.name = row._lastName
    return
  }
  if (groups.value.some((group) => group._key !== row._key && group.name.trim() === next)) {
    groupError.value = `已有同名分组「${next}」`
    row.name = row._lastName
    return
  }
  groupError.value = null
  for (const entry of entries.value) {
    if (entry.group === row._lastName) entry.group = next
  }
  if (activeTab.value === row._lastName) activeTab.value = next
  row._lastName = next
  row.name = next
}

/** 删组：只删组，组内条目变回未分组（条目不会跟着消失） */
function removeGroup(row: GroupRow) {
  const affected = entries.value.filter((entry) => entry.group === row._lastName).length
  const ok = window.confirm(
    `删掉分组「${row._lastName}」？\n组内 ${affected} 条条目会变回「未分组」（条目本身不删）。\n（还没写库：点「保存」才生效，点「放弃改动」可以撤销）`,
  )
  if (!ok) return
  for (const entry of entries.value) {
    if (entry.group === row._lastName) entry.group = ''
  }
  groups.value = groups.value.filter((group) => group._key !== row._key)
  if (activeTab.value === row._lastName) activeTab.value = 'manage'
}

// ---------- 新增条目（进草稿） ----------

function createDraft() {
  return {
    id: '',
    label: '',
    // 从最常见的「副词条」起步（旧管理页同款默认值），管理员通常只改字段名
    target: 'panel:dmgBonus',
    perRoll: 30,
    cap: 1,
    group: '',
    rollCost: 1,
    enabledByDefault: false,
    sortOrder: 0,
  }
}

const draft = ref(createDraft())
const draftError = ref<string | null>(null)

/**
 * 管理员手动改过 id 没有。
 *
 * 没改过就跟着「分组 / 目标 / 每档」自动重算（新增时多数情况根本不用碰 id）；
 * 改过之后不再覆盖 —— 手写的意图优先于生成器。
 */
const draftIdTouched = ref(false)

/**
 * 按规范推一个 id。
 *
 * 撞名时接 `_2`、`_3`（`set:x:10` 这类 id 里已经带数字，再拼 `:2` 会被读成另一个数值）。
 * 推出来的只是**建议值**：新增表单里的 id 输入框可改，改过就不再覆盖。
 */
function suggestEntryId(group: string, target: string, perRoll: number, taken: Set<string>): string {
  const trimmed = group.trim()
  const field = target.startsWith('stat:')
    ? target.slice('stat:'.length)
    : target.startsWith('panel:')
      ? target.slice('panel:'.length)
      : target
  const slotMatch = /^([456])\s*号位$/.exec(trimmed)
  let base: string
  if (slotMatch) {
    base = `main:slot${slotMatch[1]}:${MAIN_SLOT_FIELD_ALIASES[field] ?? field}`
  } else if (trimmed === '2件套') {
    base = `set:${field}:${Number.isFinite(perRoll) ? perRoll : 0}`
  } else if (target.startsWith('stat:')) {
    base = `substat:${field}`
  } else {
    base = `panel:${field}`
  }
  if (!taken.has(base)) return base
  let suffix = 2
  while (taken.has(`${base}_${suffix}`)) suffix += 1
  return `${base}_${suffix}`
}

/** 新增表单当前建议的 id（按规范生成 + 避开草稿里已用的） */
const suggestedDraftId = computed(() =>
  suggestEntryId(
    draft.value.group,
    draft.value.target,
    draft.value.perRoll,
    new Set(entries.value.map((entry) => entry.id.trim())),
  ),
)

watch(
  suggestedDraftId,
  (id) => {
    if (!draftIdTouched.value) draft.value.id = id
  },
  { immediate: true },
)

/** 新增表单的「目标」：下拉选已知字段，或切自定义输入 */
const draftTargetCustom = ref(false)

function onPickDraftTarget(event: Event) {
  const select = event.target as HTMLSelectElement
  if (select.value === CUSTOM_TARGET) {
    draftTargetCustom.value = true
    void nextTick(() =>
      document.querySelector<HTMLInputElement>('.add-entry .target-input')?.focus(),
    )
    return
  }
  draftTargetCustom.value = false
  draft.value.target = select.value
}

/** 自定义输入里写回了已知字段就自动切回下拉（与条目行同一套判断） */
function onCommitDraftTarget() {
  draft.value.target = draft.value.target.trim()
  if (KNOWN_TARGETS.has(draft.value.target)) draftTargetCustom.value = false
}

const draftPerRollUnit = computed(() =>
  affixPerRollUnit(draft.value.target as Parameters<typeof affixPerRollUnit>[0]) === 'percent'
    ? '%'
    : '',
)

/** 新增条目：进草稿（点「保存」才写库） */
function submitDraft() {
  const id = draft.value.id.trim()
  const label = draft.value.label.trim()
  const target = draft.value.target.trim()

  if (!id) {
    draftError.value = '请填写条目 ID'
    return
  }  if (id.length > ENTRY_ID_MAX) {
    draftError.value = `条目 ID 过长（≤${ENTRY_ID_MAX}）`
    return
  }
  if (entries.value.some((entry) => entry.id.trim() === id)) {
    draftError.value = `已有同 ID 条目「${id}」——换一个 ID，或直接在上面改那一条`
    return
  }
  if (!label) {
    draftError.value = '请填写词条名称'
    return
  }
  if (!TARGET_PREFIXES.some((prefix) => target.startsWith(prefix))) {
    draftError.value = `目标须以 ${TARGET_PREFIXES.join(' 或 ')} 开头`
    return
  }
  if (!Number.isFinite(draft.value.perRoll) || draft.value.perRoll <= 0) {
    draftError.value = '每档数值须为正数'
    return
  }
  if (!Number.isFinite(draft.value.cap) || draft.value.cap < 0) {
    draftError.value = '上限须为非负数（0 = 不限）'
    return
  }
  if (!Number.isFinite(draft.value.rollCost) || draft.value.rollCost < 0) {
    draftError.value = '每档占用须为非负数'
    return
  }

  draftError.value = null
  const sortOrder = Number.isFinite(draft.value.sortOrder)
    ? draft.value.sortOrder
    : nextEntrySortOrder()
  /**
   * 落在哪个组：草稿里没选组，就落在**当前正看着的这个组**上。
   *
   * 在「5号位」页里点新增、结果条目跑到「未分组」去，是实测踩到的：多出一个未分组页签，
   * 而当前页反倒空着。人所处的位置本身就是最强的意图信号。
   */
  const fallbackGroup = activeGroupName.value || ''
  const group = draft.value.group || fallbackGroup
  entries.value = [
    ...entries.value,
    {
      id,
      label,
      target,
      perRoll: draft.value.perRoll,
      cap: draft.value.cap,
      group,
      rollCost: draft.value.rollCost,
      enabledByDefault: draft.value.enabledByDefault,
      sortOrder,
      // 草稿里新增的：`_prevId` 空，保存时不参与「改 ID」确认
      _key: nextKey(),
      _prevId: '',
    },
  ]
  // 表单复位：分组留着（常连着加同组的几条），其余清掉
  draft.value = { ...createDraft(), group }
  draft.value.sortOrder = nextEntrySortOrder()
  draftIdTouched.value = false
}

// ---------- 新增分组（进草稿） ----------

const newGroupName = ref('')
const newGroupCap = ref(DEFAULT_AFFIX_GROUP_CAP)
const newGroupSortOrder = ref(0)

function submitNewGroup() {
  const name = newGroupName.value.trim()
  if (!name) {
    groupError.value = '请填写组名'
    return
  }
  if (groups.value.some((group) => group.name.trim() === name)) {
    groupError.value = `已有同名分组「${name}」`
    return
  }
  groupError.value = null
  groups.value = [
    ...groups.value,
    {
      name,
      cap: newGroupCap.value,
      sortOrder: newGroupSortOrder.value,
      _key: nextKey(),
      // 草稿里新增的：`_lastName` 空
      _lastName: '',
    },
  ]
  newGroupName.value = ''
  newGroupCap.value = DEFAULT_AFFIX_GROUP_CAP
  newGroupSortOrder.value = nextGroupSortOrder()
}

onMounted(() => {
  void loadScheme()
})
</script>

<template>
  <section class="editor-panel affix-preset-panel">
    <header class="panel-header">
      <h2 class="panel-title">官方预设词条库</h2>
      <p class="panel-desc">
        这里是<strong>官方预设的唯一来源</strong>：进计算页的人都会拿到这份。用户能复制一份到自己的
        浏览器里随便改，但改不回这里。用户一旦复制走，那份就是<strong>冻结的副本</strong> ——
        这里之后怎么改都不会影响它，改动只对<strong>之后新建</strong>的库生效。
      </p>
      <p class="panel-desc panel-desc--save">
        改动先存在本页草稿里，<strong>点「保存」才写进数据库</strong>（整套方案一次提交，要么全成、
        要么全不成）。没保存就想走，点「放弃改动」退回上次读取的内容。
      </p>
    </header>

    <p v-if="loading && !loaded" class="panel-hint">正在从数据库读取官方预设…</p>
    <p v-else-if="error && !loaded" class="form-error">{{ error }}</p>

    <template v-else>
      <!-- 方案（多套官方预设）：用户侧拿的是「默认」那一套 -->
      <div class="scheme-bar">
        <span class="scheme-label">方案</span>
        <button
          v-for="item in schemes"
          :key="item.name"
          type="button"
          class="chip"
          :class="{ active: item.name === activeScheme }"
          :disabled="busy || schemeBusy"
          :title="`${item.entryCount} 条${item.isDefault ? '（默认方案：用户侧拿到的就是这一套）' : ''}`"
          @click="switchScheme(item.name)"
        >
          {{ item.name }}<span class="scheme-count">{{ item.entryCount }}</span>
        </button>
        <button
          type="button"
          class="chip"
          :disabled="busy || schemeBusy"
          title="新建一套官方预设（可从现有方案复制一份）"
          @click="openNewScheme"
        >
          + 新建方案
        </button>
        <!--
          复制当前方案（用户 2026-09-13「从0建设太麻烦了，所以要这个功能」）：
          一键把「新建」面板预置成「复制现有方案 · 当前这套」，名字都填好，
          改个名就能创建 —— 从零搭一套 50 条是没人愿意干的事。
        -->
        <button
          type="button"
          class="chip"
          :disabled="busy || schemeBusy || !activeScheme"
          :title="`把「${activeScheme}」整份复制成一套新方案`"
          @click="openCopyScheme"
        >
          复制当前方案
        </button>
        <span class="stat-spacer" />
        <!--
          方案之间是**平级**的（用户 2026-09-13「他们应该是平级的」）：
          删除入口一律显示，只是默认方案不能删 —— 按钮置灰 + 说明为什么，
          而不是「这一套悄悄少了个按钮」。
        -->
        <button
          type="button"
          class="secondary-btn danger-lite"
          :disabled="busy || schemeBusy || isDefaultScheme"
          :title="
            isDefaultScheme
              ? '默认方案决定用户侧拿到哪一份预设，不能删除'
              : '删掉当前这套方案的条目与分组，不能撤销'
          "
          @click="removeActiveScheme"
        >
          删除当前方案
        </button>
      </div>

      <!-- 新建方案：名称 + 内容来源（空白 / 复制现有） -->
      <div v-if="newSchemeOpen" class="scheme-new">
        <div class="scheme-new-grid">
          <label>
            <span>方案名</span>
            <input v-model="newSchemeName" type="text" maxlength="64" placeholder="如：暴击流" />
          </label>
          <label>
            <span>内容来源</span>
            <select v-model="newSchemeSource">
              <option value="">空白方案（条目与分组都从零建）</option>
              <option :value="COPY_SOURCE">复制现有方案…</option>
            </select>
          </label>
          <label v-if="newSchemeSource === COPY_SOURCE">
            <span>复制自</span>
            <select v-model="copyFromScheme">
              <option v-for="item in copySourceOptions" :key="item.name" :value="item.name">
                {{ item.name }}（{{ item.entryCount }} 条）
              </option>
            </select>
          </label>
          <button type="button" class="primary-btn" :disabled="schemeBusy" @click="createScheme">
            {{ schemeBusy ? '创建中…' : '创建' }}
          </button>
          <button
            type="button"
            class="secondary-btn"
            :disabled="schemeBusy"
            @click="cancelNewScheme"
          >
            取消
          </button>
        </div>
        <p class="footnote">
          复制＝把选中那套方案的条目与分组整份搬过来，之后两套各自独立；空方案从零搭。
          新建出来的方案<strong>不是</strong>默认方案 —— 默认方案决定用户侧拿到哪一份。
        </p>
      </div>

      <p v-if="message" class="form-ok">{{ message }}</p>
      <p v-if="error" class="form-error">{{ error }}</p>

      <!--
        状态行：计数 + 未保存改动 + 保存 / 放弃改动 / 重新读取。
        保存控件放在「重新读取」**左边**（用户 2026-09-13「把这2个按钮和状态就放到现在
        重新读取位置 左侧」）—— 一行里管完这一页的读写，不再单独占一条常驻条。
      -->
      <div class="stat-row">
        <span>条目 <strong>{{ entries.length }}</strong> 条</span>
        <span>默认启用 <strong>{{ enabledCount }}</strong> 条</span>
        <span>分组 <strong>{{ groups.length }}</strong> 个</span>
        <span class="stat-spacer" />
        <span class="save-state" :class="{ 'save-state--dirty': pendingChanges > 0 }">
          {{
            pendingChanges > 0 ? `未保存改动：${pendingSummary}` : '没有未保存的改动'
          }}
        </span>
        <button
          type="button"
          class="primary-btn"
          :disabled="busy || pendingChanges === 0"
          @click="saveDraft"
        >
          {{ busy ? '保存中…' : '保存' }}
        </button>
        <button
          type="button"
          class="secondary-btn"
          :disabled="busy || pendingChanges === 0"
          @click="discardDraft"
        >
          放弃改动
        </button>
        <button type="button" class="secondary-btn" :disabled="loading || busy" @click="reload">
          {{ loading ? '读取中…' : '重新读取' }}
        </button>
      </div>

      <div class="tab-strip" role="tablist">
        <button
          type="button"
          class="chip"
          :class="{ active: activeTab === 'manage' }"
          role="tab"
          :aria-selected="activeTab === 'manage'"
          @click="activeTab = 'manage'"
        >
          组管理
        </button>
        <button
          v-for="group in groups"
          :key="group._key"
          type="button"
          class="chip"
          :class="{ active: activeTab === group.name }"
          role="tab"
          :aria-selected="activeTab === group.name"
          @click="activeTab = group.name"
        >
          {{ group.name }}
        </button>
        <button
          v-if="hasUngrouped"
          type="button"
          class="chip"
          :class="{ active: activeTab === UNGROUPED_TAB }"
          role="tab"
          :aria-selected="activeTab === UNGROUPED_TAB"
          @click="activeTab = UNGROUPED_TAB"
        >
          未分组
        </button>
      </div>

      <!-- 组页首行：组名 + 组额度（额度只在这里显示，改在组管理页） -->
      <div v-if="activeGroup" class="group-head">
        <span class="group-head-name">{{ activeGroup.name }}</span>
        <span class="group-head-cap">
          组额度：
          <strong>{{ Number(activeGroup.cap) === 0 ? '不限制' : activeGroup.cap }}</strong>
        </span>
        <span class="group-head-hint">
          {{
            Number(activeGroup.cap) === 0
              ? '这几条可以同时用满各自上限'
              : '组内各条档数之和 ≤ 额度（改额度去「组管理」页）'
          }}
        </span>
        <button
          type="button"
          class="chip group-select-all"
          :disabled="!visibleEntries.length || busy"
          :title="allVisibleEnabled ? '本页条目全部取消默认启用' : '本页条目全部默认启用'"
          @click="toggleAllVisible"
        >
          {{ allVisibleEnabled ? '全部取消默认' : '全部默认启用' }}
        </button>
      </div>
      <div v-else-if="activeTab === UNGROUPED_TAB" class="group-head">
        <span class="group-head-name">未分组</span>
        <span class="group-head-hint">这些条目不属于任何组，彼此不约束</span>
        <button
          type="button"
          class="chip group-select-all"
          :disabled="!visibleEntries.length || busy"
          :title="allVisibleEnabled ? '本页条目全部取消默认启用' : '本页条目全部默认启用'"
          @click="toggleAllVisible"
        >
          {{ allVisibleEnabled ? '全部取消默认' : '全部默认启用' }}
        </button>
      </div>

      <!-- 条目页：与用户侧同一张表，多出 ID / 每档占用 / 排序三列 -->
      <template v-if="activeTab !== 'manage'">
        <div class="table-scroll">
          <table class="preset-table preset-table--entries">
            <colgroup>
              <col class="col-default" />
              <col class="col-id" />
              <col class="col-label" />
              <col class="col-target" />
              <col class="col-perroll" />
              <col class="col-cap" />
              <col class="col-rollcost" />
              <col class="col-group" />
              <col class="col-sort" />
              <col class="col-del" />
            </colgroup>
            <thead>
              <tr>
                <th class="th-admin-only" title="勾上 = 新用户拿到这份预设时，这条本来就参与计算。用户侧只能在自己那份里勾选，改不到这里的默认值">
                  默认启用
                </th>
                <th
                  class="th-admin-only"
                  title="条目 ID：条目的对外身份（导出、复制方案、之后新建的库都按它走）。用户侧看不见也改不了"
                >
                  ID
                </th>
                <th title="给用户看的名字，自由文本；用户侧可改自己那份的副本">名称</th>
                <th title="这条实际加哪个属性；stat: 走词条计数桶、panel: 走局外面板增量。用户侧只读（改目标＝删了重建）">
                  目标
                </th>
                <th title="配 1 档加多少（数值与该属性的单位一致）">每档</th>
                <th title="这条最多能配几档；0 = 不设上限（求解器还受组额度与总预算约束）">
                  上限
                </th>
                <th
                  class="th-admin-only"
                  title="配 1 档要吃掉几个「总词条数」预算：填 2 就是这条 1 档顶别人 2 档。用户侧条目固定为 1，改不了"
                >
                  每档占用
                </th>
                <th title="同一组共享一个档数额度；组额度 0 = 组内不互相约束">分组</th>
                <th
                  class="th-admin-only"
                  title="展示顺序，小的在前（保存后按新顺序重排）；同一套方案里不能重复。用户侧没有这个概念"
                >
                  排序
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="entry in visibleEntries"
                :key="entry._key"
                :class="{ disabled: !entry.enabledByDefault }"
              >
                <td>
                  <input
                    v-model="entry.enabledByDefault"
                    type="checkbox"
                    :disabled="busy"
                  />
                </td>
                <!-- ID 可改：它是条目的对外身份，保存时会列出 旧→新 让人确认一次 -->
                <td class="id-cell">
                  <input
                    v-model="entry.id"
                    class="cell-input id-input"
                    type="text"
                    :maxlength="ENTRY_ID_MAX"
                    :disabled="busy"
                    title="条目 ID：条目的对外身份（导出、复制方案、之后新建的库都按它走）"
                    @change="trimEntryId(entry)"
                  />
                </td>
                <td>
                  <input v-model="entry.label" class="cell-input" type="text" :disabled="busy" />
                </td>
                <td>
                  <!-- 目标：下拉选已知字段（按落点分组），或切「自定义」手写字段名 -->
                  <select
                    v-if="!isCustomTarget(entry)"
                    class="cell-input"
                    :value="entry.target"
                    :disabled="busy"
                    :title="`${entry.target}｜stat: 走词条计数桶、panel: 走面板字段`"
                    @change="onPickTarget(entry, $event)"
                  >
                    <optgroup
                      v-for="group of TARGET_OPTION_GROUPS"
                      :key="group.label"
                      :label="group.label"
                    >
                      <option v-for="opt in group.options" :key="opt.id" :value="opt.id">
                        {{ opt.label }}
                      </option>
                    </optgroup>
                    <option :value="CUSTOM_TARGET">自定义字段名（不在这两份清单里）…</option>
                  </select>
                  <!-- 自定义模式才需要这行小字：下拉里已经显示中文名，再写一遍是噪音 -->
                  <template v-else>
                    <input
                      v-model="entry.target"
                      class="cell-input target-input"
                      type="text"
                      placeholder="stat:xxx 或 panel:xxx"
                      :disabled="busy"
                      @change="onCommitCustomTarget(entry)"
                    />
                    <span
                      class="cell-hint"
                      :class="{ 'cell-hint--warn': !targetRecognized(entry.target) }"
                    >
                      {{ targetHint(entry.target) }}
                    </span>
                  </template>
                </td>
                <td>
                  <span class="per-roll-cell">
                    <input
                      v-model.number="entry.perRoll"
                      class="cell-input num"
                      type="number"
                      step="0.1"
                      :disabled="busy"
                    />
                    <!-- 单位槽恒存在：用 v-if 会让百分比行的输入框被单位挤窄，整列右边缘参差不齐 -->
                    <span class="unit-hint">{{ perRollUnit(entry.target) }}</span>
                  </span>
                </td>
                <td>
                  <input
                    v-model.number="entry.cap"
                    class="cell-input num"
                    type="number"
                    min="0"
                    step="1"
                    title="0 表示不设上限"
                    :disabled="busy"
                  />
                </td>
                <td>
                  <input
                    v-model.number="entry.rollCost"
                    class="cell-input num"
                    type="number"
                    min="0"
                    step="1"
                    title="每条词条占几个「总词条数」预算；用户侧固定为 1"
                    :disabled="busy"
                  />
                </td>
                <td>
                  <select v-model="entry.group" class="cell-input" :disabled="busy">
                    <option value="">（未分组）</option>
                    <option v-for="group in groups" :key="group._key" :value="group.name">
                      {{ group.name }}
                    </option>
                  </select>
                </td>
                <td>
                  <input
                    v-model.number="entry.sortOrder"
                    class="cell-input num"
                    type="number"
                    step="1"
                    title="展示顺序（小的在前）；保存后列表按新顺序排列"
                    :disabled="busy"
                  />
                </td>
                <td>
                  <button
                    type="button"
                    class="del-btn"
                    title="从草稿里删掉这条（点「保存」才写库）"
                    :disabled="busy"
                    @click="removeEntry(entry)"
                  >
                    ×
                  </button>
                </td>
              </tr>
              <tr v-if="!visibleEntries.length">
                <td colspan="10" class="empty-cell">这一页没有条目。</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="add-entry">
          <h5>新增词条</h5>
          <div class="add-grid">
            <label class="add-grid--wide">
              <span>
                ID
                <em class="field-note">
                  {{
                    draftIdTouched
                      ? '已手改（跟着分组 / 目标 / 每档自动生成的那份不再覆盖它）'
                      : `按规范自动生成：${suggestedDraftId || '（先选分组和目标）'}`
                  }}
                </em>
              </span>
              <input
                v-model="draft.id"
                type="text"
                :maxlength="ENTRY_ID_MAX"
                placeholder="如 main:slot4:critDmg"
                @input="draftIdTouched = true"
              />
            </label>
            <label>
              <span>名称</span>
              <input v-model="draft.label" type="text" placeholder="如 爆伤 48%" />
            </label>
            <label class="add-grid--wide">
              <span>
                目标
                <em class="field-note">{{ draftTargetCustom ? '自定义字段名' : '从清单里选' }}</em>
              </span>
              <select v-if="!draftTargetCustom" :value="draft.target" @change="onPickDraftTarget">
                <optgroup
                  v-for="group of TARGET_OPTION_GROUPS"
                  :key="group.label"
                  :label="group.label"
                >
                  <option v-for="opt in group.options" :key="opt.id" :value="opt.id">
                    {{ opt.label }}
                  </option>
                </optgroup>
                <option :value="CUSTOM_TARGET">自定义字段名（不在这两份清单里）…</option>
              </select>
              <input
                v-else
                v-model="draft.target"
                class="target-input"
                type="text"
                placeholder="stat:critDmg 或 panel:dmgBonus"
                @change="onCommitDraftTarget"
              />
            </label>
            <label>
              <span>每档</span>
              <span class="per-roll-cell">
                <input v-model.number="draft.perRoll" type="number" step="0.1" min="0" />
                <span class="unit-hint">{{ draftPerRollUnit }}</span>
              </span>
            </label>
            <label>
              <span>上限（0=不限）</span>
              <input v-model.number="draft.cap" type="number" min="0" step="1" />
            </label>
            <label>
              <span>每档占用</span>
              <input v-model.number="draft.rollCost" type="number" min="0" step="1" />
            </label>
            <label>
              <span>分组</span>
              <select v-model="draft.group">
                <option value="">（未分组）</option>
                <option v-for="group in groups" :key="group._key" :value="group.name">
                  {{ group.name }}
                </option>
              </select>
            </label>
            <label>
              <span>排序</span>
              <input v-model.number="draft.sortOrder" type="number" step="1" />
            </label>
            <label class="add-grid--check">
              <span>默认启用</span>
              <input v-model="draft.enabledByDefault" type="checkbox" />
            </label>
            <button type="button" class="primary-btn" :disabled="busy" @click="submitDraft">
              添加
            </button>
          </div>
          <p v-if="draftError" class="form-error">{{ draftError }}</p>

          <!-- ID 规范：只有一个出处的说明放在这里，避免各处手写各说各话 -->
          <p class="footnote">
            新增先进草稿，点上方的「保存」才写库。<strong>ID 是条目的对外身份</strong>
            （导出文件、复制方案、之后新建的库都按它走）；已经复制走的用户库是冻结副本，不受影响。
            规范：
          </p>
          <ul class="id-rules">
            <li v-for="rule in ENTRY_ID_RULES" :key="rule.match">
              <span class="rule-match">{{ rule.match }}</span>
              <code>{{ rule.format }}</code>
              <span class="rule-example">如 <code>{{ rule.example }}</code></span>
            </li>
          </ul>
          <p class="footnote">
            按这个规范填，之后无论谁看这条 ID 都能一眼认出它从哪来。撞名时生成器接
            <code>_2</code>（<code>set:</code> 开头的 ID 里已经带数值，不再拼 <code>:2</code>）。
            目标从清单里选就不用手打字段名；清单里没有的（前端还没支持的新字段）用「自定义」手写，
            写错了下面会标红 —— 认不出的字段名计算页会跳过它。
          </p>
        </div>

        <!--
          列说明（用户 2026-09-13「这种说明统一移到下面」）：原来只有「上限 / 每档占用」两行、
          还挂在表格上方；现在统一放表格下面，并把每列的含义与排序规则都写全。
        -->
        <section class="column-legend">
          <h4>各列是什么意思</h4>
          <dl>
            <dt class="legend-admin-only">默认启用</dt>
            <dd>
              勾上＝新用户拿到这份预设时，这条本来就在参与计算。用户侧只在自己那份副本里勾选，改不到这里的默认值。
            </dd>

            <dt class="legend-admin-only">ID</dt>
            <dd>
              条目的对外身份：导出文件、复制方案、之后新建的用户库都按它走。发布后别改（改要按保存时的确认走）。
              命名规范见上面「新增词条」那段。
            </dd>

            <dt>名称</dt>
            <dd>给用户看的名字，自由文本；用户可改自己那份的副本。</dd>

            <dt>目标</dt>
            <dd>
              这条<strong>实际</strong>加哪个属性（名称只是文本，可能对不上）。<code>stat:</code>
              走词条计数桶、<code>panel:</code> 走局外面板增量；认不出的字段名计算页会跳过它
              （会标红提醒）。
            </dd>

            <dt>每档</dt>
            <dd>配 1 档加多少，单位随目标字段（百分比字段显示 <code>%</code>）。</dd>

            <dt>上限</dt>
            <dd>
              这条最多能配几档；<strong>0 = 不设上限</strong>。求解器实际取值是三者取最小：
              自己的上限 − 已用、组额度 − 组内已用、总词条数预算还剩多少。
            </dd>

            <dt class="legend-admin-only">每档占用</dt>
            <dd>
              配 1 档要吃掉几个「总词条数」预算：填 2 就是这条 1 档顶别人 2 档。
              用户侧条目固定是 1，改不了；只有官方预设能配成别的值。
            </dd>

            <dt>分组</dt>
            <dd>
              同一组共享一个档数额度（额度在「组管理」页维护）。组额度 0 = 组内不互相约束，只是归类。
            </dd>

            <dt class="legend-admin-only">排序</dt>
            <dd>
              列表与页签的先后，<strong>小的在前</strong>；<strong>同一套方案里必须唯一</strong>——
              条目一条序列、分组另一条序列，可以跳号（1、50 也行），但不许同号：
              重复的保存会被拦下（前端先拦一道，后端再拦一道）。
              <br />
              规则细节：① 服务端按它取数，所以<strong>保存之后</strong>列表才重排；
              ② 它<strong>不影响数值</strong> —— 同目标的条目是<strong>相加</strong>的，
              不存在「取某一条」这回事，顺序只决定谁先出现在列表里。
            </dd>
          </dl>
          <p class="legend-note">
            <span class="legend-swatch" />红字列＝用户侧只能读、不能改，只在管理侧维护。
          </p>
        </section>
      </template>
      <!-- 组管理页：建 / 改名 / 改额度 / 改排序 / 删（额度只在这一处维护） -->
      <template v-else>
        <div class="table-scroll">
          <table class="preset-table preset-table--groups">
            <colgroup>
              <col class="col-groupname" />
              <col class="col-groupcap" />
              <col class="col-groupsort" />
              <col class="col-groupnote" />
              <col class="col-del" />
            </colgroup>
            <thead>
              <tr>
                <th title="改名会连同组内条目的分组一起改（保存时一次写库）">组名</th>
                <th title="组内各条档数之和的上限；0 = 不限">组额度</th>
                <th title="分组展示顺序，小的在前；同一套方案里不能重复">排序</th>
                <th>说明</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="group in groups" :key="group._key">
                <td>
                  <input
                    v-model="group.name"
                    class="cell-input"
                    type="text"
                    :disabled="busy"
                    title="改名会连同组内条目的分组一起改"
                    @change="onRenameGroup(group)"
                  />
                </td>
                <td>
                  <input
                    v-model.number="group.cap"
                    class="cell-input num"
                    type="number"
                    min="0"
                    step="1"
                    title="组内各条档数之和的上限；0 = 不限"
                    :disabled="busy"
                  />
                </td>
                <td>
                  <input
                    v-model.number="group.sortOrder"
                    class="cell-input num"
                    type="number"
                    step="1"
                    title="分组展示顺序（小的在前）"
                    :disabled="busy"
                  />
                </td>
                <td class="note-cell">
                  {{
                    Number(group.cap) === 0
                      ? '0 = 不限制（这几条可以同时用满各自上限）'
                      : '组内各条档数之和 ≤ 额度'
                  }}
                  · 组内 {{ entries.filter((entry) => entry.group === group.name).length }} 条
                </td>
                <td>
                  <button
                    type="button"
                    class="del-btn"
                    title="从草稿里删掉这个分组，组内条目会变回未分组（点「保存」才写库）"
                    :disabled="busy"
                    @click="removeGroup(group)"
                  >
                    ×
                  </button>
                </td>
              </tr>
              <tr v-if="!groups.length">
                <td colspan="5" class="empty-cell">
                  还没有分组。分组用来表达「这几条共享一个档数额度」—— 比如 5 号位主属性只能选一个，
                  就建一个额度 1 的组，把候选条目放进去。
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="add-entry">
          <h5>新建分组</h5>
          <div class="add-grid">
            <label>
              <span>组名</span>
              <input v-model="newGroupName" type="text" placeholder="如：5号位主属性" />
            </label>
            <label>
              <span>组额度</span>
              <input
                v-model.number="newGroupCap"
                type="number"
                min="0"
                step="1"
                title="组内各条档数之和的上限；0 = 不限"
              />
            </label>
            <label>
              <span>排序</span>
              <input v-model.number="newGroupSortOrder" type="number" step="1" />
            </label>
            <button type="button" class="primary-btn" :disabled="busy" @click="submitNewGroup">
              新增分组
            </button>
          </div>
          <p class="footnote">
            组额度 = 组内各条档数之和的上限（4/5/6 号位、2 件套用 1：只能选一条）。
            删分组只删组本身，条目在「分组」下拉里选组；组改名会连同组内条目一起改。
            新增先进草稿，点上方的「保存」才写库。
          </p>
        </div>
      </template>
    </template>

    <!-- 会话过期：写接口被 401 顶回来时给一条明确出路（而不是干瞪着一行红字） -->
    <AdminConfirmDialog
      :visible="authDialogVisible"
      title="需要重新登录"
      message="当前后台会话无效或已过期，改动没法写进数据库。请重新登录管理员账号，回来后这一页会重新读取。"
      confirm-text="去登录"
      cancel-text="稍后"
      @confirm="goRelogin"
      @cancel="authDialogVisible = false"
    />
  </section>
</template>

<style scoped>
/**
 * 配色一律走主题变量（与其他管理页一致）：写死深色在白天模式下会变成
 * 「浅色页面上浮着深色卡片」（旧管理页 2026-09-12 实测踩过）。
 * 结构照用户侧词条库弹窗右栏那张表 —— 两边要「看起来是同一套」。
 */
.affix-preset-panel {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.panel-hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text);
  opacity: 0.75;
}

/* 「改动先存草稿」那条说明：与上面的介绍拉开一点距离，别糊成一段 */
.panel-desc--save {
  margin-top: 0.5rem;
  padding: 0.45rem 0.6rem;
  border-left: 3px solid #e8a838;
  border-radius: 0 6px 6px 0;
  background: var(--color-background-soft);
  opacity: 0.9;
  text-align: left;
}

/* 列义说明：给「上限 / 每档占用」这类容易被误读的列配一句 */
.column-legend {
  margin: 0;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  font-size: 0.76rem;
  line-height: 1.55;
  color: var(--color-text);
}

.column-legend h4 {
  margin: 0 0 0.45rem;
  font-size: 0.84rem;
  color: var(--color-heading);
}

.column-legend dl {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 0.3rem 0.7rem;
  margin: 0;
}

.column-legend dt {
  font-weight: 600;
  color: var(--color-heading);
  white-space: nowrap;
}

.column-legend dd {
  margin: 0;
}

.column-legend code {
  padding: 0 0.25rem;
  border-radius: 4px;
  background: var(--color-background-mute);
  font-family: var(--zzz-font-mono, monospace);
  font-size: 0.72rem;
}

/*
 * 红字＝用户侧只能读的列（表头也是这个色）。
 * 选择器带上 `.preset-table` / `.column-legend`：不然会被 `.preset-table th { color: … }`
 * 与 `.column-legend dt { color: … }` 按优先级压掉（实测：只写类名时颜色不生效）。
 */
.preset-table th.th-admin-only,
.column-legend dt.legend-admin-only {
  color: #e85d4c;
}

.legend-note {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.55rem 0 0;
  font-size: 0.74rem;
  opacity: 0.85;
}

.legend-swatch {
  flex: 0 0 0.6rem;
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 2px;
  background: #e85d4c;
}

@media (max-width: 720px) {
  .column-legend dl {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* ---------- 方案 ---------- */

.scheme-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.scheme-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-heading);
}

.scheme-count {
  margin-left: 0.3rem;
  font-size: 0.72rem;
  opacity: 0.65;
}

.scheme-new {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 0.7rem 0.85rem;
}

.scheme-new-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.5rem;
  align-items: end;
}

.scheme-new-grid label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.76rem;
  color: var(--color-text);
}

.scheme-new-grid input,
.scheme-new-grid select {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  background: var(--color-background);
  color: var(--color-heading);
  font: inherit;
  font-size: 0.82rem;
}

/* 「删除当前方案」：危险动作，但别用大红色块抢视线 */
.danger-lite {
  color: #e85d4c;
  border-color: color-mix(in srgb, #e85d4c 35%, var(--color-border));
}

/* ---------- 状态行里的未保存状态 ---------- */

/*
 * 未保存状态跟着保存按钮走（用户 2026-09-13：把状态和两个按钮放到「重新读取」左边）。
 * 没有改动时不抢眼；有改动时才用金色——状态与按钮的可用性始终对得上。
 */
.save-state {
  font-size: 0.85rem;
  color: var(--color-text);
  opacity: 0.75;
  white-space: nowrap;
}

.save-state--dirty {
  color: #a8781f;
  opacity: 1;
  font-weight: 600;
}

[data-theme='dark'] .save-state--dirty {
  color: #f0d7a2;
}

.stat-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.85rem;
  color: var(--color-text);
}

.stat-row strong {
  color: var(--color-heading);
}

.stat-spacer {
  flex: 1;
}

.tab-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  overflow-x: auto;
  padding-bottom: 0.2rem;
}

.tab-strip .chip {
  flex-shrink: 0;
}

.group-head {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  font-size: 0.85rem;
  color: var(--color-text);
}

.group-head-name {
  font-weight: 600;
  color: var(--color-heading);
}

.group-head-cap strong {
  color: #a8781f;
}

[data-theme='dark'] .group-head-cap strong {
  color: #f0d7a2;
}

.group-head-hint {
  font-size: 0.78rem;
  opacity: 0.7;
}

/* 组页「全部默认启用」：靠右站，不跟组名抢位置 */
.group-select-all {
  margin-left: auto;
  flex-shrink: 0;
}

.table-scroll {
  overflow: auto;
  max-height: 52vh;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
}

.preset-table {
  width: 100%;
  /* 固定表格布局：输入框自带约 20 字符的固有宽度，不锁列宽的话「每档 / 上限」会被撑到 200px+ */
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 0.82rem;
  color: var(--color-text);
}

.preset-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 0.45rem 0.5rem;
  background: var(--color-background-mute);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-heading);
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
}

.preset-table td {
  padding: 0.3rem 0.5rem;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}

.preset-table tr:last-child td {
  border-bottom: none;
}

.preset-table tr.disabled {
  opacity: 0.55;
}

/* 单元格里的输入框要能被列宽约束住（否则固有宽度仍是撑宽的元凶） */
.cell-input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 0.2rem 0.35rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background);
  color: var(--color-heading);
  font: inherit;
  font-size: 0.8rem;
}

.cell-input:focus {
  border-color: #e8a838;
  outline: none;
}

.cell-input:disabled {
  opacity: 0.6;
}

/**
 * 数字格：**左对齐**，并给右侧留出箭头（spinner）的距离。
 *
 * 用户 2026-09-13 附截图反馈：右对齐时数字紧贴上下箭头，点选数值极易误触箭头把值改掉。
 * 左对齐后数字与箭头之间天然隔开一整列宽度；`padding-right` 是给位数多的值兜底
 * （哪怕填到 4 位数，也还留着这道缝）。
 */
.preset-table .cell-input.num {
  text-align: left;
  padding-right: 1.15rem;
}

/* ID 格：等宽小字，弱化成「键」的样子（它不是给人读的说明文字） */
.id-input {
  font-family: var(--zzz-font-mono, monospace);
  font-size: 0.72rem;
}

/* ID 格：等宽小字交给 `.id-input`（它现在是输入框，不是纯文本） */
.id-cell {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cell-hint {
  display: block;
  margin-top: 0.1rem;
  font-size: 0.68rem;
  line-height: 1.25;
  opacity: 0.6;
}

.cell-hint--warn {
  color: #e85d4c;
  opacity: 0.9;
}

.per-roll-cell {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  width: 100%;
}

/* 输入框吃掉单位槽以外的空间；单位槽宽度固定 → 每行输入框等宽、右边缘对齐 */
.per-roll-cell > .cell-input {
  flex: 1 1 auto;
}

.unit-hint {
  flex: 0 0 0.62rem;
  width: 0.62rem;
  font-size: 0.75rem;
  line-height: 1.4;
  opacity: 0.6;
}

.note-cell {
  font-size: 0.76rem;
  opacity: 0.75;
}

.empty-cell {
  padding: 0.7rem 0.5rem;
  font-size: 0.8rem;
  opacity: 0.7;
}

/* ---------- 列宽（固定表格布局，不锁宽度输入框会把列撑到 200px+） ---------- */

.preset-table--entries .col-default {
  width: 62px;
}
.preset-table--entries .col-id {
  width: 148px;
}
.preset-table--entries .col-label {
  width: 168px;
}
.preset-table--entries .col-target {
  width: 152px;
}
.preset-table--entries .col-perroll {
  width: 96px;
}
.preset-table--entries .col-cap {
  width: 64px;
}
.preset-table--entries .col-rollcost {
  width: 70px;
}
.preset-table--entries .col-group {
  width: 108px;
}
.preset-table--entries .col-sort {
  /* 76px：两位数的「39」完整画得下（56px 时右内边距 + 数字框 spinner 吃掉可见区，
     只剩首位数字 —— 用户 2026-09-13 截图里「3333334444444」的真身，见步骤 48） */
  width: 76px;
}
.preset-table--entries .col-del,
.preset-table--groups .col-del {
  width: 32px;
}

.preset-table--groups .col-groupname {
  width: 150px;
}
.preset-table--groups .col-groupcap {
  width: 90px;
}
.preset-table--groups .col-groupsort {
  width: 70px;
}
.preset-table--groups .col-groupnote {
  width: auto;
}

.del-btn {
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}

.del-btn:hover:not(:disabled) {
  color: #e85d4c;
}

.del-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.add-entry {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 0.75rem 0.85rem;
}

.add-entry h5 {
  margin: 0 0 0.45rem;
  font-size: 0.88rem;
  color: var(--color-heading);
}

.add-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.5rem;
  align-items: end;
}

.add-grid label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.76rem;
  color: var(--color-text);
}

.add-grid input,
.add-grid select {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  background: var(--color-background);
  color: var(--color-heading);
  font: inherit;
  font-size: 0.82rem;
}

.add-grid .add-grid--check {
  flex-direction: row;
  align-items: center;
  gap: 0.35rem;
}

.add-grid--check input[type='checkbox'] {
  width: auto;
}

/* ID 与目标这两格要放下「规范说明」，给宽一点 */
.add-grid .add-grid--wide {
  grid-column: span 2;
}

.add-grid label > span {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
}

/* 字段旁边的小字说明（自动生成 / 已手改 / 从清单里选） */
.field-note {
  font-size: 0.68rem;
  font-style: normal;
  color: var(--color-text);
  opacity: 0.7;
}

.id-rules {
  margin: 0.35rem 0 0;
  padding-left: 1.1rem;
  font-size: 0.74rem;
  line-height: 1.6;
  color: var(--color-text);
}

.id-rules code,
.footnote code {
  padding: 0 0.25rem;
  border-radius: 4px;
  background: var(--color-background-mute);
  font-family: var(--zzz-font-mono, monospace);
  font-size: 0.72rem;
}

.rule-match {
  margin-right: 0.3rem;
  color: var(--color-heading);
}

.rule-example {
  margin-left: 0.4rem;
  opacity: 0.75;
}

.footnote {
  margin: 0.5rem 0 0;
  font-size: 0.74rem;
  line-height: 1.5;
  color: var(--color-text);
  opacity: 0.7;
}

@media (max-width: 900px) {
  .table-scroll {
    max-height: none;
  }

  .add-grid .add-grid--wide {
    grid-column: auto;
  }
}
</style>
