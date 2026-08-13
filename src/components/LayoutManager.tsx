import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Columns, Crosshair, Layers, Maximize2, Minimize2, Rows, X } from "lucide-react";

import { FrameLeaf, FrameSplit, LayoutNode, ToolDefinition } from "../types";
import { findFrame, frameContext, useWorkspace } from "../context/WorkspaceContext";

export const FocusContext = React.createContext<{
  maximizedFrameId: string | null;
  toggleMaximize: (frameId: string) => void;
}>({
  maximizedFrameId: null,
  toggleMaximize: () => {},
});

export const LayoutManager: React.FC = () => {
  const { layoutTree, setLayoutTree, resetLayout, subscribeEvent } = useWorkspace();
  const [maximizedFrameId, setMaximizedFrameId] = useState<string | null>(null);

  const toggleMaximize = useCallback((frameId: string) => {
    setMaximizedFrameId((prev) => (prev === frameId ? null : frameId));
  }, []);

  useEffect(
    () =>
      subscribeEvent("toggle-focus", (data: { frameId?: string }) => {
        if (data?.frameId) toggleMaximize(data.frameId);
      }),
    [subscribeEvent, toggleMaximize],
  );

  useEffect(() => {
    if (!layoutTree || !maximizedFrameId) return;
    if (!findFrame(layoutTree, maximizedFrameId)) setMaximizedFrameId(null);
  }, [layoutTree, maximizedFrameId]);

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
          <span className="dss-label">No frames open</span>
          <div className="flex gap-2">
            <button
              className="dss-button dss-button--ghost"
              onClick={() =>
                setLayoutTree({
                  type: "leaf",
                  id: "frame_explorer_init",
                  tool: "file-explorer",
                  contexts: {},
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
                  id: "frame_terminal_init",
                  tool: "terminal",
                  contexts: {},
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

  const maximized = maximizedFrameId ? findFrame(layoutTree, maximizedFrameId) : null;

  return (
    <FocusContext.Provider value={{ maximizedFrameId, toggleMaximize }}>
      <div
        className="w-full h-full overflow-hidden"
        style={{ backgroundColor: "var(--dss-bg-app)", padding: 4 }}
      >
        {maximized ? <Frame node={maximized} /> : <TreeNode node={layoutTree} />}
      </div>
    </FocusContext.Provider>
  );
};

const TreeNode: React.FC<{ node: LayoutNode }> = ({ node }) =>
  node.type === "split" ? <Split node={node} /> : <Frame node={node} />;

const Split: React.FC<{ node: FrameSplit }> = ({ node }) => {
  const { setSplitPercentage } = useWorkspace();
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
      setSplitPercentage(node.id, pct);
    };
    const onUp = () => setDragging(false);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, node.direction, node.id, setSplitPercentage]);

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

const Frame: React.FC<{ node: FrameLeaf }> = ({ node }) => {
  const {
    focusedFrameId,
    focusFrame,
    selectedFrameId,
    toggleSelectFrame,
    tools,
    splitFrame,
    closeFrame,
    swapFrames,
    setFrameTool,
    setFrameContext,
  } = useWorkspace();
  const { maximizedFrameId, toggleMaximize } = React.useContext(FocusContext);

  const [menuOpen, setMenuOpen] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const focused = focusedFrameId === node.id;
  const selected = selectedFrameId === node.id;
  const maximized = maximizedFrameId === node.id;
  const tool = tools[node.tool];

  const setContext = useCallback(
    (patch: Record<string, unknown>) => setFrameContext(node.id, patch),
    [node.id, setFrameContext],
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
        className={`h-full flex flex-col min-h-0 overflow-hidden dss-cut-sm ${focused ? "dss-glow" : ""}`}
        style={{
          backgroundColor: "var(--dss-bg-panel)",
          boxShadow: selected
            ? "0 0 0 2px var(--dss-accent-hot)"
            : focused
              ? undefined
              : "0 0 0 1px var(--dss-border-soft)",
        }}
      >
        {/* Header. Clicking the chrome selects this frame as the open target;
            clicking the tool's content below only moves focus. */}
        <div
          className="dss-chrome flex items-center justify-between px-1.5 py-[3px] flex-shrink-0 cursor-pointer"
          draggable
          onMouseDown={() => focusFrame(node.id)}
          onClick={() => toggleSelectFrame(node.id)}
          title={
            selected
              ? "Selected as open target - click to release. Drag onto another frame to swap."
              : "Click to target opens here. Drag onto another frame to swap."
          }
          onDragStart={(e) => {
            e.dataTransfer.setData("application/x-arclight-frame", node.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            const dragged = e.dataTransfer.types.includes("application/x-arclight-frame");
            if (!dragged) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropTarget(true);
          }}
          onDragLeave={() => setDropTarget(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropTarget(false);
            const from = e.dataTransfer.getData("application/x-arclight-frame");
            if (from && from !== node.id) swapFrames(from, node.id);
          }}
          style={{
            backgroundColor: dropTarget
              ? "color-mix(in srgb, var(--dss-accent) 30%, var(--dss-bg-surface))"
              : selected
                ? "color-mix(in srgb, var(--dss-accent-hot) 14%, var(--dss-bg-surface))"
                : focused
                  ? "var(--dss-bg-surface)"
                  : "transparent",
            borderBottom: dropTarget
              ? "1px solid var(--dss-accent)"
              : "1px solid var(--dss-border-soft)",
          }}
        >
          <div className="flex items-center gap-1 min-w-0">
            {selected && (
              <Crosshair
                size={11}
                className="flex-shrink-0"
                style={{ color: "var(--dss-accent-hot)" }}
              />
            )}
            {node.history && node.history.length > 0 && (
              <button
                className="dss-icon-button"
                title="Back"
                onClick={(e) => {
                  e.stopPropagation();
                  closeFrame(node.id);
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
                  color: selected
                    ? "var(--dss-accent-hot)"
                    : focused
                      ? "var(--dss-accent)"
                      : "var(--dss-text-dim)",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                title="Change tool"
              >
                {tool?.name ?? "select"}
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
                  {(Object.values(tools) as ToolDefinition[]).map((t) => (
                    <button
                      key={t.type}
                      className="w-full text-left px-2.5 py-1.5 text-[11px]"
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: node.tool === t.type ? "var(--dss-accent)" : "var(--dss-text)",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor = "var(--dss-bg-input)")
                      }
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFrameTool(node.id, t.type);
                        setMenuOpen(false);
                      }}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-0.5 flex-shrink-0">
            <span
              className="dss-label mr-1 hidden sm:inline"
              style={{ fontSize: 8, opacity: 0.55 }}
              title="Frame id, for dnet commands and the control API"
            >
              {node.id}
            </span>
            <button
              className="dss-icon-button"
              title={maximized ? "Restore" : "Maximize"}
              onClick={(e) => {
                e.stopPropagation();
                toggleMaximize(node.id);
              }}
              style={maximized ? { color: "var(--dss-accent)" } : undefined}
            >
              {maximized ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
            </button>
            {!maximized && (
              <>
                <button
                  className="dss-icon-button"
                  title="Split right"
                  onClick={(e) => {
                    e.stopPropagation();
                    splitFrame(node.id, "horizontal", node.tool, frameContext(node));
                  }}
                >
                  <Columns size={11} />
                </button>
                <button
                  className="dss-icon-button"
                  title="Split down"
                  onClick={(e) => {
                    e.stopPropagation();
                    splitFrame(node.id, "vertical", node.tool, frameContext(node));
                  }}
                >
                  <Rows size={11} />
                </button>
                <button
                  className="dss-icon-button"
                  title="Close frame"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeFrame(node.id);
                  }}
                >
                  <X size={11} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Tool content. Focus follows interaction here; selection does not. */}
        <div
          className="flex-1 min-h-0 overflow-hidden relative"
          onMouseDown={() => focusFrame(node.id)}
        >
          {tool ? (
            <tool.component
              key={node.tool}
              frameId={node.id}
              context={frameContext(node)}
              setContext={setContext}
            />
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
