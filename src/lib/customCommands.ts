import { useWorkspace } from "../context/WorkspaceContext";

export interface CommandContext {
  cwd: string;
  setCwd: (cwd: string) => void;
  paneId: string;
  workspace: ReturnType<typeof useWorkspace>;
  print: (text: string, type?: "stdout" | "stderr" | "system") => void;
  executeRaw: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number; cwd?: string }>;
}

export interface CustomCommand {
  name: string;
  description: string;
  usage: string;
  execute: (args: string[], ctx: CommandContext) => void | Promise<void>;
}

/**
 * =========================================================================
 * HOW TO ADD YOUR OWN CUSTOM COMMAND:
 * =========================================================================
 * 1. Add a new command object to the `CUSTOM_COMMANDS` array below.
 * 2. Define its `name`, `description`, and `usage` instructions.
 * 3. Implement the `execute` function. You have access to:
 *    - `args`: string array of params passed (e.g. `dnet command arg1 arg2`)
 *    - `ctx`: an object with helper functions and current states:
 *         - `cwd`: current shell working directory path
 *         - `setCwd`: function to change shell working directory
 *         - `paneId`: ID of the terminal pane running this command
 *         - `workspace`: complete workspace context (splitPane, setPaneState, updateSettings, etc.)
 *         - `print(text, type)`: print text into terminal output console (types: "stdout", "stderr", "system")
 *         - `executeRaw(cmd)`: run a standard system bash/cmd command on the backend server
 *
 * Example:
 * {
 *   name: "greet",
 *   description: "Prints a warm greeting with an optional name parameter",
 *   usage: "dnet greet [your-name]",
 *   execute: (args, ctx) => {
 *     const name = args[0] || "Developer";
 *     ctx.print(`Hello, ${name}! Welcome to the dnet workspace environment.`, "stdout");
 *   }
 * }
 * =========================================================================
 */
export const CUSTOM_COMMANDS: CustomCommand[] = [
  {
    name: "help",
    description: "Displays list of all available dnet commands",
    usage: "dnet help",
    execute: (args, ctx) => {
      ctx.print("\x1b[1;34mDNET CUSTOM COMMAND SUITE\x1b[0m", "system");
      ctx.print("\x1b[90m==================================================\x1b[0m", "system");
      CUSTOM_COMMANDS.forEach((cmd) => {
        ctx.print(`\x1b[1;32mdnet ${cmd.name}\x1b[0m`, "stdout");
        ctx.print(`  \x1b[90mDesc :\x1b[0m ${cmd.description}`, "stdout");
        ctx.print(`  \x1b[90mUsage:\x1b[0m \x1b[36m${cmd.usage}\x1b[0m\n`, "stdout");
      });
      ctx.print("\x1b[90m==================================================\x1b[0m", "system");
      ctx.print("\x1b[35mCustomize in:\x1b[0m /src/lib/customCommands.ts", "system");
    },
  },
  {
    name: "edit",
    description: "Opens a file in the workspace code editor, splitting the pane",
    usage: "dnet edit <filename> [-h | --horizontal] [-v | --vertical]",
    execute: async (args, ctx) => {
      if (args.length === 0) {
        ctx.print("Error: Filename is required.", "stderr");
        ctx.print("Usage: dnet edit <filename> [-h | --horizontal] [-v | --vertical]", "system");
        return;
      }

      // Parse options
      let filename = "";
      let direction: "horizontal" | "vertical" = "vertical";

      for (const arg of args) {
        if (arg === "-h" || arg === "--horizontal") {
          direction = "horizontal";
        } else if (arg === "-v" || arg === "--vertical") {
          direction = "vertical";
        } else if (!arg.startsWith("-")) {
          filename = arg;
        }
      }

      if (!filename) {
        ctx.print("Error: Filename is required.", "stderr");
        return;
      }

      // Resolve relative file path based on current shell working directory
      let resolvedPath = filename;
      if (ctx.cwd && ctx.cwd !== "." && !filename.startsWith("/")) {
        resolvedPath = `${ctx.cwd}/${filename}`.replace(/\/+/g, "/");
      }

      ctx.print(`Opening '${resolvedPath}' in a new ${direction} editor split...`, "system");
      
      // Perform the layout split action
      ctx.workspace.splitPane(ctx.paneId, direction, "editor", { filePath: resolvedPath });
    },
  },
  {
    name: "terminal",
    description: "Opens another terminal in a new workspace split pane",
    usage: "dnet terminal [-h | --horizontal] [-v | --vertical]",
    execute: (args, ctx) => {
      let direction: "horizontal" | "vertical" = "vertical";
      for (const arg of args) {
        if (arg === "-h" || arg === "--horizontal") {
          direction = "horizontal";
        } else if (arg === "-v" || arg === "--vertical") {
          direction = "vertical";
        }
      }

      ctx.print(`Opening a new ${direction} terminal split...`, "system");
      ctx.workspace.splitPane(ctx.paneId, direction, "terminal", { terminalCwd: ctx.cwd });
    },
  },
  {
    name: "theme",
    description: "Changes the workspace active visual theme",
    usage: "dnet theme <slate | obsidian | cyberpunk | light>",
    execute: (args, ctx) => {
      const allowed = ["slate", "obsidian", "cyberpunk", "light"];
      const requested = args[0]?.toLowerCase();
      if (!requested || !allowed.includes(requested)) {
        ctx.print(`Error: Invalid theme. Choose from: ${allowed.join(", ")}`, "stderr");
        return;
      }
      ctx.print(`Changing theme to '${requested}'...`, "system");
      ctx.workspace.updateSettings({ theme: requested as any });
    },
  },
  {
    name: "layout",
    description: "Manages the workspace layout structure",
    usage: "dnet layout reset",
    execute: (args, ctx) => {
      if (args[0] === "reset") {
        ctx.print("Resetting workspace layout to default schema...", "system");
        ctx.workspace.resetLayout();
      } else {
        ctx.print("Usage: dnet layout reset", "stderr");
      }
    },
  },
  {
    name: "info",
    description: "Displays workspace state and host system information",
    usage: "dnet info",
    execute: async (args, ctx) => {
      ctx.print("Gathering workspace and host status info...", "system");
      try {
        const res = await fetch("/api/system/info");
        if (res.ok) {
          const sys = await res.json();
          ctx.print(`  Host Platform : ${sys.platform} (${sys.arch})`, "stdout");
          ctx.print(`  Node Version  : ${sys.nodeVersion}`, "stdout");
          ctx.print(`  Workspace Root: ${sys.rootDir}`, "stdout");
        }
      } catch (err: any) {
        ctx.print(`Could not fetch system info: ${err.message}`, "stderr");
      }
      ctx.print(`  Current CWD   : ${ctx.cwd}`, "stdout");
      ctx.print(`  Active Theme  : ${ctx.workspace.settings.theme}`, "stdout");
      ctx.print(`  Font Size     : ${ctx.workspace.settings.fontSize}px`, "stdout");
    },
  },
  {
    name: "calc",
    description: "Evaluates a simple mathematical expression",
    usage: "dnet calc <expression>",
    execute: (args, ctx) => {
      const expr = args.join(" ");
      if (!expr) {
        ctx.print("Usage: dnet calc <expression> (e.g., dnet calc 120 * 4.5)", "system");
        return;
      }
      try {
        // Safe evaluation of mathematical expression
        const safeFunc = new Function(`return (${expr})`);
        const result = safeFunc();
        ctx.print(`${expr} = ${result}`, "stdout");
      } catch (err: any) {
        ctx.print(`Error evaluating expression: ${err.message}`, "stderr");
      }
    },
  },
  {
    name: "create",
    description: "Creates a new file or directory inside the current path",
    usage: "dnet create <file | dir> <path>",
    execute: async (args, ctx) => {
      const type = args[0]?.toLowerCase();
      const relativePath = args[1];
      if (!type || !relativePath || (type !== "file" && type !== "dir")) {
        ctx.print("Usage: dnet create <file | dir> <path>", "stderr");
        return;
      }

      let resolvedPath = relativePath;
      if (ctx.cwd && ctx.cwd !== "." && !relativePath.startsWith("/")) {
        resolvedPath = `${ctx.cwd}/${relativePath}`.replace(/\/+/g, "/");
      }

      ctx.print(`Creating ${type} at '${resolvedPath}'...`, "system");

      try {
        const res = await fetch("/api/files/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: resolvedPath, type }),
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Creation failed");
        }

        ctx.print(`Successfully created ${type} at '${resolvedPath}'`, "stdout");
        // Emit a refresh event so the explorer is notified to reload!
        ctx.workspace.emitEvent("refresh-explorer", { path: ctx.cwd });
      } catch (err: any) {
        ctx.print(`Error creating ${type}: ${err.message}`, "stderr");
      }
    },
  },
  {
    name: "focus",
    description: "Highlights/focuses a specific pane by its ID or toggles fullscreen view",
    usage: "dnet focus [paneId]",
    execute: (args, ctx) => {
      const targetId = args[0];
      if (!targetId) {
        ctx.print("Toggling full-screen focus view for this pane...", "system");
        ctx.workspace.emitEvent("toggle-focus", { paneId: ctx.paneId });
        return;
      }
      const registry = ctx.workspace.panesRegistry || [];
      const found = registry.find((p) => p.id === targetId);
      if (!found) {
        ctx.print(`Error: Pane with ID '${targetId}' not found. Run 'dnet panes' to see active IDs.`, "stderr");
        return;
      }
      ctx.workspace.setActivePaneId(targetId);
      ctx.print(`Focused/highlighted pane '${targetId}'.`, "stdout");
    },
  },
  {
    name: "panes",
    description: "Lists all currently active workspace panes in the registry",
    usage: "dnet panes",
    execute: (args, ctx) => {
      const registry = ctx.workspace.panesRegistry || [];
      if (registry.length === 0) {
        ctx.print("No active panes in the registry.", "system");
        return;
      }
      ctx.print("Active Panes Registry:\n", "system");
      ctx.print(
        "ID".padEnd(25) + "Tool/View".padEnd(20) + "Highlighted?".padEnd(15) + "CWD/File Path\n",
        "system"
      );
      ctx.print("-".repeat(80) + "\n", "system");
      registry.forEach((p) => {
        const isSel = p.isActive ? "YES" : "No";
        let attr = "";
        if (p.pluginType === "file-explorer" && p.state?.currentPath) {
          attr = `cwd: ${p.state.currentPath}`;
        } else if (p.pluginType === "editor" && p.state?.filePath) {
          attr = `file: ${p.state.filePath}`;
        } else if (p.pluginType === "terminal" && p.state?.terminalCwd) {
          attr = `cwd: ${p.state.terminalCwd}`;
        } else {
          attr = "-";
        }
        ctx.print(`${p.id.padEnd(25)}${p.pluginType.padEnd(20)}${isSel.padEnd(15)}${attr}\n`, "stdout");
      });
    },
  },
  {
    name: "close",
    description: "Closes or pops history for a specific pane by its ID",
    usage: "dnet close <paneId>",
    execute: (args, ctx) => {
      const targetId = args[0];
      if (!targetId) {
        ctx.print("Usage: dnet close <paneId>", "stderr");
        return;
      }
      const registry = ctx.workspace.panesRegistry || [];
      const found = registry.find((p) => p.id === targetId);
      if (!found) {
        ctx.print(`Error: Pane with ID '${targetId}' not found.`, "stderr");
        return;
      }
      ctx.workspace.closePane(targetId);
      ctx.print(`Closed/Popped history for pane '${targetId}'.`, "stdout");
    },
  },
  {
    name: "set-tool",
    description: "Changes the tool/view of a specific pane",
    usage: "dnet set-tool <paneId> <editor | terminal | file-explorer | settings>",
    execute: (args, ctx) => {
      const paneId = args[0];
      const toolType = args[1];
      const allowed = ["editor", "terminal", "file-explorer", "settings"];
      if (!paneId || !toolType || !allowed.includes(toolType)) {
        ctx.print("Usage: dnet set-tool <paneId> <editor | terminal | file-explorer | settings>", "stderr");
        return;
      }
      const registry = ctx.workspace.panesRegistry || [];
      const found = registry.find((p) => p.id === paneId);
      if (!found) {
        ctx.print(`Error: Pane with ID '${paneId}' not found.`, "stderr");
        return;
      }
      ctx.workspace.setPanePlugin(paneId, toolType);
      ctx.print(`Changed pane '${paneId}' tool view to '${toolType}'.`, "stdout");
    },
  },
  {
    name: "open",
    description: "Opens a file in a target editor pane, or the highlighted pane",
    usage: "dnet open <filePath> [paneId]",
    execute: (args, ctx) => {
      const filePath = args[0];
      const targetPaneId = args[1];
      if (!filePath) {
        ctx.print("Usage: dnet open <filePath> [paneId]", "stderr");
        return;
      }

      let resolvedPath = filePath;
      if (ctx.cwd && ctx.cwd !== "." && !filePath.startsWith("/")) {
        resolvedPath = `${ctx.cwd}/${filePath}`.replace(/\/+/g, "/");
      }

      const registry = ctx.workspace.panesRegistry || [];

      if (targetPaneId) {
        const found = registry.find((p) => p.id === targetPaneId);
        if (!found) {
          ctx.print(`Error: Pane with ID '${targetPaneId}' not found.`, "stderr");
          return;
        }
        ctx.workspace.setPanePlugin(targetPaneId, "editor");
        ctx.workspace.setPaneState(targetPaneId, { filePath: resolvedPath });
        ctx.workspace.setActivePaneId(targetPaneId);
        ctx.print(`Opened '${resolvedPath}' in pane '${targetPaneId}'.`, "stdout");
      } else {
        ctx.workspace.emitEvent("open-file", { path: resolvedPath, sourcePaneId: ctx.workspace.activePaneId });
        ctx.print(`Opened '${resolvedPath}' in the highlighted pane context.`, "stdout");
      }
    },
  },
];
