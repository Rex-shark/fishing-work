// e2e 協定測試工具：起真正的 server（隨機埠、127.0.0.1），以 socket.io-client 打 /draw-guess
import { vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import {
  DRAW_GUESS_NAMESPACE,
  type Ack,
  type ClientToServerEvents,
  type JoinResult,
  type ServerToClientEvents,
} from '@fishing-work/shared';
import { createApp, type App, type AppOptions } from '../../src/app';

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface TestServer {
  app: App;
  url: string;
  /** 連線並等到 connect；測試結束時由 stop() 一併斷開 */
  connect(): Promise<ClientSocket>;
  stop(): Promise<void>;
}

/** 伺服器 log 是一行一筆 JSON，測試時靜音以免洗版 */
export function silenceLogs(): void {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

export async function startServer(options: AppOptions = {}): Promise<TestServer> {
  const app = createApp({ port: 0, host: '127.0.0.1', ...options });
  const { port } = await app.listen();
  const url = `http://127.0.0.1:${port}`;
  const sockets: ClientSocket[] = [];
  return {
    app,
    url,
    connect: async () => {
      const s: ClientSocket = io(`${url}${DRAW_GUESS_NAMESPACE}`, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });
      sockets.push(s);
      await once(s, 'connect');
      return s;
    },
    stop: async () => {
      for (const s of sockets) s.disconnect();
      await app.close();
    },
  };
}

/** 以任意參數送出事件（測試惡意／錯誤的 payload 用，繞過型別） */
export function rawEmit(s: ClientSocket, event: string, ...args: unknown[]): void {
  (s.emit as unknown as (ev: string, ...a: unknown[]) => void)(event, ...args);
}

/** 送出帶 ack 的事件並等待回覆 */
export function request<T = void>(s: ClientSocket, event: string, ...payload: unknown[]): Promise<Ack<T>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 3000);
    rawEmit(s, event, ...payload, (r: Ack<T>) => {
      clearTimeout(t);
      resolve(r);
    });
  });
}

export function join(s: ClientSocket, payload: unknown): Promise<Ack<JoinResult>> {
  return request<JoinResult>(s, 'player:join', payload);
}

/** join 並斷言成功 */
export async function joinOk(s: ClientSocket, nickname: string, token?: string): Promise<JoinResult> {
  const r = await join(s, token === undefined ? { nickname } : { nickname, token });
  if (!r.ok) throw new Error(`join 失敗：${r.error}`);
  return r.data;
}

export function once<T extends unknown[] = unknown[]>(s: ClientSocket, event: string, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting ${event}`)), ms);
    (s.once as unknown as (ev: string, fn: (...a: unknown[]) => void) => void)(event, (...a: unknown[]) => {
      clearTimeout(t);
      resolve(a as T);
    });
  });
}

/** 持續收集某事件的第一個參數 */
export function collect<T>(s: ClientSocket, event: string): T[] {
  const out: T[] = [];
  (s.on as unknown as (ev: string, fn: (p: T) => void) => void)(event, (p: T) => out.push(p));
  return out;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 輪詢直到條件成立（預設 3 秒逾時） */
export async function waitFor(cond: () => boolean, ms = 3000, label = 'condition'): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`waitFor timeout: ${label}`);
    await sleep(10);
  }
}
