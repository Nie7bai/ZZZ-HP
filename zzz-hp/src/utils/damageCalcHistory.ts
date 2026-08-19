import type { AgentBuffDoc } from '@/types/calculator'
import { loadCustomSkills, parseCustomSkillList, replaceCustomSkills } from '@/utils/skillLibrary'
import type {
  DamageCalcHistoryEntry,
  DamageCalcHistoryExport,
  DamageCalcHistoryImportResult,
  DamageCalcWorkingDraft,
  SchemeFolderMeta,
  SchemeStore,
} from '@/types/damageCalcHistory'
import { SCHEME_STORE_VERSION } from '@/types/damageCalcHistory'

const STORAGE_KEY = 'zzz-hp-damage-calc-history'
const LOADED_KEY = 'zzz-hp-scheme-loaded'
const DRAFT_KEY = 'zzz-hp-damage-calc-draft'

// ===================== 路径规范工具（对齐 zzz-dev） =====================
// 路径以 "/" 开头，多级用 "/" 分隔，末尾无 "/"。根目录 folder = ""。

function normFolder(f: string): string {
  if (!f) return ''
  f = String(f).replace(/\\/g, '/')
  if (f === '/' || f === '') return ''
  if (f[0] !== '/') f = '/' + f
  return f.replace(/\/+$/, '')
}

function schemePath(folder: string, name: string): string {
  folder = normFolder(folder)
  name = (name || '').trim()
  if (folder === '') return '/' + name
  return folder + '/' + name
}

const SCHEME_KEY_PREFIX = 's:'
/** 方案的存储 key：前缀 + 路径，与目录路径命名空间解耦，允许「目录与方案同名」 */
function schemeKey(folder: string, name: string): string {
  return SCHEME_KEY_PREFIX + schemePath(folder, name)
}

/** 把带前缀的 scheme key 还原为路径（兼容多层 s: 前缀污染，用于导入/旧数据迁移） */
function schemeKeyToPath(key: string): string {
  let p = key || ''
  while (p.startsWith(SCHEME_KEY_PREFIX)) p = p.slice(SCHEME_KEY_PREFIX.length)
  // 清掉路径中因历史污染残留的 s: 段（如 /s:/父/名 -> /父/名）
  p = p.replace(/\/?s:\/?/g, '/')
  return p
}

function parentFolder(path: string): string {
  path = String(path || '')
  const i = path.lastIndexOf('/')
  if (i <= 0) return ''
  return path.slice(0, i)
}

function baseName(path: string): string {
  path = String(path || '')
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

/** 返回 folder 下的直接子目录路径列表（合并显式 dirs + 方案 folder 隐含的目录） */
function childFolders(store: SchemeStore, folder: string): string[] {
  const set = new Set<string>()
  const prefix = folder === '' ? '/' : folder + '/'
  for (const d of Object.keys(store.dirs)) {
    if (d.indexOf(prefix) === 0) {
      const rest = d.slice(prefix.length)
      const seg = rest.split('/')[0]
      if (seg) set.add(folder === '' ? '/' + seg : folder + '/' + seg)
    }
  }
  for (const p of Object.keys(store.schemes)) {
    const f = store.schemes[p]?.folder || ''
    if (!f || f === folder) continue
    if (f.indexOf(prefix) === 0) {
      const rest = f.slice(prefix.length)
      const seg = rest.split('/')[0]
      if (seg) set.add(folder === '' ? '/' + seg : folder + '/' + seg)
    }
  }
  return Array.from(set)
}

/** 判断路径是目录还是方案 */
export function pathType(path: string): 'dir' | 'scheme' | 'unknown'
export function pathType(store: SchemeStore, path: string): 'dir' | 'scheme' | 'unknown'
export function pathType(
  storeOrPath: SchemeStore | string,
  maybePath?: string,
): 'dir' | 'scheme' | 'unknown' {
  const store = typeof storeOrPath === 'string' ? readStore() : storeOrPath
  const path = typeof storeOrPath === 'string' ? storeOrPath : maybePath!
  if (store.dirs[path]) return 'dir'
  if (store.schemes[path]) return 'scheme'
  return 'unknown'
}

/**
 * 检测 folder 下 name 是否与已有项重名。
 * 目录与方案现已解耦（方案 key 带 s: 前缀），可「目录与方案同名」。
 * 因此默认仍按 type 区分：type='dir' 只查目录冲突，type='scheme' 只查方案冲突；
 * 不传 type 则两者都查（向后兼容）。
 * 返回 'dir' | 'scheme' 表示冲突类型，null 表示无冲突。
 */
export function nameConflictType(
  folder: string,
  name: string,
  type?: 'dir' | 'scheme',
): 'dir' | 'scheme' | null {
  const trimmed = (name || '').trim()
  if (!trimmed || trimmed.includes('/')) return null
  const store = readStore()
  const sp = schemePath(normFolder(folder), trimmed)
  if (type !== 'scheme' && store.dirs[sp]) return 'dir'
  if (type !== 'dir' && store.schemes[schemeKey(normFolder(folder), trimmed)]) return 'scheme'
  return null
}

export { normFolder, schemePath, parentFolder, baseName, childFolders }

/** 读取原始 store（组件做批量/树操作时需要） */
export function readRawStore(): SchemeStore {
  return readStore()
}

function dirOrder(store: SchemeStore, d: string): number {
  return store.dirs[d]?.order ?? 0
}

function schemeOrder(store: SchemeStore, p: string): number {
  return store.schemes[p]?.order ?? 0
}

/** 把新建/产出的项排到同级最前，并重排同级为连续 0..n-1 */
function assignOrderFront(
  store: SchemeStore,
  type: 'dir' | 'scheme',
  folder: string,
  newPath: string,
) {
  let sibs: string[]
  if (type === 'dir') {
    sibs = childFolders(store, folder).sort((a, b) => dirOrder(store, a) - dirOrder(store, b))
    sibs = sibs.filter((d) => d !== newPath)
    sibs.unshift(newPath)
    sibs.forEach((d, i) => {
      if (!store.dirs[d]) store.dirs[d] = { createdAt: Date.now(), order: i }
      store.dirs[d].order = i
    })
  } else {
    sibs = Object.keys(store.schemes)
      .filter((p) => (store.schemes[p]?.folder || '') === folder)
      .sort((a, b) => schemeOrder(store, a) - schemeOrder(store, b))
    sibs = sibs.filter((p) => p !== newPath)
    sibs.unshift(newPath)
    sibs.forEach((p, i) => {
      if (store.schemes[p]) store.schemes[p].order = i
    })
  }
}

/** 为缺失 order 的目录/方案补连续序号 */
function ensureOrders(store: SchemeStore): boolean {
  let changed = false
  const dirsByFolder: Record<string, string[]> = {}
  for (const d of Object.keys(store.dirs)) {
    const par = parentFolder(d)
    ;(dirsByFolder[par] = dirsByFolder[par] || []).push(d)
  }
  for (const f of Object.keys(dirsByFolder)) {
    const dirSiblings = dirsByFolder[f]!
    dirSiblings
      .sort((a, b) => {
        const oa = dirOrder(store, a)
        const ob = dirOrder(store, b)
        if (oa !== ob) return oa - ob
        return a.localeCompare(b, 'zh-CN')
      })
      .forEach((d, i) => {
        if (typeof store.dirs[d]?.order !== 'number') {
          if (!store.dirs[d]) store.dirs[d] = { createdAt: Date.now(), order: 0 }
          store.dirs[d]!.order = i
          changed = true
        }
      })
  }
  const schByFolder: Record<string, string[]> = {}
  for (const p of Object.keys(store.schemes)) {
    const f = store.schemes[p]!.folder || ''
    ;(schByFolder[f] = schByFolder[f] || []).push(p)
  }
  for (const f of Object.keys(schByFolder)) {
    const schSiblings = schByFolder[f]!
    schSiblings
      .sort((a, b) => {
        const oa = schemeOrder(store, a)
        const ob = schemeOrder(store, b)
        if (oa !== ob) return oa - ob
        const ta = store.schemes[a]!.savedAt ?? 0
        const tb = store.schemes[b]!.savedAt ?? 0
        if (ta !== tb) return tb - ta
        return (store.schemes[a]!.name || a).localeCompare(
          store.schemes[b]!.name || b,
          'zh-CN',
        )
      })
      .forEach((p, i) => {
        if (typeof store.schemes[p]?.order !== 'number') {
          store.schemes[p]!.order = i
          changed = true
        }
      })
  }
  return changed
}

// ===================== 底层读写 / 迁移 =====================

function createEmptyStore(): SchemeStore {
  return { version: SCHEME_STORE_VERSION, dirs: {}, schemes: {} }
}

/**
 * v2 → v3：招式库 / 准备阶段 / 流程 改造。
 *
 * 3.1.6.4 的「事件跟随方案」未上线，其 `directEvents` / `anomalyEvents` 与随之而来的
 * 全局事件复制迁移（migrateLegacyGlobalEvents）一并废弃：前者直接清除，后者已删除。
 *
 * 旧的全局自定义事件模式库不在这里处理——它转成**全局自定义招式库**，
 * 与方案无关，见 `migrateLegacyModesToSkills`。
 */
function migrateStoreToV3(store: SchemeStore): void {
  if (store.version >= SCHEME_STORE_VERSION) return
  for (const entry of Object.values(store.schemes)) {
    if (!entry) continue
    delete entry.directEvents
    delete entry.anomalyEvents
  }
  delete (store as unknown as Record<string, unknown>).customEventsMigrated
  store.version = SCHEME_STORE_VERSION
}

function isValidEntry(item: unknown): item is DamageCalcHistoryEntry {
  if (!item || typeof item !== 'object') return false
  const c = item as Record<string, unknown>
  return (
    typeof c.id === 'string' &&
    typeof c.name === 'string' &&
    typeof c.savedAt === 'number' &&
    Array.isArray(c.teamSlots) &&
    !!c.panelState &&
    typeof c.panelState === 'object'
  )
}

function migrateFromLegacyArray(list: unknown[]): SchemeStore {
  const store = createEmptyStore()
  for (const raw of list) {
    if (!isValidEntry(raw)) continue
    const folder = normFolder(raw.folder || '')
    const name = (raw.name || '').trim() || baseName(raw.id)
    if (!name) continue
    // 同路径去重：自动加后缀
    let key = schemeKey(folder, name)
    let cand = name
    let i = 2
    while (store.schemes[key]) {
      cand = name + '-' + i
      key = schemeKey(folder, cand)
      i++
    }
    const entry: DamageCalcHistoryEntry = {
      ...raw,
      id: key,
      name: cand,
      folder,
      order: 0,
    }
    store.schemes[key] = entry
  }
  ensureOrders(store)
  return store
}

function readStore(): SchemeStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createEmptyStore()
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      const store = migrateFromLegacyArray(parsed)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
      } catch {
        /* ignore */
      }
      return store
    }
    if (!parsed || typeof parsed !== 'object') return createEmptyStore()
    const o = parsed as Partial<SchemeStore>
    const store: SchemeStore = {
      version: Number(o.version) || 2,
      dirs: (o.dirs as Record<string, SchemeFolderMeta>) || {},
      schemes: (o.schemes as Record<string, DamageCalcHistoryEntry>) || {},
    }
    // 迁移 + 清理：
    // 1) 任意 key（未前缀 / 多层 s: 前缀污染）统一还原为正确 schemeKey
    // 2) 修复历史上把 s: 前缀误当目录路径导致的 folder=「/s:/...」脏数据
    for (const key of Object.keys(store.schemes)) {
      const entry = store.schemes[key]!
      // 还原路径（schemeKeyToPath 内部已处理多层 s: 前缀污染）
      const realPath = schemeKeyToPath(key)
      const folderContaminated = /^\/?s:($|\/)/.test(entry.folder || '')
      const folder = normFolder(folderContaminated ? parentFolder(realPath) : (entry.folder || parentFolder(realPath)))
      const name = entry.name || baseName(realPath)
      const correctKey = schemeKey(folder, name)
      if (correctKey !== key) {
        if (!store.schemes[correctKey]) {
          entry.folder = folder
          entry.name = name
          entry.id = correctKey
          store.schemes[correctKey] = entry
        }
        delete store.schemes[key]
      }
    }
    // 当前高亮方案 id 同步到新 key（兼容多层 s: 前缀污染）
    const loaded = getLoadedSchemeId()
    if (loaded && !store.schemes[loaded]) {
      const loadedPath = schemeKeyToPath(loaded)
      const alt = schemeKey(parentFolder(loadedPath), baseName(loadedPath))
      if (store.schemes[alt]) setLoadedSchemeId(alt)
    }
    ensureOrders(store)
    migrateStoreToV3(store)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    } catch {
      /* ignore */
    }
    return store
  } catch {
    return createEmptyStore()
  }
}

function writeStore(store: SchemeStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* ignore quota errors */
  }
}

// ===================== 方案条目 =====================

/** 当前目录下的方案列表（按 order 升序，与 dev 一致：order 小在前） */
export function listDamageCalcHistory(folder = ''): DamageCalcHistoryEntry[] {
  const f = normFolder(folder)
  const store = readStore()
  return Object.keys(store.schemes)
    .filter((p) => (store.schemes[p]?.folder || '') === f)
    .sort((a, b) => schemeOrder(store, a) - schemeOrder(store, b))
    .map((p) => store.schemes[p]!)
}

/** 全部方案（给父组件总览用） */
export function listAllDamageCalcHistory(): DamageCalcHistoryEntry[] {
  const store = readStore()
  return Object.values(store.schemes).sort(
    (a, b) => (a.order ?? a.savedAt) - (b.order ?? b.savedAt),
  )
}

/** 把 entry 写入 store；entry.id / folder / name 会被规范化为路径 */
export function saveDamageCalcHistory(entry: DamageCalcHistoryEntry): DamageCalcHistoryEntry[] {
  const store = readStore()
  const folder = normFolder(entry.folder || '')
  const name = (entry.name || '').trim()
  if (!name) return listAllDamageCalcHistory()
  const key = schemeKey(folder, name)
  const normalized: DamageCalcHistoryEntry = {
    ...entry,
    id: key,
    folder,
    name,
    order: entry.order ?? 0,
  }
  store.schemes[key] = normalized
  assignOrderFront(store, 'scheme', folder, key)
  writeStore(store)
  return listAllDamageCalcHistory()
}

export function removeDamageCalcHistory(path: string): DamageCalcHistoryEntry[] {
  const store = readStore()
  delete store.schemes[path]
  writeStore(store)
  return listAllDamageCalcHistory()
}

export function createHistoryEntryId(): string {
  return `damage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 目录内无冲突命名（仅与同目录下的「方案」去重；目录与方案可同名） */
function dedupBase(store: SchemeStore, folder: string, desired: string, suffix = '复制'): string {
  const f = normFolder(folder)
  const candidates = new Set<string>()
  for (const p of Object.keys(store.schemes)) {
    if ((store.schemes[p]?.folder || '') === f) candidates.add(baseName(p))
  }
  if (!candidates.has(desired)) return desired
  let i = 2
  let cand = desired + '-' + suffix
  while (candidates.has(cand)) {
    cand = desired + '-' + suffix + i
    i++
  }
  return cand
}

export function copyScheme(path: string): DamageCalcHistoryEntry[] {
  const store = readStore()
  const src = store.schemes[path]
  if (!src) return listAllDamageCalcHistory()
  const folder = src.folder || ''
  const newName = dedupBase(store, folder, src.name)
  const newKey = schemeKey(folder, newName)
  const copy: DamageCalcHistoryEntry = JSON.parse(JSON.stringify(src))
  copy.id = newKey
  copy.folder = folder
  copy.name = newName
  copy.savedAt = Date.now()
  copy.order = 0
  store.schemes[newKey] = copy
  assignOrderFront(store, 'scheme', folder, newKey)
  writeStore(store)
  return listAllDamageCalcHistory()
}

/** 把方案复制到 targetFolder（整理模式粘贴用） */
export function duplicateSchemeToFolder(path: string, targetFolder: string): DamageCalcHistoryEntry[] {
  const store = readStore()
  const src = store.schemes[path]
  if (!src) return listAllDamageCalcHistory()
  const folder = normFolder(targetFolder)
  const newName = dedupBase(store, folder, src.name)
  const newKey = schemeKey(folder, newName)
  const copy: DamageCalcHistoryEntry = JSON.parse(JSON.stringify(src))
  copy.id = newKey
  copy.folder = folder
  copy.name = newName
  copy.savedAt = Date.now()
  copy.order = 0
  store.schemes[newKey] = copy
  assignOrderFront(store, 'scheme', folder, newKey)
  writeStore(store)
  return listAllDamageCalcHistory()
}

export function renameScheme(path: string, name: string, folder?: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  const store = readStore()
  if (!store.schemes[path]) return false
  const src = store.schemes[path]!
  const targetFolder = folder !== undefined ? normFolder(folder) : src.folder || ''
  const newKey = schemeKey(targetFolder, trimmed)
  if (newKey !== path && store.schemes[newKey]) return false
  const entry: DamageCalcHistoryEntry = { ...src, id: newKey, name: trimmed, folder: targetFolder }
  delete store.schemes[path]
  store.schemes[newKey] = entry
  assignOrderFront(store, 'scheme', targetFolder, newKey)
  writeStore(store)
  return true
}

export function moveScheme(path: string, targetFolder: string): DamageCalcHistoryEntry[] {
  const store = readStore()
  const src = store.schemes[path]
  if (!src) return listAllDamageCalcHistory()
  const folder = normFolder(targetFolder)
  if ((src.folder || '') === folder) return listAllDamageCalcHistory()
  const newName = dedupBase(store, folder, src.name, '移动')
  const newKey = schemeKey(folder, newName)
  const entry: DamageCalcHistoryEntry = { ...src, id: newKey, folder, name: newName }
  delete store.schemes[path]
  store.schemes[newKey] = entry
  assignOrderFront(store, 'scheme', folder, newKey)
  writeStore(store)
  return listAllDamageCalcHistory()
}

/**
 * 前后移动：dir=-1 向前（列表中往上，order 变小更靠前）；dir=1 向后。
 * siblings 按 order 升序排列，索引越小越靠前。
 */
export function reorderScheme(path: string, dir: -1 | 1): DamageCalcHistoryEntry[] {
  const store = readStore()
  const target = store.schemes[path]
  if (!target) return listAllDamageCalcHistory()
  const folder = target.folder || ''
  const siblings = Object.keys(store.schemes)
    .filter((p) => (store.schemes[p]?.folder || '') === folder)
    .sort((a, b) => schemeOrder(store, a) - schemeOrder(store, b))
  const i = siblings.indexOf(path)
  const j = i + dir
  if (i < 0 || j < 0 || j >= siblings.length) return listAllDamageCalcHistory()
  const a = store.schemes[siblings[i]!]!
  const b = store.schemes[siblings[j]!]!
  const oa = a.order
  const ob = b.order
  a.order = ob
  b.order = oa
  writeStore(store)
  return listAllDamageCalcHistory()
}

/** 前后移动目录：dir=-1 向前，dir=1 向后 */
export function reorderFolder(path: string, dir: -1 | 1): DamageCalcHistoryEntry[] {
  const store = readStore()
  const folder = parentFolder(path)
  // 同级目录可能包含“仅由方案 folder 隐式生成”的目录（store.dirs 里没有记录）。
  // 先把所有同级目录（显式 + 隐式）都补齐/重排为连续 order，否则隐式目录无法排序，
  // 且交换会落到 undefined 上抛错。补记录后排序语义与显式目录完全一致。
  const siblings = childFolders(store, folder).sort((a, b) => dirOrder(store, a) - dirOrder(store, b))
  siblings.forEach((d, i) => {
    if (!store.dirs[d]) store.dirs[d] = { createdAt: Date.now(), order: i }
    else store.dirs[d]!.order = i
  })
  const i = siblings.indexOf(path)
  const j = i + dir
  if (i < 0 || j < 0 || j >= siblings.length) return listAllDamageCalcHistory()
  const a = store.dirs[siblings[i]!]!
  const b = store.dirs[siblings[j]!]!
  const oa = a.order
  a.order = b.order
  b.order = oa
  writeStore(store)
  return listAllDamageCalcHistory()
}

export function batchDeleteSchemes(paths: string[]): DamageCalcHistoryEntry[] {
  const store = readStore()
  for (const p of paths) {
    const type = pathType(store, p)
    if (type === 'scheme') delete store.schemes[p]
    else if (type === 'dir') deleteFolderInternal(store, p)
  }
  writeStore(store)
  return listAllDamageCalcHistory()
}

// ===================== 目录树（支持嵌套） =====================

/** 当前 folder 下的直接子目录路径列表（按 order 升序） */
export function listFolders(folder = ''): string[] {
  const f = normFolder(folder)
  const store = readStore()
  return childFolders(store, f).sort(
    (a, b) => dirOrder(store, a) - dirOrder(store, b),
  )
}

export function createFolder(folderPath: string): boolean {
  const fp = normFolder(folderPath)
  if (!fp) return false
  if (baseName(fp).includes('/')) return false
  const store = readStore()
  if (store.dirs[fp]) return false
  store.dirs[fp] = { createdAt: Date.now(), order: 0 }
  assignOrderFront(store, 'dir', parentFolder(fp), fp)
  writeStore(store)
  return true
}

function deleteFolderInternal(store: SchemeStore, folderPath: string) {
  for (const d of Object.keys(store.dirs)) {
    if (d === folderPath || d.indexOf(folderPath + '/') === 0) delete store.dirs[d]
  }
  for (const p of Object.keys(store.schemes)) {
    const f = store.schemes[p]?.folder || ''
    if (f === folderPath || f.indexOf(folderPath + '/') === 0) delete store.schemes[p]
  }
}

export function deleteFolder(folderPath: string): void {
  const store = readStore()
  deleteFolderInternal(store, normFolder(folderPath))
  writeStore(store)
}

/** 递归复制目录子树到 targetFolder（目标目录内无冲突命名） */
export function copyFolderTree(srcPath: string, targetFolder: string): DamageCalcHistoryEntry[] {
  const store = readStore()
  const src = normFolder(srcPath)
  if (!store.dirs[src]) return listAllDamageCalcHistory()
  const target = normFolder(targetFolder)
  const base = baseName(src)
  let dstBase = base
  let i = 2
  while (store.dirs[schemePath(target, dstBase)]) {
    // 仅当目标目录内已存在同名（含源目录自身）时才加 -复制 后缀，否则保持原名
    dstBase = i === 2 ? base + '-复制' : base + '-复制' + i
    i++
  }
  const dst = schemePath(target, dstBase)
  store.dirs[dst] = { createdAt: Date.now(), order: 0 }
  assignOrderFront(store, 'dir', target, dst)

  // 复制子目录
  for (const d of Object.keys(store.dirs)) {
    if (d === src || d.indexOf(src + '/') === 0) {
      const nd = dst + d.slice(src.length)
      if (!store.dirs[nd]) store.dirs[nd] = { ...store.dirs[d]! }
    }
  }
  // 复制方案
  const copied: { path: string; folder: string }[] = []
  for (const p of Object.keys(store.schemes)) {
    const s = store.schemes[p]!
    const f = s.folder || ''
    if (f === src || f.indexOf(src + '/') === 0) {
      const nf = dst + (f ? f.slice(src.length) : '')
      const copy: DamageCalcHistoryEntry = JSON.parse(JSON.stringify(s))
      copy.folder = nf
      const newKey = schemeKey(nf, s.name)
      copy.id = newKey
      store.schemes[newKey] = copy
      copied.push({ path: newKey, folder: nf })
    }
  }
  for (let k = copied.length - 1; k >= 0; k--) {
    assignOrderFront(store, 'scheme', copied[k]!.folder, copied[k]!.path)
  }
  writeStore(store)
  return listAllDamageCalcHistory()
}

/** 递归移动目录子树到 targetFolder */
export function moveFolderTree(srcPath: string, targetFolder: string): DamageCalcHistoryEntry[] {
  const store = readStore()
  const src = normFolder(srcPath)
  if (!store.dirs[src]) return listAllDamageCalcHistory()
  const target = normFolder(targetFolder)
  // 禁止移入自身或子孙
  if (target === src || target.indexOf(src + '/') === 0) return listAllDamageCalcHistory()
  const base = baseName(src)
  let dstBase = base
  let i = 2
  while (store.dirs[schemePath(target, dstBase)]) {
    dstBase = base + '-移动' + i
    i++
  }
  const dst = schemePath(target, dstBase)
  store.dirs[dst] = { createdAt: Date.now(), order: 0 }
  assignOrderFront(store, 'dir', target, dst)

  for (const d of Object.keys(store.dirs)) {
    if (d === src || d.indexOf(src + '/') === 0) {
      const nd = dst + d.slice(src.length)
      store.dirs[nd] = store.dirs[d]!
      delete store.dirs[d]
    }
  }
  for (const p of Object.keys(store.schemes)) {
    const s = store.schemes[p]!
    const f = s.folder || ''
    if (f === src || f.indexOf(src + '/') === 0) {
      const nf = dst + (f ? f.slice(src.length) : '')
      s.folder = nf
      s.id = schemeKey(nf, s.name)
      store.schemes[s.id] = s
      if (s.id !== p) delete store.schemes[p]
    }
  }
  writeStore(store)
  return listAllDamageCalcHistory()
}

export function renameFolder(oldPath: string, newName: string): boolean {
  const trimmed = newName.trim()
  if (!trimmed || trimmed.includes('/')) return false
  const store = readStore()
  const op = normFolder(oldPath)
  if (!store.dirs[op]) return false
  const parent = parentFolder(op)
  const np = schemePath(parent, trimmed)
  if (np !== op && store.dirs[np]) return false

  // 重命名 dirs 树
  const dirsToRename = Object.keys(store.dirs).filter(
    (d) => d === op || d.indexOf(op + '/') === 0,
  )
  const dirMapping: Record<string, string> = {}
  for (const d of dirsToRename) {
    const nd = np + d.slice(op.length)
    dirMapping[d] = nd
    store.dirs[nd] = store.dirs[d]!
    delete store.dirs[d]
  }
  // 重命名其下方案 folder + path key
  const schemesToMove = Object.keys(store.schemes).filter((p) => {
    const f = store.schemes[p]?.folder || ''
    return f === op || f.indexOf(op + '/') === 0
  })
  for (const p of schemesToMove) {
    const s = store.schemes[p]!
    const nf = np + (s.folder ? s.folder.slice(op.length) : '')
    s.folder = nf
    const newKey = schemeKey(nf, s.name)
    s.id = newKey
    store.schemes[newKey] = s
    if (newKey !== p) delete store.schemes[p]
  }
  writeStore(store)
  return true
}

/** 目录下直接子方案数 */
export function countSchemesInFolder(folderPath: string): number {
  const f = normFolder(folderPath)
  const store = readStore()
  return Object.values(store.schemes).filter((s) => (s.folder || '') === f).length
}

/** 目录下直接子目录数 */
export function countChildFolders(folderPath: string): number {
  return childFolders(readStore(), normFolder(folderPath)).length
}

// ===================== 当前方案高亮 =====================

export function getLoadedSchemeId(): string {
  try {
    return localStorage.getItem(LOADED_KEY) || ''
  } catch {
    return ''
  }
}

export function setLoadedSchemeId(id: string): void {
  try {
    if (id) localStorage.setItem(LOADED_KEY, id)
    else localStorage.removeItem(LOADED_KEY)
  } catch {
    /* ignore */
  }
}

export function findDamageCalcHistory(id: string): DamageCalcHistoryEntry | null {
  if (!id) return null
  return listAllDamageCalcHistory().find((entry) => entry.id === id) ?? null
}

export function loadWorkingDraft(): DamageCalcWorkingDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DamageCalcWorkingDraft
    if (!parsed || !Array.isArray(parsed.teamSlots)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveWorkingDraft(draft: DamageCalcWorkingDraft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    /* quota / private mode */
  }
}

export function clearWorkingDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* ignore */
  }
}

// ===================== 格式化辅助 =====================

export function formatDamageCalcAgentSelection(
  teamSlots: DamageCalcHistoryEntry['teamSlots'],
  agents: AgentBuffDoc[],
): string {
  const labels = teamSlots.map((slot, index) => {
    if (!slot.agentId) return `槽位${index + 1}未选`
    const agent = agents.find((item) => item.id === slot.agentId)
    const name = agent?.name ?? '未知角色'
    return slot.isMainC ? `${name}（主C）` : name
  })
  return labels.join(' / ')
}

export function schemeStats(entry: DamageCalcHistoryEntry): {
  charN: number
  skillN: number
} {
  const charN = entry.teamSlots.filter((slot) => !!slot?.agentId).length
  const flowCount = Array.isArray(entry.slots)
    ? entry.slots.reduce(
        (total, slot) => total + (Array.isArray(slot?.flow) ? slot.flow.length : 0),
        0,
      )
    : undefined
  const legacyEventCount = (entry.directEvents?.length ?? 0) + (entry.anomalyEvents?.length ?? 0)
  const skillN = flowCount ?? legacyEventCount
  return { charN, skillN }
}

export function formatDamageCalcHistoryTime(savedAt: number): string {
  const date = new Date(savedAt)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ===================== 导出 / 导入（对齐 dev 的 zzz_schemes 包） =====================

function emptyImportResult(errors: string[]): DamageCalcHistoryImportResult {
  return {
    added: 0,
    skipped: 0,
    errors,
    customSkillCount: 0,
    legacyPack: false,
    loadedId: '',
  }
}

function ingestSchemes(
  target: SchemeStore,
  incomingSchemes: Record<string, DamageCalcHistoryEntry>,
): { added: number; skipped: number } {
  let added = 0
  let skipped = 0
  for (const p of Object.keys(incomingSchemes)) {
    const v = incomingSchemes[p]
    if (!v || !isValidEntry(v)) {
      skipped++
      continue
    }
    const rawPath = schemeKeyToPath(p)
    const folder = normFolder(v.folder || parentFolder(rawPath))
    const name = v.name || baseName(rawPath)
    const key = schemeKey(folder, name)
    const entry: DamageCalcHistoryEntry = {
      ...v,
      id: key,
      folder,
      name,
      order: typeof v.order === 'number' ? v.order : 0,
    }
    delete entry.directEvents
    delete entry.anomalyEvents
    target.schemes[key] = entry
    added++
  }
  return { added, skipped }
}

function resolveImportedLoadedId(store: SchemeStore, requested?: string | null): string {
  const want = String(requested ?? '').trim()
  if (want && store.schemes[want]) return want
  if (want) {
    const found = Object.values(store.schemes).find((entry) => entry.id === want)
    if (found) return found.id
  }
  return Object.values(store.schemes)[0]?.id ?? ''
}

function commitReplacedStore(
  store: SchemeStore,
  customRaw: unknown,
  legacyPack: boolean,
  requestedId?: string | null,
): DamageCalcHistoryImportResult {
  const skills = parseCustomSkillList(customRaw)
  if (skills == null) {
    return emptyImportResult(['自建招式数据格式错误，未改动本机数据'])
  }
  ensureOrders(store)
  store.version = SCHEME_STORE_VERSION
  writeStore(store)
  replaceCustomSkills(skills)
  clearWorkingDraft()
  const loadedId = resolveImportedLoadedId(store, requestedId)
  setLoadedSchemeId(loadedId)
  return {
    added: Object.keys(store.schemes).length,
    skipped: 0,
    errors: [],
    customSkillCount: skills.length,
    legacyPack,
    loadedId,
  }
}

export function exportDamageCalcHistory(): string {
  const store = readStore()
  const payload: DamageCalcHistoryExport = {
    type: 'zzz-hp-schemes',
    version: SCHEME_STORE_VERSION,
    exportedAt: Date.now(),
    dirs: store.dirs,
    schemes: store.schemes,
    currentId: getLoadedSchemeId(),
    customSkills: loadCustomSkills(),
  }
  return JSON.stringify(payload, null, 2)
}

/** 整包覆盖：清空本机方案库、自建招式、工作草稿后再写入。合并导入尚未做。 */
export function importDamageCalcHistory(json: string): DamageCalcHistoryImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return emptyImportResult(['JSON 解析失败，请检查文件格式'])
  }

  if (Array.isArray(parsed)) {
    const migrated = migrateFromLegacyArray(parsed)
    const next = createEmptyStore()
    const ingested = ingestSchemes(next, migrated.schemes)
    for (const d of Object.keys(migrated.dirs)) next.dirs[d] = migrated.dirs[d]!
    const result = commitReplacedStore(next, [], true, null)
    if (!result.errors.length) {
      result.added = ingested.added
      result.skipped = ingested.skipped
    }
    return result
  }

  const data = parsed as Partial<DamageCalcHistoryExport> & { entries?: unknown[] }
  if (data.type !== 'zzz-hp-schemes' && !Array.isArray(data.entries) && !data.schemes) {
    return emptyImportResult(['文件类型错误：不是 zzz-hp-schemes 方案库文件'])
  }

  const next = createEmptyStore()
  const incomingDirs = data.dirs || {}
  for (const d of Object.keys(incomingDirs)) next.dirs[d] = incomingDirs[d]!

  let incomingSchemes: Record<string, DamageCalcHistoryEntry> = data.schemes || {}
  if (Array.isArray(data.entries)) {
    const migrated = migrateFromLegacyArray(data.entries)
    incomingSchemes = migrated.schemes
    for (const d of Object.keys(migrated.dirs)) {
      if (!next.dirs[d]) next.dirs[d] = migrated.dirs[d]!
    }
  }

  const ingested = ingestSchemes(next, incomingSchemes)
  const legacyPack = !Object.prototype.hasOwnProperty.call(data, 'customSkills')
  const result = commitReplacedStore(next, legacyPack ? [] : data.customSkills, legacyPack, data.currentId)
  if (!result.errors.length) {
    result.added = ingested.added
    result.skipped = ingested.skipped
  }
  return result
}
