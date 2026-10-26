# Optional QQ bot extensions

These files are **not loaded by the npm package automatically**. Copy them into
the QQ bot's data root:

```text
{dataRoot}/.qqbot-extensions/inbound/bili-card-url.mjs
{dataRoot}/.qqbot-extensions/outbound/abs-image-paths.mjs
```

`dataRoot` is the QQ bot's data directory (usually `<im-qqbot.cwd>/dshqqbot`).

- `bili-card-url.mjs`: reads a Bilibili URL out of a QQ mini-program card's raw
  payload. It only accepts `bilibili.com` / `b23.tv` URLs, never bare `BV...`
  substrings, because QQ message IDs can contain false BVs.
- `abs-image-paths.mjs`: rewrites relative markdown image paths to absolute
  paths so the QQ uploader can find them. It resolves against `process.cwd()`;
  set `QQBOT_CWD` when the host cwd differs from `im-qqbot.cwd`.
- `random-sticker.mjs`: after a group reply, picks a sticker from the formal
  `lib/library` with a configurable probability (`QQBOT_STICKER_PROB`, default
  0.15) and per-peer cooldown (`QQBOT_STICKER_COOLDOWN_MIN`, default 10).

Reload extensions with `/tools-reload` (or restart the bot).
