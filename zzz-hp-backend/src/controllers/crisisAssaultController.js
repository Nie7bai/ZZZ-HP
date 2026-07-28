import {
  getBossChartHistory,
  getBossNames,
  getCrisisAssaultPhases,
} from '../services/crisisAssaultService.js'
import { isValidAdminSession } from '../services/adminSessionService.js'
import { success, fail } from '../utils/response.js'

function readIsSiteAdmin(req) {
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim()
    if (isValidAdminSession(token)) return true
  }
  const headerToken = req.headers['x-admin-token']
  if (typeof headerToken === 'string' && isValidAdminSession(headerToken.trim())) {
    return true
  }
  return false
}

export async function listPhases(req, res) {
  try {
    const includeHidden = readIsSiteAdmin(req)
    const data = await getCrisisAssaultPhases({ includeHidden })
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
    const includeHidden = readIsSiteAdmin(req)
    const data = await getBossChartHistory(bossName, { includeHidden })
    if (!data.length) {
      return fail(res, '未找到该 Boss 数据', 404)
    }
    return success(res, data)
  } catch (err) {
    return fail(res, '获取 Boss 折线图数据失败', 500, { error: err.message })
  }
}
