import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import App from './App'
import { applyCanvasBackground } from './features/canvas/canvasBackground'
import { useUiStore } from './layout/uiStore'
import { getShell } from './shells'
import { applyDocumentTheme, initialDocumentTheme } from './shells/document'
import { hasSavedSession } from './socket/client'

const root = document.getElementById('root')
if (!root) throw new Error('找不到 #root')

// 第一次繪製前就套好：畫布底色（shared 常數，不隨主題）與文件主題（plan/home-page.md 決策 5）。
// 有重連憑證 → App 會直接顯示所選殼層的 resume 畫面，先套該殼層；沒有 → 首頁（data-theme="home"）。避免先閃一下另一種外觀
// index.html 的內嵌腳本已在 CSS 套用前先設 data-theme（原字串、不驗證）；這裡以驗證過的憑證（hasSavedSession）與已註冊主題修正，並補上 title／favicon
applyCanvasBackground(document.documentElement)
applyDocumentTheme(document, initialDocumentTheme(hasSavedSession(), getShell(useUiStore.getState().shellId)), { phase: 'idle' })

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
