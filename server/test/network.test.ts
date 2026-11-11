import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PORT, clientAddress, httpUrl, isWildcardHost, lanIPv4Addresses, listenErrorHint, readPort, shareUrls } from '../src/lib/network';

const v4 = (address: string, internal = false): NetworkInterfaceInfo => ({
  address,
  netmask: '255.255.255.0',
  family: 'IPv4',
  mac: '00:00:00:00:00:00',
  internal,
  cidr: `${address}/24`,
});
const v6 = (address: string): NetworkInterfaceInfo => ({
  address,
  netmask: 'ffff:ffff:ffff:ffff::',
  family: 'IPv6',
  mac: '00:00:00:00:00:00',
  internal: false,
  cidr: `${address}/64`,
  scopeid: 0,
});

const ifaces = {
  lo0: [v4('127.0.0.1', true)],
  en0: [v6('fe80::1'), v4('192.168.1.23')],
  utun3: [v4('10.8.0.2')],
  bridge0: [v4('192.168.1.23')],
};

describe('區網 IP 列舉（spec §3 區網可達）', () => {
  it('只列非內部 IPv4、去重、依介面名稱排序', () => {
    expect(lanIPv4Addresses(ifaces)).toEqual(['192.168.1.23', '10.8.0.2']);
  });

  it('沒有任何區網介面 → 空陣列', () => {
    expect(lanIPv4Addresses({ lo0: [v4('127.0.0.1', true)] })).toEqual([]);
  });

  it('family 為數字 4（舊版 Node）也接受', () => {
    const legacy = { ...v4('192.168.0.5'), family: 4 } as unknown as NetworkInterfaceInfo;
    expect(lanIPv4Addresses({ en0: [legacy] })).toEqual(['192.168.0.5']);
  });

  it('shareUrls：綁 0.0.0.0 時每個區網 IP 一個網址；綁特定位址時只列該位址', () => {
    expect(shareUrls('0.0.0.0', 3000, '/draw-guess/', ifaces)).toEqual([
      'http://192.168.1.23:3000/draw-guess/',
      'http://10.8.0.2:3000/draw-guess/',
    ]);
    expect(shareUrls('192.168.1.23', 8080, '/draw-guess/', ifaces)).toEqual(['http://192.168.1.23:8080/draw-guess/']);
    expect(shareUrls('::1', 3000, '/', ifaces)).toEqual(['http://[::1]:3000/']);
  });

  it('shareUrls：80 埠不顯示埠號（spec §3），其他埠照印', () => {
    expect(shareUrls('0.0.0.0', 80, '/draw-guess/', ifaces)).toEqual([
      'http://192.168.1.23/draw-guess/',
      'http://10.8.0.2/draw-guess/',
    ]);
    expect(shareUrls('192.168.1.23', 80, '/draw-guess/', ifaces)).toEqual(['http://192.168.1.23/draw-guess/']);
    expect(shareUrls('::1', 80, '/', ifaces)).toEqual(['http://[::1]/']);
    expect(shareUrls('0.0.0.0', 8080, '/draw-guess/', ifaces)[0]).toBe('http://192.168.1.23:8080/draw-guess/');
  });

  it('httpUrl：80 省略埠號；IPv6 加中括號', () => {
    expect(httpUrl('localhost', 80, '/draw-guess/')).toBe('http://localhost/draw-guess/');
    expect(httpUrl('localhost', 3000, '/draw-guess/')).toBe('http://localhost:3000/draw-guess/');
    expect(httpUrl('fe80::1', 443, '/')).toBe('http://[fe80::1]:443/');
  });

  it('isWildcardHost', () => {
    expect(isWildcardHost('0.0.0.0')).toBe(true);
    expect(isWildcardHost('::')).toBe(true);
    expect(isWildcardHost('127.0.0.1')).toBe(false);
  });
});

describe('clientAddress（spec §3 外網可達：log 位址）', () => {
  it('優先 CF-Connecting-IP', () => {
    expect(clientAddress({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' }, '127.0.0.1')).toBe('1.2.3.4');
  });
  it('其次 X-Forwarded-For 的第一個位址', () => {
    expect(clientAddress({ 'x-forwarded-for': ' 5.6.7.8 , 9.9.9.9' }, '127.0.0.1')).toBe('5.6.7.8');
  });
  it('都沒有時用 socket 位址；空字串標頭視為沒有', () => {
    expect(clientAddress({ 'cf-connecting-ip': '', 'x-forwarded-for': '' }, '::ffff:192.168.1.5')).toBe('::ffff:192.168.1.5');
    expect(clientAddress({}, undefined)).toBeUndefined();
  });
});

describe('listenErrorHint（spec §3：啟動失敗提示）', () => {
  it('EADDRINUSE → 提示 lsof 查占用者或改 PORT；80 埠另提醒 dev 與 start 不能同時跑', () => {
    const h80 = listenErrorHint('EADDRINUSE', 80);
    expect(h80).toContain('lsof -nP -iTCP:80');
    expect(h80).toContain('PORT=');
    expect(h80).toContain('不能同時跑');
    const h3000 = listenErrorHint('EADDRINUSE', 3000);
    expect(h3000).toContain('lsof -nP -iTCP:3000');
    expect(h3000).not.toContain('不能同時跑');
  });
  it('EACCES → 提示改 PORT=8080 或提權', () => {
    const h = listenErrorHint('EACCES', 80);
    expect(h).toContain('PORT=8080');
    expect(h).toContain('提權');
  });
  it('其他錯誤 → null', () => {
    expect(listenErrorHint('ENOTFOUND', 80)).toBeNull();
    expect(listenErrorHint(undefined, 80)).toBeNull();
  });
});

describe('readPort（spec §9.1，Epic 21 決策 8；code review #10）', () => {
  const run = (value: string | undefined) => {
    const warns: [string, Record<string, unknown> | undefined][] = [];
    const env: NodeJS.ProcessEnv = value === undefined ? {} : { PORT: value };
    const port = readPort(env, (event, fields) => warns.push([event, fields]));
    return { port, warns };
  };

  it('未設 → 80，不 warn', () => {
    expect(run(undefined)).toEqual({ port: 80, warns: [] });
    expect(DEFAULT_PORT).toBe(80);
  });

  it.each(['3100', '80', '1', '65535', ' 7180 '])('合法 %j → 該整數，不 warn', (v) => {
    const { port, warns } = run(v);
    expect(port).toBe(Number(v.trim()));
    expect(warns).toEqual([]);
  });

  it.each(['', '   ', 'abc', '80.5', '0', '-1', '65536', '1e9', 'NaN', 'Infinity', '0x50', '1e3', '+80', '８０'])('不合法 %j → 80 並 warn', (v) => {
    const { port, warns } = run(v);
    expect(port).toBe(80);
    expect(warns).toEqual([['server.envInvalid', { name: 'PORT', value: v, using: 80 }]]);
  });
});
