import { useMemo } from "react";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

import { useWorkspace } from "../context/WorkspaceContext";

/**
 * CodeMirror theme built from the DSS tokens, so the editor moves with the
 * rest of the workspace instead of carrying its own colours.
 */

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function buildTheme(dark: boolean): Extension {
  const bg = token("--dss-surface-solid", "#161b22");
  const fg = token("--dss-ink", "#ffffff");
  const dim = token("--dss-ink-soft", "#b9c2cc");
  const faint = token("--dss-ink-faint", "#a3adb8");
  const accent = token("--dss-accent", "#00e0ff");
  const surface = token("--dss-bg-surface", "#1c2128");
  const selection = token("--term-selection", "rgba(159,191,254,0.26)");

  const view = EditorView.theme(
    {
      "&": {
        color: fg,
        backgroundColor: bg,
        height: "100%",
      },
      ".cm-content": {
        fontFamily: token("--dss-font-mono", "monospace"),
        caretColor: accent,
      },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: accent },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: selection,
      },
      ".cm-gutters": {
        backgroundColor: bg,
        color: faint,
        border: "none",
        borderRight: `1px solid ${token("--dss-rule-soft", "rgba(168,209,255,0.22)")}`,
      },
      ".cm-activeLine": { backgroundColor: surface },
      ".cm-activeLineGutter": { backgroundColor: surface, color: dim },
      ".cm-foldPlaceholder": {
        backgroundColor: surface,
        border: "none",
        color: dim,
      },
      ".cm-selectionMatch": { backgroundColor: selection },
      ".cm-matchingBracket, .cm-nonmatchingBracket": {
        backgroundColor: surface,
        outline: `1px solid ${accent}`,
      },
      ".cm-tooltip": {
        backgroundColor: surface,
        border: `1px solid ${token("--dss-rule", "rgba(168,209,255,0.24)")}`,
        color: fg,
      },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: accent,
        color: bg,
      },
      ".cm-panels": { backgroundColor: surface, color: fg },
      ".cm-searchMatch": { backgroundColor: selection },
      ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: accent, color: bg },
      ".cm-scroller": { overflow: "auto" },
    },
    { dark },
  );

  const highlight = HighlightStyle.define([
    { tag: [t.comment, t.lineComment, t.blockComment], color: faint, fontStyle: "italic" },
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: token("--dss-indigo", "#667eea") },
    { tag: [t.string, t.special(t.string)], color: accent },
    { tag: [t.number, t.bool, t.null], color: token("--dss-peri", "#9fbffe") },
    { tag: [t.function(t.variableName), t.labelName], color: "#d2a8ff" },
    { tag: [t.definition(t.variableName), t.propertyName], color: fg },
    { tag: [t.typeName, t.className, t.namespace], color: token("--dss-mint", "#7ef0d0") },
    { tag: [t.operator, t.operatorKeyword], color: token("--dss-mint", "#7ef0d0") },
    { tag: [t.tagName, t.angleBracket], color: token("--dss-peri", "#9fbffe") },
    { tag: [t.attributeName], color: accent },
    { tag: [t.regexp, t.escape], color: "#ff9e64" },
    { tag: [t.meta, t.documentMeta], color: dim },
    { tag: [t.link, t.url], color: accent, textDecoration: "underline" },
    { tag: [t.heading], color: fg, fontWeight: "bold" },
    { tag: [t.invalid], color: token("--dss-error", "#ff6b6b") },
  ]);

  return [view, syntaxHighlighting(highlight)];
}

export function useCodeMirrorTheme(): Extension {
  const { settings } = useWorkspace();
  // Rebuilt whenever the theme changes so the tokens are re-read.
  return useMemo(
    () => buildTheme(settings.theme !== "light"),
    // Presets change the tokens too, so the theme is rebuilt for both.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.theme, settings.preset],
  );
}
