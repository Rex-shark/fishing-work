#!/usr/bin/env node
// 假的 Ollama（繪圖比賽 AI 評分器與評語器測試用）：spec/draw-contest/architecture.md §6「假的 Ollama」、§6.1「假的 Ollama」
//
// 實作三個端點，格式與真 Ollama 相同（systemone：2026-10-07 以 0.40.0、clef:27b-q4_k_m 實測；chat：2026-10-12 以 0.40.3、gemma4:26b-mlx-bf16 實測）：
//   POST /v1/systemone  { model, images?: [base64]（一或兩張）, state, questions: { 名稱: { type, criteria?, instructions? } } }
//                       → 200 { model, answers: { 名稱: Answer }, usage: { input_tokens, output_tokens: 0 } }
//                       score：{ type, score（期望等級）, legend, probabilities, confidence（1 − 熵／ln 等級數） }
//                       noul ：{ type, noul（0..1） }
//                       錯誤：400 { error }（缺 model／questions／state、type 不對、criteria 不是陣列、base64 壞）、
//                             404 { error }（model 不是評分模型）
//   POST /api/chat      { model, messages: [{ role, content, images?: [base64] }], stream?, think?, keep_alive?, options? }（Epic 15 評語器）
//                       → 200 { model, message: { role: 'assistant', content }, done: true, done_reason, …_count／…_duration }
//                       content 依「最後一則帶圖訊息的 images」的雜湊從固定幾句挑一句（同一張圖永遠同一句）；沒有圖（暖機）時回固定短句。
//                       第一名稱讚版（Epic 15 Phase 4）：最後一則 user 訊息的文案含「這張是本回合第一名」時，改從另一組稱讚句（MOCK_PRAISES）挑，
//                       與批評句（MOCK_COMMENTS）沒有交集，測試才分得出這張有沒有被重做。
//                       （2026-10-21 Phase 7 起 user 文案帶參賽者暱稱：原本只比對「第一名」，暱稱本身含「第一名」時批評版會被誤判，
//                       改比對稱讚版特有的整句片段。）
//                       錯誤：400 { error }（缺 model、messages 不是陣列、base64 壞）、404 { error }（model 不是評語模型）
//   GET  /api/tags      → { models: [{ name, model, ... }] }（列評分模型 MOCK_MODEL 與評語模型 MOCK_COMMENT_MODEL 兩個）
// 分數由「images 的 base64 字串＋題目名稱＋instructions」的 FNV-1a 雜湊決定：同一張圖永遠同分，換圖通常不同。
// Epic 20 像不像比賽（spec §6「假的 Ollama」）：images 可為兩張（[參考圖, 作品]），雜湊含兩張（只有一張時與原本完全相同）；
// 題目名稱不限（similarity 等任何 score 題照常依 criteria 回分布，noul 題回機率）。
// /api/chat 同理：最後一則帶圖訊息的 images 全部進雜湊（mimic 回合為 [參考圖, 作品]，換作品就可能換句）。
//
// 用法（專案根目錄）：
//   node user/mock/systemone.mjs                                   # 預設 127.0.0.1:11435
//   MOCK_PORT=11435 MOCK_DELAY_MS=800 MOCK_MODEL=clef:27b-nvfp4 node user/mock/systemone.mjs
//   MOCK_PORT=11436 MOCK_CHAT_DELAY_MS=300 node user/mock/systemone.mjs    # 評語慢一點，揭曉後才陸續收到 contest:comment
//   JUDGE=ollama OLLAMA_URL=http://127.0.0.1:11435 PORT=3211 node server/dist/index.js   # server 指向假 Ollama（評分與評語都走它）
// 環境變數：MOCK_PORT（預設 11435）、MOCK_HOST（預設 127.0.0.1）、MOCK_DELAY_MS（每次 systemone 回應前的延遲，預設 0）、
//           MOCK_MODEL（評分模型，預設 clef:27b-nvfp4）、MOCK_COMMENT_MODEL（評語模型，預設 gemma4:26b-mlx-bf16）、
//           MOCK_CHAT_DELAY_MS（每次 chat 回應前的延遲，預設 0）、MOCK_CHAT_CONTENT（有設就每次 chat 都回這個字串；設成空字串可模擬「輸出空白」。
//           **固定內容優先、不再區分批評／稱讚**：稱讚版請求也回同一個字串，暖機也是）、
//           MOCK_PRAISE_CONTENT（有設就只有稱讚版請求回這個字串，優先於 MOCK_CHAT_CONTENT；設成空字串可模擬「其他人的評語成功、只有第一名稱讚版失敗」）、
//           MOCK_REJECT_MARKER（Epic 21：有設就讓「任一張圖解 base64 後的 bytes 含這個字串（latin1）」的 /v1/systemone 請求回 MOCK_REJECT_STATUS，
//           模擬 Ollama 拒收某張圖；測試在 PNG 的 tEXt chunk 或 JPEG 的 COM segment 放這個標記，結構仍合法、其他圖照常回分數）、
//           MOCK_CHAT_REJECT_MARKER（同上，作用在 /api/chat：最後一則帶圖訊息的任一張圖含標記 → 回 MOCK_REJECT_STATUS）、
//           MOCK_REJECT_STATUS（上兩者回的 HTTP 狀態碼，預設 400；400／413／415／422 為「輸入被拒」，可設 404／429／500 等測「上游不可用」那一類，spec §5.5）。
// 也可在程式內 import { startMockOllama } 啟動（測試用，回傳 { url, close, requests }）。
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(text, hash = FNV_OFFSET) {
  let h = hash >>> 0;
  const bytes = Buffer.from(text, 'utf8');
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32：回傳 [0, 1) */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** /api/chat 的固定評語（中性調侃；依圖片雜湊挑一句） */
export const MOCK_COMMENTS = [
  '就這？線條抖成這樣也敢交卷，勇氣可嘉呢～',
  '嗯哼，勉強看得出來是什麼啦，下次再加油一點吧。',
  '畫成這樣還想拿高分？想得真美呢～',
  '欸，意外地不差嘛，可別太得意喔。',
  '這是認真畫的嗎？算了，至少有交卷啦。',
];
/** 第一名稱讚版（user 文案含「這張是本回合第一名」）的固定稱讚句；與 MOCK_COMMENTS 沒有交集 */
export const MOCK_PRAISES = [
  '哼，這張居然還不錯嘛，第一名就勉強給你啦～',
  '欸？畫得這麼好是想怎樣，才、才沒有在誇你喔！',
  '嘛，這次算你厲害，下次也要這樣讓我驚訝才行喔～',
  '居然真的被你拿到第一，好啦好啦，這張是真的很可以啦！',
];
/** 沒有圖的 chat（暖機）回的短句 */
export const MOCK_WARMUP_REPLY = '嗨';

/** 驗證 chat 請求；回 [status, error] 或 null */
function validateChat(body, commentModel) {
  if (typeof body !== 'object' || body === null) return [400, 'invalid request body'];
  if (typeof body.model !== 'string' || body.model === '') return [400, 'model is required'];
  if (body.model !== commentModel) return [404, `model "${body.model}" not found, try pulling it first`];
  if (!Array.isArray(body.messages)) return [400, 'messages must be an array'];
  for (const m of body.messages) {
    if (typeof m !== 'object' || m === null || typeof m.role !== 'string') return [400, 'invalid message'];
    if (m.images === undefined) continue;
    if (!Array.isArray(m.images)) return [400, 'images must be an array'];
    for (const img of m.images) if (typeof img !== 'string' || !B64.test(img)) return [400, 'illegal base64 data at input byte 0'];
  }
  return null;
}

/** 稱讚版 user 文案特有的片段（spec §6.1）；2026-10-21 Phase 7 由「第一名」改為整句片段，免得暱稱含「第一名」被誤判 */
export const PRAISE_MARKER = '這張是本回合第一名';

/** 是否為第一名稱讚版：最後一則 user 訊息的文案含 PRAISE_MARKER（spec §6.1 稱讚版 user 文案） */
function isPraiseChat(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return typeof messages[i].content === 'string' && messages[i].content.includes(PRAISE_MARKER);
  }
  return false;
}

/**
 * 雜湊用的圖片鍵：一張時就是那張的 base64（與 Epic 20 之前相同），多張（mimic 的 [參考圖, 作品]）以 NUL 串接。
 * 空陣列或沒有圖 → null。
 */
export function imagesKey(images) {
  if (!Array.isArray(images) || images.length === 0) return null;
  return images.length === 1 ? images[0] : images.join('\u0000');
}

/** 最後一則帶圖訊息的圖片鍵（全部圖片，見 imagesKey）；沒有則 null */
function chatImageKey(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const key = imagesKey(messages[i].images);
    if (key !== null) return key;
  }
  return null;
}

function answerFor(name, q, imageKey) {
  const next = rng(fnv1a(`${name}\u0000${q.instructions ?? ''}`, fnv1a(imageKey)));
  if (q.type === 'noul') return { type: 'noul', noul: next() };
  if (q.type === 'score') {
    const n = q.criteria.length;
    const w = Array.from({ length: n }, () => next() ** 2 + 0.01);
    const sum = w.reduce((s, x) => s + x, 0);
    const p = w.map((x) => x / sum);
    const legend = {};
    const probabilities = {};
    let score = 0;
    let entropy = 0;
    p.forEach((pi, i) => {
      legend[String(i)] = q.criteria[i];
      probabilities[String(i)] = pi;
      score += i * pi;
      entropy -= pi > 0 ? pi * Math.log(pi) : 0;
    });
    const confidence = n > 1 ? 1 - entropy / Math.log(n) : 1;
    return { type: 'score', score, legend, probabilities, confidence };
  }
  // choice：回第一個選項（本專案不用）
  const options = Array.isArray(q.options) ? q.options : [];
  return { type: 'choice', choice: options[0] ?? null };
}

/** 驗證請求；回 [status, error] 或 null */
function validate(body, model) {
  if (typeof body !== 'object' || body === null) return [400, 'invalid request body'];
  if (typeof body.model !== 'string' || body.model === '') return [400, 'model is required'];
  if (body.model !== model) return [404, `model "${body.model}" not found, try pulling it first`];
  const qs = body.questions;
  const names = typeof qs === 'object' && qs !== null && !Array.isArray(qs) ? Object.keys(qs) : [];
  if (names.length < 1 || names.length > 64) return [400, 'questions must contain 1–64 fields'];
  if (body.state === undefined) return [400, 'state: must be a JSON value'];
  for (const name of names) {
    const q = qs[name];
    if (typeof q !== 'object' || q === null) return [400, `json: cannot unmarshal into Go struct field Request.questions of type decision.Question`];
    if (q.type !== 'choice' && q.type !== 'noul' && q.type !== 'score') return [400, `question "${name}": type must be choice, noul, or score`];
    if (q.type === 'score' && !Array.isArray(q.criteria)) return [400, `question "${name}": score criteria must be an array`];
  }
  if (body.images !== undefined) {
    if (!Array.isArray(body.images)) return [400, 'images must be an array'];
    for (const img of body.images) if (typeof img !== 'string' || !B64.test(img)) return [400, 'illegal base64 data at input byte 0'];
  }
  return null;
}

/** 錯誤回應的文字（拒收時）；真 Ollama 解不了圖時回 400 { error }，文案不一，這裡固定一句 */
export const MOCK_REJECT_ERROR = 'failed to process inputs: image: unknown format';

/** 任一張圖（base64）解碼後含 marker（latin1 bytes）→ true；marker 未設或空字串 → false */
function imagesContain(images, marker) {
  if (typeof marker !== 'string' || marker === '' || !Array.isArray(images)) return false;
  const needle = Buffer.from(marker, 'latin1');
  return images.some((img) => typeof img === 'string' && Buffer.from(img, 'base64').includes(needle));
}

/** 最後一則帶圖訊息的 images（沒有則 null） */
function lastChatImages(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (Array.isArray(messages[i].images) && messages[i].images.length > 0) return messages[i].images;
  }
  return null;
}

function send(res, status, obj) {
  const text = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

/**
 * 啟動假 Ollama。
 * @param {{ port?: number, host?: string, delayMs?: number, model?: string, commentModel?: string, chatDelayMs?: number, chatContent?: string, praiseContent?: string, rejectMarker?: string, chatRejectMarker?: string, rejectStatus?: number }} [options]
 *   model：評分模型；commentModel：評語模型；chatDelayMs：每次 chat 回應前的延遲；chatContent：有給就每次 chat 都回這個字串（不分批評／稱讚）；
 *   praiseContent：有給就只有第一名稱讚版請求回這個字串（優先於 chatContent）；
 *   rejectMarker／chatRejectMarker：圖片 bytes 含此字串的 systemone／chat 請求回 rejectStatus（預設 400），其餘照常（Epic 21）
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void>, requests: Array<{ method: string, path: string, body?: unknown }> }>}
 */
export function startMockOllama(options = {}) {
  const model = options.model ?? 'clef:27b-nvfp4';
  const commentModel = options.commentModel ?? 'gemma4:26b-mlx-bf16';
  const delayMs = options.delayMs ?? 0;
  const chatDelayMs = options.chatDelayMs ?? 0;
  const host = options.host ?? '127.0.0.1';
  const rejectStatus = options.rejectStatus ?? 400;
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const path = (req.url ?? '/').split('?')[0];
      if (req.method === 'GET' && path === '/api/tags') {
        requests.push({ method: 'GET', path });
        const entry = (name, capabilities) => ({
          name,
          model: name,
          modified_at: new Date(0).toISOString(),
          size: 0,
          digest: 'mock',
          details: { format: 'gguf', family: 'mock', parameter_size: '0B', quantization_level: 'mock' },
          capabilities,
        });
        // 評分模型與評語模型都列出（同名時只列一次）
        const models = [entry(model, ['decision', 'vision'])];
        if (commentModel !== model) models.push(entry(commentModel, ['completion', 'vision', 'thinking']));
        send(res, 200, { models });
        return;
      }
      if (path === '/api/chat') {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'text/plain' });
          res.end('405 method not allowed');
          return;
        }
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch (err) {
          send(res, 400, { error: `invalid character in request body: ${String(err)}` });
          return;
        }
        requests.push({ method: 'POST', path, body });
        const bad = validateChat(body, commentModel);
        if (bad) {
          send(res, bad[0], { error: bad[1] });
          return;
        }
        if (imagesContain(lastChatImages(body.messages), options.chatRejectMarker)) {
          send(res, rejectStatus, { error: MOCK_REJECT_ERROR });
          return;
        }
        const imageKey = chatImageKey(body.messages);
        const praise = isPraiseChat(body.messages);
        // 優先序：稱讚版的固定內容 → 全部的固定內容 → 沒有圖（暖機）→ 依圖片雜湊從稱讚句或批評句挑一句
        const pick = (lines) => lines[fnv1a(imageKey ?? '') % lines.length];
        const content =
          praise && options.praiseContent !== undefined
            ? options.praiseContent
            : options.chatContent !== undefined
              ? options.chatContent
              : praise
                ? pick(MOCK_PRAISES)
                : imageKey === null
                  ? MOCK_WARMUP_REPLY
                  : pick(MOCK_COMMENTS);
        const promptTokens = 30 + Math.ceil((imageKey ?? '').length / 400);
        const reply = () => {
          if (res.destroyed) return;
          send(res, 200, {
            model: commentModel,
            created_at: new Date().toISOString(),
            message: { role: 'assistant', content },
            done: true,
            done_reason: 'stop',
            total_duration: chatDelayMs * 1e6,
            load_duration: 0,
            prompt_eval_count: promptTokens,
            eval_count: [...content].length,
          });
        };
        if (chatDelayMs > 0) setTimeout(reply, chatDelayMs);
        else reply();
        return;
      }
      if (path === '/v1/systemone') {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'text/plain' });
          res.end('405 method not allowed');
          return;
        }
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch (err) {
          send(res, 400, { error: `invalid character in request body: ${String(err)}` });
          return;
        }
        requests.push({ method: 'POST', path, body });
        const bad = validate(body, model);
        if (bad) {
          send(res, bad[0], { error: bad[1] });
          return;
        }
        if (imagesContain(body.images, options.rejectMarker)) {
          send(res, rejectStatus, { error: MOCK_REJECT_ERROR });
          return;
        }
        const imageKey = imagesKey(body.images) ?? '';
        const answers = {};
        for (const [name, q] of Object.entries(body.questions)) answers[name] = answerFor(name, q, imageKey);
        const inputTokens = 120 + Math.ceil(imageKey.length / 400);
        const reply = () => {
          if (res.destroyed) return;
          send(res, 200, { model, answers, usage: { input_tokens: inputTokens, output_tokens: 0 } });
        };
        if (delayMs > 0) setTimeout(reply, delayMs);
        else reply();
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 page not found');
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      const { port } = server.address();
      resolve({
        url: `http://${host}:${port}`,
        port,
        requests,
        close: () =>
          new Promise((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}

// 直接執行：node user/mock/systemone.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.MOCK_PORT ?? 11435);
  const delayMs = Number(process.env.MOCK_DELAY_MS ?? 0);
  const chatDelayMs = Number(process.env.MOCK_CHAT_DELAY_MS ?? 0);
  const mock = await startMockOllama({
    port,
    host: process.env.MOCK_HOST ?? '127.0.0.1',
    delayMs,
    model: process.env.MOCK_MODEL ?? 'clef:27b-nvfp4',
    commentModel: process.env.MOCK_COMMENT_MODEL ?? 'gemma4:26b-mlx-bf16',
    chatDelayMs,
    ...(process.env.MOCK_CHAT_CONTENT !== undefined ? { chatContent: process.env.MOCK_CHAT_CONTENT } : {}),
    ...(process.env.MOCK_PRAISE_CONTENT !== undefined ? { praiseContent: process.env.MOCK_PRAISE_CONTENT } : {}),
    ...(process.env.MOCK_REJECT_MARKER ? { rejectMarker: process.env.MOCK_REJECT_MARKER } : {}),
    ...(process.env.MOCK_CHAT_REJECT_MARKER ? { chatRejectMarker: process.env.MOCK_CHAT_REJECT_MARKER } : {}),
    ...(process.env.MOCK_REJECT_STATUS ? { rejectStatus: Number(process.env.MOCK_REJECT_STATUS) } : {}),
  });
  const rejects = [process.env.MOCK_REJECT_MARKER && `systemone 拒收標記「${process.env.MOCK_REJECT_MARKER}」`, process.env.MOCK_CHAT_REJECT_MARKER && `chat 拒收標記「${process.env.MOCK_CHAT_REJECT_MARKER}」`].filter(Boolean);
  console.log(`假 Ollama 已啟動：${mock.url}（systemone delay ${delayMs} ms、chat delay ${chatDelayMs} ms${rejects.length ? `；${rejects.join('、')} → HTTP ${process.env.MOCK_REJECT_STATUS || 400}` : ''}）`);
  const stop = () => mock.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
