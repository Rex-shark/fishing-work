// 交卷 PNG 驗證：spec/draw-contest/architecture.md §5.1
// payload 為物件、png 為 ArrayBuffer／Buffer／Uint8Array，長度 1..MAX_SUBMISSION_BYTES；
// 前 8 bytes 為 PNG magic；IHDR 寬高等於 CANVAS_LOGICAL。server 不解碼圖片，只存 bytes。
import { CANVAS_LOGICAL, MAX_SUBMISSION_BYTES } from '@fishing-work/shared/draw-contest';

/** PNG 檔頭（magic bytes） */
export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** 檔頭 8 ＋ IHDR chunk（長度 4、型別 4、資料 13、CRC 4）＝ 33 bytes：短於此不可能是合法 PNG */
const MIN_PNG_BYTES = 33;
/** IHDR 資料長度固定 13 */
const IHDR_LENGTH = 13;
/** 'IHDR' 的 ASCII */
const IHDR_TYPE = [0x49, 0x48, 0x44, 0x52] as const;

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

/** PNG bytes 是否合法（§5.1 長度、magic、IHDR 寬高） */
export function isValidSubmissionPng(bytes: Uint8Array): boolean {
  const size = bytes.byteLength;
  if (size < 1 || size > MAX_SUBMISSION_BYTES || size < MIN_PNG_BYTES) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  if (readU32(bytes, 8) !== IHDR_LENGTH) return false;
  for (let i = 0; i < IHDR_TYPE.length; i++) if (bytes[12 + i] !== IHDR_TYPE[i]) return false;
  return readU32(bytes, 16) === CANVAS_LOGICAL.width && readU32(bytes, 20) === CANVAS_LOGICAL.height;
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
