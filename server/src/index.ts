import { DRAW_GUESS_NAMESPACE } from '@fishing-work/shared';
import { DRAW_CONTEST_NAMESPACE } from '@fishing-work/shared/draw-contest';
import { createApp } from './app';
import { log } from './lib/log';
import { listenErrorHint } from './lib/network';
import { shareLog } from './lib/shareLog';

// spec §3：PORT 預設 80（公司區網只放行標準埠）、HOST 預設 0.0.0.0（所有介面，區網同事才連得到）。
// 開發時 server 由 dev script 帶 PORT=3000（Vite 綁 80 並 proxy /socket.io 過來）。
const PORT = Number(process.env.PORT ?? 80);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = createApp({ port: PORT, host: HOST });

let port: number;
try {
  ({ port } = await app.listen());
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  log.error('server.listen.failed', {
    host: HOST,
    port: PORT,
    code: code ?? null,
    err: String(err),
    hint: listenErrorHint(code, PORT) ?? undefined,
  });
  process.exit(1);
}
log.info('server.listen', { host: HOST, port, games: [DRAW_GUESS_NAMESPACE, DRAW_CONTEST_NAMESPACE] });

// 分享網址（spec §3，2026-10-12 海圖定案）：share 先印站台根網址（遊戲清單），games 再列每款遊戲的完整網址；
// PUBLIC_URL（站台根網址，只取 origin，舊的 /draw-guess/ 值相容）優先；容器內（IN_CONTAINER=1）不印 172.x 而改印提示（§3「Docker 部署」）
const share = shareLog({
  host: HOST,
  port,
  games: [
    { key: 'draw-guess', path: '/draw-guess/' },
    { key: 'draw-contest', path: '/draw-contest/' },
  ],
  env: process.env,
});
log[share.level](share.event, share.fields);

let closing = false;
const shutdown = (signal: string) => {
  if (closing) return;
  closing = true;
  log.info('server.shutdown', { signal });
  void app.close().then(() => process.exit(0));
  // 保險：關不掉就強制結束
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
