import { Router } from 'express'
import {
  getBossChart,
  listBossNames,
  listPhases,
} from '../controllers/crisisAssaultController.js'

const router = Router()

router.get('/phases', listPhases)
router.get('/bosses', listBossNames)
router.get('/boss-chart', getBossChart)

export default router
