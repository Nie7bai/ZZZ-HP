/**
 * nanoka 临界推演（simul）数据客户端
 * 与 nanokaClient.js（防卫战）同构：页面解析 buildTag → 静态 JSON。
 */
import { fetchJson, fetchText } from './nanokaClient.js'

const SIMUL_PAGE = 'https://zzz.nanoka.cc/simul'
const STATIC_BASE = 'https://static.nanoka.cc/zzz'

export async function resolveSimulBuildTag(pageUrl = SIMUL_PAGE) {
  const html = await fetchText(pageUrl)
  const match = html.match(/data-url="https:\/\/static\.nanoka\.cc\/zzz\/([^"]+)\/simul\.json"/)
  if (!match) {
    throw new Error('无法从 nanoka simul 页面解析数据版本号')
  }
  return match[1]
}

export async function fetchSimulIndex(buildTag) {
  return fetchJson(`${STATIC_BASE}/${buildTag}/simul.json`)
}

export async function fetchSimulDetail(buildTag, simulId, locale = 'zh') {
  const normalizedLocale = locale === 'en' ? 'en' : 'zh'
  return fetchJson(`${STATIC_BASE}/${buildTag}/${normalizedLocale}/simul/${simulId}.json`)
}

export function simulIndexEntries(simulIndex) {
  return Object.entries(simulIndex ?? {}).map(([id, meta]) => ({
    simulId: id,
    ...meta,
  }))
}
