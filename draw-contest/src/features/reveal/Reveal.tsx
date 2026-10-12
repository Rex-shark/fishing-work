// 揭曉畫廊（spec/draw-contest/design.md §3；architecture §7 features/reveal）：每位參賽者一張縮圖卡，依 results 的 rank 排列。
//   網格 repeat(auto-fill, minmax(220px, 1fr))、間距 16px；寬度 < 768px 兩欄。
//   卡片：標題列（名次記號、暱稱、分數 tabular-nums；隨機評分加小字「隨機」；未交卷「未儲存」）＋ 16:9 縮圖
//   （白底 1px --border、與畫布相同的陰影；前三名外框 2px --accent；自己那張卡底 --bg-active）。
//   圖片來自 store.gallery（contest:gallery 的 object URL）；交卷了但圖還沒到 → 灰底「載入中」；未交卷 → 空白。
//   評語行（Epic 15）：縮圖下方一行（標題列與縮圖位置固定，同一列的縮圖上緣對齊；評語行數只影響卡片底部高度）；
//   評審名稱（shared 的 COMMENT_PERSONA_NAME）粗體 --fg 前綴＋冒號＋評語（12px 斜體 --fg-muted、完整顯示不截斷，卡片底部隨行數變高）；
//   還在產生顯示「<評審名稱>：正在寫評語」（不用省略號，免得像被截斷）；沒有評語（未交卷、失敗、關閉）整行不渲染、卡片變矮。
//   顯示與否只看該卡片自己的 comment／commentPending（revealView.revealComment），不看 round.commentMode。
//   放大檢視（選做）：點縮圖（或 Enter／Space）放大到工作區中央，再點或 Esc 回網格，焦點還給原縮圖；
//   評語與網格卡片一樣在圖片下方，完整顯示（不截斷；design §3，2026-10-12 定案與網格卡片一致）。
// 殼層把本元件放在中央工作區（round.showReveal）；外層無障礙名稱與「未儲存」的叫法來自 ShellViews.terms，本檔不寫死偽裝字樣。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { COMMENT_PERSONA_NAME } from '@fishing-work/shared/draw-contest'
import { tip } from '../../layout/tooltipPlacement'
import { useTermsView } from '../../shells/views'
import { useGameStore } from '../../store/game'
import { COMMENT_PENDING_TEXT, revealCards, type RevealCard, type RevealComment, type RevealImage } from './revealView'

export function Reveal() {
  const results = useGameStore((s) => s.round.results)
  const gallery = useGameStore((s) => s.gallery)
  const me = useGameStore((s) => s.me)
  const terms = useTermsView()
  if (results === null) return null
  return <RevealView cards={revealCards(results, gallery, me, terms)} label={terms.gallery} />
}

/** 畫廊本體（不接 store；測試以靜態渲染驗證） */
export function RevealView({ cards, label }: { cards: readonly RevealCard[]; label: string }) {
  const [zoomed, setZoomed] = useState<string | null>(null)
  const zoomedCard = cards.find((c) => c.playerId === zoomed)
  /** 放大前有焦點的縮圖（回網格時還焦點） */
  const returnTo = useRef<string | null>(null)
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    if (zoomed !== null || returnTo.current === null) return
    const id = returnTo.current
    returnTo.current = null
    listRef.current?.querySelector<HTMLElement>(`[data-reveal="${CSS.escape(id)}"]`)?.focus()
  }, [zoomed])

  if (zoomedCard !== undefined) {
    return (
      <ZoomedCard
        card={zoomedCard}
        onClose={() => {
          returnTo.current = zoomedCard.playerId
          setZoomed(null)
        }}
      />
    )
  }

  return (
    <div className="h-full w-full overflow-y-auto">
      <ol
        ref={listRef}
        aria-label={label}
        className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[16px] p-1 max-md:grid-cols-2"
      >
        {cards.map((card) => (
          <li key={card.playerId} className={`min-w-0 rounded-[2px] p-2 ${card.isMe ? 'bg-active' : ''}`}>
            <CardTitle card={card} />
            <button
              type="button"
              data-reveal={card.playerId}
              aria-label={`${card.label}（放大）`}
              {...tip(card.summary, 'top')}
              onClick={() => setZoomed(card.playerId)}
              className={`block aspect-video w-full cursor-zoom-in overflow-hidden bg-slide shadow-slide focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus ${
                card.podium ? 'outline-2 outline-accent' : 'outline-1 outline-border'
              }`}
            >
              <Thumb image={card.image} nickname={card.nickname} />
            </button>
            {card.comment !== null && <CardComment comment={card.comment} />}
          </li>
        ))}
      </ol>
    </div>
  )
}

/** 標題列：名次記號、暱稱、分數（tabular-nums）、隨機評分小字；窄欄時自動換行（暱稱優先完整顯示） */
function CardTitle({ card }: { card: RevealCard }) {
  return (
    <div aria-hidden="true" className="mb-1 flex min-w-0 flex-wrap items-baseline gap-x-1 text-[12px] leading-[18px] text-fg">
      <span className={`shrink-0 tabular-nums ${card.podium ? 'font-bold text-accent' : 'text-fg-muted'}`}>{card.mark}</span>
      {/* 暱稱不縮（窄欄時分數換到下一行），只在比整欄還長時截斷 */}
      <span className="max-w-full shrink-0 truncate font-bold">{card.nickname}</span>
      <span className="shrink-0 tabular-nums">{card.scoreText}</span>
      {card.random && <span className="shrink-0 text-[11px] text-fg-muted">隨機</span>}
    </div>
  )
}

/**
 * 評語行（design §3）：評審名稱粗體 --fg 作前綴、冒號後接評語（12px 斜體 --fg-muted）；產生中前綴照舊、評語的位置顯示「正在寫評語」。
 * 網格卡片與放大檢視相同：在圖片下方（上方留 6px，讓出前三名 2px 外框與焦點外框）、完整顯示不截斷
 * （2026-10-12 定案：截斷的「…」與產生中分不出來）。與標題列一樣 aria-hidden：評語文字已在縮圖按鈕的無障礙名稱裡
 */
function CardComment({ comment }: { comment: RevealComment }) {
  return (
    <p aria-hidden="true" data-reveal-comment={comment.kind} className="mt-1.5 text-[12px] leading-[18px] break-words text-fg-muted">
      <span className="font-bold text-fg">{COMMENT_PERSONA_NAME}：</span>
      <span className="italic">{comment.kind === 'pending' ? COMMENT_PENDING_TEXT : comment.text}</span>
    </p>
  )
}

/** 縮圖內容：圖片／灰底「載入中」／空白 */
function Thumb({ image, nickname }: { image: RevealImage; nickname: string }) {
  if (image.kind === 'image') return <img src={image.url} alt={`${nickname} 的畫`} draggable={false} className="block h-full w-full object-contain" />
  if (image.kind === 'loading') {
    return <span className="flex h-full w-full items-center justify-center bg-hover text-[12px] text-fg-muted">載入中</span>
  }
  return <span className="block h-full w-full" />
}

/**
 * 放大檢視的寬度：16:9 依剩餘寬高縮放，高度先扣掉圖片上下的文字列。
 * 只有標題列（圖片上方）扣 28px；圖片下方多一行評語再扣 42px
 * （6px 間距＋兩行 18px：高度受限時寬度夠，前綴加 40 字的評語兩行內放得下）
 */
const ZOOM_WIDTH = 'w-[min(100cqw,calc((100cqh-28px)*16/9))]'
const ZOOM_WIDTH_WITH_COMMENT = 'w-[min(100cqw,calc((100cqh-70px)*16/9))]'

/** 放大檢視：同畫布尺寸置中（父層為 size container）；順序同網格卡片（標題列 → 圖片 → 完整評語）；再點或 Esc 回網格 */
export function ZoomedCard({ card, onClose }: { card: RevealCard; onClose: () => void }) {
  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }
  const width = card.comment === null ? ZOOM_WIDTH : ZOOM_WIDTH_WITH_COMMENT
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2">
      <div className={width}>
        <CardTitle card={card} />
      </div>
      {/* 圖片與評語包成同一塊（同寬、左緣對齊）：外層 gap-2 只隔開標題列與圖片，
          評語行上方只有自己的 6px（與網格卡片相同），不會再疊上 8px */}
      <div className={width}>
        <button
          type="button"
          autoFocus
          aria-label={`${card.label}（回到全部）`}
          onClick={onClose}
          onKeyDown={handleKeyDown}
          className={`block aspect-video w-full cursor-zoom-out overflow-hidden bg-slide shadow-slide focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus ${
            card.podium ? 'outline-2 outline-accent' : 'outline-1 outline-border'
          }`}
        >
          <Thumb image={card.image} nickname={card.nickname} />
        </button>
        {card.comment !== null && <CardComment comment={card.comment} />}
      </div>
    </div>
  )
}
