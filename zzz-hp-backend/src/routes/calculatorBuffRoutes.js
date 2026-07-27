import { Router } from 'express'
import {
  getCalculatorBuffs,
  getFollowUpSkillRules,
  getSkillSubcategories,
  getDamageEventModes,
  removeAgent,
  removeBangboo,
  removeDriveDisc,
  removeFollowUpSkillRule,
  removeSkillSubcategory,
  removeDamageEventMode,
  removeWengine,
  saveAgent,
  saveBangboo,
  saveDriveDisc,
  saveFollowUpSkillRule,
  saveSkillSubcategory,
  saveDamageEventMode,
  saveWengine,
} from '../controllers/calculatorBuffController.js'

const router = Router()

router.get('/', getCalculatorBuffs)

router.get('/skill-subcategories', getSkillSubcategories)
router.put('/skill-subcategories', saveSkillSubcategory)
router.delete('/skill-subcategories/:id', removeSkillSubcategory)

router.get('/follow-up-rules', getFollowUpSkillRules)
router.put('/follow-up-rules', saveFollowUpSkillRule)
router.delete('/follow-up-rules/:id', removeFollowUpSkillRule)

router.get('/damage-event-modes', getDamageEventModes)
router.put('/damage-event-modes', saveDamageEventMode)
router.delete('/damage-event-modes/:id', removeDamageEventMode)

router.put('/agents', saveAgent)
router.delete('/agents/:id', removeAgent)

router.put('/bangboos', saveBangboo)
router.delete('/bangboos/:id', removeBangboo)

router.put('/drive-discs', saveDriveDisc)
router.delete('/drive-discs/:id', removeDriveDisc)

router.put('/wengines', saveWengine)
router.delete('/wengines/:id', removeWengine)

export default router
