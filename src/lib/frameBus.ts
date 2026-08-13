/**
 * The frame content bus.
 *
 * Reading and writing what is *inside* a frame is the point of the control
 * API: an agent needs the editor's buffer, the terminal's screen, and the
 * explorer's listing, and needs to type into them.
 *
 * Only the mounted tool knows its own live state — the editor's unsaved buffer
 * and cursor, the terminal's rendered screen, the explorer's current listing.
 * So each tool registers a handler here when it mounts, and the control bridge
 * calls through. Agents drive exactly the same state the user sees, rather
 * than a second implementation that can drift.
 */

export interface FrameSelection {
  from: number;
  to: number;
  text: string;
}

export interface FrameReadResult {
  tool: string;
  /** Primary textual content. Terminal screen, editor buffer, explorer path. */
  content?: string;
  /** Structured content where a shape is more useful than text. */
  data?: unknown;
  [key: string]: unknown;
}

export interface FrameHandler {
  tool: string;
  /** Return the frame's current contents. */
  read: (options?: Record<string, unknown>) => Promise<FrameReadResult> | FrameReadResult;
  /** Act on the frame. Returns whatever the action produces. */
  write?: (
    action: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown> | unknown;
}

const handlers = new Map<string, FrameHandler>();

/** Called by a tool on mount; the returned function unregisters it. */
export function registerFrameHandler(frameId: string, handler: FrameHandler): () => void {
  handlers.set(frameId, handler);
  return () => {
    // Only remove our own registration. A frame that remounts can register the
    // replacement before the previous cleanup runs.
    if (handlers.get(frameId) === handler) handlers.delete(frameId);
  };
}

export function getFrameHandler(frameId: string): FrameHandler | undefined {
  return handlers.get(frameId);
}

export function readFrame(
  frameId: string,
  options?: Record<string, unknown>,
): Promise<FrameReadResult> {
  const handler = handlers.get(frameId);
  if (!handler) {
    return Promise.reject(new Error(`frame '${frameId}' is not mounted`));
  }
  return Promise.resolve(handler.read(options));
}

export function writeFrame(
  frameId: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const handler = handlers.get(frameId);
  if (!handler) {
    return Promise.reject(new Error(`frame '${frameId}' is not mounted`));
  }
  if (!handler.write) {
    return Promise.reject(new Error(`the ${handler.tool} tool accepts no write actions`));
  }
  return Promise.resolve(handler.write(action, payload));
}
