/**
 * 运行时验证：招式类型多坐标匹配
 *
 * 1. 硬编码的 3 个旧公共招式小类 id 必须真实存在
 * 2. 未提供 coords 时行为与旧逻辑完全一致（向后兼容）
 * 3. 限定公共「强化特殊技」的 Buff 能命中带该类型的角色招式（旧逻辑命不中）
 *
 * 运行：node --import tsx scripts/test-skill-match-coords.mjs
 */
import { readFileSync } from 'node:fs'
import { effectMatchesContext, normalizeBuffEffect } from '../src/utils/buffEffect.ts'
import { buildSkillContextFromHit, resolveSkillPreviews } from '../src/utils/resolvedHit.ts'
import { parseCustomSkillList } from '../src/utils/skillLibrary.ts'
import {
  buildSkillMatchCoords,
  LEGACY_PUBLIC_SUBCATEGORY_ID,
  skillTypeLabelsForDisplay,
} from '../src/utils/skillTypes.ts'

const DATA = '../../zzz-hp-backend/scripts/data/zzz-hp-calculator-buffs.json'
const json = JSON.parse(readFileSync(new URL(DATA, import.meta.url), 'utf8'))
const subs = json.skillSubcategories ?? []

let failed = 0
const check = (name, actual, expected) => {
  const ok = actual === expected
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  期望 ${expected} 实际 ${actual}`}`)
}

console.log('=== 1. 公共小类 id 存在性 ===')
for (const [type, id] of Object.entries(LEGACY_PUBLIC_SUBCATEGORY_ID)) {
  const sub = subs.find((item) => String(item.id) === id)
  check(`${type} -> ${id}（${sub?.name ?? '未找到'}）`, Boolean(sub) && !sub.agentId, true)
}

const skillEffect = (targets) => ({
  id: 'eff-test',
  scope: 'skill',
  kind: 'fixed',
  stat: 'skillDmgBonus',
  value: 60,
  skillTargets: targets,
})

console.log('')
console.log('=== 2. 向后兼容：不传 coords 时同旧逻辑 ===')
const legacyCtx = { damageKind: 'direct', categoryId: 'special', subcategoryId: 'yixuan-sub-1' }
check(
  '限定 special 整类命中',
  effectMatchesContext(skillEffect([{ category: 'special', subcategoryId: null }]), legacyCtx),
  true,
)
check(
  '限定同一小类命中',
  effectMatchesContext(
    skillEffect([{ category: 'special', subcategoryId: 'yixuan-sub-1' }]),
    legacyCtx,
  ),
  true,
)
check(
  '限定别的小类不命中',
  effectMatchesContext(
    skillEffect([{ category: 'special', subcategoryId: 'yixuan-sub-2' }]),
    legacyCtx,
  ),
  false,
)
check(
  '限定别的大类不命中',
  effectMatchesContext(skillEffect([{ category: 'basic', subcategoryId: null }]), legacyCtx),
  false,
)

console.log('')
console.log('=== 3. 新架构：强化特殊技类型命中公共锚点 Buff ===')
const coords = buildSkillMatchCoords({
  skillTypes: ['specialEnhanced'],
  buffAnchorId: 'yixuan-sub-1',
  buffAnchorCategory: 'special',
})
console.log('  凝云术坐标:', JSON.stringify(coords))
const newCtx = { ...legacyCtx, coords }

check(
  '限定公共「强化特殊技」命中（旧逻辑命不中）',
  effectMatchesContext(
    skillEffect([
      { category: 'special', subcategoryId: LEGACY_PUBLIC_SUBCATEGORY_ID.specialEnhanced },
    ]),
    newCtx,
  ),
  true,
)
check(
  '限定 special 整类仍命中（蕴含 specialEnhanced ⊃ special）',
  effectMatchesContext(skillEffect([{ category: 'special', subcategoryId: null }]), newCtx),
  true,
)
check(
  '限定自身锚点仍命中',
  effectMatchesContext(
    skillEffect([{ category: 'special', subcategoryId: 'yixuan-sub-1' }]),
    newCtx,
  ),
  true,
)
check(
  '限定别人的锚点不命中',
  effectMatchesContext(
    skillEffect([{ category: 'special', subcategoryId: 'yixuan-sub-2' }]),
    newCtx,
  ),
  false,
)
check(
  '限定 basic 不命中',
  effectMatchesContext(skillEffect([{ category: 'basic', subcategoryId: null }]), newCtx),
  false,
)

console.log('')
console.log('=== 4. 冲刺攻击蕴含闪避 ===')
const dashCtx = {
  damageKind: 'direct',
  categoryId: 'dodge',
  subcategoryId: null,
  coords: buildSkillMatchCoords({ skillTypes: ['dash'] }),
}
check(
  '限定公共「冲刺攻击」命中',
  effectMatchesContext(
    skillEffect([{ category: 'dodge', subcategoryId: LEGACY_PUBLIC_SUBCATEGORY_ID.dash }]),
    dashCtx,
  ),
  true,
)
check(
  '限定 dodge 整类命中',
  effectMatchesContext(skillEffect([{ category: 'dodge', subcategoryId: null }]), dashCtx),
  true,
)
check(
  '限定公共「闪避反击」不命中',
  effectMatchesContext(
    skillEffect([{ category: 'dodge', subcategoryId: LEGACY_PUBLIC_SUBCATEGORY_ID.dodgeCounter }]),
    dashCtx,
  ),
  false,
)

console.log('')
console.log('=== 5. 异常类招式（类型与锚点均留空）不吃招式限定 Buff ===')
const anomalyCtx = {
  damageKind: 'anomaly',
  anomalySubKind: 'disorder',
  categoryId: 'basic',
  subcategoryId: null,
  coords: buildSkillMatchCoords({ skillTypes: [], buffAnchorId: null }),
}
check(
  '限定 basic 整类不再误命中（旧逻辑会命中）',
  effectMatchesContext(
    { ...skillEffect([{ category: 'basic', subcategoryId: null }]), appliesToAnomaly: true },
    anomalyCtx,
  ),
  false,
)

console.log('')
console.log('=== 6. 毁伤可与其他招式类型并存 ===')
const sharpenSkill = { id: 'normal', name: '普通段', agentId: 'sunbringer', damageType: 'sharpen', skillTypes: ['specialEnhanced'] }
const skills = parseCustomSkillList([
  sharpenSkill,
  { ...sharpenSkill, id: 'tagged', name: '毁伤段', skillTypes: ['destruction', 'specialEnhanced'] },
])
const [normalHit, taggedHit] = resolveSkillPreviews({
  slots: [{ prepared: skills.map((skill) => ({ id: skill.id, skillId: skill.id })), flow: [] }],
  teamSlots: [{ agentId: 'sunbringer' }],
  findSkill: (id) => skills.find((skill) => skill.id === id) ?? null,
  resolveAgentProfession: () => '锋御',
})
const normalContext = buildSkillContextFromHit(normalHit, '火')
const taggedContext = buildSkillContextFromHit(taggedHit, '火')
const destructionBuff = normalizeBuffEffect({
  ...skillEffect([{ category: 'destruction', subcategoryId: null }]),
  stat: 'custom:emberMarkRatio',
  value: 40,
})
check('锐化自建招式读回后保留两个标签', skillTypeLabelsForDisplay(taggedHit.skill.skillTypes).join('、'), '强化特殊技、毁伤')
check('毁伤段沿用锐化分支', taggedContext.directSubKind, 'sharpen')
check('毁伤没有占用原有招式大类', taggedContext.categoryId, 'special')
check('毁伤限定命中毁伤段', effectMatchesContext(destructionBuff, taggedContext), true)
check('毁伤限定不命中同类普通段', effectMatchesContext(destructionBuff, normalContext), false)
check(
  '毁伤段仍命中强化特殊技限定',
  effectMatchesContext(skillEffect([
    { category: 'special', subcategoryId: LEGACY_PUBLIC_SUBCATEGORY_ID.specialEnhanced },
  ]), taggedContext),
  true,
)

console.log('')
console.log(failed === 0 ? '全部通过' : `${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
