import { Router } from 'express'
import { addBuff, queryBuff, queryBuffTemplates, removeBuff } from '../controllers/dataController.js'
import { requireAdmin } from '../middleware/requireAdmin.js'

const router = Router()

router.get('/search', queryBuff)
router.get('/templates', queryBuffTemplates)
router.post('/', requireAdmin, addBuff)
router.delete('/:id', requireAdmin, removeBuff)

export default router
