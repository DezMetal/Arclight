import React, { ReactNode } from "react";

export type SplitDirection = "horizontal" | "vertical";

/**
 * A pane holds one context per tool it has hosted, not a single shared blob.
 *
 * Switching a pane from explorer to terminal and back restores the explorer
 * exactly where it was, because the two tools never share a state object.
 * The whole tree stays serializable, so every pane is addressable and
 * scriptable by id.
 */
export interface PaneLeaf {
  type: "leaf";
  id: string;
  pluginType: string;
  /** Keyed by plugin type. */
  contexts?: Record<string, any>;
  /** Legacy single-state field, migrated into `contexts` on load. */
  state?: any;
  history?: { pluginType: string }[];
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
