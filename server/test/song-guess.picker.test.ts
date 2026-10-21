// 猜歌抽歌：spec/song-guess/architecture.md §4「答案判定」歌名去重、§5 choosing、§6 picker
// fixture 為真 iTunes 回應裁出的樣本（server/test/fixtures/song-guess.itunes.json；排行榜 song-guess.chart.json，Epic 18；
// 動漫熱門 song-guess.anime.json，Epic 19）。
import { describe, expect, it } from 'vitest';
import { ANIME_HOT_POOL, HOT_POOL, SONGS_PER_GAME, normalizeTitle } from '@fishing-work/shared/song-guess';
import {
  isLiveVersion,
  isSoundtrackOrCover,
  majorityArtist,
  mostFrequentArtist,
  pick,
  pickAnime,
  pickChart,
  topArtist,
  type PickedSong,
} from '../src/games/song-guess/picker';
import type { ItunesTrack } from '../src/games/song-guess/itunes';
import { animeFixtureMerged, chartFixtureTracks, fixtureTracks, seededRandom, track, type FixtureTerm } from './helpers/songGuess';

const N = SONGS_PER_GAME;

/** 以多組亂數抽很多次，收集所有被抽到過的歌（歌名正規化 → 那首歌）；同一歌名每次都應該是同一個版本 */
function poolOf(tracks: ItunesTrack[], artist: string, rounds = 200): Map<string, PickedSong> {
  const pool = new Map<string, PickedSong>();
  for (let seed = 1; seed <= rounds; seed++) {
    const picked = pick(tracks, artist, N, seededRandom(seed));
    if (picked === null) throw new Error('pick 回 null');
    for (const s of picked.songs) {
      const key = normalizeTitle(s.title);
      const prev = pool.get(key);
      if (prev !== undefined && prev.trackId !== s.trackId) throw new Error(`同一歌名抽到不同版本：${prev.title}／${s.title}`);
      pool.set(key, s);
    }
  }
  return pool;
}

function mustPick(term: FixtureTerm, artist: string = term, seed = 7) {
  const picked = pick(fixtureTracks(term), artist, N, seededRandom(seed));
  if (picked === null) throw new Error('pick 回 null');
  return picked;
}

describe('pick：基本', () => {
  it('孫燕姿：抽 5 首、各不相同、都有試聽、歌手名含輸入、topic 為正式名稱', () => {
    const { songs, topic } = mustPick('孫燕姿');
    expect(songs).toHaveLength(5);
    expect(topic).toBe('孫燕姿');
    expect(new Set(songs.map((s) => normalizeTitle(s.title))).size).toBe(5);
    for (const s of songs) {
      expect(s.artist).toContain('孫燕姿');
      expect(s.previewUrl).toMatch(/^https:\/\/audio-ssl\.itunes\.apple\.com\//);
      expect(s.artworkUrl).toMatch(/100x100bb\.jpg$/);
      expect(s.itunesUrl).toMatch(/^https:\/\/music\.apple\.com\//);
      expect(typeof s.album).toBe('string');
      expect(s.trackTimeMillis).toBeGreaterThan(30_000);
    }
  });

  it('可抽的歌＝過濾去重後的全部：孫燕姿樣本共 15 首（合唱曲算、別人 feat. 她的不算）', () => {
    const pool = poolOf(fixtureTracks('孫燕姿'), '孫燕姿');
    expect([...pool.keys()].sort()).toEqual(
      ['我不難過', '開始懂了', '我懷念的', '我也很想他', '遇見', '綠光', '原來你什麼都不要', '不是真的愛我', '逆光', '天黑黑', '第一天', '雨天', '原點', '樣子', '王子麵'].sort(),
    );
    // 吳青峰的 `(......醉鬼阿Q) [feat. 孫燕姿]`、五月天的 `溫柔 … (feat.孫燕姿)`、林俊傑的 `Stay With You …`：artistName 不含孫燕姿
    for (const s of pool.values()) expect(s.artist).toContain('孫燕姿');
  });

  it('輸入不分大小寫、全形、空白', () => {
    expect(pick(fixtureTracks('Taylor Swift'), 'ｔａｙｌｏｒ　ＳＷＩＦＴ', N, seededRandom(1))?.topic).toBe('Taylor Swift');
    expect(pick(fixtureTracks('Taylor Swift'), 'taylorswift', N, seededRandom(1))?.songs).toHaveLength(5);
  });

  it('不改動傳入的陣列', () => {
    const tracks = fixtureTracks('孫燕姿');
    const before = JSON.stringify(tracks);
    pick(tracks, '孫燕姿', N, seededRandom(3));
    expect(JSON.stringify(tracks)).toBe(before);
  });
});

describe('pick：歌手過濾', () => {
  it('告五人只留本人：搜尋結果混著周杰倫、五月天、動力火車、八三夭，一首都不會抽到', () => {
    const tracks = fixtureTracks('告五人');
    expect(tracks.some((t) => t.artistName === '周杰倫')).toBe(true);
    expect(tracks.some((t) => t.artistName === '五月天')).toBe(true);
    const pool = poolOf(tracks, '告五人');
    for (const s of pool.values()) expect(s.artist).toContain('告五人');
    expect(pool.has(normalizeTitle('聽媽媽的話'))).toBe(false);
    expect(pool.has(normalizeTitle('知足'))).toBe(false);
    expect(pool.has(normalizeTitle('我不該哭'))).toBe(false);
    expect(pool.has(normalizeTitle('不搖滾'))).toBe(false);
    expect(mustPick('告五人').topic).toBe('告五人');
  });

  it('告五人的「唯一」是本人的版本，不是五月天 feat. 告五人的同名歌', () => {
    expect(poolOf(fixtureTracks('告五人'), '告五人').get('唯一')).toMatchObject({
      artist: '告五人',
      title: '唯一 (三立/台視戲劇《戀愛是科學》插曲)',
    });
  });

  it('Taylor Swift：別人唱的同名歌〈Taylor Swift〉不會抽到', () => {
    const pool = poolOf(fixtureTracks('Taylor Swift'), 'Taylor Swift');
    for (const s of pool.values()) expect(s.artist).toContain('Taylor Swift');
    expect(pool.has('taylorswift')).toBe(false);
    expect(pool.has(normalizeTitle('The Joker And The Queen'))).toBe(false);
  });

  it('topic 取過濾後出現最多次的 artistName（合唱曲的「A & B」不影響）', () => {
    expect(mustPick('周杰倫').topic).toBe('周杰倫');
    // 合唱曲佔多數時才會變
    const duet = [1, 2, 3].map((i) => track(i, `合唱${i}`, { artistName: '孫燕姿 & 蔡健雅' }));
    const solo = [4, 5].map((i) => track(i, `獨唱${i}`));
    expect(pick([...duet, ...solo], '孫燕姿', 5)?.topic).toBe('孫燕姿 & 蔡健雅');
  });
});

describe('pick：最多次 artistName 退回（英文名、別名）', () => {
  it('Jay Chou → 結果的 artistName 全是「周杰倫」，退回後照樣出題', () => {
    const tracks = fixtureTracks('Jay Chou');
    expect(tracks.some((t) => t.artistName.toLowerCase().includes('jay'))).toBe(false);
    const picked = mustPick('Jay Chou');
    expect(picked.topic).toBe('周杰倫');
    expect(picked.songs).toHaveLength(5);
    for (const s of picked.songs) expect(s.artist).toContain('周杰倫');
  });

  it('輸入本身就夠 5 首時不退回（不會被結果裡更多的別人蓋掉）', () => {
    const mine = [1, 2, 3, 4, 5].map((i) => track(i, `我的歌${i}`, { artistName: '小樂團' }));
    const others = Array.from({ length: 20 }, (_, i) => track(100 + i, `別人的歌${i}`, { artistName: '大明星' }));
    const picked = pick([...others, ...mine], '小樂團', 5, seededRandom(2));
    expect(picked?.topic).toBe('小樂團');
    expect(picked?.songs.every((s) => s.artist === '小樂團')).toBe(true);
  });

  it('退回須過半：真回應 Jay Chou 的結果裡「周杰倫」佔多數 → 可退回', () => {
    const tracks = fixtureTracks('Jay Chou');
    const top = topArtist(tracks);
    // 樣本裁成 27 首後周杰倫 17 首（完整回應是 190／200），仍過半
    expect(top).toEqual({ name: '周杰倫', count: 17 });
    expect((top?.count ?? 0) * 2).toBeGreaterThan(tracks.length);
    expect(majorityArtist(tracks)).toBe('周杰倫');
    expect(pick(tracks, 'Jay Chou', N, seededRandom(1))?.topic).toBe('周杰倫');
  });

  it('退回須過半：190／200（真實比例）可退回', () => {
    const tracks = [
      ...Array.from({ length: 190 }, (_, i) => track(i + 1, `周杰倫的歌${i}`, { artistName: '周杰倫' })),
      ...Array.from({ length: 10 }, (_, i) => track(500 + i, `合唱${i}`, { artistName: '温嵐 & 周杰倫' })),
    ];
    expect(pick(tracks, 'Jay Chou', N, seededRandom(1))?.topic).toBe('周杰倫');
  });

  it('退回須過半：結果被多位歌手瓜分、沒有人過半 → 不退回（null），不會出別人的歌', () => {
    // 輸入的歌手自己只有 2 首；其餘由兩個團各 5 首瓜分（最多的佔 5／12）
    const tracks = [
      track(1, '合唱一', { artistName: '客串歌手' }),
      track(2, '合唱二', { artistName: '客串歌手' }),
      ...[3, 4, 5, 6, 7].map((i) => track(i, `甲的歌${i}`, { artistName: '大團甲' })),
      ...[8, 9, 10, 11, 12].map((i) => track(i, `乙的歌${i}`, { artistName: '大團乙' })),
    ];
    expect(topArtist(tracks)).toEqual({ name: '大團甲', count: 5 });
    expect(majorityArtist(tracks)).toBeNull();
    expect(pick(tracks, '客串歌手', N)).toBeNull();
    // 真回應：告五人的結果有 33 首、告五人本人只佔 15 首（不過半）→ 打一個對不上的名字不會退回成告五人
    const mixed = fixtureTracks('告五人');
    expect(topArtist(mixed)).toEqual({ name: '告五人', count: 15 });
    expect(mixed).toHaveLength(33);
    expect(pick(mixed, '對不上的名字', N)).toBeNull();
    expect(pick(mixed, '告五人', N)?.topic).toBe('告五人');
  });

  it('退回須過半的邊界：剛好一半不算，多一首才算', () => {
    const mine = (count: number) => Array.from({ length: count }, (_, i) => track(i + 1, `歌${i}`, { artistName: '周杰倫' }));
    const others = (count: number) => Array.from({ length: count }, (_, i) => track(100 + i, `別人的歌${i}`, { artistName: `路人${i}` }));
    // 5／10：剛好一半 → 不退回
    expect(majorityArtist([...mine(5), ...others(5)])).toBeNull();
    expect(pick([...mine(5), ...others(5)], 'Jay Chou', N)).toBeNull();
    // 6／11：過半 → 退回
    expect(majorityArtist([...mine(6), ...others(5)])).toBe('周杰倫');
    expect(pick([...mine(6), ...others(5)], 'Jay Chou', N)?.topic).toBe('周杰倫');
    // 6／12：剛好一半 → 不退回
    expect(pick([...mine(6), ...others(6)], 'Jay Chou', N)).toBeNull();
    // 1／1、0 筆
    expect(majorityArtist(mine(1))).toBe('周杰倫');
    expect(majorityArtist([])).toBeNull();
  });

  it('退回須過半的分母是全部原始結果：沒試聽（之後會被濾掉）的也算', () => {
    const mine = Array.from({ length: 6 }, (_, i) => track(i + 1, `歌${i}`, { artistName: '周杰倫' }));
    const noPreview = Array.from({ length: 6 }, (_, i) => track(100 + i, `沒試聽${i}`, { artistName: `路人${i}`, previewUrl: null }));
    // 有試聽的全是周杰倫，但 6／12 不過半 → 不退回
    expect(pick([...mine, ...noPreview], 'Jay Chou', N)).toBeNull();
    expect(pick([...mine, ...noPreview.slice(0, 5)], 'Jay Chou', N)?.topic).toBe('周杰倫');
  });

  it('過半只看「完全相同的 artistName」：合唱寫法（A & B）各算各的', () => {
    // 周杰倫 5 首＋「温嵐 & 周杰倫」5 首＋路人 1 首：沒有任何一個寫法過半（5／11）
    const tracks = [
      ...Array.from({ length: 5 }, (_, i) => track(i + 1, `歌${i}`, { artistName: '周杰倫' })),
      ...Array.from({ length: 5 }, (_, i) => track(50 + i, `合唱${i}`, { artistName: '温嵐 & 周杰倫' })),
      track(99, '路人的歌', { artistName: '路人' }),
    ];
    expect(pick(tracks, 'Jay Chou', N)).toBeNull();
  });

  it('退回後仍不足 → null', () => {
    const tracks = [1, 2, 3, 4].map((i) => track(i, `歌${i}`, { artistName: '周杰倫' }));
    expect(pick(tracks, 'Jay Chou', 5)).toBeNull();
  });

  it('最多次的歌手就是輸入（已經試過）→ 不重複過濾，直接 null', () => {
    const tracks = [1, 2, 3].map((i) => track(i, `歌${i}`));
    expect(pick(tracks, '孫燕姿', 5)).toBeNull();
  });
});

describe('pick：去重（同一首歌的不同版本只留一首）', () => {
  it('非 Live 優先於較長的 Live：半島鐵盒、晴天、安靜', () => {
    const pool = poolOf(fixtureTracks('周杰倫'), '周杰倫');
    // 半島鐵盒：錄音室版 317400、Live 266520、Live 363920（最長）→ 留錄音室版
    expect(pool.get('半島鐵盒')).toMatchObject({ title: '半島鐵盒', trackTimeMillis: 317400 });
    expect(pool.get('晴天')).toMatchObject({ title: '晴天', trackTimeMillis: 269747 });
    expect(pool.get('安靜')).toMatchObject({ title: '安靜', trackTimeMillis: 334240 });
  });

  it('非 Live 之間留全長最長的：稻香（Remix 較短）、天黑黑與綠光（Remastered 較長）', () => {
    expect(poolOf(fixtureTracks('周杰倫'), '周杰倫').get('稻香')).toMatchObject({ title: '稻香', trackTimeMillis: 223453 });
    const sun = poolOf(fixtureTracks('孫燕姿'), '孫燕姿');
    expect(sun.get('天黑黑')).toMatchObject({ title: '天黑黑 (Remastered)', trackTimeMillis: 237067 });
    expect(sun.get('綠光')).toMatchObject({ title: '綠光 (Remastered)', trackTimeMillis: 194627 });
  });

  it('Live 版排在前面也一樣留非 Live：五月天〈私奔到月球〉', () => {
    const tracks = fixtureTracks('五月天');
    const live = tracks.findIndex((t) => t.trackName === '私奔到月球 (feat. 陳綺貞) [Life Live]');
    const studio = tracks.findIndex((t) => t.trackName === '私奔到月球');
    expect(live).toBeGreaterThanOrEqual(0);
    expect(live).toBeLessThan(studio);
    const pool = poolOf(tracks, '五月天');
    expect(pool.get('私奔到月球')?.title).toBe('私奔到月球');
    expect(pool.get('派對動物')?.title).toBe('派對動物');
  });

  it('括號前沒空白的副標、「 - 」副標、Taylor’s Version 都併成一首', () => {
    const jay = poolOf(fixtureTracks('周杰倫'), '周杰倫');
    expect(jay.get('我是如此相信')?.title).toBe('我是如此相信(電影《天火》主題曲)'); // 266383 > 265013
    const yoasobi = poolOf(fixtureTracks('YOASOBI'), 'YOASOBI');
    expect(yoasobi.get('夜に駆ける')).toMatchObject({ title: '夜に駆ける', trackTimeMillis: 261013 });
    expect(yoasobi.get(normalizeTitle('あの夢をなぞって'))?.title).toBe('あの夢をなぞって');
    const taylor = poolOf(fixtureTracks('Taylor Swift'), 'Taylor Swift');
    expect(taylor.get('lovestory')).toMatchObject({ title: 'Love Story (Taylor’s Version)', trackTimeMillis: 235767 });
    expect(taylor.get('lookwhatyoumademedo')?.title).toBe('Look What You Made Me Do');
  });

  it('只有 Live 版的歌照樣可以抽', () => {
    const tracks = [track(1, '愛 (Live)'), ...[2, 3, 4, 5].map((i) => track(i, `歌${i}`))];
    expect(pick(tracks, '孫燕姿', 5)?.songs.map((s) => s.title)).toContain('愛 (Live)');
  });

  it('全長相同時留先出現的', () => {
    const tracks = [track(1, '遇見'), track(2, '遇見 (電影版)'), ...[3, 4, 5, 6].map((i) => track(i, `歌${i}`))];
    const pool = poolOf(tracks, '孫燕姿', 50);
    expect(pool.get('遇見')?.trackId).toBe(1);
  });
});

describe('pick：不足 5 首 → null（ARTIST_NOT_FOUND）', () => {
  it('查無（0 筆）', () => {
    expect(pick([], '沒有這個人', N)).toBeNull();
  });

  it('只有 3 首', () => {
    const three = fixtureTracks('孫燕姿').filter((t) => t.artistName === '孫燕姿').slice(0, 3);
    expect(pick(three, '孫燕姿', N)).toBeNull();
  });

  it('筆數夠但去重後不足（同一首歌的 6 個版本）', () => {
    const versions = ['遇見', '遇見 (Live)', '遇見 (Remastered)', '遇見 - 電影版', '遇見 (伴奏)', '遇見（鋼琴版）'].map((name, i) => track(i + 1, name));
    expect(pick(versions, '孫燕姿', N)).toBeNull();
  });

  it('剛好 n 首可以、n + 1 首不行', () => {
    const tracks = fixtureTracks('孫燕姿');
    expect(pick(tracks, '孫燕姿', 15)?.songs).toHaveLength(15);
    expect(pick(tracks, '孫燕姿', 16)).toBeNull();
  });

  it('沒有試聽的歌不算', () => {
    const tracks = [1, 2, 3, 4, 5, 6].map((i) => track(i, `歌${i}`, i <= 2 ? { previewUrl: null } : {}));
    expect(pick(tracks, '孫燕姿', N)).toBeNull();
    expect(pick([...tracks, track(7, '歌7')], '孫燕姿', N)?.songs.map((s) => s.trackId).sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it('純符號歌名（normalizeTitle 為空）排除', () => {
    const tracks = [track(1, '...'), track(2, '？！'), track(3, '(…)'), ...[4, 5, 6, 7].map((i) => track(i, `歌${i}`))];
    expect(pick(tracks, '孫燕姿', N)).toBeNull();
    const pool = poolOf([...tracks, track(8, '歌8')], '孫燕姿', 20);
    expect([...pool.values()].map((s) => s.trackId).sort()).toEqual([4, 5, 6, 7, 8]);
  });

  it('去副標後為空的歌名（括號開頭）排除：整串當答案幾乎猜不到', () => {
    const bracketFirst = [
      track(1, '(......醉鬼阿Q) [feat. 孫燕姿]'),
      track(2, '(......醉鬼阿Q) (feat. 孫燕姿)'),
      track(3, "(I Can't Get No) Satisfaction"),
      track(4, '【Live】倔強'),
      track(5, 'feat. 某人'),
    ];
    const normal = [6, 7, 8, 9].map((i) => track(i, `歌${i}`));
    // 9 筆裡只有 4 首可抽 → 不足
    expect(pick([...bracketFirst, ...normal], '孫燕姿', N)).toBeNull();
    const pool = poolOf([...bracketFirst, ...normal, track(10, '歌10')], '孫燕姿', 30);
    expect([...pool.values()].map((s) => s.trackId).sort((a, b) => a - b)).toEqual([6, 7, 8, 9, 10]);
  });

  it('真回應裡的括號開頭歌名：輸入吳青峰也抽不到〈(......醉鬼阿Q)〉', () => {
    const tracks = fixtureTracks('孫燕姿');
    const mine = tracks.filter((t) => t.artistName === '吳青峰');
    expect(mine.map((t) => t.trackName)).toEqual(['(......醉鬼阿Q) [feat. 孫燕姿]', '(......醉鬼阿Q) (feat. 孫燕姿)']);
    const others = [1, 2, 3, 4, 5].map((i) => track(i, `吳青峰的歌${i}`, { artistName: '吳青峰' }));
    const pool = poolOf([...mine, ...others], '吳青峰', 30);
    expect([...pool.values()].map((s) => s.trackId).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('pick：亂數可注入', () => {
  it('同一組亂數 → 同一結果；不同亂數 → 會抽到不同的組合', () => {
    const tracks = fixtureTracks('孫燕姿');
    const a = pick(tracks, '孫燕姿', N, seededRandom(42))?.songs.map((s) => s.trackId);
    const b = pick(tracks, '孫燕姿', N, seededRandom(42))?.songs.map((s) => s.trackId);
    expect(a).toEqual(b);
    const combos = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) combos.add(String(pick(tracks, '孫燕姿', N, seededRandom(seed))?.songs.map((s) => s.trackId)));
    expect(combos.size).toBeGreaterThan(20);
  });

  it('亂數恆為 0 → 依去重後的順序取前 5 首', () => {
    const tracks = [1, 2, 3, 4, 5, 6, 7].map((i) => track(i, `歌${i}`));
    expect(pick(tracks, '孫燕姿', N, () => 0)?.songs.map((s) => s.trackId)).toEqual([1, 2, 3, 4, 5]);
  });

  it('亂數回到邊界（0.999999…、甚至 1）也不會出界或重複', () => {
    const tracks = [1, 2, 3, 4, 5, 6, 7].map((i) => track(i, `歌${i}`));
    for (const r of [0.9999999999, 1]) {
      const ids = pick(tracks, '孫燕姿', N, () => r)?.songs.map((s) => s.trackId) ?? [];
      expect(ids).toHaveLength(5);
      expect(new Set(ids).size).toBe(5);
      for (const id of ids) expect(id).toBeGreaterThanOrEqual(1);
    }
  });

  it('每首歌被抽到的機率大致相同（7 選 5，各約 5/7）', () => {
    const tracks = [1, 2, 3, 4, 5, 6, 7].map((i) => track(i, `歌${i}`));
    const counts = new Map<number, number>();
    const random = seededRandom(2026);
    const rounds = 7000;
    for (let i = 0; i < rounds; i++) for (const s of pick(tracks, '孫燕姿', N, random)?.songs ?? []) counts.set(s.trackId, (counts.get(s.trackId) ?? 0) + 1);
    for (let id = 1; id <= 7; id++) {
      const ratio = (counts.get(id) ?? 0) / rounds;
      expect(ratio).toBeGreaterThan(5 / 7 - 0.03);
      expect(ratio).toBeLessThan(5 / 7 + 0.03);
    }
  });
});

describe('isLiveVersion', () => {
  it('副標含 Live／演唱會／現場', () => {
    expect(isLiveVersion('晴天 (Live)')).toBe(true);
    expect(isLiveVersion('你不是真正的快樂 (LIVE)')).toBe(true);
    expect(isLiveVersion('私奔到月球 (feat. 陳綺貞) [Life Live]')).toBe(true);
    expect(isLiveVersion('我不願讓你一個人 (live in the sky)')).toBe(true);
    expect(isLiveVersion('祝我生日快樂 (無與倫比演唱會對唱版)')).toBe(true);
    expect(isLiveVersion('Yellow - Live in Tokyo')).toBe(true);
    expect(isLiveVersion('倔強【現場版】')).toBe(true);
  });

  it('歌名本身含 Live、沒有副標、其他副標都不算', () => {
    expect(isLiveVersion('Live My Life')).toBe(false);
    expect(isLiveVersion('I Don’t Wanna Live Forever (Fifty Shades Darker)')).toBe(false);
    expect(isLiveVersion('天黑黑 (Remastered)')).toBe(false);
    expect(isLiveVersion('晴天')).toBe(false);
    expect(isLiveVersion('(Live) 開頭就是括號')).toBe(false);
    expect(isLiveVersion('【Live】倔強')).toBe(false);
  });
});

describe('mostFrequentArtist／topArtist', () => {
  it('topArtist 帶次數', () => {
    expect(topArtist(fixtureTracks('Taylor Swift'))).toEqual({ name: 'Taylor Swift', count: 18 });
    expect(topArtist([])).toBeNull();
  });

  it('取出現最多次的；同次數取先出現的；空陣列為 null', () => {
    expect(mostFrequentArtist(fixtureTracks('Jay Chou'))).toBe('周杰倫');
    expect(mostFrequentArtist(fixtureTracks('告五人'))).toBe('告五人');
    expect(mostFrequentArtist([track(1, 'a', { artistName: 'B' }), track(2, 'b', { artistName: 'A' })])).toBe('B');
    expect(mostFrequentArtist([])).toBeNull();
  });
});

// ─── Epic 18：熱門（HOT_POOL）與排行榜 ──────────────────────────────

/** n 首合成歌：歌名「第i名」，依名次排列（iTunes 回傳順序＝熱門度） */
function ranked(count: number, overrides: (i: number) => Partial<ItunesTrack> = () => ({})): ItunesTrack[] {
  return Array.from({ length: count }, (_, k) => track(k + 1, `第${k + 1}名`, overrides(k + 1)));
}

/** 多組亂數抽很多次，收集抽到過的 trackId */
function idsOver(run: (random: () => number) => PickedSong[] | undefined, rounds = 300): Set<number> {
  const ids = new Set<number>();
  for (let seed = 1; seed <= rounds; seed++) for (const s of run(seededRandom(seed)) ?? []) ids.add(s.trackId);
  return ids;
}

describe('pick：熱門（hot，Epic 18 決策 2）', () => {
  it('HOT_POOL 為 30', () => {
    expect(HOT_POOL).toBe(30);
  });

  it('hot：60 首裡只會抽到前 30 名；多抽幾次前 30 名都抽得到', () => {
    const tracks = ranked(60);
    const ids = idsOver((r) => pick(tracks, '孫燕姿', N, r, { hot: true })?.songs);
    for (const id of ids) expect(id).toBeLessThanOrEqual(HOT_POOL);
    expect(ids.size).toBe(HOT_POOL);
  });

  it('非 hot（預設與 hot: false）：會抽到 30 名之後', () => {
    const tracks = ranked(60);
    for (const options of [undefined, { hot: false }]) {
      const ids = idsOver((r) => pick(tracks, '孫燕姿', N, r, options)?.songs);
      expect([...ids].some((id) => id > HOT_POOL)).toBe(true);
      expect(ids.size).toBe(60);
    }
  });

  it('前 30 名以「過濾去重後」計：別人的歌、沒試聽、括號開頭與重複版本不佔名額', () => {
    // 原始順序：前 40 筆裡夾著 10 首別人的、5 首沒試聽、5 首重複版本 → 本人可抽的第 30 首在原始第 50 筆左右
    const tracks: ItunesTrack[] = [];
    let id = 1;
    for (let k = 1; k <= 40; k++) {
      tracks.push(track(id++, `本人${k}`));
      if (k <= 10) tracks.push(track(id++, `別人${k}`, { artistName: '路人' }));
      if (k <= 5) tracks.push(track(id++, `沒試聽${k}`, { previewUrl: null }));
      if (k <= 5) tracks.push(track(id++, `本人${k} (Live)`));
    }
    const titles = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      for (const s of pick(tracks, '孫燕姿', N, seededRandom(seed), { hot: true })?.songs ?? []) titles.add(normalizeTitle(s.title));
    }
    expect(titles).toEqual(new Set(Array.from({ length: 30 }, (_, k) => normalizeTitle(`本人${k + 1}`))));
  });

  it('去重留下的版本不改名次：Live 版排在前面時，該歌仍以第一次出現的名次計', () => {
    // 第 1 筆是「第1名 (Live)」、錄音室版在最後（第 61 筆）→ 第1名仍在前 30，抽到的是錄音室版
    const tracks = [track(1000, '第1名 (Live)'), ...ranked(60).slice(1), track(1, '第1名')];
    const picked = new Map<string, number>();
    for (let seed = 1; seed <= 300; seed++) {
      for (const s of pick(tracks, '孫燕姿', N, seededRandom(seed), { hot: true })?.songs ?? []) picked.set(s.title, s.trackId);
    }
    expect(picked.get('第1名')).toBe(1);
    expect(picked.has('第1名 (Live)')).toBe(false);
    expect([...picked.values()].every((x) => x === 1 || x <= HOT_POOL)).toBe(true);
  });

  it('不足 30 首：hot 等同全部（12 首全抽得到），結果與非 hot 相同', () => {
    const tracks = ranked(12);
    expect(idsOver((r) => pick(tracks, '孫燕姿', N, r, { hot: true })?.songs).size).toBe(12);
    for (let seed = 1; seed <= 20; seed++) {
      expect(pick(tracks, '孫燕姿', N, seededRandom(seed), { hot: true })).toEqual(pick(tracks, '孫燕姿', N, seededRandom(seed)));
    }
  });

  it('剛好 30 首與 31 首的邊界：31 首時第 31 名抽不到', () => {
    expect(idsOver((r) => pick(ranked(30), '孫燕姿', N, r, { hot: true })?.songs).size).toBe(30);
    const ids = idsOver((r) => pick(ranked(31), '孫燕姿', N, r, { hot: true })?.songs);
    expect(ids.has(31)).toBe(false);
    expect(ids.size).toBe(30);
  });

  it('退回（最多次 artistName）那一輪同樣套 hot：Jay Chou → 周杰倫 60 首，只抽前 30', () => {
    const tracks = ranked(60, () => ({ artistName: '周杰倫' }));
    const ids = idsOver((r) => {
      const picked = pick(tracks, 'Jay Chou', N, r, { hot: true });
      expect(picked?.topic).toBe('周杰倫');
      return picked?.songs;
    });
    expect(Math.max(...ids)).toBeLessThanOrEqual(HOT_POOL);
    expect(Math.max(...idsOver((r) => pick(tracks, 'Jay Chou', N, r, { hot: false })?.songs))).toBeGreaterThan(HOT_POOL);
  });

  it('topic 在 hot 時以前 30 首計：前 30 名多為合唱寫法時 topic 跟著變；非 hot 以全部計', () => {
    // 前 30 名：20 首「孫燕姿 & 蔡健雅」＋10 首「孫燕姿」；之後 40 首「孫燕姿」
    const tracks = ranked(70, (i) => ({ artistName: i <= 20 ? '孫燕姿 & 蔡健雅' : '孫燕姿' }));
    expect(pick(tracks, '孫燕姿', N, seededRandom(1), { hot: true })?.topic).toBe('孫燕姿 & 蔡健雅');
    expect(pick(tracks, '孫燕姿', N, seededRandom(1), { hot: false })?.topic).toBe('孫燕姿');
  });

  it('真回應（孫燕姿 15 首可抽，不足 30）：hot 與非 hot 的候選相同', () => {
    const tracks = fixtureTracks('孫燕姿');
    const hot = idsOver((r) => pick(tracks, '孫燕姿', N, r, { hot: true })?.songs, 200);
    const all = idsOver((r) => pick(tracks, '孫燕姿', N, r)?.songs, 200);
    expect(hot).toEqual(all);
    expect(hot.size).toBe(15);
  });
});

describe('pickChart（Epic 18：台灣熱門／西洋熱門）', () => {
  it('真榜單樣本（tw 20 首、us 20 首）：抽 5 首、都有試聽、各不相同', () => {
    for (const country of ['tw', 'us'] as const) {
      const tracks = chartFixtureTracks(country);
      expect(tracks).toHaveLength(20);
      const songs = pickChart(tracks, N, seededRandom(3));
      expect(songs).toHaveLength(5);
      expect(new Set(songs?.map((s) => s.trackId)).size).toBe(5);
      for (const s of songs ?? []) expect(s.previewUrl).toMatch(/^https:\/\/audio-ssl\.itunes\.apple\.com\//);
    }
  });

  it('真台灣榜不過濾語言：韓團、中文歌都抽得到；20 首全部可抽', () => {
    const ids = idsOver((r) => pickChart(chartFixtureTracks('tw'), N, r) ?? undefined, 300);
    expect(ids.size).toBe(20);
    const artists = new Set(chartFixtureTracks('tw').filter((t) => ids.has(t.trackId)).map((t) => t.artistName));
    expect(artists.has('周杰倫')).toBe(true);
    expect(artists.has('A2O & A2O LITE')).toBe(true);
  });

  it('去重鍵＝artistName ＋ normalizeTitle：同歌手同名（含副標、Live）只留一首，不同歌手同名各算一首', () => {
    const tracks = [
      track(1, '晴天', { artistName: '周杰倫' }),
      track(2, '晴天 (Live)', { artistName: '周杰倫' }),
      track(3, '晴天', { artistName: '別的歌手' }),
      track(4, '歌4', { artistName: 'A' }),
      track(5, '歌5', { artistName: 'B' }),
    ];
    expect(pickChart(tracks, 5)).toBeNull();
    const four = pickChart(tracks, 4, seededRandom(1));
    expect(four?.map((s) => s.trackId).sort()).toEqual([1, 3, 4, 5]);
  });

  it('排除：沒試聽、純符號歌名（normalizeTitle 空）、括號開頭（mainTitle 空）', () => {
    const bad = [
      track(1, '沒試聽', { previewUrl: null, artistName: 'A' }),
      track(2, '...', { artistName: 'B' }),
      track(3, "(I Can't Get No) Satisfaction", { artistName: 'C' }),
    ];
    const good = [4, 5, 6, 7].map((i) => track(i, `歌${i}`, { artistName: `歌手${i}` }));
    expect(pickChart([...bad, ...good], N)).toBeNull();
    const ids = idsOver((r) => pickChart([...bad, ...good, track(8, '歌8', { artistName: '歌手8' })], N, r) ?? undefined, 50);
    expect([...ids].sort()).toEqual([4, 5, 6, 7, 8]);
  });

  it('不套 HOT_POOL：榜單 100 首裡第 31 名之後也抽得到', () => {
    const tracks = Array.from({ length: 100 }, (_, k) => track(k + 1, `第${k + 1}名`, { artistName: `歌手${k + 1}` }));
    expect(Math.max(...idsOver((r) => pickChart(tracks, N, r) ?? undefined))).toBeGreaterThan(HOT_POOL);
  });

  it('不足 n 首回 null（CHART_FAILED）；空陣列也是', () => {
    expect(pickChart([], N)).toBeNull();
    expect(pickChart(chartFixtureTracks('us').slice(0, 4), N)).toBeNull();
    expect(pickChart(chartFixtureTracks('us').slice(0, 5), N)).toHaveLength(5);
  });

  it('同一組亂數 → 同一結果；不改動傳入的陣列', () => {
    const tracks = chartFixtureTracks('us');
    const before = JSON.stringify(tracks);
    expect(pickChart(tracks, N, seededRandom(9))).toEqual(pickChart(tracks, N, seededRandom(9)));
    expect(JSON.stringify(tracks)).toBe(before);
  });

  it('抽到的歌保留本首歌手與揭曉欄位（song.artist、封面、itunesUrl）', () => {
    const [first] = pickChart(chartFixtureTracks('tw'), 20, () => 0) ?? [];
    expect(first).toMatchObject({ trackId: 6820428730, title: 'NEON', artist: 'A2O & A2O LITE', album: 'NEON - Single' });
    expect(first?.artworkUrl).toMatch(/100x100bb\.jpg$/);
    expect(first?.trackTimeMillis).toBe(208000);
  });
});

// ─── Epic 19：動漫熱門 ─────────────────────────────────────────────

/** 只看歌名與專輯的判定（其餘欄位不影響） */
const sc = (trackName: string, collectionName: string | null = 'Single') => isSoundtrackOrCover({ trackName, collectionName });

describe('isSoundtrackOrCover（Epic 19 決策 3）', () => {
  it('命中：拉丁字母關鍵字不分大小寫、整字比對（歌名或專輯任一含即算）', () => {
    expect(sc('Departure!', 'HUNTER×HUNTER Original Soundtrack')).toBe(true);
    expect(sc('紅蓮華 (Cover)')).toBe(true);
    expect(sc('紅蓮華', 'Anime Song COVER Collection')).toBe(true);
    expect(sc('Unravel (Piano Ver.)')).toBe(true);
    expect(sc('Theme', '進撃の巨人 OST')).toBe(true);
    expect(sc('Theme', 'Movie OST2')).toBe(false); // OST 緊接數字不是整字（記錄邊界行為）
    expect(sc('Theme (OST Ver.)')).toBe(true);
    expect(sc('紅蓮華 (off vocal)')).toBe(true);
    expect(sc('紅蓮華 (Off Vocal Ver.)')).toBe(true);
    expect(sc('BGM 01')).toBe(true);
    expect(sc('Opening (Instrumental)')).toBe(true);
    expect(sc('紅蓮華 (Remix)')).toBe(true);
    expect(sc('紅蓮華', '8-bit Anime Hits')).toBe(true);
    expect(sc('紅蓮華', 'Music Box Collection')).toBe(true);
    expect(sc('Anime Hits', 'Anime Piano Covers')).toBe(true); // 複數也算（含 cover／piano）
    expect(sc('Remixes')).toBe(true);
    expect(sc('Theme', 'Soundtracks')).toBe(true);
    // 全形英數經 NFKC 後同半形
    expect(sc('Ｔｈｅｍｅ', 'ＯＳＴ')).toBe(true);
  });

  it('命中：acoustic／orchestral／karaoke（Epic 19 Phase 2.5 決策 10，2026-10-20）同樣整字、不分大小寫、允許複數', () => {
    expect(sc('螺旋 - RASEN - Acoustic Ver. -')).toBe(true);
    expect(sc('生命的記憶 (Orchestral version)')).toBe(true);
    expect(sc('紅蓮華 (Karaoke Version)')).toBe(true);
    expect(sc('Theme', 'Anime Acoustics')).toBe(true);
    expect(sc('Theme', 'ACOUSTIC COVERS')).toBe(true);
    // 邊界只允許 e?s：Acoustically、Orchestrally 是別的字
    expect(sc('Acoustically')).toBe(false);
    expect(sc('Orchestrally Yours')).toBe(false);
    expect(sc('Karaokeish')).toBe(false);
  });

  it('命中：日文／中文關鍵字以子字串比對', () => {
    expect(sc('Call of Silence', 'TVアニメ「進撃の巨人」Season 2 オリジナルサウンドトラック')).toBe(true);
    expect(sc('隔壁的龍貓', '龍貓 動畫電影原聲帶')).toBe(true);
    expect(sc('主題曲', '你的名字 电影原声带')).toBe(true);
    expect(sc('紅蓮華 (オリジナル・カラオケ)')).toBe(true);
    expect(sc('紅蓮華 (伴奏版)')).toBe(true);
    expect(sc('紅蓮華 鋼琴版')).toBe(true);
    expect(sc('Butter-Fly', '熱烈!アニソン魂 THE BEST カバー楽曲集')).toBe(true);
    expect(sc('紅蓮華 (音樂盒版)')).toBe(true);
    expect(sc('紅蓮華', 'ジブリ オルゴール')).toBe(true);
  });

  it('不誤殺：關鍵字是別的英文字的一部分', () => {
    expect(sc('LOST IN PARADISE (feat. AKLO)', 'LOST IN PARADISE - EP')).toBe(false);
    expect(sc('Ghost')).toBe(false);
    expect(sc('Lost')).toBe(false);
    expect(sc('Most of All')).toBe(false);
    expect(sc('Discover')).toBe(false);
    expect(sc('Recovery')).toBe(false);
    expect(sc('Pianoman')).toBe(false);
    expect(sc('Hostage')).toBe(false);
    expect(sc('Bgmania')).toBe(false);
    expect(sc('Remixology')).toBe(false);
    expect(sc('18-bits')).toBe(false); // 8-bit 前面緊接數字
    expect(sc('紅蓮華', null)).toBe(false);
    expect(sc('残響散歌', '残響散歌 / 朝が来る - EP')).toBe(false);
  });

  it('真 Apple 樣本：排除 14 首（動畫電影原聲帶、オリジナルサウンドトラック、カバー楽曲集）；LOST IN PARADISE 不被排除', () => {
    const merged = animeFixtureMerged();
    const excluded = merged.filter((t) => isSoundtrackOrCover(t));
    expect(excluded).toHaveLength(14);
    for (const t of excluded) expect(`${t.collectionName ?? ''}`).toMatch(/原聲帶|サウンドトラック|カバー/);
    const lost = merged.find((t) => t.trackName.startsWith('LOST IN PARADISE'));
    expect(lost).toBeDefined();
    expect(isSoundtrackOrCover(lost!)).toBe(false);
  });
});

describe('pickAnime（Epic 19 決策 2、3）', () => {
  const anime = (id: number, trackName: string, overrides: Partial<ItunesTrack> = {}) => track(id, trackName, { artistName: `歌手${id}`, ...overrides });

  it('抽 n 首：都在候選裡、不重複；亂數可注入（同 seed 同結果）', () => {
    const tracks = Array.from({ length: 20 }, (_, i) => anime(i + 1, `歌${i + 1}`));
    const a = pickAnime(tracks, N, seededRandom(7));
    const b = pickAnime(tracks, N, seededRandom(7));
    expect(a).toHaveLength(N);
    expect(a).toEqual(b);
    expect(new Set(a!.map((s) => s.trackId)).size).toBe(N);
    expect(a![0]).toMatchObject({ artist: expect.stringMatching(/^歌手\d+$/), previewUrl: expect.stringMatching(/^https:\/\//) });
  });

  it('只從合併排名前 ANIME_HOT_POOL（60）首抽：輸入 100 首，多組亂數都抽不到第 61 首之後', () => {
    const tracks = Array.from({ length: 100 }, (_, i) => anime(i + 1, `歌${i + 1}`));
    const seen = new Set<number>();
    for (let seed = 1; seed <= 300; seed++) for (const s of pickAnime(tracks, N, seededRandom(seed))!) seen.add(s.trackId);
    expect(ANIME_HOT_POOL).toBe(60);
    expect(Math.max(...seen)).toBeLessThanOrEqual(60);
    expect(seen.has(60)).toBe(true);
    expect(seen.has(1)).toBe(true);
  });

  it('前 60 是「排除與去重之後」的前 60：前面被排除或重複的不佔名額', () => {
    const tracks: ItunesTrack[] = [];
    for (let i = 1; i <= 10; i++) tracks.push(anime(i, `原聲${i}`, { collectionName: 'Original Soundtrack' }));
    for (let i = 11; i <= 20; i++) tracks.push(anime(i, '同一首', { artistName: '同一位' }));
    for (let i = 21; i <= 90; i++) tracks.push(anime(i, `歌${i}`));
    const seen = new Set<number>();
    for (let seed = 1; seed <= 400; seed++) for (const s of pickAnime(tracks, N, seededRandom(seed))!) seen.add(s.trackId);
    // 候選：11（同一首的第一筆）＋ 21～79（59 首）＝ 60 首
    for (const id of seen) expect(id === 11 || (id >= 21 && id <= 79)).toBe(true);
    expect(seen.has(79)).toBe(true);
    expect(seen.has(11)).toBe(true);
  });

  it('去重：artistName ＋ normalizeTitle 相同只留**較前者**（不比 Live、長度）；不同歌手同歌名是不同的歌', () => {
    const tracks = [
      anime(1, '紅蓮華 (Live)', { artistName: 'LiSA', trackTimeMillis: 100_000 }),
      anime(2, '紅蓮華', { artistName: 'LiSA', trackTimeMillis: 300_000 }),
      anime(3, '紅蓮華', { artistName: '別人' }),
      anime(4, 'A'),
      anime(5, 'B'),
      anime(6, 'C'),
    ];
    const ids = new Set<number>();
    for (let seed = 1; seed <= 100; seed++) for (const s of pickAnime(tracks, N, seededRandom(seed))!) ids.add(s.trackId);
    expect([...ids].sort((x, y) => x - y)).toEqual([1, 3, 4, 5, 6]);
  });

  it('排除：沒試聽、原聲帶／翻唱、歌名猜不到（normalizeTitle 或 mainTitle 為空）', () => {
    const good = [anime(1, 'A'), anime(2, 'B'), anime(3, 'C'), anime(4, 'D')];
    const bad = [
      anime(10, 'E', { previewUrl: null }),
      anime(11, 'F (Cover)'),
      anime(12, 'G', { collectionName: '動畫電影原聲帶' }),
      anime(13, '(......醉鬼阿Q) [feat. 孫燕姿]'),
      anime(14, '!!!'),
    ];
    expect(pickAnime([...good, ...bad], N, seededRandom(1))).toBeNull();
    const ok = pickAnime([...good, ...bad, anime(5, 'H')], N, seededRandom(1));
    expect(ok!.map((s) => s.trackId).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
  });

  it('不足 n 首 → null（CHART_FAILED）；剛好 n 首 → 全抽', () => {
    expect(pickAnime([], N, seededRandom(1))).toBeNull();
    const four = Array.from({ length: N - 1 }, (_, i) => anime(i + 1, `歌${i + 1}`));
    expect(pickAnime(four, N, seededRandom(1))).toBeNull();
    const five = [...four, anime(N, `歌${N}`)];
    expect(pickAnime(five, N, seededRandom(1))!.map((s) => s.trackId).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
  });

  it('真 Apple 樣本：合併 49 首 → 可抽 35 首（排除 14）；多組亂數抽到的歌都不是原聲帶／翻唱、有試聽', () => {
    const merged = animeFixtureMerged();
    const seen = new Map<number, PickedSong>();
    for (let seed = 1; seed <= 300; seed++) for (const s of pickAnime(merged, N, seededRandom(seed))!) seen.set(s.trackId, s);
    expect(seen.size).toBe(35);
    for (const s of seen.values()) {
      expect(isSoundtrackOrCover({ trackName: s.title, collectionName: s.album })).toBe(false);
      expect(s.previewUrl).toMatch(/^https:\/\/audio-ssl\.itunes\.apple\.com\//);
    }
    expect([...seen.values()].some((s) => s.title.startsWith('LOST IN PARADISE'))).toBe(true);
  });
});
