import { Router } from 'express'
import {
  getSeasonDates,
  postSeasonDate,
  putSeasonDate,
  removeSeasonDate,
} from '../controllers/seasonDateController.js'

const router = Router()

router.get('/', getSeasonDates)
router.post('/', postSeasonDate)
router.put('/:id', putSeasonDate)
router.delete('/:id', removeSeasonDate)

export default router
