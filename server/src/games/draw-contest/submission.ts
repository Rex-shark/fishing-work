// 交卷 PNG 驗證：spec/draw-contest/architecture.md §5.1
// payload 為物件、png 為 ArrayBuffer／Buffer／Uint8Array，長度 1..MAX_SUBMISSION_BYTES；
// 前 8 bytes 為 PNG magic；IHDR 寬高等於 CANVAS_LOGICAL。server 不解碼圖片，只存 bytes。
// Epic 21（§5.5，code review #5）加結構檢查（不解碼、不算 CRC）：簽章後逐 chunk 走訪且長度不越界；第一個 chunk 為 IHDR；
// 至少一個 IDAT；最後一個為長度 0 的 IEND 且檔案恰好結束。原本 33 bytes 的假 PNG 會通過、送到 Ollama 被 400 拖累整回合。
import { CANVAS_LOGICAL, MAX_SUBMISSION_BYTES } from '@fishing-work/shared/draw-contest';

/** PNG 檔頭（magic bytes） */
export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** 檔頭 8 ＋ IHDR chunk（長度 4、型別 4、資料 13、CRC 4）＝ 33 bytes：短於此不可能是合法 PNG */
const MIN_PNG_BYTES = 33;
/** IHDR 資料長度固定 13 */
const IHDR_LENGTH = 13;
/** chunk 的長度欄 4 ＋ 型別 4 ＋ CRC 4（資料另計） */
const CHUNK_OVERHEAD = 12;
/** chunk 型別（ASCII 四字元，讀成 big-endian u32 比對） */
const TYPE_IHDR = 0x49484452; // 'IHDR'
const TYPE_IDAT = 0x49444154; // 'IDAT'
const TYPE_IEND = 0x49454e44; // 'IEND'

/**
 * 讀取 contest:submit 的 payload：不是物件、png 不是 ArrayBuffer 或 Uint8Array（含 Buffer）→ null。
 * 其他 TypedArray／DataView 一律拒。
 */
export function readSubmissionPayload(payload: unknown): Uint8Array | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { png } = payload as Record<string, unknown>;
  if (png instanceof ArrayBuffer) return new Uint8Array(png);
  if (png instanceof Uint8Array) return png; // Node 端 socket.io 還原的二進位為 Buffer（Uint8Array 子類別）
  return null;
}

/** 讀 big-endian 無號 32 位元整數 */
function readU32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

/**
 * PNG bytes 是否合法（§5.1 長度、magic、IHDR 寬高；§5.5 結構）。
 * 結構：簽章之後逐 chunk 走訪（長度＋型別＋資料＋CRC 不得越過檔尾）；第一個 chunk 是長度 13 的 IHDR 且寬高＝CANVAS_LOGICAL；
 * 至少一個 IDAT；遇到 IEND 時其長度須為 0、且它的 CRC 之後檔案恰好結束（IEND 必為最後一個 chunk）。CRC 不驗、內容不解碼。
 */
export function isValidSubmissionPng(bytes: Uint8Array): boolean {
  const size = bytes.byteLength;
  if (size < 1 || size > MAX_SUBMISSION_BYTES || size < MIN_PNG_BYTES) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  let offset: number = PNG_SIGNATURE.length;
  let first = true;
  let sawIdat = false;
  while (offset + 8 <= size) {
    const length = readU32(bytes, offset);
    const type = readU32(bytes, offset + 4);
    const end = offset + CHUNK_OVERHEAD + length;
    if (end > size) return false; // 長度越界（含長度欄是天文數字）
    if (first) {
      if (type !== TYPE_IHDR || length !== IHDR_LENGTH) return false;
      if (readU32(bytes, offset + 8) !== CANVAS_LOGICAL.width || readU32(bytes, offset + 12) !== CANVAS_LOGICAL.height) return false;
      first = false;
    } else if (type === TYPE_IHDR) {
      return false; // IHDR 只能有一個且在最前面
    }
    if (type === TYPE_IDAT) sawIdat = true;
    if (type === TYPE_IEND) return length === 0 && end === size && sawIdat;
    offset = end;
  }
  // 走到檔尾（或剩不到一個 chunk 標頭）都沒遇到 IEND
  return false;
}

/** payload 形狀＋內容一次驗完；合法時回傳 bytes（尚未複製） */
export function checkSubmission(payload: unknown): { ok: true; png: Uint8Array } | { ok: false } {
  const png = readSubmissionPayload(payload);
  if (png === null || !isValidSubmissionPng(png)) return { ok: false };
  return { ok: true, png };
}

/**
 * 複製成獨立的 ArrayBuffer（存檔與 contest:gallery 用）。
 * socket.io 在 Node 端還原的 Buffer 是整個 WebSocket frame 的切片（byteOffset ≠ 0），直接取 .buffer 會帶出其他封包內容，因此一律複製。
 */
export function copyToArrayBuffer(view: Uint8Array): ArrayBuffer {
  return new Uint8Array(view).buffer;
}
