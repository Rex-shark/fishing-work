// Clef 決策模型評分器：spec/draw-contest/architecture.md §3「評分器環境變數」、§6「ollama」
// POST ${OLLAMA_URL}/v1/systemone，三題 likeness／is_topic／effort，合成 0..SCORE_MAX 的分數。
// 圖片為交卷原 PNG 的 base64（2026-10-12 起不再縮圖：clef:27b-nvfp4 在 MLX 後端 1280×720 約 2.4 秒）。
// Epic 20 像不像比賽（input.reference 有值）：images 為 [參考圖 JPEG, 交卷 PNG]、state.task 為 MIMIC_TASK，
// 兩題 similarity／effort（不問 is_topic），合成 score = round(100 × (0.9 × similarity/4 + 0.1 × effort/2))。
//
// 真實 API 格式（2026-10-07 以 Ollama 0.40.0、clef:27b-q4_k_m 實測）：
//   請求 { model, images: [base64], state: {...任意 JSON}, questions: { <名稱>: Question } }
//     Question = { type: 'score', criteria: string[], instructions }     // criteria 為由低到高的等級；三題都帶 instructions（§6 定案）
//              | { type: 'noul', instructions? }                         // 是非題，回 0..1 機率
//              | { type: 'choice', ... }（本評分器不用）
//   回應 200 { model, answers: { <名稱>: Answer }, usage: { input_tokens, output_tokens } }
//     score → { type: 'score', score: 期望等級（0..criteria.length-1 的實數）, legend: { '0': 文案… },
//               probabilities: { '0': p… }, confidence: 1 − 熵／ln(等級數) }
//     noul  → { type: 'noul', noul: 0..1 }
//   錯誤 4xx { error: '…' }（例：model 不存在 404、questions 為空或 base64 壞掉 400）
import { SCORE_MAX } from '@fishing-work/shared/draw-contest';
import { UpstreamHttpError } from './httpError';
import { abortReason } from './random';
import type { Judge, JudgeInput, JudgeOutput } from './types';

// ─── 請求（文案逐字照 §6）─────────────────────────────────────────

export const JUDGE_TASK = 'A player drew this picture in a drawing contest.';
export const LIKENESS_CRITERIA = [
  'Unrecognizable',
  'Vaguely related',
  'Somewhat recognizable',
  'Clearly recognizable',
  'Unmistakable',
] as const;
export const EFFORT_CRITERIA = ['Blank or scribble', 'Partial', 'Complete drawing'] as const;

/** likeness 的題目文字（§6 逐字）：topic 原樣放入（中文題目直接送） */
export function likenessInstructions(topic: string): string {
  return `How clearly does this drawing depict the topic '${topic}'?`;
}

/** is_topic 的題目文字（§6 逐字） */
export function isTopicInstructions(topic: string): string {
  return `Is this a drawing of ${topic}?`;
}

/** effort 的題目文字（§6 逐字，與題目無關） */
export const EFFORT_INSTRUCTIONS = 'How complete is the drawing?';

export interface SystemOneRequest {
  model: string;
  images: string[];
  state: { task: string; topic: string };
  questions: {
    likeness: { type: 'score'; instructions: string; criteria: string[] };
    is_topic: { type: 'noul'; instructions: string };
    effort: { type: 'score'; instructions: string; criteria: string[] };
  };
}

// ─── 像不像比賽（Epic 20，§6「像不像比賽」；文案逐字）──────────────

export const MIMIC_TASK = 'A player tried to copy the first image (the reference) by drawing the second image in a drawing contest.';
export const SIMILARITY_CRITERIA = [
  'Completely different',
  'Slightly similar',
  'Roughly similar',
  'Very similar',
  'Nearly identical',
] as const;
/** similarity 的題目文字（§6 逐字，與題目無關：主體由參考圖定義） */
export const SIMILARITY_INSTRUCTIONS =
  "The first image is the reference and the second is the player's drawing. How closely does the drawing reproduce the reference in shapes, composition and main subject, ignoring colour and line thickness?";

export interface SystemOneMimicRequest {
  model: string;
  /** [參考圖 JPEG, 交卷 PNG]（順序固定：instructions 以「first／second」指稱） */
  images: [string, string];
  state: { task: string; topic: string };
  questions: {
    similarity: { type: 'score'; instructions: string; criteria: string[] };
    effort: { type: 'score'; instructions: string; criteria: string[] };
  };
}

/** mimic 版請求：不問 is_topic（主體由參考圖定義）；effort 與現況相同 */
export function buildMimicRequest(model: string, topic: string, referenceBase64: string, imageBase64: string): SystemOneMimicRequest {
  return {
    model,
    images: [referenceBase64, imageBase64],
    state: { task: MIMIC_TASK, topic },
    questions: {
      similarity: { type: 'score', instructions: SIMILARITY_INSTRUCTIONS, criteria: [...SIMILARITY_CRITERIA] },
      effort: { type: 'score', instructions: EFFORT_INSTRUCTIONS, criteria: [...EFFORT_CRITERIA] },
    },
  };
}

export function buildSystemOneRequest(model: string, topic: string, imageBase64: string): SystemOneRequest {
  return {
    model,
    images: [imageBase64],
    state: { task: JUDGE_TASK, topic },
    questions: {
      likeness: { type: 'score', instructions: likenessInstructions(topic), criteria: [...LIKENESS_CRITERIA] },
      is_topic: { type: 'noul', instructions: isTopicInstructions(topic) },
      effort: { type: 'score', instructions: EFFORT_INSTRUCTIONS, criteria: [...EFFORT_CRITERIA] },
    },
  };
}

// ─── 暖機請求（§6.1「啟動」：Clef 也比照暖機）────────────────────

/**
 * 暖機用的 1×1 PNG（69 bytes，8-bit RGB、單一像素為畫布底色 #1E1E1E）。寫死位元組：server 不帶圖片函式庫（pngjs 已移除）。
 * 2026-10-12 實測 Ollama 0.40.3 的 /v1/systemone 接受 1×1 圖（200）。
 */
export const WARMUP_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQk5MDAAC4AFuF/QUSAAAAAElFTkSuQmCC';
/** 暖機請求的題目（state.topic 與題目文字裡的佔位字；結果不使用） */
export const WARMUP_TOPIC = 'warmup';
/**
 * 暖機請求帶的 keep_alive：模型載入後常駐 30 分鐘（與評語器暖機相同）。
 * 2026-10-12 實測：/v1/systemone 接受此欄位；設過一次後，之後不帶 keep_alive 的評分請求也沿用 30 分鐘（每次請求往後順延），
 * 不帶的話是 Ollama 預設的 5 分鐘——啟動後 5 分鐘內沒人玩，暖機就白做了。
 */
export const WARMUP_KEEP_ALIVE = '30m';

export interface SystemOneWarmupRequest extends SystemOneRequest {
  keep_alive: string;
}

/** 暖機請求：與評分請求同一份 state／questions（同一條路徑、同樣的提示詞前綴），圖片換成 1×1 PNG，另帶 keep_alive */
export function buildWarmupRequest(model: string): SystemOneWarmupRequest {
  return { ...buildSystemOneRequest(model, WARMUP_TOPIC, WARMUP_PNG_BASE64), keep_alive: WARMUP_KEEP_ALIVE };
}

// ─── 回應解析與合成 ───────────────────────────────────────────────

/** 模型的原始三值（給 log 與測試） */
export interface SystemOneRaw {
  /** 0..4 */
  likeness: number;
  /** likeness 的信心值 0..1 */
  likenessConfidence: number;
  /** 0..1 */
  isTopic: number;
  /** 0..2 */
  effort: number;
}

/** 浮點誤差容許量：略超出範圍（如 4.0000000001）視為邊界值，明顯超出才算不合法 */
const EPS = 1e-6;

function readNumber(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`systemone 回應 ${path} 不是有限數字：${JSON.stringify(value)}`);
  if (value < min - EPS || value > max + EPS) throw new Error(`systemone 回應 ${path} 超出 ${min}..${max}：${value}`);
  return Math.min(max, Math.max(min, value));
}

function readAnswer(answers: Record<string, unknown>, name: string, type: 'score' | 'noul'): Record<string, unknown> {
  const a = answers[name];
  if (typeof a !== 'object' || a === null) throw new Error(`systemone 回應缺 answers.${name}`);
  const rec = a as Record<string, unknown>;
  if (rec.type !== type) throw new Error(`systemone 回應 answers.${name}.type 應為 ${type}：${JSON.stringify(rec.type)}`);
  return rec;
}

/** 解析回應 JSON；缺欄位、型別或數值不合法一律 throw（佇列會退回 random） */
export function parseSystemOneResponse(json: unknown): SystemOneRaw {
  if (typeof json !== 'object' || json === null) throw new Error('systemone 回應不是 JSON 物件');
  const answers = (json as Record<string, unknown>).answers;
  if (typeof answers !== 'object' || answers === null) throw new Error('systemone 回應缺 answers');
  const ans = answers as Record<string, unknown>;
  const likeness = readAnswer(ans, 'likeness', 'score');
  const isTopic = readAnswer(ans, 'is_topic', 'noul');
  const effort = readAnswer(ans, 'effort', 'score');
  return {
    likeness: readNumber(likeness.score, 'likeness.score', 0, LIKENESS_CRITERIA.length - 1),
    likenessConfidence: readNumber(likeness.confidence, 'likeness.confidence', 0, 1),
    isTopic: readNumber(isTopic.noul, 'is_topic.noul', 0, 1),
    effort: readNumber(effort.score, 'effort.score', 0, EFFORT_CRITERIA.length - 1),
  };
}

/** §6 合成：score = round(100 × (0.6 × likeness/4 + 0.3 × is_topic + 0.1 × effort/2))，夾在 0..SCORE_MAX；confidence = likeness.confidence */
export function combineScore(raw: SystemOneRaw): JudgeOutput {
  const value = 100 * (0.6 * (raw.likeness / 4) + 0.3 * raw.isTopic + 0.1 * (raw.effort / 2));
  const score = Math.min(SCORE_MAX, Math.max(0, Math.round(value)));
  const confidence = Math.min(1, Math.max(0, raw.likenessConfidence));
  return { score, confidence };
}

/** mimic 版模型原始兩值（給 log 與測試） */
export interface SystemOneMimicRaw {
  /** 0..4 */
  similarity: number;
  /** similarity 的信心值 0..1 */
  similarityConfidence: number;
  /** 0..2 */
  effort: number;
}

/** 解析 mimic 版回應；缺欄位、型別或數值不合法一律 throw（佇列會退回 random） */
export function parseMimicResponse(json: unknown): SystemOneMimicRaw {
  if (typeof json !== 'object' || json === null) throw new Error('systemone 回應不是 JSON 物件');
  const answers = (json as Record<string, unknown>).answers;
  if (typeof answers !== 'object' || answers === null) throw new Error('systemone 回應缺 answers');
  const ans = answers as Record<string, unknown>;
  const similarity = readAnswer(ans, 'similarity', 'score');
  const effort = readAnswer(ans, 'effort', 'score');
  return {
    similarity: readNumber(similarity.score, 'similarity.score', 0, SIMILARITY_CRITERIA.length - 1),
    similarityConfidence: readNumber(similarity.confidence, 'similarity.confidence', 0, 1),
    effort: readNumber(effort.score, 'effort.score', 0, EFFORT_CRITERIA.length - 1),
  };
}

/** §6 mimic 合成：score = round(100 × (0.9 × similarity/4 + 0.1 × effort/2))，夾在 0..SCORE_MAX；confidence = similarity.confidence */
export function combineMimicScore(raw: SystemOneMimicRaw): JudgeOutput {
  const value = 100 * (0.9 * (raw.similarity / 4) + 0.1 * (raw.effort / 2));
  const score = Math.min(SCORE_MAX, Math.max(0, Math.round(value)));
  const confidence = Math.min(1, Math.max(0, raw.similarityConfidence));
  return { score, confidence };
}

// ─── 評分器 ───────────────────────────────────────────────────────

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface OllamaJudgeOptions {
  /** OLLAMA_URL，例 http://127.0.0.1:11434（結尾斜線可有可無） */
  url: string;
  /** JUDGE_MODEL */
  model: string;
  /** 測試注入；預設全域 fetch */
  fetch?: FetchLike;
  /** 每張評分完成時回報原始值與耗時（給 log）；mode 'mimic' 時 raw 為 similarity／effort 兩值（Epic 20） */
  onScored?: (info: { topic: string; mode: 'topic' | 'mimic'; raw: SystemOneRaw | SystemOneMimicRaw; out: JudgeOutput; ms: number; inputTokens?: number }) => void;
}

/** fetch 失敗的可讀說明：Node 的 fetch 只說「fetch failed」，原因在 cause（ECONNREFUSED、bad port…） */
export function describeFetchError(err: unknown): string {
  const e = err as { message?: string; cause?: { code?: string; message?: string } } | null;
  const cause = e?.cause?.code ?? e?.cause?.message;
  return cause ? `${e?.message ?? String(err)}（${cause}）` : String(err);
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
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
  return new UpstreamHttpError(res.status, `systemone HTTP ${res.status}${detail ? `：${detail.slice(0, 200)}` : ''}`);
}

/** POST /v1/systemone 並回傳解析後的 JSON；連線失敗、非 2xx、壞 JSON 皆 throw；中止（逾時／丟棄）原樣拋出，讓佇列辨認 */
async function postSystemOne(fetchImpl: FetchLike, endpoint: string, body: SystemOneRequest | SystemOneMimicRequest, signal: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // 中止原樣拋出；其餘補上原因
    if (signal.aborted) throw abortReason(signal);
    throw new Error(`連不上 Ollama：${describeFetchError(err)}`);
  }
  if (!res.ok) throw await httpError(res);
  try {
    return await res.json();
  } catch (err) {
    if (signal.aborted) throw abortReason(signal);
    throw new Error(`systemone 回應不是合法 JSON：${String(err)}`);
  }
}

function readInputTokens(json: unknown): number | undefined {
  const usage = (json as { usage?: { input_tokens?: unknown } } | null)?.usage;
  return typeof usage?.input_tokens === 'number' ? usage.input_tokens : undefined;
}

export function createOllamaJudge(options: OllamaJudgeOptions): Judge {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const endpoint = joinUrl(options.url, '/v1/systemone');
  return {
    mode: 'ai',
    async score(input: JudgeInput, signal: AbortSignal): Promise<JudgeOutput> {
      if (signal.aborted) throw abortReason(signal);
      const started = Date.now();
      // 交卷原圖（1280×720）直送，不縮圖（Epic 15 決策 12；spec §6）；mimic 回合參考圖在前、作品在後（Epic 20）
      const png = input.png.toString('base64');
      const mimic = input.reference !== undefined;
      const body = mimic
        ? buildMimicRequest(options.model, input.topic, input.reference!.toString('base64'), png)
        : buildSystemOneRequest(options.model, input.topic, png);
      const json = await postSystemOne(fetchImpl, endpoint, body, signal);
      let raw: SystemOneRaw | SystemOneMimicRaw;
      let out: JudgeOutput;
      if (mimic) {
        const r = parseMimicResponse(json);
        raw = r;
        out = combineMimicScore(r);
      } else {
        const r = parseSystemOneResponse(json);
        raw = r;
        out = combineScore(r);
      }
      const inputTokens = readInputTokens(json);
      options.onScored?.({
        topic: input.topic,
        mode: mimic ? 'mimic' : 'topic',
        raw,
        out,
        ms: Date.now() - started,
        ...(inputTokens !== undefined ? { inputTokens } : {}),
      });
      return out;
    },
  };
}

// ─── 暖機 ─────────────────────────────────────────────────────────

export type JudgeWarmupResult = { ok: true; ms: number; inputTokens?: number } | { ok: false; ms: number; reason: string };

/**
 * 背景暖機（§6.1「啟動」）：送一張 1×1 PNG 的 systemone 請求把 Clef 載進記憶體（冷啟動第一張實測 13.4 秒）。
 * 只用來 log；成功與否都不影響之後的評分（每回合仍先試 ollama，失敗由佇列退回 random）。不 throw。
 */
export async function warmupSystemOne(options: { url: string; model: string; timeoutMs: number; fetch?: FetchLike }): Promise<JudgeWarmupResult> {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const started = Date.now();
  try {
    const json = await postSystemOne(fetchImpl, joinUrl(options.url, '/v1/systemone'), buildWarmupRequest(options.model), AbortSignal.timeout(options.timeoutMs));
    parseSystemOneResponse(json);
    const inputTokens = readInputTokens(json);
    return { ok: true, ms: Date.now() - started, ...(inputTokens !== undefined ? { inputTokens } : {}) };
  } catch (err) {
    const timedOut = (err as { name?: string } | null)?.name === 'TimeoutError';
    return { ok: false, ms: Date.now() - started, reason: timedOut ? `暖機逾時（${options.timeoutMs} ms）` : String(err) };
  }
}

// ─── 啟動探測 ─────────────────────────────────────────────────────

export type ProbeResult = { ok: true; models: string[] } | { ok: false; reason: string };

/**
 * 探測 Ollama：GET ${url}/api/tags，確認連得上且清單裡有 model。
 * 只用來 log；結果不改變評分器（每回合仍先試 ollama，失敗由佇列退回 random）。
 */
export async function probeOllama(options: { url: string; model: string; timeoutMs?: number; fetch?: FetchLike }): Promise<ProbeResult> {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  try {
    const res = await fetchImpl(joinUrl(options.url, '/api/tags'), { signal: AbortSignal.timeout(options.timeoutMs ?? 3000) });
    if (!res.ok) return { ok: false, reason: `GET /api/tags HTTP ${res.status}` };
    const json = (await res.json()) as { models?: unknown };
    if (!Array.isArray(json.models)) return { ok: false, reason: 'GET /api/tags 回應缺 models' };
    const models = json.models
      .map((m: unknown) => (typeof m === 'object' && m !== null ? (m as { name?: unknown }).name : undefined))
      .filter((n): n is string => typeof n === 'string');
    if (!models.includes(options.model)) return { ok: false, reason: `Ollama 沒有模型 ${options.model}（ollama list 可查）` };
    return { ok: true, models };
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'TimeoutError') return { ok: false, reason: `GET /api/tags 逾時（${options.timeoutMs ?? 3000} ms）` };
    return { ok: false, reason: `連不上 Ollama：${describeFetchError(err)}` };
  }
}
