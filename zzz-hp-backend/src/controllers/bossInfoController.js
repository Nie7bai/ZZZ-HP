import {
  findBossInfoByName,
  listBossInfoRecords,
  searchBossInfoNames,
  updateBossInfoById,
  deleteBossInfoById,
} from '../services/bossInfoService.js'
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

export async function listBossInfo(req, res) {
  const keyword = req.query.q ?? req.query.keyword ?? ''
  const limit = req.query.limit
  const offset = req.query.offset
  const catalog = req.query.catalog ?? req.query.scope ?? 'all'

  try {
    const data = await listBossInfoRecords({ keyword, limit, offset, catalog })
    return success(res, data)
  } catch (err) {
    return fail(res, 'Boss 基础库列表查询失败', 500, { error: err.message })
  }
}

export async function patchBossInfo(req, res) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return fail(res, '无效的 boss_info ID', 400)
  }

  try {
    const data = await updateBossInfoById(id, req.body ?? {})
    return success(res, data, '已更新 Boss 基础信息')
  } catch (err) {
    const status = err.message?.includes('不存在') ? 404 : 400
    return fail(res, err.message || 'Boss 基础信息更新失败', status, { error: err.message })
  }
}

export async function removeBossInfo(req, res) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return fail(res, '无效的 boss_info ID', 400)
  }

  try {
    const data = await deleteBossInfoById(id)
    const hint =
      data.referenced_count > 0
        ? `（各期仍有 ${data.referenced_count} 条同名怪物记录，未一并删除）`
        : ''
    return success(res, data, `已删除 Boss 基础信息${hint}`)
  } catch (err) {
    const status = err.message?.includes('不存在') ? 404 : 400
    return fail(res, err.message || 'Boss 基础信息删除失败', status, { error: err.message })
  }
}
