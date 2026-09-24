import './assets/main.css'
import './assets/interknot.css'
// 计算器统一的 chip（选择/切换按钮）样式：见文件头「全站唯一来源」
import './assets/calculatorChip.css'
// 面板导出图片的截图展开样式：见 dev-docs/panel-image-export.md §3.4
import './assets/panelImageExport.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { initTheme } from './stores/theme'
import { useUserAuthStore } from './stores/userAuth'

initTheme()

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

const userAuth = useUserAuthStore(pinia)
void userAuth.restoreSession()

app.mount('#app')
