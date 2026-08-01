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
  uploadGuestbook,
  handleUploadError,
} from '../controllers/uploadController.js'

const router = Router()

router.post('/boss', uploadBossImage, handleUploadError, uploadBoss)
router.post('/buff', uploadBuffImage, handleUploadError, uploadBuff)
router.post('/calculator', uploadCalculatorImage, handleUploadError, uploadCalculator)
router.post('/calculator-public', uploadCalculatorPublicImage, handleUploadError, uploadCalculatorPublic)
router.post('/guestbook', uploadGuestbookImage, handleUploadError, uploadGuestbook)

export default router
