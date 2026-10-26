/**
 * dsh-qqbot-plus/vision — 独立识图工具
 *
 * 主模型可以保持 deepseek（纯文本）；遇到图片时调用本工具，
 * 工具内部用 qwen3-vl-plus 看图并把结果作为文本返回。
 */
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'dsh-qqbot-plus:vision'
export const inject = ['tools', 'llm', 'attachments']

const TOOL_NAME = 'qqbot_describe_image'

function sniffImageMediaType(bytes) {
  if (bytes.length < 12) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return null
}

async function loadImageBytes(image, maxBytes, signal) {
  let data
  if (/^https?:\/\//i.test(image)) {
    const resp = await fetch(image, { signal, redirect: 'error' })
    if (!resp.ok) throw new Error(`${TOOL_NAME}: download failed (HTTP ${resp.status})`)
    const buf = Buffer.from(await resp.arrayBuffer())
    if (buf.length > maxBytes) throw new Error(`${TOOL_NAME}: image too large (${buf.length} bytes)`)
    data = new Uint8Array(buf)
  } else {
    const info = await stat(image).catch(() => null)
    if (!info?.isFile()) throw new Error(`${TOOL_NAME}: image file not found: ${image}`)
    if (info.size > maxBytes) throw new Error(`${TOOL_NAME}: image too large (${info.size} bytes)`)
    data = new Uint8Array(await readFile(image))
  }
  const mediaType = sniffImageMediaType(data)
  if (mediaType === null) throw new Error(`${TOOL_NAME}: unrecognized image format (png/jpeg/gif/webp only)`)
  return { data, mediaType }
}

function finishError(finish) {
  switch (finish.kind) {
    case 'error':
    case 'aborted':
      return new Error(finish.failure.message)
    default:
      return undefined
  }
}

async function callVision(llm, vision, prompt, imageRef, signal) {
  const message = createUserMessage({
    content: [
      { type: 'image', attachment: imageRef },
      { type: 'text', text: prompt },
    ],
    source: { kind: 'plugin', plugin: 'dsh-qqbot-plus' },
  })
  const assembler = new BlockAssembler()
  for await (const chunk of llm.stream({
    provider: vision.provider,
    model: vision.model,
    messages: [message],
    maxTokens: vision.maxTokens,
    signal,
  })) {
    assembler.push(chunk)
  }
  const terminalError = finishError(assembler.finish)
  if (terminalError !== undefined) throw terminalError
  const text = assembler.blocks()
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join(' ')
    .trim()
  if (text.length === 0) throw new Error(`${TOOL_NAME}: vision model returned no text`)
  return text
}

export function apply(ctx, config = {}) {
  const vision = {
    provider: String(config.provider ?? 'zhipu'),
    model: String(config.model ?? 'aliyun/qwen3-vl-plus'),
    maxBytes: Number(config.maxBytes ?? 10 * 1024 * 1024),
    maxTokens: Number(config.maxTokens ?? 1024),
    defaultPrompt: String(config.defaultPrompt ?? '描述这张图片的内容；如果有文字，逐字转录；如果是截图，说明界面和关键信息。'),
    timeoutMs: Number(config.timeoutMs ?? 120000),
  }
  const tools = ctx.get('tools')
  const llm = ctx.get('llm')
  const attachments = ctx.get('attachments')
  if (!tools?.register || !llm?.stream || !attachments?.saveImage) {
    ctx.logger?.warn(`[dsh-qqbot-plus/vision] tools/llm/attachments 不可用，工具未注册`)
    return
  }

  const definition = {
    name: TOOL_NAME,
    description: 'Inspect one image and return the text the user needs. The image is a local absolute path '
      + '(downloaded by the QQ bot) or an http(s) URL. Use this when the user references an image, '
      + 'or when a task needs OCR, chart/diagram reading, screenshot or UI analysis, translation of '
      + 'image text, or photo understanding. Always pass an explicit `prompt` with a precise '
      + 'instruction (e.g. "transcribe all text", "extract the table as CSV", "translate the text '
      + 'into Chinese") instead of relying on the generic default.',
    parameters: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          description: 'Absolute path to a local image file, or an http(s) URL of the image.',
        },
        prompt: {
          type: 'string',
          description: 'Your precise instruction for the vision model about this image.',
        },
      },
      required: ['image'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          model: { type: 'string' },
          image: { type: 'string' },
          mimeType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] },
          bytes: { type: 'integer' },
        },
        required: ['text', 'model', 'image', 'mimeType', 'bytes'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const { image, prompt } = args
      if (typeof image !== 'string' || image.length === 0) {
        throw new Error(`${TOOL_NAME}: \`image\` must be a non-empty string`)
      }
      const loaded = await loadImageBytes(image, vision.maxBytes, exec.signal)
      const ref = await attachments.saveImage({
        data: loaded.data,
        mediaType: loaded.mediaType,
        name: /^https?:\/\//i.test(image) ? undefined : basename(image),
      })
      const text = await callVision(llm, vision, prompt ?? vision.defaultPrompt, ref, exec.signal)
      return { text, model: vision.model, image, mimeType: loaded.mediaType, bytes: loaded.data.length }
    },
  }

  tools.register(definition)
  console.log(`[dsh-qqbot-plus/vision] ${TOOL_NAME} 已注册 (${vision.provider}/${vision.model})`)
  ctx.logger?.info(`[dsh-qqbot-plus/vision] ${TOOL_NAME} 已注册 (${vision.provider}/${vision.model})`)
}
