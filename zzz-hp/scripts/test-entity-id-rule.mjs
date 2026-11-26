/**
 * 计算器实体 ID 规则（角色 / 音擎 / 驱动盘 / 邦布）一致性回归。
 *
 * ID 会被当作头像文件名与 URL 路径，后端上传接口对不合规 ID 报「无效的实体 ID」。
 * 这里锁两件事：
 * 1. 前端 `calculatorEntityId.ts` 与后端 `calculatorPublicAsset.js` 的正则逐字一致；
 * 2. 保存前的友好提示能在上传前拦住中文 / 空格 / `+` / `#` 这类 ID。
 *
 * 运行：npx vite-node scripts/test-entity-id-rule.mjs
 */
import {
  CALCULATOR_ENTITY_ID_SAFE_RE,
  calculatorEntityIdError,
  isValidCalculatorEntityId,
} from '../src/utils/calculatorEntityId.ts'
import { CALCULATOR_ENTITY_ID_SAFE_RE as BACKEND_RE } from '../../zzz-hp-backend/src/utils/calculatorPublicAsset.js'

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

check(
  '前后端实体 ID 正则逐字一致',
  CALCULATOR_ENTITY_ID_SAFE_RE.source === BACKEND_RE.source &&
    CALCULATOR_ENTITY_ID_SAFE_RE.flags === BACKEND_RE.flags,
  `${CALCULATOR_ENTITY_ID_SAFE_RE} vs ${BACKEND_RE}`,
)

const VALID = ['woodpecker', 'SuitBranch&BladeSong', 'orphie&magus', 'a.b_c-1', "d'agostino"]
for (const id of VALID) {
  check(`合法 ID：${id}`, isValidCalculatorEntityId(id))
}

const INVALID = ['啄木鸟电音', 'new disc', 'Suit+Plus', 'a#1', '-leading', '_leading', '', '   ']
for (const id of INVALID) {
  check(`非法 ID：${JSON.stringify(id)}`, !isValidCalculatorEntityId(id))
}

check(
  '空 ID：提示先填 ID',
  calculatorEntityIdError('') === '请先填写 ID',
  calculatorEntityIdError(''),
)
check(
  '中文 ID：提示里写明「不能用作头像文件名」并给出允许字符',
  calculatorEntityIdError('啄木鸟电音').includes('不能用作头像文件名') &&
    calculatorEntityIdError('啄木鸟电音').includes('字母'),
  calculatorEntityIdError('啄木鸟电音'),
)
check('合法 ID 不报错', calculatorEntityIdError('woodpecker') === '')

console.log(`\n=== 结果：passed = ${passed}, failed = ${failed} ===`)
if (failed > 0) process.exit(1)
