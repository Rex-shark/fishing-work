import { describe, expect, it } from 'vitest';
import { countChars, hasControlChars } from '../src/draw-guess/text';

describe('countChars', () => {
  it('ASCII 與中文各算 1', () => {
    expect(countChars('abc')).toBe(3);
    expect(countChars('長頸鹿')).toBe(3);
  });

  it('BMP 外的 emoji（代理對）算 1', () => {
    expect('👍'.length).toBe(2);
    expect(countChars('👍')).toBe(1);
  });

  it('不做字形叢集：ZWJ 家庭 emoji 依 code point 算 5', () => {
    expect(countChars('👨‍👩‍👧')).toBe(5);
  });

  it('空字串為 0', () => {
    expect(countChars('')).toBe(0);
  });
});

describe('hasControlChars', () => {
  it('換行、tab、NUL、BEL、DEL 皆為控制字元', () => {
    for (const c of ['\n', '\r', '\t', '\u0000', '\u0007', '\u007f', '\u0085']) {
      expect(hasControlChars(`a${c}b`)).toBe(true);
    }
  });

  it('一般文字、空白、全形空白、emoji 不是控制字元', () => {
    expect(hasControlChars('Alice 小明　👍')).toBe(false);
  });

  it('零寬連接符（ZWJ，屬 Cf 非 Cc）不算控制字元', () => {
    expect(hasControlChars('👨‍👩‍👧')).toBe(false);
  });
});
