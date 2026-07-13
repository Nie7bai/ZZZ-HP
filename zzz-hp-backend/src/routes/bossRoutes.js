import { Router } from 'express'
import { addBoss, queryBoss, removeBoss } from '../controllers/dataController.js'

const router = Router()

router.get('/search', queryBoss)
router.post('/', addBoss)
router.delete('/:id', removeBoss)

export default router
