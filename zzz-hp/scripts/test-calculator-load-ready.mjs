/**
 * 运行时验证：真实 store 成功加载后，计算器 View 进入 ready 状态
 *
 * 运行：npm run test:calculator-loading:ready
 */

import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

let failed = 0
function check(name, actual, expected) {
  const ok = actual === expected
  if (!ok) failed++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      期望 ${expected}\n      实际 ${actual}`}`,
  )
}

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
}
globalThis.document = {
  documentElement: { dataset: {} },
  body: { style: {} },
}

const [
  { createPinia, setActivePinia },
  { useCalculatorBuffStore },
  { default: CharacterCalculatorView },
] = await Promise.all([
  import('pinia'),
  import('../src/stores/calculatorBuffs.ts'),
  import('../src/views/CharacterCalculatorView.vue'),
])

const expectedUrls = [
  '/api/calculator-buffs',
  '/api/calculator-buffs/damage-event-modes',
  '/api/calculator-buffs/skills',
]
const responseDataByUrl = new Map([
  [
    expectedUrls[0],
    {
      agents: [],
      wengines: [],
      bangboos: [],
      driveDiscs: [],
      skillSubcategories: [],
      followUpSkillRules: [],
    },
  ],
  [expectedUrls[1], []],
  [expectedUrls[2], []],
])
const requestedUrls = []
globalThis.fetch = async (input) => {
  const url = String(input)
  requestedUrls.push(url)
  if (!responseDataByUrl.has(url)) throw new Error(`意外请求：${url}`)
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 200, message: 'ok', data: responseDataByUrl.get(url) }),
  }
}

const pinia = createPinia()
setActivePinia(pinia)
const store = useCalculatorBuffStore(pinia)
await store.loadAll(true)

const RouterLink = defineComponent({
  setup(_props, { attrs, slots }) {
    return () => h('a', attrs, slots.default?.())
  },
})
const app = createSSRApp(CharacterCalculatorView)
app.use(pinia)
app.component('RouterLink', RouterLink)
const html = await renderToString(app)

check('成功加载正确的三个接口', requestedUrls.join(','), expectedUrls.join(','))
check('store 标记为已加载', store.loaded, true)
check('ready 状态挂载计算器内容', html.includes('局内 Buff 增益'), true)
check('ready 状态不再显示加载提示', html.includes('正在从数据库加载计算器数据...'), false)
check('ready 状态没有错误提示', html.includes('role="alert"'), false)

console.log('')
console.log(failed === 0 ? '全部通过' : `${failed} 项失败`)
process.exitCode = failed === 0 ? 0 : 1
