// 遊戲說明對話框（複製自我畫你猜；DESIGN.md §16；spec/song-guess/design.md §1「說明」）：兩步，外觀交給殼層的 Dialog（purpose 'help'）。
//   第一步：標題「說明」、items＝主題清單（點選進第二步）。
//   第二步：標題＝主題、body＝段落（代入殼層名稱）、items「返回」（回清單，Enter）「關閉」（Esc）。
//   Esc 在任一步都關閉；關閉時焦點還給開啟它的說明入口（helpOpen.closeHelp）。
// 開關在 uiStore.helpTopic；殼層的說明入口呼叫 App 注入的 ShellProps.help.open。放在殼層的 dialogs 插槽（同出題對話框）。
// 佔位符：{volunteer}＝ShellViews.volunteer.label、{switch}＝ShellViews.help.switchHint（本檔不寫死任何殼層名稱）。
// 對話框開著時遊戲照常進行（非強制回應）：其他插槽不受影響。
import { useUiStore } from '../../layout/uiStore'
import { useHelpView, useShellViews, useVolunteerView } from '../../shells/views'
import { closeHelp } from './helpOpen'
import {
  HELP_BACK_LABEL,
  HELP_CLOSE_LABEL,
  HELP_LIST_TITLE,
  HELP_TOPICS,
  findHelpTopic,
  renderTopic,
  type HelpTopic,
  type HelpTopicId,
} from './helpTopics'

/** 說明對話框（接 uiStore）：helpTopic 為 null 時不渲染 */
export function HelpDialog() {
  const topicId = useUiStore((s) => s.helpTopic)
  const setTopic = useUiStore((s) => s.setHelpTopic)
  if (topicId === null) return null
  return <HelpDialogView topicId={topicId} onNavigate={setTopic} onClose={closeHelp} />
}

/** 說明對話框的兩步（狀態由呼叫端持有；未知的主題 id 視為清單） */
export function HelpDialogView(props: {
  topicId: 'list' | HelpTopicId
  /** 換步：主題 id＝進入該主題；'list'＝回清單 */
  onNavigate(topic: 'list' | HelpTopicId): void
  onClose(): void
}) {
  const { topicId, onNavigate, onClose } = props
  const topic = topicId === 'list' ? undefined : findHelpTopic(topicId)
  // key：兩步各自掛載（選單反白、預設焦點重新開始）
  return topic === undefined ? (
    <HelpList key="list" onNavigate={onNavigate} onClose={onClose} />
  ) : (
    <HelpTopicBody key={topic.id} topic={topic} onNavigate={onNavigate} onClose={onClose} />
  )
}

function HelpList({ onNavigate, onClose }: { onNavigate(topic: HelpTopicId): void; onClose(): void }) {
  const { Dialog } = useShellViews()
  return (
    <Dialog
      purpose="help"
      label={HELP_LIST_TITLE}
      title={HELP_LIST_TITLE}
      items={HELP_TOPICS.map((t) => ({ id: t.id, label: t.title, onSelect: () => onNavigate(t.id) }))}
      onEscape={onClose}
    />
  )
}

function HelpTopicBody({ topic, onNavigate, onClose }: { topic: HelpTopic; onNavigate(topic: 'list'): void; onClose(): void }) {
  const { Dialog } = useShellViews()
  const volunteer = useVolunteerView()
  const help = useHelpView()
  const paragraphs = renderTopic(topic, { volunteer: volunteer.label, switch: help.switchHint })
  return (
    <Dialog
      purpose="help"
      label={`${HELP_LIST_TITLE}：${topic.title}`}
      title={topic.title}
      body={paragraphs.map((text, i) => (
        <p key={i}>{text}</p>
      ))}
      items={[
        { id: 'back', label: HELP_BACK_LABEL, detail: 'Enter', onSelect: () => onNavigate('list') },
        { id: 'close', label: HELP_CLOSE_LABEL, detail: 'Esc', onSelect: onClose },
      ]}
      onEscape={onClose}
    />
  )
}
