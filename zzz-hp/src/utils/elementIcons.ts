/**
 * 绝区零属性图标（本地 /attribute_image/ 目录，由 nanoka CDN 下载管理）
 */
const ELEMENT_ICON_MAP: Record<string, string> = {
  冰: '/attribute_image/IconIce.webp',
  火: '/attribute_image/IconFire.webp',
  电: '/attribute_image/IconElectric.webp',
  以太: '/attribute_image/IconEther.webp',
  物理: '/attribute_image/IconPhysical.webp',
  风: '/attribute_image/IconWind.webp',
  霜: '/attribute_image/IconFrost.webp',
  流明: '/attribute_image/IconLumen.webp',
}

export interface ElementIconItem {
  name: string
  icon: string
}

/** 解析「冰属性、以太」这类文本 → 图标列表（去重，忽略未收录属性） */
export function parseElementIcons(text: string | null | undefined): ElementIconItem[] {
  if (!text) return []
  const items: ElementIconItem[] = []
  const seen = new Set<string>()
  for (const raw of String(text).split(/[、,\s]+/)) {
    const name = raw.replace(/属性$/, '').trim()
    if (!name || seen.has(name)) continue
    const icon = ELEMENT_ICON_MAP[name]
    if (!icon) continue
    seen.add(name)
    items.push({ name, icon })
  }
  return items
}

export function elementIconPath(name: string): string | null {
  return ELEMENT_ICON_MAP[name] ?? null
}
