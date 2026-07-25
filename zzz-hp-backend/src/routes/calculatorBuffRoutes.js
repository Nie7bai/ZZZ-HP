import { Router } from 'express'
import {
  getCalculatorBuffs,
  getFollowUpSkillRules,
  getSkillSubcategories,
  removeAgent,
  removeBangboo,
  removeDriveDisc,
  removeFollowUpSkillRule,
  removeSkillSubcategory,
  removeWengine,
  saveAgent,
  saveBangboo,
  saveDriveDisc,
  saveFollowUpSkillRule,
  saveSkillSubcategory,
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

router.put('/agents', saveAgent)
router.delete('/agents/:id', removeAgent)

router.put('/bangboos', saveBangboo)
router.delete('/bangboos/:id', removeBangboo)

router.put('/drive-discs', saveDriveDisc)
router.delete('/drive-discs/:id', removeDriveDisc)

router.put('/wengines', saveWengine)
router.delete('/wengines/:id', removeWengine)

export default router
