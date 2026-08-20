<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { AgentBuffDoc } from '@/types/calculator'
import type { DamageCalcHistoryEntry } from '@/types/damageCalcHistory'
import {
  batchDeleteSchemes,
  baseName,
  copyFolderTree,
  copyScheme,
  countChildFolders,
  countSchemesInFolder,
  createFolder,
  deleteFolder,
  duplicateSchemeToFolder,
  exportDamageCalcHistory,
  formatDamageCalcHistoryTime,
  getLoadedSchemeId,
  importDamageCalcHistory,
  listAllDamageCalcHistory,
  listDamageCalcHistory,
  listFolders,
  moveFolderTree,
  moveScheme,
  nameConflictType,
  normFolder,
  parentFolder,
  pathType,
  renameFolder,
  renameScheme,
  reorderFolder,
  reorderScheme,
  schemePath,
  schemeStats,
  setLoadedSchemeId,
} from '@/utils/damageCalcHistory'

const props = defineProps<{
  entries: DamageCalcHistoryEntry[]
  agents: AgentBuffDoc[]
  activeEntryId?: string
  message?: string
}>()

const emit = defineEmits<{
  save: [payload: { name: string; folder: string }]
  overwrite: [path: string]
  load: [entry: DamageCalcHistoryEntry]
  'clear-loaded': []
  changed: []
  imported: [loadedId: string]
}>()

// ============ 2次确认锁 + 自定义弹窗（替代浏览器原生 confirm / prompt） ============
const CONFIRM_KEY = 'zzz-hp-scheme-confirm'
const confirmEnabled = ref(true)
try {
  const cv = localStorage.getItem(CONFIRM_KEY)
  if (cv !== null) confirmEnabled.value = cv === '1'
} catch (_) {}

function toggleConfirmLock(e: Event) {
  confirmEnabled.value = (e.target as HTMLInputElement).checked
  try {
    localStorage.setItem(CONFIRM_KEY, confirmEnabled.value ? '1' : '0')
  } catch (_) {}
}

interface PendingConfirm {
  title: string
  message: string
  danger?: boolean
  confirmText?: string
  cancelText?: string
  highlight?: string
  onConfirm: () => void
}
const pendingConfirm = ref<PendingConfirm | null>(null)

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function confirmMessageHtml() {
  const p = pendingConfirm.value
  if (!p) return ''
  const escMsg = escapeHtml(p.message)
  if (!p.highlight) return escMsg
  const escHl = escapeHtml(p.highlight)
  return escMsg.split(escHl).join('<span class="scheme-confirm-hl">' + escHl + '</span>')
}

function confirmThen(opts: Omit<PendingConfirm, 'onConfirm'>, action: () => void) {
  if (!confirmEnabled.value) {
    action()
    return
  }
  pendingConfirm.value = { ...opts, onConfirm: action }
}

/** 不受二次确认锁影响，导入覆盖等破坏性操作必须走这层 */
function confirmAlways(opts: Omit<PendingConfirm, 'onConfirm'>, action: () => void) {
  pendingConfirm.value = { ...opts, onConfirm: action }
}

function closeConfirm() {
  pendingConfirm.value = null
}

function runConfirm() {
  const fn = pendingConfirm.value?.onConfirm
  closeConfirm()
  if (fn) fn()
}

// ============ 状态 ============
const draftName = ref('')
const searchQuery = ref('')
// 搜索框：对齐 zzz-dev 的原生 oninput 做法——每次按键立即更新并强制刷新列表，
// 避免 Vue computed 对 searchQuery 的依赖偶发未被稳定收集导致"输 1 字符不搜、要 2 字符才搜"的错位。
function onSearchInput(e: Event) {
  const t = e.target as HTMLInputElement
  searchQuery.value = t.value
  revision.value++
}
// 安全网：searchQuery 变化时强制重算列表，确保任何响应式边界情况下都即时过滤
watch(searchQuery, () => {
  revision.value++
})
const currentFolder = ref('')
const loadedId = ref('')
const modalOpen = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
const formMessage = ref('')
/** 从伤害事件弹窗「新建方案」打开时为 true：保存成功后自动关闭方案库 */
const openedForEventSave = ref(false)

// ============ localStorage 占用提示（常驻显示，接近上限时弹窗顶部额外红字，不干涉保存）============
const STORAGE_LIMIT_MB = 5
const STORAGE_WARN_MB = 4
const SCHEME_STORAGE_KEY = 'zzz-hp-damage-calc-history'

const storageUsage = computed(() => {
  // 依赖 revision：增删改/导入后实时刷新占用
  void revision.value
  try {
    const raw = localStorage.getItem(SCHEME_STORAGE_KEY)
    const bytes = raw ? raw.length * 2 : 0 // localStorage 按 UTF-16 计字节
    const mb = bytes / (1024 * 1024)
    return { bytes, mb, text: `${mb.toFixed(2)} / ${STORAGE_LIMIT_MB} MB` }
  } catch {
    return { bytes: 0, mb: 0, text: `0 / ${STORAGE_LIMIT_MB} MB` }
  }
})
const storageWarn = computed(() => storageUsage.value.mb >= STORAGE_WARN_MB)

// 数据版本计数器：每次对 localStorage 做增删改（子组件 emit('changed') → 父组件重读全部方案
// → props.entries 引用变化）或 currentFolder / searchQuery 变化时，强制 subFolders / currentEntries
// 重新从 localStorage 读取。否则 computed 只依赖 currentFolder，当前目录内增删目录时不会重算
// （需刷新才显示），且子组件过去依赖 props.entries（父组件只传了根目录方案）会导致进子目录看不到方案。
const revision = ref(0)

watch(
  () => props.entries,
  () => {
    revision.value++
    // 以父组件当前方案为准，避免空状态时回落到上次 localStorage 高亮
    loadedId.value = props.activeEntryId || ''
  },
)

// 整理模式
const manageMode = ref(false)
const selectedIds = ref<string[]>([])
const clipboard = ref<{ op: 'copy' | 'cut'; ids: string[] } | null>(null)

// 新建目录内联输入
const newFolderMode = ref(false)
const newFolderName = ref('')

// 内联重命名
const renamingSchemePath = ref('')
const renamingSchemeValue = ref('')
const renamingFolder = ref('')
const renamingFolderValue = ref('')

// 关键修复：父组件加载后更新 activeEntryId，子组件必须同步，否则高亮/状态条不刷新
watch(
  () => props.activeEntryId,
  (id) => {
    loadedId.value = id || ''
  },
  { immediate: true },
)

function initLoaded() {
  loadedId.value = props.activeEntryId || ''
}

// ============ 打开 / 关闭 ============
function openModal() {
  modalOpen.value = true
  formMessage.value = ''
  openedForEventSave.value = false
}

function closeModal() {
  modalOpen.value = false
  draftName.value = ''
  searchQuery.value = ''
  formMessage.value = ''
  openedForEventSave.value = false
  manageMode.value = false
  selectedIds.value = []
  clipboard.value = null
  newFolderMode.value = false
  newFolderName.value = ''
  renamingSchemePath.value = ''
  renamingFolder.value = ''
}

// ============ 保存（新建） ============
function saveCurrent() {
  const name = draftName.value.trim()
  if (!name) {
    formMessage.value = '请先输入方案命名'
    return
  }
  const fromEventSave = openedForEventSave.value
  formMessage.value = ''
  emit('save', { name, folder: currentFolder.value })
  draftName.value = ''
  if (fromEventSave) {
    // 从事件弹窗引导新建：保存后关掉方案库，让出事件窗继续编辑
    closeModal()
  }
}

// ============ 加载 / 覆盖 ============
function loadEntry(entry: DamageCalcHistoryEntry) {
  const name = entry.name
  confirmThen(
    {
      title: '加载方案',
      message: `确认加载「${name}」？将覆盖当前计算页配置。`,
      danger: true,
      highlight: name,
    },
    () => {
      emit('load', entry)
      closeModal()
    },
  )
}

function overwriteEntry(path: string) {
  const entry = props.entries.find((e) => e.id === path)
  const name = entry?.name || '该方案'
  confirmThen(
    {
      title: '覆盖保存方案',
      message: `确认用当前配置覆盖「${name}」？原方案将被替换。`,
      danger: true,
      highlight: name,
    },
    () => emit('overwrite', path),
  )
}

// ============ 方案操作 ============
function deleteEntry(path: string) {
  const name = baseName(path)
  confirmThen(
    {
      title: '删除方案',
      message: `确认删除「${name}」？本地未备份将无法找回。`,
      danger: true,
      highlight: name,
    },
    () => {
      batchDeleteSchemes([path])
      selectedIds.value = selectedIds.value.filter((x) => x !== path)
      if (getLoadedSchemeId() === path) setLoadedSchemeId('')
      loadedId.value = props.activeEntryId === path ? '' : props.activeEntryId || ''
      emit('changed')
    },
  )
}

function copyEntry(path: string) {
  copyScheme(path)
  emit('changed')
}

function startRenameScheme(entry: DamageCalcHistoryEntry) {
  renamingSchemePath.value = entry.id
  renamingSchemeValue.value = entry.name
  nextTick(() => {
    const el = document.querySelector<HTMLInputElement>('.scheme-rename-input')
    el?.focus()
    el?.select()
  })
}

function commitRenameScheme() {
  const path = renamingSchemePath.value
  const name = renamingSchemeValue.value.trim()
  renamingSchemePath.value = ''
  renamingSchemeValue.value = ''
  if (!path || !name) {
    emit('changed')
    return
  }
  const oldName = baseName(path)
  if (name === oldName) {
    emit('changed')
    return
  }
  const entry = props.entries.find((e) => e.id === path)
  const conflict = nameConflictType(entry?.folder || parentFolder(path), name, 'scheme')
  if (conflict) {
    formMessage.value = `当前目录下已存在同名方案「${name}」，请使用其他名称`
    emit('changed')
    return
  }
  const ok = renameScheme(path, name)
  formMessage.value = ok ? `方案已改名为「${name}」` : '改名失败，请重试'
  emit('changed')
}

function moveOrder(path: string, dir: -1 | 1) {
  reorderScheme(path, dir)
  emit('changed')
}

// ============ 目录操作 ============
// 子组件自己从 localStorage 读取目录与方案，避免依赖父组件 props.entries
// （父组件曾只传根目录方案，导致进子目录看不到方案）；revision 变更时强制重算。
const subFolders = computed(() => {
  void revision.value
  const q = searchQuery.value.trim().toLowerCase()
  return listFolders(currentFolder.value).filter((d) => !q || baseName(d).toLowerCase().includes(q))
})

const currentEntries = computed(() => {
  void revision.value
  const q = searchQuery.value.trim().toLowerCase()
  return listDamageCalcHistory(currentFolder.value)
    .filter((e) => {
      if (!q) return true
      return (e.name || '').toLowerCase().includes(q)
    })
    .sort((a, b) => (a.order ?? a.savedAt) - (b.order ?? b.savedAt))
})

function enterFolder(path: string) {
  currentFolder.value = path
}

function goUp() {
  currentFolder.value = parentFolder(currentFolder.value)
}

// 整理模式下点击目录卡本体（非复选框、非重命名编辑中）→ 钻入该目录
// 参考 zzz-dev：目录可钻取，勾选仅由复选框负责；勾选跨目录保留，便于"父目录选方案→进子目录粘贴"
function onDirMetaClick(dir: string) {
  if (renamingFolder.value === dir) return
  enterFolder(dir)
}

// 整理模式下点击方案卡本体 → 勾选/取消（方案不可钻取）
function onSchemeMetaClick(entry: DamageCalcHistoryEntry) {
  if (renamingSchemePath.value === entry.id) return
  if (manageMode.value) toggleSelect(entry.id)
}

function startNewFolder() {
  newFolderMode.value = true
  newFolderName.value = ''
  nextTick(() => {
    document.querySelector<HTMLInputElement>('.dir-new-input')?.focus()
  })
}

function cancelNewFolder() {
  newFolderMode.value = false
  newFolderName.value = ''
}

function commitNewFolder() {
  const name = newFolderName.value.trim()
  if (!name) {
    cancelNewFolder()
    return
  }
  if (name.includes('/')) {
    formMessage.value = '目录名不能包含 "/"'
    return
  }
  // 同名保护：目录仅与目录冲突拦截（与方案可同名）
  const conflict = nameConflictType(currentFolder.value, name, 'dir')
  if (conflict === 'dir') {
    formMessage.value = `目录「${name}」已存在，不能重名`
    return
  }
  const path = schemePath(currentFolder.value, name)
  if (!createFolder(path)) {
    formMessage.value = '目录创建失败（名称非法或与已有项重名）'
    return
  }
  formMessage.value = ''
  cancelNewFolder()
  emit('changed')
}

function deleteFolderByName(path: string) {
  const name = baseName(path)
  const schemeCount = countSchemesInFolder(path)
  const dirCount = countChildFolders(path)
  confirmThen(
    {
      title: '删除目录',
      message:
        `确认删除目录「${name}」？将一并删除其下 ${schemeCount} 套方案` +
        (dirCount ? ` 及 ${dirCount} 个子目录` : '') +
        '，无法找回。',
      danger: true,
      highlight: name,
    },
    () => {
      deleteFolder(path)
      if (currentFolder.value === path || currentFolder.value.indexOf(path + '/') === 0) {
        currentFolder.value = parentFolder(path)
      }
      selectedIds.value = selectedIds.value.filter((x) => x !== path)
      emit('changed')
    },
  )
}

function startRenameFolder(path: string) {
  renamingFolder.value = path
  renamingFolderValue.value = baseName(path)
  nextTick(() => {
    document.querySelector<HTMLInputElement>('.folder-rename-input')?.focus()
    document.querySelector<HTMLInputElement>('.folder-rename-input')?.select()
  })
}

function commitRenameFolder() {
  const path = renamingFolder.value
  const name = renamingFolderValue.value.trim()
  renamingFolder.value = ''
  renamingFolderValue.value = ''
  if (!path || !name) {
    emit('changed')
    return
  }
  const oldName = baseName(path)
  if (name === oldName) {
    emit('changed')
    return
  }
  const conflict = nameConflictType(parentFolder(path), name, 'dir')
  if (conflict === 'dir') {
    formMessage.value = `当前目录下已存在同名目录「${name}」，请使用其他名称`
    emit('changed')
    return
  }
  const ok = renameFolder(path, name)
  if (ok) {
    // 若重命名了当前所在目录或其祖先，同步当前目录位置
    const np = schemePath(parentFolder(path), name)
    if (currentFolder.value === path) currentFolder.value = np
    else if (currentFolder.value.indexOf(path + '/') === 0) {
      currentFolder.value = np + currentFolder.value.slice(path.length)
    }
    formMessage.value = `目录已改名为「${name}」`
  } else {
    formMessage.value = '目录改名失败，请重试'
  }
  emit('changed')
}

// ============ 整理模式（批量管理） ============
function toggleManage() {
  manageMode.value = !manageMode.value
  if (!manageMode.value) {
    selectedIds.value = []
    clipboard.value = null
  }
}

function isSelected(path: string) {
  return selectedIds.value.includes(path)
}

function toggleSelect(path: string) {
  if (isSelected(path)) selectedIds.value = selectedIds.value.filter((x) => x !== path)
  else selectedIds.value = [...selectedIds.value, path]
}

function selectAllInFolder() {
  const here = [
    ...subFolders.value,
    ...currentEntries.value.map((e) => e.id),
  ]
  const allSelected = here.length > 0 && here.every((id) => isSelected(id))
  if (allSelected) {
    const hereSet = new Set(here)
    selectedIds.value = selectedIds.value.filter((x) => !hereSet.has(x))
  } else {
    const set = new Set(selectedIds.value)
    here.forEach((id) => set.add(id))
    selectedIds.value = Array.from(set)
  }
}

function batchDelete() {
  if (selectedIds.value.length === 0) return
  confirmThen(
    {
      title: '批量删除',
      message: `确认删除选中的 ${selectedIds.value.length} 项（含其下方案/子目录）？本地未备份将无法找回。`,
      danger: true,
    },
    () => {
      batchDeleteSchemes(selectedIds.value)
      const loaded = getLoadedSchemeId()
      if (loaded && selectedIds.value.includes(loaded)) setLoadedSchemeId('')
      selectedIds.value = []
      clipboard.value = null
      loadedId.value = props.activeEntryId || ''
      emit('changed')
    },
  )
}

function batchCopy() {
  if (selectedIds.value.length === 0) return
  clipboard.value = { op: 'copy', ids: selectedIds.value.slice() }
  formMessage.value = `已复制 ${selectedIds.value.length} 项，切换到目标目录后点“粘贴”移动`
}

function batchCut() {
  if (selectedIds.value.length === 0) return
  clipboard.value = { op: 'cut', ids: selectedIds.value.slice() }
  formMessage.value = `已剪切 ${selectedIds.value.length} 项，切换到目标目录后点“粘贴”移动`
}

function paste() {
  if (!clipboard.value) {
    formMessage.value = '剪贴板为空：请先复制或剪切方案/目录'
    return
  }
  const { op, ids } = clipboard.value
  for (const id of ids) {
    const type = pathType(id)
    if (type === 'scheme') {
      if (op === 'copy') duplicateSchemeToFolder(id, currentFolder.value)
      else moveScheme(id, currentFolder.value)
    } else if (type === 'dir') {
      if (op === 'copy') copyFolderTree(id, currentFolder.value)
      else moveFolderTree(id, currentFolder.value)
    }
  }
  clipboard.value = null
  selectedIds.value = []
  emit('changed')
}

function moveDirOrder(path: string, dir: -1 | 1) {
  reorderFolder(path, dir)
  emit('changed')
}

// ============ 路径面包屑 ============
const breadcrumbSegments = computed(() => {
  if (!currentFolder.value) return []
  const parts = currentFolder.value.split('/').filter(Boolean)
  return parts.map((seg, idx) => {
    const path = '/' + parts.slice(0, idx + 1).join('/')
    return { name: seg, path }
  })
})

function loadedEntry() {
  if (!loadedId.value) return undefined
  return listAllDamageCalcHistory().find((e) => e.id === loadedId.value)
}

function jumpToLoadedFolder() {
  const e = loadedEntry()
  if (e) currentFolder.value = normFolder(e.folder || '')
}

/** 清空当前页面上的方案配置（不删方案库条目） */
function clearLoadedScheme() {
  confirmThen(
    {
      title: '清空当前配置',
      message:
        '确认清空当前页面的队伍、面板、额外 Buff、准备/流程和敌方配置？方案库里已保存的条目不会删除。',
      confirmText: '清空当前配置',
    },
    () => {
      loadedId.value = ''
      setLoadedSchemeId('')
      emit('clear-loaded')
      formMessage.value = '已清空当前页面配置'
    },
  )
}

// ============ 导出 / 导入 ============
function exportAll() {
  confirmThen(
    { title: '导出全部方案', message: '确认将当前方案库和自建招式导出为 JSON 文件？' },
    () => {
      const json = exportDamageCalcHistory()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `zzz-hp-schemes-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      formMessage.value = '已导出全部方案和自建招式'
    },
  )
}

function triggerImport() {
  confirmAlways(
    {
      title: '导入会清空本机存档',
      message:
        '将删除本机全部方案（含准备招式、流程）、全部自建招式，以及当前工作草稿，再用文件内容替换。主题、账号、管理端登录不受影响。请先点「导出全部」在本地存档。确定已存档并继续？',
      danger: true,
      confirmText: '已存档，继续',
    },
    () => {
      confirmThen(
        {
          title: '再次确认导入',
          message: '确定清空本机方案和自建招式，然后选择导入文件？',
          danger: true,
        },
        () => {
          fileInputRef.value?.click()
        },
      )
    },
  )
}

function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const json = String(reader.result)
    confirmAlways(
      {
        title: '用文件覆盖本机',
        message: `即将用「${file.name}」替换本机全部方案和自建招式。此操作无法撤销。`,
        danger: true,
        confirmText: '覆盖导入',
        highlight: file.name,
      },
      () => {
        const result = importDamageCalcHistory(json)
        if (result.errors.length) {
          formMessage.value = result.errors.join('；')
          return
        }
        const legacyHint = result.legacyPack
          ? '（旧文件不含自建招式，流程可能显示招式已删除）'
          : ''
        formMessage.value = `已覆盖导入 ${result.added} 个方案、${result.customSkillCount} 条自建招式${legacyHint}`
        emit('changed')
        emit('imported', result.loadedId)
      },
    )
  }
  reader.readAsText(file)
  input.value = ''
}

// ============ 过滤 / 排序 / 显示 ============
function statsOf(entry: DamageCalcHistoryEntry) {
  const s = schemeStats(entry)
  return `角色 ${s.charN} · 事件 ${s.skillN}`
}

function dirStats(path: string) {
  return `方案 ${countSchemesInFolder(path)} · 目录 ${countChildFolders(path)}`
}

// ============ 键盘 ============
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (pendingConfirm.value) {
    closeConfirm()
    return
  }
  if (modalOpen.value) closeModal()
}

watch(
  () => modalOpen.value,
  (isOpen) => {
    if (!pendingConfirm.value) {
      document.body.style.overflow = isOpen ? 'hidden' : ''
    }
  },
)

watch(pendingConfirm, (pending) => {
  if (pending) {
    document.body.style.overflow = 'hidden'
    return
  }
  document.body.style.overflow = modalOpen.value ? 'hidden' : ''
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  initLoaded()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})

defineExpose({
  openModal,
  closeModal,
  clearLoadedScheme,
  /** 打开方案库并带提示（例如：请先新建方案再保存事件）；层级高于事件弹窗 */
  openModalWithHint(hint: string) {
    modalOpen.value = true
    openedForEventSave.value = true
    formMessage.value = hint
    void nextTick(() => {
      const el = document.querySelector<HTMLInputElement>('.scheme-save-row .field-input')
      el?.focus()
      el?.scrollIntoView({ block: 'nearest' })
    })
  },
})
</script>

<template>
  <section id="damage-calc-history" class="history-section damage-anchor">
    <div
      class="history-trigger"
      role="button"
      tabindex="0"
      @click="openModal"
      @keydown.enter.prevent="openModal"
    >
      <header class="history-header">
        <div>
          <h2>方案库</h2>
          <p class="history-desc">保存当前队伍与面板配置为方案，支持目录分组、搜索、整理、导出 / 导入全部。导入会清空本机方案和自建招式。存储依赖浏览器 localStorage，已用 {{ storageUsage.text }}</p>
        </div>
        <span class="history-open-hint" aria-hidden="true">›</span>
      </header>
      <div class="history-summary-bar">
        <div class="history-summary-text">
          <span class="history-summary-main">
            <template v-if="loadedEntry()">
              当前方案：{{ loadedEntry()?.name }} @ {{ loadedEntry()?.folder ? loadedEntry()?.folder : '根目录' }}
            </template>
            <template v-else>共 {{ props.entries.length }} 个方案</template>
          </span>
          <span class="history-summary-hint">
            清空当前页面配置，不删除方案库中的条目
          </span>
          <span v-if="message" class="history-summary-status">{{ message }}</span>
        </div>
        <button
          type="button"
          class="loaded-clear"
          @click.stop="clearLoadedScheme"
        >
          清空当前配置
        </button>
      </div>
    </div>
  </section>

  <Teleport to="body">
    <div
      v-if="modalOpen"
      class="history-modal-overlay"
      role="presentation"
      @click.self="closeModal"
    >
      <div
        class="history-modal scheme-modal"
        :class="{ manage: manageMode }"
        role="dialog"
        aria-modal="true"
        aria-label="方案库"
      >
        <header class="history-modal-header">
          <div class="history-title-area">
            <h2>方案库</h2>
            <p v-show="storageWarn" class="history-warn">浏览器 localStorage 接近 5MB 上限，建议清理无用方案或「导出全部」备份于本地</p>
          </div>
          <button type="button" class="history-modal-close" aria-label="关闭" @click="closeModal">
            ×
          </button>
        </header>
        <p class="history-modal-desc">保存当前队伍与面板配置为方案，支持目录分组、搜索、整理、导出 / 导入全部。导入会清空本机方案和自建招式。存储依赖浏览器 localStorage，已用 {{ storageUsage.text }}</p>

        <!-- 顶部提示条：固定占位，消息出现/消失不抖动，始终可见 -->
        <div class="history-message-slot">
          <p v-show="formMessage || message" class="history-message">
            {{ formMessage || message }}
          </p>
        </div>

        <!-- 保存当前配置 -->
        <div class="scheme-save-row">
          <label class="field field-grow">
            <input
              v-model="draftName"
              type="text"
              class="field-input"
              placeholder="方案命名（如：朱鸢队满配测试）"
              @keyup.enter="saveCurrent"
            />
          </label>
          <button type="button" class="save-btn" @click="saveCurrent">保存当前配置</button>
          <label
            class="scheme-lock"
            :class="{ on: confirmEnabled }"
            :title="confirmEnabled ? '已开启：删除 / 加载 / 覆盖 / 导入 / 导出 等动作会二次确认。点此关闭则可直接执行' : '已关闭：删除 / 加载 / 覆盖 / 导入 / 导出 等动作将直接执行，无二次确认。点此开启更安全'"
          >
            <input type="checkbox" :checked="confirmEnabled" @change="toggleConfirmLock" />
            <span class="lock-track" aria-hidden="true"><span class="lock-knob"></span></span>
            <span class="lock-text">{{ confirmEnabled ? '二次确认·开' : '二次确认·关' }}</span>
          </label>
        </div>

        <!-- 工具栏 -->
        <div class="scheme-toolbar">
          <input
            :value="searchQuery"
            type="text"
            class="field-input scheme-search"
            placeholder="搜索方案名 / 目录名…"
            @input="onSearchInput"
          />
          <button type="button" class="save-btn scheme-export" @click="exportAll">导出全部</button>
          <button type="button" class="save-btn scheme-import" @click="triggerImport">导入全部</button>
          <button
            type="button"
            class="save-btn scheme-manage"
            :class="{ active: manageMode }"
            @click="toggleManage"
          >
            整理模式
          </button>
          <button type="button" class="save-btn scheme-mkdir" @click="startNewFolder">
            + 新建目录
          </button>
          <span v-if="newFolderMode" class="dir-new-wrap">
            <input
              v-model="newFolderName"
              type="text"
              class="field-input dir-new-input"
              maxlength="40"
              placeholder="新目录名…"
              @keyup.enter="commitNewFolder"
              @keyup.esc="cancelNewFolder"
            />
            <button type="button" class="save-btn dir-new-ok" @click="commitNewFolder">确定</button>
            <button type="button" class="save-btn dir-new-cancel" @click="cancelNewFolder">取消</button>
          </span>
          <input
            ref="fileInputRef"
            type="file"
            accept="application/json,.json"
            class="scheme-file-input"
            @change="onFilePicked"
          />
        </div>

        <!-- 整理模式批量栏 -->
        <div v-if="manageMode" class="scheme-batch">
          <span class="batch-count">已选 {{ selectedIds.length }} 项</span>
          <button type="button" class="batch-btn" @click="selectAllInFolder">全部选择</button>
          <button type="button" class="batch-btn batch-bdel" @click="batchDelete">删除</button>
          <button type="button" class="batch-btn batch-bcopy" @click="batchCopy">复制</button>
          <button type="button" class="batch-btn batch-bcut" @click="batchCut">剪切</button>
          <button
            type="button"
            class="batch-btn batch-bpaste"
            :disabled="!clipboard"
            @click="paste"
          >
            粘贴
          </button>
        </div>

        <!-- 路径面包屑 -->
        <nav class="scheme-breadcrumb" aria-label="方案库目录路径">
          <button
            type="button"
            class="bc-seg"
            :class="{ current: currentFolder === '' }"
            @click="currentFolder = ''"
          >
            根目录
          </button>
          <template v-for="seg in breadcrumbSegments" :key="seg.path">
            <span class="bc-sep">/</span>
            <button
              type="button"
              class="bc-seg"
              :class="{ current: currentFolder === seg.path }"
              @click="currentFolder = seg.path"
            >
              {{ seg.name }}
            </button>
          </template>
          <span class="bc-count">{{ subFolders.length + currentEntries.length }} 项</span>
        </nav>

        <!-- 当前方案指示 -->
        <div v-if="loadedId" class="scheme-loaded-indicator">
          <div class="scheme-loaded-main">
            当前方案：<b>{{ loadedEntry()?.name }}</b>
            <span class="loaded-folder">
              @ {{ loadedEntry()?.folder ? loadedEntry()?.folder : '根目录' }}
            </span>
            <button v-if="loadedEntry()" type="button" class="loaded-jump" @click="jumpToLoadedFolder">
              [跳转到目录]
            </button>
          </div>
            <button type="button" class="loaded-clear" @click="clearLoadedScheme">
              清空当前配置
            </button>
        </div>

        <!-- 卡片网格 -->
        <div class="scheme-grid-wrap">
          <div v-if="subFolders.length === 0 && currentEntries.length === 0" class="history-empty">
            {{ props.entries.length ? '此目录暂无方案。' : '暂无方案，填写命名后保存当前配置。' }}
          </div>

          <ul v-else class="scheme-list" role="list">
            <!-- 目录卡片 -->
            <li
              v-for="dir in subFolders"
              :key="dir"
              class="scheme-dir-card"
              :class="{ manage: manageMode }"
            >
              <div class="scheme-card-main">
                <label v-if="manageMode" class="scheme-check-wrap" @click.stop>
                  <input
                    type="checkbox"
                    class="scheme-check"
                    :checked="isSelected(dir)"
                    @change="toggleSelect(dir)"
                  />
                </label>
                <div class="scheme-meta dir-meta" @click="onDirMetaClick(dir)">
                  <div class="dir-head">
                    <span class="dir-icon">📁</span>
                    <input
                      v-if="renamingFolder === dir"
                      v-model="renamingFolderValue"
                      type="text"
                      class="field-input folder-rename-input"
                      maxlength="40"
                      @keyup.enter="commitRenameFolder"
                      @keyup.esc="renamingFolder = ''"
                      @blur="commitRenameFolder"
                    />
                    <div v-else class="dir-title">
                      <span class="dir-tag">目录</span>
                      <span class="scheme-name" :title="baseName(dir)">{{ baseName(dir) }}</span>
                    </div>
                  </div>
                  <div class="scheme-time placeholder-line">&nbsp;</div>
                  <span class="scheme-stats">{{ dirStats(dir) }}</span>
                </div>
              </div>
              <div v-if="manageMode" class="order-ctrls">
                <button type="button" class="order-btn" title="前移" @click="moveDirOrder(dir, -1)">▲</button>
                <button type="button" class="order-btn" title="后移" @click="moveDirOrder(dir, 1)">▼</button>
              </div>
              <div v-else class="scheme-actions">
                <button type="button" class="card-btn card-rename" @click="startRenameFolder(dir)">改名</button>
                <button type="button" class="card-btn card-del" @click="deleteFolderByName(dir)">删除</button>
              </div>
            </li>

            <!-- 方案卡片 -->
            <li
              v-for="entry in currentEntries"
              :key="entry.id"
              class="scheme-card"
              :class="{
                'scheme-loaded': entry.id === loadedId,
                manage: manageMode,
              }"
            >
              <div class="scheme-card-main">
                  <label v-if="manageMode" class="scheme-check-wrap" @click.stop>
                    <input
                      type="checkbox"
                      class="scheme-check"
                      :checked="isSelected(entry.id)"
                      @change="toggleSelect(entry.id)"
                    />
                  </label>
                  <div class="scheme-meta" @click="onSchemeMetaClick(entry)">
                    <div class="scheme-name-row">
                      <span v-if="entry.id === loadedId" class="scheme-cur-tag">当前</span>
                      <input
                        v-if="renamingSchemePath === entry.id"
                        v-model="renamingSchemeValue"
                        type="text"
                        class="field-input scheme-rename-input"
                        maxlength="40"
                        @keyup.enter="commitRenameScheme"
                        @keyup.esc="renamingSchemePath = ''"
                        @blur="commitRenameScheme"
                      />
                      <span v-else class="scheme-name" :title="entry.name">{{ entry.name }}</span>
                    </div>
                    <span class="scheme-time">{{ formatDamageCalcHistoryTime(entry.savedAt) }}</span>
                    <span class="scheme-stats">{{ statsOf(entry) }}</span>
                  </div>
                </div>
                <div v-if="manageMode" class="order-ctrls">
                  <button type="button" class="order-btn" title="前移" @click="moveOrder(entry.id, -1)">▲</button>
                  <button type="button" class="order-btn" title="后移" @click="moveOrder(entry.id, 1)">▼</button>
                </div>
                <div v-else class="scheme-actions">
                  <button type="button" class="card-btn card-save" title="用当前配置覆盖此方案" @click="overwriteEntry(entry.id)">保存</button>
                  <button type="button" class="card-btn card-load" @click="loadEntry(entry)">加载</button>
                  <button type="button" class="card-btn card-copy" @click="copyEntry(entry.id)">复制</button>
                  <button type="button" class="card-btn card-rename" @click="startRenameScheme(entry)">改名</button>
                  <button type="button" class="card-btn card-del" @click="deleteEntry(entry.id)">删除</button>
                </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 确认框独立 Teleport：外层「清空当前配置」时方案库未打开也能看见 -->
  <Teleport to="body">
    <div
      v-if="pendingConfirm"
      class="scheme-confirm-overlay"
      @click.self="closeConfirm"
    >
      <div class="scheme-confirm" :class="{ danger: pendingConfirm.danger }">
        <div v-if="pendingConfirm.title" class="scheme-confirm-title">{{ pendingConfirm.title }}</div>
        <p class="scheme-confirm-msg" v-html="confirmMessageHtml()"></p>
        <div class="scheme-confirm-btns">
          <button type="button" class="scheme-confirm-cancel" @click="closeConfirm">
            {{ pendingConfirm.cancelText || '取消' }}
          </button>
          <button
            type="button"
            class="scheme-confirm-ok"
            :class="{ danger: pendingConfirm.danger }"
            @click="runConfirm"
          >
            {{ pendingConfirm.confirmText || '确认' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.history-section {
  border: 1px solid #2a2d33;
  border-radius: 14px;
  background: #171a1f;
  padding: 0;
  overflow: hidden;
}

.history-trigger {
  width: 100%;
  display: block;
  border: none;
  background: transparent;
  color: inherit;
  padding: 1rem;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.2s;
}

.history-trigger:hover {
  background: rgba(201, 165, 92, 0.06);
}

.history-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.history-header h2 {
  margin: 0;
  font-size: 1.05rem;
  color: #f0f2f6;
}

.history-desc {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: #9aa3b0;
}

.history-open-hint {
  flex: 0 0 auto;
  font-size: 1.2rem;
  color: #8f96a3;
  line-height: 1;
  margin-top: 0.15rem;
}

/* 与伤害事件 mode-summary-bar 同结构：一条底框，左文案、右操作钮 */
.history-summary-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 0.65rem;
  padding: 0.55rem 0.75rem;
  border: 1px solid #2d323a;
  border-radius: 10px;
  background: #0f1217;
}

.history-summary-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.history-summary-main {
  font-size: 0.8rem;
  color: #b7c0cd;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-summary-hint,
.history-summary-status {
  font-size: 0.72rem;
  color: #8f96a3;
  line-height: 1.35;
}

.history-summary-status {
  color: #9aa3b0;
}

.history-modal-overlay {
  position: fixed;
  inset: 0;
  /* 高于伤害事件弹窗（1200），避免从事件流打开方案库时被挡住 */
  z-index: 1400;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(3px);
}

.history-modal {
  position: relative;
  width: min(1080px, 100%);
  height: min(86vh, 820px);
  display: flex;
  flex-direction: column;
  border: 1px solid #2a2d33;
  border-radius: 14px;
  background: #171a1f;
  padding: 1rem;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}


/* 顶页固定：头部 / 保存行 / 工具栏 / 当前方案 / 批量栏 / 面包屑
   一律不收缩，始终占自然高度，避免内容增减时互相挤压导致弹窗抖动 */
.history-modal-header,
.scheme-save-row,
.scheme-toolbar,
.scheme-batch,
.scheme-breadcrumb,
.scheme-loaded-indicator {
  flex: 0 0 auto;
}

.history-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.45rem;
}

.history-modal-header h2 {
  margin: 0;
  font-size: 1.05rem;
  color: #f0f2f6;
}

.history-modal-desc {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: #9aa3b0;
}

.history-modal-close {
  flex: 0 0 auto;
  width: 2rem;
  height: 2rem;
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #d5dae4;
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
}

.history-modal-close:hover {
  border-color: #c9a55c;
}

.scheme-save-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  align-items: flex-end;
}

.field {
  display: flex;
  flex: 1 1 200px;
  flex-direction: column;
  gap: 0.25rem;
}

.field-grow {
  flex: 1 1 260px;
}

.field-label {
  font-size: 0.76rem;
  color: #aab2bf;
}

.field-input {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #ebedf0;
  padding: 0.44rem 0.54rem;
  font-size: 0.84rem;
}

.save-btn {
  border: 1px solid #3a4a31;
  border-radius: 8px;
  background: #1a2218;
  color: #d8e8c8;
  padding: 0.48rem 0.9rem;
  font-size: 0.84rem;
  cursor: pointer;
  white-space: nowrap;
}

.save-btn:hover {
  border-color: #c9a55c;
  background: #222818;
}

.save-btn.active {
  border-color: #c9a55c;
  background: #2c2410;
  color: #f0d7a2;
}

.scheme-lock {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: #b7c0cd;
  cursor: pointer;
  user-select: none;
}

.scheme-lock input {
  display: none;
}

/* 滑动开关：关=灰、开=绿（已上锁保护） */
.lock-track {
  position: relative;
  flex: 0 0 auto;
  width: 2.4rem;
  height: 1.25rem;
  border-radius: 999px;
  background: #3a3f47;
  transition: background-color 0.15s;
}

.lock-knob {
  position: absolute;
  top: 0.15rem;
  left: 0.15rem;
  width: 0.95rem;
  height: 0.95rem;
  border-radius: 50%;
  background: #d5dae4;
  transition: transform 0.15s, background-color 0.15s;
}

.scheme-lock.on .lock-track {
  background: #2f7d4f;
}

.scheme-lock.on .lock-knob {
  transform: translateX(1.15rem);
  background: #eafff1;
}

.lock-text {
  font-size: 0.8rem;
  color: #8f96a3;
}

.scheme-lock.on .lock-text {
  color: #8fe0a8;
}

/* 顶部提示条：固定占位，无论有无消息都占同一高度，避免抖动 */
.history-message-slot {
  flex: 0 0 auto;
  min-height: 1.8rem;
  display: flex;
  align-items: center;
}

.history-message {
  margin: 0;
  max-width: 100%;
  font-size: 0.78rem;
  color: #9aa3b0;
  line-height: 1.35rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-title-area {
  display: flex;
  align-items: center;
  gap: 1rem;
  min-width: 0;
  flex: 1 1 auto;
}

.history-warn {
  margin: 0;
  margin-left: auto;
  flex: 0 1 auto;
  min-width: 0;
  font-size: 0.75rem;
  line-height: 1.2rem;
  color: #e85656;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.scheme-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-top: 0.6rem;
}

.scheme-search {
  flex: 1 1 200px;
}

.scheme-export,
.scheme-import,
.scheme-manage,
.scheme-mkdir {
  flex: 0 0 auto;
}

.scheme-file-input {
  display: none;
}

.scheme-batch {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-top: 0.55rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid #2d323a;
  border-radius: 10px;
  background: #0f1217;
}

.batch-count {
  font-size: 0.78rem;
  color: #b7c0cd;
}

.batch-btn {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #161a20;
  color: #d5dae4;
  padding: 0.36rem 0.7rem;
  font-size: 0.8rem;
  cursor: pointer;
}

.batch-btn:hover:not(:disabled) {
  border-color: #c9a55c;
}

.batch-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.batch-bdel {
  border-color: #5a3030;
  color: #e0a0a0;
}

.batch-bcopy,
.batch-bcut {
  border-color: #30485a;
  color: #a0c8e0;
}

.scheme-breadcrumb {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.55rem;
  font-size: 0.85rem;
  flex-wrap: wrap;
}

.bc-seg {
  border: none;
  background: transparent;
  color: #6b8fd4;
  cursor: pointer;
  padding: 0.15rem 0.25rem;
  font-size: inherit;
  border-radius: 4px;
}

.bc-seg:hover {
  color: #8fabdf;
  background: rgba(107, 143, 212, 0.1);
}

.bc-seg.current {
  color: #f0d7a2;
  cursor: default;
}

.bc-sep {
  color: #6b7685;
  padding: 0 0.1rem;
}

.bc-count {
  margin-left: auto;
  font-size: 0.78rem;
  color: #8f96a3;
}

.scheme-loaded-indicator {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin: 0.55rem 0 0;
  font-size: 0.8rem;
  color: #9fd6a0;
}

.scheme-loaded-main {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scheme-loaded-indicator .loaded-folder {
  color: #8f96a3;
}

.loaded-jump {
  margin-left: 0.4rem;
  color: #6b8fd4;
  cursor: pointer;
  text-decoration: underline;
  background: transparent;
  border: none;
  font-size: inherit;
  padding: 0;
}

.loaded-jump:hover {
  color: #8fabdf;
}

.loaded-clear {
  flex-shrink: 0;
  margin-left: 0;
  border: 1px solid #343a44;
  border-radius: 8px;
  background: #12161d;
  color: #d5dae4;
  font-family: inherit;
  font-size: 0.8rem;
  padding: 0.35rem 0.75rem;
  cursor: pointer;
  white-space: nowrap;
  line-height: 1.2;
}

.history-summary-bar .loaded-clear {
  /* 嵌在摘要条内时与 mode-summary-hint 一致，避免另起一层白底造成色差 */
  background: #12161d;
}

.loaded-clear:hover {
  border-color: #c9a55c;
  color: #f0d7a2;
}

.scheme-grid-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  margin-top: 0.55rem;
  flex: 1 1 0;
  min-height: 0;
}

.history-empty {
  margin: 0.75rem 0 0;
  font-size: 0.8rem;
  color: #7a828f;
  text-align: center;
  padding: 1.5rem 1rem;
}

.scheme-list {
  margin: 0;
  padding: 0 0.25rem 0 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.55rem;
  overflow: auto;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
  flex: 1;
  min-height: 0;
  align-content: start;
}

.scheme-card,
.scheme-dir-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  border: 1px solid #2d323a;
  border-radius: 10px;
  background: #0f1217;
  padding: 0.55rem 0.65rem;
  /* 不写 min-height：卡片按内容自然撑高，等高交给网格 align-items:stretch 自动处理；
     目录卡与方案卡结构一致（placeholder-line 对齐行数），无需分两套格式，缩放也不溢出 */
}

/* 目录卡：淡黄四边边框 + 淡黄底色，与方案卡一眼区分且不突兀 */
.scheme-dir-card {
  border: 1px solid rgba(201, 165, 92, 0.65);
  background: rgba(201, 165, 92, 0.12);
}

.scheme-card:hover,
.scheme-dir-card:hover {
  border-color: #c9a55c;
}

/* 目录卡 hover 用蓝色调，而非方案卡的金色，保持类型可辨 */
.scheme-dir-card:hover {
  border-color: #6b8fd4;
}

.scheme-card.scheme-loaded {
  border-color: #4caf72;
  box-shadow: 0 0 0 1px #4caf72 inset;
  background: rgba(76, 175, 114, 0.08);
}

.scheme-card.manage,
.scheme-dir-card.manage {
  flex-direction: row;
  align-items: center;
  gap: 10px;
}

.scheme-card.manage > .scheme-card-main,
.scheme-dir-card.manage > .scheme-card-main {
  flex: 1 1 auto;
  min-width: 0;
}

.scheme-card-main {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  min-width: 0;
  /* 不再 flex:1：避免与卡片 min-height 在缩放时错位导致按钮溢出；等高由网格 stretch + 按钮 margin-top:auto 兜底 */
}

.scheme-check-wrap {
  flex: 0 0 auto;
  padding-top: 0.1rem;
}

.scheme-check {
  width: 1rem;
  height: 1rem;
  cursor: pointer;
  accent-color: #c9a55c;
  margin: 0;
}

.scheme-meta {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
  cursor: pointer;
}

.scheme-name-row {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
}

.scheme-cur-tag {
  display: inline-block;
  flex: 0 0 auto;
  font-size: 0.7rem;
  font-weight: 700;
  color: #fff;
  background: #4caf72;
  border-radius: 4px;
  padding: 0.1rem 0.4rem;
}

.scheme-name {
  font-size: 0.92rem;
  font-weight: 600;
  color: #f0f2f6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.scheme-card.scheme-loaded .scheme-name {
  color: #a8e6bf;
}

.scheme-time {
  font-size: 0.76rem;
  color: #8f96a3;
}

.scheme-stats {
  font-size: 0.76rem;
  color: #8f96a3;
}

/* 目录卡占位行：与方案卡的时间行同高，保证目录卡初始行数/高度一致 */
.placeholder-line {
  visibility: hidden;
  pointer-events: none;
  user-select: none;
}

.dir-icon {
  font-size: 1rem;
  flex: 0 0 auto;
  line-height: 1;
}

.dir-head {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
}

.dir-title {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
}

.dir-tag {
  flex: 0 0 auto;
  font-size: 0.68rem;
  font-weight: 700;
  color: #9fc4ee;
  background: #1c3550;
  border: 1px solid #2f5378;
  border-radius: 4px;
  padding: 0.05rem 0.4rem;
  letter-spacing: 0.02rem;
}

.dir-meta {
  cursor: pointer;
}

.scheme-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  flex-shrink: 0; /* 关键：按钮区永不压缩/溢出卡片边界（zzz-dev 同款写法） */
  margin-top: auto; /* 卡片被网格拉伸时按钮沉底，避免悬空 */
}

.card-btn {
  border: 1px solid #2d323a;
  border-radius: 6px;
  background: #161a20;
  color: #d5dae4;
  padding: 0.28rem 0.55rem;
  font-size: 0.76rem;
  cursor: pointer;
}

.card-btn:hover {
  border-color: #c9a55c;
}

.card-save {
  border-color: #3a4a31;
  background: #1a2218;
  color: #d8e8c8;
}

.card-load {
  border-color: #3a4a31;
  background: #1a2218;
  color: #d8e8c8;
}

.card-copy,
.card-rename {
  border-color: #30485a;
  color: #a0c8e0;
}

.card-del {
  border-color: #5a3030;
  color: #e0a0a0;
}

.order-ctrls {
  display: inline-flex;
  flex-direction: column;
  gap: 0.25rem;
  flex-shrink: 0;
  margin-left: auto; /* 整理模式：排序按钮顶到卡片右侧（对齐 zzz-dev） */
}

.order-btn {
  width: 1.6rem;
  height: 1.25rem;
  line-height: 1;
  border: 1px solid #3a4a31;
  border-radius: 5px;
  background: #161a20;
  color: #d8e8c8;
  font-size: 0.7rem;
  cursor: pointer;
  text-align: center;
  padding: 0;
}

.order-btn:hover {
  border-color: #c9a55c;
}

.scheme-rename-input,
.folder-rename-input {
  width: 100%;
  min-width: 0;
  font-size: 0.84rem;
  padding: 0.25rem 0.45rem;
}

.dir-new-wrap {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.dir-new-input {
  width: 10rem;
}

.dir-new-ok,
.dir-new-cancel {
  padding: 0.4rem 0.7rem;
  font-size: 0.8rem;
}

@media (max-width: 720px) {
  .scheme-list {
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  }
}

@media (max-width: 480px) {
  .scheme-list {
    grid-template-columns: 1fr;
  }
}
</style>

<!-- 确认框 Teleport 到 body，样式必须非 scoped，否则方案库关闭时可能看不见 -->
<style>
.scheme-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 1500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
}

.scheme-confirm {
  width: min(420px, 100%);
  max-height: 100%;
  border: 1px solid #2d323a;
  border-radius: 12px;
  background: linear-gradient(180deg, #1b1f25 0%, #13161b 100%);
  padding: 1rem;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
}

.scheme-confirm.danger {
  border-color: #5a3030;
}

.scheme-confirm-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #f0f2f6;
  margin-bottom: 0.5rem;
}

.scheme-confirm-msg {
  margin: 0 0 1rem;
  font-size: 0.84rem;
  line-height: 1.55;
  color: #d5dae4;
  word-break: break-word;
}

.scheme-confirm-hl {
  color: #e0a0a0;
  font-weight: 600;
}

.scheme-confirm-btns {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.scheme-confirm-cancel {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #161a20;
  color: #d5dae4;
  padding: 0.45rem 0.85rem;
  font-size: 0.84rem;
  cursor: pointer;
}

.scheme-confirm-cancel:hover {
  border-color: #c9a55c;
}

.scheme-confirm-ok {
  border: 1px solid #3a4a31;
  border-radius: 8px;
  background: #1a2218;
  color: #d8e8c8;
  padding: 0.45rem 0.85rem;
  font-size: 0.84rem;
  cursor: pointer;
}

.scheme-confirm-ok:hover {
  border-color: #c9a55c;
  background: #222818;
}

.scheme-confirm-ok.danger {
  border-color: #5a3030;
  background: #2a1616;
  color: #e8b4b4;
}

.scheme-confirm-ok.danger:hover {
  border-color: #d88a8a;
  background: #341a1a;
}
</style>
