export interface ChangelogEntry {
  id: number
  version: string
  title: string
  content: string
  publishedAt: string
  createdAt?: string
  updatedAt?: string
}

export interface ChangelogPayload {
  version: string
  title: string
  content: string
  publishedAt?: string | null
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const json = (await response.json()) as ApiResponse<T>
  if (!response.ok || json.code !== 200) {
    throw new Error(json.message || `请求失败: ${response.status}`)
  }
  return json.data
}

export async function fetchChangelogs(): Promise<ChangelogEntry[]> {
  return requestJson<ChangelogEntry[]>('/api/changelog')
}

export async function createChangelog(payload: ChangelogPayload): Promise<ChangelogEntry> {
  return requestJson<ChangelogEntry>('/api/changelog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function updateChangelog(
  id: number,
  payload: ChangelogPayload,
): Promise<ChangelogEntry> {
  return requestJson<ChangelogEntry>(`/api/changelog/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function deleteChangelog(id: number): Promise<void> {
  await requestJson<{ id: number }>(`/api/changelog/${id}`, {
    method: 'DELETE',
  })
}
