// 圖片訊息驗證：spec/architecture.md §5「圖片訊息」、§8（Epic 2）
// magic bytes 判定的純函式在 shared（sniffImageMime）；這裡負責 payload 形狀、mime 清單、大小、寬高與繁中錯誤訊息。
import {
  IMAGE_MIMES,
  IMAGE_MIN_INTERVAL_MS,
  MAX_IMAGE_BYTES,
  sniffImageMime,
  type ImageMeta,
  type ImageMime,
} from '@fishing-work/shared';

/** 寬高上限（spec §5：寬高須為 1..4096 的整數；spec 未命名常數，定義在 server 端） */
export const IMAGE_DIMENSION_MAX = 4096;

/** chat:image 的繁中錯誤訊息（ack.message，客戶端直接顯示） */
export const IMAGE_ERROR_MESSAGES = {
  /** payload 形狀不對（不是物件、欄位缺或型別錯、data 不是二進位） */
  PAYLOAD: '圖片資料格式錯誤，請重新選擇圖片',
  MIME: '不支援的圖片格式（僅限 PNG、JPEG、GIF、WebP）',
  MAGIC: '圖片內容與格式不符',
  SIZE: `圖片大小需為 1 byte～${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
  DIMENSION: `圖片寬高需為 1～${IMAGE_DIMENSION_MAX} 的整數`,
  RATE_LIMITED: `傳圖太快了，請稍候再送（間隔至少 ${IMAGE_MIN_INTERVAL_MS / 1000} 秒）`,
  /** 畫師在 choosing／drawing 傳圖（文字照 spec §5） */
  SPOILER_BLOCKED: '作畫中畫師不能傳圖片',
} as const;

/** Room.image 收到的中繼資料：mime 尚未確認在清單內（由 validateImage 判定）；bytes 不由客戶端提供（server 以實際長度填入） */
export interface ImageMetaInput {
  mime: string;
  width: number;
  height: number;
}

export interface ImagePayloadInput {
  meta: ImageMetaInput;
  data: Uint8Array;
}

/**
 * 讀取 chat:image 的 payload（register 用；spec §5 檢查表第一列）：
 * 不是物件、mime 非字串、width／height 非數字、data 不是 ArrayBuffer 或 Uint8Array（含 Buffer）→ null（IMAGE_INVALID）。
 * 其他 TypedArray／DataView 一律拒。客戶端多帶的欄位（例如 bytes）一律忽略、不驗（spec §5：bytes 由 server 填入）。
 */
export function readImagePayload(payload: unknown): ImagePayloadInput | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { mime, width, height, data } = payload as Record<string, unknown>;
  if (typeof mime !== 'string' || typeof width !== 'number' || typeof height !== 'number') return null;
  let view: Uint8Array;
  if (data instanceof ArrayBuffer) view = new Uint8Array(data);
  else if (data instanceof Uint8Array) view = data; // Node 端 socket.io 還原的二進位為 Buffer（Uint8Array 子類別）
  else return null;
  return { meta: { mime, width, height }, data: view };
}

export type ImageCheck = { ok: true; meta: ImageMeta } | { ok: false; message: string };

function isImageMime(mime: string): mime is ImageMime {
  return (IMAGE_MIMES as readonly string[]).includes(mime);
}

function isDimension(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= IMAGE_DIMENSION_MAX;
}

/**
 * 內容驗證（spec §5 IMAGE_INVALID 列，依序）：mime ∈ IMAGE_MIMES → 大小 1..MAX_IMAGE_BYTES
 * → magic bytes 與 mime 相符 → 寬高為 1..IMAGE_DIMENSION_MAX 的整數。
 * 通過時回傳正規化後的 ImageMeta（只含四個欄位，bytes 由 server 以實際 data 長度填入）。
 */
export function validateImage(meta: ImageMetaInput, data: Uint8Array): ImageCheck {
  if (!isImageMime(meta.mime)) return { ok: false, message: IMAGE_ERROR_MESSAGES.MIME };
  const size = data.byteLength;
  if (size === 0 || size > MAX_IMAGE_BYTES) return { ok: false, message: IMAGE_ERROR_MESSAGES.SIZE };
  if (sniffImageMime(data) !== meta.mime) return { ok: false, message: IMAGE_ERROR_MESSAGES.MAGIC };
  if (!isDimension(meta.width) || !isDimension(meta.height)) {
    return { ok: false, message: IMAGE_ERROR_MESSAGES.DIMENSION };
  }
  return { ok: true, meta: { mime: meta.mime, width: meta.width, height: meta.height, bytes: size } };
}

/**
 * 轉成 chat:image 要送出的 ArrayBuffer（§4 ImagePayload.data）。
 * 若 view 剛好涵蓋整個 ArrayBuffer 就直接沿用，否則複製所需區段。
 * 注意：socket.io 在 Node 端還原的 Buffer 是整個 WebSocket frame 的切片（byteOffset ≠ 0），
 * 而 `Buffer#slice` 不複製（等同 subarray），直接取 `.buffer` 會把整個 frame（含其他封包內容）送出去；
 * 因此一律用 `new Uint8Array(view)` 複製。
 */
export function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = view;
  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) return buffer;
  return new Uint8Array(view).buffer;
}
