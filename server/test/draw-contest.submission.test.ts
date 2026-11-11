// 交卷 PNG 驗證：spec/draw-contest/architecture.md §5.1
import { describe, expect, it } from 'vitest';
import { MAX_SUBMISSION_BYTES } from '@fishing-work/shared/draw-contest';
import { checkSubmission, copyToArrayBuffer, isValidSubmissionPng, readSubmissionPayload } from '../src/games/draw-contest/submission';
import { makePng, makePngOfSize, pngChunk, pngFromChunks, pngParts } from './helpers/drawContest';

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
    const exact = makePngOfSize(MAX_SUBMISSION_BYTES);
    expect(exact.byteLength).toBe(MAX_SUBMISSION_BYTES);
    expect(isValidSubmissionPng(exact)).toBe(true);
    expect(isValidSubmissionPng(makePngOfSize(MAX_SUBMISSION_BYTES + 1))).toBe(false);
  });
});

describe('§5.5 PNG 結構檢查（Epic 21；不解碼、不算 CRC）', () => {
  const { ihdr, idat, iend } = pngParts;
  const text = () => pngChunk('tEXt', Buffer.from('Comment\0hello', 'latin1'));

  it('最小合法：簽章＋IHDR＋IDAT＋IEND；IHDR 與 IDAT 之間、IDAT 之間可有輔助 chunk、多個 IDAT', () => {
    expect(isValidSubmissionPng(pngFromChunks([ihdr(), idat(), iend()]))).toBe(true);
    expect(isValidSubmissionPng(pngFromChunks([ihdr(), text(), idat(), idat(), text(), iend()]))).toBe(true);
  });

  it('code review #5 的 33 bytes 假 PNG（簽章＋IHDR，沒有 IDAT／IEND）→ 不合法', () => {
    const fake = pngFromChunks([ihdr()]);
    expect(fake.byteLength).toBe(33);
    expect(isValidSubmissionPng(fake)).toBe(false);
    // 舊測試 helper 的假 PNG（簽章＋IHDR 無 CRC＋32 bytes 雜訊）→ 不合法
    const old = Uint8Array.from([...fake.subarray(0, 29), ...Array.from({ length: 32 }, (_, i) => (i * 7) & 0xff)]);
    expect(isValidSubmissionPng(old)).toBe(false);
  });

  it('缺 IEND、缺 IDAT → 不合法', () => {
    expect(isValidSubmissionPng(pngFromChunks([ihdr(), idat()]))).toBe(false);
    expect(isValidSubmissionPng(pngFromChunks([ihdr(), text(), iend()]))).toBe(false);
    expect(isValidSubmissionPng(pngFromChunks([ihdr(), iend()]))).toBe(false);
  });

  it('IEND 後多 bytes、IEND 之後還有 chunk、IEND 長度不是 0 → 不合法', () => {
    const good = makePng(1);
    expect(isValidSubmissionPng(Uint8Array.from([...good, 0x00]))).toBe(false);
    expect(isValidSubmissionPng(pngFromChunks([ihdr(), idat(), iend(), text()]))).toBe(false);
    expect(isValidSubmissionPng(pngFromChunks([ihdr(), idat(), pngChunk('IEND', Uint8Array.of(0))]))).toBe(false);
  });

  it('IHDR 不在第一、出現第二個 IHDR → 不合法', () => {
    expect(isValidSubmissionPng(pngFromChunks([text(), ihdr(), idat(), iend()]))).toBe(false);
    expect(isValidSubmissionPng(pngFromChunks([idat(), ihdr(), iend()]))).toBe(false);
    expect(isValidSubmissionPng(pngFromChunks([ihdr(), idat(), ihdr(), iend()]))).toBe(false);
  });

  it('寬高不符（結構合法但尺寸錯）→ 不合法', () => {
    expect(isValidSubmissionPng(pngFromChunks([ihdr(1279, 720), idat(), iend()]))).toBe(false);
    expect(isValidSubmissionPng(pngFromChunks([ihdr(1, 1), idat(), iend()]))).toBe(false);
  });

  it('chunk 長度越界：IDAT 宣稱的長度超過檔尾、長度欄為 0xFFFFFFFF、截斷在 chunk 標頭中間 → 不合法', () => {
    const good = pngFromChunks([ihdr(), idat(), iend()]);
    const idatAt = 8 + 25; // 簽章 8 ＋ IHDR chunk 25
    const longer = Uint8Array.from(good);
    new DataView(longer.buffer).setUint32(idatAt, readLen(good, idatAt) + 100);
    expect(isValidSubmissionPng(longer)).toBe(false);
    const huge = Uint8Array.from(good);
    new DataView(huge.buffer).setUint32(idatAt, 0xffffffff);
    expect(isValidSubmissionPng(huge)).toBe(false);
    expect(isValidSubmissionPng(good.subarray(0, idatAt + 5))).toBe(false);
    expect(isValidSubmissionPng(good.subarray(0, good.byteLength - 1))).toBe(false); // IEND 的 CRC 少 1 byte
  });

  it('CRC 錯不影響（不算 CRC）', () => {
    const good = makePng(2);
    const badCrc = Uint8Array.from(good);
    badCrc[8 + 21] ^= 0xff; // IHDR 的 CRC 第一個 byte
    expect(isValidSubmissionPng(badCrc)).toBe(true);
  });
});

function readLen(bytes: Uint8Array, at: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at);
}

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
