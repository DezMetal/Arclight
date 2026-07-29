import React, { ReactNode } from "react";

export type SplitDirection = "horizontal" | "vertical";

export interface PaneLeaf {
  type: "leaf";
  id: string;
  pluginType: string;
  state?: any;
  history?: { pluginType: string; state: any }[];
}

export interface PaneParent {
  type: "split";
  id: string;
  direction: SplitDirection;
  splitPercentage: number; // e.g. 50
  left: LayoutNode;
  right: LayoutNode;
}

export type LayoutNode = PaneLeaf | PaneParent;

export interface PluginDefinition {
  type: string;
  name: string;
  icon: string; // Lucide icon name
  description: string;
  component: React.ComponentType<{ paneId: string; state: any; updateState: (state: any) => void }>;
}

export interface WorkspaceEvent {
  name: string;
  payload: any;
}

export interface FileItem {
  name: string;
  path: string;
  absolutePath: string;
  isDirectory: boolean;
  size: number;
  mtime: string;
  error?: boolean;
}

export interface DirectoryListing {
  currentPath: string;
  absoluteCurrentPath: string;
  items: FileItem[];
}
