import { Router } from 'express'
import { addBuff, queryBuff, queryBuffTemplates, removeBuff } from '../controllers/dataController.js'
import {
  exportBuffTableHandler,
  handleBuffTableUpload,
  importBuffTableHandler,
} from '../controllers/buffTableSnapshotController.js'
import { requireAdmin } from '../middleware/requireAdmin.js'

const router = Router()

router.get('/search', queryBuff)
router.get('/templates', queryBuffTemplates)
router.get('/export', requireAdmin, exportBuffTableHandler)
router.post('/import', requireAdmin, handleBuffTableUpload, importBuffTableHandler)
router.post('/', requireAdmin, addBuff)
router.delete('/:id', requireAdmin, removeBuff)

export default router
