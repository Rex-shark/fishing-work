// 圖片 magic bytes 判定（spec/architecture.md §5「圖片訊息」、§8；Epic 2）
// 純函式、無執行期相依：server 用來驗證客戶端宣告的 mime，client 可預檢。
import type { ImageMime } from './events';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const GIF87A = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] as const; // "GIF87a"
const GIF89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] as const; // "GIF89a"
const RIFF = [0x52, 0x49, 0x46, 0x46] as const; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50] as const; // "WEBP"（offset 8）

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

/**
 * 依檔頭 magic bytes 判斷圖片格式；不認得（含截斷、空）回 null。
 * - PNG：89 50 4E 47 0D 0A 1A 0A
 * - JPEG：FF D8 FF
 * - GIF："GIF87a"／"GIF89a"
 * - WebP："RIFF" + 4 bytes 長度 + "WEBP"（offset 8）
 */
export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  if (startsWith(bytes, GIF87A) || startsWith(bytes, GIF89A)) return 'image/gif';
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return 'image/webp';
  return null;
}
