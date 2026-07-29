import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { LayoutNode, PaneLeaf, SplitDirection, PluginDefinition } from "../types";

export type ThemeName = "dnet" | "arc" | "light";

export const THEMES: { id: ThemeName; label: string; description: string }[] = [
  { id: "dnet", label: "D-Net", description: "Signature palette, tuned for long sessions" },
  { id: "arc", label: "Arc", description: "Full-intensity DSS cyan" },
  { id: "light", label: "Alabaster", description: "Clean light surface" },
];

interface WorkspaceSettings {
  fontSize: number;
  tabSize: number;
  autosave: boolean;
  showHidden: boolean;
  theme: ThemeName;
  rememberState: boolean;
}

interface WorkspaceContextProps {
  layoutTree: LayoutNode | null;
  setLayoutTree: React.Dispatch<React.SetStateAction<LayoutNode | null>>;
  activePaneId: string | null;
  setActivePaneId: (id: string | null) => void;
  lastActiveEditorId: string | null;
  setLastActiveEditorId: (id: string | null) => void;
  plugins: Record<string, PluginDefinition>;
  registerPlugin: (plugin: PluginDefinition) => void;
  splitPane: (paneId: string, direction: SplitDirection, newPluginType: string, initialState?: any) => void;
  closePane: (paneId: string) => void;
  setPanePlugin: (paneId: string, pluginType: string) => void;
  setPaneState: (paneId: string, state: any) => void;
  updateSplitPercentage: (parentId: string, percentage: number) => void;
  emitEvent: (name: string, payload: any) => void;
  subscribeEvent: (name: string, handler: (payload: any) => void) => () => void;
  resetLayout: () => void;
  settings: WorkspaceSettings;
  updateSettings: (newSettings: Partial<WorkspaceSettings>) => void;
  panesRegistry: PaneSummary[];
  /** Read any pane's stored context for a tool, without mounting it. */
  getPaneContext: (paneId: string, pluginType?: string) => any;
}

const WorkspaceContext = createContext<WorkspaceContextProps | undefined>(undefined);

/** Explorer down the left, editor above terminal on the right. */
const DEFAULT_LAYOUT: LayoutNode = {
  type: "split",
  id: "split_root",
  direction: "horizontal",
  splitPercentage: 20,
  left: {
    type: "leaf",
    id: "pane_explorer",
    pluginType: "file-explorer",
    state: {},
  },
  right: {
    type: "split",
    id: "split_right",
    direction: "vertical",
    splitPercentage: 62,
    left: {
      type: "leaf",
      id: "pane_editor",
      pluginType: "editor",
      state: {},
    },
    right: {
      type: "leaf",
      id: "pane_terminal",
      pluginType: "terminal",
      state: {},
    },
  },
};

const DEFAULT_SETTINGS: WorkspaceSettings = {
  fontSize: 13,
  tabSize: 2,
  autosave: true,
  showHidden: false,
  theme: "dnet",
  rememberState: true,
};

const SETTINGS_KEY = "arclight_settings";
const LAYOUT_KEY = "arclight_layout";

export interface PaneSummary {
  id: string;
  pluginType: string;
  isActive: boolean;
  /** The active tool's context. */
  state: any;
  /** Every tool context this pane remembers, keyed by plugin type. */
  contexts: Record<string, any>;
  historyCount: number;
}

/** Read the context a leaf holds for the tool it is currently showing. */
export function leafContext(leaf: PaneLeaf): any {
  return (leaf.contexts || {})[leaf.pluginType] || {};
}

/**
 * Bring a persisted layout up to the current shape.
 *
 * Layouts saved before panes had per-tool contexts carry a single `state`
 * object plus history entries that embedded their own state. Both are folded
 * into `contexts` so an existing saved workspace keeps working.
 */
function migrateLayout(node: LayoutNode | null): LayoutNode | null {
  if (!node) return null;
  if (node.type === "split") {
    return { ...node, left: migrateLayout(node.left)!, right: migrateLayout(node.right)! };
  }

  if (node.contexts) {
    return node;
  }

  const contexts: Record<string, any> = {};
  if (node.state && Object.keys(node.state).length > 0) {
    contexts[node.pluginType] = node.state;
  }
  for (const entry of (node.history || []) as { pluginType: string; state?: any }[]) {
    if (entry.state && !contexts[entry.pluginType]) {
      contexts[entry.pluginType] = entry.state;
    }
  }

  const { state: _dropped, ...rest } = node;
  return {
    ...rest,
    contexts,
    history: (node.history || []).map((h) => ({ pluginType: h.pluginType })),
  };
}

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<WorkspaceSettings>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [layoutTree, setLayoutTree] = useState<LayoutNode | null>(() => {
    try {
      const settingsSaved = localStorage.getItem(SETTINGS_KEY);
      const parsedSettings = settingsSaved ? JSON.parse(settingsSaved) : null;
      const remember = parsedSettings ? parsedSettings.rememberState !== false : true;
      if (!remember) return DEFAULT_LAYOUT;

      const saved = localStorage.getItem(LAYOUT_KEY);
      return saved ? migrateLayout(JSON.parse(saved)) : DEFAULT_LAYOUT;
    } catch {
      return DEFAULT_LAYOUT;
    }
  });

  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const [lastActiveEditorId, setLastActiveEditorId] = useState<string | null>(null);
  const [plugins, setPlugins] = useState<Record<string, PluginDefinition>>({});
  const [panesRegistry, setPanesRegistry] = useState<PaneSummary[]>([]);
  
  const eventListeners = useRef<Map<string, Set<(payload: any) => void>>>(new Map());

  // Update panes registry on layoutTree or activePaneId modification
  useEffect(() => {
    const getLeaves = (node: LayoutNode | null): PaneLeaf[] => {
      if (!node) return [];
      if (node.type === "leaf") return [node];
      return [...getLeaves(node.left), ...getLeaves(node.right)];
    };
    const leaves = getLeaves(layoutTree);
    const registry = leaves.map((leaf) => ({
      id: leaf.id,
      pluginType: leaf.pluginType,
      isActive: leaf.id === activePaneId,
      state: (leaf.contexts || {})[leaf.pluginType] || {},
      contexts: leaf.contexts || {},
      historyCount: leaf.history ? leaf.history.length : 0,
    }));
    setPanesRegistry(registry);
  }, [layoutTree, activePaneId]);

  // Save layout tree on modification if rememberState is enabled
  useEffect(() => {
    if (settings.rememberState && layoutTree) {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layoutTree));
    } else if (!settings.rememberState) {
      localStorage.removeItem(LAYOUT_KEY);
    }
  }, [layoutTree, settings.rememberState]);

  // Save settings on modification and apply theme body class
  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    
    // The theme class goes on <html>, not <body>, so that code reading tokens
    // off documentElement (the terminal palette) sees the active theme.
    const root = document.documentElement;
    THEMES.forEach((t) => root.classList.remove(`theme-${t.id}`));
    root.classList.add(`theme-${settings.theme || "dnet"}`);
  }, [settings]);

  // Event Broadcasting Implementation
  const emitEvent = useCallback((name: string, payload: any) => {
    const listeners = eventListeners.current.get(name);
    if (listeners) {
      listeners.forEach((handler) => {
        try {
          handler(payload);
        } catch (err) {
          console.error(`Error broadcasting event '${name}':`, err);
        }
      });
    }
  }, []);

  const subscribeEvent = useCallback((name: string, handler: (payload: any) => void) => {
    if (!eventListeners.current.has(name)) {
      eventListeners.current.set(name, new Set());
    }
    eventListeners.current.get(name)!.add(handler);
    
    return () => {
      const listeners = eventListeners.current.get(name);
      if (listeners) {
        listeners.delete(handler);
        if (listeners.size === 0) {
          eventListeners.current.delete(name);
        }
      }
    };
  }, []);

  const registerPlugin = useCallback((plugin: PluginDefinition) => {
    setPlugins((prev) => ({ ...prev, [plugin.type]: plugin }));
  }, []);

  const updateSettings = useCallback((newSettings: Partial<WorkspaceSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
  }, []);

  // Recursive Splitting Helper
  const splitPane = useCallback((paneId: string, direction: SplitDirection, newPluginType: string, initialState?: any) => {
    const splitLeafInTree = (node: LayoutNode): LayoutNode => {
      if (node.type === "leaf") {
        if (node.id === paneId) {
          const randId = Math.random().toString(36).substring(2, 7);
          const deepClone = (obj: any) => {
            if (!obj) return obj;
            return JSON.parse(JSON.stringify(obj));
          };
          const leftLeaf: PaneLeaf = {
            type: "leaf",
            id: node.id,
            pluginType: node.pluginType,
            contexts: deepClone(node.contexts) || {},
            history: deepClone(node.history) || [],
          };
          // The new pane seeds only the tool it is being opened as. Inheriting
          // the source pane's whole state handed a terminal the editor's
          // filePath and vice versa. History belongs to the original pane.
          const seeded = initialState ? deepClone(initialState) : {};
          const rightLeaf: PaneLeaf = {
            type: "leaf",
            id: `pane_${randId}`,
            pluginType: newPluginType,
            contexts: { [newPluginType]: seeded },
            history: [],
          };
          return {
            type: "split",
            id: `split_${randId}`,
            direction,
            splitPercentage: 50,
            left: leftLeaf,
            right: rightLeaf,
          };
        }
        return node;
      } else {
        return {
          ...node,
          left: splitLeafInTree(node.left),
          right: splitLeafInTree(node.right),
        };
      }
    };

    setLayoutTree((prev) => {
      if (!prev) {
        return {
          type: "leaf",
          id: `pane_${Math.random().toString(36).substring(2, 7)}`,
          pluginType: newPluginType,
          state: {},
        };
      }
      return splitLeafInTree(prev);
    });
  }, []);

  // Recursive Close/Remove/Pop Helper
  const closePane = useCallback((paneId: string) => {
    const removeOrPopLeafFromTree = (node: LayoutNode): LayoutNode | null => {
      if (node.type === "leaf") {
        if (node.id === paneId) {
          const history = node.history || [];
          if (history.length > 0) {
            const last = history[history.length - 1];
            return {
              ...node,
              pluginType: last.pluginType,
              history: history.slice(0, -1),
            };
          }
          return null; // Marks for removal
        }
        return node;
      }
      
      const newLeft = removeOrPopLeafFromTree(node.left);
      const newRight = removeOrPopLeafFromTree(node.right);
      
      if (newLeft === null) return newRight;
      if (newRight === null) return newLeft;
      
      return {
        ...node,
        left: newLeft,
        right: newRight,
      };
    };

    setLayoutTree((prev) => {
      if (!prev) return null;
      return removeOrPopLeafFromTree(prev);
    });
  }, []);

  const setPanePlugin = useCallback((paneId: string, pluginType: string) => {
    const updateLeafPlugin = (node: LayoutNode): LayoutNode => {
      if (node.type === "leaf") {
        if (node.id === paneId) {
          // Contexts are preserved. Switching explorer -> terminal -> explorer
          // returns the explorer to the directory it was showing.
          return { ...node, pluginType };
        }
        return node;
      }
      return {
        ...node,
        left: updateLeafPlugin(node.left),
        right: updateLeafPlugin(node.right),
      };
    };
    setLayoutTree((prev) => {
      if (!prev) return null;
      return updateLeafPlugin(prev);
    });
  }, []);

  const setPaneState = useCallback((paneId: string, state: any) => {
    const updateLeafState = (node: LayoutNode): LayoutNode => {
      if (node.type === "leaf") {
        if (node.id === paneId) {
          const contexts = node.contexts || {};
          const current = contexts[node.pluginType] || {};
          const isSame = Object.keys(state).every((k) => current[k] === state[k]);
          if (isSame) return node;
          return {
            ...node,
            contexts: {
              ...contexts,
              [node.pluginType]: { ...current, ...state },
            },
          };
        }
        return node;
      }
      
      const left = updateLeafState(node.left);
      const right = updateLeafState(node.right);
      
      if (left === node.left && right === node.right) {
        return node;
      }
      
      return {
        ...node,
        left,
        right,
      };
    };
    setLayoutTree((prev) => {
      if (!prev) return null;
      const updated = updateLeafState(prev);
      return updated === prev ? prev : updated;
    });
  }, []);

  const updateSplitPercentage = useCallback((parentId: string, percentage: number) => {
    const updatePercentage = (node: LayoutNode): LayoutNode => {
      if (node.type === "leaf") return node;
      if (node.id === parentId) {
        return {
          ...node,
          splitPercentage: Math.max(10, Math.min(90, percentage)),
        };
      }
      return {
        ...node,
        left: updatePercentage(node.left),
        right: updatePercentage(node.right),
      };
    };
    setLayoutTree((prev) => {
      if (!prev) return null;
      return updatePercentage(prev);
    });
  }, []);

  const resetLayout = useCallback(() => {
    setLayoutTree(DEFAULT_LAYOUT);
  }, []);

  // Independent / Targeted File Opening to Specific Editor
  useEffect(() => {
    const handleOpenFileEvent = (payload: any) => {
      if (!layoutTree) {
        setLayoutTree({
          type: "leaf",
          id: "pane_editor_init",
          pluginType: "editor",
          contexts: { editor: { filePath: payload.path } },
        });
        setActivePaneId("pane_editor_init");
        setLastActiveEditorId("pane_editor_init");
        return;
      }

      // Local helper to find node by ID
      const findNodeById = (node: LayoutNode, id: string): PaneLeaf | null => {
        if (node.type === "leaf") {
          return node.id === id ? node : null;
        }
        return findNodeById(node.left, id) || findNodeById(node.right, id);
      };

      const convertPaneToEditor = (paneId: string, filePath: string) => {
        setLayoutTree((prev) => {
          if (!prev) return null;
          const targetWithHistory = (node: LayoutNode): LayoutNode => {
            if (node.type === "leaf") {
              if (node.id === paneId) {
                const currentHistory = node.history || [];
                const updatedHistory = [...currentHistory, { pluginType: node.pluginType }];
                return {
                  ...node,
                  pluginType: "editor",
                  contexts: {
                    ...(node.contexts || {}),
                    editor: { ...((node.contexts || {}).editor || {}), filePath },
                  },
                  history: updatedHistory,
                };
              }
              return node;
            }
            return {
              ...node,
              left: targetWithHistory(node.left),
              right: targetWithHistory(node.right),
            };
          };
          return targetWithHistory(prev);
        });
        setActivePaneId(paneId);
        setLastActiveEditorId(paneId);
      };

      const sourcePaneId = payload.sourcePaneId;
      const explicitTargetPaneId = payload.targetPaneId;

      // Case A: Explicit target node specified (e.g. from context menu "Open in Node...")
      if (explicitTargetPaneId) {
        const targetNode = findNodeById(layoutTree, explicitTargetPaneId);
        if (targetNode) {
          if (targetNode.pluginType === "editor") {
            setPaneState(explicitTargetPaneId, { filePath: payload.path, fileContent: undefined, isDirty: false });
          } else {
            convertPaneToEditor(explicitTargetPaneId, payload.path);
          }
          setActivePaneId(explicitTargetPaneId);
          setLastActiveEditorId(explicitTargetPaneId);
          return;
        }
      }

      // Case B: Highlighted/Selected pane that is NOT a file explorer
      if (activePaneId) {
        const activeNode = findNodeById(layoutTree, activePaneId);
        if (activeNode && activeNode.pluginType !== "file-explorer") {
          if (activeNode.pluginType === "editor") {
            setPaneState(activePaneId, { filePath: payload.path, fileContent: undefined, isDirty: false });
          } else {
            convertPaneToEditor(activePaneId, payload.path);
          }
          setActivePaneId(activePaneId);
          setLastActiveEditorId(activePaneId);
          return;
        }
      }

      // Case C: No other valid pane highlighted/selected first -> Open in the source explorer pane ("same pane")
      if (sourcePaneId) {
        const sourceNode = findNodeById(layoutTree, sourcePaneId);
        if (sourceNode) {
          if (sourceNode.pluginType === "editor") {
            setPaneState(sourcePaneId, { filePath: payload.path, fileContent: undefined, isDirty: false });
          } else {
            convertPaneToEditor(sourcePaneId, payload.path);
          }
          setActivePaneId(sourcePaneId);
          setLastActiveEditorId(sourcePaneId);
          return;
        }
      }

      // Case D: Fallback to first available editor, or split if none
      let targetPaneId: string | null = null;
      if (lastActiveEditorId) {
        const activeNode = findNodeById(layoutTree, lastActiveEditorId);
        if (activeNode && activeNode.pluginType === "editor") {
          targetPaneId = lastActiveEditorId;
        }
      }

      if (!targetPaneId) {
        const findFirstEditor = (node: LayoutNode): string | null => {
          if (node.type === "leaf") {
            return node.pluginType === "editor" ? node.id : null;
          }
          return findFirstEditor(node.left) || findFirstEditor(node.right);
        };
        targetPaneId = findFirstEditor(layoutTree);
      }

      if (targetPaneId) {
        setPaneState(targetPaneId, { filePath: payload.path, fileContent: undefined, isDirty: false });
        setActivePaneId(targetPaneId);
        setLastActiveEditorId(targetPaneId);
      } else {
        const paneToSplit = activePaneId || "pane_explorer";
        splitPane(paneToSplit, "horizontal", "editor", { filePath: payload.path });
      }
    };

    const unsubscribe = subscribeEvent("open-file", handleOpenFileEvent);
    return unsubscribe;
  }, [layoutTree, activePaneId, lastActiveEditorId, subscribeEvent, setPanePlugin, splitPane, setPaneState]);

  const getPaneContext = useCallback(
    (paneId: string, pluginType?: string) => {
      const pane = panesRegistry.find((p) => p.id === paneId);
      if (!pane) return undefined;
      return pluginType ? pane.contexts[pluginType] : pane.state;
    },
    [panesRegistry],
  );

  return (
    <WorkspaceContext.Provider
      value={{
        layoutTree,
        setLayoutTree,
        activePaneId,
        setActivePaneId,
        lastActiveEditorId,
        setLastActiveEditorId,
        plugins,
        registerPlugin,
        splitPane,
        closePane,
        setPanePlugin,
        setPaneState,
        updateSplitPercentage,
        emitEvent,
        subscribeEvent,
        resetLayout,
        settings,
        updateSettings,
        panesRegistry,
        getPaneContext,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return context;
};
