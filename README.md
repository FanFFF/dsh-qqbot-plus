# @yangfan1998/dsh-qqbot-plus

**One-install QQ bot bundle for DeepSeek Harness.**

`@yangfan1998/dsh-qqbot-plus` mounts the [`@zaofan/dsh-qqbot`](https://www.npmjs.com/package/@zaofan/dsh-qqbot) gateway together with three optional tools:

- `qqbot_describe_image` — image understanding / OCR via an image-capable model
- `tts_speak` — Edge TTS voice messages (mp3)
- `bili_read` / `bili_search` / `bili_hot` / `bili_frames` — Bilibili video, danmaku, comments and thumbnail understanding

It is a **bundle**, not a fork of the QQ gateway. The gateway remains `@zaofan/dsh-qqbot` and can be upgraded independently.

> Status: `0.1.0` · not yet published to npm. Build a local tarball with `npm pack`.

---

## Requirements

| Item | Requirement |
|---|---|
| Node.js | `>= 22.13` |
| DeepSeek Harness | `>= 0.2.1-alpha.2` |
| QQ bot | AppID + AppSecret from QQ Open Platform |
| LLM route | An image-capable model for `qqbot_describe_image` (default `zhipu/aliyun/qwen3-vl-plus`) |
| TTS (optional) | `edge-tts` executable on `PATH`, or set `tts.bin` |
| Bilibili (optional) | No key required for public data; `BILIBILI_SESSDATA` unlocks subtitles |

---

## Install

### Local tarball (works today, no npm account needed)

```bash
cd /path/to/dsh-qqbot-plus
npm pack
# produces yangfan1998-dsh-qqbot-plus-0.1.0.tgz

dsh plugin --profile <your-profile> add ./yangfan1998-dsh-qqbot-plus-0.1.0.tgz
```

If pnpm reports `ERR_PNPM_IGNORED_BUILDS` (the QQ gateway pulls `onnxruntime-node` / `protobufjs`):

```bash
cd ~/.dsh/profiles/<your-profile>
pnpm approve-builds --all
```

Then add the bundle to the profile's `package.json` (the plugin manager does not
auto-append bundle packages in all DSH versions):

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@yangfan1998/dsh-qqbot-plus"
      ]
    }
  }
}
```

Verify the composed tree before booting:

```bash
dsh --profile <your-profile> --dump-config | grep -A3 'id: im-qqbot'
dsh --profile <your-profile> --dump-config | grep -A3 'id: qqbot-plus'
```

### npm (after publishing)

```bash
dsh plugin --profile <your-profile> add @yangfan1998/dsh-qqbot-plus
```

> Use a **fresh profile**. The bundle patch inserts an `im-qqbot` row; if you already installed `@zaofan/dsh-qqbot` in that profile, you will get a duplicate `im-qqbot` and the patch will not activate.
>
> For an existing gateway, **do not add this package to `dsh.profile.bundles`**. Install the package, then copy the `- insert:` block from [`cordis.tools-only.yml`](./cordis.tools-only.yml) into the profile's own `cordis.patch.yml`.

---

## Configure credentials

The bundle patch uses `__FROM_ENV__` for `appId` / `appSecret`. Either:

### Option A — environment variables

```bash
export QQBOT_APPID=1905977275
export QQBOT_APP_SECRET=your-secret
```

### Option B — literal values in the profile patch

Edit the `im-qqbot` row in your profile's `cordis.patch.yml`:

```yaml
- id: im-qqbot
  name: '@zaofan/dsh-qqbot'
  config:
    appId: '1905977275'
    appSecret: 'your-secret'
```

Never commit real secrets. The QQ bot must also have the group-message permission enabled by the group owner if you want non-@ group messages.

---

## Tool configuration

The bundle's `cordis.patch.yml` ships safe defaults. Override them in the `qqbot-plus` row:

```yaml
- id: qqbot-plus
  name: @yangfan1998/dsh-qqbot-plus
  config:
    vision:
      provider: zhipu
      model: aliyun/qwen3-vl-plus
      maxTokens: 1024
    tts:
      bin: edge-tts
      voice: zh-CN-XiaoyiNeural
      rate: '+5%'
      pitch: '+12Hz'
      maxChars: 500
    bilibili:
      timeoutMs: 20000
      danmakuLimit: 25
      commentLimit: 10
      replyLimit: 5
```

### Vision

Any route whose model accepts `image` input works. The model must be available in your `llm-pi-ai` (or other LLM plugin) provider config. If the model is missing, `qqbot_describe_image` disables itself and the rest of the bundle keeps running.

### TTS

`tts_speak` shells out to `edge-tts` and writes an mp3 under `downloads/tts` by default.

```bash
python3 -m pip install edge-tts
# or point at an existing venv:
# tts.bin: /path/to/venv/bin/edge-tts
```

If `edge-tts` is unavailable, the tool returns a clear error; it does not crash the plugin.

### Bilibili

Public video metadata, danmaku and comments work without a cookie. Subtitles often require login:

```bash
export BILIBILI_SESSDATA=your-sessdata
```

Bilibili can rate-limit anonymous requests; the tool throttles requests and caches the anonymous `buvid3` cookie.

---

## Tools

| Tool | Purpose |
|---|---|
| `qqbot_describe_image` | Inspect one local image or URL; OCR, tables, screenshots, photos |
| `tts_speak` | Generate a short mp3 with Edge TTS; send it with `send_media(kind="voice")` |
| `bili_read` | Metadata, danmaku, hot comments (nested), optional subtitles |
| `bili_search` | Search Bilibili by title/keyword; returns BV ids with match scores |
| `bili_hot` | Bilibili trending list |
| `bili_frames` | Thumbnail sprite sheet → vision model summary; low-resolution, do not treat as factual |

---

## Optional extensions

The package ships two `{dataRoot}/.qqbot-extensions` extensions:

- `extensions/inbound/bili-card-url.mjs` — extracts a Bilibili URL from a QQ mini-program card's raw payload. It intentionally only accepts URLs, never bare `BV...` substrings (QQ message ids can contain false BVs).
- `extensions/outbound/abs-image-paths.mjs` — rewrites relative markdown image paths to absolute paths before QQ upload.

Copy them into the QQ bot's data root:

```bash
DATA_ROOT="/path/to/qqbot/data-root"   # usually <im-qqbot.cwd>/dshqqbot
PKG_DIR="$(node -e "console.log(require.resolve('@yangfan1998/dsh-qqbot-plus'))" | xargs dirname)"

mkdir -p "$DATA_ROOT/.qqbot-extensions/inbound" "$DATA_ROOT/.qqbot-extensions/outbound"
cp "$PKG_DIR/extensions/inbound/bili-card-url.mjs" "$DATA_ROOT/.qqbot-extensions/inbound/"
cp "$PKG_DIR/extensions/outbound/abs-image-paths.mjs" "$DATA_ROOT/.qqbot-extensions/outbound/"
```

`abs-image-paths` resolves relative paths against `process.cwd()`; set `QQBOT_CWD` if your host cwd differs from `im-qqbot.cwd`.

---

## What is NOT included

- No QQ AppID / AppSecret / API keys / cookies
- No persona or group prompt (bring your own)
- No sticker/meme image packs (third-party art licensing)
- No web settings page; configure via `cordis.patch.yml` or env
- No `launchd` / systemd unit; deployment is up to you

---

## Security notes

- The Bilibili tool makes outbound HTTPS requests to `bilibili.com`, `b23.tv` and `api.bilibili.com`.
- The vision tool downloads only `http(s)` images you pass it; it does not scan arbitrary files.
- `tts_speak` executes the configured `edge-tts` binary with text as an argument. Do not point `tts.bin` at an untrusted script.
- This package does not bundle credentials. Run it with a dedicated QQ bot account.

---

## Publishing checklist

- [ ] `npm pack` and install the tarball into a fresh test profile
- [ ] verify `im-qqbot` + `qqbot-plus` both activate
- [ ] verify `qqbot_describe_image` with a real image
- [ ] verify `tts_speak` with `edge-tts`
- [ ] verify `bili_read` with a public BV
- [ ] replace the placeholder version/author/repository in `package.json`
- [ ] `npm publish` (needs an npm account)
- [ ] push to your own GitHub repository (do not reuse another account's credentials)
- [ ] add the `dsh-plugin` topic and submit to the DSH plugin market

---

## License

MIT. See [LICENSE](./LICENSE).
