import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronRight,
  Eye,
  EyeOff,
  File as FileIcon,
  FilePlus,
  Folder,
  FolderPlus,
  HardDrive,
  Home,
  Link2,
  Lock,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { useWorkspace } from "../context/WorkspaceContext";
import type { ToolProps } from "../types";
import { fs, paths, errorText, type DriveInfo, type FileEntry } from "../lib/api";

interface MenuState {
  x: number;
  y: number;
  entry: FileEntry;
}

const HIDDEN_PREFIXES = [".", "$"];

function isHidden(entry: FileEntry): boolean {
  return HIDDEN_PREFIXES.some((p) => entry.name.startsWith(p));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export const FileExplorerPane: React.FC<ToolProps> = ({ frameId, context, setContext }) => {
  const workspace = useWorkspace();
  const { settings, updateSettings, frames, openFile, selectedFrameId } = workspace;

  const [path, setPath] = useState(context.currentPath ?? "");
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [addressDraft, setAddressDraft] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<{ entry: FileEntry; cut: boolean } | null>(null);
  const [submenuOpen, setSubmenuOpen] = useState(false);

  const pathRef = useRef(path);
  pathRef.current = path;

  /** Frames a file can be sent to. This one is excluded - an explorer
   *  cannot usefully display a file, and "Open" already covers in-place. */
  const otherFrames = useMemo(
    () => frames.filter((f) => f.id !== frameId),
    [frames, frameId],
  );

  useEffect(() => {
    fs.drives().then(setDrives).catch(() => setDrives([]));
  }, []);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setError(null);
    try {
      const listing = await fs.list(target);
      setPath(listing.path);
      setParent(listing.parent);
      setEntries(listing.entries);
      setSelected(null);
    } catch (err) {
      setError(errorText(err));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial location: remembered path, else the user's home.
  useEffect(() => {
    (async () => {
      const start = context.currentPath || (await fs.homeDir().catch(() => ""));
      if (start) await load(start);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (path) setContext({ currentPath: path });
  }, [path, setContext]);

  useEffect(() => {
    const unsubscribe = workspace.subscribeEvent("refresh-explorer", () => {
      if (pathRef.current) void load(pathRef.current);
    });
    return unsubscribe;
  }, [workspace, load]);

  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null);
    window.addEventListener("click", dismiss);
    window.addEventListener("contextmenu", dismiss);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("contextmenu", dismiss);
    };
  }, [menu]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return entries.filter((entry) => {
      if (!settings.showHidden && isHidden(entry)) return false;
      if (needle && !entry.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [entries, filter, settings.showHidden]);

  /**
   * Open an entry. Directories navigate in place; files go wherever the
   * workspace decides - the selected frame if there is one, otherwise the
   * configured default. `sourceFrameId` is this frame, used only as the
   * fallback when nothing is selected.
   */
  const openEntry = useCallback(
    (entry: FileEntry, target?: { frameId?: string; newFrame?: boolean }) => {
      if (entry.isDirectory && !target) {
        void load(entry.path);
        return;
      }
      openFile(entry.path, { ...target, sourceFrameId: frameId });
    },
    [load, openFile, frameId],
  );

  const doDelete = useCallback(
    async (entry: FileEntry) => {
      const label = entry.isDirectory ? "folder and everything inside it" : "file";
      if (!window.confirm(`Delete this ${label}?\n\n${entry.path}`)) return;
      try {
        await fs.delete(entry.path, entry.isDirectory);
        await load(pathRef.current);
      } catch (err) {
        setError(errorText(err));
      }
    },
    [load],
  );

  const commitRename = useCallback(
    async (entry: FileEntry) => {
      const next = draftName.trim();
      setRenaming(null);
      if (!next || next === entry.name) return;
      try {
        await fs.rename(entry.path, paths.join(paths.dirname(entry.path), next));
        await load(pathRef.current);
      } catch (err) {
        setError(errorText(err));
      }
    },
    [draftName, load],
  );

  const createEntry = useCallback(
    async (kind: "file" | "dir") => {
      const name = window.prompt(kind === "dir" ? "New folder name" : "New file name");
      if (!name?.trim()) return;
      try {
        await fs.create(paths.join(pathRef.current, name.trim()), kind);
        await load(pathRef.current);
      } catch (err) {
        setError(errorText(err));
      }
    },
    [load],
  );

  const paste = useCallback(async () => {
    if (!clipboard) return;
    const target = paths.join(pathRef.current, clipboard.entry.name);
    try {
      if (clipboard.cut) {
        await fs.rename(clipboard.entry.path, target);
      } else if (clipboard.entry.isDirectory) {
        setError("copying folders is not supported yet — use the terminal");
        return;
      } else {
        await fs.copy(clipboard.entry.path, target);
      }
      setClipboard(null);
      await load(pathRef.current);
    } catch (err) {
      setError(errorText(err));
    }
  }, [clipboard, load]);

  const breadcrumbs = useMemo(() => {
    if (!path) return [];
    const parts = path.split(/[\\/]/).filter(Boolean);
    const crumbs: { label: string; target: string }[] = [];
    let acc = "";
    parts.forEach((part: string, index: number) => {
      acc = index === 0 ? `${part}\\` : paths.join(acc, part);
      crumbs.push({ label: part, target: acc });
    });
    return crumbs;
  }, [path]);

  return (
    <div
            className="h-full flex flex-col overflow-hidden"
      style={{ backgroundColor: "var(--dss-bg-panel)" }}
    >
      {/* Toolbar */}
      <header
        className="dss-chrome flex items-center gap-1 px-1.5 py-1 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--dss-border-soft)" }}
      >
        <button
          className="dss-icon-button"
          title="Up one level"
          disabled={!parent}
          onClick={() => parent && load(parent)}
        >
          <ArrowUp size={12} />
        </button>
        <button
          className="dss-icon-button"
          title="Home"
          onClick={async () => load(await fs.homeDir())}
        >
          <Home size={12} />
        </button>
        <button className="dss-icon-button" title="Refresh" onClick={() => load(path)}>
          <RefreshCw size={12} className={loading ? "dss-pulse" : undefined} />
        </button>

        <div className="flex-1" />

        <button className="dss-icon-button" title="New file" onClick={() => createEntry("file")}>
          <FilePlus size={12} />
        </button>
        <button className="dss-icon-button" title="New folder" onClick={() => createEntry("dir")}>
          <FolderPlus size={12} />
        </button>
        <button
          className="dss-icon-button"
          title={settings.showHidden ? "Hide hidden items" : "Show hidden items"}
          onClick={() => updateSettings({ showHidden: !settings.showHidden })}
        >
          {settings.showHidden ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </header>

      {/* Address bar */}
      <div
        className="px-1.5 py-1 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--dss-border-soft)" }}
      >
        {addressDraft !== null ? (
          <input
            className="dss-input"
            autoFocus
            value={addressDraft}
            onChange={(e) => setAddressDraft(e.target.value)}
            onBlur={() => setAddressDraft(null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void load(addressDraft);
                setAddressDraft(null);
              } else if (e.key === "Escape") {
                setAddressDraft(null);
              }
            }}
          />
        ) : (
          <div
            className="flex items-center gap-0.5 overflow-x-auto whitespace-nowrap text-[11px] cursor-text"
            style={{ fontFamily: "var(--dss-font-mono)", scrollbarWidth: "none" }}
            onClick={() => setAddressDraft(path)}
            title="Click to type a path"
          >
            {breadcrumbs.map((crumb, index) => (
              <React.Fragment key={crumb.target}>
                {index > 0 && (
                  <ChevronRight size={9} style={{ color: "var(--dss-text-faint)" }} />
                )}
                <button
                  className="px-1 py-0.5 hover:underline"
                  style={{ color: "var(--dss-text-dim)", background: "none", border: "none" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void load(crumb.target);
                  }}
                >
                  {crumb.label}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Filter */}
      <div
        className="px-1.5 py-1 flex items-center gap-1 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--dss-border-soft)" }}
      >
        <Search size={11} style={{ color: "var(--dss-text-faint)" }} className="flex-shrink-0" />
        <input
          className="dss-input"
          style={{ border: "none", background: "transparent", padding: "1px 2px" }}
          placeholder="filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setFilter("")}
        />
        {filter && (
          <button className="dss-icon-button" onClick={() => setFilter("")}>
            <X size={11} />
          </button>
        )}
        {clipboard && (
          <button
            className="dss-label px-1 flex-shrink-0"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--dss-accent)" }}
            onClick={paste}
            title={`Paste ${clipboard.entry.name}`}
          >
            paste
          </button>
        )}
      </div>

      {error && (
        <div
          className="px-2 py-1 text-[11px] flex-shrink-0 dss-selectable"
          style={{ color: "var(--dss-destructive)", backgroundColor: "var(--dss-bg-input)" }}
        >
          {error}
        </div>
      )}

      {/* Listing */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {visible.map((entry) => {
          const isSelected = selected === entry.path;
          return (
            <div
              key={entry.path}
              onClick={() => setSelected(entry.path)}
              onDoubleClick={() => openEntry(entry)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSelected(entry.path);
                setSubmenuOpen(false);
                setMenu({ x: e.clientX, y: e.clientY, entry });
              }}
              className="flex items-center gap-1.5 px-2 py-[3px] cursor-pointer text-[12px]"
              style={{
                backgroundColor: isSelected ? "var(--dss-bg-surface)" : "transparent",
                color: entry.unreadable ? "var(--dss-text-faint)" : "var(--dss-text)",
                borderLeft: isSelected
                  ? "2px solid var(--dss-accent)"
                  : "2px solid transparent",
              }}
            >
              {entry.isDirectory ? (
                <Folder size={12} style={{ color: "var(--dss-accent)" }} className="flex-shrink-0" />
              ) : (
                <FileIcon
                  size={12}
                  style={{ color: "var(--dss-text-faint)" }}
                  className="flex-shrink-0"
                />
              )}

              {renaming === entry.path ? (
                <input
                  className="dss-input"
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => void commitRename(entry)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename(entry);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="truncate flex-1">{entry.name}</span>
                  {entry.isSymlink && (
                    <Link2 size={9} style={{ color: "var(--dss-text-faint)" }} className="flex-shrink-0" />
                  )}
                  {entry.readonly && !entry.isDirectory && (
                    <Lock size={9} style={{ color: "var(--dss-text-faint)" }} className="flex-shrink-0" />
                  )}
                  {!entry.isDirectory && (
                    <span
                      className="text-[10px] flex-shrink-0"
                      style={{ color: "var(--dss-text-faint)" }}
                    >
                      {formatSize(entry.size)}
                    </span>
                  )}
                </>
              )}
            </div>
          );
        })}

        {!loading && visible.length === 0 && !error && (
          <div className="px-2 py-3 text-[11px]" style={{ color: "var(--dss-text-faint)" }}>
            {filter ? "nothing matches" : "empty"}
          </div>
        )}
      </div>

      {/* Drives */}
      {drives.length > 0 && (
        <footer
          className="dss-chrome flex items-center gap-1 px-1.5 py-1 flex-shrink-0 overflow-x-auto"
          style={{ borderTop: "1px solid var(--dss-border-soft)" }}
        >
          <HardDrive size={11} style={{ color: "var(--dss-text-faint)" }} className="flex-shrink-0" />
          {drives.map((drive) => (
            <button
              key={drive.path}
              className="dss-label px-1 flex-shrink-0"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: path.toUpperCase().startsWith(drive.label.toUpperCase())
                  ? "var(--dss-accent)"
                  : "var(--dss-text-dim)",
              }}
              onClick={() => load(drive.path)}
            >
              {drive.label}
            </button>
          ))}
        </footer>
      )}

      {/* Context menu */}
      {menu && (
        <div
          className="fixed dss-cut-sm"
          style={{
            left: Math.min(menu.x, window.innerWidth - 200),
            top: Math.min(menu.y, window.innerHeight - 290),
            zIndex: 900,
            minWidth: 190,
            backgroundColor: "var(--dss-bg-surface)",
            boxShadow: "0 0 0 1px var(--dss-border)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {[
            {
              label: menu.entry.isDirectory
                ? "Open"
                : selectedFrameId
                  ? `Open in ${selectedFrameId}`
                  : "Open",
              run: () => openEntry(menu.entry),
            },
            ...(menu.entry.isDirectory
              ? []
              : [
                  {
                    label: "Open in frame",
                    submenu: true as const,
                    run: () => setSubmenuOpen((v) => !v),
                  },
                  {
                    label: "Open in new frame",
                    run: () => openEntry(menu.entry, { newFrame: true }),
                  },
                ]),
            {
              label: "Open with system app",
              run: () => fs.openExternal(menu.entry.path).catch((e) => setError(errorText(e))),
            },
            {
              label: "Reveal in Explorer",
              run: () => fs.revealInExplorer(menu.entry.path).catch((e) => setError(errorText(e))),
            },
            {
              label: "Terminal here",
              run: () =>
                workspace.emitEvent("change-terminal-cwd", {
                  path: menu.entry.isDirectory ? menu.entry.path : paths.dirname(menu.entry.path),
                }),
            },
            { label: "Copy", run: () => setClipboard({ entry: menu.entry, cut: false }) },
            { label: "Cut", run: () => setClipboard({ entry: menu.entry, cut: true }) },
            {
              label: "Copy path",
              run: () => navigator.clipboard.writeText(menu.entry.path),
            },
            {
              label: "Rename",
              run: () => {
                setDraftName(menu.entry.name);
                setRenaming(menu.entry.path);
              },
            },
            { label: "Delete", run: () => void doDelete(menu.entry), danger: true },
          ].map((item) => (
            <React.Fragment key={item.label}>
              <button
                className="w-full text-left px-2.5 py-1.5 text-[11px] flex items-center justify-between gap-2"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: item.danger ? "var(--dss-destructive)" : "var(--dss-text)",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = "var(--dss-bg-input)")
                }
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                onClick={() => {
                  item.run();
                  // The submenu toggle keeps the menu open; everything else closes it.
                  if (!item.submenu) setMenu(null);
                }}
              >
                <span>{item.label}</span>
                {item.submenu && <ChevronRight size={10} />}
              </button>

              {item.submenu && submenuOpen && (
                <div style={{ backgroundColor: "var(--dss-bg-input)" }}>
                  {otherFrames.length === 0 && (
                    <div
                      className="px-4 py-1.5 text-[10px]"
                      style={{ color: "var(--dss-text-faint)" }}
                    >
                      no other frames
                    </div>
                  )}
                  {otherFrames.map((f) => (
                    <button
                      key={f.id}
                      className="w-full text-left px-4 py-1.5 text-[11px] flex items-center justify-between gap-2"
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--dss-text)",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor = "var(--dss-bg-surface)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = "transparent")
                      }
                      onClick={() => {
                        openEntry(menu.entry, { frameId: f.id });
                        setMenu(null);
                        setSubmenuOpen(false);
                      }}
                    >
                      <span>{f.id}</span>
                      <span className="dss-label" style={{ fontSize: 8 }}>
                        {f.tool}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};
