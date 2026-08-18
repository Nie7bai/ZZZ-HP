import { Router } from 'express'
import { requireAdmin } from '../middleware/requireAdmin.js'
import {
  previewSeasonContentHandler,
  softDeleteSeasonContentHandler,
  purgeSeasonContentHandler,
  restoreSeasonContentHandler,
  cleanupSeasonContentHandler,
} from '../controllers/seasonContentController.js'
import {
  exportSeasonSnapshotHandler,
  handleSeasonSnapshotUpload,
  importSeasonSnapshotHandler,
} from '../controllers/seasonSnapshotController.js'

const router = Router()

router.get('/export', requireAdmin, exportSeasonSnapshotHandler)
router.post('/import', requireAdmin, handleSeasonSnapshotUpload, importSeasonSnapshotHandler)

router.post('/preview', requireAdmin, previewSeasonContentHandler)
router.post('/soft-delete', requireAdmin, softDeleteSeasonContentHandler)
router.post('/purge', requireAdmin, purgeSeasonContentHandler)
router.post('/restore', requireAdmin, restoreSeasonContentHandler)
router.post('/cleanup', requireAdmin, cleanupSeasonContentHandler)

export default router
