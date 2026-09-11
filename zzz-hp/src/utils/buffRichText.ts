/**
 * Buff 文案着色（对齐游戏 / nanoka 描述色标）：
 * - `<color=#RRGGBB>…</color>` 保留原色
 * - 数值 / 百分比高亮
 * - 属性名（火/电/以太…及「属性伤害」等）按属性色
 *
 * 属性色用 class 而非内联 hex，避免数值正则误伤色值。
 * 色值取自 nanoka 角色 JSON 中的 `<color=#…>` 标签。
 */

export const BUFF_ELEMENT_CSS_COLORS: Record<string, string> = {
  火: '#FF5521',
  冰: '#98EFF0',
  电: '#2EB6FF',
  以太: '#FE437E',
  物理: '#F0D12B',
  风: '#A6C5FD',
  流明: '#FFA9DD',
}

/** 数值高亮（nanoka 常用绿 `#2BAD00`） */
export const BUFF_RICH_NUMBER_COLOR = '#2BAD00'

const COLOR_TAG_RE =
  /<color=#([0-9a-fA-F]{3,8})>([\s\S]*?)<\/color>|<color=([^>\s]+)>([\s\S]*?)<\/color>/gi

/**
 * 属性词：
 * - 以太/流明/物理：可单独或带「属性/伤害…」
 * - 火/冰/电/风：须带「属性」或「伤害/抗性/异常/积蓄」，避免误伤「电流」等词
 */
const ELEMENT_PHRASE_RE =
  /(以太|流明|物理)(?:属性(?:伤害|抗性|异常|积蓄)?|伤害|抗性|异常|积蓄)?|(?:火|冰|电|风)(?:属性(?:伤害|抗性|异常|积蓄)?|伤害|抗性|异常|积蓄)/g

/** 效果行属性限定：`[电]` / `[电、火]` */
const ELEMENT_BRACKET_RE =
  /\[((?:以太|流明|物理|火|冰|电|风)(?:、(?:以太|流明|物理|火|冰|电|风))*)\]/g

/**
 * 其余方括号关键词（职业 / 招式等，nanoka 常用白字加粗）：
 * `[强攻]` / `[极限闪避]` / `[连携技]`
 */
const KEYWORD_BRACKET_RE = /(\[[^\[\]]+\])/g

/** 数值：含可选正负号、小数与 % */
const NUMBER_RE = /([+-]?\d+(?:\.\d+)?%?)/g

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function span(className: string, innerHtml: string, style?: string): string {
  const styleAttr = style ? ` style="${style}"` : ''
  return `<span class="${className}"${styleAttr}>${innerHtml}</span>`
}

function colorElementPhrase(full: string, el: string): string {
  if (!BUFF_ELEMENT_CSS_COLORS[el]) return full
  return span(`buff-rt-el buff-rt-el--${el}`, full)
}

function elementNameFromPhrase(full: string): string {
  return (['以太', '流明', '物理'] as const).find((n) => full.startsWith(n)) ?? full.charAt(0)
}

function highlightPlainEscaped(escaped: string): string {
  // 先标数值；已生成片段用占位符保护，避免二次匹配 class 名
  let out = escaped.replace(NUMBER_RE, (full) => span('buff-rt-num', full))

  const holders: string[] = []
  const park = (html: string) => {
    const key = `\u0000H${holders.length}\u0000`
    holders.push(html)
    return key
  }

  out = out.replace(ELEMENT_BRACKET_RE, (_full, inner: string) => {
    const colored = inner
      .split('、')
      .map((el) => colorElementPhrase(el, el))
      .join('、')
    return park(`[${colored}]`)
  })
  // 非属性的方括号关键词：加粗强调
  out = out.replace(KEYWORD_BRACKET_RE, (full) => park(span('buff-rt-kw', full)))
  out = out.replace(ELEMENT_PHRASE_RE, (full) =>
    park(colorElementPhrase(full, elementNameFromPhrase(full))),
  )
  out = out.replace(/\u0000H(\d+)\u0000/g, (_m, i) => holders[Number(i)] ?? '')
  return out
}

/**
 * 将 Buff 说明 / 效果行转为可安全 v-html 的 HTML（含 <br>）。
 */
export function formatBuffRichHtml(raw: string | null | undefined): string {
  const source = String(raw ?? '')
  if (!source) return ''

  const chunks: string[] = []
  let last = 0
  COLOR_TAG_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = COLOR_TAG_RE.exec(source))) {
    const before = source.slice(last, match.index)
    if (before) chunks.push(highlightPlainEscaped(escapeHtml(before)))
    const hex = (match[1] || '').trim()
    const named = (match[3] || '').trim()
    const inner = match[2] ?? match[4] ?? ''
    const color =
      hex.length >= 3
        ? `#${hex}`
        : named.startsWith('#')
          ? named
          : BUFF_ELEMENT_CSS_COLORS[named] || BUFF_RICH_NUMBER_COLOR
    chunks.push(span('buff-rt-color', highlightPlainEscaped(escapeHtml(inner)), `color:${color}`))
    last = match.index + match[0].length
  }
  const rest = source.slice(last)
  if (rest) chunks.push(highlightPlainEscaped(escapeHtml(rest)))

  return chunks.join('').replace(/\r\n|\n|\r/g, '<br>')
}

export function buffElementCssColor(element: string): string | null {
  return BUFF_ELEMENT_CSS_COLORS[element] ?? null
}
