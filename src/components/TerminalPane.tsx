import React, { useCallback, useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon, Trash2, RotateCcw, Copy } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

import { useWorkspace } from "../context/WorkspaceContext";
import { pty, errorText, type ShellOption } from "../lib/api";
import { readTerminalTheme } from "../lib/terminalTheme";
import { runCustomCommand, matchCustomCommand } from "../lib/customCommands";

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
      /* container not laid out yet; the ResizeObserver will catch it */
    }

    const decoder = new TextDecoder("utf-8", { fatal: false });

    pty
      .spawn(
        {
          id: sessionId,
          cwd: state.terminalCwd || undefined,
          cols: term.cols,
          rows: term.rows,
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
      })
      .catch((err) => {
        if (disposed) return;
        term.write(`\r\n\x1b[31m${errorText(err)}\x1b[0m\r\n`);
        setAlive(false);
      });

    // Keystrokes. Custom commands are intercepted here, on the input side,
    // before bytes ever reach the shell — the old approach scanned the shell's
    // *output* for a sentinel string, which misfired whenever a chunk boundary
    // split the marker or a file containing it was printed.
    let lineBuffer = "";
    const dataSub = term.onData((data) => {
      if (data === "\r") {
        const command = matchCustomCommand(lineBuffer);
        if (command) {
          lineBuffer = "";
          term.write("\r\n");
          void runCustomCommand(command, {
            cwd: cwdRef.current,
            paneId,
            sessionId,
            workspace: workspaceRef.current,
            print: (text) => term.write(text.replace(/\r?\n/g, "\r\n")),
          }).finally(() => {
            // Redraw the shell's prompt so the line the user is on stays real.
            void pty.write(sessionId, "\r");
          });
          return;
        }
        lineBuffer = "";
      } else if (data === "\x7f") {
        lineBuffer = lineBuffer.slice(0, -1);
      } else if (data === "\x03" || data === "\x1b") {
        lineBuffer = "";
      } else if (data >= " ") {
        lineBuffer += data;
      }

      void pty.write(sessionId, data).catch(() => setAlive(false));
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
