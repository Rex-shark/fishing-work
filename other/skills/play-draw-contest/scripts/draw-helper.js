// 繪圖比賽（draw-contest）輔助腳本：在遊戲分頁裡執行一次，會安裝 window.dc（加入、聊天、出題、作畫、交卷、讀結果）。
// 用法見同目錄上一層的 SKILL.md。座標一律是邏輯畫布像素：寬 1280、高 720，原點在左上角。
// 在首頁就可以先裝（加入房間不會換頁，裝好的 dc 會留著）。
// 只透過頁面上的元件操作（對畫布送指標事件、點工具列按鈕），不碰連線與遊戲狀態；重新整理頁面後要再執行一次。
// 依賴的畫面文字與無障礙標籤列在 other/skills/MAINTENANCE.md 的 UI-DEP／CONST-DEP；遊戲改了那些字，這裡的選擇器要跟著改。
(() => {
  'use strict'
  const W = 1280
  const H = 720
  const PALETTE = ['#FFFFFF', '#000000', '#FFECEA', '#9E9E9E', '#F44747', '#FF8C00', '#FFD700', '#6A9955', '#569CD6', '#C586C0']
  // 等待一律不靠計時器的短間隔：瀏覽器視窗被遮住或在背景時，Chrome 會把 setTimeout 拉長到 1 秒以上
  // （實測 39 步要 86 秒），所以「讓頁面先更新一下」用 MessageChannel 讓出執行權，「等到某個狀況成立」用 MutationObserver。
  const yieldOnce = () =>
    new Promise((r) => {
      const ch = new MessageChannel()
      ch.port1.onmessage = () => r()
      ch.port2.postMessage(null)
    })
  /** 讓頁面處理完剛才的點擊與重繪（工具列按鈕讀的是上一次繪製時的狀態） */
  const tick = async () => {
    await yieldOnce()
    await yieldOnce()
  }
  /**
   * 等到 test() 成立就回 true；seconds 秒內沒成立回 false。
   * 畫面一有變動就重新檢查（MutationObserver），計時器只用一個當截止時間，視窗在背景時也不會被拖慢
   */
  function waitUntil(test, seconds) {
    return new Promise((resolve) => {
      if (test()) return resolve(true)
      let timer = null
      const observer = new MutationObserver(() => {
        if (test()) finish(true)
      })
      function finish(value) {
        observer.disconnect()
        clearTimeout(timer)
        resolve(value)
      }
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true })
      timer = setTimeout(() => finish(test()), seconds * 1000)
    })
  }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  const q = (sel, root = document) => root.querySelector(sel)
  const buttonByText = (text) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === text)
  const liveCanvas = () => q('canvas[aria-label="畫布"]')
  /** 出題對話框的題目輸入框（像不像比賽起對話框裡另有參考圖的檔案欄位，要排除） */
  const topicField = () => q('[role="dialog"] input:not([type="file"]):not([type="hidden"])')
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
      await tick()
      return currentColor()
    }
    if (currentColor() === want) return want
    const btn = colorButton()
    if (!btn) throw new Error('找不到顏色按鈕（工具列不在畫面上）')
    const panelSel = '[role="dialog"][aria-label="顏色面板"]'
    if (!q(panelSel)) {
      btn.click()
      await tick()
    }
    const { h, s, v, gray } = hexToHsv(want)
    if (!gray) {
      const hue = q(`${panelSel} [role="slider"][aria-label="色相"]`)
      const r = hue.getBoundingClientRect()
      press(hue, r.left + (Math.round(h) / 360) * r.width, r.top + r.height / 2)
      await tick()
    }
    const sv = q(`${panelSel} [role="slider"][aria-label="飽和度與明度"]`)
    const r = sv.getBoundingClientRect()
    press(sv, r.left + (s / 100) * r.width, r.top + (1 - v / 100) * r.height)
    await tick()
    if (q(panelSel)) btn.click()
    await tick()
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
      await tick()
      slider = sizeSlider()
    }
    if (Number(slider.getAttribute('aria-valuenow')) !== want) {
      const r = slider.getBoundingClientRect()
      press(slider, r.left + ((want - 1) / 63) * r.width, r.top + r.height / 2)
      await tick()
    }
    lastSize = want
    if (more) {
      more.click()
      await tick()
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
    await tick()
    if (before && before !== want) await setColor(before)
    return want
  }

  async function clickTool(label, times = 1) {
    for (let i = 0; i < times; i++) {
      await tick()
      const btn = q(`button[aria-label="${label}"]`)
      if (!btn || btn.disabled) return
      btn.click()
    }
    await tick()
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

  // ─── 題目候選（隨機） ──────────────────────────────────────────
  // 模型自己想題目時很容易收斂到同幾個（照文件裡的例子出），所以出題前先從題庫隨機抽候選，再從中挑。
  const TOPIC_BANK = {
    easy: '香蕉 草莓 葡萄 西瓜 鳳梨 櫻桃 檸檬 玉米 紅蘿蔔 香菇 甜甜圈 漢堡 披薩 壽司 冰淇淋 棒棒糖 蛋糕 珍珠奶茶 荷包蛋 粽子 雨傘 剪刀 鉛筆 時鐘 鑰匙 眼鏡 檯燈 電風扇 馬克杯 茶壺 牙刷 拖鞋 帽子 氣球 風箏 蠟燭 手機 吉他 月亮 星星 彩虹 雪人 仙人掌 向日葵 鬱金香 樹葉 金魚 貓頭鷹 蝸牛 瓢蟲 蝴蝶 烏龜 兔子 小雞 企鵝 青蛙 螃蟹 海星 鯨魚 蘋果'.split(' '),
    medium: '腳踏車 機車 公車 火車 飛機 帆船 潛水艇 火箭 熱氣球 直升機 救護車 消防車 挖土機 紅綠燈 路燈 郵筒 燈塔 風車 城堡 帳篷 摩天輪 溜滑梯 長頸鹿 大象 斑馬 獅子 無尾熊 熊貓 孔雀 恐龍 章魚 水母 鱷魚 刺蝟 松鼠 老鷹 生氣的貓 睡覺的狗 融化的冰淇淋 會飛的豬 戴眼鏡的熊 哭泣的雲 生日蛋糕 聖誕樹 南瓜燈 煙火 電腦 相機 洗衣機 冰箱 電視 沙漏 地球儀 望遠鏡 天秤'.split(' '),
    hard: '戴帽子的企鵝 貓坐在鋼琴上 下雨天等公車 月亮下的燈塔 海邊的椰子樹 雪地裡的小木屋 騎腳踏車的熊 月球上的太空人 坐在雲上的小羊 沙漠裡的駱駝 湖上的天鵝 森林裡的蘑菇屋 夜市的攤位 颱風天的雨傘 吃冰淇淋的狗 打籃球的猴子 彩虹下的獨角獸 火山爆發 海底的沉船 釣魚的小貓 陽台上的盆栽 公園的長椅 夕陽下的帆船 下雪的城堡 飛過山的熱氣球 樹上的貓頭鷹 撐傘的青蛙 蹺蹺板上的兔子 戴耳機的貓 吃竹子的熊貓 衝浪的企鵝 帳篷和營火 拉麵和筷子 窗邊的貓 海盜船 機器人遛狗 外星人的飛碟 恐龍吃蛋糕 雪地裡的企鵝 魚缸裡的金魚'.split(' '),
  }

  /**
   * 隨機給 n 個題目候選（level：'easy'｜'medium'｜'hard'），排除聊天室裡看得到的已出過題目。
   * 每次呼叫結果都不同；挑一個用，或受啟發自己想一個（自己想的也不要跟已出過的重複）
   */
  function suggestTopics(level = 'easy', n = 6) {
    const pool = TOPIC_BANK[level]
    if (!pool) throw new Error(`level 要是 'easy'、'medium' 或 'hard'：${level}`)
    const used = new Set(topics().map((t) => t.trim()))
    const cands = pool.filter((t) => !used.has(t))
    for (let i = cands.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[cands[i], cands[j]] = [cands[j], cands[i]]
    }
    return cands.slice(0, Math.max(1, n))
  }

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

  /** 回合開始的系統訊息：一般是「X 出題「題目」，開始作畫」，像不像比賽是「X 出題「題目」（像不像比賽：照著參考圖畫）」 */
  const ROUND_START = /出題「(.+)」(，開始作畫|（像不像比賽：照著參考圖畫）)$/
  const roundStarts = () =>
    chat(Infinity)
      .map((m) => (m.who === null ? ROUND_START.exec(m.text) : null))
      .filter(Boolean)

  /** 出過的題目（依聊天室的系統訊息，舊到新）。只看得到聊天室還留著的部分：伺服器重啟會清空，空陣列不代表沒出過 */
  function topics() {
    return roundStarts().map((m) => m[1])
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
      // 像不像比賽：照著參考圖畫，評分看像不像參考圖。畫面上有「參考圖」面板就是；聊天室的開始訊息當備援
      out.mimic = q('section[aria-label="參考圖"]') !== null || (roundStarts().pop()?.[2] ?? '').includes('像不像')
    } else {
      // 最近一題：揭曉是「題目　第一名：…」、等待中是「上一回合：題目　第一名：…」（中間是全形空白）；讀不到就從聊天室找
      const summary = phase === 'ended' || phase === 'idle' ? head.replace(/^上一回合：/, '') : ''
      // 像不像比賽的回合，題目後面多「（像不像）」
      out.lastTopic = (summary.includes('\u3000') ? summary.split('\u3000')[0].replace(/（像不像）$/, '') : null) ?? topics().pop() ?? null
    }
    // 自己正在出題時：對話框輸入框裡目前的字（確認字有打進去）
    if (phase === 'choosing') out.topicInput = topicField()?.value ?? null
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
    const reached = await waitUntil(() => want.includes(status().phase), seconds)
    return { reached, status: status() }
  }

  /** 依序執行作畫步驟；任何一步失敗就停下並回報是哪一步。題目剛送出、畫布還沒出現時會先等一下（最多 5 秒） */
  async function draw(steps) {
    if (!Array.isArray(steps)) return { ok: false, error: 'steps 要是陣列', status: status() }
    await waitUntil(() => liveCanvas() !== null, 5)
    if (!liveCanvas()) return { ok: false, done: 0, error: '畫布現在不能畫（不是作畫階段、你是旁觀者，或已經交卷）', status: status() }
    await tick()
    let done = 0
    try {
      for (const step of steps) {
        await runStep(step)
        done++
      }
    } catch (e) {
      return { ok: false, done, failedStep: steps[done], error: String(e?.message ?? e), status: status() }
    }
    await tick()
    return { ok: true, done, status: status() }
  }

  /** 交卷：按「完成」再按確認框的「儲存」；交卷後不能再改 */
  async function submit() {
    if (!liveCanvas()) return { ok: false, error: '現在不能交卷（不是作畫階段、你是旁觀者，或已經交卷）', status: status() }
    await tick()
    const finish = buttonByText('完成')
    if (!finish) return { ok: false, error: '找不到「完成」按鈕', status: status() }
    finish.click()
    await waitUntil(() => buttonByText('儲存') !== undefined, 3)
    const save = buttonByText('儲存')
    if (!save) return { ok: false, error: '確認框沒有出現', status: status() }
    // 比對時去掉倒數（每秒都在變）
    const progress = () => status().text.replace(/\d\d:\d\d/, '')
    const before = progress()
    save.click()
    await waitUntil(() => liveCanvas() === null, 15)
    if (liveCanvas()) return { ok: false, error: '交卷沒有成功，看畫面上「完成」旁邊的錯誤訊息', status: status() }
    // 畫布鎖定就是交卷成功；「已儲存 n/m」晚一點才更新，稍等讓回傳的 status 是新的
    await waitUntil(() => progress() !== before, 1.5)
    return { ok: true, status: status() }
  }

  /**
   * 揭曉結果：每張畫一筆 { label, commentPending }；label 有名次、暱稱、分數與完整評語（卡片上的評語太長會被截斷，以這裡為準）。
   * commentPending 為 true 表示評語還在寫，過幾秒再讀。還沒揭曉（或畫廊已收起）回 null。
   * 像不像比賽的第一格是「參考圖」卡（按鈕帶 data-reveal-reference、不帶 data-reveal，沒有名次與分數），不列入
   */
  function results() {
    const list = q('ol[aria-label="投影片瀏覽"]')
    if (!list) return null
    return Array.from(list.children)
      .map((li) => ({
        label: (q('button[data-reveal]', li)?.getAttribute('aria-label') ?? li.querySelector('button')?.getAttribute('aria-label') ?? '').replace(/（放大）$/, ''),
        commentPending: q('[data-reveal-comment="pending"]', li) !== null,
      }))
      .filter((r) => /^第 \d+ 名/.test(r.label))
  }

  // ─── 加入、聊天、出題（填輸入框、送出表單、按按鈕；跟用鍵盤滑鼠操作是同一條路） ───────────

  /** 設定輸入框的值並通知頁面（React 的受控輸入框要走原生 setter 加 input 事件才收得到） */
  function setInput(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const alertText = (root = document) => q('[role="alert"]', root)?.textContent.trim() ?? null
  const until = waitUntil

  /** 在首頁輸入暱稱加入房間；回 { ok, error, status }。暱稱重複等錯誤會在 error 裡，換一個再呼叫即可 */
  async function join(nickname) {
    const input = q('input[name="nickname"]')
    if (!input) return { ok: status().phase !== 'unknown', error: '不在首頁（已經在房間裡了？）', status: status() }
    setInput(input, nickname)
    await tick()
    input.form.requestSubmit()
    // 上一次失敗的錯誤訊息還在畫面上：先等它被清掉，才不會把舊訊息當成這一次的結果
    await until(() => !q('input[name="nickname"]') || alertText() === null, 1)
    await until(() => !q('input[name="nickname"]') || alertText() !== null, 8)
    const joined = !q('input[name="nickname"]')
    if (joined) await until(() => status().phase !== 'unknown', 3)
    return joined ? { ok: true, status: status() } : { ok: false, error: alertText() ?? '沒有加入成功，看首頁上的訊息', status: status() }
  }

  /** 在聊天室送出一則訊息（最多 200 字）；回 { ok, error } */
  async function say(text) {
    const input = q('[aria-label="聊天輸入"]')
    if (!input) return { ok: false, error: '找不到聊天輸入框（還沒加入房間？）' }
    const count = () => document.querySelectorAll('[aria-label="聊天訊息"] > li[data-kind="chat"]').length
    const before = count()
    setInput(input, text)
    await tick()
    input.form.requestSubmit()
    const sent = await until(() => count() > before || alertText(input.form) !== null, 4)
    return count() > before ? { ok: true } : { ok: false, error: (sent && alertText(input.form)) || '訊息沒有送出' }
  }

  /** 按「我出題」；成功時你成為出題者、出題對話框已出現。回 { ok, error, status } */
  async function volunteer() {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') ?? '').endsWith('：我出題'))
    if (!btn) return { ok: false, error: '現在不能出題（有回合在進行，或在線不到 2 人）', status: status() }
    btn.click()
    const opened = await until(() => topicField() !== null, 5)
    return opened ? { ok: true, status: status() } : { ok: false, error: alertText() ?? '出題對話框沒有出現（可能被別人搶先）', status: status() }
  }

  /** 在出題對話框輸入題目並送出（1–20 字）；成功時作畫已經開始，接著呼叫 draw。回 { ok, error, status } */
  async function setTopic(topic) {
    const input = topicField()
    if (!input) return { ok: false, error: '出題對話框不在畫面上（你不是出題者，或還沒呼叫 volunteer）', status: status() }
    setInput(input, topic)
    await tick()
    input.form.requestSubmit()
    await until(() => topicField() === null || alertText(q('[role="dialog"]')) !== null, 6)
    if (topicField() !== null) return { ok: false, error: alertText(q('[role="dialog"]')) ?? '題目沒有送出', status: status() }
    await until(() => status().phase === 'drawing', 3)
    return { ok: status().phase === 'drawing', status: status() }
  }

  /** 放棄出題（按出題對話框的「取消」）；回 { ok, status } */
  async function cancelTopic() {
    const btn = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent.trim() === '取消')
    if (!btn) return { ok: false, error: '出題對話框不在畫面上', status: status() }
    btn.click()
    const closed = await until(() => topicField() === null, 4)
    return { ok: closed, status: status() }
  }

  /** 等揭曉且每張畫的評語都寫完（或確定沒有評語）才回傳；最多等 seconds 秒。回 { done, results } */
  async function waitForComments(seconds = 25) {
    const allWritten = () => {
      const r = results()
      return r !== null && r.every((x) => !x.commentPending)
    }
    const done = await waitUntil(allWritten, seconds)
    return { done, results: results() }
  }

  window.dc = { join, say, volunteer, setTopic, cancelTopic, suggestTopics, draw, submit, status, waitFor, waitForComments, results, chat, topics, W, H, PALETTE }
  return `dc 已安裝（畫布 ${W}×${H}）：${JSON.stringify(status())}`
})()
