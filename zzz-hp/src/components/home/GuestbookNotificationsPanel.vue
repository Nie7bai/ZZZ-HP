<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  blockGuestbookUser,
  createGuestbookDmConversation,
  fetchGuestbookDmConversations,
  fetchGuestbookDmMessages,
  fetchGuestbookNotifications,
  markGuestbookNotificationsRead,
  searchGuestbookUsers,
  sendGuestbookDmMessage,
  type GuestbookDmConversation,
  type GuestbookDmMessage,
  type GuestbookEntry,
  type GuestbookKnockTab,
  type GuestbookNotification,
  type GuestbookSocialUser,
} from '@/api/guestbook'
import { resolveAssetUrl } from '@/utils/gameData'
import GuestbookRichComposer from '@/components/home/GuestbookRichComposer.vue'
import GuestbookRichText from '@/components/home/GuestbookRichText.vue'
import GuestbookComposerIcons from '@/components/home/GuestbookComposerIcons.vue'
import { useGuestbookMediaViewer } from '@/composables/useGuestbookMediaViewer'
import { useUserAuthStore } from '@/stores/userAuth'
import {
  attachQuote,
  formatMessagePreview,
  quotePreviewText,
  scrollToQuoteTarget,
  type GuestbookQuoteRef,
} from '@/utils/guestbookQuotes'

const props = defineProps<{
  initialChatPeerId?: number | null
  myAvatar?: string
  myNickname?: string
  /** 递增后跳转到有未读的分类 */
  jumpUnreadNonce?: number
}>()

const emit = defineEmits<{
  close: []
  openPost: [item: GuestbookEntry, highlightCommentId?: number | null]
  openUser: [userId: number]
  openReports: []
  openAccounts: []
  unreadChanged: []
}>()

const FAIRY_NAME = 'Fairy'
const FAIRY_AVATAR = '/images/fairy-avatar.png'
const marqueeLine = 'ZZZ HP '.repeat(4)
const KNOCK_RETURN_STATE_KEY = 'zzz-hp-knock-return'

interface KnockReturnState {
  activeTab: GuestbookKnockTab
  userSearchQuery: string
  userSearchResults: GuestbookSocialUser[]
  activeDmId: number | null
  activeConversationKey: number | null
  mainPaneFront?: 'chat' | 'search'
}

const KNOCK_TABS: { id: GuestbookKnockTab; label: string; short: string }[] = [
  { id: 'system', label: '系统通知', short: '系统' },
  { id: 'follow', label: '关注', short: '关注' },
  { id: 'chat', label: '聊天', short: '聊天' },
]

const FAIRY_ONLY_TYPES = new Set([
  'announcement',
  'changelog',
  'post_hidden',
  'post_deleted',
  'post_restored',
  'user_banned',
])

const SYSTEM_TYPES = new Set([
  'like',
  'favorite',
  'comment',
  'mention',
  'post_hidden',
  'post_deleted',
  'post_restored',
  'restore_request',
  'announcement',
  'changelog',
  'report',
  'report_handled',
  'user_banned',
  'unban_request',
])

const FOLLOW_TYPES = new Set(['follow_post'])

const loading = ref(false)
const error = ref('')
const activeTab = ref<GuestbookKnockTab>('system')
const items = ref<GuestbookNotification[]>([])

const dmLoading = ref(false)
const dmError = ref('')
const dmConversations = ref<GuestbookDmConversation[]>([])
const activeDmId = ref<number | null>(null)
const mainPaneFront = ref<'chat' | 'search'>('chat')
const dmMessages = ref<GuestbookDmMessage[]>([])
const dmDraft = ref('')
const dmImages = ref<string[]>([])
const dmSending = ref(false)
const dmQuote = ref<GuestbookQuoteRef | null>(null)
const messagesScrollRef = ref<HTMLElement | null>(null)
const dmComposerRef = ref<InstanceType<typeof GuestbookRichComposer> | null>(null)
const dmMsgMenuId = ref<number | null>(null)
const userAuth = useUserAuthStore()
const { openMediaViewer } = useGuestbookMediaViewer()

function dmPreviewText(content: string) {
  return formatMessagePreview(content) || '暂无消息'
}

function openDmImages(images: string[], index: number) {
  openMediaViewer(images, index)
}

function toggleDmMsgMenu(messageId: number) {
  dmMsgMenuId.value = dmMsgMenuId.value === messageId ? null : messageId
}

function closeDmMsgMenu() {
  dmMsgMenuId.value = null
}

async function onBlockDmPeer() {
  const peerId = activeDmConversation.value?.peerId
  if (!peerId || !userAuth.isLoggedIn) return
  dmError.value = ''
  try {
    await blockGuestbookUser(peerId)
    dmError.value = '已拉黑该用户'
  } catch (err) {
    dmError.value = err instanceof Error ? err.message : '拉黑失败'
  } finally {
    closeDmMsgMenu()
  }
}

const userSearchQuery = ref('')
const userSearchResults = ref<GuestbookSocialUser[]>([])
const userSearchLoading = ref(false)
const userSearchError = ref('')

function formatTime(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

function safeTitle(item: GuestbookNotification) {
  return formatMessagePreview(item.postTitle || '') || '你的委托'
}

function safeNotifyMessage(item: GuestbookNotification) {
  return formatMessagePreview(item.message || '')
}

function messageOf(item: GuestbookNotification) {
  const who = item.actorNickname || '有人'
  const title = safeTitle(item)
  switch (item.type) {
    case 'like':
      return `${who} 点赞了你的委托「${title}」`
    case 'favorite':
      return `${who} 收藏了你的委托「${title}」`
    case 'comment':
      return `${who} 评论了你的委托「${title}」`
    case 'mention':
      return `${who} 在委托「${title}」中 @ 了你`
    case 'post_hidden':
      return `你的委托「${title}」已被管理员屏蔽`
    case 'post_deleted':
      return `你的委托「${title}」已被管理员删除`
    case 'post_restored':
      return `你的委托「${title}」已恢复展示`
    case 'restore_request':
      return `${who} 申请恢复委托「${title}」`
    case 'announcement':
      return `站点发布了新公告「${title}」`
    case 'changelog':
      return `站点更新了日志「${title}」`
    case 'follow_post':
      return `你的关注 ${who} 发布了新的委托「${title}」`
    case 'report':
      return `${who} 举报了${reportTargetLabel(item)}「${title}」`
    case 'report_handled':
      return `你举报的${reportTargetLabel(item)}「${title}」已处理`
    case 'user_banned':
      return `账号已被封禁`
    case 'unban_request':
      return `${who} 申请解封`
    default:
      return `你的委托「${title}」有新动态`
  }
}

function reportTargetLabel(item: GuestbookNotification) {
  if (item.commentId) return '评论'
  if (!item.postId) return '用户'
  return '委托'
}

function avatarLetter(name: string) {
  return (name || '匿').trim().charAt(0).toUpperCase()
}

function avatarUrl(value?: string | null) {
  return resolveAssetUrl(value || '') || ''
}

function messageParts(item: GuestbookNotification) {
  const who = item.actorNickname || '有人'
  const title = safeTitle(item)
  switch (item.type) {
    case 'like':
      return { prefix: '', actor: who, suffix: ` 点赞了你的委托「${title}」`, actorId: item.actorUserId }
    case 'favorite':
      return { prefix: '', actor: who, suffix: ` 收藏了你的委托「${title}」`, actorId: item.actorUserId }
    case 'comment':
      return { prefix: '', actor: who, suffix: ` 评论了你的委托「${title}」`, actorId: item.actorUserId }
    case 'mention':
      return { prefix: '', actor: who, suffix: ` 在委托「${title}」中 @ 了你`, actorId: item.actorUserId }
    case 'follow_post':
      return { prefix: '你的关注 ', actor: who, suffix: ` 发布了新的委托「${title}」`, actorId: item.actorUserId }
    case 'restore_request':
      return { prefix: '', actor: who, suffix: ` 申请恢复委托「${title}」`, actorId: item.actorUserId }
    case 'report':
      return {
        prefix: '',
        actor: who,
        suffix: ` 举报了${reportTargetLabel(item)}「${title}」`,
        actorId: item.actorUserId,
      }
    case 'report_handled':
      return {
        text: `你举报的${reportTargetLabel(item)}「${title}」已处理`,
        actorId: null as number | null,
      }
    case 'user_banned':
      return { text: '账号已被封禁', actorId: null as number | null }
    case 'unban_request':
      return {
        prefix: '',
        actor: who,
        suffix: ' 申请解封',
        actorId: item.actorUserId,
      }
    case 'post_hidden':
      return { text: `你的委托「${title}」已被管理员屏蔽`, actorId: null as number | null }
    case 'post_deleted':
      return { text: `你的委托「${title}」已被管理员删除`, actorId: null as number | null }
    case 'post_restored':
      return { text: `你的委托「${title}」已恢复展示`, actorId: null as number | null }
    case 'announcement':
      return { text: `站点发布了新公告「${title}」`, actorId: null as number | null }
    case 'changelog':
      return { text: `站点更新了日志「${title}」`, actorId: null as number | null }
    default:
      return { text: `你的委托「${title}」有新动态`, actorId: null as number | null }
  }
}

function isFairyNotify(item: GuestbookNotification) {
  return FAIRY_ONLY_TYPES.has(item.type)
}

function notifyDisplayAvatar(item: GuestbookNotification) {
  return isFairyNotify(item) ? FAIRY_AVATAR : avatarUrl(item.actorAvatar)
}

function tabItems(tab: GuestbookKnockTab) {
  if (tab === 'system') return items.value.filter((n) => SYSTEM_TYPES.has(n.type))
  if (tab === 'follow') return items.value.filter((n) => FOLLOW_TYPES.has(n.type))
  return []
}

const filteredItems = computed(() => tabItems(activeTab.value))

const tabUnread = computed(() => ({
  system: tabItems('system').filter((n) => !n.isRead).length,
  follow: tabItems('follow').filter((n) => !n.isRead).length,
  chat: dmConversations.value.reduce((acc, c) => acc + (c.unreadCount || 0), 0),
}))

type ConversationRow = {
  key: number
  postId: number | null
  postTitle: string
  actorUserId: number | null
  actorNickname: string
  actorAvatar: string
  messages: GuestbookNotification[]
  unreadCount: number
  preview: string
  isFollow: boolean
}

function followPreview(item: GuestbookNotification) {
  const title = formatMessagePreview(item.postTitle || '') || '新委托'
  return `发布了新的委托「${title}」`
}

function buildSystemConversations(list: GuestbookNotification[]): ConversationRow[] {
  const map = new Map<number, GuestbookNotification[]>()
  for (const n of list) {
    const pid = Number(n.postId)
    // postId=0：用户举报等无帖子关联的系统通知，归入专用会话
    const key = Number.isFinite(pid) && pid > 0 ? pid : 0
    const arr = map.get(key) || []
    arr.push(n)
    map.set(key, arr)
  }

  const rows: ConversationRow[] = []
  for (const [postId, messages] of map.entries()) {
    const sorted = [...messages].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    if (!sorted.length) continue
    const unreadCount = sorted.reduce((acc, x) => acc + (x.isRead ? 0 : 1), 0)
    const last = sorted[sorted.length - 1]!
    rows.push({
      key: postId,
      postId: postId > 0 ? postId : null,
      postTitle:
        postId > 0
          ? formatMessagePreview(last.postTitle || '') || '你的委托'
          : '系统通知',
      actorUserId: null,
      actorNickname: '',
      actorAvatar: '',
      messages: sorted,
      unreadCount,
      preview: messageOf(last),
      isFollow: false,
    })
  }

  rows.sort((a, b) => {
    const atA = a.messages[a.messages.length - 1]?.createdAt || ''
    const atB = b.messages[b.messages.length - 1]?.createdAt || ''
    return new Date(atB).getTime() - new Date(atA).getTime()
  })
  return rows
}

function buildFollowConversations(list: GuestbookNotification[]): ConversationRow[] {
  const map = new Map<number, GuestbookNotification[]>()
  for (const n of list) {
    const aid = Number(n.actorUserId)
    if (!Number.isFinite(aid) || aid <= 0) continue
    const arr = map.get(aid) || []
    arr.push(n)
    map.set(aid, arr)
  }

  const rows: ConversationRow[] = []
  for (const [actorUserId, messages] of map.entries()) {
    const sorted = [...messages].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    if (!sorted.length) continue
    const unreadCount = sorted.reduce((acc, x) => acc + (x.isRead ? 0 : 1), 0)
    const last = sorted[sorted.length - 1]!
    rows.push({
      key: actorUserId,
      postId: last.postId ?? null,
      postTitle: last.postTitle || '新委托',
      actorUserId,
      actorNickname: last.actorNickname || '用户',
      actorAvatar: last.actorAvatar || '',
      messages: sorted,
      unreadCount,
      preview: followPreview(last),
      isFollow: true,
    })
  }

  rows.sort((a, b) => {
    const atA = a.messages[a.messages.length - 1]?.createdAt || ''
    const atB = b.messages[b.messages.length - 1]?.createdAt || ''
    return new Date(atB).getTime() - new Date(atA).getTime()
  })
  return rows
}

function buildConversations(list: GuestbookNotification[], tab: GuestbookKnockTab): ConversationRow[] {
  if (tab === 'follow') return buildFollowConversations(list)
  return buildSystemConversations(list)
}

const conversations = computed(() => buildConversations(filteredItems.value, activeTab.value))
const activeConversationKey = ref<number | null>(null)
const activeConversation = computed(
  () => conversations.value.find((c) => c.key === activeConversationKey.value) || null,
)
const activeMessages = computed(() => activeConversation.value?.messages || [])

const dmMessagesDisplay = computed(() => dmMessages.value)

const activeDmConversation = computed(
  () => dmConversations.value.find((c) => c.id === activeDmId.value) || null,
)

const searchPanelOpen = computed(
  () =>
    activeTab.value === 'chat' &&
    Boolean(userSearchQuery.value.trim() || userSearchLoading.value || userSearchResults.value.length),
)

const sidebarEmptyText = computed(() => {
  if (activeTab.value === 'chat') {
    return dmConversations.value.length ? '' : '搜索用户或选择会话'
  }
  if (loading.value) return ''
  if (activeTab.value === 'follow') return '暂无关注动态'
  return '暂无系统通知'
})

function pickInitialNotifyActive(convs: ConversationRow[]) {
  const withUnread = convs.find((c) => c.unreadCount > 0)
  activeConversationKey.value = (withUnread || convs[0] || null)?.key ?? null
}

function pickInitialDmActive(convs: GuestbookDmConversation[]) {
  const withUnread = convs.find((c) => c.unreadCount > 0)
  activeDmId.value = (withUnread || convs[0] || null)?.id ?? null
}

function saveKnockReturnState() {
  const state: KnockReturnState = {
    activeTab: activeTab.value,
    userSearchQuery: userSearchQuery.value,
    userSearchResults: userSearchResults.value,
    activeDmId: activeDmId.value,
    activeConversationKey: activeConversationKey.value,
    mainPaneFront: mainPaneFront.value,
  }
  sessionStorage.setItem(KNOCK_RETURN_STATE_KEY, JSON.stringify(state))
}

function takeKnockReturnState(): KnockReturnState | null {
  try {
    const raw = sessionStorage.getItem(KNOCK_RETURN_STATE_KEY)
    if (!raw) return null
    sessionStorage.removeItem(KNOCK_RETURN_STATE_KEY)
    return JSON.parse(raw) as KnockReturnState
  } catch {
    return null
  }
}

function emitOpenUser(userId: number) {
  saveKnockReturnState()
  emit('openUser', userId)
}

function scrollMessagesToEnd() {
  const run = () => {
    const el = messagesScrollRef.value
    if (!el) return
    el.scrollTop = el.scrollHeight
  }
  void nextTick(() => {
    run()
    // 图片等异步内容撑高后，再滚一次到底
    requestAnimationFrame(() => {
      run()
      window.setTimeout(run, 80)
    })
  })
}

function quoteDmMessage(message: GuestbookDmMessage) {
  dmQuote.value = {
    type: 'dm',
    id: message.id,
    nickname: message.isMine
      ? props.myNickname || '我'
      : message.senderNickname || '用户',
    preview: quotePreviewText(message.content, message.images),
  }
}

function clearDmQuote() {
  dmQuote.value = null
}

function jumpToQuotedMessage(quote: GuestbookQuoteRef) {
  if (quote.type !== 'dm') return
  const ok = scrollToQuoteTarget(`ik-dm-msg-${quote.id}`)
  if (!ok) dmError.value = '原消息不在当前会话中'
}

async function loadNotifications(skipPickInitial = false) {
  loading.value = true
  error.value = ''
  try {
    items.value = await fetchGuestbookNotifications()
    if (!skipPickInitial && activeTab.value !== 'chat') {
      pickInitialNotifyActive(buildConversations(tabItems(activeTab.value), activeTab.value))
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载敲敲失败'
  } finally {
    loading.value = false
  }
}

async function loadDmConversations(skipPickInitial = false) {
  dmLoading.value = true
  dmError.value = ''
  try {
    dmConversations.value = await fetchGuestbookDmConversations()
    if (!skipPickInitial) pickInitialDmActive(dmConversations.value)
    if (activeDmId.value) await loadDmMessages(activeDmId.value)
  } catch (err) {
    dmError.value = err instanceof Error ? err.message : '加载聊天失败'
  } finally {
    dmLoading.value = false
  }
}

async function loadDmMessages(conversationId: number) {
  try {
    const data = await fetchGuestbookDmMessages(conversationId)
    dmMessages.value = data.messages
    const idx = dmConversations.value.findIndex((c) => c.id === conversationId)
    if (idx >= 0) {
      const prevUnread = dmConversations.value[idx]?.unreadCount || 0
      dmConversations.value[idx] = { ...dmConversations.value[idx], ...data.conversation, unreadCount: 0 }
      if (prevUnread > 0) emit('unreadChanged')
    }
    scrollMessagesToEnd()
  } catch (err) {
    dmError.value = err instanceof Error ? err.message : '加载消息失败'
  }
}

async function selectDmConversation(id: number) {
  activeDmId.value = id
  mainPaneFront.value = 'chat'
  dmQuote.value = null
  await loadDmMessages(id)
}

async function markAllRead() {
  if (activeTab.value === 'chat') return
  try {
    // 不传 ids：标记当前用户全部通知已读（含其他分类）
    await markGuestbookNotificationsRead()
    items.value = items.value.map((n) => ({ ...n, isRead: true }))
    emit('unreadChanged')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '标记已读失败'
  }
}

async function jumpToUnread() {
  // 确保通知与私信都已加载，否则 chat 未读会一直是 0
  if (!items.value.length && !loading.value) {
    await loadNotifications(true)
  }
  await loadDmConversations(true)

  const order: GuestbookKnockTab[] = ['system', 'follow', 'chat']
  const hit = order.find((tab) => {
    if (tab === 'chat') {
      return dmConversations.value.some((c) => (c.unreadCount || 0) > 0)
    }
    return tabItems(tab).some((n) => !n.isRead)
  })
  if (!hit) return

  if (hit === 'chat') {
    activeTab.value = 'chat'
    activeConversationKey.value = null
    dmQuote.value = null
    userSearchResults.value = []
    mainPaneFront.value = 'chat'
    const conv = dmConversations.value.find((c) => (c.unreadCount || 0) > 0)
    if (conv) {
      await selectDmConversation(conv.id)
    } else {
      pickInitialDmActive(dmConversations.value)
      if (activeDmId.value) await loadDmMessages(activeDmId.value)
    }
    return
  }

  activeTab.value = hit
  activeDmId.value = null
  dmMessages.value = []
  dmQuote.value = null
  const convs = buildConversations(tabItems(hit), hit)
  pickInitialNotifyActive(convs)
  await nextTick()
  const el = document.querySelector('.ik-knock__msg-bubble.is-unread') as HTMLElement | null
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

watch(
  () => props.jumpUnreadNonce,
  (nonce) => {
    if (nonce == null || nonce <= 0) return
    void jumpToUnread()
  },
)

async function openNotification(item: GuestbookNotification) {
  if (!item.isRead) {
    try {
      await markGuestbookNotificationsRead([item.id])
      item.isRead = true
      emit('unreadChanged')
    } catch {
      /* ignore */
    }
  }
  if (item.type === 'report' || item.type === 'unban_request') {
    if (item.type === 'unban_request') {
      emit('openAccounts')
      return
    }
    emit('openReports')
    return
  }
  if (item.type === 'report_handled' || item.type === 'user_banned') {
    return
  }
  if (!item.postId) {
    if (item.actorUserId) emitOpenUser(item.actorUserId)
    return
  }
  emit(
    'openPost',
    { id: item.postId } as GuestbookEntry,
    item.commentId != null ? Number(item.commentId) : null,
  )
}

async function openReportsManage(item: GuestbookNotification) {
  if (!item.isRead) {
    try {
      await markGuestbookNotificationsRead([item.id])
      item.isRead = true
    } catch {
      /* ignore */
    }
  }
  if (item.type === 'unban_request') {
    emit('openAccounts')
    return
  }
  emit('openReports')
}

async function sendDm() {
  const cid = activeDmId.value
  const text = dmDraft.value.trim()
  const images = [...dmImages.value]
  if (!cid || (!text && !images.length) || dmSending.value) return
  dmSending.value = true
  dmError.value = ''
  try {
    const payloadContent = dmQuote.value ? attachQuote(dmQuote.value, text) : text
    const result = await sendGuestbookDmMessage(cid, { content: payloadContent, images })
    dmDraft.value = ''
    dmImages.value = []
    dmQuote.value = null
    dmMessages.value = [...dmMessages.value, result.message]
    const idx = dmConversations.value.findIndex((c) => c.id === cid)
    if (idx >= 0) {
      dmConversations.value[idx] = {
        ...dmConversations.value[idx],
        ...result.conversation,
        lastMessage: formatMessagePreview(result.message.content, result.message.images) || '[图片]',
        lastMessageAt: result.message.createdAt,
      }
    }
    scrollMessagesToEnd()
  } catch (err) {
    dmError.value = err instanceof Error ? err.message : '发送失败'
  } finally {
    dmSending.value = false
  }
}

function notifyHasActorLink(item: GuestbookNotification) {
  const parts = messageParts(item)
  return Boolean(parts.actorId && parts.actor)
}

function notifyPlainText(item: GuestbookNotification) {
  return messageParts(item).text || ''
}

function openActorProfile(item: GuestbookNotification) {
  if (item.actorUserId) emitOpenUser(item.actorUserId)
}

function openActorById(event: Event, userId: number) {
  event.stopPropagation()
  if (userId > 0) emitOpenUser(userId)
}

function openPeerProfile() {
  const peerId = activeDmConversation.value?.peerId
  if (peerId) emitOpenUser(peerId)
}

function selectTab(tab: GuestbookKnockTab) {
  if (activeTab.value === tab) return
  activeTab.value = tab
  activeConversationKey.value = null
  activeDmId.value = null
  dmMessages.value = []
  dmQuote.value = null
  userSearchResults.value = []
  if (tab === 'chat') {
    void loadDmConversations()
  } else {
    pickInitialNotifyActive(buildConversations(tabItems(tab), tab))
    scrollMessagesToEnd()
  }
}

async function searchUsers() {
  const q = userSearchQuery.value.trim()
  userSearchError.value = ''
  mainPaneFront.value = 'search'
  if (!q) {
    userSearchResults.value = []
    return
  }
  userSearchLoading.value = true
  try {
    userSearchResults.value = await searchGuestbookUsers(q)
  } catch (err) {
    userSearchResults.value = []
    userSearchError.value = err instanceof Error ? err.message : '搜索失败'
  } finally {
    userSearchLoading.value = false
  }
}

function openUserFromSearch(userId: number) {
  emitOpenUser(userId)
}

async function startChatFromSearch(userId: number) {
  await openChatWithPeer(userId)
}

function openPeerProfileFromAvatar(event: Event, peerId: number) {
  event.stopPropagation()
  emitOpenUser(peerId)
}

async function openChatWithPeer(peerUserId: number) {
  activeTab.value = 'chat'
  mainPaneFront.value = 'chat'
  dmError.value = ''
  try {
    const conv = await createGuestbookDmConversation(peerUserId)
    await loadDmConversations()
    activeDmId.value = conv.id
    await loadDmMessages(conv.id)
  } catch (err) {
    dmError.value = err instanceof Error ? err.message : '发起聊天失败'
    await loadDmConversations()
  }
}

watch(
  () => [activeConversationKey.value, activeDmId.value, activeTab.value] as const,
  () => {
    scrollMessagesToEnd()
  },
)

watch(
  () => props.initialChatPeerId,
  (peerId) => {
    if (peerId && peerId > 0) void openChatWithPeer(peerId)
  },
  { immediate: true },
)

onMounted(async () => {
  document.addEventListener('click', closeDmMsgMenu)
  const shouldRestore = Boolean(sessionStorage.getItem(KNOCK_RETURN_STATE_KEY))
  await loadNotifications(shouldRestore)
  if (!shouldRestore) return

  const state = takeKnockReturnState()
  if (!state) return

  activeTab.value = state.activeTab
  userSearchQuery.value = state.userSearchQuery || ''
  userSearchResults.value = Array.isArray(state.userSearchResults) ? state.userSearchResults : []
  mainPaneFront.value = state.mainPaneFront === 'search' ? 'search' : 'chat'

  if (state.activeTab === 'chat') {
    await loadDmConversations(true)
    if (state.activeDmId) {
      activeDmId.value = state.activeDmId
      await loadDmMessages(state.activeDmId)
    }
  } else {
    activeConversationKey.value = state.activeConversationKey ?? null
    activeDmId.value = null
    dmMessages.value = []
  }
  scrollMessagesToEnd()
})

onUnmounted(() => {
  document.removeEventListener('click', closeDmMsgMenu)
})
</script>

<template>
  <div class="ik-knock-panel">
    <div class="ik-knock__marquee is-running" aria-hidden="true">
      <div class="ik-knock__marquee-band">
        <div class="ik-knock__marquee-row ik-knock__marquee-row--ltr">
          <div class="ik-knock__marquee-track">
            <span class="ik-knock__marquee-text">{{ marqueeLine }}</span>
            <span class="ik-knock__marquee-text">{{ marqueeLine }}</span>
          </div>
        </div>
        <div class="ik-knock__marquee-row ik-knock__marquee-row--rtl">
          <div class="ik-knock__marquee-track">
            <span class="ik-knock__marquee-text">{{ marqueeLine }}</span>
            <span class="ik-knock__marquee-text">{{ marqueeLine }}</span>
          </div>
        </div>
        <div class="ik-knock__marquee-row ik-knock__marquee-row--ltr ik-knock__marquee-row--offset">
          <div class="ik-knock__marquee-track">
            <span class="ik-knock__marquee-text">{{ marqueeLine }}</span>
            <span class="ik-knock__marquee-text">{{ marqueeLine }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="activeTab !== 'chat' && tabUnread[activeTab]" class="ik-knock__toolbar">
      <button type="button" class="ik-knock__toolbar-btn" @click="markAllRead">全部已读</button>
    </div>

    <div class="ik-knock__body">
      <aside class="ik-knock__sidebar">
        <div class="ik-knock__tabs ik-knock__tabs--sidebar" role="tablist" aria-label="敲敲分类">
          <button
            v-for="tab in KNOCK_TABS"
            :key="tab.id"
            type="button"
            role="tab"
            class="ik-knock__tab"
            :class="{ 'is-active': activeTab === tab.id }"
            :aria-selected="activeTab === tab.id"
            :title="tab.label"
            @click="selectTab(tab.id)"
          >
            <span class="ik-knock__tab-label">{{ tab.short }}</span>
            <span v-if="tabUnread[tab.id]" class="ik-knock__unread-dot" aria-hidden="true" />
          </button>
        </div>

        <form v-if="activeTab === 'chat'" class="ik-knock__search" @submit.prevent="searchUsers">
          <input
            v-model="userSearchQuery"
            class="ik-knock__search-input"
            type="search"
            maxlength="40"
            placeholder="UID / 昵称"
            @focus="mainPaneFront = 'search'"
          />
          <button type="submit" class="ik-knock__search-btn" :disabled="userSearchLoading">
            {{ userSearchLoading ? '…' : '搜' }}
          </button>
        </form>
        <p v-if="activeTab === 'chat' && userSearchError" class="ik-knock__sidebar-hint err">{{ userSearchError }}</p>

        <div class="ik-knock__list">
          <template v-if="activeTab === 'chat'">
            <button
              v-for="c in dmConversations"
              :key="c.id"
              type="button"
              class="ik-knock__list-item"
              :class="{ 'is-active': activeDmId === c.id }"
              @click="selectDmConversation(c.id)"
            >
              <span
                class="ik-knock__avatar ik-knock__avatar--clickable"
                @click="openPeerProfileFromAvatar($event, c.peerId)"
              >
                <img
                  v-if="avatarUrl(c.peerAvatar)"
                  :src="avatarUrl(c.peerAvatar)"
                  class="ik-knock__avatar-img"
                  alt=""
                  draggable="false"
                />
                <span v-else class="ik-knock__avatar-letter">{{ avatarLetter(c.peerNickname) }}</span>
              </span>
              <span class="ik-knock__item-text">
                <span class="ik-knock__item-title">{{ c.peerNickname || '用户' }}</span>
                <span class="ik-knock__item-subtitle">{{ dmPreviewText(c.lastMessage) }}</span>
              </span>
              <span v-if="c.unreadCount > 0" class="ik-knock__unread-dot ik-knock__unread-dot--lg" aria-label="未读" />
            </button>
          </template>

          <template v-else>
            <button
              v-for="c in conversations"
              :key="c.key"
              type="button"
              class="ik-knock__list-item"
              :class="{ 'is-active': activeConversationKey === c.key }"
              @click="activeConversationKey = c.key"
            >
              <span
                class="ik-knock__avatar"
                :class="{ 'ik-knock__avatar--clickable': c.isFollow && Boolean(c.actorUserId) }"
                @click="c.isFollow && c.actorUserId && openActorById($event, c.actorUserId)"
              >
                <img
                  v-if="c.isFollow && avatarUrl(c.actorAvatar)"
                  :src="avatarUrl(c.actorAvatar)"
                  class="ik-knock__avatar-img"
                  alt=""
                  draggable="false"
                />
                <span
                  v-else-if="c.isFollow"
                  class="ik-knock__avatar-letter"
                >{{ avatarLetter(c.actorNickname) }}</span>
                <img
                  v-else
                  :src="FAIRY_AVATAR"
                  class="ik-knock__avatar-img"
                  alt=""
                  draggable="false"
                />
              </span>
              <span class="ik-knock__item-text">
                <span class="ik-knock__item-title">{{
                  c.isFollow ? c.actorNickname || '用户' : c.postTitle || '你的委托'
                }}</span>
                <span class="ik-knock__item-subtitle">{{ c.preview || '暂无消息' }}</span>
              </span>
              <span v-if="c.unreadCount > 0" class="ik-knock__unread-dot ik-knock__unread-dot--lg" aria-label="未读" />
            </button>
          </template>

          <p
            v-if="!loading && !dmLoading && sidebarEmptyText && !conversations.length && !dmConversations.length && !searchPanelOpen"
            class="ik-knock__sidebar-hint"
          >
            {{ sidebarEmptyText }}
          </p>
          <p v-if="loading || dmLoading" class="ik-knock__sidebar-hint">加载中…</p>
        </div>
      </aside>

      <section class="ik-knock__main">
        <template v-if="activeTab === 'chat'">
          <div class="ik-knock__main-stack">
            <div
              class="ik-knock__main-layer ik-knock__main-layer--chat"
              :class="{ 'is-front': mainPaneFront === 'chat' }"
              @pointerdown="mainPaneFront = 'chat'"
            >
              <header v-if="activeDmConversation" class="ik-knock__main-head">
                <strong>{{ activeDmConversation.peerNickname || '用户' }}</strong>
              </header>
              <div v-if="activeDmConversation" ref="messagesScrollRef" class="ik-knock__messages">
            <div
              v-for="m in dmMessagesDisplay"
              :id="'ik-dm-msg-' + m.id"
              :key="m.id"
              class="ik-knock__msg"
              :class="{ 'is-mine': m.isMine }"
            >
                  <span
                    class="ik-knock__avatar"
                    :class="{ 'ik-knock__avatar--clickable': !m.isMine }"
                    @click="!m.isMine && activeDmConversation && openPeerProfileFromAvatar($event, activeDmConversation.peerId)"
                  >
                    <img
                      v-if="avatarUrl(m.isMine ? props.myAvatar : m.senderAvatar)"
                      :src="avatarUrl(m.isMine ? props.myAvatar : m.senderAvatar)"
                      class="ik-knock__avatar-img"
                      alt=""
                      draggable="false"
                    />
                    <span v-else class="ik-knock__avatar-letter">{{
                      avatarLetter(m.isMine ? props.myNickname || '我' : m.senderNickname)
                    }}</span>
                  </span>
                  <div class="ik-knock__msg-body">
                    <span class="ik-knock__msg-name">{{
                      m.isMine ? props.myNickname || '我' : m.senderNickname || '用户'
                    }}</span>
                <div v-if="m.content" class="ik-knock__msg-bubble">
                  <GuestbookRichText
                    :content="m.content"
                    :is-mine="m.isMine"
                    in-bubble
                    @jump-quote="jumpToQuotedMessage"
                  />
                </div>
                    <div v-if="m.images?.length" class="ik-knock__msg-images">
                      <button
                        v-for="(img, idx) in m.images"
                        :key="img + idx"
                        type="button"
                        class="ik-knock__msg-image-btn"
                        title="双击查看大图"
                        @dblclick.prevent="openDmImages(m.images || [], idx)"
                      >
                        <img
                          :src="avatarUrl(img)"
                          alt=""
                          draggable="false"
                        />
                      </button>
                    </div>
                    <div class="ik-knock__msg-meta" :class="{ 'is-mine': m.isMine }">
                      <span class="ik-knock__msg-time">{{ formatTime(m.createdAt) }}</span>
                      <button type="button" class="ik-knock__msg-icon-btn" data-tip="引用" @click="quoteDmMessage(m)">
                        <GuestbookComposerIcons kind="reply" />
                      </button>
                      <div
                        v-if="!m.isMine && userAuth.isLoggedIn"
                        class="ik-knock__msg-menu-wrap"
                        @click.stop
                      >
                        <button
                          type="button"
                          class="ik-knock__msg-icon-btn"
                          data-tip="更多"
                          @click.stop="toggleDmMsgMenu(m.id)"
                        >
                          <GuestbookComposerIcons kind="more" />
                        </button>
                        <div v-if="dmMsgMenuId === m.id" class="ik-knock__msg-menu">
                          <button type="button" @click="onBlockDmPeer">拉黑用户</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="ik-knock__empty-pill">EMPTY</div>
              <div v-if="activeDmConversation" class="ik-knock__composer">
                <div v-if="dmQuote" class="ik-knock__quote-compose">
                  <div class="ik-knock__quote-compose-body">
                    <strong>引用 {{ dmQuote.nickname }}</strong>
                    <span>{{ dmQuote.preview || '…' }}</span>
                  </div>
                  <button type="button" class="ik-knock__quote-compose-close" @click="clearDmQuote">×</button>
                </div>
                <GuestbookRichComposer
                  ref="dmComposerRef"
                  v-model="dmDraft"
                  v-model:images="dmImages"
                  :sending="dmSending"
                  placeholder="输入消息…"
                  :maxlength="2000"
                  @send="sendDm"
                  @preview-image="({ urls, index }) => openMediaViewer(urls, index)"
                />
              </div>
            </div>

            <div
              v-if="searchPanelOpen"
              class="ik-knock__main-layer ik-knock__main-layer--search ik-knock__search-panel"
              :class="{ 'is-front': mainPaneFront === 'search' }"
              @pointerdown="mainPaneFront = 'search'"
            >
              <header class="ik-knock__search-panel-head">
                <strong>搜索结果</strong>
                <span>「{{ userSearchQuery.trim() }}」</span>
              </header>
              <p v-if="userSearchError" class="ik-knock__search-panel-hint err">{{ userSearchError }}</p>
              <p v-else-if="userSearchLoading" class="ik-knock__search-panel-hint">搜索中…</p>
              <p v-else-if="!userSearchResults.length" class="ik-knock__search-panel-hint">未找到用户</p>
              <ul v-else class="ik-knock__search-panel-list">
                <li v-for="u in userSearchResults" :key="u.id" class="ik-knock__search-panel-item">
                  <button type="button" class="ik-knock__search-panel-main" @click="openUserFromSearch(u.id)">
                    <span class="ik-knock__avatar">
                      <img v-if="avatarUrl(u.avatar)" :src="avatarUrl(u.avatar)" class="ik-knock__avatar-img" alt="" />
                      <span v-else class="ik-knock__avatar-letter">{{ avatarLetter(u.nickname) }}</span>
                    </span>
                    <span class="ik-knock__item-text">
                      <span class="ik-knock__item-title">{{ u.nickname }}</span>
                      <span class="ik-knock__item-subtitle">UID {{ u.id }}</span>
                    </span>
                  </button>
                  <button type="button" class="ik-knock__mini-btn" @click="startChatFromSearch(u.id)">敲敲</button>
                </li>
              </ul>
            </div>
          </div>
          <p v-if="dmError" class="ik-knock__main-error">{{ dmError }}</p>
        </template>

        <template v-else>
          <header v-if="activeConversation" class="ik-knock__main-head">
            <strong>{{
              activeTab === 'follow'
                ? activeConversation.actorNickname || '用户'
                : FAIRY_NAME
            }}</strong>
          </header>
          <div v-if="activeConversation" ref="messagesScrollRef" class="ik-knock__messages">
            <div v-for="m in activeMessages" :key="m.id" class="ik-knock__msg">
              <span
                class="ik-knock__avatar"
                :class="{ 'ik-knock__avatar--clickable': Boolean(m.actorUserId) && !isFairyNotify(m) }"
                @click="m.actorUserId && !isFairyNotify(m) && openActorProfile(m)"
              >
                <img :src="notifyDisplayAvatar(m)" class="ik-knock__avatar-img" alt="" draggable="false" />
              </span>
              <div class="ik-knock__msg-body">
                <span
                  v-if="activeTab === 'follow' && m.actorNickname"
                  class="ik-knock__msg-name ik-knock__name-link"
                  @click="openActorProfile(m)"
                >{{ m.actorNickname }}</span>
                <div class="ik-knock__msg-row">
                  <button
                    type="button"
                    class="ik-knock__msg-bubble"
                    :class="{ 'is-unread': !m.isRead }"
                    @click="openNotification(m)"
                  >
                    <template v-if="activeTab === 'follow'">
                      {{ followPreview(m) }}
                    </template>
                    <template v-else-if="notifyHasActorLink(m)">
                      {{ messageParts(m).prefix }}
                      <span class="ik-knock__name-link" @click.stop="openActorProfile(m)">{{
                        messageParts(m).actor
                      }}</span>
                      {{ messageParts(m).suffix }}
                    </template>
                    <template v-else>
                      {{ notifyPlainText(m) }}
                    </template>
                    <span
                      v-if="
                        safeNotifyMessage(m) &&
                        (m.type === 'post_hidden' ||
                          m.type === 'post_deleted' ||
                          m.type === 'restore_request' ||
                          m.type === 'report' ||
                          m.type === 'report_handled' ||
                          m.type === 'user_banned' ||
                          m.type === 'unban_request')
                      "
                      class="ik-knock__msg-extra"
                    >
                      {{ safeNotifyMessage(m) }}
                    </span>
                  </button>
                  <span
                    v-if="!m.isRead"
                    class="ik-knock__unread-dot ik-knock__unread-dot--clickable"
                    role="button"
                    tabindex="0"
                    aria-label="查看未读"
                    @click.stop="openNotification(m)"
                    @keydown.enter.prevent="openNotification(m)"
                  />
                </div>
                <span class="ik-knock__msg-time">{{ formatTime(m.createdAt) }}</span>
                <button
                  v-if="m.type === 'report' || m.type === 'unban_request'"
                  type="button"
                  class="ik-knock__msg-quote"
                  @click="openReportsManage(m)"
                >
                  {{ m.type === 'unban_request' ? '前往账号管理' : '前往处理' }}
                </button>
                <button
                  v-else-if="m.postId"
                  type="button"
                  class="ik-knock__msg-quote"
                  @click="openNotification(m)"
                >
                  委托 · {{ safeTitle(m) }}
                </button>
              </div>
            </div>
          </div>
          <div v-else-if="error" class="ik-knock__empty-pill err">{{ error }}</div>
          <div v-else class="ik-knock__empty-pill">EMPTY</div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ik-knock__msg-image-btn {
  border: 0;
  padding: 0;
  background: transparent;
  border-radius: 10px;
  overflow: hidden;
  cursor: zoom-in;
}

.ik-knock__msg-image-btn:hover {
  box-shadow: 0 0 0 2px rgba(251, 254, 0, 0.45);
}

.ik-knock__msg-image-btn img {
  display: block;
  max-width: 160px;
  border-radius: 10px;
}

.ik-knock__msg-extra {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.85;
}

.ik-knock__list-item--search {
  cursor: default;
}

.ik-knock__search-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
}

.ik-knock__list-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  padding: 0;
}

.ik-knock__mini-btn {
  flex-shrink: 0;
  border: 2px solid #333;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  padding: 4px 10px;
  cursor: pointer;
}

.ik-knock__mini-btn:hover {
  border-color: #fbfe00;
  color: #fbfe00;
}

.ik-knock__main-error {
  margin: 0;
  padding: 8px 14px;
  color: #ff6b6b;
  font-size: 12px;
}

.ik-knock__empty-pill.err {
  color: #ff6b6b;
  letter-spacing: 1px;
}

.ik-knock__name-link {
  color: #9aaa5a;
  font-weight: 700;
  cursor: pointer;
}

.ik-knock__name-link:hover {
  text-decoration: underline;
}

.ik-knock__msg-name {
  font-size: 11px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.55);
}

.ik-knock__avatar--clickable {
  cursor: pointer;
}

.ik-knock__msg.is-quote-highlight,
.ik-knock__msg.is-quote-highlight .ik-knock__msg-bubble {
  animation: ik-quote-flash 1.8s ease;
}

@keyframes ik-quote-flash {
  0%,
  100% {
    box-shadow: none;
  }
  20%,
  60% {
    box-shadow: 0 0 0 2px rgba(157, 204, 0, 0.75);
  }
}

.ik-knock__search-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ik-knock__main-stack {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ik-knock__main-layer {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #0d0d0d;
  z-index: 1;
}

.ik-knock__main-layer.is-front {
  z-index: 2;
}

.ik-knock__main-layer--chat:not(.is-front) {
  pointer-events: none;
}

.ik-knock__main-layer--search:not(.is-front) {
  pointer-events: none;
}

.ik-knock__search-panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 2px solid #202020;
  color: #fff;
}

.ik-knock__search-panel-head span {
  color: rgba(255, 255, 255, 0.45);
  font-size: 12px;
}

.ik-knock__search-panel-hint {
  padding: 16px;
  color: rgba(255, 255, 255, 0.45);
  font-size: 13px;
}

.ik-knock__search-panel-hint.err {
  color: #ff6b6b;
}

.ik-knock__search-panel-list {
  list-style: none;
  margin: 0;
  padding: 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ik-knock__search-panel-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ik-knock__search-panel-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  box-shadow: inset 0 0 0 1px #333;
  color: inherit;
  padding: 8px 12px;
  cursor: pointer;
  text-align: left;
}
</style>
