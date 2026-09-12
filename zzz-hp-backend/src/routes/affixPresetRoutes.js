import { Router } from 'express'
import {
  getAffixPreset,
  removeAffixPresetEntry,
  removeAffixPresetGroup,
  replaceAffixPresetHandler,
  saveAffixPresetEntry,
  saveAffixPresetGroup,
} from '../controllers/affixPresetController.js'
import { requireAdmin } from '../middleware/requireAdmin.js'

/**
 * 官方预设词条库。
 *
 * 读公开（进计算页就要拿它，不能要求登录）；写一律 `requireAdmin` ——
 * 用户侧「改不了」不是靠界面藏按钮，而是这些写接口根本不接受非管理员请求。
 */
const router = Router()

router.get('/', getAffixPreset)

router.put('/entries', requireAdmin, saveAffixPresetEntry)
router.delete('/entries/:id', requireAdmin, removeAffixPresetEntry)

router.put('/groups', requireAdmin, saveAffixPresetGroup)
router.delete('/groups/:name', requireAdmin, removeAffixPresetGroup)

router.put('/', requireAdmin, replaceAffixPresetHandler)

export default router
