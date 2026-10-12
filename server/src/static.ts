import { existsSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import { log } from './lib/log';

// 本檔在開發時位於 server/src/，建置後被打包進 server/dist/index.js；
// 兩者都在 server/ 下一層，因此往上一層即為 server 套件根目錄。
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(serverRoot, 'public');

/** 一款遊戲的客戶端靜態檔：URL 前綴、建置產物目錄（server/.. 下的 <workspace>/dist）、缺檔提示 */
interface GameStatic {
  /** URL 前綴，例如 /draw-guess */
  base: string;
  dist: string;
  /** dist 不存在時 static.missing 的 hint */
  missingHint: string;
}

const games: GameStatic[] = [
  {
    base: '/draw-guess',
    dist: resolve(serverRoot, '..', 'draw-guess', 'dist'),
    missingHint: '先執行 npm run build（開發時請走 Vite：http://localhost/draw-guess/）',
  },
  {
    base: '/draw-contest',
    dist: resolve(serverRoot, '..', 'draw-contest', 'dist'),
    missingHint: '先執行 npm run build（開發時請走 Vite：npm run dev → http://localhost/draw-contest/）',
  },
  {
    base: '/song-guess',
    dist: resolve(serverRoot, '..', 'song-guess', 'dist'),
    missingHint: '先執行 npm run build（開發時請走 Vite：npm run dev → http://localhost/song-guess/）',
  },
];

export function mountStatic(app: Express): void {
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/', (_req, res) => {
    res.sendFile(resolve(publicDir, 'index.html'));
  });

  for (const game of games) mountGame(app, game);
}

function mountGame(app: Express, { base, dist, missingHint }: GameStatic): void {
  if (!existsSync(resolve(dist, 'index.html'))) {
    log.warn('static.missing', { dir: dist, hint: missingHint });
  }

  app.use(base, express.static(dist));

  // SPA fallback：無副檔名的路徑回 index.html；帶副檔名（找不到的資源檔）回 404
  app.get(`${base}/{*splat}`, (req, res) => {
    if (extname(req.path) !== '') {
      res.sendStatus(404);
      return;
    }
    res.sendFile(resolve(dist, 'index.html'), (err) => {
      if (err && !res.headersSent) res.sendStatus(404);
    });
  });
}
