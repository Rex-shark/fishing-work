// ppt 主題註解卡片的純邏輯（可單元測試；DESIGN.md §13.2「右註解窗格」）：輸入框文字；頭像首字與底色（Epic 5 起搬到 shells/avatar.ts 與 meet 共用，這裡轉出以維持既有匯入）。
// 樣式在 CommentChat.tsx；本檔不含 class 與色碼。檔名刻意與 CommentChat.tsx 取不同字根（macOS 檔名不分大小寫）。
export { AVATAR_COLOR_COUNT, AVATAR_FALLBACK, avatarColorIndex, avatarInitial, type FirstGrapheme } from '../avatar'

/** 底部輸入框的 placeholder（DESIGN §13.2「新增註解…」）；取代功能元件依角色給的提示文字 */
export const COMMENT_PLACEHOLDER = '新增註解…'

/** 送出鈕的名稱與提示（Epic 13 起在 office/officeLayout，ppt 與 excel 共用） */
export { COMMENT_SEND_LABEL } from '../office/officeLayout'
