import assert from 'node:assert/strict'
import { createMemoryHistory, createRouter } from 'vue-router'
import {
  getFirstModePanelId,
  getModePanelDefinitions,
  getModePanelPath,
  MODE_PANEL_IDS,
} from '../src/config/modePanels'
import { getModePanelRouteName, publicModePanelRouteRecords } from '../src/router/modePanelRoutes'

const EmptyRouteView = { render: () => null }

function replaceRouteComponents(record) {
  return {
    ...record,
    ...(record.component ? { component: EmptyRouteView } : {}),
    ...(record.children ? { children: record.children.map(replaceRouteComponents) } : {}),
  }
}

const testRouteRecords = publicModePanelRouteRecords.map(replaceRouteComponents)

const router = createRouter({
  history: createMemoryHistory(),
  routes: testRouteRecords,
})

const routeGroups = [
  {
    basePath: '/crisis-assault',
    mode: 'crisis-assault',
    routeName: 'crisis-assault',
  },
  {
    basePath: '/defense/old',
    defenseVariant: 'old',
    mode: 'defense',
    routeName: 'defense-old',
    title: '旧·式舆防卫战',
  },
  {
    basePath: '/defense/new',
    defenseVariant: 'new',
    mode: 'defense',
    routeName: 'defense-new',
    title: '新·式舆防卫战',
  },
  {
    basePath: '/deduction',
    mode: 'deduction',
    routeName: 'deduction',
  },
]

for (const routeGroup of routeGroups) {
  const availablePanels = getModePanelDefinitions(routeGroup.mode)
  const fallbackPanelId = getFirstModePanelId(routeGroup.mode)
  const fallbackPath = getModePanelPath(routeGroup.basePath, fallbackPanelId)

  await router.push(routeGroup.basePath)
  assert.equal(router.currentRoute.value.path, fallbackPath)
  assert.equal(
    router.currentRoute.value.name,
    getModePanelRouteName(routeGroup.routeName, fallbackPanelId),
  )

  for (const panel of availablePanels) {
    const panelPath = getModePanelPath(routeGroup.basePath, panel.id)
    await router.push(panelPath)
    assert.equal(router.currentRoute.value.path, panelPath)
    assert.equal(
      router.currentRoute.value.name,
      getModePanelRouteName(routeGroup.routeName, panel.id),
    )
    assert.equal(router.currentRoute.value.meta.modePanelId, panel.id)
    assert.equal(router.currentRoute.value.meta.modePanelMode, routeGroup.mode)
    assert.equal(router.currentRoute.value.meta.modePanelBasePath, routeGroup.basePath)
    assert.equal(router.currentRoute.value.meta.defenseVariant, routeGroup.defenseVariant)
    assert.equal(router.currentRoute.value.meta.title, routeGroup.title)
  }

  const unavailablePanelIds = MODE_PANEL_IDS.filter(
    (panelId) => !availablePanels.some((panel) => panel.id === panelId),
  )
  for (const unavailablePanelId of unavailablePanelIds) {
    await router.push(getModePanelPath(routeGroup.basePath, unavailablePanelId))
    assert.equal(router.currentRoute.value.path, fallbackPath)
  }

  await router.push(`${routeGroup.basePath}/not-a-panel`)
  assert.equal(router.currentRoute.value.path, fallbackPath)

  await router.push(`${routeGroup.basePath}/not/a/panel`)
  assert.equal(router.currentRoute.value.path, fallbackPath)

  await router.push(`${routeGroup.basePath}/not-a-panel?source=test#details`)
  assert.equal(router.currentRoute.value.path, fallbackPath)
  assert.equal(router.currentRoute.value.query.source, 'test')
  assert.equal(router.currentRoute.value.hash, '#details')
}

console.log('Mode panel route contract checks passed.')
