import React, { useCallback, useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon, Trash2, RotateCcw, Copy } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

import { useWorkspace } from "../context/WorkspaceContext";
import type { ToolProps } from "../types";
import { pty, errorText, type ShellOption } from "../lib/api";
import { readTerminalTheme } from "../lib/terminalTheme";
import { runCustomCommand, matchCustomCommand, COMMAND_PREFIX } from "../lib/customCommands";
import { consumeChunk, initialState, ESC, CR, LF, BACKSPACE, CTRL_C } from "../lib/terminalInput";
import { registerFrameHandler } from "../lib/frameBus";

/** Back up one column, overwrite with a space, back up again. */
const ERASE = "\b \b";

const RED = 31;
const YELLOW = 33;

/** Wrap text in an SGR colour so status lines stand out in the scrollback. */
const sgr = (code: number, text: string) => `${ESC}[${code}m${text}${ESC}[0m`;

/**
 * A view onto a shell session that lives in the Rust backend.
 *
 * The component owns no shell state. Unmounting detaches; it does not kill.
 * A layout change, a tool switch, a hot reload or a font-size change therefore
 * leave the shell running, and remounting replays its scrollback.
 */
export const TerminalPane: React.FC<ToolProps> = ({ frameId, context, setContext }) => {
  const workspace = useWorkspace();
  const { settings } = workspace;

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionId = `pty-${frameId}`;

  const [cwd, setCwd] = useState<string>(context.terminalCwd ?? "");
  const [alive, setAlive] = useState(false);
  const [shells, setShells] = useState<ShellOption[]>([]);
  const [shell, setShell] = useState<string>(context.shell ?? "cmd");
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
    setContext({ terminalCwd: cwd, shell });
  }, [cwd, shell, setContext]);

  // --- session lifecycle ---------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let attachment: number | undefined;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: 'JetBrains Mono, Consolas, "Courier New", monospace',
      fontSize: settings.fontSize ?? 13,
      lineHeight: 1.25,
      scrollback: 10000,
      allowProposedApi: true,
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
      /* not laid out yet; sizes are clamped below */
    }

    const decoder = new TextDecoder("utf-8", { fatal: false });

    // A frame created by a split has not been laid out when this runs, so
    // fit() reports 0 columns. Handing ConPTY a zero-size window leaves the
    // shell running but never drawing.
    const cols = Math.max(term.cols || 0, 20);
    const rows = Math.max(term.rows || 0, 5);

    const startCwd = cwdRef.current || context.terminalCwd || undefined;

    pty
      .spawn({ id: sessionId, cwd: startCwd, cols, rows, shell }, (bytes) => {
        if (!disposed) term.write(decoder.decode(bytes, { stream: true }));
      })
      .then((info) => {
        attachment = info.attachment;
        // Unmounted while the spawn was in flight: release immediately, or the
        // session keeps a sink pointing at a disposed terminal.
        if (disposed) {
          void pty.detach(sessionId, attachment);
          return;
        }
        setAlive(true);
        setCwd(info.cwd);
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
        term.write(CR + LF + sgr(RED, errorText(err)) + CR + LF);
        setAlive(false);
      });

    // --- input -------------------------------------------------------------
    //
    // Routing lives in lib/terminalInput.ts, which is pure and unit tested.
    // Keeping it out of here is deliberate: this decision has been wrong twice
    // and its symptom is misleading -- a leak surfaces as the shell reporting
    // "'dnet' is not recognized", which reads like a PATH problem.
    let inputState = initialState();

    const send = (text: string) => {
      void pty.write(sessionId, text).catch(() => setAlive(false));
    };

    const execute = (commandLine: string) => {
      const matched = matchCustomCommand(commandLine);
      if (!matched) {
        // Not a command after all; hand it over rather than swallow it.
        send(commandLine + CR);
        return;
      }

      term.write(CR + LF);
      void runCustomCommand(matched, {
        cwd: cwdRef.current,
        frameId,
        sessionId,
        workspace: workspaceRef.current,
        print: (text) => term.write(text.split("\n").join(CR + LF)),
      }).finally(() => {
        // The shell never saw the command, so nudge it to redraw its prompt.
        send(CR);
      });
    };

    const dataSub = term.onData((data) => {
      const step = consumeChunk(inputState, data, COMMAND_PREFIX);
      inputState = step.state;

      for (const fx of step.effects) {
        if (fx.erase > 0) term.write(ERASE.repeat(fx.erase));
        if (fx.echo) term.write(fx.echo);
        if (fx.send) send(fx.send);
        if (fx.execute !== undefined) execute(fx.execute);
      }
    });

    const resizeSub = term.onResize(({ cols: c, rows: r }) => {
      void pty.resize(sessionId, c, r).catch(() => {});
    });

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* frame collapsed or hidden */
      }
    });
    observer.observe(container);

    return () => {
      disposed = true;
      observer.disconnect();
      dataSub.dispose();
      resizeSub.dispose();
      // Detach, do not kill. The shell keeps running and keeps buffering;
      // remounting replays what it missed.
      void pty.detach(sessionId, attachment);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // settings.fontSize is deliberately absent: it is applied in place below
    // rather than by rebuilding the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameId, sessionId, shell, generation]);

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
    const id = requestAnimationFrame(() => {
      term.options.theme = readTerminalTheme();
    });
    return () => cancelAnimationFrame(id);
    // Presets move the palette as well as themes do.
  }, [settings.theme, settings.preset]);

  // Working directory, reported by the shell itself via OSC.
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
      termRef.current?.write(CR + LF + sgr(YELLOW, "[shell exited]") + CR + LF);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [sessionId]);

  // External "cd here" requests from the explorer.
  useEffect(() => {
    const unsubscribe = workspace.subscribeEvent(
      "change-terminal-cwd",
      (data: { path?: string; frameId?: string }) => {
        if (!data?.path) return;
        if (data.frameId && data.frameId !== frameId) return;
        void pty.write(sessionId, `cd /d "${data.path}"${CR}`);
      },
    );
    return unsubscribe;
  }, [workspace, frameId, sessionId]);

  const restart = useCallback(async () => {
    const here = cwdRef.current;
    termRef.current?.write(
      CR + LF + sgr(YELLOW, `restarting shell${here ? ` in ${here}` : ""}...`) + CR + LF,
    );
    await pty.kill(sessionId).catch(() => {});
    // The remounted effect reads cwdRef, so the new shell opens where the old
    // one was rather than back at the home directory.
    setGeneration((g) => g + 1);
  }, [sessionId]);

  const copySelection = useCallback(async () => {
    const selection = termRef.current?.getSelection();
    if (selection) await navigator.clipboard.writeText(selection);
  }, []);

  // --- control API surface -------------------------------------------------
  //
  // Reads the rendered screen rather than raw PTY bytes, so a caller sees what
  // the user sees: escape sequences already applied, lines already wrapped.
  useEffect(() => {
    return registerFrameHandler(frameId, {
      tool: "terminal",

      read: (options) => {
        const term = termRef.current;
        if (!term) return { tool: "terminal", content: "", alive: false };

        const buffer = term.buffer.active;
        const includeScrollback = Boolean(options?.scrollback);
        const requested = Number(options?.lines);

        const end = buffer.baseY + term.rows;
        let start = includeScrollback ? 0 : buffer.baseY;
        if (Number.isFinite(requested) && requested > 0) {
          start = Math.max(0, end - requested);
        }

        const lines: string[] = [];
        for (let i = start; i < end; i += 1) {
          // translateToString(true) trims the right padding xterm keeps for
          // fixed-width cells, which would otherwise be a wall of spaces.
          lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
        }

        // Trailing blank lines are just unused rows, not content.
        while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();

        return {
          tool: "terminal",
          content: lines.join("\n"),
          alive,
          cwd: cwdRef.current,
          shell,
          cols: term.cols,
          rows: term.rows,
          cursor: { x: buffer.cursorX, y: buffer.cursorY },
          selection: term.getSelection() || null,
        };
      },

      write: async (action, payload) => {
        const term = termRef.current;
        switch (action) {
          case "input":
            // Raw bytes, exactly as typing would produce.
            await pty.write(sessionId, String(payload.data ?? ""));
            return { ok: true };

          case "command": {
            // A whole command line plus Enter, the common case for an agent.
            const text = String(payload.command ?? "");
            await pty.write(sessionId, text + CR);
            return { ok: true };
          }

          case "key": {
            // Named control points, so callers need not know byte values.
            const keys: Record<string, string> = {
              enter: CR,
              tab: "\t",
              backspace: BACKSPACE,
              escape: ESC,
              up: `${ESC}[A`,
              down: `${ESC}[B`,
              right: `${ESC}[C`,
              left: `${ESC}[D`,
              home: `${ESC}[H`,
              end: `${ESC}[F`,
              pageup: `${ESC}[5~`,
              pagedown: `${ESC}[6~`,
              delete: `${ESC}[3~`,
              "ctrl-c": CTRL_C,
              "ctrl-d": String.fromCharCode(4),
              "ctrl-l": String.fromCharCode(12),
              "ctrl-z": String.fromCharCode(26),
            };
            const name = String(payload.key ?? "").toLowerCase();
            const seq = keys[name];
            if (!seq) {
              return { error: `unknown key '${name}'`, available: Object.keys(keys) };
            }
            await pty.write(sessionId, seq);
            return { ok: true };
          }

          case "clear":
            term?.clear();
            return { ok: true };

          case "restart":
            await restart();
            return { ok: true };

          default:
            return {
              error: `unknown terminal action '${action}'`,
              available: ["input", "command", "key", "clear", "restart"],
            };
        }
      },
    });
  }, [frameId, sessionId, alive, shell, restart]);

  return (
    <div
      onMouseDown={() => termRef.current?.focus()}
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
            className="truncate text-[11px]"
            style={{ color: "var(--dss-text-dim)", fontFamily: "var(--dss-font-mono)" }}
            title={cwd}
          >
            {cwd || "..."}
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
