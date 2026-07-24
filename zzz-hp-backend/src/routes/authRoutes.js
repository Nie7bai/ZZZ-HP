import { Router } from 'express'
import {
  bindPhoneHandler,
  createQr,
  getMe,
  getSecurity,
  loginPassword,
  logout,
  pollQr,
  sendBindPhoneCode,
  setPasswordHandler,
  updateMe,
  uploadAvatar,
} from '../controllers/authController.js'
import { uploadGuestbookImage } from '../middleware/upload.js'
import { handleUploadError } from '../controllers/uploadController.js'

const router = Router()

router.post('/mihoyo/qr', createQr)
router.post('/mihoyo/qr/status', pollQr)
router.post('/login/password', loginPassword)
router.get('/me', getMe)
router.patch('/me', updateMe)
router.post('/me/avatar', uploadGuestbookImage, handleUploadError, uploadAvatar)
router.get('/security', getSecurity)
router.post('/phone/send-code', sendBindPhoneCode)
router.post('/phone/bind', bindPhoneHandler)
router.post('/password', setPasswordHandler)
router.post('/logout', logout)

export default router
