import { Router } from 'express'
import { lookupBossInfo, searchBossInfo } from '../controllers/bossInfoController.js'

const router = Router()

router.get('/lookup', lookupBossInfo)
router.get('/search', searchBossInfo)

export default router
