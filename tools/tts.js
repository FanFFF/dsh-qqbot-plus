/**
 * dsh-qqbot-plus/tts — 用 edge-tts（微软神经语音）生成语音文件。
 * 只负责生成 mp3 并返回绝对路径；发送由 fork 的 send_media(kind=voice) 完成。
 */
import { execFile } from 'node:child_process'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const name = 'dsh-qqbot-plus:tts'
export const inject = ['tools']

const TOOL_NAME = 'tts_speak'

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`tts_speak: ${error.message}${stderr ? ` | ${String(stderr).slice(0, 300)}` : ''}`))
        return
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

export function apply(ctx, config = {}) {
  const tools = ctx.get('tools')
  if (!tools?.register) {
    ctx.logger?.warn('[dsh-qqbot-plus/tts] tools 服务不可用，工具未注册')
    return
  }
  const cfg = {
    edgeTts: String(config.edgeTts ?? process.env.EDGE_TTS_BIN ?? 'edge-tts'),
    outDir: String(config.outDir ?? join(process.cwd(), 'downloads', 'tts')),
    voice: String(config.voice ?? 'zh-CN-XiaoyiNeural'),
    rate: String(config.rate ?? '+5%'),
    pitch: String(config.pitch ?? '+12Hz'),
    maxChars: Number(config.maxChars ?? 500),
    timeoutMs: Number(config.timeoutMs ?? 60000),
  }

  const definition = {
    name: TOOL_NAME,
    description: 'Synthesize a short Chinese voice message with Microsoft Edge neural TTS and return the absolute mp3 path. '
      + 'Use this whenever the user asks for a voice message / 语音 / 声音. Then send it with '
      + 'send_media({ kind: "voice", source: <returned path> }). Do NOT use macOS `say` — it sounds robotic.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to speak. Keep it short (1-3 sentences).' },
        voice: { type: 'string', description: 'Optional edge-tts voice id. Default zh-CN-XiaoyiNeural (lively/sweet).' },
        rate: { type: 'string', description: 'Optional rate, e.g. "+5%". Default from config.' },
        pitch: { type: 'string', description: 'Optional pitch, e.g. "+12Hz". Default from config.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          voice: { type: 'string' },
          bytes: { type: 'integer' },
        },
        required: ['path', 'voice', 'bytes'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: `语音文件已生成: ${value.path}` }],
    },
    async execute(args, exec) {
      const text = String(args.text ?? '').trim()
      if (!text) throw new Error('tts_speak: `text` must be non-empty')
      if ([...text].length > cfg.maxChars) {
        throw new Error(`tts_speak: text too long (${[...text].length} > ${cfg.maxChars})`)
      }
      const voice = String(args.voice ?? cfg.voice)
      const rate = String(args.rate ?? cfg.rate)
      const pitch = String(args.pitch ?? cfg.pitch)
      await mkdir(cfg.outDir, { recursive: true })
      const out = join(cfg.outDir, `tts-${Date.now()}-${randomUUID().slice(0, 8)}.mp3`)
      await run(cfg.edgeTts, [
        '--voice', voice,
        `--rate=${rate}`,
        `--pitch=${pitch}`,
        '--text', text,
        '--write-media', out,
      ], cfg.timeoutMs)
      const info = await stat(out)
      if (!info.isFile() || info.size === 0) throw new Error('tts_speak: edge-tts produced no file')
      return { path: out, voice, bytes: info.size }
    },
  }

  tools.register(definition)
  console.log(`[dsh-qqbot-plus/tts] ${TOOL_NAME} 已注册 (edge-tts, default ${cfg.voice})`)
  ctx.logger?.info(`[dsh-qqbot-plus/tts] ${TOOL_NAME} 已注册 (default ${cfg.voice})`)
}
