// 出題對話框的「參考圖（選填）」區（Epic 20 像不像比賽；plan/contest-mimic.md 決策 2、8、12；spec/draw-contest/design.md §2 choosing）：
//   沒選圖：拖曳區（把圖片拖進來）＋「選擇圖片」按鈕（開選檔視窗）；選好：縮圖預覽＋「移除」（無障礙名稱「移除參考圖」）。
//   選檔欄位是 <input type="file">（無障礙名稱「參考圖」；視覺隱藏、由「選擇圖片」開啟），題目框仍是對話框裡第一個 <input type="text">
//   （AI 遊玩技能以 input:not([type="file"]) 取題目框，決策 12）。轉 JPEG 與錯誤訊息在 TopicForm（normalize）；本元件只收檔與呈現。
//   送出中（busy）或轉檔中（preparing）：按鈕只設 aria-disabled（不用原生 disabled，焦點不會掉；同殼層對話框的規則）、拖放與選檔都不理會。
// 放在殼層對話框的 attachment 位置（題目輸入框下方）；色彩一律用 token。
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { REFERENCE_PICKER_TEXT } from './referenceText'


export interface ReferencePickerProps {
  /** 已選好的參考圖預覽（object URL）；null＝還沒選 */
  preview: string | null
  /** 送出中（等 server 回應） */
  busy: boolean
  /** 轉檔中 */
  preparing: boolean
  onFile(file: File): void
  onRemove(): void
}

const SECONDARY_BUTTON =
  'h-[26px] rounded-[2px] border border-border bg-button-secondary px-3 text-fg transition-colors duration-100 hover:bg-button-secondary-hover focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-border-focus aria-disabled:cursor-default aria-disabled:opacity-60 aria-disabled:hover:bg-button-secondary'

export function ReferencePicker({ preview, busy, preparing, onFile, onRemove }: ReferencePickerProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const locked = busy || preparing

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // 清掉值：再選同一個檔也會觸發 change
    e.target.value = ''
    if (file !== undefined && !locked) onFile(file)
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = locked ? 'none' : 'copy'
    if (!locked) setDragging(true)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file !== undefined && !locked) onFile(file)
  }

  return (
    <div
      className="mt-3"
      aria-busy={busy || undefined}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <div className="mb-1 text-fg">{REFERENCE_PICKER_TEXT.heading}</div>
      {preview === null ? (
        <div
          className={`flex flex-wrap items-center justify-center gap-2 rounded-[2px] border border-dashed px-3 py-3 text-[12px] text-fg-muted ${
            dragging ? 'border-border-focus bg-hover' : 'border-border bg-input'
          }`}
        >
          <span>{preparing ? REFERENCE_PICKER_TEXT.preparing : REFERENCE_PICKER_TEXT.drop}</span>
          <button
            type="button"
            aria-label={REFERENCE_PICKER_TEXT.choose}
            aria-disabled={locked || undefined}
            onClick={() => {
              if (!locked) fileRef.current?.click()
            }}
            className={`${SECONDARY_BUTTON} cursor-pointer text-[13px]`}
          >
            {REFERENCE_PICKER_TEXT.choose}
          </button>
        </div>
      ) : (
        // 窄寬度（375px 時對話框內容約 135px）縮圖與「移除」換行，縮圖不超過容器寬（Phase 2.5）
        <div className={`flex flex-wrap items-center gap-3 rounded-[2px] p-1 ${dragging ? 'bg-hover' : ''}`}>
          <img
            src={preview}
            alt={REFERENCE_PICKER_TEXT.preview}
            draggable={false}
            className="block aspect-video w-[128px] max-w-full shrink-0 border border-border bg-editor object-contain"
          />
          <div className="flex min-w-0 flex-col items-start gap-1">
            <button
              type="button"
              aria-label={REFERENCE_PICKER_TEXT.removeLabel}
              aria-disabled={locked || undefined}
              onClick={() => {
                if (!locked) onRemove()
              }}
              className={`${SECONDARY_BUTTON} cursor-pointer`}
            >
              {REFERENCE_PICKER_TEXT.remove}
            </button>
            {preparing && <span className="text-[12px] text-fg-muted">{REFERENCE_PICKER_TEXT.preparing}</span>}
          </div>
        </div>
      )}
      {/* 視覺隱藏的選檔欄位：由「選擇圖片」開啟；不在 Tab 順序裡（按鈕已可聚焦），自動化工具仍可直接 setInputFiles */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        aria-label={REFERENCE_PICKER_TEXT.field}
        tabIndex={-1}
        onChange={handleChange}
        className="sr-only"
      />
    </div>
  )
}
