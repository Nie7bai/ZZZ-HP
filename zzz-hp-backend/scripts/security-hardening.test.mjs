import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { revokeAllAdminSessions } from '../src/services/adminSessionService.js'
import { runAdminPasswordRotation } from './set-admin-password.mjs'
import {
  normalizeAvatarSourceUrl,
  resolveExistingAvatarFile,
} from '../src/utils/calculatorPublicAsset.js'
import { detectImageKind } from '../src/utils/imageMagic.js'
import { createEmptyBuffStatModifiers } from '../src/utils/calculatorBuffFields.js'
import { failInternal } from '../src/utils/response.js'

test('failInternal 生产环境不回传内部错误详情', () => {
  const makeRes = () => {
    const recorded = {}
    return {
      recorded,
      status(code) {
        recorded.code = code
        return this
      },
      json(body) {
        recorded.body = body
        return this
      },
    }
  }

  const err = new Error('sensitive database detail (ER_DUP_ENTRY)')
  const originalNodeEnv = process.env.NODE_ENV
  const originalExpose = process.env.EXPOSE_ERROR_DETAIL

  try {
    // 生产环境：message 为稳定文案，data 不携带内部详情
    process.env.NODE_ENV = 'production'
    delete process.env.EXPOSE_ERROR_DETAIL
    let res = makeRes()
    failInternal(res, err, '获取留言失败')
    assert.equal(res.recorded.code, 500)
    assert.equal(res.recorded.body.message, '获取留言失败')
    assert.equal(res.recorded.body.data, null)

    // 生产 + 显式 EXPOSE_ERROR_DETAIL=1：附带详情便于排查
    process.env.EXPOSE_ERROR_DETAIL = '1'
    res = makeRes()
    failInternal(res, err, '获取留言失败')
    assert.deepEqual(res.recorded.body.data, {
      error: 'sensitive database detail (ER_DUP_ENTRY)',
    })

    // 非生产环境：附带详情
    delete process.env.NODE_ENV
    delete process.env.EXPOSE_ERROR_DETAIL
    res = makeRes()
    failInternal(res, err, '获取留言失败')
    assert.deepEqual(res.recorded.body.data, {
      error: 'sensitive database detail (ER_DUP_ENTRY)',
    })
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
    if (originalExpose === undefined) delete process.env.EXPOSE_ERROR_DETAIL
    else process.env.EXPOSE_ERROR_DETAIL = originalExpose
  }
})

test('avatar URL 拒绝穿越与未知前缀', () => {
  assert.equal(normalizeAvatarSourceUrl('/character/foo.webp'), '/character/foo.webp')
  assert.equal(normalizeAvatarSourceUrl('/character/../.env'), null)
  assert.equal(normalizeAvatarSourceUrl('/character/%2e%2e/secret'), null)
  assert.equal(normalizeAvatarSourceUrl('/etc/passwd'), null)
  assert.equal(normalizeAvatarSourceUrl('C:\\Windows\\win.ini'), null)
  assert.equal(resolveExistingAvatarFile('/character/../../package.json'), null)
})

test('魔数识别与空 Buff factor 默认为 0', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  assert.equal(detectImageKind(png), 'png')
  assert.equal(detectImageKind(Buffer.from('not-an-image')), null)

  const empty = createEmptyBuffStatModifiers()
  assert.equal(empty.directDmgMultFactor, 0)
  assert.equal(empty.radianceMultFactor, 0)
  assert.equal(empty.specialMultFactor, 0)
})

test('批量撤销管理员会话会写入空会话存储', (t) => {
  const writes = []

  t.mock.method(fs, 'existsSync', () => true)
  t.mock.method(fs, 'writeFileSync', (...args) => writes.push(args))

  revokeAllAdminSessions()

  assert.equal(writes.length, 1)
  assert.match(writes[0][0], /admin-sessions\.json$/)
  assert.deepEqual(JSON.parse(writes[0][1]), { sessions: {} })
  assert.equal(writes[0][2], 'utf8')
})

test('密码更新成功后才撤销会话并关闭数据库连接', async () => {
  const events = []
  const connection = {
    async query() {
      events.push('query')
      return [[{ id: 7 }]]
    },
    async execute() {
      events.push('execute')
    },
    async end() {
      events.push('end')
    },
  }

  const exitCode = await runAdminPasswordRotation({
    plainPassword: ' test-password-not-a-secret ',
    environment: {},
    async createConnection() {
      events.push('connect')
      return connection
    },
    async hashPassword(password) {
      assert.equal(password, 'test-password-not-a-secret')
      events.push('hash')
      return '$2b$12$test-only-hash'
    },
    revokeSessions() {
      events.push('revoke')
    },
    logger: {
      log() {
        events.push('log')
      },
      error() {
        events.push('error')
      },
    },
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(events, ['connect', 'hash', 'query', 'execute', 'revoke', 'log', 'end'])
})

test('数据库写入失败时不撤销会话', async () => {
  let revoked = false
  const errors = []
  const connection = {
    async query() {
      return [[{ id: 7 }]]
    },
    async execute() {
      const error = new Error('sensitive database detail')
      error.code = 'ER_TEST_FAILURE'
      throw error
    },
    async end() {},
  }

  const exitCode = await runAdminPasswordRotation({
    plainPassword: 'test-password-not-a-secret',
    environment: {},
    createConnection: async () => connection,
    hashPassword: async () => '$2b$12$test-only-hash',
    revokeSessions() {
      revoked = true
    },
    logger: { log() {}, error: (message) => errors.push(message) },
  })

  assert.equal(exitCode, 1)
  assert.equal(revoked, false)
  assert.deepEqual(errors, ['设置管理员密码失败（ER_TEST_FAILURE）。'])
})

test('数据库写入后撤销失败会报告部分成功并返回失败', async () => {
  const errors = []
  let connectionClosed = false
  const connection = {
    async query() {
      return [[]]
    },
    async execute() {},
    async end() {
      connectionClosed = true
    },
  }

  const exitCode = await runAdminPasswordRotation({
    plainPassword: 'test-password-not-a-secret',
    environment: {},
    createConnection: async () => connection,
    hashPassword: async () => '$2b$12$test-only-hash',
    revokeSessions() {
      const error = new Error('sensitive filesystem detail')
      error.code = 'EACCES'
      throw error
    },
    logger: { log() {}, error: (message) => errors.push(message) },
  })

  assert.equal(exitCode, 1)
  assert.equal(connectionClosed, true)
  assert.deepEqual(errors, [
    '管理员密码已写入数据库，但撤销现有管理员会话失败（EACCES）。请保持后端停服并检查 data 目录写权限。',
  ])
})

test('命令行入口缺少 ADMIN_PASSWORD 时会失败且不会连接数据库', () => {
  const scriptPath = fileURLToPath(new URL('./set-admin-password.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: os.tmpdir(),
    env: { ...process.env, ADMIN_PASSWORD: '' },
    encoding: 'utf8',
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /请先在 .env 中设置 ADMIN_PASSWORD/)
})
