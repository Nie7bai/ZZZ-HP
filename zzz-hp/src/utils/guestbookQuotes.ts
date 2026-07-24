export type GuestbookQuoteType = 'comment' | 'dm'

export type GuestbookQuoteRef = {
  type: GuestbookQuoteType
  id: number
  nickname: string
  preview: string
}

const QUOTE_TOKEN_REGEX =
  /^\[\[quote:(comment|dm):(\d+)\|([^|\]]+)\|([\s\S]*)\]\]\n?/

function sanitizeQuotePart(value: string, maxLen: number) {
  return String(value || '')
    .replace(/[\[\]|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
}

/** 去掉内容里所有引用 token，只保留可见正文 */
export function stripQuoteTokens(text: string) {
  let raw = String(text || '')
  for (let i = 0; i < 8; i++) {
    const next = raw
      .replace(/\[\[quote:(?:comment|dm):\d+\|[^|\]]+\|[\s\S]*?\]\]\n?/g, '')
      .replace(/\[\[quote:(?:comment|dm):\d+[\s\S]*?\]\]\n?/g, '')
      .replace(/\[\[quote:(?:comment|dm):[\s\S]*?\]\]/g, '')
      .replace(/quote:(?:comment|dm):\d+\|[^|\]]+\|/g, '')
      .replace(/quote:(?:comment|dm):\d+/g, '')
    if (next === raw) break
    raw = next
  }
  return raw.trim()
}

function cleanPreviewField(text: string): string {
  let raw = String(text || '').trim()
  if (!raw) return ''

  for (let i = 0; i < 8; i++) {
    const match = raw.match(QUOTE_TOKEN_REGEX)
    if (match) {
      const inner = cleanPreviewField(match[4] || '')
      if (inner) return inner
      raw = stripQuoteTokens(match[4] || '')
      continue
    }

    const stripped = stripQuoteTokens(raw)
    if (stripped !== raw) {
      raw = stripped
      continue
    }

    if (/\[\[quote:|quote:(?:comment|dm):|\[\[/i.test(raw)) {
      raw = raw
        .replace(/\[\[/g, '')
        .replace(/\]\]/g, '')
        .replace(/quote:(?:comment|dm):\d+/gi, '')
        .replace(/\|/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      const tail = raw.split(/测试机/).pop()?.replace(/^[？?|·\s]+/, '').trim()
      if (tail && tail.length < raw.length) return tail
      continue
    }
    break
  }

  return raw.replace(/\s+/g, ' ').trim()
}

/** 从任意文本（含嵌套/损坏 token）提取给用户看的预览 */
export function unwrapQuotePreview(text: string) {
  const parsed = splitQuotedContent(text)
  const body = stripQuoteTokens(parsed.body).replace(/\s+/g, ' ').trim()
  if (body) return body

  if (parsed.quote) return parsed.quote.preview

  return cleanPreviewField(text)
}

export function quotePreviewText(content: string, images?: string[]) {
  const parsed = splitQuotedContent(content)
  const body = stripQuoteTokens(parsed.body).replace(/\s+/g, ' ').trim()
  if (body) return body.slice(0, 120)

  if (parsed.quote) {
    const inner = unwrapQuotePreview(parsed.quote.preview).replace(/\s+/g, ' ').trim()
    if (inner) return inner.slice(0, 120)
  }

  const text = unwrapQuotePreview(content).replace(/\s+/g, ' ').trim()
  if (text) return text.slice(0, 120)
  if (images?.length) return '[图片]'
  return ''
}

export function buildQuoteToken(quote: GuestbookQuoteRef) {
  const nickname = sanitizeQuotePart(quote.nickname || '用户', 40)
  const preview = sanitizeQuotePart(unwrapQuotePreview(quote.preview), 200)
  return `[[quote:${quote.type}:${quote.id}|${nickname}|${preview}]]`
}

export function attachQuote(quote: GuestbookQuoteRef, body: string) {
  const text = String(body || '').trim()
  if (!text) return buildQuoteToken(quote)
  return `${buildQuoteToken(quote)}\n${text}`
}

export function splitQuotedContent(content: string) {
  const raw = String(content || '')
  const match = raw.match(QUOTE_TOKEN_REGEX)
  if (!match) {
    if (/\[\[quote:|quote:(?:comment|dm):|\[\[/i.test(raw)) {
      return { body: cleanPreviewField(raw) }
    }
    return { body: raw }
  }

  return {
    quote: {
      type: match[1] as GuestbookQuoteType,
      id: Number(match[2]),
      nickname: match[3] || '用户',
      preview: cleanPreviewField(match[4] || ''),
    },
    body: stripQuoteTokens(raw.slice(match[0].length)),
  }
}

export function formatMessagePreview(content: string, images?: string[]) {
  const parsed = splitQuotedContent(content)
  const body = stripQuoteTokens(parsed.body).replace(/\s+/g, ' ').trim()
  if (body) return body.slice(0, 120)
  if (parsed.quote?.preview) return parsed.quote.preview.slice(0, 120)
  const cleaned = cleanPreviewField(content)
  if (cleaned) return cleaned.slice(0, 120)
  if (images?.length) return '[图片]'
  return ''
}

export function scrollToQuoteTarget(elementId: string) {
  let done = false
  const tryOnce = () => {
    if (done) return true
    const el = document.getElementById(elementId)
    if (!el) return false
    done = true
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('is-quote-highlight')
    window.setTimeout(() => el.classList.remove('is-quote-highlight'), 1800)
    return true
  }

  if (tryOnce()) return true

  // DOM 可能尚未挂载（详情切 tab / 列表渲染），短延迟重试几次
  ;[80, 200, 400].forEach((ms) => {
    window.setTimeout(() => {
      tryOnce()
    }, ms)
  })
  return false
}
