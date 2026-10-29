# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.4] - 2026-10-28

### Fixed

- An export no longer fails after the film is made because its length could not be read ("cannot read <film>.mp4: " with nothing after it): the film is handed over with the time line's length. When ffmpeg can't read a film, the message now says why, also when ffmpeg printed nothing (it could not start, or was stopped).

## [0.7.3] - 2026-10-19

### Added

- A film can be presented as a slide deck. "Present" beside the export button opens the preview in deck mode (`index.html?deck`, or `window.DECK_MODE`, `runtime/deck.js`): each spoken line is one step, and a click, → or Space plays the picture up to just before the next line and holds it there, so the animations of a line come in one click at a time. ← goes back a step, ↑ ↓ jump a page, Home and End go to either end, F is full screen. It is silent and without subtitles: the presenter speaks. P opens a presenter window with the line to say, the next one and a clock; the two windows follow each other. The step is kept in the address (`#12`), and a phone can swipe or tap. On a hosted service the popover also gives the deck's link to share: the preview's own signed address, which opens without signing in and follows the film as it changes.

- The engine's scripts are fetched at once instead of one after another (`boot.js` writes a preload for each before the scripts): a preview on a far server boots in a few seconds instead of paying a round trip per script.

- An extra the engine ships, named `engine/…` in `META.extras`, is loaded from the engine itself, wherever it is served from, not only through the project's `engine` link.

- A brand can keep its logo small in a corner of every page (`BrandBrief.corner`: `tr`, `br` or `bl`; top-left is where each page's title sits). The engine draws it itself (`META.mark`, set by the director from the brief): its wordless mark, else its logo, the dark-ground logo on a dark paper, above the page and still while the camera moves. It fades in with the film and out when the last line ends, before the closing sign-off, so one logo shows at a time. The planner, the page agents and the reviewer are told the corner is taken: pages keep it clear, and the reviewer fails a page that crowds it, not one that shows it.

- A film in a designed style (one whose look the director designs for each film) of 8 pages or more now gets its own components before its pages are drawn. The storyboard lists the things the film draws on 3 pages or more (`look.kit`: a map, a globe, a recurring mark), a session writes them once in the film's look as `extras/film-kit.js`, and they are checked on a sheet of their own (lint, determinism and a reviewer). The ones that pass are loaded for every page and listed first in each page's components, so the film shows each thing the same way on every page and no page draws it from nothing. It is written while the film is narrated, so it adds no wait. Once checked, the file is fixed: the agents' write and edit tools refuse it, and a change made any other way is put back before a page is checked. A kit that fails leaves the pages to draw everything themselves, as before.

- An exported film opens on a cover instead of a blank stage. Its first frame is a page at rest (the moment its thumbnail is cut), so a chat app or a file browser that shows a video by its first frame shows a picture; one frame of it is not seen when the film plays. It is the first page unless another is chosen: "Cover" beside the workbench's export button lists the film's pages to pick from (`Studio.setCover(id, page)`, saved as `cover.json` in the project, a `cover` event). Choosing another cover marks an mp4 already made out of date, and the next export draws only the film's first segment again.

- The cover can be an image of your own. "Upload image", first in the cover picker, takes a JPEG, PNG or WebP of up to 10 MB; the exported film's first frame shows it filling the frame (cropped to the film's shape) instead of a page. It is kept in the project as `cover-<hash>.<ext>` and named in `cover.json` (`{ "image": … }`), checked by its bytes, never followed through a link (`Studio.setCoverImage(id, data)`, `PUT /api/projects/:id/cover/image`, a `cover` event with `image`). Choosing a page again removes it.

### Fixed

- A film a hosted service stops because the account ran out of credits now says so (`paused` with `reason: 'credits'`, from `Studio.stop(id, 'credits')`), with a button to top up beside Continue and the out-of-credits notice at the top of the workbench until the balance is topped up. It used to read as if the user had paused it.

- While a film is being made, the workbench's players no longer reload the whole film each time a page starts, finishes or goes round its check again. They reloaded dozens of times during a film, the page you were playing was cut off and stuck near its start, and the browser could slow to a crawl. A player now picks up a new version only when a page has been drawn.

- The preview no longer shakes at the start of a page when a line's audio gets stuck. A line whose file came without a length or byte ranges (a hosted film's files sometimes do while it is being made) could be told to play and never finish seeking; the picture kept to that line all the same and was pulled back to its start every few frames. A line now leads the picture only while it is playing. A stuck line holds the picture, is fetched again after 1.5 s, and is skipped after 4 s, so the film plays on.

- A change that adds a page to the storyboard (a new end card, say) no longer fails that page on every Continue. Its revision note read the page's file, which does not exist yet; a page a change adds is now drawn from nothing.

- Narration no longer fails with a zero-length "audible sound" cut when a take's trailing silence stops a few milliseconds before the end of its file.

- A new film's placeholder opening is in the film's language. Until the director writes the script, an English film showed a Chinese first page and lines in the film strip; the template's opening (section, greeting, title line, first question) is now filled in English for an English film (`createProject(dir, { lang })`, passed from the film's `lang` by Studio and the CLI) and stays Chinese for a Chinese one.

- The `warm-story` style is labelled "Warm illustration" in the English interface (it said "Warm storybook") and its short Chinese name, as the agent and hosted services name it.

## [0.7.2] - 2026-10-16

### Fixed

- A film no longer ends with a hard cut a second after its last line. The last page holds about 2.5 seconds after the narration ends, then the film fades to its background over its final 0.8 seconds (`META.fadeOut` sets it; 0 for a hard cut). The last page's agent is told the film ends on it, so it lands the close with the last line and then holds still, and the page check looks at that hold.

## [0.7.1] - 2026-10-16

### Added

- Videos on the home page can be put in groups: a tab for each group (with All and Ungrouped), and a menu on every row to move a video to a group, make a new group, take it out of one, or delete it. "Select" picks several videos to move or delete at once. A project's group is kept in its `project.json` (`group`), set with `Studio.moveProject(id, group)` or `PATCH /api/projects/:id`.

### Changed

- The home page asks for one model. The director and the pages get a model each under "Advanced", which opens by itself when they were saved apart.

### Fixed

- A page that its own check passed with a note shows as drawn, not as something to look at.
- On Windows, a project without its `.gitignore` no longer stages the engine links in its first commit (which hit the git timeout and left the folder locked).
- The environment tests read a child's variables case-insensitively on Windows.

## [0.7.0] - 2026-10-16

### Added

- Hosts that run projects elsewhere can open a Studio that leaves project folders as they are (`linkProjects: false`) and create a project without starting it (`createProject(…, { start: false })`). The engine's runner helpers (`engineCmd`, `nodeEnv`, `childEnv`, `confine`) are exported.
- A run numbers its events on from the highest number in its log, so a log rebuilt by a host with an event left out never reuses a number.
- `Studio.halt(id)` stops a film's task without logging a pause, for a host that is going away: the next host to open the film finds it cut short and carries it on.
- `new Studio({ web: false })`: the research reaches no web at all (no search, no page, no repository clone), for a host whose runs have no network. Links in a request are left in its words for the director, and a film from a topic alone has no research. `offlineWeb` is the web such a host's research sees.

### Changed

- A Renderer may answer the final plan's segment names, the backend that drew them and why not the GPU; they are carried on the done event.

### Fixed

- A colour name the style's palette doesn't have (`yellowF` in a style without it) no longer reaches the page as an invalid CSS colour, which drew black: a light fill `<name>F` of a colour the palette has is that colour mixed toward the paper, and any other name is ink and reported by the page check as an error, with the style's names.
- warm-story's objects (`P.tag`, `P.hand`, `P.calendar`, `P.snowball`, …) can be hidden with `hide(t, dur)` like any other element; a page that called it no longer fails to draw.

### Security

- A project gets its git history before any agent's shell runs (and before any commit), so a shell can no longer make `.git` itself first.
- Nothing the agent made is evaluated or decoded in the studio's own process any more: the narration reads `script.js` and `voice.js` through a new engine tool (`script-data.mjs`), and ffmpeg (narration, frames, posters, the film gate) and the document parsers run in child processes, confined with no network when the network is taken away. ffmpeg only opens local files (`-protocol_whitelist file,pipe`). What a child answers is checked before it is used: a page id must be a plain name, the document parser's files must be plain names beside their documents, the film gate's answer must have its shape. The narration writes its takes and voice.js only into the project, never through a planted link, and a frame cut is one picture of bounded size. The final mix also reads the narration's audio with local files only.
- The research never follows a link out of a folder it was given: a link in a cloned repository or one planted in the material is refused or left out of listings and searches, and a repository is cloned with links checked out as plain files, through the studio's git helper (hooks and fsmonitor off), from https only.
- On Linux the agent's shell runs in a new user namespace that can make no other, with no capabilities, under a seccomp filter that refuses the kernel's riskier calls (bpf, userfaultfd, io_uring, keyrings, ptrace, perf events, kexec, mounts, namespace changes).
- On Linux, a file the studio writes into a project is reached folder by folder through what it already opened, so a folder swapped for a link at that moment can no longer leave even an empty folder outside the project. A new `listIn` lists a project folder the same way.

## [0.6.0] - 2026-10-15

### Added

- Research before the storyboard. When a request points at something (a web page, a GitHub, GitLab or Gitee repository, or a folder or file on your computer, by its link or path), a research agent reads it first: it clones the repository, finds the idea at its centre and the code that shows it, and hands the director a brief written for the film: a hook, how it works with a way to draw each step, facts with their sources, code and quotes to put on screen, and what not to overclaim. It runs on the pages' model (the cheaper one), may take many steps, and older tool output is cleared as it goes so long sessions fit; it stops after 20 minutes at most. If it fails, the film is made without it.
- Web search for research, in Settings → Web search: Tavily, Serper, SerpAPI or Jina, several keys per service if you like. With one set up, a film from a topic alone checks its facts on the web first; with material attached, the new Web research switch beside it adds the web. Without a search engine, links, repositories and folders are still read (pages through Jina Reader's free tier, or directly).
- `new Studio({ localFiles: false })` never reads a folder or file named in a request, for a hosted service.
- `render.mjs --hw` encodes on an NVIDIA card (h264_nvenc) on Linux, as it already did on a Mac's media engine. `--jpeg-quality N` captures frames at a lower JPEG quality (92 by default; 85 is about a fifth quicker and looks the same once encoded), and `FRAMETELL_CHROME_ARGS` adds flags to every Chrome the tools open.
- `frametell run` voices an English film with ElevenLabs when both a Volcengine and an ElevenLabs key are set.
- Third-party notices, in the repository and in the app.

### Changed

- The director finds the film's argument before planning its pages, and pages reveal on the word that names them, move smoothly and keep one lead at a time.
- An export says it is done as soon as the film is ready; its final check runs afterwards in a process of its own and reports when it finishes. The film's sound is made once and cached, and can be made while the frames are drawn, so joining the film takes milliseconds instead of seconds.
- Building the desktop app downloads Electron from GitHub by default; `ELECTRON_MIRROR` picks a mirror.
- In the conversation, the play hint on a drawn page shows as soon as the pointer is on the row, instead of after half a second.

## [0.5.1] - 2026-10-14

### Added

- Hosts can give each run its own settings: `ConfigStore.load()` is told which project's run is asking.
- Narration services can be reached through a gateway (`ttsBaseUrls`).
- Model requests name their session (`x-frametell-session`).
- Hosts can hear every event of every run (`StudioOptions.onEvent`), to keep or forward the events themselves.
- `FRAMETELL_SANDBOX_NONET=1` keeps the agent's shell and the engine's tools (Chrome included) off the network and, on Linux, away from other processes. `FRAMETELL_SANDBOX_REQUIRED=1` refuses to run a shell when no sandbox is available; asking for no network requires a sandbox too.
- A style can leave its look to each film: with a `fonts.json` beside its grammar card, the director designs the film's look while writing the storyboard (`look` in storyboard.json: a style card, a palette by the runtime's colour names, one of the style's fonts, and a line: sketch, pen or clean). The server checks it, writes it into `META.look`, and every page agent and reviewer reads the card after the style's own. The storyboard card in the panel shows the look in a line, with its colours.
- `META.look` can set the line (`line`: how rough and bowed a stroke is, its width, traced once or twice). Its fonts load before the first frame, and the band behind a page's heading takes the paper's colour.
- Each `cost` event carries the turn that just ran (`turn`) and the model that took it (`model`, "provider/id"), so a service that prices turns itself no longer has to guess the model from the session's name. A page drawn again after a failure runs on the director's model, and was priced as the page model.
- On a hosted service, the workbench can show what a film cost the service in dollars beside its credits (`Hosted.credits.spent` may return `cost`; a service gives it only to its admins).
- Settings → General → Export folder: every mp4 export, with and without subtitles, is also saved to a folder you choose (picked in the desktop app, typed as a path in the browser), replacing an earlier export of the same name. "Show in Finder" opens that copy. A folder that can't be written is said, and the film stays in the project.

### Changed

- What a film cost is always shown in US dollars. It used to read ¥0.00 until the first model turn came in, and films from when a provider was priced in yuan showed ¥: those are now turned into dollars.
- On a hosted service, a step that the balance doesn't cover says so above the composer: what it needs, what is left, and a link to top up. A storyboard waiting for approval says it before the button is pressed, and the button waits until the credits are there. A refused approval used to leave the card marked approved with nothing happening. Nothing is set aside for a step any more, so the workbench no longer shows a held amount.

### Security

- The agent's shell, the engine's tools and git get only the environment they need (paths, locale, the Chrome and ffmpeg settings, `FRAMETELL_*`). A host's secrets under any name, such as a database URL, no longer reach them; `NODE_OPTIONS` and `NODE_PATH` stay out too.
- The shell's sandbox lets back in the installed engine's folders, not wherever a project's `engine/` and `engine_modules/` links point: a shell could repoint them at a hidden folder and read it.
- The shell can no longer change a project's `.git`, whose hooks and config run in the studio's own git, outside the sandbox.

## [0.5.0] - 2026-10-13

### Added

- A film can carry notes for its style (`styleNotes` on a new project): the director and the page agents read them right after the style card.
- A film can carry its own look (`look` on a new project, written to `META.look` in `script.js`): palette colours by the runtime's names, the hand and latin font stacks, and the stylesheets that bring those fonts. `runtime/look.js` applies it over the style.
- A style can draw in three.js: its films load three and paint their pages with WebGL.
- Double-click a drawn page in the conversation to play it in its close-up. A page still being drawn can't be opened yet.
- A message sent while a film is being made waits in a queue, where it can still be edited, and goes to the director as soon as the run is at rest. It used to reach only the agents spoken to after it, and was often lost.
- On a hosted service, the workbench says what the credits are: what this film has spent, what is set aside for the step being made (explained on hover), and what is left. The balance in the top bar is no longer a link.

### Changed

- A page's checks are quicker and no longer go round in circles. Lint's findings are split into must-fix problems (a runtime error, an unknown API, text off the canvas or in the subtitle band, raw markup, an empty opening or ending) and advice (a sparse or text-heavy page, small or touching text). A page its agent calls done passes on advice alone; done with a must-fix problem is asked about once, then settled as it is. A round that changes no code ends the checks instead of checking the same page again, and one page's lint gives up after 90 seconds. The whole-film review looks at must-fix problems only.
- The director answers in the language the film's topic was written in until you say something in the conversation. It used to fall back to the interface setting, so a film asked for in one language could get its storyboard notes in another.
- Opening a page in the workbench is instant: its player stays loaded between visits, warms up before it is asked for, and keeps its cache. While it loads it shows a sharp key frame and a loading line.
- Past a dozen pages, the film's page lane scrolls instead of squeezing the pages, and follows the page on screen.

### Fixed

- Pause stops everything at once. It used to wait for whatever was in flight, so pages, their screenshots and lint went on in the background for minutes after "Paused".
- A film paused before a restart stays paused. It used to go on by itself.
- A page left mid-check when the app or server restarted picks up at the check it was in, instead of being drawn again from nothing.
- Play from the conversation plays the film, with sound. With the film view open it did nothing, and a play started from the panel could be silent.
- Page agents see the methods a component returns, and a true/false `META` field is rewritten in place instead of being added a second time.
- A page's thumbnail (in the film strip and on the finished film's card) no longer carries a time label in its corner.

## [0.4.0] - 2026-10-13

### Changed

- The product has a new Chinese name, Zhenyan ("frames that speak"); the English name stays Frametell. The interface, the CLI, the README, its banners and the brand guide all use it.
- Frametell is now licensed under the GNU Affero General Public License v3.0 (AGPL-3.0) instead of MIT. Using, modifying and running it, commercially too, stays free; offering a modified version to others over a network now means making that version's source available to them under the same license.
- Contributors accept a Contributor License Agreement (CLA.md) once, by replying to a bot on their first pull request.
- Home's style picker shows the chosen style and a few others in one row, ending in "Browse every style", which opens every style in a dialog, grouped into free styles and those for members.

### Fixed

- A finished film exports even when the model it was made with can no longer be reached (its provider was removed from Settings, or its key deleted). Exporting needs no model, but it stopped with "Model … is not available" and offered Continue instead.

## [0.3.2] - 2026-10-12

### Changed

- Settings puts Claude first as the recommended provider, and Home's "no model connected" hint leads to it.

## [0.3.1] - 2026-10-12

### Fixed

- An export no longer hangs. A browser that stopped answering mid-export (now and then Chrome does, most often on a busy or just-woken Mac) left the export waiting for hours. Now a frame that takes more than a minute counts as stuck: that part of the film is drawn again in a new browser, and if it sticks a second time the export stops and says so.
- Canceling an export stops its browsers too. They kept drawing in the background and slowed down every export after it.
- Pages that couldn't be drawn now say why, and what to do next. The film used to stop on "These pages were not drawn: p16, p17…" and nothing more, though each page had its reason. Now the reason comes with it, and a model service's trouble is said in words to act on: the key's balance or quota ran out, the key was turned down, the service is limiting requests, or it couldn't be reached.
- Continue draws failed pages with the film's own model when pages have a model of their own. It used to ask the same model the same way, and the same pages failed again on every Continue. Pages that fail more than once ask how they should look, so the next try is told something new.
- Typing "continue" after a film stops on an error continues it. It used to be kept as a note for when work resumed, and saying it again and again did nothing; only the Continue button did. After an error, anything typed goes on with the film, and is followed.
- Voicing no longer waits forever on a voice service that stops answering. Each take gives up after 90 seconds and is asked again, as it always meant to; making a film had dropped that deadline, so one silent request held the film on "Recording the voiceover" until it was paused.
- Voicing no longer stops on a page whose recording begins (or ends) with a few milliseconds of noise before its silence. It used to call its own trim of that silence "dropped sound" and stop, and Continue stopped the same way every time.

## [0.3.0] - 2026-10-12

### Added

- Preferences in Settings: write once what you want in every film (the voice, the look, the pace, who it is for), and the director and the page agents follow it in every storyboard, narration, page and change. Suggestions add a line with one click.
- A video can be deleted from the list on Home. It asks first, and a video being made has to be stopped before it can go.
- Styles can be installed beside the built-in ones: a style pack brings its own components, the new-film form picks a style by its picture (and plays a short loop on hover), and a style that draws characters may give them faces.
- On a hosted service: the account's credits in the top bar, what a film will take before it starts, what a film has spent in credits instead of money, and downloads saved as a file named after the film.

### Fixed

- The narration stays in step with the picture. Each line's audio was only fetched when its turn came, so on a slow connection every line started late and was cut off where its estimate ended, with a thud. Now lines load ahead, the picture waits for a line that isn't ready and follows the voice while it plays, and every line plays to its end.
- A preview that fails to load, or stays dark, is loaded again by itself instead of waiting for the whole panel to be reloaded. Its play hint and buttons follow the panel's language.
- Exported frames fill the whole stage: on some machines the bottom rows of every frame came out black.
- Voice lists open at once: the ElevenLabs list is kept per key instead of being fetched every time a list opens.

## [0.2.4] - 2026-10-12

### Fixed

- A film always has every page of its storyboard. The pages drawn are the ones the narration covers, and a model whose turn ended early had narrated only the first page of an eight-page storyboard: the film was then drawn, checked and shown as done, green all the way, one page long. Now the director asks for the narration of the missing pages, and if it still doesn't come, the film stops and says which pages have none.

## [0.2.3] - 2026-10-12

### Security

- An agent's shell is confined to its project. The file tools already were, but a shell command could read anything the app could: a page agent unsure what a change meant was seen reading other folders and searching the whole home folder. Now its shell runs in a sandbox (Seatbelt on macOS, bubblewrap on Linux when it works there) that reads only the project, the engine and the system, and writes only the project. On Windows the shell is not confined yet.
- An agent's shell no longer sees API keys, secrets or tokens in its environment.
- Agents can't read the studio's own record of a run (`.studio/`: its events, sessions and state).

### Fixed

- A change the page already shows, or one that says nothing the page can do, is answered in seconds with the reason ("the numbers on this page are already yellow"), instead of the page agent searching for minutes and sometimes changing other pages.
- An ElevenLabs key whose voices could not be listed showed no voices and no reason. The voice lists and the key in Settings now say why: the key can't read voices (turn on Voices: Read for it in ElevenLabs), the key was turned down, or ElevenLabs couldn't be reached (check the connection or set a proxy). A key that can speak but not read voices gets ElevenLabs' default voices, so it can still narrate. Listing gives up after 15 seconds instead of waiting with no end.

### Added

- On a hosted service, a Volcengine voice can be added by its id with the account's own key.

## [0.2.2] - 2026-10-12

### Fixed

- The preview keeps its place while the film is being made. A page that changed (drawn, checked, redrawn) used to reload the preview: it flashed and went back to the start. Now the new version loads behind the one on screen, at the moment you were watching, and takes its place once it is drawn; while the preview plays, it waits until you pause.
- The preview's play hint and button tips are in the film's language. A Chinese film showed "Click the picture or press Space to play" in English.
- Play on the "Your video is ready" card plays the film. Without an up-to-date mp4, the film is the live preview, and both Play buttons only switched to it without starting it.
- A page check's findings are a warning, not an error, and read in the panel's language. A page drawn with a finding was marked in red, with the finding in English ("text-dominated page: …"); it is now amber, and a Chinese panel says it in Chinese.

## [0.2.1] - 2026-10-12

### Added

- A film can draw its pages with another model than its director's. The director (storyboard, narration, planning a change) and the pages (drawing them, checking the whole film) each have a model in the new-film form, remembered for the next film; the pages are most of a film's tokens, so a faster, cheaper model there saves the most. Unset, the pages use the director's; the page model must be able to see images, and each turn is priced at the model that took it.
- My voices: any Volcengine voice by its id (the 1.0 and 2.0 libraries, and cloned voices), pasted at the foot of a voice list or added in Settings. Adding one speaks a sample with it, so a wrong id or a voice the account hasn't enabled is said right there. 1.0 voices get word timings too. The built-in list is 18 explainer voices of TTS 2.0, with samples.
- A film's voice can be switched from the composer: pick another under This film and send; the whole film is narrated again in that voice and nothing is redrawn (going back to a voice you had costs nothing).
- A Volcengine key can also be an older app's `AppID:Access Token`.
- The model picker lists providers on the left and their models on the right; search spans every provider, and arrow keys and Tab move between them.
- `studio.resumeInterrupted()` continues the runs and exports a restart cut short, for a hosted service that restarts on every deploy. The desktop app and the CLI still leave it to you: the film shows as paused, with Continue.
- `new Studio({ review: 'defects' })` runs the whole-film check only for what breaks a film (a frame that flickers, page code that fails), once and briefly. The default is unchanged.
- The engine can split an export across machines (`render.mjs --plan` / `--segments`); a run that finds every segment already drawn only joins them and adds the sound.

### Fixed

- A change to a finished film that never reached the page is no longer shown as done. When the page model's edits didn't land (or it only said it had made the change), the page passed its checks and showed "done", and the preview and the export kept the old picture. Now a page whose code is unchanged is asked once more, every check round restates the change, and if it still didn't land the page is marked for you to look at and the director says which page was not changed.
- Continue answers at once. A paused film shows that it is getting ready the moment you continue, instead of staying paused until its next step began: getting ready fetched the model list of every provider with a key (12 seconds was seen, and a provider that hung held the film back with no end), so Continue seemed to do nothing until you left and came back. Now only the film's own providers' lists are fetched, and they get 15 seconds.
- A provider whose gateway moved is reached at its new address.
- Exports on a small machine no longer run out of memory adding subtitles: they are added to two segments at a time, not all at once.
- Pause stops the film whenever you press it. Pressed while an agent was between two requests (checking a page, taking screenshots), it used to be missed, and the film went on for minutes.

## [0.2.0] - 2026-10-11

### Added

- A film can have no voice. The voice picker leads with "No voice"; it is the default when no voice service is connected, so a film can be made without one. The director then writes the storyboard so the picture tells the story on its own (key words and numbers on screen) and the narration as captions that read well alone. Subtitles stay your choice: a film can be just animation.
- With a Volcengine voice, the narration has a tone on every page (curious in the hook, slower and firmer on a key page, calm at the close), and its own on the rare line that turns: a question to the viewer, a punchline, a quote.
- The panel can run hosted: a `studioBridge` that sets `hosted` (Frametell Cloud) gets the account and a sign-out in the top bar instead of Settings, no model picker (the service chooses), and only the voices the service can speak with. Home also takes `?topic=` to start with an idea typed elsewhere.

### Changed

- English films no longer offer Volcengine's voices, which speak only Chinese. Since a film's language follows the panel's, the English panel doesn't show them by default, and its Settings list ElevenLabs first.

## [0.1.2] - 2026-10-11

### Changed

- Films are made faster. Pages are drafted at medium thinking (a draft took 37–74 s instead of 170–220 s, and the pages were no worse); the director writes the storyboard from what it is given instead of browsing the engine first (the first storyboard came in about 50 s instead of 100 s); a check round's fixes go out in one reply and end the round, instead of two or three more model turns; and `frametell run` draws up to ten pages at once, like the studio.
- The director's prompts, the style cards, the engine's tools and the docs are in English. Films are still made in Chinese or English, and every stage names the film's language. Reports, notes and failures follow the language of your latest message, or the interface's.
- Material parsed from PDF and PowerPoint follows the film's language too: page and notes labels are in Chinese for a Chinese film, "Page N" and "Notes:" for an English one.

### Added

- `new Studio({ renderer })` hands exports to another renderer, such as a render service, instead of rendering in the same process.
- Releases are built by GitHub Actions from a version tag: the macOS app and its dmg are signed with the Developer ID, notarized and checked, and wait in a draft release.

### Fixed

- Pages kept their fonts, and exports worked, when the engine was installed as a pnpm dependency; it used to look for its modules in the wrong folder.
- The engine's tests no longer leave a link inside the package that points at its own parent folder. A tool that followed links could walk it forever (one scan grew to 43 GB).
- The storyboard stage asks again when a model turn ends without a storyboard.

## [0.1.1] - 2026-10-11

### Fixed

- The macOS app opens after it is downloaded. It was left with a signature that no longer matched the app, and Apple silicon Macs called it damaged with no way to open it. It is now signed with Sitor's Developer ID and notarized by Apple, so it opens like any other app. A build made without a Developer ID certificate is signed ad hoc instead, and macOS asks once before opening it.

## [0.1.0] - 2026-10-11

The first release of Frametell: a local, open-source studio that turns an idea or your material into an explainer video. A director agent drafts a storyboard for you to approve, then writes the narration, voices it, draws every page in a chosen style, checks its own work, and renders a 1080p film with subtitles.

### Added

#### Making a film

- Start from one sentence or from material: PDF, Word, PowerPoint, EPUB, Markdown and images, parsed to Markdown beforehand (headings, lists, tables, pictures, slide notes).
- A storyboard of pages and beats (a concrete object, what it does, the camera, the text on screen) that you approve or change before anything is drawn. It is checked before you see it: layout words instead of things, catch-all verbs, too much text on screen, an opening or ending carried by text, and numbers on screen that the material does not contain.
- Narration written for the voice, voiced with word-level timing, and animations cued to the words they belong to.
- Pages drawn up to 10 at once. Each page checks itself against lint (out of frame, the subtitle band, overlapping or too-small text, empty boxes, text-heavy or sparse pages, frames that differ depending on playback, LaTeX left in plain text) and against screenshots of itself, with up to three rounds to fix what it finds. A final pass then reviews the whole film.
- A page whose code breaks shows its name in place while the rest of the film plays. The error, with the line it came from, goes back to that page's agent, and an export refuses a film with a broken page.
- The film is previewed live as soon as its pages are drawn. An mp4 is rendered only when you export, and incrementally: after a one-page change, only the segments that page appears in are rendered again.
- Changes by conversation: a request that names pages goes straight to them, and anything that may touch the narration is planned first. Pages are fixed with edits, not rewrites, and every revision says where its time went (a one-page picture change takes about half a minute).
- Hand the director exactly what you mean: a page, a narration line, a frame, or files and images you attach, paste or drop. They show as chips above the message.
- Runs pick up where they stopped after the app is closed. Cost, model and token use are shown for every film.

#### Languages

- Films in Chinese or English. Home asks for the film's language (the panel's by default). The director writes the storyboard, narration and on-screen text in it and talks to you in the panel's language; English storyboards are checked in English, and English text wraps between words.
- The interface in Chinese or English, following the system or chosen in Settings; the core, CLI and server messages follow it too.

#### Styles and engine

- Five styles, each with a grammar card and a benchmark film used as a regression test: warm illustration (`warm-story`), quiet study (`study`), chalkboard, whiteboard and tech-dark.
- An engine where every page is a function of time: shapes, text, charts, KaTeX, three.js scenes, camera presets (quick push, pan, slam, shake), brand logos from simple-icons, and a component library of 28 files (gauges, timelines, flows, sequence diagrams, 3D stacks, file trees, rankings and more) that take their data from the page. A gallery project draws every component and is a test.
- A film check on the rendered mp4 that blocks blank frames and reports motion.

#### Models and voices

- Any model: Claude, OpenAI, Gemini, Grok, OpenRouter, DeepSeek, Kimi, Zhipu GLM, Qwen, MiniMax, SiliconFlow, Doubao, Hunyuan, Xiaomi MiMo and Ollama, each with its own base URL if you have one. Models a provider does not list can be typed in, and your own OpenAI- or Anthropic-compatible endpoints can be added. An optional HTTP proxy applies to every request.
- Voices from Volcengine TTS (Chinese) and ElevenLabs (English and more). Every voice can be heard before you choose it, and the built-in Volcengine previews ship with Frametell, so listening costs nothing.
- Keys stay on your computer, in a settings file only you can read, and the panel only ever sees them masked.

#### Workbench

- A conversation with the director beside the stage, with a live line saying what is being written and how far it has got.
- A film view with a page lane, a canvas of every page with its narration, and a focus view for one page: key frames linked both ways with its narration lines and the player, a lightbox to read any frame or self-check sheet in detail.
- Settings in one dialog: model providers with their marks, voices, general settings, the network proxy and a check of this computer (Chrome, ffmpeg, git).
- Exports with and without burned-in subtitles. In the desktop app, Show in Finder reveals the file; in a browser, its path can be copied.

#### Apps and API

- A desktop app for macOS (Apple silicon), built with `pnpm package:desktop`. It contains the engine and a redistributable GPLv3 ffmpeg, and needs neither Node nor anything else installed except Chrome.
- A command line: `frametell` opens the studio in your browser; `frametell run <material…> [--style] [--duration] [--model] [--lang]` makes a film straight through.
- A Linux render image (`docker/render.Dockerfile`): draws a finished project to mp4 with no desktop, GPU or Mac — Debian's Chromium and ffmpeg, Noto CJK and emoji fonts, the engine with its own modules. `docker run … frametell-render /project --fps 30 --workers 4`. Tried on the Pomodoro technique film (54.5 s, warm-story): frames identical to the Mac export; 75 s on 4 cores, 123 s on 2.
- One core behind every client (`@frametell/core`), with an HTTP + SSE server in the CLI and IPC in the desktop app. A `Studio` can take its own data directory and settings store, and keeps its data in `~/.frametell` (or `FRAMETELL_HOME`) by default.
- Open-source groundwork: MIT licence, CI on Linux, macOS and Windows, contributing and security guides, issue forms and a pull request checklist, READMEs and docs in English and Chinese.

### Known limitations

- The desktop app is not signed with a Developer ID or notarized (fixed in 0.1.1). Only an Apple-silicon macOS build is provided; Windows is not packaged yet.
- Chrome, Edge or Chromium must be installed; Frametell draws and renders with it.
- Undoing a change uses git; without it a film is still made, but its versions are not kept.
- The npm packages are not published yet; install from source (see the README).
- The Claude Agent SDK and Codex runtimes are in the code but not offered; every film runs on the built-in agent, which works with any provider.

[Unreleased]: https://github.com/sitor-ai/frametell/compare/v0.7.4...HEAD
[0.7.4]: https://github.com/sitor-ai/frametell/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/sitor-ai/frametell/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/sitor-ai/frametell/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/sitor-ai/frametell/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/sitor-ai/frametell/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/sitor-ai/frametell/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/sitor-ai/frametell/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/sitor-ai/frametell/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/sitor-ai/frametell/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/sitor-ai/frametell/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/sitor-ai/frametell/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/sitor-ai/frametell/compare/v0.2.4...v0.3.0
[0.2.4]: https://github.com/sitor-ai/frametell/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/sitor-ai/frametell/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/sitor-ai/frametell/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/sitor-ai/frametell/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/sitor-ai/frametell/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/sitor-ai/frametell/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/sitor-ai/frametell/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/sitor-ai/frametell/releases/tag/v0.1.0
