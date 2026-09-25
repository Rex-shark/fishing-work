// 區網可達：spec/architecture.md §3「區網可達」
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

/** 列舉本機所有非內部（非 loopback）IPv4 位址，依介面名稱排序（en0 會排在前面） */
export function lanIPv4Addresses(ifaces: Interfaces = networkInterfaces()): string[] {
  const out: string[] = [];
  for (const name of Object.keys(ifaces).sort()) {
    for (const info of ifaces[name] ?? []) {
      // Node 18.0–18.3 曾以數字 4 表示 family，兩者都接受
      const family: unknown = info.family;
      if ((family === 'IPv4' || family === 4) && !info.internal && !out.includes(info.address)) {
        out.push(info.address);
      }
    }
  }
  return out;
}

/** 綁定位址是否為「所有介面」 */
export function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '';
}

/** http 網址：80 埠不顯示埠號（spec §3），其他埠照印；IPv6 位址加中括號 */
export function httpUrl(host: string, port: number, path: string): string {
  const h = host.includes(':') ? `[${host}]` : host;
  return `http://${h}${port === 80 ? '' : `:${port}`}${path}`;
}

/** 同事可開的分享網址：綁所有介面時列出每個區網 IP；綁特定位址時只列該位址 */
export function shareUrls(host: string, port: number, path: string, ifaces?: Interfaces): string[] {
  const hosts = isWildcardHost(host) ? lanIPv4Addresses(ifaces) : [host];
  return hosts.map((h) => httpUrl(h, port, path));
}

/** listen 失敗時給人看的提示（spec §3：EADDRINUSE → lsof 查占用者；EACCES → 改 PORT=8080 或提權）；其他錯誤回 null */
export function listenErrorHint(code: string | undefined, port: number): string | null {
  if (code === 'EADDRINUSE') {
    const devNote = port === 80 ? '。注意 npm run dev（Vite）與 npm start 都占 80，不能同時跑' : '';
    return `埠 ${port} 已被占用：用 \`lsof -nP -iTCP:${port}\` 查占用者，或改用其他埠（例如 PORT=8080 npm start）${devNote}`;
  }
  if (code === 'EACCES') {
    return `沒有權限綁定埠 ${port}：改用 PORT=8080 npm start，或提權（Linux 需 sudo 或 setcap；macOS 10.14 起一般使用者即可綁 80）`;
  }
  return null;
}

type Headers = Record<string, string | string[] | undefined>;

function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * log 用的客戶端位址（spec §3 外網可達）：經 Cloudflare Tunnel 時 socket 位址是 cloudflared（本機），
 * 因此優先取 CF-Connecting-IP，其次 X-Forwarded-For 的第一個位址，最後才用 socket 位址。
 * 只用於 log，不做任何授權判斷（標頭可被偽造）。
 */
export function clientAddress(headers: Headers, socketAddress: string | undefined): string | undefined {
  const cf = firstHeader(headers['cf-connecting-ip'])?.trim();
  if (cf) return cf;
  const xff = firstHeader(headers['x-forwarded-for'])?.split(',')[0]?.trim();
  if (xff) return xff;
  return socketAddress;
}
