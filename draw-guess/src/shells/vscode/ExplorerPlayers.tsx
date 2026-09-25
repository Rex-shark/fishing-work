// vscode 主題的玩家清單呈現（ShellViews.PlayerList）：偽裝成 EXPLORER 檔案樹（DESIGN.md §5「側欄」、§6「樹狀 / 清單列」；architecture §7 殼層對照）。
// 樹：FISHING-WORK › players › `<暱稱>.ts`。列右側：本回合得分 +N、畫師 ●（仿 git 修改標記）、已猜對 ✓、分數。
// 自己那列粗體；斷線中（寬限期內）淡化＋斜體。其餘檔案（src、README.md…）為裝飾。列資料由功能元件 features/players/PlayerList 提供。
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { PlayerPublic } from '@fishing-work/shared'
import { playerRowLabel } from '../../features/players/playerRow'
import { ChevronDownIcon, ChevronRightIcon, FileGlyphIcon } from '../../layout/icons'
import type { PlayerListViewProps } from '../views'
import { WORKSPACE_NAME, playerFileName } from './ideLayout'

/** DESIGN §6：縮排 8px + 層級 × 8px */
const indent = (level: number) => ({ paddingLeft: 8 + level * 8 })

export function ExplorerPlayers({ rows }: PlayerListViewProps) {
  const players = rows.map((r) => r.player)
  const [expanded, setExpanded] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const treeRef = useRef<HTMLUListElement>(null)

  // 可聚焦的列：players 資料夾＋（展開時）每位玩家。roving tabindex：只有一列 tabIndex=0
  const focusable = ['folder:players', ...(expanded ? players.map((p) => p.id) : [])]
  const current = selected !== null && focusable.includes(selected) ? selected : focusable[0]

  function focusRow(id: string) {
    setSelected(id)
    treeRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`)?.focus()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    const i = focusable.indexOf(current)
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (i < focusable.length - 1) focusRow(focusable[i + 1])
        break
      case 'ArrowUp':
        e.preventDefault()
        if (i > 0) focusRow(focusable[i - 1])
        break
      case 'ArrowLeft':
        if (current === 'folder:players' && expanded) setExpanded(false)
        else if (current !== 'folder:players') focusRow('folder:players')
        break
      case 'ArrowRight':
        if (current === 'folder:players' && !expanded) setExpanded(true)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (current === 'folder:players') setExpanded((v) => !v)
        else setSelected(current)
        break
    }
  }

  return (
    <ul ref={treeRef} role="tree" aria-label="玩家清單" onKeyDown={handleKeyDown} className="pb-2 leading-[22px]">
      {/* 工作區根節點（仿 VS Code 的資料夾區段標題） */}
      <li role="none" aria-hidden="true" className="flex h-[22px] items-center gap-1 text-[11px] font-bold tracking-[0.5px] text-fg uppercase" style={indent(0)}>
        <ChevronDownIcon />
        {WORKSPACE_NAME}
      </li>

      <DecorRow level={1} folder>
        src
      </DecorRow>

      <li
        role="treeitem"
        aria-expanded={expanded}
        aria-selected={selected === 'folder:players'}
        aria-label={`players 資料夾，${players.length} 位玩家`}
        data-row="folder:players"
        tabIndex={current === 'folder:players' ? 0 : -1}
        onClick={() => {
          setSelected('folder:players')
          setExpanded((v) => !v)
        }}
        className={rowClass(selected === 'folder:players')}
        style={indent(1)}
      >
        {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <span className="truncate">players</span>
      </li>

      {expanded && (
        <li role="none">
          <ul role="group">
            {rows.map(({ player: p, isMe, gain }) => (
              <PlayerRow
                key={p.id}
                player={p}
                isMe={isMe}
                gain={gain}
                selected={selected === p.id}
                tabbable={current === p.id}
                onSelect={() => setSelected(p.id)}
              />
            ))}
          </ul>
        </li>
      )}

      <DecorRow level={1} glyph="M↓" glyphClass="text-sem-keyword">
        README.md
      </DecorRow>
      <DecorRow level={1} glyph="{}" glyphClass="text-sem-function">
        package.json
      </DecorRow>
      <DecorRow level={1} glyph="{}" glyphClass="text-sem-function">
        tsconfig.json
      </DecorRow>
    </ul>
  )
}

function rowClass(selected: boolean): string {
  return `flex h-[22px] cursor-pointer items-center gap-[6px] pr-3 transition-colors duration-100 outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-focus ${
    selected ? 'bg-active text-fg-statusbar' : 'text-fg hover:bg-hover'
  }`
}

function PlayerRow(props: {
  player: PlayerPublic
  isMe: boolean
  gain: number | null
  selected: boolean
  tabbable: boolean
  onSelect: () => void
}) {
  const { player: p, isMe, gain, selected, tabbable, onSelect } = props
  // 名稱色仿 git 裝飾：畫師（修改中）--sem-function、已猜對 --sem-type；選取時字白
  const nameColor = selected ? '' : p.isDrawer ? 'text-sem-function' : p.hasGuessed ? 'text-sem-type' : ''
  const label = playerRowLabel(playerFileName(p.nickname), p, isMe, gain)
  return (
    <li
      role="treeitem"
      aria-selected={selected}
      aria-label={label}
      data-row={p.id}
      tabIndex={tabbable ? 0 : -1}
      onClick={onSelect}
      title={label}
      className={`${rowClass(selected)} ${isMe ? 'font-bold' : ''} ${p.connected ? '' : 'italic opacity-50'}`}
      style={{ paddingLeft: indent(2).paddingLeft + 16 }}
    >
      <FileGlyphIcon glyph="TS" className="text-sem-keyword" />
      <span className={`min-w-0 flex-1 truncate ${nameColor}`}>{playerFileName(p.nickname)}</span>
      <span aria-hidden="true" className="flex shrink-0 items-center gap-[6px] font-normal tabular-nums not-italic">
        {gain !== null && <span className="text-sem-type">+{gain}</span>}
        {p.isDrawer && <span className="text-sem-function">●</span>}
        {p.hasGuessed && <span className="text-sem-type">✓</span>}
        <span className="text-sem-number">{p.score}</span>
      </span>
    </li>
  )
}

/** 裝飾用的檔案／資料夾列（不可聚焦、點了無反應） */
function DecorRow(props: { level: number; folder?: boolean; glyph?: string; glyphClass?: string; children: ReactNode }) {
  const { level, folder, glyph, glyphClass, children } = props
  return (
    <li
      role="none"
      aria-hidden="true"
      className="flex h-[22px] items-center gap-[6px] pr-3 text-fg"
      style={folder ? indent(level) : { paddingLeft: indent(level).paddingLeft + 16 }}
    >
      {folder ? <ChevronRightIcon /> : <FileGlyphIcon glyph={glyph ?? ''} className={glyphClass} />}
      <span className="truncate">{children}</span>
    </li>
  )
}
