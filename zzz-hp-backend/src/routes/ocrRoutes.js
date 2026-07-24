import { Router } from 'express'
import {
  uploadPanelImage,
  handleOcrUploadError,
  recognizePanel,
  ocrStatus,
} from '../controllers/ocrController.js'

const router = Router()

router.get('/status', ocrStatus)
router.post('/panel', uploadPanelImage, handleOcrUploadError, recognizePanel)

export default router
