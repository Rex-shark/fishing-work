// 伺服器工廠：建立 Express + http server + Socket.IO，註冊各遊戲 namespace。
// index.ts 只負責讀環境變數、呼叫本工廠並 listen；e2e 測試以隨機埠與較短的計時直接呼叫。
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Server } from 'socket.io';
import {
  DRAW_GUESS_NAMESPACE,
  MAX_IMAGE_BYTES,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@fishing-work/shared';
import { registerDrawGuess, type PendingBytesOf } from './games/draw-guess/register';
import type { Clock, Room, RoomDurations } from './games/draw-guess/room';
import { mountStatic } from './static';

export interface AppOptions {
  /** 預設 80（spec §3）；0 = 隨機埠（測試用） */
  port?: number;
  /** 預設 0.0.0.0（所有介面，spec §3 區網可達） */
  host?: string;
  /** 注入時鐘（測試用） */
  clock?: Clock;
  /** 覆寫回合／寬限期長度（測試用；正式環境一律用 shared 常數） */
  durations?: Partial<RoomDurations>;
  /** 覆寫 Socket.IO 心跳（e2e 驗證死連線偵測用）；正式環境一律用預設 PING_INTERVAL_MS／PING_TIMEOUT_MS */
  ping?: { interval?: number; timeout?: number };
  /** 覆寫 chat:image 慢連線保護的待送量查詢（e2e 模擬慢連線用；預設讀 engine.io／ws 的待送佇列） */
  pendingBytesOf?: PendingBytesOf;
}

/** spec §3：Socket.IO 心跳間隔 */
export const PING_INTERVAL_MS = 10_000;
/**
 * spec §3：心跳逾時。2026-09-25 由 5000 放寬為 30000：ping 封包排在待送的大圖之後，
 * 2 MiB/s 的連線收一張 10 MB 就要 5 秒，原設定會誤判斷線；最壞積壓約 32 MiB（略過門檻 + 一張）
 * 在設計下限 2 MiB/s 下約 16 秒，壓測實測最慢 19.2 秒，20 秒餘裕不足故再放寬到 30 秒。
 * 代價：死連線最慢 40 秒才判定（加 15 秒寬限期，名額與畫師身分最慢 55 秒釋出，仍在 90 秒回合內）
 */
export const PING_TIMEOUT_MS = 30_000;

export interface App {
  httpServer: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  drawGuessRoom: Room;
  /** 開始監聽，回傳實際綁定的位址與埠 */
  listen(): Promise<{ host: string; port: number }>;
  /** 斷開所有連線、關閉 http server、清掉房間計時器 */
  close(): Promise<void>;
}

export function createApp(options: AppOptions = {}): App {
  const port = options.port ?? 80;
  const host = options.host ?? '0.0.0.0';

  const app = express();
  // spec §3 外網可達：經 Cloudflare Tunnel 時由 X-Forwarded-* 還原客戶端位址與協定
  app.set('trust proxy', true);
  mountStatic(app);

  const httpServer = createServer(app);
  // spec §3：死連線最慢 pingInterval + pingTimeout（40 秒）判定斷線（pingTimeout 放寬的原因見 PING_TIMEOUT_MS）；
  // 聊天圖片最大 MAX_IMAGE_BYTES，另留 64 KiB 給封包其餘部分（預設 1 MB 會讓傳圖直接斷線，Epic 2）
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    maxHttpBufferSize: MAX_IMAGE_BYTES + 65_536,
    pingInterval: options.ping?.interval ?? PING_INTERVAL_MS,
    pingTimeout: options.ping?.timeout ?? PING_TIMEOUT_MS,
  });

  const drawGuessRoom = registerDrawGuess(io.of(DRAW_GUESS_NAMESPACE), {
    clock: options.clock,
    durations: options.durations,
    pendingBytesOf: options.pendingBytesOf,
  });

  return {
    httpServer,
    io,
    drawGuessRoom,
    listen: () =>
      new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject);
          const addr = httpServer.address() as AddressInfo;
          resolve({ host, port: addr.port });
        });
      }),
    close: () =>
      new Promise((resolve) => {
        drawGuessRoom.dispose();
        // io.close() 會斷開所有 socket 並關閉底層 http server
        io.close(() => resolve());
      }),
  };
}
