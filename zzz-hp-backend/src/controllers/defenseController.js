import { getDefenseSeasons } from '../services/defenseService.js'
import { getDefenseSeasonIdTable } from '../utils/defenseSeasonId.js'
import { success, fail } from '../utils/response.js'

export async function listDefenseSeasons(req, res) {
  const variant = req.query.variant === 'old' ? 'old' : 'new'

  try {
    const data = await getDefenseSeasons(variant)
    return success(res, data)
  } catch (err) {
    return fail(res, '获取式舆防卫战数据失败', 500, { error: err.message })
  }
}

export async function listDefenseSeasonIdMap(_req, res) {
  try {
    const data = getDefenseSeasonIdTable()
    return success(res, data)
  } catch (err) {
    return fail(res, '获取防卫战 ID 转换表失败', 500, { error: err.message })
  }
}
