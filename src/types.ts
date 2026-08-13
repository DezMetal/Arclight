import React from "react";

export type SplitDirection = "horizontal" | "vertical";

/**
 * A frame: one splittable work area holding one tool.
 *
 * A frame keeps a separate context per tool it has hosted, so switching a frame
 * from explorer to terminal and back restores the explorer exactly where it
 * was. The whole tree is serializable, which is what lets the control API
 * address and drive every frame by id.
 */
export interface FrameLeaf {
  type: "leaf";
  id: string;
  /** Which tool is currently showing. */
  tool: string;
  /** Stored state per tool, keyed by tool type. */
  contexts?: Record<string, any>;
  /** Tools this frame previously showed, most recent last. */
  history?: { tool: string }[];

  // --- legacy fields, migrated on load ---
  /** @deprecated renamed to `tool` */
  pluginType?: string;
  /** @deprecated folded into `contexts` */
  state?: any;
}

export interface FrameSplit {
  type: "split";
  id: string;
  direction: SplitDirection;
  /** Share of the axis given to `left`, 0-100. */
  splitPercentage: number;
  left: LayoutNode;
  right: LayoutNode;
}

export type LayoutNode = FrameLeaf | FrameSplit;

export interface ToolProps {
  frameId: string;
  /** This frame's stored context for this tool. */
  context: any;
  /** Merge a patch into this frame's context for this tool. */
  setContext: (patch: Record<string, unknown>) => void;
}

export interface ToolDefinition {
  type: string;
  name: string;
  /** Lucide icon name. */
  icon: string;
  description: string;
  component: React.ComponentType<ToolProps>;
}

/** A flattened view of one frame, safe to serialize over the control API. */
export interface FrameSummary {
  id: string;
  tool: string;
  /** Has keyboard focus. */
  focused: boolean;
  /** Explicitly chosen as the target for opens. */
  selected: boolean;
  /** The active tool's context. */
  context: any;
  /** Every tool context this frame remembers. */
  contexts: Record<string, any>;
  historyCount: number;
}

/** Where an open request should land. */
export interface OpenTarget {
  /** Open in this specific frame. */
  frameId?: string;
  /** Split a new frame off and open there instead. */
  newFrame?: boolean;
  /** Direction for `newFrame`; defaults to the setting. */
  direction?: SplitDirection;
  /** The frame the request came from, used when nothing else applies. */
  sourceFrameId?: string;
}
