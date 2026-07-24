interface ApiResult<T> {
  code: number
  message: string
  data: T
  error?: string
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiResult<T>
  const isSuccessCode = body.code >= 200 && body.code < 300
  if (!response.ok || !isSuccessCode) {
    throw new Error(body.message || '请求失败')
  }
  return body.data
}

export async function loginAdmin(password: string) {
  const response = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  return parseResponse<{ authenticated: boolean; token?: string }>(response)
}
