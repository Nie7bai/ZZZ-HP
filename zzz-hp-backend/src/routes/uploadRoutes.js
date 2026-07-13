import { Router } from 'express'
import { uploadBossImage, uploadBuffImage, uploadCalculatorImage } from '../middleware/upload.js'
import { uploadBoss, uploadBuff, uploadCalculator, handleUploadError } from '../controllers/uploadController.js'

const router = Router()

router.post('/boss', uploadBossImage, handleUploadError, uploadBoss)
router.post('/buff', uploadBuffImage, handleUploadError, uploadBuff)
router.post('/calculator', uploadCalculatorImage, handleUploadError, uploadCalculator)

export default router
