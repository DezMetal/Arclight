/**
 * The one place the UI talks to the backend.
 *
 * Everything goes through Tauri IPC — there is no HTTP server, no port, and
 * nothing listening on the network. Panes import from here rather than calling
 * `invoke` directly, so the transport can change without touching components.
 */

import { invoke, Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// --- Filesystem ------------------------------------------------------------

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  modified: number | null;
  readonly: boolean;
  unreadable: boolean;
}

export interface DirListing {
  path: string;
  parent: string | null;
  entries: FileEntry[];
}

export interface FileContent {
  path: string;
  content: string;
  truncated: boolean;
  size: number;
}

export interface DriveInfo {
  path: string;
  label: string;
}

/** Rust returns snake_case; the UI wants camelCase. */
interface RawFileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  is_symlink: boolean;
  size: number;
  modified: number | null;
  readonly: boolean;
  unreadable: boolean;
}

function toFileEntry(raw: RawFileEntry): FileEntry {
  return {
    name: raw.name,
    path: raw.path,
    isDirectory: raw.is_directory,
    isSymlink: raw.is_symlink,
    size: raw.size,
    modified: raw.modified,
    readonly: raw.readonly,
    unreadable: raw.unreadable,
  };
}

export const fs = {
  async list(path: string): Promise<DirListing> {
    const raw = await invoke<{
      path: string;
      parent: string | null;
      entries: RawFileEntry[];
    }>("fs_list", { path });
    return {
      path: raw.path,
      parent: raw.parent,
      entries: raw.entries.map(toFileEntry),
    };
  },

  read(path: string): Promise<FileContent> {
    return invoke<FileContent>("fs_read", { path });
  },

  write(path: string, content: string): Promise<void> {
    return invoke<void>("fs_write", { path, content });
  },

  create(path: string, kind: "file" | "dir"): Promise<string> {
    return invoke<string>("fs_create", { path, kind });
  },

  /** Directory deletes require `recursive` explicitly — see fs_api.rs. */
  delete(path: string, recursive = false): Promise<void> {
    return invoke<void>("fs_delete", { path, recursive });
  },

  rename(from: string, to: string): Promise<string> {
    return invoke<string>("fs_rename", { from, to });
  },

  exists(path: string): Promise<boolean> {
    return invoke<boolean>("fs_exists", { path });
  },

  homeDir(): Promise<string> {
    return invoke<string>("fs_home_dir");
  },

  drives(): Promise<DriveInfo[]> {
    return invoke<DriveInfo[]>("fs_drives");
  },

  openExternal(path: string): Promise<void> {
    return invoke<void>("open_external", { path });
  },

  revealInExplorer(path: string): Promise<void> {
    return invoke<void>("reveal_in_explorer", { path });
  },

  /** Copy via read+write. Adequate for text; binaries need a Rust-side copy. */
  async copy(from: string, to: string): Promise<void> {
    const file = await fs.read(from);
    await fs.write(to, file.content);
  },
};

// --- Paths -----------------------------------------------------------------

/**
 * Path helpers that assume Windows separators but tolerate forward slashes,
 * since the user types both and shells emit both.
 */
export const paths = {
  sep: "\\",

  join(base: string, ...parts: string[]): string {
    let out = base.replace(/[\\/]+$/, "");
    for (const part of parts) {
      const clean = part.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "");
      if (clean) out += `\\${clean}`;
    }
    return out;
  },

  dirname(p: string): string {
    const norm = p.replace(/[\\/]+$/, "");
    const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
    if (idx <= 2) return norm.slice(0, idx + 1) || norm;
    return norm.slice(0, idx);
  },

  basename(p: string): string {
    const norm = p.replace(/[\\/]+$/, "");
    const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
    return idx === -1 ? norm : norm.slice(idx + 1);
  },

  extname(p: string): string {
    const base = paths.basename(p);
    const idx = base.lastIndexOf(".");
    return idx <= 0 ? "" : base.slice(idx).toLowerCase();
  },

  isAbsolute(p: string): boolean {
    return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\") || p.startsWith("/");
  },

  /** Resolve `input` against `base` when it is not already absolute. */
  resolve(base: string, input: string): string {
    if (paths.isAbsolute(input)) return input.replace(/\//g, "\\");
    return paths.join(base, input.replace(/\//g, "\\"));
  },
};

// --- Terminal --------------------------------------------------------------

export interface ShellOption {
  id: string;
  label: string;
  path: string;
}

export interface SessionInfo {
  id: string;
  alive: boolean;
  shell: string;
  cwd: string;
}

export interface SpawnOptions {
  id: string;
  cwd?: string;
  cols: number;
  rows: number;
  shell?: string;
}

export const pty = {
  /**
   * Start a session, or reattach to one that is already running.
   *
   * `onData` receives raw PTY bytes. On reattach the backend replays
   * scrollback through the same channel first, so the pane redraws exactly
   * as it looked before it unmounted.
   */
  async spawn(
    options: SpawnOptions,
    onData: (bytes: Uint8Array) => void,
  ): Promise<SessionInfo> {
    const channel = new Channel<ArrayBuffer>();
    channel.onmessage = (message) => {
      onData(new Uint8Array(message));
    };
    return invoke<SessionInfo>("pty_spawn", { options, onData: channel });
  },

  write(id: string, data: string): Promise<void> {
    return invoke<void>("pty_write", { id, data });
  },

  resize(id: string, cols: number, rows: number): Promise<void> {
    return invoke<void>("pty_resize", { id, cols, rows });
  },

  /** Stop receiving output without killing the shell. */
  detach(id: string): Promise<void> {
    return invoke<void>("pty_detach", { id });
  },

  kill(id: string): Promise<void> {
    return invoke<void>("pty_kill", { id });
  },

  list(): Promise<SessionInfo[]> {
    return invoke<SessionInfo[]>("pty_list");
  },

  availableShells(): Promise<ShellOption[]> {
    return invoke<ShellOption[]>("pty_available_shells");
  },

  /** Fires when a shell reports a new working directory via OSC 7 / OSC 9;9. */
  onCwdChange(
    handler: (payload: { id: string; cwd: string }) => void,
  ): Promise<UnlistenFn> {
    return listen<{ id: string; cwd: string }>("pty:cwd", (event) =>
      handler(event.payload),
    );
  },

  /** Fires when a shell process exits. */
  onExit(handler: (payload: { id: string }) => void): Promise<UnlistenFn> {
    return listen<{ id: string }>("pty:exit", (event) => handler(event.payload));
  },
};

// --- System ----------------------------------------------------------------

export interface SystemInfo {
  os: string;
  arch: string;
  app_version: string;
  home_dir: string | null;
  hostname: string | null;
  username: string | null;
}

export function systemInfo(): Promise<SystemInfo> {
  return invoke<SystemInfo>("system_info");
}

/** Normalise the string form of an error thrown across the IPC boundary. */
export function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}
