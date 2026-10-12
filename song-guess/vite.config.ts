import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 執行拓樸見 spec/song-guess/architecture.md §3
export default defineConfig({
  base: '/song-guess/',
  plugins: [react(), tailwindcss()],
  server: {
    // 開發只在 Rex 本機（不需區網）：80 是我畫你猜、5174 是繪圖比賽的 dev server，猜歌綁 5175；被占用就直接失敗而不是悄悄換埠
    port: 5175,
    strictPort: true,
    proxy: {
      '/socket.io': { target: 'http://localhost:5173', ws: true },
      // Vite 會把 / 302 到 base（/song-guess/）；以下四條轉出去，
      // 讓 http://localhost:5175/ 跟正式一樣是遊戲清單（server :5173）、/draw-guess/ 是我畫你猜的 Vite（:80）、
      // /draw-contest/ 是繪圖比賽的 Vite（:5174）、/healthz 可用（與另兩款對稱）
      '^/$': { target: 'http://localhost:5173' },
      '/draw-guess': { target: 'http://localhost:80', ws: true },
      '/draw-contest': { target: 'http://localhost:5174', ws: true },
      '/healthz': { target: 'http://localhost:5173' },
    },
  },
});
