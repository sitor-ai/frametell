<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/readme/banner-zh-dark.png">
    <img alt="帧言 Frametell：帧帧有言，把想法和资料讲成片" src="docs/brand/readme/banner-zh-light.png" width="100%">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/sitor-ai/frametell/releases/latest"><img src="https://img.shields.io/badge/%E4%B8%8B%E8%BD%BD-macOS%20(Apple%20%E8%8A%AF%E7%89%87)-1C1917?logo=apple&logoColor=white" alt="下载帧言 macOS 版（Apple 芯片）"></a>
</p>

<p align="center">
  <a href="README.md">English</a> · <b>简体中文</b>
</p>

**帧言**（Frametell）把你的想法和资料，变成画面会动、生动好看的讲解视频。一句灵感就能开始，比如「讲讲量子力学测不准原理」；也可以交给它笔记、文档、PDF、PPT 和图片。导演 Agent 先出分镜给你拍板，再写口播、配音、逐页作画并自检，最后渲染成 1080p 成片，附带字幕和发布信息。

它是给知识创作者用的：讲历史、科学、技术、投资、心理学、读书的人。你只管把事情讲清楚，不用学剪辑。

## 看看效果

https://github.com/user-attachments/assets/99dd4dc5-2ed4-421d-bf4d-697acd553b59

在桌面版里完整做一条片子，压缩成一分钟：提一个问题、拍板分镜、写口播、配音、画出五页，直到成片（72 秒，用时 12 分 52 秒，花费 1.59 美元）。

下面两条片子都是帧言从头做到尾的：分镜、口播、配音、每一页画面和渲染。点图片观看（有声音）。

<table>
  <tr>
    <td width="50%"><a href="docs/media/uncertainty.mp4"><img src="docs/media/uncertainty.jpg" alt="《测不准原理》的几帧画面，黑板风格"></a></td>
    <td width="50%"><a href="docs/media/pomodoro.mp4"><img src="docs/media/pomodoro.jpg" alt="《番茄工作法》的几帧画面，暖调插画风格"></a></td>
  </tr>
  <tr>
    <td><b>测不准原理</b> · 67 秒，<code>chalkboard</code> 黑板风格。只给了一句话「讲讲量子力学测不准原理」，模型是 DeepSeek。</td>
    <td><b>番茄工作法</b> · 55 秒，<code>warm-story</code> 暖调插画风格。素材是一页笔记，模型是 Gemini 3.7 Flash。</td>
  </tr>
</table>

## 为什么用帧言

- **先拍板，再动手。** 分镜确认之前一页都不画。哪一页不对，指着它说改什么就行。
- **过程看得见。** Agent 边做边说在干什么、为什么这么做，花了多少钱、用了多久，任何时候一眼可见。
- **效果稳，省 token。** 不是从零生成视频，而是驱动一整套成熟的视频引擎：风格、组件、镜头运动、质量检查都是现成的。
- **本地运行，任何模型。** 资料留在你的电脑上。本机已经登录 Claude Code、Codex 或 Grok 时，可以直接调用这些命令行，不用填 API Key。也可以接 Anthropic、OpenAI、Google、DeepSeek、OpenRouter，或任意 OpenAI / Anthropic 兼容接口。

## 怎么做出来的

1. **想法或资料**：一句话、一段想法，或者交给它文档、PDF、PPT、图片、Markdown。有一样就够，也可以一起给。
2. **分镜**：导演把你的想法或资料拆成一页页、一个个拍点，你确认或修改。
3. **口播与配音**：写好讲稿，用火山 TTS 或 ElevenLabs 配音。
4. **逐页画面**：按你选的风格画每一页，用 lint 和截图逐页自检。
5. **成片**：全片检查后渲染 1080p MP4，带字幕。

内置风格：`warm-story`（暖调叙事）、`study`（安静书房）、`chalkboard`（黑板）、`whiteboard`（白板）、`tech-dark`（深色科技）。

## 开始使用

### 下载应用

**macOS（Apple 芯片）**：从 [最新版本](https://github.com/sitor-ai/frametell/releases/latest) 下载 `.dmg`，打开后把帧言拖进「应用程序」。应用经过 Apple 签名和公证。本机还需要装有 Chrome、Edge 或 Chromium，帧言用它来画页面和渲染。

打开后，如果本机已经登录 Claude Code、Codex 或 Grok，在「设置 → 本机命令行」里选一个即可，不用填 API Key 和请求地址。也可以仍按原来的方式填写模型服务商的 key。配音再填一个火山引擎 TTS 或 ElevenLabs 的 key。

Windows 和 Intel Mac 暂时还没有安装包，可以先从源码运行。

### 从源码运行

需要 Node.js 22.19 以上、pnpm，以及本机装有 Chrome、Edge 或 Chromium。FFmpeg 已内置。

```bash
git clone https://github.com/sitor-ai/frametell.git && cd frametell
pnpm install && pnpm build    # 在国内可以先 export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ 加速

export ANTHROPIC_API_KEY=...         # 或 OPENAI_API_KEY、GEMINI_API_KEY …
export VOLCENGINE_TTS_API_KEY=...    # 可选，配音用；也可以用 ELEVENLABS_API_KEY

# 在浏览器里打开工作室
node apps/cli/dist/cli.js serve

# 或者直接在命令行出一条视频
node apps/cli/dist/cli.js run 讲稿.pdf --style warm-story --duration 60
```

## 社区

用帧言做了片子、遇到问题、想要新风格，都欢迎来群里聊。扫码加入帧言交流群：

<p align="center">
  <img src="docs/brand/community/wecom.png" alt="帧言交流群（企业微信）二维码" width="220">
</p>

Bug 和功能建议也可以直接提 [Issue](../../issues)。

## 许可

帧言以 [GNU Affero 通用公共许可证 v3.0](LICENSE)（AGPL-3.0）开源。你可以自由使用、修改和运行它，包括商用；但如果你把修改后的版本通过网络提供给别人使用，就要以同样的许可证向他们公开修改后的源码。如果需要不带这些义务的商业授权，请发邮件到 [contact@sitor.ai](mailto:contact@sitor.ai)。

© 2026 [**Sitor AI**](https://sitor.ai)
