// 參考圖驗證（Epic 20 像不像比賽）：spec/draw-contest/architecture.md §5.1b
// round:setTopic 的 reference：省略或 undefined → topic 模式（現況）；有值須為 ArrayBuffer／Buffer／Uint8Array、
// 長度 1..MAX_REFERENCE_BYTES、前 3 bytes 為 JPEG magic FF D8 FF；不合法 → REFERENCE_INVALID。
// 客戶端已把參考圖正規化成 JPEG（長邊 ≤ 1280、品質 0.9）；server 不解碼，只存 bytes。
import { MAX_REFERENCE_BYTES } from '@fishing-work/shared/draw-contest';

/** JPEG 檔頭（SOI ＋ 下一個 marker 的 FF） */
export const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;

/** reference 的值轉成 bytes：ArrayBuffer 或 Uint8Array（含 Node 端 socket.io 還原的 Buffer）；其他型別 → null */
function readReferenceBytes(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Uint8Array) return value;
  return null;
}

/** JPEG bytes 是否合法（§5.1b 長度、magic） */
export function isValidReferenceJpeg(bytes: Uint8Array): boolean {
  const size = bytes.byteLength;
  if (size < 1 || size > MAX_REFERENCE_BYTES || size < JPEG_SIGNATURE.length) return false;
  for (let i = 0; i < JPEG_SIGNATURE.length; i++) if (bytes[i] !== JPEG_SIGNATURE[i]) return false;
  return true;
}

export type ReferenceCheck =
  /** 沒有參考圖（省略或 undefined）→ topic 模式 */
  | { ok: true; jpeg: null }
  /** 合法參考圖 → mimic 模式；jpeg 為獨立複本（不與 socket.io 的 frame 共用記憶體） */
  | { ok: true; jpeg: ArrayBuffer }
  | { ok: false };

/**
 * 驗 setTopic payload 的 reference 欄位（§5.1b）。
 * undefined → 沒有參考圖；其餘值（含 null、字串、其他 TypedArray）都要通過型別、長度、magic 檢查，否則不合法。
 */
export function checkReference(value: unknown): ReferenceCheck {
  if (value === undefined) return { ok: true, jpeg: null };
  const bytes = readReferenceBytes(value);
  if (bytes === null || !isValidReferenceJpeg(bytes)) return { ok: false };
  // socket.io 在 Node 端還原的 Buffer 是整個 frame 的切片（byteOffset ≠ 0），一律複製
  return { ok: true, jpeg: new Uint8Array(bytes).buffer };
}
