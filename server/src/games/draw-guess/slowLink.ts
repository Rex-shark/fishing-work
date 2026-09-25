// 聊天圖片的慢連線保護：spec/architecture.md §5「圖片訊息」（2026-09-25 壓測定案）、§4 IMAGE_SKIP_BUFFER_BYTES。
// 發 chat:image 前檢查每個收件 socket 的待送量，超過門檻者改收 { id, data: null }（略過這張），
// 避免慢連線的 ping 封包排在一串 10 MB 圖片後面而被 ping timeout 誤判斷線。
//
// 待送量 = engine.io Socket 的 writeBuffer（transport 不可寫時累積的封包）
//        + WebSocket transport 底層 ws 的 bufferedAmount（已交給 ws、還在 Node 寫入佇列裡的 bytes）。
// 兩者都是 engine.io 6.6／ws 8 的內部結構（型別上為 private），因此以執行期形狀檢查讀取，形狀不符時該部分視為 0
// （等同不保護、照常送圖，不會誤擋）；server/test/slowLink.test.ts 以假物件鎖定讀法，e2e 以真實暫停讀取的客戶端驗證。

/** 單一封包資料的位元組數：字串以 UTF-8 計、二進位以 byteLength 計，其他（無資料）為 0 */
export function packetBytes(data: unknown): number {
  if (typeof data === 'string') return Buffer.byteLength(data, 'utf8');
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return 0;
}

/**
 * engine.io Socket（socket.io 的 `socket.conn`）的待送量（bytes）：
 * - `writeBuffer`：transport 忙碌（上一批還沒寫完）時新封包排在這裡；慢連線的 ping 也卡在這裡
 * - `transport.socket.bufferedAmount`：WebSocket transport 已交給 ws、尚未寫進核心的 bytes（Node 寫入佇列）
 * polling transport 沒有底層 ws，只計 writeBuffer。conn 不存在（socket 已離線）回 0。
 */
export function pendingBytes(conn: unknown): number {
  if (typeof conn !== 'object' || conn === null) return 0;
  let total = 0;
  const { writeBuffer, transport } = conn as { writeBuffer?: unknown; transport?: unknown };
  if (Array.isArray(writeBuffer)) {
    for (const packet of writeBuffer) {
      if (typeof packet === 'object' && packet !== null) total += packetBytes((packet as { data?: unknown }).data);
    }
  }
  if (typeof transport === 'object' && transport !== null) {
    const ws = (transport as { socket?: unknown }).socket;
    if (typeof ws === 'object' && ws !== null) {
      const buffered = (ws as { bufferedAmount?: unknown }).bufferedAmount;
      if (typeof buffered === 'number' && Number.isFinite(buffered) && buffered > 0) total += buffered;
    }
  }
  return total;
}

/**
 * 依待送量把收件者分成兩組（保持原順序）：待送量 **超過** threshold（> threshold）者略過，其餘照常送。
 * pendingBytesOf 丟例外或回傳非有限數時視為 0（照常送，不因量測失敗而誤擋）。
 */
export function partitionRecipients<T>(
  recipients: readonly T[],
  pendingBytesOf: (recipient: T) => number,
  threshold: number,
): { normal: T[]; skipped: T[] } {
  const normal: T[] = [];
  const skipped: T[] = [];
  for (const r of recipients) {
    let pending = 0;
    try {
      const v = pendingBytesOf(r);
      pending = Number.isFinite(v) ? v : 0;
    } catch {
      pending = 0;
    }
    (pending > threshold ? skipped : normal).push(r);
  }
  return { normal, skipped };
}
