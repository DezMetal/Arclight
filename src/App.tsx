import React, { useEffect } from "react";
import { WorkspaceProvider, useWorkspace } from "./context/WorkspaceContext";
import { LayoutManager } from "./components/LayoutManager";
import { FileExplorerPane } from "./components/FileExplorerPane";
import { CodeEditorPane } from "./components/CodeEditorPane";
import { SettingsPane } from "./components/SettingsPane";
import { TerminalPane } from "./components/TerminalPane";
import { 
  LayoutGrid
} from "lucide-react";

function WorkspaceAppContent() {
  const { registerPlugin } = useWorkspace();

  // Register modular plugin/add-on panes on application mount
  useEffect(() => {
    // 1. File Explorer Pane
    registerPlugin({
      type: "file-explorer",
      name: "File Explorer",
      icon: "Folder",
      description: "Desktop file explorer supporting search, create, and upload actions",
      component: FileExplorerPane,
    });

    // 2. Integrated Code Editor Pane
    registerPlugin({
      type: "editor",
      name: "Code Editor",
      icon: "FileCode",
      description: "Workspace-aware editor with tab indentation and autosave bindings",
      component: CodeEditorPane,
    });

    // 3. Settings Pane
    registerPlugin({
      type: "settings",
      name: "Settings",
      icon: "Sliders",
      description: "Configure workspace parameters and environment themes",
      component: SettingsPane,
    });

    // 4. System Terminal Pane
    registerPlugin({
      type: "terminal",
      name: "Terminal",
      icon: "Terminal",
      description: "Execute actual shell commands on the host OS natively",
      component: TerminalPane,
    });
  }, [registerPlugin]);

  return (
    <div className="h-screen w-screen max-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Main Workspace Layout */}
      <main className="flex-1 overflow-hidden relative">
        <LayoutManager />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <WorkspaceProvider>
      <WorkspaceAppContent />
    </WorkspaceProvider>
  );
}
