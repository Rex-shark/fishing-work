import { defineConfig } from 'tsup';

// 建置成單一 dist/index.js；@fishing-work/shared 為 .ts 原始碼，必須打包進來
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: ['@fishing-work/shared'],
});
