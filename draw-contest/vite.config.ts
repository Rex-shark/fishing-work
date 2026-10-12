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
      // Vite 會把 / 302 到 base（/draw-contest/）；以下三條轉出去，
      // 讓 http://localhost:3001/ 跟正式一樣是遊戲清單（server :3000）、/draw-guess/ 是我畫你猜的 Vite（:80）、/healthz 可用（Rex 2026-10-12）
      '^/$': { target: 'http://localhost:3000' },
      '/draw-guess': { target: 'http://localhost:80', ws: true },
      '/healthz': { target: 'http://localhost:3000' },
    },
  },
});
