import { describe, expect, it } from 'vitest'
import { DRAWER_IMAGE_BLOCKED, dragHasFiles, imageBlockedReason, nextDragDepth, type DragEventKind } from '../src/features/chat/dropZone'

const run = (events: DragEventKind[]) => events.reduce(nextDragDepth, 0)

describe('nextDragDepth：投放覆蓋層不因子元素 dragleave 閃爍', () => {
  it('進入面板 → 深度 1（顯示覆蓋層）', () => {
    expect(run(['enter'])).toBe(1)
  })

  it('移到子元素：先 enter 子元素再 leave 父元素，深度維持 > 0', () => {
    expect(run(['enter', 'enter', 'leave'])).toBe(1)
  })

  it('真正離開面板 → 0（收起）', () => {
    expect(run(['enter', 'enter', 'leave', 'leave'])).toBe(0)
  })

  it('多餘的 leave 不會變負數', () => {
    expect(run(['leave', 'leave'])).toBe(0)
    expect(run(['enter', 'leave', 'leave', 'enter'])).toBe(1)
  })

  it('drop／dragend 一律歸零', () => {
    expect(run(['enter', 'enter', 'enter', 'drop'])).toBe(0)
    expect(run(['enter', 'enter', 'end'])).toBe(0)
  })
})

describe('dragHasFiles：只有拖檔案時才顯示覆蓋層', () => {
  it.each([
    [['Files'], true],
    [['text/plain', 'Files'], true],
    [['text/plain'], false],
    [['text/uri-list', 'text/html'], false],
    [[], false],
  ])('%j → %s', (types, expected) => {
    expect(dragHasFiles(types)).toBe(expected)
  })

  it('沒有 dataTransfer', () => {
    expect(dragHasFiles(null)).toBe(false)
    expect(dragHasFiles(undefined)).toBe(false)
  })
})

describe('imageBlockedReason：作畫中的畫師不能傳圖（決策 4）', () => {
  it('畫師在 choosing／drawing 被擋，文字與 server 相同', () => {
    expect(imageBlockedReason('choosing', true)).toBe(DRAWER_IMAGE_BLOCKED)
    expect(imageBlockedReason('drawing', true)).toBe('作畫中畫師不能傳圖片')
  })

  it('猜題者不擋；畫師在 idle／ended 不擋', () => {
    expect(imageBlockedReason('drawing', false)).toBeNull()
    expect(imageBlockedReason('choosing', false)).toBeNull()
    expect(imageBlockedReason('idle', true)).toBeNull()
    expect(imageBlockedReason('ended', true)).toBeNull()
  })
})
