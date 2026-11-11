// 出題對話框的歌手名預檢遇到不可見字元（Epic 21 決策 1；spec/architecture.md §9.1、spec/song-guess/architecture.md §5.4）：
//   SourceDialog 以 shared 的 validateArtist 預檢（與 server 同一個函式）；含禁用的不可見字元（零寬空白、隱形填充…）
//   或移除不可見字元後為空 → 不送出，顯示既有的 ARTIST_INVALID_MESSAGE；emoji 用的 ZWJ／VS16（👨‍👩‍👧、❤️）照常送出。
// 本款三種輸入只有歌手名在客戶端預檢；暱稱與聊天照 server 的 ack.message 顯示（文案同既有 INVALID）。
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ARTIST_INVALID_MESSAGE } from '@fishing-work/shared/song-guess'
import type { DialogProps } from '../src/shells/views'
import { ShellViewsContext } from '../src/shells/views'
import { MEET_VIEWS } from '../src/shells/meet/meetViews'
import { initialGameState, useGameStore } from '../src/store/game'
import { mount, unmountAll } from './fakeDom'
import { round } from './fixtures'

const setSource = vi.hoisted(() => vi.fn(async () => ({ ok: false as const, error: 'ARTIST_NOT_FOUND' as const, message: '找不到這位歌手' })))
vi.mock('../src/socket/client', () => ({ setSource, cancelRound: vi.fn(async () => ({ ok: true })) }))

const { SourceDialog } = await import('../src/features/round/SourceDialog')

let last: DialogProps | null = null
const Dialog = (p: DialogProps) => {
  last = p
  return null
}
const props = (): DialogProps => {
  if (last === null) throw new Error('對話框沒有渲染')
  return last
}

async function submitArtist(text: string): Promise<void> {
  await act(async () => props().input?.onChange(text))
  await act(async () => props().items.find((i) => i.id === 'submit')?.onSelect())
}

beforeEach(async () => {
  setSource.mockClear()
  last = null
  useGameStore.setState({ me: 'p1', round: round({ phase: 'choosing', setterId: 'p1', endsAt: null }) })
  await mount(<ShellViewsContext.Provider value={{ ...MEET_VIEWS, Dialog }}>{<SourceDialog />}</ShellViewsContext.Provider>)
})

afterEach(async () => {
  await unmountAll()
  useGameStore.setState({ ...initialGameState })
})

describe('SourceDialog：歌手名含不可見字元', () => {
  it.each([
    ['只有零寬空白 U+200B', '​'],
    ['夾零寬空白', '孫​燕姿'],
    ['隱形填充 U+3164', 'ㅤ'],
    ['只有 ZWJ', '‍'],
    ['BOM U+FEFF', 'Jay﻿Chou'],
  ])('%s：不送出、顯示既有的歌手名錯誤訊息', async (_name, text) => {
    await submitArtist(text)
    expect(setSource).not.toHaveBeenCalled()
    expect(props().error).toBe(ARTIST_INVALID_MESSAGE)
  })

  it.each([
    ['ZWJ 組合 emoji', '👨‍👩‍👧'],
    ['VS16 emoji', '❤️'],
    ['一般歌手名', '孫燕姿'],
  ])('%s：照常送出（錯誤是 server 回的，不是本地預檢）', async (_name, text) => {
    await submitArtist(text)
    expect(setSource).toHaveBeenCalledTimes(1)
    expect(props().error).toBe('找不到這位歌手')
  })
})
