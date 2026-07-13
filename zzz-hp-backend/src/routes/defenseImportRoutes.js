import { Router } from 'express'
import { importFromNanoka } from '../controllers/defenseImportController.js'

const router = Router()

router.post('/import/nanoka', importFromNanoka)

export default router
