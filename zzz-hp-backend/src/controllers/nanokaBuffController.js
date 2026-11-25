/**
 * nanoka 增益（关键字 → 增益块）管理端接口。
 *
 * 抓 nanoka 一律由**浏览器**完成（浏览器走用户系统代理），服务端不联网：
 *   - `POST /extract`  ：吃浏览器抓来的详情 + 索引项，返回「原文项 + 关键字效果（层B/C）」，
 *                        以及本地记录匹配结果与**字典（槽位标签 / 下拉选项）**；**不写库**。
 *   - `POST /simplify` ：阶段一的 [化简] / [全部化简]；把（可编辑的）原文重跑阶段1，**不写库**。
 *   - `POST /parse`    ：阶段二的 [解析] = **智能覆盖**（逐字段回填 + 冲突清单），**不写库**。
 *   - `POST /apply`    ：唯一写库入口（`dryRun: true` 只算不写；写库走既有 upsert）。
 *
 * 参数不对（`kind` 不认 / `detail` 缺失 / 本地找不到对应记录）一律 400 + 中文原因。
 */
import {
  applyBuffItems,
  extractBuffItems,
  findEmptyBuffTargets,
  nanokaRulesTable,
  simplifyBuffTexts,
  smartMergeParse,
} from '../services/nanokaBuffService.js'
import { fail, success } from '../utils/response.js'

const KIND_LABELS = { agent: '角色', wengine: '音擎' }

/**
 * GET /api/admin/nanoka-buffs/empty-targets?kind=agent|wengine
 * 「找空活干」：列出**所有增益容器里 effect 条数 = 0** 的角色 / 音擎（只读查询，不写库）。
 * 顺带返回「增益条很少（≤ fewThreshold）」的列表供参考。
 */
export async function emptyTargetsNanokaBuffsHandler(req, res) {
  try {
    const kind = String(req.query?.kind ?? 'agent') === 'wengine' ? 'wengine' : 'agent'
    const fewThreshold = Number.parseInt(String(req.query?.fewThreshold ?? ''), 10)
    const data = await findEmptyBuffTargets({
      kind,
      fewThreshold: Number.isFinite(fewThreshold) && fewThreshold >= 0 ? fewThreshold : 2,
    })
    return success(
      res,
      data,
      `${KIND_LABELS[kind]}：0 增益 ${data.empty.length} / ${data.total} 条（增益条 ≤ ${data.fewThreshold} 的另有 ${data.few.length} 条）`,
    )
  } catch (err) {
    return fail(res, err.message || '0 增益列表读取失败', 400, { error: err.message })
  }
}

/** GET /api/admin/nanoka-buffs/rules —— 解析规则对照表（只读；单一事实来源，不写库） */
export async function rulesNanokaBuffsHandler(_req, res) {
  try {
    const data = nanokaRulesTable()
    const count = data.groups.reduce((total, group) => total + group.items.length, 0)
    return success(res, data, `解析规则 ${data.groups.length} 组 / ${count} 条`)
  } catch (err) {
    return fail(res, err.message || '解析规则读取失败', 400, { error: err.message })
  }
}

/** POST /api/admin/nanoka-buffs/extract —— 抽取（不写库） */
export async function extractNanokaBuffsHandler(req, res) {
  try {
    const { kind, nanokaId, meta, detail } = req.body ?? {}
    const data = await extractBuffItems({ kind, nanokaId, meta, detail })
    const { counts } = data
    const message =
      `${data.localName || data.localId}：抓到 ${counts.items} 段原文（有增益 ${counts.buffItems} / 废原文 ${counts.wasteItems}）；` +
      `关键字 ${counts.keywords} 条（可录 ${counts.recordable} · 待补槽位 ${counts.unableSlots} · 招式锚点不录 ${counts.dropped} 条）`
    return success(res, data, message)
  } catch (err) {
    return fail(res, err.message || '增益抽取失败', 400, { error: err.message })
  }
}

/** POST /api/admin/nanoka-buffs/simplify —— [化简]（阶段一，不写库） */
export async function simplifyNanokaBuffsHandler(req, res) {
  try {
    const { kind, nanokaId, items, corePassiveText } = req.body ?? {}
    const data = await simplifyBuffTexts({ kind, nanokaId, items, corePassiveText })
    const message = `已化简 ${data.items.length} 段原文（未写入）`
    return success(res, data, message)
  } catch (err) {
    return fail(res, err.message || '化简失败', 400, { error: err.message })
  }
}

/** POST /api/admin/nanoka-buffs/parse —— [解析] = 智能覆盖（不写库） */
export async function parseNanokaBuffsHandler(req, res) {
  try {
    const { rows, keywords, anchors, agentId } = req.body ?? {}
    const data = smartMergeParse({ rows, keywords, anchors, agentId })
    const message =
      `解析完成：回填 ${data.filled} 个字段 / 冲突 ${data.conflicts.length} 条（等你裁决）/ ` +
      `追加 ${data.added} 行 / 保留 ${data.stale} 行（关键字里已无此条）/ 阻断 ${data.blocked} 行`
    return success(res, data, message)
  } catch (err) {
    return fail(res, err.message || '解析失败', 400, { error: err.message })
  }
}

/** POST /api/admin/nanoka-buffs/apply —— 按槽位下标写入（`dryRun` 只算不写） */
export async function applyNanokaBuffsHandler(req, res) {
  try {
    const { kind, id, rows, dryRun } = req.body ?? {}
    const data = await applyBuffItems({ kind, id, rows, dryRun: dryRun === true })
    const head = `${KIND_LABELS[data.kind] ?? data.kind}「${data.name || data.id}」`
    let message = data.dryRun
      ? `${head}：预览（未写入）——将新增 ${data.updated} 条 / 重复跳过 ${data.skipped} / 失败 ${data.failed}`
      : `${head}：新增 ${data.updated} 条 / 重复跳过 ${data.skipped}${data.failed ? ` / 失败 ${data.failed}` : ''}`
    if (data.writeError) message = `${head}：写库失败 —— ${data.writeError}`
    return success(res, data, message)
  } catch (err) {
    return fail(res, err.message || '增益写入失败', 400, { error: err.message })
  }
}
