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
  流明: '/attribute_image/IconLumen.webp',
}

/** 弱点/抗性可选属性（与临界推演 chip 一致） */
export const TRAIT_ELEMENTS = ['冰', '火', '电', '以太', '物理', '风', '流明'] as const

export type TraitElement = (typeof TRAIT_ELEMENTS)[number]

export interface ElementIconItem {
  name: string
  icon: string
}

export function normalizeTraitElementName(raw: string): string {
  return String(raw ?? '')
    .replace(/属性$/, '')
    .trim()
}

export function splitTraitElements(value: string | string[] | null | undefined): string[] {
  if (value == null) return []
  const parts = Array.isArray(value) ? value : String(value).split(/[、,\s]+/)
  const seen = new Set<string>()
  const list: string[] = []
  for (const part of parts) {
    const name = normalizeTraitElementName(part)
    if (!name || seen.has(name)) continue
    seen.add(name)
    list.push(name)
  }
  return list
}

export function joinTraitElements(list: string[]): string {
  return [...new Set(list.map(normalizeTraitElementName).filter(Boolean))].join('、')
}

export function toggleTraitElement(list: string[], el: string): string[] {
  return list.includes(el) ? list.filter((item) => item !== el) : [...list, el]
}

/** 解析「冰属性、以太」这类文本 → 图标列表（去重，忽略未收录属性） */
export function parseElementIcons(
  text: string | string[] | null | undefined,
): ElementIconItem[] {
  const items: ElementIconItem[] = []
  const seen = new Set<string>()
  for (const name of splitTraitElements(text)) {
    if (seen.has(name)) continue
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

export function hasElementIcons(text: string | string[] | null | undefined): boolean {
  return parseElementIcons(text).length > 0
}
