// npm run dev 的最後一個程序（排在 server 與各遊戲的 Vite 之後；spec/architecture.md §3「開發」、spec/song-guess/architecture.md §3）：
// 等 http://localhost/healthz（經 draw-guess 的 Vite 轉到 server :7180）回 200，才開瀏覽器到遊戲清單 http://localhost/。
// 原因：Vite 不到 0.1 秒就就緒，server（tsx）要約 1 秒；若用 Vite 的 server.open，瀏覽器會先開到 proxy error（2026-10-12 實測）。
// 環境變數：DEV_OPEN_URL 覆寫要開的網址；BROWSER=none 不開（測試用）；BROWSER 以 .js 結尾時改為 node <該檔> <網址>（與 Vite 相同慣例）。
import { spawn } from 'node:child_process';

const url = process.env.DEV_OPEN_URL ?? 'http://localhost/';
const probe = new URL('/healthz', url);
const deadline = Date.now() + 30_000;

let ready = false;
while (Date.now() < deadline) {
  try {
    const r = await fetch(probe);
    if (r.ok) {
      ready = true;
      break;
    }
  } catch {
    // Vite 或 server 還沒起來，稍後再試
  }
  await new Promise((r) => setTimeout(r, 300));
}

if (!ready) {
  console.warn(`[dev-open] 30 秒內 ${probe} 仍未回 200，不開瀏覽器；請自行開 ${url}`);
  process.exit(0);
}

const browser = process.env.BROWSER ?? '';
if (browser === 'none') process.exit(0);

const [cmd, args] = browser.endsWith('.js')
  ? [process.execPath, [browser, url]]
  : process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];

spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
console.log(`[dev-open] 已開瀏覽器：${url}`);
