import { createBoss, createBuff, deleteBoss, deleteBuff, searchBossRecords, searchBuffRecords } from '../services/dataService.js'
import { success, fail } from '../utils/response.js'

function validateBoss(body) {
  const { version, phase, boss_name, recordScheme } = body
  if (!version || !phase || !boss_name) {
    return 'version、phase、boss_name 为必填字段'
  }
  if (recordScheme === 'defense') {
    const required = ['stage', 'roomInStage', 'wave', 'monsterCategory', 'monsterSubType', 'count']
    const missing = required.filter((key) => body[key] == null || body[key] === '')
    if (missing.length) {
      return `式舆防卫战缺少字段：${missing.join('、')}`
    }
  }
  return null
}

function validateBuff(body) {
  const { version, phase, buff_name, recordScheme, buffIndex } = body
  if (!version || !phase || !buff_name) {
    return 'version、phase、buff_name 为必填字段'
  }
  if (buffIndex == null || buffIndex === '') {
    return 'buffIndex（Buff 序号）为必填字段'
  }
  if (recordScheme === 'defense') {
    const required = ['stage', 'roomInStage', 'buffIndex']
    const missing = required.filter((key) => body[key] == null || body[key] === '')
    if (missing.length) {
      return `式舆防卫战缺少字段：${missing.join('、')}`
    }
  }
  return null
}

export async function addBoss(req, res) {
  const error = validateBoss(req.body)
  if (error) {
    return fail(res, error, 400)
  }

  try {
    const data = await createBoss(req.body)
    return success(res, data, 'Boss 添加成功', 200)
  } catch (err) {
    return fail(res, err.message || 'Boss 添加失败', 400, { error: err.message })
  }
}

export async function addBuff(req, res) {
  const error = validateBuff(req.body)
  if (error) {
    return fail(res, error, 400)
  }

  try {
    const data = await createBuff(req.body)
    return success(res, data, 'Buff 添加成功', 201)
  } catch (err) {
    return fail(res, 'Buff 添加失败', 500, { error: err.message })
  }
}

export async function queryBoss(req, res) {
  try {
    const data = await searchBossRecords({
      version: req.query.version,
      phase: req.query.phase,
      keyword: req.query.q ?? req.query.keyword,
      limit: req.query.limit,
      recordScheme: req.query.recordScheme ?? req.query.scheme ?? null,
    })
    return success(res, data)
  } catch (err) {
    return fail(res, 'Boss 检索失败', 500, { error: err.message })
  }
}

export async function removeBoss(req, res) {
  try {
    const data = await deleteBoss(req.params.id)
    return success(res, data, 'Boss 删除成功')
  } catch (err) {
    const status = err.message.includes('不存在') ? 404 : 400
    return fail(res, 'Boss 删除失败', status, { error: err.message })
  }
}

export async function queryBuff(req, res) {
  try {
    const data = await searchBuffRecords({
      version: req.query.version,
      phase: req.query.phase,
      keyword: req.query.q ?? req.query.keyword,
      limit: req.query.limit,
      recordScheme: req.query.recordScheme ?? req.query.scheme ?? null,
    })
    return success(res, data)
  } catch (err) {
    return fail(res, 'Buff 检索失败', 500, { error: err.message })
  }
}

export async function removeBuff(req, res) {
  try {
    const data = await deleteBuff(req.params.id)
    return success(res, data, 'Buff 删除成功')
  } catch (err) {
    const status = err.message.includes('不存在') ? 404 : 400
    return fail(res, 'Buff 删除失败', status, { error: err.message })
  }
}
