import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Columns, Layers, Maximize2, Minimize2, Rows, X } from "lucide-react";

import { LayoutNode, PaneLeaf, PaneParent, PluginDefinition } from "../types";
import { useWorkspace } from "../context/WorkspaceContext";

function findLeafNode(node: LayoutNode, id: string): PaneLeaf | null {
  if (node.type === "leaf") return node.id === id ? node : null;
  return findLeafNode(node.left, id) ?? findLeafNode(node.right, id);
}

export const FocusContext = React.createContext<{
  maximizedPaneId: string | null;
  toggleMaximize: (paneId: string) => void;
}>({
  maximizedPaneId: null,
  toggleMaximize: () => {},
});

export const LayoutManager: React.FC = () => {
  const { layoutTree, setLayoutTree, resetLayout, subscribeEvent } = useWorkspace();
  const [maximizedPaneId, setMaximizedPaneId] = useState<string | null>(null);

  const toggleMaximize = useCallback((paneId: string) => {
    setMaximizedPaneId((prev) => (prev === paneId ? null : paneId));
  }, []);

  useEffect(() => {
    return subscribeEvent("toggle-focus", (data: { paneId?: string }) => {
      if (data?.paneId) toggleMaximize(data.paneId);
    });
  }, [subscribeEvent, toggleMaximize]);

  // Drop focus if the maximized pane disappeared.
  useEffect(() => {
    if (!layoutTree || !maximizedPaneId) return;
    if (!findLeafNode(layoutTree, maximizedPaneId)) setMaximizedPaneId(null);
  }, [layoutTree, maximizedPaneId]);

  if (!layoutTree) {
    return (
      <div
        className="w-full h-full flex items-center justify-center dss-grid-bg"
        style={{ backgroundColor: "var(--dss-bg-app)" }}
      >
        <div
          className="dss-cut p-5 flex flex-col gap-3 items-center"
          style={{
            backgroundColor: "var(--dss-bg-panel)",
            boxShadow: "0 0 0 1px var(--dss-border)",
            minWidth: 300,
          }}
        >
          <Layers size={26} style={{ color: "var(--dss-accent)" }} />
          <span className="dss-label">Workspace empty</span>
          <div className="flex gap-2">
            <button
              className="dss-button dss-button--ghost"
              onClick={() =>
                setLayoutTree({
                  type: "leaf",
                  id: "pane_explorer_init",
                  pluginType: "file-explorer",
                  state: {},
                })
              }
            >
              Explorer
            </button>
            <button
              className="dss-button dss-button--ghost"
              onClick={() =>
                setLayoutTree({
                  type: "leaf",
                  id: "pane_terminal_init",
                  pluginType: "terminal",
                  state: {},
                })
              }
            >
              Terminal
            </button>
          </div>
          <button className="dss-button" onClick={resetLayout}>
            Restore default layout
          </button>
        </div>
      </div>
    );
  }

  const focused = maximizedPaneId ? findLeafNode(layoutTree, maximizedPaneId) : null;

  return (
    <FocusContext.Provider value={{ maximizedPaneId, toggleMaximize }}>
      <div
        className="w-full h-full overflow-hidden"
        style={{ backgroundColor: "var(--dss-bg-app)", padding: 4 }}
      >
        {focused ? <LeafNode node={focused} /> : <TreeNode node={layoutTree} />}
      </div>
    </FocusContext.Provider>
  );
};

const TreeNode: React.FC<{ node: LayoutNode }> = ({ node }) =>
  node.type === "split" ? <SplitNode node={node} /> : <LeafNode node={node} />;

const SplitNode: React.FC<{ node: PaneParent }> = ({ node }) => {
  const { updateSplitPercentage } = useWorkspace();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pct =
        node.direction === "horizontal"
          ? ((e.clientX - rect.left) / rect.width) * 100
          : ((e.clientY - rect.top) / rect.height) * 100;
      // Clamp so a pane can never be dragged to zero and become unrecoverable.
      updateSplitPercentage(node.id, Math.min(92, Math.max(8, pct)));
    };
    const onUp = () => setDragging(false);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, node.direction, node.id, updateSplitPercentage]);

  const pct = node.splitPercentage;
  const horizontal = node.direction === "horizontal";

  return (
    <div
      ref={containerRef}
      className={`w-full h-full flex ${horizontal ? "flex-row" : "flex-col"} overflow-hidden`}
    >
      <div style={{ flex: `${pct} ${pct} 0%`, overflow: "hidden" }}>
        <TreeNode node={node.left} />
      </div>

      <div
        onMouseDown={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        className={horizontal ? "cursor-col-resize" : "cursor-row-resize"}
        style={{
          flexShrink: 0,
          width: horizontal ? 5 : "100%",
          height: horizontal ? "100%" : 5,
          backgroundColor: dragging ? "var(--dss-accent)" : "transparent",
          transition: "background-color 0.12s ease",
        }}
        onMouseEnter={(e) => {
          if (!dragging) e.currentTarget.style.backgroundColor = "var(--dss-border)";
        }}
        onMouseLeave={(e) => {
          if (!dragging) e.currentTarget.style.backgroundColor = "transparent";
        }}
      />

      <div style={{ flex: `${100 - pct} ${100 - pct} 0%`, overflow: "hidden" }}>
        <TreeNode node={node.right} />
      </div>
    </div>
  );
};

const LeafNode: React.FC<{ node: PaneLeaf }> = ({ node }) => {
  const { activePaneId, setActivePaneId, plugins, splitPane, closePane, setPanePlugin, setPaneState } =
    useWorkspace();
  const { maximizedPaneId, toggleMaximize } = React.useContext(FocusContext);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isActive = activePaneId === node.id;
  const isMaximized = maximizedPaneId === node.id;
  const plugin = plugins[node.pluginType];

  const updateState = useCallback(
    (next: Record<string, unknown>) => setPaneState(node.id, next),
    [node.id, setPaneState],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  return (
    <div className="h-full w-full p-[3px]">
      <div
        onMouseDown={() => !isActive && setActivePaneId(node.id)}
        className={`h-full flex flex-col min-h-0 overflow-hidden dss-cut-sm ${
          isActive ? "dss-glow" : ""
        }`}
        style={{
          backgroundColor: "var(--dss-bg-panel)",
          boxShadow: isActive ? undefined : "0 0 0 1px var(--dss-border-soft)",
        }}
      >
        {/* Pane header */}
        <div
          className="dss-chrome flex items-center justify-between px-1.5 py-[3px] flex-shrink-0"
          style={{
            backgroundColor: isActive ? "var(--dss-bg-surface)" : "transparent",
            borderBottom: "1px solid var(--dss-border-soft)",
          }}
        >
          <div className="flex items-center gap-1 min-w-0">
            {node.history && node.history.length > 0 && (
              <button
                className="dss-icon-button"
                title="Back"
                onClick={(e) => {
                  e.stopPropagation();
                  closePane(node.id);
                }}
              >
                <ArrowLeft size={11} />
              </button>
            )}
            <div className="relative" ref={menuRef}>
              <button
                className="dss-label flex items-center gap-1 px-1 py-0.5"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: isActive ? "var(--dss-accent)" : "var(--dss-text-dim)",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                title="Change tool"
              >
                {plugin?.name ?? "select"}
                <span style={{ fontSize: 7 }}>▼</span>
              </button>

              {menuOpen && (
                <div
                  className="absolute left-0 mt-1 dss-cut-sm"
                  style={{
                    minWidth: 150,
                    zIndex: 900,
                    backgroundColor: "var(--dss-bg-surface)",
                    boxShadow: "0 0 0 1px var(--dss-border)",
                  }}
                >
                  {(Object.values(plugins) as PluginDefinition[]).map((p) => (
                    <button
                      key={p.type}
                      className="w-full text-left px-2.5 py-1.5 text-[11px]"
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color:
                          node.pluginType === p.type ? "var(--dss-accent)" : "var(--dss-text)",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor = "var(--dss-bg-input)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = "transparent")
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        setPanePlugin(node.id, p.type);
                        setMenuOpen(false);
                      }}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              className="dss-icon-button"
              title={isMaximized ? "Restore" : "Maximize"}
              onClick={(e) => {
                e.stopPropagation();
                toggleMaximize(node.id);
              }}
              style={isMaximized ? { color: "var(--dss-accent)" } : undefined}
            >
              {isMaximized ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
            </button>
            {!isMaximized && (
              <>
                <button
                  className="dss-icon-button"
                  title="Split right"
                  onClick={(e) => {
                    e.stopPropagation();
                    splitPane(node.id, "horizontal", node.pluginType);
                  }}
                >
                  <Columns size={11} />
                </button>
                <button
                  className="dss-icon-button"
                  title="Split down"
                  onClick={(e) => {
                    e.stopPropagation();
                    splitPane(node.id, "vertical", node.pluginType);
                  }}
                >
                  <Rows size={11} />
                </button>
                <button
                  className="dss-icon-button"
                  title="Close pane"
                  onClick={(e) => {
                    e.stopPropagation();
                    closePane(node.id);
                  }}
                >
                  <X size={11} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Tool */}
        <div className="flex-1 min-h-0 overflow-hidden relative">
          {plugin ? (
            <plugin.component paneId={node.id} state={node.state ?? {}} updateState={updateState} />
          ) : (
            <div
              className="h-full flex items-center justify-center text-[11px]"
              style={{ color: "var(--dss-text-faint)" }}
            >
              pick a tool from the header
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
