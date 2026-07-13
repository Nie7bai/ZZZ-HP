import {
  getBossChartHistory,
  getBossNames,
  getCrisisAssaultPhases,
} from '../services/crisisAssaultService.js'
import { success, fail } from '../utils/response.js'

export async function listPhases(_req, res) {
  try {
    const data = await getCrisisAssaultPhases()
    return success(res, data)
  } catch (err) {
    return fail(res, '获取危局强袭战数据失败', 500, { error: err.message })
  }
}

export async function listBossNames(_req, res) {
  try {
    const data = await getBossNames()
    return success(res, data)
  } catch (err) {
    return fail(res, '获取 Boss 列表失败', 500, { error: err.message })
  }
}

export async function getBossChart(req, res) {
  const bossName = req.query.boss_name
  if (!bossName) {
    return fail(res, '请提供 boss_name 参数', 400)
  }

  try {
    const data = await getBossChartHistory(bossName)
    if (!data.length) {
      return fail(res, '未找到该 Boss 数据', 404)
    }
    return success(res, data)
  } catch (err) {
    return fail(res, '获取 Boss 折线图数据失败', 500, { error: err.message })
  }
}
