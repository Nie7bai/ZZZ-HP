<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { AffixCounts } from '@/types/calculatorPanel'
import {
  AFFIX_LIBRARY_SET_NAME_MAX,
  AFFIX_PANEL_DELTA_FIELD_LABELS,
  AFFIX_SUBSTAT_KEY_LABELS,
  activateAffixLibrarySet,
  activeAffixLibrarySet,
  affixPerRollUnit,
  createAffixLibrarySet,
  deleteAffixLibrarySet,
  exportAffixLibrarySet,
  importAffixLibrarySet,
  loadAffixLibraryStore,
  panelTarget,
  renameAffixLibrarySet,
  resolveAffixLibrary,
  resolveAffixLibraryAll,
  saveAffixLibraryStore,
  statTarget,
  type AffixLibraryEntry,
  type AffixLibraryEntryTarget,
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
 * - **条目级编辑**（启用 / 增 / 改 / 删 / 恢复默认）走 emit 交给页面，
 *   沿用既有的「改了就重算」链路，不在这里另建一套状态。
 */

const props = withDefaults(
  defineProps<{
    open: boolean
    /** 当前激活库的全部条目（含未参与计算的） */
    library: AffixLibraryEntry[]
    /** 正在参与计算的条目 id */
    enabledIds: string[]
  }>(),
  {},
)

const emit = defineEmits<{
  close: []
  toggleEntry: [entryId: string, enabled: boolean]
  addEntry: [entry: Omit<AffixLibraryEntry, 'id'>]
  updateEntry: [entryId: string, patch: Partial<AffixLibraryEntry>]
  removeEntry: [entryId: string]
  restoreDefaults: []
  /** 库级变更（切换/新建/重命名/删除/导入）已完成并落盘，页面应重新载入 */
  switched: []
}>()

const enabledSet = computed(() => new Set(props.enabledIds))

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
    pendingImport.value = null
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

function startNewSet() {
  newSetMode.value = true
  newSetName.value = ''
  void nextTick(() => newSetInputRef.value?.focus())
}

function commitNewSet() {
  const name = newSetName.value.trim() || '新建词条库'
  newSetMode.value = false
  newSetName.value = ''
  commitStoreChange((base) => createAffixLibrarySet(base, name))
  setMessage.value = `已新建「${name}」并切了过去`
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
/** 选完文件后要执行哪种导入（点按钮时决定，文件选择器是共用的） */
const pendingImportMode = ref<'replace' | 'new'>('new')
const importError = ref('')
/** 覆盖式导入的二次确认内容（文件名） */
const pendingImport = ref<{ json: string; fileName: string } | null>(null)

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

function triggerImport(mode: 'replace' | 'new') {
  importError.value = ''
  pendingImportMode.value = mode
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
  const mode = pendingImportMode.value
  if (mode === 'replace') {
    // 覆盖会顶掉当前库内容，先确认再落盘
    pendingImport.value = { json: text, fileName: file.name }
    return
  }
  applyImport(text, 'new')
}

function applyImport(json: string, mode: 'replace' | 'new') {
  // 先跟盘上内容对齐再解析，理由同 `withLatestActiveState`
  const result = importAffixLibrarySet(withLatestActiveState(store.value), json, mode)
  if (result.error) {
    importError.value = result.error
    return
  }
  importError.value = ''
  pendingImport.value = null
  commitStore(result.store)
  setMessage.value =
    mode === 'replace' ? `已用文件覆盖当前库（${result.name}）` : `已导入为新库「${result.name}」`
}

function confirmPendingImport() {
  const pending = pendingImport.value
  if (!pending) return
  applyImport(pending.json, 'replace')
}

function cancelPendingImport() {
  pendingImport.value = null
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

function onRestoreDefaults() {
  forwardEntryEdit(() => emit('restoreDefaults'))
}

// ---------- 条目编辑（新增表单） ----------

/** 候选目标（合并后是一个下拉，按命名空间分组） */
const STAT_TARGET_OPTIONS = (Object.keys(AFFIX_SUBSTAT_KEY_LABELS) as (keyof AffixCounts)[]).map(
  (key) => ({ id: statTarget(key), label: AFFIX_SUBSTAT_KEY_LABELS[key] }),
)

const PANEL_TARGET_OPTIONS = (
  Object.keys(AFFIX_PANEL_DELTA_FIELD_LABELS) as AffixPanelDeltaField[]
).map((field) => ({ id: panelTarget(field), label: AFFIX_PANEL_DELTA_FIELD_LABELS[field] }))

const draft = ref({
  label: '',
  target: statTarget('atkPercent') as AffixLibraryEntryTarget,
  perRoll: 3,
  cap: 0,
  group: '',
})
const draftError = ref<string | null>(null)

const draftPerRollUnit = computed(() =>
  affixPerRollUnit(draft.value.target) === 'percent' ? '%' : '',
)

/** 列表里的类型说明：区分「按基础值换算」与「直接叠加面板」 */
function targetNamespaceLabel(target: AffixLibraryEntryTarget): string {
  return target.startsWith('stat:') ? '词条数' : '面板增量'
}

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
  forwardEntryEdit(() =>
    emit('addEntry', {
      label,
      target: draft.value.target,
      perRoll: draft.value.perRoll,
      cap: draft.value.cap,
      group: draft.value.group.trim(),
      // 独立功能口径：每条词条 1 档一律占 1 个总词条数
      rollCost: 1,
      enabledByDefault: true,
    }),
  )
  draft.value.label = ''
  draft.value.cap = 0
  draft.value.group = ''
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

            <div v-if="newSetMode" class="set-new-row">
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
              <button type="button" class="mini-btn ok" @click="commitNewSet">确定</button>
              <button type="button" class="mini-btn" @click="cancelNewSet">取消</button>
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
              <button type="button" class="mini-btn" @click="triggerImport('new')">导入为新库</button>
              <button type="button" class="mini-btn" @click="triggerImport('replace')">
                覆盖当前库
              </button>
            </div>
            <input
              ref="fileInputRef"
              type="file"
              accept="application/json,.json"
              class="file-input"
              @change="onFilePicked"
            />

            <p v-if="pendingImport" class="confirm-row">
              用「{{ pendingImport.fileName }}」覆盖当前库「{{ activeSet.name }}」？
              <button type="button" class="mini-btn ok" @click="confirmPendingImport">覆盖</button>
              <button type="button" class="mini-btn" @click="cancelPendingImport">取消</button>
            </p>
            <p v-if="importError" class="err">{{ importError }}</p>
            <p v-if="setMessage" class="ok-msg">{{ setMessage }}</p>
          </aside>

          <!-- 右：当前库的条目 -->
          <section class="entry-pane">
            <div class="pane-head">
              <span class="pane-title">「{{ activeSet.name }}」的词条</span>
              <button type="button" class="mini-btn" @click="onRestoreDefaults">
                恢复默认
              </button>
            </div>

            <div class="entry-scroll">
              <table class="library-table">
                <thead>
                  <tr>
                    <th>参与</th>
                    <th>名称</th>
                    <th>类型</th>
                    <th>每档</th>
                    <th>上限</th>
                    <th>互斥组</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="entry in library"
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
                        @change="
                          onUpdateEntry(entry.id, {
                            label: ($event.target as HTMLInputElement).value,
                          })
                        "
                      />
                    </td>
                    <td class="type-cell">{{ targetNamespaceLabel(entry.target) }}</td>
                    <td>
                      <span class="per-roll-cell">
                        <input
                          class="inline-input num"
                          type="number"
                          step="0.1"
                          :value="entry.perRoll"
                          @change="
                            onUpdateEntry(entry.id, {
                              perRoll: Number(($event.target as HTMLInputElement).value),
                            })
                          "
                        />
                        <span v-if="perRollUnitHint(entry.target)" class="unit-hint">%</span>
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
                      <input
                        class="inline-input"
                        :value="entry.group"
                        placeholder="空=自由"
                        @change="
                          onUpdateEntry(entry.id, {
                            group: ($event.target as HTMLInputElement).value,
                          })
                        "
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        class="del-btn"
                        title="删除该条目（默认条目可用「恢复默认」找回）"
                        @click="onRemoveEntry(entry.id)"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="add-entry">
              <h5>新增词条</h5>
              <div class="add-grid">
                <label>
                  <span>名称</span>
                  <input v-model="draft.label" type="text" placeholder="如：5号位增伤" />
                </label>
                <label>
                  <span>目标</span>
                  <select v-model="draft.target">
                    <optgroup label="词条数（按基础值换算）">
                      <option v-for="opt in STAT_TARGET_OPTIONS" :key="opt.id" :value="opt.id">
                        {{ opt.label }}
                      </option>
                    </optgroup>
                    <optgroup label="面板增量（直接叠加局外面板）">
                      <option v-for="opt in PANEL_TARGET_OPTIONS" :key="opt.id" :value="opt.id">
                        {{ opt.label }}
                      </option>
                    </optgroup>
                  </select>
                </label>
                <label>
                  <span>每档</span>
                  <span class="per-roll-cell">
                    <input v-model.number="draft.perRoll" type="number" step="0.1" min="0" />
                    <span v-if="draftPerRollUnit" class="unit-hint">{{ draftPerRollUnit }}</span>
                  </span>
                </label>
                <label>
                  <span>上限</span>
                  <input v-model.number="draft.cap" type="number" min="0" step="1" title="0 = 不设上限" />
                </label>
                <label>
                  <span>互斥组</span>
                  <input v-model="draft.group" type="text" placeholder="可空" />
                </label>
                <button type="button" class="btn-primary" @click="submitDraft">添加</button>
              </div>
              <p v-if="draftError" class="err">{{ draftError }}</p>
            </div>

            <p class="footnote">
              同一字段有多条词条时，档数会合并计算，每档值取列表中靠后的那条。
            </p>
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

.set-new-row {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;
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

.confirm-row.danger {
  color: #f0c9c9;
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
  border-collapse: collapse;
  font-size: 0.8rem;
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

.type-cell {
  color: #9aa3b0;
  white-space: nowrap;
}

.inline-input {
  width: 100%;
  min-width: 4rem;
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

.unit-hint {
  color: #8b94a1;
  font-size: 0.75rem;
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
