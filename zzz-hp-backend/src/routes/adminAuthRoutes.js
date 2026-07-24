import { Router } from 'express'
import { loginAdmin } from '../controllers/adminAuthController.js'
import {
  createGuestbookModerator,
  deleteGuestbookModerator,
  getGuestbookModerators,
  toggleGuestbookModerator,
} from '../controllers/guestbookModeratorController.js'
import {
  banGuestbookUser,
  editGuestbookUser,
  getGuestbookUser,
  getGuestbookUsers,
} from '../controllers/adminGuestbookUserController.js'

const router = Router()

router.post('/login', loginAdmin)
router.get('/guestbook-moderators', getGuestbookModerators)
router.post('/guestbook-moderators', createGuestbookModerator)
router.delete('/guestbook-moderators/:id', deleteGuestbookModerator)
router.patch('/guestbook-moderators/:id/enabled', toggleGuestbookModerator)

router.get('/guestbook-users', getGuestbookUsers)
router.get('/guestbook-users/:id', getGuestbookUser)
router.patch('/guestbook-users/:id', editGuestbookUser)
router.patch('/guestbook-users/:id/ban', banGuestbookUser)

export default router
