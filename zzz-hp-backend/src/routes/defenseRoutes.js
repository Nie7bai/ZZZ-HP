import { Router } from 'express'
import { listDefenseSeasonIdMap, listDefenseSeasons } from '../controllers/defenseController.js'
import { importFromNanoka } from '../controllers/defenseImportController.js'

const router = Router()

router.get('/seasons', listDefenseSeasons)
router.get('/season-id-map', listDefenseSeasonIdMap)
router.post('/import/nanoka', importFromNanoka)

export default router
