import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { ViteNodeRunner } from 'vite-node/client'
import { ViteNodeServer } from 'vite-node/server'

/**
 * 客户端黑盒验证：PanelCalcSection 的页级预览与事件明细均接入提供者基础伤害来源。
 *
 * 运行：npm run test:anomaly-provider-source
 */

const root = fileURLToPath(new URL('../', import.meta.url))

const dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/' })
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  Event: dom.window.Event,
  MouseEvent: dom.window.MouseEvent,
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  cancelAnimationFrame: clearTimeout,
})) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}

const { default: vuePlugin } = await import('@vitejs/plugin-vue')
const server = await createServer({
  configFile: false,
  root,
  plugins: [vuePlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: undefined },
})
const viteNode = new ViteNodeServer(server, { transformMode: { web: [/\.vue$/] } })
const runner = new ViteNodeRunner({
  root: server.config.root,
  base: server.config.base,
  fetchModule: (id) => viteNode.fetchModule(id),
  resolveId: (id, importer) => viteNode.resolveId(id, importer),
})

let app
try {
  const [{ default: Panel }, calculatorUi, panelTypes, vue, pinia] = await Promise.all([
    runner.executeFile(`${root}/src/components/calculator/PanelCalcSection.vue`),
    runner.executeFile(`${root}/src/utils/calculatorUi.ts`),
    runner.executeFile(`${root}/src/types/calculatorPanel.ts`),
    runner.executeId('vue'),
    runner.executeId('pinia'),
  ])

  const makeAgent = (id, name, profession, panel) => ({
    id,
    name,
    profession,
    element: '物理',
    supportNeeds: [],
    avatar_image: null,
    note: '',
    basePanel: { ...calculatorUi.createEmptyAgentBasePanel(), ...panel },
    mindscapeNotes: calculatorUi.createEmptyMindscapeNotes(),
    mindscapeBuffs: calculatorUi.createEmptyMindscapeBuffs(),
  })
  const owner = makeAgent('owner', '招式持有者', '命破', {
    hp: 20_000,
    atk: 3_000,
    mastery: 100,
    anomalyMult: 100,
  })
  const provider = makeAgent('provider', '异常强度提供者', '异常', {
    hp: 10_000,
    atk: 4_321,
    mastery: 100,
    anomalyMult: 100,
    disorderBaseMult: 100,
    disorderCompMult: 100,
    anomalyDuration: 10,
  })
  const providerPanel = {
    ...panelTypes.createDefaultExternalPanel(),
    ...provider.basePanel,
  }
  const slot = (agent, index) => ({
    agentId: agent.id,
    rank: 0,
    wengineId: 'none',
    wengineRefine: 1,
    isMainC: index === 0,
    twoPieceDriveDiscId: 'none',
    fourPieceDriveDiscId: 'none',
  })
  const makeHit = (id, triggerAgentId) => ({
    id,
    skill: {
      id: 'skill',
      name: id,
      agentId: 'owner',
      source: 'custom',
      damageType: 'disorder',
      skillTypes: [],
      baseMult: 0,
      baseMultFactor: 100,
    },
    ownerAgentId: 'owner',
    anomalyPowerAgentId: 'provider',
    triggerAgentId,
    count: 1,
    staggerPhase: 'normal',
    critMode: 'expected',
    damageKind: 'anomaly',
    anomalySubKind: 'disorder',
    coords: [],
    isFollowUp: false,
    multOverrides: null,
    panelMods: null,
  })

  const hits = vue.shallowRef([])
  let hitResults = null
  const commonProps = {
    teamSlots: [slot(owner, 0), slot(provider, 1)],
    agents: [owner, provider],
    wengines: [],
    bangboos: [],
    driveDiscs: [],
    selectedBangbooId: 'none',
    bangbooRefine: 1,
    editedSlotIndex: 0,
    calcMode: 'panel',
    damageKind: 'anomaly',
    anomalySubKind: 'disorder',
    triggerAnomalyAgentId: 'provider',
    anomalySlotPanels: { provider: providerPanel },
    previewHits: [makeHit('skipped-preview', null)],
    enemyInput: {
      defense: 0,
      resistanceType: 'normal',
      vulnerableMultiplier: 1,
      staggerMultiplier: 1,
      specialMultiplier: 1,
      level: 60,
    },
  }
  const Harness = vue.defineComponent({
    setup() {
      return () =>
        vue.h(Panel, {
          ...commonProps,
          hits: hits.value,
          'onUpdate:hitCalcResults': (value) => {
            hitResults = value
          },
        })
    },
  })

  app = vue.createApp(Harness)
  app.use(pinia.createPinia())
  app.mount('#app')

  const checkbox = document.querySelector('.detail-mode-toggle input')
  checkbox.checked = true
  checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  await vue.nextTick()
  const pageGroup = [...document.querySelectorAll('.formula-aligned-group')].find(
    (element) =>
      element.querySelector('.formula-agent-label')?.textContent.includes('异常强度提供者') &&
      element.textContent.includes('异常基础期望'),
  )
  const pageResult = pageGroup?.querySelector('.formula-aligned-result')?.textContent.trim()
  if (pageResult !== '8,642') {
    throw new Error(`页级接线：期望 8,642，实际 ${pageResult}`)
  }

  hits.value = [makeHit('valid-hit', 'owner')]
  await vue.nextTick()
  const hitResult = hitResults?.['valid-hit']
  if (hitResult?.baseDamageSource !== 'atk' || hitResult?.baseDamage !== 4_321) {
    throw new Error(
      `事件接线：期望 atk/4321，实际 ${hitResult?.baseDamageSource}/${hitResult?.baseDamage}`,
    )
  }

  console.log('PASS  面板页级预览使用提供者攻击力：8,642')
  console.log('PASS  面板事件明细使用提供者攻击力：atk / 4321')
} finally {
  app?.unmount()
  await server.close()
  dom.window.close()
}
