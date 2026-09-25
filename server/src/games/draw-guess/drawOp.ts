// draw:op 形狀驗證（不信任客戶端）：spec/architecture.md §5「draw:op 驗證」的無狀態部分
// （phase、畫師身分、open stroke、strokeId 是否用過、歷史上限等有狀態的檢查在 Room.draw）。
// 合法的 op 一律「重建」成乾淨物件再存入歷史與轉發，客戶端多塞的欄位不會外流。
import {
  BRUSH_MAX,
  BRUSH_MIN,
  COLOR_PATTERN,
  MAX_POINTS_PER_MOVE,
  STROKE_ID_MAX,
  type DrawOp,
  type Point,
  type Tool,
} from '@fishing-work/shared';

export type SanitizeResult = { ok: true; op: DrawOp } | { ok: false; reason: string };

const TOOLS: readonly string[] = ['pen', 'eraser'] satisfies Tool[];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readStrokeId(v: unknown): string | null {
  return typeof v === 'string' && v.length >= 1 && v.length <= STROKE_ID_MAX ? v : null;
}

/** 座標必須是有限數且在 0..1（客戶端送出前已 clamp，§6） */
function readPoint(v: unknown): Point | null {
  if (!isRecord(v)) return null;
  const { x, y } = v;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

/** 粗細：整數且 BRUSH_MIN..BRUSH_MAX（NaN、Infinity、小數、字串皆不合法） */
function isBrushSize(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= BRUSH_MIN && v <= BRUSH_MAX;
}

export function sanitizeDrawOp(raw: unknown): SanitizeResult {
  if (!isRecord(raw)) return { ok: false, reason: 'notObject' };
  if (raw.type === 'clear') return { ok: true, op: { type: 'clear' } };

  const strokeId = readStrokeId(raw.strokeId);
  switch (raw.type) {
    case 'begin': {
      if (strokeId === null) return { ok: false, reason: 'strokeId' };
      const { tool, color, size } = raw;
      if (typeof tool !== 'string' || !TOOLS.includes(tool)) return { ok: false, reason: 'tool' };
      // 任意 #RRGGBB（大小寫皆可、原樣保存）；橡皮擦也要帶合法色（渲染時忽略）
      if (typeof color !== 'string' || !COLOR_PATTERN.test(color)) return { ok: false, reason: 'color' };
      if (!isBrushSize(size)) return { ok: false, reason: 'size' };
      const point = readPoint(raw.point);
      if (point === null) return { ok: false, reason: 'point' };
      return { ok: true, op: { type: 'begin', strokeId, tool: tool as Tool, color, size, point } };
    }
    case 'move': {
      if (strokeId === null) return { ok: false, reason: 'strokeId' };
      const pts = raw.points;
      if (!Array.isArray(pts) || pts.length === 0 || pts.length > MAX_POINTS_PER_MOVE) return { ok: false, reason: 'points' };
      const points: Point[] = [];
      for (const p of pts) {
        const point = readPoint(p);
        if (point === null) return { ok: false, reason: 'points' };
        points.push(point);
      }
      return { ok: true, op: { type: 'move', strokeId, points } };
    }
    case 'end':
    case 'undo':
      if (strokeId === null) return { ok: false, reason: 'strokeId' };
      return { ok: true, op: { type: raw.type, strokeId } };
    default:
      return { ok: false, reason: 'type' };
  }
}
