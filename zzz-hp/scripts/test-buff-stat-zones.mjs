/**
 * 管理侧乘区目录：64 项 / 3 类 / 类型约束。
 * 运行：npx vite-node scripts/test-buff-stat-zones.mjs
 */
import {
  BUFF_STAT_ZONES,
  allowedDamageTypesOf,
  anomalyStatsOfZone,
  anomalyTypeOfStat,
  buffStatZoneOf,
  isPanelStatKey,
  findBuffStatZoneById,
  statRowsForZone,
  zoneTypesOfStats,
} from '../src/utils/buffStatZones.ts'
import { BUFF_STAT_FIELDS } from '../src/utils/calculatorUi.ts'
import { ANOMALY_DAMAGE_TYPES } from '../src/utils/buffDamageTypes.ts'

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n[1] 63 项，覆盖全部 74 个字段')
check('共 64 个乘区选项', BUFF_STAT_ZONES.length === 64, `${BUFF_STAT_ZONES.length}`)
const covered = new Set()
for (const zone of BUFF_STAT_ZONES) {
  if (zone.stat) covered.add(zone.stat)
  for (const stat of Object.values(zone.statsByType ?? {})) {
    if (stat) covered.add(stat)
  }
}
check('覆盖字段数 = BUFF_STAT_FIELDS', covered.size === BUFF_STAT_FIELDS.length, `${covered.size}/${BUFF_STAT_FIELDS.length}`)
check(
  '每个字段都能反查到乘区',
  BUFF_STAT_FIELDS.every((field) => Boolean(buffStatZoneOf(field.key))),
)

console.log('\n[2] 类1 死限制')
const class1 = BUFF_STAT_ZONES.filter((zone) => zone.tier === 1)
check('类1 共 4 项', class1.length === 4)
const pierce = findBuffStatZoneById('zone:pierceDmgBonus')
const sharpen = findBuffStatZoneById('zone:sharpenDmgBonus')
const mutation = findBuffStatZoneById('zone:mutationCoeff')
check('贯穿增伤锁命破', pierce?.label === '贯穿增伤' && pierce?.lockedTypes?.join(',') === 'pierce')
check('锐化伤害提升锁锋御', sharpen?.label === '锐化伤害提升' && sharpen?.lockedTypes?.join(',') === 'sharpen')
check(
  '异化系数锁异常 5 项',
  mutation?.lockedTypes?.length === 5 &&
    ANOMALY_DAMAGE_TYPES.every((type) => mutation?.lockedTypes?.includes(type)),
)
const imbue = findBuffStatZoneById('zone:imbueDmgBonus')
check(
  '浸染增伤锁直伤三项',
  imbue?.label === '浸染增伤' &&
    imbue?.lockedTypes?.join(',') === 'normal,pierce,sharpen',
)
check('类1 不允许改类型（allowed 与 locked 一致）', allowedDamageTypesOf(pierce).join(',') === 'pierce')

console.log('\n[3] 类2 部分限制')
const class2 = BUFF_STAT_ZONES.filter((zone) => zone.tier === 2)
check('类2 共 3 项', class2.length === 3)
check(
  '类2 名称',
  class2.map((zone) => zone.label).join(',') === '异常类增伤,异常类暴击率,异常类爆伤',
)
const dmgZone = findBuffStatZoneById('zone:anomalyDmg')
check('异常类增伤 5 落点', anomalyStatsOfZone(dmgZone).length === 5)
check(
  '异常类增伤只允许异常 5 项（直伤 3 项禁用）',
  allowedDamageTypesOf(dmgZone).join(',') === ANOMALY_DAMAGE_TYPES.join(','),
)
const rowsAll = statRowsForZone(dmgZone, [])
check('类2 空选择 = 全部 5 条', rowsAll.length === 5)
const rowsTwo = statRowsForZone(dmgZone, ['attributeAnomaly', 'disorder'])
check(
  '类2 勾 2 类 = 2 条（字段正确）',
  rowsTwo.length === 2 &&
    rowsTwo[0].stat === 'attributeAnomalyDmgBonus' &&
    rowsTwo[1].stat === 'disorderDmgBonus',
)
check(
  '类2 反推类型',
  zoneTypesOfStats(dmgZone, ['attributeAnomalyDmgBonus', 'disorderDmgBonus']).join(',') ===
    'attributeAnomaly,disorder',
)

console.log('\n[4] 类3 都可选；不改字段')
const class3 = BUFF_STAT_ZONES.filter((zone) => zone.tier === 3)
check('类3 共 57 项', class3.length === 57, `${class3.length}`)
check(
  '异常掌控（固定）带「（数值）」',
  findBuffStatZoneById('zone:anomalyControl')?.label === '异常掌控（数值）',
)
check(
  '异常掌控（百分比）带「%」',
  findBuffStatZoneById('zone:anomalyControlPercent')?.label === '异常掌控%',
)
check('类3 允许全部 8 项', allowedDamageTypesOf(class3[0]).length === 8)
check('锐爆伤害加成仍是类3 独立项', findBuffStatZoneById('zone:sharpenCritDmgBonus')?.tier === 3)
check(
  '锐爆伤害加成保留原名',
  findBuffStatZoneById('zone:sharpenCritDmgBonus')?.label === '锐爆伤害加成',
)
check(
  '类3 勾类型仍只 1 条',
  statRowsForZone(findBuffStatZoneById('zone:atk'), ['pierce', 'normal']).length === 1,
)

console.log('\n[5] 子类字段反查')
check('attributeAnomalyDmgBonus → 属性异常', anomalyTypeOfStat('attributeAnomalyDmgBonus') === 'attributeAnomaly')
check('anomalyReleaseCritDmg → 异放', anomalyTypeOfStat('anomalyReleaseCritDmg') === 'anomalyRelease')
check('普通 stat 无子类类型', anomalyTypeOfStat('atk') === null)
check('异放增伤已折叠（不是独立乘区 id）', !findBuffStatZoneById('zone:anomalyReleaseDmgBonus'))

console.log('\n[6] 附加伤害来源属性只认面板字段')
check('isPanelStatKey：hp / mastery 是面板字段', isPanelStatKey('hp') && isPanelStatKey('mastery'))
check(
  'isPanelStatKey：局外生命值 / 紊乱失衡易伤下限不是面板字段',
  !isPanelStatKey('externalHpPercent') && !isPanelStatKey('disorderStaggerFloor'),
)

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
