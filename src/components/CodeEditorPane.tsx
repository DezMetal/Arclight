import React, { useState, useEffect, useRef } from "react";
import { FileCode, Save, RefreshCw, Check, AlertCircle, FileText, Search, CornerDownRight, Braces, Info, X, ExternalLink, Terminal } from "lucide-react";
import { useWorkspace } from "../context/WorkspaceContext";

export const CodeEditorPane: React.FC<{
  paneId: string;
  state: { filePath?: string; fileContent?: string; isDirty?: boolean };
  updateState: (state: any) => void;
}> = ({ paneId, state, updateState }) => {
  const { settings, setActivePaneId, setLastActiveEditorId } = useWorkspace();
  const [filePath, setFilePath] = useState<string | null>(state.filePath || null);
  const [fileContent, setFileContent] = useState<string>(state.fileContent || "");
  const [isDirty, setIsDirty] = useState<boolean>(state.isDirty || false);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Advanced editor features states
  const [cursorPos, setCursorPos] = useState({ line: 1, column: 1 });
  
  // Find & Replace
  const [showFind, setShowFind] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [matchIndex, setMatchIndex] = useState(-1);
  const [matches, setMatches] = useState<number[]>([]);



  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const [forceOpenAsText, setForceOpenAsText] = useState(false);
  const lastPathRef = useRef<string | null>(null);
  const hasLoadedRef = useRef<boolean>(false);

  // React to file path changes assigned from parent layout state
  useEffect(() => {
    if (state.filePath) {
      const isNewPath = lastPathRef.current !== state.filePath;
      if (isNewPath) {
        lastPathRef.current = state.filePath;
        setForceOpenAsText(false);
        hasLoadedRef.current = false;
      }
      
      // Use cached state from layout tree if available, avoiding redundant loads that discard local edits
      if (state.fileContent !== undefined) {
        setFilePath(state.filePath);
        setFileContent(state.fileContent);
        setIsDirty(state.isDirty || false);
        hasLoadedRef.current = true;
      } else {
        handleOpenFile(state.filePath);
      }
    } else {
      lastPathRef.current = null;
      setFilePath(null);
      setFileContent("");
      setIsDirty(false);
      hasLoadedRef.current = true;
    }
  }, [state.filePath, forceOpenAsText]);

  // Keep state sync'd with workspace state updates
  useEffect(() => {
    // Only update parent state if we have successfully loaded or cached the file,
    // and our local filePath matches what the parent expects,
    // to prevent overwriting the parent's new target path during the loading phase.
    if (hasLoadedRef.current && (state.filePath === undefined || state.filePath === filePath)) {
      updateState({ filePath, fileContent, isDirty });
    }
  }, [filePath, fileContent, isDirty, state.filePath, updateState]);

  // Auto-update match positions for Find & Replace
  useEffect(() => {
    if (!findText) {
      setMatches([]);
      setMatchIndex(-1);
      return;
    }
    const idxs: number[] = [];
    let pos = 0;
    while (true) {
      const matchPos = fileContent.toLowerCase().indexOf(findText.toLowerCase(), pos);
      if (matchPos === -1) break;
      idxs.push(matchPos);
      pos = matchPos + findText.length;
    }
    setMatches(idxs);
    if (idxs.length > 0) {
      setMatchIndex((prev) => (prev >= 0 && prev < idxs.length ? prev : 0));
    } else {
      setMatchIndex(-1);
    }
  }, [findText, fileContent]);

  const handleOpenFile = async (path: string) => {
    setLoading(true);
    setErrorMessage(null);
    setSaveStatus("idle");

    const fileNm = path.replace(/\\/g, "/").split("/").pop() || "";
    const fileExt = fileNm.split(".").pop()?.toLowerCase() || "";
    const isImg = ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"].includes(fileExt);
    const isAud = ["mp3", "wav", "ogg", "m4a", "aac"].includes(fileExt);
    const isVid = ["mp4", "webm", "ogv", "mov", "avi"].includes(fileExt);
    const isTextFile = [
      "ts", "tsx", "js", "jsx", "html", "css", "json", "md", "txt", "py", "sh", "yml", "yaml", "xml", "ini", "conf", "sql", "env", "gitignore", "dockerfile", "mdx", "toml", "gradle", "properties"
    ].includes(fileExt) || !fileExt;

    // Skip reading file content for media and binaries unless forced to open as text
    if ((isImg || isAud || isVid || !isTextFile) && !forceOpenAsText) {
      setFilePath(path);
      setFileContent("");
      setIsDirty(false);
      hasLoadedRef.current = true;
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        throw new Error(`Failed to load file: ${res.statusText}`);
      }
      const data = await res.json();
      setFilePath(path);
      setFileContent(data.content || "");
      setIsDirty(false);
      hasLoadedRef.current = true;
    } catch (err: any) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenExternal = async (appName?: string) => {
    if (!filePath) return;
    try {
      const res = await fetch("/api/files/open-external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, app: appName }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to open externally");
      }
      setErrorMessage(null);
    } catch (err: any) {
      setErrorMessage(`Failed to open: ${err.message}`);
    }
  };

  const handleSaveFile = async () => {
    if (!filePath) return;
    setSaveStatus("saving");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, content: fileContent }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to save file");
      }

      setIsDirty(false);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch (err: any) {
      setSaveStatus("error");
      setErrorMessage(err.message);
    }
  };

  // Autosave implementation
  useEffect(() => {
    if (!settings.autosave || !isDirty || !filePath) return;

    const timer = setTimeout(() => {
      handleSaveFile();
    }, 1500);

    return () => clearTimeout(timer);
  }, [fileContent, isDirty, filePath, settings.autosave]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setFileContent(e.target.value);
    setIsDirty(true);
  };

  const updateCursorPos = () => {
    const textarea = textAreaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const textBefore = fileContent.substring(0, start);
    const lines = textBefore.split("\n");
    setCursorPos({
      line: lines.length,
      column: lines[lines.length - 1].length + 1
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = textAreaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    // 1. Bracket/Quote Auto-Closing
    const closingPairs: Record<string, string> = {
      "(": ")",
      "[": "]",
      "{": "}",
      "\"": "\"",
      "'": "'",
      "`": "`",
    };

    if (closingPairs[e.key] !== undefined) {
      e.preventDefault();
      const closingChar = closingPairs[e.key];
      const selected = fileContent.substring(start, end);
      const inserted = e.key + selected + closingChar;
      const updated = fileContent.substring(0, start) + inserted + fileContent.substring(end);
      
      setFileContent(updated);
      setIsDirty(true);
      setTimeout(() => {
        textarea.selectionStart = start + 1;
        textarea.selectionEnd = start + 1 + selected.length;
        updateCursorPos();
      }, 0);
      return;
    }

    // 2. Overwrite closing bracket/quote if typed immediately before it
    if ([")", "]", "}", "\"", "'", "`"].includes(e.key)) {
      if (start === end && fileContent[start] === e.key) {
        e.preventDefault();
        textarea.selectionStart = textarea.selectionEnd = start + 1;
        updateCursorPos();
        return;
      }
    }

    // 3. Auto-Indent on Enter
    if (e.key === "Enter") {
      e.preventDefault();
      const textBefore = fileContent.substring(0, start);
      const lines = textBefore.split("\n");
      const currentLine = lines[lines.length - 1];
      const indentMatch = currentLine.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : "";

      const inserted = "\n" + indent;
      const updated = fileContent.substring(0, start) + inserted + fileContent.substring(end);
      
      setFileContent(updated);
      setIsDirty(true);
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + inserted.length;
        updateCursorPos();
      }, 0);
      return;
    }

    // 4. Tab indent
    if (e.key === "Tab") {
      e.preventDefault();
      const spaces = " ".repeat(settings.tabSize || 2);
      const updatedContent = fileContent.substring(0, start) + spaces + fileContent.substring(end);
      setFileContent(updatedContent);
      setIsDirty(true);

      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + spaces.length;
        updateCursorPos();
      }, 0);
    }

    // Ctrl+S or Cmd+S to save
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      handleSaveFile();
    }

    // Ctrl+F or Cmd+F for Find Panel
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      setShowFind(true);
    }


  };

  const handleEditorFocus = () => {
    setActivePaneId(paneId);
    setLastActiveEditorId(paneId);
  };

  const fileName = filePath ? filePath.replace(/\\/g, "/").split("/").pop() || "" : "";
  const fileExtension = fileName.split(".").pop() || "";

  const ext = fileExtension.toLowerCase();
  const isImage = ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"].includes(ext);
  const isAudio = ["mp3", "wav", "ogg", "m4a", "aac"].includes(ext);
  const isVideo = ["mp4", "webm", "ogv", "mov", "avi"].includes(ext);
  const isKnownText = [
    "ts", "tsx", "js", "jsx", "html", "css", "json", "md", "txt", "py", "sh", "yml", "yaml", "xml", "ini", "conf", "sql", "env", "gitignore", "dockerfile", "mdx", "toml", "gradle", "properties"
  ].includes(ext) || !ext;

  const getSaveStatusIcon = () => {
    switch (saveStatus) {
      case "saving":
        return <RefreshCw size={14} className="animate-spin text-blue-400" />;
      case "saved":
        return <Check size={14} className="text-emerald-400" />;
      case "error":
        return <AlertCircle size={14} className="text-rose-400" />;
      default:
        return <Save size={14} className="text-slate-400 group-hover:text-slate-200" />;
    }
  };

  const getSaveStatusText = () => {
    switch (saveStatus) {
      case "saving":
        return "Saving...";
      case "saved":
        return "Saved";
      case "error":
        return "Save Error";
      default:
        return "Save (Ctrl+S)";
    }
  };

  // Auto-Formatter for standard brace languages and JSON
  const handleFormatCode = () => {
    if (!fileContent.trim()) return;
    try {
      if (fileExtension === "json") {
        const parsed = JSON.parse(fileContent);
        setFileContent(JSON.stringify(parsed, null, settings.tabSize || 2));
        setIsDirty(true);
        return;
      }

      const linesList = fileContent.split("\n");
      let currentIndentLevel = 0;
      const tabSpace = " ".repeat(settings.tabSize || 2);
      
      const formattedLines = linesList.map((line) => {
        let trimmed = line.trim();
        
        if (trimmed.startsWith("}") || trimmed.startsWith("]") || trimmed.startsWith(")")) {
          currentIndentLevel = Math.max(0, currentIndentLevel - 1);
        }
        
        const indentedLine = tabSpace.repeat(currentIndentLevel) + trimmed;
        
        const opens = (trimmed.match(/[\{\[\(]/g) || []).length;
        const closes = (trimmed.match(/[\}\]\)]/g) || []).length;
        currentIndentLevel = Math.max(0, currentIndentLevel + (opens - closes));
        
        return indentedLine;
      });

      setFileContent(formattedLines.join("\n"));
      setIsDirty(true);
    } catch (err: any) {
      setErrorMessage("Could not auto-format: " + err.message);
    }
  };

  const highlightMatch = (startPos: number) => {
    const textarea = textAreaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(startPos, startPos + findText.length);
    const lineNum = fileContent.substring(0, startPos).split("\n").length;
    textarea.scrollTop = Math.max(0, (lineNum - 6) * 21);
  };

  const findNext = () => {
    if (matches.length === 0) return;
    const nextIdx = (matchIndex + 1) % matches.length;
    setMatchIndex(nextIdx);
    highlightMatch(matches[nextIdx]);
  };

  const findPrev = () => {
    if (matches.length === 0) return;
    const prevIdx = (matchIndex - 1 + matches.length) % matches.length;
    setMatchIndex(prevIdx);
    highlightMatch(matches[prevIdx]);
  };

  const doReplace = () => {
    if (matchIndex === -1 || matches.length === 0) return;
    const currentPos = matches[matchIndex];
    const updated = fileContent.substring(0, currentPos) + replaceText + fileContent.substring(currentPos + findText.length);
    setFileContent(updated);
    setIsDirty(true);
  };

  const doReplaceAll = () => {
    if (!findText) return;
    const regex = new RegExp(findText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
    const updated = fileContent.replace(regex, replaceText);
    setFileContent(updated);
    setIsDirty(true);
  };



  const lineCount = fileContent.split("\n").length;

  return (
    <div 
      onClick={handleEditorFocus}
      className="h-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden relative font-sans"
    >
      {/* Editor Header */}
      <div className="px-3 py-2 border-b border-slate-800/60 flex items-center justify-between bg-slate-900/60">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 bg-slate-800 border border-slate-700/60 rounded">
            {filePath ? (
              <FileCode size={13} className="text-blue-400" />
            ) : (
              <FileText size={13} className="text-slate-400" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-xs tracking-tight truncate text-slate-200">
              {fileName || "No File Selected"}
            </h3>
            {filePath && (
              <p className="text-[9px] text-slate-500 font-mono truncate" title={filePath}>{filePath}</p>
            )}
          </div>
          {isDirty && (
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0 animate-pulse" title="Unsaved changes" />
          )}
        </div>

        {filePath && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowFind(!showFind)}
              className={`p-1.5 rounded border border-slate-700/60 text-slate-400 hover:text-white hover:bg-slate-800 transition ${showFind ? "bg-blue-600/20 border-blue-500/50 text-blue-400" : ""}`}
              title="Find and Replace (Ctrl+F)"
            >
              <Search size={12} />
            </button>
            <button
              onClick={handleFormatCode}
              className="p-1.5 rounded border border-slate-700/60 text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Auto Format Indentation"
            >
              <Braces size={12} />
            </button>
            <button
              onClick={handleSaveFile}
              disabled={saveStatus === "saving"}
              className="group flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-750 disabled:bg-slate-850 rounded text-[10px] font-semibold text-slate-300 hover:text-white transition border border-slate-700/60"
            >
              {getSaveStatusIcon()}
              <span className="hidden sm:inline">{getSaveStatusText()}</span>
            </button>
          </div>
        )}
      </div>

      {/* Advanced Find & Replace Bar */}
      {showFind && filePath && (
        <div className="px-3 py-2 bg-slate-900 border-b border-slate-800/80 flex flex-wrap items-center gap-2 animate-fadeIn z-20">
          <div className="flex items-center bg-slate-950 rounded border border-slate-800 px-2 py-1">
            <input
              type="text"
              placeholder="Find..."
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              className="bg-transparent text-xs text-slate-200 outline-none w-32 font-mono"
              autoFocus
            />
            {findText && (
              <span className="text-[10px] text-slate-500 ml-1.5 font-mono select-none">
                {matches.length > 0 ? `${matchIndex + 1}/${matches.length}` : "0"}
              </span>
            )}
          </div>

          <div className="flex items-center bg-slate-950 rounded border border-slate-800 px-2 py-1">
            <input
              type="text"
              placeholder="Replace..."
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              className="bg-transparent text-xs text-slate-200 outline-none w-32 font-mono"
            />
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={findPrev}
              disabled={matches.length === 0}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded text-[10px] font-mono"
            >
              Prev
            </button>
            <button
              onClick={findNext}
              disabled={matches.length === 0}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded text-[10px] font-mono"
            >
              Next
            </button>
            <button
              onClick={doReplace}
              disabled={matchIndex === -1}
              className="px-2 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-30 rounded text-[10px] text-white font-mono"
            >
              Replace
            </button>
            <button
              onClick={doReplaceAll}
              disabled={!findText}
              className="px-2 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-30 rounded text-[10px] text-white font-mono"
            >
              All
            </button>
            <button
              onClick={() => setShowFind(false)}
              className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-100 rounded ml-1"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}



      {/* Editor Main Canvas */}
      <div className="flex-1 flex overflow-hidden font-mono text-xs leading-relaxed relative">
        {loading ? (
          <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-[1px] flex flex-col items-center justify-center z-10">
            <RefreshCw size={24} className="text-blue-400 animate-spin mb-2" />
            <span className="text-xs text-slate-400 font-sans">Reading file content...</span>
          </div>
        ) : !filePath ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500 font-sans">
            <FileCode size={40} className="text-slate-700 stroke-[1.5] mb-3" />
            <h4 className="font-semibold text-slate-400 text-sm">No Active File</h4>
            <p className="text-xs max-w-xs mt-1 text-slate-500">
              Double-click a file in the File Explorer to open it here for editing.
            </p>
          </div>
        ) : isImage && !forceOpenAsText ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-900 overflow-y-auto">
            <div className="max-w-full p-4 bg-slate-950 border border-slate-800 rounded-lg shadow-2xl flex flex-col items-center gap-4">
              <div className="relative p-2 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:16px_16px] bg-slate-900 rounded border border-slate-800 max-h-[350px] overflow-hidden flex items-center justify-center">
                <img
                  src={`/api/files/raw?path=${encodeURIComponent(filePath)}`}
                  alt={fileName}
                  referrerPolicy="no-referrer"
                  className="max-h-[300px] max-w-full object-contain select-none"
                />
              </div>
              <div className="text-center font-sans space-y-1">
                <h4 className="text-xs font-semibold text-slate-200">{fileName}</h4>
                <p className="text-[10px] text-slate-500 font-mono truncate max-w-xs">{filePath}</p>
                <div className="flex justify-center gap-3 pt-2">
                  <a
                    href={`/api/files/raw?path=${encodeURIComponent(filePath)}`}
                    download={fileName}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-[11px] font-semibold transition"
                  >
                    Download Image
                  </a>
                  <button
                    onClick={() => handleOpenExternal()}
                    className="px-3 py-1 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded text-[11px] font-semibold transition"
                  >
                    Open with Default App
                  </button>
                  <button
                    onClick={() => setForceOpenAsText(true)}
                    className="px-3 py-1 bg-slate-850 hover:bg-slate-800 text-slate-400 rounded text-[11px] font-semibold transition"
                  >
                    Force Open as Text
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : isAudio && !forceOpenAsText ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-900">
            <div className="w-full max-w-md p-6 bg-slate-950 border border-slate-800 rounded-lg shadow-2xl flex flex-col items-center gap-4">
              <div className="p-4 bg-blue-600/10 border border-blue-500/20 rounded-full text-blue-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
              </div>
              <div className="text-center font-sans space-y-1 w-full">
                <h4 className="text-xs font-semibold text-slate-200 truncate">{fileName}</h4>
                <p className="text-[10px] text-slate-500 font-mono truncate">{filePath}</p>
              </div>
              <audio
                controls
                src={`/api/files/raw?path=${encodeURIComponent(filePath)}`}
                className="w-full mt-2"
              />
              <div className="flex gap-3 pt-2">
                <a
                  href={`/api/files/raw?path=${encodeURIComponent(filePath)}`}
                  download={fileName}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-[11px] font-semibold transition font-sans"
                >
                  Download Audio
                </a>
                <button
                  onClick={() => handleOpenExternal()}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded text-[11px] font-semibold transition font-sans"
                >
                  Open with Default App
                </button>
                <button
                  onClick={() => setForceOpenAsText(true)}
                  className="px-3 py-1 bg-slate-850 hover:bg-slate-800 text-slate-400 rounded text-[11px] font-semibold transition font-sans"
                >
                  Force Open as Text
                </button>
              </div>
            </div>
          </div>
        ) : isVideo && !forceOpenAsText ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-900 overflow-y-auto">
            <div className="w-full max-w-xl p-4 bg-slate-950 border border-slate-800 rounded-lg shadow-2xl flex flex-col items-center gap-4">
              <video
                controls
                src={`/api/files/raw?path=${encodeURIComponent(filePath)}`}
                className="max-h-[250px] w-full rounded border border-slate-800 bg-black"
              />
              <div className="text-center font-sans space-y-1 w-full">
                <h4 className="text-xs font-semibold text-slate-200 truncate">{fileName}</h4>
                <p className="text-[10px] text-slate-500 font-mono truncate">{filePath}</p>
                <div className="flex justify-center gap-3 pt-2">
                  <a
                    href={`/api/files/raw?path=${encodeURIComponent(filePath)}`}
                    download={fileName}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-[11px] font-semibold transition"
                  >
                    Download Video
                  </a>
                  <button
                    onClick={() => handleOpenExternal()}
                    className="px-3 py-1 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded text-[11px] font-semibold transition"
                  >
                    Open with Default App
                  </button>
                  <button
                    onClick={() => setForceOpenAsText(true)}
                    className="px-3 py-1 bg-slate-850 hover:bg-slate-800 text-slate-400 rounded text-[11px] font-semibold transition"
                  >
                    Force Open as Text
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : !isKnownText && !forceOpenAsText ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-900">
            <div className="max-w-md p-6 bg-slate-950 border border-slate-800 rounded-xl shadow-2xl space-y-4">
              <div className="p-4 bg-slate-800 border border-slate-700/60 rounded-full text-slate-400 w-16 h-16 flex items-center justify-center mx-auto">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>
              </div>
              <div className="space-y-1 font-sans">
                <h4 className="font-semibold text-slate-200 text-sm">Unsupported or Binary File</h4>
                <p className="text-xs text-slate-400 leading-relaxed max-w-xs mx-auto">
                  The file <strong className="text-slate-300 font-semibold">{fileName}</strong> has a binary format or extension (<strong className="text-blue-400 font-mono uppercase">{fileExtension || "unknown"}</strong>) and cannot be displayed as plain text.
                </p>
              </div>
              <div className="flex flex-col gap-2 pt-2 font-sans">
                <div className="grid grid-cols-2 gap-2">
                  <a
                    href={`/api/files/raw?path=${encodeURIComponent(filePath)}`}
                    download={fileName}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-xs font-semibold rounded text-white transition text-center"
                  >
                    Download File
                  </a>
                  <button
                    onClick={() => handleOpenExternal()}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-750 text-xs font-semibold rounded text-slate-200 border border-slate-700/50 transition"
                  >
                    Open with Default App
                  </button>
                </div>
                <button
                  onClick={() => setForceOpenAsText(true)}
                  className="w-full px-3 py-2 bg-slate-900 hover:bg-slate-850 text-xs font-semibold rounded text-slate-400 hover:text-slate-200 transition border border-slate-800"
                >
                  Force Open as Text Anyway
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex h-full overflow-hidden relative">
            {/* Line Numbers column */}
            <div className="py-4 select-none text-right text-slate-600 bg-slate-950 border-r border-slate-900/80 w-12 font-mono pr-3 flex flex-col overflow-hidden">
              {Array.from({ length: lineCount }).map((_, i) => (
                <div key={i} className="h-[21px]" style={{ fontSize: `${settings.fontSize}px` }}>{i + 1}</div>
              ))}
            </div>

            {/* Standard Edit Canvas */}
            <textarea
              ref={textAreaRef}
              value={fileContent}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              onFocus={handleEditorFocus}
              onClick={updateCursorPos}
              onKeyUp={updateCursorPos}
              spellCheck={false}
              className="flex-1 py-4 px-4 bg-slate-950 text-slate-200 outline-none resize-none overflow-y-auto whitespace-pre font-mono leading-[21px] selection:bg-blue-600/30 selection:text-white"
              style={{ 
                tabSize: settings.tabSize || 2, 
                fontSize: `${settings.fontSize || 14}px` 
              }}
              placeholder="Start coding here..."
            />
          </div>
        )}
      </div>

      {/* Editor Footer */}
      {filePath && (
        <div className="px-3 py-1.5 border-t border-slate-900 bg-slate-950/80 text-[10px] text-slate-500 flex justify-between items-center font-mono">
          <div className="flex items-center gap-3 select-none">
            <span>Lines: {lineCount}</span>
            <span>Col: {cursorPos.column}, Ln: {cursorPos.line}</span>
            <span>Type: <span className="uppercase text-slate-400">{fileExtension || "txt"}</span></span>
          </div>
          {errorMessage ? (
            <span className="text-rose-400 flex items-center gap-1 font-sans">
              <AlertCircle size={10} /> {errorMessage}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
};
