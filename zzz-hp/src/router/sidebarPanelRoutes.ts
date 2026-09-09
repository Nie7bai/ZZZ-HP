import type { Component } from 'vue'
import type { RouteLocationGeneric, RouteMeta, RouteRecordRaw } from 'vue-router'

type LazyRouteComponent = () => Promise<{ default: Component }>
type RouteProps =
  | boolean
  | Record<string, unknown>
  | ((to: RouteLocationGeneric) => Record<string, unknown>)

export interface SidebarPanelRouteOptions {
  basePath: string
  routeName: string
  component: Component | LazyRouteComponent
  panelIds: readonly string[]
  defaultPanelId: string
  meta?: RouteMeta
  /** 挂到每个 panel 子路由上的 props */
  childProps?: RouteProps
}

export function getSidebarPanelRouteName(routeName: string, panelId: string): string {
  return `${routeName}-panel-${panelId}`
}

export function getSidebarPanelPath(basePath: string, panelId: string): string {
  return `${basePath.replace(/\/+$/, '')}/${panelId}`
}

export function getSidebarPanelLocation(
  basePath: string,
  panelId: string,
  routeState: Pick<RouteLocationGeneric, 'query' | 'hash'>,
) {
  return {
    path: getSidebarPanelPath(basePath, panelId),
    query: { ...routeState.query },
    hash: routeState.hash,
  }
}

/**
 * 侧栏每一项对应 `/base/<panelId>`，与危局/防卫战 modePanelRoutes 同构。
 * 父路径仅作 redirect；子路由渲染同一 component，靠 meta.sidebarPanelId 区分面板。
 */
export function createSidebarPanelRouteRecords(
  options: SidebarPanelRouteOptions,
): RouteRecordRaw[] {
  if (!options.panelIds.includes(options.defaultPanelId)) {
    throw new Error(
      `defaultPanelId "${options.defaultPanelId}" must be included in panelIds for ${options.basePath}`,
    )
  }

  const fallbackRouteName = getSidebarPanelRouteName(options.routeName, options.defaultPanelId)
  const redirectToFallback = (to: RouteLocationGeneric) => ({
    name: fallbackRouteName,
    params: {},
    query: to.query,
    hash: to.hash,
  })

  const sharedMeta: RouteMeta = {
    ...options.meta,
    sidebarPanelBasePath: options.basePath,
  }

  return [
    {
      path: options.basePath,
      name: options.routeName,
      redirect: redirectToFallback,
      meta: sharedMeta,
      children: [
        ...options.panelIds.map<RouteRecordRaw>((panelId) => ({
          path: panelId,
          name: getSidebarPanelRouteName(options.routeName, panelId),
          component: options.component,
          props: options.childProps,
          meta: {
            ...sharedMeta,
            sidebarPanelId: panelId,
          },
        })),
        {
          path: ':pathMatch(.*)*',
          redirect: redirectToFallback,
        },
      ],
    },
  ]
}
