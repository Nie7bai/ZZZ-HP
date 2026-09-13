/**
 * 官方预设词条库：鉴权接线。
 *
 * 用户口径（2026-09-12）：「管理员(或开发者)能改，**用户改不了**」。
 * 用户改不了靠的不是界面藏按钮，而是这些写接口一律 `requireAdmin` ——
 * 所以这里钉住接线本身：谁把 `requireAdmin` 摘掉，这里必须红。
 *
 * 读接口必须**公开**（进计算页就要拿官方预设，不能要求登录）。
 *
 * 写入口四个（2026-09-13 起）：整份替换一套方案、新建方案、重命名方案、删除方案。
 * 管理页是「草稿 + 保存」，保存＝整份替换，所以逐条的 entries / groups 写接口已删除 ——
 * 留在这里的清单要跟着代码走，少一个都不行。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { requireAdmin } from '../src/middleware/requireAdmin.js'
import affixPresetRoutes from '../src/routes/affixPresetRoutes.js'

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

test('官方预设：读接口公开（首个中间件是控制器，不是鉴权）', () => {
  const handlers = getRouteHandlers(affixPresetRoutes, 'get', '/')
  assert.equal(handlers.length, 1, 'GET / 应当只有控制器，不挂任何鉴权')
  assert.notEqual(handlers[0], requireAdmin)
})

test('官方预设：全部写接口首中间件必须是 requireAdmin', () => {
  const writeRoutes = [
    ['put', '/'],
    ['post', '/schemes'],
    ['patch', '/schemes/:name'],
    ['delete', '/schemes/:name'],
  ]
  for (const [method, path] of writeRoutes) {
    const handlers = getRouteHandlers(affixPresetRoutes, method, path)
    assert.equal(
      handlers[0],
      requireAdmin,
      `${method.toUpperCase()} ${path} 的首个中间件应为 requireAdmin`,
    )
    assert.ok(handlers.length >= 2, `${method.toUpperCase()} ${path} 缺少控制器`)
  }
})

test('官方预设：逐条写接口已删除（保存＝整份替换，不给半份状态留口子）', () => {
  const removed = [
    ['put', '/entries'],
    ['delete', '/entries/:id'],
    ['put', '/groups'],
    ['delete', '/groups/:name'],
  ]
  for (const [method, path] of removed) {
    const layer = affixPresetRoutes.stack.find(
      (entry) => entry.route && entry.route.path === path && Boolean(entry.route.methods[method]),
    )
    assert.equal(
      layer,
      undefined,
      `${method.toUpperCase()} ${path} 应当已删除：管理页的保存是整份替换`,
    )
  }
})
