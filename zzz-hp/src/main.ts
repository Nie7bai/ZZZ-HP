import './assets/main.css'
import './assets/interknot.css'
// 计算器统一的 chip（选择/切换按钮）样式：见文件头「全站唯一来源」
import './assets/calculatorChip.css'
// 录入方式（面板导入 / 词条导入）二选一按钮：全站唯一来源（弹窗跨 Teleport 也要同款视觉）
import './assets/entryModeTabs.css'
// 面板导出图片的截图展开样式：见 dev-docs/panel-image-export.md §3.4
import './assets/infoTip.css'
import './assets/panelImageExport.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { initTheme } from './stores/theme'
import { loadRuntimeDamageChains } from './zones/chainSource'
import { loadRuntimeZoneSchemes } from './zones/schemeSource'

initTheme()

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

// 先并行拉取已启用的乘区方案与计算链路（各自最多 1.5s；失败回落内置），再挂载
void Promise.allSettled([loadRuntimeZoneSchemes(), loadRuntimeDamageChains()]).finally(() => {
  app.mount('#app')
})
