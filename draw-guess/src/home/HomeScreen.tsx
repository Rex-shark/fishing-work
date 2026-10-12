// 首頁（plan/home-page.md 決策 1–3、8、10；DESIGN §14；architecture §7 home/）：未加入且沒有重連憑證時顯示，不偽裝、不屬於任何殼層。
// 紙張質感（Epic 10 試做，plan/home-paper.md）：整頁可捲動、暖白紙底加紙紋與暗角（theme.css 的 html[data-theme='home'] body）、輸入框與卡片掛 home-paper（紙卡紋理）；置中欄 max 640px，側邊 24px（< 480px 為 16px）；
// 內容垂直置中，高於視窗時從頂端排。只用 home-* class（DESIGN §14.2 token）與 home-paper utility，不重用殼層 token、不寫死色碼（紙紋 data URI 只放 theme.css）。
// 內容：標題、暱稱輸入（join／rememberedNickname／nicknameDraft、字數、錯誤）、介面風格卡片（只選取＝寫 uiStore.shellId）、
// 「進入遊戲」按鈕（Enter 亦可）、連線狀態一行、頁尾。加入成功後 App 以選取的殼層進遊戲畫面。
// 加入中（busy；plan/notes.md 2026-10-12）：暱稱輸入框 readOnly＋aria-busy、按鈕 aria-disabled＋aria-busy，都不用原生 disabled
//   （被停用的元素會失去焦點，加入失敗後 Enter 就收不到）；加入失敗時焦點放回暱稱輸入框，可以直接重打再按 Enter。
//   按鈕只有「未連線」（不是加入中）才用原生 disabled，外觀與行為同原本。
// 相依規則：可 import shells/catalog、shells/types、layout/uiStore、layout/themeCardNav、socket/client、store/game；
// 不得 import 特定殼層、shells/views、工具提示（首頁在殼層之外），也不得含偽裝字樣（test/shellBoundary.test.ts 把關）。
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
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
  const offline = connection !== 'connected'
  const canSubmit = !offline && !busy
  const length = countChars(nickname.trim())
  const inputRef = useRef<HTMLInputElement>(null)
  const wasBusy = useRef(false)

  // 加入失敗（busy 結束而首頁還在；成功時 App 已換成遊戲畫面）：焦點放回暱稱輸入框——錯誤訊息就在輸入框下方，
  // 不論是在輸入框按 Enter、點按鈕還是在風格卡片按 Enter 送出的，都可以直接重打再按 Enter
  useEffect(() => {
    const ended = wasBusy.current && !busy
    wasBusy.current = busy
    if (ended) inputRef.current?.focus()
  }, [busy])

  function setNickname(value: string) {
    setNicknameState(value)
    setDraft(value)
  }

  async function handleJoin() {
    // 加入中（輸入框 readOnly、按鈕 aria-disabled，Enter 與點擊仍會進來）與未連線都在這裡擋下，不重複送出
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
            // 未連線：原生 disabled（同原本）。加入中：aria-disabled＋aria-busy（外觀同原生 disabled：opacity .5、不變 hover 色），按鈕若有焦點不會掉。
            // enabled:aria-disabled:hover 比 enabled:hover 多一層選擇器，蓋過 hover 色不靠樣式表的先後順序
            disabled={offline && !busy}
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
            className="h-12 w-full cursor-pointer rounded-xl bg-home-accent text-[16px] font-semibold text-home-on-accent transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-home-accent enabled:hover:bg-home-accent-hover disabled:cursor-default disabled:opacity-50 aria-disabled:cursor-default aria-disabled:opacity-50 enabled:aria-disabled:hover:bg-home-accent"
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
