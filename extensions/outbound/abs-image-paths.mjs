/**
 * 出站扩展：把 markdown 图片里的“相对路径”改成绝对路径。
 * 背景：QQ 插件只上传绝对路径（/...、file://...、C:/...）的本地图；
 * 模型经常写 ![alt](downloads/xx.jpg)，会被当成普通文本，QQ 只显示 [alt]。
 *
 * 只改本地相对路径，http(s)/qqbot-media/data/file/绝对路径原样放过。
 */
import path from 'node:path'

export const name = 'abs-image-paths'

// Resolve relative image paths against the bot's current working directory.
// Prefer ctx.cwd when the host exposes it; QQBOT_CWD is the explicit override.

export async function onOutbound(ctx, next) {
  const CWD = process.env.QQBOT_CWD || (typeof ctx?.cwd === 'string' ? ctx.cwd : process.cwd())
  const text = String(ctx?.text ?? '')
  if (!text.includes('![')) return next()

  const out = text.replace(
    /!\[([^\]]*)\]\(\s*<?((?!https?:|qqbot-media:|data:|file:|\/|[A-Za-z]:[\\/])[^)\n]+?)>?\s*\)/g,
    (whole, alt, src) => {
      const clean = String(src).trim()
      if (!clean) return whole
      return `![${alt}](${path.resolve(CWD, clean)})`
    },
  )

  if (out !== text) ctx.rewrite(out)
  return next()
}
