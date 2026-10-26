/**
 * dsh-qqbot-plus/bilibili — 读 B 站视频：
 *   bili_read   元数据 / 弹幕（短视频全量）/ 热评（含楼中楼）/ 字幕（需 SESSDATA）
 *   bili_frames 视频缩略图拼图 → 视觉模型概述画面
 *   bili_hot    B 站热门榜（自己刷 B 站用）
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'dsh-qqbot-plus:bilibili'
export const inject = ['tools']

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
const REF = 'https://www.bilibili.com/'
const BV_RE = /BV[0-9A-Za-z]{10}/
const AV_RE = /av(\d+)/i
const B23_RE = /https?:\/\/b23\.tv\/[A-Za-z0-9]+/i
let lastRequestAt = 0
let buvidCookie = ''

async function throttle(ms = 400) {
  const wait = lastRequestAt + ms - Date.now()
  if (wait > 0) await sleep(wait)
  lastRequestAt = Date.now()
}

function headers(extra = {}) {
  const h = {
    'user-agent': UA,
    referer: REF,
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    ...extra,
  }
  const sess = process.env.BILIBILI_SESSDATA || ''
  const cookies = []
  if (sess) cookies.push(`SESSDATA=${sess}`)
  if (buvidCookie) cookies.push(buvidCookie)
  if (cookies.length) h.cookie = cookies.join('; ')
  return h
}

async function ensureBuvid(timeoutMs) {
  if (buvidCookie) return
  try {
    await throttle()
    const res = await fetch('https://www.bilibili.com/', { headers: headers(), redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
    const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    const hit = cookies.find(c => String(c).startsWith('buvid3='))
    if (hit) buvidCookie = String(hit).split(';')[0]
  } catch { /* 没 cookie 也继续试 */ }
}

async function fetchJson(url, timeoutMs) {
  await throttle()
  const res = await fetch(url, { headers: headers(), redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`B站接口 HTTP ${res.status}`)
  const data = await res.json()
  if (typeof data?.code !== 'number') throw new Error('B站接口返回非 JSON 信封')
  if (data.code !== 0) throw new Error(`B站接口错误 ${data.code}: ${data.message || ''}`)
  return data.data
}

async function fetchText(url, timeoutMs) {
  await throttle()
  const res = await fetch(url, { headers: headers({ accept: 'application/xml,text/xml,*/*' }), redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`B站接口 HTTP ${res.status}`)
  return await res.text()
}

function decodeXml(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
}

function fmtDuration(sec) {
  const n = Number(sec) || 0
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

function fmtDate(ts) {
  try { return new Date(Number(ts) * 1000).toISOString().slice(0, 10) } catch { return '' }
}

function fmtCount(n) {
  const v = Number(n) || 0
  if (v >= 100000000) return (v / 100000000).toFixed(1) + '亿'
  if (v >= 10000) return (v / 10000).toFixed(1) + '万'
  return String(v)
}

async function resolveTarget(input, timeoutMs) {
  let s = String(input ?? '').trim()
  if (!s) throw new Error('请给 B 站视频链接、BV 号或 av 号')
  if (/^b23\.tv\//i.test(s)) s = 'https://' + s
  const short = s.match(B23_RE)?.[0]
  if (short) {
    await throttle()
    const res = await fetch(short, { headers: headers(), redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
    s = res.url || s
  }
  const bv = s.match(BV_RE)?.[0]
  const av = s.match(AV_RE)?.[1]
  if (bv) return { kind: 'bvid', id: bv }
  if (av) return { kind: 'aid', id: String(av) }
  throw new Error('没能从输入里找到 BV 号 / av 号 / B 站视频链接')
}

async function getVideo(target, timeoutMs) {
  const q = target.kind === 'bvid' ? `bvid=${encodeURIComponent(target.id)}` : `aid=${encodeURIComponent(target.id)}`
  return await fetchJson(`https://api.bilibili.com/x/web-interface/view?${q}`, timeoutMs)
}

function normText(s) {
  return String(s ?? '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
}

function titleScore(query, title) {
  const a = normText(query), b = normText(title)
  if (!a || !b) return 0
  if (b.includes(a) || a.includes(b)) return 1
  const grams = new Set()
  for (let i = 0; i < a.length - 1; i += 2) grams.add(a.slice(i, i + 2))
  if (grams.size === 0) return 0
  let hit = 0
  for (const g of grams) if (b.includes(g)) hit += 1
  return hit / grams.size
}

async function searchBili(keyword, limit, timeoutMs) {
  const q = String(keyword ?? '').trim()
  if (!q) throw new Error('bili_search: keyword 不能为空')
  await ensureBuvid(timeoutMs)
  const html = await fetchText('https://search.bilibili.com/all?keyword=' + encodeURIComponent(q), timeoutMs)
  const seen = new Set()
  const bvs = []
  for (const m of html.matchAll(/href="([^"]*?\/video\/(BV[0-9A-Za-z]{10})[^"]*)"/g)) {
    const bv = m[2]
    if (!bv || seen.has(bv)) continue
    seen.add(bv)
    bvs.push(bv)
  }
  if (bvs.length === 0) return []
  const candidates = bvs.slice(0, Math.min(Math.max(limit + 4, 6), 12))
  const rows = []
  for (const bv of candidates) {
    try {
      const v = await getVideo({ kind: 'bvid', id: bv }, timeoutMs)
      rows.push({ bvid: bv, title: v.title, up: v.owner?.name ?? '', view: Number(v.stat?.view) || 0, score: titleScore(q, v.title) })
    } catch { /* 单个失败跳过 */ }
  }
  rows.sort((a, b) => b.score - a.score || b.view - a.view)
  return rows.slice(0, limit)
}

function pickPage(video, target) {
  const pages = Array.isArray(video.pages) ? video.pages : []
  const p = Number(target.page) || 1
  const page = pages[p - 1] || pages[0]
  return { cid: page?.cid ?? video.cid, page: page?.page ?? 1, part: page?.part ?? '' }
}

async function getDanmaku(cid, limit, mode, timeoutMs) {
  const xml = await fetchText(`https://api.bilibili.com/x/v1/dm/list.so?oid=${encodeURIComponent(cid)}`, timeoutMs)
  const items = []
  const re = /<d p="([^"]*)">([\s\S]*?)<\/d>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    const text = decodeXml(m[2]).trim()
    if (text) items.push({ text, p: m[1] })
    if (items.length >= 4000) break
  }
  const counts = new Map()
  for (const it of items) counts.set(it.text, (counts.get(it.text) || 0) + 1)
  const wanted = Math.min(Math.max(Number(limit) || 25, 1), 50)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, wanted)
  const recent = items.slice(-Math.min(10, wanted)).map(x => x.text)
  const full = mode === 'full' || (mode !== 'sample' && items.length <= 300) ? items.map(x => x.text) : undefined
  return { total: items.length, top: top.map(([text, count]) => ({ text, count })), recent, full, mode: full ? 'full' : 'sample' }
}

async function getComments(aid, limit, replyLimit, timeoutMs) {
  const data = await fetchJson(`https://api.bilibili.com/x/v2/reply?type=1&oid=${encodeURIComponent(aid)}&sort=2&ps=${Math.min(limit, 50)}&pn=1`, timeoutMs)
  const all = [...(data.top_replies || []), ...(data.replies || [])]
  const seen = new Set()
  const list = []
  for (const r of all) {
    const id = String(r.rpid ?? '')
    if (id && seen.has(id)) continue
    if (id) seen.add(id)
    const item = {
      user: r.member?.uname ?? '',
      text: r.content?.message ?? '',
      like: Number(r.like) || 0,
      replies: Number(r.rcount) || 0,
      nested: [],
    }
    if (replyLimit > 0 && Number(r.rcount) > 0) {
      try {
        const sub = await fetchJson(`https://api.bilibili.com/x/v2/reply/reply?type=1&oid=${encodeURIComponent(aid)}&root=${encodeURIComponent(id)}&ps=${Math.min(replyLimit, 10)}&pn=1`, timeoutMs)
        item.nested = (sub.replies || []).slice(0, replyLimit).map(x => ({
          user: x.member?.uname ?? '',
          text: x.content?.message ?? '',
          like: Number(x.like) || 0,
        }))
      } catch { /* 楼中楼失败不影响主楼 */ }
    }
    list.push(item)
  }
  list.sort((a, b) => b.like - a.like)
  return { total: Number(data.page?.count) || list.length, list: list.slice(0, limit) }
}

async function getSubtitles(aid, cid, lang, maxChars, timeoutMs) {
  const data = await fetchJson(`https://api.bilibili.com/x/player/v2?aid=${encodeURIComponent(aid)}&cid=${encodeURIComponent(cid)}`, timeoutMs)
  const tracks = data.subtitle?.subtitles || []
  if (!tracks.length) {
    return { available: false, reason: '没有可访问的字幕轨（可能视频没字幕，或需要登录 BILIBILI_SESSDATA）' }
  }
  const track = tracks.find(t => String(t.lan || '').toLowerCase() === String(lang || 'zh-CN').toLowerCase()) || tracks[0]
  let url = String(track.subtitle_url || '')
  if (url.startsWith('//')) url = 'https:' + url
  if (!url) return { available: false, reason: '字幕轨没有下载地址' }
  await throttle()
  const res = await fetch(url, { headers: headers({ accept: 'application/json,*/*' }), redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) return { available: false, reason: `字幕下载 HTTP ${res.status}` }
  const body = await res.json()
  const lines = (body.body || []).map(x => String(x.content ?? '').trim()).filter(Boolean)
  let text = lines.join('\n')
  let truncated = false
  if (text.length > maxChars) { text = text.slice(0, maxChars); truncated = true }
  return { available: true, language: track.lan_doc || track.lan || '', text, truncated, lines: lines.length }
}

async function getVideoShot(aid, cid, timeoutMs) {
  const data = await fetchJson(`https://api.bilibili.com/x/player/videoshot?aid=${encodeURIComponent(aid)}&cid=${encodeURIComponent(cid)}&index=1`, timeoutMs)
  const images = (data.image || []).map(u => String(u).startsWith('//') ? 'https:' + u : String(u))
  return { images, xLen: data.img_x_len, yLen: data.img_y_len, xSize: data.img_x_size, ySize: data.img_y_size }
}

function renderRead(video, page, danmaku, comments, subtitles, include) {
  const d = video
  const out = []
  out.push(`【视频】${d.title}`)
  out.push(`BV: ${d.bvid}  AV: ${d.aid}  分P: ${page.page}${page.part ? ` ${page.part}` : ''}  时长: ${fmtDuration(d.duration)}  发布: ${fmtDate(d.pubdate)}`)
  out.push(`UP: ${d.owner?.name ?? ''}  分区: ${d.tname || d.tname_v2 || ''}`)
  out.push(`播放: ${fmtCount(d.stat?.view)}  弹幕: ${fmtCount(d.stat?.danmaku)}  评论: ${fmtCount(d.stat?.reply)}  点赞: ${fmtCount(d.stat?.like)}  投币: ${fmtCount(d.stat?.coin)}  收藏: ${fmtCount(d.stat?.favorite)}  分享: ${fmtCount(d.stat?.share)}`)
  if (d.desc) out.push(`简介: ${String(d.desc).trim().slice(0, 900)}`)
  if (Array.isArray(d.pages) && d.pages.length > 1) {
    out.push(`分P: ${d.pages.slice(0, 10).map(p => `P${p.page} ${p.part || ''}`).join(' | ')}${d.pages.length > 10 ? ' ...' : ''}`)
  }
  if (include.includes('danmaku') && danmaku) {
    out.push('', `【弹幕】共 ${danmaku.total} 条（${danmaku.mode === 'full' ? '全量' : '样本'}）`)
    if (danmaku.full) {
      out.push(danmaku.full.join(' ｜ ').slice(0, 9000))
    } else {
      out.push('高频: ' + (danmaku.top.map(x => `${x.text}${x.count > 1 ? `×${x.count}` : ''}`).join(' ｜ ') || '（无）'))
      if (danmaku.recent.length) out.push('近期: ' + danmaku.recent.join(' ｜ '))
    }
  }
  if (include.includes('comments') && comments) {
    out.push('', `【热评】共 ${fmtCount(comments.total)} 条，取前 ${comments.list.length} 条（含楼中楼样本）`)
    for (const c of comments.list) {
      const t = String(c.text).replace(/\s+/g, ' ').slice(0, 220)
      out.push(`- ${c.user}（👍${fmtCount(c.like)}）: ${t}`)
      for (const n of c.nested || []) {
        out.push(`  ↳ ${n.user}（👍${fmtCount(n.like)}）: ${String(n.text).replace(/\s+/g, ' ').slice(0, 160)}`)
      }
    }
  }
  if (include.includes('subtitles') && subtitles) {
    out.push('', '【字幕】')
    if (subtitles.available) {
      out.push(`(${subtitles.language || '字幕'}，${subtitles.lines} 行${subtitles.truncated ? '，已截断' : ''})`)
      out.push(subtitles.text)
    } else {
      out.push(subtitles.reason)
    }
  }
  return out.join('\n').slice(0, 18000)
}

function finishError(finish) {
  if (finish?.kind === 'error' || finish?.kind === 'aborted') return new Error(finish.failure?.message || 'vision call failed')
  return undefined
}

export function apply(ctx, config = {}) {
  const tools = ctx.get('tools')
  if (!tools?.register) {
    ctx.logger?.warn('[dsh-qqbot-plus/bilibili] tools 服务不可用，工具未注册')
    return
  }
  const llm = ctx.get('llm')
  const attachments = ctx.get('attachments')
  const canVision = !!llm?.stream && !!attachments?.saveImage
  const cfg = {
    timeoutMs: Number(config.timeoutMs ?? 20000),
    danmakuLimit: Number(config.danmakuLimit ?? 25),
    commentLimit: Number(config.commentLimit ?? 10),
    replyLimit: Number(config.replyLimit ?? 5),
    subtitleLang: String(config.subtitleLang ?? 'zh-CN'),
    subtitleMaxChars: Number(config.subtitleMaxChars ?? 8000),
    visionProvider: String(config.visionProvider ?? 'zhipu'),
    visionModel: String(config.visionModel ?? 'aliyun/qwen3-vl-plus'),
    visionMaxTokens: Number(config.visionMaxTokens ?? 1024),
  }

  const readTool = {
    name: 'bili_read',
    description: 'Read a Bilibili video by URL, b23.tv short link, BV id or av id. Returns metadata, danmaku (full for short videos), hot comments with nested replies, and subtitles when available. Use this whenever a QQ message shares a Bilibili video, then join the discussion based on the returned content. If subtitles are unavailable and you need the visual content, call bili_frames.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bilibili video URL, b23.tv short link, BV id or av id.' },
        include: {
          type: 'array',
          items: { type: 'string', enum: ['video', 'danmaku', 'comments', 'subtitles'] },
          description: 'Sections to include. Default: video, danmaku, comments. Add subtitles when the video has a public subtitle track.',
        },
        danmaku_mode: { type: 'string', enum: ['auto', 'full', 'sample'], description: 'auto=full when <=300 danmaku, else sample; full/sample force one mode.' },
        danmaku_limit: { type: 'integer', description: 'Sample size for high-frequency danmaku (default 25, max 50).' },
        comment_limit: { type: 'integer', description: 'Top-level comments (default 10, max 30).' },
        reply_limit: { type: 'integer', description: 'Nested replies per top comment (default 5, max 10; 0=off).' },
        subtitle_lang: { type: 'string', description: 'Preferred subtitle language, default zh-CN.' },
      },
      required: ['target'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const include = Array.isArray(args.include) && args.include.length ? args.include : ['video', 'danmaku', 'comments']
      const target = await resolveTarget(args.target, cfg.timeoutMs)
      let video
      try {
        video = await getVideo(target, cfg.timeoutMs)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (/-400|-404|请求错误/.test(msg)) {
          return { text: `这个视频号无效或不存在：${args.target}\n如果它来自 QQ 卡片，请改用 bili_search 按卡片标题搜索（不要用 message id 里的 BV 片段）。` }
        }
        throw e
      }
      const page = pickPage(video, target)
      let danmaku, comments, subtitles
      if (include.includes('danmaku')) {
        danmaku = await getDanmaku(page.cid, args.danmaku_limit || cfg.danmakuLimit, args.danmaku_mode || 'auto', cfg.timeoutMs)
          .catch(e => ({ total: 0, top: [], recent: [], error: e.message }))
      }
      if (include.includes('comments')) {
        comments = await getComments(video.aid, Math.min(Number(args.comment_limit) || cfg.commentLimit, 30), Math.min(Number(args.reply_limit) ?? cfg.replyLimit, 10), cfg.timeoutMs)
          .catch(e => ({ total: 0, list: [], error: e.message }))
      }
      if (include.includes('subtitles')) {
        subtitles = await getSubtitles(video.aid, page.cid, args.subtitle_lang || cfg.subtitleLang, cfg.subtitleMaxChars, cfg.timeoutMs)
          .catch(e => ({ available: false, reason: e.message }))
      }
      return { text: renderRead(video, page, danmaku, comments, subtitles, include) }
    },
  }

  const framesTool = {
    name: 'bili_frames',
    description: 'Fetch Bilibili video snapshot sprites (a grid of frames) and ask the vision model to describe the visuals. Use this when subtitles are unavailable but you need to know what happens on screen, who appears, or what text is shown. Read-only; no video download.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bilibili video URL, b23.tv short link, BV id or av id.' },
        prompt: { type: 'string', description: 'What to look for in the frames (default: overview of scenes/people/on-screen text).' },
      },
      required: ['target'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      if (!canVision) return { text: '当前宿主没有 llm/attachments 服务，无法调用视觉模型。' }
      const target = await resolveTarget(args.target, cfg.timeoutMs)
      const video = await getVideo(target, cfg.timeoutMs)
      const page = pickPage(video, target)
      const shot = await getVideoShot(video.aid, page.cid, cfg.timeoutMs)
      if (!shot.images.length) return { text: '这个视频没有可用的缩略图拼图（videoshot 为空）。' }
      await throttle()
      const res = await fetch(shot.images[0], { headers: headers({ accept: 'image/jpeg,image/*,*/*' }), redirect: 'follow', signal: AbortSignal.timeout(cfg.timeoutMs) })
      if (!res.ok) return { text: `缩略图下载失败 HTTP ${res.status}` }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > 8 * 1024 * 1024) return { text: '缩略图拼图过大，已跳过。' }
      const ref = await attachments.saveImage({ data: new Uint8Array(buf), mediaType: 'image/jpeg', name: 'bili-videoshot.jpg' })
      const prompt = String(args.prompt || '这是 B 站视频的低分辨率缩略图拼图，按时间顺序排列（可能为 10x10 网格）。只描述你能明确看到的画面/人物/场景/大块文字；看不清的名单、比分、具体数字一律说“看不清”，不要猜。不要逐格复述。')
      const message = createUserMessage({
        content: [{ type: 'image', attachment: ref }, { type: 'text', text: prompt }],
        source: { kind: 'plugin', plugin: 'dsh-qqbot-plus' },
      })
      const assembler = new BlockAssembler()
      for await (const chunk of llm.stream({ provider: cfg.visionProvider, model: cfg.visionModel, messages: [message], maxTokens: cfg.visionMaxTokens, signal: exec.signal })) {
        assembler.push(chunk)
      }
      const err = finishError(assembler.finish)
      if (err) throw err
      const text = assembler.blocks().filter(b => b.type === 'text').map(b => b.text).join(' ').trim()
      return { text: '【注意】以下是低分辨率缩略图拼图的视觉概述，画面文字/比分/名单可能看不清，不要当作事实。\n\n' + (text || '视觉模型没有返回文字。') }
    },
  }

  const searchTool = {
    name: 'bili_search',
    description: 'Search Bilibili videos by keyword or a card title, and return matching BV ids with titles/UP/play counts. Use this when a QQ Bilibili share card has no URL/BV: pass the card title here, then call bili_read on the best match. Only returns public search results.',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Search keywords or the card title.' },
        limit: { type: 'integer', description: 'How many matches to return (default 5, max 10).' },
      },
      required: ['keyword'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10)
      const rows = await searchBili(args.keyword, limit, cfg.timeoutMs)
      if (!rows.length) return { text: `【B站搜索】${args.keyword}\n没搜到匹配视频。` }
      const lines = [`【B站搜索】${args.keyword}`]
      for (const [i, r] of rows.entries()) {
        lines.push(`${i + 1}. ${r.title} ｜ ${r.bvid} ｜ UP ${r.up} ｜ 播放 ${fmtCount(r.view)} ｜ 匹配 ${(r.score * 100).toFixed(0)}%`)
      }
      if (rows[0].score < 0.6) lines.push('', '匹配度偏低：建议用卡片标题里更完整的片段（保留“第几集/节目名/关键词”）再搜一次。')
      return { text: lines.join('\n') }
    },
  }

  const hotTool = {
    name: 'bili_hot',
    description: 'Read the current Bilibili trending/ranking list (rid=0, all). Useful when the user wants you to browse Bilibili for something worth sharing. Returns title, BV, UP and stats.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'How many videos (default 10, max 20).' } },
      required: [],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 20)
      const data = await fetchJson('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all', cfg.timeoutMs)
      const list = (data.list || []).slice(0, limit)
      const lines = [`【B站热门榜】取前 ${list.length} 条`]
      for (const v of list) {
        lines.push(`- ${v.title} ｜ ${v.bvid} ｜ UP ${v.owner?.name ?? ''} ｜ 播放 ${fmtCount(v.stat?.view)} ｜ 弹幕 ${fmtCount(v.stat?.danmaku)} ｜ ${fmtDuration(v.duration)}`)
      }
      return { text: lines.join('\n') }
    },
  }

  tools.register(readTool)
  if (canVision) tools.register(framesTool)
  tools.register(searchTool)
  tools.register(hotTool)
  console.log(`[dsh-qqbot-plus/bilibili] bili_read / bili_search / bili_hot${canVision ? ' / bili_frames' : ''} 已注册`)
  ctx.logger?.info('[dsh-qqbot-plus/bilibili] bili_read / bili_hot 已注册')
}

export { resolveTarget, getVideo, getDanmaku, getComments, getSubtitles, getVideoShot, searchBili, fetchJson }
