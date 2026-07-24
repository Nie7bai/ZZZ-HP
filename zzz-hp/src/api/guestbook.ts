export const GUESTBOOK_CATEGORIES = [
  '灌水',
  '求助',
  '攻略',
  '情报',
  '同人',
  '数据',
  '公告',
  '更新日志',
] as const

export const ADMIN_ONLY_CATEGORIES = ['公告', '更新日志'] as const

export type GuestbookCategory = (typeof GUESTBOOK_CATEGORIES)[number]

export interface GuestbookExpDailyTask {
  key: string
  label: string
  exp: number
  dailyLimit: number
  used: number
}

export interface GuestbookEntry {
  id: number
  userId?: number | null
  nickname: string
  avatar?: string
  isAnonymous?: boolean
  isMine?: boolean
  level?: number
  exp?: number
  anonymousAuthor?: GuestbookAnonymousAuthor
  title: string
  category: string
  content: string
  cover?: string
  images?: string[]
  isHidden: boolean
  isSensitive?: boolean
  isDeleted?: boolean
  deletedAt?: string | null
  isPinned?: boolean
  pinnedAt?: string | null
  profilePinned?: boolean
  viewCount?: number
  moderationMessage?: string
  restoreRequestedAt?: string | null
  commentCount?: number
  likeCount?: number
  favoriteCount?: number
  likedByMe?: boolean
  favoritedByMe?: boolean
  viewedByMe?: boolean
  createdAt: string
  updatedAt?: string
}

export interface GuestbookComment {
  id: number
  postId: number
  userId?: number | null
  nickname: string
  avatar?: string
  isAnonymous?: boolean
  isMine?: boolean
  level?: number
  exp?: number
  anonymousAuthor?: GuestbookAnonymousAuthor
  content: string
  images?: string[]
  isHidden: boolean
  mutedByMe?: boolean
  blockedForMe?: boolean
  canRestoreGlobal?: boolean
  canRestoreMute?: boolean
  floor: number
  likeCount?: number
  likedByMe?: boolean
  createdAt: string
  updatedAt?: string
  postTitle?: string
  postCategory?: string
}

export type GuestbookManageStatus = 'normal' | 'hidden' | 'deleted' | 'sensitive'

export interface GuestbookAnonymousAuthor {
  id: number
  uid: number
  nickname: string
  avatar?: string
}

export type GuestbookNotificationType =
  | 'like'
  | 'favorite'
  | 'comment'
  | 'mention'
  | 'post_hidden'
  | 'post_deleted'
  | 'post_restored'
  | 'restore_request'
  | 'announcement'
  | 'changelog'
  | 'follow_post'
  | 'report'
  | 'report_handled'
  | 'user_banned'
  | 'unban_request'

export type GuestbookKnockTab = 'system' | 'follow' | 'chat'

export interface GuestbookReport {
  id: number
  reporterUserId: number
  reporterNickname: string
  targetType: 'post' | 'comment' | 'user'
  postId: number
  postTitle: string
  commentId?: number | null
  commentPreview?: string
  reportedUserId?: number | null
  reportedUserNickname?: string
  reason: string
  handlerMessage?: string
  status: 'pending' | 'handled'
  createdAt: string
  handledAt?: string | null
}

export interface GuestbookCommentLikeResult {
  liked: boolean
  comment: GuestbookComment
}

export interface GuestbookNotification {
  id: number
  userId: number
  type: GuestbookNotificationType
  postId: number
  postTitle: string
  actorUserId?: number | null
  actorNickname: string
  actorAvatar?: string
  commentId?: number | null
  message?: string
  isRead: boolean
  createdAt: string
}

export type GuestbookProfileTab =
  | 'posts'
  | 'anonymous-posts'
  | 'favorites'
  | 'likes'
  | 'comments'
  | 'followers'
  | 'following'

export interface GuestbookUserProfile {
  id: number
  uid: number
  nickname: string
  avatar?: string
  bio?: string
  banner?: string
  level?: number
  exp?: number
  expRequired?: number | null
  isMaxLevel?: boolean
  dailyTasks?: GuestbookExpDailyTask[]
  isSelf?: boolean
  isBanned?: boolean
  bannedAt?: string | null
  banUntil?: string | null
  banReason?: string
  followerCount: number
  followingCount: number
  postCount: number
  totalViews: number
  totalLikes?: number
  totalFavorites?: number
  isFollowing?: boolean
  isBlockedByMe?: boolean
  profilePublicSocial?: boolean
  profileShowTabs?: GuestbookProfileTab[]
}

export interface GuestbookSocialUser {
  id: number
  nickname: string
  avatar?: string
  bio?: string
  banner?: string
  followedAt?: string | null
}

export interface GuestbookCommentBlockResult {
  type: 'global' | 'mute'
  blocked: boolean
  postId: number
}

export interface GuestbookPayload {
  nickname?: string
  title: string
  category: string
  content?: string
  images?: string[]
  anonymous?: boolean
  /** 公告/更新日志：是否向全站推送敲敲通知，默认 true */
  notify?: boolean
  /** 敏感内容：图片默认模糊，标题正文正常展示 */
  isSensitive?: boolean
}

export interface GuestbookDmConversation {
  id: number
  peerId: number
  peerNickname: string
  peerAvatar?: string
  lastMessage: string
  lastMessageAt?: string
  unreadCount: number
  updatedAt: string
}

export interface GuestbookDmMessage {
  id: number
  conversationId: number
  senderId: number
  senderNickname: string
  senderAvatar?: string
  content: string
  images?: string[]
  isRead: boolean
  isMine?: boolean
  createdAt: string
}

export interface GuestbookCommentPayload {
  nickname?: string
  content: string
  images?: string[]
  anonymous?: boolean
}

export interface GuestbookLikeResult {
  liked: boolean
  post: GuestbookEntry
}

export interface GuestbookFavoriteResult {
  favorited: boolean
  post: GuestbookEntry
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

function getUserToken(): string {
  try {
    return localStorage.getItem('zzz-hp-user-token') || ''
  } catch {
    return ''
  }
}

function getAdminToken(): string {
  try {
    return localStorage.getItem('zzz-hp-admin-token') || ''
  } catch {
    return ''
  }
}

function withAuthHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const token = getUserToken()
  if (!token) return headers
  return { ...headers, Authorization: `Bearer ${token}` }
}

function withAdminHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const token = getAdminToken()
  if (!token) return headers
  return { ...headers, 'X-Admin-Token': token }
}

function withStaffHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return withAdminHeaders(withAuthHeaders(headers))
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const json = (await response.json()) as ApiResponse<T>
  if (!response.ok || json.code !== 200) {
    const message = json.message || `请求失败: ${response.status}`
    if (response.status === 403 && /封禁/.test(message) && /无法发帖|无法评论|发帖或评论/.test(message)) {
      throw new Error(message)
    }
    if (response.status === 403 && /封禁/.test(message) && /已被封禁|无法登录/.test(message)) {
      const { useUserAuthStore } = await import('@/stores/userAuth')
      const auth = useUserAuthStore()
      auth.clearSession()
      auth.setBanNotice(message)
      auth.openLoginDialog()
    }
    throw new Error(message)
  }
  return json.data
}

export interface GuestbookListParams {
  category?: string
  /** 关键词，匹配标题 / 正文 / 昵称 */
  q?: string
  /** YYYY-MM-DD */
  startDate?: string
  /** YYYY-MM-DD */
  endDate?: string
  /** 按用户筛选 */
  userId?: number
  /** 仅查询当前登录账号自己的匿名委托 */
  anonymous?: 'only'
  /** 仅已关注用户的帖子 */
  following?: boolean
}

/** 前台：仅可见帖子；可按分类 / 关键词 / 日期筛选 */
export async function fetchGuestbook(
  params: GuestbookListParams | string = {},
): Promise<GuestbookEntry[]> {
  const opts: GuestbookListParams = typeof params === 'string' ? { category: params } : params
  const query = new URLSearchParams()
  if (opts.category?.trim()) query.set('category', opts.category.trim())
  if (opts.q?.trim()) query.set('q', opts.q.trim())
  if (opts.startDate?.trim()) query.set('startDate', opts.startDate.trim())
  if (opts.endDate?.trim()) query.set('endDate', opts.endDate.trim())
  if (opts.userId && opts.userId > 0) query.set('userId', String(opts.userId))
  if (opts.anonymous) query.set('anonymous', opts.anonymous)
  if (opts.following) query.set('following', '1')
  const qs = query.toString()
  return requestJson<GuestbookEntry[]>(`/api/guestbook${qs ? `?${qs}` : ''}`, {
    headers: withAuthHeaders(),
  })
}

export async function fetchGuestbookPost(id: number): Promise<GuestbookEntry> {
  return requestJson<GuestbookEntry>(`/api/guestbook/${id}`, {
    headers: withStaffHeaders(),
  })
}

export async function fetchGuestbookComments(postId: number): Promise<GuestbookComment[]> {
  return requestJson<GuestbookComment[]>(`/api/guestbook/${postId}/comments`, {
    headers: withStaffHeaders(),
  })
}

export async function createGuestbookComment(
  postId: number,
  payload: GuestbookCommentPayload,
): Promise<GuestbookComment> {
  return requestJson<GuestbookComment>(`/api/guestbook/${postId}/comments`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
}

export async function deleteGuestbookComment(postId: number, commentId: number): Promise<void> {
  await requestJson<{ id: number; postId: number }>(
    `/api/guestbook/${postId}/comments/${commentId}`,
    {
      method: 'DELETE',
      headers: withAuthHeaders(),
    },
  )
}

export async function blockGuestbookComment(
  postId: number,
  commentId: number,
): Promise<GuestbookCommentBlockResult> {
  return requestJson<GuestbookCommentBlockResult>(
    `/api/guestbook/${postId}/comments/${commentId}/block`,
    {
      method: 'POST',
      headers: withAuthHeaders(),
    },
  )
}

/** 留言板管理员：按状态查看帖子 */
export async function fetchGuestbookManage(
  status: GuestbookManageStatus = 'normal',
): Promise<GuestbookEntry[]> {
  return requestJson<GuestbookEntry[]>(`/api/guestbook/manage?status=${status}`, {
    headers: withStaffHeaders(),
  })
}

export async function restoreGuestbook(id: number): Promise<GuestbookEntry> {
  return requestJson<GuestbookEntry>(`/api/guestbook/${id}/restore`, {
    method: 'PATCH',
    headers: withStaffHeaders(),
  })
}

export async function requestRestoreGuestbook(id: number): Promise<GuestbookEntry> {
  return requestJson<GuestbookEntry>(`/api/guestbook/${id}/request-restore`, {
    method: 'POST',
    headers: withAuthHeaders(),
  })
}

export async function fetchGuestbookNotifications(): Promise<GuestbookNotification[]> {
  return requestJson<GuestbookNotification[]>('/api/guestbook/me/notifications', {
    headers: withAuthHeaders(),
  })
}

export async function fetchGuestbookUnreadCount(): Promise<number> {
  const data = await requestJson<{ count: number }>(
    '/api/guestbook/me/notifications/unread-count',
    { headers: withAuthHeaders() },
  )
  return data.count
}

export async function markGuestbookNotificationsRead(ids?: number[]): Promise<void> {
  await requestJson<{ updated: number }>('/api/guestbook/me/notifications/read', {
    method: 'PATCH',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(ids?.length ? { ids } : {}),
  })
}

export interface GuestbookCheckInResult {
  ok?: boolean
  alreadyCheckedIn?: boolean
  gained?: number
  progress?: {
    level: number
    exp: number
    expRequired: number | null
    isMaxLevel: boolean
  }
}

export async function checkInGuestbook(): Promise<GuestbookCheckInResult> {
  return requestJson<GuestbookCheckInResult>('/api/guestbook/me/checkin', {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: '{}',
  })
}

export async function fetchGuestbookDmConversations(): Promise<GuestbookDmConversation[]> {
  return requestJson<GuestbookDmConversation[]>('/api/guestbook/me/dm/conversations', {
    headers: withAuthHeaders(),
  })
}

export async function createGuestbookDmConversation(
  peerUserId: number,
): Promise<GuestbookDmConversation> {
  return requestJson<GuestbookDmConversation>('/api/guestbook/me/dm/conversations', {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ peerUserId }),
  })
}

export async function fetchGuestbookDmMessages(conversationId: number): Promise<{
  conversation: GuestbookDmConversation
  messages: GuestbookDmMessage[]
}> {
  return requestJson<{ conversation: GuestbookDmConversation; messages: GuestbookDmMessage[] }>(
    `/api/guestbook/me/dm/conversations/${conversationId}/messages`,
    { headers: withAuthHeaders() },
  )
}

export async function sendGuestbookDmMessage(
  conversationId: number,
  payload: { content?: string; images?: string[] },
): Promise<{ message: GuestbookDmMessage; conversation: GuestbookDmConversation }> {
  return requestJson<{ message: GuestbookDmMessage; conversation: GuestbookDmConversation }>(
    `/api/guestbook/me/dm/conversations/${conversationId}/messages`,
    {
      method: 'POST',
      headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    },
  )
}

export async function fetchGuestbookUserProfile(userId: number): Promise<GuestbookUserProfile> {
  return requestJson<GuestbookUserProfile>(`/api/guestbook/users/${userId}/profile`, {
    headers: withAuthHeaders(),
  })
}

export async function searchGuestbookUsers(query: string): Promise<GuestbookSocialUser[]> {
  const q = encodeURIComponent(query.trim())
  return requestJson<GuestbookSocialUser[]>(`/api/guestbook/users/search?q=${q}`, {
    headers: withAuthHeaders(),
  })
}

export async function fetchGuestbookFollowers(userId: number): Promise<GuestbookSocialUser[]> {
  return requestJson<GuestbookSocialUser[]>(`/api/guestbook/users/${userId}/followers`, {
    headers: withAuthHeaders(),
  })
}

export async function fetchGuestbookFollowing(userId: number): Promise<GuestbookSocialUser[]> {
  return requestJson<GuestbookSocialUser[]>(`/api/guestbook/users/${userId}/following`, {
    headers: withAuthHeaders(),
  })
}

export async function followGuestbookUser(userId: number): Promise<{ following: boolean }> {
  return requestJson<{ following: boolean }>(`/api/guestbook/users/${userId}/follow`, {
    method: 'POST',
    headers: withAuthHeaders(),
  })
}

export async function unfollowGuestbookUser(userId: number): Promise<{ following: boolean }> {
  return requestJson<{ following: boolean }>(`/api/guestbook/users/${userId}/follow`, {
    method: 'DELETE',
    headers: withAuthHeaders(),
  })
}

export async function blockGuestbookUser(userId: number): Promise<{ blocked: boolean }> {
  return requestJson<{ blocked: boolean }>(`/api/guestbook/users/${userId}/block`, {
    method: 'POST',
    headers: withAuthHeaders(),
  })
}

export async function unblockGuestbookUser(userId: number): Promise<{ blocked: boolean }> {
  return requestJson<{ blocked: boolean }>(`/api/guestbook/users/${userId}/block`, {
    method: 'DELETE',
    headers: withAuthHeaders(),
  })
}

export async function fetchMyBlockedUsers(): Promise<GuestbookSocialUser[]> {
  return requestJson<GuestbookSocialUser[]>('/api/guestbook/me/blocks', {
    headers: withAuthHeaders(),
  })
}

/** 站点后台：留言板管理员账号列表 */
export interface GuestbookModerator {
  id: number
  mihoyoAid: string
  mihoyoMid?: string
  note?: string
  isEnabled?: boolean
  createdAt: string
}

export async function fetchGuestbookModerators(): Promise<GuestbookModerator[]> {
  return requestJson<GuestbookModerator[]>('/api/admin/guestbook-moderators', {
    headers: withAdminHeaders(),
  })
}

export async function addGuestbookModerator(payload: {
  mihoyoAid: string
  mihoyoMid?: string
  note?: string
}): Promise<GuestbookModerator> {
  return requestJson<GuestbookModerator>('/api/admin/guestbook-moderators', {
    method: 'POST',
    headers: withAdminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
}

export async function removeGuestbookModerator(id: number): Promise<void> {
  await requestJson<{ id: number }>(`/api/admin/guestbook-moderators/${id}`, {
    method: 'DELETE',
    headers: withAdminHeaders(),
  })
}

export async function toggleGuestbookModerator(
  id: number,
  enabled: boolean,
): Promise<GuestbookModerator> {
  return requestJson<GuestbookModerator>(`/api/admin/guestbook-moderators/${id}/enabled`, {
    method: 'PATCH',
    headers: withAdminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ enabled }),
  })
}

export async function createGuestbook(payload: GuestbookPayload): Promise<GuestbookEntry> {
  return requestJson<GuestbookEntry>('/api/guestbook', {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
}

export async function updateGuestbook(
  id: number,
  payload: GuestbookPayload,
): Promise<GuestbookEntry> {
  return requestJson<GuestbookEntry>(`/api/guestbook/${id}`, {
    method: 'PATCH',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
}

export async function setGuestbookPinned(id: number, isPinned: boolean): Promise<GuestbookEntry> {
  return requestJson<GuestbookEntry>(`/api/guestbook/${id}/pin`, {
    method: 'PATCH',
    headers: withAdminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ isPinned }),
  })
}

export async function setProfilePinned(id: number, isPinned: boolean): Promise<GuestbookEntry> {
  return requestJson<GuestbookEntry>(`/api/guestbook/${id}/profile-pin`, {
    method: 'PATCH',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ isPinned }),
  })
}

export async function toggleGuestbookCommentLike(
  postId: number,
  commentId: number,
): Promise<GuestbookCommentLikeResult> {
  return requestJson<GuestbookCommentLikeResult>(
    `/api/guestbook/${postId}/comments/${commentId}/like`,
    {
      method: 'POST',
      headers: withAuthHeaders(),
    },
  )
}

export async function reportGuestbookPost(
  postId: number,
  payload: { reason?: string } = {},
): Promise<{ ok: boolean; duplicate?: boolean }> {
  return requestJson<{ ok: boolean; duplicate?: boolean }>(`/api/guestbook/${postId}/report`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
}

export async function reportGuestbookComment(
  postId: number,
  commentId: number,
  payload: { reason?: string } = {},
): Promise<{ ok: boolean; duplicate?: boolean }> {
  return requestJson<{ ok: boolean; duplicate?: boolean }>(
    `/api/guestbook/${postId}/comments/${commentId}/report`,
    {
      method: 'POST',
      headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    },
  )
}

export async function reportGuestbookUser(
  userId: number,
  payload: { reason?: string } = {},
): Promise<{ ok: boolean; duplicate?: boolean }> {
  return requestJson<{ ok: boolean; duplicate?: boolean }>(`/api/guestbook/users/${userId}/report`, {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
}

export async function requestGuestbookUnban(reason: string): Promise<{ ok: boolean; id?: number }> {
  return requestJson<{ ok: boolean; id?: number }>('/api/guestbook/me/unban-request', {
    method: 'POST',
    headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ reason }),
  })
}

export async function fetchGuestbookReports(
  status: 'pending' | 'handled' | 'all' = 'pending',
  targetType: 'post' | 'comment' | 'user' | 'all' = 'all',
): Promise<GuestbookReport[]> {
  const params = new URLSearchParams({ status, targetType })
  return requestJson<GuestbookReport[]>(`/api/guestbook/manage/reports?${params}`, {
    headers: withStaffHeaders(),
  })
}

export async function handleGuestbookReport(
  reportId: number,
  payload: { message?: string } = {},
): Promise<void> {
  await requestJson(`/api/guestbook/manage/reports/${reportId}`, {
    method: 'PATCH',
    headers: withStaffHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
}

export async function toggleGuestbookLike(id: number): Promise<GuestbookLikeResult> {
  return requestJson<GuestbookLikeResult>(`/api/guestbook/${id}/like`, {
    method: 'POST',
    headers: withAuthHeaders(),
  })
}

export async function toggleGuestbookFavorite(id: number): Promise<GuestbookFavoriteResult> {
  return requestJson<GuestbookFavoriteResult>(`/api/guestbook/${id}/favorite`, {
    method: 'POST',
    headers: withAuthHeaders(),
  })
}

export async function fetchMyFavoritePosts(): Promise<GuestbookEntry[]> {
  return requestJson<GuestbookEntry[]>('/api/guestbook/me/favorites', {
    headers: withAuthHeaders(),
  })
}

export async function fetchMyLikedPosts(): Promise<GuestbookEntry[]> {
  return requestJson<GuestbookEntry[]>('/api/guestbook/me/likes', {
    headers: withAuthHeaders(),
  })
}

export async function fetchMyComments(): Promise<GuestbookComment[]> {
  return requestJson<GuestbookComment[]>('/api/guestbook/me/comments', {
    headers: withAuthHeaders(),
  })
}

export async function uploadGuestbookImage(file: File): Promise<{ url: string; filename: string }> {
  const formData = new FormData()
  formData.append('image', file)
  const response = await fetch('/api/upload/guestbook', {
    method: 'POST',
    body: formData,
  })
  const json = (await response.json()) as ApiResponse<{ url: string; filename: string }>
  if (!response.ok || (json.code !== 200 && json.code !== 201)) {
    throw new Error(json.message || `上传失败: ${response.status}`)
  }
  return json.data
}

export async function setGuestbookHidden(
  id: number,
  isHidden: boolean,
  message = '',
): Promise<GuestbookEntry> {
  return requestJson<GuestbookEntry>(`/api/guestbook/${id}/visibility`, {
    method: 'PATCH',
    headers: withStaffHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ isHidden, message }),
  })
}

export async function setGuestbookSensitive(
  id: number,
  isSensitive: boolean,
): Promise<GuestbookEntry> {
  return requestJson<GuestbookEntry>(`/api/guestbook/${id}/sensitive`, {
    method: 'PATCH',
    headers: withStaffHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ isSensitive }),
  })
}

export async function fetchGuestbookSensitiveVisibility(): Promise<{ hidden: boolean }> {
  return requestJson<{ hidden: boolean }>('/api/guestbook/settings/sensitive-visibility')
}

export async function updateGuestbookSensitiveVisibility(
  hidden: boolean,
): Promise<{ hidden: boolean }> {
  return requestJson<{ hidden: boolean }>('/api/guestbook/settings/sensitive-visibility', {
    method: 'PATCH',
    headers: withStaffHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ hidden }),
  })
}

export async function deleteGuestbook(id: number, message = ''): Promise<void> {
  await requestJson<{ id: number }>(`/api/guestbook/${id}`, {
    method: 'DELETE',
    headers: withStaffHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ message }),
  })
}
