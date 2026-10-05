import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // cargo 构建时会锁写 target/ 下的 dll，Vite 默认递归监视整个项目会 EBUSY 崩掉 dev server。
    // 必须用函数判定：chokidar 的 glob 字符串写法在 Windows 上会连带把 src/ 看丢（改了 CSS 不热更）。
    watch: { ignored: (p: string) => p.replace(/\\/g, '/').includes('/src-tauri/') },
  },
})
