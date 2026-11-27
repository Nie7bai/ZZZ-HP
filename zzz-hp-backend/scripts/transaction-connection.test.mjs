import test from 'node:test'
import assert from 'node:assert/strict'
import pool from '../src/config/db.js'
import {
  deleteDeductionPeriod,
  reorderDeductionNodes,
} from '../src/services/deductionAdminService.js'

function createConnectionDouble({ failOnExecute = 0 } = {}) {
  const calls = []
  const rows = []
  const connection = {
    calls,
    rows,
    rolledBack: false,
    async beginTransaction() {
      calls.push('BEGIN')
    },
    async commit() {
      calls.push('COMMIT')
    },
    async rollback() {
      calls.push('ROLLBACK')
      connection.rolledBack = true
      for (const row of rows) row.persisted = false
    },
    async query(sql) {
      calls.push(sql)
      return [{ affectedRows: 0 }]
    },
    async execute(sql) {
      calls.push(sql)
      if (/DELETE FROM|UPDATE deduction_node/.test(sql)) {
        rows.push({ persisted: false })
        if (failOnExecute && rows.length === failOnExecute) {
          throw new Error('模拟批量操作中途失败')
        }
      }
      return [{ affectedRows: 1 }]
    },
    release() {},
  }
  return connection
}

async function assertUsesOneTransactionConnection(t, operation) {
  const connection = createConnectionDouble({ failOnExecute: 2 })
  t.mock.method(pool, 'getConnection', async () => connection)
  t.mock.method(pool, 'query', async () => {
    throw new Error('事务语句不得直接走连接池')
  })
  t.mock.method(pool, 'execute', async () => {
    throw new Error('事务内 SQL 不得直接走连接池')
  })

  await assert.rejects(operation, /模拟批量操作中途失败/)
  assert.ok(connection.calls.includes('ROLLBACK'))
  assert.equal(connection.rolledBack, true)
  assert.equal(connection.rows.length, 2)
  assert.ok(connection.rows.every((row) => row.persisted === false))
}

test('删除临界推演期数：三张表中途失败时在同一连接回滚', async (t) => {
  await assertUsesOneTransactionConnection(t, () => deleteDeductionPeriod('test-period'))
})

test('临界推演重排：部分更新失败后在同一连接回滚', async (t) => {
  await assertUsesOneTransactionConnection(t, () => reorderDeductionNodes('test-period', [1, 2]))
})
