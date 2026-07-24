import {
  getSiteInfoSection,
  listSiteInfoSections,
  updateSiteInfoSection,
} from '../services/siteInfoService.js'
import { fail, success } from '../utils/response.js'

export async function getSiteInfoSections(_req, res) {
  try {
    const data = await listSiteInfoSections()
    return success(res, data)
  } catch (err) {
    return fail(res, '获取网站说明失败', 500, { error: err.message })
  }
}

export async function getSiteInfoSectionByKey(req, res) {
  const panelKey = String(req.params.panelKey || '').trim()
  try {
    const data = await getSiteInfoSection(panelKey)
    if (!data) return fail(res, '栏目不存在', 404)
    return success(res, data)
  } catch (err) {
    return fail(res, '获取网站说明失败', 500, { error: err.message })
  }
}

export async function editSiteInfoSection(req, res) {
  const panelKey = String(req.params.panelKey || '').trim()
  const title = typeof req.body?.title === 'string' ? req.body.title : ''
  const content = typeof req.body?.content === 'string' ? req.body.content : ''

  try {
    const data = await updateSiteInfoSection(panelKey, { title, content })
    if (data?.error) return fail(res, data.error, 400)
    if (!data) return fail(res, '栏目不存在', 404)
    return success(res, data, '网站说明已保存')
  } catch (err) {
    return fail(res, '保存网站说明失败', 500, { error: err.message })
  }
}
