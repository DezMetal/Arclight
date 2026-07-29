import React, { useRef, useState, useEffect, useCallback } from "react";
import { LayoutNode, SplitDirection, PaneLeaf, PaneParent, PluginDefinition } from "../types";
import { useWorkspace } from "../context/WorkspaceContext";
import { Columns, Rows, X, Layers, Maximize2, Minimize2, ArrowLeft } from "lucide-react";

// Helper to find a leaf node inside a layout tree
const findLeafNode = (node: LayoutNode, id: string): PaneLeaf | null => {
  if (node.type === "leaf") {
    return node.id === id ? node : null;
  }
  const leftRes = findLeafNode(node.left, id);
  if (leftRes) return leftRes;
  return findLeafNode(node.right, id);
};

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

  // Listen to toggle-focus custom command events
  useEffect(() => {
    const handleToggleFocus = (data: any) => {
      if (data && data.paneId) {
        toggleMaximize(data.paneId);
      }
    };
    const unsubscribe = subscribeEvent("toggle-focus", handleToggleFocus);
    return unsubscribe;
  }, [subscribeEvent, toggleMaximize]);

  // If layoutTree changes and the maximized pane is gone, reset focus
  useEffect(() => {
    if (!layoutTree || !maximizedPaneId) return;
    const found = findLeafNode(layoutTree, maximizedPaneId);
    if (!found) {
      setMaximizedPaneId(null);
    }
  }, [layoutTree, maximizedPaneId]);

  if (!layoutTree) {
    return (
      <div className="flex-1 w-full h-full flex flex-col items-center justify-center bg-slate-950 text-slate-400 p-8 text-center select-none animate-fadeIn">
        <div className="max-w-md p-6 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl space-y-4">
          <Layers size={36} className="text-slate-600 mx-auto" />
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-slate-200">Workspace Cleared</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              All active panes have been closed. Open a workspace tool or click below to restore default panel settings.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 pt-2">
            <button
              onClick={() => {
                setLayoutTree({
                  type: "leaf",
                  id: "pane_explorer_init",
                  pluginType: "file-explorer",
                  state: {},
                });
              }}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-750 text-xs font-semibold rounded text-slate-200 border border-slate-700/50 transition"
            >
              Open File Explorer
            </button>
            <button
              onClick={() => {
                setLayoutTree({
                  type: "leaf",
                  id: "pane_settings_init",
                  pluginType: "settings",
                  state: {},
                });
              }}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-750 text-xs font-semibold rounded text-slate-200 border border-slate-700/50 transition"
            >
              Open Settings
            </button>
          </div>
          <button
            onClick={resetLayout}
            className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 text-xs font-semibold rounded text-white transition shadow-lg shadow-blue-950/20"
          >
            Restore Default Workspace Layout
          </button>
        </div>
      </div>
    );
  }

  const focusedNode = maximizedPaneId ? findLeafNode(layoutTree, maximizedPaneId) : null;

  return (
    <FocusContext.Provider value={{ maximizedPaneId, toggleMaximize }}>
      <div className="flex-1 w-full h-full relative p-2 md:p-3 overflow-hidden select-none bg-slate-950">
        {focusedNode ? (
          <LeafNodeRenderer node={focusedNode} />
        ) : (
          <LayoutNodeRenderer node={layoutTree} />
        )}
      </div>
    </FocusContext.Provider>
  );
};

const LayoutNodeRenderer: React.FC<{ node: LayoutNode }> = ({ node }) => {
  if (node.type === "split") {
    return <SplitNodeRenderer node={node} />;
  }
  return <LeafNodeRenderer node={node} />;
};

const SplitNodeRenderer: React.FC<{ node: PaneParent }> = ({ node }) => {
  const { updateSplitPercentage } = useWorkspace();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Drag resizing calculation
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      let percentage = 50;

      if (node.direction === "horizontal") {
        const clientX = e.clientX - rect.left;
        percentage = (clientX / rect.width) * 100;
      } else {
        const clientY = e.clientY - rect.top;
        percentage = (clientY / rect.height) * 100;
      }

      updateSplitPercentage(node.id, percentage);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, node.direction, node.id, updateSplitPercentage]);

  const splitPercentage = node.splitPercentage;

  return (
    <div
      ref={containerRef}
      className={`w-full h-full flex ${
        node.direction === "horizontal" ? "flex-row" : "flex-col"
      } overflow-hidden`}
    >
      {/* Left / Top pane */}
      <div
        style={{
          flex: `${splitPercentage} ${splitPercentage} 0%`,
          overflow: "hidden",
        }}
        className="h-full w-full"
      >
        <LayoutNodeRenderer node={node.left} />
      </div>

      {/* Resize Bar Divider */}
      <div
        onMouseDown={handleMouseDown}
        className={`bg-slate-900 border-slate-800 hover:bg-blue-600/60 active:bg-blue-500 transition-colors z-20 flex items-center justify-center ${
          node.direction === "horizontal"
            ? "w-[6px] h-full cursor-col-resize border-l border-r"
            : "h-[6px] w-full cursor-row-resize border-t border-b"
        } ${isDragging ? "bg-blue-500" : ""}`}
      >
        <div
          className={`bg-slate-700 rounded-full ${
            node.direction === "horizontal" ? "w-[2px] h-6" : "h-[2px] w-6"
          }`}
        />
      </div>

      {/* Right / Bottom pane */}
      <div
        style={{
          flex: `${100 - splitPercentage} ${100 - splitPercentage} 0%`,
          overflow: "hidden",
        }}
        className="h-full w-full"
      >
        <LayoutNodeRenderer node={node.right} />
      </div>
    </div>
  );
};

const LeafNodeRenderer: React.FC<{ node: PaneLeaf }> = ({ node }) => {
  const {
    activePaneId,
    setActivePaneId,
    plugins,
    splitPane,
    closePane,
    setPanePlugin,
    setPaneState,
  } = useWorkspace();

  const { maximizedPaneId, toggleMaximize } = React.useContext(FocusContext);

  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isActive = activePaneId === node.id;
  const isMaximized = maximizedPaneId === node.id;
  const currentPlugin = plugins[node.pluginType];

  const updateState = useCallback((newState: any) => {
    setPaneState(node.id, newState);
  }, [node.id, setPaneState]);

  const handlePaneClick = () => {
    if (!isActive) {
      setActivePaneId(node.id);
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  return (
    <div
      onClick={handlePaneClick}
      className="h-full w-full flex flex-col p-1 transition-all duration-200"
    >
      <div 
        className={`flex-1 flex flex-col min-h-0 overflow-hidden bg-slate-900 border rounded-lg transition-all duration-200 ${
          isActive 
            ? "border-blue-500/80 shadow-lg shadow-blue-950/20 ring-1 ring-blue-500/20" 
            : "border-slate-800/80"
        }`}
      >
        {/* Pane Integrated Title/Tabs Header */}
        <div 
          className={`flex items-center justify-between px-3 py-1.5 border-b select-none text-xs transition-colors ${
            isActive 
              ? "bg-slate-850 border-slate-700/80 text-slate-100" 
              : "bg-slate-900/40 border-slate-850/60 text-slate-400 hover:text-slate-300"
          }`}
        >
          {/* Left Side: Active Tool Selector Dropdown */}
          <div className="flex items-center gap-1.5">
            {node.history && node.history.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closePane(node.id); // This will pop history since closePane handles popping
                }}
                className="p-1 hover:bg-slate-800 text-blue-400 hover:text-blue-300 rounded transition"
                title="Go Back"
              >
                <ArrowLeft size={12} />
              </button>
            )}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDropdown(!showDropdown);
                }}
                className="flex items-center gap-1.5 py-0.5 px-2 -ml-2 hover:bg-slate-800 rounded transition text-xs font-semibold uppercase tracking-wide"
                title="Change view tool"
              >
                <Layers size={11} className="text-blue-400" />
                <span>{currentPlugin?.name || "Select View"}</span>
                <span className="text-[9px] opacity-60">▼</span>
              </button>

            {showDropdown && (
              <div className="absolute left-0 mt-1.5 w-44 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl z-30 overflow-hidden py-1">
                <div className="px-2.5 py-1 text-[9px] uppercase font-bold tracking-wider text-slate-500 border-b border-slate-800/80 mb-1">
                  Change tool view
                </div>
                {(Object.values(plugins) as PluginDefinition[]).map((plugin) => (
                  <button
                    key={plugin.type}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPanePlugin(node.id, plugin.type);
                      setShowDropdown(false);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 text-xs flex items-center gap-2 hover:bg-slate-800 transition ${
                      node.pluginType === plugin.type ? "text-blue-400 font-semibold bg-slate-850/50" : "text-slate-300"
                    }`}
                  >
                    <span>{plugin.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

          {/* Right Side: Split, Maximize and Close Controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleMaximize(node.id);
              }}
              className={`p-1 rounded transition ${
                isMaximized 
                  ? "bg-blue-600/20 text-blue-400 hover:text-blue-300"
                  : "hover:bg-slate-800 text-slate-400 hover:text-slate-200"
              }`}
              title={isMaximized ? "Exit Fullscreen (focus)" : "Fullscreen focus"}
            >
              {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>

            {!isMaximized && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    splitPane(node.id, "horizontal", node.pluginType);
                  }}
                  className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition"
                  title="Split Vertically"
                >
                  <Columns size={12} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    splitPane(node.id, "vertical", node.pluginType);
                  }}
                  className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition"
                  title="Split Horizontally"
                >
                  <Rows size={12} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closePane(node.id);
                  }}
                  className="p-1 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded transition"
                  title="Close Pane"
                >
                  <X size={12} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Dynamic plugin mount */}
        <div className="flex-1 min-h-0 overflow-hidden relative">
          {currentPlugin ? (
            <currentPlugin.component
              paneId={node.id}
              state={node.state || {}}
              updateState={updateState}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center bg-slate-900 text-slate-500">
              <p className="text-xs">Select a tool view using the toolbar menu.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
