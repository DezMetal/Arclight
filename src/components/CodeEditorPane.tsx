import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, RotateCcw, Save } from "lucide-react";
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { languages } from "@codemirror/language-data";

import { useWorkspace } from "../context/WorkspaceContext";
import { fs, paths, errorText } from "../lib/api";
import { useCodeMirrorTheme } from "../lib/editorTheme";

/**
 * File editor backed by CodeMirror 6.
 *
 * Replaces the previous <textarea>, which had no syntax highlighting, no
 * multi-cursor, no folding, and hand-written bracket/indent handling that
 * CodeMirror does properly.
 */
export const CodeEditorPane: React.FC<{
  paneId: string;
  state: { filePath?: string };
  updateState: (state: Record<string, unknown>) => void;
}> = ({ paneId, state, updateState }) => {
  const workspace = useWorkspace();
  const { settings, setActivePaneId, setLastActiveEditorId } = workspace;

  const [filePath, setFilePath] = useState(state.filePath ?? "");
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [extensions, setExtensions] = useState<ReturnType<typeof EditorView.theme>[]>([]);

  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const theme = useCodeMirrorTheme();
  const dirty = content !== saved;

  const open = useCallback(async (target: string) => {
    setError(null);
    try {
      const file = await fs.read(target);
      setFilePath(file.path);
      setContent(file.content);
      setSaved(file.content);
      setStatus("idle");
    } catch (err) {
      setError(errorText(err));
      setContent("");
      setSaved("");
    }
  }, []);

  useEffect(() => {
    if (state.filePath) void open(state.filePath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (filePath) updateState({ filePath });
  }, [filePath, updateState]);

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

  // Open requests from the explorer and from `dnet open`.
  useEffect(() => {
    const unsubscribe = workspace.subscribeEvent(
      "open-file",
      (payload: { path?: string; sourcePaneId?: string }) => {
        if (!payload?.path) return;
        const isTarget =
          workspace.activePaneId === paneId ||
          workspace.lastActiveEditorId === paneId ||
          !workspace.activePaneId;
        if (isTarget) void open(payload.path);
      },
    );
    return unsubscribe;
  }, [workspace, paneId, open]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    },
    [save],
  );

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
      onMouseDown={() => {
        setActivePaneId(paneId);
        setLastActiveEditorId(paneId);
      }}
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
