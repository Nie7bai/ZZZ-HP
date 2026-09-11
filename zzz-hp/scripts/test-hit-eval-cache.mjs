/**
 * 招式结算记忆表（`utils/hitEvalCache.ts`）的守卫测试。
 *
 * 这张表是「按输入分键」的：键漏掉任何一个影响结果的字段，就会命中过期结果 ——
 * 数字看着像对的但是错的，且不会有任何报错。所以这里逐字段验证**键会随输入变化**。
 *
 * 运行：npx vite-node scripts/test-hit-eval-cache.mjs
 */
import {
  buildHitEvalContextSignature,
  buildHitEvalFingerprint,
  clearHitEvalCache,
  hitEvalCacheDebugStats,
  hitEvalCacheKey,
  internHitEvalContext,
  readHitEvalCache,
  writeHitEvalCache,
} from '../src/utils/hitEvalCache.ts'

let passed = 0
let failed = 0

function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}

const baseHit = {
  id: 'flow-1',
  ownerAgentId: 'velina',
  anomalyPowerAgentId: 'piper',
  triggerAgentId: 'remiel',
  count: 3,
  staggerPhase: 'stagger',
  critMode: 'expected',
  anomalySubKind: 'anomaly',
  coords: [],
  isFollowUp: false,
  multOverrides: null,
  panelMods: null,
  effectiveBaseMult: 100,
  skillTalentLevel: 12,
  skill: {
    id: 'dev-1',
    name: '测试招式',
    damageType: 'anomaly',
    baseMult: 100,
    skillTypes: [],
    buffAnchorId: null,
    baseMultFactor: 100,
    settlementMult: 0,
  },
}

const basePanel = { hp: 10000, atk: 2000, critRate: 50, critDmg: 100, mastery: 100 }

console.log('== 招式指纹 ==')
{
  const a = buildHitEvalFingerprint(baseHit)
  const b = buildHitEvalFingerprint({ ...baseHit })
  check('同一招式 → 指纹相同', a === b)

  const changed = [
    ['count', { count: 4 }],
    ['ownerAgentId', { ownerAgentId: 'piper' }],
    ['anomalyPowerAgentId', { anomalyPowerAgentId: 'velina' }],
    ['triggerAgentId', { triggerAgentId: 'velina' }],
    ['staggerPhase', { staggerPhase: 'normal' }],
    ['critMode', { critMode: 'crit' }],
    ['anomalySubKind', { anomalySubKind: 'disorder' }],
    ['effectiveBaseMult', { effectiveBaseMult: 101 }],
    ['skillTalentLevel', { skillTalentLevel: 11 }],
    ['multOverrides', { multOverrides: { directDmgMult: 1 } }],
    ['panelMods', { panelMods: { dmgBonus: 1 } }],
    ['skill.id', { skill: { ...baseHit.skill, id: 'dev-2' } }],
    ['skill.damageType', { skill: { ...baseHit.skill, damageType: 'direct' } }],
    ['skill.baseMult', { skill: { ...baseHit.skill, baseMult: 101 } }],
    ['skill.baseMultFactor', { skill: { ...baseHit.skill, baseMultFactor: 101 } }],
    ['skill.settlementMult', { skill: { ...baseHit.skill, settlementMult: 1 } }],
    ['skill.buffAnchorId', { skill: { ...baseHit.skill, buffAnchorId: 'x' } }],
    ['skill.skillTypes', { skill: { ...baseHit.skill, skillTypes: ['ultimate'] } }],
    ['hit.id', { id: 'flow-2' }],
  ]
  for (const [label, patch] of changed) {
    check(`改 ${label} → 指纹变化`, buildHitEvalFingerprint({ ...baseHit, ...patch }) !== a)
  }
}

console.log('== 键：招式 + 上下文 + 面板 + 是否带明细 ==')
{
  const fp = buildHitEvalFingerprint(baseHit)
  const ctxSig = internHitEvalContext('ctx-A')
  const key = hitEvalCacheKey(fp, ctxSig, basePanel, false)

  check('同输入 → 同键', hitEvalCacheKey(fp, ctxSig, { ...basePanel }, false) === key)
  check(
    '换主 C 面板 → 键不同（这就是「用哪份面板」那根轴）',
    hitEvalCacheKey(fp, ctxSig, { ...basePanel, atk: 2001 }, false) !== key,
  )
  check(
    '上下文签名不同 → 键不同',
    hitEvalCacheKey(fp, internHitEvalContext('ctx-B'), basePanel, false) !== key,
  )
  check(
    '同一份上下文 → 同一令牌（两个消费者必须拿到同一个）',
    internHitEvalContext('ctx-A') === ctxSig,
  )
  check(
    '同招式同面板、一个要明细一个不要 → 键不同',
    hitEvalCacheKey(fp, ctxSig, basePanel, true) !== key,
  )
}

console.log('== 表读写与容量 ==')
{
  clearHitEvalCache()
  const fp = buildHitEvalFingerprint(baseHit)
  const key = hitEvalCacheKey(fp, internHitEvalContext('ctx-A'), basePanel, false)
  const entry = { hitId: baseHit.id, perHit: 10, total: 30, result: { ok: true } }

  check('未写入时读不到', readHitEvalCache(key) === null)
  writeHitEvalCache(key, entry)
  check('写入后读到同一条', readHitEvalCache(key) === entry)

  const before = hitEvalCacheDebugStats()
  check('命中计数 +1', before.hits === 1 && before.misses === 1, JSON.stringify(before))

  clearHitEvalCache()
  check('清空后读不到', readHitEvalCache(key) === null)
  check('清空后计数归零', hitEvalCacheDebugStats().size === 0)

  // 容量上限：超限后最早写入的被淘汰，最新写入的还在
  const limit = hitEvalCacheDebugStats().limit
  for (let i = 0; i < limit + 10; i += 1) {
    writeHitEvalCache(`k-${i}`, { hitId: `h-${i}`, perHit: i, total: i, result: {} })
  }
  check('条目数不超过上限', hitEvalCacheDebugStats().size === limit)
  check('最早的已被淘汰', readHitEvalCache('k-0') === null)
  check('最新的仍在', readHitEvalCache(`k-${limit + 9}`) != null)
  clearHitEvalCache()
}

console.log('== 令牌表：同内容必须得到同令牌 ==')
{
  const a = internHitEvalContext('sig-1')
  const b = internHitEvalContext('sig-1')
  const c = internHitEvalContext('sig-2')
  check('同签名 → 同令牌（两个消费者靠这个共用同一行）', a === b)
  check('不同签名 → 不同令牌', a !== c)
}

console.log('')
console.log(`结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
