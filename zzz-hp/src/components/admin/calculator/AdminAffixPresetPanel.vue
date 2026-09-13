<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  deleteAffixPresetEntry,
  fetchAffixPreset,
  replaceAffixPreset,
  saveAffixPresetEntry,
  saveAffixPresetGroup,
  type AffixPresetEntryDoc,
  type AffixPresetGroupDoc,
} from '@/api/affixPreset'
import {
  DEFAULT_AFFIX_GROUP_CAP,
  affixPerRollUnit,
  affixTargetLabel,
  isAffixLibraryEntryTarget,
} from '@/utils/affixLibrary'
import '@/components/admin/calculator/adminCalculatorPanel.css'

/**
 * 官方预设词条库（管理侧唯一编辑入口）
 *
 * 口径（用户 2026-09-12 / 2026-09-13）：
 * - 官方预设的**唯一来源＝数据库**；用户侧只读，他们能复制一份到自己浏览器里改，改不回这里；
 * - 界面与用户侧那张表**同一套样子**（组管理 / 分组页 / 行内编辑 / 新增表单）——
 *   用户 2026-09-13「你就跟用户侧的差不多嘛」。用户侧那份是成品，**本目录之外不许动**；
 * - 管理侧**不设「高级编辑」开关**：管理员要用的字段一次全给（用户 2026-09-13「当然是全开的」）。
 *
 * 比用户侧多出来的字段（用户侧没有 / 改不了）：
 * `id`（稳定键）、`sortOrder`（条目与分组的展示顺序）、`rollCost`（每档占用）、
 * `enabledByDefault`（勾给新用户哪几条）、`target` 可填自由字段名。
 *
 * ⚠️ **id 不可改**：用户本地的 `enabledOverride` / `overrides` / `removedEntryIds` 都按 id 索引，
 *    改 id 等于让那些记录全部失配。要换 id 请删掉再新增，并接受用户侧记录失配。
 *
 * 写库策略：
 * - 行内改一条 → 立刻 `PUT` 那一条（与用户侧「改了就生效」同一手感），失败回滚并回填输入框；
 * - **组改名 / 删组**要连同组内条目的 `group` 引用一起改 —— 走 `PUT /api/affix-preset`
 *   整份替换（后端事务），避免「组名改了、条目指向一个不存在的组」那种半成品
 *   （那种条目在用户侧看不见，等于凭空丢词条）。
 */

const TARGET_PREFIXES = ['stat:', 'panel:']

/** 条目 ID 上限，与后端 `normalizeEntryPayload` 同值 */
const ENTRY_ID_MAX = 64

const entries = ref<AffixPresetEntryDoc[]>([])
const groups = ref<AffixPresetGroupDoc[]>([])
const loaded = ref(false)
const loading = ref(false)
/** 正在写库：期间锁住编辑入口，避免两次写交叉把两份快照落库 */
const busy = ref(false)
const message = ref('')
const error = ref('')

const UNGROUPED_TAB = '__ungrouped__'
const activeTab = ref<string>('manage')

/** 条目按排序号展示（与数据库查询、用户侧看到的一致；改完排序号当场重排） */
const sortedEntries = computed(() =>
  [...entries.value].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id),
  ),
)

const sortedGroups = computed(() =>
  [...groups.value].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name),
  ),
)

const activeGroupName = computed(() =>
  activeTab.value === 'manage' || activeTab.value === UNGROUPED_TAB ? '' : activeTab.value,
)

const visibleEntries = computed(() => {
  if (activeTab.value === 'manage') return []
  if (activeTab.value === UNGROUPED_TAB) return sortedEntries.value.filter((entry) => !entry.group)
  return sortedEntries.value.filter((entry) => entry.group === activeTab.value)
})

const activeGroup = computed(
  () => groups.value.find((group) => group.name === activeGroupName.value) ?? null,
)

/** 有未分组条目才给页签（删组或新增未选组的条目时它会冒出来） */
const hasUngrouped = computed(() => entries.value.some((entry) => !entry.group))

const enabledCount = computed(() => entries.value.filter((entry) => entry.enabledByDefault).length)

/** 本页条目是否**全部**默认启用（决定按钮显示「全部默认启用」还是「全部取消默认」） */
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

/**
 * 未分组页同理：最后一条未分组条目被删掉（或改了分组）后，那个页签就没了 ——
 * 停在上面的会看到一张空表、页签条里也没有选中项，只能自己另点一个。直接退回组管理页。
 * （实测踩到：新增一条未选分组的条目 → 删掉 → 页面空着。）
 */
watch(hasUngrouped, (has) => {
  if (!has && activeTab.value === UNGROUPED_TAB) activeTab.value = 'manage'
})

function nextEntrySortOrder(): number {
  const orders = entries.value.map((entry) => entry.sortOrder ?? 0)
  return orders.length ? Math.max(...orders) + 1 : 0
}

function nextGroupSortOrder(): number {
  const orders = groups.value.map((group) => group.sortOrder ?? 0)
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

// ---------- 读 / 写 ----------

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const data = await fetchAffixPreset()
    entries.value = data.entries
    groups.value = data.groups
    loaded.value = true
    newGroupSortOrder.value = nextGroupSortOrder()
    draft.value.sortOrder = nextEntrySortOrder()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

/** 写库统一入口：一把锁 + 统一的提示位置，避免两处写交叉 */
async function runWrite(action: () => Promise<string>) {
  if (busy.value) return
  busy.value = true
  message.value = ''
  error.value = ''
  try {
    message.value = await action()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    busy.value = false
  }
}

/**
 * 把输入控件回填成库里的值。
 *
 * 为什么非做不可：模板用 `:value` + `@change`，本地值若「改了又改回来」，
 * Vue 的渲染结果与上一次相同就不会去动 DOM —— 界面上会留着那个**没存进去**的值。
 */
function revertControl(event: Event | undefined, value: string | number | boolean) {
  const el = event?.target
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') el.checked = Boolean(value)
    else el.value = String(value)
    return
  }
  if (el instanceof HTMLSelectElement) el.value = String(value)
}

/** 行内改一条：先动本地（界面立刻响应），再落库；失败连输入框一起回填 */
async function patchEntry(
  id: string,
  patch: Partial<AffixPresetEntryDoc>,
  event?: Event,
  okMessage?: string,
) {
  const entry = entries.value.find((item) => item.id === id)
  if (!entry) return
  const backup = { ...entry }
  Object.assign(entry, patch)
  const label = patch.label ?? backup.label
  await runWrite(async () => {
    try {
      const saved = await saveAffixPresetEntry({ ...entry })
      Object.assign(entry, saved)
      return okMessage ?? `已保存「${label}」`
    } catch (err) {
      Object.assign(entry, backup)
      const key = Object.keys(patch)[0] as keyof AffixPresetEntryDoc | undefined
      if (key) revertControl(event, backup[key] as string | number | boolean)
      throw err
    }
  })
}

/**
 * 整份替换：分组与条目一起重写（后端事务，失败不留半份）。
 * 用于「组改名 / 删组」这类**必须同步条目引用**的动作，以及「整份重写」按钮。
 */
async function replaceSnapshot(
  nextEntries: AffixPresetEntryDoc[],
  nextGroups: AffixPresetGroupDoc[],
  describe: () => string,
  onFailure?: () => void,
) {
  const backupEntries = entries.value
  const backupGroups = groups.value
  entries.value = nextEntries
  groups.value = nextGroups
  await runWrite(async () => {
    try {
      const data = await replaceAffixPreset({ entries: nextEntries, groups: nextGroups })
      entries.value = data.entries
      groups.value = data.groups
      return describe()
    } catch (err) {
      entries.value = backupEntries
      groups.value = backupGroups
      onFailure?.()
      throw err
    }
  })
}

async function rewriteAll() {
  const entryCount = entries.value.length
  const groupCount = groups.value.length
  if (
    !window.confirm(
      `把当前这 ${entryCount} 条 / ${groupCount} 组整份重写一遍？\n（后端事务：要么全成、要么全不成；内容不变，只是按当前内容重存一次）`,
    )
  ) {
    return
  }
  await replaceSnapshot(
    [...entries.value],
    [...groups.value],
    () => `已重写：${entries.value.length} 条 / ${groups.value.length} 组`,
  )
}

// ---------- 条目 ----------

function toggleEntryDefault(entry: AffixPresetEntryDoc, enabled: boolean, event: Event) {
  void patchEntry(
    entry.id,
    { enabledByDefault: enabled },
    event,
    `${enabled ? '已默认启用' : '已取消默认启用'}「${entry.label}」`,
  )
}

function onRemoveEntry(entry: AffixPresetEntryDoc) {
  const hint = `确认删除条目「${entry.label}」（${entry.id}）？\n用户本地若存着这条的状态会失配 —— 他们的勾选 / 每档覆盖 / 删除记录都按 ID 索引。`
  if (!window.confirm(hint)) return
  const backup = entries.value
  entries.value = entries.value.filter((item) => item.id !== entry.id)
  void runWrite(async () => {
    try {
      await deleteAffixPresetEntry(entry.id)
      return `已删除「${entry.label}」`
    } catch (err) {
      entries.value = backup
      throw err
    }
  })
}

/** 本页「全部默认启用 / 全部取消默认」：一次替换写库（逐条 PUT 会发 N 个请求） */
function toggleAllVisible() {
  const ids = new Set(visibleEntries.value.map((entry) => entry.id))
  const next = !allVisibleEnabled.value
  const nextEntries = entries.value.map((entry) =>
    ids.has(entry.id) ? { ...entry, enabledByDefault: next } : entry,
  )
  void replaceSnapshot(
    nextEntries,
    [...groups.value],
    () => `本页 ${ids.size} 条已${next ? '全部默认启用' : '全部取消默认'}`,
  )
}

// ---------- 新增条目 ----------

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

function submitDraft() {
  const id = draft.value.id.trim()
  const label = draft.value.label.trim()
  const target = draft.value.target.trim()

  if (!id) {
    draftError.value = '请填写条目 ID'
    return
  }
  if (id.length > ENTRY_ID_MAX) {
    draftError.value = `条目 ID 过长（≤${ENTRY_ID_MAX}）`
    return
  }
  if (entries.value.some((entry) => entry.id === id)) {
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
  const doc: AffixPresetEntryDoc = {
    id,
    label,
    target,
    perRoll: draft.value.perRoll,
    cap: draft.value.cap,
    group: draft.value.group,
    rollCost: draft.value.rollCost,
    enabledByDefault: draft.value.enabledByDefault,
    sortOrder: draft.value.sortOrder,
  }
  void runWrite(async () => {
    const saved = await saveAffixPresetEntry(doc)
    entries.value = [...entries.value, saved]
    draft.value = { ...createDraft(), group: doc.group }
    draft.value.sortOrder = nextEntrySortOrder()
    return `已新增条目「${label}」（${id}）`
  })
}

// ---------- 分组 ----------

const newGroupName = ref('')
const newGroupCap = ref(DEFAULT_AFFIX_GROUP_CAP)
const newGroupSortOrder = ref(0)

async function patchGroup(
  name: string,
  patch: Partial<AffixPresetGroupDoc>,
  event?: Event,
  okMessage?: string,
) {
  const group = groups.value.find((item) => item.name === name)
  if (!group) return
  const backup = { ...group }
  Object.assign(group, patch)
  await runWrite(async () => {
    try {
      const saved = await saveAffixPresetGroup({ ...group })
      Object.assign(group, saved)
      return okMessage ?? `已保存分组「${backup.name}」`
    } catch (err) {
      Object.assign(group, backup)
      const key = Object.keys(patch)[0] as keyof AffixPresetGroupDoc | undefined
      if (key) revertControl(event, backup[key] as string | number)
      throw err
    }
  })
}

function submitNewGroup() {
  const name = newGroupName.value.trim()
  if (!name) {
    error.value = '请填写组名'
    return
  }
  if (groups.value.some((group) => group.name === name)) {
    error.value = `已有同名分组「${name}」`
    return
  }
  const doc: AffixPresetGroupDoc = {
    name,
    cap: newGroupCap.value,
    sortOrder: newGroupSortOrder.value,
  }
  void runWrite(async () => {
    const saved = await saveAffixPresetGroup(doc)
    groups.value = [...groups.value, saved]
    newGroupName.value = ''
    newGroupCap.value = DEFAULT_AFFIX_GROUP_CAP
    newGroupSortOrder.value = nextGroupSortOrder()
    return `已新建分组「${name}」（额度 ${saved.cap === 0 ? '不限' : saved.cap}）`
  })
}

/**
 * 改组名：**连同组内条目的分组字段一起改**（一次替换写库）。
 * 只改组名的话，组内条目会指向一个不存在的组 —— 那种条目在用户侧根本看不见。
 */
function renameGroup(from: string, event: Event) {
  const input = event.target as HTMLInputElement
  const to = input.value.trim()
  if (!to || to === from) {
    input.value = from
    return
  }
  if (groups.value.some((group) => group.name === to)) {
    error.value = `已有同名分组「${to}」`
    input.value = from
    return
  }
  const affected = entries.value.filter((entry) => entry.group === from).length
  const nextGroups = groups.value.map((group) =>
    group.name === from ? { ...group, name: to } : group,
  )
  const nextEntries = entries.value.map((entry) =>
    entry.group === from ? { ...entry, group: to } : entry,
  )
  // 页签跟着改名走，否则改完停在一个已经不存在的页上
  if (activeTab.value === from) activeTab.value = to
  void replaceSnapshot(
    nextEntries,
    nextGroups,
    () => `分组「${from}」已改名为「${to}」（组内 ${affected} 条条目一起改）`,
    () => {
      input.value = from
      if (activeTab.value === to) activeTab.value = from
    },
  )
}

/** 删组：只删组，组内条目变回未分组（条目不会跟着消失） */
function removeGroup(group: AffixPresetGroupDoc) {
  const affected = entries.value.filter((entry) => entry.group === group.name).length
  const hint = affected
    ? `组内 ${affected} 条条目会变回「未分组」（条目本身不删）`
    : '组内没有条目'
  if (!window.confirm(`确认删除分组「${group.name}」？\n${hint}。`)) return
  const nextGroups = groups.value.filter((item) => item.name !== group.name)
  const nextEntries = entries.value.map((entry) =>
    entry.group === group.name ? { ...entry, group: '' } : entry,
  )
  if (activeTab.value === group.name) activeTab.value = 'manage'
  void replaceSnapshot(
    nextEntries,
    nextGroups,
    () => `已删除分组「${group.name}」（${affected} 条条目变回未分组）`,
    () => {
      if (activeTab.value === 'manage') activeTab.value = group.name
    },
  )
}

onMounted(() => {
  void loadAll()
})
</script>

<template>
  <section class="editor-panel affix-preset-panel">
    <header class="panel-header">
      <h2 class="panel-title">官方预设词条库</h2>
      <p class="panel-desc">
        这里是<strong>官方预设的唯一来源</strong>：进计算页的人都会拿到这份。用户能复制一份到自己的
        浏览器里随便改，但改不回这里。<strong>条目 ID 一旦发布不要改</strong> —— 用户本地的勾选、
        每档覆盖、删除记录都按 ID 索引。
      </p>
    </header>

    <p v-if="loading && !loaded" class="panel-hint">正在从数据库读取官方预设…</p>
    <p v-else-if="error && !loaded" class="form-error">{{ error }}</p>

    <template v-else>
      <div class="stat-row">
        <span>条目 <strong>{{ entries.length }}</strong> 条</span>
        <span>默认启用 <strong>{{ enabledCount }}</strong> 条</span>
        <span>分组 <strong>{{ groups.length }}</strong> 个</span>
        <span class="stat-spacer" />
        <button type="button" class="secondary-btn" :disabled="loading || busy" @click="loadAll">
          {{ loading ? '读取中…' : '重新读取' }}
        </button>
        <button
          type="button"
          class="secondary-btn"
          :disabled="loading || busy"
          title="按当前内容整份重存一次（后端事务）：内容不变，用于「改乱了想确认一遍」"
          @click="rewriteAll"
        >
          整份重写
        </button>
      </div>

      <p v-if="message" class="form-ok">{{ message }}</p>
      <p v-if="error" class="form-error">{{ error }}</p>

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
          v-for="group in sortedGroups"
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
                <th>默认启用</th>
                <th>ID</th>
                <th>名称</th>
                <th>目标</th>
                <th>每档</th>
                <th>上限</th>
                <th>每档占用</th>
                <th>分组</th>
                <th>排序</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="entry in visibleEntries"
                :key="entry.id"
                :class="{ disabled: !entry.enabledByDefault }"
              >
                <td>
                  <input
                    type="checkbox"
                    :checked="entry.enabledByDefault"
                    :disabled="busy"
                    @change="
                      toggleEntryDefault(
                        entry,
                        ($event.target as HTMLInputElement).checked,
                        $event,
                      )
                    "
                  />
                </td>
                <!-- ID 是稳定键：只读展示（改 ID＝删了重建） -->
                <td class="id-cell" :title="entry.id">{{ entry.id }}</td>
                <td>
                  <input
                    class="cell-input"
                    type="text"
                    :value="entry.label"
                    :disabled="busy"
                    @change="
                      patchEntry(entry.id, {
                        label: ($event.target as HTMLInputElement).value,
                      }, $event)
                    "
                  />
                </td>
                <td>
                  <input
                    class="cell-input"
                    type="text"
                    :value="entry.target"
                    :disabled="busy"
                    @change="
                      patchEntry(entry.id, {
                        target: ($event.target as HTMLInputElement).value.trim(),
                      }, $event)
                    "
                  />
                  <span class="cell-hint" :class="{ 'cell-hint--warn': !targetRecognized(entry.target) }">
                    {{ targetHint(entry.target) }}
                  </span>
                </td>
                <td>
                  <span class="per-roll-cell">
                    <input
                      class="cell-input num"
                      type="number"
                      step="0.1"
                      :value="entry.perRoll"
                      :disabled="busy"
                      @change="
                        patchEntry(entry.id, {
                          perRoll: Number(($event.target as HTMLInputElement).value),
                        }, $event)
                      "
                    />
                    <!-- 单位槽恒存在：用 v-if 会让百分比行的输入框被单位挤窄，整列右边缘参差不齐 -->
                    <span class="unit-hint">{{ perRollUnit(entry.target) }}</span>
                  </span>
                </td>
                <td>
                  <input
                    class="cell-input num"
                    type="number"
                    min="0"
                    step="1"
                    :value="entry.cap"
                    title="0 表示不设上限"
                    :disabled="busy"
                    @change="
                      patchEntry(entry.id, {
                        cap: Number(($event.target as HTMLInputElement).value),
                      }, $event)
                    "
                  />
                </td>
                <td>
                  <input
                    class="cell-input num"
                    type="number"
                    min="0"
                    step="1"
                    :value="entry.rollCost"
                    title="每条词条占几个「总词条数」预算；用户侧固定为 1"
                    :disabled="busy"
                    @change="
                      patchEntry(entry.id, {
                        rollCost: Number(($event.target as HTMLInputElement).value),
                      }, $event)
                    "
                  />
                </td>
                <td>
                  <select
                    class="cell-input"
                    :value="entry.group"
                    :disabled="busy"
                    @change="
                      patchEntry(entry.id, {
                        group: ($event.target as HTMLSelectElement).value,
                      }, $event)
                    "
                  >
                    <option value="">（未分组）</option>
                    <option v-for="group in sortedGroups" :key="group.name" :value="group.name">
                      {{ group.name }}
                    </option>
                  </select>
                </td>
                <td>
                  <input
                    class="cell-input num"
                    type="number"
                    step="1"
                    :value="entry.sortOrder ?? 0"
                    title="展示顺序（小的在前）"
                    :disabled="busy"
                    @change="
                      patchEntry(entry.id, {
                        sortOrder: Number(($event.target as HTMLInputElement).value),
                      }, $event)
                    "
                  />
                </td>
                <td>
                  <button
                    type="button"
                    class="del-btn"
                    title="删除该条目（用户本地按 ID 存的勾选 / 覆盖会因此失配）"
                    :disabled="busy"
                    @click="onRemoveEntry(entry)"
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
            <label>
              <span>ID</span>
              <input v-model="draft.id" type="text" placeholder="如 main:slot4:critDmg" />
            </label>
            <label>
              <span>名称</span>
              <input v-model="draft.label" type="text" placeholder="如 爆伤 48%" />
            </label>
            <label>
              <span>目标（字段名）</span>
              <input v-model="draft.target" type="text" placeholder="stat:critDmg 或 panel:dmgBonus" />
            </label>
            <label>
              <span>每档</span>
              <span class="per-roll-cell">
                <input v-model.number="draft.perRoll" type="number" step="0.1" min="0" />
                <span class="unit-hint">{{ perRollUnit(draft.target) }}</span>
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
                <option v-for="group in sortedGroups" :key="group.name" :value="group.name">
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
              新增
            </button>
          </div>
          <p v-if="draftError" class="form-error">{{ draftError }}</p>
          <p class="footnote">
            新增即写库。<strong>ID 是用户本地记录的索引</strong>，发布后不要再改；
            目标填 `stat:` 走词条计数桶、`panel:` 走面板字段，认不出的字段名计算页会跳过它。
          </p>
        </div>
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
                <th>组名</th>
                <th>组额度</th>
                <th>排序</th>
                <th>说明</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="group in sortedGroups" :key="group.name">
                <td>
                  <input
                    class="cell-input"
                    type="text"
                    :value="group.name"
                    :disabled="busy"
                    title="改名会连同组内条目的分组一起改"
                    @change="renameGroup(group.name, $event)"
                  />
                </td>
                <td>
                  <input
                    class="cell-input num"
                    type="number"
                    min="0"
                    step="1"
                    :value="group.cap"
                    title="组内各条档数之和的上限；0 = 不限"
                    :disabled="busy"
                    @change="
                      patchGroup(group.name, {
                        cap: Number(($event.target as HTMLInputElement).value),
                      }, $event)
                    "
                  />
                </td>
                <td>
                  <input
                    class="cell-input num"
                    type="number"
                    step="1"
                    :value="group.sortOrder ?? 0"
                    title="分组展示顺序（小的在前）"
                    :disabled="busy"
                    @change="
                      patchGroup(group.name, {
                        sortOrder: Number(($event.target as HTMLInputElement).value),
                      }, $event)
                    "
                  />
                </td>
                <td class="note-cell">
                  {{
                    group.cap === 0
                      ? '0 = 不限制（这几条可以同时用满各自上限）'
                      : '组内各条档数之和 ≤ 额度'
                  }}
                  · 组内 {{ entries.filter((entry) => entry.group === group.name).length }} 条
                </td>
                <td>
                  <button
                    type="button"
                    class="del-btn"
                    title="只删这个分组，组内条目会变回未分组"
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
          </p>
        </div>
      </template>
    </template>
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

.cell-input.num {
  text-align: right;
}

.id-cell {
  font-family: var(--zzz-font-mono, monospace);
  font-size: 0.72rem;
  line-height: 1.5;
  color: var(--color-text);
  opacity: 0.85;
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
  width: 132px;
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
  width: 56px;
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
}
</style>
