import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import { useCrisisAssaultCompareStore } from '../stores/crisisAssaultCompare'
import AdminLayout from '../layouts/AdminLayout.vue'
import type { AdminScope } from '../types/admin'
import { isAdminAuthenticated } from '../utils/adminAuth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/crisis-assault',
      name: 'crisis-assault',
      component: () => import('../views/CrisisAssaultView.vue'),
    },
    {
      path: '/defense',
      name: 'defense-select',
      component: () => import('../views/DefenseSelectView.vue'),
    },
    {
      path: '/defense/old',
      name: 'defense-old',
      component: () => import('../views/DefenseView.vue'),
      meta: { title: '旧·式舆防卫战' },
    },
    {
      path: '/defense/new',
      name: 'defense-new',
      component: () => import('../views/DefenseView.vue'),
      meta: { title: '新·式舆防卫战' },
    },
    {
      path: '/deduction',
      name: 'deduction',
      component: () => import('../views/DeductionView.vue'),
    },
    {
      path: '/character-calculator',
      name: 'character-calculator',
      component: () => import('../views/CharacterCalculatorView.vue'),
    },
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
      path: '/admin/defense',
      name: 'admin-defense-select',
      component: () => import('../views/admin/AdminDefenseSelectView.vue'),
      meta: { requiresAdmin: true },
    },
    {
      path: '/admin/crisis-assault',
      name: 'admin-crisis-assault',
      component: AdminLayout,
      props: () => ({
        title: '危局强袭战',
        scope: 'crisis-assault' as AdminScope,
        backTo: '/admin',
        backLabel: '← 返回管理员入口',
      }),
      meta: { requiresAdmin: true },
    },
    {
      path: '/admin/deduction',
      name: 'admin-deduction',
      component: AdminLayout,
      props: () => ({
        title: '临界推演',
        scope: 'deduction' as AdminScope,
        backTo: '/admin',
        backLabel: '← 返回管理员入口',
      }),
      meta: { requiresAdmin: true },
    },
    {
      path: '/admin/character-calculator',
      name: 'admin-character-calculator',
      component: () => import('../layouts/AdminCalculatorLayout.vue'),
      meta: { requiresAdmin: true },
    },
    {
      path: '/admin/defense/old',
      name: 'admin-defense-old',
      component: AdminLayout,
      props: () => ({
        title: '旧·式舆防卫战',
        scope: 'defense-old' as AdminScope,
        backTo: '/admin/defense',
        backLabel: '← 返回式舆防卫战',
      }),
      meta: { requiresAdmin: true },
    },
    {
      path: '/admin/defense/new',
      name: 'admin-defense-new',
      component: AdminLayout,
      props: () => ({
        title: '新·式舆防卫战',
        scope: 'defense-new' as AdminScope,
        backTo: '/admin/defense',
        backLabel: '← 返回式舆防卫战',
      }),
      meta: { requiresAdmin: true },
    },
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

router.afterEach((to, from) => {
  if (from.name === 'crisis-assault' && to.name !== 'crisis-assault') {
    useCrisisAssaultCompareStore().clear()
  }
})

export default router
