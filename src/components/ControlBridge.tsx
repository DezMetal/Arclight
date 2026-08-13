import { useEffect, useRef } from "react";

import { useWorkspace } from "../context/WorkspaceContext";
import { control, type ControlRequest } from "../lib/control";
import { pty } from "../lib/api";
import { matchCustomCommand, runCustomCommand } from "../lib/customCommands";

/**
 * Connects the control API to the live workspace.
 *
 * Renders nothing. Mounted once, it mirrors workspace state into the Rust
 * server and executes the commands HTTP callers send, so external systems
 * drive the same code paths the UI does rather than a parallel implementation.
 */
export const ControlBridge: React.FC = () => {
  const workspace = useWorkspace();

  // The request handler is installed once but must always see current state.
  const wsRef = useRef(workspace);
  wsRef.current = workspace;

  // Mirror workspace state whenever it changes.
  useEffect(() => {
    void control
      .publish({
        frames: workspace.frames,
        focusedFrameId: workspace.focusedFrameId,
        selectedFrameId: workspace.selectedFrameId,
        settings: workspace.settings,
        tools: Object.keys(workspace.tools),
      })
      .catch(() => {
        /* server not running */
      });
  }, [
    workspace.frames,
    workspace.focusedFrameId,
    workspace.selectedFrameId,
    workspace.settings,
    workspace.tools,
  ]);

  // Push frame changes to SSE subscribers.
  useEffect(() => {
    void control
      .emit({ type: "frames", frames: workspace.frames })
      .catch(() => {});
  }, [workspace.frames]);

  // Execute bridged commands.
  useEffect(() => {
    const unlisten = control.onRequest(async (request: ControlRequest) => {
      const ws = wsRef.current;
      const { id, action, payload } = request;

      const reply = (result: unknown) => void control.respond(id, result);

      try {
        switch (action) {
          case "open": {
            if (!payload.path) return reply({ error: "path is required" });
            const target = ws.resolveOpenTarget({
              frameId: payload.frameId ?? undefined,
              newFrame: payload.newFrame ?? undefined,
              direction: payload.direction ?? undefined,
            });
            ws.openFile(payload.path, {
              frameId: payload.frameId ?? undefined,
              newFrame: payload.newFrame ?? undefined,
              direction: payload.direction ?? undefined,
            });
            return reply({ ok: true, target });
          }

          case "split": {
            if (!payload.frameId) return reply({ error: "frameId is required" });
            if (!ws.frames.some((f) => f.id === payload.frameId)) {
              return reply({ error: `no frame '${payload.frameId}'` });
            }
            const created = ws.splitFrame(
              payload.frameId,
              payload.direction === "horizontal" ? "horizontal" : "vertical",
              payload.tool || "editor",
              payload.context ?? undefined,
            );
            return reply({ ok: true, frameId: created });
          }

          case "setTool": {
            if (!ws.frames.some((f) => f.id === payload.frameId)) {
              return reply({ error: `no frame '${payload.frameId}'` });
            }
            if (!ws.tools[payload.tool]) {
              return reply({
                error: `unknown tool '${payload.tool}'`,
                available: Object.keys(ws.tools),
              });
            }
            ws.setFrameTool(payload.frameId, payload.tool);
            return reply({ ok: true });
          }

          case "close": {
            if (!ws.frames.some((f) => f.id === payload.frameId)) {
              return reply({ error: `no frame '${payload.frameId}'` });
            }
            ws.closeFrame(payload.frameId);
            return reply({ ok: true });
          }

          case "select": {
            const target = payload.frameId;
            if (target && !ws.frames.some((f) => f.id === target)) {
              return reply({ error: `no frame '${target}'` });
            }
            ws.selectFrame(target ?? null);
            return reply({ ok: true, selectedFrameId: target ?? null });
          }

          case "terminalWrite": {
            const frame = ws.frames.find((f) => f.id === payload.frameId);
            if (!frame) return reply({ error: `no frame '${payload.frameId}'` });
            if (frame.tool !== "terminal") {
              return reply({ error: `frame '${payload.frameId}' is not a terminal` });
            }
            await pty.write(`pty-${payload.frameId}`, payload.data ?? "");
            return reply({ ok: true });
          }

          case "command": {
            // Runs the same dnet commands the terminal exposes, so scripted
            // and typed control share one implementation.
            const line = `dnet ${payload.command ?? ""}`.trim();
            const matched = matchCustomCommand(line);
            if (!matched) return reply({ error: `not a dnet command: '${line}'` });

            const frameId =
              payload.frameId ?? ws.selectedFrameId ?? ws.focusedFrameId ?? ws.frames[0]?.id ?? "";

            let output = "";
            await runCustomCommand(matched, {
              cwd: ws.getFrameContext(frameId)?.terminalCwd ?? "",
              frameId,
              sessionId: `pty-${frameId}`,
              workspace: ws,
              // Strip SGR sequences so callers get plain text.
              print: (text) => {
                output += text.replace(/\x1b\[[0-9;]*m/g, "");
              },
            });
            return reply({ ok: true, output: output.trimEnd() });
          }

          default:
            return reply({ error: `unknown action '${action}'` });
        }
      } catch (err) {
        return reply({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  return null;
};
