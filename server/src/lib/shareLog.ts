// 啟動時的分享網址 log：spec/architecture.md §3「區網可達」與「Docker 部署」
import type { NetworkInterfaceInfo } from 'node:os';
import type { LogFields } from './log';
import { httpUrl, isWildcardHost, shareUrls } from './network';

type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

export interface ShareLogInput {
  host: string;
  port: number;
  path: string;
  /**
   * 第二款遊戲（繪圖比賽）的路徑，例如 '/draw-contest/'（Epic 14）。
   * 有給才在 `server.lan` 加 `games`／`shareContest`、容器提示加一句；省略時輸出與 Epic 9 完全相同。
   */
  contestPath?: string;
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

/** 容器內沒設 PUBLIC_URL 時的提示（文案依 spec §3「Docker 部署」） */
export function containerHint(path: string): string {
  return `請用主機的區網 IP：http://<主機 IP>:<對外埠>${path}，或設定 PUBLIC_URL`;
}

/** 容器提示補一句第二款遊戲的路徑（Epic 14）；沒有第二款時原樣回傳 */
export function containerHintWithContest(path: string, contestPath?: string): string {
  const hint = containerHint(path);
  return contestPath ? `${hint}；繪圖比賽為 ${contestPath}` : hint;
}

/**
 * 由分享網址的 origin 推出另一款遊戲的網址：`http://192.168.1.23/draw-guess/` + `/draw-contest/`
 * → `http://192.168.1.23/draw-contest/`（PUBLIC_URL 仍是我畫你猜的完整網址，語意不變）。
 * 不是合法網址（例如 PUBLIC_URL 打錯）時略過，不讓啟動 log 拋錯。
 */
export function contestUrls(share: string[], contestPath: string): string[] {
  const out: string[] = [];
  for (const u of share) {
    try {
      out.push(`${new URL(u).origin}${contestPath}`);
    } catch {
      // 略過無法解析的網址
    }
  }
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
 * 決定啟動時要印哪一筆分享網址 log（純函式，不直接寫 log）：
 * 1. 有 PUBLIC_URL → 只印它（`server.lan`，`source: 'PUBLIC_URL'`）。
 * 2. 沒設且 IN_CONTAINER=1 → 不列容器內的 172.x 位址，改印提示（`server.lan.container`）。
 * 3. 其他（非容器）→ 行為不變：列出每個區網 IP；綁所有介面卻找不到區網 IP 時 warn（`server.lan.none`）。
 */
export function shareLog({ host, port, path, contestPath, env, ifaces }: ShareLogInput): ShareLog {
  const inContainer = isInContainer(env);
  // 容器內的 localhost:<容器埠> 對主機不一定成立（對外埠可能不同），容器模式不印 local
  const local = httpUrl('localhost', port, path);
  const pub = publicUrl(env);
  // Epic 14：有第二款遊戲時，server.lan 加 games 與 shareContest（既有 share／local／source 不變）
  const contest = (share: string[]): LogFields =>
    contestPath ? { shareContest: contestUrls(share, contestPath), games: [path, contestPath] } : {};

  if (pub) {
    return {
      level: 'info',
      event: 'server.lan',
      fields: inContainer
        ? { share: [pub], source: 'PUBLIC_URL', ...contest([pub]) }
        : { share: [pub], source: 'PUBLIC_URL', local, ...contest([pub]) },
    };
  }

  if (inContainer) {
    return {
      level: 'info',
      event: 'server.lan.container',
      fields: { hint: containerHintWithContest(path, contestPath) },
    };
  }

  const urls = shareUrls(host, port, path, ifaces);
  if (isWildcardHost(host) && urls.length === 0) {
    return {
      level: 'warn',
      event: 'server.lan.none',
      fields: { hint: '找不到任何區網 IPv4：確認已連上 Wi-Fi／有線網路，同事才連得到', local },
    };
  }
  return { level: 'info', event: 'server.lan', fields: { share: urls, local, ...contest(urls) } };
}
