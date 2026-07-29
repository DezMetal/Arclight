import React, { useEffect } from "react";
import { WorkspaceProvider, useWorkspace } from "./context/WorkspaceContext";
import { LayoutManager } from "./components/LayoutManager";
import { FileExplorerPane } from "./components/FileExplorerPane";
import { CodeEditorPane } from "./components/CodeEditorPane";
import { SettingsPane } from "./components/SettingsPane";
import { TerminalPane } from "./components/TerminalPane";

function WorkspaceShell() {
  const { registerPlugin } = useWorkspace();

  useEffect(() => {
    registerPlugin({
      type: "file-explorer",
      name: "Explorer",
      icon: "Folder",
      description: "Browse the filesystem",
      component: FileExplorerPane,
    });
    registerPlugin({
      type: "editor",
      name: "Editor",
      icon: "FileCode",
      description: "Read and edit files",
      component: CodeEditorPane,
    });
    registerPlugin({
      type: "terminal",
      name: "Terminal",
      icon: "Terminal",
      description: "A real shell on this machine",
      component: TerminalPane,
    });
    registerPlugin({
      type: "settings",
      name: "Settings",
      icon: "Sliders",
      description: "Workspace preferences",
      component: SettingsPane,
    });
  }, [registerPlugin]);

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden"
      style={{ backgroundColor: "var(--dss-bg-app)", color: "var(--dss-text)" }}
    >
      <main className="flex-1 min-h-0 relative">
        <LayoutManager />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <WorkspaceProvider>
      <WorkspaceShell />
    </WorkspaceProvider>
  );
}
