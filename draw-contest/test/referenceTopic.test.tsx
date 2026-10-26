// 出題對話框的「參考圖（選填）」區（Epic 20；plan/contest-mimic.md 決策 2、8、12；design §2 choosing）：
//   referenceChoice（選檔 → JPEG → 預覽 URL；換一張、移除、卸載 revoke；錯誤不採用、之前的保留；轉檔中移除丟掉結果）、
//   ReferencePicker 的靜態渲染（拖曳區、「選擇圖片」、縮圖＋「移除參考圖」、<input type="file" aria-label="參考圖">、送出中不用原生 disabled）、
//   TopicForm 交給殼層的 props（attachment、錯誤、送題帶 reference、REFERENCE_INVALID 歸參考圖），
//   以及 ppt 殼層實際渲染：AI 遊玩技能的選擇器 input:not([type="file"]) 仍取得題目框（決策 12）。
// 本專案的 Vitest 沒有 DOM：拖放與選檔的事件、焦點要靠瀏覽器實測。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { NormalizeResult } from '../src/features/reference/normalize'
import { createReferenceChoice, type ReferenceChoiceDeps } from '../src/features/reference/referenceChoice'
import { ReferencePicker } from '../src/features/reference/ReferencePicker'
import { REFERENCE_PICKER_TEXT } from '../src/features/reference/referenceText'
import { TopicForm } from '../src/features/round/TopicDialog'
import { PPT_VIEWS } from '../src/shells/ppt/pptViews'
import { ShellViewsContext, type DialogProps, type ShellViews } from '../src/shells/views'
import { setTopic } from '../src/socket/client'

vi.mock('../src/socket/client', () => ({ setTopic: vi.fn(), cancelRound: vi.fn() }))
vi.mock('../src/features/round/countdown', () => ({ usePhaseRemainingSeconds: () => 45, formatClock: (s: number) => `00:${s}` }))

const jpeg = (n = 4) => {
  const b = new Uint8Array(n)
  b.set([0xff, 0xd8, 0xff])
  return b.buffer
}
const ok = (bytes = jpeg()): NormalizeResult => ({ ok: true, jpeg: bytes, width: 10, height: 10 })
const bad: NormalizeResult = { ok: false, error: 'NOT_IMAGE', message: '請選擇圖片檔（PNG、JPEG、WebP 或 GIF）' }
const file = (name = 'a.png') => new Blob([name], { type: 'image/png' })

function choiceDeps(results: NormalizeResult[]) {
  let n = 0
  const deps = {
    normalize: vi.fn(() => Promise.resolve(results.shift() ?? bad)),
    createUrl: vi.fn(() => `blob:ref/${++n}`),
    revokeUrl: vi.fn(),
  } satisfies ReferenceChoiceDeps
  return deps
}

describe('referenceChoice：選好的參考圖與預覽 URL 的生命週期', () => {
  it('選檔成功：轉成 JPEG、建預覽 URL；再選一張 revoke 前一張', async () => {
    const first = jpeg(4)
    const second = jpeg(8)
    const d = choiceDeps([ok(first), ok(second)])
    const c = createReferenceChoice(d)
    const listener = vi.fn()
    c.subscribe(listener)
    await c.choose(file())
    expect(c.getState()).toEqual({ reference: { jpeg: first, url: 'blob:ref/1' }, preparing: false, error: null })
    expect(d.createUrl).toHaveBeenCalledTimes(1)
    expect((d.createUrl.mock.calls[0] as unknown as [Blob])[0].type).toBe('image/jpeg')
    await c.choose(file('b.png'))
    expect(c.getState().reference).toEqual({ jpeg: second, url: 'blob:ref/2' })
    expect(d.revokeUrl).toHaveBeenCalledWith('blob:ref/1')
    expect(listener).toHaveBeenCalled()
  })

  it('不是圖片或轉檔失敗：顯示錯誤、不採用；之前選好的那張保留（不 revoke）', async () => {
    const d = choiceDeps([ok(), bad])
    const c = createReferenceChoice(d)
    await c.choose(file())
    await c.choose(new Blob(['x'], { type: 'text/plain' }))
    expect(c.getState().error).toBe(bad.ok ? '' : bad.message)
    expect(c.getState().reference?.url).toBe('blob:ref/1')
    expect(d.revokeUrl).not.toHaveBeenCalled()
  })

  it('正規化本身丟例外也當轉檔失敗', async () => {
    const c = createReferenceChoice({ normalize: () => Promise.reject(new Error('x')), createUrl: () => 'u', revokeUrl: vi.fn() })
    await c.choose(file())
    expect(c.getState()).toMatchObject({ reference: null, preparing: false, error: '圖片轉檔失敗，請換一張' })
  })

  it('移除：revoke、清掉錯誤；卸載（release）同樣 revoke 並回到初始', async () => {
    const d = choiceDeps([ok(), ok()])
    const c = createReferenceChoice(d)
    await c.choose(file())
    c.setError('參考圖格式不正確或太大（請選圖片檔）')
    c.remove()
    expect(c.getState()).toEqual({ reference: null, preparing: false, error: null })
    expect(d.revokeUrl).toHaveBeenCalledWith('blob:ref/1')
    await c.choose(file())
    c.release()
    expect(d.revokeUrl).toHaveBeenLastCalledWith('blob:ref/2')
    expect(c.getState().reference).toBeNull()
  })

  it('轉檔中：再選被忽略；移除或卸載後轉完的結果丟掉（不建 URL）', async () => {
    let resolve: (r: NormalizeResult) => void = () => {}
    const d = { normalize: vi.fn(() => new Promise<NormalizeResult>((r) => (resolve = r))), createUrl: vi.fn(() => 'u'), revokeUrl: vi.fn() }
    const c = createReferenceChoice(d)
    const pending = c.choose(file())
    expect(c.getState().preparing).toBe(true)
    await c.choose(file('again'))
    expect(d.normalize).toHaveBeenCalledTimes(1)
    c.remove()
    resolve(ok())
    await pending
    expect(c.getState()).toEqual({ reference: null, preparing: false, error: null })
    expect(d.createUrl).not.toHaveBeenCalled()
  })
})

describe('ReferencePicker（靜態渲染）', () => {
  const noop = () => {}
  const empty = renderToStaticMarkup(<ReferencePicker preview={null} busy={false} preparing={false} onFile={noop} onRemove={noop} />)
  const chosen = renderToStaticMarkup(<ReferencePicker preview="blob:ref/1" busy={false} preparing={false} onFile={noop} onRemove={noop} />)
  const busy = renderToStaticMarkup(<ReferencePicker preview="blob:ref/1" busy preparing={false} onFile={noop} onRemove={noop} />)

  it('區塊標題「參考圖（選填）」；檔案欄位是 <input type="file">，無障礙名稱「參考圖」、只收圖片、不在 Tab 順序裡', () => {
    expect(empty).toContain('>參考圖（選填）<')
    const input = /<input [^>]*>/.exec(empty)?.[0] ?? ''
    expect(input).toContain('type="file"')
    expect(input).toContain('aria-label="參考圖"')
    expect(input).toContain('accept="image/*"')
    expect(input).toContain('tabindex="-1"')
  })

  it('沒選圖：拖曳區文字＋「選擇圖片」按鈕；沒有縮圖與移除', () => {
    expect(empty).toContain(REFERENCE_PICKER_TEXT.drop)
    expect(empty).toMatch(/<button type="button" aria-label="選擇圖片"[^>]*>選擇圖片<\/button>/)
    expect(empty).not.toContain('移除參考圖')
    expect(empty).not.toContain('<img')
  })

  it('選好：縮圖預覽（16:9 contain、--bg-editor 底）＋「移除」（無障礙名稱「移除參考圖」）；沒有「選擇圖片」', () => {
    expect(chosen).toMatch(/<img src="blob:ref\/1" alt="參考圖預覽"[^>]*class="[^"]*aspect-video[^"]*bg-editor[^"]*object-contain/)
    expect(chosen).toMatch(/<button type="button" aria-label="移除參考圖"[^>]*>移除<\/button>/)
    expect(chosen).not.toContain('aria-label="選擇圖片"')
  })

  it('Phase 2.5：預覽列可換行、縮圖不超過容器寬（375px 時「移除」不被截）', () => {
    expect(chosen).toMatch(/<div class="flex flex-wrap items-center gap-3[^"]*">\s*<img/)
    expect(chosen).toMatch(/<img [^>]*class="[^"]*w-\[128px\] max-w-full/)
  })

  it('送出中：區塊 aria-busy、按鈕只設 aria-disabled，沒有任何原生 disabled（焦點不會掉）', () => {
    expect(busy).toContain('aria-busy="true"')
    expect(busy).toMatch(/aria-label="移除參考圖" aria-disabled="true"/)
    expect(busy).not.toMatch(/\sdisabled(?:=|\s|\/?>)/)
    expect(chosen).not.toContain('aria-disabled="')
  })

  it('轉檔中：顯示「正在處理圖片…」、「選擇圖片」aria-disabled', () => {
    const html = renderToStaticMarkup(<ReferencePicker preview={null} busy={false} preparing onFile={noop} onRemove={noop} />)
    expect(html).toContain('正在處理圖片…')
    expect(html).toMatch(/aria-label="選擇圖片" aria-disabled="true"/)
  })
})

/** 渲染 TopicForm，擷取交給殼層 Dialog 的 props */
function captureTopic(choice = createReferenceChoice(choiceDeps([]))): DialogProps | null {
  let last: DialogProps | null = null
  const Dialog = (p: DialogProps) => {
    last = p
    return null
  }
  const views: ShellViews = { ...PPT_VIEWS, Dialog }
  renderToStaticMarkup(
    <ShellViewsContext.Provider value={views}>
      <TopicForm choice={choice} />
    </ShellViewsContext.Provider>,
  )
  return last
}

const renderPpt = (choice = createReferenceChoice(choiceDeps([]))) =>
  renderToStaticMarkup(
    <ShellViewsContext.Provider value={PPT_VIEWS}>
      <TopicForm choice={choice} />
    </ShellViewsContext.Provider>,
  )

describe('TopicForm：參考圖交給殼層、送題帶 reference', () => {
  beforeEach(() => {
    vi.mocked(setTopic).mockReset().mockResolvedValue({ ok: true })
  })

  it('attachment 是參考圖區；既有的題目輸入框與兩個選項不變', () => {
    const p = captureTopic()
    expect(p?.attachment).toBeDefined()
    expect(p?.input?.ariaLabel).toBe('題目')
    expect(p?.items.map((i) => i.id)).toEqual(['submit', 'cancel'])
  })

  it('沒選圖：送題不帶 reference（payload 只有題目，一般回合）', async () => {
    captureTopic()?.items[0]?.onSelect()
    await vi.waitFor(() => expect(setTopic).toHaveBeenCalledTimes(1))
    expect(setTopic).toHaveBeenLastCalledWith('', undefined)
  })

  it('選好圖：送題帶那張 JPEG 的 bytes', async () => {
    const bytes = jpeg(16)
    const choice = createReferenceChoice(choiceDeps([ok(bytes)]))
    await choice.choose(file())
    captureTopic(choice)?.items[0]?.onSelect()
    await vi.waitFor(() => expect(setTopic).toHaveBeenCalledTimes(1))
    expect(setTopic).toHaveBeenLastCalledWith('', bytes)
  })

  it('非圖片的錯誤：顯示在對話框的錯誤位置，題目框不標紅', async () => {
    const choice = createReferenceChoice(choiceDeps([bad]))
    await choice.choose(new Blob(['x'], { type: 'text/plain' }))
    const p = captureTopic(choice)
    expect(p?.error).toBe(bad.ok ? null : bad.message)
    expect(p?.input?.invalid).toBe(false)
  })

  it('server 回 REFERENCE_INVALID：錯誤歸參考圖（choice），題目維持', async () => {
    const message = '參考圖格式不正確或太大（請選圖片檔）'
    vi.mocked(setTopic).mockResolvedValue({ ok: false, error: 'REFERENCE_INVALID', message })
    const choice = createReferenceChoice(choiceDeps([ok()]))
    await choice.choose(file())
    captureTopic(choice)?.items[0]?.onSelect()
    await vi.waitFor(() => expect(choice.getState().error).toBe(message))
    expect(choice.getState().reference).not.toBeNull()
  })

  it('轉檔中：確定（送出）為 aria-disabled，按了也不送', async () => {
    const choice = createReferenceChoice({ normalize: () => new Promise(() => {}), createUrl: () => 'u', revokeUrl: () => {} })
    void choice.choose(file())
    const p = captureTopic(choice)
    expect(p?.items[0]?.disabled).toBe(true)
    p?.items[0]?.onSelect()
    await Promise.resolve()
    expect(setTopic).not.toHaveBeenCalled()
  })
})

describe('ppt 殼層實際渲染（AI 遊玩技能的選擇器，決策 12）', () => {
  const inputs = (html: string) => [...html.matchAll(/<input [^>]*>/g)].map((m) => m[0])

  it('題目框是對話框裡第一個 input、明確 type="text"；input:not([type="file"]) 只對到它', () => {
    const html = renderPpt()
    const all = inputs(html)
    expect(all).toHaveLength(2)
    expect(all[0]).toContain('type="text"')
    expect(all[0]).toContain('placeholder="輸入題目（1–20 字）後按 Enter"')
    const notFile = all.filter((tag) => !/\stype="file"/.test(tag))
    expect(notFile).toEqual([all[0]])
    expect(all[1]).toContain('type="file"')
  })

  it('參考圖區在題目框之後、錯誤與按鈕之前；既有的「確定」「取消」不變', () => {
    const html = renderPpt()
    expect(html.indexOf('參考圖（選填）')).toBeGreaterThan(html.indexOf('<input '))
    expect(html.indexOf('參考圖（選填）')).toBeLessThan(html.indexOf('>確定<'))
    expect(html).toContain('>確定<')
    expect(html).toContain('>取消<')
    expect(html).toContain('輸入標題')
  })

  it('選好圖後：縮圖與「移除參考圖」出現在對話框裡', async () => {
    const choice = createReferenceChoice(choiceDeps([ok()]))
    await choice.choose(file())
    const html = renderPpt(choice)
    expect(html).toContain('alt="參考圖預覽"')
    expect(html).toContain('aria-label="移除參考圖"')
  })
})
