import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { containerHint, isInContainer, publicUrl, shareLog } from '../src/lib/shareLog';
import { containerHintWithContest, contestUrls } from '../src/lib/shareLog';

const v4 = (address: string, internal = false): NetworkInterfaceInfo => ({
  address,
  netmask: '255.255.255.0',
  family: 'IPv4',
  mac: '00:00:00:00:00:00',
  internal,
  cidr: `${address}/24`,
});

const lan = { lo0: [v4('127.0.0.1', true)], en0: [v4('192.168.1.23')] };
const docker = { lo: [v4('127.0.0.1', true)], eth0: [v4('172.17.0.2')] };
const base = { host: '0.0.0.0', port: 80, path: '/draw-guess/' };

describe('分享網址 log（spec §3 區網可達、Docker 部署）', () => {
  it('非容器、沒設 PUBLIC_URL：行為不變，列出每個區網 IP 與 local', () => {
    expect(shareLog({ ...base, env: {}, ifaces: lan })).toEqual({
      level: 'info',
      event: 'server.lan',
      fields: { share: ['http://192.168.1.23/draw-guess/'], local: 'http://localhost/draw-guess/' },
    });
  });

  it('非容器、找不到區網 IP：warn server.lan.none', () => {
    const out = shareLog({ ...base, port: 8080, env: {}, ifaces: { lo0: [v4('127.0.0.1', true)] } });
    expect(out.level).toBe('warn');
    expect(out.event).toBe('server.lan.none');
    expect(out.fields.local).toBe('http://localhost:8080/draw-guess/');
  });

  it('非容器、綁特定位址：只列該位址', () => {
    const out = shareLog({ ...base, host: '127.0.0.1', port: 3000, env: {}, ifaces: lan });
    expect(out.fields.share).toEqual(['http://127.0.0.1:3000/draw-guess/']);
  });

  it('容器內沒設 PUBLIC_URL：不印 172.x，改印提示', () => {
    const out = shareLog({ ...base, env: { IN_CONTAINER: '1' }, ifaces: docker });
    expect(out).toEqual({
      level: 'info',
      event: 'server.lan.container',
      fields: { hint: '請用主機的區網 IP：http://<主機 IP>:<對外埠>/draw-guess/，或設定 PUBLIC_URL' },
    });
    expect(JSON.stringify(out)).not.toContain('172.');
  });

  it('容器內有設 PUBLIC_URL：只印 PUBLIC_URL（去頭尾空白）', () => {
    const out = shareLog({
      ...base,
      env: { IN_CONTAINER: '1', PUBLIC_URL: ' http://192.168.1.50/draw-guess/ ' },
      ifaces: docker,
    });
    expect(out).toEqual({
      level: 'info',
      event: 'server.lan',
      fields: { share: ['http://192.168.1.50/draw-guess/'], source: 'PUBLIC_URL' },
    });
  });

  it('非容器有設 PUBLIC_URL：印 PUBLIC_URL，保留 local', () => {
    const out = shareLog({ ...base, env: { PUBLIC_URL: 'https://x.trycloudflare.com/draw-guess/' }, ifaces: lan });
    expect(out.fields).toEqual({
      share: ['https://x.trycloudflare.com/draw-guess/'],
      source: 'PUBLIC_URL',
      local: 'http://localhost/draw-guess/',
    });
  });

  it('PUBLIC_URL 為空字串或只有空白：視為未設', () => {
    expect(publicUrl({ PUBLIC_URL: '' })).toBeNull();
    expect(publicUrl({ PUBLIC_URL: '   ' })).toBeNull();
    expect(publicUrl({})).toBeNull();
    expect(shareLog({ ...base, env: { IN_CONTAINER: '1', PUBLIC_URL: '' }, ifaces: docker }).event).toBe(
      'server.lan.container',
    );
  });

  it('IN_CONTAINER：1／true 為開，其他（含未設、0、空字串）為關', () => {
    expect(isInContainer({ IN_CONTAINER: '1' })).toBe(true);
    expect(isInContainer({ IN_CONTAINER: 'true' })).toBe(true);
    expect(isInContainer({ IN_CONTAINER: '0' })).toBe(false);
    expect(isInContainer({ IN_CONTAINER: '' })).toBe(false);
    expect(isInContainer({})).toBe(false);
  });

  it('containerHint 依路徑組字', () => {
    expect(containerHint('/draw-guess/')).toBe('請用主機的區網 IP：http://<主機 IP>:<對外埠>/draw-guess/，或設定 PUBLIC_URL');
  });
});

describe('分享網址 log：第二款遊戲繪圖比賽（Epic 14，spec §3）', () => {
  const contest = { ...base, contestPath: '/draw-contest/' };
  const games = ['/draw-guess/', '/draw-contest/'];

  it('非容器、沒設 PUBLIC_URL：share／local 不變，另加 shareContest 與 games', () => {
    expect(shareLog({ ...contest, env: {}, ifaces: lan })).toEqual({
      level: 'info',
      event: 'server.lan',
      fields: {
        share: ['http://192.168.1.23/draw-guess/'],
        local: 'http://localhost/draw-guess/',
        shareContest: ['http://192.168.1.23/draw-contest/'],
        games,
      },
    });
  });

  it('非 80 埠、多個區網 IP：shareContest 逐一對應、保留埠號', () => {
    const two = { ...lan, en1: [v4('10.0.0.8')] };
    const out = shareLog({ ...contest, port: 8080, env: {}, ifaces: two });
    expect(out.fields.share).toEqual(['http://192.168.1.23:8080/draw-guess/', 'http://10.0.0.8:8080/draw-guess/']);
    expect(out.fields.shareContest).toEqual([
      'http://192.168.1.23:8080/draw-contest/',
      'http://10.0.0.8:8080/draw-contest/',
    ]);
  });

  it('容器內有設 PUBLIC_URL：PUBLIC_URL 仍是我畫你猜的網址，shareContest 由 origin 推出', () => {
    const out = shareLog({
      ...contest,
      env: { IN_CONTAINER: '1', PUBLIC_URL: ' http://192.168.1.50:8080/draw-guess/ ' },
      ifaces: docker,
    });
    expect(out).toEqual({
      level: 'info',
      event: 'server.lan',
      fields: {
        share: ['http://192.168.1.50:8080/draw-guess/'],
        source: 'PUBLIC_URL',
        shareContest: ['http://192.168.1.50:8080/draw-contest/'],
        games,
      },
    });
  });

  it('非容器有設 PUBLIC_URL（tunnel）：保留 local，shareContest 取 https origin', () => {
    const out = shareLog({ ...contest, env: { PUBLIC_URL: 'https://x.trycloudflare.com/draw-guess/' }, ifaces: lan });
    expect(out.fields).toEqual({
      share: ['https://x.trycloudflare.com/draw-guess/'],
      source: 'PUBLIC_URL',
      local: 'http://localhost/draw-guess/',
      shareContest: ['https://x.trycloudflare.com/draw-contest/'],
      games,
    });
  });

  it('PUBLIC_URL 不是合法網址：share 照印，shareContest 為空陣列，不拋錯', () => {
    const out = shareLog({ ...contest, env: { PUBLIC_URL: '192.168.1.50/draw-guess/' }, ifaces: lan });
    expect(out.fields.share).toEqual(['192.168.1.50/draw-guess/']);
    expect(out.fields.shareContest).toEqual([]);
    expect(contestUrls(['not a url', 'http://a.b/draw-guess/'], '/draw-contest/')).toEqual(['http://a.b/draw-contest/']);
  });

  it('容器內沒設 PUBLIC_URL：提示加一句「繪圖比賽為 /draw-contest/」，仍不印 172.x', () => {
    const out = shareLog({ ...contest, env: { IN_CONTAINER: '1' }, ifaces: docker });
    expect(out).toEqual({
      level: 'info',
      event: 'server.lan.container',
      fields: {
        hint: '請用主機的區網 IP：http://<主機 IP>:<對外埠>/draw-guess/，或設定 PUBLIC_URL；繪圖比賽為 /draw-contest/',
      },
    });
    expect(JSON.stringify(out)).not.toContain('172.');
    expect(containerHintWithContest('/draw-guess/')).toBe(containerHint('/draw-guess/'));
  });

  it('找不到區網 IP：server.lan.none 不受影響（不加 games）', () => {
    const out = shareLog({ ...contest, env: {}, ifaces: { lo0: [v4('127.0.0.1', true)] } });
    expect(out).toEqual({
      level: 'warn',
      event: 'server.lan.none',
      fields: {
        hint: '找不到任何區網 IPv4：確認已連上 Wi-Fi／有線網路，同事才連得到',
        local: 'http://localhost/draw-guess/',
      },
    });
  });
});
