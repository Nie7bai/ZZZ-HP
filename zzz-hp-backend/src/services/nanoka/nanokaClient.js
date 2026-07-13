const NANOKA_SHIYU_PAGE = 'https://zzz.nanoka.cc/shiyu'
const STATIC_BASE = 'https://static.nanoka.cc/zzz'

async function fetchText(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'user-agent': 'zzz-hp-importer/1.0',
      accept: 'application/json, text/html;q=0.9,*/*;q=0.8',
      ...(options.headers ?? {}),
    },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`请求失败 ${res.status}: ${url}`)
  }
  return text
}

async function fetchJson(url) {
  const text = await fetchText(url)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`响应不是合法 JSON: ${url}`)
  }
}

export async function resolveNanokaBuildTag(pageUrl = NANOKA_SHIYU_PAGE) {
  const html = await fetchText(pageUrl)
  const match = html.match(/data-url="https:\/\/static\.nanoka\.cc\/zzz\/([^"]+)\/shiyu\.json"/)
  if (!match) {
    throw new Error('无法从 nanoka 页面解析数据版本号')
  }
  return match[1]
}

export async function fetchShiyuIndex(buildTag) {
  return fetchJson(`${STATIC_BASE}/${buildTag}/shiyu.json`)
}

export async function fetchSeasonDetail(buildTag, seasonId, locale = 'zh') {
  const normalizedLocale = locale === 'en' ? 'en' : 'zh'
  return fetchJson(`${STATIC_BASE}/${buildTag}/${normalizedLocale}/shiyu/${seasonId}.json`)
}

export async function listSeasonIdsFromPage(pageUrl = NANOKA_SHIYU_PAGE) {
  const html = await fetchText(pageUrl)
  return [...new Set([...html.matchAll(/\/shiyu\/(\d{4,6})/g)].map((m) => m[1]))]
}

export function seasonIndexEntries(shiyuIndex) {
  return Object.entries(shiyuIndex ?? {}).map(([id, meta]) => ({
    seasonId: id,
    ...meta,
  }))
}
