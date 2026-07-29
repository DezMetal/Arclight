# Dev Workspace

A tiled workspace that aims to replace your file explorer, editor, terminal and IDE
with one lightweight program.

> **Status: pre-alpha, under active rebuild.** The current tree is a browser app
> served by a local Node server. It is being ported to a Tauri desktop shell with a
> real PTY. Do not rely on it for daily work yet — see [Known limitations](#known-limitations).

## Concept

The workspace is a tree of **panes**. Any pane can host any **tool**, and any pane can
be split horizontally or vertically. Tools currently registered:

| Tool | Type id | What it does |
| --- | --- | --- |
| File Explorer | `file-explorer` | Browse the real filesystem, create/rename/delete, open externally |
| Code Editor | `editor` | Edit files, autosave, find-in-file |
| Terminal | `terminal` | Shell session on the host OS |
| Settings | `settings` | Theme, font size, workspace preferences |

Layout and settings persist to `localStorage` under `dev_workspace_layout` and
`dev_workspace_settings`.

## Running it

**Prerequisites:** Node.js 22+

```bash
npm install
```

```bash
npm run dev
```

Then open <http://localhost:3000>.

Other scripts:

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite in middleware mode behind the Express API server |
| `npm run build` | Bundle frontend to `dist/` and server to `dist/server.cjs` |
| `npm start` | Run the production bundle |
| `npm run lint` | Typecheck with `tsc --noEmit` |
| `npm run clean` | Remove `dist/` |

## Architecture (current)

```
index.html
  └── src/main.tsx
        └── src/App.tsx                  registers the four tools
              └── WorkspaceContext       layout tree, settings, pane registry, event bus
                    └── LayoutManager    recursive split/resize renderer
                          └── <tool panes>

server.ts        Express + Vite middleware + WebSocket terminal, port 3000
pty_bridge.py    Unix-only PTY helper spawned by server.ts (unused on Windows)
```

The frontend talks to the backend over `/api/*` REST endpoints and one WebSocket at
`/api/terminal/ws`.

### Custom commands

`src/lib/customCommands.ts` defines the `dnet <command>` suite available inside the
terminal — `dnet help`, `dnet edit <file>`, `dnet theme <name>`, `dnet panes`, and
others. Each command receives a context object exposing the current working directory,
the pane id, the full workspace API, a `print()` helper, and `executeRaw()` for
shelling out. See the header comment in that file for how to add one.

## Known limitations

These are the reasons this is not yet a daily driver. Each is tracked for the rebuild.

- **The Windows terminal is not a real PTY.** `server.ts` spawns `cmd.exe` over plain
  pipes and emulates a line editor in Node — echo, backspace and history are simulated,
  and left/right arrows are discarded. Interactive programs (Python REPL, `ssh`, `vim`,
  `git commit`, progress bars, password prompts) do not work. Tab completion does not work.
- **Working-directory tracking is Linux-only.** It reads `/proc/<pid>/cwd`, so the path
  indicator never updates on Windows.
- **Terminal sessions are fragile.** A session survives unmount for only 3 seconds, and
  changing the font size tears down and reconnects the shell.
- **Custom commands are dispatched by scanning terminal stdout for a sentinel string.**
  This misfires on chunk boundaries and on any output containing the sentinel.
- **The editor is a `<textarea>`.** No syntax highlighting, no multi-cursor, no LSP.
- **Theming overrides Tailwind class names with `!important`.** Components using an
  unlisted colour silently escape the theme, and the terminal's colours are hardcoded
  separately from the theme system.
- **The server binds `0.0.0.0` with no authentication** and exposes filesystem and shell
  endpoints. Anyone on the same network has full access. Do not run this on an untrusted
  network in its current form.

## Licence

Unlicensed / private.
