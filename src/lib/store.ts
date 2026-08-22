/**
 * Workspace persistence.
 *
 * Backed by a JSON file in the user's config directory, not localStorage.
 * localStorage is scoped to the page origin, which differs between the dev
 * server and the packaged app, and a webview data reset wipes it -- which is
 * why the layout and every open directory kept coming back empty.
 */

import { invoke } from "@tauri-apps/api/core";

export interface PersistedWorkspace {
  version: number;
  layout: unknown;
  settings: unknown;
  /** Set the first time the app runs, so the welcome shows exactly once. */
  seenWelcome?: boolean;
  /** Which frame had focus, so you resume in the pane you left off in. */
  focusedFrameId?: string | null;
  /** The standing target for anything opened, if one was set. */
  selectedFrameId?: string | null;
}

/** Bumped when the persisted shape changes in a way migration must notice. */
export const STATE_VERSION = 1;

export const store = {
  async load(): Promise<PersistedWorkspace | null> {
    try {
      return await invoke<PersistedWorkspace | null>("state_load");
    } catch (err) {
      // A corrupt file is reported and set aside by the backend; starting from
      // defaults is better than refusing to open.
      console.warn("workspace state could not be read:", err);
      return null;
    }
  },

  save(state: PersistedWorkspace): Promise<void> {
    return invoke<void>("state_save", { state });
  },

  location(): Promise<{ path: string; exists: boolean }> {
    return invoke<{ path: string; exists: boolean }>("state_location");
  },
};
