// 套用文件主題（plan/camouflage-themes.md 決策 3、4；plan/home-page.md 決策 5）：<html data-theme>、document.title、favicon。
//   首頁（不偽裝）：data-theme="home"、title「fishing-work」、favicon 預設 favicon.svg（HOME_DOCUMENT）；
//   殼層：該主題的 id／titleFor／faviconHref（ShellDefinition 本身就符合 DocumentTheme）。
// main.tsx 在第一次繪製前以 initialDocumentTheme 決定首次 data-theme（有重連憑證 → 所選殼層；沒有 → home），避免閃爍；
// 之後由 App 依畫面（pickScreen）同步。只在值不同時才寫入（避免 favicon 重新下載）。純函式，接受最小介面以便單元測試。
import type { ShellId, ShellTitleState } from './types'

interface AttrTarget {
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
}

export interface ShellDocument {
  title: string
  documentElement: AttrTarget
  querySelector(selector: string): AttrTarget | null
}

export const THEME_ATTR = 'data-theme'
export const FAVICON_SELECTOR = 'link[rel="icon"]'

/** 首頁的 data-theme 值（theme.css 的 [data-theme='home'] 區塊，DESIGN §14.2） */
export const HOME_THEME_ID = 'home'

/** 文件主題 id：首頁或已註冊的殼層 */
export type DocumentThemeId = typeof HOME_THEME_ID | ShellId

/** 文件層級需要的資料：殼層的 ShellDefinition 或首頁的 HOME_DOCUMENT */
export interface DocumentTheme {
  id: DocumentThemeId
  titleFor(state: ShellTitleState): string
  faviconHref: string
}

/** 首頁：不偽裝，分頁標題用中性的專案名、favicon 用預設圖示（依 Vite base 解析） */
export const HOME_DOCUMENT: DocumentTheme = {
  id: HOME_THEME_ID,
  titleFor: () => 'fishing-work',
  faviconHref: `${import.meta.env.BASE_URL}favicon.svg`,
}

/**
 * 第一次繪製前的文件主題（main.tsx）：有重連憑證（App 會直接顯示殼層的 resume 畫面）→ 所選殼層；沒有（首頁）→ HOME_DOCUMENT。
 * 必須與 App 第一次渲染的畫面一致（pickScreen({ joined: false, resuming: hasSavedSession })）
 */
export function initialDocumentTheme(hasSavedSession: boolean, shell: DocumentTheme): DocumentTheme {
  return hasSavedSession ? shell : HOME_DOCUMENT
}

/** 只設定 <html data-theme> */
export function applyThemeAttr(doc: Pick<ShellDocument, 'documentElement'>, id: DocumentThemeId): void {
  if (doc.documentElement.getAttribute(THEME_ATTR) !== id) doc.documentElement.setAttribute(THEME_ATTR, id)
}

/** 套用整組文件主題：data-theme、title、favicon */
export function applyDocumentTheme(doc: ShellDocument, theme: DocumentTheme, state: ShellTitleState): void {
  applyThemeAttr(doc, theme.id)
  const title = theme.titleFor(state)
  if (doc.title !== title) doc.title = title
  const icon = doc.querySelector(FAVICON_SELECTOR)
  if (icon !== null && icon.getAttribute('href') !== theme.faviconHref) icon.setAttribute('href', theme.faviconHref)
}
