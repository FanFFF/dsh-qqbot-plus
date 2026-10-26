/**
 * bili-card-url.mjs — 从 QQ 的 B 站分享卡片 raw 事件里挖出视频链接。
 *
 * ⚠️ 只认 B 站 URL，不再从任意字符串里抠 BV：
 *   QQ 的 message id（ROBOT1.0_...）里可能正好包含 "BVxxxxxxxxxx" 子串，
 *   之前会把 message id 里的假 BV 当成视频号（实测 BVHglOfewpT0 → -400）。
 *   卡片没有 URL 时交给 bili_search 按标题搜。
 */
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'bili-card-url'

const BILI_URL_RE = /https?:\/\/[^\s"'<>\\]*(?:bilibili\.com|b23\.tv)[^\s"'<>\\]*/i

function collect(value, out, depth = 0) {
  if (depth > 8 || value == null) return
  if (typeof value === 'string') {
    const url = value.match(BILI_URL_RE)?.[0]
    if (url) out.urls.add(url)
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collect(v, out, depth + 1)
    return
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) {
      if (typeof v === 'object' || typeof v === 'string') collect(v, out, depth + 1)
    }
  }
}

function diag(ctx, payload) {
  try {
    const root = String(ctx.dataRoot || '')
    if (!root) return
    appendFileSync(join(root, 'bili-card-diag.log'), new Date().toISOString() + ' ' + JSON.stringify(payload) + '\n')
  } catch { /* ignore */ }
}

export async function onInbound(ctx, next) {
  try {
    const text = String(ctx.text || '')
    const isCard = /卡片消息|哔哩哔哩/i.test(text)
    const already = BILI_URL_RE.test(text)
    if (isCard || /哔哩哔哩|bilibili|b23\.tv|BV[0-9A-Za-z]{10}/i.test(text)) {
      const out = { urls: new Set() }
      collect(ctx.message?.raw, out)
      collect(ctx.message?.msgElements, out)
      collect(ctx.message?.arkData, out)
      if (out.urls.size) {
        diag(ctx, { found: [...out.urls], hadLink: already })
        if (!already) {
          const link = [...out.urls][0]
          ctx.rewrite({ text: `${text}\n[系统提取] B站视频链接: ${link}`, reason: 'bili-card-url' })
        }
      } else if (isCard) {
        const raw = ctx.message?.raw
        const keys = raw && typeof raw === 'object' ? Object.keys(raw) : []
        diag(ctx, { found: [], hadLink: already, rawKeys: keys.slice(0, 40) })
      }
    }
  } catch { /* 绝不影响入站 */ }
  return next()
}
