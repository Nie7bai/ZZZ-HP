import DOMPurify from 'isomorphic-dompurify'
import MarkdownIt from 'markdown-it'
import type { Config as DomPurifyConfig } from 'dompurify'

/**
 * 留言正文安全渲染（对齐 InterKnot format-body）：
 * CommonMark + 自动链接 + 换行转 <br>，再经 DOMPurify 白名单过滤。
 */
const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
  typographer: false,
})

const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!
  token.attrSet('target', '_blank')
  token.attrSet('rel', 'noopener nofollow noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

const SANITIZE_CONFIG: DomPurifyConfig = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'hr',
    'div',
    'span',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
    'del',
    'strike',
    'mark',
    'small',
    'sub',
    'sup',
    'kbd',
    'abbr',
    'cite',
    'ruby',
    'rb',
    'rp',
    'rt',
    'rtc',
    'a',
    'img',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'samp',
    'var',
    'details',
    'summary',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'caption',
  ],
  ALLOWED_ATTR: [
    'href',
    'target',
    'rel',
    'src',
    'alt',
    'title',
    'width',
    'height',
    'class',
    'id',
    'colspan',
    'rowspan',
    'open',
    'style',
    'loading',
    'decoding',
  ],
}

const DANGEROUS_CSS_RE =
  /javascript:|vbscript:|data:|expression\s*\(|behavior\s*:|@import\b|<\s*\/?[a-z]|position\s*:\s*(fixed|sticky|absolute)/i

let hooksInstalled = false

function ensureSanitizeHooks() {
  if (hooksInstalled) return
  hooksInstalled = true

  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName === 'style' && DANGEROUS_CSS_RE.test(data.attrValue)) {
      data.keepAttr = false
    }
  })

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeType !== 1) return
    const el = node as Element
    if (el.tagName === 'A' && el.getAttribute('target') === '_blank') {
      el.setAttribute('rel', 'noopener nofollow noreferrer')
    }
    if (el.tagName === 'IMG') {
      el.setAttribute('loading', 'lazy')
      el.setAttribute('decoding', 'async')
    }
  })
}

/** 将用户输入的纯文本 / Markdown 渲染为安全 HTML */
export function formatBodyText(text: string): string {
  if (!text) return ''
  ensureSanitizeHooks()
  const rendered = md.render(text)
  return DOMPurify.sanitize(rendered, SANITIZE_CONFIG)
}
