import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, RotateCcw, Save } from "lucide-react";
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { languages } from "@codemirror/language-data";

import { useWorkspace } from "../context/WorkspaceContext";
import type { ToolProps } from "../types";
import { fs, paths, errorText } from "../lib/api";
import { useCodeMirrorTheme } from "../lib/editorTheme";
import { registerFrameHandler } from "../lib/frameBus";

/**
 * File editor backed by CodeMirror 6.
 *
 * Replaces the previous <textarea>, which had no syntax highlighting, no
 * multi-cursor, no folding, and hand-written bracket/indent handling that
 * CodeMirror does properly.
 */
export const CodeEditorPane: React.FC<ToolProps> = ({ frameId, context, setContext }) => {
  const { settings } = useWorkspace();

  const [filePath, setFilePath] = useState(context.filePath ?? "");
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [extensions, setExtensions] = useState<ReturnType<typeof EditorView.theme>[]>([]);

  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const theme = useCodeMirrorTheme();
  const dirty = content !== saved;

  /**
   * The path whose contents are actually in the buffer.
   *
   * Kept separate from `filePath`, which is only what the header shows.
   * Deriving "do we need to load?" from the displayed path meant a freshly
   * mounted frame already agreed with its context and skipped the read, so
   * every file opened blank.
   */
  const loadedRef = useRef<string | null>(null);

  const open = useCallback(async (target: string) => {
    setError(null);
    loadedRef.current = target;
    try {
      const file = await fs.read(target);
      setFilePath(file.path);
      setContent(file.content);
      setSaved(file.content);
      setStatus("idle");
      // The backend returns a normalised path; treat that as loaded too so a
      // round trip through the context does not trigger a second read.
      loadedRef.current = file.path;
    } catch (err) {
      setError(errorText(err));
      setContent("");
      setSaved("");
    }
  }, []);

  // The workspace writes the requested file into this frame's editor context.
  // This covers a fresh mount, a frame switched to the editor by an open, and
  // a frame already showing the editor that had a new file routed to it.
  useEffect(() => {
    const wanted = context.filePath;
    if (!wanted || loadedRef.current === wanted) return;
    void open(wanted);
  }, [context.filePath, open]);

  useEffect(() => {
    if (filePath) setContext({ filePath });
  }, [filePath, setContext]);

  // Load the language mode that matches the extension.
  useEffect(() => {
    let cancelled = false;
    const ext = paths.extname(filePath).replace(".", "");
    if (!ext) {
      setExtensions([]);
      return;
    }
    const match = languages.find(
      (lang) =>
        lang.extensions.includes(ext) ||
        lang.alias.includes(ext) ||
        lang.name.toLowerCase() === ext,
    );
    if (!match) {
      setExtensions([]);
      return;
    }
    match
      .load()
      .then((support) => {
        if (!cancelled) setExtensions([support as never]);
      })
      .catch(() => setExtensions([]));
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const save = useCallback(async () => {
    if (!filePath) return;
    setStatus("saving");
    try {
      await fs.write(filePath, content);
      setSaved(content);
      setStatus("saved");
      setError(null);
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch (err) {
      setError(errorText(err));
      setStatus("idle");
    }
  }, [filePath, content]);

  // Autosave, debounced.
  useEffect(() => {
    if (!settings.autosave || !dirty || !filePath) return;
    const timer = window.setTimeout(() => void save(), 900);
    return () => window.clearTimeout(timer);
  }, [content, dirty, filePath, settings.autosave, save]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    },
    [save],
  );

  // --- control API surface -------------------------------------------------
  //
  // Reads the *live buffer*, not the file on disk, so an agent sees unsaved
  // work exactly as the user does.
  useEffect(() => {
    return registerFrameHandler(frameId, {
      tool: "editor",

      read: () => {
        const view = editorRef.current?.view;
        const selection = view?.state.selection.main;
        return {
          tool: "editor",
          content,
          filePath,
          dirty,
          lineCount: content.length ? content.split("\n").length : 0,
          selection: selection
            ? {
                from: selection.from,
                to: selection.to,
                text: content.slice(selection.from, selection.to),
              }
            : null,
          error,
        };
      },

      write: async (action, payload) => {
        const view = editorRef.current?.view;

        switch (action) {
          case "setContent":
            setContent(String(payload.content ?? ""));
            return { ok: true };

          case "insert": {
            const text = String(payload.text ?? "");
            const at = Number.isFinite(Number(payload.at))
              ? Number(payload.at)
              : (view?.state.selection.main.head ?? content.length);
            const clamped = Math.max(0, Math.min(at, content.length));
            setContent(content.slice(0, clamped) + text + content.slice(clamped));
            return { ok: true, at: clamped };
          }

          case "replace": {
            const find = String(payload.find ?? "");
            if (!find) return { error: "find is required" };
            const replacement = String(payload.replace ?? "");
            const all = payload.all !== false;
            if (!content.includes(find)) return { ok: true, replaced: 0 };
            const replaced = all ? content.split(find).length - 1 : 1;
            setContent(all ? content.split(find).join(replacement) : content.replace(find, replacement));
            return { ok: true, replaced };
          }

          case "find": {
            const needle = String(payload.query ?? "");
            if (!needle) return { error: "query is required" };
            const matches: { index: number; line: number }[] = [];
            let from = 0;
            for (;;) {
              const index = content.indexOf(needle, from);
              if (index === -1) break;
              matches.push({
                index,
                line: content.slice(0, index).split("\n").length,
              });
              from = index + needle.length;
            }
            return { ok: true, matches, count: matches.length };
          }

          case "save":
            await save();
            return { ok: true, filePath };

          case "open": {
            const target = String(payload.path ?? "");
            if (!target) return { error: "path is required" };
            await open(target);
            return { ok: true, filePath: target };
          }

          case "reload":
            if (filePath) await open(filePath);
            return { ok: true };

          default:
            return {
              error: `unknown editor action '${action}'`,
              available: ["setContent", "insert", "replace", "find", "save", "open", "reload"],
            };
        }
      },
    });
  }, [frameId, content, filePath, dirty, error, save, open]);

  const basicSetup = useMemo(
    () => ({
      lineNumbers: true,
      foldGutter: true,
      highlightActiveLine: true,
      highlightActiveLineGutter: true,
      bracketMatching: true,
      closeBrackets: true,
      autocompletion: true,
      highlightSelectionMatches: true,
      searchKeymap: true,
      tabSize: settings.tabSize ?? 2,
    }),
    [settings.tabSize],
  );

  return (
    <div
      onKeyDown={onKeyDown}
      className="h-full flex flex-col overflow-hidden"
      style={{ backgroundColor: "var(--dss-bg-panel)" }}
    >
      <header
        className="dss-chrome flex items-center justify-between gap-2 px-2 py-1 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--dss-border-soft)" }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="truncate text-[11px]"
            style={{
              fontFamily: "var(--dss-font-mono)",
              color: filePath ? "var(--dss-text)" : "var(--dss-text-faint)",
            }}
            title={filePath}
          >
            {filePath ? paths.basename(filePath) : "no file open"}
          </span>
          {dirty && (
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: "var(--dss-accent)" }}
              title="Unsaved changes"
            />
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {status !== "idle" && (
            <span className="dss-label" style={{ fontSize: 9 }}>
              {status}
            </span>
          )}
          <button
            className="dss-icon-button"
            title="Reload from disk"
            disabled={!filePath}
            onClick={() => filePath && open(filePath)}
          >
            <RotateCcw size={11} />
          </button>
          <button
            className="dss-icon-button"
            title="Open with system app"
            disabled={!filePath}
            onClick={() => filePath && fs.openExternal(filePath).catch((e) => setError(errorText(e)))}
          >
            <ExternalLink size={11} />
          </button>
          <button
            className="dss-icon-button"
            title="Save (Ctrl+S)"
            disabled={!filePath || !dirty}
            onClick={save}
          >
            <Save size={11} />
          </button>
        </div>
      </header>

      {error && (
        <div
          className="px-2 py-1 text-[11px] flex-shrink-0 dss-selectable"
          style={{ color: "var(--dss-destructive)", backgroundColor: "var(--dss-bg-input)" }}
        >
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden dss-selectable">
        {filePath ? (
          <CodeMirror
            ref={editorRef}
            value={content}
            onChange={setContent}
            height="100%"
            style={{ height: "100%", fontSize: settings.fontSize ?? 13 }}
            theme={theme}
            extensions={extensions}
            basicSetup={basicSetup}
          />
        ) : (
          <div
            className="h-full flex items-center justify-center text-[11px]"
            style={{ color: "var(--dss-text-faint)" }}
          >
            open a file from the explorer
          </div>
        )}
      </div>
    </div>
  );
};
