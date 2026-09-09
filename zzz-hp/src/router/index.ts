import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import { useCrisisAssaultCompareStore } from '../stores/crisisAssaultCompare'
import AdminLayout from '../layouts/AdminLayout.vue'
import { publicModePanelRouteRecords } from './modePanelRoutes'
import { createSidebarPanelRouteRecords } from './sidebarPanelRoutes'
import {
  ADMIN_CALCULATOR_PANELS,
  ADMIN_DEDUCTION_PANELS,
  ADMIN_SCOPE_PANELS,
  CHARACTER_CALC_PAGES,
  SITE_INFO_ROUTE_PANELS,
} from '../constants/sidebarPanelIds'
import type { AdminScope } from '../types/admin'
import { isAdminAuthenticated } from '../utils/adminAuth'

const AdminCalculatorLayout = () => import('../layouts/AdminCalculatorLayout.vue')
const SiteInfoView = () => import('../views/SiteInfoView.vue')
const CharacterCalculatorView = () => import('../views/CharacterCalculatorView.vue')

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/account',
      name: 'account',
      component: () => import('../views/AccountView.vue'),
      meta: { title: '账号中心' },
    },
    ...createSidebarPanelRouteRecords({
      basePath: '/about',
      routeName: 'about',
      component: SiteInfoView,
      panelIds: SITE_INFO_ROUTE_PANELS,
      defaultPanelId: 'about',
      meta: { title: '网站说明' },
      childProps: {
        backTo: '/',
        backLabel: '← 返回首页',
      },
    }),
    ...publicModePanelRouteRecords,
    {
      path: '/defense',
      name: 'defense-select',
      component: () => import('../views/DefenseSelectView.vue'),
    },
    ...createSidebarPanelRouteRecords({
      basePath: '/character-calculator',
      routeName: 'character-calculator',
      component: CharacterCalculatorView,
      panelIds: CHARACTER_CALC_PAGES,
      defaultPanelId: 'damage',
    }),
    {
      path: '/admin/login',
      name: 'admin-login',
      component: () => import('../views/admin/AdminLoginView.vue'),
      meta: { adminPublic: true },
    },
    {
      path: '/admin',
      name: 'admin',
      component: () => import('../views/admin/AdminModeSelectView.vue'),
      meta: { requiresAdmin: true },
    },
    {
      path: '/admin/changelog',
      name: 'admin-changelog',
      component: () => import('../views/admin/AdminChangelogView.vue'),
      meta: { requiresAdmin: true },
    },
    {
      path: '/admin/guestbook',
      name: 'admin-guestbook',
      component: () => import('../views/admin/AdminGuestbookView.vue'),
      meta: { requiresAdmin: true },
    },
    {
      path: '/admin/defense',
      name: 'admin-defense-select',
      component: () => import('../views/admin/AdminDefenseSelectView.vue'),
      meta: { requiresAdmin: true },
    },
    {
      path: '/admin/site-info',
      name: 'admin-site-info',
      component: () => import('../views/admin/AdminSiteInfoView.vue'),
      meta: { requiresAdmin: true, title: '网站说明管理' },
    },
    ...createSidebarPanelRouteRecords({
      basePath: '/admin/about',
      routeName: 'admin-about',
      component: SiteInfoView,
      panelIds: SITE_INFO_ROUTE_PANELS,
      defaultPanelId: 'about',
      meta: { requiresAdmin: true, title: '网站说明' },
      childProps: {
        backTo: '/admin',
        backLabel: '← 返回管理员入口',
      },
    }),
    ...createSidebarPanelRouteRecords({
      basePath: '/admin/crisis-assault',
      routeName: 'admin-crisis-assault',
      component: AdminLayout,
      panelIds: ADMIN_SCOPE_PANELS,
      defaultPanelId: 'monster',
      meta: { requiresAdmin: true },
      childProps: () => ({
        title: '危局强袭战',
        scope: 'crisis-assault' as AdminScope,
        backTo: '/admin',
        backLabel: '← 返回管理员入口',
      }),
    }),
    ...createSidebarPanelRouteRecords({
      basePath: '/admin/deduction',
      routeName: 'admin-deduction',
      component: AdminLayout,
      panelIds: ADMIN_DEDUCTION_PANELS,
      defaultPanelId: 'monster',
      meta: { requiresAdmin: true },
      childProps: () => ({
        title: '临界推演',
        scope: 'deduction' as AdminScope,
        backTo: '/admin',
        backLabel: '← 返回管理员入口',
      }),
    }),
    {
      path: '/admin/boss-info',
      name: 'admin-boss-info',
      component: () => import('../views/admin/AdminBossInfoView.vue'),
      meta: { requiresAdmin: true, title: '怪物基础库' },
    },
    {
      path: '/admin/buffs',
      name: 'admin-buffs',
      component: () => import('../views/admin/AdminBuffCatalogView.vue'),
      meta: { requiresAdmin: true, title: '环境 Buff 管理' },
    },
    ...createSidebarPanelRouteRecords({
      basePath: '/admin/character-calculator',
      routeName: 'admin-character-calculator',
      component: AdminCalculatorLayout,
      panelIds: ADMIN_CALCULATOR_PANELS,
      defaultPanelId: 'agent',
      meta: { requiresAdmin: true },
    }),
    ...createSidebarPanelRouteRecords({
      basePath: '/admin/defense/old',
      routeName: 'admin-defense-old',
      component: AdminLayout,
      panelIds: ADMIN_SCOPE_PANELS,
      defaultPanelId: 'monster',
      meta: { requiresAdmin: true },
      childProps: () => ({
        title: '旧·式舆防卫战',
        scope: 'defense-old' as AdminScope,
        backTo: '/admin/defense',
        backLabel: '← 返回式舆防卫战',
      }),
    }),
    ...createSidebarPanelRouteRecords({
      basePath: '/admin/defense/new',
      routeName: 'admin-defense-new',
      component: AdminLayout,
      panelIds: ADMIN_SCOPE_PANELS,
      defaultPanelId: 'monster',
      meta: { requiresAdmin: true },
      childProps: () => ({
        title: '新·式舆防卫战',
        scope: 'defense-new' as AdminScope,
        backTo: '/admin/defense',
        backLabel: '← 返回式舆防卫战',
      }),
    }),
  ],
})

router.beforeEach((to) => {
  const needsAdmin = to.matched.some((record) => record.meta.requiresAdmin)
  if (!needsAdmin) {
    if (to.name === 'admin-login' && isAdminAuthenticated()) {
      return { path: '/admin' }
    }
    return true
  }

  if (isAdminAuthenticated()) return true

  return {
    path: '/admin/login',
    query: { redirect: to.fullPath },
  }
})

router.afterEach((to, from, failure) => {
  if (
    !failure &&
    from.meta.modePanelMode === 'crisis-assault' &&
    to.meta.modePanelMode !== 'crisis-assault'
  ) {
    useCrisisAssaultCompareStore().clear()
  }
})

export default router
