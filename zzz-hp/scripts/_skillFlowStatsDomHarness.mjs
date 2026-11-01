/** 将真实 SFC 编译为客户端组件，在内存 DOM 内测试点击；不启动浏览器或服务。 */
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://damage-analysis.invalid',
})
const previousGlobals = new Map()
for (const name of [
  'window',
  'document',
  'navigator',
  'Element',
  'HTMLElement',
  'SVGElement',
  'Node',
  'Event',
  'MouseEvent',
  'localStorage',
]) {
  previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: dom.window[name],
  })
}
const { createRenderer, h, nextTick, reactive } = await import('vue')
const { nodeOps, patchProp } = await import('@vue/runtime-dom')
// vite-node 的配置加载可能先导入 Vue；为渲染器显式注入内存 document，
// 避免 runtime-dom 在模块初始化时捕获了 Node 环境的空 document。
const testDocument = dom.window.document
const { createApp } = createRenderer({
  ...nodeOps,
  patchProp,
  createElement: (tag, namespace) =>
    namespace === 'svg'
      ? testDocument.createElementNS('http://www.w3.org/2000/svg', tag)
      : testDocument.createElement(tag),
  createText: (text) => testDocument.createTextNode(text),
  createComment: (text) => testDocument.createComment(text),
  querySelector: (selector) => testDocument.querySelector(selector),
  insertStaticContent(content, parent, anchor, namespace) {
    const template = testDocument.createElement('template')
    template.innerHTML = namespace === 'svg' ? `<svg>${content}</svg>` : content
    const fragment = namespace === 'svg' ? template.content.firstChild : template.content
    const first = fragment.firstChild
    const last = fragment.lastChild
    if (namespace === 'svg') {
      while (fragment.firstChild) parent.insertBefore(fragment.firstChild, anchor)
    } else parent.insertBefore(fragment, anchor)
    return [first, last]
  },
})
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const componentDir = path.resolve(scriptDir, '../src/components/calculator')
const temporaryFiles = []
const compiledTargets = new Map()
const replacements = new Map()
let StatsPanel

async function compileComponent(name) {
  const cached = compiledTargets.get(name)
  if (cached) return cached
  const filename = path.join(componentDir, `${name}.vue`)
  if (!existsSync(filename)) return
  const source = await fs.readFile(filename, 'utf8')
  const { descriptor } = parse(source, { filename })
  const compiled = compileScript(descriptor, { id: `test-${name}`, inlineTemplate: true })
  let content = compiled.content
  for (const [from, to] of replacements) content = content.replaceAll(from, to)
  const output = ts.transpileModule(content, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  const target = path.join(scriptDir, `tmp-sf-${name}-${process.pid}.mjs`)
  temporaryFiles.push(target)
  await fs.writeFile(target, output, 'utf8')
  replacements.set(`@/components/calculator/${name}.vue`, `./${path.basename(target)}`)
  compiledTargets.set(name, target)
  return target
}

async function component() {
  if (StatsPanel) return StatsPanel
  await compileComponent('SkillFlowDamageCrossAnalysis')
  await compileComponent('SkillFlowDamageRecordComparison')
  await compileComponent('FlowDamageModule')
  const filename = await compileComponent('SkillFlowStatsPanel')
  StatsPanel = (await import(filename)).default
  return StatsPanel
}

export async function mountStatsPanel(props) {
  const Panel = await component()
  const mounted = mountWith(Panel, props)
  await nextTick()
  return {
    ...mounted,
    one: (selector) => mounted.host.querySelector(selector),
    all: (selector) => [...mounted.host.querySelectorAll(selector)],
    async clickLabel(label) {
      const button = [...mounted.host.querySelectorAll('[aria-label]')].find(
        (el) => el.getAttribute('aria-label') === label,
      )
      if (!button) throw new Error(`找不到控件：${label}`)
      button.click()
      await nextTick()
    },
    async clickText(selector, text) {
      const button = [...mounted.host.querySelectorAll(selector)].find(
        (el) => el.textContent.trim() === text,
      )
      if (!button) throw new Error(`找不到按钮：${text}`)
      button.click()
      await nextTick()
    },
    async setProps(patch) {
      Object.assign(mounted.state, patch)
      await nextTick()
    },
    async settle() {
      await nextTick()
    },
    unmount() {
      mounted.app.unmount()
      mounted.host.remove()
    },
  }
}

/** 单独挂载一个计算器子组件（如 FlowZoneCalculation），用于分块渲染的 DOM 断言 */
export async function mountCalculatorComponent(name, props) {
  const filename = await compileComponent(name)
  const Component = (await import(filename)).default
  const mounted = mountWith(Component, props)
  await nextTick()
  return {
    ...mounted,
    one: (selector) => mounted.host.querySelector(selector),
    all: (selector) => [...mounted.host.querySelectorAll(selector)],
    text: () => mounted.host.textContent.replace(/\s+/g, ' ').trim(),
    async setProps(patch) {
      Object.assign(mounted.state, patch)
      await nextTick()
    },
    async settle() {
      await nextTick()
    },
    unmount() {
      mounted.app.unmount()
      mounted.host.remove()
    },
  }
}

function mountWith(Component, props) {
  const host = dom.window.document.createElement('div')
  dom.window.document.body.append(host)
  const state = reactive({ ...props })
  const app = createApp({ render: () => h(Component, state) })
  app.mount(host)
  return { host, state, app }
}

export function testStorage() {
  return dom.window.localStorage
}

export async function disposeStatsDomHarness() {
  dom.window.close()
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  }
  await Promise.all(
    temporaryFiles.map(async (filename) => {
      // Windows 下 vite-node 可能还挂着句柄：短暂重试，仍失败就留给系统
      // （临时文件名匹配 .gitignore 的 tmp-*.mjs，不会进版本库）
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          await fs.unlink(filename)
          return
        } catch (err) {
          if (err?.code !== 'EPERM' && err?.code !== 'EBUSY') throw err
          await new Promise((resolve) => setTimeout(resolve, 60))
        }
      }
    }),
  )
}

export function damageAnalysisFixture() {
  const hit = (id, skillId, type, count, staggerPhase = 'normal') => ({
    id,
    skill: { id: skillId, name: type === 'direct' ? '普通攻击' : '乱流', damageType: type },
    ownerAgentId: id === 'b' ? 'b' : 'a',
    damageKind: type === 'direct' ? 'direct' : 'anomaly',
    directSubKind: 'normal',
    anomalySubKind: 'turbulence',
    count,
    staggerPhase,
    anomalyPowerAgentId: 'a',
    triggerAgentId: 'b',
  })
  return {
    teamSlots: [{ agentId: 'a' }, { agentId: 'b' }],
    agents: [
      { id: 'a', name: '角色甲' },
      { id: 'b', name: '角色乙' },
    ],
    slots: [
      { prepared: [], flow: ['a1', 'a2', 't1', 't2'].map((id) => ({ id })) },
      { prepared: [], flow: [{ id: 'b' }] },
    ],
    hits: [
      hit('a1', 'direct', 'direct', 1),
      hit('a2', 'direct', 'direct', 2, 'stagger'),
      hit('t1', 'turb', 'turbulence', 3),
      hit('t2', 'turb', 'turbulence', 4, 'stagger'),
      hit('b', 'direct', 'direct', 5),
    ],
    hitDamages: { a1: 10, a2: 20, t1: 30, t2: 40, b: 100 },
    activeSlotIndex: 1,
    schemeName: '回归方案',
  }
}
