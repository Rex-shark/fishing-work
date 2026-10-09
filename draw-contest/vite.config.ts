import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 執行拓樸見 spec/draw-contest/architecture.md §2、§3
export default defineConfig({
  base: '/draw-contest/',
  plugins: [react(), tailwindcss()],
  server: {
    // 開發只在 Rex 本機（不需區網）：80 已被我畫你猜的 dev server 占用，繪圖比賽綁 3001；被占用就直接失敗而不是悄悄換埠
    port: 3001,
    strictPort: true,
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
