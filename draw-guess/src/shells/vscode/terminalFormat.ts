// vscode 主題的聊天室格式（DESIGN.md §5「聊天室訊息格式」）：訊息仿終端機輸出（純邏輯，可單元測試）。
// 從 features/chat 搬來（Epic 3 Phase 3）：`// ` system 前綴、`✓ ` 猜對前綴、`[HH:mm] ` 時間戳、`❯` 提示符都是這個偽裝的外觀。
import type { ChatLineData } from '../views'
import { IMAGE_LABEL } from '../../features/chat/chatFormat'

/** 輸入列提示符（--sem-type） */
export const TERMINAL_PROMPT = '❯'

/** system 訊息前綴（仿程式註解，--sem-comment） */
export const SYSTEM_PREFIX = '// '

/** correct 訊息前綴（--sem-type） */
export const CORRECT_PREFIX = '✓ '

/** 本地錯誤提示前綴（--sem-error） */
export const ERROR_PREFIX = '✗ '

/** 行首時間戳 `[HH:mm] `（--fg-dim）；time 為 ChatLineData.time */
export function terminalTimestamp(time: string): string {
  return `[${time}] `
}

/**
 * 一則訊息的顯示片段（元件依 tone 套 token class）：
 * - chat：`amy: 是狗嗎`（暱稱 variable、內容 editor）
 * - system：`// amy 加入了`（comment）；揭曉 `// 題目是 狗（全員猜對）` 的題目改 string 色
 * - correct：`✓ ben 猜對了`（type）
 * - image：`bob: [圖片]`（縮圖另由 ImageMessage 畫在下一行）；本機沒有圖時依狀態顯示灰字佔位（muted）：
 *   `[圖片]（載入中…）`／`[圖片]（連線較慢，已略過）`／`[圖片]（已清除）`／`[圖片]（中途加入看不到）`
 */
export type ChatTone = 'name' | 'text' | 'comment' | 'string' | 'correct' | 'muted'
export interface ChatPart {
  tone: ChatTone
  text: string
}

export function terminalLineParts(line: ChatLineData): ChatPart[] {
  switch (line.kind) {
    case 'image': {
      const placeholder = line.image?.placeholder ?? null
      const label: ChatPart = placeholder === null ? { tone: 'text', text: IMAGE_LABEL } : { tone: 'muted', text: placeholder }
      return line.nickname !== null ? [{ tone: 'name', text: line.nickname }, { tone: 'text', text: ': ' }, label] : [label]
    }
    case 'chat':
      return line.nickname !== null
        ? [
            { tone: 'name', text: line.nickname },
            { tone: 'text', text: `: ${line.text}` },
          ]
        : [{ tone: 'text', text: line.text }]
    case 'correct':
      return [{ tone: 'correct', text: `${CORRECT_PREFIX}${line.text}` }]
    case 'system':
      if (line.reveal !== null) {
        return [
          { tone: 'comment', text: `${SYSTEM_PREFIX}題目是 ` },
          { tone: 'string', text: line.reveal.topic },
          { tone: 'comment', text: `（${line.reveal.reason}）` },
        ]
      }
      return [{ tone: 'comment', text: `${SYSTEM_PREFIX}${line.text}` }]
  }
}
