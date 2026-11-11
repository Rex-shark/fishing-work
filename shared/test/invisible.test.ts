/// <reference types="node" />
// 不可見字元（Epic 21 決策 1；spec/architecture.md §9.1、spec/song-guess/architecture.md §5.4；code review #2）
// 三款 text.ts 各有一份 stripInvisible／hasForbiddenInvisible（逐字相同，不抽共用），這裡三款一起測。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as dgText from '../src/draw-guess/text';
import * as dcText from '../src/draw-contest/text';
import * as sgText from '../src/song-guess/text';
import * as dgNick from '../src/draw-guess/nickname';
import * as dcNick from '../src/draw-contest/nickname';
import * as sgNick from '../src/song-guess/nickname';
import { containsSpoiler as dgSpoiler, isCorrect as dgCorrect, normalizeAnswer } from '../src/draw-guess/answer';
import {
  containsSpoiler as sgSpoiler,
  isCorrect as sgCorrect,
  normalizeFull,
  normalizeTitle,
  titleLength,
} from '../src/song-guess/answer';

const FAMILY = '👨‍👩‍👧'; // 👨 ZWJ 👩 ZWJ 👧
const HEART = '❤️'; // U+2764 U+FE0F

/** spec §9.1 列舉的不可見字元（\p{Cf} 取幾個代表） */
const FORBIDDEN = [
  ['U+200B 零寬空白', '​'],
  ['U+200C ZWNJ', '‌'],
  ['U+200E LRM', '‎'],
  ['U+202E RLO', '‮'],
  ['U+2060 WJ', '⁠'],
  ['U+FEFF BOM', '﻿'],
  ['U+00AD 軟連字號', '­'],
  ['U+E0041 tag', '\u{E0041}'],
  ['U+FE00 VS1', '︀'],
  ['U+FE0E VS15', '︎'],
  ['U+E0100 VS17', '\u{E0100}'],
  ['U+E01EF VS256', '\u{E01EF}'],
  ['U+180B 蒙古文 FVS1', '᠋'],
  ['U+180E 蒙古文母音分隔', '᠎'],
  ['U+180F 蒙古文 FVS4', '᠏'],
  ['U+034F CGJ', '͏'],
  ['U+115F 韓文初聲填充', 'ᅟ'],
  ['U+1160 韓文中聲填充', 'ᅠ'],
  ['U+3164 韓文填充', 'ㅤ'],
  ['U+FFA0 半形韓文填充', 'ﾠ'],
  ['U+2800 點字空白', '⠀'],
] as const;

const GAMES = [
  { name: 'draw-guess', text: dgText, nick: dgNick },
  { name: 'draw-contest', text: dcText, nick: dcNick },
  { name: 'song-guess', text: sgText, nick: sgNick },
] as const;

describe.each(GAMES)('$name：stripInvisible／hasForbiddenInvisible', ({ text }) => {
  it.each(FORBIDDEN)('%s：禁用，且會被移除', (_label, ch) => {
    expect(text.hasForbiddenInvisible(`a${ch}b`)).toBe(true);
    expect(text.stripInvisible(`a${ch}b`)).toBe('ab');
  });

  it('ZWJ（U+200D）與 VS16（U+FE0F）允許出現，但比對時會被移除', () => {
    expect(text.hasForbiddenInvisible('‍')).toBe(false);
    expect(text.hasForbiddenInvisible('️')).toBe(false);
    expect(text.hasForbiddenInvisible(FAMILY)).toBe(false);
    expect(text.hasForbiddenInvisible(HEART)).toBe(false);
    expect(text.stripInvisible(FAMILY)).toBe('👨👩👧');
    expect(text.stripInvisible(HEART)).toBe('❤');
    expect(text.stripInvisible('蘋‍果')).toBe('蘋果');
  });

  it('一般文字、全形空白、膚色修飾、國旗不受影響', () => {
    for (const s of ['Alice', '長頸鹿', 'a　b', '👍🏽', '🇹🇼', '1️⃣']) {
      expect(text.hasForbiddenInvisible(s)).toBe(false);
    }
    expect(text.stripInvisible('👍🏽🇹🇼')).toBe('👍🏽🇹🇼');
  });

  it('isInvisibleOnlyOrForbidden：含禁用字元、或移除後只剩空白／為空', () => {
    expect(text.isInvisibleOnlyOrForbidden('Re​x')).toBe(true);
    expect(text.isInvisibleOnlyOrForbidden('‍️')).toBe(true);
    expect(text.isInvisibleOnlyOrForbidden('‍ ‍')).toBe(true);
    expect(text.isInvisibleOnlyOrForbidden(FAMILY)).toBe(false);
    expect(text.isInvisibleOnlyOrForbidden('Rex')).toBe(false);
  });

  it('全域旗標的 regex 不殘留 lastIndex（連續呼叫結果一致）', () => {
    for (let i = 0; i < 3; i++) {
      expect(text.stripInvisible('a​b​c')).toBe('abc');
      expect(text.hasForbiddenInvisible('a​b')).toBe(true);
    }
  });
});

describe.each(GAMES)('$name：暱稱', ({ nick }) => {
  it.each([
    ['零寬空白暱稱（冒充）', 'Re​x'],
    ['全不可見（U+3164）', 'ㅤ'],
    ['全不可見（多個）', '​⠀﻿'],
    ['只有 ZWJ＋VS16', '‍️'],
    ['RLO 反轉', '‮xeR'],
  ])('%s → NICKNAME_INVALID，文案不變', (_label, raw) => {
    expect(nick.validateNickname(raw)).toEqual({ ok: false, error: 'NICKNAME_INVALID', message: nick.NICKNAME_INVALID_MESSAGE });
  });

  it(`emoji 暱稱 ${FAMILY}、${HEART} 合法且原樣保存（不退化）`, () => {
    expect(nick.validateNickname(FAMILY)).toEqual({ ok: true, nickname: FAMILY });
    expect(nick.validateNickname(` ${HEART} `)).toEqual({ ok: true, nickname: HEART });
    expect(nick.validateNickname(`Rex${HEART}`)).toEqual({ ok: true, nickname: `Rex${HEART}` });
  });

  it('nicknameKey 先移除不可見字元：Rex＋VS16、R＋ZWJ＋ex 與 Rex 同鍵；全形大小寫照舊', () => {
    const key = nick.nicknameKey('Rex');
    expect(nick.nicknameKey('Rex️')).toBe(key);
    expect(nick.nicknameKey('R‍ex')).toBe(key);
    expect(nick.nicknameKey('Ｒｅｘ')).toBe(key);
    expect(nick.nicknameKey('REX​')).toBe(key);
  });
});

describe('draw-guess：答案比對（normalizeAnswer 先 stripInvisible）', () => {
  it('「蘋＋ZWJ＋果」等於「蘋果」：猜對、也被洩題防護攔下', () => {
    expect(normalizeAnswer('蘋‍果')).toBe(normalizeAnswer('蘋果'));
    expect(normalizeAnswer('蘋​果')).toBe('蘋果');
    expect(dgCorrect('蘋‍果', '蘋果')).toBe(true);
    expect(dgSpoiler('是蘋‍果嗎', '蘋果')).toBe(true);
    expect(dgSpoiler('是蘋️果嗎', '蘋果')).toBe(true);
  });

  it('題目只有不可見字元 → 正規化為空（不視為洩題、不算猜對）', () => {
    expect(normalizeAnswer('​')).toBe('');
    expect(dgCorrect('​', '​')).toBe(false);
    expect(dgSpoiler('任何字', '​')).toBe(false);
  });
});

describe('draw-contest／song-guess：題目、歌手名、聊天驗證', () => {
  it.each([['零寬', '蘋​果'], ['全不可見', 'ㅤ'], ['只有 ZWJ', '‍']])('題目%s → 不合法', (_l, raw) => {
    expect(dcText.validateTopic(raw)).toEqual({ ok: false });
  });

  it.each([['零寬', '孫​燕姿'], ['全不可見', '⠀'], ['只有 VS16', '️']])('歌手名%s → 不合法', (_l, raw) => {
    expect(sgText.validateArtist(raw)).toEqual({ ok: false });
  });

  it.each([dcText, sgText])('聊天：零寬字元、全不可見 → 不合法；emoji 照常', (text) => {
    expect(text.validateChatText('答​案')).toEqual({ ok: false });
    expect(text.validateChatText('‍️')).toEqual({ ok: false });
    expect(text.validateChatText(`加油 ${FAMILY}${HEART}`)).toEqual({ ok: true, text: `加油 ${FAMILY}${HEART}` });
  });

  it('含 ZWJ／VS16 的正常題目與歌手名合法、原樣保存', () => {
    expect(dcText.validateTopic(FAMILY)).toEqual({ ok: true, topic: FAMILY });
    expect(sgText.validateArtist(`IU ${HEART}`)).toEqual({ ok: true, artist: `IU ${HEART}` });
  });
});

describe('song-guess：歌名比對（normalizeTitle／normalizeFull 先 stripInvisible）', () => {
  it('ZWJ 夾歌名：猜對、洩題都照判', () => {
    expect(normalizeTitle('遇‍見')).toBe('遇見');
    expect(normalizeFull('遇‍見 (Live)')).toBe('遇見live');
    expect(sgCorrect('遇‍見', '遇見')).toBe(true);
    expect(sgSpoiler('是遇‍見嗎', '遇見')).toBe(true);
    expect(sgSpoiler('是遇️見嗎', '遇見 (Live)')).toBe(true);
  });

  it('iTunes 歌名本身帶不可見字元也能比對；字數提示不算不可見字元', () => {
    expect(sgCorrect('遇見', '遇​見')).toBe(true);
    expect(titleLength('遇​見')).toBe(2);
  });
});

describe('三款 text.ts 的不可見字元區塊逐字相同（決策 1：逐字複製，去重留第二批 #22）', () => {
  const block = (game: string): string => {
    const src = readFileSync(new URL(`../src/${game}/text.ts`, import.meta.url), 'utf8');
    const from = src.indexOf('// ── 不可見字元');
    const to = src.indexOf('export function isInvisibleOnlyOrForbidden');
    if (from < 0 || to < 0) throw new Error(`${game}/text.ts 找不到不可見字元區塊`);
    return src.slice(from, src.indexOf('\n}\n', to) + 3);
  };

  it('draw-contest、song-guess 與 draw-guess 相同', () => {
    const dg = block('draw-guess');
    expect(block('draw-contest')).toBe(dg);
    expect(block('song-guess')).toBe(dg);
  });
});
