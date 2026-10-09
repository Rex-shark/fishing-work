// server 的 Vitest 設定：評分器隔離（Epic 14 Phase 3）
// JUDGE 預設為 ollama，而 Rex 本機 127.0.0.1:11434 真的在跑 Clef。測試若沒注入評分器（例：draw-guess 的 e2e
// 以 createApp() 起整個 server，draw-contest namespace 會走 judgeSetupFromEnv），就可能對真模型探測或評分。
// 這裡把整個測試程序的預設改成 random，並把 OLLAMA_URL 指到不可能連上的 127.0.0.1:1，雙重保險。
// 要測 ollama 路徑的測試一律注入 fetch 或連 user/mock/systemone.mjs，不讀這兩個變數。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      JUDGE: 'random',
      OLLAMA_URL: 'http://127.0.0.1:1',
    },
  },
});
