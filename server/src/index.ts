import { DRAW_GUESS_NAMESPACE } from '@fishing-work/shared';
import { createApp } from './app';
import { log } from './lib/log';
import { httpUrl, isWildcardHost, listenErrorHint, shareUrls } from './lib/network';

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
log.info('server.listen', { host: HOST, port, games: [DRAW_GUESS_NAMESPACE] });

const local = httpUrl('localhost', port, '/draw-guess/');
const urls = shareUrls(HOST, port, '/draw-guess/');
if (isWildcardHost(HOST) && urls.length === 0) {
  log.warn('server.lan.none', { hint: '找不到任何區網 IPv4：確認已連上 Wi-Fi／有線網路，同事才連得到', local });
} else {
  log.info('server.lan', { share: urls, local });
}

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
