// Clef 決策模型評分器：spec/draw-contest/architecture.md §3「評分器環境變數」、§6「ollama」
// POST ${OLLAMA_URL}/v1/systemone，三題 likeness／is_topic／effort，合成 0..SCORE_MAX 的分數。
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
import { PNG } from 'pngjs';
import { SCORE_MAX } from '@fishing-work/shared/draw-contest';
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

// ─── 縮圖 ─────────────────────────────────────────────────────────

/**
 * 把 PNG 等比縮到寬 targetWidth（只縮不放：原寬 ≤ targetWidth 時回傳原 bytes），重新編碼成 PNG。
 * 作法：box 平均。目標像素 (x, y) 取來源 [⌊x·sx⌋, ⌊(x+1)·sx⌋) × [⌊y·sy⌋, ⌊(y+1)·sy⌋) 這塊（至少 1×1）的平均，
 * sx = 原寬／目標寬、sy = 原高／目標高。整數倍（1280→640 為 2×2）時恰好是不重疊的 k×k box 平均；
 * 非整數倍時每塊大小在 ⌊s⌋ 與 ⌈s⌉ 之間交錯，邊界像素整顆歸給一側、不做分數權重——
 * 對評分用的縮圖誤差可忽略，換來單一簡單迴圈。
 * 顏色以 alpha 加權平均（避免透明像素的顏色滲入）；輸出 RGBA 8-bit。原 Buffer 不變。
 */
export function downscalePng(png: Buffer, targetWidth: number): Buffer {
  const src = PNG.sync.read(png);
  const sw = src.width;
  const sh = src.height;
  if (!Number.isInteger(targetWidth) || targetWidth < 1) throw new Error(`縮圖寬度不合法：${targetWidth}`);
  if (sw <= targetWidth) return png;
  const dw = targetWidth;
  const dh = Math.max(1, Math.round((sh * dw) / sw));
  const dst = new PNG({ width: dw, height: dh });
  const s = src.data;
  const d = dst.data;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / dw));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * sw + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          const alpha = s[i + 3];
          r += s[i] * alpha;
          g += s[i + 1] * alpha;
          b += s[i + 2] * alpha;
          a += alpha;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * dw + x) * 4;
      d[o] = a === 0 ? 0 : Math.round(r / a);
      d[o + 1] = a === 0 ? 0 : Math.round(g / a);
      d[o + 2] = a === 0 ? 0 : Math.round(b / a);
      d[o + 3] = Math.round(a / n);
    }
  }
  return PNG.sync.write(dst);
}

// ─── 評分器 ───────────────────────────────────────────────────────

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface OllamaJudgeOptions {
  /** OLLAMA_URL，例 http://127.0.0.1:11434（結尾斜線可有可無） */
  url: string;
  /** JUDGE_MODEL */
  model: string;
  /** JUDGE_IMAGE_WIDTH */
  imageWidth: number;
  /** 測試注入；預設全域 fetch */
  fetch?: FetchLike;
  /** 每張評分完成時回報原始三值與耗時（給 log） */
  onScored?: (info: { topic: string; raw: SystemOneRaw; out: JudgeOutput; ms: number; inputTokens?: number }) => void;
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

/** HTTP 錯誤：附狀態碼與 Ollama 回的 error 文字 */
async function httpError(res: Response): Promise<Error> {
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
  return new Error(`systemone HTTP ${res.status}${detail ? `：${detail.slice(0, 200)}` : ''}`);
}

export function createOllamaJudge(options: OllamaJudgeOptions): Judge {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const endpoint = joinUrl(options.url, '/v1/systemone');
  return {
    mode: 'ai',
    async score(input: JudgeInput, signal: AbortSignal): Promise<JudgeOutput> {
      if (signal.aborted) throw abortReason(signal);
      const started = Date.now();
      const small = downscalePng(input.png, options.imageWidth);
      const body = buildSystemOneRequest(options.model, input.topic, small.toString('base64'));
      let res: Response;
      try {
        res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        // 中止（逾時／丟棄）原樣拋出，讓佇列辨認；其餘補上原因
        if (signal.aborted) throw abortReason(signal);
        throw new Error(`連不上 Ollama：${describeFetchError(err)}`);
      }
      if (!res.ok) throw await httpError(res);
      let json: unknown;
      try {
        json = await res.json();
      } catch (err) {
        if (signal.aborted) throw abortReason(signal);
        throw new Error(`systemone 回應不是合法 JSON：${String(err)}`);
      }
      const raw = parseSystemOneResponse(json);
      const out = combineScore(raw);
      const usage = (json as { usage?: { input_tokens?: unknown } }).usage;
      options.onScored?.({
        topic: input.topic,
        raw,
        out,
        ms: Date.now() - started,
        ...(typeof usage?.input_tokens === 'number' ? { inputTokens: usage.input_tokens } : {}),
      });
      return out;
    },
  };
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
