import React, { useCallback, useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon, Trash2, RotateCcw, Copy } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

import { useWorkspace } from "../context/WorkspaceContext";
import { pty, errorText, type ShellOption } from "../lib/api";
import { readTerminalTheme } from "../lib/terminalTheme";
import { runCustomCommand, matchCustomCommand, COMMAND_PREFIX } from "../lib/customCommands";

/**
 * The terminal is a view onto a session that lives in the Rust backend.
 *
 * The component owns no shell state. Unmounting detaches; it does not kill.
 * That is why a layout change, a hot reload, or a font-size change no longer
 * destroys your shell — the previous implementation kept sessions in a module
 * map guarded by a 3-second timer and tore down on any of those.
 */
export const TerminalPane: React.FC<{
  paneId: string;
  state: { terminalCwd?: string; shell?: string };
  updateState: (state: Record<string, unknown>) => void;
}> = ({ paneId, state, updateState }) => {
  const workspace = useWorkspace();
  const { settings, setActivePaneId } = workspace;

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionId = `pty-${paneId}`;

  const [cwd, setCwd] = useState(state.terminalCwd ?? "");
  const [alive, setAlive] = useState(false);
  const [shells, setShells] = useState<ShellOption[]>([]);
  const [shell, setShell] = useState(state.shell ?? "cmd");
  const [generation, setGeneration] = useState(0);

  // Latest values for use inside long-lived xterm callbacks, which capture
  // their closure once at mount.
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  useEffect(() => {
    pty.availableShells().then(setShells).catch(() => setShells([]));
  }, []);

  useEffect(() => {
    updateState({ terminalCwd: cwd, shell });
  }, [cwd, shell, updateState]);

  // --- session lifecycle ---------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: 'JetBrains Mono, Consolas, "Courier New", monospace',
      fontSize: settings.fontSize ?? 13,
      lineHeight: 1.25,
      letterSpacing: 0,
      scrollback: 10000,
      allowProposedApi: true,
      macOptionIsMeta: true,
      theme: readTerminalTheme(),
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);

    termRef.current = term;
    fitRef.current = fit;

    try {
      fit.fit();
    } catch {
      /* container not laid out yet; sizes are clamped below */
    }

    const decoder = new TextDecoder("utf-8", { fatal: false });

    // A pane created by a split has not been laid out when this runs, so
    // fit() reports 0 columns. Handing ConPTY a zero-size window leaves the
    // shell started but never drawing — which looked like "the terminal never
    // starts". Clamp to a usable size; the ResizeObserver corrects it as soon
    // as the split has real dimensions.
    const cols = Math.max(term.cols || 0, 20);
    const rows = Math.max(term.rows || 0, 5);

    pty
      .spawn(
        {
          id: sessionId,
          cwd: state.terminalCwd || undefined,
          cols,
          rows,
          shell,
        },
        (bytes) => {
          if (!disposed) term.write(decoder.decode(bytes, { stream: true }));
        },
      )
      .then((info) => {
        if (disposed) return;
        setAlive(true);
        setCwd(info.cwd);
        // Re-fit once the browser has laid the pane out for real.
        requestAnimationFrame(() => {
          if (disposed) return;
          try {
            fit.fit();
          } catch {
            /* still not laid out */
          }
        });
      })
      .catch((err) => {
        if (disposed) return;
        term.write(`\r\n\x1b[31m${errorText(err)}\x1b[0m\r\n`);
        setAlive(false);
      });

    // Keystrokes.
    //
    // A `dnet` line must never reach the shell, or cmd answers with "'dnet' is
    // not recognized". Since we cannot know what a line is until enough of it
    // is typed, input at the start of a line is *held* while it could still
    // become `dnet`, echoed locally so typing feels immediate. The moment it
    // cannot be, the held characters are flushed to the shell and we go back to
    // pass-through for the rest of the line.
    //
    // Worst case is four held characters, and only at a line start.
    type Phase = "holding" | "passthrough" | "command";
    let phase: Phase = "holding";
    let held = "";
    let line = "";

    const send = (data: string) => {
      void pty.write(sessionId, data).catch(() => setAlive(false));
    };

    /** Give up on `dnet`: erase the local echo and hand the shell everything. */
    const flushHeld = (andThen: string) => {
      if (held) term.write("\b \b".repeat(held.length));
      const payload = held + andThen;
      held = "";
      phase = "passthrough";
      if (payload) send(payload);
    };

    const execute = () => {
      const matched = matchCustomCommand(line);
      line = "";
      held = "";
      phase = "holding";
      if (!matched) return;

      term.write("\r\n");
      void runCustomCommand(matched, {
        cwd: cwdRef.current,
        paneId,
        sessionId,
        workspace: workspaceRef.current,
        print: (text) => term.write(text.replace(/\r?\n/g, "\r\n")),
      }).finally(() => {
        // The shell never saw the command, so nudge it to redraw its prompt.
        send("\r");
      });
    };

    const dataSub = term.onData((data) => {
      // Escape sequences and pastes are never dnet commands.
      if (data.startsWith("\x1b") || data.length > 1) {
        if (phase === "command") {
          if (data.startsWith("\x1b")) return; // ignore arrows mid-command
          line += data;
          term.write(data);
          return;
        }
        flushHeld(data);
        return;
      }

      if (phase === "command") {
        if (data === "\r") {
          execute();
        } else if (data === "\x7f") {
          if (line.length > 0) {
            line = line.slice(0, -1);
            term.write("\b \b");
          }
          if (line.length === 0) phase = "holding";
        } else if (data === "\x03") {
          term.write("^C\r\n");
          line = "";
          held = "";
          phase = "holding";
          send("\r");
        } else if (data >= " ") {
          line += data;
          term.write(data);
        }
        return;
      }

      if (phase === "passthrough") {
        if (data === "\r") phase = "holding";
        send(data);
        return;
      }

      // phase === "holding"
      if (data === "\r") {
        if (held === COMMAND_PREFIX) {
          line = held;
          execute();
        } else {
          flushHeld("\r");
          phase = "holding";
        }
        return;
      }

      if (data === "\x7f") {
        if (held.length > 0) {
          held = held.slice(0, -1);
          term.write("\b \b");
        } else {
          send(data);
        }
        return;
      }

      if (data === "\x03") {
        if (held) term.write("\b \b".repeat(held.length));
        held = "";
        send(data);
        return;
      }

      if (data < " ") {
        flushHeld(data);
        return;
      }

      const candidate = held + data;
      if (candidate === `${COMMAND_PREFIX} ` || candidate.startsWith(`${COMMAND_PREFIX} `)) {
        // Confirmed ours for the rest of this line.
        phase = "command";
        line = candidate;
        held = "";
        term.write(data);
      } else if (COMMAND_PREFIX.startsWith(candidate)) {
        // Still could be `dnet` — hold and echo.
        held = candidate;
        term.write(data);
      } else {
        flushHeld(data);
      }
    });

    const resizeSub = term.onResize(({ cols, rows }) => {
      void pty.resize(sessionId, cols, rows).catch(() => {});
    });

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* pane is collapsed or hidden */
      }
    });
    observer.observe(container);

    return () => {
      disposed = true;
      observer.disconnect();
      dataSub.dispose();
      resizeSub.dispose();
      // Detach, do not kill. The shell keeps running in the backend and keeps
      // buffering output; remounting replays it.
      void pty.detach(sessionId);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // `settings.fontSize` is deliberately absent: font changes are applied
    // in place below rather than by rebuilding the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, sessionId, shell, generation]);

  // Font size applied without touching the session.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = settings.fontSize ?? 13;
    try {
      fitRef.current?.fit();
    } catch {
      /* ignore */
    }
  }, [settings.fontSize]);

  // Theme applied without touching the session.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    // Wait a frame so the theme class is on <body> before variables are read.
    const id = requestAnimationFrame(() => {
      term.options.theme = readTerminalTheme();
    });
    return () => cancelAnimationFrame(id);
  }, [settings.theme]);

  // Working directory, reported by the shell itself.
  useEffect(() => {
    const unlisten = pty.onCwdChange(({ id, cwd: next }) => {
      if (id === sessionId) setCwd(next);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [sessionId]);

  useEffect(() => {
    const unlisten = pty.onExit(({ id }) => {
      if (id !== sessionId) return;
      setAlive(false);
      termRef.current?.write("\r\n\x1b[33m[shell exited]\x1b[0m\r\n");
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [sessionId]);

  // External "cd here" requests from the file explorer.
  useEffect(() => {
    const unsubscribe = workspace.subscribeEvent(
      "change-terminal-cwd",
      (data: { path?: string; paneId?: string }) => {
        if (!data?.path) return;
        if (data.paneId && data.paneId !== paneId) return;
        void pty.write(sessionId, `cd /d "${data.path}"\r`);
      },
    );
    return unsubscribe;
  }, [workspace, paneId, sessionId]);

  const restart = useCallback(async () => {
    termRef.current?.write("\r\n\x1b[33mrestarting shell…\x1b[0m\r\n");
    await pty.kill(sessionId).catch(() => {});
    setGeneration((g) => g + 1);
  }, [sessionId]);

  const copySelection = useCallback(async () => {
    const selection = termRef.current?.getSelection();
    if (selection) await navigator.clipboard.writeText(selection);
  }, []);

  return (
    <div
      onMouseDown={() => {
        setActivePaneId(paneId);
        termRef.current?.focus();
      }}
      className="h-full flex flex-col overflow-hidden"
      style={{ backgroundColor: "var(--term-bg)" }}
    >
      <header
        className="dss-chrome flex items-center justify-between gap-2 px-2 py-1 flex-shrink-0"
        style={{
          backgroundColor: "var(--dss-bg-panel)",
          borderBottom: "1px solid var(--dss-border-soft)",
        }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <TerminalIcon
            size={12}
            style={{ color: alive ? "var(--dss-accent)" : "var(--dss-text-faint)" }}
            className="flex-shrink-0"
          />
          <span
            className="dss-label truncate"
            style={{ color: "var(--dss-text-dim)", textTransform: "none", letterSpacing: 0 }}
            title={cwd}
          >
            {cwd || "…"}
          </span>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {shells.length > 1 && (
            <select
              className="dss-input"
              style={{ width: "auto", padding: "1px 4px", fontSize: 10 }}
              value={shell}
              onChange={(e) => setShell(e.target.value)}
              title="Shell"
            >
              {shells.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
          <span
            className="dss-label"
            style={{
              color: alive ? "var(--dss-accent)" : "var(--dss-destructive)",
              fontSize: 9,
            }}
          >
            {alive ? "pty" : "dead"}
          </span>
          <button className="dss-icon-button" onClick={copySelection} title="Copy selection">
            <Copy size={11} />
          </button>
          <button
            className="dss-icon-button"
            onClick={() => termRef.current?.clear()}
            title="Clear"
          >
            <Trash2 size={11} />
          </button>
          <button className="dss-icon-button" onClick={restart} title="Restart shell">
            <RotateCcw size={11} />
          </button>
        </div>
      </header>

      <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden dss-selectable" />
    </div>
  );
};
