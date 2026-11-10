import type { RemoteZoneConfig } from '@/zones/schemeAdapter'

/** 公共只读：已启用的乘区定义与方案（失败返回 null，不影响内置链路） */
export async function fetchRuntimeZoneConfig(): Promise<RemoteZoneConfig | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1500)
  try {
    const response = await fetch('/api/calculator/zone-schemes', { signal: controller.signal })
    const body = await response.json().catch(() => null)
    if (!response.ok || !body) return null
    if (typeof body.code === 'number' && (body.code < 200 || body.code >= 300)) return null
    return (body.data ?? null) as RemoteZoneConfig | null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
