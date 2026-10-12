// 首頁（複製自我畫你猜；DESIGN §14；spec/draw-contest/design.md §1）：未加入且沒有重連憑證時顯示，不偽裝、不屬於任何殼層。
// 與我畫你猜的差異：標題「繪圖比賽」、風格卡片只有一張（仍是 radiogroup、預設選取；名稱來自註冊表）。
// 紙張質感（Epic 10 試做，plan/home-paper.md）：整頁可捲動、暖白紙底加紙紋與暗角（theme.css 的 html[data-theme='home'] body）、輸入框與卡片掛 home-paper（紙卡紋理）；置中欄 max 640px，側邊 24px（< 480px 為 16px）；
// 內容垂直置中，高於視窗時從頂端排。只用 home-* class（DESIGN §14.2 token）與 home-paper utility，不重用殼層 token、不寫死色碼（紙紋 data URI 只放 theme.css）。
// 內容：標題、暱稱輸入（join／rememberedNickname／nicknameDraft、字數、錯誤）、介面風格卡片（只選取＝寫 uiStore.shellId）、
// 「進入遊戲」按鈕（Enter 亦可）、連線狀態一行、頁尾。加入成功後 App 以選取的殼層進遊戲畫面。
// 加入中（busy）不用原生 disabled（plan/notes.md 2026-10-12：被停用的元素會失去焦點，加入失敗後就不能直接重打再按 Enter）：
//   暱稱輸入框改 readOnly＋aria-busy、按鈕改 aria-disabled＋aria-busy（外觀同原本的停用）；加入失敗時焦點放回輸入框。
//   未連線時按鈕仍是原生 disabled（不是使用者送出造成的停用，維持原樣）。
// 相依規則：可 import shells/catalog、shells/types、layout/uiStore、layout/themeCardNav、socket/client、store/game；
// 不得 import 特定殼層、shells/views、工具提示（首頁在殼層之外），也不得含偽裝字樣（test/shellBoundary.test.ts 把關）。
import { useId, useRef, useState, type FormEvent } from 'react'
import { NICKNAME_MAX, countChars } from '@fishing-work/shared/draw-contest'
import { useUiStore } from '../layout/uiStore'
import { THEME_CATALOG } from '../shells/catalog'
import { join, rememberedNickname } from '../socket/client'
import { useGameStore } from '../store/game'
import { HomeThemeCards } from './HomeThemeCards'
import { enterButtonLabel, homeConnectionLabel } from './homeLabels'

export function HomeScreen() {
  const connection = useGameStore((s) => s.connection)
  const joinError = useGameStore((s) => s.joinError)
  const autoJoining = useGameStore((s) => s.autoJoining)
  const shellId = useUiStore((s) => s.shellId)
  const setShellId = useUiStore((s) => s.setShellId)
  const setDraft = useUiStore((s) => s.setNicknameDraft)
  const [nickname, setNicknameState] = useState(() => useUiStore.getState().nicknameDraft ?? rememberedNickname())
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  /** 加入請求在途：用 ref 擋重複送出（按鈕加入中不是原生 disabled；連按兩下時第二下還看不到 submitting 的更新） */
  const joining = useRef(false)
  const id = useId()
  const ids = { title: `${id}-title`, field: `${id}-field`, count: `${id}-count`, error: `${id}-error`, styles: `${id}-styles` }

  const busy = submitting || autoJoining
  const canSubmit = connection === 'connected' && !busy
  const length = countChars(nickname.trim())

  function setNickname(value: string) {
    setNicknameState(value)
    setDraft(value)
  }

  async function handleJoin() {
    if (!canSubmit || joining.current) return
    joining.current = true
    setSubmitting(true)
    try {
      const r = await join(nickname)
      if (r.ok) {
        // 加入成功後草稿作廢（之後回到首頁時改用上次的暱稱）
        setDraft(null)
      } else {
        // 加入失敗（暱稱重複等）：焦點放回暱稱輸入框，可以直接重打再按 Enter
        // （在輸入框按 Enter 送出時焦點本來就沒離開；用滑鼠按按鈕、或在風格卡片上按 Enter 送出時焦點在別處）
        inputRef.current?.focus()
      }
    } finally {
      joining.current = false
      setSubmitting(false)
    }
  }

  // Enter：輸入框走 form 原生 submit（隱式送出），注音等輸入法選字的 Enter 不會觸發
  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void handleJoin()
  }

  return (
    <main className="flex min-h-dvh flex-col px-4 min-[480px]:px-6">
      <form
        onSubmit={handleSubmit}
        aria-labelledby={ids.title}
        className="mx-auto my-auto flex w-full max-w-[640px] flex-col gap-8 pt-10 pb-6"
      >
        <header className="flex flex-col gap-2">
          <h1 id={ids.title} className="text-[28px] leading-[36px] font-semibold text-home-fg">
            繪圖比賽
          </h1>
          <p className="text-[15px] leading-[22px] text-home-fg-muted">輸入暱稱、挑一種介面風格，就能加入</p>
        </header>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={ids.field} className="text-[14px] leading-[20px] font-medium text-home-fg">
              暱稱
            </label>
            <span
              id={ids.count}
              className={`text-[12px] leading-[16px] tabular-nums ${length > NICKNAME_MAX ? 'text-home-error' : 'text-home-fg-dim'}`}
            >
              {length}/{NICKNAME_MAX}
            </span>
          </div>
          <input
            ref={inputRef}
            id={ids.field}
            name="nickname"
            autoFocus
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            // 加入中：readOnly＋aria-busy，不用原生 disabled（會失去焦點）
            readOnly={busy}
            aria-busy={busy || undefined}
            // maxLength 以 UTF-16 計（emoji 算 2），放寬 4 倍，長度以 server 為準
            maxLength={NICKNAME_MAX * 4}
            aria-invalid={joinError !== null}
            aria-describedby={joinError !== null ? `${ids.count} ${ids.error}` : ids.count}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            className="home-paper h-12 w-full rounded-xl border border-home-border bg-home-surface px-4 text-[16px] text-home-fg outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-home-fg-dim focus:border-home-accent focus:outline-2 focus:outline-offset-0 focus:outline-home-accent aria-[invalid=true]:border-home-error aria-busy:cursor-default aria-busy:opacity-60"
          />
          {joinError !== null && (
            <p id={ids.error} role="alert" className="text-[13px] leading-[18px] text-home-error">
              {joinError}
            </p>
          )}
        </div>

        <section className="flex flex-col gap-3" aria-labelledby={ids.styles}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id={ids.styles} className="text-[14px] leading-[20px] font-medium text-home-fg">
              介面風格
            </h2>
            <p className="text-[12px] leading-[16px] text-home-fg-dim">只影響你自己的畫面，之後可在遊戲內切換</p>
          </div>
          <HomeThemeCards
            options={THEME_CATALOG}
            value={shellId}
            onSelect={setShellId}
            onEnter={() => void handleJoin()}
            labelledBy={ids.styles}
          />
        </section>

        <div className="flex flex-col gap-3">
          <button
            type="submit"
            // 未連線（不是加入中）：原生 disabled，同原本。加入中：aria-disabled＋aria-busy（按鈕仍可聚焦，焦點不會掉；重複送出由 handleJoin 擋）
            disabled={!busy && connection !== 'connected'}
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
            className="h-12 w-full cursor-pointer rounded-xl bg-home-accent text-[16px] font-semibold text-home-on-accent transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-home-accent enabled:not-aria-disabled:hover:bg-home-accent-hover disabled:cursor-default disabled:opacity-50 aria-disabled:cursor-default aria-disabled:opacity-50"
          >
            {enterButtonLabel(submitting)}
          </button>
          <p role="status" aria-live="polite" className="flex items-center gap-2 text-[13px] leading-[18px] text-home-fg-muted">
            <span
              aria-hidden="true"
              data-connection-dot={connection}
              className={`size-2 shrink-0 rounded-full ${connection === 'connected' ? 'bg-home-ok' : 'bg-home-fg-dim'}`}
            />
            {homeConnectionLabel(connection)}
          </p>
        </div>
      </form>
      <footer className="pb-6 text-center text-[12px] leading-[16px] text-home-fg-dim">fishing-work</footer>
    </main>
  )
}
