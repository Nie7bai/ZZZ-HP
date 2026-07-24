<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  GUESTBOOK_CATEGORIES,
  ADMIN_ONLY_CATEGORIES,
  blockGuestbookComment,
  blockGuestbookUser,
  checkInGuestbook,
  createGuestbook,
  createGuestbookComment,
  deleteGuestbook,
  deleteGuestbookComment,
  fetchGuestbook,
  fetchGuestbookComments,
  fetchGuestbookDmConversations,
  fetchGuestbookManage,
  fetchGuestbookNotifications,
  fetchGuestbookPost,
  fetchGuestbookUnreadCount,
  fetchGuestbookSensitiveVisibility,
  searchGuestbookUsers,
  fetchGuestbookFollowing,
  fetchGuestbookReports,
  handleGuestbookReport,
  restoreGuestbook,
  reportGuestbookComment,
  reportGuestbookPost,
  requestGuestbookUnban,
  setGuestbookHidden,
  setGuestbookPinned,
  setGuestbookSensitive,
  toggleGuestbookFavorite,
  toggleGuestbookCommentLike,
  toggleGuestbookLike,
  updateGuestbook,
  updateGuestbookSensitiveVisibility,
  uploadGuestbookImage,
  type GuestbookComment,
  type GuestbookEntry,
  type GuestbookManageStatus,
  type GuestbookProfileTab,
  type GuestbookReport,
  type GuestbookSocialUser,
} from '@/api/guestbook'
import { resolveAssetUrl } from '@/utils/gameData'
import { formatBodyText } from '@/utils/formatBody'
import { parseMentionQuery, applyMention } from '@/utils/guestbookMentions'
import {
  loadRecentMentions,
  mergeMentionSearchResults,
  pushRecentMention,
} from '@/utils/guestbookMentionSuggestions'
import {
  attachQuote,
  formatMessagePreview,
  quotePreviewText,
  scrollToQuoteTarget,
  type GuestbookQuoteRef,
} from '@/utils/guestbookQuotes'
import { isAdminAuthenticated } from '@/utils/adminAuth'
import { useUserAuthStore } from '@/stores/userAuth'
import GuestbookProfilePanel from '@/components/home/GuestbookProfilePanel.vue'
import GuestbookSensitiveMedia from '@/components/home/GuestbookSensitiveMedia.vue'
import GuestbookAccountPanel from '@/components/home/GuestbookAccountPanel.vue'
import GuestbookAccountManagePanel from '@/components/home/GuestbookAccountManagePanel.vue'
import GuestbookNotificationsPanel from '@/components/home/GuestbookNotificationsPanel.vue'
import GuestbookUserChip from '@/components/home/GuestbookUserChip.vue'
import GuestbookRichComposer from '@/components/home/GuestbookRichComposer.vue'
import GuestbookRichText from '@/components/home/GuestbookRichText.vue'
import GuestbookLikeButton from '@/components/home/GuestbookLikeButton.vue'
import GuestbookConfirmDialog from '@/components/home/GuestbookConfirmDialog.vue'
import GuestbookMediaViewer from '@/components/home/GuestbookMediaViewer.vue'
import GuestbookComposerIcons from '@/components/home/GuestbookComposerIcons.vue'
import IkModalShell from '@/components/common/IkModalShell.vue'
import { useGuestbookMediaViewer } from '@/composables/useGuestbookMediaViewer'
import {
  GUESTBOOK_SENSITIVE_REVEAL_KEY,
  useGuestbookSensitiveReveal,
} from '@/composables/useGuestbookSensitiveReveal'

/** 未上传封面时使用的默认图（后端 guestbook_image/zzz.jpg） */
const DEFAULT_COVER = '/guestbook_image/zzz.jpg'

const route = useRoute()
const router = useRouter()
const userAuth = useUserAuthStore()
const guestbookSensitiveReveal = useGuestbookSensitiveReveal()
provide(GUESTBOOK_SENSITIVE_REVEAL_KEY, guestbookSensitiveReveal)

const TITLE_MAX = 120
const CONTENT_MAX = 10000
const IMAGE_MAX = 9
const DRAFT_MAX = 9
const DRAFT_KEY_PREFIX = 'zzz-hp-guestbook-drafts-v1'
const marqueeLine = 'ZZZ HP '.repeat(4)

const open = ref(false)
const creating = ref(false)
const editingPostId = ref<number | null>(null)
const showingProfile = ref(false)
const showingAccount = ref(false)
const showingModeration = ref(false)
const showingNotifications = ref(false)
const unreadCount = ref(0)
const lastDmUnread = ref(0)
const lastMentionUnread = ref(0)
const knockToast = ref<{ text: string; peerId?: number; postId?: number } | null>(null)
const manageSection = ref<'posts' | 'accounts' | 'reports'>('posts')
const modTab = ref<GuestbookManageStatus>('normal')
const modTabs = [
  { label: '正常的', value: 'normal' as const },
  { label: '敏感内容', value: 'sensitive' as const },
  { label: '屏蔽的', value: 'hidden' as const },
  { label: '删除的', value: 'deleted' as const },
]
const actionBusy = ref(false)
const commentActionId = ref<number | null>(null)
const expandedBlockedComments = ref<Record<number, boolean>>({})
const modEntries = ref<GuestbookEntry[]>([])
const modLoading = ref(false)
const modError = ref('')
const modMessage = ref('')
const hideAllSensitive = ref(false)
const sensitiveSettingBusy = ref(false)
const modReports = ref<GuestbookReport[]>([])
const modReportsLoading = ref(false)
const modReportStatus = ref<'pending' | 'handled'>('pending')
const modReportTarget = ref<'all' | 'post' | 'comment' | 'user'>('all')
const pendingHighlightCommentId = ref<number | null>(null)
const handleReportDialog = reactive({
  open: false,
  busy: false,
  message: '',
  report: null as GuestbookReport | null,
})

const banStatusDialog = reactive({
  open: false,
  busy: false,
  applyOpen: false,
  reason: '',
})

function formatBanRemaining(banUntil?: string | null) {
  if (!banUntil) return '永久'
  const ms = new Date(banUntil).getTime() - Date.now()
  if (ms <= 0) return '已到期'
  const totalMin = Math.ceil(ms / 60000)
  if (totalMin < 60) return `${totalMin} 分钟`
  const hours = Math.floor(totalMin / 60)
  if (hours < 48) return `${hours} 小时`
  return `${Math.ceil(hours / 24)} 天`
}

function formatBanTime(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

function openSelfBanDialog() {
  if (!userAuth.user?.isBanned) return
  banStatusDialog.open = true
  banStatusDialog.applyOpen = false
  banStatusDialog.reason = ''
  banStatusDialog.busy = false
}

function closeBanStatusDialog() {
  banStatusDialog.open = false
  banStatusDialog.applyOpen = false
  banStatusDialog.reason = ''
  banStatusDialog.busy = false
}

async function submitUnbanRequest() {
  if (banStatusDialog.busy) return
  const reason = banStatusDialog.reason.trim()
  if (!reason) {
    showCommentError('请填写申请原因')
    return
  }
  banStatusDialog.busy = true
  try {
    await requestGuestbookUnban(reason)
    banStatusDialog.applyOpen = false
    banStatusDialog.reason = ''
    showCommentError('解封申请已提交')
  } catch (err) {
    showCommentError(err instanceof Error ? err.message : '申请失败')
  } finally {
    banStatusDialog.busy = false
  }
}
const modDialog = reactive({
  open: false,
  action: 'hide' as 'hide' | 'delete',
  entry: null as GuestbookEntry | null,
  message: '',
  busy: false,
})
const MOD_MSG_DEFAULT = {
  hide: '您的委托暂时不符合委托规约，已被屏蔽，若想恢复帖子请联系管理员',
  delete: '您的委托暂时不符合委托规约，已被删除，若想恢复帖子请联系管理员',
}
const returnToProfileTab = ref<GuestbookProfileTab | null>(null)
const returnToModeration = ref(false)
const returnToNotifications = ref(false)
const returnToDetailAfterProfile = ref(false)
const profileStack = ref<number[]>([])
const profileRestoreTab = ref<GuestbookProfileTab | null>(null)

const WIDTH_KEY = 'zzz-hp-guestbook-width'
const WIDTH_MIN = 360
function defaultDrawerWidth() {
  if (typeof window === 'undefined') return 960
  return Math.min(Math.round(window.innerWidth * 0.76), window.innerWidth - 24)
}
function clampDrawerWidth(px: number) {
  const max = Math.max(WIDTH_MIN, window.innerWidth - 24)
  return Math.min(max, Math.max(WIDTH_MIN, Math.round(px)))
}
function readStoredWidth() {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY) || '')
    if (Number.isFinite(raw) && raw >= WIDTH_MIN) return clampDrawerWidth(raw)
  } catch {
    /* ignore */
  }
  return defaultDrawerWidth()
}
const drawerWidth = ref(readStoredWidth())
const resizing = ref(false)
const isCompactDrawer = ref(
  typeof window !== 'undefined' ? window.innerWidth <= 560 : false,
)
const drawerStyle = computed(() =>
  isCompactDrawer.value ? { width: '100vw' } : { width: `${drawerWidth.value}px` },
)
const entries = ref<GuestbookEntry[]>([])
const loading = ref(false)
const submitting = ref(false)
const uploading = ref(false)
const commenting = ref(false)
const error = ref('')
const createError = ref('')
const commentError = ref('')
let commentErrorTimer: ReturnType<typeof setTimeout> | null = null
const commentComposerRef = ref<InstanceType<typeof GuestbookRichComposer> | null>(null)
const commentMenuId = ref<number | null>(null)
const commentMenuStyle = ref<Record<string, string>>({})
const commentMenuComment = computed(() =>
  comments.value.find((item) => item.id === commentMenuId.value) || null,
)
const { viewerOpen, viewerUrls, viewerIndex, openMediaViewer } = useGuestbookMediaViewer()

const reportDialog = reactive({
  open: false,
  busy: false,
  reason: '',
  targetType: 'post' as 'post' | 'comment',
  postId: 0,
  commentId: null as number | null,
})

function showCommentError(message: string) {
  commentError.value = message
  if (commentErrorTimer) clearTimeout(commentErrorTimer)
  commentErrorTimer = setTimeout(() => {
    commentError.value = ''
    commentErrorTimer = null
  }, 2500)
}
const loadedOnce = ref(false)
const activeCategory = ref('')
const searchKeyword = ref('')
/** 日期快捷筛选：'' | '1' | '3' | '7' | '30' */
const dateRange = ref('')
/** 最近一次成功请求时是否带有筛选条件 */
const filtersApplied = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const selected = ref<GuestbookEntry | null>(null)
const detailImageIndex = ref(0)
/** 移动端详情：正文 / 评论 分栏 */
const detailMobileTab = ref<'post' | 'comments'>('post')
const comments = ref<GuestbookComment[]>([])
const commentsLoading = ref(false)

const commentForm = reactive({
  nickname: '',
  content: '',
  anonymous: false,
  images: [] as string[],
})
const mentionResults = ref<GuestbookSocialUser[]>([])
const mentionRecent = ref<GuestbookSocialUser[]>([])
const mentionFollowing = ref<GuestbookSocialUser[]>([])
const mentionOpen = ref(false)
const mentionLoading = ref(false)
const commentCaret = ref(0)
const commentQuote = ref<GuestbookQuoteRef | null>(null)
const feedScrollRef = ref<HTMLElement | null>(null)
const feedRefreshing = ref(false)
let mentionTimer: ReturnType<typeof setTimeout> | null = null

const form = reactive({
  nickname: '',
  title: '',
  category: '灌水',
  content: '',
  anonymous: false,
  notifyPublish: true,
  isSensitive: false,
  images: [] as string[],
})

type GuestbookDraft = {
  id: string
  nickname: string
  title: string
  category: string
  content: string
  anonymous: boolean
  notifyPublish: boolean
  isSensitive: boolean
  images: string[]
  updatedAt: number
}

const drafts = ref<GuestbookDraft[]>([])
const activeDraftId = ref<string | null>(null)
const draftPanelOpen = ref(false)
const markdownPreview = ref(false)
let draftSaveTimer: ReturnType<typeof setTimeout> | null = null

const draftStorageKey = computed(
  () => `${DRAFT_KEY_PREFIX}:${userAuth.user?.id || 'guest'}`,
)
const draftContentHtml = computed(() =>
  form.content.trim() ? formatBodyText(form.content) : '',
)

function hasDraftContent() {
  return Boolean(form.title.trim() || form.content.trim() || form.images.length)
}

function readDrafts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(draftStorageKey.value) || '[]')
    drafts.value = Array.isArray(parsed)
      ? parsed
          .filter((item): item is GuestbookDraft => Boolean(item && typeof item.id === 'string'))
          .slice(0, DRAFT_MAX)
      : []
  } catch {
    drafts.value = []
  }
}

function persistDrafts() {
  try {
    localStorage.setItem(draftStorageKey.value, JSON.stringify(drafts.value))
  } catch {
    createError.value = '草稿保存失败，请检查浏览器存储空间'
  }
}

function snapshotDraft(id: string): GuestbookDraft {
  return {
    id,
    nickname: form.nickname,
    title: form.title,
    category: form.category,
    content: form.content,
    anonymous: form.anonymous,
    notifyPublish: form.notifyPublish,
    isSensitive: form.isSensitive,
    images: [...form.images],
    updatedAt: Date.now(),
  }
}

function saveCurrentDraft({ silent = false } = {}) {
  if (isEditing.value || !hasDraftContent()) return true
  let id = activeDraftId.value
  const existingIndex = id ? drafts.value.findIndex((draft) => draft.id === id) : -1
  if (existingIndex < 0) {
    if (drafts.value.length >= DRAFT_MAX) {
      if (!silent) createError.value = `草稿箱最多保存 ${DRAFT_MAX} 篇，请先删除一篇草稿`
      return false
    }
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    activeDraftId.value = id
    drafts.value.unshift(snapshotDraft(id))
  } else {
    drafts.value.splice(existingIndex, 1, snapshotDraft(id!))
  }
  drafts.value.sort((a, b) => b.updatedAt - a.updatedAt)
  persistDrafts()
  if (!silent) createError.value = ''
  return true
}

function loadDraft(draft: GuestbookDraft) {
  activeDraftId.value = draft.id
  form.nickname = draft.nickname || userAuth.user?.nickname || ''
  form.title = draft.title
  form.category = draft.category || '灌水'
  form.content = draft.content
  form.anonymous = draft.anonymous
  form.notifyPublish = draft.notifyPublish
  form.isSensitive = draft.isSensitive
  form.images = [...draft.images]
  createError.value = ''
  draftPanelOpen.value = false
}

function removeDraft(id: string) {
  drafts.value = drafts.value.filter((draft) => draft.id !== id)
  persistDrafts()
  if (activeDraftId.value === id) resetCreateForm()
}

function startNewDraft() {
  if (!saveCurrentDraft()) return
  resetCreateForm()
  draftPanelOpen.value = false
}

function formatDraftTime(value: number) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const FOLLOWING_TAB = '__following__'

const categoryTabs = [
  { label: '最新', value: '' },
  ...GUESTBOOK_CATEGORIES.map((c) => ({ label: c, value: c })),
  { type: 'separator' as const },
  { label: '关注', value: FOLLOWING_TAB },
]

const dateRangeTabs = [
  { label: '全部', value: '' },
  { label: '今日', value: '1' },
  { label: '近3日', value: '3' },
  { label: '近7天', value: '7' },
  { label: '近30天', value: '30' },
] as const

const hasActiveFilters = computed(
  () => Boolean(searchKeyword.value.trim()) || Boolean(dateRange.value),
)

const resultCountText = computed(() => {
  if (!filtersApplied.value) return ''
  return `已应用筛选 · 共 ${entries.value.length} 条`
})

const masonryGridRef = ref<HTMLElement | null>(null)
const masonryColumnCount = ref(3)
let masonryResizeObserver: ResizeObserver | null = null

function calcMasonryColumnCount(containerWidth: number) {
  if (containerWidth <= 0) return 1
  if (containerWidth <= 560) return 2
  const gap = 18
  const colWidth = containerWidth <= 768 ? 160 : 220
  return Math.max(1, Math.floor((containerWidth + gap) / (colWidth + gap)))
}

function splitMasonryColumns<T>(items: readonly T[], count: number): T[][] {
  const cols = Array.from({ length: count }, () => [] as T[])
  items.forEach((item, index) => {
    cols[index % count]!.push(item)
  })
  return cols
}

const feedMasonryColumns = computed(() =>
  splitMasonryColumns(entries.value, masonryColumnCount.value),
)

function updateMasonryColumnCount() {
  const el = masonryGridRef.value
  if (!el) return
  masonryColumnCount.value = calcMasonryColumnCount(el.clientWidth)
}

function bindMasonryObserver() {
  masonryResizeObserver?.disconnect()
  masonryResizeObserver = null
  const el = masonryGridRef.value
  if (!el || typeof ResizeObserver === 'undefined') {
    updateMasonryColumnCount()
    return
  }
  masonryResizeObserver = new ResizeObserver(() => updateMasonryColumnCount())
  masonryResizeObserver.observe(el)
  updateMasonryColumnCount()
}

const selectedContentHtml = computed(() =>
  selected.value?.content ? formatBodyText(selected.value.content) : '',
)

function formatLocalDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 含今天在内的最近 N 天起点（本地日期 YYYY-MM-DD） */
function rangeStartForDays(days: number) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (Math.max(1, days) - 1))
  return formatLocalDate(d)
}

function resolveDateFilter(range: string) {
  const days = Number(range)
  if (!Number.isFinite(days) || days <= 0) return { startDate: undefined as string | undefined }
  return { startDate: rangeStartForDays(days) }
}

const titleLen = computed(() => form.title.length)
const contentLen = computed(() => form.content.length)
const canSubmit = computed(() => {
  const hasTitle = form.title.trim().length > 0
  const hasBody = form.content.trim().length > 0 || form.images.length > 0
  return hasTitle && hasBody && !submitting.value && !uploading.value
})

const isEditing = computed(() => editingPostId.value != null)

const mentionDisplayGroups = computed(() =>
  mergeMentionSearchResults(
    parseMentionQuery(commentForm.content, commentCaret.value) || '',
    mentionRecent.value,
    mentionFollowing.value,
    mentionResults.value,
  ),
)

const canEditSelected = computed(() => {
  if (!selected.value || !userAuth.isLoggedIn) return false
  return Boolean(selected.value.isMine)
})

const MOD_MODE_KEY = 'zzz-hp-guestbook-mod-mode'
function readModeratorMode() {
  try {
    return localStorage.getItem(MOD_MODE_KEY) !== '0'
  } catch {
    return true
  }
}
const moderatorModeOn = ref(readModeratorMode())

const isAdmin = computed(() => isAdminAuthenticated())

const canManagePosts = computed(
  () =>
    Boolean(
      isAdmin.value ||
        (userAuth.user?.isGuestbookModerator && moderatorModeOn.value),
    ),
)

const createCategories = computed(() =>
  GUESTBOOK_CATEGORIES.filter(
    (cat) =>
      !ADMIN_ONLY_CATEGORIES.includes(cat as (typeof ADMIN_ONLY_CATEGORIES)[number]) ||
      Boolean(userAuth.user?.isGuestbookModerator),
  ),
)

const showNotifyPublishToggle = computed(
  () =>
    Boolean(userAuth.user?.isGuestbookModerator) &&
    (form.category === '公告' || form.category === '更新日志') &&
    !editingPostId.value,
)

const knockChatPeerId = ref<number | null>(null)
const knockJumpUnreadNonce = ref(0)
const profileUserId = ref<number | null>(null)
const profileDisplayName = ref('')

function toggleModeratorMode() {
  moderatorModeOn.value = !moderatorModeOn.value
  try {
    localStorage.setItem(MOD_MODE_KEY, moderatorModeOn.value ? '1' : '0')
  } catch {
    /* ignore */
  }
  if (!moderatorModeOn.value && showingModeration.value) {
    closeModeration()
  }
}

const isPostAuthor = computed(() => {
  if (!selected.value || !userAuth.isLoggedIn) return false
  return Boolean(selected.value.isMine)
})

function formatRelativeTime(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const diff = Date.now() - d.getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dayNum = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dayNum}`
}

function avatarLetter(name: string) {
  return (name || '匿').trim().charAt(0).toUpperCase()
}

function avatarTone(name: string) {
  let hash = 0
  for (const ch of name || '匿名') hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const hues = [72, 188, 32, 280, 12, 210, 45, 160]
  return hues[hash % hues.length]
}

function authorAvatarUrl(avatar?: string | null) {
  return resolveAssetUrl(avatar || '') || ''
}

function onResizePointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  resizing.value = true
  const startX = event.clientX
  const startW = drawerWidth.value

  const onMove = (e: PointerEvent) => {
    // 左侧边缘拖动：向左拉宽，向右拉窄
    const next = clampDrawerWidth(startW + (startX - e.clientX))
    drawerWidth.value = next
  }
  const onUp = () => {
    resizing.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    try {
      localStorage.setItem(WIDTH_KEY, String(drawerWidth.value))
    } catch {
      /* ignore */
    }
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function onWindowResize() {
  isCompactDrawer.value = window.innerWidth <= 560
  drawerWidth.value = clampDrawerWidth(drawerWidth.value)
  updateMasonryColumnCount()
}

function coverTone(item: GuestbookEntry) {
  let hash = 0
  const seed = `${item.category}-${item.title}-${item.id}`
  for (const ch of seed) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0
  return 20 + (hash % 320)
}

function coverUrl(item: GuestbookEntry) {
  return resolveAssetUrl(item.cover || item.images?.[0] || DEFAULT_COVER) || DEFAULT_COVER
}

const selectedDetailImages = computed(() => {
  const post = selected.value
  if (!post) return [] as string[]
  const images = (post.images || []).map((u) => String(u || '').trim()).filter(Boolean)
  if (images.length) return images
  const cover = String(post.cover || '').trim()
  return cover ? [cover] : []
})

const detailImageUrl = computed(() => {
  const post = selected.value
  if (!post) return DEFAULT_COVER
  const images = selectedDetailImages.value
  if (!images.length) return coverUrl(post)
  const index = Math.min(Math.max(detailImageIndex.value, 0), images.length - 1)
  return resolveAssetUrl(images[index]!) || images[index]! || coverUrl(post)
})

function setDetailImageIndex(index: number) {
  const max = selectedDetailImages.value.length - 1
  if (max < 0) {
    detailImageIndex.value = 0
    return
  }
  detailImageIndex.value = Math.min(Math.max(index, 0), max)
}

function onGalleryThumbClick(index: number) {
  if (index === detailImageIndex.value) {
    openPostImages(index)
    return
  }
  setDetailImageIndex(index)
}

function prevDetailImage() {
  setDetailImageIndex(detailImageIndex.value - 1)
}

function nextDetailImage() {
  setDetailImageIndex(detailImageIndex.value + 1)
}

function resetCreateForm() {
  editingPostId.value = null
  activeDraftId.value = null
  form.nickname = ''
  form.title = ''
  form.category =
    activeCategory.value && activeCategory.value !== FOLLOWING_TAB ? activeCategory.value : '灌水'
  form.content = ''
  form.anonymous = false
  form.notifyPublish = true
  form.isSensitive = false
  form.images = []
  createError.value = ''
}

async function loadEntries() {
  loading.value = true
  error.value = ''
  try {
    const isFollowing = activeCategory.value === FOLLOWING_TAB
    if (isFollowing && !userAuth.isLoggedIn) {
      entries.value = []
      error.value = '登录后查看关注用户的委托'
      filtersApplied.value = false
      loadedOnce.value = true
      return
    }
    const { startDate } = resolveDateFilter(dateRange.value)
    entries.value = await fetchGuestbook({
      category: !isFollowing && activeCategory.value ? activeCategory.value : undefined,
      following: isFollowing || undefined,
      q: searchKeyword.value.trim() || undefined,
      startDate,
    })
    filtersApplied.value = Boolean(searchKeyword.value.trim() || dateRange.value)
    loadedOnce.value = true
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载留言失败'
  } finally {
    loading.value = false
    void nextTick(() => bindMasonryObserver())
  }
}

function scrollFeedToTop() {
  feedScrollRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

async function refreshFeed() {
  if (feedRefreshing.value) return
  feedRefreshing.value = true
  try {
    await loadEntries()
  } finally {
    feedRefreshing.value = false
  }
}

function clearCommentQuote() {
  commentQuote.value = null
}

function jumpToQuotedComment(quote: GuestbookQuoteRef) {
  if (quote.type !== 'comment') return
  detailMobileTab.value = 'comments'
  void nextTick(() => {
    const ok = scrollToQuoteTarget(`gb-comment-${quote.id}`)
    if (!ok) {
      // 重试结束后仍找不到再提示
      window.setTimeout(() => {
        if (!document.getElementById(`gb-comment-${quote.id}`)) {
          showCommentError('原评论已不存在')
        }
      }, 450)
    }
  })
}

function openCommentImages(images: string[], index: number) {
  openMediaViewer(images, index)
}

function openPostImages(index = detailImageIndex.value) {
  const post = selected.value
  if (!post) return
  const images = selectedDetailImages.value
  if (images.length) {
    openMediaViewer(images, index)
    return
  }
  const cover = String(post.cover || '').trim()
  if (cover) openMediaViewer([cover], 0)
}

function openCreateFormImages(index: number) {
  openMediaViewer(form.images, index)
}

function onMediaFavorited() {
  commentComposerRef.value?.refreshStickers()
}

function toggleCommentMenu(commentId: number, event?: MouseEvent) {
  if (commentMenuId.value === commentId) {
    closeCommentMenu()
    return
  }
  const trigger = (event?.currentTarget as HTMLElement | null) || null
  if (trigger) {
    const rect = trigger.getBoundingClientRect()
    const menuWidth = 140
    const estimatedHeight = 180
    const spaceAbove = rect.top
    const openDown = spaceAbove < estimatedHeight + 12
    const left = Math.min(
      Math.max(8, rect.right - menuWidth),
      window.innerWidth - menuWidth - 8,
    )
    commentMenuStyle.value = openDown
      ? {
          top: `${Math.round(rect.bottom + 6)}px`,
          left: `${Math.round(left)}px`,
          bottom: 'auto',
        }
      : {
          top: 'auto',
          bottom: `${Math.round(window.innerHeight - rect.top + 6)}px`,
          left: `${Math.round(left)}px`,
        }
  } else {
    commentMenuStyle.value = {}
  }
  commentMenuId.value = commentId
}

function closeCommentMenu() {
  commentMenuId.value = null
  commentMenuStyle.value = {}
}

function showCommentMenu(comment: GuestbookComment) {
  return (
    canReportComment(comment) ||
    canDeleteComment(comment) ||
    canBlockComment(comment) ||
    canRestoreComment(comment) ||
    canBlockCommentUser(comment)
  )
}

function canReportComment(comment: GuestbookComment) {
  if (!userAuth.isLoggedIn || comment.isMine) return false
  return !isCommentBlocked(comment)
}

function canReportPost() {
  if (!selected.value || !userAuth.isLoggedIn) return false
  const ownerId = Number(selected.value.userId)
  const myId = Number(userAuth.user?.id)
  if (ownerId && myId && ownerId === myId) return false
  return true
}

function openReportComment(comment: GuestbookComment) {
  if (!selected.value) return
  reportDialog.open = true
  reportDialog.busy = false
  reportDialog.reason = ''
  reportDialog.targetType = 'comment'
  reportDialog.postId = selected.value.id
  reportDialog.commentId = comment.id
  closeCommentMenu()
}

function openReportPost() {
  if (!selected.value) return
  reportDialog.open = true
  reportDialog.busy = false
  reportDialog.reason = ''
  reportDialog.targetType = 'post'
  reportDialog.postId = selected.value.id
  reportDialog.commentId = null
}

function closeReportDialog() {
  reportDialog.open = false
  reportDialog.reason = ''
}

async function confirmReportDialog() {
  if (reportDialog.busy) return
  reportDialog.busy = true
  try {
    const reason = reportDialog.reason.trim()
    if (reportDialog.targetType === 'comment' && reportDialog.commentId) {
      const result = await reportGuestbookComment(reportDialog.postId, reportDialog.commentId, { reason })
      showCommentError(result.duplicate ? '今日已举报过该评论' : '举报已提交，管理员会尽快处理')
    } else {
      const result = await reportGuestbookPost(reportDialog.postId, { reason })
      showCommentError(result.duplicate ? '今日已举报过该委托' : '举报已提交，管理员会尽快处理')
    }
    closeReportDialog()
  } catch (err) {
    showCommentError(err instanceof Error ? err.message : '举报失败')
  } finally {
    reportDialog.busy = false
  }
}

async function onToggleCommentLike(comment: GuestbookComment) {
  if (!selected.value) return
  if (!userAuth.isLoggedIn) {
    userAuth.openLoginDialog()
    return
  }
  if (commentActionId.value != null || isCommentBlocked(comment)) return
  commentActionId.value = comment.id
  try {
    const result = await toggleGuestbookCommentLike(selected.value.id, comment.id)
    const idx = comments.value.findIndex((item) => item.id === comment.id)
    if (idx >= 0) comments.value[idx] = { ...comments.value[idx], ...result.comment }
    void userAuth.refreshMe()
  } catch (err) {
    showCommentError(err instanceof Error ? err.message : '点赞失败')
  } finally {
    commentActionId.value = null
  }
}

async function loadModReports() {
  if (!canManagePosts.value) return
  modReportsLoading.value = true
  modError.value = ''
  try {
    modReports.value = await fetchGuestbookReports(modReportStatus.value, modReportTarget.value)
  } catch (err) {
    modError.value = err instanceof Error ? err.message : '加载举报失败'
  } finally {
    modReportsLoading.value = false
  }
}

async function onHandleReport(report: GuestbookReport) {
  if (report.status === 'handled') return
  handleReportDialog.open = true
  handleReportDialog.busy = false
  handleReportDialog.message = ''
  handleReportDialog.report = report
}

function closeHandleReportDialog() {
  handleReportDialog.open = false
  handleReportDialog.message = ''
  handleReportDialog.report = null
}

async function confirmHandleReport() {
  const report = handleReportDialog.report
  if (!report || handleReportDialog.busy) return
  handleReportDialog.busy = true
  modError.value = ''
  try {
    await handleGuestbookReport(report.id, { message: handleReportDialog.message.trim() })
    modMessage.value = '已处理，并已通知举报人'
    closeHandleReportDialog()
    await loadModReports()
    void refreshUnreadCount()
  } catch (err) {
    modError.value = err instanceof Error ? err.message : '处理举报失败'
  } finally {
    handleReportDialog.busy = false
  }
}

async function openReportTarget(report: GuestbookReport) {
  if (report.targetType === 'user' && report.reportedUserId) {
    openProfile(Number(report.reportedUserId))
    return
  }
  await openDetail(
    { id: report.postId } as GuestbookEntry,
    undefined,
    report.targetType === 'comment' ? report.commentId : null,
  )
}

function canBlockCommentUser(comment: GuestbookComment) {
  if (!userAuth.isLoggedIn || comment.isMine) return false
  const uid = Number(comment.userId)
  return uid > 0
}

async function onBlockCommentUser(comment: GuestbookComment) {
  const uid = Number(comment.userId)
  if (!uid || !userAuth.isLoggedIn) return
  if (commentActionId.value != null) return
  commentActionId.value = comment.id
  commentError.value = ''
  try {
    await blockGuestbookUser(uid)
    showCommentError('已拉黑该用户')
  } catch (err) {
    showCommentError(err instanceof Error ? err.message : '拉黑失败')
  } finally {
    commentActionId.value = null
    closeCommentMenu()
  }
}

function quoteComment(comment: GuestbookComment) {
  commentQuote.value = {
    type: 'comment',
    id: comment.id,
    nickname: comment.nickname || '用户',
    preview: quotePreviewText(comment.content, comment.images),
  }
}

function selectCategory(value: string) {
  if (activeCategory.value === value) return
  activeCategory.value = value
  selected.value = null
  if (creating.value && value !== FOLLOWING_TAB) form.category = value || form.category
  void loadEntries()
}

function selectDateRange(value: string) {
  if (dateRange.value === value) return
  dateRange.value = value
  selected.value = null
  void loadEntries()
}

function applySearch() {
  selected.value = null
  void loadEntries()
}

function clearSearch() {
  if (!hasActiveFilters.value && !filtersApplied.value) return
  searchKeyword.value = ''
  dateRange.value = ''
  filtersApplied.value = false
  selected.value = null
  void loadEntries()
}

async function openDetail(
  item: GuestbookEntry,
  fromProfileTab?: GuestbookProfileTab,
  highlightCommentId?: number | null,
) {
  creating.value = false
  editingPostId.value = null
  pendingHighlightCommentId.value =
    highlightCommentId != null && Number(highlightCommentId) > 0 ? Number(highlightCommentId) : null
  // undefined = 普通打开；null = 通知进帖但无评论 → 高亮正文；number = 高亮评论
  const highlightPostBody = highlightCommentId === null
  detailMobileTab.value = pendingHighlightCommentId.value ? 'comments' : 'post'
  if (fromProfileTab) {
    returnToProfileTab.value = fromProfileTab
    returnToModeration.value = false
    returnToNotifications.value = false
  } else if (showingNotifications.value) {
    returnToNotifications.value = true
    returnToProfileTab.value = null
    returnToModeration.value = false
    showingNotifications.value = false
  } else if (showingModeration.value) {
    returnToModeration.value = true
    returnToProfileTab.value = null
    showingModeration.value = false
  } else {
    returnToProfileTab.value = null
    returnToModeration.value = false
    returnToNotifications.value = false
  }
  showingProfile.value = false
  showingAccount.value = false
  selected.value = item
  detailImageIndex.value = 0
  commentsLoading.value = true
  commentError.value = ''
  commentForm.content = ''
  commentForm.images = []
  commentQuote.value = null
  try {
    selected.value = await fetchGuestbookPost(item.id)
    comments.value = await fetchGuestbookComments(item.id)
    syncEntryInList(selected.value)
    const highlightId = pendingHighlightCommentId.value
    await nextTick()
    if (highlightId) {
      detailMobileTab.value = 'comments'
      await nextTick()
      scrollToQuoteTarget(`gb-comment-${highlightId}`)
      pendingHighlightCommentId.value = null
    } else if (highlightPostBody && selected.value) {
      detailMobileTab.value = 'post'
      await nextTick()
      scrollToQuoteTarget(`gb-post-${selected.value.id}`)
    }
  } catch (err) {
    comments.value = []
    showCommentError(err instanceof Error ? err.message : '加载评论失败')
  } finally {
    commentsLoading.value = false
  }
}

function openDetailFromKnock(item: GuestbookEntry, highlightCommentId?: number | null) {
  void openDetail(item, undefined, highlightCommentId)
}

function openDetailFromProfile(item: GuestbookEntry, fromTab?: GuestbookProfileTab) {
  void openDetail(item, fromTab)
}

function closeDetail() {
  const tab = returnToProfileTab.value
  const backToMod = returnToModeration.value
  const backToNotify = returnToNotifications.value
  selected.value = null
  comments.value = []
  commentError.value = ''
  expandedBlockedComments.value = {}
  if (tab) {
    showingProfile.value = true
    profileRestoreTab.value = tab
    returnToProfileTab.value = null
    void nextTick(() => {
      profileRestoreTab.value = null
    })
  } else if (backToNotify) {
    showingNotifications.value = true
    returnToNotifications.value = false
    void refreshUnreadCount()
  } else if (backToMod) {
    showingModeration.value = true
    returnToModeration.value = false
    void loadModerationEntries()
  }
}

function canDeleteComment(comment: GuestbookComment) {
  if (!userAuth.isLoggedIn) return false
  if (canManagePosts.value) return true
  return Boolean(comment.isMine)
}

function canBlockComment(comment: GuestbookComment) {
  if (!userAuth.isLoggedIn || comment.blockedForMe) return false
  const uid = userAuth.user?.id
  if (!uid || comment.isMine) return false
  return true
}

function canRestoreComment(comment: GuestbookComment) {
  return Boolean(comment.canRestoreGlobal || comment.canRestoreMute)
}

function isCommentBlocked(comment: GuestbookComment) {
  return Boolean(comment.blockedForMe)
}

function toggleExpandBlocked(commentId: number) {
  expandedBlockedComments.value = {
    ...expandedBlockedComments.value,
    [commentId]: !expandedBlockedComments.value[commentId],
  }
}

async function refreshComments() {
  if (!selected.value) return
  comments.value = await fetchGuestbookComments(selected.value.id)
  selected.value = {
    ...selected.value,
    commentCount: comments.value.length,
  }
  syncEntryInList(selected.value)
}

async function onDeleteComment(comment: GuestbookComment) {
  if (!selected.value || !canDeleteComment(comment)) return
  if (commentActionId.value != null) return
  commentActionId.value = comment.id
  commentError.value = ''
  try {
    await deleteGuestbookComment(selected.value.id, comment.id)
    await refreshComments()
  } catch (err) {
    showCommentError(err instanceof Error ? err.message : '删除评论失败')
  } finally {
    commentActionId.value = null
  }
}

async function onRestoreComment(comment: GuestbookComment) {
  if (!selected.value || !canRestoreComment(comment)) return
  if (commentActionId.value != null) return
  commentActionId.value = comment.id
  commentError.value = ''
  try {
    await blockGuestbookComment(selected.value.id, comment.id)
    delete expandedBlockedComments.value[comment.id]
    await refreshComments()
  } catch (err) {
    showCommentError(err instanceof Error ? err.message : '恢复评论失败')
  } finally {
    commentActionId.value = null
  }
}

async function onBlockComment(comment: GuestbookComment) {
  if (!selected.value || !canBlockComment(comment)) return
  if (commentActionId.value != null) return
  commentActionId.value = comment.id
  commentError.value = ''
  try {
    await blockGuestbookComment(selected.value.id, comment.id)
    await refreshComments()
  } catch (err) {
    showCommentError(err instanceof Error ? err.message : '屏蔽评论失败')
  } finally {
    commentActionId.value = null
  }
}

async function refreshUnreadCount() {
  if (!userAuth.isLoggedIn) {
    unreadCount.value = 0
    lastDmUnread.value = 0
    lastMentionUnread.value = 0
    return
  }
  try {
    const [count, convs, notifications] = await Promise.all([
      fetchGuestbookUnreadCount(),
      fetchGuestbookDmConversations(),
      fetchGuestbookNotifications(),
    ])
    const dmUnread = convs.reduce((sum, c) => sum + (c.unreadCount || 0), 0)
    const mentionUnread = notifications.filter((n) => n.type === 'mention' && !n.isRead).length

    if (dmUnread > lastDmUnread.value && !showingNotifications.value) {
      const hit = convs.find((c) => c.unreadCount > 0)
      if (hit) {
        knockToast.value = { text: `${hit.peerNickname || '有人'} 给你发了消息`, peerId: hit.peerId }
        window.setTimeout(() => {
          if (knockToast.value?.peerId === hit.peerId) knockToast.value = null
        }, 6000)
      }
    }

    if (mentionUnread > lastMentionUnread.value && !showingNotifications.value) {
      const hit = notifications.find((n) => n.type === 'mention' && !n.isRead)
      if (hit) {
        knockToast.value = {
          text: `${hit.actorNickname || '有人'} @ 了你`,
          postId: hit.postId,
        }
        window.setTimeout(() => {
          if (knockToast.value?.postId === hit.postId && !knockToast.value.peerId) {
            knockToast.value = null
          }
        }, 6000)
      }
    }

    lastDmUnread.value = dmUnread
    lastMentionUnread.value = mentionUnread
    unreadCount.value = count
  } catch {
    unreadCount.value = 0
  }
}

function openKnockToastChat() {
  if (!knockToast.value) return
  const toast = knockToast.value
  knockToast.value = null
  if (!open.value) openDrawer()
  if (toast.postId) {
    void openDetail({ id: toast.postId } as GuestbookEntry)
    return
  }
  if (toast.peerId) {
    knockChatPeerId.value = toast.peerId
    openNotifications()
  }
}

async function onCommentCaret(caret: number) {
  commentCaret.value = caret
  const query = parseMentionQuery(commentForm.content, caret)
  if (query === null) {
    mentionOpen.value = false
    mentionResults.value = []
    mentionRecent.value = []
    mentionFollowing.value = []
    return
  }
  if (mentionTimer) clearTimeout(mentionTimer)
  mentionOpen.value = true
  if (!query) {
    mentionRecent.value = loadRecentMentions()
    if (userAuth.isLoggedIn && userAuth.user?.id) {
      try {
        mentionFollowing.value = await fetchGuestbookFollowing(userAuth.user.id)
      } catch {
        mentionFollowing.value = []
      }
    } else {
      mentionFollowing.value = []
    }
    mentionResults.value = []
    return
  }
  mentionTimer = setTimeout(async () => {
    mentionLoading.value = true
    try {
      mentionRecent.value = loadRecentMentions()
      if (userAuth.isLoggedIn && userAuth.user?.id && !mentionFollowing.value.length) {
        try {
          mentionFollowing.value = await fetchGuestbookFollowing(userAuth.user.id)
        } catch {
          mentionFollowing.value = []
        }
      }
      mentionResults.value = await searchGuestbookUsers(query)
    } catch {
      mentionResults.value = []
    } finally {
      mentionLoading.value = false
    }
  }, 200)
}

function pickMention(user: GuestbookSocialUser) {
  pushRecentMention(user)
  const applied = applyMention(commentForm.content, commentCaret.value, user)
  commentForm.content = applied.text
  commentCaret.value = applied.caret
  mentionOpen.value = false
  mentionResults.value = []
  mentionRecent.value = []
  mentionFollowing.value = []
}

function openNotifications() {
  if (!userAuth.isLoggedIn) {
    userAuth.openLoginDialog()
    return
  }
  selected.value = null
  creating.value = false
  showingProfile.value = false
  showingAccount.value = false
  showingModeration.value = false
  showingNotifications.value = true
}

function onKnockUnreadClick() {
  knockJumpUnreadNonce.value += 1
}

function openChatFromProfile(userId: number) {
  knockChatPeerId.value = userId
  showingProfile.value = false
  showingAccount.value = false
  showingNotifications.value = true
}

function closeNotifications() {
  showingNotifications.value = false
  knockChatPeerId.value = null
  void refreshUnreadCount()
}

async function loadModerationEntries() {
  modLoading.value = true
  modError.value = ''
  try {
    modEntries.value = await fetchGuestbookManage(modTab.value)
  } catch (err) {
    modError.value = err instanceof Error ? err.message : '加载管理列表失败'
  } finally {
    modLoading.value = false
  }
}

async function loadSensitiveVisibility() {
  try {
    hideAllSensitive.value = (await fetchGuestbookSensitiveVisibility()).hidden
  } catch {
    hideAllSensitive.value = false
  }
}

async function toggleHideAllSensitive() {
  if (sensitiveSettingBusy.value) return
  sensitiveSettingBusy.value = true
  modError.value = ''
  try {
    const result = await updateGuestbookSensitiveVisibility(!hideAllSensitive.value)
    hideAllSensitive.value = result.hidden
    modMessage.value = result.hidden
      ? '已在前台隐藏所有敏感委托，帖子状态未改变'
      : '已恢复在前台展示敏感委托'
    await loadEntries()
  } catch (err) {
    modError.value = err instanceof Error ? err.message : '更新敏感内容设置失败'
  } finally {
    sensitiveSettingBusy.value = false
  }
}

function selectModTab(value: GuestbookManageStatus) {
  if (modTab.value === value) return
  modTab.value = value
  void loadModerationEntries()
}

function openModeration(section: 'posts' | 'accounts' | 'reports' = 'posts') {
  if (!canManagePosts.value) return
  if (section === 'accounts' && !isAdmin.value) return
  selected.value = null
  creating.value = false
  showingProfile.value = false
  showingAccount.value = false
  showingNotifications.value = false
  manageSection.value = section
  modTab.value = 'normal'
  showingModeration.value = true
  if (section === 'posts') {
    void loadModerationEntries()
    void loadSensitiveVisibility()
  } else if (section === 'reports') {
    void loadModReports()
  }
}

function openModerationReports() {
  showingNotifications.value = false
  openModeration('reports')
}

function openModerationAccounts() {
  showingNotifications.value = false
  openModeration('accounts')
}

function closeModeration() {
  showingModeration.value = false
  manageSection.value = 'posts'
  modMessage.value = ''
  modError.value = ''
}

function selectManageSection(section: 'posts' | 'accounts' | 'reports') {
  if (section === 'accounts' && !isAdmin.value) return
  manageSection.value = section
  modMessage.value = ''
  modError.value = ''
  if (section === 'posts') {
    void loadModerationEntries()
  } else if (section === 'reports') {
    void loadModReports()
  }
}

function modDialogPlaceholder() {
  return modDialog.action === 'delete' ? MOD_MSG_DEFAULT.delete : MOD_MSG_DEFAULT.hide
}

function openModDialog(entry: GuestbookEntry, action: 'hide' | 'delete') {
  modDialog.open = true
  modDialog.action = action
  modDialog.entry = entry
  modDialog.message = ''
  modDialog.busy = false
}

function closeModDialog() {
  modDialog.open = false
  modDialog.entry = null
  modDialog.message = ''
  modDialog.busy = false
}

async function confirmModDialog() {
  const entry = modDialog.entry
  if (!entry || modDialog.busy) return
  modDialog.busy = true
  modMessage.value = ''
  modError.value = ''
  const message = modDialog.message.trim()
  const action = modDialog.action
  try {
    if (action === 'hide') {
      await setGuestbookHidden(entry.id, true, message)
      modMessage.value = `已屏蔽 #${entry.id}`
    } else {
      await deleteGuestbook(entry.id, message)
      modMessage.value = `已删除 #${entry.id}`
      if (selected.value?.id === entry.id) closeDetail()
    }
    closeModDialog()
    await loadModerationEntries()
    await loadEntries()
    if (selected.value?.id === entry.id && action === 'hide') {
      selected.value = await fetchGuestbookPost(entry.id)
    }
  } catch (err) {
    modError.value = err instanceof Error ? err.message : '操作失败'
    modDialog.busy = false
  }
}

async function unhideModPost(entry: GuestbookEntry) {
  modMessage.value = ''
  modError.value = ''
  try {
    await setGuestbookHidden(entry.id, false)
    modMessage.value = `已恢复 #${entry.id}`
    await loadModerationEntries()
    await loadEntries()
    if (selected.value?.id === entry.id) {
      selected.value = await fetchGuestbookPost(entry.id)
    }
  } catch (err) {
    modError.value = err instanceof Error ? err.message : '操作失败'
  }
}

async function toggleModPostHidden(entry: GuestbookEntry) {
  if (entry.isHidden) {
    await unhideModPost(entry)
  } else {
    openModDialog(entry, 'hide')
  }
}

async function restoreModPost(entry: GuestbookEntry) {
  modMessage.value = ''
  modError.value = ''
  try {
    await restoreGuestbook(entry.id)
    modMessage.value = `已恢复 #${entry.id}`
    if (selected.value?.id === entry.id) closeDetail()
    await loadModerationEntries()
    await loadEntries()
  } catch (err) {
    modError.value = err instanceof Error ? err.message : '恢复失败'
  }
}

async function removeModPost(entry: GuestbookEntry) {
  openModDialog(entry, 'delete')
}

async function onModeratorRestoreSelected() {
  if (!selected.value || !canManagePosts.value) return
  await restoreModPost(selected.value)
}

async function onModeratorHideSelected() {
  if (!selected.value || !canManagePosts.value) return
  if (selected.value.isDeleted) {
    await onModeratorRestoreSelected()
    return
  }
  if (selected.value.isHidden) {
    await unhideModPost(selected.value)
  } else {
    openModDialog(selected.value, 'hide')
  }
}

async function onModeratorDeleteSelected() {
  if (!selected.value || !canManagePosts.value) return
  await removeModPost(selected.value)
}

async function toggleModPostSensitive(entry: GuestbookEntry) {
  modMessage.value = ''
  modError.value = ''
  try {
    const updated = await setGuestbookSensitive(entry.id, !entry.isSensitive)
    syncEntryInList(updated)
    modMessage.value = updated.isSensitive ? `已标记敏感 #${entry.id}` : `已取消敏感 #${entry.id}`
    await loadModerationEntries()
    await loadEntries()
  } catch (err) {
    modError.value = err instanceof Error ? err.message : '敏感标记操作失败'
  }
}

async function onModeratorToggleSensitiveSelected() {
  if (!selected.value || !canManagePosts.value || actionBusy.value) return
  actionBusy.value = true
  try {
    await toggleModPostSensitive(selected.value)
  } finally {
    actionBusy.value = false
  }
}

function openCreate() {
  if (!userAuth.isLoggedIn) {
    userAuth.openLoginDialog()
    return
  }
  selected.value = null
  showingProfile.value = false
  showingAccount.value = false
  showingModeration.value = false
  showingNotifications.value = false
  resetCreateForm()
  readDrafts()
  draftPanelOpen.value = false
  markdownPreview.value = false
  creating.value = true
}

function closeCreate() {
  if (!isEditing.value && hasDraftContent() && !saveCurrentDraft()) return
  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer)
    draftSaveTimer = null
  }
  creating.value = false
  editingPostId.value = null
  activeDraftId.value = null
  createError.value = ''
}

function startEdit(post: GuestbookEntry) {
  editingPostId.value = post.id
  activeDraftId.value = null
  form.title = post.title
  form.category = post.category || '灌水'
  form.content = post.content || ''
  form.images = [...(post.images || [])]
  form.isSensitive = Boolean(post.isSensitive)
  form.anonymous = Boolean(post.isAnonymous)
  form.nickname = post.nickname
  selected.value = null
  showingProfile.value = false
  showingAccount.value = false
  creating.value = true
  createError.value = ''
}

function syncEntryInList(post: GuestbookEntry) {
  const idx = entries.value.findIndex((e) => e.id === post.id)
  if (idx >= 0) entries.value[idx] = { ...entries.value[idx], ...post }
  if (selected.value?.id === post.id) selected.value = { ...selected.value, ...post }
}

async function onToggleLike() {
  if (!selected.value || !userAuth.isLoggedIn) {
    userAuth.openLoginDialog()
    return
  }
  if (actionBusy.value) return
  actionBusy.value = true
  try {
    const result = await toggleGuestbookLike(selected.value.id)
    syncEntryInList(result.post)
    void refreshUnreadCount()
    void userAuth.refreshMe()
  } catch (err) {
    showCommentError(err instanceof Error ? err.message : '点赞失败')
  } finally {
    actionBusy.value = false
  }
}

async function onToggleFavorite() {
  if (!selected.value || !userAuth.isLoggedIn) {
    userAuth.openLoginDialog()
    return
  }
  if (actionBusy.value) return
  actionBusy.value = true
  try {
    const result = await toggleGuestbookFavorite(selected.value.id)
    syncEntryInList(result.post)
    void refreshUnreadCount()
  } catch (err) {
    showCommentError(err instanceof Error ? err.message : '收藏失败')
  } finally {
    actionBusy.value = false
  }
}

async function onToggleAdminPin() {
  if (!selected.value || !isAdmin.value) return
  if (actionBusy.value) return
  actionBusy.value = true
  try {
    const post = await setGuestbookPinned(selected.value.id, !selected.value.isPinned)
    syncEntryInList(post)
    await loadEntries()
  } catch (err) {
    showCommentError(err instanceof Error ? err.message : '置顶失败')
  } finally {
    actionBusy.value = false
  }
}

function openAuthorProfile(entry: GuestbookEntry) {
  const entryUid = Number(entry.userId)
  if (!Number.isFinite(entryUid) || entryUid <= 0) return
  const myUid = Number(userAuth.user?.id)
  if (myUid && entryUid === myUid) {
    openProfile()
  } else {
    openProfile(entryUid)
  }
}

function openAnonymousAuthorProfile(entry: GuestbookEntry | GuestbookComment) {
  const id = Number(entry.anonymousAuthor?.id)
  if (!Number.isFinite(id) || id <= 0) return
  if (showingModeration.value && !selected.value) {
    returnToModeration.value = true
  }
  openProfile(id)
}

function openKnockUserProfile(userId: number) {
  const id = Number(userId)
  if (!Number.isFinite(id) || id <= 0) return

  if (showingNotifications.value) {
    returnToNotifications.value = true
    returnToProfileTab.value = null
    returnToModeration.value = false
    showingNotifications.value = false
  } else if (selected.value) {
    returnToDetailAfterProfile.value = true
  } else if (showingProfile.value && profileUserId.value != null) {
    profileStack.value.push(profileUserId.value)
  }

  profileUserId.value = id
  creating.value = false
  showingAccount.value = false
  showingModeration.value = false
  if (!returnToDetailAfterProfile.value) {
    selected.value = null
  }
  showingProfile.value = true
}

function openProfile(userId?: number) {
  const normalized =
    userId != null && Number.isFinite(Number(userId)) && Number(userId) > 0
      ? Number(userId)
      : null
  const mine = Number(userAuth.user?.id)
  const targetId = normalized ?? (Number.isFinite(mine) && mine > 0 ? mine : null)
  if (!targetId) {
    userAuth.openLoginDialog()
    return
  }
  if (!normalized && !userAuth.isLoggedIn) {
    userAuth.openLoginDialog()
    return
  }

  if (showingNotifications.value) {
    returnToNotifications.value = true
    returnToProfileTab.value = null
    returnToModeration.value = false
    showingNotifications.value = false
  } else if (selected.value) {
    returnToDetailAfterProfile.value = true
  } else if (showingProfile.value && profileUserId.value != null) {
    profileStack.value.push(profileUserId.value)
  }

  profileUserId.value = normalized
  creating.value = false
  showingAccount.value = false
  showingModeration.value = false
  if (!returnToDetailAfterProfile.value) {
    selected.value = null
  }
  showingProfile.value = true
}

function closeProfile() {
  if (profileStack.value.length) {
    profileUserId.value = profileStack.value.pop()!
    return
  }
  showingProfile.value = false
  profileUserId.value = null
  profileDisplayName.value = ''
  if (returnToNotifications.value) {
    showingNotifications.value = true
    returnToNotifications.value = false
    void refreshUnreadCount()
    return
  }
  if (returnToDetailAfterProfile.value) {
    returnToDetailAfterProfile.value = false
    return
  }
  if (returnToModeration.value) {
    showingModeration.value = true
    returnToModeration.value = false
    void loadModerationEntries()
  }
}

function openAccountCenter() {
  if (!userAuth.isLoggedIn) {
    userAuth.openLoginDialog()
    return
  }
  selected.value = null
  creating.value = false
  showingProfile.value = false
  showingAccount.value = true
}

function closeAccountCenter() {
  showingAccount.value = false
}

function backToProfileFromAccount() {
  showingAccount.value = false
  showingProfile.value = true
}

async function logoutFromProfile() {
  await userAuth.logout()
  showingProfile.value = false
  showingAccount.value = false
}

async function onPickFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return

  const remain = IMAGE_MAX - form.images.length
  if (remain <= 0) {
    createError.value = `最多上传 ${IMAGE_MAX} 张图片`
    return
  }

  uploading.value = true
  createError.value = ''
  try {
    for (const file of files.slice(0, remain)) {
      const uploaded = await uploadGuestbookImage(file)
      form.images.push(uploaded.url)
    }
  } catch (err) {
    createError.value = err instanceof Error ? err.message : '图片上传失败'
  } finally {
    uploading.value = false
  }
}

function removeImage(index: number) {
  form.images.splice(index, 1)
}

async function submitPost() {
  createError.value = ''
  if (!userAuth.isLoggedIn) {
    userAuth.openLoginDialog()
    return
  }
  if (!form.title.trim()) {
    createError.value = '请输入标题'
    return
  }
  if (!form.content.trim() && form.images.length === 0) {
    createError.value = '请填写正文或至少上传一张图片'
    return
  }

  submitting.value = true
  try {
    const payload = {
      nickname: form.anonymous
        ? '匿名'
        : userAuth.isLoggedIn
          ? userAuth.user?.nickname
          : form.nickname.trim() || undefined,
      anonymous: form.anonymous,
      title: form.title.trim(),
      category: form.category,
      content: form.content.trim(),
      images: form.images,
      isSensitive: form.isSensitive,
      notify: showNotifyPublishToggle.value ? form.notifyPublish : undefined,
    }
    const saved = editingPostId.value
      ? await updateGuestbook(editingPostId.value, payload)
      : await createGuestbook(payload)
    if (activeDraftId.value) {
      drafts.value = drafts.value.filter((draft) => draft.id !== activeDraftId.value)
      persistDrafts()
    }
    creating.value = false
    editingPostId.value = null
    activeDraftId.value = null
    await loadEntries()
    await openDetail(saved)
    void userAuth.refreshMe()
  } catch (err) {
    createError.value = err instanceof Error ? err.message : editingPostId.value ? '保存失败' : '发布失败'
  } finally {
    submitting.value = false
  }
}

async function submitComment() {
  if (!selected.value) return
  if (!userAuth.isLoggedIn) {
    userAuth.openLoginDialog()
    return
  }
  commentError.value = ''
  const content = commentForm.content.trim()
  const images = [...commentForm.images]
  if (!content && !images.length) {
    showCommentError('请填写评论或添加图片')
    return
  }

  commenting.value = true
  try {
    const payloadContent = commentQuote.value
      ? attachQuote(commentQuote.value, content)
      : content
    await createGuestbookComment(selected.value.id, {
      nickname: commentForm.anonymous
        ? '匿名'
        : userAuth.isLoggedIn
          ? userAuth.user?.nickname
          : commentForm.nickname.trim() || undefined,
      content: payloadContent,
      images,
      anonymous: commentForm.anonymous,
    })
    commentForm.content = ''
    commentForm.images = []
    commentForm.anonymous = false
    commentQuote.value = null
    mentionOpen.value = false
    comments.value = await fetchGuestbookComments(selected.value.id)
    selected.value = {
      ...selected.value,
      commentCount: comments.value.length,
    }
    syncEntryInList(selected.value)
    void loadEntries()
    void refreshUnreadCount()
    void userAuth.refreshMe()
  } catch (err) {
    showCommentError(err instanceof Error ? err.message : '评论失败')
  } finally {
    commenting.value = false
  }
}

function openDrawer() {
  open.value = true
  void refreshUnreadCount()
  if (userAuth.isLoggedIn) {
    void checkInGuestbook()
      .then(() => userAuth.refreshMe())
      .catch(() => {
        /* 已打卡或网络失败时忽略 */
      })
  }
}

function closeDrawer() {
  open.value = false
  selected.value = null
  creating.value = false
  showingProfile.value = false
  showingAccount.value = false
  showingModeration.value = false
  showingNotifications.value = false
  if (
    route.query.guestbook ||
    route.query.post ||
    route.query.profile ||
    route.query.account
  ) {
    void router.replace({ path: route.path, query: {} })
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !open.value) return
  if (modDialog.open) {
    closeModDialog()
    return
  }
  if (selected.value) {
    closeDetail()
    return
  }
  if (creating.value) {
    closeCreate()
    return
  }
  if (showingAccount.value) {
    backToProfileFromAccount()
    return
  }
  if (showingProfile.value) {
    closeProfile()
    return
  }
  if (showingModeration.value) {
    closeModeration()
    return
  }
  if (showingNotifications.value) {
    closeNotifications()
    return
  }
  closeDrawer()
}

async function handleRouteOpen() {
  if (
    route.query.guestbook !== '1' &&
    !route.query.post &&
    route.query.profile !== '1' &&
    route.query.account !== '1'
  ) {
    return
  }
  open.value = true
  await loadEntries()
  if (route.query.account === '1') {
    if (userAuth.isLoggedIn) openAccountCenter()
    else userAuth.openLoginDialog()
    return
  }
  if (route.query.profile === '1') {
    if (userAuth.isLoggedIn) openProfile()
    else userAuth.openLoginDialog()
    return
  }
  const postId = Number(route.query.post)
  if (Number.isFinite(postId) && postId > 0) {
    const found = entries.value.find((e) => e.id === postId)
    if (found) await openDetail(found)
  }
}

watch(open, (isOpen) => {
  document.body.style.overflow = isOpen ? 'hidden' : ''
  if (isOpen && !loadedOnce.value) void loadEntries()
  if (isOpen) {
    void refreshUnreadCount()
    void nextTick(() => bindMasonryObserver())
  }
})

let unreadTimer: ReturnType<typeof setInterval> | null = null
let globalUnreadTimer: ReturnType<typeof setInterval> | null = null
watch(open, (isOpen) => {
  if (unreadTimer) {
    clearInterval(unreadTimer)
    unreadTimer = null
  }
  if (isOpen && userAuth.isLoggedIn) {
    unreadTimer = setInterval(() => void refreshUnreadCount(), 30000)
  }
})

watch(
  () => userAuth.isLoggedIn,
  (loggedIn) => {
    if (globalUnreadTimer) {
      clearInterval(globalUnreadTimer)
      globalUnreadTimer = null
    }
    if (loggedIn) {
      void refreshUnreadCount()
      globalUnreadTimer = setInterval(() => void refreshUnreadCount(), 15000)
    } else {
      lastDmUnread.value = 0
      knockToast.value = null
    }
  },
  { immediate: true },
)

watch(
  () => userAuth.user?.nickname,
  (name) => {
    if (!name) return
    if (!form.anonymous) form.nickname = name
    commentForm.nickname = name
  },
  { immediate: true },
)

watch(
  () => [
    form.nickname,
    form.title,
    form.category,
    form.content,
    form.anonymous,
    form.notifyPublish,
    form.isSensitive,
    ...form.images,
  ],
  () => {
    if (!creating.value || isEditing.value || !hasDraftContent()) return
    if (draftSaveTimer) clearTimeout(draftSaveTimer)
    draftSaveTimer = setTimeout(() => {
      saveCurrentDraft({ silent: true })
      draftSaveTimer = null
    }, 600)
  },
)

watch(
  () =>
    [route.query.guestbook, route.query.post, route.query.profile, route.query.account] as const,
  () => {
    void handleRouteOpen()
  },
)

watch(drawerWidth, () => {
  void nextTick(() => updateMasonryColumnCount())
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onWindowResize)
  document.addEventListener('click', closeCommentMenu)
  window.addEventListener('scroll', closeCommentMenu, true)
  void handleRouteOpen()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onWindowResize)
  document.removeEventListener('click', closeCommentMenu)
  window.removeEventListener('scroll', closeCommentMenu, true)
  masonryResizeObserver?.disconnect()
  masonryResizeObserver = null
  document.body.style.overflow = ''
  if (unreadTimer) clearInterval(unreadTimer)
  if (globalUnreadTimer) clearInterval(globalUnreadTimer)
  if (draftSaveTimer) clearTimeout(draftSaveTimer)
  if (commentErrorTimer) clearTimeout(commentErrorTimer)
})
</script>

<template>
  <Teleport to="body">
    <button
      v-show="!open"
      type="button"
      class="gb-edge-tab"
      aria-label="打开留言板"
      @click="openDrawer"
    >
      <span class="gb-edge-tab__text">留言板</span>
    </button>

    <div v-if="knockToast" class="gb-knock-toast" role="status">
      <span>{{ knockToast.text }}</span>
      <button type="button" @click="openKnockToastChat">查看</button>
      <button type="button" class="gb-knock-toast__close" aria-label="关闭" @click="knockToast = null">×</button>
    </div>

    <button
      v-show="open"
      type="button"
      class="gb-backdrop"
      aria-label="关闭留言板"
      @click="closeDrawer"
    />

    <aside
      class="gb-drawer"
      :class="{ 'gb-drawer--open': open, 'gb-drawer--resizing': resizing }"
      :style="drawerStyle"
      aria-label="留言板"
      :aria-hidden="!open"
    >
      <div
        class="gb-resize-handle"
        title="拖动调整宽度"
        aria-label="拖动调整留言板宽度"
        @pointerdown="onResizePointerDown"
      />
      <!-- 绳网式大字滚动背景 -->
      <div
        class="gb-marquee"
        :class="{ 'is-running': open && !selected }"
        aria-hidden="true"
      >
        <div class="gb-marquee__band">
          <div class="gb-marquee__row gb-marquee__row--ltr">
            <div class="gb-marquee__track">
              <span class="gb-marquee__text">{{ marqueeLine }}</span>
              <span class="gb-marquee__text">{{ marqueeLine }}</span>
            </div>
          </div>
          <div class="gb-marquee__row gb-marquee__row--rtl">
            <div class="gb-marquee__track">
              <span class="gb-marquee__text">{{ marqueeLine }}</span>
              <span class="gb-marquee__text">{{ marqueeLine }}</span>
            </div>
          </div>
          <div class="gb-marquee__row gb-marquee__row--ltr gb-marquee__row--offset">
            <div class="gb-marquee__track">
              <span class="gb-marquee__text">{{ marqueeLine }}</span>
              <span class="gb-marquee__text">{{ marqueeLine }}</span>
            </div>
          </div>
        </div>
      </div>

      <header class="gb-header">
        <div class="gb-header__lead">
          <template v-if="userAuth.isLoggedIn && !showingModeration">
            <button type="button" class="gb-user" @click="openProfile()">
              <GuestbookUserChip
                :nickname="userAuth.user?.nickname || '旅人'"
                :avatar="userAuth.user?.avatar"
                :level="userAuth.user?.level"
                :exp="userAuth.user?.exp"
                :is-banned="Boolean(userAuth.user?.isBanned)"
                @open-ban="openSelfBanDialog"
              />
            </button>
          </template>
          <h2 v-else-if="showingModeration" class="gb-header__title">留言板管理</h2>
        </div>
        <div class="gb-header__actions">
          <template v-if="userAuth.isLoggedIn">
            <button
              v-if="userAuth.isLoggedIn && !showingModeration"
              type="button"
              class="gb-knock-btn"
              aria-label="敲敲"
              @click="openNotifications"
            >
              敲敲
              <span v-if="unreadCount" class="gb-knock-badge gb-knock-badge--dot" aria-label="有未读" />
            </button>
            <button
              v-if="userAuth.user?.isGuestbookModerator && !showingModeration"
              type="button"
              class="gb-post-btn ghost"
              :class="{ 'is-active': moderatorModeOn }"
              @click="toggleModeratorMode"
            >
              {{ moderatorModeOn ? '管理员模式' : '普通模式' }}
            </button>
            <button
              v-if="canManagePosts && !showingModeration"
              type="button"
              class="gb-post-btn ghost"
              @click="openModeration()"
            >
              管理
            </button>
            <button
              v-if="!showingModeration"
              type="button"
              class="gb-post-btn ghost"
              @click="userAuth.logout()"
            >
              退出
            </button>
          </template>
          <button
            v-else
            type="button"
            class="gb-post-btn ghost"
            @click="userAuth.openLoginDialog()"
          >
            登录
          </button>
          <button
            v-if="showingModeration"
            type="button"
            class="gb-post-btn ghost"
            @click="closeModeration()"
          >
            返回
          </button>
          <button
            v-if="!showingModeration && userAuth.isLoggedIn"
            type="button"
            class="gb-post-btn"
            @click="openCreate"
          >
            发帖
          </button>
          <span v-if="!showingModeration" class="gb-count">
            {{ entries.length }}
          </span>
          <button type="button" class="gb-close ik-dialog__close" aria-label="关闭" @click="closeDrawer">
            <img src="/images/close-btn.webp" alt="" class="ik-dialog__close-img" draggable="false" />
          </button>
        </div>
      </header>

      <section v-if="showingModeration" class="gb-feed gb-feed--mod">
        <nav class="gb-tabs gb-tabs--manage-section" aria-label="管理分区">
          <button
            type="button"
            class="gb-tab"
            :class="{ 'gb-tab--active': manageSection === 'posts' }"
            @click="selectManageSection('posts')"
          >
            委托
          </button>
          <button
            v-if="isAdmin"
            type="button"
            class="gb-tab"
            :class="{ 'gb-tab--active': manageSection === 'accounts' }"
            @click="selectManageSection('accounts')"
          >
            账号
          </button>
          <button
            v-if="canManagePosts"
            type="button"
            class="gb-tab"
            :class="{ 'gb-tab--active': manageSection === 'reports' }"
            @click="selectManageSection('reports')"
          >
            举报
          </button>
        </nav>

        <template v-if="manageSection === 'posts'">
          <p v-if="modMessage" class="gb-hint ok">{{ modMessage }}</p>
          <p v-if="modError" class="gb-hint err">{{ modError }}</p>

          <nav class="gb-tabs" aria-label="委托筛选">
            <button
              v-for="tab in modTabs"
              :key="tab.value"
              type="button"
              class="gb-tab"
              :class="{ 'gb-tab--active': modTab === tab.value }"
              @click="selectModTab(tab.value)"
            >
              {{ tab.label }}
            </button>
          </nav>
          <div class="gb-sensitive-global">
            <div>
              <strong>屏蔽所有敏感内容</strong>
              <span>开启后前台不显示敏感委托，但不会改变帖子屏蔽状态</span>
            </div>
            <button
              type="button"
              class="switch switch--prominent"
              :class="{ on: hideAllSensitive }"
              role="switch"
              :aria-checked="hideAllSensitive"
              :disabled="sensitiveSettingBusy"
              @click="toggleHideAllSensitive"
            >
              <span class="switch-knob" />
              <span class="switch-text">{{ hideAllSensitive ? '已屏蔽' : '展示中' }}</span>
            </button>
          </div>

          <p v-if="modLoading" class="gb-empty">加载中…</p>
          <p v-else-if="!modEntries.length" class="gb-empty">暂无委托</p>
          <ul v-else class="gb-grid">
            <li
              v-for="item in modEntries"
              :key="item.id"
              class="gb-card"
              :class="{ 'is-active': selected?.id === item.id, 'is-hidden': item.isHidden, 'is-deleted': item.isDeleted }"
              @click="openDetail(item)"
            >
              <div class="gb-card__shell">
                <div class="gb-card__inner">
                  <div
                    class="gb-card__cover gb-card__cover--img"
                    :style="{ '--cover-hue': String(coverTone(item)) }"
                  >
                    <GuestbookSensitiveMedia
                      :post-id="item.id"
                      :is-sensitive="item.isSensitive"
                      :src="coverUrl(item)"
                      img-class="gb-card__cover-img"
                      loading="lazy"
                    />
                    <span class="gb-card__stats">👁 {{ item.viewCount ?? 0 }} 💬 {{ item.commentCount ?? 0 }}</span>
                    <span v-if="item.isPinned" class="gb-card__pin">置顶</span>
                    <span v-if="item.isSensitive" class="gb-card__status gb-card__status--sensitive">敏感</span>
                    <span v-if="item.isHidden" class="gb-card__status">已屏蔽</span>
                    <span v-if="item.isDeleted" class="gb-card__status gb-card__status--deleted">已删除</span>
                    <span v-if="item.restoreRequestedAt" class="gb-card__restore-req">申请恢复</span>
                  </div>

                  <div class="gb-card__body">
                    <div
                      class="gb-card__author"
                      :class="{ 'is-clickable': item.userId }"
                      @click.stop="item.userId && openAuthorProfile(item)"
                    >
                      <span class="gb-avatar-shell">
                        <span
                          v-if="authorAvatarUrl(item.avatar)"
                          class="gb-avatar gb-avatar--img"
                          aria-hidden="true"
                        >
                          <img :src="authorAvatarUrl(item.avatar)" alt="" />
                        </span>
                        <span
                          v-else
                          class="gb-avatar"
                          :style="{ '--tone': String(avatarTone(item.nickname)) }"
                          aria-hidden="true"
                        >
                          {{ avatarLetter(item.nickname) }}
                        </span>
                      </span>
                      <div class="gb-card__author-block">
                        <strong class="gb-name">{{ item.nickname }}</strong>
                        <span class="gb-author-line" />
                      </div>
                    </div>
                    <button
                      v-if="item.anonymousAuthor"
                      type="button"
                      class="gb-anonymous-author"
                      @click.stop="openAnonymousAuthorProfile(item)"
                    >
                      <span class="gb-anonymous-author__avatar">
                        <img
                          v-if="authorAvatarUrl(item.anonymousAuthor.avatar)"
                          :src="authorAvatarUrl(item.anonymousAuthor.avatar)"
                          alt=""
                        />
                        <span v-else>{{ avatarLetter(item.anonymousAuthor.nickname) }}</span>
                      </span>
                      <span>
                        {{ item.anonymousAuthor.nickname }}
                        <small>UID {{ item.anonymousAuthor.uid }}</small>
                      </span>
                    </button>
                    <p class="gb-card__title">
                      <span class="gb-cat">[{{ item.category || '灌水' }}]</span>
                      {{ item.title || '无标题' }}
                    </p>
                    <div class="gb-mod-card__actions" @click.stop>
                      <template v-if="modTab === 'normal' || modTab === 'sensitive'">
                        <button type="button" class="gb-detail__action" @click="toggleModPostSensitive(item)">
                          {{ item.isSensitive ? '取消敏感' : '标记敏感' }}
                        </button>
                        <button type="button" class="gb-detail__action" @click="toggleModPostHidden(item)">
                          屏蔽
                        </button>
                        <button type="button" class="gb-detail__action danger" @click="removeModPost(item)">
                          删除
                        </button>
                      </template>
                      <template v-else-if="modTab === 'hidden'">
                        <button type="button" class="gb-detail__action" @click="toggleModPostSensitive(item)">
                          {{ item.isSensitive ? '取消敏感' : '标记敏感' }}
                        </button>
                        <button type="button" class="gb-detail__action" @click="toggleModPostHidden(item)">
                          恢复
                        </button>
                        <button type="button" class="gb-detail__action danger" @click="removeModPost(item)">
                          删除
                        </button>
                      </template>
                      <template v-else>
                        <button type="button" class="gb-detail__action" @click="toggleModPostSensitive(item)">
                          {{ item.isSensitive ? '取消敏感' : '标记敏感' }}
                        </button>
                        <button type="button" class="gb-detail__action" @click="restoreModPost(item)">
                          恢复
                        </button>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </template>

        <GuestbookAccountManagePanel v-else-if="manageSection === 'accounts' && isAdmin" class="gb-acc-manage" />

        <template v-else-if="manageSection === 'reports'">
          <p v-if="modMessage" class="gb-hint ok">{{ modMessage }}</p>
          <p v-if="modError" class="gb-hint err">{{ modError }}</p>

          <nav class="gb-tabs" aria-label="举报类型">
            <button
              type="button"
              class="gb-tab"
              :class="{ 'gb-tab--active': modReportTarget === 'all' }"
              @click="modReportTarget = 'all'; loadModReports()"
            >
              全部
            </button>
            <button
              type="button"
              class="gb-tab"
              :class="{ 'gb-tab--active': modReportTarget === 'post' }"
              @click="modReportTarget = 'post'; loadModReports()"
            >
              帖子
            </button>
            <button
              type="button"
              class="gb-tab"
              :class="{ 'gb-tab--active': modReportTarget === 'comment' }"
              @click="modReportTarget = 'comment'; loadModReports()"
            >
              评论
            </button>
            <button
              v-if="isAdmin"
              type="button"
              class="gb-tab"
              :class="{ 'gb-tab--active': modReportTarget === 'user' }"
              @click="modReportTarget = 'user'; loadModReports()"
            >
              用户
            </button>
          </nav>

          <nav class="gb-tabs" aria-label="处理状态">
            <button
              type="button"
              class="gb-tab"
              :class="{ 'gb-tab--active': modReportStatus === 'pending' }"
              @click="modReportStatus = 'pending'; loadModReports()"
            >
              未处理
            </button>
            <button
              type="button"
              class="gb-tab"
              :class="{ 'gb-tab--active': modReportStatus === 'handled' }"
              @click="modReportStatus = 'handled'; loadModReports()"
            >
              已处理
            </button>
          </nav>

          <p v-if="modReportsLoading" class="gb-empty">加载举报…</p>
          <p v-else-if="!modReports.length" class="gb-empty">
            {{ modReportStatus === 'pending' ? '暂无待处理举报' : '暂无已处理举报' }}
          </p>
          <ul v-else class="gb-report-list">
            <li v-for="report in modReports" :key="report.id" class="gb-report-item">
              <div class="gb-report-item__main">
                <strong>
                  #{{ report.id }} ·
                  {{
                    report.targetType === 'comment'
                      ? '评论'
                      : report.targetType === 'user'
                        ? '用户'
                        : '帖子'
                  }}
                  <span
                    class="gb-report-item__status"
                    :class="report.status === 'handled' ? 'is-handled' : 'is-pending'"
                  >
                    {{ report.status === 'handled' ? '已处理' : '未处理' }}
                  </span>
                </strong>
                <span v-if="report.targetType === 'user'">
                  {{ report.reporterNickname }} 举报了用户「{{ report.reportedUserNickname || '用户' }}」
                </span>
                <span v-else>
                  {{ report.reporterNickname }} 举报了「{{
                    formatMessagePreview(report.postTitle || '') || '无标题'
                  }}」
                </span>
                <span v-if="report.targetType === 'comment' && report.commentPreview" class="gb-report-item__preview">
                  评论：{{ formatMessagePreview(report.commentPreview) || report.commentPreview }}
                </span>
                <span v-if="report.reason" class="gb-report-item__reason">
                  原因：{{ formatMessagePreview(report.reason) || report.reason }}
                </span>
                <span v-if="report.handlerMessage" class="gb-report-item__feedback">
                  反馈：{{ formatMessagePreview(report.handlerMessage) || report.handlerMessage }}
                </span>
                <time>{{ formatRelativeTime(report.createdAt) }}</time>
              </div>
              <div class="gb-report-item__actions">
                <button type="button" class="gb-detail__action" @click="openReportTarget(report)">
                  {{
                    report.targetType === 'comment'
                      ? '定位评论'
                      : report.targetType === 'user'
                        ? '查看用户'
                        : '查看帖子'
                  }}
                </button>
                <button
                  v-if="report.status === 'pending'"
                  type="button"
                  class="gb-detail__action"
                  :disabled="handleReportDialog.busy"
                  @click="onHandleReport(report)"
                >
                  处理
                </button>
              </div>
            </li>
          </ul>
        </template>
      </section>

      <template v-else>
        <div ref="feedScrollRef" class="gb-feed">
          <form class="gb-search" :class="{ 'has-filters': filtersApplied }" @submit.prevent="applySearch">
            <div class="gb-search__bar">
              <div class="gb-search__ranges" role="group" aria-label="时间筛选">
                <button
                  v-for="tab in dateRangeTabs"
                  :key="tab.value || 'all-time'"
                  type="button"
                  class="gb-search__range"
                  :class="{ 'is-active': dateRange === tab.value }"
                  @click="selectDateRange(tab.value)"
                >
                  {{ tab.label }}
                </button>
              </div>

              <label class="gb-search__field gb-search__field--q">
                <span class="gb-search__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
                    <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="2" />
                    <path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="square" />
                  </svg>
                </span>
                <span class="sr-only">搜索</span>
                <input
                  v-model="searchKeyword"
                  class="gb-search__input"
                  type="search"
                  maxlength="80"
                  placeholder="搜索标题 / 正文 / 昵称"
                  enterkeyhint="search"
                />
              </label>

              <div class="gb-search__actions">
                <button type="submit" class="gb-search__btn">检索</button>
                <button
                  type="button"
                  class="gb-search__clear"
                  :disabled="!hasActiveFilters && !filtersApplied"
                  aria-label="清除筛选"
                  @click="clearSearch"
                >
                  ×
                </button>
              </div>
            </div>
            <p v-if="resultCountText" class="gb-search__hint">{{ resultCountText }}</p>
          </form>

          <nav class="gb-tabs gb-tabs--cats" aria-label="分类筛选">
            <template v-for="(tab, idx) in categoryTabs" :key="tab.type === 'separator' ? `sep-${idx}` : tab.value || 'all'">
              <span v-if="tab.type === 'separator'" class="gb-tab-sep gb-tab-sep--v" aria-hidden="true">|</span>
              <button
                v-else
                type="button"
                class="gb-tab"
                :class="{ 'gb-tab--active': activeCategory === tab.value }"
                @click="selectCategory(tab.value)"
              >
                {{ tab.label }}
              </button>
            </template>
          </nav>

          <p v-if="loading" class="gb-empty">加载中…</p>
          <p v-else-if="!entries.length && !error" class="gb-empty">
            {{ filtersApplied ? '没有找到符合条件的帖子' : '还没有帖子，来发第一条吧' }}
          </p>
          <p v-else-if="error && !entries.length" class="gb-empty err">{{ error }}</p>
          <div v-else ref="masonryGridRef" class="gb-masonry">
            <ul
              v-for="(col, colIndex) in feedMasonryColumns"
              :key="`feed-col-${colIndex}`"
              class="gb-masonry__col"
            >
            <li
              v-for="item in col"
              :key="item.id"
              class="gb-card"
              :class="{ 'is-active': selected?.id === item.id }"
              @click="openDetail(item)"
            >
              <div class="gb-card__shell">
                <div class="gb-card__inner">
                  <div
                    class="gb-card__cover gb-card__cover--img"
                    :style="{ '--cover-hue': String(coverTone(item)) }"
                  >
                    <GuestbookSensitiveMedia
                      :post-id="item.id"
                      :is-sensitive="item.isSensitive"
                      :src="coverUrl(item)"
                      img-class="gb-card__cover-img"
                      loading="lazy"
                    />
                    <span class="gb-card__stats">👁 {{ item.viewCount ?? 0 }} 💬 {{ item.commentCount ?? 0 }}</span>
                    <span v-if="item.isPinned" class="gb-card__pin">置顶</span>
                  </div>

                  <div class="gb-card__body">
                    <div
                    class="gb-card__author"
                    :class="{ 'is-clickable': item.userId }"
                    @click.stop="item.userId && openAuthorProfile(item)"
                  >
                      <span class="gb-avatar-shell">
                        <span
                          v-if="authorAvatarUrl(item.avatar)"
                          class="gb-avatar gb-avatar--img"
                          aria-hidden="true"
                        >
                          <img :src="authorAvatarUrl(item.avatar)" alt="" />
                        </span>
                        <span
                          v-else
                          class="gb-avatar"
                          :style="{ '--tone': String(avatarTone(item.nickname)) }"
                          aria-hidden="true"
                        >
                          {{ avatarLetter(item.nickname) }}
                        </span>
                      </span>
                      <div class="gb-card__author-block">
                        <strong class="gb-name">{{ item.nickname }}</strong>
                        <span class="gb-author-line" />
                      </div>
                    </div>
                    <p class="gb-card__title" :class="{ 'is-viewed': item.viewedByMe }">
                      <span class="gb-cat">[{{ item.category || '灌水' }}]</span>
                      {{ item.title || '无标题' }}
                    </p>
                  </div>
                </div>
              </div>
            </li>
            </ul>
          </div>
        </div>
      </template>

      <Transition name="gb-detail">
        <div v-if="selected" class="gb-detail" role="dialog" aria-modal="true">
          <button type="button" class="gb-detail__mask" aria-label="关闭详情" @click="closeDetail" />
          <div class="gb-detail__backdrop" aria-hidden="true" />
          <div class="gb-detail__stripe" aria-hidden="true" />
          <div class="gb-detail__dialog">
            <div class="gb-detail__outer">
              <div class="gb-detail__inner">
                <header class="gb-detail__top">
                  <div
                    class="gb-detail__author"
                    :class="{ 'is-clickable': selected.userId }"
                    @click="selected.userId && openAuthorProfile(selected)"
                  >
                    <span class="gb-detail__avatar-shell">
                      <span
                        v-if="authorAvatarUrl(selected.avatar)"
                        class="gb-avatar gb-avatar--lg gb-avatar--img"
                      >
                        <img :src="authorAvatarUrl(selected.avatar)" alt="" />
                      </span>
                      <span
                        v-else
                        class="gb-avatar gb-avatar--lg"
                        :style="{ '--tone': String(avatarTone(selected.nickname)) }"
                      >
                        {{ avatarLetter(selected.nickname) }}
                      </span>
                    </span>
                    <div class="gb-detail__author-text">
                      <div class="gb-detail__name-row">
                        <strong>{{ selected.nickname }}</strong>
                        <span v-if="!selected.isAnonymous" class="gb-lv">Lv.{{ selected.level ?? 1 }}</span>
                        <button
                          v-if="selected.anonymousAuthor"
                          type="button"
                          class="gb-anonymous-author gb-anonymous-author--inline"
                          @click.stop="openAnonymousAuthorProfile(selected)"
                        >
                          <span class="gb-anonymous-author__avatar">
                            <img
                              v-if="authorAvatarUrl(selected.anonymousAuthor.avatar)"
                              :src="authorAvatarUrl(selected.anonymousAuthor.avatar)"
                              alt=""
                            />
                            <span v-else>{{ avatarLetter(selected.anonymousAuthor.nickname) }}</span>
                          </span>
                          <span>
                            {{ selected.anonymousAuthor.nickname }}
                            <small>UID {{ selected.anonymousAuthor.uid }}</small>
                          </span>
                        </button>
                      </div>
                      <p>
                        {{ formatRelativeTime(selected.createdAt) }}
                        · 👁 {{ selected.viewCount ?? 0 }} 浏览
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="gb-detail__close"
                    aria-label="关闭"
                    @click="closeDetail"
                  >
                    ×
                  </button>
                </header>

                <div class="gb-detail__main">
                  <!-- 帖子内容区背后的绳网大字跑马灯 -->
                  <div class="gb-marquee gb-detail__marquee" :class="{ 'is-running': !!selected }" aria-hidden="true">
                    <div class="gb-marquee__band">
                      <div class="gb-marquee__row gb-marquee__row--ltr">
                        <div class="gb-marquee__track">
                          <span class="gb-marquee__text">{{ marqueeLine }}</span>
                          <span class="gb-marquee__text">{{ marqueeLine }}</span>
                        </div>
                      </div>
                      <div class="gb-marquee__row gb-marquee__row--rtl">
                        <div class="gb-marquee__track">
                          <span class="gb-marquee__text">{{ marqueeLine }}</span>
                          <span class="gb-marquee__text">{{ marqueeLine }}</span>
                        </div>
                      </div>
                      <div class="gb-marquee__row gb-marquee__row--ltr gb-marquee__row--offset">
                        <div class="gb-marquee__track">
                          <span class="gb-marquee__text">{{ marqueeLine }}</span>
                          <span class="gb-marquee__text">{{ marqueeLine }}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <nav class="gb-detail__mobile-tabs" aria-label="详情分区">
                    <button
                      type="button"
                      class="gb-detail__mobile-tab"
                      :class="{ 'is-active': detailMobileTab === 'post' }"
                      @click="detailMobileTab = 'post'"
                    >
                      正文
                    </button>
                    <button
                      type="button"
                      class="gb-detail__mobile-tab"
                      :class="{ 'is-active': detailMobileTab === 'comments' }"
                      @click="detailMobileTab = 'comments'"
                    >
                      评论 ({{ comments.length }})
                    </button>
                  </nav>

                  <div class="gb-detail__split">
                  <section class="gb-detail__left" :class="{ 'is-active': detailMobileTab === 'post' }">
                    <div class="gb-detail__left-scroll">
                      <div class="gb-detail__cover-wrap">
                        <div class="gb-detail__cover-border">
                          <div
                            class="gb-detail__cover-stage"
                            :style="{ '--cover-hue': String(coverTone(selected)) }"
                          >
                            <button
                              v-if="selectedDetailImages.length > 1"
                              type="button"
                              class="gb-detail__cover-nav gb-detail__cover-nav--prev"
                              :disabled="detailImageIndex <= 0"
                              aria-label="上一张"
                              @click.stop="prevDetailImage"
                            >
                              ‹
                            </button>
                            <button
                              type="button"
                              class="gb-detail__cover gb-detail__cover--btn"
                              title="点击查看大图"
                              @click.stop="openPostImages(detailImageIndex)"
                              @dblclick.prevent="openPostImages(detailImageIndex)"
                            >
                              <GuestbookSensitiveMedia
                                :post-id="selected.id"
                                :is-sensitive="selected.isSensitive"
                                :src="detailImageUrl"
                              />
                            </button>
                            <button
                              v-if="selectedDetailImages.length > 1"
                              type="button"
                              class="gb-detail__cover-nav gb-detail__cover-nav--next"
                              :disabled="detailImageIndex >= selectedDetailImages.length - 1"
                              aria-label="下一张"
                              @click.stop="nextDetailImage"
                            >
                              ›
                            </button>
                            <span
                              v-if="selectedDetailImages.length > 1"
                              class="gb-detail__cover-counter"
                            >
                              {{ detailImageIndex + 1 }}/{{ selectedDetailImages.length }}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div v-if="selectedDetailImages.length > 1" class="gb-detail__gallery">
                        <button
                          v-for="(img, i) in selectedDetailImages"
                          :key="img + i"
                          type="button"
                          class="gb-detail__gallery-btn"
                          :class="{ 'is-active': i === detailImageIndex }"
                          title="单击切换，再点查看大图"
                          @click="onGalleryThumbClick(i)"
                          @dblclick.prevent="openPostImages(i)"
                        >
                          <GuestbookSensitiveMedia
                            :post-id="selected.id"
                            :is-sensitive="selected.isSensitive"
                            :src="resolveAssetUrl(img) || ''"
                          />
                        </button>
                      </div>
                      <div :id="'gb-post-' + selected.id" class="gb-detail__text">
                        <div
                          v-if="selected.moderationMessage && (isPostAuthor || canManagePosts)"
                          class="gb-detail__moderation"
                        >
                          <strong>{{
                            selected.isDeleted ? '委托已删除' : selected.isHidden ? '委托已屏蔽' : '管理员留言'
                          }}</strong>
                          <p>{{ selected.moderationMessage }}</p>
                        </div>
                        <h3 class="gb-detail__title">
                          <span class="gb-detail__title-cat"
                            >[ {{ selected.category || '灌水' }} ]</span
                          >
                          {{ selected.title || '无标题' }}
                        </h3>
                        <div
                          v-if="selectedContentHtml"
                          class="gb-detail__content"
                          v-html="selectedContentHtml"
                        />
                        <p v-else class="gb-detail__content gb-detail__content--empty">暂无正文</p>
                      </div>
                    </div>
                  </section>

                  <section class="gb-detail__right" :class="{ 'is-active': detailMobileTab === 'comments' }">
                    <div class="gb-comments">
                      <p v-if="commentsLoading" class="gb-empty sm">加载评论…</p>
                      <p v-else-if="!comments.length" class="gb-empty sm">还没有评论，来抢沙发</p>
                      <ul v-else class="gb-comment-list">
                        <li
                          v-for="c in comments"
                          :id="'gb-comment-' + c.id"
                          :key="c.id"
                          class="gb-comment"
                          :class="{ 'is-blocked': isCommentBlocked(c) }"
                        >
                          <span
                            v-if="authorAvatarUrl(c.avatar)"
                            class="gb-avatar gb-avatar--sm gb-avatar--img"
                          >
                            <img :src="authorAvatarUrl(c.avatar)" alt="" />
                          </span>
                          <span
                            v-else
                            class="gb-avatar gb-avatar--sm"
                            :style="{ '--tone': String(avatarTone(c.nickname)) }"
                          >
                            {{ avatarLetter(c.nickname) }}
                          </span>
                          <div class="gb-comment__main">
                            <div class="gb-comment__head">
                              <button
                                v-if="c.userId"
                                type="button"
                                class="gb-comment__author"
                                @click="openProfile(Number(c.userId))"
                              >
                                <strong>{{ c.nickname }}</strong>
                              </button>
                              <strong v-else>{{ c.nickname }}</strong>
                              <button
                                v-if="c.anonymousAuthor"
                                type="button"
                                class="gb-anonymous-author gb-anonymous-author--inline"
                                @click="openAnonymousAuthorProfile(c)"
                              >
                                <span class="gb-anonymous-author__avatar">
                                  <img
                                    v-if="authorAvatarUrl(c.anonymousAuthor.avatar)"
                                    :src="authorAvatarUrl(c.anonymousAuthor.avatar)"
                                    alt=""
                                  />
                                  <span v-else>{{ avatarLetter(c.anonymousAuthor.nickname) }}</span>
                                </span>
                                <span>
                                  {{ c.anonymousAuthor.nickname }}
                                  <small>UID {{ c.anonymousAuthor.uid }}</small>
                                </span>
                              </button>
                              <span v-if="!c.isAnonymous" class="gb-lv">Lv.{{ c.level ?? 1 }}</span>
                              <span class="gb-floor">F{{ c.floor }}</span>
                              <span v-if="isCommentBlocked(c)" class="gb-comment__blocked-tag">已屏蔽</span>
                            </div>

                            <div v-if="isCommentBlocked(c)" class="gb-comment__blocked">
                              <p v-if="!expandedBlockedComments[c.id]" class="gb-comment__blocked-tip">
                                该评论已被屏蔽
                              </p>
                              <p
                                v-else
                                class="gb-comment__body gb-comment__body--mosaic"
                              >
                                {{ c.content }}
                              </p>
                              <div class="gb-comment__blocked-actions">
                                <button
                                  type="button"
                                  class="gb-comment__op"
                                  @click="toggleExpandBlocked(c.id)"
                                >
                                  {{ expandedBlockedComments[c.id] ? '收起' : '展开' }}
                                </button>
                                <button
                                  v-if="canRestoreComment(c)"
                                  type="button"
                                  class="gb-comment__op"
                                  :disabled="commentActionId === c.id"
                                  @click="onRestoreComment(c)"
                                >
                                  恢复
                                </button>
                              </div>
                            </div>
                            <p v-else class="gb-comment__body">
                              <GuestbookRichText
                                :content="c.content"
                                @open-user="openKnockUserProfile"
                                @jump-quote="jumpToQuotedComment"
                              />
                            </p>
                            <div v-if="c.images?.length" class="gb-comment__images">
                              <button
                                v-for="(img, idx) in c.images"
                                :key="img + idx"
                                type="button"
                                class="gb-comment__image-btn"
                                title="点击查看大图"
                                @click.prevent="openCommentImages(c.images || [], idx)"
                                @dblclick.prevent="openCommentImages(c.images || [], idx)"
                              >
                                <img :src="resolveAssetUrl(img) || img" alt="" />
                              </button>
                            </div>

                            <div class="gb-comment__foot">
                              <span class="gb-comment__time">{{ formatRelativeTime(c.createdAt) }}</span>
                              <div class="gb-comment__actions">
                                <button
                                  v-if="userAuth.isLoggedIn && !isCommentBlocked(c)"
                                  type="button"
                                  class="gb-comment__icon-btn gb-comment__icon-btn--like"
                                  :class="{ 'is-active': c.likedByMe }"
                                  :disabled="commentActionId === c.id"
                                  data-tip="点赞"
                                  @click="onToggleCommentLike(c)"
                                >
                                  <GuestbookLikeButton
                                    :active="c.likedByMe"
                                    :count="c.likeCount"
                                    compact
                                  />
                                </button>
                                <button
                                  v-if="userAuth.isLoggedIn"
                                  type="button"
                                  class="gb-comment__icon-btn"
                                  data-tip="引用"
                                  @click="quoteComment(c)"
                                >
                                  <GuestbookComposerIcons kind="reply" />
                                </button>
                                <div
                                  v-if="showCommentMenu(c)"
                                  class="gb-comment__menu-wrap"
                                  @click.stop
                                >
                                  <button
                                    type="button"
                                    class="gb-comment__icon-btn"
                                    data-tip="更多"
                                    @click.stop="toggleCommentMenu(c.id, $event)"
                                  >
                                    <GuestbookComposerIcons kind="more" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </li>
                      </ul>
                    </div>

                    <form v-if="userAuth.isLoggedIn" class="gb-comment-bar" @submit.prevent="submitComment">
                      <div class="gb-comment-compose">
                        <button
                          type="button"
                          class="gb-comment-anonymous"
                          :class="{ 'is-active': commentForm.anonymous }"
                          :aria-pressed="commentForm.anonymous"
                          @click="commentForm.anonymous = !commentForm.anonymous"
                        >
                          {{ commentForm.anonymous ? '匿名评论：开启' : '匿名评论：关闭' }}
                        </button>
                        <div v-if="commentQuote" class="gb-quote-compose">
                          <div class="gb-quote-compose__body">
                            <strong>引用 {{ commentQuote.nickname }}</strong>
                            <span>{{ commentQuote.preview || '…' }}</span>
                          </div>
                          <button type="button" class="gb-quote-compose__close" @click="clearCommentQuote">×</button>
                        </div>
                        <GuestbookRichComposer
                          ref="commentComposerRef"
                          v-model="commentForm.content"
                          v-model:images="commentForm.images"
                          :sending="commenting"
                          placeholder="说点什么… 输入 @ 可提及用户"
                          :maxlength="1000"
                          send-label="评论"
                          @caret-change="onCommentCaret"
                          @send="submitComment"
                          @preview-image="({ urls, index }) => openMediaViewer(urls, index)"
                        />
                        <ul v-if="mentionOpen" class="gb-mention-list">
                          <li v-if="mentionLoading" class="gb-mention-list__hint">搜索中…</li>
                          <template v-else>
                            <li
                              v-if="mentionDisplayGroups.recent.length"
                              class="gb-mention-list__section"
                            >
                              最近 @
                            </li>
                            <li v-for="u in mentionDisplayGroups.recent" :key="`recent-${u.id}`">
                              <button type="button" class="gb-mention-list__item" @click="pickMention(u)">
                                <span class="gb-mention-list__avatar">
                                  <img
                                    v-if="resolveAssetUrl(u.avatar)"
                                    :src="resolveAssetUrl(u.avatar) || ''"
                                    alt=""
                                  />
                                  <span v-else>{{ (u.nickname || '匿').slice(0, 1) }}</span>
                                </span>
                                <span class="gb-mention-list__meta">
                                  <strong>{{ u.nickname }}</strong>
                                  <span>UID {{ u.id }}</span>
                                </span>
                              </button>
                            </li>
                            <li
                              v-if="mentionDisplayGroups.following.length"
                              class="gb-mention-list__section"
                            >
                              关注的人
                            </li>
                            <li v-for="u in mentionDisplayGroups.following" :key="`follow-${u.id}`">
                              <button type="button" class="gb-mention-list__item" @click="pickMention(u)">
                                <span class="gb-mention-list__avatar">
                                  <img
                                    v-if="resolveAssetUrl(u.avatar)"
                                    :src="resolveAssetUrl(u.avatar) || ''"
                                    alt=""
                                  />
                                  <span v-else>{{ (u.nickname || '匿').slice(0, 1) }}</span>
                                </span>
                                <span class="gb-mention-list__meta">
                                  <strong>{{ u.nickname }}</strong>
                                  <span>UID {{ u.id }}</span>
                                </span>
                              </button>
                            </li>
                            <li
                              v-if="mentionDisplayGroups.remote.length"
                              class="gb-mention-list__section"
                            >
                              搜索结果
                            </li>
                            <li v-for="u in mentionDisplayGroups.remote" :key="`remote-${u.id}`">
                              <button type="button" class="gb-mention-list__item" @click="pickMention(u)">
                                <span class="gb-mention-list__avatar">
                                  <img
                                    v-if="resolveAssetUrl(u.avatar)"
                                    :src="resolveAssetUrl(u.avatar) || ''"
                                    alt=""
                                  />
                                  <span v-else>{{ (u.nickname || '匿').slice(0, 1) }}</span>
                                </span>
                                <span class="gb-mention-list__meta">
                                  <strong>{{ u.nickname }}</strong>
                                  <span>UID {{ u.id }}</span>
                                </span>
                              </button>
                            </li>
                            <li
                              v-if="
                                !mentionDisplayGroups.recent.length &&
                                !mentionDisplayGroups.following.length &&
                                !mentionDisplayGroups.remote.length
                              "
                              class="gb-mention-list__hint"
                            >
                              输入 UID 或昵称搜索
                            </li>
                          </template>
                        </ul>
                      </div>
                    </form>
                    <p v-else class="gb-comment-login-hint">
                      <button type="button" class="gb-comment-login-hint__btn" @click="userAuth.openLoginDialog()">
                        登录
                      </button>
                      后可发表评论
                    </p>
                    <p v-if="commentError" class="gb-hint err bar">{{ commentError }}</p>

                    <div class="gb-detail__actions">
                      <button
                        type="button"
                        class="gb-detail__action gb-detail__action--like"
                        :class="{ 'is-active': selected.likedByMe }"
                        :disabled="actionBusy"
                        @click="onToggleLike"
                      >
                        <GuestbookLikeButton
                          :active="selected.likedByMe"
                          :count="selected.likeCount ?? 0"
                        />
                      </button>
                      <button
                        type="button"
                        class="gb-detail__action"
                        :class="{ 'is-active': selected.favoritedByMe }"
                        :disabled="actionBusy"
                        @click="onToggleFavorite"
                      >
                        ★ {{ selected.favoriteCount ?? 0 }}
                      </button>
                      <button
                        v-if="canReportPost()"
                        type="button"
                        class="gb-detail__action"
                        @click="openReportPost"
                      >
                        举报
                      </button>
                      <button
                        v-if="canEditSelected"
                        type="button"
                        class="gb-detail__action"
                        @click="startEdit(selected)"
                      >
                        编辑
                      </button>
                      <button
                        v-if="isAdmin"
                        type="button"
                        class="gb-detail__action"
                        :class="{ 'is-active': selected.isPinned }"
                        :disabled="actionBusy"
                        @click="onToggleAdminPin"
                      >
                        {{ selected.isPinned ? '取消置顶' : '置顶' }}
                      </button>
                      <button
                        v-if="canManagePosts && !selected.isDeleted"
                        type="button"
                        class="gb-detail__action"
                        :class="{ 'is-active': selected.isSensitive }"
                        :disabled="actionBusy"
                        @click="onModeratorToggleSensitiveSelected"
                      >
                        {{ selected.isSensitive ? '取消敏感' : '标记敏感' }}
                      </button>
                      <button
                        v-if="canManagePosts && selected.isDeleted"
                        type="button"
                        class="gb-detail__action"
                        :disabled="actionBusy"
                        @click="onModeratorRestoreSelected"
                      >
                        恢复帖子
                      </button>
                      <button
                        v-else-if="canManagePosts"
                        type="button"
                        class="gb-detail__action"
                        :class="{ 'is-active': selected.isHidden }"
                        :disabled="actionBusy"
                        @click="onModeratorHideSelected"
                      >
                        {{ selected.isHidden ? '恢复帖子' : '屏蔽帖子' }}
                      </button>
                      <button
                        v-if="canManagePosts && !selected.isDeleted"
                        type="button"
                        class="gb-detail__action danger"
                        :disabled="actionBusy"
                        @click="onModeratorDeleteSelected"
                      >
                        删除帖子
                      </button>
                    </div>
                  </section>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>

      <div v-if="modDialog.open" class="gb-mod-dialog" role="dialog" aria-modal="true">
        <button type="button" class="gb-mod-dialog__mask" aria-label="关闭" @click="closeModDialog" />
        <div class="gb-mod-dialog__panel">
          <h3>{{ modDialog.action === 'delete' ? '删除委托' : '屏蔽委托' }}</h3>
          <p class="gb-mod-dialog__hint">
            可向作者留言说明原因；留空则使用默认提示。
          </p>
          <textarea
            v-model="modDialog.message"
            class="gb-mod-dialog__input"
            rows="4"
            maxlength="500"
            :placeholder="modDialogPlaceholder()"
          />
          <div class="gb-mod-dialog__actions">
            <button type="button" class="gb-detail__action" @click="closeModDialog">取消</button>
            <button
              type="button"
              class="gb-detail__action danger"
              :disabled="modDialog.busy"
              @click="confirmModDialog"
            >
              {{ modDialog.busy ? '处理中…' : modDialog.action === 'delete' ? '确认删除' : '确认屏蔽' }}
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="open && !showingModeration && !showingProfile && !showingAccount && !showingNotifications && !selected && !creating"
        class="gb-fab-group"
      >
        <button type="button" class="gb-fab" aria-label="回到顶部" @click="scrollFeedToTop">↑</button>
        <button
          type="button"
          class="gb-fab"
          aria-label="刷新"
          :disabled="feedRefreshing"
          @click="refreshFeed"
        >
          ↻
        </button>
      </div>
    </aside>

    <IkModalShell :open="showingNotifications" size="knock" :z-index="9100" @close="closeNotifications">
      <template #header>
        <div class="ik-knock__brand">
          <span class="ik-knock__brand-icon" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="7" y="4" width="18" height="24" rx="3" fill="#fbfe00" stroke="#000" stroke-width="1.5" />
              <rect x="11" y="8" width="10" height="14" rx="1" fill="#000" />
              <circle cx="16" cy="25" r="0.9" fill="#000" />
              <path d="M22 8 q3 -1 5 1" stroke="#fbfe00" stroke-width="1.8" stroke-linecap="round" fill="none" />
              <path d="M22 5 q5 -1.5 8 1.5" stroke="#fbfe00" stroke-width="1.8" stroke-linecap="round" fill="none" />
            </svg>
          </span>
          <span class="ik-knock__brand-text">敲敲</span>
          <button
            v-if="unreadCount"
            type="button"
            class="ik-knock__brand-unread"
            @click="onKnockUnreadClick"
          >
            <span class="ik-knock__unread-dot" aria-hidden="true" />
            未读 {{ unreadCount > 99 ? '99+' : unreadCount }}
          </button>
        </div>
      </template>
      <GuestbookNotificationsPanel
        :initial-chat-peer-id="knockChatPeerId"
        :jump-unread-nonce="knockJumpUnreadNonce"
        :my-avatar="userAuth.user?.avatar"
        :my-nickname="userAuth.user?.nickname"
        @close="closeNotifications"
        @open-post="openDetailFromKnock"
        @open-user="openKnockUserProfile"
        @open-reports="openModerationReports"
        @open-accounts="openModerationAccounts"
        @unread-changed="refreshUnreadCount"
      />
    </IkModalShell>

    <IkModalShell :open="showingProfile" size="post" :z-index="9050" @close="closeProfile">
      <template #header>
        <div class="ik-modal-header-row">
          <h2 class="ik-modal-header-title">
            {{
              profileUserId && profileUserId !== userAuth.user?.id
                ? profileDisplayName || '用户名片'
                : '我的名片'
            }}
          </h2>
        </div>
      </template>
      <div class="ik-post-panel">
        <GuestbookProfilePanel
          :key="profileUserId ?? userAuth.user?.id ?? 'self'"
          :profile-user-id="profileUserId"
          :restore-tab="profileRestoreTab"
          @close="closeProfile"
          @open-post="openDetailFromProfile"
          @open-user="openKnockUserProfile"
          @open-chat="openChatFromProfile"
          @logout="logoutFromProfile"
          @open-account="openAccountCenter"
        />
      </div>
    </IkModalShell>

    <IkModalShell :open="showingAccount" size="wide" :z-index="9060" @close="closeAccountCenter">
      <template #header>
        <div class="ik-modal-header-row">
          <button type="button" class="ik-dialog__back" @click="backToProfileFromAccount">返回</button>
          <h2 class="ik-modal-header-title">账号中心</h2>
        </div>
      </template>
      <div class="ik-post-panel">
        <GuestbookAccountPanel
          @close="closeAccountCenter"
          @back-to-profile="backToProfileFromAccount"
          @logout="logoutFromProfile"
        />
      </div>
    </IkModalShell>

    <IkModalShell :open="creating" size="post" :z-index="9040" @close="closeCreate">
      <template #header>
        <div class="create-modal-head">
          <h2 class="ik-modal-header-title">{{ isEditing ? '编辑委托' : '发布委托' }}</h2>
          <button
            v-if="!isEditing"
            type="button"
            class="draft-toggle"
            :class="{ active: draftPanelOpen }"
            @click="draftPanelOpen = !draftPanelOpen"
          >
            草稿箱 {{ drafts.length }}/{{ DRAFT_MAX }}
          </button>
        </div>
      </template>
      <div class="ik-post-panel">
        <div class="gb-create gb-create--modal">
          <div class="gb-create__panel">
            <section v-if="!isEditing && draftPanelOpen" class="draft-panel">
              <div class="draft-panel__head">
                <strong>草稿箱</strong>
                <button type="button" class="draft-new" @click="startNewDraft">新建草稿</button>
              </div>
              <p v-if="!drafts.length" class="draft-empty">暂无草稿，未发布的内容会自动保存在这里。</p>
              <ul v-else class="draft-list">
                <li
                  v-for="draft in drafts"
                  :key="draft.id"
                  :class="{ active: activeDraftId === draft.id }"
                >
                  <button type="button" class="draft-load" @click="loadDraft(draft)">
                    <strong>{{ draft.title.trim() || '无标题草稿' }}</strong>
                    <span>{{ formatDraftTime(draft.updatedAt) }}</span>
                  </button>
                  <button
                    type="button"
                    class="draft-delete"
                    aria-label="删除草稿"
                    @click="removeDraft(draft.id)"
                  >
                    ×
                  </button>
                </li>
              </ul>
            </section>

            <div class="create-title-row">
              <input
                v-model="form.title"
                class="create-title-input"
                type="text"
                :maxlength="TITLE_MAX"
                placeholder="请输入标题"
              />
              <span class="create-counter">{{ titleLen }}/{{ TITLE_MAX }}</span>
            </div>

            <div class="create-block">
              <div class="create-block-head">
                <h3>分类</h3>
                <span>选择委托所属频道</span>
              </div>
              <div class="create-cats ik-create-category-chips">
                <button
                  v-for="cat in createCategories"
                  :key="cat"
                  type="button"
                  class="ik-create-category-chip"
                  :class="{ 'ik-create-category-chip--active': form.category === cat }"
                  @click="form.category = cat"
                >
                  {{ cat }}
                </button>
              </div>
            </div>

            <div v-if="showNotifyPublishToggle" class="create-block">
              <div class="create-block-head">
                <h3>发布通知</h3>
                <span>向全站用户推送敲敲通知</span>
              </div>
              <div class="ik-create-category-chips">
                <button
                  type="button"
                  class="ik-create-category-chip"
                  :class="{ 'ik-create-category-chip--active': form.notifyPublish }"
                  @click="form.notifyPublish = true"
                >
                  推送敲敲
                </button>
                <button
                  type="button"
                  class="ik-create-category-chip"
                  :class="{ 'ik-create-category-chip--active': !form.notifyPublish }"
                  @click="form.notifyPublish = false"
                >
                  不推送
                </button>
              </div>
            </div>

            <div class="create-block">
              <div class="create-block-head">
                <h3>正文</h3>
                <div class="create-body-tools">
                  <span>支持 Markdown；若仅上传图片，正文可留空</span>
                  <button
                    type="button"
                    class="preview-toggle"
                    :class="{ active: markdownPreview }"
                    @click="markdownPreview = !markdownPreview"
                  >
                    {{ markdownPreview ? '关闭预览' : '预览' }}
                  </button>
                </div>
              </div>
              <div class="create-body-layout" :class="{ 'is-previewing': markdownPreview }">
                <textarea
                  v-model="form.content"
                  class="create-body"
                  :maxlength="CONTENT_MAX"
                  rows="12"
                  placeholder="请尽情发挥吧… 支持 Markdown（标题、列表、加粗、链接等）"
                />
                <article v-if="markdownPreview" class="create-body-preview">
                  <div v-if="draftContentHtml" v-html="draftContentHtml" />
                  <span v-else class="create-body-preview__empty">输入正文后将在这里显示预览</span>
                </article>
              </div>
              <div class="create-body-foot">
                <span class="create-counter">{{ contentLen }}/{{ CONTENT_MAX }}</span>
              </div>
            </div>

            <div class="create-block">
              <div class="create-block-head">
                <h3>图片 {{ form.images.length }}/{{ IMAGE_MAX }}</h3>
                <span>第一张图片为封面</span>
              </div>
              <div class="create-images">
                <div
                  v-for="(url, index) in form.images"
                  :key="url + index"
                  class="create-image"
                  title="双击查看大图"
                  @dblclick.prevent="openCreateFormImages(index)"
                >
                  <img :src="resolveAssetUrl(url)" alt="" />
                  <button
                    type="button"
                    class="create-image-remove"
                    @click.stop="removeImage(index)"
                  >
                    ×
                  </button>
                  <span v-if="index === 0" class="create-cover-tag">封面</span>
                </div>
                <button
                  v-if="form.images.length < IMAGE_MAX"
                  type="button"
                  class="create-image-add"
                  :disabled="uploading"
                  @click="fileInput?.click()"
                >
                  <span class="plus">+</span>
                  {{ uploading ? '上传中…' : '添加图片' }}
                </button>
              </div>
              <input
                ref="fileInput"
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                multiple
                hidden
                @change="onPickFiles"
              />
            </div>

            <div class="create-block">
              <div class="create-block-head">
                <h3>昵称</h3>
                <span>
                  {{
                    userAuth.isLoggedIn && !form.anonymous
                      ? '已使用米游社登录昵称'
                      : '匿名开启后将显示为「匿名」'
                  }}
                </span>
              </div>
              <input
                v-model="form.nickname"
                class="create-nick"
                type="text"
                maxlength="40"
                :placeholder="userAuth.isLoggedIn ? '登录昵称' : '可选，不填则为匿名'"
                :disabled="form.anonymous || userAuth.isLoggedIn"
              />
            </div>

            <p v-if="createError" class="gb-hint err">{{ createError }}</p>
          </div>

          <footer class="gb-create__footer">
            <button
              v-if="!isEditing"
              type="button"
              class="draft-save"
              :disabled="!hasDraftContent()"
              @click="saveCurrentDraft()"
            >
              {{ activeDraftId ? '更新草稿' : '存入草稿箱' }}
            </button>
            <label class="anon-toggle" :class="{ 'is-active': form.anonymous }">
              <span>匿名发布</span>
              <button
                type="button"
                class="switch"
                :class="{ on: form.anonymous }"
                role="switch"
                :aria-checked="form.anonymous"
                @click="form.anonymous = !form.anonymous"
              >
                <span class="switch-knob" />
                <span class="switch-text">{{ form.anonymous ? '已开启' : '未开启' }}</span>
              </button>
            </label>
            <label class="anon-toggle" :class="{ 'is-active': form.isSensitive }">
              <span>敏感内容</span>
              <button
                type="button"
                class="switch"
                :class="{ on: form.isSensitive }"
                role="switch"
                :aria-checked="form.isSensitive"
                @click="form.isSensitive = !form.isSensitive"
              >
                <span class="switch-knob" />
                <span class="switch-text">{{ form.isSensitive ? '已开启' : '未开启' }}</span>
              </button>
            </label>
            <button type="button" class="publish-btn" :disabled="!canSubmit" @click="submitPost">
              {{ submitting ? (isEditing ? '保存中…' : '发布中…') : isEditing ? '保存修改' : '发布委托' }}
            </button>
          </footer>
        </div>
      </div>
    </IkModalShell>

    <GuestbookMediaViewer
      v-model:open="viewerOpen"
      v-model:index="viewerIndex"
      :urls="viewerUrls"
      @favorited="onMediaFavorited"
    />

    <GuestbookConfirmDialog
      :open="reportDialog.open"
      :title="reportDialog.targetType === 'comment' ? '举报评论' : '举报委托'"
      message="可填写举报原因，管理员会尽快处理；留空也可直接提交。"
      confirm-label="提交举报"
      reason-placeholder="可选，说明举报原因…"
      show-reason
      :reason="reportDialog.reason"
      :busy="reportDialog.busy"
      @update:reason="reportDialog.reason = $event"
      @close="closeReportDialog"
      @confirm="confirmReportDialog"
    />

    <GuestbookConfirmDialog
      :open="handleReportDialog.open"
      title="处理举报"
      message="可向举报人留言说明处理结果；留空则仅通知已处理。"
      confirm-label="确认已处理"
      reason-placeholder="可选，写给举报人的反馈…"
      show-reason
      :reason="handleReportDialog.message"
      :busy="handleReportDialog.busy"
      @update:reason="handleReportDialog.message = $event"
      @close="closeHandleReportDialog"
      @confirm="confirmHandleReport"
    />

    <GuestbookConfirmDialog
      :open="banStatusDialog.open && !banStatusDialog.applyOpen"
      title="封禁状态"
      :details="[
        { label: '原因', value: userAuth.user?.banReason || '未填写' },
        { label: '开始', value: formatBanTime(userAuth.user?.bannedAt) },
        { label: '剩余', value: formatBanRemaining(userAuth.user?.banUntil) },
      ]"
      confirm-label="申请解封"
      cancel-label="关闭"
      @close="closeBanStatusDialog"
      @confirm="banStatusDialog.applyOpen = true"
    />

    <GuestbookConfirmDialog
      :open="banStatusDialog.applyOpen"
      title="申请解封"
      message="请说明申请解封的原因，将通知站点管理员。"
      confirm-label="提交申请"
      reason-placeholder="填写申请原因…"
      show-reason
      :reason="banStatusDialog.reason"
      :busy="banStatusDialog.busy"
      @update:reason="banStatusDialog.reason = $event"
      @close="banStatusDialog.applyOpen = false"
      @confirm="submitUnbanRequest"
    />

    <Teleport to="body">
      <div
        v-if="commentMenuComment"
        class="gb-comment__menu gb-comment__menu--portal"
        :style="commentMenuStyle"
        @click.stop
      >
        <button
          v-if="canReportComment(commentMenuComment)"
          type="button"
          class="gb-comment__menu-item"
          @click="openReportComment(commentMenuComment)"
        >
          举报评论
        </button>
        <button
          v-if="canBlockCommentUser(commentMenuComment)"
          type="button"
          class="gb-comment__menu-item"
          :disabled="commentActionId === commentMenuComment.id"
          @click="onBlockCommentUser(commentMenuComment)"
        >
          拉黑用户
        </button>
        <button
          v-if="canBlockComment(commentMenuComment)"
          type="button"
          class="gb-comment__menu-item"
          :disabled="commentActionId === commentMenuComment.id"
          @click="onBlockComment(commentMenuComment); closeCommentMenu()"
        >
          屏蔽评论
        </button>
        <button
          v-if="canDeleteComment(commentMenuComment)"
          type="button"
          class="gb-comment__menu-item"
          :disabled="commentActionId === commentMenuComment.id"
          @click="onDeleteComment(commentMenuComment); closeCommentMenu()"
        >
          删除评论
        </button>
        <button
          v-if="canRestoreComment(commentMenuComment)"
          type="button"
          class="gb-comment__menu-item"
          :disabled="commentActionId === commentMenuComment.id"
          @click="onRestoreComment(commentMenuComment); closeCommentMenu()"
        >
          恢复评论
        </button>
      </div>
    </Teleport>
  </Teleport>
</template>

<style scoped>
.gb-edge-tab {
  position: fixed;
  top: 50%;
  right: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  min-height: 5.5rem;
  padding: 0.85rem 0.35rem;
  border: 1px solid #2a2a2a;
  border-right: none;
  border-radius: 10px 0 0 10px;
  background: #111;
  color: #bfff09;
  cursor: pointer;
  box-shadow: -4px 0 18px rgba(0, 0, 0, 0.35);
  transform: translateY(-50%);
}

.gb-edge-tab:hover {
  width: 2.25rem;
  background: #bfff09;
  color: #111;
}

.gb-edge-tab__text {
  writing-mode: vertical-rl;
  letter-spacing: 0.18em;
  font-size: 0.85rem;
  font-weight: 800;
  line-height: 1;
}

.gb-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1250;
  border: none;
  padding: 0;
  margin: 0;
  background: rgba(0, 0, 0, 0.78);
  cursor: pointer;
}

.gb-drawer {
  --gb-bg: #000;
  --gb-card: #222;
  --gb-primary: #bfff09;
  --gb-link: #42a5f5;

  position: fixed;
  top: 0;
  right: 0;
  z-index: 1260;
  display: flex;
  flex-direction: column;
  /* 宽度由 JS / style 控制，可拖拽任意调整 */
  width: 76vw;
  max-width: calc(100vw - 24px);
  min-width: 360px;
  height: 100dvh;
  overflow: hidden;
  isolation: isolate;
  background: var(--gb-bg);
  color: #f0f0f0;
  border-left: 1px solid #1a1a1a;
  box-shadow: -16px 0 48px rgba(0, 0, 0, 0.6);
  transform: translateX(105%);
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.gb-drawer--resizing {
  transition: none;
  user-select: none;
}

.gb-resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 20;
  width: 8px;
  cursor: ew-resize;
  touch-action: none;
}

.gb-resize-handle::after {
  content: '';
  position: absolute;
  left: 2px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 48px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.gb-drawer:hover .gb-resize-handle::after,
.gb-drawer--resizing .gb-resize-handle::after {
  opacity: 1;
  background: rgba(191, 255, 9, 0.65);
}

.gb-drawer--open {
  transform: translateX(0);
  pointer-events: auto;
}

/* 绳网全局大字跑马灯背景 */
.gb-marquee {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
}

.gb-marquee__band {
  position: absolute;
  width: 220%;
  height: 220%;
  left: -60%;
  top: -60%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
  gap: 0.006em;
  font-size: clamp(240px, 32vw, 400px);
  transform: translateY(5vh) rotate(-15deg);
}

.gb-marquee__row {
  flex: 0 0 auto;
  overflow: hidden;
  white-space: nowrap;
  font-size: inherit;
  line-height: 0.74;
}

.gb-marquee__track {
  display: inline-flex;
  flex-shrink: 0;
  animation-play-state: paused;
  will-change: transform;
  backface-visibility: hidden;
}

.gb-marquee__row--ltr .gb-marquee__track {
  animation: gb-marquee-ltr 400s linear infinite;
}

.gb-marquee__row--rtl .gb-marquee__track {
  animation: gb-marquee-rtl 480s linear infinite;
}

.gb-marquee__row--offset .gb-marquee__track {
  animation-delay: -140s;
}

.gb-marquee.is-running .gb-marquee__track {
  animation-play-state: running;
}

.gb-marquee__text {
  display: inline-block;
  padding-right: 0.15em;
  font-size: inherit;
  line-height: inherit;
  font-weight: 800;
  letter-spacing: -0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.07);
  white-space: nowrap;
  user-select: none;
}

@keyframes gb-marquee-ltr {
  from {
    transform: translate3d(-50%, 0, 0);
  }
  to {
    transform: translate3d(0, 0, 0);
  }
}

@keyframes gb-marquee-rtl {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    transform: translate3d(-50%, 0, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .gb-marquee__track {
    animation: none !important;
  }
}

.gb-header {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-shrink: 0;
  padding: max(0.85rem, env(safe-area-inset-top)) 1.25rem 0.75rem;
  border-bottom: 1px solid #1f1f1f;
  background: #0a0a0a;
}

.gb-header__lead {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.gb-header__title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #fff;
}

.gb-header__brand {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}

.gb-header__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 12px 12px 0 12px;
  background: var(--gb-primary);
  color: #111;
  font-size: 0.65rem;
  font-weight: 900;
}

.gb-header__brand h2 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #fff;
}

.gb-header__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  flex-shrink: 0;
}

.gb-user {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 280px;
  max-width: min(500px, 68vw);
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
}

.gb-user:hover {
  filter: brightness(1.06);
}

.gb-user__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #eee;
  font-size: 0.82rem;
  font-weight: 800;
}

.gb-post-btn {
  border: none;
  border-radius: 999px;
  background: var(--gb-primary);
  color: #111;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 800;
  padding: 0.4rem 1rem;
  cursor: pointer;
}

.gb-post-btn.ghost {
  background: #1a1a1a;
  color: #ddd;
  border: 1px solid #333;
}

.gb-post-btn.ghost.is-active {
  border-color: rgba(191, 255, 9, 0.55);
  color: #bfff09;
  background: rgba(191, 255, 9, 0.1);
}

.gb-count {
  min-width: 1.6rem;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: rgba(191, 255, 9, 0.12);
  border: 1px solid rgba(191, 255, 9, 0.35);
  color: var(--gb-primary);
  font-size: 0.75rem;
  font-weight: 700;
  text-align: center;
}

.gb-close {
  width: auto;
  height: auto;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 0;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.gb-search {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  padding: 0.7rem 1.25rem 0.55rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background:
    linear-gradient(90deg, rgba(191, 255, 9, 0.04), transparent 28%),
    rgba(0, 0, 0, 0.48);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.gb-search.has-filters {
  background:
    linear-gradient(90deg, rgba(191, 255, 9, 0.1), transparent 36%),
    rgba(0, 0, 0, 0.55);
}

.gb-search__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 0.45rem;
}

.gb-search__ranges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  flex: 0 1 auto;
  order: 1;
  min-width: 0;
  padding: 0.18rem;
  border: 1px solid #2c2c2c;
  border-radius: 10px 10px 0 10px;
  background: rgba(14, 14, 14, 0.92);
}

.gb-search__field {
  display: flex;
  align-items: center;
  min-width: 0;
}

.gb-search__field--q {
  position: relative;
  flex: 1 1 220px;
  order: 2;
  min-width: 160px;
}

.gb-search__actions {
  display: flex;
  align-items: stretch;
  gap: 0.35rem;
  flex-shrink: 0;
  order: 3;
}

.gb-search__icon {
  position: absolute;
  left: 0.75rem;
  top: 50%;
  z-index: 1;
  display: inline-flex;
  color: #6e6e6e;
  transform: translateY(-50%);
  pointer-events: none;
  transition: color 140ms ease;
}

.gb-search__field--q:focus-within .gb-search__icon {
  color: var(--gb-primary);
}

.gb-search__input {
  width: 100%;
  min-width: 0;
  height: 2.25rem;
  padding: 0 0.85rem 0 2.2rem;
  border: 1px solid #2c2c2c;
  border-radius: 10px 10px 0 10px;
  background: rgba(14, 14, 14, 0.92);
  color: #f2f2f2;
  font-size: 0.86rem;
  letter-spacing: 0.01em;
  outline: none;
  box-sizing: border-box;
  transition:
    border-color 140ms ease,
    box-shadow 140ms ease,
    background 140ms ease;
}

.gb-search__input::placeholder {
  color: #666;
}

.gb-search__input:hover {
  border-color: #3a3a3a;
}

.gb-search__input:focus {
  border-color: rgba(191, 255, 9, 0.55);
  background: #101010;
  box-shadow: 0 0 0 1px rgba(191, 255, 9, 0.18);
}

.gb-search__input::-webkit-search-cancel-button {
  filter: invert(1);
  cursor: pointer;
}

.gb-search__range {
  height: 1.9rem;
  padding: 0 0.7rem;
  border: 1px solid transparent;
  border-radius: 7px 7px 0 7px;
  background: transparent;
  color: #b8b8b8;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color 120ms ease,
    background 120ms ease,
    border-color 120ms ease;
}

.gb-search__range:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.05);
}

.gb-search__range.is-active {
  color: #111;
  background: var(--gb-primary);
  border-color: var(--gb-primary);
}

.gb-search__btn {
  height: 2.25rem;
  padding: 0 1.05rem;
  border: none;
  border-radius: 10px 10px 0 10px;
  background: var(--gb-primary);
  color: #111;
  font-size: 0.82rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition:
    transform 120ms ease,
    filter 120ms ease;
}

.gb-search__btn:hover {
  filter: brightness(1.06);
  transform: translateY(-1px);
}

.gb-search__btn:active {
  transform: translateY(0);
}

.gb-search__clear {
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid #333;
  border-radius: 10px 10px 0 10px;
  background: #161616;
  color: #aaa;
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  transition:
    color 120ms ease,
    border-color 120ms ease,
    background 120ms ease;
}

.gb-search__clear:hover:not(:disabled) {
  color: #fff;
  border-color: #555;
  background: #1f1f1f;
}

.gb-search__clear:disabled {
  opacity: 0.28;
  cursor: not-allowed;
}

.gb-search__hint {
  margin: 0.4rem 0 0;
  color: rgba(191, 255, 9, 0.78);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.gb-tabs {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  padding: 0.55rem 1.25rem 0.65rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(6px);
}

.gb-tabs--cats {
  flex-wrap: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
  gap: 0.4rem;
  padding-top: 0.65rem;
  padding-bottom: 0.75rem;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.gb-tabs--cats::-webkit-scrollbar {
  display: none;
}

.gb-tab-sep--v {
  padding: 0 0.35rem;
  transform: none;
  font-weight: 900;
  color: rgba(255, 255, 255, 0.28);
}

.gb-comment__author {
  border: 0;
  background: transparent;
  padding: 0;
  margin: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.gb-comment__author:hover strong {
  color: #bfff09;
}

.gb-create--modal {
  min-height: 100%;
}

.gb-create--modal .gb-create__panel {
  margin: 0;
}

.create-modal-head {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}

.draft-toggle,
.draft-new,
.draft-save,
.preview-toggle {
  border: 1px solid #3b3b3b;
  border-radius: 999px;
  background: #1b1b1b;
  color: #ddd;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 800;
  cursor: pointer;
}

.draft-toggle {
  padding: 0.3rem 0.7rem;
}

.draft-toggle.active,
.preview-toggle.active {
  border-color: #d8ff4d;
  color: #d8ff4d;
}

.draft-panel {
  margin-bottom: 1rem;
  padding: 0.75rem;
  border: 1px solid #303030;
  border-radius: 12px;
  background: #131313;
}

.draft-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.55rem;
}

.draft-new,
.preview-toggle {
  padding: 0.25rem 0.65rem;
}

.draft-empty {
  margin: 0;
  color: #777;
  font-size: 0.78rem;
}

.draft-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.draft-list li {
  display: flex;
  min-width: 0;
  border: 1px solid #2d2d2d;
  border-radius: 9px;
  background: #191919;
  overflow: hidden;
}

.draft-list li.active {
  border-color: #d8ff4d;
}

.draft-load {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  padding: 0.55rem 0.65rem;
  border: 0;
  background: transparent;
  color: #eee;
  text-align: left;
  cursor: pointer;
}

.draft-load strong {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.draft-load span {
  color: #777;
  font-size: 0.68rem;
}

.draft-delete {
  width: 2rem;
  border: 0;
  border-left: 1px solid #2d2d2d;
  background: transparent;
  color: #888;
  font-size: 1rem;
  cursor: pointer;
}

.draft-delete:hover {
  color: #ff7d7d;
}

.gb-profile--modal .gb-profile__toolbar {
  display: none;
}


.gb-tabs--cats::-webkit-scrollbar {
  display: none;
}

.gb-tab-sep {
  flex-shrink: 0;
  align-self: center;
  padding: 0 0.35rem;
  margin: 0 0.05rem;
  font-size: 0.82rem;
  font-weight: 900;
  color: rgba(255, 255, 255, 0.28);
}

.gb-create {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.gb-create__panel {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0.85rem 1.1rem 0;
  padding: 1rem 1.1rem 1.2rem;
  border: 1px solid #2a2a2a;
  border-radius: 16px;
  background: rgba(12, 12, 12, 0.92);
}

.create-title-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #222;
}

.create-title-input {
  flex: 1;
  border: none;
  background: transparent;
  color: #fff;
  font: inherit;
  font-size: 1.2rem;
  font-weight: 700;
  outline: none;
}

.create-title-input::placeholder {
  color: #666;
}

.create-counter {
  font-size: 0.8rem;
  color: #777;
}

.create-block {
  margin-bottom: 1.15rem;
}

.create-block-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.55rem;
}

.create-block-head h3 {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 800;
  color: #fff;
}

.create-block-head span {
  font-size: 0.74rem;
  color: #777;
}

.create-body-tools {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.55rem;
}

.create-body-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.75rem;
}

.create-body-layout.is-previewing {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.create-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.create-cat {
  border: 1px solid #2f2f2f;
  border-radius: 999px;
  background: #171717;
  color: #ddd;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  padding: 0.35rem 0.85rem;
  cursor: pointer;
}

.create-cat.active {
  background: var(--gb-primary);
  border-color: var(--gb-primary);
  color: #111;
}

.create-body {
  width: 100%;
  min-height: 220px;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  background: #111;
  color: #eee;
  font: inherit;
  font-size: 0.9rem;
  line-height: 1.55;
  padding: 0.8rem 0.9rem;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}

.create-body-preview {
  min-height: 220px;
  overflow: auto;
  padding: 0.8rem 0.9rem;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  background: #151515;
  color: #eee;
  font-size: 0.9rem;
  line-height: 1.65;
  overflow-wrap: anywhere;
  box-sizing: border-box;
}

.create-body-preview :deep(:first-child) {
  margin-top: 0;
}

.create-body-preview :deep(:last-child) {
  margin-bottom: 0;
}

.create-body-preview :deep(a) {
  color: #bfff09;
}

.create-body-preview :deep(img) {
  max-width: 100%;
}

.create-body-preview__empty {
  color: #666;
}

.create-body::placeholder {
  color: #555;
}

.create-body-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 0.35rem;
}

.create-images {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 0.65rem;
}

.create-image,
.create-image-add {
  position: relative;
  aspect-ratio: 1;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid #2a2a2a;
  background: #151515;
}

.create-image {
  cursor: zoom-in;
}

.create-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.create-image-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 1.4rem;
  height: 1.4rem;
  border: none;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  cursor: pointer;
}

.create-cover-tag {
  position: absolute;
  left: 5px;
  bottom: 5px;
  padding: 0.08rem 0.35rem;
  border-radius: 4px;
  background: var(--gb-primary);
  color: #111;
  font-size: 0.65rem;
  font-weight: 800;
}

.create-image-add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  color: #999;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}

.create-image-add:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.create-image-add .plus {
  font-size: 1.45rem;
  line-height: 1;
  color: #ccc;
}

.create-nick {
  width: min(320px, 100%);
  border: 1px solid #2a2a2a;
  border-radius: 999px;
  background: #111;
  color: #eee;
  font: inherit;
  padding: 0.5rem 0.9rem;
  outline: none;
}

.create-nick:disabled {
  opacity: 0.5;
}

.gb-create__footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.85rem;
  padding: 0.75rem 1.1rem 1rem;
  border-top: 1px solid #1f1f1f;
  background: rgba(0, 0, 0, 0.55);
}

.draft-save {
  margin-right: auto;
  padding: 0.5rem 0.9rem;
}

.draft-save:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.anon-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  font-weight: 700;
  color: #ddd;
  transition: color 0.18s ease, text-shadow 0.18s ease;
}

.anon-toggle.is-active {
  color: #d8ff4d;
}

.switch {
  position: relative;
  width: 5.4rem;
  height: 1.9rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 999px;
  background: #333;
  cursor: pointer;
  padding: 0;
}

.switch.on {
  background: #d8ff4d;
  border-color: #e8ff8a;
}

.switch-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 999px;
  background: #111;
  transition: transform 0.18s ease;
}

.switch.on .switch-knob {
  transform: translateX(3.4rem);
}

.switch-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-left: 1.35rem;
  font-size: 0.68rem;
  font-weight: 800;
  color: #bbb;
  pointer-events: none;
}

.switch.on .switch-text {
  color: #111;
  padding-right: 1.4rem;
  padding-left: 0;
}

.switch:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.switch--prominent {
  flex-shrink: 0;
}

.gb-sensitive-global {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: 0.75rem 0 1rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid rgba(191, 255, 9, 0.25);
  border-radius: 12px;
  background: rgba(191, 255, 9, 0.06);
}

.gb-sensitive-global > div {
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
}

.gb-sensitive-global strong {
  color: #fff;
  font-size: 0.85rem;
}

.gb-sensitive-global span {
  color: rgba(255, 255, 255, 0.52);
  font-size: 0.72rem;
}

.publish-btn {
  min-width: 8rem;
  border: none;
  border-radius: 10px;
  padding: 0.65rem 1.2rem;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 900;
  color: #111;
  cursor: pointer;
  background:
    repeating-linear-gradient(
      -45deg,
      #bfff09,
      #bfff09 8px,
      #a8e008 8px,
      #a8e008 16px
    );
}

.publish-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.gb-tab {
  flex-shrink: 0;
  border: 1px solid #2f2f2f;
  border-radius: 999px;
  background: #1a1a1a;
  color: #eaeaea;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  padding: 0.32rem 0.85rem;
  cursor: pointer;
}

.gb-tab--active {
  background: var(--gb-primary);
  border-color: var(--gb-primary);
  color: #111;
}

.gb-feed {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 1rem 1.25rem 1.4rem;
  background: transparent;
}

.gb-feed .gb-search,
.gb-feed .gb-tabs {
  margin-left: -1.25rem;
  margin-right: -1.25rem;
}

.gb-empty {
  margin: 3rem 0;
  text-align: center;
  color: #888;
  font-size: 0.95rem;
}

.gb-empty.sm {
  margin: 1.5rem 0;
  font-size: 0.85rem;
}

.gb-empty.err,
.gb-hint.err {
  color: #ff6b6b;
}

.gb-hint {
  margin: 0;
  font-size: 0.8rem;
}

.gb-hint.bar {
  padding: 0 0.85rem 0.55rem;
}

.gb-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1.15rem 1.1rem;
  align-items: start;
}

.gb-masonry {
  display: flex;
  align-items: flex-start;
  gap: 1.1rem;
}

.gb-masonry__col {
  flex: 1 1 0;
  min-width: 0;
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1.15rem;
}

.gb-card {
  cursor: pointer;
}

.gb-card__shell {
  border-radius: 22px 22px 0 22px;
  background: #000;
  padding: 4px;
  transition: background-color 0.18s ease;
}

.gb-card:hover .gb-card__shell {
  background: var(--gb-primary);
}

.gb-card__inner {
  border-radius: 18px 18px 0 18px;
  overflow: hidden;
  background: var(--gb-card);
}

.gb-card__cover {
  position: relative;
  overflow: hidden;
  min-height: 120px;
  background: linear-gradient(
    160deg,
    hsl(var(--cover-hue, 200) 35% 18%),
    hsl(calc(var(--cover-hue, 200) + 40) 40% 10%)
  );
}

.gb-card__cover--img {
  background: #151515;
}

.gb-card__cover-img {
  display: block;
  width: 100%;
  height: auto;
  max-height: none;
  object-fit: contain;
  object-position: top center;
  transform: scale(1);
  transition:
    transform 1.2s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 400ms ease;
  will-change: transform;
}

.gb-card:hover .gb-card__cover-img,
.gb-card:focus-within .gb-card__cover-img,
.gb-card.is-active .gb-card__cover-img {
  transform: scale(1.06);
}

@media (prefers-reduced-motion: reduce) {
  .gb-card__cover-img {
    transition: none;
  }

  .gb-card:hover .gb-card__cover-img,
  .gb-card:focus-within .gb-card__cover-img,
  .gb-card.is-active .gb-card__cover-img {
    transform: none;
  }
}

.gb-card__stats {
  position: absolute;
  top: 10px;
  left: 12px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  color: #fff;
  font-size: 0.82rem;
  font-weight: 700;
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.8);
}

.gb-card__restore-req {
  position: absolute;
  bottom: 10px;
  right: 12px;
  z-index: 2;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(191, 255, 9, 0.92);
  color: #111;
  font-size: 11px;
  font-weight: 800;
}

.gb-detail__moderation {
  margin-bottom: 0.85rem;
  padding: 0.75rem 0.9rem;
  border-radius: 12px;
  border: 1px solid rgba(255, 140, 0, 0.35);
  background: rgba(255, 140, 0, 0.08);
}

.gb-detail__moderation strong {
  display: block;
  margin-bottom: 0.35rem;
  color: #ffb347;
  font-size: 0.85rem;
}

.gb-detail__moderation p {
  margin: 0;
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.88rem;
  line-height: 1.55;
  white-space: pre-wrap;
}

.gb-mod-dialog {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.gb-mod-dialog__mask {
  position: absolute;
  inset: 0;
  border: 0;
  background: rgba(0, 0, 0, 0.55);
  cursor: pointer;
}

.gb-mod-dialog__panel {
  position: relative;
  z-index: 1;
  width: min(420px, 100%);
  padding: 1rem 1.1rem 1.1rem;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: #1a1a1a;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}

.gb-mod-dialog__panel h3 {
  margin: 0 0 0.35rem;
  color: #fff;
  font-size: 1rem;
}

.gb-mod-dialog__hint {
  margin: 0 0 0.75rem;
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.82rem;
}

.gb-mod-dialog__input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: #fff;
  font: inherit;
  resize: vertical;
}

.gb-mod-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.85rem;
}

.gb-card__status {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 2;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 140, 0, 0.92);
  color: #111;
  font-size: 11px;
  font-weight: 800;
}

.gb-card__status--deleted {
  background: rgba(255, 60, 60, 0.92);
  color: #fff;
}

.gb-card__status--sensitive {
  top: auto;
  bottom: 10px;
  right: 12px;
  background: rgba(160, 80, 220, 0.92);
  color: #fff;
}

.gb-anonymous-author {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  max-width: 100%;
  margin-top: 0.45rem;
  padding: 0.3rem 0.5rem;
  border: 1px solid rgba(191, 255, 9, 0.3);
  border-radius: 8px;
  background: rgba(191, 255, 9, 0.07);
  color: #eaffad;
  font: inherit;
  font-size: 0.72rem;
  cursor: pointer;
}

.gb-anonymous-author:hover {
  border-color: var(--gb-primary);
  background: rgba(191, 255, 9, 0.14);
}

.gb-anonymous-author--inline {
  margin-top: 0;
  padding: 0.18rem 0.38rem;
}

.gb-anonymous-author__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.45rem;
  height: 1.45rem;
  overflow: hidden;
  border-radius: 50%;
  background: #30343a;
  color: #fff;
  font-weight: 800;
}

.gb-anonymous-author__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.gb-anonymous-author > span:last-child {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem;
}

.gb-anonymous-author small {
  color: rgba(255, 255, 255, 0.52);
  font-size: 0.65rem;
}

.gb-comment-anonymous {
  align-self: flex-start;
  margin-bottom: 0.35rem;
  padding: 0.25rem 0.55rem;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.65);
  font-size: 0.7rem;
  font-weight: 700;
  cursor: pointer;
}

.gb-comment-anonymous.is-active {
  border-color: var(--gb-primary);
  background: rgba(191, 255, 9, 0.12);
  color: var(--gb-primary);
}

.gb-card__cover .gb-sensitive-media {
  display: block;
}

.gb-card.is-hidden .gb-card__cover-img,
.gb-card.is-deleted .gb-card__cover-img {
  filter: grayscale(0.55) brightness(0.72);
}

.gb-feed--mod {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 1rem 1.25rem;
  display: flex;
  flex-direction: column;
}

.gb-tabs--manage-section {
  margin-bottom: 0.35rem;
  flex-shrink: 0;
}

.gb-acc-manage {
  flex: 1;
  min-height: 12rem;
  margin-top: 0.35rem;
}

.gb-mod-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.55rem;
}

.gb-mod-card__actions .gb-detail__action {
  padding: 4px 10px;
  font-size: 11px;
}

.gb-knock-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  min-width: 36px;
  height: 36px;
  padding: 0 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.88);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.gb-knock-btn:hover {
  border-color: rgba(191, 255, 9, 0.45);
  color: #bfff09;
}

.gb-knock-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: #ff3b30;
  color: #fff;
  font-size: 10px;
  font-weight: 800;
  line-height: 16px;
  text-align: center;
  border: 1px solid #000;
}

.gb-knock-badge--dot {
  min-width: 10px;
  width: 10px;
  height: 10px;
  padding: 0;
  top: -2px;
  right: -2px;
  border-width: 1px;
}

.gb-notify-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.88);
  cursor: pointer;
}

.gb-notify-btn:hover {
  border-color: rgba(191, 255, 9, 0.45);
  color: #bfff09;
}

.gb-notify-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: #ff4d4f;
  color: #fff;
  font-size: 10px;
  font-weight: 800;
  line-height: 16px;
  text-align: center;
}

.gb-card__pin {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 2;
  padding: 2px 8px;
  border-radius: 999px;
  background: #bfff09;
  color: #111;
  font-size: 11px;
  font-weight: 800;
}

.gb-card__excerpt {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 2.4rem 1rem 1rem;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
  line-clamp: 5;
  font-size: 0.86rem;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.78);
  word-break: break-word;
}

.gb-card__body {
  position: relative;
  z-index: 1;
  padding: 0 8px 12px;
}

.gb-card__author {
  display: flex;
  align-items: flex-start;
}

.gb-avatar-shell {
  position: relative;
  z-index: 2;
  margin-top: -28px;
  width: 54px;
  height: 54px;
  padding: 2px;
  border-radius: 999px;
  background: var(--gb-card);
  flex-shrink: 0;
  box-sizing: border-box;
}

.gb-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 999px;
  font-size: 1rem;
  font-weight: 800;
  color: #111;
  background: hsl(var(--tone, 72) 78% 58%);
}

.gb-avatar--lg {
  width: 2.9rem;
  height: 2.9rem;
  border: 2px solid #111;
  flex-shrink: 0;
}

.gb-avatar--sm {
  width: 2.05rem;
  height: 2.05rem;
  font-size: 0.78rem;
  flex-shrink: 0;
}

.gb-avatar--img {
  padding: 0;
  overflow: hidden;
  background: #222;
}

.gb-avatar--img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.gb-card__author-block {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 32px;
  padding-left: 8px;
  margin-left: 4px;
  width: calc(100% - 58px);
  min-width: 0;
}

.gb-name {
  margin: 4px 0;
  font-size: 0.92rem;
  font-weight: 700;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gb-author-line {
  display: block;
  width: 100%;
  height: 1px;
  background: #3a3a3a;
}

.gb-card__title {
  margin: 8px 0 0;
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1.3;
  color: var(--gb-link);
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  word-break: break-word;
}

.gb-card__title.is-viewed {
  color: #fff;
}

.gb-card__title.is-viewed .gb-cat {
  color: rgba(255, 255, 255, 0.72);
}

.gb-cat {
  margin-right: 0.2rem;
  color: var(--gb-link);
  font-weight: 800;
}

.gb-detail {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: clamp(0.5rem, 1.8vw, 1.5rem);
  background: transparent;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  /* 防止内部滚动穿透到留言板列表 */
  overscroll-behavior: contain;
}

.gb-detail__mask {
  position: absolute;
  inset: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}

.gb-detail__backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.6);
}

.gb-detail__stripe {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    40deg,
    transparent,
    transparent 3.5px,
    rgba(255, 255, 255, 0.09) 4.5px,
    rgba(255, 255, 255, 0.09) 7.5px,
    transparent 8.5px
  );
}

.gb-detail__dialog {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: min(1080px, 100%);
  /* 电脑端约占视口高度 75%，避免贴满留言板 */
  height: min(75vh, 100%);
  max-height: 100%;
  min-height: 0;
  min-width: 0;
  transform-origin: center;
}

.gb-detail__outer {
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 4px;
  background: #2d2c2d;
  border-radius: 24px 0 24px 24px;
  overflow: hidden;
  box-sizing: border-box;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
}

.gb-detail__inner {
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 4px;
  background: #000;
  border-radius: 22px 0 22px 22px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.gb-detail__top {
  position: relative;
  z-index: 2;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.55rem 0.85rem;
  border-radius: 18px 0 0 0;
  background: #0a0a0a;
}

.gb-detail__author.is-clickable,
.gb-card__author.is-clickable {
  cursor: pointer;
}

.gb-detail__author.is-clickable:hover strong,
.gb-card__author.is-clickable:hover .gb-name {
  color: #bfff09;
}

.gb-detail__author {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
}

.gb-detail__avatar-shell {
  width: 2.9rem;
  height: 2.9rem;
  padding: 2px;
  border-radius: 999px;
  background: #111;
  flex-shrink: 0;
  box-sizing: border-box;
}

.gb-detail__avatar-shell .gb-avatar {
  width: 100%;
  height: 100%;
  border: none;
}

.gb-detail__name-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}

.gb-detail__name-row strong {
  color: #fff;
  font-size: 0.95rem;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gb-detail__author-text {
  min-width: 0;
}

.gb-detail__author-text p {
  margin: 0.15rem 0 0;
  font-size: 0.75rem;
  color: #777;
}

.gb-lv {
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 800;
  font-style: italic;
  color: var(--gb-primary);
}

.gb-detail__close {
  flex-shrink: 0;
  width: 2.35rem;
  height: 2.35rem;
  border: none;
  border-radius: 8px;
  background: #e53935;
  color: #fff;
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
  transition:
    opacity 140ms ease,
    transform 140ms ease;
}

.gb-detail__close:hover {
  opacity: 0.9;
  transform: scale(1.04);
}

.gb-detail__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0.75rem 0 0;
  margin-top: 0.35rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.gb-detail__action {
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.88);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.gb-detail__action:hover:not(:disabled) {
  border-color: rgba(191, 255, 9, 0.45);
  color: #bfff09;
}

.gb-detail__action.is-active {
  border-color: #bfff09;
  background: rgba(191, 255, 9, 0.12);
  color: #bfff09;
}

.gb-detail__action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.gb-detail__main {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.gb-detail__mobile-tabs {
  display: none;
  position: relative;
  z-index: 2;
  flex-shrink: 0;
  gap: 0;
  padding: 0 0.55rem;
  border-bottom: 1px solid #1f1f1f;
  background: #0a0a0a;
}

.gb-detail__mobile-tab {
  flex: 1;
  margin: 0;
  padding: 0.55rem 0.4rem;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #888;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.gb-detail__mobile-tab.is-active {
  color: #bfff09;
  border-bottom-color: #bfff09;
}

.gb-detail__marquee {
  z-index: 0;
}

.gb-detail__split {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  background: transparent;
  border-radius: 0 0 18px 18px;
}

.gb-detail__left {
  flex: 3;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.gb-detail__left-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 12px 8px 12px 12px;
  background: rgba(0, 0, 0, 0.85);
  border-radius: 16px;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.gb-detail__left-scroll::-webkit-scrollbar {
  display: none;
}

.gb-detail__cover-wrap {
  padding: 14px 16px 8px;
}

.gb-detail__cover-border {
  padding: 3px;
  border-radius: 14px;
  background: #2a2a2a;
}

.gb-detail__cover-stage {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  background: linear-gradient(
    160deg,
    hsl(var(--cover-hue, 200) 30% 16%),
    hsl(calc(var(--cover-hue, 200) + 40) 35% 8%)
  );
}

.gb-detail__cover {
  border-radius: 12px;
  overflow: hidden;
  background: transparent;
}

.gb-detail__cover--btn {
  display: block;
  width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  cursor: zoom-in;
  text-align: left;
  font: inherit;
  color: inherit;
  background: transparent;
}

.gb-detail__cover img,
.gb-detail__cover .gb-sensitive-media img {
  display: block;
  width: 100%;
  max-height: 340px;
  object-fit: contain;
  background: #111;
}

.gb-detail__cover-nav {
  position: absolute;
  top: 50%;
  z-index: 2;
  transform: translateY(-50%);
  width: 36px;
  height: 56px;
  margin: 0;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.48);
  color: #fff;
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
  transition:
    background 0.15s ease,
    opacity 0.15s ease;
}

.gb-detail__cover-nav:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.7);
}

.gb-detail__cover-nav:disabled {
  opacity: 0.28;
  cursor: default;
}

.gb-detail__cover-nav--prev {
  left: 8px;
}

.gb-detail__cover-nav--next {
  right: 8px;
}

.gb-detail__cover-counter {
  position: absolute;
  right: 10px;
  bottom: 8px;
  z-index: 2;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: rgba(255, 255, 255, 0.88);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.gb-detail__gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 0.45rem;
  padding: 0 16px 8px;
}

.gb-detail__gallery-btn {
  display: block;
  width: 100%;
  margin: 0;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 8px;
  overflow: hidden;
  background: #111;
  cursor: pointer;
}

.gb-detail__gallery-btn.is-active {
  border-color: #fbfe00;
}

.gb-detail__gallery img,
.gb-detail__gallery .gb-sensitive-media,
.gb-detail__gallery-btn .gb-sensitive-media {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 6px;
  background: #111;
}

.gb-detail__gallery img,
.gb-detail__gallery .gb-sensitive-media img,
.gb-detail__gallery-btn .gb-sensitive-media img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 6px;
  background: #111;
}

.gb-detail__text {
  padding: 4px 18px 22px;
}

.gb-detail__text.is-quote-highlight {
  border-radius: 10px;
  animation: gb-quote-flash 1.8s ease;
}

.gb-detail__title {
  margin: 0 0 16px;
  font-size: 24px;
  font-weight: 900;
  letter-spacing: 0.5px;
  line-height: 1.35;
  color: #fff;
  word-break: break-word;
}

.gb-detail__title-cat {
  margin-right: 6px;
  color: #42a5f5;
  font-weight: 800;
}

.gb-detail__content {
  margin: 0;
  font-size: 16px;
  line-height: 1.7;
  color: #e0e0e0;
  white-space: normal;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.gb-detail__content--empty {
  color: #808080;
}

.gb-detail__content :deep(p) {
  margin: 0 0 0.85em;
}

.gb-detail__content :deep(p:last-child) {
  margin-bottom: 0;
}

.gb-detail__content :deep(p:empty) {
  display: none;
}

.gb-detail__content :deep(h1),
.gb-detail__content :deep(h2),
.gb-detail__content :deep(h3),
.gb-detail__content :deep(h4),
.gb-detail__content :deep(h5),
.gb-detail__content :deep(h6) {
  margin: 1.1em 0 0.55em;
  color: #fff;
  font-weight: 800;
  line-height: 1.35;
}

.gb-detail__content :deep(h1) {
  font-size: 1.45em;
}
.gb-detail__content :deep(h2) {
  font-size: 1.28em;
}
.gb-detail__content :deep(h3) {
  font-size: 1.12em;
}

.gb-detail__content :deep(ul),
.gb-detail__content :deep(ol) {
  margin: 0.55em 0 0.85em;
  padding-left: 1.4em;
}

.gb-detail__content :deep(li) {
  margin: 0.2em 0;
}

.gb-detail__content :deep(hr) {
  margin: 1.1em 0;
  border: none;
  border-top: 1px solid #2a2a2a;
}

.gb-detail__content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
}

.gb-detail__content :deep(a) {
  color: #6f9cff;
  text-decoration: underline;
}

.gb-detail__content :deep(pre) {
  background: #1a1a1a;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
}

.gb-detail__content :deep(code) {
  background: #1a1a1a;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: Consolas, Monaco, monospace;
  font-size: 0.92em;
}

.gb-detail__content :deep(pre code) {
  padding: 0;
  background: transparent;
}

.gb-detail__content :deep(blockquote) {
  border-left: 4px solid #bfff09;
  padding-left: 16px;
  margin: 12px 0;
  color: #b0b0b0;
}

.gb-detail__content :deep(table) {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 14px;
  background: #111;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
}

.gb-detail__content :deep(table th),
.gb-detail__content :deep(table td) {
  padding: 8px 12px;
  border: 1px solid #2a2a2a;
  text-align: left;
  vertical-align: top;
}

.gb-detail__content :deep(table thead th) {
  background: #1a1a1a;
  color: #fff;
  font-weight: 700;
}

.gb-detail__content :deep(table tbody tr:nth-child(even)) {
  background: #161616;
}

.gb-detail__right {
  flex: 2;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin: 12px 12px 12px 4px;
  background: rgba(0, 0, 0, 0.85);
  border-radius: 16px;
  overflow: hidden;
}

.gb-comments {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.35rem 0.85rem;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.gb-comments::-webkit-scrollbar {
  display: none;
}

.gb-comment-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.gb-comment.is-quote-highlight {
  border-radius: 10px;
  animation: gb-quote-flash 1.8s ease;
}

@keyframes gb-quote-flash {
  0%,
  100% {
    box-shadow: none;
    background: transparent;
  }
  20%,
  60% {
    box-shadow: inset 0 0 0 2px rgba(157, 204, 0, 0.65);
    background: rgba(157, 204, 0, 0.08);
  }
}

.gb-comment {
  display: flex;
  gap: 0.65rem;
  padding: 0.9rem 0.15rem;
}

.gb-comment + .gb-comment {
  border-top: 3px solid #1e1e1e;
}

.gb-comment__main {
  flex: 1;
  min-width: 0;
}

.gb-comment__head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.gb-comment__head strong {
  font-size: 0.85rem;
  color: #999;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gb-floor {
  margin-left: auto;
  flex-shrink: 0;
  padding: 0.05rem 0.45rem;
  border-radius: 0 6px 6px 6px;
  background: rgba(255, 255, 255, 0.06);
  font-size: 0.7rem;
  font-weight: 600;
  color: #999;
}

.gb-comment__body {
  margin: 0.4rem 0 0;
  font-size: 0.92rem;
  line-height: 1.55;
  color: #f0f0f0;
  white-space: pre-wrap;
  word-break: break-word;
}

.gb-comment__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.45rem;
  font-size: 0.72rem;
  color: #666;
}

.gb-comment__time {
  flex-shrink: 0;
}

.gb-comment__actions {
  display: inline-flex;
  align-items: center;
  gap: 0;
}

.gb-comment__icon-btn {
  position: relative;
  min-width: 28px;
  height: 28px;
  border: 0;
  padding: 0 7px;
  border-radius: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.48);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.gb-comment__icon-btn + .gb-comment__icon-btn,
.gb-comment__icon-btn + .gb-comment__menu-wrap,
.gb-comment__menu-wrap + .gb-comment__icon-btn {
  border-left: 1px solid rgba(255, 255, 255, 0.16);
}

.gb-comment__icon-btn--like {
  min-width: 0;
  padding: 0 8px;
}

.gb-comment__icon-btn:hover {
  color: #fbfe00;
}

.gb-comment__icon-btn.is-active {
  color: #fbfe00;
}

.gb-comment__icon-btn[data-tip]::after {
  content: attr(data-tip);
  position: absolute;
  left: 50%;
  bottom: calc(100% + 6px);
  transform: translateX(-50%) translateY(2px);
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(20, 20, 20, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.88);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.12s ease, transform 0.12s ease, visibility 0.12s ease;
  z-index: 8;
}

.gb-comment__icon-btn[data-tip]:hover::after {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(0);
}

.gb-comment__menu-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.gb-comment__menu-wrap + .gb-comment__icon-btn,
.gb-comment__icon-btn + .gb-comment__menu-wrap {
  border-left: 1px solid rgba(255, 255, 255, 0.16);
}

.gb-comment__menu {
  min-width: 128px;
  padding: 6px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #2a2a2a;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  gap: 0;
}

.gb-comment__menu--portal {
  position: fixed;
  z-index: 14000;
}

.gb-comment__menu-item {
  position: relative;
  display: block;
  width: 100%;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
  font: inherit;
  font-size: 0.8rem;
  text-align: center;
  padding: 9px 12px;
  cursor: pointer;
}

.gb-comment__menu-item + .gb-comment__menu-item {
  margin-top: 5px;
}

.gb-comment__menu-item + .gb-comment__menu-item::before {
  content: '';
  position: absolute;
  top: -3px;
  left: 14px;
  right: 14px;
  height: 1px;
  background: rgba(255, 255, 255, 0.12);
  pointer-events: none;
}

.gb-comment__menu-item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.gb-comment__menu-item:disabled {
  opacity: 0.45;
  cursor: wait;
}

.gb-detail__action--like {
  display: inline-flex;
  align-items: center;
  gap: 0;
  min-width: 0;
}

.gb-report-list {
  list-style: none;
  margin: 0;
  padding: 0 0.75rem 1rem;
}

.gb-report-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 0;
  border-bottom: 1px solid #2a2a2a;
}

.gb-report-item__main {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.gb-report-item__main strong {
  color: #fff;
  font-size: 0.85rem;
}

.gb-report-item__main span,
.gb-report-item__main time {
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.78rem;
}

.gb-report-item__reason {
  color: rgba(255, 255, 255, 0.72) !important;
}

.gb-report-item__preview {
  color: rgba(255, 255, 255, 0.62) !important;
}

.gb-report-item__status {
  margin-left: 0.4rem;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  vertical-align: middle;
}

.gb-report-item__status.is-pending {
  background: rgba(255, 59, 48, 0.18);
  color: #ff8a80;
}

.gb-report-item__status.is-handled {
  background: rgba(191, 255, 9, 0.14);
  color: #bfff09;
}

.gb-report-item__feedback {
  color: #bfff09 !important;
}

.gb-report-item__actions {
  display: flex;
  flex-shrink: 0;
  gap: 0.35rem;
}

.gb-comment__ops {
  display: inline-flex;
  gap: 0.35rem;
}

.gb-comment__op {
  border: 0;
  padding: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
}

.gb-comment__op:hover:not(:disabled) {
  color: #bfff09;
}

.gb-comment__op:disabled {
  opacity: 0.5;
  cursor: wait;
}

.gb-comment.is-blocked .gb-comment__main {
  opacity: 0.92;
}

.gb-comment__blocked-tag {
  margin-left: 0.35rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.68rem;
  font-weight: 700;
}

.gb-comment__blocked {
  margin-top: 0.2rem;
  padding: 0.55rem 0.65rem;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px dashed rgba(255, 255, 255, 0.12);
}

.gb-comment__blocked-tip {
  margin: 0;
  font-size: 0.82rem;
  color: rgba(255, 255, 255, 0.45);
}

.gb-comment__body--mosaic {
  margin: 0.35rem 0 0;
  filter: blur(6px);
  user-select: none;
  pointer-events: none;
}

.gb-comment__blocked-actions {
  display: flex;
  gap: 0.45rem;
  margin-top: 0.45rem;
}

.gb-detail__action.danger {
  border-color: rgba(255, 120, 120, 0.35);
  color: #ff9a9a;
}

.gb-detail__action.danger:hover:not(:disabled) {
  border-color: rgba(255, 120, 120, 0.65);
  color: #ffbdbd;
}

.gb-mod {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.85rem 1rem 1.25rem;
}

.gb-mod__hint {
  margin: 0 0 0.75rem;
  font-size: 0.82rem;
  color: rgba(255, 255, 255, 0.45);
}

.gb-mod__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.gb-mod__item {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: #1a1c20;
  overflow: hidden;
}

.gb-mod__item.is-hidden {
  opacity: 0.72;
  border-style: dashed;
}

.gb-mod__open {
  width: 100%;
  border: 0;
  padding: 0.75rem 0.85rem;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.gb-mod__top {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: center;
  margin-bottom: 0.35rem;
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.55);
}

.gb-mod__top strong {
  color: #bfff09;
}

.gb-mod__cat,
.gb-mod__badge {
  padding: 0 0.35rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
}

.gb-mod__badge {
  color: #ffbdbd;
}

.gb-mod__open h3 {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
  color: #fff;
}

.gb-mod__open p {
  margin: 0;
  font-size: 0.84rem;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.72);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.gb-mod__actions {
  display: flex;
  gap: 0.45rem;
  padding: 0 0.85rem 0.85rem;
}

.gb-hint.ok {
  color: #bfff09;
}

.gb-comment-login-hint {
  flex-shrink: 0;
  margin: 0;
  padding: 0.85rem 0.75rem;
  padding-bottom: max(0.85rem, env(safe-area-inset-bottom));
  border-top: 1px solid #202020;
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.85rem;
  text-align: center;
}

.gb-comment-login-hint__btn {
  border: 0;
  padding: 0;
  background: transparent;
  color: #bfff09;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.gb-comment-bar {
  flex-shrink: 0;
  display: flex;
  gap: 0.4rem;
  align-items: center;
  padding: 0.65rem 0.75rem;
  padding-bottom: max(0.65rem, env(safe-area-inset-bottom));
  border-top: 1px solid #202020;
  background: transparent;
}

.gb-comment-bar--rich {
  flex-direction: column;
  align-items: stretch;
}

.gb-comment-compose {
  position: relative;
  width: 100%;
  min-width: 0;
}

.gb-mention-list {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 6px);
  z-index: 30;
  list-style: none;
  margin: 0;
  padding: 6px;
  border-radius: 12px;
  border: 2px solid #333;
  background: #111;
  max-height: 180px;
  overflow-y: auto;
}

.gb-mention-list button,
.gb-mention-list__item {
  width: 100%;
  border: 0;
  background: transparent;
  color: #fff;
  text-align: left;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  font: inherit;
  font-size: 0.85rem;
}

.gb-mention-list__item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.gb-mention-list__avatar {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid #333;
  background: #222;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 800;
}

.gb-mention-list__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.gb-mention-list__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.gb-mention-list__meta strong {
  font-weight: 800;
  color: #fff;
}

.gb-mention-list__meta span {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
}

.gb-mention-list button:hover,
.gb-mention-list__item:hover {
  background: rgba(191, 255, 9, 0.12);
}

.gb-mention-list__hint {
  padding: 8px 10px;
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.8rem;
}

.gb-mention-list__section {
  padding: 8px 10px 4px;
  color: #bfff09;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.gb-quote-compose {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin-bottom: 0.55rem;
  padding: 0.6rem 0.7rem;
  border-left: 3px solid #fbfe00;
  border-radius: 0 8px 8px 0;
  background: rgba(0, 0, 0, 0.55);
}

.gb-quote-compose__body {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 0.2rem;
}

.gb-quote-compose__body strong {
  color: #bfff09;
  font-size: 0.75rem;
}

.gb-quote-compose__body span {
  color: rgba(255, 255, 255, 0.68);
  font-size: 0.78rem;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gb-quote-compose__close {
  border: 0;
  background: transparent;
  color: #888;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
}

.gb-fab-group {
  position: absolute;
  right: 1rem;
  bottom: 1.2rem;
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.gb-fab {
  width: 2.5rem;
  height: 2.5rem;
  border: 2px solid #333;
  border-radius: 999px;
  background: rgba(18, 18, 18, 0.92);
  color: #fff;
  font-size: 1rem;
  font-weight: 800;
  cursor: pointer;
}

.gb-fab:hover:not(:disabled) {
  border-color: #d8ff4d;
  color: #d8ff4d;
}

.gb-fab:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

:deep(.gb-mention) {
  color: #bfff09;
  font-weight: 800;
}

.gb-comment__images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.gb-comment__image-btn {
  border: 0;
  padding: 0;
  background: transparent;
  border-radius: 10px;
  cursor: zoom-in;
  overflow: hidden;
}

.gb-comment__image-btn:hover {
  box-shadow: 0 0 0 2px rgba(191, 255, 9, 0.45);
}

.gb-comment__image-btn img {
  display: block;
  max-width: min(220px, 100%);
  max-height: 180px;
  border-radius: 10px;
  border: 1px solid #333;
  object-fit: cover;
}

.gb-knock-toast {
  position: fixed;
  right: 16px;
  bottom: 88px;
  z-index: 1500;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 2px solid #333;
  background: rgba(0, 0, 0, 0.92);
  color: #fff;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}

.gb-knock-toast button {
  border: 0;
  border-radius: 999px;
  background: #fbfe00;
  color: #000;
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  padding: 6px 12px;
  cursor: pointer;
}

.gb-knock-toast__close {
  background: transparent !important;
  color: rgba(255, 255, 255, 0.55) !important;
  padding: 0 4px !important;
  font-size: 18px !important;
}

.gb-input {
  border: 1px solid #303030;
  background: #171717;
  color: #f0f0f0;
  font: inherit;
  outline: none;
  min-width: 0;
}

.gb-input--nick-sm {
  flex: 0 0 4.5rem;
  border-radius: 999px;
  padding: 0.45rem 0.55rem;
  font-size: 0.78rem;
}

.gb-input--say {
  flex: 1;
  border-radius: 999px;
  padding: 0.5rem 0.85rem;
  font-size: 0.85rem;
  min-height: 2.5rem;
}

.gb-input--say:focus,
.gb-input--nick-sm:focus {
  border-color: #4a4a4a;
  background: #111;
}

.gb-send {
  border: none;
  border-radius: 999px;
  background: var(--gb-primary);
  color: #111;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.gb-send.sm {
  flex-shrink: 0;
  padding: 0.45rem 0.85rem;
  font-size: 0.8rem;
}

.gb-send:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* 绳网式进场 / 退场 */
.gb-detail-enter-active,
.gb-detail-leave-active {
  transition: background-color 200ms cubic-bezier(0.165, 0.84, 0.44, 1);
}

.gb-detail-enter-active .gb-detail__stripe,
.gb-detail-leave-active .gb-detail__stripe {
  transition: opacity 200ms cubic-bezier(0.165, 0.84, 0.44, 1);
}

.gb-detail-enter-active .gb-detail__dialog,
.gb-detail-leave-active .gb-detail__dialog {
  transition:
    transform 200ms cubic-bezier(0.165, 0.84, 0.44, 1),
    opacity 200ms cubic-bezier(0.165, 0.84, 0.44, 1);
}

.gb-detail-enter-from {
  background-color: transparent;
}

.gb-detail-enter-from .gb-detail__stripe {
  opacity: 0;
}

.gb-detail-enter-from .gb-detail__dialog {
  opacity: 0;
  transform: translateX(5%);
}

.gb-detail-leave-to {
  background-color: transparent;
}

.gb-detail-leave-to .gb-detail__stripe {
  opacity: 0;
}

.gb-detail-leave-to .gb-detail__dialog {
  opacity: 0;
  transform: translateX(-5%);
}

@media (prefers-reduced-motion: reduce) {
  .gb-detail-enter-active,
  .gb-detail-leave-active,
  .gb-detail-enter-active .gb-detail__stripe,
  .gb-detail-leave-active .gb-detail__stripe,
  .gb-detail-enter-active .gb-detail__dialog,
  .gb-detail-leave-active .gb-detail__dialog {
    transition: none;
  }
}

@media (max-width: 1100px) {
  .gb-detail__dialog {
    width: 100%;
  }
}

@media (max-width: 900px) {
  .gb-drawer {
    min-width: min(360px, 100vw);
    max-width: 100vw;
  }

  .gb-detail {
    padding: 0.55rem;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: transparent;
  }

  .gb-detail__backdrop {
    background: rgba(0, 0, 0, 0.82);
  }

  .gb-detail__marquee .gb-marquee__band {
    width: 260%;
    height: 260%;
    left: -80%;
    top: -80%;
    font-size: clamp(360px, 48vw, 640px);
  }

  .gb-detail__dialog {
    /* 平板/手机仍尽量吃满可用区 */
    height: 100%;
  }

  .gb-detail__outer,
  .gb-detail__inner {
    border-radius: 18px 0 18px 18px;
  }

  .gb-detail__split {
    flex-direction: column;
  }

  .gb-detail__left {
    flex: 1 1 42%;
    margin: 0;
  }

  .gb-detail__left-scroll {
    margin: 8px 8px 0;
  }

  .gb-detail__right {
    flex: 1 1 58%;
    margin: 8px;
  }

  .gb-detail__cover-wrap {
    padding: 10px 12px 6px;
  }

  .gb-detail__cover img {
    max-height: 180px;
  }

  .gb-detail__text {
    padding: 2px 14px 14px;
  }

  .gb-detail__title {
    margin-bottom: 10px;
    font-size: 20px;
  }

  .gb-detail__content {
    font-size: 15px;
  }

  .gb-grid {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  }

  .gb-masonry {
    gap: 0.85rem;
  }

  .gb-masonry__col {
    gap: 0.85rem;
  }
}

@media (max-width: 560px) {
  .gb-drawer {
    min-width: 100vw;
    max-width: 100vw;
  }

  .gb-resize-handle {
    display: none;
  }

  .gb-header {
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 0.45rem;
    padding-left: 0.85rem;
    padding-right: 0.85rem;
  }

  .gb-header__lead {
    flex: 1 1 100%;
  }

  .gb-user {
    min-width: 0;
    max-width: 100%;
    width: 100%;
  }

  .gb-header :deep(.gb-user-chip) {
    min-width: 0;
    max-width: 100%;
    width: 100%;
  }

  .gb-header__actions {
    flex: 1 1 100%;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .gb-search,
  .gb-tabs,
  .gb-feed {
    padding-left: 0.85rem;
    padding-right: 0.85rem;
  }

  .gb-feed .gb-search,
  .gb-feed .gb-tabs {
    flex-shrink: 0;
    margin-left: -0.85rem;
    margin-right: -0.85rem;
  }

  .gb-search__field--q {
    flex: 1 1 100%;
  }

  .gb-search__ranges {
    flex: 1 1 100%;
  }

  .gb-search__range {
    flex: 1 1 auto;
    text-align: center;
    padding: 0 0.45rem;
  }

  .gb-search__actions {
    width: 100%;
  }

  .gb-search__btn {
    flex: 1;
  }

  .gb-search__clear {
    flex-shrink: 0;
  }

  .gb-tabs {
    gap: 0.35rem;
    padding-top: 0.55rem;
    padding-bottom: 0.55rem;
    flex-wrap: wrap;
    overflow: visible;
  }

  .gb-tab {
    font-size: 0.74rem;
    padding: 0.28rem 0.7rem;
  }

  .create-cats {
    flex-wrap: wrap;
  }

  .gb-detail {
    padding: 0;
  }

  .gb-detail__outer,
  .gb-detail__inner {
    border-radius: 0;
    padding: 0;
  }

  .gb-detail__top {
    border-radius: 0;
    padding: 0.55rem 0.7rem;
    padding-top: max(0.55rem, env(safe-area-inset-top));
  }

  .gb-detail__avatar-shell {
    width: 2.4rem;
    height: 2.4rem;
  }

  .gb-detail__mobile-tabs {
    display: flex;
  }

  .gb-detail__split {
    display: block;
    overflow: hidden;
    height: 100%;
  }

  .gb-detail__left,
  .gb-detail__right {
    display: none;
    height: 100%;
    flex: 1 1 auto;
    margin: 0;
  }

  .gb-detail__left.is-active,
  .gb-detail__right.is-active {
    display: flex;
    flex-direction: column;
  }

  .gb-detail__right {
    border-radius: 12px;
    margin: 6px;
  }

  .gb-detail__left-scroll {
    margin: 6px 6px 0;
    border-radius: 12px;
  }

  .gb-detail__cover img {
    max-height: 140px;
  }

  .gb-detail__gallery {
    grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
    padding: 0 12px 6px;
  }

  .gb-comment-bar {
    gap: 0.35rem;
    padding: 0.55rem 0.55rem max(0.55rem, env(safe-area-inset-bottom));
  }

  .gb-input--nick-sm {
    flex: 0 0 3.6rem;
    padding: 0.4rem 0.4rem;
    font-size: 0.72rem;
  }

  .gb-input--say {
    padding: 0.45rem 0.7rem;
    font-size: 0.8rem;
    min-height: 2.2rem;
  }

  .gb-send.sm {
    padding: 0.4rem 0.65rem;
    font-size: 0.74rem;
  }

  .gb-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .gb-masonry {
    gap: 0.75rem;
  }

  .gb-masonry__col {
    gap: 0.75rem;
  }
}

/* 矮屏（横屏手机 / 小笔记本）：压缩封面，优先保证评论区可用 */
@media (max-height: 700px) {
  .gb-detail {
    padding: 0.4rem;
  }

  .gb-detail__cover img {
    max-height: 120px;
  }

  .gb-detail__left-scroll,
  .gb-detail__right {
    margin: 6px;
  }

  .gb-detail__text {
    padding: 2px 12px 12px;
  }
}
</style>
