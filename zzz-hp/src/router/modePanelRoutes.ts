import type { Component } from 'vue'
import type { RouteLocationGeneric, RouteMeta, RouteRecordRaw } from 'vue-router'
import { getFirstModePanelId, getModePanelDefinitions, type ModePanelId } from '@/config/modePanels'
import type { ModeKey } from '@/types/history'

type LazyRouteComponent = () => Promise<{ default: Component }>

interface ModePanelRouteOptions {
  basePath: string
  component: Component | LazyRouteComponent
  meta?: RouteMeta
  mode: ModeKey
  routeName: string
}

export function getModePanelRouteName(routeName: string, panelId: ModePanelId): string {
  return `${routeName}-panel-${panelId}`
}

function createFallbackLocation(to: RouteLocationGeneric, fallbackRouteName: string) {
  return {
    name: fallbackRouteName,
    params: {},
    query: to.query,
    hash: to.hash,
  }
}

export function createModePanelRouteRecords(options: ModePanelRouteOptions): RouteRecordRaw[] {
  const fallbackPanelId = getFirstModePanelId(options.mode)
  const fallbackRouteName = getModePanelRouteName(options.routeName, fallbackPanelId)
  const redirectToFallback = (to: RouteLocationGeneric) =>
    createFallbackLocation(to, fallbackRouteName)

  return [
    {
      path: options.basePath,
      name: options.routeName,
      redirect: redirectToFallback,
      meta: {
        ...options.meta,
        modePanelBasePath: options.basePath,
        modePanelMode: options.mode,
      },
      children: [
        ...getModePanelDefinitions(options.mode).map<RouteRecordRaw>((panel) => ({
          path: panel.id,
          name: getModePanelRouteName(options.routeName, panel.id),
          component: options.component,
          meta: { modePanelId: panel.id },
        })),
        {
          path: ':pathMatch(.*)*',
          redirect: redirectToFallback,
        },
      ],
    },
  ]
}

const CrisisAssaultView = () => import('../views/CrisisAssaultView.vue')
const DefenseView = () => import('../views/DefenseView.vue')
const DeductionView = () => import('../views/DeductionView.vue')

export const publicModePanelRouteRecords: RouteRecordRaw[] = [
  ...createModePanelRouteRecords({
    basePath: '/crisis-assault',
    component: CrisisAssaultView,
    mode: 'crisis-assault',
    routeName: 'crisis-assault',
  }),
  ...createModePanelRouteRecords({
    basePath: '/defense/old',
    component: DefenseView,
    meta: { defenseVariant: 'old', title: '旧·式舆防卫战' },
    mode: 'defense',
    routeName: 'defense-old',
  }),
  ...createModePanelRouteRecords({
    basePath: '/defense/new',
    component: DefenseView,
    meta: { defenseVariant: 'new', title: '新·式舆防卫战' },
    mode: 'defense',
    routeName: 'defense-new',
  }),
  ...createModePanelRouteRecords({
    basePath: '/deduction',
    component: DeductionView,
    mode: 'deduction',
    routeName: 'deduction',
  }),
]
