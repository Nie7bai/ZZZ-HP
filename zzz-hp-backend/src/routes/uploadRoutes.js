import { Router } from 'express'
import { uploadBossImage, uploadBuffImage, uploadCalculatorImage, uploadGuestbookImage } from '../middleware/upload.js'
import { uploadBoss, uploadBuff, uploadCalculator, uploadGuestbook, handleUploadError } from '../controllers/uploadController.js'

const router = Router()

router.post('/boss', uploadBossImage, handleUploadError, uploadBoss)
router.post('/buff', uploadBuffImage, handleUploadError, uploadBuff)
router.post('/calculator', uploadCalculatorImage, handleUploadError, uploadCalculator)
router.post('/guestbook', uploadGuestbookImage, handleUploadError, uploadGuestbook)

export default router
