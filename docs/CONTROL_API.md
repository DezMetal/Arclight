# Arclight Control API

Drive the workspace from anything that can make an HTTP request: your own
agents, scripts, local AI, or another D-Net Lab system.

The API reads and writes what is *inside* a frame, not just its geometry. An
agent can read the file you have open — including edits you have not saved —
watch a terminal's output, type into it, and move you around the workspace.

---

## Turning it on

**Settings → Control API → Enable.** The panel shows the address and the token.

Off by default, bound to `127.0.0.1` only, and every route but `/v1/health`
requires the token. Nothing listens until you switch it on.

```bash
export ARC=http://127.0.0.1:8787
export TOKEN=paste-from-settings
```

Verify it is up:

```bash
curl -s $ARC/v1/health
```

```json
{ "ok": true, "app": "arclight", "version": "0.1.2", "running": true }
```

The API also documents itself, so an agent holding the address and the token
needs nothing else:

```bash
curl -s -H "Authorization: Bearer $TOKEN" $ARC/v1/guide
```

That returns a condensed usage guide written for agents -- frames and tools,
why the editor buffer beats reading the file from disk, and the two errors
worth knowing about. It ships inside the binary, so it can never go stale
against the build you are actually talking to. This page stays the long form,
for people.

Every other call carries the token:

```bash
curl -s -H "Authorization: Bearer $TOKEN" $ARC/v1/state
```

`X-Arclight-Token: <token>` works too, if a bearer header is awkward.

---

## The model in one paragraph

The window is a tree of **frames**. Each frame shows one **tool** — explorer,
editor, terminal or settings — and keeps a separate context per tool, so a
frame remembers the directory its explorer was showing even while it displays
a terminal. Every frame has a stable **id**, shown in its header. That id is
what you address.

---

## Finding your way around

```bash
curl -s -H "Authorization: Bearer $TOKEN" $ARC/v1/frames
```

```json
[
  { "id": "frame_explorer", "tool": "file-explorer", "focused": false, "selected": false,
    "context": { "currentPath": "C:\\code\\arclight" } },
  { "id": "frame_editor", "tool": "editor", "focused": true, "selected": false,
    "context": { "filePath": "C:\\code\\arclight\\src\\App.tsx" } },
  { "id": "frame_terminal", "tool": "terminal", "focused": false, "selected": false,
    "context": { "terminalCwd": "C:\\code\\arclight", "shell": "cmd" } }
]
```

`/v1/state` returns the same list plus settings, which frame is focused, which
is selected, and the registered tools.

---

## Reading frame contents

```
GET /v1/frames/{id}/content
```

Served by the **live tool**, so you see what the user sees.

### Editor

```bash
curl -s -H "Authorization: Bearer $TOKEN" $ARC/v1/frames/frame_editor/content
```

```json
{
  "ok": true,
  "tool": "editor",
  "content": "export function main() {\n  return 42;\n}\n",
  "filePath": "C:\\code\\arclight\\src\\main.ts",
  "dirty": true,
  "lineCount": 3,
  "selection": { "from": 24, "to": 33, "text": "return 42" }
}
```

`dirty: true` means the buffer differs from disk. **Reading the file from disk
would have given you stale content** — this is the buffer.

### Terminal

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$ARC/v1/frames/frame_terminal/content?lines=20"
```

```json
{
  "ok": true,
  "tool": "terminal",
  "content": "C:\\code>npm test\n\n  17 passing\n\nC:\\code>",
  "alive": true,
  "cwd": "C:\\code",
  "shell": "cmd",
  "cols": 120,
  "rows": 30,
  "cursor": { "x": 8, "y": 4 }
}
```

The **rendered screen**, with escape sequences already applied and lines
wrapped — not raw PTY bytes.

| Query | Effect |
| --- | --- |
| *(none)* | The visible screen |
| `?lines=N` | The last N lines |
| `?scrollback=true` | The entire buffer |

### Explorer

```bash
curl -s -H "Authorization: Bearer $TOKEN" $ARC/v1/frames/frame_explorer/content
```

```json
{
  "ok": true,
  "tool": "file-explorer",
  "path": "C:\\code\\arclight",
  "parent": "C:\\code",
  "data": [
    { "name": "src", "path": "C:\\code\\arclight\\src", "type": "directory",
      "size": 0, "modified": 1786000000, "readonly": false, "symlink": false },
    { "name": "README.md", "path": "C:\\code\\arclight\\README.md", "type": "file",
      "size": 14203, "modified": 1786000123, "readonly": false, "symlink": false }
  ],
  "count": 2
}
```

`?all=true` ignores the active filter and the hidden-files setting.

---

## Writing to frame contents

```
POST /v1/frames/{id}/content
{ "action": "...", "payload": { ... } }
```

An unknown action returns the valid list, so the surface is discoverable
without the docs.

### Terminal actions

| Action | Payload | Does |
| --- | --- | --- |
| `command` | `{ "command": "npm test" }` | Types the line and presses Enter |
| `input` | `{ "data": "y" }` | Raw bytes, no Enter |
| `key` | `{ "key": "ctrl-c" }` | A named control point |
| `clear` | — | Clears the screen |
| `restart` | — | Restarts the shell in the same directory |

Keys: `enter` `tab` `backspace` `escape` `up` `down` `left` `right` `home`
`end` `pageup` `pagedown` `delete` `ctrl-c` `ctrl-d` `ctrl-l` `ctrl-z`.

Run a build, then read the result:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"action\":\"command\",\"payload\":{\"command\":\"npm test\"}}" $ARC/v1/frames/frame_terminal/content
```

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$ARC/v1/frames/frame_terminal/content?lines=40"
```

Answer a prompt the shell is waiting on:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"action\":\"input\",\"payload\":{\"data\":\"y\r\"}}" $ARC/v1/frames/frame_terminal/content
```

Interrupt a runaway process:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"action\":\"key\",\"payload\":{\"key\":\"ctrl-c\"}}" $ARC/v1/frames/frame_terminal/content
```

### Editor actions

| Action | Payload | Does |
| --- | --- | --- |
| `setContent` | `{ "content": "..." }` | Replaces the whole buffer |
| `insert` | `{ "text": "...", "at": 120 }` | Inserts at an offset; omit `at` for the cursor |
| `replace` | `{ "find": "a", "replace": "b", "all": true }` | Find and replace |
| `find` | `{ "query": "TODO" }` | Returns offsets and line numbers, changes nothing |
| `save` | — | Writes to disk |
| `open` | `{ "path": "C:/x/y.ts" }` | Opens another file in this frame |
| `reload` | — | Discards edits, re-reads from disk |

Find, patch, save:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"action\":\"find\",\"payload\":{\"query\":\"TODO\"}}" $ARC/v1/frames/frame_editor/content
```

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"action\":\"replace\",\"payload\":{\"find\":\"TODO\",\"replace\":\"DONE\",\"all\":true}}" $ARC/v1/frames/frame_editor/content
```

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"action\":\"save\"}" $ARC/v1/frames/frame_editor/content
```

Edits appear live in front of the user. With autosave on they reach disk on
their own, so `save` is only needed when you want it written *now*.

### Explorer actions

| Action | Payload |
| --- | --- |
| `navigate` | `{ "path": "src" }` — relative or absolute |
| `up` / `home` / `refresh` | — |
| `filter` | `{ "query": "test" }` |
| `select` | `{ "path": "..." }` |
| `open` | `{ "path": "...", "frameId": "...", "newFrame": true }` |
| `create` | `{ "kind": "file", "name": "notes.md" }` |

---

## Moving around the workspace

| Route | Method | Body |
| --- | --- | --- |
| `/v1/open` | POST | `{ path, frame_id?, new_frame?, direction? }` |
| `/v1/frames/split` | POST | `{ frame_id, direction, tool, context? }` |
| `/v1/frames/{id}/tool` | POST | `{ tool }` |
| `/v1/frames/{id}/close` | POST | — |
| `/v1/frames/{id}/select` | POST | — (`{id}` may be `none` to release) |
| `/v1/command` | POST | `{ command }` — any `dnet` command |

Open a file in a new frame:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"path\":\"C:/code/notes.md\",\"new_frame\":true}" $ARC/v1/open
```

Make a frame the standing target, after which everything you open lands there:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" $ARC/v1/frames/frame_editor/select
```

Add a terminal beside an existing frame — returns the new frame's id, which
you can address immediately:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"frame_id\":\"frame_editor\",\"direction\":\"vertical\",\"tool\":\"terminal\"}" $ARC/v1/frames/split
```

`/v1/command` runs the same `dnet` commands the terminal exposes and returns
their output as plain text, so scripted and typed control cannot drift apart:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"command\":\"frames\"}" $ARC/v1/command
```

---

## Watching for changes

`/v1/events` is a Server-Sent Events stream, so an agent can react instead of
polling.

```bash
curl -N -H "Authorization: Bearer $TOKEN" $ARC/v1/events
```

```
data: {"type":"frames","frames":[...]}
```

---

## A worked example

An agent that opens a file, edits it, runs the tests, and reads the result.

```python
"""Drive an Arclight workspace over the control API."""

import json
import time
import urllib.request

ARC = "http://127.0.0.1:8787"
TOKEN = "paste-from-settings"


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(f"{ARC}{path}", data=data, method=method)
    request.add_header("Authorization", f"Bearer {TOKEN}")
    if data:
        request.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read())


# Which frames are open?
frames = call("GET", "/v1/frames")
editor = next(f["id"] for f in frames if f["tool"] == "editor")
terminal = next(f["id"] for f in frames if f["tool"] == "terminal")

# Open a file, then read what is actually in the buffer.
call("POST", "/v1/open", {"path": "C:/code/arclight/src/main.ts", "frame_id": editor})
buffer = call("GET", f"/v1/frames/{editor}/content")
print(buffer["content"])

# Patch it and write it out.
call(
    "POST",
    f"/v1/frames/{editor}/content",
    {"action": "replace", "payload": {"find": "42", "replace": "43", "all": True}},
)
call("POST", f"/v1/frames/{editor}/content", {"action": "save"})

# Run the tests in the terminal the user is already looking at.
call(
    "POST",
    f"/v1/frames/{terminal}/content",
    {"action": "command", "payload": {"command": "npm test"}},
)
time.sleep(20)

print(call("GET", f"/v1/frames/{terminal}/content?lines=40")["content"])
```

Everything here happens in front of the user, in the window they are working
in. That is the point: the agent and the human share one workspace rather than
each holding a private copy of the state.

---

## Errors

| Status | Meaning |
| --- | --- |
| `401` | Missing or wrong token |
| `400` | The workspace rejected it — the body carries `error` |
| `503` | The workspace did not answer within 10 seconds |

Two worth knowing about:

- **`frame '<id>' is not mounted`** — reads and writes are served by the live
  tool, so a frame must currently be *showing* that tool. A frame displaying a
  terminal has no editor buffer to read. Switch it first with
  `POST /v1/frames/{id}/tool`.
- **`no frame '<id>'`** — the id is gone. Frame ids are stable while a frame
  exists but are never reused; re-read `/v1/frames`.

---

## Security

This API edits files and runs shell commands. It is built to be closed:

- **Off by default.** Nothing listens until you enable it.
- **Loopback only** unless you deliberately allow remote clients. That toggle
  is marked in red, because anyone who can reach the machine and holds the
  token gets your filesystem and a shell.
- **Token compared in constant time**, so it cannot be recovered by timing
  responses.
- **Rotate it** from Settings at any time; the old token stops working
  immediately.

Treat the token like an SSH key. If you route through
[dnet-api-node](https://github.com/DezMetal/dnet-api-node), the gateway holds
the Arclight token and callers only ever present their own key.
