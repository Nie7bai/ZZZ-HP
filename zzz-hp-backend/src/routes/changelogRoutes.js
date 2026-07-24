import { Router } from 'express'
import {
  addChangelog,
  editChangelog,
  getChangelog,
  getChangelogs,
  removeChangelog,
} from '../controllers/changelogController.js'

const router = Router()

router.get('/', getChangelogs)
router.get('/:id', getChangelog)
router.post('/', addChangelog)
router.put('/:id', editChangelog)
router.delete('/:id', removeChangelog)

export default router
