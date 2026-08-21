import { Router } from 'express'
import {
  listBossInfo,
  lookupBossInfo,
  patchBossInfo,
  removeBossInfo,
  searchBossInfo,
} from '../controllers/bossInfoController.js'
import { requireAdmin } from '../middleware/requireAdmin.js'

const router = Router()

router.get('/lookup', lookupBossInfo)
router.get('/search', searchBossInfo)
router.get('/list', listBossInfo)
router.put('/:id', requireAdmin, patchBossInfo)
router.delete('/:id', requireAdmin, removeBossInfo)

export default router
