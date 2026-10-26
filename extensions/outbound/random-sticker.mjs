/**
 * random-sticker.mjs — 回复发完后，按概率自动补一张表情包。
 *
 * 用 fork 的出站 turnEnd 阶段：正文已经发完，补图走先被动后主动通道，
 * 不阻塞正文。只从 {dataRoot}/lib/library 里选「正式库」的图。
 *
 * 环境变量：
 *   QQBOT_STICKER_PROB=0.15          每次回复补图概率
 *   QQBOT_STICKER_COOLDOWN_MIN=10    同一会话最短间隔（分钟）
 */
import { readdir, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'

export const name = 'random-sticker'

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])
const PROB = Math.max(0, Math.min(1, Number(process.env.QQBOT_STICKER_PROB ?? 0.15)))
const COOLDOWN_MS = Math.max(0, Number(process.env.QQBOT_STICKER_COOLDOWN_MIN ?? 10)) * 60_000
const RECENT_KEEP = 8

/** peerId -> last sent ms */
const lastSentAt = new Map()
/** 最近发过的文件，避免连续重复 */
const recent = []

async function listLibrary(dataRoot) {
  const candidates = [
    join(String(dataRoot || ''), 'lib', 'library'),
    join(String(dataRoot || ''), '表情包', 'lib', 'library'),
    join(process.cwd(), '表情包', 'lib', 'library'),
  ]
  for (const dir of candidates) {
    if (!dir || dir.includes('undefined')) continue
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    const out = []
    for (const e of entries) {
      if (!e.isFile()) continue
      const ext = extname(e.name).toLowerCase()
      if (!IMAGE_EXT.has(ext)) continue
      const path = join(dir, e.name)
      try {
        const info = await stat(path)
        if (info.isFile() && info.size > 0 && info.size <= 10 * 1024 * 1024) out.push(path)
      } catch { /* skip */ }
    }
    if (out.length > 0) return out
  }
  return []
}

function pick(files) {
  if (files.length === 0) return null
  const fresh = files.filter((p) => !recent.includes(p))
  const pool = fresh.length > 0 ? fresh : files
  return pool[Math.floor(Math.random() * pool.length)] ?? null
}

export async function onOutbound(ctx, next) {
  try {
    if (ctx.phase !== 'turnEnd' || !ctx.isLastChunk) return next()
    if (ctx.kind === 'media' || ctx.kind === 'card' || ctx.kind === 'forward') return next()
    const scope = String(ctx.target?.scope ?? '')
    if (scope && scope !== 'group') return next()
    const text = String(ctx.text ?? '').trim()
    if (!text || text.length < 2) return next()
    if (/\[MEDIA:|!\[|qqbot-media:|\[表情/.test(text)) return next()

    const peer = String(ctx.target?.peerId ?? '')
    const now = Date.now()
    const last = lastSentAt.get(peer) ?? 0
    if (last && now - last < COOLDOWN_MS) return next()
    if (Math.random() >= PROB) return next()

    const files = await listLibrary(ctx.dataRoot)
    const path = pick(files)
    if (!path) return next()
    lastSentAt.set(peer, now)
    recent.push(path)
    while (recent.length > RECENT_KEEP) recent.shift()

    ctx.background(async () => {
      try {
        const ok = await ctx.sendMedia({ path })
        if (!ok) ctx.note?.('random-sticker: sendMedia returned false')
      } catch (e) {
        ctx.logger?.warn?.(`[random-sticker] send failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    })
  } catch { /* 出站扩展永远不能影响正文 */ }
  return next()
}
