import { Router } from 'express'
import {
  addGuestbookComment,
  addGuestbookEntry,
  checkInGuestbookEntry,
  blockGuestbookComment,
  editGuestbookEntry,
  favoriteGuestbookEntry,
  getGuestbookComments,
  getGuestbookEntries,
  getGuestbookEntry,
  getGuestbookSensitiveVisibility,
  getManageGuestbookEntries,
  getGuestbookReports,
  getMyCommentEntries,
  getMyFavoriteEntries,
  getMyLikedEntries,
  getMyNotificationUnreadCount,
  getMyNotifications,
  hideGuestbookEntry,
  handleGuestbookReport,
  likeGuestbookEntry,
  likeGuestbookComment,
  markMyNotificationsRead,
  pinGuestbookEntry,
  profilePinGuestbookEntry,
  removeGuestbookComment,
  removeGuestbookEntry,
  reportGuestbookComment,
  reportGuestbookEntry,
  reportGuestbookUser,
  requestGuestbookUnban,
  requestRestoreGuestbookEntry,
  restoreGuestbookEntry,
  setGuestbookSensitiveEntry,
  updateGuestbookSensitiveVisibility,
} from '../controllers/guestbookController.js'

import {
  blockGuestbookUser,
  followGuestbookUser,
  getGuestbookUserFollowers,
  getGuestbookUserFollowing,
  getGuestbookUserProfile,
  getMyBlockedUsers,
  searchGuestbookUsers,
  unblockGuestbookUser,
  unfollowGuestbookUser,
} from '../controllers/guestbookSocialController.js'
import {
  createMyDmConversation,
  getMyDmConversations,
  getMyDmMessages,
  markMyDmConversationRead,
  sendMyDmMessage,
} from '../controllers/guestbookDmController.js'

const router = Router()

router.post('/me/checkin', checkInGuestbookEntry)
router.post('/me/unban-request', requestGuestbookUnban)
router.get('/me/favorites', getMyFavoriteEntries)
router.get('/me/likes', getMyLikedEntries)
router.get('/me/comments', getMyCommentEntries)
router.get('/me/notifications', getMyNotifications)
router.get('/me/notifications/unread-count', getMyNotificationUnreadCount)
router.patch('/me/notifications/read', markMyNotificationsRead)
router.get('/me/dm/conversations', getMyDmConversations)
router.post('/me/dm/conversations', createMyDmConversation)
router.get('/me/dm/conversations/:id/messages', getMyDmMessages)
router.post('/me/dm/conversations/:id/messages', sendMyDmMessage)
router.patch('/me/dm/conversations/:id/read', markMyDmConversationRead)
router.get('/me/blocks', getMyBlockedUsers)
router.get('/users/search', searchGuestbookUsers)
router.get('/users/:id/profile', getGuestbookUserProfile)
router.get('/users/:id/followers', getGuestbookUserFollowers)
router.get('/users/:id/following', getGuestbookUserFollowing)
router.post('/users/:id/follow', followGuestbookUser)
router.delete('/users/:id/follow', unfollowGuestbookUser)
router.post('/users/:id/block', blockGuestbookUser)
router.delete('/users/:id/block', unblockGuestbookUser)
router.post('/users/:id/report', reportGuestbookUser)
router.get('/manage/reports', getGuestbookReports)
router.patch('/manage/reports/:reportId', handleGuestbookReport)
router.get('/manage', getManageGuestbookEntries)
router.get('/settings/sensitive-visibility', getGuestbookSensitiveVisibility)
router.patch('/settings/sensitive-visibility', updateGuestbookSensitiveVisibility)
router.get('/', getGuestbookEntries)
router.post('/', addGuestbookEntry)
router.get('/:id/comments', getGuestbookComments)
router.post('/:id/comments', addGuestbookComment)
router.post('/:id/comments/:commentId/like', likeGuestbookComment)
router.post('/:id/comments/:commentId/report', reportGuestbookComment)
router.post('/:id/comments/:commentId/block', blockGuestbookComment)
router.delete('/:id/comments/:commentId', removeGuestbookComment)
router.patch('/:id', editGuestbookEntry)
router.patch('/:id/pin', pinGuestbookEntry)
router.patch('/:id/profile-pin', profilePinGuestbookEntry)
router.patch('/:id/restore', restoreGuestbookEntry)
router.post('/:id/request-restore', requestRestoreGuestbookEntry)
router.post('/:id/report', reportGuestbookEntry)
router.post('/:id/like', likeGuestbookEntry)
router.post('/:id/favorite', favoriteGuestbookEntry)
router.get('/:id', getGuestbookEntry)
router.patch('/:id/visibility', hideGuestbookEntry)
router.patch('/:id/sensitive', setGuestbookSensitiveEntry)
router.delete('/:id', removeGuestbookEntry)

export default router
