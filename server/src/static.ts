import { existsSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import { log } from './lib/log';

// 本檔在開發時位於 server/src/，建置後被打包進 server/dist/index.js；
// 兩者都在 server/ 下一層，因此往上一層即為 server 套件根目錄。
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(serverRoot, 'public');
const drawGuessDist = resolve(serverRoot, '..', 'draw-guess', 'dist');

export function mountStatic(app: Express): void {
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/', (_req, res) => {
    res.sendFile(resolve(publicDir, 'index.html'));
  });

  if (!existsSync(resolve(drawGuessDist, 'index.html'))) {
    log.warn('static.missing', { dir: drawGuessDist, hint: '先執行 npm run build（開發時請走 Vite：http://localhost/draw-guess/）' });
  }

  app.use('/draw-guess', express.static(drawGuessDist));

  // SPA fallback：無副檔名的路徑回 index.html；帶副檔名（找不到的資源檔）回 404
  app.get('/draw-guess/{*splat}', (req, res) => {
    if (extname(req.path) !== '') {
      res.sendStatus(404);
      return;
    }
    res.sendFile(resolve(drawGuessDist, 'index.html'), (err) => {
      if (err && !res.headersSent) res.sendStatus(404);
    });
  });
}
