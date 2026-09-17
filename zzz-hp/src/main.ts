import './assets/main.css'
import './assets/interknot.css'
// 计算器统一的 chip（选择/切换按钮）样式：见文件头「全站唯一来源」
import './assets/calculatorChip.css'
// 录入方式（面板导入 / 词条导入）二选一按钮：全站唯一来源（弹窗跨 Teleport 也要同款视觉）
import './assets/entryModeTabs.css'

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
