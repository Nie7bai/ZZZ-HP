/**
 * 运行时验证：计算器加载状态与页面重试接线
 *
 * 运行：npm run test:calculator-loading
 */

import { createRenderer, defineComponent, h, markRaw, nextTick } from 'vue'

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
const documentBody = { type: 'body', style: {} }
globalThis.document = {
  documentElement: { dataset: {} },
  body: documentBody,
  activeElement: documentBody,
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

function createNode(type, text = '') {
  const node = markRaw({ type, text, props: {}, style: {}, children: [], parent: null })
  node.focus = () => {
    globalThis.document.activeElement = node
  }
  return node
}

function containsNode(root, target) {
  return root === target || root.children.some((child) => containsNode(child, target))
}

function insert(child, parent, anchor = null) {
  if (child.parent) remove(child)
  child.parent = parent
  const index = anchor ? parent.children.indexOf(anchor) : -1
  if (index < 0) parent.children.push(child)
  else parent.children.splice(index, 0, child)
}

function remove(child) {
  if (!child.parent) return
  if (containsNode(child, globalThis.document.activeElement)) {
    globalThis.document.activeElement = globalThis.document.body
  }
  const index = child.parent.children.indexOf(child)
  if (index >= 0) child.parent.children.splice(index, 1)
  child.parent = null
}

const renderer = createRenderer({
  patchProp(element, key, _previousValue, nextValue) {
    if (nextValue == null) delete element.props[key]
    else element.props[key] = nextValue
  },
  insert,
  remove,
  createElement: (type) => createNode(type),
  createText: (text) => createNode('#text', text),
  createComment: (text) => createNode('#comment', text),
  setText: (node, text) => {
    node.text = text
  },
  setElementText(element, text) {
    element.children = []
    element.text = text
  },
  parentNode: (node) => node.parent,
  nextSibling(node) {
    const index = node.parent?.children.indexOf(node) ?? -1
    return index < 0 ? null : (node.parent.children[index + 1] ?? null)
  },
  setScopeId: () => {},
  insertStaticContent(content, parent, anchor) {
    const node = createNode('#static', content)
    insert(node, parent, anchor)
    return [node, node]
  },
})

function findNode(node, predicate) {
  if (predicate(node)) return node
  for (const child of node.children) {
    const match = findNode(child, predicate)
    if (match) return match
  }
  return null
}

function renderedText(node) {
  return [node?.text, ...(node?.children ?? []).map(renderedText)]
    .filter(Boolean)
    .join(' ')
    .trim()
    .replace(/\s+/g, ' ')
}

const pinia = createPinia()
setActivePinia(pinia)
const store = useCalculatorBuffStore(pinia)
store.loading = false
store.loaded = false
store.error = ''

let requestCount = 0
let rejectRequest
const failureMessages = ['首次加载失败', '重试仍然失败', '再次重试失败', '点击空白处后失败']
globalThis.fetch = () => {
  const message = failureMessages[requestCount] ?? '加载失败'
  requestCount++
  return new Promise((_resolve, reject) => {
    rejectRequest = () => reject(new Error(message))
  })
}

const RouterLink = defineComponent({
  setup(_props, { attrs, slots }) {
    return () => h('a', attrs, slots.default?.())
  },
})
const root = createNode('#root')
const app = renderer.createApp(CharacterCalculatorView)
app.use(pinia)
app.component('RouterLink', RouterLink)
app.mount(root)
await nextTick()

check(
  '首次请求期间显示加载态',
  renderedText(findNode(root, (node) => node.props.role === 'status')),
  '正在从数据库加载计算器数据...',
)
rejectRequest?.()
await new Promise((resolve) => setTimeout(resolve, 0))
await nextTick()

let alert = findNode(root, (node) => node.props.role === 'alert')
let retryButton = findNode(
  root,
  (node) => node.type === 'button' && renderedText(node) === '重新加载',
)
check('页面错误态显示后端消息', renderedText(alert), '首次加载失败')
check('页面错误态提供重试按钮', Boolean(retryButton), true)

store.loaded = true
await nextTick()
retryButton = findNode(root, (node) => node.type === 'button' && renderedText(node) === '重新加载')
const requestsBeforeRetry = requestCount
retryButton.focus()
retryButton.props.onClick()
retryButton.props.onClick()
await nextTick()
check('快速重复点击只发起一次强制请求', requestCount - requestsBeforeRetry, 1)
check(
  '重试期间显示加载态',
  renderedText(findNode(root, (node) => node.props.role === 'status')),
  '正在从数据库加载计算器数据...',
)
check('重试期间焦点移至加载状态', globalThis.document.activeElement?.props?.role, 'status')

rejectRequest?.()
await new Promise((resolve) => setTimeout(resolve, 0))
await nextTick()
alert = findNode(root, (node) => node.props.role === 'alert')
retryButton = findNode(root, (node) => node.type === 'button' && renderedText(node) === '重新加载')
check('重试失败后显示新错误', renderedText(alert), '重试仍然失败')
check('重试失败后仍可再次重试', Boolean(retryButton), true)
check('重试失败后焦点返回重试按钮', globalThis.document.activeElement === retryButton, true)

const requestsBeforeFocusMoveRetry = requestCount
retryButton.props.onClick()
await nextTick()
check('移开焦点前已发起新重试', requestCount - requestsBeforeFocusMoveRetry, 1)
check(
  '移开焦点前显示加载态',
  renderedText(findNode(root, (node) => node.props.role === 'status')),
  '正在从数据库加载计算器数据...',
)
const sidebarButton = findNode(
  root,
  (node) => node.type === 'button' && String(node.props.class).includes('sidebar-btn'),
)
sidebarButton.focus()
rejectRequest?.()
await new Promise((resolve) => setTimeout(resolve, 0))
await nextTick()
check('用户移开焦点后不再强制抢回', globalThis.document.activeElement === sidebarButton, true)

retryButton = findNode(root, (node) => node.type === 'button' && renderedText(node) === '重新加载')
const requestsBeforeBodyFocusRetry = requestCount
retryButton.focus()
retryButton.props.onClick()
await nextTick()
check('点击空白处前已发起新重试', requestCount - requestsBeforeBodyFocusRetry, 1)
globalThis.document.activeElement = globalThis.document.body
rejectRequest?.()
await new Promise((resolve) => setTimeout(resolve, 0))
await nextTick()
check('焦点落到页面空白后不再强制抢回', globalThis.document.activeElement === documentBody, true)

app.unmount()
console.log('')
console.log(failed === 0 ? '全部通过' : `${failed} 项失败`)
process.exitCode = failed === 0 ? 0 : 1
