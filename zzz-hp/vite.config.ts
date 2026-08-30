import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3010',
        changeOrigin: true,
      },
      '/boss_image': {
        target: 'http://localhost:3010',
        changeOrigin: true,
      },
      '/buff_image': {
        target: 'http://localhost:3010',
        changeOrigin: true,
      },
      '/attribute_image': {
        target: 'http://localhost:3010',
        changeOrigin: true,
      },
      '/calculator_image': {
        target: 'http://localhost:3010',
        changeOrigin: true,
      },
      '/guestbook_image': {
        target: 'http://localhost:3010',
        changeOrigin: true,
      },
      // 与后端上传落盘目录一致；含 `&` 的旧文件名也能由 Express 正确提供。
      // 必须带尾部斜杠，否则会误匹配前端路由 /character-calculator（刷新整页时）。
      '/character/': {
        target: 'http://localhost:3010',
        changeOrigin: true,
      },
      '/wengine/': {
        target: 'http://localhost:3010',
        changeOrigin: true,
      },
      '/drive_disc/': {
        target: 'http://localhost:3010',
        changeOrigin: true,
      },
      '/bangboo/': {
        target: 'http://localhost:3010',
        changeOrigin: true,
      },
    },
  },
})
