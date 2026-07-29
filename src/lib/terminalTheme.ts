import type { ITheme } from "@xterm/xterm";

/**
 * Build xterm's palette from the DSS tokens on :root.
 *
 * The terminal used to carry its own hardcoded colours, so it was the one
 * surface that never followed the active theme. Reading the same variables the
 * rest of the UI uses means a theme switch moves everything at once.
 */

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function readTerminalTheme(): ITheme {
  return {
    background: token("--term-bg", "#0d1117"),
    foreground: token("--term-fg", "#c9d1d9"),
    cursor: token("--term-cursor", "#9fbffe"),
    cursorAccent: token("--term-bg", "#0d1117"),
    selectionBackground: token("--term-selection", "rgba(159,191,254,0.26)"),
    black: token("--term-black", "#161b22"),
    red: token("--term-red", "#ff7b72"),
    green: token("--term-green", "#3fb950"),
    yellow: token("--term-yellow", "#d29922"),
    blue: token("--term-blue", "#58a6ff"),
    magenta: token("--term-magenta", "#bc8cff"),
    cyan: token("--term-cyan", "#39c5cf"),
    white: token("--term-white", "#b1bac4"),
    brightBlack: token("--term-bright-black", "#6e7681"),
    brightRed: token("--term-bright-red", "#ffa198"),
    brightGreen: token("--term-bright-green", "#56d364"),
    brightYellow: token("--term-bright-yellow", "#e3b341"),
    brightBlue: token("--term-bright-blue", "#79c0ff"),
    brightMagenta: token("--term-bright-magenta", "#d2a8ff"),
    brightCyan: token("--term-bright-cyan", "#56d4dd"),
    brightWhite: token("--term-bright-white", "#f0f6fc"),
  };
}
