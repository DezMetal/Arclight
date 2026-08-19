import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  FrameLeaf,
  FrameSummary,
  LayoutNode,
  OpenTarget,
  SplitDirection,
  ToolDefinition,
} from "../types";
import { PRESETS, THEMES, type PresetName, type ThemeName } from "../lib/themes";
import { STATE_VERSION, store } from "../lib/store";

// Re-exported so existing imports keep working; the definitions live in
// lib/themes.ts, which imports nothing and therefore cannot form a cycle.
export { PRESETS, THEMES };
export type { PresetName, ThemeName };

/** What happens when a file is opened and no frame is selected. */
export type DefaultOpenBehaviour = "current" | "new";

export interface WorkspaceSettings {
  fontSize: number;
  tabSize: number;
  autosave: boolean;
  showHidden: boolean;
  theme: ThemeName;
  preset: PresetName;
  rememberState: boolean;
  /** Where files land when nothing is explicitly selected. */
  defaultOpen: DefaultOpenBehaviour;
  /** Direction used when a file opens into a new frame. */
  defaultSplit: SplitDirection;

  /** Control API. Off by default; Arclight is fully usable offline. */
  apiEnabled: boolean;
  apiPort: number;
  apiToken: string;
  /** Bind beyond loopback. A deliberate, separate choice from enabling. */
  apiAllowRemote: boolean;
}

interface WorkspaceContextProps {
  layoutTree: LayoutNode | null;
  setLayoutTree: React.Dispatch<React.SetStateAction<LayoutNode | null>>;

  /** The frame with keyboard focus. Follows interaction. */
  focusedFrameId: string | null;
  focusFrame: (id: string | null) => void;

  /**
   * The frame explicitly chosen as the target for opens. Sticky: it is set by
   * clicking a frame's header, never by interacting with its content, so
   * clicking a file in the explorer does not silently retarget opens.
   */
  selectedFrameId: string | null;
  selectFrame: (id: string | null) => void;
  toggleSelectFrame: (id: string) => void;

  tools: Record<string, ToolDefinition>;
  registerTool: (tool: ToolDefinition) => void;

  frames: FrameSummary[];
  getFrameContext: (frameId: string, tool?: string) => any;

  splitFrame: (
    frameId: string,
    direction: SplitDirection,
    tool: string,
    context?: any,
  ) => string;
  closeFrame: (frameId: string) => void;
  /** Exchange two frames' positions, keeping their contexts. */
  swapFrames: (a: string, b: string) => void;
  setFrameTool: (frameId: string, tool: string) => void;
  setFrameContext: (frameId: string, patch: Record<string, unknown>) => void;
  setSplitPercentage: (splitId: string, percentage: number) => void;

  /** Resolve where an open would land, without performing it. */
  resolveOpenTarget: (target?: OpenTarget) => { frameId: string | null; willCreate: boolean };
  /** Open a file, honouring selection and the configured default. */
  openFile: (path: string, target?: OpenTarget) => void;

  emitEvent: (name: string, payload: any) => void;
  subscribeEvent: (name: string, handler: (payload: any) => void) => () => void;

  resetLayout: () => void;
  /** False until the user dismisses the first-run welcome. */
  seenWelcome: boolean;
  dismissWelcome: () => void;
  /** Where the workspace file lives, shown in settings. */
  statePath: string;
  settings: WorkspaceSettings;
  updateSettings: (patch: Partial<WorkspaceSettings>) => void;
}

const WorkspaceContext = createContext<WorkspaceContextProps | undefined>(undefined);

/** Explorer down the left, editor above terminal on the right. */
const DEFAULT_LAYOUT: LayoutNode = {
  type: "split",
  id: "split_root",
  direction: "horizontal",
  splitPercentage: 20,
  left: { type: "leaf", id: "frame_explorer", tool: "file-explorer", contexts: {} },
  right: {
    type: "split",
    id: "split_right",
    direction: "vertical",
    splitPercentage: 62,
    left: { type: "leaf", id: "frame_editor", tool: "editor", contexts: {} },
    right: { type: "leaf", id: "frame_terminal", tool: "terminal", contexts: {} },
  },
};

const DEFAULT_SETTINGS: WorkspaceSettings = {
  fontSize: 13,
  tabSize: 2,
  autosave: true,
  showHidden: false,
  theme: "dark",
  preset: "signal",
  rememberState: true,
  defaultOpen: "current",
  defaultSplit: "vertical",
  apiEnabled: false,
  apiPort: 8787,
  apiToken: "",
  apiAllowRemote: false,
};

const SETTINGS_KEY = "arclight_settings";
const LAYOUT_KEY = "arclight_layout";

// --- tree helpers ----------------------------------------------------------

export function frameContext(frame: FrameLeaf): any {
  return (frame.contexts || {})[frame.tool] || {};
}

export function collectFrames(node: LayoutNode | null): FrameLeaf[] {
  if (!node) return [];
  if (node.type === "leaf") return [node];
  return [...collectFrames(node.left), ...collectFrames(node.right)];
}

export function findFrame(node: LayoutNode | null, id: string): FrameLeaf | null {
  if (!node) return null;
  if (node.type === "leaf") return node.id === id ? node : null;
  return findFrame(node.left, id) ?? findFrame(node.right, id);
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Strip the last path segment. Tolerates both separators. */
function dirOf(filePath: string): string {
  const norm = filePath.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  if (idx <= 2) return norm.slice(0, idx + 1) || norm;
  return norm.slice(0, idx);
}

/**
 * The directory a frame is "at", whichever tool it happens to be showing.
 *
 * Lets a new tool pick up where the frame already was instead of dumping the
 * user back at their home directory every time they split or switch tools.
 */
export function frameLocation(frame: FrameLeaf): string | undefined {
  const contexts = frame.contexts || {};
  const order = [frame.tool, "file-explorer", "terminal", "editor"];
  for (const tool of order) {
    const ctx = contexts[tool];
    if (!ctx) continue;
    if (ctx.currentPath) return ctx.currentPath;
    if (ctx.terminalCwd) return ctx.terminalCwd;
    if (ctx.filePath) return dirOf(ctx.filePath);
  }
  return undefined;
}

/**
 * Seed a tool's context from where the frame already is.
 *
 * Switching a frame from explorer to terminal should open the shell in the
 * directory the explorer was showing, not at the home directory.
 */
export function deriveContext(frame: FrameLeaf, tool: string): any {
  const existing = (frame.contexts || {})[tool];
  if (existing && Object.keys(existing).length > 0) return existing;

  const location = frameLocation(frame);
  if (!location) return {};

  switch (tool) {
    case "file-explorer":
      return { currentPath: location };
    case "terminal":
      return { terminalCwd: location };
    default:
      return {};
  }
}

/**
 * The frame occupying the most screen area.
 *
 * Area is the product of the split fractions on the path down to the leaf,
 * which tracks what is actually on screen without measuring the DOM. Opening
 * into a new frame splits this one, so a new file lands in the roomiest place
 * rather than bisecting whatever narrow sidebar happened to be focused.
 */
export function largestFrameId(node: LayoutNode | null): string | null {
  let best: { id: string; area: number } | null = null;

  const walk = (n: LayoutNode, area: number) => {
    if (n.type === "leaf") {
      if (!best || area > best.area) best = { id: n.id, area };
      return;
    }
    const share = Math.min(100, Math.max(0, n.splitPercentage)) / 100;
    walk(n.left, area * share);
    walk(n.right, area * (1 - share));
  };

  if (node) walk(node, 1);
  return best ? (best as { id: string; area: number }).id : null;
}

function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/**
 * Bring a persisted layout up to the current shape.
 *
 * Handles two earlier generations: layouts with a single `state` blob instead
 * of per-tool `contexts`, and layouts using `pluginType` before frames were
 * called frames.
 */
function migrateLayout(node: LayoutNode | null): LayoutNode | null {
  if (!node) return null;

  if (node.type === "split") {
    const left = migrateLayout(node.left);
    const right = migrateLayout(node.right);
    if (!left) return right;
    if (!right) return left;
    return { ...node, left, right };
  }

  const tool = node.tool || node.pluginType || "file-explorer";

  let contexts = node.contexts;
  if (!contexts) {
    contexts = {};
    if (node.state && Object.keys(node.state).length > 0) {
      contexts[tool] = node.state;
    }
    for (const entry of (node.history || []) as { tool?: string; pluginType?: string; state?: any }[]) {
      const key = entry.tool || entry.pluginType;
      if (key && entry.state && !contexts[key]) contexts[key] = entry.state;
    }
  }

  return {
    type: "leaf",
    id: node.id,
    tool,
    contexts,
    history: (node.history || []).map((h: any) => ({ tool: h.tool || h.pluginType })).filter((h) => h.tool),
  };
}

/** Rewrite one leaf in place, returning the same tree object when nothing changed. */
function mapFrame(
  node: LayoutNode,
  frameId: string,
  fn: (frame: FrameLeaf) => FrameLeaf,
): LayoutNode {
  if (node.type === "leaf") {
    return node.id === frameId ? fn(node) : node;
  }
  const left = mapFrame(node.left, frameId, fn);
  const right = mapFrame(node.right, frameId, fn);
  return left === node.left && right === node.right ? node : { ...node, left, right };
}

// --- provider --------------------------------------------------------------

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // State is loaded asynchronously from the config file, so the first render
  // uses defaults and `hydrated` gates saving. Without that gate the defaults
  // would be written back over the saved workspace before it arrived.
  const [settings, setSettings] = useState<WorkspaceSettings>(DEFAULT_SETTINGS);
  const [layoutTree, setLayoutTree] = useState<LayoutNode | null>(DEFAULT_LAYOUT);
  const [hydrated, setHydrated] = useState(false);
  const [seenWelcome, setSeenWelcome] = useState(true);
  const [statePath, setStatePath] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [saved, where] = await Promise.all([
        store.load(),
        store.location().catch(() => ({ path: "", exists: false })),
      ]);
      if (cancelled) return;

      if (saved) {
        if (saved.settings) {
          setSettings({ ...DEFAULT_SETTINGS, ...(saved.settings as object) });
        }
        const remember =
          (saved.settings as WorkspaceSettings | undefined)?.rememberState !== false;
        if (remember && saved.layout) {
          setLayoutTree(migrateLayout(saved.layout as LayoutNode));
        }
        setSeenWelcome(saved.seenWelcome === true);
      } else {
        // Nothing saved: first run.
        setSeenWelcome(false);
      }

      setStatePath(where.path);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [focusedFrameId, setFocusedFrameId] = useState<string | null>(null);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [tools, setTools] = useState<Record<string, ToolDefinition>>({});

  const listeners = useRef<Map<string, Set<(payload: any) => void>>>(new Map());

  // Persist ---------------------------------------------------------------
  //
  // One file, written whenever anything changes, but never before the saved
  // state has been read back.
  useEffect(() => {
    if (!hydrated) return;
    void store
      .save({
        version: STATE_VERSION,
        layout: settings.rememberState ? layoutTree : null,
        settings,
        seenWelcome,
      })
      .catch((err) => console.warn("could not save workspace:", err));
  }, [hydrated, layoutTree, settings, seenWelcome]);

  useEffect(() => {
    // DSS reads these two attributes off <html>. Setting them here is the
    // entire theming mechanism - no class juggling, no per-component work.
    const root = document.documentElement;
    root.setAttribute("data-theme", settings.theme || "dark");
    root.setAttribute("data-dss-preset", settings.preset || "signal");
  }, [settings.theme, settings.preset]);

  // Drop focus/selection when the frame disappears.
  useEffect(() => {
    if (focusedFrameId && !findFrame(layoutTree, focusedFrameId)) setFocusedFrameId(null);
    if (selectedFrameId && !findFrame(layoutTree, selectedFrameId)) setSelectedFrameId(null);
  }, [layoutTree, focusedFrameId, selectedFrameId]);

  // Events ----------------------------------------------------------------
  const emitEvent = useCallback((name: string, payload: any) => {
    listeners.current.get(name)?.forEach((handler) => {
      try {
        handler(payload);
      } catch (err) {
        console.error(`event '${name}' handler failed:`, err);
      }
    });
  }, []);

  const subscribeEvent = useCallback((name: string, handler: (payload: any) => void) => {
    if (!listeners.current.has(name)) listeners.current.set(name, new Set());
    listeners.current.get(name)!.add(handler);
    return () => {
      const set = listeners.current.get(name);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) listeners.current.delete(name);
    };
  }, []);

  // Tools -----------------------------------------------------------------
  const registerTool = useCallback((tool: ToolDefinition) => {
    setTools((prev) => (prev[tool.type] === tool ? prev : { ...prev, [tool.type]: tool }));
  }, []);

  // Frame mutations -------------------------------------------------------
  const splitFrame = useCallback(
    (frameId: string, direction: SplitDirection, tool: string, context?: any): string => {
      const createdId = newId("frame");

      setLayoutTree((prev) => {
        // Without an explicit context, inherit where the source frame is, so a
        // split opens beside you rather than back at the home directory.
        const source = prev ? findFrame(prev, frameId) : null;
        const seeded =
          context !== undefined
            ? clone(context)
            : source
              ? deriveContext(source, tool)
              : {};
        if (!prev) {
          return { type: "leaf", id: createdId, tool, contexts: { [tool]: seeded } };
        }

        const split = (node: LayoutNode): LayoutNode => {
          if (node.type === "leaf") {
            if (node.id !== frameId) return node;
            return {
              type: "split",
              id: newId("split"),
              direction,
              splitPercentage: 50,
              left: { ...node },
              // The new frame seeds only the tool it is opened as. Inheriting
              // the source frame's whole context handed a terminal the
              // editor's filePath and vice versa.
              right: {
                type: "leaf",
                id: createdId,
                tool,
                contexts: { [tool]: seeded },
                history: [],
              },
            };
          }
          const left = split(node.left);
          const right = split(node.right);
          return left === node.left && right === node.right ? node : { ...node, left, right };
        };

        return split(prev);
      });

      return createdId;
    },
    [],
  );

  const closeFrame = useCallback((frameId: string) => {
    setLayoutTree((prev) => {
      if (!prev) return null;

      const remove = (node: LayoutNode): LayoutNode | null => {
        if (node.type === "leaf") {
          if (node.id !== frameId) return node;
          const history = node.history || [];
          if (history.length > 0) {
            // Popping history restores a previous tool; its context is still
            // held by the frame, so it comes back where it was.
            return { ...node, tool: history[history.length - 1].tool, history: history.slice(0, -1) };
          }
          return null;
        }
        const left = remove(node.left);
        const right = remove(node.right);
        if (!left) return right;
        if (!right) return left;
        return left === node.left && right === node.right ? node : { ...node, left, right };
      };

      return remove(prev);
    });
  }, []);

  const setFrameTool = useCallback((frameId: string, tool: string) => {
    setLayoutTree((prev) =>
      prev
        ? mapFrame(prev, frameId, (frame) => {
            if (frame.tool === tool) return frame;
            // Contexts are preserved, so explorer -> terminal -> explorer
            // returns the explorer to the directory it was showing. A tool
            // being opened here for the first time inherits the frame's
            // current location rather than starting at the home directory.
            const seeded = deriveContext(frame, tool);
            return {
              ...frame,
              tool,
              contexts: { ...(frame.contexts || {}), [tool]: seeded },
            };
          })
        : prev,
    );
  }, []);

  const setFrameContext = useCallback((frameId: string, patch: Record<string, unknown>) => {
    setLayoutTree((prev) =>
      prev
        ? mapFrame(prev, frameId, (frame) => {
            const contexts = frame.contexts || {};
            const current = contexts[frame.tool] || {};
            const unchanged = Object.keys(patch).every((k) => current[k] === patch[k]);
            if (unchanged) return frame;
            return {
              ...frame,
              contexts: { ...contexts, [frame.tool]: { ...current, ...patch } },
            };
          })
        : prev,
    );
  }, []);

  /**
   * Exchange the positions of two frames.
   *
   * Swapping whole leaves keeps every context, tool and history intact, so a
   * rearrangement never costs you a running shell or an editor's file.
   */
  const swapFrames = useCallback((a: string, b: string) => {
    if (a === b) return;
    setLayoutTree((prev) => {
      if (!prev) return prev;

      const first = findFrame(prev, a);
      const second = findFrame(prev, b);
      if (!first || !second) return prev;

      const replace = (node: LayoutNode): LayoutNode => {
        if (node.type === "leaf") {
          if (node.id === a) return second;
          if (node.id === b) return first;
          return node;
        }
        return { ...node, left: replace(node.left), right: replace(node.right) };
      };

      return replace(prev);
    });
  }, []);

  const setSplitPercentage = useCallback((splitId: string, percentage: number) => {
    setLayoutTree((prev) => {
      if (!prev) return null;
      const apply = (node: LayoutNode): LayoutNode => {
        if (node.type === "leaf") return node;
        if (node.id === splitId) {
          return { ...node, splitPercentage: Math.min(92, Math.max(8, percentage)) };
        }
        return { ...node, left: apply(node.left), right: apply(node.right) };
      };
      return apply(prev);
    });
  }, []);

  // Derived ---------------------------------------------------------------
  const frames = useMemo<FrameSummary[]>(
    () =>
      collectFrames(layoutTree).map((frame) => ({
        id: frame.id,
        tool: frame.tool,
        focused: frame.id === focusedFrameId,
        selected: frame.id === selectedFrameId,
        context: frameContext(frame),
        contexts: frame.contexts || {},
        historyCount: frame.history?.length ?? 0,
      })),
    [layoutTree, focusedFrameId, selectedFrameId],
  );

  const getFrameContext = useCallback(
    (frameId: string, tool?: string) => {
      const frame = findFrame(layoutTree, frameId);
      if (!frame) return undefined;
      return tool ? (frame.contexts || {})[tool] : frameContext(frame);
    },
    [layoutTree],
  );

  // Selection -------------------------------------------------------------
  const focusFrame = useCallback((id: string | null) => setFocusedFrameId(id), []);
  const selectFrame = useCallback((id: string | null) => setSelectedFrameId(id), []);
  const toggleSelectFrame = useCallback(
    (id: string) => setSelectedFrameId((prev) => (prev === id ? null : id)),
    [],
  );

  // Opening ---------------------------------------------------------------
  const resolveOpenTarget = useCallback(
    (target?: OpenTarget): { frameId: string | null; willCreate: boolean } => {
      // 1. An explicit frame always wins.
      if (target?.frameId) return { frameId: target.frameId, willCreate: false };
      // 2. An explicit request for a new frame.
      if (target?.newFrame) return { frameId: null, willCreate: true };
      // 3. A selected frame is the standing target.
      if (selectedFrameId && findFrame(layoutTree, selectedFrameId)) {
        return { frameId: selectedFrameId, willCreate: false };
      }
      // 4. Nothing selected: fall back to the configured default.
      if (settings.defaultOpen === "new") return { frameId: null, willCreate: true };
      return { frameId: target?.sourceFrameId ?? focusedFrameId, willCreate: false };
    },
    [selectedFrameId, focusedFrameId, layoutTree, settings.defaultOpen],
  );

  const openFile = useCallback(
    (path: string, target?: OpenTarget) => {
      const { frameId, willCreate } = resolveOpenTarget(target);

      if (willCreate) {
        // Split the roomiest frame, not whichever one happened to be focused.
        // Opening from a narrow explorer sidebar otherwise bisected the
        // sidebar and produced two unusably thin frames.
        const origin =
          largestFrameId(layoutTree) ??
          target?.sourceFrameId ??
          selectedFrameId ??
          focusedFrameId ??
          collectFrames(layoutTree)[0]?.id;
        if (!origin) {
          setLayoutTree({
            type: "leaf",
            id: newId("frame"),
            tool: "editor",
            contexts: { editor: { filePath: path } },
          });
          return;
        }
        const created = splitFrame(
          origin,
          target?.direction ?? settings.defaultSplit,
          "editor",
          { filePath: path },
        );
        setFocusedFrameId(created);
        return;
      }

      if (!frameId) return;

      // Switching an existing frame to the editor records what it was showing,
      // so closing the frame pops back to it.
      setLayoutTree((prev) =>
        prev
          ? mapFrame(prev, frameId, (frame) => ({
              ...frame,
              tool: "editor",
              history:
                frame.tool === "editor"
                  ? frame.history || []
                  : [...(frame.history || []), { tool: frame.tool }],
              contexts: {
                ...(frame.contexts || {}),
                editor: { ...((frame.contexts || {}).editor || {}), filePath: path },
              },
            }))
          : prev,
      );
      setFocusedFrameId(frameId);
    },
    [resolveOpenTarget, splitFrame, layoutTree, selectedFrameId, focusedFrameId, settings.defaultSplit],
  );

  const dismissWelcome = useCallback(() => setSeenWelcome(true), []);

  const resetLayout = useCallback(() => {
    setLayoutTree(DEFAULT_LAYOUT);
    setSelectedFrameId(null);
  }, []);

  const updateSettings = useCallback((patch: Partial<WorkspaceSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        layoutTree,
        setLayoutTree,
        focusedFrameId,
        focusFrame,
        selectedFrameId,
        selectFrame,
        toggleSelectFrame,
        tools,
        registerTool,
        frames,
        getFrameContext,
        splitFrame,
        closeFrame,
        swapFrames,
        setFrameTool,
        setFrameContext,
        setSplitPercentage,
        resolveOpenTarget,
        openFile,
        emitEvent,
        subscribeEvent,
        resetLayout,
        seenWelcome,
        dismissWelcome,
        statePath,
        settings,
        updateSettings,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside a WorkspaceProvider");
  return ctx;
};
