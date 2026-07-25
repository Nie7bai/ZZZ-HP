import './assets/main.css'
import './assets/interknot.css'

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
