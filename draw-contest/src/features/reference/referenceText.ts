// 像不像比賽（Epic 20）的畫面文字：出題對話框的參考圖區、作畫中的參考圖面板。
// 是 AI 遊玩技能的依賴（other/skills/MAINTENANCE.md UI-DEP 出題對話框、畫布；plan/contest-mimic.md 決策 8、12）：
// 「參考圖（選填）」「選擇圖片」「移除參考圖」、選檔欄位與面板 section 的無障礙名稱「參考圖」、
// 面板按鈕「放大參考圖」「收合參考圖」「展開參考圖」逐字照 plan，改動要先知會事務長。

/** 區塊與按鈕的文字（AI 遊玩技能依賴：「參考圖（選填）」「選擇圖片」「移除參考圖」「參考圖」；決策 8、12） */
export const REFERENCE_PICKER_TEXT = {
  heading: '參考圖（選填）',
  /** <input type="file"> 的無障礙名稱 */
  field: '參考圖',
  drop: '把圖片拖到這裡，或',
  choose: '選擇圖片',
  remove: '移除',
  removeLabel: '移除參考圖',
  preview: '參考圖預覽',
  preparing: '正在處理圖片…',
} as const

/** 面板的文字 */
export const REFERENCE_PANEL_TEXT = {
  /** section 的無障礙名稱 */
  region: '參考圖',
  /** 標題列與收合後小按鈕的可見文字 */
  title: '參考圖',
  zoom: '放大參考圖',
  /** 放大檢視的按鈕（再點或 Esc 回到面板） */
  unzoom: '縮小參考圖',
  collapse: '收合參考圖',
  expand: '展開參考圖',
  loading: '載入中',
} as const
