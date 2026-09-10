/**
 * 运行时验证：旧全局事件模式库 → 全局自定义招式库
 *
 * 运行：npm run test:skill-migration
 */

// 必须在导入被测模块前装好 localStorage 桩
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { migrateLegacyModesToSkills, loadCustomSkills, isLegacyModeMigrationDone } = await import(
  '../src/utils/skillLibrary.ts'
)
const { LEGACY_PUBLIC_SUBCATEGORY_ID } = await import('../src/utils/skillTypes.ts')
const { buildSkillMatchCoords } = await import('../src/utils/skillTypes.ts')

let failed = 0
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      期望 ${e}\n      实际 ${a}`}`)
}

const subcategories = [
  { id: 'all-special-ms0fcqv7', agentId: '', categoryId: 'special', name: '强化特殊技' },
  { id: 'yixuan-special-1', agentId: 'yixuan', categoryId: 'special', name: '强化特殊技：凝云术' },
]

const event = (over) => ({
  id: 'evt-1',
  kind: 'direct',
  categoryId: 'special',
  skillSubcategoryId: null,
  count: 3,
  staggerPhase: 'stagger',
  critMode: 'fullCrit',
  ownerAgentId: null,
  triggerAgentId: null,
  multOverrides: null,
  ...over,
})

const mode = (events, over) => ({
  id: 'custom-1',
  agentId: 'yixuan',
  teamKey: '',
  name: '仪玄循环',
  modeType: 'direct',
  events,
  ...over,
})

const run = (modes) => {
  store.clear()
  store.set('zzz-hp-custom-damage-event-modes', JSON.stringify(modes))
  const result = migrateLegacyModesToSkills({ subcategories })
  return { result, skills: loadCustomSkills() }
}

console.log('=== 1. 选了公共小类 = 其实在选类型，还原成类型而非锚点 ===')
{
  const { skills } = run([
    mode([
      event({ id: 'e1', skillSubcategoryId: LEGACY_PUBLIC_SUBCATEGORY_ID.specialEnhanced }),
    ]),
  ])
  check('招式类型', skills[0]?.skillTypes, ['specialEnhanced'])
  check('增益锚点为空', skills[0]?.buffAnchorId, null)
  check('名称取小类名', skills[0]?.name, '强化特殊技')
}

console.log('')
console.log('=== 2. 角色小类 → 增益锚点，类型取旧大类 ===')
{
  const { skills } = run([mode([event({ id: 'e2', skillSubcategoryId: 'yixuan-special-1' })])])
  check('招式类型', skills[0]?.skillTypes, ['special'])
  check('增益锚点', skills[0]?.buffAnchorId, 'yixuan-special-1')
  check('名称', skills[0]?.name, '强化特殊技：凝云术')
}

console.log('')
console.log('=== 3. 异常类：类型与锚点均留空 ===')
{
  const { skills } = run([
    mode([event({ id: 'e3', kind: 'disorder', skillBound: false, skillSubcategoryId: null })], {
      modeType: 'anomaly',
    }),
  ])
  check('招式类型为空', skills[0]?.skillTypes, [])
  check('锚点为空', skills[0]?.buffAnchorId, null)
  check('伤害类型', skills[0]?.damageType, 'disorder')
  check('名称回落伤害类型', skills[0]?.name, '紊乱')
}

console.log('')
console.log('=== 4. multOverrides 按 kind 取对应字段作基础倍率 ===')
{
  const { skills } = run([
    mode([
      event({ id: 'e4a', kind: 'direct', multOverrides: { directDmgMult: 320, anomalyMult: 999 } }),
      event({
        id: 'e4b',
        kind: 'disorder',
        skillBound: false,
        multOverrides: { disorderBaseMult: 450, directDmgMult: 111 },
      }),
      event({
        id: 'e4c',
        kind: 'radiance',
        skillBound: false,
        multOverrides: { radianceMult: 700 },
      }),
    ]),
  ])
  check('直伤取 directDmgMult', skills.find((s) => s.id === 'skill-mig-e4a')?.baseMult, 320)
  check('紊乱取 disorderBaseMult', skills.find((s) => s.id === 'skill-mig-e4b')?.baseMult, 450)
  check('耀变取 radianceMult', skills.find((s) => s.id === 'skill-mig-e4c')?.baseMult, 700)
}

console.log('')
console.log('=== 5. 归属：ownerAgentId 优先于 mode.agentId ===')
{
  const { skills } = run([
    mode([
      event({ id: 'e5a' }),
      event({ id: 'e5b', ownerAgentId: 'zhuyuan', multOverrides: { directDmgMult: 200 } }),
    ]),
  ])
  check('无 owner 时用 mode.agentId', skills.find((s) => s.id === 'skill-mig-e5a')?.agentId, 'yixuan')
  check('有 owner 时用 owner', skills.find((s) => s.id === 'skill-mig-e5b')?.agentId, 'zhuyuan')
}

console.log('')
console.log('=== 6. 去重：多套模式里的相同招式合并 ===')
{
  const { result, skills } = run([
    mode([event({ id: 'e6a', multOverrides: { directDmgMult: 300 } })], { id: 'custom-a' }),
    mode([event({ id: 'e6b', multOverrides: { directDmgMult: 300 } })], { id: 'custom-b' }),
    mode([event({ id: 'e6c', multOverrides: { directDmgMult: 500 } })], { id: 'custom-c' }),
  ])
  check('新增 2 条', result.added, 2)
  check('合并 1 条', result.merged, 1)
  check('库内共 2 条', skills.length, 2)
}

console.log('')
console.log('=== 7. 编排信息一律丢弃 ===')
{
  const { skills } = run([mode([event({ id: 'e7', count: 9, critMode: 'fullCrit' })])])
  const keys = Object.keys(skills[0] ?? {}).sort()
  check(
    '招式上不含 count / staggerPhase / critMode',
    keys.filter((k) => ['count', 'staggerPhase', 'critMode', 'triggerAgentId'].includes(k)),
    [],
  )
}

console.log('')
console.log('=== 8. 幂等：标记已迁移后不再重复 ===')
{
  const { skills } = run([mode([event({ id: 'e8' })])])
  check('首次迁移 1 条', skills.length, 1)
  check('标记已置位', isLegacyModeMigrationDone(), true)
  const again = migrateLegacyModesToSkills({ subcategories })
  check('再次调用无新增', again.added, 0)
  check('库内仍 1 条', loadCustomSkills().length, 1)
}

console.log('')
console.log('=== 9. 异常类不带招式类型；锚点保留（供「限定某一招」的 Buff 识别） ===')
{
  /**
   * 本组期望在 2026-08-16（6da0596）随机制更新：
   * 锚点从「一律丢弃」改为「保留」，因为同批引入了 `appliesToAnomaly` ——
   * 招式限定 Buff 是否作用于异常伤害由它决定（`buffEffect.shouldApplyEffect`：
   * scope=skill 且 damageKind=anomaly 时须 `appliesToAnomaly === true` 才命中）。
   * 若这里把锚点丢掉，管理员为异常伤害配的招式限定增益将永远无法命中
   * （后端 `fix-skill-anomaly-applies.mjs` 正是在给这类固有异常乘区补该标记）。
   * 招式类型仍然为空：异常伤害不吃「按类型」的限定。
   */
  const { skills } = run([
    mode(
      [
        event({
          id: 'e9',
          kind: 'anomalyRelease',
          skillBound: true,
          categoryId: 'special',
          skillSubcategoryId: 'yixuan-special-1',
        }),
      ],
      { modeType: 'anomaly' },
    ),
  ])
  check('招式类型为空', skills[0]?.skillTypes, [])
  check('锚点保留（供招式限定 Buff 识别）', skills[0]?.buffAnchorId, 'yixuan-special-1')
  check('名称仍可用小类名识别', skills[0]?.name, '强化特殊技：凝云术')
  check('伤害类型保留', skills[0]?.damageType, 'anomalyRelease')
  // 锚点必须真的能产出匹配坐标，否则「保留」没有意义。
  // 与真实调用方一致：`resolvedHit.ts` 会从旧小类记录取 categoryId 一并传入。
  const coords = buildSkillMatchCoords({
    skillTypes: skills[0]?.skillTypes,
    buffAnchorId: skills[0]?.buffAnchorId,
    buffAnchorCategory: 'special',
  })
  check(
    '锚点产出招式限定坐标',
    coords,
    [{ category: 'special', subcategoryId: 'yixuan-special-1' }],
  )
}

console.log('')
console.log('=== 10. 不改用户已有自定义招式的名字 ===')
{
  store.clear()
  store.set(
    'zzz-hp-skill-library-custom',
    JSON.stringify([
      {
        id: 'mine-1',
        name: '紊乱',
        agentId: 'yixuan',
        source: 'custom',
        damageType: 'disorder',
        skillTypes: [],
        buffAnchorId: null,
        baseMult: 1,
      },
    ]),
  )
  store.set(
    'zzz-hp-custom-damage-event-modes',
    JSON.stringify([mode([event({ id: 'e10', kind: 'disorder', skillBound: false })], { modeType: 'anomaly' })]),
  )
  migrateLegacyModesToSkills({ subcategories })
  const skills = loadCustomSkills()
  check(
    '原有名字不动',
    skills.find((s) => s.id === 'mine-1')?.name,
    '紊乱',
  )
  check(
    '新迁入的同名加序号',
    skills.find((s) => s.id === 'skill-mig-e10')?.name,
    '紊乱 2',
  )
}

console.log('')
console.log(failed === 0 ? '全部通过' : `${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
