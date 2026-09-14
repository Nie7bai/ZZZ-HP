<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { AffixCounts } from '@/types/calculatorPanel'
import { ensureAffixPresetLoaded, loadAffixPresetScheme } from '@/utils/affixPresetLoader'
import type {
  BuffApplySituation,
  BuffScope,
  BuffSkillTargetId,
} from '@/types/calculator'
import {
  BUFF_SCOPE_OPTIONS,
  BUFF_SKILL_TARGET_OPTIONS,
} from '@/types/calculator'
import {
  AFFIX_GAIN_FIELDS,
  AFFIX_GAIN_FIELD_LABELS,
  AFFIX_LIBRARY_SET_NAME_MAX,
  AFFIX_PANEL_DELTA_FIELD_LABELS,
  AFFIX_SUBSTAT_KEY_LABELS,
  DEFAULT_AFFIX_GROUP_CAP,
  activateAffixLibrarySet,
  activeAffixLibrarySet,
  affixEntryConditionSummary,
  affixPerRollUnit,
  affixTargetLabel,
  createAffixLibraryStateForOrigin,
  createAffixLibraryStateFromPreset,
  createAffixLibrarySet,
  defaultAffixPresetSchemeName,
  deleteAffixLibrarySet,
  exportAffixLibrarySet,
  gainTarget,
  importAffixLibrarySet,
  isGainTarget,
  isUsingServerAffixPreset,
  loadAffixLibraryStore,
  panelTarget,
  presetAffixSchemesBase,
  renameAffixLibrarySet,
  resolveAffixLibrary,
  resolveAffixLibraryAll,
  saveAffixLibraryStore,
  statTarget,
  type AffixGainField,
  type AffixLibraryEntry,
  type AffixLibraryEntryTarget,
  type AffixLibraryGroup,
  type AffixLibraryState,
  type AffixLibraryStore,
  type AffixPanelDeltaField,
} from '@/utils/affixLibrary'

/**
 * 词条库弹窗：多套库切换 + 条目编辑 + 导入导出。
 *
 * 为什么做成弹窗：词条库内联在页面上会把布局撑很长，且「换一套配装」需要
 * 逐条改回来。多套库分开存、随时切换，编辑区收进弹窗。
 *
 * 职责划分：
 * - **库级操作**（新建 / 重命名 / 删除 / 切换 / 导入导出）由本组件自己做并落盘，
 *   完成后 emit `switched`，由页面重新载入激活库并重算；
 * - **条目级编辑与分组编辑**（启用 / 增 / 改 / 删 / 分组额度 / 恢复默认）走 emit 交给页面，
 *   沿用既有的「改了就重算」链路，不在这里另建一套状态。
 */

const props = withDefaults(
  defineProps<{
    open: boolean
    /** 当前激活库的全部条目（含未参与计算的） */
    library: AffixLibraryEntry[]
    /** 正在参与计算的条目 id */
    enabledIds: string[]
    /** 当前激活库的分组（组名 + 组额度），见分组页 */
    groups: AffixLibraryGroup[]
  }>(),
  {},
)

const emit = defineEmits<{
  close: []
  toggleEntry: [entryId: string, enabled: boolean]
  /** 一次改多条（组页的「全选 / 全部取消」）——一次落盘，不要按条 emit */
  toggleEntries: [entryIds: string[], enabled: boolean]
  addEntry: [entry: Omit<AffixLibraryEntry, 'id'>]
  updateEntry: [entryId: string, patch: Partial<AffixLibraryEntry>]
  removeEntry: [entryId: string]
  restoreDefaults: []
  /** 新建分组（额度默认 1 档） */
  addGroup: [name: string, cap: number]
  /** 改组额度 */
  setGroupCap: [name: string, cap: number]
  /** 改组名（页面负责同步条目引用） */
  renameGroup: [from: string, to: string]
  /** 只删分组，组内条目变回自由条目 */
  removeGroup: [name: string]
  /** 库级变更（切换/新建/重命名/删除/导入）已完成并落盘，页面应重新载入 */
  switched: []
}>()

const enabledSet = computed(() => new Set(props.enabledIds))

/**
 * 右栏横向分页。
 *
 * `'manage'` = 组管理（首页）；`'__ungrouped__'` = 未分组（**只在真有未分组条目时出现**，
 * 因为预设里所有条目都在组里，平时看不到它；删组或新建未选组的条目时它会冒出来，
 * 否则那些条目会在界面上凭空消失）；其余值 = 组名。
 */
const UNGROUPED_TAB = '__ungrouped__'
const activeTab = ref<string>('manage')

/** 当前页对应的组名；组管理页与未分组页为 '' */
const activeGroupName = computed(() =>
  activeTab.value === 'manage' || activeTab.value === UNGROUPED_TAB ? '' : activeTab.value,
)

/** 当前页要显示的条目 */
const visibleEntries = computed(() => {
  if (activeTab.value === 'manage') return []
  if (activeTab.value === UNGROUPED_TAB) return props.library.filter((entry) => !entry.group)
  return props.library.filter((entry) => entry.group === activeTab.value)
})

/** 当前页的组（组管理页 / 未分组页为 null） */
const activeGroup = computed(
  () => props.groups.find((group) => group.name === activeGroupName.value) ?? null,
)

/** 有未分组条目才给页签 */
const hasUngrouped = computed(() => props.library.some((entry) => !entry.group))

/** 本页条目是否**全部**已勾选（决定按钮显示「全选」还是「全部取消」） */
const allVisibleEnabled = computed(
  () => visibleEntries.value.length > 0 && visibleEntries.value.every((e) => enabledSet.value.has(e.id)),
)

/** 当前页的组被删掉时退回组管理页，避免停在一个不存在的页上 */
watch(
  () => props.groups.map((group) => group.name).join('\u0000'),
  () => {
    if (activeTab.value === 'manage' || activeTab.value === UNGROUPED_TAB) return
    if (!props.groups.some((group) => group.name === activeTab.value)) activeTab.value = 'manage'
  },
)

// ---------- 高级编辑开关 ----------

/**
 * 高级编辑：关闭时只留「勾选参与 + 调单词条上限」，其余编辑入口一律关掉。
 *
 * 默认**关闭** —— 这是给拿到预设就能用的用户准备的：词条库开箱是一份可用配置，
 * 想改结构的人自己把开关打开（状态记在本机）。
 *
 * 关闭时**不隐藏任何数据**：自定义条目、改过的值照常显示、照常参与计算，
 * 只是输入框不可改。藏起来会变成「看不见的东西在影响伤害」。
 */
const ADVANCED_EDITING_KEY = 'zzz-hp-affix-library-advanced-editing'

function loadAdvancedEditing(): boolean {
  try {
    return localStorage.getItem(ADVANCED_EDITING_KEY) === '1'
  } catch {
    return false
  }
}

const advancedEditing = ref(loadAdvancedEditing())
const simpleMode = computed(() => !advancedEditing.value)

watch(advancedEditing, (on) => {
  try {
    localStorage.setItem(ADVANCED_EDITING_KEY, on ? '1' : '0')
  } catch {
    /* 存不了就只在本次会话生效 */
  }
})

// ---------- 库列表 ----------

const store = ref<AffixLibraryStore>(loadAffixLibraryStore())

/** 弹窗打开时重新读盘：外部（内容编辑）可能已改过激活库的内容 */
watch(
  () => props.open,
  (open) => {
    if (!open) return
    store.value = loadAffixLibraryStore()
    editingSetId.value = ''
    setMessage.value = ''
    importError.value = ''
    activeTab.value = 'manage'
    advancedEditing.value = loadAdvancedEditing()
    groupError.value = null
  },
)

const activeSet = computed(() => activeAffixLibrarySet(store.value))

/** 每套库的条目概览：全部条数 / 参与计算的条数 */
function setSummary(id: string): { total: number; enabled: number } {
  const set = store.value.sets.find((item) => item.id === id)
  if (!set) return { total: 0, enabled: 0 }
  return {
    total: resolveAffixLibraryAll(set.state).length,
    enabled: resolveAffixLibrary(set.state).length,
  }
}

const editingSetId = ref('')
const setDraftName = ref('')
const setMessage = ref('')
const renameInputRef = ref<HTMLInputElement | HTMLInputElement[] | null>(null)

function commitStore(next: AffixLibraryStore) {
  store.value = next
  saveAffixLibraryStore(next)
  emit('switched')
}

/**
 * 用盘上激活库的内容，替换内存快照里的那一份。
 *
 * 条目级编辑（启用/增/改/删）是 emit 给页面落盘的，弹窗手里的 `store` 还停在打开那一刻。
 * 库级操作前先合并盘上内容，否则「改几条 → 再切库」会把刚改的内容原样写回去。
 * 激活库对不上（例如别处刚切过库）就整份作废，避免拿旧结构覆盖新存档。
 */
function withLatestActiveState(base: AffixLibraryStore): AffixLibraryStore {
  const disk = loadAffixLibraryStore()
  if (disk.activeId !== base.activeId) return base
  const latest = activeAffixLibrarySet(disk)
  return {
    ...base,
    sets: base.sets.map((set) => (set.id === base.activeId ? { ...set, state: latest.state } : set)),
  }
}

/** 库级操作统一入口：先跟盘上内容对齐，再落盘并把变更告知页面 */
function commitStoreChange(apply: (base: AffixLibraryStore) => AffixLibraryStore) {
  commitStore(apply(withLatestActiveState(store.value)))
}

/**
 * 条目级编辑统一入口：转给页面落盘后立刻重新读盘。
 *
 * 不重读的话，弹窗里的库快照会停在打开那一刻：左侧「参与/总条数」计数不会变，
 * 之后做库级操作也会基于旧内容。
 */
function forwardEntryEdit(action: () => void) {
  action()
  store.value = loadAffixLibraryStore()
}

function switchSet(id: string) {
  if (id === store.value.activeId) return
  commitStoreChange((base) => activateAffixLibrarySet(base, id))
  setMessage.value = ''
}

function startRename(id: string) {
  const set = store.value.sets.find((item) => item.id === id)
  if (!set) return
  editingSetId.value = id
  setDraftName.value = set.name
  void nextTick(focusRenameInput)
}

/**
 * 把光标送进重命名输入框。
 *
 * 这个输入框在 `v-for` 里面，Vue 会把 v-for 里的模板 ref 收成**数组**（ref_for），
 * 所以两种形状都要认，否则 `?.focus()` 会因为「数组没有 focus」而静默失败。
 */
function focusRenameInput() {
  const target = renameInputRef.value
  const input = Array.isArray(target) ? target[0] : target
  input?.focus()
}

function commitRename() {
  const id = editingSetId.value
  if (!id) return
  const name = setDraftName.value.trim()
  editingSetId.value = ''
  if (!name) return
  commitStoreChange((base) => renameAffixLibrarySet(base, id, name))
  setMessage.value = `已重命名为「${name}」`
}

function cancelRename() {
  editingSetId.value = ''
}

const newSetMode = ref(false)
const newSetName = ref('')
const newSetInputRef = ref<HTMLInputElement | null>(null)

/**
 * 新建库的起点（用户 2026-09-12 口径：新建时给用户选；2026-09-13：**新建完毕就冻结**）。
 *
 * 起点两类：**空配置** 或 **复制某一套官方预设方案**（用户 2026-09-13「要选到新方案」）。
 * 「复制」时把选中那套方案**整份**搬进本库，此后官方怎么改都与本库无关
 * （用户口径「你不独立，怎么跟官方维护」）。界面上空配置排前面。
 */
const EMPTY_SET_SOURCE = '__empty__'

/** 当前选中的起点：`EMPTY_SET_SOURCE` 或某个方案名 */
const newSetSource = ref<string>(EMPTY_SET_SOURCE)

/** 用户是否亲手点过起点（点过就不再被「快照到手」自动改成默认方案） */
const newSetSourceTouched = ref(false)

/** 正在取官方那份预设（新建「预设词条方案」时先取到再冻结，取的过程里按钮禁用） */
const newSetBusy = ref(false)

/** 服务端现有的方案（空数组 = 还没拿到快照） */
const schemeOptions = computed(() => presetAffixSchemesBase())

/** 默认方案名（新建面板的预选项） */
const defaultSchemeName = computed(() => defaultAffixPresetSchemeName())

/**
 * 选中的方案没了（管理员删了方案）就退回默认方案 —— 否则确定时会对着一套不存在的方案发请求。
 */
watch(schemeOptions, (list) => {
  if (!list.length) return
  if (newSetSource.value === EMPTY_SET_SOURCE) return
  if (!list.some((scheme) => scheme.name === newSetSource.value)) {
    newSetSource.value = defaultSchemeName.value
  }
})

function startNewSet() {
  newSetMode.value = true
  newSetName.value = ''
  newSetSourceTouched.value = false
  newSetSource.value = schemeOptions.value.length ? defaultSchemeName.value : EMPTY_SET_SOURCE
  /**
   * 提前把官方那份拉起来：点「确定」时多半已在手，新建就是当场冻结，不用等。
   * 拉到手才知道有哪些方案 —— 用户没自己点过的话，选中默认方案。
   */
  void ensureAffixPresetLoaded().then(() => {
    if (!newSetSourceTouched.value) newSetSource.value = defaultSchemeName.value
  })
  void nextTick(() => newSetInputRef.value?.focus())
}

/**
 * 确定新建：**新建完毕就冻结** —— 先把选中的那套方案取到，再当场整份复制进新库。
 *
 * 为什么等取到才建：新建那一刻要冻的是**官方**那份；若官方还没取到就复制，冻进去的是
 * 代码兜底，与官方对不上且之后不再纠正（用户 2026-09-13「肯定有偏差的」）。
 * 取不到就**不建**，如实告诉用户（可以改用空配置）。
 *
 * 「默认方案」走已经在手的那份（`createAffixLibraryStateForOrigin('copy')`）；
 * 其他方案现拉一份（`loadAffixPresetScheme`，不污染全局快照 —— 那份是计算页在用的）。
 */
async function commitNewSet() {
  const name = newSetName.value.trim() || '新建词条库'
  const source = newSetSource.value
  let presetState: AffixLibraryState | null = null

  if (source !== EMPTY_SET_SOURCE) {
    newSetBusy.value = true
    try {
      if (source === defaultSchemeName.value) {
        await ensureAffixPresetLoaded()
        if (!isUsingServerAffixPreset()) {
          setMessage.value = '拿不到官方预设（服务器没响应），暂时没法复制一份；可以先用「空配置」'
          return
        }
      } else {
        try {
          const snapshot = await loadAffixPresetScheme(source)
          presetState = createAffixLibraryStateFromPreset(snapshot.entries, snapshot.groups)
        } catch {
          setMessage.value = `拿不到方案「${source}」（服务器没响应），暂时没法复制；可以先用「空配置」`
          return
        }
      }
    } finally {
      newSetBusy.value = false
    }
  }

  newSetMode.value = false
  newSetName.value = ''
  commitStoreChange((base) =>
    createAffixLibrarySet(
      base,
      name,
      presetState ??
        createAffixLibraryStateForOrigin(source === EMPTY_SET_SOURCE ? 'empty' : 'copy'),
    ),
  )
  setMessage.value =
    source === EMPTY_SET_SOURCE
      ? `已新建空配置库「${name}」并切了过去`
      : `已新建「${name}」并切了过去（复制自「${source}」）`
}

function cancelNewSet() {
  newSetMode.value = false
  newSetName.value = ''
}

/** 待确认的删除：最后一套不给删，所以只需确认一次 */
const pendingDeleteId = ref('')

function startDeleteSet(id: string) {
  pendingDeleteId.value = id
}

function cancelDeleteSet() {
  pendingDeleteId.value = ''
}

function confirmDeleteSet() {
  const id = pendingDeleteId.value
  pendingDeleteId.value = ''
  if (!id) return
  const base = withLatestActiveState(store.value)
  const next = deleteAffixLibrarySet(base, id)
  // 最后一套不给删：条数没变就当没这回事，不落盘也不通知页面
  if (next.sets.length === base.sets.length) return
  commitStore(next)
  setMessage.value = `已删除，当前使用「${activeAffixLibrarySet(next).name}」`
}

// ---------- 导出 / 导入 ----------

const fileInputRef = ref<HTMLInputElement | null>(null)
const importError = ref('')

function exportCurrent() {
  const json = exportAffixLibrarySet(store.value)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const safeName = activeSet.value.name.replace(/[\\/:*?"<>|]/g, '_')
  a.download = `zzz-hp-affix-library-${safeName}-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  setMessage.value = `已导出「${activeSet.value.name}」`
}

/**
 * 导入：只走「新增一套库」这一条路。
 *
 * 曾经还有「覆盖当前库」（就地替换、保留库身份）—— 用户 2026-09-13 判定多余，去掉：
 * 想还原备份就「先删旧库、再导入为新库」。`importAffixLibrarySet` 的 `'replace'`
 * 模式仍保留在 utils 里（有测试覆盖），恢复按钮只是加个 UI 的事。
 */
function triggerImport() {
  importError.value = ''
  fileInputRef.value?.click()
}

async function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  let text = ''
  try {
    text = await file.text()
  } catch {
    importError.value = '读取文件失败'
    return
  }
  applyImport(text)
}

function applyImport(json: string) {
  // 先跟盘上内容对齐再解析，理由同 `withLatestActiveState`
  const result = importAffixLibrarySet(withLatestActiveState(store.value), json, 'new')
  if (result.error) {
    importError.value = result.error
    return
  }
  importError.value = ''
  commitStore(result.store)
  setMessage.value = `已导入为新库「${result.name}」`
}

// ---------- 条目编辑（转发给页面，落盘后刷新本地快照） ----------

function onToggleEntry(entryId: string, enabled: boolean) {
  forwardEntryEdit(() => emit('toggleEntry', entryId, enabled))
}

function onUpdateEntry(entryId: string, patch: Partial<AffixLibraryEntry>) {
  forwardEntryEdit(() => emit('updateEntry', entryId, patch))
}

function onRemoveEntry(entryId: string) {
  forwardEntryEdit(() => emit('removeEntry', entryId))
}

/**
 * 本页「全选 / 全部取消」。
 *
 * 只作用于**当前页看到的条目**（组页 = 该组的条目，未分组页 = 没组的条目）——
 * 这是「组内页面」的语义：想整组一起上就不要逐条点。
 * 一次 emit 多条、页面一次落盘：逐条 emit 会让求解重跑 N 次。
 */
function toggleAllVisible() {
  const ids = visibleEntries.value.map((entry) => entry.id)
  if (!ids.length) return
  const next = !allVisibleEnabled.value
  forwardEntryEdit(() => emit('toggleEntries', ids, next))
}

/**
 * 恢复默认：独立库要按**当前官方预设**重新复制一份，因此同样得先拿到官方那份；
 * 拿不到就不动手（免得把代码兜底冻成「官方」），并如实说明。
 */
async function onRestoreDefaults() {
  if (activeSet.value.state.origin === 'copy' && !isUsingServerAffixPreset()) {
    await ensureAffixPresetLoaded()
    if (!isUsingServerAffixPreset()) {
      setMessage.value = '拿不到官方预设（服务器没响应），暂时没法恢复默认'
      return
    }
  }
  forwardEntryEdit(() => emit('restoreDefaults'))
}

// ---------- 分组（组名 + 组额度） ----------

/** 组额度说明：一句话讲清这个数字管什么 */
const GROUP_CAP_HINT = '组内各条档数之和 ≤ 额度'

/** 额度 0 的说明：别只说「不限」，要说清它还是一种约束的关闭状态 */
const GROUP_CAP_UNLIMITED_HINT = '0 = 不限制（这几条可以同时用满各自上限）'

const groupError = ref<string | null>(null)

function onPickGroup(target: string, value: string) {
  if (target === 'draft') {
    draft.value.group = value
    return
  }
  forwardEntryEdit(() => emit('updateEntry', target, { group: value }))
}

function onSetGroupCap(name: string, value: number) {
  forwardEntryEdit(() => emit('setGroupCap', name, value))
}

/** 改组名：空名 / 重名一律拒绝，并把输入框还原成原值（否则界面与实际不符） */
function onRenameGroup(from: string, event: Event) {
  const input = event.target as HTMLInputElement
  const to = input.value.trim()
  if (!to || to === from) {
    input.value = from
    return
  }
  if (props.groups.some((group) => group.name === to)) {
    groupError.value = `已有同名分组「${to}」`
    input.value = from
    return
  }
  groupError.value = null
  forwardEntryEdit(() => emit('renameGroup', from, to))
}

/** 删组：只删组，组内条目变回自由条目（页面负责清引用） */
function onRemoveGroup(name: string) {
  groupError.value = null
  forwardEntryEdit(() => emit('removeGroup', name))
}

/** 分组页的新建表单（与条目行共用建组逻辑） */
const newGroupDraftName = ref('')
const newGroupDraftCap = ref(DEFAULT_AFFIX_GROUP_CAP)

function submitNewGroup() {
  const name = newGroupDraftName.value.trim()
  if (!name) {
    groupError.value = '请填写组名'
    return
  }
  if (props.groups.some((group) => group.name === name)) {
    groupError.value = `已有同名分组「${name}」`
    return
  }
  groupError.value = null
  forwardEntryEdit(() => emit('addGroup', name, newGroupDraftCap.value))
  newGroupDraftName.value = ''
  newGroupDraftCap.value = DEFAULT_AFFIX_GROUP_CAP
}

// ---------- 条目编辑（新增表单） ----------

/** `stat:` 落点的可选属性 */
const STAT_TARGET_OPTIONS = (Object.keys(AFFIX_SUBSTAT_KEY_LABELS) as (keyof AffixCounts)[]).map(
  (key) => ({ id: statTarget(key), label: AFFIX_SUBSTAT_KEY_LABELS[key] }),
)

/** `panel:` 落点的可选属性 */
const PANEL_TARGET_OPTIONS = (
  Object.keys(AFFIX_PANEL_DELTA_FIELD_LABELS) as AffixPanelDeltaField[]
).map((field) => ({ id: panelTarget(field), label: AFFIX_PANEL_DELTA_FIELD_LABELS[field] }))

/**
 * 「新增条目」的属性清单：两个落点**合并成一个列表**。
 *
 * 条目不再区分「词条数 / 面板增量」（用户 2026-09-12 裁定：词条只表达「给哪个属性加多少」，
 * 怎么折算由字段语义决定）。同名属性只列一次 —— `异常精通` 在两个落点里都有，
 * 语义相同（平铺加），保留先出现的那个。
 */
const TARGET_OPTIONS = (() => {
  const seen = new Set<string>()
  const merged: { id: AffixLibraryEntryTarget; label: string }[] = []
  for (const option of [...STAT_TARGET_OPTIONS, ...PANEL_TARGET_OPTIONS]) {
    if (seen.has(option.label)) continue
    seen.add(option.label)
    merged.push(option)
  }
  return merged
})()

const GAIN_TARGET_OPTIONS = AFFIX_GAIN_FIELDS.map((field: AffixGainField) => ({
  id: gainTarget(field),
  label: `局内·${AFFIX_GAIN_FIELD_LABELS[field] ?? field}`,
}))

const draft = ref({
  label: '',
  target: statTarget('atkPercent') as AffixLibraryEntryTarget,
  perRoll: 3,
  cap: 0,
  group: '',
  applySituation: 'global' as BuffApplySituation,
  scope: 'general' as BuffScope,
  skillCategory: 'basic' as BuffSkillTargetId,
  appliesToAnomaly: false,
})
const draftError = ref<string | null>(null)
const draftIsGain = computed(() => isGainTarget(draft.value.target))
const draftPerRollUnit = computed(() =>
  affixPerRollUnit(draft.value.target) === 'percent' ? '%' : '',
)

function perRollUnitHint(target: AffixLibraryEntryTarget): string {
  return affixPerRollUnit(target) === 'percent' ? '%' : ''
}

function submitDraft() {
  const label = draft.value.label.trim()
  if (!label) {
    draftError.value = '请填写词条名称'
    return
  }
  if (!Number.isFinite(draft.value.perRoll) || draft.value.perRoll <= 0) {
    draftError.value = '每档数值须为正数'
    return
  }
  draftError.value = null
  const target = draft.value.target
  const conditionFields = isGainTarget(target)
    ? {
        applySituation: draft.value.applySituation,
        scope: draft.value.scope,
        ...(draft.value.scope === 'skill'
          ? {
              skillCategory: draft.value.skillCategory,
              skillSubcategoryId: null,
              appliesToAnomaly: draft.value.appliesToAnomaly,
            }
          : {}),
      }
    : {}
  forwardEntryEdit(() =>
    emit('addEntry', {
      label,
      target,
      perRoll: draft.value.perRoll,
      cap: draft.value.cap,
      group: draft.value.group.trim(),
      // 独立功能口径：每条词条 1 档一律占 1 个总词条数
      rollCost: 1,
      enabledByDefault: true,
      ...conditionFields,
    }),
  )
  draft.value.label = ''
  draft.value.cap = 0
  draft.value.group = ''
  draft.value.applySituation = 'global'
  draft.value.scope = 'general'
  draft.value.skillCategory = 'basic'
  draft.value.appliesToAnomaly = false
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="affix-library-overlay" role="presentation" @click.self="emit('close')">
      <div class="affix-library-modal" role="dialog" aria-modal="true" aria-label="词条库">
        <header class="modal-header">
          <h2>词条库</h2>
          <button type="button" class="close-btn" aria-label="关闭" @click="emit('close')">×</button>
        </header>

        <div class="modal-body">
          <!-- 左：多套库 -->
          <aside class="set-pane">
            <div class="pane-head">
              <span class="pane-title">我的词条库（{{ store.sets.length }}）</span>
              <button type="button" class="mini-btn" @click="startNewSet">+ 新建</button>
            </div>

            <!-- 常驻说明：界面上看不到「官方预设」那一套，它是所有库的底料，容易被误当成 bug -->
            <p class="set-list-hint">
              官方预设在服务器上、由管理员维护，你改不到它。新建时可复制其中一套预设方案；
              新建后存于本机浏览器，后续由你维护，勾选 / 改名 / 每档 / 删除 / 导出 / 导入都只存本机
            </p>

            <div v-if="newSetMode" class="set-new-panel">
              <input
                ref="newSetInputRef"
                v-model="newSetName"
                type="text"
                class="field-input"
                :maxlength="AFFIX_LIBRARY_SET_NAME_MAX"
                placeholder="新库名…"
                @keyup.enter="commitNewSet"
                @keyup.esc="cancelNewSet"
              />

              <p class="option-caption">从哪来：</p>
              <label class="origin-option">
                <input
                  v-model="newSetSource"
                  type="radio"
                  :value="EMPTY_SET_SOURCE"
                  @change="newSetSourceTouched = true"
                />
                <span class="origin-body">
                  <strong>空配置</strong>
                  <span class="origin-desc">不加载官方预设，条目与分组都自己建</span>
                </span>
              </label>

              <!-- 官方预设有几套方案就列几项（用户 2026-09-13「要选到新方案」） -->
              <label
                v-for="scheme in schemeOptions"
                :key="scheme.name"
                class="origin-option"
              >
                <input
                  v-model="newSetSource"
                  type="radio"
                  :value="scheme.name"
                  @change="newSetSourceTouched = true"
                />
                <span class="origin-body">
                  <strong>预设词条方案「{{ scheme.name }}」</strong>
                </span>
              </label>

              <!-- 快照还没到手：如实说没有方案可选，不假装有 -->
              <p v-if="!schemeOptions.length" class="origin-desc origin-desc--hint">
                还没拿到官方预设（服务器没响应），暂时看不到可复制的方案；可以先用「空配置」
              </p>

              <div class="set-new-actions">
                <button type="button" class="mini-btn ok" :disabled="newSetBusy" @click="commitNewSet">
                  {{ newSetBusy ? '取官方预设…' : '确定' }}
                </button>
                <button type="button" class="mini-btn" :disabled="newSetBusy" @click="cancelNewSet">
                  取消
                </button>
              </div>
            </div>

            <ul class="set-list">
              <li
                v-for="set in store.sets"
                :key="set.id"
                class="set-item"
                :class="{ active: set.id === store.activeId }"
              >
                <template v-if="editingSetId === set.id">
                  <input
                    ref="renameInputRef"
                    v-model="setDraftName"
                    type="text"
                    class="field-input rename-input"
                    :maxlength="AFFIX_LIBRARY_SET_NAME_MAX"
                    @keyup.enter="commitRename"
                    @keyup.esc="cancelRename"
                  />
                  <button type="button" class="mini-btn ok" @click="commitRename">确定</button>
                  <button type="button" class="mini-btn" @click="cancelRename">取消</button>
                </template>
                <template v-else>
                  <button type="button" class="set-main" @click="switchSet(set.id)">
                    <span class="set-name">{{ set.name }}</span>
                    <span class="set-meta">
                      {{ setSummary(set.id).enabled }} / {{ setSummary(set.id).total }} 条参与
                    </span>
                  </button>
                  <!-- 空配置的库标一下，免得日后忘了它是从零搭的 -->
                  <span v-if="set.state.origin === 'empty'" class="set-badge set-badge--muted">
                    空配置
                  </span>
                  <span v-if="set.id === store.activeId" class="set-badge">使用中</span>
                  <button
                    type="button"
                    class="mini-btn icon"
                    title="重命名"
                    @click.stop="startRename(set.id)"
                  >
                    改名
                  </button>
                  <button
                    type="button"
                    class="mini-btn icon danger"
                    title="删除该库"
                    :disabled="store.sets.length <= 1"
                    @click.stop="startDeleteSet(set.id)"
                  >
                    删除
                  </button>
                </template>
              </li>
            </ul>

            <p v-if="pendingDeleteId" class="confirm-row danger">
              删除这套库的内容？
              <button type="button" class="mini-btn danger" @click="confirmDeleteSet">删除</button>
              <button type="button" class="mini-btn" @click="cancelDeleteSet">取消</button>
            </p>

            <div class="pane-actions">
              <button type="button" class="mini-btn" @click="exportCurrent">导出当前库</button>
              <button type="button" class="mini-btn" @click="triggerImport">导入为新库</button>
            </div>
            <input
              ref="fileInputRef"
              type="file"
              accept="application/json,.json"
              class="file-input"
              @change="onFilePicked"
            />

            <p v-if="importError" class="err">{{ importError }}</p>
            <p v-if="setMessage" class="ok-msg">{{ setMessage }}</p>
          </aside>

          <!-- 右：当前库的横向分页（组管理 → 各组 → 未分组） -->
          <section class="entry-pane">
            <div class="pane-head">
              <span class="pane-title">「{{ activeSet.name }}」</span>
              <label class="advanced-switch" title="关闭后只能勾选参与与调整单词条上限">
                <input v-model="advancedEditing" type="checkbox" />
                <span>高级编辑</span>
              </label>
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
                :key="group.name"
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
                <strong>{{ activeGroup.cap === 0 ? '不限制' : activeGroup.cap }}</strong>
              </span>
              <span class="group-head-hint">
                {{
                  activeGroup.cap === 0
                    ? '这几条可以同时用满各自上限'
                    : `${GROUP_CAP_HINT}（改额度去「组管理」页）`
                }}
              </span>
              <button
                type="button"
                class="chip group-select-all"
                :disabled="!visibleEntries.length"
                :title="allVisibleEnabled ? '本页条目全部取消勾选' : '本页条目全部勾选'"
                @click="toggleAllVisible"
              >
                {{ allVisibleEnabled ? '全部取消' : '全选' }}
              </button>
            </div>
            <div v-if="activeTab === UNGROUPED_TAB" class="group-head">
              <span class="group-head-name">未分组</span>
              <span class="group-head-hint">这些条目不属于任何组，彼此不约束</span>
              <button
                type="button"
                class="chip group-select-all"
                :disabled="!visibleEntries.length"
                :title="allVisibleEnabled ? '本页条目全部取消勾选' : '本页条目全部勾选'"
                @click="toggleAllVisible"
              >
                {{ allVisibleEnabled ? '全部取消' : '全选' }}
              </button>
            </div>

            <div v-if="activeTab !== 'manage'" class="entry-scroll">
              <table class="library-table library-table--entries">
                <colgroup>
                  <col class="col-participate" />
                  <col class="col-label" />
                  <col class="col-target" />
                  <col class="col-perroll" />
                  <col class="col-cap" />
                  <col class="col-group" />
                  <col class="col-del" />
                </colgroup>
                <thead>
                  <tr>
                    <th>参与</th>
                    <th>名称</th>
                    <th>目标</th>
                    <th>每档</th>
                    <th>上限</th>
                    <th>分组</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="entry in visibleEntries"
                    :key="entry.id"
                    :class="{ disabled: !enabledSet.has(entry.id) }"
                  >
                    <td>
                      <input
                        type="checkbox"
                        :checked="enabledSet.has(entry.id)"
                        @change="
                          onToggleEntry(entry.id, ($event.target as HTMLInputElement).checked)
                        "
                      />
                    </td>
                    <td>
                      <input
                        class="inline-input"
                        :value="entry.label"
                        :disabled="simpleMode"
                        @change="
                          onUpdateEntry(entry.id, {
                            label: ($event.target as HTMLInputElement).value,
                          })
                        "
                      />
                    </td>
                    <!-- 目标只读：名称是自由文本、目标才是实际效果；改目标＝删掉再新增 -->
                    <td class="target-cell" :title="entry.target">
                      {{ affixTargetLabel(entry.target) }}
                      <span
                        v-if="affixEntryConditionSummary(entry)"
                        class="condition-hint"
                      >
                        {{ affixEntryConditionSummary(entry) }}
                      </span>
                    </td>
                    <td>
                      <span class="per-roll-cell">
                        <input
                          class="inline-input num"
                          type="number"
                          step="0.1"
                          :value="entry.perRoll"
                          :disabled="simpleMode"
                          @change="
                            onUpdateEntry(entry.id, {
                              perRoll: Number(($event.target as HTMLInputElement).value),
                            })
                          "
                        />
                        <!-- 单位槽恒存在（非百分比行为空串）：用 v-if 会让百分比行的输入框被单位挤窄 13px，
                             整列右边缘参差不齐（用户 2026-09-12 报的「对齐」）。 -->
                        <span class="unit-hint">{{ perRollUnitHint(entry.target) }}</span>
                      </span>
                    </td>
                    <td>
                      <input
                        class="inline-input num"
                        type="number"
                        min="0"
                        step="1"
                        :value="entry.cap"
                        title="0 表示不设上限"
                        @change="
                          onUpdateEntry(entry.id, {
                            cap: Number(($event.target as HTMLInputElement).value),
                          })
                        "
                      />
                    </td>
                    <td>
                      <select
                        class="inline-input"
                        :value="entry.group"
                        :disabled="simpleMode"
                        @change="onPickGroup(entry.id, ($event.target as HTMLSelectElement).value)"
                      >
                        <option value="">空=自由</option>
                        <option v-for="group in groups" :key="group.name" :value="group.name">
                          {{ group.name }}
                        </option>
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        class="del-btn"
                        title="删除该条目（默认条目可用「恢复默认」找回）"
                        :disabled="simpleMode"
                        @click="onRemoveEntry(entry.id)"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="activeTab !== 'manage' && !simpleMode" class="add-entry">
              <h5>新增词条</h5>
              <div class="add-grid">
                <label>
                  <span>名称</span>
                  <input v-model="draft.label" type="text" placeholder="如：5号位增伤" />
                </label>
                <label>
                  <span>目标</span>
                  <select v-model="draft.target">
                    <optgroup label="词条 / 局外">
                      <option v-for="opt in TARGET_OPTIONS" :key="opt.id" :value="opt.id">
                        {{ opt.label }}
                      </option>
                    </optgroup>
                    <optgroup label="局内增益（可加招式/失衡条件）">
                      <option v-for="opt in GAIN_TARGET_OPTIONS" :key="opt.id" :value="opt.id">
                        {{ opt.label }}
                      </option>
                    </optgroup>
                  </select>
                </label>
                <template v-if="draftIsGain">
                  <label>
                    <span>作用情况</span>
                    <select v-model="draft.applySituation">
                      <option value="global">全局</option>
                      <option value="stagger">失衡期</option>
                      <option value="non_stagger">非失衡期</option>
                    </select>
                  </label>
                  <label>
                    <span>作用域</span>
                    <select v-model="draft.scope">
                      <option v-for="opt in BUFF_SCOPE_OPTIONS" :key="opt.id" :value="opt.id">
                        {{ opt.label }}
                      </option>
                    </select>
                  </label>
                  <label v-if="draft.scope === 'skill'">
                    <span>招式大类</span>
                    <select v-model="draft.skillCategory">
                      <option v-for="opt in BUFF_SKILL_TARGET_OPTIONS" :key="opt.id" :value="opt.id">
                        {{ opt.label }}
                      </option>
                    </select>
                  </label>
                  <label v-if="draft.scope === 'skill'" class="field-check">
                    <span>异常结算</span>
                    <span class="check-row">
                      <input v-model="draft.appliesToAnomaly" type="checkbox" />
                      也生效
                    </span>
                  </label>
                </template>
                <label>
                  <span>每档</span>
                  <span class="per-roll-cell">
                    <input v-model.number="draft.perRoll" type="number" step="0.1" min="0" />
                    <span class="unit-hint">{{ draftPerRollUnit }}</span>
                  </span>
                </label>
                <label>
                  <span>上限</span>
                  <input v-model.number="draft.cap" type="number" min="0" step="1" title="0 = 不设上限" />
                </label>
                <label>
                  <span>分组</span>
                  <select
                    :value="draft.group"
                    @change="onPickGroup('draft', ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="">空=自由</option>
                    <option v-for="group in groups" :key="group.name" :value="group.name">
                      {{ group.name }}
                    </option>
                  </select>
                </label>
                <button type="button" class="btn-primary" @click="submitDraft">添加</button>
              </div>
              <p v-if="draftError" class="err">{{ draftError }}</p>
            </div>

            <p v-if="activeTab !== 'manage'" class="footnote">
              同一字段有多条词条时，档数会<strong>相加</strong>（各条按自己的每档值分别折算后累加），
              排列顺序不影响结果。
              <span v-if="simpleMode">（「高级编辑」打开后才能改结构）</span>
            </p>

            <!-- 组管理页：建 / 改名 / 改额度 / 删（额度只在这一处维护） -->
            <template v-else>
              <div class="entry-scroll">
                <table class="library-table library-table--groups">
                  <colgroup>
                    <col class="col-groupname" />
                    <col class="col-groupcap" />
                    <col class="col-groupnote" />
                    <col class="col-del" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>组名</th>
                      <th>组额度</th>
                      <th>说明</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="group in groups" :key="group.name">
                      <td>
                        <input
                          class="inline-input"
                          type="text"
                          :value="group.name"
                          :disabled="simpleMode"
                          @change="onRenameGroup(group.name, $event)"
                        />
                      </td>
                      <td>
                        <input
                          class="inline-input num"
                          type="number"
                          min="0"
                          step="1"
                          :value="group.cap"
                          title="组内各条档数之和的上限；0 = 不限"
                          :disabled="simpleMode"
                          @change="
                            onSetGroupCap(
                              group.name,
                              Number(($event.target as HTMLInputElement).value),
                            )
                          "
                        />
                      </td>
                      <td class="type-cell">
                        {{ group.cap === 0 ? GROUP_CAP_UNLIMITED_HINT : GROUP_CAP_HINT }}
                      </td>
                      <td>
                        <button
                          type="button"
                          class="del-btn"
                          title="只删这个分组，组内条目会变回未分组"
                          :disabled="simpleMode"
                          @click="onRemoveGroup(group.name)"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                    <tr v-if="!groups.length">
                      <td colspan="4" class="empty-cell">
                        还没有分组。分组用来表达「这几条共享一个档数额度」—— 比如 5 号位主属性
                        只能选一个，就建一个额度 1 的组，把候选条目放进去。
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div v-if="!simpleMode" class="add-entry">
                <h5>新建分组</h5>
                <div class="add-grid">
                  <label>
                    <span>组名</span>
                    <input v-model="newGroupDraftName" type="text" placeholder="如：5号位主属性" />
                  </label>
                  <label>
                    <span>组额度</span>
                    <input
                      v-model.number="newGroupDraftCap"
                      type="number"
                      min="0"
                      step="1"
                      title="组内各条档数之和的上限；0 = 不限"
                    />
                  </label>
                  <button type="button" class="btn-primary" @click="submitNewGroup">
                    添加分组
                  </button>
                </div>
              </div>

              <p v-if="groupError" class="err">{{ groupError }}</p>
              <p v-if="simpleMode" class="footnote">
                当前是只读模式：可以勾选条目、调单词条上限；新建 / 删除 / 改名分组、
                改组额度需要先勾上右上角的「高级编辑」。
              </p>
              <p v-else class="footnote">
                删分组只删组本身，组内条目会变回未分组（条目不会被删掉）。
                条目在「词条」页的下拉里选组，额度不够时求解器会少分配档数。
              </p>
              <div class="pane-actions">
                <button
                  type="button"
                  class="mini-btn"
                  title="把整份词条库恢复成预设（自建条目与所有改动都会没）"
                  @click="onRestoreDefaults"
                >
                  恢复默认
                </button>
              </div>
            </template>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.affix-library-overlay {
  position: fixed;
  inset: 0;
  z-index: 1250;
  background: rgba(0, 0, 0, 0.55);
  display: grid;
  place-items: center;
  padding: 1rem;
}

.affix-library-modal {
  width: 1080px;
  height: 720px;
  max-width: calc(100vw - 2rem);
  max-height: calc(100vh - 2rem);
  border: 1px solid #2d323a;
  border-radius: 14px;
  background: linear-gradient(180deg, #171a1f 0%, #12151a 100%);
  color: #e4e8ef;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid #2d323a;
  flex-shrink: 0;
}

.modal-header h2 {
  margin: 0;
  font-size: 1rem;
  color: #f0f2f6;
}

.close-btn {
  border: none;
  background: transparent;
  color: #9aa3b0;
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
}

.close-btn:hover {
  color: #f0f2f6;
}

.modal-body {
  flex: 1;
  min-height: 0;
  display: grid;
  /* minmax(0, …) 两列都写上：右列是宽表格，默认的 `1fr` 有 min-content 下限，
     窄屏时会把左列挤出去、整块横向溢出。 */
  grid-template-columns: minmax(0, 280px) minmax(0, 1fr);
}

/* 窄屏（手机 / 分屏）：两栏改成上下两段，表格自己横向滚动 */
@media (max-width: 820px) {
  .affix-library-modal {
    width: calc(100vw - 1rem);
    height: calc(100vh - 1rem);
  }

  .modal-body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }

  .set-pane {
    border-right: none;
    border-bottom: 1px solid #2d323a;
    max-height: 38vh;
    overflow-y: auto;
  }
}

/* ---------- 左：库列表 ---------- */

.set-pane {
  border-right: 1px solid #2d323a;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0.7rem 0.75rem;
  gap: 0.5rem;
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-shrink: 0;
}

.pane-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: #cfd6e0;
}

/* 右栏横向分页条（组管理 → 各组 → 未分组）：按钮本体用统一 chip，这里只管排布 */
.tab-strip {
  display: flex;
  gap: 0.35rem;
  overflow-x: auto;
  padding-bottom: 0.2rem;
  flex-shrink: 0;
}

.tab-strip .chip {
  flex-shrink: 0;
}

/* 高级编辑开关 */
.advanced-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.76rem;
  color: #9aa3b0;
  margin-left: auto;
  cursor: pointer;
  user-select: none;
}

/* 组页首行：组名 + 额度 */
.group-head {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  flex-shrink: 0;
  font-size: 0.8rem;
  color: #cfd6e0;
}

.group-head-name {
  font-weight: 600;
}

.group-head-cap strong {
  color: #f0dfb4;
}

.group-head-hint {
  color: #8b94a1;
  font-size: 0.74rem;
}

/* 组页「全选 / 全部取消」：靠右站，不跟组名抢位置 */
.group-select-all {
  margin-left: auto;
  flex-shrink: 0;
}

.empty-cell {
  color: #8b94a1;
  font-size: 0.78rem;
  padding: 0.6rem 0.45rem;
}

/* 常驻说明：官方预设是底料，列表里看不到它 —— 不写一句会被当成 bug */
.set-list-hint {
  margin: 0 0 0.35rem;
  font-size: 0.7rem;
  line-height: 1.45;
  color: #7d8694;
  flex-shrink: 0;
}

.set-new-panel {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  flex-shrink: 0;
  border: 1px solid #3a4049;
  border-radius: 9px;
  padding: 0.45rem;
  margin-bottom: 0.35rem;
  background: #14181f;
}

.option-caption {
  margin: 0;
  font-size: 0.72rem;
  color: #8b94a1;
}

.origin-option {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  font-size: 0.74rem;
  color: #cdd3dc;
  cursor: pointer;
}

.origin-option input[type='radio'] {
  margin-top: 0.15rem;
  flex-shrink: 0;
}

.origin-body {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.origin-desc {
  font-size: 0.68rem;
  line-height: 1.4;
  color: #7d8694;
}

/* 「还没拿到预设」这类提示：不跟真选项抢注意力，但要说清为什么没得选 */
.origin-desc--hint {
  margin: 0;
  padding-top: 0.1rem;
}

.set-new-actions {
  display: flex;
  gap: 0.3rem;
  margin-top: 0.1rem;
}

.field-input {
  flex: 1;
  min-width: 0;
  border: 1px solid #3a4049;
  border-radius: 8px;
  background: #10131a;
  color: #e4e8ef;
  font: inherit;
  font-size: 0.82rem;
  padding: 0.25rem 0.45rem;
}

.rename-input {
  font-size: 0.8rem;
}

.set-list {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.set-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  border: 1px solid #2d323a;
  border-radius: 9px;
  padding: 0.3rem 0.4rem;
  background: #161a21;
}

.set-item.active {
  border-color: #c9a55c;
  background: #221d13;
}

.set-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: left;
  padding: 0.1rem 0.15rem;
}

.set-name {
  font-size: 0.85rem;
  color: #eef1f6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.set-meta {
  font-size: 0.72rem;
  color: #8b94a1;
}

.set-badge {
  flex-shrink: 0;
  font-size: 0.68rem;
  color: #5c4818;
  background: #e8d3a0;
  border-radius: 999px;
  padding: 0.05rem 0.4rem;
}

.pane-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  flex-shrink: 0;
  border-top: 1px solid #2d323a;
  padding-top: 0.5rem;
}

.file-input {
  display: none;
}

.mini-btn {
  border: 1px solid #3a4049;
  border-radius: 8px;
  background: #1b1f27;
  color: #cfd6e0;
  font: inherit;
  font-size: 0.76rem;
  padding: 0.2rem 0.5rem;
  cursor: pointer;
}

.mini-btn:hover:not(:disabled) {
  border-color: #c9a55c;
  color: #f0f2f6;
}

.mini-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.mini-btn.ok {
  border-color: #c9a55c;
  background: #2a2314;
  color: #f0dfb4;
}

.mini-btn.danger:hover:not(:disabled) {
  border-color: #d16b6b;
  color: #f3c9c9;
}

.confirm-row {
  margin: 0;
  font-size: 0.78rem;
  color: #d8dde6;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
  flex-shrink: 0;
}

/* 危险确认句（删除这套库）：淡粉在深色底上像褪色正文，改成错误红 —— 一眼看出是危险操作 */
.confirm-row.danger {
  color: #f08c8c;
}

.err {
  margin: 0;
  font-size: 0.78rem;
  color: #f08c8c;
}

.ok-msg {
  margin: 0;
  font-size: 0.78rem;
  color: #a8d5a8;
}

/* ---------- 右：条目编辑 ---------- */

.entry-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0.7rem 0.85rem;
  gap: 0.5rem;
}

.entry-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid #2d323a;
  border-radius: 10px;
}

.library-table {
  width: 100%;
  /* 固定表格布局：输入框自带约 20 字符的固有宽度，不锁列宽的话「每档 / 上限」会被撑到 200px+ */
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 0.8rem;
}

/* 单元格里的输入框要能被列宽约束住（否则固有宽度仍是撑宽的元凶） */
.library-table td > .inline-input,
.library-table td .per-roll-cell > .inline-input,
.library-table td select.inline-input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.library-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #1b1f27;
  color: #9aa3b0;
  font-weight: 600;
  text-align: left;
  padding: 0.4rem 0.45rem;
  border-bottom: 1px solid #2d323a;
  white-space: nowrap;
}

.library-table td {
  padding: 0.25rem 0.45rem;
  border-bottom: 1px solid #23282f;
}

.library-table tr.disabled {
  opacity: 0.5;
}

/** 目标列：只读文本，展示条目实际作用的字段（名称是自由文本，可能对不上） */
.target-cell {
  color: #9aa3b0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.condition-hint {
  display: block;
  margin-top: 0.1rem;
  font-size: 0.7rem;
  color: #c9a55c;
  white-space: normal;
}

.check-row {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: #e4e8ef;
  font-size: 0.8rem;
}

/* ---------- 列宽（固定表格布局，不锁宽度输入框会把列撑到 200px+） ---------- */

.library-table--entries .col-participate {
  width: 46px;
}
/*
 * 名称列必须给宽度：`table-layout: fixed` 下没设宽度的列在容器不够宽时会被**压到 0px**
 * （实测：加了「目标」列后名称列变成 0，名字整列看不见）。
 * 给了宽度后容器更窄就整体横向滚动（`.entry-scroll` 已是 `overflow: auto`），不会再挤没谁。
 */
.library-table--entries .col-label {
  width: 190px;
}
.library-table--entries .col-target {
  width: 104px;
}
.library-table--entries .col-perroll {
  width: 104px;
}
.library-table--entries .col-cap {
  width: 72px;
}
.library-table--entries .col-group {
  width: 118px;
}
.library-table--entries .col-del,
.library-table--groups .col-del {
  width: 34px;
}

.library-table--groups .col-groupcap {
  width: 96px;
}
.library-table--groups .col-groupnote {
  width: 260px;
}

.inline-input {
  width: 100%;
  min-width: 0;
  border: 1px solid #3a4049;
  border-radius: 6px;
  background: #10131a;
  color: #e4e8ef;
  font: inherit;
  font-size: 0.78rem;
  padding: 0.15rem 0.35rem;
}

.inline-input.num {
  text-align: right;
}

.per-roll-cell {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  width: 100%;
}

/* 输入框吃掉单位槽以外的空间；单位槽宽度固定 → 每行输入框等宽、右边缘对齐 */
.per-roll-cell > .inline-input {
  flex: 1 1 auto;
}

.unit-hint {
  /* 固定宽度（不是 auto）：% 只在百分比行出现，auto 会让那些行的输入框被挤窄 */
  flex: 0 0 0.62rem;
  width: 0.62rem;
  text-align: left;
  color: #8b94a1;
  font-size: 0.75rem;
  line-height: 1;
}

.del-btn {
  border: none;
  background: transparent;
  color: #9aa3b0;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}

.del-btn:hover {
  color: #f08c8c;
}

.add-entry {
  flex-shrink: 0;
}

.add-entry h5 {
  margin: 0 0 0.35rem;
  font-size: 0.82rem;
  color: #cfd6e0;
}

.add-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 0.45rem;
  align-items: end;
}

.add-grid label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.75rem;
  color: #9aa3b0;
}

.add-grid input,
.add-grid select {
  border: 1px solid #3a4049;
  border-radius: 7px;
  background: #10131a;
  color: #e4e8ef;
  font: inherit;
  font-size: 0.8rem;
  padding: 0.2rem 0.4rem;
  /* 输入框默认有一份固定的内容宽度，不给 100% 会顶出网格格子 */
  width: 100%;
  min-width: 0;
}

.btn-primary {
  border: 1px solid #c9a55c;
  border-radius: 8px;
  background: #2a2314;
  color: #f0dfb4;
  font: inherit;
  font-size: 0.8rem;
  padding: 0.28rem 0.7rem;
  cursor: pointer;
  height: fit-content;
}

.btn-primary:hover {
  background: #3a3018;
}

.footnote {
  margin: 0;
  font-size: 0.72rem;
  color: #8b94a1;
  flex-shrink: 0;
}
</style>
