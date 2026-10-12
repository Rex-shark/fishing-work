// 繪圖比賽（draw-contest）作畫輔助：在遊戲分頁裡執行一次，會安裝 window.dc。
// 用法見同目錄上一層的 SKILL.md「畫法 A」。座標一律是邏輯畫布像素：寬 1280、高 720，原點在左上角。
// 只透過頁面上的元件操作（對畫布送指標事件、點工具列按鈕），不碰連線與遊戲狀態；重新整理頁面後要再執行一次。
// 依賴的畫面文字與無障礙標籤列在 SKILL.md 檔頭的 UI-DEP／CONST-DEP（grep 這兩個字）；遊戲改了那些字，這裡的選擇器要跟著改。
(() => {
  'use strict'
  const W = 1280
  const H = 720
  const PALETTE = ['#FFFFFF', '#000000', '#FFECEA', '#9E9E9E', '#F44747', '#FF8C00', '#FFD700', '#6A9955', '#569CD6', '#C586C0']
  /** 等 React 重繪（工具列按鈕讀的是上一次繪製時的狀態） */
  const TICK = 60
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  const q = (sel, root = document) => root.querySelector(sel)
  const buttonByText = (text) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === text)
  const liveCanvas = () => q('canvas[aria-label="畫布"]')
  let lastSize = 4

  function fire(el, type, x, y) {
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: type === 'pointermove' ? -1 : 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: x,
        clientY: y,
      }),
    )
  }
  const press = (el, x, y) => {
    fire(el, 'pointerdown', x, y)
    fire(el, 'pointerup', x, y)
  }

  /** 一筆：points 為 [[x, y], …]（邏輯像素）；只有一點時畫一個圓點 */
  function stroke(points) {
    const c = liveCanvas()
    if (!c) throw new Error('畫布現在不能畫（不是作畫階段、你是旁觀者，或已經交卷）')
    const r = c.getBoundingClientRect()
    const at = ([x, y]) => [r.left + (clamp(x, 0, W) / W) * r.width, r.top + (clamp(y, 0, H) / H) * r.height]
    const first = at(points[0])
    fire(c, 'pointerdown', first[0], first[1])
    let last = first
    for (let i = 1; i < points.length; i++) {
      last = at(points[i])
      fire(c, 'pointermove', last[0], last[1])
    }
    fire(c, 'pointerup', last[0], last[1])
  }

  // ─── 顏色、粗細、背景 ───────────────────────────────────────────

  const normHex = (hex) => {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex).trim())
    if (!m) throw new Error(`色碼要是 #RRGGBB：${hex}`)
    return `#${m[1].toUpperCase()}`
  }
  const colorButton = () => q('button[aria-label^="選擇顏色"]')
  const currentColor = () => (/#[0-9A-F]{6}/.exec(colorButton()?.getAttribute('aria-label') ?? '') ?? [null])[0]

  function hexToHsv(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    const max = Math.max(r, g, b)
    const d = max - Math.min(r, g, b)
    let h = 0
    if (d !== 0) {
      if (max === r) h = 60 * (((g - b) / d + 6) % 6)
      else if (max === g) h = 60 * ((b - r) / d + 2)
      else h = 60 * ((r - g) / d + 4)
    }
    return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100, gray: d === 0 }
  }

  /** 換筆色：色塊有的直接點色塊；其他顏色用顏色面板（色相條＋飽和度明度方塊，結果可能差一兩階）。回傳實際筆色 */
  async function setColor(hex) {
    const want = normHex(hex)
    const swatch = PALETTE.includes(want) ? q(`[role="radio"][aria-label^="顏色 ${want}"]`) : null
    if (swatch) {
      swatch.click()
      await sleep(TICK)
      return currentColor()
    }
    if (currentColor() === want) return want
    const btn = colorButton()
    if (!btn) throw new Error('找不到顏色按鈕（工具列不在畫面上）')
    const panelSel = '[role="dialog"][aria-label="顏色面板"]'
    if (!q(panelSel)) {
      btn.click()
      await sleep(TICK)
    }
    const { h, s, v, gray } = hexToHsv(want)
    if (!gray) {
      const hue = q(`${panelSel} [role="slider"][aria-label="色相"]`)
      const r = hue.getBoundingClientRect()
      press(hue, r.left + (Math.round(h) / 360) * r.width, r.top + r.height / 2)
      await sleep(TICK)
    }
    const sv = q(`${panelSel} [role="slider"][aria-label="飽和度與明度"]`)
    const r = sv.getBoundingClientRect()
    press(sv, r.left + (s / 100) * r.width, r.top + (1 - v / 100) * r.height)
    await sleep(TICK)
    if (q(panelSel)) btn.click()
    await sleep(TICK)
    return currentColor()
  }

  const sizeSlider = () => q('[role="slider"][aria-label="粗細"]')
  const currentSize = () => {
    const s = sizeSlider()
    return s ? Number(s.getAttribute('aria-valuenow')) : lastSize
  }

  /** 換粗細（1–64 邏輯像素）；視窗太窄時滑桿收在「⋯」裡，會自動打開再關上 */
  async function setSize(size) {
    const want = clamp(Math.round(Number(size)), 1, 64)
    if (!Number.isFinite(want)) throw new Error(`粗細要是 1–64 的數字：${size}`)
    let slider = sizeSlider()
    let more = null
    if (!slider) {
      more = q('button[aria-label^="更多畫筆設定"]')
      if (!more) throw new Error('找不到粗細滑桿（工具列不在畫面上）')
      more.click()
      await sleep(TICK)
      slider = sizeSlider()
    }
    if (Number(slider.getAttribute('aria-valuenow')) !== want) {
      const r = slider.getBoundingClientRect()
      press(slider, r.left + ((want - 1) / 63) * r.width, r.top + r.height / 2)
      await sleep(TICK)
    }
    lastSize = want
    if (more) {
      more.click()
      await sleep(TICK)
    }
    return want
  }

  /** 換背景色（只影響自己的畫布，交卷的圖也用它當底）；換完筆色回到原本的顏色 */
  async function setBackground(hex) {
    const before = currentColor()
    const want = await setColor(hex)
    const btn = q('button[aria-label^="把背景設為目前顏色"]')
    if (!btn) throw new Error('找不到背景色按鈕（工具列不在畫面上）')
    btn.click()
    await sleep(TICK)
    if (before && before !== want) await setColor(before)
    return want
  }

  async function clickTool(label, times = 1) {
    for (let i = 0; i < times; i++) {
      await sleep(TICK)
      const btn = q(`button[aria-label="${label}"]`)
      if (!btn || btn.disabled) return
      btn.click()
    }
    await sleep(TICK)
  }

  // ─── 形狀 ─────────────────────────────────────────────────────

  /** 橢圓上的點；start／end 是角度（0 在右邊、順時針，90 在正下方），不滿一圈時頭尾兩點都含 */
  function ellipsePoints(cx, cy, rx, ry, start = 0, end = 360) {
    const full = Math.abs(end - start) >= 360
    const n = full ? 72 : Math.max(8, Math.ceil(Math.abs(end - start) / 5))
    return Array.from({ length: full ? n : n + 1 }, (_, i) => {
      const a = ((start + ((end - start) * i) / n) * Math.PI) / 180
      return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]
    })
  }

  /** 通過每個點的平滑曲線（Catmull-Rom） */
  function smoothPath(pts, closed) {
    if (pts.length < 3) return pts
    const n = pts.length
    const get = (i) => (closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)])
    const out = []
    const segments = closed ? n : n - 1
    for (let i = 0; i < segments; i++) {
      const [p0, p1, p2, p3] = [get(i - 1), get(i), get(i + 1), get(i + 2)]
      for (let k = 0; k < 12; k++) {
        const t = k / 12
        const f = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t)
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])])
      }
    }
    if (!closed) out.push(pts[n - 1])
    return out
  }

  /** 用目前筆刷把多邊形塗滿：水平掃描線，最後沿邊界描一圈把邊緣修平；每條線只有一段時（凸形）連成一筆，復原一次就整塊消失 */
  function fillPolygon(poly, size) {
    const half = size / 2
    const ys = poly.map((p) => p[1])
    let y0 = Math.min(...ys) + half
    let y1 = Math.max(...ys) - half
    if (y1 < y0) y0 = y1 = (y0 + y1) / 2
    const rows = Math.max(1, Math.ceil((y1 - y0) / Math.max(1, size * 0.5)))
    const spans = []
    let single = true
    for (let i = 0; i <= rows; i++) {
      const y = y0 + ((y1 - y0) * i) / rows
      const xs = []
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k]
        const b = poly[(k + 1) % poly.length]
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]))
      }
      xs.sort((a, b) => a - b)
      if (xs.length !== 2) single = false
      for (let k = 0; k + 1 < xs.length; k += 2) {
        let xa = xs[k] + half
        let xb = xs[k + 1] - half
        if (xb < xa) xa = xb = (xs[k] + xs[k + 1]) / 2
        spans.push([xa, xb, y])
      }
    }
    const outline = [...poly, poly[0]]
    if (single && spans.length > 0) {
      const path = []
      spans.forEach(([xa, xb, y], i) => (i % 2 === 0 ? path.push([xa, y], [xb, y]) : path.push([xb, y], [xa, y])))
      stroke([...path, ...outline])
    } else {
      for (const [xa, xb, y] of spans) stroke(xa === xb ? [[xa, y]] : [[xa, y], [xb, y]])
      stroke(outline)
    }
  }

  async function shape(points, step) {
    if (!Array.isArray(points) || points.length === 0) throw new Error('缺少座標')
    if (!step.fill) {
      stroke(step.closed === false ? points : [...points, points[0]])
      return
    }
    const xs = points.map((p) => p[0])
    const ys = points.map((p) => p[1])
    const small = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    const before = currentSize()
    // 填色用細筆刷：邊緣才貼齊形狀、細長的角也塗得到
    const fillSize = await setSize(step.fillSize ?? clamp(Math.round(small / 12), 2, 10))
    fillPolygon(points, fillSize)
    if (before !== fillSize) await setSize(before)
  }

  async function runStep(step) {
    if (step.op === 'bg') return void (await setBackground(step.color))
    if (step.color) await setColor(step.color)
    if (step.size) await setSize(step.size)
    switch (step.op) {
      case 'color':
      case 'size':
        return
      case 'line':
        return stroke([step.from, step.to])
      case 'dot':
        return stroke([step.at])
      case 'path': {
        const pts = step.smooth ? smoothPath(step.points, !!step.closed) : step.points
        return stroke(step.closed ? [...pts, pts[0]] : pts)
      }
      case 'polygon':
        return shape(step.points, step)
      case 'rect':
        return shape(
          [
            [step.x, step.y],
            [step.x + step.w, step.y],
            [step.x + step.w, step.y + step.h],
            [step.x, step.y + step.h],
          ],
          step,
        )
      case 'ellipse': {
        const arc = step.start !== undefined || step.end !== undefined
        const pts = ellipsePoints(step.cx, step.cy, step.rx, step.ry ?? step.rx, step.start ?? 0, step.end ?? 360)
        // 不填色的弧線不閉合；填色時以頭尾兩點的連線封口（半圓、弓形）
        return shape(pts, arc && !step.fill ? { ...step, closed: false } : step)
      }
      case 'undo':
        return clickTool('復原', step.times ?? 1)
      case 'clear':
        return clickTool('清空畫布')
      default:
        throw new Error(`不認得的 op：${step.op}`)
    }
  }

  // ─── 狀態、交卷、結果 ───────────────────────────────────────────

  /** 元素內的文字，各段以一個空白相接（倒數與前面的文字是不同節點） */
  function textOf(el) {
    const parts = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const t = walker.currentNode.textContent.trim()
      if (t) parts.push(t)
    }
    return parts.join(' ')
  }

  /** 聊天室最後 n 則：玩家訊息 { who, time, text }；系統訊息（加入、出題、揭曉…）的 who 是 null */
  function chat(n = 20) {
    return Array.from(document.querySelectorAll('[aria-label="聊天訊息"] > li'))
      .slice(-n)
      .map((li) =>
        li.dataset.kind === 'chat'
          ? { who: q('div > span:not([aria-hidden])', li)?.textContent ?? '', time: q('time', li)?.textContent ?? '', text: q('p', li)?.textContent ?? '' }
          : { who: null, text: li.textContent.trim() },
      )
  }

  /** 出過的題目（依聊天室的系統訊息，舊到新）。只看得到聊天室還留著的部分：伺服器重啟會清空，空陣列不代表沒出過 */
  function topics() {
    return chat(Infinity)
      .map((m) => (m.who === null ? /出題「(.+)」，開始作畫$/.exec(m.text) : null))
      .filter(Boolean)
      .map((m) => m[1])
  }

  /** 目前回合狀態（讀畫面上的文字，不讀遊戲內部狀態） */
  function status() {
    const notes = q('[aria-label="備忘稿"] [role="status"]')
    const segments = notes ? Array.from(notes.children).map(textOf) : []
    const text = segments.join('  ')
    // 只看第一段的固定句型：揭曉與等待中的那一列帶著題目，題目可以是任何字，不能用「包含某個詞」判斷
    const head = segments[0] ?? ''
    let phase = 'unknown'
    if (!notes) phase = q('input[name="nickname"]') ? 'home' : 'unknown'
    else if (/^作畫中 \d\d:\d\d$/.test(head)) phase = 'drawing'
    else if (/^正在評分 \d+\/\d+…/.test(head)) phase = 'judging'
    else if (/正在輸入.+… \d\d:\d\d$/.test(head)) phase = 'choosing'
    else if (head.startsWith('上一回合')) phase = 'idle'
    else phase = 'ended'
    const clock = /(\d\d):(\d\d)$/.exec(head)
    const out = { phase, text, secondsLeft: clock && (phase === 'drawing' || phase === 'choosing') ? Number(clock[1]) * 60 + Number(clock[2]) : null }
    if (phase === 'drawing') {
      out.topic = (segments[1] ?? '').split('：').slice(1).join('：')
      out.role = (segments[1] ?? '').startsWith('本回合旁觀') ? 'spectator' : 'participant'
      out.canDraw = liveCanvas() !== null
      out.submitted = out.role === 'participant' && !out.canDraw
    } else {
      // 最近一題：揭曉是「題目　第一名：…」、等待中是「上一回合：題目　第一名：…」（中間是全形空白）；讀不到就從聊天室找
      const summary = phase === 'ended' || phase === 'idle' ? head.replace(/^上一回合：/, '') : ''
      out.lastTopic = (summary.includes('\u3000') ? summary.split('\u3000')[0] : null) ?? topics().pop() ?? null
    }
    // 自己正在出題時：對話框輸入框裡目前的字（確認字有打進去）
    if (phase === 'choosing') out.topicInput = q('[role="dialog"] input')?.value ?? null
    // 送出中的按鈕是 aria-disabled／aria-busy，不是原生 disabled
    out.canVolunteer = Array.from(document.querySelectorAll('button')).some(
      (b) => (b.getAttribute('aria-label') ?? '').endsWith('：我出題') && !b.disabled && b.getAttribute('aria-disabled') !== 'true',
    )
    return out
  }

  /**
   * 在頁面裡等到進入指定階段（字串或陣列）才回傳，省掉一直來回查；最多等 seconds 秒（預設 25，避免工具逾時）。
   * 回 { reached, status }：reached 為 false 表示時間到了還沒等到，再呼叫一次即可
   */
  async function waitFor(phases, seconds = 25) {
    const want = Array.isArray(phases) ? phases : [phases]
    const until = Date.now() + seconds * 1000
    for (;;) {
      const s = status()
      if (want.includes(s.phase)) return { reached: true, status: s }
      if (Date.now() >= until) return { reached: false, status: s }
      await sleep(250)
    }
  }

  /** 依序執行作畫步驟；任何一步失敗就停下並回報是哪一步。題目剛送出、畫布還沒出現時會先等一下（最多 5 秒） */
  async function draw(steps) {
    if (!Array.isArray(steps)) return { ok: false, error: 'steps 要是陣列', status: status() }
    for (let i = 0; i < 50 && !liveCanvas(); i++) await sleep(100)
    if (!liveCanvas()) return { ok: false, done: 0, error: '畫布現在不能畫（不是作畫階段、你是旁觀者，或已經交卷）', status: status() }
    await sleep(TICK)
    let done = 0
    try {
      for (const step of steps) {
        await runStep(step)
        done++
      }
    } catch (e) {
      return { ok: false, done, failedStep: steps[done], error: String(e?.message ?? e), status: status() }
    }
    await sleep(TICK)
    return { ok: true, done, status: status() }
  }

  /** 交卷：按「完成」再按確認框的「儲存」；交卷後不能再改 */
  async function submit() {
    if (!liveCanvas()) return { ok: false, error: '現在不能交卷（不是作畫階段、你是旁觀者，或已經交卷）', status: status() }
    await sleep(TICK)
    const finish = buttonByText('完成')
    if (!finish) return { ok: false, error: '找不到「完成」按鈕', status: status() }
    finish.click()
    let save
    for (let i = 0; i < 40 && !save; i++) {
      await sleep(50)
      save = buttonByText('儲存')
    }
    if (!save) return { ok: false, error: '確認框沒有出現', status: status() }
    // 比對時去掉倒數（每秒都在變）
    const progress = () => status().text.replace(/\d\d:\d\d/, '')
    const before = progress()
    save.click()
    for (let i = 0; i < 300 && liveCanvas(); i++) await sleep(50)
    if (liveCanvas()) return { ok: false, error: '交卷沒有成功，看畫面上「完成」旁邊的錯誤訊息', status: status() }
    // 畫布鎖定就是交卷成功；「已儲存 n/m」晚一點才更新，稍等讓回傳的 status 是新的
    for (let i = 0; i < 30 && progress() === before; i++) await sleep(50)
    return { ok: true, status: status() }
  }

  /**
   * 揭曉結果：每張畫一筆 { label, commentPending }；label 有名次、暱稱、分數與完整評語（卡片上的評語太長會被截斷，以這裡為準）。
   * commentPending 為 true 表示評語還在寫，過幾秒再讀。還沒揭曉（或畫廊已收起）回 null
   */
  function results() {
    const list = q('ol[aria-label="投影片瀏覽"]')
    if (!list) return null
    return Array.from(list.children).map((li) => ({
      label: (q('button[data-reveal]', li)?.getAttribute('aria-label') ?? '').replace(/（放大）$/, ''),
      commentPending: q('[data-reveal-comment="pending"]', li) !== null,
    }))
  }

  /** 等揭曉且每張畫的評語都寫完（或確定沒有評語）才回傳；最多等 seconds 秒。回 { done, results } */
  async function waitForComments(seconds = 25) {
    const until = Date.now() + seconds * 1000
    for (;;) {
      const r = results()
      const done = r !== null && r.every((x) => !x.commentPending)
      if (done || Date.now() >= until) return { done, results: r }
      await sleep(500)
    }
  }

  window.dc = { draw, submit, status, waitFor, waitForComments, results, chat, topics, W, H, PALETTE }
  return `dc 已安裝（畫布 ${W}×${H}）：${JSON.stringify(status())}`
})()
