/**
 * 鉴权接线敏感度：消融 requireUser / requireAdmin 后必须红，不能只靠「行为单元」绿过门禁。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { requireAdmin } from '../src/middleware/requireAdmin.js'
import { requireUser } from '../src/middleware/requireUser.js'
import uploadRoutes from '../src/routes/uploadRoutes.js'
import buffRoutes from '../src/routes/buffRoutes.js'
import bossRoutes from '../src/routes/bossRoutes.js'
import changelogRoutes from '../src/routes/changelogRoutes.js'
import seasonContentRoutes from '../src/routes/seasonContentRoutes.js'
import deductionAdminRoutes from '../src/routes/deductionAdminRoutes.js'

function getRouteLayer(router, method, path) {
  const layer = router.stack.find(
    (entry) => entry.route && entry.route.path === path && Boolean(entry.route.methods[method]),
  )
  assert.ok(layer, `缺少路由 ${method.toUpperCase()} ${path}`)
  return layer.route
}

function getRouteHandlers(router, method, path) {
  return getRouteLayer(router, method, path).stack.map((layer) => layer.handle)
}

function assertFirstHandler(router, method, path, expected) {
  const handlers = getRouteHandlers(router, method, path)
  assert.equal(
    handlers[0],
    expected,
    `${method.toUpperCase()} ${path} 的首个中间件应为 ${expected.name || 'expected'}`,
  )
  return handlers
}

function makeRes() {
  return {
    code: undefined,
    body: undefined,
    status(code) {
      this.code = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
}

test('留言板上传：requireUser 必须在 Multer 之前', () => {
  const handlers = assertFirstHandler(uploadRoutes, 'post', '/guestbook', requireUser)
  assert.ok(handlers.length >= 3, '期望 requireUser → Multer → 错误处理 → 控制器')
  assert.notEqual(handlers[1], requireUser)
  assert.notEqual(handlers[1], requireAdmin)
})

test('管理端图片上传路由首中间件必须是 requireAdmin', () => {
  for (const path of ['/boss', '/buff', '/calculator', '/calculator-public']) {
    assertFirstHandler(uploadRoutes, 'post', path, requireAdmin)
  }
  assertFirstHandler(uploadRoutes, 'post', '/calculator-public/ensure', requireAdmin)
})

test('若干写接口首中间件必须是 requireAdmin', () => {
  assertFirstHandler(buffRoutes, 'post', '/', requireAdmin)
  assertFirstHandler(buffRoutes, 'delete', '/:id', requireAdmin)
  assertFirstHandler(buffRoutes, 'get', '/export', requireAdmin)
  assertFirstHandler(buffRoutes, 'post', '/import', requireAdmin)

  assertFirstHandler(bossRoutes, 'post', '/', requireAdmin)
  assertFirstHandler(bossRoutes, 'delete', '/:id', requireAdmin)

  assertFirstHandler(changelogRoutes, 'post', '/', requireAdmin)
  assertFirstHandler(changelogRoutes, 'put', '/:id', requireAdmin)
  assertFirstHandler(changelogRoutes, 'delete', '/:id', requireAdmin)

  assertFirstHandler(seasonContentRoutes, 'post', '/preview', requireAdmin)
  assertFirstHandler(seasonContentRoutes, 'post', '/soft-delete', requireAdmin)
  assertFirstHandler(seasonContentRoutes, 'post', '/purge', requireAdmin)
})

test('deductionAdmin 整组挂载 requireAdmin', () => {
  const layer = deductionAdminRoutes.stack.find(
    (entry) => !entry.route && entry.handle === requireAdmin,
  )
  assert.ok(layer, 'deductionAdminRoutes 应 router.use(requireAdmin)')
})

test('requireUser 无 Bearer 时返回 401 且不 next', async () => {
  const res = makeRes()
  let nextCalled = false
  await requireUser({ headers: {} }, res, () => {
    nextCalled = true
  })
  assert.equal(res.code, 401)
  assert.match(String(res.body?.message ?? ''), /未登录/)
  assert.equal(nextCalled, false)
})

test('requireAdmin 无有效会话时返回 401 且不 next', () => {
  const res = makeRes()
  let nextCalled = false
  requireAdmin({ headers: {} }, res, () => {
    nextCalled = true
  })
  assert.equal(res.code, 401)
  assert.equal(res.body?.data?.code, 'ADMIN_AUTH_REQUIRED')
  assert.equal(nextCalled, false)
})
