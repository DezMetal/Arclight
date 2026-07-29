import React, { useState, useEffect, useRef } from "react";
import { Terminal as TerminalIcon, Trash2, RotateCcw } from "lucide-react";
import { useWorkspace } from "../context/WorkspaceContext";
import { CUSTOM_COMMANDS, CommandContext } from "../lib/customCommands";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalSession {
  term: Terminal;
  fitAddon: FitAddon;
  socket: WebSocket;
  cwd: string;
  connected: boolean;
  cleanupTimeoutId?: any;
  onCwdChange?: (cwd: string) => void;
  onConnectChange?: (connected: boolean) => void;
}

const activeSessions: Record<string, TerminalSession> = {};

export const TerminalPane: React.FC<{
  paneId: string;
  state: { terminalCwd?: string };
  updateState: (state: any) => void;
}> = ({ paneId, state, updateState }) => {
  const workspace = useWorkspace();
  const { settings, setActivePaneId } = workspace;
  const [cwd, setCwd] = useState<string>(state.terminalCwd || ".");
  const [connected, setConnected] = useState(false);
  const [reconnectTrigger, setReconnectTrigger] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  // Sync state up
  useEffect(() => {
    updateState({ terminalCwd: cwd });
  }, [cwd, updateState]);

  // Connect/disconnect lifecycle
  useEffect(() => {
    if (!containerRef.current) return;

    let term: Terminal;
    let fitAddon: FitAddon;
    let socket: WebSocket;
    let isReused = false;

    const session = activeSessions[paneId];
    if (session) {
      isReused = true;
      if (session.cleanupTimeoutId) {
        clearTimeout(session.cleanupTimeoutId);
        session.cleanupTimeoutId = undefined;
      }
      
      term = session.term;
      fitAddon = session.fitAddon;
      socket = session.socket;
      
      setCwd(session.cwd);
      setConnected(session.connected);

      // Update active state setters
      session.onCwdChange = (newCwd) => setCwd(newCwd);
      session.onConnectChange = (newConnected) => setConnected(newConnected);

      // Re-attach to the new DOM container
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
        if (term.element) {
          containerRef.current.appendChild(term.element);
        } else {
          term.open(containerRef.current);
        }
      }
      fitAddon.fit();

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;
      socketRef.current = socket;
    } else {
      // 1. Initialize xterm.js with high readability
      term = new Terminal({
        cursorBlink: true,
        fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, "Courier New", monospace',
        fontSize: settings.fontSize || 12,
        lineHeight: 1.2,
        convertEol: true,
        theme: {
          background: "#020617", // slate-950
          foreground: "#cbd5e1", // slate-300
          cursor: "#10b981",     // emerald-500
          cursorAccent: "#020617",
          selectionBackground: "rgba(148, 163, 184, 0.3)", // slate-400 with opacity
          black: "#0f172a",
          red: "#f43f5e",
          green: "#10b981",
          yellow: "#eab308",
          blue: "#3b82f6",
          magenta: "#d946ef",
          cyan: "#06b6d4",
          white: "#f8fafc",
          brightBlack: "#475569",
          brightRed: "#fda4af",
          brightGreen: "#34d399",
          brightYellow: "#fef08a",
          brightBlue: "#60a5fa",
          brightMagenta: "#f472b6",
          brightCyan: "#67e8f9",
          brightWhite: "#ffffff"
        },
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      term.open(containerRef.current);
      fitAddon.fit();

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;

      // 2. Establish WebSocket connection
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/api/terminal/ws?paneId=${paneId}&cwd=${encodeURIComponent(cwd)}&cols=${term.cols}&rows=${term.rows}`;

      socket = new WebSocket(wsUrl);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      activeSessions[paneId] = {
        term,
        fitAddon,
        socket,
        cwd,
        connected: false,
        onCwdChange: (newCwd) => setCwd(newCwd),
        onConnectChange: (newConnected) => setConnected(newConnected),
      };

      socket.onopen = () => {
        const sess = activeSessions[paneId];
        if (sess) {
          sess.connected = true;
          sess.onConnectChange?.(true);
        } else {
          setConnected(true);
        }
      };

      socket.onclose = () => {
        const sess = activeSessions[paneId];
        if (sess) {
          sess.connected = false;
          sess.onConnectChange?.(false);
        } else {
          setConnected(false);
        }
        term.write("\r\n\x1b[31m[Terminal Connection Closed]\x1b[0m\r\n");
      };

      socket.onerror = () => {
        term.write("\r\n\x1b[31m[Terminal Connection Error]\x1b[0m\r\n");
      };

      // Client-side execution of a custom command
      const runClientCustomCommand = async (fullCmdStr: string) => {
        const parts = fullCmdStr.trim().split(/\s+/);
        const subCommandName = parts[0];
        const args = parts.slice(1);

        const foundCmd = CUSTOM_COMMANDS.find(c => c.name === subCommandName);
        if (!foundCmd) {
          term.write(`\r\n\x1b[31mError: '${subCommandName}' is not a registered custom command.\x1b[0m\r\n`);
          return;
        }

        const printHelper = (text: string) => {
          const formatted = text.replace(/\r?\n/g, "\r\n");
          term.write(formatted);
        };

        const executeRawHelper = async (rawCmd: string) => {
          const res = await fetch("/api/terminal/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command: rawCmd, cwd }),
          });
          if (!res.ok) {
            throw new Error(`Execution error: ${res.statusText}`);
          }
          const data = await res.json();
          return {
            stdout: data.stdout || "",
            stderr: data.stderr || "",
            exitCode: data.exitCode,
            cwd: data.cwd,
          };
        };

        const context: CommandContext = {
          cwd,
          setCwd: (newCwd: string) => {
            const sess = activeSessions[paneId];
            if (sess) {
              sess.cwd = newCwd;
              sess.onCwdChange?.(newCwd);
            } else {
              setCwd(newCwd);
            }
          },
          paneId,
          workspace,
          print: printHelper,
          executeRaw: executeRawHelper,
        };

        try {
          term.write("\r\n");
          await foundCmd.execute(args, context);
          term.write("\r\n");
        } catch (err: any) {
          term.write(`\r\n\x1b[31mError executing custom command: ${err.message}\x1b[0m\r\n`);
        }
      };

      // Receive data from PTY
      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const parsed = JSON.parse(event.data);
            if (parsed.type === "cwd") {
              const sess = activeSessions[paneId];
              if (sess) {
                sess.cwd = parsed.cwd;
                sess.onCwdChange?.(parsed.cwd);
              } else {
                setCwd(parsed.cwd);
              }
            }
          } catch (e) {
            // Ignore
          }
        } else {
          // Parse custom commands from stdout buffer
          const bytes = new Uint8Array(event.data);
          const text = new TextDecoder().decode(bytes);
          
          if (text.includes("__DNET_CUSTOM_CMD__:")) {
            const lines = text.split(/\r?\n/);
            const filteredLines = lines.filter(line => {
              if (line.includes("__DNET_CUSTOM_CMD__:")) {
                // Ignore setup commands/definitions to prevent false triggers or noise
                if (
                  line.includes("doskey dnet") || 
                  line.includes("dnet()") || 
                  line.includes("echo __DNET_CUSTOM_CMD__")
                ) {
                  return false;
                }
                const match = line.match(/__DNET_CUSTOM_CMD__:(.*)/);
                if (match) {
                  const cmdStr = match[1].trim();
                  // Avoid empty commands or raw placeholder triggers like '$*'
                  if (cmdStr && cmdStr !== "$*") {
                    runClientCustomCommand(cmdStr);
                  }
                }
                return false;
              }
              return true;
            });
            if (filteredLines.length > 0) {
              term.write(filteredLines.join("\r\n"));
            }
          } else {
            term.write(bytes);
          }
        }
      };

      // Send keystrokes from terminal to backend PTY
      term.onData((data) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(data);
        }
      });
    }

    // Resize observer (always recreation per DOM node mount)
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: "resize",
            cols: term.cols,
            rows: term.rows
          }));
        }
      } catch (e) {
        // Ignore
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      
      // Delay closing of session. If it remounts within 3000ms, the timeout is cancelled!
      const timeoutId = setTimeout(() => {
        const sess = activeSessions[paneId];
        if (sess) {
          sess.socket.close();
          sess.term.dispose();
          delete activeSessions[paneId];
        }
      }, 3000);

      const sess = activeSessions[paneId];
      if (sess) {
        sess.cleanupTimeoutId = timeoutId;
        sess.onCwdChange = undefined;
        sess.onConnectChange = undefined;
      }
    };
  }, [paneId, settings.fontSize, reconnectTrigger]);

  // Sync external change directory actions
  useEffect(() => {
    const handleCwdChange = (data: { path: string }) => {
      if (data && data.path) {
        setCwd(data.path);
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: "cd", path: data.path }));
        }
      }
    };
    const unsubscribe = workspace.subscribeEvent("change-terminal-cwd", handleCwdChange);
    return unsubscribe;
  }, [workspace]);

  const handleContainerClick = () => {
    terminalRef.current?.focus();
    setActivePaneId(paneId);
  };

  const clearTerminal = () => {
    terminalRef.current?.clear();
  };

  const resetTerminal = () => {
    terminalRef.current?.write("\r\n\x1b[33mRestarting shell session...\x1b[0m\r\n");
    
    // Clear active sessions registry for this pane to force a clean re-initialization
    const sess = activeSessions[paneId];
    if (sess) {
      if (sess.cleanupTimeoutId) clearTimeout(sess.cleanupTimeoutId);
      sess.socket.close();
      sess.term.dispose();
      delete activeSessions[paneId];
    } else if (socketRef.current) {
      socketRef.current.close();
    }
    
    setReconnectTrigger(prev => prev + 1);
  };

  return (
    <div 
      onClick={handleContainerClick}
      className="h-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-mono"
    >
      {/* Terminal Title Header */}
      <div className="px-3 py-2 border-b border-slate-800/60 flex items-center justify-between bg-slate-900/60 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <TerminalIcon size={14} className={`text-emerald-400 flex-shrink-0 ${connected ? "animate-pulse" : ""}`} />
          <span className="font-semibold text-xs tracking-tight text-slate-200 truncate">
            {connected ? `Interactive Terminal (${cwd})` : "Connecting to shell..."}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="flex items-center gap-1 text-[10px] text-slate-500 mr-2 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-rose-500 animate-ping"}`} />
            <span className="capitalize">{connected ? "live pty" : "offline"}</span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); clearTerminal(); }}
            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition"
            title="Clear Terminal Output"
          >
            <Trash2 size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); resetTerminal(); }}
            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition"
            title="Restart Shell Process"
          >
            <RotateCcw size={12} />
          </button>
        </div>
      </div>

      {/* Terminal Canvas Container */}
      <div 
        ref={containerRef}
        className="flex-1 w-full h-full p-2 bg-slate-950 overflow-hidden"
      />
    </div>
  );
};
