import { Router } from 'express'
import {
  getCalculatorBuffs,
  removeAgent,
  removeBangboo,
  removeDriveDisc,
  removeWengine,
  saveAgent,
  saveBangboo,
  saveDriveDisc,
  saveWengine,
} from '../controllers/calculatorBuffController.js'

const router = Router()

router.get('/', getCalculatorBuffs)

router.put('/agents', saveAgent)
router.delete('/agents/:id', removeAgent)

router.put('/bangboos', saveBangboo)
router.delete('/bangboos/:id', removeBangboo)

router.put('/drive-discs', saveDriveDisc)
router.delete('/drive-discs/:id', removeDriveDisc)

router.put('/wengines', saveWengine)
router.delete('/wengines/:id', removeWengine)

export default router
