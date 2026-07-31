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

Artifacts are copied to `dist-release/` with versioned names:

- `Arclight-<version>-portable.exe` — single file, run it anywhere, no install
- `Arclight-<version>-setup.exe` — NSIS installer, adds Start Menu entry and uninstaller

A release build takes roughly six minutes; LTO and `codegen-units = 1` are on
deliberately, which is what keeps the binary near 4 MB.

### Distribution notes

Builds are **unsigned**. Windows SmartScreen will warn on a downloaded binary
until either the certificate or the file itself accumulates reputation; users
reach the app through *More info → Run anyway*. For a public repository,
[SignPath](https://signpath.io/) grants free certificates to open-source
projects, which removes the warning without cost.

The installer uses Tauri's `downloadBootstrapper` mode for WebView2, so it
fetches the runtime if the target machine lacks it. Windows 11 always has it;
some Windows 10 machines do not and will need to be online during install.

## The workspace model

The window is a tree of **panes**. Any pane can host any **tool**, and any pane
can split horizontally or vertically without limit.

| Tool | What it does |
| --- | --- |
| **Explorer** | Browse the real filesystem — drives, breadcrumbs, filter, create, rename, delete, cut/copy/paste, reveal in Windows Explorer |
| **Editor** | CodeMirror 6 — syntax highlighting for ~100 languages, multi-cursor, folding, search, autosave |
| **Terminal** | A real shell, via ConPTY |
| **Settings** | Theme, font size, tab size, autosave, layout |

Pane headers carry the tool selector, split controls, maximize and close. The
focused pane is the one with the accent glow around it. Layout and settings
persist to `localStorage` under `arclight_layout` and `arclight_settings`.

## The terminal

This is a genuine PTY, not a pipe with a line editor bolted on. ConPTY on
Windows via `portable-pty`, which means tab completion, arrow keys, readline,
and every interactive program works: Python REPL, `ssh`, `vim`, `git commit`,
progress bars, password prompts.

**Sessions live in the Rust backend, not in the UI.** A pane can unmount, the
webview can hot-reload, the layout can be rearranged, the font size can change —
the shell keeps running and keeps buffering output. Reattaching replays
scrollback so the pane looks exactly as it did. Killing a shell is something you
do deliberately, with the restart button.

`cmd.exe` is the default. PowerShell, PowerShell 7 and Git Bash are offered in
the pane header when they are installed.

Working directory is reported by the shell itself through OSC 9;9 (Windows) or
OSC 7 (POSIX), parsed out of the PTY stream with a scanner that handles
sequences split across read boundaries.

## The `dnet` command suite

Type `dnet <command>` in any terminal pane to drive the workspace. These are
matched on the input line before a byte reaches the shell.

| Command | Does |
| --- | --- |
| `dnet help` | List every command |
| `dnet edit <file> [-h\|-v]` | Open a file in a new editor split |
| `dnet open <file>` | Open a file in the active editor |
| `dnet term [-h\|-v]` | New terminal split at this directory |
| `dnet explore [-h\|-v]` | New explorer split at this directory |
| `dnet reveal [path]` | Show in Windows Explorer |
| `dnet theme <dnet\|arc\|light>` | Switch theme |
| `dnet font <size>` | Set interface font size |
| `dnet new <file\|dir> <path>` | Create something |
| `dnet panes` | List panes and their ids |
| `dnet close <paneId>` | Close a pane |
| `dnet layout reset` | Restore the default layout |
| `dnet sessions` | List running shells |
| `dnet info` | Host and workspace details |
| `dnet calc <expr>` | Arithmetic |

Adding your own is a single object appended to `CUSTOM_COMMANDS` in
[`src/lib/customCommands.ts`](src/lib/customCommands.ts) — the file header
documents the context object each command receives.

## Theming

Theming is driven by **semantic design tokens** in
[`src/styles/dss.css`](src/styles/dss.css), derived from the D-Net Signature
Stylesheet and retuned for IDE density. Three themes ship:

- **D-Net** — the signature palette, softer, built for long sessions
- **Arc** — full-intensity DSS cyan
- **Alabaster** — light

Every surface reads the same variables, *including* the terminal's 16-colour
ANSI palette and the editor's syntax highlighting. A theme switch moves
everything at once. Adding a theme means adding one token block — no component
changes, and no `!important` anywhere.

## Architecture

```
src-tauri/
  src/main.rs        Entry point
  src/lib.rs         Command registration
  src/pty.rs         PTY sessions, scrollback, OSC cwd parsing
  src/fs_api.rs      Filesystem commands, Windows path handling
  src/sysinfo.rs     Host details

src/
  main.tsx           React entry
  App.tsx            Registers the four tools
  context/           Layout tree, settings, pane registry, event bus
  components/        LayoutManager + the four tool panes
  lib/api.ts         The only place the UI talks to the backend
  lib/customCommands.ts
  lib/terminalTheme.ts, lib/editorTheme.ts
  styles/dss.css     Design tokens and signature primitives

tools/generate_icons.py   Draws the icon set with Pillow
```

The frontend never calls `invoke` directly outside `lib/api.ts`, so the
transport can change without touching a component.

### Why there is no server

An earlier version of this project ran an Express server that bound `0.0.0.0`
with no authentication and exposed both filesystem and shell-exec endpoints —
anyone on the same network had full remote code execution. Tauri IPC is
in-process. There is no port to reach and nothing to authenticate.

## Not done yet

- Drag-and-drop from Windows Explorer, file associations, "Open with"
  registration, global summon hotkey, tray
- Recursive folder copy in the explorer (files copy; folders need the terminal)
- LSP / autocomplete beyond CodeMirror's built-in word completion
- Custom window chrome — currently uses the native title bar
- Split-pane keyboard navigation

## Licence

Private. © D-Net Lab.
