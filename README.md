# @yangfan1998/dsh-qqbot-plus

**DeepSeek Harness 的 QQ 机器人整合包：装一次，带网关、识图、语音和 B 站工具。**

`@yangfan1998/dsh-qqbot-plus` 会挂载 [`@zaofan/dsh-qqbot`](https://www.npmjs.com/package/@zaofan/dsh-qqbot) 网关，并额外提供：

- `qqbot_describe_image` — 图片理解 / OCR
- `tts_speak` — Edge TTS 语音（mp3）
- `bili_read` / `bili_search` / `bili_hot` / `bili_frames` — B 站视频、弹幕、评论、缩略图理解

它是 **bundle**，不是 QQ 网关的 fork。网关仍然是 `@zaofan/dsh-qqbot`，可以独立升级。

> 当前版本：`0.1.0`。已发布到 npm；本地也可以 `npm pack` 后安装。

---

## 环境要求

| 项目 | 要求 |
|---|---|
| Node.js | `>= 22.13` |
| DeepSeek Harness | `>= 0.2.1-alpha.2` |
| QQ 机器人 | QQ 开放平台的 AppID + AppSecret |
| 识图模型 | 支持图片输入的 LLM 路由（默认 `zhipu/aliyun/qwen3-vl-plus`） |
| TTS（可选） | `edge-tts` 可执行文件在 `PATH`，或配置 `tts.bin` |
| B 站（可选） | 公开数据不需要 Key；`BILIBILI_SESSDATA` 可解锁字幕 |

---

## 安装

### 方式一：从 npm 安装（推荐）

```bash
dsh plugin --profile <你的profile> add @yangfan1998/dsh-qqbot-plus
```

如果 pnpm 报 `ERR_PNPM_IGNORED_BUILDS`（QQ 网关依赖的 `onnxruntime-node` / `protobufjs`）：

```bash
cd ~/.dsh/profiles/<你的profile>
pnpm approve-builds --all
```

然后把这个 bundle 加进 profile 的 `package.json`（部分 DSH 版本的插件管理器不会自动追加）：

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

启动前先确认组合树：

```bash
dsh --profile <你的profile> --dump-config | grep -A3 'id: im-qqbot'
dsh --profile <你的profile> --dump-config | grep -A3 'id: qqbot-plus'
```

### 方式二：从本地 tarball 安装

```bash
cd /path/to/dsh-qqbot-plus
npm pack
# 生成 yangfan1998-dsh-qqbot-plus-0.1.0.tgz

dsh plugin --profile <你的profile> add ./yangfan1998-dsh-qqbot-plus-0.1.0.tgz
```

### 方式三：已经有 QQ 网关的 profile

这个包默认会插入 `im-qqbot`。如果你已经装了 `@zaofan/dsh-qqbot`，**不要**把本包加入 `dsh.profile.bundles`，否则会出现重复的 `im-qqbot`。

改为：安装本包后，把 [`cordis.tools-only.yml`](./cordis.tools-only.yml) 里的 `- insert:` 段复制到你 profile 自己的 `cordis.patch.yml`。

---

## 配置凭据

bundle 的 `cordis.patch.yml` 使用 `__FROM_ENV__` 读取 `appId` / `appSecret`。

### 方式 A：环境变量

```bash
export QQBOT_APPID=1905977275
export QQBOT_APP_SECRET=你的secret
```

### 方式 B：直接写 profile patch

编辑 profile 的 `cordis.patch.yml` 里的 `im-qqbot` 行：

```yaml
- id: im-qqbot
  name: '@zaofan/dsh-qqbot'
  config:
    appId: '1905977275'
    appSecret: '你的secret'
```

不要把真实密钥提交到 Git。

如果想让机器人接收非 @ 的群消息，群主还需要在 QQ 机器人资料页开启“接收群消息/通知”。

---

## 工具配置

bundle 自带安全默认值。覆盖时改 `qqbot-plus` 行：

```yaml
- id: qqbot-plus
  name: '@yangfan1998/dsh-qqbot-plus'
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

### 识图

只要你的 LLM 路由里有支持 `image` 输入的模型即可。模型必须在 `llm-pi-ai`（或其他 LLM 插件）的 provider 配置里存在。

模型不可用时，`qqbot_describe_image` 会自动禁用；不会拖垮整个插件。

### 语音

`tts_speak` 调用外部 `edge-tts`，默认把 mp3 写到 `downloads/tts`。

```bash
python3 -m pip install edge-tts
# 或者指向已有 venv：
# tts.bin: /path/to/venv/bin/edge-tts
```

`edge-tts` 不可用时，工具会返回明确错误，不会让插件崩溃。

### B 站

公开视频的元数据、弹幕、评论不需要 Cookie；字幕通常需要登录：

```bash
export BILIBILI_SESSDATA=你的SESSDATA
```

B 站会限流匿名请求；工具内部做了节流，并缓存匿名 `buvid3` Cookie。

---

## 工具列表

| 工具 | 用途 |
|---|---|
| `qqbot_describe_image` | 看一张本地图片或 URL；OCR、表格、截图、照片 |
| `tts_speak` | 用 Edge TTS 生成短语音 mp3；再用 `send_media(kind="voice")` 发出 |
| `bili_read` | 视频元数据、弹幕、热评（含楼中楼）、可选字幕 |
| `bili_search` | 按标题/关键词搜 B 站，返回 BV 和匹配度 |
| `bili_hot` | B 站热门榜 |
| `bili_frames` | 视频缩略图拼图 → 视觉模型概述；分辨率低，不要当事实 |

---

## 可选扩展

包内带了两个 `{dataRoot}/.qqbot-extensions` 扩展：

- `extensions/inbound/bili-card-url.mjs` — 从 QQ 小程序卡片的 raw 数据里提取 B 站 URL。只接受 URL，不接受裸 `BV...`，因为 QQ message id 里可能刚好包含假 BV。
- `extensions/outbound/abs-image-paths.mjs` — 发图前把 markdown 里的相对图片路径改成绝对路径。

复制到 QQ 机器人的数据根：

```bash
DATA_ROOT="/path/to/qqbot/data-root"   # 通常是 <im-qqbot.cwd>/dshqqbot
PKG_DIR="$(node -e "console.log(require.resolve('@yangfan1998/dsh-qqbot-plus'))" | xargs dirname)"

mkdir -p "$DATA_ROOT/.qqbot-extensions/inbound" "$DATA_ROOT/.qqbot-extensions/outbound"
cp "$PKG_DIR/extensions/inbound/bili-card-url.mjs" "$DATA_ROOT/.qqbot-extensions/inbound/"
cp "$PKG_DIR/extensions/outbound/abs-image-paths.mjs" "$DATA_ROOT/.qqbot-extensions/outbound/"
```

`abs-image-paths` 默认用 `process.cwd()` 解析相对路径；如果宿主 cwd 和 `im-qqbot.cwd` 不一致，设置 `QQBOT_CWD`。

---

## 不包含什么

- 不包含 QQ AppID / AppSecret / API Key / Cookie
- 不包含人设或群守则（自带你的）
- 不包含表情包图库（第三方素材授权问题）
- 不包含 Web 设置页；通过 `cordis.patch.yml` 或环境变量配置
- 不包含 `launchd` / systemd 服务文件；部署方式由你决定

---

## 安全说明

- B 站工具会访问 `bilibili.com`、`b23.tv` 和 `api.bilibili.com`。
- 识图工具只下载你传入的 `http(s)` 图片，不扫描任意文件。
- `tts_speak` 会用配置的 `edge-tts` 可执行文件执行文本参数；不要把 `tts.bin` 指向不可信脚本。
- 本包不内置任何凭据。建议用专门的 QQ 机器人账号运行。

---

## 发布检查

- [ ] `npm pack` 后在全新测试 profile 安装
- [ ] 确认 `im-qqbot` + `qqbot-plus` 都激活
- [ ] 用真实图片验证 `qqbot_describe_image`
- [ ] 用 `edge-tts` 验证 `tts_speak`
- [ ] 用公开 BV 验证 `bili_read`
- [ ] 更新 `package.json` 里的版本/作者/仓库
- [ ] `npm publish`（需要 npm 账号和 2FA）
- [ ] 推到自己的 GitHub 仓库（不要复用别人的凭据）
- [ ] 加 `dsh-plugin` topic，提交到 DSH 插件市场

---

## 许可证

MIT，见 [LICENSE](./LICENSE)。
