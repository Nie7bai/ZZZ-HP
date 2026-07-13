import { Router } from 'express'
import { addBuff, queryBuff, removeBuff } from '../controllers/dataController.js'

const router = Router()

router.get('/search', queryBuff)
router.post('/', addBuff)
router.delete('/:id', removeBuff)

export default router
