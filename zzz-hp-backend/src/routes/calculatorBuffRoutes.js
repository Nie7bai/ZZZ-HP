import { Router } from 'express'
import multer from 'multer'
import {
  exportCalculatorBuffs,
  getCalculatorBuffs,
  getFollowUpSkillRules,
  getSkillSubcategories,
  getSkills,
  getDamageEventModes,
  importCalculatorBuffs,
  removeAgent,
  removeBangboo,
  removeDriveDisc,
  removeFollowUpSkillRule,
  removeSkillSubcategory,
  removeSkill,
  removeDamageEventMode,
  removeWengine,
  saveAgent,
  saveBangboo,
  saveDriveDisc,
  saveFollowUpSkillRule,
  saveSkillSubcategory,
  saveSkill,
  saveDamageEventMode,
  saveWengine,
} from '../controllers/calculatorBuffController.js'
import { requireAdmin } from '../middleware/requireAdmin.js'
import { fail } from '../utils/response.js'

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase()
    const type = String(file.mimetype || '')
    if (name.endsWith('.json') || type.includes('json') || type === 'application/octet-stream') {
      cb(null, true)
      return
    }
    cb(new Error('请上传 JSON 文件'))
  },
})

function handleImportUpload(req, res, next) {
  importUpload.single('file')(req, res, (err) => {
    if (err) return fail(res, err.message || '上传失败', 400)
    if (!req.file) return fail(res, '请选择 JSON 文件', 400)
    return next()
  })
}

const router = Router()

router.get('/', getCalculatorBuffs)
router.get('/export', requireAdmin, exportCalculatorBuffs)
router.post('/import', requireAdmin, handleImportUpload, importCalculatorBuffs)

router.get('/skill-subcategories', getSkillSubcategories)
router.put('/skill-subcategories', requireAdmin, saveSkillSubcategory)
router.delete('/skill-subcategories/:id', requireAdmin, removeSkillSubcategory)

router.get('/follow-up-rules', getFollowUpSkillRules)
router.put('/follow-up-rules', requireAdmin, saveFollowUpSkillRule)
router.delete('/follow-up-rules/:id', requireAdmin, removeFollowUpSkillRule)

router.get('/skills', getSkills)
router.put('/skills', requireAdmin, saveSkill)
router.delete('/skills/:id', requireAdmin, removeSkill)

router.get('/damage-event-modes', getDamageEventModes)
router.put('/damage-event-modes', requireAdmin, saveDamageEventMode)
router.delete('/damage-event-modes/:id', requireAdmin, removeDamageEventMode)

router.put('/agents', requireAdmin, saveAgent)
router.delete('/agents/:id', requireAdmin, removeAgent)

router.put('/bangboos', requireAdmin, saveBangboo)
router.delete('/bangboos/:id', requireAdmin, removeBangboo)

router.put('/drive-discs', requireAdmin, saveDriveDisc)
router.delete('/drive-discs/:id', requireAdmin, removeDriveDisc)

router.put('/wengines', requireAdmin, saveWengine)
router.delete('/wengines/:id', requireAdmin, removeWengine)

export default router
