import { findBossInfoByName, searchBossInfoNames } from '../services/bossInfoService.js'
import { success, fail } from '../utils/response.js'

export async function lookupBossInfo(req, res) {
  const bossName = req.query.boss_name ?? req.query.name ?? ''

  try {
    const data = await findBossInfoByName(bossName)
    return success(res, data, data ? '已找到 Boss 基础信息' : '未找到 Boss 基础信息')
  } catch (err) {
    return fail(res, 'Boss 基础信息查询失败', 500, { error: err.message })
  }
}

export async function searchBossInfo(req, res) {
  const keyword = req.query.q ?? req.query.keyword ?? ''

  try {
    const data = await searchBossInfoNames(keyword)
    return success(res, data)
  } catch (err) {
    return fail(res, 'Boss 名称检索失败', 500, { error: err.message })
  }
}
