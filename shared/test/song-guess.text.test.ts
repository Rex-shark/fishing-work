// 猜歌文字驗證：spec/song-guess/architecture.md §5（validateArtist）、§5.2（validateChatText）、§5.3（文案）
import { describe, expect, it } from 'vitest';
import { ARTIST_MAX, CHAT_MAX } from '../src/song-guess/constants';
import { ARTIST_INVALID_MESSAGE, countChars, hasControlChars, validateArtist, validateChatText } from '../src/song-guess/text';

describe('countChars／hasControlChars', () => {
  it('emoji 以 code point 計', () => {
    expect(countChars('👍')).toBe(1);
    expect(countChars('孫燕姿')).toBe(3);
  });

  it('換行、tab 為控制字元，全形空白不是', () => {
    expect(hasControlChars('a\nb')).toBe(true);
    expect(hasControlChars('a\tb')).toBe(true);
    expect(hasControlChars('a　b')).toBe(false);
  });
});

describe('validateArtist', () => {
  it('回傳去頭尾空白（含全形空白）後的歌手名；中間的空白保留', () => {
    expect(validateArtist('  孫燕姿　')).toEqual({ ok: true, artist: '孫燕姿' });
    expect(validateArtist('\nTaylor Swift\n')).toEqual({ ok: true, artist: 'Taylor Swift' });
  });

  it('空字串與只有空白（半形、全形、混合）不合法', () => {
    expect(validateArtist('')).toEqual({ ok: false });
    expect(validateArtist('   ').ok).toBe(false);
    expect(validateArtist('　　').ok).toBe(false);
    expect(validateArtist(' 　   ').ok).toBe(false);
  });

  it(`剛好 ${ARTIST_MAX} 字合法、${ARTIST_MAX + 1} 字不合法`, () => {
    expect(validateArtist('一'.repeat(ARTIST_MAX)).ok).toBe(true);
    expect(validateArtist('一'.repeat(ARTIST_MAX + 1)).ok).toBe(false);
    expect(validateArtist('a'.repeat(ARTIST_MAX)).ok).toBe(true);
    expect(validateArtist('a'.repeat(ARTIST_MAX + 1)).ok).toBe(false);
  });

  it('emoji 算 1（代理對不算 2）', () => {
    expect(validateArtist('🎤'.repeat(ARTIST_MAX))).toEqual({ ok: true, artist: '🎤'.repeat(ARTIST_MAX) });
    expect(validateArtist('🎤'.repeat(ARTIST_MAX + 1)).ok).toBe(false);
  });

  it('中間含控制字元不合法', () => {
    expect(validateArtist('孫\n燕姿').ok).toBe(false);
    expect(validateArtist('孫\t燕姿').ok).toBe(false);
    expect(validateArtist('孫\u0007燕姿').ok).toBe(false);
  });

  it('超長字串直接判不合法', () => {
    expect(validateArtist('x'.repeat(100_000)).ok).toBe(false);
  });

  it('錯誤文案照 spec §5.3', () => {
    expect(ARTIST_INVALID_MESSAGE).toBe('歌手名稱需為 1～30 個字，不可含控制字元，也不能只有空白');
  });
});

describe('validateChatText', () => {
  it('回傳去頭尾空白後的文字', () => {
    expect(validateChatText('  你好 ')).toEqual({ ok: true, text: '你好' });
  });

  it('空字串與全空白不合法', () => {
    expect(validateChatText('')).toEqual({ ok: false });
    expect(validateChatText('  　 ').ok).toBe(false);
  });

  it(`剛好 ${CHAT_MAX} 字合法、${CHAT_MAX + 1} 字不合法`, () => {
    expect(validateChatText('a'.repeat(CHAT_MAX)).ok).toBe(true);
    expect(validateChatText('a'.repeat(CHAT_MAX + 1)).ok).toBe(false);
    expect(validateChatText('👍'.repeat(CHAT_MAX)).ok).toBe(true);
  });

  it('中間有換行不合法（單行）；頭尾換行會先被去掉', () => {
    expect(validateChatText('第一行\n第二行').ok).toBe(false);
    expect(validateChatText('\n你好\n')).toEqual({ ok: true, text: '你好' });
  });
});
