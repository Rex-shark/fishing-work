// 啟動時的分享網址 log：spec/architecture.md §3「區網可達」與「Docker 部署」
// 2026-10-12（海圖定案）：share 改印站台根網址（遊戲清單），games 另列每款遊戲的完整網址。
import type { NetworkInterfaceInfo } from 'node:os';
import type { LogFields } from './log';
import { httpUrl, isWildcardHost, shareUrls } from './network';

type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

/** 一款遊戲：key 為 log 的 games 鍵（也是靜態檔前綴），path 為該遊戲的路徑，例如 '/draw-guess/' */
export interface ShareGame {
  key: string;
  path: string;
}

export interface ShareLogInput {
  host: string;
  port: number;
  /** 要列在 `games` 的遊戲，依序印出（index.ts 傳我畫你猜、繪圖比賽） */
  games: ShareGame[];
  /** 只讀 PUBLIC_URL 與 IN_CONTAINER 兩個鍵 */
  env: Record<string, string | undefined>;
  /** 測試注入用；省略時讀本機網路介面 */
  ifaces?: Interfaces;
}

export interface ShareLog {
  level: 'info' | 'warn';
  event: string;
  fields: LogFields;
}

/** 站台根路徑（遊戲清單） */
const ROOT = '/';

/** 容器提示文案用的遊戲名稱對照（spec §3「Docker 部署」）；查不到時退回 key */
export const GAME_LABELS: Readonly<Record<string, string>> = {
  'draw-guess': '我畫你猜',
  'draw-contest': '繪圖比賽',
};

export function gameLabel(key: string): string {
  return GAME_LABELS[key] ?? key;
}

/**
 * 容器內沒設 PUBLIC_URL 時的提示（文案逐字依 spec §3「Docker 部署」）：
 * 「請用主機的區網 IP：http://<主機 IP>:<對外埠>/（遊戲清單；我畫你猜 /draw-guess/、繪圖比賽 /draw-contest/），或設定 PUBLIC_URL」
 */
export function containerHint(games: ShareGame[]): string {
  const list = games.map((g) => `${gameLabel(g.key)} ${g.path}`).join('、');
  const note = list ? `（遊戲清單；${list}）` : '（遊戲清單）';
  return `請用主機的區網 IP：http://<主機 IP>:<對外埠>${ROOT}${note}，或設定 PUBLIC_URL`;
}

/**
 * 由站台根網址推出某款遊戲的完整網址：`http://192.168.1.23/` + `/draw-guess/` → `http://192.168.1.23/draw-guess/`。
 * 不是合法網址（例如 PUBLIC_URL 打錯）時略過，不讓啟動 log 拋錯。
 */
export function gameUrls(share: string[], path: string): string[] {
  const out: string[] = [];
  for (const u of share) {
    try {
      out.push(`${new URL(u).origin}${path}`);
    } catch {
      // 略過無法解析的網址
    }
  }
  return out;
}

/** `server.lan` 的 `games` 欄位：鍵為遊戲 key、值為該遊戲在每個 share origin 下的完整網址 */
export function gamesField(share: string[], games: ShareGame[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const g of games) out[g.key] = gameUrls(share, g.path);
  return out;
}

/** IN_CONTAINER 是否開啟（Dockerfile 設 IN_CONTAINER=1；也接受 true） */
export function isInContainer(env: Record<string, string | undefined>): boolean {
  const v = env.IN_CONTAINER?.trim().toLowerCase();
  return v === '1' || v === 'true';
}

/** PUBLIC_URL：去頭尾空白；空字串視為未設（compose 未設時可能傳入空字串） */
export function publicUrl(env: Record<string, string | undefined>): string | null {
  const v = env.PUBLIC_URL?.trim();
  return v ? v : null;
}

/**
 * PUBLIC_URL ＝ 站台根網址：只取 origin 再補 `/`，所以舊值 `http://x/draw-guess/` 仍可用、印出 `http://x/`。
 * 不是合法網址時原樣回傳（share 照印、games 會是空陣列，不拋錯）。
 */
export function publicShare(pub: string): string {
  try {
    return `${new URL(pub).origin}${ROOT}`;
  } catch {
    return pub;
  }
}

/**
 * 決定啟動時要印哪一筆分享網址 log（純函式，不直接寫 log）。欄位依序 share → local → games → source：
 * 1. 有 PUBLIC_URL → share 為其 origin + '/'（`server.lan`，`source: 'PUBLIC_URL'`）。
 * 2. 沒設且 IN_CONTAINER=1 → 不列容器內的 172.x 位址、不印 local，改印提示（`server.lan.container`）。
 * 3. 其他（非容器）→ 列出每個區網 IP 的根網址；綁所有介面卻找不到區網 IP 時 warn（`server.lan.none`）。
 */
export function shareLog({ host, port, games, env, ifaces }: ShareLogInput): ShareLog {
  const inContainer = isInContainer(env);
  // 容器內的 localhost:<容器埠> 對主機不一定成立（對外埠可能不同），容器模式不印 local
  const local = httpUrl('localhost', port, ROOT);
  const pub = publicUrl(env);

  if (pub) {
    const share = [publicShare(pub)];
    return {
      level: 'info',
      event: 'server.lan',
      fields: inContainer
        ? { share, games: gamesField(share, games), source: 'PUBLIC_URL' }
        : { share, local, games: gamesField(share, games), source: 'PUBLIC_URL' },
    };
  }

  if (inContainer) {
    return { level: 'info', event: 'server.lan.container', fields: { hint: containerHint(games) } };
  }

  const share = shareUrls(host, port, ROOT, ifaces);
  if (isWildcardHost(host) && share.length === 0) {
    return {
      level: 'warn',
      event: 'server.lan.none',
      fields: { hint: '找不到任何區網 IPv4：確認已連上 Wi-Fi／有線網路，同事才連得到', local },
    };
  }
  return { level: 'info', event: 'server.lan', fields: { share, local, games: gamesField(share, games) } };
}
