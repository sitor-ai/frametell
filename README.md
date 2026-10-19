<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/readme/banner-en-dark.png">
    <img alt="Frametell: tell stories, frame by frame. Turn your ideas and material into vivid explainer videos" src="docs/brand/readme/banner-en-light.png" width="100%">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/sitor-ai/frametell/releases/latest"><img src="https://img.shields.io/badge/Download-macOS%20(Apple%20Silicon)-1C1917?logo=apple&logoColor=white" alt="Download Frametell for macOS (Apple Silicon)"></a>
</p>

<p align="center">
  <b>English</b> · <a href="README.zh-CN.md">简体中文</a>
</p>

**Frametell** (帧言, *zhēn yán*) turns your ideas and your material into vivid explainer videos with pages that move. One sentence is enough to start ("explain the uncertainty principle"), or you can hand it notes, documents, PDFs, slides and images. A director agent first drafts a storyboard for you to sign off on. Then it writes the narration, voices it, draws each page and checks its own work. You get a 1080p video, with subtitles and publishing notes.

It's built for knowledge creators who explain history, science, technology, investing, psychology or books, and who'd rather tell the story than learn video editing.

## See it

https://github.com/user-attachments/assets/99dd4dc5-2ed4-421d-bf4d-697acd553b59

One run in the desktop app, condensed to a minute: a question, a storyboard to sign off, narration, voice, five pages and the finished film (72 s, made in 12 min 52 s for $1.59).

Two films Frametell made end to end in English: storyboard, narration, an ElevenLabs voice, every page and the render. Click a picture to watch (with sound).

<table>
  <tr>
    <td width="50%"><a href="docs/media/sky-blue.mp4"><img src="docs/media/sky-blue.jpg" alt="Frames from Why is the sky blue, a chalkboard-style film about Rayleigh scattering"></a></td>
    <td width="50%"><a href="docs/media/compound-interest.mp4"><img src="docs/media/compound-interest.jpg" alt="Frames from Why starting early matters, a warm illustrated film about compound interest"></a></td>
  </tr>
  <tr>
    <td><b>Why is the sky blue?</b> · 87 s, <code>chalkboard</code>. Made from one sentence (“Why is the sky blue, and why are sunsets red?”) with Gemini.</td>
    <td><b>Why starting early matters</b> · 72 s, <code>warm-story</code>. Compound interest, from one sentence, with Gemini.</td>
  </tr>
</table>

Frametell makes Chinese films just as well; see the <a href="README.zh-CN.md">Chinese README</a> for two of them.

## Why Frametell

- **You approve the plan first.** Nothing gets drawn until you've signed off on the storyboard. If a page is wrong, point at it and say what to change.
- **You can watch it work.** The agent says what it's doing and why, and the cost and time spent are on screen at every step.
- **Stable results, fewer tokens.** The agent drives a mature video engine with styles, components, camera moves and quality checks. It doesn't generate video from scratch.
- **Runs locally, with any model.** Your materials and API keys stay on your computer. It works with Anthropic, OpenAI, Google, DeepSeek, OpenRouter and other providers, or any OpenAI- or Anthropic-compatible endpoint. If Claude Code, Codex or Grok is already signed in, that CLI can review the film. It does not draw it.

## How it works

1. **Idea or material.** Type what you want to explain, as one sentence or a page of thoughts, or drop in a document, PDF, slide deck, images or Markdown. Either is enough, and you can give it both.
2. **Storyboard.** The director turns your idea or material into pages and story beats, and you approve or edit them.
3. **Narration and voice.** It writes the script and voices it with ElevenLabs (or Volcengine TTS for Chinese).
4. **Pages.** It draws every page in the style you chose and checks each one with lint and screenshots.
5. **Film.** It runs a final check on the full video, then renders a 1080p MP4 with subtitles.

Built-in styles: `warm-story`, `study`, `chalkboard`, `whiteboard`, `tech-dark`.

## Get started

### Download the app

**macOS on Apple Silicon:** download the `.dmg` from the [latest release](https://github.com/sitor-ai/frametell/releases/latest), open it and drag Frametell into Applications. The app is signed and notarized by Apple. You also need Chrome, Edge or Chromium installed; Frametell uses it to draw and render the pages.

When it opens, add a key for a model provider (Anthropic, OpenAI, Google, OpenRouter …) under Settings, and an [ElevenLabs](https://elevenlabs.io) key for the voiceover. A signed-in Claude Code, Codex or Grok can be the review model under Settings → Local CLI. It looks at the pages. It does not draw them.

Windows and Intel Macs don't have an app yet. Until they do, run Frametell from source.

### Run from source

You need Node.js 22.19 or later, pnpm, and Chrome, Edge or Chromium installed. FFmpeg is bundled.

```bash
git clone https://github.com/sitor-ai/frametell.git && cd frametell
pnpm install && pnpm build

export ANTHROPIC_API_KEY=...         # or OPENAI_API_KEY, GEMINI_API_KEY …
export ELEVENLABS_API_KEY=...        # optional, for the voiceover (VOLCENGINE_TTS_API_KEY for Chinese voices)

# Open the studio in your browser
node apps/cli/dist/cli.js serve

# Or make a video straight from the command line
node apps/cli/dist/cli.js run notes.pdf --style warm-story --duration 60 --lang en
```

## Community

Questions, ideas and films you've made are all welcome. Come say hi on [Discord](https://discord.gg/GKz3McPPXx).

<p align="center">
  <a href="https://discord.gg/GKz3McPPXx"><img src="https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?logo=discord&logoColor=white" alt="Join Frametell on Discord"></a>
</p>

For bugs and feature requests, open an [issue](../../issues).

## License

Frametell is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). You may use, modify and
run it, including commercially. If you offer a modified version to others over a network, you must make your modified
source available to them under the same license. For a commercial license without these obligations, email
[contact@sitor.ai](mailto:contact@sitor.ai).

© 2026 [**Sitor AI**](https://sitor.ai)
