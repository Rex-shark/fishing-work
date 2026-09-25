// 圖片 magic bytes 判定（spec/architecture.md §5「圖片訊息」；Epic 2）
import { describe, expect, it } from 'vitest';
import {
  IMAGE_MAX_EDGE,
  IMAGE_MIMES,
  IMAGE_MIN_INTERVAL_MS,
  IMAGE_SKIP_BUFFER_BYTES,
  MAX_IMAGE_BYTES,
} from '../src/draw-guess/constants';
import { sniffImageMime } from '../src/draw-guess/image';

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const u8 = (...parts: number[][]): Uint8Array => new Uint8Array(parts.flat());

const PNG = u8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 0x0d]);
const JPEG = u8([0xff, 0xd8, 0xff, 0xe0], [0, 0x10]);
const GIF87 = u8(ascii('GIF87a'), [1, 0, 1, 0]);
const GIF89 = u8(ascii('GIF89a'), [1, 0, 1, 0]);
const WEBP = u8(ascii('RIFF'), [0x1a, 0, 0, 0], ascii('WEBP'), ascii('VP8 '));

describe('sniffImageMime：合法', () => {
  it.each([
    ['PNG', PNG, 'image/png'],
    ['JPEG', JPEG, 'image/jpeg'],
    ['GIF87a', GIF87, 'image/gif'],
    ['GIF89a', GIF89, 'image/gif'],
    ['WebP', WEBP, 'image/webp'],
  ] as const)('%s', (_name, bytes, mime) => {
    expect(sniffImageMime(bytes)).toBe(mime);
  });

  it('剛好只有簽章長度也算合法（JPEG 3 bytes、WebP 12 bytes）', () => {
    expect(sniffImageMime(u8([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(sniffImageMime(u8(ascii('RIFF'), [0, 0, 0, 0], ascii('WEBP')))).toBe('image/webp');
  });

  it('結果都在 IMAGE_MIMES 清單內', () => {
    for (const b of [PNG, JPEG, GIF87, WEBP]) {
      expect(IMAGE_MIMES).toContain(sniffImageMime(b));
    }
  });

  it('接受 Uint8Array 的子視圖（byteOffset 非 0）', () => {
    const buf = new Uint8Array([0, 0, ...PNG]);
    expect(sniffImageMime(buf.subarray(2))).toBe('image/png');
  });
});

describe('sniffImageMime：不合法', () => {
  it('空', () => {
    expect(sniffImageMime(new Uint8Array(0))).toBeNull();
  });

  it.each([
    ['PNG 截斷', PNG.subarray(0, 7)],
    ['JPEG 截斷', JPEG.subarray(0, 2)],
    ['GIF 截斷', GIF89.subarray(0, 5)],
    ['WebP 截斷（缺 WEBP）', WEBP.subarray(0, 11)],
  ])('%s', (_name, bytes) => {
    expect(sniffImageMime(bytes)).toBeNull();
  });

  it.each([
    ['PNG 第 8 byte 錯', u8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b])],
    ['JPEG 第 3 byte 錯', u8([0xff, 0xd8, 0xfe, 0xe0])],
    ['GIF88a', u8(ascii('GIF88a'), [1, 0])],
    ['小寫 gif89a', u8(ascii('gif89a'), [1, 0])],
    ['純文字', u8(ascii('hello, world'))],
    ['BMP', u8(ascii('BM'), [0, 0, 0, 0, 0, 0, 0, 0])],
    ['SVG', u8(ascii('<svg xmlns='))],
  ])('錯誤 header：%s', (_name, bytes) => {
    expect(sniffImageMime(bytes)).toBeNull();
  });

  it('RIFF 但非 WEBP（WAVE、AVI）', () => {
    expect(sniffImageMime(u8(ascii('RIFF'), [0x24, 0, 0, 0], ascii('WAVE'), ascii('fmt ')))).toBeNull();
    expect(sniffImageMime(u8(ascii('RIFF'), [0x24, 0, 0, 0], ascii('AVI '), ascii('LIST')))).toBeNull();
  });

  it('WEBP 不在 offset 8 不算', () => {
    expect(sniffImageMime(u8(ascii('RIFF'), ascii('WEBP'), [0, 0, 0, 0]))).toBeNull();
  });
});

describe('圖片常數（spec §4）', () => {
  it('值照 spec', () => {
    expect(IMAGE_MIMES).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
    expect(MAX_IMAGE_BYTES).toBe(10_485_760);
    expect(IMAGE_MAX_EDGE).toBe(1280);
    expect(IMAGE_MIN_INTERVAL_MS).toBe(3000);
    // 慢連線保護：2 × MAX_IMAGE_BYTES + 2 MiB（允許兩張在途，2026-09-25 定案）
    expect(IMAGE_SKIP_BUFFER_BYTES).toBe(23_068_672);
    expect(IMAGE_SKIP_BUFFER_BYTES).toBe(2 * MAX_IMAGE_BYTES + 2 * 1024 * 1024);
  });
});
