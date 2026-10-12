import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  GAME_LABELS,
  containerHint,
  gameLabel,
  gameUrls,
  gamesField,
  isInContainer,
  publicShare,
  publicUrl,
  shareLog,
} from '../src/lib/shareLog';

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
const games = [
  { key: 'draw-guess', path: '/draw-guess/' },
  { key: 'draw-contest', path: '/draw-contest/' },
];
const base = { host: '0.0.0.0', port: 80, games };

const CONTAINER_HINT =
  '請用主機的區網 IP：http://<主機 IP>:<對外埠>/（遊戲清單；我畫你猜 /draw-guess/、繪圖比賽 /draw-contest/），或設定 PUBLIC_URL';

describe('分享網址 log（spec §3 區網可達、Docker 部署；2026-10-12 改印遊戲清單）', () => {
  it('非容器、沒設 PUBLIC_URL：share 為每個區網 IP 的根網址，local 為 localhost 根網址，games 列兩款完整網址', () => {
    const out = shareLog({ ...base, env: {}, ifaces: lan });
    expect(out).toEqual({
      level: 'info',
      event: 'server.lan',
      fields: {
        share: ['http://192.168.1.23/'],
        local: 'http://localhost/',
        games: {
          'draw-guess': ['http://192.168.1.23/draw-guess/'],
          'draw-contest': ['http://192.168.1.23/draw-contest/'],
        },
      },
    });
    // 欄位順序：先遊戲清單再列每款遊戲（log 是 JSON 一行，順序就是 Rex 看到的順序）
    expect(Object.keys(out.fields)).toEqual(['share', 'local', 'games']);
    expect(Object.keys(out.fields.games as object)).toEqual(['draw-guess', 'draw-contest']);
  });

  it('非 80 埠、多個區網 IP：share／games 逐一對應、保留埠號', () => {
    const two = { ...lan, en1: [v4('10.0.0.8')] };
    const out = shareLog({ ...base, port: 8080, env: {}, ifaces: two });
    expect(out.fields.share).toEqual(['http://192.168.1.23:8080/', 'http://10.0.0.8:8080/']);
    expect(out.fields.local).toBe('http://localhost:8080/');
    expect(out.fields.games).toEqual({
      'draw-guess': ['http://192.168.1.23:8080/draw-guess/', 'http://10.0.0.8:8080/draw-guess/'],
      'draw-contest': ['http://192.168.1.23:8080/draw-contest/', 'http://10.0.0.8:8080/draw-contest/'],
    });
  });

  it('非容器、找不到區網 IP：warn server.lan.none，local 為根網址，不帶 games', () => {
    const out = shareLog({ ...base, port: 8080, env: {}, ifaces: { lo0: [v4('127.0.0.1', true)] } });
    expect(out).toEqual({
      level: 'warn',
      event: 'server.lan.none',
      fields: {
        hint: '找不到任何區網 IPv4：確認已連上 Wi-Fi／有線網路，同事才連得到',
        local: 'http://localhost:8080/',
      },
    });
  });

  it('非容器、綁特定位址：只列該位址', () => {
    const out = shareLog({ ...base, host: '127.0.0.1', port: 3000, env: {}, ifaces: lan });
    expect(out.fields.share).toEqual(['http://127.0.0.1:3000/']);
    expect(out.fields.games).toEqual({
      'draw-guess': ['http://127.0.0.1:3000/draw-guess/'],
      'draw-contest': ['http://127.0.0.1:3000/draw-contest/'],
    });
  });

  it('容器內沒設 PUBLIC_URL：不印 172.x，改印遊戲清單提示（文案逐字依 spec）', () => {
    const out = shareLog({ ...base, env: { IN_CONTAINER: '1' }, ifaces: docker });
    expect(out).toEqual({ level: 'info', event: 'server.lan.container', fields: { hint: CONTAINER_HINT } });
    expect(JSON.stringify(out)).not.toContain('172.');
  });

  it('容器內有設 PUBLIC_URL（舊值：我畫你猜完整網址）：share 為其 origin 根網址，不印 local，games 由同一 origin 推出', () => {
    const out = shareLog({
      ...base,
      env: { IN_CONTAINER: '1', PUBLIC_URL: ' http://192.168.1.50:8080/draw-guess/ ' },
      ifaces: docker,
    });
    expect(out).toEqual({
      level: 'info',
      event: 'server.lan',
      fields: {
        share: ['http://192.168.1.50:8080/'],
        games: {
          'draw-guess': ['http://192.168.1.50:8080/draw-guess/'],
          'draw-contest': ['http://192.168.1.50:8080/draw-contest/'],
        },
        source: 'PUBLIC_URL',
      },
    });
    expect(Object.keys(out.fields)).toEqual(['share', 'games', 'source']);
  });

  it('非容器有設 PUBLIC_URL（根網址、tunnel https）：保留 local，欄位順序 share → local → games → source', () => {
    const out = shareLog({ ...base, env: { PUBLIC_URL: 'https://x.trycloudflare.com/' }, ifaces: lan });
    expect(out.fields).toEqual({
      share: ['https://x.trycloudflare.com/'],
      local: 'http://localhost/',
      games: {
        'draw-guess': ['https://x.trycloudflare.com/draw-guess/'],
        'draw-contest': ['https://x.trycloudflare.com/draw-contest/'],
      },
      source: 'PUBLIC_URL',
    });
    expect(Object.keys(out.fields)).toEqual(['share', 'local', 'games', 'source']);
  });

  it('PUBLIC_URL 不是合法網址：share 原樣印、games 各鍵為空陣列，不拋錯', () => {
    const out = shareLog({ ...base, env: { PUBLIC_URL: '192.168.1.50/draw-guess/' }, ifaces: lan });
    expect(out.event).toBe('server.lan');
    expect(out.fields.share).toEqual(['192.168.1.50/draw-guess/']);
    expect(out.fields.games).toEqual({ 'draw-guess': [], 'draw-contest': [] });
    expect(out.fields.source).toBe('PUBLIC_URL');
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
});

describe('分享網址 log 的純函式', () => {
  it('publicShare：取 origin 補 /（80／443 預設埠不帶埠號；舊的 /draw-guess/ 值相容）；不合法時原樣回傳', () => {
    expect(publicShare('http://192.168.1.50/draw-guess/')).toBe('http://192.168.1.50/');
    expect(publicShare('http://192.168.1.50:80/draw-guess/')).toBe('http://192.168.1.50/');
    expect(publicShare('http://192.168.1.50:8080/')).toBe('http://192.168.1.50:8080/');
    expect(publicShare('http://192.168.1.50:8080')).toBe('http://192.168.1.50:8080/');
    expect(publicShare('https://x.trycloudflare.com/draw-contest/')).toBe('https://x.trycloudflare.com/');
    expect(publicShare('192.168.1.50/draw-guess/')).toBe('192.168.1.50/draw-guess/');
  });

  it('gameUrls：由每個 share origin 補路徑，略過無法解析的網址', () => {
    expect(gameUrls(['http://192.168.1.23/', 'http://10.0.0.8:8080/'], '/draw-contest/')).toEqual([
      'http://192.168.1.23/draw-contest/',
      'http://10.0.0.8:8080/draw-contest/',
    ]);
    expect(gameUrls(['not a url', 'http://a.b/'], '/draw-guess/')).toEqual(['http://a.b/draw-guess/']);
    expect(gameUrls([], '/draw-guess/')).toEqual([]);
  });

  it('gamesField：鍵依傳入順序、值為該遊戲的完整網址陣列', () => {
    const out = gamesField(['http://192.168.1.23/'], games);
    expect(Object.keys(out)).toEqual(['draw-guess', 'draw-contest']);
    expect(out['draw-contest']).toEqual(['http://192.168.1.23/draw-contest/']);
    expect(gamesField(['http://192.168.1.23/'], [])).toEqual({});
  });

  it('遊戲名稱對照：draw-guess → 我畫你猜、draw-contest → 繪圖比賽；未知 key 退回 key', () => {
    expect(GAME_LABELS).toEqual({ 'draw-guess': '我畫你猜', 'draw-contest': '繪圖比賽' });
    expect(gameLabel('draw-guess')).toBe('我畫你猜');
    expect(gameLabel('draw-contest')).toBe('繪圖比賽');
    expect(gameLabel('new-game')).toBe('new-game');
  });

  it('containerHint：依遊戲順序組字、以「、」分隔；沒有遊戲時只印遊戲清單', () => {
    expect(containerHint(games)).toBe(CONTAINER_HINT);
    expect(containerHint([games[1], games[0]])).toBe(
      '請用主機的區網 IP：http://<主機 IP>:<對外埠>/（遊戲清單；繪圖比賽 /draw-contest/、我畫你猜 /draw-guess/），或設定 PUBLIC_URL',
    );
    expect(containerHint([])).toBe('請用主機的區網 IP：http://<主機 IP>:<對外埠>/（遊戲清單），或設定 PUBLIC_URL');
  });
});
