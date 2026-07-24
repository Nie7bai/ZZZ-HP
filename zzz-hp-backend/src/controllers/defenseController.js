import { getDefenseSeasons } from '../services/defenseService.js'
import { getDefenseSeasonIdTable } from '../utils/defenseSeasonId.js'
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

export async function listDefenseSeasons(req, res) {
  const variant = req.query.variant === 'old' ? 'old' : 'new'

  try {
    const includeHidden = readIsSiteAdmin(req)
    const data = await getDefenseSeasons(variant, { includeHidden })
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
