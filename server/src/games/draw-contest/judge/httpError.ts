// 上游（Ollama）HTTP 錯誤與分類：spec/draw-contest/architecture.md §5.5「評分器錯誤分類」（Epic 21 決策 4、決策 11，code review #5）
// - 輸入被拒（白名單，決策 11）：HTTP 400／413／415／422——只跟這張輸入有關 → 只影響這一張
//   （評分退回 random 但不降級、評語該張 null 且不計連續失敗）。
// - 其餘一切＝上游不可用（連線失敗、逾時、5xx、404 模型不存在、401／403、408／429、其他 4xx、回應解析失敗）
//   → 照原規則處理（評分整回合降級、評語計入連續失敗）。404 若算被拒，缺模型時會每張都退 random 卻顯示 judgeMode 'ai'。
// 評分器（judge/ollama.ts）與評語器（commentary/ollamaChat.ts）收到非 2xx 一律拋此類別，佇列以 isInputRejected 判斷。

/** 上游回非 2xx：status 為 HTTP 狀態碼；message 附 Ollama 回的 error 文字 */
export class UpstreamHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'UpstreamHttpError';
    this.status = status;
  }
}

/** 「這張輸入被拒」的狀態碼白名單（§5.5，決策 11） */
export const INPUT_REJECTED_STATUSES: ReadonlySet<number> = new Set([400, 413, 415, 422]);

/** 是否為「這張輸入被拒」：UpstreamHttpError 且狀態碼在白名單內 */
export function isInputRejected(err: unknown): boolean {
  return err instanceof UpstreamHttpError && INPUT_REJECTED_STATUSES.has(err.status);
}
