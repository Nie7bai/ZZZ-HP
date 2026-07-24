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
  listSkillSubcategories,
  upsertSkillSubcategory,
} from '../services/skillSubcategoryService.js'
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
