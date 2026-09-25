import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 執行拓樸見 spec/architecture.md §3
export default defineConfig({
  base: '/draw-guess/',
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    // 公司區網只放行標準埠（5173 會被擋）：dev server 綁 80，被占用就直接失敗而不是悄悄換埠
    port: 80,
    strictPort: true,
    // Vite 預設只接受 localhost 與 IP 的 Host 標頭；cloudflared 快速通道（*.trycloudflare.com）與
    // mDNS（<電腦名稱>.local）要明列，否則回 "Blocked request. This host is not allowed."
    allowedHosts: ['.trycloudflare.com', '.local'],
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
