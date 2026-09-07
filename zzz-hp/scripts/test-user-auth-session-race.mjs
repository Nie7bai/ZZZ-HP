// Run: npx vite-node scripts/test-user-auth-session-race.mjs
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useUserAuthStore } from '../src/stores/userAuth'

const originalFetch = globalThis.fetch
const storedValues = new Map()
const storage = {
  getItem: (key) => storedValues.get(key) ?? null,
  setItem: (key, value) => storedValues.set(key, String(value)),
  removeItem: (key) => storedValues.delete(key),
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })

const userA = { id: 1, nickname: 'Account A', mihoyoAid: 'a' }
const userB = { id: 2, nickname: 'Account B', mihoyoAid: 'b' }
/** @type {Map<string, Array<(value: Response) => void>>} */
const pendingMe = new Map()

globalThis.fetch = async (input, init) => {
  assert.equal(String(input), '/api/auth/me')
  const authHeader = new Headers(init?.headers).get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  return new Promise((resolve) => {
    const queue = pendingMe.get(token) ?? []
    queue.push(resolve)
    pendingMe.set(token, queue)
  })
}

function resolveMe(token, body, status = 200) {
  const queue = pendingMe.get(token)
  assert.ok(queue?.length, `missing pending /me for ${token}`)
  const resolve = queue.shift()
  resolve(
    Response.json(
      status === 200 ? { code: 200, data: body } : { code: status, message: '未登录', data: null },
      { status },
    ),
  )
}

try {
  setActivePinia(createPinia())
  const auth = useUserAuthStore()

  // A 的 refreshMe 尚未返回时切到 B；A 成功回包不得覆盖 B
  auth.setSession('token-A', userA)
  const refreshA = auth.refreshMe()
  const switchToB = auth.switchAccount({ token: 'token-B', userId: 2, nickname: userB.nickname })
  resolveMe('token-B', userB)
  await switchToB
  resolveMe('token-A', userA)
  const late = await refreshA
  assert.equal(late?.id, 1)
  assert.equal(auth.token, 'token-B')
  assert.equal(auth.user?.id, 2)
  assert.equal(storage.getItem('zzz-hp-user-token'), 'token-B')
  const saved = JSON.parse(storage.getItem('zzz-hp-saved-accounts') || '[]')
  assert.ok(saved.some((item) => item.token === 'token-B' && item.userId === 2))
  assert.ok(!saved.some((item) => item.token === 'token-B' && item.userId === 1))

  // A 的 401 迟到不得清掉已切换的 B
  auth.setSession('token-A', userA)
  const failA = auth.refreshMe().then(
    () => ({ ok: true }),
    (error) => ({ error }),
  )
  const switchAgain = auth.switchAccount({ token: 'token-B', userId: 2, nickname: userB.nickname })
  resolveMe('token-B', userB)
  await switchAgain
  resolveMe('token-A', null, 401)
  const failed = await failA
  assert.ok(failed.error)
  assert.equal(auth.token, 'token-B')
  assert.equal(auth.user?.id, 2)
  assert.equal(storage.getItem('zzz-hp-user-token'), 'token-B')

  console.log('test-user-auth-session-race: ok')
} finally {
  globalThis.fetch = originalFetch
}
