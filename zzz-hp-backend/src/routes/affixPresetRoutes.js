import { Router } from 'express'
import {
  createAffixPresetSchemeHandler,
  getAffixPreset,
  removeAffixPresetScheme,
  replaceAffixPresetHandler,
} from '../controllers/affixPresetController.js'
import { requireAdmin } from '../middleware/requireAdmin.js'

/**
 * 官方预设词条库（多套「方案」）。
 *
 * 读公开（进计算页就要拿它，不能要求登录）；写一律 `requireAdmin` ——
 * 用户侧「改不了」不是靠界面藏按钮，而是这些写接口根本不接受非管理员请求。
 *
 * 写入口三个：整份替换一套方案（管理页「保存」）、新建方案、删除方案。
 * 没有逐条写接口：管理页是「草稿 + 保存」，保存就是整份替换（见控制器注释）。
 */
const router = Router()

router.get('/', getAffixPreset)

router.put('/', requireAdmin, replaceAffixPresetHandler)

router.post('/schemes', requireAdmin, createAffixPresetSchemeHandler)
router.delete('/schemes/:name', requireAdmin, removeAffixPresetScheme)

export default router
