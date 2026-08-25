import { Router } from 'express'
import {
  listBossInfo,
  lookupBossInfo,
  patchBossInfo,
  removeBossInfo,
  searchBossInfo,
  syncBossInfoFromBossHandler,
} from '../controllers/bossInfoController.js'
import {
  exportBossInfoHandler,
  handleBossInfoUpload,
  importBossInfoHandler,
} from '../controllers/bossInfoSnapshotController.js'
import { requireAdmin } from '../middleware/requireAdmin.js'

const router = Router()

router.get('/lookup', lookupBossInfo)
router.get('/search', searchBossInfo)
router.get('/list', listBossInfo)
router.get('/export', requireAdmin, exportBossInfoHandler)
router.post('/import', requireAdmin, handleBossInfoUpload, importBossInfoHandler)
router.post('/sync-from-boss', requireAdmin, syncBossInfoFromBossHandler)
router.put('/:id', requireAdmin, patchBossInfo)
router.delete('/:id', requireAdmin, removeBossInfo)

export default router
