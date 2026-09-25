import { describe, expect, it } from 'vitest';
import { containsSpoiler, isCorrect, normalizeAnswer } from '../src/draw-guess/answer';

describe('normalizeAnswer', () => {
  it('全形英數轉半形', () => {
    expect(normalizeAnswer('ＡＢＣ１２３')).toBe('abc123');
  });

  it('全形空白與半形空白皆移除', () => {
    expect(normalizeAnswer('蘋　果 派')).toBe('蘋果派');
  });

  it('英文轉小寫', () => {
    expect(normalizeAnswer('HeLLo')).toBe('hello');
  });

  it('移除前後與中間空白（含 tab、換行）', () => {
    expect(normalizeAnswer('  ice \t cream\n ')).toBe('icecream');
  });

  it('中文維持原樣', () => {
    expect(normalizeAnswer('長頸鹿')).toBe('長頸鹿');
  });

  it('全空白字串正規化為空字串', () => {
    expect(normalizeAnswer(' 　 ')).toBe('');
  });
});

describe('isCorrect', () => {
  it('完全相同', () => {
    expect(isCorrect('長頸鹿', '長頸鹿')).toBe(true);
  });

  it('大小寫不同仍相符', () => {
    expect(isCorrect('iphone', 'iPhone')).toBe(true);
  });

  it('全形英數與全形空白仍相符', () => {
    expect(isCorrect('ｉＰｈｏｎｅ　１５', 'iPhone 15')).toBe(true);
  });

  it('前後與中間空白不影響', () => {
    expect(isCorrect('  長 頸 鹿  ', '長頸鹿')).toBe(true);
  });

  it('題目含空白，猜題不含空白也相符', () => {
    expect(isCorrect('icecream', 'Ice Cream')).toBe(true);
  });

  it('不相符：不同詞', () => {
    expect(isCorrect('斑馬', '長頸鹿')).toBe(false);
  });

  it('不相符：只猜到部分', () => {
    expect(isCorrect('長頸', '長頸鹿')).toBe(false);
  });

  it('不相符：多打字', () => {
    expect(isCorrect('長頸鹿啦', '長頸鹿')).toBe(false);
  });

  it('空字串不算猜對', () => {
    expect(isCorrect('', '')).toBe(false);
    expect(isCorrect('  ', ' ')).toBe(false);
  });
});

describe('containsSpoiler', () => {
  it('訊息包含題目', () => {
    expect(containsSpoiler('答案是長頸鹿啦', '長頸鹿')).toBe(true);
  });

  it('訊息以空白拆開題目仍視為洩題', () => {
    expect(containsSpoiler('是 長 頸 鹿 喔', '長頸鹿')).toBe(true);
  });

  it('大小寫、全形不同仍視為洩題', () => {
    expect(containsSpoiler('我猜 ＩＣＥ　ＣＲＥＡＭ 吧', 'ice cream')).toBe(true);
  });

  it('訊息與題目完全相同也算洩題', () => {
    expect(containsSpoiler('長頸鹿', '長頸鹿')).toBe(true);
  });

  it('不包含題目', () => {
    expect(containsSpoiler('脖子很長的動物', '長頸鹿')).toBe(false);
  });

  it('只包含題目一部分不算洩題', () => {
    expect(containsSpoiler('長頸', '長頸鹿')).toBe(false);
  });

  it('題目正規化後為空字串時不視為洩題', () => {
    expect(containsSpoiler('任何訊息', '  ')).toBe(false);
  });
});
