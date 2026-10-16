import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 執行拓樸見 spec/draw-contest/architecture.md §2、§3
export default defineConfig({
  base: '/draw-contest/',
  plugins: [react(), tailwindcss()],
  server: {
    // 開發只在 Rex 本機（不需區網）：80 已被我畫你猜的 dev server 占用，繪圖比賽綁 7181（Rex 2026-10-12：內部埠改用 7180／7181，不用 3000／3001）；被占用就直接失敗而不是悄悄換埠
    port: 7181,
    strictPort: true,
    // :80（我畫你猜 Vite）會把 /draw-contest、/song-guess 連同原 Host 標頭轉過來；走 cloudflared 或 mDNS 時
    // Host 不是 localhost，三份 vite.config 都要放行，否則回 "Blocked request. This host is not allowed."（Rex 2026-10-14）
    allowedHosts: ['.trycloudflare.com', '.local'],
    proxy: {
      '/socket.io': { target: 'http://localhost:7180', ws: true },
      // Vite 會把 / 302 到 base（/draw-contest/）；以下四條轉出去，
      // 讓 http://localhost:7181/ 跟正式一樣是遊戲清單（server :7180）、/draw-guess/ 是我畫你猜的 Vite（:80）、/healthz 可用（Rex 2026-10-12）
      '^/$': { target: 'http://localhost:7180' },
      '/draw-guess': { target: 'http://localhost:80', ws: true },
      // 猜歌的 Vite（:7182，HMR；Epic 16，spec/song-guess/architecture.md §3）
      '/song-guess': { target: 'http://localhost:7182', ws: true },
      '/healthz': { target: 'http://localhost:7180' },
    },
  },
});
