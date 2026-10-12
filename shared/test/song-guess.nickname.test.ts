// 猜歌暱稱驗證：spec/song-guess/overview.md 規則 1（複製自繪圖比賽）
import { describe, expect, it } from 'vitest';
import { NICKNAME_MAX } from '../src/song-guess/constants';
import { NICKNAME_INVALID_MESSAGE, nicknameKey, validateNickname } from '../src/song-guess/nickname';

describe('validateNickname', () => {
  it('去頭尾空白後回傳（含全形空白）', () => {
    expect(validateNickname('　 Alice ')).toEqual({ ok: true, nickname: 'Alice' });
  });

  it('空字串與全空白不合法', () => {
    expect(validateNickname('').ok).toBe(false);
    expect(validateNickname('   　').ok).toBe(false);
  });

  it(`剛好 ${NICKNAME_MAX} 字合法、${NICKNAME_MAX + 1} 字不合法`, () => {
    expect(validateNickname('一'.repeat(NICKNAME_MAX)).ok).toBe(true);
    expect(validateNickname('a'.repeat(NICKNAME_MAX + 1)).ok).toBe(false);
  });

  it('emoji 以 code point 計', () => {
    expect(validateNickname('👍'.repeat(NICKNAME_MAX)).ok).toBe(true);
    expect(validateNickname('👍'.repeat(NICKNAME_MAX + 1)).ok).toBe(false);
  });

  it('中間含控制字元不合法', () => {
    expect(validateNickname('Al\nice').ok).toBe(false);
    expect(validateNickname('\nAlice\n')).toEqual({ ok: true, nickname: 'Alice' });
  });

  it('錯誤帶 NICKNAME_INVALID 與繁中訊息', () => {
    expect(validateNickname('')).toEqual({ ok: false, error: 'NICKNAME_INVALID', message: NICKNAME_INVALID_MESSAGE });
  });
});

describe('nicknameKey', () => {
  it('不分大小寫', () => {
    expect(nicknameKey('Alice')).toBe(nicknameKey('aLICE'));
  });

  it('全形英數視同半形', () => {
    expect(nicknameKey('Ａｌｉｃｅ')).toBe(nicknameKey('alice'));
    expect(nicknameKey('Ｂｏｂ１２')).toBe('bob12');
  });

  it('中文維持原樣', () => {
    expect(nicknameKey('小明')).toBe('小明');
  });
});
