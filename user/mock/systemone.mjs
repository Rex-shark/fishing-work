#!/usr/bin/env node
// 假的 Ollama（繪圖比賽 AI 評分器測試用）：spec/draw-contest/architecture.md §6「假的 Ollama」
//
// 只實作兩個端點，格式與真 Ollama 0.40.0 相同（2026-10-07 以 clef:27b-q4_k_m 實測）：
//   POST /v1/systemone  { model, images?: [base64], state, questions: { 名稱: { type, criteria?, instructions? } } }
//                       → 200 { model, answers: { 名稱: Answer }, usage: { input_tokens, output_tokens: 0 } }
//                       score：{ type, score（期望等級）, legend, probabilities, confidence（1 − 熵／ln 等級數） }
//                       noul ：{ type, noul（0..1） }
//                       錯誤：400 { error }（缺 model／questions／state、type 不對、criteria 不是陣列、base64 壞）、
//                             404 { error }（model 不在清單）
//   GET  /api/tags      → { models: [{ name, model, ... }] }（只列 MOCK_MODEL 一個）
// 分數由「images[0] 的 base64 字串＋題目名稱＋instructions」的 FNV-1a 雜湊決定：同一張圖永遠同分，換圖通常不同。
//
// 用法（專案根目錄）：
//   node user/mock/systemone.mjs                                   # 預設 127.0.0.1:11435
//   MOCK_PORT=11435 MOCK_DELAY_MS=800 MOCK_MODEL=clef:27b-q4_k_m node user/mock/systemone.mjs
//   JUDGE=ollama OLLAMA_URL=http://127.0.0.1:11435 PORT=3211 node server/dist/index.js   # server 指向假 Ollama
// 環境變數：MOCK_PORT（預設 11435）、MOCK_HOST（預設 127.0.0.1）、MOCK_DELAY_MS（每次 systemone 回應前的延遲，預設 0）、
//           MOCK_MODEL（預設 clef:27b-q4_k_m）。
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

function send(res, status, obj) {
  const text = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

/**
 * 啟動假 Ollama。
 * @param {{ port?: number, host?: string, delayMs?: number, model?: string }} [options]
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void>, requests: Array<{ method: string, path: string, body?: unknown }> }>}
 */
export function startMockOllama(options = {}) {
  const model = options.model ?? 'clef:27b-q4_k_m';
  const delayMs = options.delayMs ?? 0;
  const host = options.host ?? '127.0.0.1';
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const path = (req.url ?? '/').split('?')[0];
      if (req.method === 'GET' && path === '/api/tags') {
        requests.push({ method: 'GET', path });
        send(res, 200, {
          models: [
            {
              name: model,
              model,
              modified_at: new Date(0).toISOString(),
              size: 0,
              digest: 'mock',
              details: { format: 'gguf', family: 'mock', parameter_size: '0B', quantization_level: 'mock' },
              capabilities: ['decision', 'vision'],
            },
          ],
        });
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
        const imageKey = Array.isArray(body.images) && body.images.length > 0 ? body.images[0] : '';
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
  const mock = await startMockOllama({
    port,
    host: process.env.MOCK_HOST ?? '127.0.0.1',
    delayMs,
    model: process.env.MOCK_MODEL ?? 'clef:27b-q4_k_m',
  });
  console.log(`假 Ollama 已啟動：${mock.url}（delay ${delayMs} ms）`);
  const stop = () => mock.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
