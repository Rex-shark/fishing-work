// 繪圖比賽文字驗證：spec/draw-contest/architecture.md §4（validateTopic）、§5.3（validateChatText）
import { describe, expect, it } from 'vitest';
import { CHAT_MAX, TOPIC_MAX } from '../src/draw-contest/constants';
import { countChars, hasControlChars, TOPIC_INVALID_MESSAGE, validateChatText, validateTopic } from '../src/draw-contest/text';

describe('countChars／hasControlChars', () => {
  it('emoji 以 code point 計', () => {
    expect(countChars('👍')).toBe(1);
    expect(countChars('長頸鹿')).toBe(3);
  });

  it('換行、tab 為控制字元，全形空白與 ZWJ 不是', () => {
    expect(hasControlChars('a\nb')).toBe(true);
    expect(hasControlChars('a\tb')).toBe(true);
    expect(hasControlChars('a　b👨‍👩‍👧')).toBe(false);
  });
});

describe('validateTopic', () => {
  it('回傳去頭尾空白（含全形空白）後的題目', () => {
    expect(validateTopic('  長頸鹿　')).toEqual({ ok: true, topic: '長頸鹿' });
    expect(validateTopic('\n長 頸 鹿\n')).toEqual({ ok: true, topic: '長 頸 鹿' });
  });

  it('空字串不合法', () => {
    expect(validateTopic('')).toEqual({ ok: false });
  });

  it('只有空白（半形、全形、混合）不合法', () => {
    expect(validateTopic('   ').ok).toBe(false);
    expect(validateTopic('　　').ok).toBe(false);
    expect(validateTopic(' 　   ').ok).toBe(false);
  });

  it(`剛好 ${TOPIC_MAX} 字合法、${TOPIC_MAX + 1} 字不合法`, () => {
    expect(validateTopic('一'.repeat(TOPIC_MAX)).ok).toBe(true);
    expect(validateTopic('一'.repeat(TOPIC_MAX + 1)).ok).toBe(false);
  });

  it('emoji 算 1（代理對不算 2）', () => {
    expect(validateTopic('🍎'.repeat(TOPIC_MAX))).toEqual({ ok: true, topic: '🍎'.repeat(TOPIC_MAX) });
    expect(validateTopic('🍎'.repeat(TOPIC_MAX + 1)).ok).toBe(false);
  });

  it('中間含控制字元不合法', () => {
    expect(validateTopic('長\n頸鹿').ok).toBe(false);
    expect(validateTopic('長\t頸鹿').ok).toBe(false);
    expect(validateTopic('長\u0007頸鹿').ok).toBe(false);
  });

  it('超長字串直接判不合法', () => {
    expect(validateTopic('x'.repeat(100_000)).ok).toBe(false);
  });

  it('錯誤文案帶上限', () => {
    expect(TOPIC_INVALID_MESSAGE).toContain(String(TOPIC_MAX));
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
