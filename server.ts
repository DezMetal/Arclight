import express from "express";
import path from "path";
import fs from "fs/promises";
import { exec, spawn, ChildProcess } from "child_process";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- API Routes ---

  // Helper to safely resolve paths within the workspace (or anywhere if the user wants system-wide,
  // but let's restrict to process.cwd() as the base, allowing absolute paths or relative paths safely)
  const rootDir = process.cwd();

  function toForwardSlash(p: string): string {
    return p.replace(/\\/g, "/");
  }
  
  function resolveSafePath(userPath: string): string {
    if (!userPath) return rootDir;
    // Normalize path separators to current system's separator
    const normalizedUserPath = userPath.replace(/\//g, path.sep).replace(/\\/g, path.sep);
    if (path.isAbsolute(normalizedUserPath)) {
      return path.normalize(normalizedUserPath);
    }
    return path.normalize(path.join(rootDir, normalizedUserPath));
  }

  // List directory contents
  app.get("/api/files/list", async (req, res) => {
    try {
      const targetPath = resolveSafePath(req.query.path as string || "");
      const stat = await fs.stat(targetPath);
      
      if (!stat.isDirectory()) {
        res.status(400).json({ error: "Path is not a directory" });
        return;
      }

      const files = await fs.readdir(targetPath);
      const items = await Promise.all(
        files.map(async (file) => {
          const fullPath = path.join(targetPath, file);
          try {
            const fileStat = await fs.stat(fullPath);
            return {
              name: file,
              path: toForwardSlash(path.relative(rootDir, fullPath)),
              absolutePath: fullPath,
              isDirectory: fileStat.isDirectory(),
              size: fileStat.size,
              mtime: fileStat.mtime.toISOString(),
            };
          } catch (e) {
            // Handle broken symlinks or locked files
            return {
              name: file,
              path: toForwardSlash(path.relative(rootDir, fullPath)),
              absolutePath: fullPath,
              isDirectory: false,
              size: 0,
              mtime: new Date().toISOString(),
              error: true,
            };
          }
        })
      );

      // Sort: folders first, then files alphabetically
      items.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      res.json({
        currentPath: toForwardSlash(path.relative(rootDir, targetPath) || "."),
        absoluteCurrentPath: targetPath,
        items,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Read file contents
  app.get("/api/files/read", async (req, res) => {
    try {
      const targetPath = resolveSafePath(req.query.path as string);
      const content = await fs.readFile(targetPath, "utf-8");
      res.json({
        path: toForwardSlash(path.relative(rootDir, targetPath)),
        absolutePath: targetPath,
        content,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Write file contents
  app.post("/api/files/write", async (req, res) => {
    try {
      const { path: userPath, content } = req.body;
      if (!userPath) {
        res.status(400).json({ error: "Path is required" });
        return;
      }
      const targetPath = resolveSafePath(userPath);
      await fs.writeFile(targetPath, content, "utf-8");
      res.json({ success: true, path: toForwardSlash(path.relative(rootDir, targetPath)) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create file or folder
  app.post("/api/files/create", async (req, res) => {
    try {
      const { path: userPath, type } = req.body;
      if (!userPath) {
        res.status(400).json({ error: "Path is required" });
        return;
      }
      const targetPath = resolveSafePath(userPath);
      if (type === "dir") {
        await fs.mkdir(targetPath, { recursive: true });
      } else {
        // Ensure parent dir exists
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, "", "utf-8");
      }
      res.json({ success: true, path: toForwardSlash(path.relative(rootDir, targetPath)) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete file or folder
  app.post("/api/files/delete", async (req, res) => {
    try {
      const { path: userPath } = req.body;
      if (!userPath) {
        res.status(400).json({ error: "Path is required" });
        return;
      }
      const targetPath = resolveSafePath(userPath);
      await fs.rm(targetPath, { recursive: true, force: true });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Rename/Move file or folder
  app.post("/api/files/rename", async (req, res) => {
    try {
      const { oldPath, newPath } = req.body;
      if (!oldPath || !newPath) {
        res.status(400).json({ error: "oldPath and newPath are required" });
        return;
      }
      const resolvedOld = resolveSafePath(oldPath);
      const resolvedNew = resolveSafePath(newPath);
      await fs.rename(resolvedOld, resolvedNew);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Serve raw file directly (great for image/audio/video tags, and download)
  app.get("/api/files/raw", async (req, res) => {
    try {
      const targetPath = resolveSafePath(req.query.path as string);
      const stat = await fs.stat(targetPath);
      if (stat.isDirectory()) {
        res.status(400).json({ error: "Path is a directory" });
        return;
      }
      res.sendFile(targetPath);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Open file with default external system app or specified program
  app.post("/api/files/open-external", async (req, res) => {
    try {
      const { path: userPath, app: appName } = req.body;
      if (!userPath) {
        res.status(400).json({ error: "Path is required" });
        return;
      }
      const targetPath = resolveSafePath(userPath);
      
      let command = "";
      if (appName) {
        command = `${appName} "${targetPath}"`;
      } else {
        if (process.platform === "win32") {
          command = `start "" "${targetPath}"`;
        } else if (process.platform === "darwin") {
          command = `open "${targetPath}"`;
        } else {
          command = `xdg-open "${targetPath}" || gio open "${targetPath}" || mimeopen -n "${targetPath}"`;
        }
      }
      
      exec(command, (err, stdout, stderr) => {
        if (err) {
          console.error("Open external failed command:", command, err);
          res.status(500).json({ error: err.message || stderr || "Failed to launch default app" });
          return;
        }
        res.json({ success: true });
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get host system details
  app.get("/api/system/info", (req, res) => {
    res.json({
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      rootDir: toForwardSlash(rootDir),
    });
  });

  // Execute terminal command
  app.post("/api/terminal/exec", (req, res) => {
    const { command, cwd } = req.body;
    const activeCwd = resolveSafePath(cwd || "");

    const isWin = process.platform === "win32";
    let shellCmd = "";
    if (isWin) {
      // Windows Command Prompt: cd /d switch drive, & execute regardless of failure, cd prints CWD
      shellCmd = `cd /d ${JSON.stringify(activeCwd)} && (${command}) & echo ---DIR_SEPARATOR--- & cd`;
    } else {
      // POSIX Shell
      shellCmd = `cd ${JSON.stringify(activeCwd)} && (${command}); echo "---DIR_SEPARATOR---"; pwd`;
    }

    exec(shellCmd, { maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
      let output = stdout || "";
      let errorOutput = stderr || "";
      let newCwd = activeCwd;

      if (output.includes("---DIR_SEPARATOR---")) {
        const parts = output.split("---DIR_SEPARATOR---");
        output = parts[0].trim();
        newCwd = parts[1].trim();
      }

      // Format relative path for CWD
      const relativeCwd = toForwardSlash(path.relative(rootDir, newCwd) || ".");

      res.json({
        stdout: output,
        stderr: errorOutput,
        cwd: relativeCwd,
        absoluteCwd: newCwd,
        exitCode: error ? error.code : 0,
      });
    });
  });

  // --- Real Interactive Terminal Session Registry ---
  interface StatefulProcess {
    id: string;
    child: ChildProcess;
    output: { type: "stdout" | "stderr" | "system"; text: string; timestamp: string }[];
    cwd: string;
    isAlive: boolean;
    isCommandRunning: boolean;
    currentCommandExitCode: number | null;
  }

  const activeProcesses = new Map<string, StatefulProcess>();

  async function getProcessCwd(pid: number | undefined): Promise<string | null> {
    if (!pid || process.platform === "win32") return null;
    try {
      const target = await fs.readlink(`/proc/${pid}/cwd`);
      return target;
    } catch (e) {
      return null;
    }
  }

  // Spawn stateful process
  app.post("/api/terminal/spawn", async (req, res) => {
    try {
      const { command, cwd, paneId } = req.body;
      const activeCwd = resolveSafePath(cwd || "");
      const sessionKey = paneId || "default_terminal";

      let procState = activeProcesses.get(sessionKey);

      // If the persistent shell doesn't exist yet or is dead, create a new one
      if (!procState || !procState.isAlive) {
        const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
        const child = spawn(shell, [], {
          cwd: activeCwd,
          env: {
            ...process.env,
            FORCE_COLOR: "1",
            TERM: "xterm-color",
          },
          shell: true,
        });

        procState = {
          id: sessionKey,
          child,
          output: [],
          cwd: activeCwd,
          isAlive: true,
          isCommandRunning: false,
          currentCommandExitCode: null,
        };

        activeProcesses.set(sessionKey, procState);

        let buffer = "";
        child.stdout?.on("data", (data: Buffer) => {
          const text = data.toString("utf-8");
          buffer += text;

          // Check if command completion sentinel was emitted in the stream
          if (buffer.includes("__DNET_CMD_DONE__:")) {
            const regex = /__DNET_CMD_DONE__:(\d+)/;
            const match = buffer.match(regex);
            if (match) {
              const code = parseInt(match[1], 10);
              const sentinelStr = match[0];
              const index = buffer.indexOf(sentinelStr);
              const before = buffer.substring(0, index);
              const after = buffer.substring(index + sentinelStr.length);

              if (before) {
                procState!.output.push({
                  type: "stdout",
                  text: before,
                  timestamp: new Date().toISOString(),
                });
              }

              procState!.isCommandRunning = false;
              procState!.currentCommandExitCode = code;

              // Extract new working directory natively
              getProcessCwd(child.pid).then((resolvedPath) => {
                if (resolvedPath) {
                  procState!.cwd = resolvedPath;
                }
              }).catch(() => {});

              buffer = after;
              return;
            }
          }

          // Push raw stdout
          procState!.output.push({
            type: "stdout",
            text,
            timestamp: new Date().toISOString(),
          });
        });

        child.stderr?.on("data", (data: Buffer) => {
          const text = data.toString("utf-8");
          procState!.output.push({
            type: "stderr",
            text,
            timestamp: new Date().toISOString(),
          });
        });

        child.stdin?.on("error", (err) => {
          console.error("persistent shell stdin error:", err);
        });

        child.stdout?.on("error", (err) => {
          console.error("persistent shell stdout error:", err);
        });

        child.stderr?.on("error", (err) => {
          console.error("persistent shell stderr error:", err);
        });

        child.on("error", (err) => {
          procState!.output.push({
            type: "stderr",
            text: `Process Error: ${err.message}\n`,
            timestamp: new Date().toISOString(),
          });
          procState!.isAlive = false;
          procState!.isCommandRunning = false;
        });

        child.on("close", (code) => {
          procState!.isAlive = false;
          procState!.isCommandRunning = false;
          procState!.output.push({
            type: "system",
            text: `Shell process closed with code ${code}`,
            timestamp: new Date().toISOString(),
          });
        });
      }

      // Write user command to persistent shell if provided
      if (command && command.trim()) {
        procState.isCommandRunning = true;
        procState.currentCommandExitCode = null;

        let formattedCmd = "";
        if (process.platform === "win32") {
          formattedCmd = `${command} & echo __DNET_CMD_DONE__:%ERRORLEVEL%\n`;
        } else {
          formattedCmd = `${command}; echo "__DNET_CMD_DONE__:$?"\n`;
        }

        if (procState.child.stdin && procState.child.stdin.writable) {
          procState.child.stdin.write(formattedCmd);
        }
      }

      res.json({
        processId: sessionKey,
        cwd: toForwardSlash(path.relative(rootDir, procState.cwd) || "."),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Poll stateful process output
  app.get("/api/terminal/poll", (req, res) => {
    const { processId, offset } = req.query;
    if (!processId) {
      res.status(400).json({ error: "processId is required" });
      return;
    }

    const procState = activeProcesses.get(processId as string);
    if (!procState) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const startIdx = parseInt(offset as string || "0", 10);
    const newOutput = procState.output.slice(startIdx);

    res.json({
      processId: procState.id,
      isAlive: procState.isAlive,
      isCommandRunning: procState.isCommandRunning,
      exitCode: procState.currentCommandExitCode,
      cwd: toForwardSlash(path.relative(rootDir, procState.cwd) || "."),
      absoluteCwd: procState.cwd,
      output: newOutput,
      newOffset: procState.output.length,
    });
  });

  // Write to stateful process stdin
  app.post("/api/terminal/write", (req, res) => {
    const { processId, input } = req.body;
    if (!processId) {
      res.status(400).json({ error: "processId is required" });
      return;
    }

    const procState = activeProcesses.get(processId);
    if (!procState) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (!procState.isAlive) {
      res.status(400).json({ error: "Process is not running" });
      return;
    }

    if (procState.child.stdin && procState.child.stdin.writable) {
      procState.child.stdin.write(input);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: "stdin is not writable" });
    }
  });

  // Kill stateful process or interrupt foreground command
  app.post("/api/terminal/kill", (req, res) => {
    const { processId, force } = req.body;
    if (!processId) {
      res.status(400).json({ error: "processId is required" });
      return;
    }

    const procState = activeProcesses.get(processId);
    if (!procState) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (procState.isAlive) {
      if (force) {
        procState.child.kill("SIGKILL");
        res.json({ success: true, message: "Killed shell process" });
      } else {
        // Send Ctrl+C / SIGINT interrupt to the shell's active child processes.
        // Writing \x03 is highly effective on Linux shell pipes.
        if (procState.child.stdin && procState.child.stdin.writable) {
          procState.child.stdin.write("\x03\n");
        }
        procState.isCommandRunning = false;
        res.json({ success: true, message: "Sent interrupt signal" });
      }
    } else {
      res.json({ success: true, message: "Process already dead" });
    }
  });

  // --- Vite / Static Assets Middleware ---

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // --- Real PTY Terminal WebSocket Server ---
  const wss = new WebSocketServer({ server, path: "/api/terminal/ws" });

  wss.on("connection", (socket, req) => {
    try {
      const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
      const paneId = url.searchParams.get("paneId") || "default";
      const initialCwd = url.searchParams.get("cwd") || ".";
      const cols = parseInt(url.searchParams.get("cols") || "80", 10);
      const rows = parseInt(url.searchParams.get("rows") || "24", 10);

      const activeCwd = resolveSafePath(initialCwd);

      const isWin = process.platform === "win32";
      let child: ChildProcess;
      let lineBuffer = "";
      const history: string[] = [];
      let historyIndex = 0;
      if (isWin) {
        child = spawn("cmd.exe", ["/Q"], {
          cwd: activeCwd,
          env: {
            ...process.env,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
            PYTHONUNBUFFERED: "1",
            PYTHONIOENCODING: "UTF-8",
            PYTHONINSPECT: "1",
            NODE_FORCE_REPL: "1"
          }
        });
      } else {
        const pythonScript = path.join(rootDir, "pty_bridge.py");
        child = spawn("python3", [pythonScript], {
          cwd: activeCwd,
          stdio: ["pipe", "pipe", "pipe", "pipe"], // stdin, stdout, stderr, fd 3
        });
      }

      // Prevent unhandled error events (like ECONNRESET) from crashing the server
      socket.on("error", (err) => {
        console.error("PTY Terminal socket error:", err);
      });

      child.on("error", (err) => {
        console.error("PTY child process error:", err);
      });

      child.stdin?.on("error", (err) => {
        console.error("PTY child.stdin error:", err);
      });

      child.stdout?.on("error", (err) => {
        console.error("PTY child.stdout error:", err);
      });

      child.stderr?.on("error", (err) => {
        console.error("PTY child.stderr error:", err);
      });

      if (child.stdio && child.stdio[3]) {
        child.stdio[3].on("error", (err) => {
          console.error("PTY child.stdio[3] error:", err);
        });
      }

      let shellPid: number | null = isWin ? child.pid : null;
      let lastCwd = activeCwd;

      // Periodically poll CWD of the shell if we know its PID
      const cwdInterval = setInterval(async () => {
        if (!shellPid) return;
        try {
          const resolvedPath = await fs.readlink(`/proc/${shellPid}/cwd`);
          if (resolvedPath && resolvedPath !== lastCwd) {
            lastCwd = resolvedPath;
            const relativeCwd = toForwardSlash(path.relative(rootDir, resolvedPath) || ".");
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "cwd", cwd: relativeCwd, absoluteCwd: resolvedPath }));
            }
          }
        } catch (e) {
          // Ignore if process ended or not permitted
        }
      }, 500);

      // Write initial size command to the control channel (fd 3)
      if (child.stdio[3] && (child.stdio[3] as any).writable) {
        (child.stdio[3] as any).write(JSON.stringify({ type: "resize", cols, rows }) + "\n");
      }

      // Preload custom bash prompt/doskey & 'dnet' bridge function inside the shell
      const startupCmds = isWin
        ? [
            `doskey dnet=echo __DNET_CUSTOM_CMD__:$*`,
            ``
          ].join("\r\n")
        : [
            `dnet() { echo "__DNET_CUSTOM_CMD__:$*"; }`,
            `clear`,
            ``
          ].join("\n");
      
      if (child.stdin && child.stdin.writable) {
        child.stdin.write(startupCmds);
      }

      // Forward child stdout (pty output) as binary frames
      child.stdout?.on("data", (data: Buffer) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(data);
        }
      });

      // Forward child stderr (contains PID as well as error messages)
      let stderrBuffer = "";
      child.stderr?.on("data", (data: Buffer) => {
        const text = data.toString("utf-8");
        stderrBuffer += text;
        
        // Parse the PID if emitted
        if (stderrBuffer.includes("__DNET_SHELL_PID__:")) {
          const match = stderrBuffer.match(/__DNET_SHELL_PID__:(\d+)/);
          if (match) {
            shellPid = parseInt(match[1], 10);
            stderrBuffer = stderrBuffer.replace(/__DNET_SHELL_PID__:\d+\n?/, "");
          }
        }

        // Send remaining stderr to socket
        if (stderrBuffer && socket.readyState === WebSocket.OPEN) {
          socket.send(Buffer.from(stderrBuffer, "utf-8"));
          stderrBuffer = "";
        }
      });

      // Forward WebSocket messages to child stdin or control channel
      socket.on("message", (message: any, isBinary: boolean) => {
        if (!isBinary) {
          try {
            const msgStr = message.toString("utf-8");
            if (msgStr.startsWith("{")) {
              const parsed = JSON.parse(msgStr);
              if (parsed.type === "resize") {
                const rCols = parsed.cols || 80;
                const rRows = parsed.rows || 24;
                if (child.stdio[3] && (child.stdio[3] as any).writable) {
                  (child.stdio[3] as any).write(JSON.stringify({ type: "resize", cols: rCols, rows: rRows }) + "\n");
                }
                return;
              }
              if (parsed.type === "cd") {
                const p = parsed.path || "";
                if (child.stdin && child.stdin.writable) {
                  const cdCmd = isWin ? `cd /d "${p}"\r\n` : `cd ${JSON.stringify(p)}\n`;
                  child.stdin.write(cdCmd);
                }
                return;
              }
            }
          } catch (e) {
            // Fallback to write raw message
          }
        }

        if (child.stdin && child.stdin.writable) {
          if (isWin) {
            const msgStr = message.toString("utf-8");
            
            // 1. Check for ANSI escape sequences starting with ESC (e.g. arrow keys)
            if (msgStr.startsWith("\x1b")) {
              if (msgStr === "\x1b[A") {
                // Up Arrow: History Previous
                if (history.length > 0 && historyIndex > 0) {
                  historyIndex--;
                  // Erase current line
                  const erase = "\x08 \x08".repeat(lineBuffer.length);
                  lineBuffer = history[historyIndex];
                  if (socket.readyState === WebSocket.OPEN) {
                    socket.send(Buffer.from(erase + lineBuffer, "utf-8"));
                  }
                }
              } else if (msgStr === "\x1b[B") {
                // Down Arrow: History Next
                if (historyIndex < history.length) {
                  historyIndex++;
                  const erase = "\x08 \x08".repeat(lineBuffer.length);
                  if (historyIndex === history.length) {
                    lineBuffer = "";
                  } else {
                    lineBuffer = history[historyIndex];
                  }
                  if (socket.readyState === WebSocket.OPEN) {
                    socket.send(Buffer.from(erase + lineBuffer, "utf-8"));
                  }
                }
              } else {
                // Other ANSI sequences (such as Left/Right arrows) are ignored for line stability
              }
              return;
            }

            // 2. Control Characters & Standard Characters
            for (let i = 0; i < msgStr.length; i++) {
              const char = msgStr[i];
              
              if (char === "\r" || char === "\n") {
                // Execute command!
                const finalLine = lineBuffer;
                
                // Save to history if not empty and different from last entry
                if (finalLine.trim().length > 0) {
                  if (history.length === 0 || history[history.length - 1] !== finalLine) {
                    history.push(finalLine);
                  }
                  historyIndex = history.length;
                }
                
                // Clear the local buffer
                lineBuffer = "";
                
                // Intercept clear/cls commands to clear xterm screen instantly
                if (finalLine.trim().toLowerCase() === "cls" || finalLine.trim().toLowerCase() === "clear") {
                  if (socket.readyState === WebSocket.OPEN) {
                    socket.send(Buffer.from("\x1b[2J\x1b[H", "utf-8"));
                  }
                }
                
                // Send the line to cmd.exe's stdin
                child.stdin.write(finalLine + "\r\n");
                
                // Move cursor to next line on client
                if (socket.readyState === WebSocket.OPEN) {
                  socket.send(Buffer.from("\r\n", "utf-8"));
                }
              } else if (char === "\x7f" || char === "\x08" || char === "\b") {
                // Backspace
                if (lineBuffer.length > 0) {
                  lineBuffer = lineBuffer.slice(0, -1);
                  if (socket.readyState === WebSocket.OPEN) {
                    socket.send(Buffer.from("\x08 \x08", "utf-8"));
                  }
                }
              } else if (char === "\x03") {
                // Ctrl+C: Cancel current input & send interrupt to process
                lineBuffer = "";
                child.stdin.write("\x03");
                if (socket.readyState === WebSocket.OPEN) {
                  socket.send(Buffer.from("^C\r\n", "utf-8"));
                }
              } else if (char === "\x0c") {
                // Ctrl+L: Clear screen
                if (socket.readyState === WebSocket.OPEN) {
                  socket.send(Buffer.from("\x1b[2J\x1b[H", "utf-8"));
                }
              } else {
                // Standard readable character
                const code = char.charCodeAt(0);
                if (code >= 32 || char === "\t") {
                  lineBuffer += char;
                  if (socket.readyState === WebSocket.OPEN) {
                    socket.send(Buffer.from(char, "utf-8"));
                  }
                }
              }
            }
          } else {
            child.stdin.write(message);
          }
        }
      });

      socket.on("close", () => {
        clearInterval(cwdInterval);
        child.kill("SIGKILL");
      });

      child.on("close", () => {
        clearInterval(cwdInterval);
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
      });

    } catch (err: any) {
      console.error("WS connection error:", err);
      socket.close();
    }
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
