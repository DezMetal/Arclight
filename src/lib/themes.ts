/**
 * Theme and preset constants.
 *
 * A leaf module on purpose: it imports nothing. These used to live in
 * WorkspaceContext, and customCommands imported them as values — which made
 * a heavy React module a dependency of the command table. On first evaluation
 * CUSTOM_COMMANDS could be read before it was populated, so the first `dnet`
 * of a session reported "unknown command" and only later attempts worked.
 *
 * Nothing here may import anything else. That is the fix.
 */

/** DSS drives these off `data-theme` on <html>. */
export type ThemeName = "dark" | "light";

/** DSS drives these off `data-dss-preset` on <html>. */
export type PresetName = "signal" | "aero" | "softclub" | "eink" | "terminal";

export const THEMES: { id: ThemeName; label: string; description: string }[] = [
  { id: "dark", label: "Dark", description: "The house default" },
  { id: "light", label: "Light", description: "Icy, never grey" },
];

export const PRESETS: { id: PresetName; label: string; description: string }[] = [
  { id: "signal", label: "Signal Glass", description: "Misty translucent glass, cyan glow" },
  { id: "aero", label: "Aero", description: "Bright teal, glassier, higher gloss" },
  { id: "softclub", label: "Softclub", description: "Warm diffusion, softer edges" },
  { id: "eink", label: "E-Ink", description: "Flat and matte, no glow" },
  { id: "terminal", label: "Terminal", description: "High-contrast phosphor" },
];
