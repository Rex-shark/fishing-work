// 交卷 PNG 驗證：spec/draw-contest/architecture.md §5.1
import { describe, expect, it } from 'vitest';
import { MAX_SUBMISSION_BYTES } from '@fishing-work/shared/draw-contest';
import { checkSubmission, copyToArrayBuffer, isValidSubmissionPng, readSubmissionPayload } from '../src/games/draw-contest/submission';
import { makePng } from './helpers/drawContest';

describe('§5.1 readSubmissionPayload（形狀）', () => {
  it('ArrayBuffer、Uint8Array、Buffer 皆可', () => {
    const png = makePng();
    expect(readSubmissionPayload({ png: png.buffer })).toEqual(png);
    expect(readSubmissionPayload({ png })).toBe(png);
    const buf = Buffer.from(png);
    expect(readSubmissionPayload({ png: buf })).toBe(buf);
  });

  it('不是物件、缺 png、png 為字串／陣列／其他 TypedArray／DataView → null', () => {
    const png = makePng();
    for (const bad of [null, undefined, 'x', 1, [], {}, { png: 'abc' }, { png: [...png] }, { png: new Uint16Array(4) }, { png: new DataView(png.buffer) }]) {
      expect(readSubmissionPayload(bad)).toBeNull();
    }
  });
});

describe('§5.1 isValidSubmissionPng（內容）', () => {
  it('1280×720、magic 正確 → 合法', () => {
    expect(isValidSubmissionPng(makePng())).toBe(true);
  });

  it('空、過短、magic 錯 → 不合法', () => {
    expect(isValidSubmissionPng(new Uint8Array(0))).toBe(false);
    expect(isValidSubmissionPng(makePng().subarray(0, 24))).toBe(false);
    const bad = makePng();
    bad[0] = 0x00;
    expect(isValidSubmissionPng(bad)).toBe(false);
    const jpeg = makePng();
    jpeg.set([0xff, 0xd8, 0xff, 0xe0], 0);
    expect(isValidSubmissionPng(jpeg)).toBe(false);
  });

  it('IHDR 寬高不等於 CANVAS_LOGICAL → 不合法', () => {
    expect(isValidSubmissionPng(makePng(0, 1279, 720))).toBe(false);
    expect(isValidSubmissionPng(makePng(0, 1280, 721))).toBe(false);
    expect(isValidSubmissionPng(makePng(0, 720, 1280))).toBe(false);
  });

  it('第一個 chunk 不是 IHDR 或長度不是 13 → 不合法', () => {
    const wrongType = makePng();
    wrongType[12] = 0x69; // 'iHDR'
    expect(isValidSubmissionPng(wrongType)).toBe(false);
    const wrongLen = makePng();
    wrongLen[11] = 14;
    expect(isValidSubmissionPng(wrongLen)).toBe(false);
  });

  it(`大小上限 MAX_SUBMISSION_BYTES（${MAX_SUBMISSION_BYTES}）：剛好合法、多 1 byte 不合法`, () => {
    const head = makePng(0, 1280, 720, 0);
    const exact = new Uint8Array(MAX_SUBMISSION_BYTES);
    exact.set(head);
    expect(isValidSubmissionPng(exact)).toBe(true);
    const over = new Uint8Array(MAX_SUBMISSION_BYTES + 1);
    over.set(head);
    expect(isValidSubmissionPng(over)).toBe(false);
  });
});

describe('checkSubmission／copyToArrayBuffer', () => {
  it('形狀＋內容一起驗', () => {
    expect(checkSubmission({ png: makePng() }).ok).toBe(true);
    expect(checkSubmission({ png: makePng(0, 1, 1) }).ok).toBe(false);
    expect(checkSubmission(null).ok).toBe(false);
  });

  it('切片的 Buffer（byteOffset ≠ 0）複製出剛好那段', () => {
    const png = makePng(9);
    const frame = Buffer.concat([Buffer.from([1, 2, 3]), Buffer.from(png), Buffer.from([4, 5])]);
    const view = frame.subarray(3, 3 + png.byteLength);
    const out = copyToArrayBuffer(view);
    expect(out.byteLength).toBe(png.byteLength);
    expect([...new Uint8Array(out)]).toEqual([...png]);
  });
});
