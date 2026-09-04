import { Router } from 'express'
import {
  uploadBossImage,
  uploadBuffImage,
  uploadCalculatorImage,
  uploadCalculatorPublicImage,
  uploadGuestbookImage,
} from '../middleware/upload.js'
import {
  uploadBoss,
  uploadBuff,
  uploadCalculator,
  uploadCalculatorPublic,
  ensureCalculatorPublic,
  uploadGuestbook,
  handleUploadError,
} from '../controllers/uploadController.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { requireUser } from '../middleware/requireUser.js'

const router = Router()

router.post('/boss', requireAdmin, uploadBossImage, handleUploadError, uploadBoss)
router.post('/buff', requireAdmin, uploadBuffImage, handleUploadError, uploadBuff)
router.post('/calculator', requireAdmin, uploadCalculatorImage, handleUploadError, uploadCalculator)
router.post(
  '/calculator-public',
  requireAdmin,
  uploadCalculatorPublicImage,
  handleUploadError,
  uploadCalculatorPublic,
)
router.post('/calculator-public/ensure', requireAdmin, ensureCalculatorPublic)
// 留言板图片：限流在 app.js；requireUser 放在 Multer 之前，未登录不落盘；内存接收 + 魔数校验后再落盘
router.post('/guestbook', requireUser, uploadGuestbookImage, handleUploadError, uploadGuestbook)

export default router
