// 繪圖比賽測試用：結構合法的 PNG／JPEG bytes（server 不解碼，只驗 magic、IHDR 寬高與 chunk 結構／JPEG 結尾，§5.1、§5.1b、§5.5）
import { crc32, deflateSync } from 'node:zlib';
import { CANVAS_LOGICAL, type JudgeMode } from '@fishing-work/shared/draw-contest';
import type { CommentInput, Commentator } from '../../src/games/draw-contest/commentary/queue';
import type { Judge, JudgeInput, JudgeOutput } from '../../src/games/draw-contest/judge/types';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/** 一個 PNG chunk：長度＋型別＋資料＋CRC32（CRC 照算，真解碼器也讀得了） */
export function pngChunk(type: string, data: Uint8Array = new Uint8Array(0)): Uint8Array {
  const td = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  return Uint8Array.from([...u32(data.byteLength), ...td, ...u32(crc32(td))]);
}

/** IDAT 內容快取（依寬高）：8-bit RGB、每列 filter 0、整張 #1E1E1E（CANVAS_BACKGROUND），zlib 壓縮 */
const idatCache = new Map<string, Uint8Array>();
function blankIdat(width: number, height: number): Uint8Array {
  const key = `${width}x${height}`;
  let idat = idatCache.get(key);
  if (idat === undefined) {
    const stride = 1 + width * 3;
    const raw = Buffer.alloc(stride * height, 0x1e);
    for (let y = 0; y < height; y++) raw[y * stride] = 0;
    idat = new Uint8Array(deflateSync(raw));
    idatCache.set(key, idat);
  }
  return idat;
}

function concat(parts: Uint8Array[]): Uint8Array {
  return Uint8Array.from(Buffer.concat(parts.map((p) => Buffer.from(p))));
}

/** IHDR chunk（8-bit RGB、無交錯） */
function ihdrChunk(width: number, height: number): Uint8Array {
  return pngChunk('IHDR', Uint8Array.from([...u32(width), ...u32(height), 8, 2, 0, 0, 0]));
}

/**
 * 合法交卷 PNG（預設 1280×720；簽章＋IHDR＋tEXt＋IDAT＋IEND，結構合法、真解碼器也讀得了）。
 * seed 改變 tEXt 的內容 bytes（extra 個），讓 random 評分器與假 Ollama 給不同分數；extra = 0 時不帶 tEXt。
 */
export function makePng(seed = 0, width: number = CANVAS_LOGICAL.width, height: number = CANVAS_LOGICAL.height, extra = 32): Uint8Array {
  const parts = [Uint8Array.from(SIGNATURE), ihdrChunk(width, height)];
  if (extra > 0) {
    const text = Buffer.alloc(8 + extra);
    text.write('Comment\0', 'latin1');
    for (let i = 0; i < extra; i++) text[8 + i] = 0x21 + ((seed * 31 + i * 7) % 90); // 可列印字元
    parts.push(pngChunk('tEXt', text));
  }
  parts.push(pngChunk('IDAT', blankIdat(width, height)), pngChunk('IEND'));
  return concat(parts);
}

/** 剛好 size bytes 的合法 1280×720 PNG（插 tEXt 補足，測大小上限用） */
export function makePngOfSize(size: number, seed = 0): Uint8Array {
  const bare = makePng(seed, CANVAS_LOGICAL.width, CANVAS_LOGICAL.height, 0).byteLength;
  // tEXt chunk 自身 12 bytes 開銷＋關鍵字 'Comment\0' 8 bytes
  const extra = size - bare - 12 - 8;
  if (extra < 0) throw new Error(`makePngOfSize：${size} 太小（至少 ${bare + 20}）`);
  const out = makePng(seed, CANVAS_LOGICAL.width, CANVAS_LOGICAL.height, extra);
  if (out.byteLength !== size) throw new Error(`makePngOfSize：長度 ${out.byteLength} ≠ ${size}`);
  return out;
}

/**
 * 帶標記的合法 1280×720 PNG：tEXt chunk 內含 marker 字串（latin1），給假 Ollama 的 rejectMarker 認（Epic 21）。
 * seed 讓同一個標記的不同張 bytes 不同。
 */
export function makeMarkedPng(marker: string, seed = 0): Uint8Array {
  return pngFromChunks([
    ihdrChunk(CANVAS_LOGICAL.width, CANVAS_LOGICAL.height),
    pngChunk('tEXt', Buffer.from(`Comment\0${marker}#${seed}`, 'latin1')),
    pngChunk('IDAT', blankIdat(CANVAS_LOGICAL.width, CANVAS_LOGICAL.height)),
    pngChunk('IEND'),
  ]);
}

/** 由 chunk 組 PNG（簽章＋各 chunk），組壞的 PNG 用 */
export function pngFromChunks(chunks: Uint8Array[]): Uint8Array {
  return concat([Uint8Array.from(SIGNATURE), ...chunks]);
}

/** makePng 的組件：IHDR、IDAT、IEND chunk（壞 PNG 測試用） */
export const pngParts = {
  ihdr: (width: number = CANVAS_LOGICAL.width, height: number = CANVAS_LOGICAL.height) => ihdrChunk(width, height),
  idat: () => pngChunk('IDAT', blankIdat(CANVAS_LOGICAL.width, CANVAS_LOGICAL.height)),
  iend: () => pngChunk('IEND'),
};

/**
 * 合法的 1×1 JPEG（288 bytes，libjpeg cjpeg -quality 90 -optimize 產生：SOI、JFIF APP0、DQT×2、SOF0、DHT×4、SOS、掃描資料、EOI）。
 * sips 讀得出 1×1；makeJpeg 在 APP0 之後插 COM segment 變化內容與長度。
 */
const BASE_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABwn/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdAAYqm//Z',
  'base64',
);
/** SOI（2）＋APP0（2＋16）之後的位置：COM 插在這裡 */
const JPEG_INSERT_AT = 20;
/** 一個 COM segment 最多帶的資料量（長度欄含自身 2 bytes，上限 65535） */
const COM_MAX_DATA = 65533;
export const MIN_JPEG_BYTES = BASE_JPEG.byteLength;

/**
 * 合法 JPEG（FF D8 FF 開頭、FF D9 結尾、segment 結構正確），整檔剛好 size bytes（預設 BASE＋36）。
 * seed 決定 COM 的內容 bytes。size 須為 MIN_JPEG_BYTES，或 ≥ MIN_JPEG_BYTES + 4（一個 COM 至少 4 bytes）。
 */
export function makeJpeg(seed = 0, size: number = MIN_JPEG_BYTES + 36): Uint8Array {
  let extra = size - MIN_JPEG_BYTES;
  if (extra < 0 || (extra > 0 && extra < 4)) throw new Error(`makeJpeg：size ${size} 無法組成（最小 ${MIN_JPEG_BYTES}，或 ≥ ${MIN_JPEG_BYTES + 4}）`);
  const segments: Buffer[] = [];
  let k = 0;
  while (extra > 0) {
    let n = Math.min(extra, COM_MAX_DATA + 4);
    if (extra - n > 0 && extra - n < 4) n -= 4; // 剩下不足一個 COM 的開銷：這段少拿 4 bytes
    const seg = Buffer.alloc(n);
    seg[0] = 0xff;
    seg[1] = 0xfe;
    seg.writeUInt16BE(n - 2, 2);
    for (let i = 4; i < n; i++) seg[i] = 0x21 + ((seed * 37 + k * 13 + i * 11) % 90); // 可列印字元，不會出現 0xFF
    segments.push(seg);
    extra -= n;
    k++;
  }
  return Uint8Array.from(Buffer.concat([BASE_JPEG.subarray(0, JPEG_INSERT_AT), ...segments, BASE_JPEG.subarray(JPEG_INSERT_AT)]));
}

/** 讓所有已排定的 microtask／promise 鏈跑完（評分佇列的結果經 promise 回報） */
export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ─── 假評分器 ─────────────────────────────────────────────────────

export interface ManualCall {
  input: JudgeInput;
  signal: AbortSignal;
  resolve(out: JudgeOutput): void;
  reject(err: unknown): void;
}

/** 手動評分器：每次 score() 記一筆，由測試決定何時以什麼分數 resolve／reject；收到 abort 即 reject */
export class ManualJudge implements Judge {
  readonly calls: ManualCall[] = [];
  constructor(readonly mode: JudgeMode = 'ai') {}
  score(input: JudgeInput, signal: AbortSignal): Promise<JudgeOutput> {
    return new Promise((resolve, reject) => {
      this.calls.push({ input, signal, resolve, reject });
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }
  /** resolve 第 i 次呼叫 */
  resolveCall(i: number, score: number, confidence = 0.5): void {
    const c = this.calls[i];
    if (!c) throw new Error(`沒有第 ${i} 次評分呼叫`);
    c.resolve({ score, confidence });
  }
}

/** 立即以函式決定分數的評分器（記錄呼叫） */
export class FnJudge implements Judge {
  readonly inputs: JudgeInput[] = [];
  constructor(
    private readonly fn: (input: JudgeInput) => JudgeOutput,
    readonly mode: JudgeMode = 'random',
  ) {}
  score(input: JudgeInput): Promise<JudgeOutput> {
    this.inputs.push(input);
    return Promise.resolve(this.fn(input));
  }
}

// ─── 假評語器（Epic 15）──────────────────────────────────────────

export interface ManualCommentCall {
  input: CommentInput;
  signal: AbortSignal;
  resolve(comment: string): void;
  reject(err: unknown): void;
}

/** 手動評語器：每次 comment() 記一筆，由測試決定何時以什麼內容 resolve／reject；收到 abort 即 reject */
export class ManualCommentator implements Commentator {
  readonly calls: ManualCommentCall[] = [];
  comment(input: CommentInput, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      this.calls.push({ input, signal, resolve, reject });
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }
  /** resolve 第 i 次呼叫 */
  resolveCall(i: number, comment: string): void {
    const c = this.calls[i];
    if (!c) throw new Error(`沒有第 ${i} 次評語呼叫`);
    c.resolve(comment);
  }
  /** reject 第 i 次呼叫 */
  rejectCall(i: number, err: unknown = new Error('boom')): void {
    const c = this.calls[i];
    if (!c) throw new Error(`沒有第 ${i} 次評語呼叫`);
    c.reject(err);
  }
}

/** 立即以函式決定內容的評語器（記錄呼叫） */
export class FnCommentator implements Commentator {
  readonly inputs: CommentInput[] = [];
  constructor(private readonly fn: (input: CommentInput) => string) {}
  comment(input: CommentInput): Promise<string> {
    this.inputs.push(input);
    return Promise.resolve(this.fn(input));
  }
}
