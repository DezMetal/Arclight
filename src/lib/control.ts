/**
 * Frontend half of the control API.
 *
 * The workspace lives in React state, so the Rust server mirrors it: this
 * publishes a snapshot whenever anything changes, and answers the commands the
 * server bridges over from HTTP callers.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface ControlConfig {
  enabled: boolean;
  port: number;
  token: string;
  allowRemote: boolean;
}

export interface ControlStatus {
  running: boolean;
  port: number;
  token: string;
  allow_remote: boolean;
  address: string | null;
}

interface ControlRequest {
  id: string;
  action: string;
  payload: Record<string, any>;
}

export const control = {
  status(): Promise<ControlStatus> {
    return invoke<ControlStatus>("control_status");
  },

  start(config: ControlConfig): Promise<ControlStatus> {
    return invoke<ControlStatus>("control_start", {
      config: {
        enabled: config.enabled,
        port: config.port,
        token: config.token,
        allow_remote: config.allowRemote,
      },
    });
  },

  stop(): Promise<ControlStatus> {
    return invoke<ControlStatus>("control_stop");
  },

  rotateToken(): Promise<string> {
    return invoke<string>("control_rotate_token");
  },

  /** Mirror the current workspace into the server so GET /v1/state is instant. */
  publish(snapshot: unknown): Promise<void> {
    return invoke<void>("control_publish", { snapshot });
  },

  respond(id: string, result: unknown): Promise<void> {
    return invoke<void>("control_respond", { id, result });
  },

  /** Push an event to SSE subscribers on /v1/events. */
  emit(event: unknown): Promise<void> {
    return invoke<void>("control_event", { event });
  },

  onRequest(handler: (request: ControlRequest) => void): Promise<UnlistenFn> {
    return listen<ControlRequest>("control:request", (e) => handler(e.payload));
  },
};

export type { ControlRequest };
