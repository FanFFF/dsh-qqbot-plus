/**
 * dsh-qqbot-plus — one-install bundle for the QQ bot.
 *
 * Mounts three optional tools on the host:
 *   - qqbot_describe_image  (vision, needs an image-capable model)
 *   - tts_speak             (Edge TTS, needs the `edge-tts` executable)
 *   - bili_read / bili_search / bili_hot / bili_frames
 *
 * The QQ gateway itself is provided by @zaofan/dsh-qqbot and is mounted by
 * cordis.patch.yml. Each tool fails soft: a missing model/executable only
 * disables that tool, it never takes down the gateway.
 */
import { apply as applyVision } from './tools/vision.js'
import { apply as applyTts } from './tools/tts.js'
import { apply as applyBilibili } from './tools/bilibili.js'

export const name = 'dsh-qqbot-plus'
export const inject = ['tools']

export function apply(ctx, config = {}) {
  const cfg = config && typeof config === 'object' ? config : {}
  const tools = [
    ['vision', applyVision, cfg.vision],
    ['tts', applyTts, cfg.tts],
    ['bilibili', applyBilibili, cfg.bilibili],
  ]
  for (const [key, fn, sub] of tools) {
    try {
      fn(ctx, sub && typeof sub === 'object' ? sub : {})
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-qqbot-plus] ${key} tool failed to mount: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
