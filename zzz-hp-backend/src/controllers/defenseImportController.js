import { importNanokaDefenseSeason, importNanokaDefenseSeasonBatch } from '../services/nanokaDefenseImportService.js'
import { success, fail } from '../utils/response.js'

export async function importFromNanoka(req, res) {
  try {
    const {
      seasonId = null,
      fromId = null,
      toId = null,
      version = null,
      phase = null,
      locale = 'zh',
      dryRun = false,
      buildTag = null,
      delayMs = 600,
    } = req.body ?? {}

    if (fromId != null || toId != null) {
      const data = await importNanokaDefenseSeasonBatch({
        fromId: fromId ?? 62038,
        toId: toId ?? 62053,
        locale,
        dryRun: Boolean(dryRun),
        buildTag,
        delayMs: Number(delayMs) || 0,
      })
      const message = data.dryRun ? 'nanoka 批量解析完成（未写入）' : 'nanoka 式舆批量导入完成'
      return success(res, data, message, data.dryRun ? 200 : 201)
    }

    const data = await importNanokaDefenseSeason({
      seasonId,
      version,
      phase,
      locale,
      dryRun: Boolean(dryRun),
      buildTag,
    })

    const message = data.dryRun ? 'nanoka 数据解析完成（未写入）' : 'nanoka 式舆数据导入完成'
    return success(res, data, message, data.dryRun ? 200 : 201)
  } catch (err) {
    return fail(res, 'nanoka 导入失败', 500, { error: err.message })
  }
}
