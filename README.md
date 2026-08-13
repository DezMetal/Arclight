<div align="center">

# Arclight

**A tiled explorer, editor and terminal in one window.**
From D-Net Lab.

</div>

---

Arclight is a native desktop workspace built to replace your file explorer, your
editor and your terminal with a single lightweight program. It is a Tauri
application: a Rust backend with a React frontend, shipping as one small `.exe`
with no server, no port, and nothing listening on the network.

**Primary platform is Windows.** macOS and Linux paths exist and compile, but
Windows is what gets used and tested.

## Running it

**Prerequisites:** Node.js 22+, Rust 1.77+, and on Windows the MSVC build tools
plus the WebView2 runtime (present by default on Windows 11).

```bash
npm install
```

```bash
npm run dev
```

That launches the app with hot reload. To produce a distributable installer:

```bash
npm run build
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Launch with hot reload |
| `npm run build` | Build the release binary and installer |
| `npm run lint` | Typecheck the frontend |
| `npm run test:rust` | Run the Rust unit tests |
| `npm run icons` | Regenerate the icon set from `tools/generate_icons.py` |

## Releasing

The version number lives in **three** files that must agree — `package.json`,
`src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`. If they drift, Windows
treats two builds as the same product and an installer will silently upgrade
over a different version. `tools/release.py` is the only thing that should set
a version.

```bash
python3 tools/release.py --bump patch
```

| Invocation | Effect |
| --- | --- |
| `python3 tools/release.py` | Build at the current version |
| `--bump patch` / `minor` / `major` | Bump all three files, then build |
| `--set X.Y.Z` | Set explicitly, then build |
| `--no-build` | Sync and verify versions without building |

Artifacts are copied to `dist-release/` with versioned names, each beside a
`.sha256` file:

- `Arclight-<version>-portable.exe` — single file, run it anywhere, no install
- `Arclight-<version>-setup.exe` — NSIS installer, adds Start Menu entry and uninstaller

The installer is selected by matching the version in its filename. The bundle
directory keeps every past build, so globbing for the newest could write an
older installer out under the new version's name.

A release build takes roughly six minutes; LTO and `codegen-units = 1` are on
deliberately, which is what keeps the binary near 4 MB.

### Distribution notes

Builds are **unsigned**. Windows SmartScreen warns on a downloaded binary until
either the signing certificate or the file itself accumulates reputation; users
reach the app through *More info → Run anyway*. A locally built binary carries
no Mark-of-the-Web and triggers nothing.

[SignPath](https://signpath.io/) grants free certificates to open-source
projects and would remove the warning at no cost. A self-signed certificate
does **not** help — SmartScreen does not trust an untrusted root, so it changes
nothing.

The installer uses Tauri's `downloadBootstrapper` mode for WebView2, so it
fetches the runtime if the target machine lacks it. Windows 11 always has it;
some Windows 10 machines do not and will need to be online during install.

## The workspace model

The window is a tree of **frames**. A frame is one splittable work area holding
one tool. Any frame can host any tool, and any frame can split horizontally or
vertically without limit.

| Tool | What it does |
| --- | --- |
| **Explorer** | Browse the real filesystem — drives, breadcrumbs, filter, create, rename, delete, cut/copy/paste, reveal in Windows Explorer |
| **Editor** | CodeMirror 6 — syntax highlighting for ~100 languages, multi-cursor, folding, search, autosave |
| **Terminal** | A real shell, via ConPTY |
| **Settings** | Theme, font size, tab size, autosave, layout |

Frame headers carry the tool selector, split controls, maximize and close, and
show the frame's id — the same id `dnet` commands and the control API use.
Drag a header onto another frame to swap their positions.

### Focus and selection

Two different things, deliberately:

- **Focused** — the frame you last interacted with, shown with an accent glow.
  Follows clicks anywhere, including inside a tool's content.
- **Selected** — the standing target for opened files, shown with a cyan
  outline and a crosshair. Set by clicking a frame's *header*; clicking content
  never changes it.

Opening a file resolves in this order: an explicit target (the **Open in
frame** menu) → the selected frame → the `defaultOpen` setting, which is either
the frame the request came from or a new frame.

Opening into a new frame splits the **largest** frame on screen, not whichever
was focused, so a file opened from a narrow sidebar does not bisect the sidebar.

Each frame keeps **one context per tool**, so switching a frame from explorer to
terminal and back returns the explorer to the directory it was showing. A tool
opened in a frame for the first time inherits that frame's current location
rather than starting at your home directory.

Layout and settings persist to `localStorage` under `arclight_layout` and
`arclight_settings`.

## The terminal

This is a genuine PTY, not a pipe with a line editor bolted on. ConPTY on
Windows via `portable-pty`, which means tab completion, arrow keys, readline,
and every interactive program works: Python REPL, `ssh`, `vim`, `git commit`,
progress bars, password prompts.

**Sessions live in the Rust backend, not in the UI.** A frame can unmount, the
webview can hot-reload, the layout can be rearranged, the font size can change —
the shell keeps running and keeps buffering output. Reattaching replays
scrollback so the frame looks exactly as it did. Killing a shell is something
you do deliberately, with the restart button; restarting reopens in the
directory the shell was last in.

`cmd.exe` is the default. PowerShell, PowerShell 7 and Git Bash are offered in
the frame header when they are installed.

Working directory is reported by the shell itself through OSC 9;9 (Windows) or
OSC 7 (POSIX), parsed out of the PTY stream with a scanner that handles
sequences split across read boundaries.

## The `dnet` command suite

Type `dnet <command>` in any terminal frame to drive the workspace. These are
matched on the input line, character by character, before a byte reaches the
shell — so the shell never sees them and never reports `'dnet' is not
recognized`.

| Command | Does |
| --- | --- |
| `dnet help` | List every command |
| `dnet edit <file> [-h\|-v]` | Open a file in a new frame |
| `dnet open <file>` | Open a file wherever the workspace routes it |
| `dnet term [-h\|-v]` | New terminal frame at this directory |
| `dnet explore [-h\|-v]` | New explorer frame at this directory |
| `dnet reveal [path]` | Show in Windows Explorer |
| `dnet theme <dark\|light>` | Switch theme |
| `dnet preset <signal\|aero\|softclub\|eink\|terminal>` | Switch the DSS preset |
| `dnet font <size>` | Set interface font size |
| `dnet new <file\|dir> <path>` | Create something |
| `dnet frames` | List frames, their ids, and which is focused or targeted |
| `dnet target <frameId\|none>` | Select a frame as the open target, or release it |
| `dnet close <frameId>` | Close a frame |
| `dnet layout reset` | Restore the default layout |
| `dnet sessions` | List running shells |
| `dnet info` | Host and workspace details |
| `dnet calc <expr>` | Arithmetic |

Adding your own is a single object appended to `CUSTOM_COMMANDS` in
[`src/lib/customCommands.ts`](src/lib/customCommands.ts) — the file header
documents the context object each command receives.

## Theming

Arclight ships the **canonical D-Net Signature Stylesheet** (v8.1.0 "Signal
Glass"). DSS lives at `test/DSS/` and owns its own distribution: Arclight is a
registered target in `targets.json`, and the copy under
[`src/styles/vendor/`](src/styles/vendor/) is **generated — never edit it**.

```bash
cd ../DSS && python3 sync.py
```

```bash
cd ../DSS && python3 sync.py --check
```

`--check` reports drift and exits non-zero, so CI catches a stale copy.

[`src/styles/dss.css`](src/styles/dss.css) is Arclight's adaptation layer. It
imports the vendored core, maps DSS tokens onto Arclight's shorter aliases, and
retunes geometry for IDE density — canonical DSS uses 26px corner cuts and page
rhythm, which is right for a document and far too loose for a frame header.

### Themes and presets

Theming is DSS's own, driven by two attributes on `<html>`:

| Attribute | Values |
| --- | --- |
| `data-theme` | `dark`, `light` |
| `data-dss-preset` | `signal`, `aero`, `softclub`, `eink`, `terminal` |

That is ten combinations, all from the shared stylesheet. Every surface reads
the same tokens — chrome, the editor's syntax colours, and the terminal's
16-colour ANSI palette — so a change moves the whole app at once.

Set them in **Settings**, or from a terminal:

```bash
dnet theme dark
```

```bash
dnet preset aero
```

Adding a preset means adding it to DSS and re-syncing. No Arclight component
changes, and no `!important` overrides of framework class names anywhere.

### Glass is opt-in

Canonical DSS puts `backdrop-filter` glass on every surface. In a workspace of
many frames that is a blur pass per frame per paint, so Arclight applies it
only where asked, via `.dss-glass-surface`. Frame bodies use a solid surface.

## The control API

Arclight can expose a local HTTP API so other systems drive the workspace —
reading frames, opening files into a specific frame, splitting frames, writing
to terminals. This is the surface AIM, Aether and local automation use.

It is **off by default**; Arclight is fully usable with it disabled. Enable it
in **Settings → Control API**, which shows the port and token.

Three properties, because this is remote control of a program that edits files
and runs shells:

- **Off unless enabled.** Nothing listens otherwise.
- **Loopback only by default.** Binding wider is a separate, explicit toggle.
- **Token required**, compared in constant time, on every route but `/v1/health`.

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/v1/frames
```

| Route | Method | Does |
| --- | --- | --- |
| `/v1/health` | GET | Liveness. No auth. |
| `/v1/state` | GET | Frames, focus, selection, settings, tools |
| `/v1/frames` | GET | Just the frames |
| `/v1/frames/split` | POST | `{ frame_id, direction, tool, context? }` |
| `/v1/frames/{id}/tool` | POST | `{ tool }` |
| `/v1/frames/{id}/close` | POST | Close it |
| `/v1/frames/{id}/select` | POST | Make it the open target; `{id}` may be `none` |
| `/v1/open` | POST | `{ path, frame_id?, new_frame?, direction? }` |
| `/v1/command` | POST | `{ command }` — any `dnet` command, output returned |
| `/v1/frames/{id}/content` | GET | **Read what is inside a frame** |
| `/v1/frames/{id}/content` | POST | **Act on what is inside a frame** |
| `/v1/terminal/{id}/write` | POST | `{ data }` — write to that frame's shell |
| `/v1/events` | GET | Server-sent stream of workspace events |

`/v1/command` runs the same `dnet` implementations the terminal exposes, so
scripted and typed control share one code path rather than drifting apart.

### Reading and writing frame contents

This is the reason the API exists. Content is served by the **mounted tool**,
not reconstructed from disk, so a caller sees exactly what is on screen —
including an editor's unsaved buffer and a terminal's rendered output rather
than raw PTY bytes.

```bash
curl -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:8787/v1/frames/frame_editor/content"
```

**Reading** — `GET /v1/frames/{id}/content`

| Tool | Returns |
| --- | --- |
| **Terminal** | `content`: the rendered screen. `?scrollback=true` for the whole buffer, `?lines=N` for the last N. Plus `cursor`, `cols`, `rows`, `cwd`, `shell`, `alive`, `selection`. |
| **Editor** | `content`: the live buffer. Plus `filePath`, `dirty`, `lineCount`, `selection` with offsets and text. |
| **Explorer** | `data`: array of `{ name, path, type, size, modified, readonly, symlink }`. `?all=true` ignores the filter and hidden-file setting. Plus `path`, `parent`, `selected`. |

**Writing** — `POST /v1/frames/{id}/content` with `{ action, payload }`

| Tool | Actions |
| --- | --- |
| **Terminal** | `input` `{data}` raw bytes · `command` `{command}` a line plus Enter · `key` `{key}` named control points (`enter`, `tab`, `up`, `ctrl-c`, `ctrl-d`, …) · `clear` · `restart` |
| **Editor** | `setContent` `{content}` · `insert` `{text, at?}` · `replace` `{find, replace, all?}` · `find` `{query}` returning match offsets and lines · `save` · `open` `{path}` · `reload` |
| **Explorer** | `navigate` `{path}` · `up` · `home` · `refresh` · `filter` `{query}` · `select` `{path}` · `open` `{path, frameId?, newFrame?}` · `create` `{kind, name}` |

An unknown action returns the list of valid ones, so a caller can discover the
surface without the docs:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"action\":\"?\"}" "http://127.0.0.1:8787/v1/frames/frame_terminal/content"
```

A frame must be **mounted** to be read or written — a frame whose tool is not
currently showing returns `frame '<id>' is not mounted`.

### Architecture, and why there is no Node inside

The workspace lives in the webview, so the Rust server mirrors it: the frontend
publishes a snapshot on every change, and commands are bridged to the frontend
and awaited. Arclight speaks its own small protocol and stays a 4 MB binary.

```
Arclight (Rust)  ──HTTP/SSE──┬── dnet-api-node   (gateway: keys, routing, scripts)
  127.0.0.1:8787             ├── Aether          (direct)
  off by default             └── local AI / IAC  (direct)
```

[dnet-api-node](https://github.com/DezMetal/dnet-api-node) is a **separate
process**, not embedded — bundling a Next.js runtime inside the app would cost
more than the app. It fronts Arclight for callers who want one key scheme and
one address across several systems; its repository ships a ready-made endpoint
pack (`data/arclight-endpoints.example.json`). Anything can equally call
Arclight directly.

## Architecture

```
src-tauri/
  src/main.rs        Entry point
  src/lib.rs         Command registration
  src/pty.rs         PTY sessions, scrollback, OSC cwd parsing
  src/fs_api.rs      Filesystem commands, Windows path handling
  src/control.rs     The control API server
  src/sysinfo.rs     Host details

src/
  main.tsx           React entry
  App.tsx            Registers the four tools
  context/           Frame tree, settings, focus and selection, event bus
  components/        LayoutManager, the four tools, ControlBridge
  lib/api.ts         The only place the UI talks to the backend
  lib/control.ts     Frontend half of the control API
  lib/customCommands.ts
  lib/terminalTheme.ts, lib/editorTheme.ts
  styles/dss.css     Adaptation layer over canonical DSS
  styles/vendor/     GENERATED - synced from test/DSS, never edit

tools/generate_icons.py   Draws the icon set with Pillow
tools/release.py          Version sync and packaging
```

The frontend never calls `invoke` directly outside `lib/api.ts` and
`lib/control.ts`, so the transport can change without touching a component.

### Why there is no HTTP server by default

An earlier version of this project ran an Express server that bound `0.0.0.0`
with no authentication and exposed both filesystem and shell-exec endpoints —
anyone on the same network had full remote code execution. Filesystem and shell
access now go over Tauri IPC, which is in-process: no port, nothing to
authenticate. The control API is the one optional exception, and it is off
until you turn it on.

### Shared code

D-Net Lab code shared between programs is never a hand-edited fork. It is a
submodule pointing at the original repository, or a generated copy produced by
that project's own sync mechanism, so every program stays compatible and
current. DSS is the generated-copy case; see [Theming](#theming).

## Not done yet

- Drag-and-drop from Windows Explorer, file associations, "Open with"
  registration, global summon hotkey, tray
- Recursive folder copy in the explorer (files copy; folders need the terminal)
- LSP / autocomplete beyond CodeMirror's built-in word completion
- Custom window chrome — currently uses the native title bar
- Keyboard navigation between frames
- Reordering frames is a swap (drag one header onto another); free
  drag-to-reposition is not implemented

## Licence

[MIT](LICENSE) — © 2026 D-Net Lab.

Use it, fork it, ship it commercially. The one condition is attribution: the
copyright notice and licence text must travel with any copy or substantial
portion of the source.

### Name and branding

The MIT licence covers the **code**, not the **name**. "Arclight" and "D-Net
Lab", and the associated marks and logo, are not licensed with it.

You may say your work is *derived from* or *based on* Arclight by D-Net Lab —
that is the attribution the licence asks for. You may not name your fork or
product in a way that suggests it is published, endorsed, or maintained by
D-Net Lab, or otherwise present yourself as building under the D-Net Lab name.

Credit, not affiliation.
