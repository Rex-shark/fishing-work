// メスガキ評語器（Epic 15）：spec/draw-contest/architecture.md §6.1「請求」「回應」
// POST ${OLLAMA_URL}/api/chat，請本機 Ollama 的 gemma4 對一張交卷的畫講一句評語。
//
// API 格式（2026-10-12 以 Ollama 0.40.3、gemma4:26b-mlx-bf16 實測）：
//   請求 { model, stream: false, think: false, keep_alive: '30m',
//          messages: [{ role: 'system', content }, { role: 'user', content, images: [base64] }],
//          options: { temperature: 0.9, num_predict: 120 } }（2026-10-21 Phase 7 由 80 改 120）
//   回應 200 { model, message: { role: 'assistant', content }, done: true,
//              total_duration, load_duration, prompt_eval_count, eval_count, ...（duration 皆奈秒） }
//   錯誤 4xx { error: '…' }（例：model 不存在 404）
// think: false 必帶：gemma4 預設思考，num_predict（當時 80，2026-10-21 起 120）會全被思考吃掉、content 空白（plan/contest-commentary.md 踩雷紀錄）。
// 提示詞只有人設一句＋兩條規則（Rex 2026-10-12：讓 gemma4 自由發揮）：**不加禁詞、不加範例句、不給名次**。
// 參賽者暱稱 2026-10-21 起放進 user 文案（Phase 7，Rex：嘗試看看模型會不會利用名稱），但不教模型怎麼用；
// 暱稱已過 validateNickname（1～12 字、無控制字元），不另過濾。
// 唯一例外是第一名稱讚版（Phase 4，Rex 2026-10-12）：user 文案換成稱讚版，告訴模型「這是第一名、妳不甘心但得承認它畫得好、用雌小鬼的口氣誇它」。
// Epic 20 像不像比賽：mimic 回合 images 為 [參考圖 JPEG, 交卷 PNG]，user 文案（批評版與稱讚版）改說明「第一張是參考圖、第二張是照著畫的」；system 與參數不變。
import { describeFetchError, joinUrl, type FetchLike } from '../judge/ollama';
import { UpstreamHttpError } from '../judge/httpError';
import { abortReason } from '../judge/random';
import type { CommentInput, Commentator } from './queue';

// ─── 請求（文案逐字照 §6.1）───────────────────────────────────────

/**
 * system 提示詞（§6.1 逐字）。人設「メスガキ」寫死在這裡，**不讀** shared 的 COMMENT_PERSONA_NAME：
 * 2026-10-21 起該常數改為卡片上顯示的評審名「ミオ」（Rex 選定），人格與語氣不變。
 * 字數規則 2026-10-21 由 40 改 60 字（Phase 7）。
 */
export const COMMENT_SYSTEM_PROMPT = `你是メスガキ，繪圖比賽的評審。規則只有兩條：用繁體中文（台灣用語）；一句話，60 字內。`;

/** user 提示詞（§6.1 逐字）：題目、暱稱原樣放入、分數為該張最終分數（暱稱 2026-10-21 Phase 7 加入） */
export function commentUserPrompt(topic: string, score: number, nickname: string): string {
  return `題目「${topic}」，評分 ${score} 分。這是參賽者「${nickname}」的畫，給一句評語。`;
}

/**
 * 第一名稱讚版的 user 提示詞（§6.1 逐字，Phase 4）：只有 ended 時的第一名重做用它；system 與其餘參數不變。
 * 2026-10-12 定案改版：初稿只要求模型「稱讚」，真模型實測多半仍直說畫得爛；明說「它畫得好、妳得承認」才有正面肯定（spec §6.1 文案由來）。
 * 2026-10-21 Phase 7 加入「，參賽者「{nickname}」」。
 */
export function praiseUserPrompt(topic: string, score: number, nickname: string): string {
  return `題目「${topic}」，評分 ${score} 分，這張是本回合第一名，參賽者「${nickname}」。妳不甘心，但還是得承認它畫得好，用雌小鬼的口氣誇它，一句評語。`;
}

/** mimic 回合的 user 提示詞（§6.1 逐字，Epic 20）：images 為 [參考圖, 交卷 PNG] */
export function mimicUserPrompt(topic: string, score: number, nickname: string): string {
  return `題目「${topic}」，評分 ${score} 分。第一張是參考圖，第二張是參賽者「${nickname}」照著畫的，給一句評語。`;
}

/** mimic 回合的第一名稱讚版 user 提示詞（§6.1 逐字，Epic 20） */
export function mimicPraiseUserPrompt(topic: string, score: number, nickname: string): string {
  return `題目「${topic}」，評分 ${score} 分，這張是本回合第一名，參賽者「${nickname}」。第一張是參考圖，第二張是它照著畫的。妳不甘心，但還是得承認它畫得像，用雌小鬼的口氣誇它，一句評語。`;
}

/** 模型在一場遊戲裡常駐（§6.1） */
export const COMMENT_KEEP_ALIVE = '30m';
/** 取樣參數（§6.1）：60 字約 60～90 token，120 留餘裕（2026-10-21 Phase 7 由 80 改 120） */
export const COMMENT_OPTIONS = { temperature: 0.9, num_predict: 120 } as const;

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
  images?: string[];
}

export interface ChatRequest {
  model: string;
  stream: false;
  think: false;
  keep_alive: string;
  messages: ChatMessage[];
  options: { temperature?: number; num_predict: number };
}

/**
 * praise = true 時 user 文案用第一名稱讚版，其餘欄位完全相同。
 * referenceBase64 非 null（Epic 20 mimic 回合）：images 為 [參考圖, 交卷 PNG]，user 文案用 mimic 版（批評或稱讚）。
 */
export function buildChatRequest(
  model: string,
  topic: string,
  score: number,
  nickname: string,
  imageBase64: string,
  praise = false,
  referenceBase64: string | null = null,
): ChatRequest {
  const mimic = referenceBase64 !== null;
  const content = mimic
    ? praise
      ? mimicPraiseUserPrompt(topic, score, nickname)
      : mimicUserPrompt(topic, score, nickname)
    : praise
      ? praiseUserPrompt(topic, score, nickname)
      : commentUserPrompt(topic, score, nickname);
  return {
    model,
    stream: false,
    think: false,
    keep_alive: COMMENT_KEEP_ALIVE,
    messages: [
      { role: 'system', content: COMMENT_SYSTEM_PROMPT },
      { role: 'user', content, images: mimic ? [referenceBase64, imageBase64] : [imageBase64] },
    ],
    options: { ...COMMENT_OPTIONS },
  };
}

/** 暖機請求（§6.1「啟動」）：不帶圖的極短 chat，只為把模型載進記憶體並 keep_alive；同樣關思考 */
export function buildWarmupRequest(model: string): ChatRequest {
  return {
    model,
    stream: false,
    think: false,
    keep_alive: COMMENT_KEEP_ALIVE,
    messages: [{ role: 'user', content: '嗨' }],
    options: { num_predict: 1 },
  };
}

// ─── 回應解析與後處理 ─────────────────────────────────────────────

/** 取出 message.content；回應不是物件或缺欄位一律 throw（佇列視為失敗） */
export function parseChatResponse(json: unknown): string {
  if (typeof json !== 'object' || json === null) throw new Error('chat 回應不是 JSON 物件');
  const message = (json as Record<string, unknown>).message;
  if (typeof message !== 'object' || message === null) throw new Error('chat 回應缺 message');
  const content = (message as Record<string, unknown>).content;
  if (typeof content !== 'string') throw new Error(`chat 回應 message.content 不是字串：${JSON.stringify(content)}`);
  return content;
}

/**
 * 後處理（§6.1）：去頭尾空白、取第一行；結果可能是空字串（佇列視為失敗）。
 * **不截斷**：60 字是給模型的規則；畫面也完整顯示（2026-10-12 起揭曉卡片已移除 line-clamp）。
 */
export function cleanComment(content: string): string {
  return content.trim().split(/\r?\n/, 1)[0].trim();
}

// ─── 評語器 ───────────────────────────────────────────────────────

/** 一張評語的回報（給 log）；chars 為 code point 數，0 = 輸出空白 */
export interface CommentedInfo {
  topic: string;
  score: number;
  /** true = 第一名稱讚版 */
  praise: boolean;
  /** true = 像不像比賽（帶參考圖，Epic 20） */
  mimic: boolean;
  comment: string;
  chars: number;
  ms: number;
  promptTokens?: number;
  evalTokens?: number;
}

export interface OllamaCommentatorOptions {
  /** OLLAMA_URL，例 http://127.0.0.1:11434（結尾斜線可有可無） */
  url: string;
  /** COMMENT_MODEL */
  model: string;
  /** 測試注入；預設全域 fetch */
  fetch?: FetchLike;
  /** 每張評語回來時回報內容與耗時（給 log） */
  onCommented?: (info: CommentedInfo) => void;
}

/** HTTP 錯誤：附狀態碼與 Ollama 回的 error 文字（UpstreamHttpError 帶 status，佇列據此區分輸入被拒與上游不可用，§5.5） */
async function httpError(res: Response): Promise<UpstreamHttpError> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { error?: unknown };
      detail = typeof j.error === 'string' ? j.error : text;
    } catch {
      detail = text;
    }
  } catch {
    // 讀不到內文：只報狀態碼
  }
  return new UpstreamHttpError(res.status, `chat HTTP ${res.status}${detail ? `：${detail.slice(0, 200)}` : ''}`);
}

function readCount(json: unknown, key: string): number | undefined {
  const v = (json as Record<string, unknown>)[key];
  return typeof v === 'number' ? v : undefined;
}

/** POST /api/chat 並回傳解析後的 JSON；連線失敗、非 2xx、壞 JSON 皆 throw；中止（逾時／丟棄）原樣拋出 */
async function postChat(fetchImpl: FetchLike, endpoint: string, body: ChatRequest, signal: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw abortReason(signal);
    throw new Error(`連不上 Ollama：${describeFetchError(err)}`);
  }
  if (!res.ok) throw await httpError(res);
  try {
    return await res.json();
  } catch (err) {
    if (signal.aborted) throw abortReason(signal);
    throw new Error(`chat 回應不是合法 JSON：${String(err)}`);
  }
}

export function createOllamaCommentator(options: OllamaCommentatorOptions): Commentator {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const endpoint = joinUrl(options.url, '/api/chat');
  return {
    async comment(input: CommentInput, signal: AbortSignal): Promise<string> {
      if (signal.aborted) throw abortReason(signal);
      const started = Date.now();
      // 交卷原圖（1280×720）直送，不縮圖（§6.1）
      const praise = input.praise === true;
      const reference = input.reference === undefined ? null : input.reference.toString('base64');
      const body = buildChatRequest(options.model, input.topic, input.score, input.nickname, input.png.toString('base64'), praise, reference);
      const json = await postChat(fetchImpl, endpoint, body, signal);
      const comment = cleanComment(parseChatResponse(json));
      const promptTokens = readCount(json, 'prompt_eval_count');
      const evalTokens = readCount(json, 'eval_count');
      options.onCommented?.({
        topic: input.topic,
        score: input.score,
        praise,
        mimic: reference !== null,
        comment,
        chars: [...comment].length,
        ms: Date.now() - started,
        ...(promptTokens !== undefined ? { promptTokens } : {}),
        ...(evalTokens !== undefined ? { evalTokens } : {}),
      });
      return comment;
    },
  };
}

// ─── 暖機 ─────────────────────────────────────────────────────────

export type WarmupResult = { ok: true; ms: number; loadMs?: number } | { ok: false; ms: number; reason: string };

/**
 * 背景暖機（§6.1「啟動」）：送一則不帶圖的極短 chat 把模型載進記憶體（冷啟動實測 9～17 秒）。
 * 只用來 log；成功與否都不影響之後的評語（每張仍照常嘗試）。不 throw。
 */
export async function warmupChat(options: { url: string; model: string; timeoutMs: number; fetch?: FetchLike }): Promise<WarmupResult> {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const started = Date.now();
  try {
    const json = await postChat(fetchImpl, joinUrl(options.url, '/api/chat'), buildWarmupRequest(options.model), AbortSignal.timeout(options.timeoutMs));
    parseChatResponse(json);
    const loadNs = readCount(json, 'load_duration');
    return { ok: true, ms: Date.now() - started, ...(loadNs !== undefined ? { loadMs: Math.round(loadNs / 1e6) } : {}) };
  } catch (err) {
    const timedOut = (err as { name?: string } | null)?.name === 'TimeoutError';
    return { ok: false, ms: Date.now() - started, reason: timedOut ? `暖機逾時（${options.timeoutMs} ms）` : String(err) };
  }
}
