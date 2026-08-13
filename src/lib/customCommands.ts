/**
 * The `dnet` command suite.
 *
 * Commands are matched on the *input* line, in the frontend, before a single
 * byte reaches the shell. The previous design injected a `doskey` alias that
 * echoed a sentinel string and then scanned the shell's stdout for it, which
 * meant: a sentinel split across two reads was missed, printing any file that
 * contained the sentinel triggered a command, and the alias did not survive
 * into a nested shell. None of those failure modes exist here.
 *
 * ── Adding a command ──────────────────────────────────────────────────────
 * Append to CUSTOM_COMMANDS below. Each command receives:
 *   args  — everything after `dnet <name>`, split on whitespace
 *   ctx   — { cwd, paneId, sessionId, workspace, print }
 * `print` writes to the terminal; use \n freely, it is converted to \r\n.
 */

import { THEMES, PRESETS, type ThemeName, type PresetName } from "../context/WorkspaceContext";
import type { useWorkspace } from "../context/WorkspaceContext";
import { fs, paths, pty, systemInfo, errorText } from "./api";

export interface CommandContext {
  cwd: string;
  frameId: string;
  sessionId: string;
  workspace: ReturnType<typeof useWorkspace>;
  print: (text: string) => void;
}

export interface CustomCommand {
  name: string;
  description: string;
  usage: string;
  execute: (args: string[], ctx: CommandContext) => void | Promise<void>;
}

/** The prefix that marks a line as ours rather than the shell's. */
export const COMMAND_PREFIX = "dnet";

const DIM = "\x1b[90m";
const ACCENT = "\x1b[36m";
const OK = "\x1b[32m";
const ERR = "\x1b[31m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/** Split a command line, honouring double-quoted segments. */
function tokenize(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push(m[1] ?? m[2]);
  return out;
}

export interface MatchedCommand {
  command: CustomCommand;
  args: string[];
}

/**
 * Decide whether a typed line is a `dnet` invocation.
 * Returns null for anything the shell should handle itself.
 */
export function matchCustomCommand(line: string): MatchedCommand | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const tokens = tokenize(trimmed);
  if (tokens[0]?.toLowerCase() !== COMMAND_PREFIX) return null;

  const name = tokens[1]?.toLowerCase();
  if (!name) {
    return { command: HELP_COMMAND, args: [] };
  }

  const command = CUSTOM_COMMANDS.find((c) => c.name === name);
  if (!command) {
    return { command: unknownCommand(name), args: [] };
  }

  return { command, args: tokens.slice(2) };
}

export async function runCustomCommand(
  matched: MatchedCommand,
  ctx: CommandContext,
): Promise<void> {
  try {
    await matched.command.execute(matched.args, ctx);
  } catch (err) {
    ctx.print(`${ERR}${errorText(err)}${RESET}\n`);
  }
}

function unknownCommand(name: string): CustomCommand {
  return {
    name,
    description: "",
    usage: "",
    execute: (_args, ctx) => {
      ctx.print(`${ERR}unknown command '${name}'${RESET}\n`);
      ctx.print(`${DIM}run 'dnet help' for the list${RESET}\n`);
    },
  };
}

/** Resolve a user-supplied path against the terminal's working directory. */
function resolveArg(ctx: CommandContext, input: string): string {
  return paths.resolve(ctx.cwd || "", input);
}

const HELP_COMMAND: CustomCommand = {
  name: "help",
  description: "List every dnet command",
  usage: "dnet help",
  execute: (_args, ctx) => {
    ctx.print(`${BOLD}${ACCENT}ARCLIGHT${RESET}${DIM} · dnet command suite${RESET}\n\n`);
    for (const cmd of CUSTOM_COMMANDS) {
      ctx.print(`  ${ACCENT}${cmd.usage.padEnd(42)}${RESET}${DIM}${cmd.description}${RESET}\n`);
    }
    ctx.print(`\n${DIM}defined in src/lib/customCommands.ts${RESET}\n`);
  },
};

export const CUSTOM_COMMANDS: CustomCommand[] = [
  HELP_COMMAND,

  {
    name: "edit",
    description: "Open a file in a new frame",
    usage: "dnet edit <file> [-h|-v]",
    execute: (args, ctx) => {
      const files = args.filter((a) => !a.startsWith("-"));
      if (files.length === 0) {
        ctx.print(`${ERR}usage: dnet edit <file> [-h|-v]${RESET}\n`);
        return;
      }
      const direction = args.some((a) => a === "-h" || a === "--horizontal")
        ? "horizontal"
        : "vertical";
      const filePath = resolveArg(ctx, files[0]);
      ctx.workspace.splitFrame(ctx.frameId, direction, "editor", { filePath });
      ctx.print(`${OK}opened${RESET} ${filePath}\n`);
    },
  },

  {
    name: "open",
    description: "Open a file where the workspace routes it",
    usage: "dnet open <file>",
    execute: (args, ctx) => {
      if (!args[0]) {
        ctx.print(`${ERR}usage: dnet open <file>${RESET}\n`);
        return;
      }
      const filePath = resolveArg(ctx, args[0]);
      ctx.workspace.openFile(filePath, { sourceFrameId: ctx.frameId });
      ctx.print(`${OK}opened${RESET} ${filePath}\n`);
    },
  },

  {
    name: "term",
    description: "Open another terminal split at this directory",
    usage: "dnet term [-h|-v]",
    execute: (args, ctx) => {
      const direction = args.some((a) => a === "-h" || a === "--horizontal")
        ? "horizontal"
        : "vertical";
      ctx.workspace.splitFrame(ctx.frameId, direction, "terminal", {
        terminalCwd: ctx.cwd,
      });
      ctx.print(`${OK}new ${direction} terminal${RESET}\n`);
    },
  },

  {
    name: "explore",
    description: "Open a file explorer split at this directory",
    usage: "dnet explore [-h|-v]",
    execute: (args, ctx) => {
      const direction = args.some((a) => a === "-h" || a === "--horizontal")
        ? "horizontal"
        : "vertical";
      ctx.workspace.splitFrame(ctx.frameId, direction, "file-explorer", {
        currentPath: ctx.cwd,
      });
      ctx.print(`${OK}new explorer at${RESET} ${ctx.cwd}\n`);
    },
  },

  {
    name: "reveal",
    description: "Show the current directory in Windows Explorer",
    usage: "dnet reveal [path]",
    execute: async (args, ctx) => {
      const target = args[0] ? resolveArg(ctx, args[0]) : ctx.cwd;
      await fs.revealInExplorer(target);
      ctx.print(`${OK}revealed${RESET} ${target}\n`);
    },
  },

  {
    name: "theme",
    description: "Switch theme (dark | light)",
    usage: "dnet theme <dark | light>",
    execute: (args, ctx) => {
      const allowed = THEMES.map((t) => t.id);
      const requested = args[0]?.toLowerCase() as ThemeName;
      if (!requested || !allowed.includes(requested)) {
        ctx.print(`${DIM}current: ${ctx.workspace.settings.theme}${RESET}\n`);
        ctx.print(`${DIM}available: ${allowed.join(", ")}${RESET}\n`);
        return;
      }
      ctx.workspace.updateSettings({ theme: requested });
      ctx.print(`${OK}theme →${RESET} ${requested}\n`);
    },
  },

  {
    name: "preset",
    description: "Switch the DSS preset",
    usage: "dnet preset <signal | aero | softclub | eink | terminal>",
    execute: (args, ctx) => {
      const requested = args[0]?.toLowerCase() as PresetName;
      const match = PRESETS.find((p) => p.id === requested);
      if (!match) {
        ctx.print(`${DIM}current: ${ctx.workspace.settings.preset}${RESET}\n`);
        for (const p of PRESETS) {
          ctx.print(`  ${ACCENT}${p.id.padEnd(10)}${RESET}${DIM}${p.description}${RESET}\n`);
        }
        return;
      }
      ctx.workspace.updateSettings({ preset: match.id });
      ctx.print(`${OK}preset →${RESET} ${match.label}\n`);
    },
  },

  {
    name: "font",
    description: "Set the interface font size in px",
    usage: "dnet font <size>",
    execute: (args, ctx) => {
      const size = Number(args[0]);
      if (!Number.isFinite(size) || size < 8 || size > 32) {
        ctx.print(`${DIM}current: ${ctx.workspace.settings.fontSize}px (8-32)${RESET}\n`);
        return;
      }
      ctx.workspace.updateSettings({ fontSize: size });
      ctx.print(`${OK}font →${RESET} ${size}px\n`);
    },
  },

  {
    name: "new",
    description: "Create a file or directory",
    usage: "dnet new <file|dir> <path>",
    execute: async (args, ctx) => {
      const kind = args[0]?.toLowerCase();
      if ((kind !== "file" && kind !== "dir") || !args[1]) {
        ctx.print(`${ERR}usage: dnet new <file|dir> <path>${RESET}\n`);
        return;
      }
      const target = resolveArg(ctx, args[1]);
      const created = await fs.create(target, kind);
      ctx.workspace.emitEvent("refresh-explorer", { path: ctx.cwd });
      ctx.print(`${OK}created${RESET} ${created}\n`);
    },
  },

  {
    name: "frames",
    description: "List the open frames and their ids",
    usage: "dnet frames",
    execute: (_args, ctx) => {
      const registry = ctx.workspace.frames;
      if (registry.length === 0) {
        ctx.print(`${DIM}no frames${RESET}\n`);
        return;
      }
      ctx.print(
        `${DIM}${"ID".padEnd(20)}${"TOOL".padEnd(16)}${"STATE".padEnd(8)}CONTEXT${RESET}\n`,
      );
      for (const frame of registry) {
        const where =
          frame.context?.filePath ?? frame.context?.terminalCwd ?? frame.context?.currentPath ?? "-";
        const mark = frame.selected
          ? `${ACCENT}target${RESET}`
          : frame.focused
            ? `${DIM}focus ${RESET}`
            : "      ";
        ctx.print(
          `${frame.id.padEnd(20)}${frame.tool.padEnd(16)}${mark}  ${DIM}${where}${RESET}\n`,
        );
      }
    },
  },

  {
    name: "target",
    description: "Select a frame as the destination for opened files",
    usage: "dnet target <frameId | none>",
    execute: (args, ctx) => {
      const arg = args[0];
      if (!arg) {
        const current = ctx.workspace.selectedFrameId;
        ctx.print(
          current
            ? `${ACCENT}${current}${RESET} ${DIM}is the open target${RESET}\n`
            : `${DIM}no target; opens follow the '${ctx.workspace.settings.defaultOpen}' default${RESET}\n`,
        );
        return;
      }
      if (arg === "none" || arg === "clear") {
        ctx.workspace.selectFrame(null);
        ctx.print(`${OK}target released${RESET}\n`);
        return;
      }
      if (!ctx.workspace.frames.some((f) => f.id === arg)) {
        ctx.print(`${ERR}no frame '${arg}'${RESET}\n`);
        return;
      }
      ctx.workspace.selectFrame(arg);
      ctx.print(`${OK}target →${RESET} ${arg}\n`);
    },
  },

  {
    name: "close",
    description: "Close a frame by id",
    usage: "dnet close <frameId>",
    execute: (args, ctx) => {
      const target = args[0] ?? ctx.frameId;
      const exists = ctx.workspace.frames.some((f) => f.id === target);
      if (!exists) {
        ctx.print(`${ERR}no pane '${target}'${RESET}\n`);
        return;
      }
      ctx.workspace.closeFrame(target);
      ctx.print(`${OK}closed${RESET} ${target}\n`);
    },
  },

  {
    name: "layout",
    description: "Reset the workspace layout",
    usage: "dnet layout reset",
    execute: (args, ctx) => {
      if (args[0] !== "reset") {
        ctx.print(`${DIM}usage: dnet layout reset${RESET}\n`);
        return;
      }
      ctx.workspace.resetLayout();
      ctx.print(`${OK}layout reset${RESET}\n`);
    },
  },

  {
    name: "sessions",
    description: "List running terminal sessions",
    usage: "dnet sessions",
    execute: async (_args, ctx) => {
      const sessions = await pty.list();
      if (sessions.length === 0) {
        ctx.print(`${DIM}none${RESET}\n`);
        return;
      }
      for (const s of sessions) {
        const mark = s.id === ctx.sessionId ? `${ACCENT}*${RESET}` : " ";
        const status = s.alive ? `${OK}alive${RESET}` : `${ERR}dead ${RESET}`;
        ctx.print(`${mark} ${s.id.padEnd(22)}${status}  ${s.shell.padEnd(12)}${DIM}${s.cwd}${RESET}\n`);
      }
    },
  },

  {
    name: "info",
    description: "Show host and workspace details",
    usage: "dnet info",
    execute: async (_args, ctx) => {
      const sys = await systemInfo();
      const row = (k: string, v: string) =>
        ctx.print(`  ${DIM}${k.padEnd(12)}${RESET}${v}\n`);
      ctx.print(`${BOLD}${ACCENT}ARCLIGHT${RESET} ${DIM}v${sys.app_version}${RESET}\n`);
      row("host", `${sys.hostname ?? "?"} (${sys.os}/${sys.arch})`);
      row("user", sys.username ?? "?");
      row("home", sys.home_dir ?? "?");
      row("cwd", ctx.cwd || "?");
      row("theme", ctx.workspace.settings.theme);
      row("font", `${ctx.workspace.settings.fontSize}px`);
      row("frames", String(ctx.workspace.frames.length));
    },
  },

  {
    name: "calc",
    description: "Evaluate an arithmetic expression",
    usage: "dnet calc <expression>",
    execute: (args, ctx) => {
      const expr = args.join(" ");
      if (!expr) {
        ctx.print(`${DIM}usage: dnet calc 120 * 4.5${RESET}\n`);
        return;
      }
      // Arithmetic only — refuse anything that is not numbers and operators,
      // so this cannot become an arbitrary-code entry point.
      if (!/^[0-9+\-*/%.()\s,]+$/.test(expr)) {
        ctx.print(`${ERR}only numbers and + - * / % ( ) are allowed${RESET}\n`);
        return;
      }
      try {
        const result = new Function(`"use strict"; return (${expr});`)();
        ctx.print(`${expr} ${DIM}=${RESET} ${ACCENT}${result}${RESET}\n`);
      } catch {
        ctx.print(`${ERR}could not evaluate '${expr}'${RESET}\n`);
      }
    },
  },
];
