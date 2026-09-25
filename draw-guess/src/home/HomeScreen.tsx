// 首頁（plan/home-page.md 決策 1–3、8、10；DESIGN §14；architecture §7 home/）：未加入且沒有重連憑證時顯示，不偽裝、不屬於任何殼層。
// 柔和 UI（Soft UI Evolution）：整頁可捲動、淺色底加兩處柔光（theme.css 的 html[data-theme='home']）；置中欄 max 640px，側邊 24px（< 480px 為 16px）；
// 內容垂直置中，高於視窗時從頂端排。只用 home-* class（DESIGN §14.2 token），不重用殼層 token。
// 內容：標題、暱稱輸入（join／rememberedNickname／nicknameDraft、字數、錯誤）、介面風格卡片（只選取＝寫 uiStore.shellId）、
// 「進入遊戲」按鈕（Enter 亦可）、連線狀態一行、頁尾。加入成功後 App 以選取的殼層進遊戲畫面。
// 相依規則：可 import shells/catalog、shells/types、layout/uiStore、layout/themeCardNav、socket/client、store/game；
// 不得 import 特定殼層、shells/views、工具提示（首頁在殼層之外），也不得含偽裝字樣（test/shellBoundary.test.ts 把關）。
import { useId, useState, type FormEvent } from 'react'
import { NICKNAME_MAX, countChars } from '@fishing-work/shared'
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
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const r = await join(nickname)
      // 加入成功後草稿作廢（之後回到首頁時改用上次的暱稱）
      if (r.ok) setDraft(null)
    } finally {
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
            我畫你猜
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
            id={ids.field}
            name="nickname"
            autoFocus
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            disabled={busy}
            // maxLength 以 UTF-16 計（emoji 算 2），放寬 4 倍，長度以 server 為準
            maxLength={NICKNAME_MAX * 4}
            aria-invalid={joinError !== null}
            aria-describedby={joinError !== null ? `${ids.count} ${ids.error}` : ids.count}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            className="h-12 w-full rounded-xl border border-home-border bg-home-surface px-4 text-[16px] text-home-fg outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-home-fg-dim focus:border-home-accent focus:outline-2 focus:outline-offset-0 focus:outline-home-accent aria-[invalid=true]:border-home-error disabled:opacity-60"
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
            disabled={!canSubmit}
            className="h-12 w-full cursor-pointer rounded-xl bg-home-accent text-[16px] font-semibold text-home-on-accent transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-home-accent enabled:hover:bg-home-accent-hover disabled:cursor-default disabled:opacity-50"
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
