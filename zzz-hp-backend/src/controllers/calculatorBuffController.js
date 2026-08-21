import {
  deleteAgent,
  deleteBangboo,
  deleteDriveDisc,
  deleteWengine,
  listCalculatorBuffs,
  upsertAgent,
  upsertBangboo,
  upsertDriveDisc,
  upsertWengine,
} from '../services/calculatorBuffService.js'
import {
  deleteSkillSubcategory,
  listFollowUpSkillRules,
  listSkillSubcategories,
  upsertFollowUpSkillRule,
  upsertSkillSubcategory,
  deleteFollowUpSkillRule,
} from '../services/skillSubcategoryService.js'
import {
  deleteDamageEventMode,
  listDamageEventModes,
  upsertDamageEventMode,
} from '../services/damageEventModeService.js'
import { deleteSkill, listSkills, upsertSkill } from '../services/skillLibraryService.js'
import {
  exportCalculatorBuffSnapshot,
  importCalculatorBuffSnapshot,
} from '../services/calculatorBuffSnapshotService.js'
import { fail, success } from '../utils/response.js'

export async function getCalculatorBuffs(_req, res) {
  try {
    const data = await listCalculatorBuffs()
    return success(res, data)
  } catch (err) {
    return fail(res, err.message || '获取计算器增益数据失败', 500, { error: err.message })
  }
}

export async function getSkillSubcategories(_req, res) {
  try {
    const data = await listSkillSubcategories()
    return success(res, data)
  } catch (err) {
    return fail(res, err.message || '获取招式小类失败', 500, { error: err.message })
  }
}

export async function saveSkillSubcategory(req, res) {
  try {
    const data = await upsertSkillSubcategory(req.body)
    return success(res, data, '招式小类保存成功')
  } catch (err) {
    return fail(res, err.message || '招式小类保存失败', 400, { error: err.message })
  }
}

export async function removeSkillSubcategory(req, res) {
  try {
    const data = await deleteSkillSubcategory(req.params.id)
    return success(res, data, '招式小类删除成功')
  } catch (err) {
    return fail(res, err.message || '招式小类删除失败', 400, { error: err.message })
  }
}

export async function getFollowUpSkillRules(_req, res) {
  try {
    const data = await listFollowUpSkillRules()
    return success(res, data)
  } catch (err) {
    return fail(res, err.message || '获取追加攻击规则失败', 500, { error: err.message })
  }
}

export async function saveFollowUpSkillRule(req, res) {
  try {
    const data = await upsertFollowUpSkillRule(req.body)
    return success(res, data, '追加攻击规则保存成功')
  } catch (err) {
    return fail(res, err.message || '追加攻击规则保存失败', 400, { error: err.message })
  }
}

export async function removeFollowUpSkillRule(req, res) {
  try {
    const data = await deleteFollowUpSkillRule(req.params.id)
    return success(res, data, '追加攻击规则删除成功')
  } catch (err) {
    return fail(res, err.message || '追加攻击规则删除失败', 400, { error: err.message })
  }
}

export async function getSkills(_req, res) {
  try {
    const data = await listSkills()
    return success(res, data)
  } catch (err) {
    return fail(res, err.message || '获取招式库失败', 500, { error: err.message })
  }
}

export async function saveSkill(req, res) {
  try {
    const data = await upsertSkill(req.body)
    return success(res, data, '招式保存成功')
  } catch (err) {
    return fail(res, err.message || '招式保存失败', 400, { error: err.message })
  }
}

export async function removeSkill(req, res) {
  try {
    const data = await deleteSkill(req.params.id)
    return success(res, data, '招式删除成功')
  } catch (err) {
    return fail(res, err.message || '招式删除失败', 400, { error: err.message })
  }
}

export async function getDamageEventModes(_req, res) {
  try {
    const data = await listDamageEventModes()
    return success(res, data)
  } catch (err) {
    return fail(res, err.message || '获取伤害事件模式失败', 500, { error: err.message })
  }
}

export async function saveDamageEventMode(req, res) {
  try {
    const data = await upsertDamageEventMode(req.body)
    return success(res, data, '伤害事件模式保存成功')
  } catch (err) {
    return fail(res, err.message || '伤害事件模式保存失败', 400, { error: err.message })
  }
}

export async function removeDamageEventMode(req, res) {
  try {
    const data = await deleteDamageEventMode(req.params.id)
    return success(res, data, '伤害事件模式删除成功')
  } catch (err) {
    return fail(res, err.message || '伤害事件模式删除失败', 400, { error: err.message })
  }
}

export async function saveAgent(req, res) {
  try {
    const data = await upsertAgent(req.body)
    return success(res, data, '角色保存成功')
  } catch (err) {
    return fail(res, err.message || '角色保存失败', 400, { error: err.message })
  }
}

export async function removeAgent(req, res) {
  try {
    const data = await deleteAgent(req.params.id)
    return success(res, data, '角色删除成功')
  } catch (err) {
    return fail(res, err.message || '角色删除失败', 400, { error: err.message })
  }
}

export async function saveBangboo(req, res) {
  try {
    const data = await upsertBangboo(req.body)
    return success(res, data, '邦布保存成功')
  } catch (err) {
    return fail(res, err.message || '邦布保存失败', 400, { error: err.message })
  }
}

export async function removeBangboo(req, res) {
  try {
    const data = await deleteBangboo(req.params.id)
    return success(res, data, '邦布删除成功')
  } catch (err) {
    return fail(res, err.message || '邦布删除失败', 400, { error: err.message })
  }
}

export async function saveDriveDisc(req, res) {
  try {
    const data = await upsertDriveDisc(req.body)
    return success(res, data, '驱动盘保存成功')
  } catch (err) {
    return fail(res, err.message || '驱动盘保存失败', 400, { error: err.message })
  }
}

export async function removeDriveDisc(req, res) {
  try {
    const data = await deleteDriveDisc(req.params.id)
    return success(res, data, '驱动盘删除成功')
  } catch (err) {
    return fail(res, err.message || '驱动盘删除失败', 400, { error: err.message })
  }
}

export async function saveWengine(req, res) {
  try {
    const data = await upsertWengine(req.body)
    return success(res, data, '音擎保存成功')
  } catch (err) {
    return fail(res, err.message || '音擎保存失败', 400, { error: err.message })
  }
}

export async function removeWengine(req, res) {
  try {
    const data = await deleteWengine(req.params.id)
    return success(res, data, '音擎删除成功')
  } catch (err) {
    return fail(res, err.message || '音擎删除失败', 400, { error: err.message })
  }
}

export async function exportCalculatorBuffs(_req, res) {
  try {
    const data = await exportCalculatorBuffSnapshot()
    return success(res, data)
  } catch (err) {
    return fail(res, err.message || '导出计算器增益失败', 500, { error: err.message })
  }
}

export async function importCalculatorBuffs(req, res) {
  try {
    let payload = req.body
    if (req.file?.buffer) {
      const text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '')
      payload = JSON.parse(text)
    }
    if (payload && typeof payload === 'object' && payload.data && !payload.agents && !payload.id) {
      payload = payload.data
    }
    const summary = await importCalculatorBuffSnapshot(payload)
    return success(res, summary, '增益导入完成')
  } catch (err) {
    const message = err instanceof SyntaxError ? 'JSON 解析失败' : err.message
    return fail(res, message || '增益导入失败', 400, { error: err.message })
  }
}
