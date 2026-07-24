<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  blockGuestbookUser,
  fetchGuestbook,
  fetchGuestbookFollowers,
  fetchGuestbookFollowing,
  fetchGuestbookUserProfile,
  fetchMyBlockedUsers,
  fetchMyComments,
  fetchMyFavoritePosts,
  fetchMyLikedPosts,
  followGuestbookUser,
  reportGuestbookUser,
  requestGuestbookUnban,
  requestRestoreGuestbook,
  setProfilePinned,
  unblockGuestbookUser,
  unfollowGuestbookUser,
  type GuestbookComment,
  type GuestbookEntry,
  type GuestbookProfileTab,
  type GuestbookSocialUser,
  type GuestbookUserProfile,
} from '@/api/guestbook'
import { resolveAssetUrl } from '@/utils/gameData'
import { useUserAuthStore } from '@/stores/userAuth'
import GuestbookSensitiveMedia from '@/components/home/GuestbookSensitiveMedia.vue'
import GuestbookLevelCard from '@/components/home/GuestbookLevelCard.vue'
import GuestbookConfirmDialog from '@/components/home/GuestbookConfirmDialog.vue'

const props = defineProps<{
  restoreTab?: GuestbookProfileTab | null
  profileUserId?: number | null
}>()

const emit = defineEmits<{
  close: []
  openPost: [item: GuestbookEntry, fromTab?: GuestbookProfileTab]
  logout: []
  openAccount: []
  openUser: [userId: number]
  openChat: [userId: number]
}>()

const userAuth = useUserAuthStore()

const NAME_MAX = 20
const BIO_MAX = 100
const marqueeLine = 'ZZZ HP '.repeat(4)

type MenuKey = 'menu' | 'blacklist' | 'edit-name' | 'edit-bio' | 'logout' | 'profile-display' | null

const PROFILE_DISPLAY_OPTIONS: { key: GuestbookProfileTab; label: string }[] = [
  { key: 'posts', label: '我的委托' },
  { key: 'favorites', label: '我的收藏' },
  { key: 'likes', label: '我的点赞' },
  { key: 'comments', label: '我的评论' },
]

const menu = ref<MenuKey>(null)
const saving = ref(false)
const uploading = ref(false)
const error = ref('')
const hint = ref('')
const nameInput = ref('')
const bioInput = ref('')
const avatarInput = ref<HTMLInputElement | null>(null)
const bannerInput = ref<HTMLInputElement | null>(null)
const profileShowDraft = ref<GuestbookProfileTab[]>(['posts', 'favorites', 'likes', 'comments'])
const profileSocialPublicDraft = ref(false)

const myPosts = ref<GuestbookEntry[]>([])
const anonymousPosts = ref<GuestbookEntry[]>([])
const favoritePosts = ref<GuestbookEntry[]>([])
const likedPosts = ref<GuestbookEntry[]>([])
const myComments = ref<GuestbookComment[]>([])
const postsLoading = ref(false)
const pinBusyId = ref<number | null>(null)
const restoreBusyId = ref<number | null>(null)
const externalProfile = ref<GuestbookUserProfile | null>(null)
const socialUsers = ref<GuestbookSocialUser[]>([])
const blockedUsers = ref<GuestbookSocialUser[]>([])
const socialBusy = ref(false)
const followBusy = ref(false)
const reportDialog = ref({
  open: false,
  busy: false,
  reason: '',
})
const banDetailOpen = ref(false)
const unbanDialog = ref({
  open: false,
  busy: false,
  reason: '',
})

type ProfileTab = GuestbookProfileTab
const activeTab = ref<ProfileTab>('posts')

const selfTabs = [
  { key: 'posts' as const, label: '我的委托' },
  { key: 'anonymous-posts' as const, label: '匿名委托' },
  { key: 'favorites' as const, label: '我的收藏' },
  { key: 'likes' as const, label: '我的点赞' },
  { key: 'comments' as const, label: '我的评论' },
  { key: 'followers' as const, label: '粉丝' },
  { key: 'following' as const, label: '关注' },
]

const otherTabs = [
  { key: 'posts' as const, label: '委托' },
  { key: 'followers' as const, label: '粉丝' },
  { key: 'following' as const, label: '关注' },
]

const targetUserId = computed(() => {
  const mine = Number(userAuth.user?.id)
  const passed = props.profileUserId != null ? Number(props.profileUserId) : null
  if (passed != null && Number.isFinite(passed) && passed > 0) return passed
  if (Number.isFinite(mine) && mine > 0) return mine
  return null
})
const isSelf = computed(() => {
  const mine = Number(userAuth.user?.id)
  const target = targetUserId.value
  if (!Number.isFinite(mine) || mine <= 0) return props.profileUserId == null
  return target === mine
})
const visibleTabs = computed(() => {
  if (isSelf.value) return selfTabs
  const show = new Set(externalProfile.value?.profileShowTabs || ['posts'])
  const socialPublic = Boolean(externalProfile.value?.profilePublicSocial)
  return otherTabs.filter((tab) => {
    if (tab.key === 'followers' || tab.key === 'following') return socialPublic
    return show.has(tab.key)
  })
})

const tabPosts = computed(() => {
  if (activeTab.value === 'anonymous-posts') return anonymousPosts.value
  if (activeTab.value === 'favorites') return favoritePosts.value
  if (activeTab.value === 'likes') return likedPosts.value
  return myPosts.value
})

const tabEmptyText = computed(() => {
  if (activeTab.value === 'followers') return '还没有粉丝'
  if (activeTab.value === 'following') return '还没有关注任何人'
  if (activeTab.value === 'favorites') return '还没有收藏任何委托'
  if (activeTab.value === 'likes') return '还没有点赞任何委托'
  if (activeTab.value === 'comments') return '还没有发表任何评论'
  if (activeTab.value === 'anonymous-posts') return '还没有发布匿名委托'
  return isSelf.value ? '还没有发布任何内容哦' : '还没有发布任何委托'
})

const user = computed(() => userAuth.user)
const uid = computed(() => externalProfile.value?.uid || user.value?.uid || user.value?.id || '—')
const displayName = computed(() => {
  if (isSelf.value) {
    return externalProfile.value?.nickname || user.value?.nickname || '绳网旅人'
  }
  return externalProfile.value?.nickname || '绳网旅人'
})
const bio = computed(() => {
  if (isSelf.value) {
    return externalProfile.value?.bio ?? user.value?.bio ?? ''
  }
  return externalProfile.value?.bio ?? ''
})
const avatarUrl = computed(() => {
  if (isSelf.value) {
    return resolveAssetUrl(externalProfile.value?.avatar || user.value?.avatar || '') || ''
  }
  return resolveAssetUrl(externalProfile.value?.avatar || '') || ''
})
const bannerUrl = computed(() => {
  if (isSelf.value) {
    return resolveAssetUrl(externalProfile.value?.banner || user.value?.banner || '') || ''
  }
  return resolveAssetUrl(externalProfile.value?.banner || '') || ''
})
const level = computed(() => externalProfile.value?.level || user.value?.level || 1)
const exp = computed(() => externalProfile.value?.exp ?? user.value?.exp ?? 0)
const dailyTasks = computed(() => externalProfile.value?.dailyTasks)
const isFollowing = computed(() => Boolean(externalProfile.value?.isFollowing))
const isBlockedByMe = computed(() => Boolean(externalProfile.value?.isBlockedByMe))
const isBanned = computed(() =>
  Boolean(isSelf.value ? user.value?.isBanned : externalProfile.value?.isBanned),
)
const banReason = computed(() =>
  isSelf.value ? user.value?.banReason || '' : externalProfile.value?.banReason || '',
)
const bannedAt = computed(() =>
  isSelf.value ? user.value?.bannedAt || null : externalProfile.value?.bannedAt || null,
)
const banUntil = computed(() =>
  isSelf.value ? user.value?.banUntil || null : externalProfile.value?.banUntil || null,
)
const stats = computed(() => ({
  views: isSelf.value
    ? (user.value?.stats?.totalViews ?? externalProfile.value?.totalViews ?? 0)
    : (externalProfile.value?.totalViews ?? 0),
  favorites: isSelf.value
    ? (user.value?.stats?.totalFavorites ?? externalProfile.value?.totalFavorites ?? 0)
    : (externalProfile.value?.totalFavorites ?? 0),
  likes: isSelf.value
    ? (user.value?.stats?.totalLikes ?? externalProfile.value?.totalLikes ?? 0)
    : (externalProfile.value?.totalLikes ?? 0),
  posts: isSelf.value
    ? (user.value?.stats?.postCount ?? externalProfile.value?.postCount ?? myPosts.value.length)
    : (externalProfile.value?.postCount ?? myPosts.value.length),
  followers: externalProfile.value?.followerCount ?? 0,
  following: externalProfile.value?.followingCount ?? 0,
}))

const MARKED_USERS_KEY = 'gb-marked-user-ids'
const markedUserIds = ref<number[]>([])

function loadMarkedUsers() {
  try {
    const raw = localStorage.getItem(MARKED_USERS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    markedUserIds.value = Array.isArray(parsed)
      ? parsed.filter((id) => Number.isFinite(Number(id))).map((id) => Number(id))
      : []
  } catch {
    markedUserIds.value = []
  }
}

function saveMarkedUsers() {
  try {
    localStorage.setItem(MARKED_USERS_KEY, JSON.stringify(markedUserIds.value))
  } catch {
    /* ignore */
  }
}

function isMarkedUser(userId: number) {
  return markedUserIds.value.includes(userId)
}

function toggleMarkedUser(userId: number) {
  if (isMarkedUser(userId)) {
    markedUserIds.value = markedUserIds.value.filter((id) => id !== userId)
  } else {
    markedUserIds.value = [...markedUserIds.value, userId]
  }
  saveMarkedUsers()
}

const isSocialListTab = computed(
  () => activeTab.value === 'followers' || activeTab.value === 'following',
)
const sortedSocialUsers = computed(() =>
  [...socialUsers.value].sort(
    (a, b) => Number(isMarkedUser(b.id)) - Number(isMarkedUser(a.id)),
  ),
)

const bannerStyle = computed(() => {
  if (bannerUrl.value) {
    return { backgroundImage: `url('${bannerUrl.value}')` }
  }
  return {}
})

function formatNumber(n: number) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function avatarLetter(name: string) {
  return (name || '旅').trim().charAt(0).toUpperCase()
}

function avatarTone(name: string) {
  let hash = 0
  for (const ch of name || '旅') hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const hues = [72, 188, 32, 280, 12, 210, 45, 160]
  return hues[hash % hues.length]
}

function coverUrl(item: GuestbookEntry) {
  return (
    resolveAssetUrl(item.cover || item.images?.[0] || '/guestbook_image/zzz.jpg') ||
    '/guestbook_image/zzz.jpg'
  )
}

function coverTone(item: GuestbookEntry) {
  let hash = 0
  const seed = `${item.category}-${item.title}-${item.id}`
  for (const ch of seed) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0
  return 20 + (hash % 320)
}

function authorAvatarUrl(avatar?: string | null) {
  return resolveAssetUrl(avatar || '') || ''
}

function socialCardBg(person: GuestbookSocialUser) {
  const banner = authorAvatarUrl(person.banner)
  if (banner) {
    return { backgroundImage: `url('${banner}')` }
  }
  return { background: 'linear-gradient(135deg, #1a1a2e, #16213e)' }
}

async function copyUid() {
  const text = String(uid.value)
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* ignore */
  }
}

function openMenu() {
  if (!userAuth.isLoggedIn) return
  menu.value = 'menu'
  error.value = ''
  hint.value = ''
  if (isSelf.value) void loadBlockedUsers()
}

function openBlacklistMenu() {
  menu.value = 'blacklist'
  void loadBlockedUsers()
}

function closeMenu() {
  menu.value = null
  error.value = ''
  hint.value = ''
}

function backToMenu() {
  menu.value = 'menu'
  error.value = ''
  hint.value = ''
}

function openEditName() {
  nameInput.value = displayName.value
  menu.value = 'edit-name'
  error.value = ''
  hint.value = ''
}

function openEditBio() {
  bioInput.value = bio.value
  menu.value = 'edit-bio'
  error.value = ''
  hint.value = ''
}

function openChat() {
  if (!targetUserId.value || isSelf.value || isBlockedByMe.value) return
  closeMenu()
  emit('openChat', targetUserId.value)
}

function openLogout() {
  menu.value = 'logout'
  error.value = ''
  hint.value = ''
}

async function submitName() {
  const trimmed = nameInput.value.trim()
  if (!trimmed) {
    error.value = '用户名不能为空'
    return
  }
  if (trimmed.length > NAME_MAX) {
    error.value = `用户名不能超过 ${NAME_MAX} 个字符`
    return
  }
  if (trimmed === displayName.value) {
    hint.value = '什么都没改呢！'
    backToMenu()
    return
  }
  saving.value = true
  error.value = ''
  try {
    await userAuth.updateProfile({ nickname: trimmed })
    closeMenu()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '修改用户名失败'
  } finally {
    saving.value = false
  }
}

async function submitBio() {
  const trimmed = bioInput.value.trim()
  if (trimmed.length > BIO_MAX) {
    error.value = `签名不能超过 ${BIO_MAX} 个字符`
    return
  }
  if (trimmed === bio.value) {
    hint.value = '什么都没改呢！'
    backToMenu()
    return
  }
  saving.value = true
  error.value = ''
  try {
    await userAuth.updateProfile({ bio: trimmed })
    closeMenu()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '修改签名失败'
  } finally {
    saving.value = false
  }
}

async function onPickImage(event: Event, field: 'avatar' | 'banner') {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  uploading.value = true
  error.value = ''
  try {
    await userAuth.uploadProfileImage(file, field)
    closeMenu()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '上传失败'
    menu.value = 'menu'
  } finally {
    uploading.value = false
  }
}

async function loadProfileCard() {
  const id = targetUserId.value
  if (!id || id <= 0) {
    externalProfile.value = null
    return
  }
  try {
    externalProfile.value = await fetchGuestbookUserProfile(id)
    if (isSelf.value) void userAuth.refreshMe()
  } catch {
    externalProfile.value = null
  }
}

async function loadSocialList() {
  const id = targetUserId.value
  if (!id) {
    socialUsers.value = []
    return
  }
  socialBusy.value = true
  try {
    if (activeTab.value === 'followers') {
      socialUsers.value = await fetchGuestbookFollowers(id)
    } else if (activeTab.value === 'following') {
      socialUsers.value = await fetchGuestbookFollowing(id)
    } else {
      socialUsers.value = []
    }
  } catch {
    socialUsers.value = []
  } finally {
    socialBusy.value = false
  }
}

async function loadBlockedUsers() {
  if (!isSelf.value || !userAuth.isLoggedIn) {
    blockedUsers.value = []
    return
  }
  try {
    blockedUsers.value = await fetchMyBlockedUsers()
  } catch {
    blockedUsers.value = []
  }
}

async function toggleFollow() {
  const id = targetUserId.value
  if (!id || isSelf.value || !userAuth.isLoggedIn || followBusy.value) return
  followBusy.value = true
  error.value = ''
  hint.value = ''
  try {
    if (isFollowing.value) {
      await unfollowGuestbookUser(id)
      if (externalProfile.value) externalProfile.value.isFollowing = false
      hint.value = '已取消关注'
    } else {
      await followGuestbookUser(id)
      if (externalProfile.value) externalProfile.value.isFollowing = true
      hint.value = '已关注'
    }
    await loadProfileCard()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '操作失败'
  } finally {
    followBusy.value = false
  }
}

async function toggleBlock() {
  const id = targetUserId.value
  if (!id || isSelf.value || !userAuth.isLoggedIn || followBusy.value) return
  followBusy.value = true
  error.value = ''
  hint.value = ''
  try {
    if (isBlockedByMe.value) {
      await unblockGuestbookUser(id)
      if (externalProfile.value) externalProfile.value.isBlockedByMe = false
      hint.value = '已移出黑名单'
    } else {
      await blockGuestbookUser(id)
      if (externalProfile.value) externalProfile.value.isBlockedByMe = true
      if (externalProfile.value) externalProfile.value.isFollowing = false
      hint.value = '已加入黑名单'
    }
    await loadProfileCard()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '操作失败'
  } finally {
    followBusy.value = false
  }
}

async function unblockUser(userId: number) {
  try {
    await unblockGuestbookUser(userId)
    await loadBlockedUsers()
    hint.value = '已取消拉黑'
  } catch (err) {
    error.value = err instanceof Error ? err.message : '取消拉黑失败'
    menu.value = 'menu'
  }
}

function openReportUser() {
  if (!userAuth.isLoggedIn || isSelf.value || !targetUserId.value) return
  closeMenu()
  reportDialog.value = { open: true, busy: false, reason: '' }
}

function closeReportUser() {
  reportDialog.value = { open: false, busy: false, reason: '' }
}

async function confirmReportUser() {
  const id = targetUserId.value
  if (!id || reportDialog.value.busy) return
  reportDialog.value.busy = true
  error.value = ''
  try {
    const result = await reportGuestbookUser(id, { reason: reportDialog.value.reason.trim() })
    hint.value = result.duplicate ? '今日已举报过该用户' : '已提交举报'
    closeReportUser()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '举报失败'
    reportDialog.value.busy = false
  }
}

function formatBanRemaining(banUntilValue?: string | null) {
  if (!banUntilValue) return '永久'
  const ms = new Date(banUntilValue).getTime() - Date.now()
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

function openBanDetail() {
  if (!isBanned.value) return
  banDetailOpen.value = true
}

function closeBanDetail() {
  banDetailOpen.value = false
  unbanDialog.value = { open: false, busy: false, reason: '' }
}

async function confirmUnbanRequest() {
  if (!isSelf.value || unbanDialog.value.busy) return
  const reason = unbanDialog.value.reason.trim()
  if (!reason) {
    error.value = '请填写申请原因'
    return
  }
  unbanDialog.value.busy = true
  try {
    await requestGuestbookUnban(reason)
    hint.value = '解封申请已提交'
    closeBanDetail()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '申请失败'
    unbanDialog.value.busy = false
  }
}

function openSocialTab(tab: 'followers' | 'following') {
  activeTab.value = tab
  void loadActiveTab()
}

async function loadMyPosts() {
  const id = targetUserId.value
  if (!id) {
    myPosts.value = []
    return
  }
  postsLoading.value = true
  try {
    myPosts.value = await fetchGuestbook({ userId: id })
    if (isSelf.value) await userAuth.refreshMe()
  } catch {
    myPosts.value = []
  } finally {
    postsLoading.value = false
  }
}

async function loadAnonymousPosts() {
  const id = targetUserId.value
  if (!id || !isSelf.value) {
    anonymousPosts.value = []
    return
  }
  postsLoading.value = true
  try {
    anonymousPosts.value = await fetchGuestbook({ userId: id, anonymous: 'only' })
  } catch {
    anonymousPosts.value = []
  } finally {
    postsLoading.value = false
  }
}

async function loadFavorites() {
  if (!user.value?.id) {
    favoritePosts.value = []
    return
  }
  postsLoading.value = true
  try {
    favoritePosts.value = await fetchMyFavoritePosts()
  } catch {
    favoritePosts.value = []
  } finally {
    postsLoading.value = false
  }
}

async function loadLikedPosts() {
  if (!user.value?.id) {
    likedPosts.value = []
    return
  }
  postsLoading.value = true
  try {
    likedPosts.value = await fetchMyLikedPosts()
  } catch {
    likedPosts.value = []
  } finally {
    postsLoading.value = false
  }
}

async function loadMyCommentsList() {
  if (!user.value?.id) {
    myComments.value = []
    return
  }
  postsLoading.value = true
  try {
    myComments.value = await fetchMyComments()
  } catch {
    myComments.value = []
  } finally {
    postsLoading.value = false
  }
}

async function loadActiveTab() {
  await loadProfileCard()
  if (activeTab.value === 'posts') await loadMyPosts()
  else if (activeTab.value === 'anonymous-posts') await loadAnonymousPosts()
  else if (activeTab.value === 'favorites') await loadFavorites()
  else if (activeTab.value === 'likes') await loadLikedPosts()
  else if (activeTab.value === 'comments') await loadMyCommentsList()
  else if (activeTab.value === 'followers' || activeTab.value === 'following') await loadSocialList()
}

function selectTab(tab: ProfileTab) {
  if (activeTab.value === tab) return
  activeTab.value = tab
  void loadActiveTab()
}

function openProfileDisplayMenu() {
  profileShowDraft.value = [
    ...(userAuth.user?.profileShowTabs || ['posts', 'favorites', 'likes', 'comments']),
  ] as GuestbookProfileTab[]
  profileSocialPublicDraft.value = Boolean(userAuth.user?.profilePublicSocial)
  menu.value = 'profile-display'
}

function toggleProfileShowTab(key: GuestbookProfileTab) {
  if (key === 'posts') return
  const set = new Set(profileShowDraft.value)
  if (set.has(key)) set.delete(key)
  else set.add(key)
  if (!set.has('posts')) set.add('posts')
  profileShowDraft.value = PROFILE_DISPLAY_OPTIONS.map((o) => o.key).filter((k) => set.has(k))
}

async function saveProfileDisplay() {
  saving.value = true
  error.value = ''
  hint.value = ''
  try {
    await userAuth.updateProfile({
      profileShowTabs: profileShowDraft.value,
      profilePublicSocial: profileSocialPublicDraft.value,
    })
    hint.value = '名片展示已更新'
    closeMenu()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
    menu.value = 'profile-display'
  } finally {
    saving.value = false
  }
}

function openPostsTabFromMenu() {
  openProfileDisplayMenu()
}

async function toggleProfilePin(item: GuestbookEntry) {
  if (pinBusyId.value != null) return
  pinBusyId.value = item.id
  try {
    await setProfilePinned(item.id, !item.profilePinned)
    if (activeTab.value === 'anonymous-posts') await loadAnonymousPosts()
    else await loadMyPosts()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '置顶失败'
    menu.value = 'menu'
  } finally {
    pinBusyId.value = null
  }
}

async function requestRestore(item: GuestbookEntry) {
  if (restoreBusyId.value != null || item.restoreRequestedAt) return
  restoreBusyId.value = item.id
  error.value = ''
  hint.value = ''
  try {
    const updated = await requestRestoreGuestbook(item.id)
    const target = item.isAnonymous ? anonymousPosts.value : myPosts.value
    const idx = target.findIndex((p) => p.id === item.id)
    if (idx >= 0) target[idx] = { ...target[idx], ...updated }
    hint.value = '恢复申请已提交，请等待管理员处理'
  } catch (err) {
    error.value = err instanceof Error ? err.message : '申请恢复失败'
  } finally {
    restoreBusyId.value = null
  }
}

function postStatusLabel(item: GuestbookEntry) {
  if (item.isDeleted) return '已删除'
  if (item.isHidden) return '已屏蔽'
  return ''
}

function formatCommentTime(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function confirmLogout() {
  closeMenu()
  emit('logout')
}

function openAccountCenter() {
  closeMenu()
  emit('openAccount')
}

function onOverlayClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('ik-overlay')) {
    if (menu.value === 'menu' || menu.value === 'blacklist') closeMenu()
    else backToMenu()
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !menu.value) return
  e.stopPropagation()
  if (menu.value === 'menu' || menu.value === 'blacklist') closeMenu()
  else backToMenu()
}

watch(
  () => props.profileUserId,
  (next, prev) => {
    const nextTarget = next ?? userAuth.user?.id ?? null
    const prevTarget = prev ?? userAuth.user?.id ?? null
    if (nextTarget === prevTarget) return
    activeTab.value = 'posts'
    error.value = ''
    void loadActiveTab()
  },
)

watch(
  () => props.restoreTab,
  (tab) => {
    if (!tab) return
    activeTab.value = tab
    void loadActiveTab()
  },
)

watch(menu, (val) => {
  if (val) window.addEventListener('keydown', onKeydown, true)
  else window.removeEventListener('keydown', onKeydown, true)
})

onMounted(() => {
  loadMarkedUsers()
  void loadActiveTab()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <div class="gb-profile gb-profile--modal">
    <div class="ik-card">
      <div class="ik-tab-bar">
        <div class="ik-tab-bar__left">
          <span class="ik-tab-bar__label">UID:</span>
          <span class="ik-tab-bar__value">{{ uid }}</span>
          <button type="button" class="ik-tab-bar__copy" aria-label="复制UID" @click="copyUid">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
        </div>
        <button
          v-if="userAuth.isLoggedIn"
          type="button"
          class="ik-more-btn"
          @click="openMenu"
        >
          更多操作
        </button>
      </div>

      <div class="ik-banner-card">
        <div class="ik-banner" :class="{ 'ik-banner--plain': !bannerUrl }" :style="bannerStyle">
          <div class="ik-banner__user">
            <div class="ik-banner__avatar-wrap">
              <div
                class="ik-banner__avatar"
                :style="avatarUrl ? undefined : { '--tone': String(avatarTone(displayName)) }"
              >
                <img
                  v-if="avatarUrl"
                  :src="avatarUrl"
                  alt=""
                  class="ik-banner__avatar-img"
                />
                <span v-else class="ik-banner__avatar-letter">{{ avatarLetter(displayName) }}</span>
              </div>
              <span class="ik-banner__level">{{ level }}</span>
            </div>
            <div class="ik-banner__info">
              <h1 class="ik-banner__name">{{ displayName }}</h1>
              <span class="ik-banner__zzz-badge">绳网旅人 · Lv.{{ level }}</span>
              <button
                v-if="isBanned"
                type="button"
                class="ik-banner__ban"
                @click="openBanDetail"
              >
                封禁状态
              </button>
            </div>
          </div>

          <div class="ik-banner__stats">
            <span class="ik-stat">
              <span class="ik-stat__label">浏览量</span>
              <span class="ik-stat__num">{{ formatNumber(stats.views) }}</span>
            </span>
            <span class="ik-stat__sep">-</span>
            <span class="ik-stat">
              <span class="ik-stat__label">被收藏</span>
              <span class="ik-stat__num">{{ formatNumber(stats.favorites) }}</span>
            </span>
            <span class="ik-stat__sep">-</span>
            <span class="ik-stat">
              <span class="ik-stat__label">点赞</span>
              <span class="ik-stat__num">{{ formatNumber(stats.likes) }}</span>
            </span>
            <span class="ik-stat__sep">-</span>
            <span class="ik-stat">
              <span class="ik-stat__label">发帖</span>
              <span class="ik-stat__num">{{ formatNumber(stats.posts) }}</span>
            </span>
            <span class="ik-stat__sep">-</span>
            <span class="ik-stat">
              <span class="ik-stat__label">粉丝</span>
              <span class="ik-stat__num">{{ formatNumber(stats.followers) }}</span>
            </span>
          </div>
        </div>

        <div class="ik-banner-footer">
          <p v-if="bio" class="ik-banner-footer__sig">{{ bio }}</p>
          <p v-else class="ik-banner-footer__sig ik-banner-footer__sig--empty">
            这个人很神秘，什么都没有留下。
          </p>
        </div>
      </div>

      <GuestbookLevelCard
        v-if="isSelf"
        :level="level"
        :exp="exp"
        :show-daily="true"
        :daily-tasks="dailyTasks"
      />
    </div>

    <div class="gb-profile__posts">
      <nav class="gb-profile__tabs" aria-label="个人内容">
        <button
          v-for="tab in visibleTabs"
          :key="tab.key"
          type="button"
          class="gb-profile__tab"
          :class="{ 'is-active': activeTab === tab.key }"
          @click="selectTab(tab.key)"
        >
          {{ tab.label }}
        </button>
      </nav>

      <div v-if="isSocialListTab" class="gb-profile__social-page">
        <p v-if="hint" class="gb-profile__hint ok">{{ hint }}</p>
        <p v-if="error" class="gb-profile__hint err">{{ error }}</p>
        <p v-if="socialBusy" class="gb-profile__empty">加载中…</p>
        <p v-else-if="!socialUsers.length" class="gb-profile__empty">{{ tabEmptyText }}</p>
        <ul v-else class="gb-profile__social-cards">
          <li
            v-for="person in sortedSocialUsers"
            :key="person.id"
            class="gb-profile__social-card-wrap"
            :class="{ 'is-pinned': isMarkedUser(person.id) }"
          >
            <div
              class="gb-profile__social-card"
              :style="socialCardBg(person)"
            >
              <button type="button" class="gb-profile__social-card-main" @click="emit('openUser', person.id)">
                <div class="gb-profile__social-card-cover">
                  <span class="gb-profile__social-card-avatar">
                    <img v-if="authorAvatarUrl(person.avatar)" :src="authorAvatarUrl(person.avatar)" alt="" />
                    <span v-else :style="{ '--tone': String(avatarTone(person.nickname)) }">{{ avatarLetter(person.nickname) }}</span>
                  </span>
                  <div class="gb-profile__social-card-info">
                    <strong>{{ person.nickname }}</strong>
                    <span>UID {{ person.id }}</span>
                  </div>
                </div>
              </button>
              <button
                type="button"
                class="gb-profile__social-mark"
                :class="{ 'is-marked': isMarkedUser(person.id) }"
                :title="isMarkedUser(person.id) ? '取消置顶' : '置顶'"
                :aria-label="isMarkedUser(person.id) ? '取消置顶该用户' : '置顶该用户'"
                @click.stop="toggleMarkedUser(person.id)"
              >
                <span aria-hidden="true">{{ isMarkedUser(person.id) ? '★' : '☆' }}</span>
              </button>
            </div>
          </li>
        </ul>
      </div>

      <template v-else>
      <p v-if="hint" class="gb-profile__hint ok">{{ hint }}</p>
      <p v-if="error" class="gb-profile__hint err">{{ error }}</p>

      <p v-if="postsLoading" class="gb-profile__empty">加载中…</p>

      <template v-else-if="activeTab !== 'comments'">
        <p v-if="!tabPosts.length" class="gb-profile__empty">{{ tabEmptyText }}</p>
        <ul v-else class="gb-grid gb-profile__grid">
          <li
            v-for="item in tabPosts"
            :key="item.id"
            class="gb-card"
            :class="{
              'is-hidden':
                (activeTab === 'posts' || activeTab === 'anonymous-posts') && item.isHidden,
              'is-deleted':
                (activeTab === 'posts' || activeTab === 'anonymous-posts') && item.isDeleted,
            }"
            @click="emit('openPost', item, activeTab)"
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
                  <span
                    v-if="(activeTab === 'posts' || activeTab === 'anonymous-posts') && postStatusLabel(item)"
                    class="gb-card__status"
                  >{{
                    postStatusLabel(item)
                  }}</span>
                  <span v-if="item.profilePinned" class="gb-card__pin">置顶</span>
                  <button
                    v-if="isSelf && (activeTab === 'posts' || activeTab === 'anonymous-posts')"
                    type="button"
                    class="gb-card__pin-btn"
                    :class="{ 'is-active': item.profilePinned }"
                    :disabled="pinBusyId === item.id"
                    @click.stop="toggleProfilePin(item)"
                  >
                    {{ item.profilePinned ? '已置顶' : '置顶' }}
                  </button>
                </div>

                <div class="gb-card__body">
                  <div class="gb-card__author">
                    <span class="gb-avatar-shell">
                      <span
                        v-if="!item.isAnonymous && authorAvatarUrl(item.avatar || avatarUrl)"
                        class="gb-avatar gb-avatar--img"
                        aria-hidden="true"
                      >
                        <img :src="authorAvatarUrl(item.avatar || avatarUrl)" alt="" />
                      </span>
                      <span
                        v-else
                        class="gb-avatar"
                        :style="{ '--tone': String(avatarTone(item.isAnonymous ? '匿名' : displayName)) }"
                        aria-hidden="true"
                      >
                        {{ avatarLetter(item.isAnonymous ? '匿名' : displayName) }}
                      </span>
                    </span>
                    <div class="gb-card__author-block">
                      <strong class="gb-name">{{
                        item.isAnonymous ? '匿名' : item.nickname || displayName
                      }}</strong>
                      <span class="gb-author-line" />
                    </div>
                  </div>
                  <p class="gb-card__title">
                    <span class="gb-cat">[{{ item.category || '灌水' }}]</span>
                    {{ item.title || '无标题' }}
                  </p>
                  <p
                    v-if="isSelf && activeTab === 'posts' && item.moderationMessage"
                    class="gb-profile__mod-msg"
                  >
                    {{ item.moderationMessage }}
                  </p>
                  <button
                    v-if="isSelf && activeTab === 'posts' && (item.isHidden || item.isDeleted)"
                    type="button"
                    class="gb-profile__restore-btn"
                    :class="{ 'is-done': item.restoreRequestedAt }"
                    :disabled="Boolean(item.restoreRequestedAt) || restoreBusyId === item.id"
                    @click.stop="requestRestore(item)"
                  >
                    {{
                      restoreBusyId === item.id
                        ? '提交中…'
                        : item.restoreRequestedAt
                          ? '已申请恢复'
                          : '申请恢复'
                    }}
                  </button>
                </div>
              </div>
            </div>
          </li>
        </ul>
      </template>

      <ul v-else-if="!myComments.length" class="gb-profile__comment-empty">
        <li class="gb-profile__empty">{{ tabEmptyText }}</li>
      </ul>
      <ul v-else class="gb-profile__comment-list">
        <li
          v-for="comment in myComments"
          :key="comment.id"
          class="gb-profile__comment-item"
        >
          <button type="button" class="gb-profile__comment-link" @click="emit('openPost', { id: comment.postId } as GuestbookEntry, 'comments')">
            <span class="gb-profile__comment-meta">
              <span v-if="comment.isAnonymous" class="gb-profile__comment-anon">匿名</span>
              [{{ comment.postCategory || '灌水' }}] {{ comment.postTitle || '无标题' }}
            </span>
            <span class="gb-profile__comment-time">{{ formatCommentTime(comment.createdAt) }}</span>
          </button>
          <p class="gb-profile__comment-body">{{ comment.content }}</p>
        </li>
      </ul>
      </template>
    </div>

    <Teleport to="body">
      <Transition name="ik-overlay">
        <div
          v-if="menu"
          class="ik-overlay"
          :class="{ 'ik-overlay--sub': menu !== 'menu' }"
          @click="onOverlayClick"
        >
          <div class="ik-overlay__backdrop" aria-hidden="true" />
          <div class="ik-overlay__stripe" aria-hidden="true" />

          <!-- 主菜单：更多操作（自己） -->
          <div v-if="menu === 'menu' && isSelf" class="ik-dialog ik-dialog--settings" @click.stop>
            <div class="ik-dialog__outer">
              <div class="ik-dialog__inner">
                <div class="ik-dialog__header">
                  <span class="ik-dialog__title">更多操作</span>
                  <button type="button" class="ik-dialog__close" aria-label="关闭" @click="closeMenu">
                    <img
                      src="/images/close-btn.webp"
                      alt="关闭"
                      class="ik-dialog__close-img"
                      draggable="false"
                    />
                  </button>
                </div>
                <div class="ik-dialog__body">
                  <div class="ik-zzz-marquee is-running" aria-hidden="true">
                    <div class="ik-zzz-marquee__band">
                      <div class="ik-zzz-marquee__row ik-zzz-marquee__row--ltr">
                        <div class="ik-zzz-marquee__track">
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                        </div>
                      </div>
                      <div class="ik-zzz-marquee__row ik-zzz-marquee__row--rtl">
                        <div class="ik-zzz-marquee__track">
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                        </div>
                      </div>
                      <div class="ik-zzz-marquee__row ik-zzz-marquee__row--ltr ik-zzz-marquee__row--offset">
                        <div class="ik-zzz-marquee__track">
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="ik-settings__list">
                    <button
                      type="button"
                      class="ik-zbtn"
                      :disabled="uploading"
                      @click="avatarInput?.click()"
                    >
                      {{ uploading ? '上传中…' : '修改头像' }}
                    </button>
                    <button type="button" class="ik-zbtn" disabled>修改称号</button>
                    <button type="button" class="ik-zbtn" disabled>修改勋章</button>
                    <button
                      type="button"
                      class="ik-zbtn"
                      :disabled="uploading"
                      @click="bannerInput?.click()"
                    >
                      修改名片
                    </button>
                    <button type="button" class="ik-zbtn" @click="openEditName">修改用户名</button>
                    <button type="button" class="ik-zbtn" @click="openEditBio">修改签名</button>
                    <button type="button" class="ik-zbtn" @click="openProfileDisplayMenu">修改名片展示</button>
                    <button type="button" class="ik-zbtn" @click="openBlacklistMenu">社交设置</button>
                    <button type="button" class="ik-zbtn" @click="openAccountCenter">账号中心</button>
                    <button type="button" class="ik-zbtn" @click="openLogout">退出登录</button>
                  </div>
                  <p v-if="hint" class="ik-dialog__hint">{{ hint }}</p>
                  <p v-if="error" class="ik-dialog__error">{{ error }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- 主菜单：更多操作（他人） -->
          <div v-else-if="menu === 'menu' && !isSelf" class="ik-dialog ik-dialog--settings" @click.stop>
            <div class="ik-dialog__outer">
              <div class="ik-dialog__inner">
                <div class="ik-dialog__header">
                  <span class="ik-dialog__title">更多操作</span>
                  <button type="button" class="ik-dialog__close" aria-label="关闭" @click="closeMenu">
                    <img
                      src="/images/close-btn.webp"
                      alt="关闭"
                      class="ik-dialog__close-img"
                      draggable="false"
                    />
                  </button>
                </div>
                <div class="ik-dialog__body">
                  <div class="ik-settings__list">
                    <button
                      type="button"
                      class="ik-zbtn"
                      :disabled="isBlockedByMe"
                      @click="openChat"
                    >
                      敲敲
                    </button>
                    <button
                      type="button"
                      class="ik-zbtn"
                      :disabled="followBusy || isBlockedByMe"
                      @click="toggleFollow"
                    >
                      {{
                        followBusy ? '处理中…' : isFollowing ? '取消关注' : '关注'
                      }}
                    </button>
                    <button
                      type="button"
                      class="ik-zbtn"
                      :disabled="followBusy"
                      @click="toggleBlock"
                    >
                      {{ isBlockedByMe ? '移出黑名单' : '加入黑名单' }}
                    </button>
                    <button type="button" class="ik-zbtn" @click="openReportUser">
                      举报用户
                    </button>
                  </div>
                  <p v-if="hint" class="ik-dialog__hint">{{ hint }}</p>
                  <p v-if="error" class="ik-dialog__error">{{ error }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- 黑名单 -->
          <div v-else-if="menu === 'blacklist'" class="ik-dialog ik-dialog--settings" @click.stop>
            <div class="ik-dialog__outer">
              <div class="ik-dialog__inner">
                <div class="ik-dialog__header">
                  <span class="ik-dialog__title">黑名单</span>
                  <button type="button" class="ik-dialog__close" aria-label="关闭" @click="backToMenu">
                    <img
                      src="/images/close-btn.webp"
                      alt="关闭"
                      class="ik-dialog__close-img"
                      draggable="false"
                    />
                  </button>
                </div>
                <div class="ik-dialog__body">
                  <p v-if="!blockedUsers.length" class="ik-dialog__hint">黑名单为空</p>
                  <div v-else class="ik-block-list ik-block-list--dialog">
                    <button
                      v-for="blocked in blockedUsers"
                      :key="blocked.id"
                      type="button"
                      class="ik-block-item"
                      @click="unblockUser(blocked.id)"
                    >
                      <span>{{ blocked.nickname }}</span>
                      <span>移出黑名单</span>
                    </button>
                  </div>
                  <p v-if="hint" class="ik-dialog__hint">{{ hint }}</p>
                  <p v-if="error" class="ik-dialog__error">{{ error }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- 修改用户名 -->
          <div v-else-if="menu === 'edit-name'" class="ik-dialog" @click.stop>
            <div class="ik-dialog__outer">
              <div class="ik-dialog__inner">
                <div class="ik-dialog__header">
                  <span class="ik-dialog__title">修改用户名</span>
                  <button type="button" class="ik-dialog__close" aria-label="关闭" @click="backToMenu">
                    <img
                      src="/images/close-btn.webp"
                      alt="关闭"
                      class="ik-dialog__close-img"
                      draggable="false"
                    />
                  </button>
                </div>
                <div class="ik-dialog__body">
                  <div class="ik-zzz-marquee is-running" aria-hidden="true">
                    <div class="ik-zzz-marquee__band">
                      <div class="ik-zzz-marquee__row ik-zzz-marquee__row--ltr">
                        <div class="ik-zzz-marquee__track">
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                        </div>
                      </div>
                      <div class="ik-zzz-marquee__row ik-zzz-marquee__row--rtl">
                        <div class="ik-zzz-marquee__track">
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                        </div>
                      </div>
                      <div class="ik-zzz-marquee__row ik-zzz-marquee__row--ltr ik-zzz-marquee__row--offset">
                        <div class="ik-zzz-marquee__track">
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="ik-edit__wrapper">
                    <div class="ik-edit">
                      <input
                        v-model="nameInput"
                        class="ik-edit__input"
                        type="text"
                        :maxlength="NAME_MAX"
                        placeholder="请输入新用户名"
                        :disabled="saving"
                        @keydown.enter="submitName"
                      />
                      <div class="ik-edit__meta">
                        <span class="ik-edit__count">{{ nameInput.trim().length }}/{{ NAME_MAX }}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      class="ik-zbtn ik-zbtn--success"
                      :disabled="saving || !nameInput.trim()"
                      @click="submitName"
                    >
                      {{ saving ? '保存中…' : '确定' }}
                    </button>
                  </div>
                  <p v-if="error" class="ik-dialog__error">{{ error }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- 修改签名 -->
          <div v-else-if="menu === 'edit-bio'" class="ik-dialog" @click.stop>
            <div class="ik-dialog__outer">
              <div class="ik-dialog__inner">
                <div class="ik-dialog__header">
                  <span class="ik-dialog__title">修改签名</span>
                  <button type="button" class="ik-dialog__close" aria-label="关闭" @click="backToMenu">
                    <img
                      src="/images/close-btn.webp"
                      alt="关闭"
                      class="ik-dialog__close-img"
                      draggable="false"
                    />
                  </button>
                </div>
                <div class="ik-dialog__body">
                  <div class="ik-zzz-marquee is-running" aria-hidden="true">
                    <div class="ik-zzz-marquee__band">
                      <div class="ik-zzz-marquee__row ik-zzz-marquee__row--ltr">
                        <div class="ik-zzz-marquee__track">
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                        </div>
                      </div>
                      <div class="ik-zzz-marquee__row ik-zzz-marquee__row--rtl">
                        <div class="ik-zzz-marquee__track">
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                        </div>
                      </div>
                      <div class="ik-zzz-marquee__row ik-zzz-marquee__row--ltr ik-zzz-marquee__row--offset">
                        <div class="ik-zzz-marquee__track">
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="ik-edit__wrapper">
                    <div class="ik-edit">
                      <textarea
                        v-model="bioInput"
                        class="ik-edit__textarea"
                        :maxlength="BIO_MAX"
                        rows="3"
                        placeholder="请输入新签名"
                        :disabled="saving"
                      />
                      <div class="ik-edit__meta">
                        <span class="ik-edit__count">{{ bioInput.trim().length }}/{{ BIO_MAX }}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      class="ik-zbtn ik-zbtn--success"
                      :disabled="saving"
                      @click="submitBio"
                    >
                      {{ saving ? '保存中…' : '确定' }}
                    </button>
                  </div>
                  <p v-if="error" class="ik-dialog__error">{{ error }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- 名片展示 -->
          <div v-else-if="menu === 'profile-display'" class="ik-dialog" @click.stop>
            <div class="ik-dialog__outer">
              <div class="ik-dialog__inner">
                <div class="ik-dialog__header">
                  <span class="ik-dialog__title">修改名片展示</span>
                  <button type="button" class="ik-dialog__close" aria-label="关闭" @click="backToMenu">
                    <img
                      src="/images/close-btn.webp"
                      alt="关闭"
                      class="ik-dialog__close-img"
                      draggable="false"
                    />
                  </button>
                </div>
                <div class="ik-dialog__body">
                  <div class="ik-settings__list">
                    <p class="ik-dialog__hint">选择他人查看你名片时可见的内容</p>
                    <label
                      v-for="opt in PROFILE_DISPLAY_OPTIONS"
                      :key="opt.key"
                      class="ik-profile-display-opt"
                    >
                      <input
                        type="checkbox"
                        :checked="profileShowDraft.includes(opt.key)"
                        :disabled="opt.key === 'posts' || saving"
                        @change="toggleProfileShowTab(opt.key)"
                      />
                      <span>{{ opt.label }}</span>
                    </label>
                    <label class="ik-profile-display-opt">
                      <input
                        v-model="profileSocialPublicDraft"
                        type="checkbox"
                        :disabled="saving"
                      />
                      <span>公开粉丝与关注列表</span>
                    </label>
                    <button
                      type="button"
                      class="ik-zbtn ik-zbtn--success"
                      :disabled="saving"
                      @click="saveProfileDisplay"
                    >
                      {{ saving ? '保存中…' : '保存' }}
                    </button>
                  </div>
                  <p v-if="error" class="ik-dialog__error">{{ error }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- 退出登录确认 -->
          <div v-else-if="menu === 'logout'" class="ik-dialog" @click.stop>
            <div class="ik-dialog__outer">
              <div class="ik-dialog__inner">
                <div class="ik-dialog__header">
                  <span class="ik-dialog__title">退出登录</span>
                  <button type="button" class="ik-dialog__close" aria-label="关闭" @click="backToMenu">
                    <img
                      src="/images/close-btn.webp"
                      alt="关闭"
                      class="ik-dialog__close-img"
                      draggable="false"
                    />
                  </button>
                </div>
                <div class="ik-dialog__body">
                  <div class="ik-zzz-marquee is-running" aria-hidden="true">
                    <div class="ik-zzz-marquee__band">
                      <div class="ik-zzz-marquee__row ik-zzz-marquee__row--ltr">
                        <div class="ik-zzz-marquee__track">
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                        </div>
                      </div>
                      <div class="ik-zzz-marquee__row ik-zzz-marquee__row--rtl">
                        <div class="ik-zzz-marquee__track">
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                        </div>
                      </div>
                      <div class="ik-zzz-marquee__row ik-zzz-marquee__row--ltr ik-zzz-marquee__row--offset">
                        <div class="ik-zzz-marquee__track">
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                          <span class="ik-zzz-marquee__text">{{ marqueeLine }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="ik-logout__wrapper">
                    <div class="ik-logout__inner">
                      <label class="ik-logout__option">
                        <input type="radio" checked readonly />
                        <span>返回首页并清除登录记录</span>
                      </label>
                    </div>
                    <div class="ik-logout__actions">
                      <button type="button" class="ik-zbtn ik-zbtn--danger" @click="backToMenu">取消</button>
                      <button type="button" class="ik-zbtn ik-zbtn--success" @click="confirmLogout">确定</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <input
      ref="avatarInput"
      type="file"
      accept="image/jpeg,image/png,image/gif,image/webp"
      hidden
      @change="onPickImage($event, 'avatar')"
    />
    <input
      ref="bannerInput"
      type="file"
      accept="image/jpeg,image/png,image/gif,image/webp"
      hidden
      @change="onPickImage($event, 'banner')"
    />

    <GuestbookConfirmDialog
      :open="reportDialog.open"
      title="举报用户"
      message="可填写举报原因，管理员会尽快处理；留空也可直接提交。"
      confirm-label="提交举报"
      reason-placeholder="可选，说明举报原因…"
      show-reason
      :reason="reportDialog.reason"
      :busy="reportDialog.busy"
      @update:reason="reportDialog.reason = $event"
      @close="closeReportUser"
      @confirm="confirmReportUser"
    />

    <GuestbookConfirmDialog
      :open="banDetailOpen && !unbanDialog.open"
      title="封禁状态"
      :details="[
        { label: '原因', value: banReason || '未填写' },
        { label: '开始', value: formatBanTime(bannedAt) },
        { label: '剩余', value: formatBanRemaining(banUntil) },
      ]"
      :confirm-label="isSelf ? '申请解封' : '知道了'"
      cancel-label="关闭"
      @close="closeBanDetail"
      @confirm="isSelf ? (unbanDialog.open = true) : closeBanDetail()"
    />

    <GuestbookConfirmDialog
      :open="unbanDialog.open"
      title="申请解封"
      message="请说明申请解封的原因，将通知站点管理员。"
      confirm-label="提交申请"
      reason-placeholder="填写申请原因…"
      show-reason
      :reason="unbanDialog.reason"
      :busy="unbanDialog.busy"
      @update:reason="unbanDialog.reason = $event"
      @close="unbanDialog.open = false"
      @confirm="confirmUnbanRequest"
    />
  </div>
</template>

<style scoped>
.gb-profile {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px 14px 24px;
  min-height: 0;
  flex: 1;
  overflow: auto;
}

.gb-profile__toolbar {
  display: flex;
  align-items: center;
}

.gb-profile__back {
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.72);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  padding: 4px 0;
}

.gb-profile__back:hover {
  color: #fff;
}

.ik-card {
  border-radius: 16px;
  overflow: hidden;
  background:
    radial-gradient(circle at 20% 10%, rgba(255, 255, 255, 0.04), transparent 40%),
    linear-gradient(180deg, #1a1c20 0%, #121417 100%);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.ik-tab-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 48px;
  padding: 10px 16px;
}

.ik-tab-bar__left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: rgba(255, 255, 255, 0.85);
  font-size: 13px;
  font-weight: 700;
}

.ik-tab-bar__label {
  letter-spacing: 0.5px;
}

.ik-tab-bar__value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.ik-tab-bar__copy {
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  display: inline-flex;
  padding: 2px;
}

.ik-tab-bar__copy:hover {
  color: #fff;
}

.ik-more-btn {
  border: 0;
  border-radius: 999px;
  padding: 8px 16px;
  background: #2a2d33;
  color: #fff;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.35);
}

.ik-more-btn:hover {
  background: #343841;
}

.ik-banner-card {
  margin: 0 12px 12px;
  overflow: hidden;
  border-radius: 14px;
}

.ik-banner {
  position: relative;
  min-height: 220px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 24px;
  padding: 28px 24px;
  border-radius: 14px 14px 0 0;
  overflow: hidden;
  background: #2a2d33 center / cover no-repeat;
}

.ik-banner--plain {
  background-image:
    linear-gradient(135deg, rgba(20, 22, 26, 0.2), rgba(10, 12, 16, 0.55)),
    radial-gradient(circle at 70% 30%, rgba(191, 255, 9, 0.18), transparent 45%),
    linear-gradient(135deg, #3a404a 0%, #1c1f24 55%, #121417 100%);
}

.ik-banner::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.45) 100%);
  pointer-events: none;
}

.ik-banner__user,
.ik-banner__stats {
  position: relative;
  z-index: 1;
}

.ik-banner__user {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.ik-banner__avatar-wrap {
  position: relative;
  flex-shrink: 0;
}

.ik-banner__avatar {
  width: 84px;
  height: 84px;
  border-radius: 999px;
  overflow: hidden;
  border: 4px solid #000;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  background: hsl(var(--tone, 72) 55% 42%);
  display: grid;
  place-items: center;
}

.ik-banner__avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ik-banner__avatar-letter {
  color: #fff;
  font-size: 32px;
  font-weight: 900;
}

.ik-banner__level {
  position: absolute;
  top: -4px;
  left: -4px;
  min-width: 28px;
  height: 28px;
  border-radius: 999px;
  background: #000;
  border: 2px solid #000;
  color: #fff;
  font-size: 12px;
  font-weight: 900;
  line-height: 24px;
  text-align: center;
  padding: 0 6px;
}

.ik-banner__info {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 6px;
  min-width: 0;
}

.ik-banner__name {
  margin: 0;
  font-size: 26px;
  font-weight: 900;
  color: #fff;
  line-height: 1.1;
  text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.4);
  word-break: break-word;
}

.ik-banner__zzz-badge {
  display: inline-block;
  align-self: flex-start;
  padding: 4px 14px;
  border-radius: 999px;
  background: #000;
  color: #bfff09;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.ik-banner__ban {
  align-self: flex-start;
  border: 1px solid rgba(255, 90, 90, 0.55);
  border-radius: 999px;
  padding: 4px 12px;
  background: rgba(180, 40, 40, 0.35);
  color: #ffb4b4;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.ik-banner__stats {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
}

.ik-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}

.ik-stat__label {
  color: rgba(255, 255, 255, 0.85);
}

.ik-stat__num {
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}

.ik-stat__sep {
  color: rgba(255, 255, 255, 0.5);
}

.ik-banner-footer {
  padding: 10px 22px;
  background:
    repeating-linear-gradient(
      -45deg,
      rgba(255, 255, 255, 0.03) 0 2px,
      transparent 2px 6px
    ),
    #16181c;
  border-radius: 0 0 14px 14px;
}

.ik-banner-footer__sig {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.95);
  line-height: 1.5;
  word-break: break-word;
}

.ik-banner-footer__sig--empty {
  color: rgba(255, 255, 255, 0.35);
  font-style: italic;
}

.gb-profile__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 4px 2px 14px;
}

.gb-profile__tab {
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.gb-profile__tab.is-active {
  border-color: #bfff09;
  background: rgba(191, 255, 9, 0.12);
  color: #bfff09;
}

.gb-profile__empty {
  margin: 28px 0;
  text-align: center;
  color: rgba(255, 255, 255, 0.35);
  font-size: 14px;
  list-style: none;
}

.gb-profile__comment-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.gb-profile__comment-item {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: #1a1c20;
  padding: 12px 14px;
}

.gb-profile__comment-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  border: 0;
  padding: 0;
  background: transparent;
  color: #bfff09;
  font-size: 13px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.gb-profile__comment-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gb-profile__comment-anon {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 6px;
  border: 1px solid rgba(148, 163, 184, 0.5);
  border-radius: 999px;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.4;
  vertical-align: 1px;
}

.gb-profile__comment-time {
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.35);
  font-size: 12px;
  font-weight: 500;
}

.gb-profile__comment-body {
  margin: 8px 0 0;
  color: rgba(255, 255, 255, 0.82);
  font-size: 14px;
  line-height: 1.45;
  word-break: break-word;
}

.gb-profile__comment-empty {
  list-style: none;
  margin: 0;
  padding: 0;
}

.gb-profile__grid {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* 与留言板列表一致的帖子卡片 */
.gb-profile__grid.gb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1.15rem 1.1rem;
}

.gb-profile__grid .gb-card {
  cursor: pointer;
}

.gb-profile__grid .gb-card__shell {
  border-radius: 22px 22px 0 22px;
  background: #000;
  padding: 4px;
  transition: background-color 0.18s ease;
}

.gb-profile__grid .gb-card:hover .gb-card__shell {
  background: #bfff09;
}

.gb-profile__grid .gb-card__inner {
  border-radius: 18px 18px 0 18px;
  overflow: hidden;
  background: #222;
}

.gb-profile__grid .gb-card__cover {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  background: hsl(var(--cover-hue, 72) 28% 22%);
}

.gb-profile__grid .gb-card__cover .gb-sensitive-media {
  display: block;
  width: 100%;
  height: 100%;
}

.gb-profile__grid .gb-card__cover-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.28s ease;
}

.gb-profile__grid .gb-card:hover .gb-card__cover-img {
  transform: scale(1.04);
}

.gb-profile__grid .gb-card__stats {
  position: absolute;
  left: 8px;
  top: 8px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  font-size: 12px;
  font-weight: 700;
  color: #fff;
}

.gb-profile__grid .gb-card__status {
  position: absolute;
  right: 8px;
  top: 8px;
  z-index: 2;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 140, 0, 0.92);
  color: #111;
  font-size: 11px;
  font-weight: 800;
}

.gb-profile__grid .gb-card.is-deleted .gb-card__status {
  background: rgba(255, 60, 60, 0.92);
  color: #fff;
}

.gb-profile__grid .gb-card.is-hidden .gb-card__cover-img,
.gb-profile__grid .gb-card.is-deleted .gb-card__cover-img {
  filter: grayscale(0.55) brightness(0.72);
}

.gb-profile__mod-msg {
  margin: 0.45rem 0 0;
  color: rgba(255, 180, 100, 0.92);
  font-size: 0.78rem;
  line-height: 1.45;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.gb-profile__restore-btn {
  margin-top: 0.55rem;
  border: 1px solid rgba(191, 255, 9, 0.45);
  background: rgba(191, 255, 9, 0.08);
  color: #bfff09;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.gb-profile__restore-btn.is-done,
.gb-profile__restore-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.gb-profile__hint {
  margin: 0 0 0.65rem;
  font-size: 0.82rem;
}

.gb-profile__hint.ok {
  color: #bfff09;
}

.gb-profile__hint.err {
  color: #ff7b7b;
}

.ik-block-list--dialog {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

.ik-block-list {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.ik-block-list__title {
  margin: 0 0 0.5rem;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.ik-block-item {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  border: 0;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.88);
  border-radius: 10px;
  padding: 0.55rem 0.75rem;
  margin-bottom: 0.4rem;
  cursor: pointer;
}

.gb-profile__social-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.gb-profile__social-cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}

.gb-profile__social-card {
  position: relative;
  border-radius: 14px;
  overflow: hidden;
  border: 2px solid #2a2a2a;
  background: #111 center / cover no-repeat;
  min-height: 108px;
}

.gb-profile__social-card-main {
  display: block;
  width: 100%;
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.gb-profile__social-card-cover {
  min-height: 108px;
  padding: 12px 14px;
  display: flex;
  align-items: flex-end;
  gap: 10px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.88) 0%, rgba(0, 0, 0, 0.35) 55%, rgba(0, 0, 0, 0.12) 100%);
}

.gb-profile__social-card-avatar {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 999px;
  border: 3px solid #000;
  overflow: hidden;
  background: #222;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 900;
  color: #fff;
}

.gb-profile__social-card-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.gb-profile__social-card-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.gb-profile__social-card-info strong {
  font-size: 0.95rem;
  color: #fff;
}

.gb-profile__social-card-info span {
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.72);
}

.gb-profile__social-mark {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 10px;
  background: rgba(10, 12, 16, 0.78);
  color: rgba(255, 255, 255, 0.72);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.gb-profile__social-mark:hover {
  transform: translateY(-1px);
  border-color: rgba(191, 255, 9, 0.72);
}

.gb-profile__social-mark.is-marked {
  border-color: #bfff09;
  background: #bfff09;
  color: #111;
}

.gb-profile__social-card-wrap.is-pinned .gb-profile__social-card {
  outline: 1px solid rgba(191, 255, 9, 0.65);
  box-shadow: 0 0 0 3px rgba(191, 255, 9, 0.08);
}

.gb-profile__social-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: #1a1c20;
  border-radius: 12px;
  padding: 0.75rem;
  margin-bottom: 0.55rem;
  cursor: pointer;
  color: inherit;
  text-align: left;
}

.gb-profile__social-meta {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.gb-profile__social-meta strong {
  color: #fff;
  font-size: 0.9rem;
}

.gb-profile__social-meta span {
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.78rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gb-profile__grid .gb-card__pin {
  position: absolute;
  top: 10px;
  right: 12px;
  left: auto;
  padding: 2px 8px;
  border-radius: 999px;
  background: #bfff09;
  color: #111;
  font-size: 11px;
  font-weight: 800;
  z-index: 2;
}

.gb-profile__grid .gb-card__pin-btn {
  position: absolute;
  left: 8px;
  bottom: 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.gb-profile__grid .gb-card__pin-btn.is-active {
  border-color: #bfff09;
  color: #bfff09;
}

.gb-profile__grid .gb-card__pin-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}

.gb-profile__grid .gb-card__body {
  padding: 0.65rem 0.75rem 0.85rem;
}

.gb-profile__grid .gb-card__author {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.45rem;
}

.gb-profile__grid .gb-avatar-shell {
  flex-shrink: 0;
  width: 54px;
  height: 54px;
  border-radius: 999px;
  padding: 3px;
  background: #222;
  box-sizing: border-box;
}

.gb-profile__grid .gb-avatar {
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

.gb-profile__grid .gb-avatar--img {
  padding: 0;
  overflow: hidden;
  background: #222;
}

.gb-profile__grid .gb-avatar--img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.gb-profile__grid .gb-card__author-block {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 32px;
  padding-left: 8px;
  margin-left: 4px;
  width: calc(100% - 58px);
  min-width: 0;
}

.gb-profile__grid .gb-name {
  margin: 4px 0;
  font-size: 0.92rem;
  font-weight: 800;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gb-profile__grid .gb-author-line {
  display: block;
  width: 100%;
  height: 2px;
  background: linear-gradient(90deg, #bfff09 0%, transparent 100%);
}

.gb-profile__grid .gb-card__title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 800;
  line-height: 1.35;
  color: #f0f0f0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.gb-profile__grid .gb-cat {
  color: #bfff09;
  margin-right: 0.25rem;
}

/* ── InterKnot「更多操作」弹窗 ───────────────────── */
.ik-overlay {
  position: fixed;
  inset: 0;
  z-index: 9100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: transparent;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.ik-overlay--sub {
  z-index: 9200;
}

.ik-overlay__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  pointer-events: none;
}

/* 与留言板详情同款斜纹 */
.ik-overlay__stripe {
  position: absolute;
  inset: 0;
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

.ik-overlay-enter-active,
.ik-overlay-leave-active {
  transition: opacity 0.18s ease;
}

.ik-overlay-enter-from,
.ik-overlay-leave-to {
  opacity: 0;
}

.ik-dialog {
  position: relative;
  z-index: 1;
  width: 450px;
  max-width: 100%;
  height: 300px;
  max-height: 90%;
}

.ik-dialog--settings {
  height: auto;
  max-height: 90%;
}

.ik-dialog__outer {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: #2d2c2d;
  border-radius: 24px 0 24px 24px;
  overflow: hidden;
}

.ik-dialog__inner {
  width: 100%;
  height: 100%;
  padding: 4px;
  background: #000;
  border-radius: 22px 0 22px 22px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ik-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 12px 24px;
  flex-shrink: 0;
  border-radius: 18px 0 0 0;
  background: #0a0a0a;
}

.ik-dialog__title {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  font-style: italic;
  letter-spacing: 0.5px;
}

.ik-dialog__close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: opacity 140ms ease, transform 140ms ease;
}

.ik-dialog__close:hover {
  opacity: 0.85;
  transform: scale(1.08);
}

.ik-dialog__close:active {
  transform: scale(0.95);
}

.ik-dialog__close-img {
  height: 32px;
  width: auto;
  display: block;
  user-select: none;
  pointer-events: none;
}

.ik-dialog__body {
  position: relative;
  flex: 1;
  min-height: 0;
  padding: 24px;
  background: #121212;
  border-radius: 0 0 18px 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.ik-dialog--settings .ik-dialog__body {
  align-items: stretch;
  justify-content: flex-start;
  overflow-y: auto;
}

/* 与留言板同款斜置大字跑马灯 */
.ik-zzz-marquee {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
  contain: strict;
}

.ik-zzz-marquee__band {
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
  font-size: clamp(160px, 28vw, 280px);
  transform: translateY(5%) rotate(-15deg);
}

.ik-zzz-marquee__row {
  flex: 0 0 auto;
  overflow: hidden;
  white-space: nowrap;
  font-size: inherit;
  line-height: 0.74;
}

.ik-zzz-marquee__track {
  display: inline-flex;
  flex-shrink: 0;
  animation-play-state: paused;
  will-change: transform;
  backface-visibility: hidden;
}

.ik-zzz-marquee__row--ltr .ik-zzz-marquee__track {
  animation: ik-zzz-marquee-ltr 400s linear infinite;
}

.ik-zzz-marquee__row--rtl .ik-zzz-marquee__track {
  animation: ik-zzz-marquee-rtl 480s linear infinite;
}

.ik-zzz-marquee__row--offset .ik-zzz-marquee__track {
  animation-delay: -140s;
}

.ik-zzz-marquee.is-running .ik-zzz-marquee__track {
  animation-play-state: running;
}

.ik-zzz-marquee__text {
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

@keyframes ik-zzz-marquee-ltr {
  from {
    transform: translate3d(-50%, 0, 0);
  }
  to {
    transform: translate3d(0, 0, 0);
  }
}

@keyframes ik-zzz-marquee-rtl {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    transform: translate3d(-50%, 0, 0);
  }
}

.ik-settings__list {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  width: 100%;
  margin: 0 auto;
  padding: 16px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 16px;
  box-sizing: border-box;
}

/* 绳网 z-button 默认外观：黑底网纹 + 圆角胶囊 + 斜体白字 */
.ik-zbtn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  margin: 0;
  border: 1px solid #000;
  border-radius: 9999px;
  padding: 12px 14px;
  font-size: 13px;
  font-weight: 800;
  font-style: italic;
  letter-spacing: 1px;
  line-height: 1.2;
  color: #fff;
  cursor: pointer;
  appearance: none;
  outline: none;
  user-select: none;
  white-space: nowrap;
  background-color: #000;
  background-image:
    linear-gradient(45deg, rgba(255, 255, 255, 0.06) 25%, transparent 0 75%, rgba(255, 255, 255, 0.06) 0),
    linear-gradient(45deg, rgba(255, 255, 255, 0.06) 25%, transparent 0 75%, rgba(255, 255, 255, 0.06) 0);
  background-position: 0 0, 3px 3px;
  background-size: 6px 6px;
  background-repeat: repeat;
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.2),
    inset 0 0 0 3px #585858,
    inset 0 0 0 4px #000;
}

.ik-zbtn:hover:not(:disabled) {
  filter: brightness(1.12);
}

.ik-zbtn:active:not(:disabled) {
  transform: translateY(1px);
}

.ik-zbtn:disabled {
  cursor: not-allowed;
  color: #b0b0b0;
  opacity: 0.72;
  box-shadow:
    inset 0 0 0 3px #3a3a3a,
    inset 0 0 0 4px #000;
}

.ik-zbtn--success {
  width: auto;
  min-width: 88px;
  color: #111;
  background-color: #00cc0d;
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.35),
    inset 0 0 0 3px #00cc0d,
    inset 0 0 0 4px #000;
}

.ik-zbtn--danger {
  width: auto;
  min-width: 88px;
  color: #fff;
  background-color: #c01c00;
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.25),
    inset 0 0 0 3px #c01c00,
    inset 0 0 0 4px #000;
}

.ik-dialog__hint,
.ik-dialog__error {
  position: relative;
  z-index: 1;
  margin: 10px 0 0;
  font-size: 13px;
  font-weight: 700;
  text-align: center;
}

.ik-dialog__hint {
  color: rgba(255, 255, 255, 0.55);
}

.ik-dialog__error {
  color: #ff8f8f;
}

.ik-edit__wrapper {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  gap: 0;
}

.ik-edit {
  width: 100%;
  max-width: 360px;
  margin: 0 auto;
  padding: 32px 20px 45px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ik-edit__input,
.ik-edit__textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: #1a1a1a;
  color: #fff;
  padding: 10px 12px;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  outline: none;
}

.ik-edit__input:focus,
.ik-edit__textarea:focus {
  border-color: #bfff09;
}

.ik-edit__textarea {
  resize: vertical;
  min-height: 84px;
}

.ik-edit__meta {
  display: flex;
  justify-content: flex-end;
  margin-top: -6px;
}

.ik-edit__count {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.3);
}

.ik-edit__wrapper > .ik-zbtn {
  margin-top: -18px;
  position: relative;
  z-index: 1;
}

.ik-logout__wrapper {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.ik-logout__inner {
  width: 100%;
  padding: 48px 24px 52px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 16px;
}

.ik-logout__option {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  font-style: italic;
  cursor: default;
}

.ik-logout__option input {
  accent-color: #bfff09;
}

.ik-logout__actions {
  display: flex;
  gap: 12px;
  margin-top: -18px;
  position: relative;
  z-index: 1;
}

@media (max-width: 640px) {
  .ik-banner {
    min-height: 200px;
    padding: 22px 16px;
  }

  .ik-banner__avatar {
    width: 68px;
    height: 68px;
  }

  .ik-banner__name {
    font-size: 22px;
  }

  .ik-dialog {
    height: auto;
    min-height: 280px;
  }

  .ik-zzz-marquee__band {
    font-size: clamp(140px, 36vw, 220px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ik-zzz-marquee__track {
    animation: none;
  }
}
</style>
