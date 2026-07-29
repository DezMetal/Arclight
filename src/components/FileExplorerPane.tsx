import React, { useState, useEffect, useCallback, useRef } from "react";
import { 
  Folder, 
  File, 
  ArrowLeft, 
  Plus, 
  FolderPlus, 
  Trash2, 
  Edit3, 
  Search, 
  RefreshCw, 
  ChevronRight, 
  FileDown,
  CornerDownRight,
  FolderOpen,
  Copy,
  Scissors,
  Clipboard,
  Terminal,
  ExternalLink,
  Layers
} from "lucide-react";
import { useWorkspace } from "../context/WorkspaceContext";
import { FileItem, DirectoryListing } from "../types";

export const FileExplorerPane: React.FC<{
  paneId: string;
  state: { currentPath?: string };
  updateState: (state: any) => void;
}> = ({ paneId, state, updateState }) => {
  const { emitEvent, subscribeEvent, settings, splitPane, panesRegistry } = useWorkspace();
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  
  // Interactive Address Bar state
  const [addressInput, setAddressInput] = useState("");
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const addressInputRef = useRef<HTMLInputElement>(null);

  // Dialog / Inline input states
  const [actionType, setActionType] = useState<"create-file" | "create-dir" | "rename" | null>(null);
  const [inputText, setInputText] = useState("");
  const [selectedItem, setSelectedItem] = useState<FileItem | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Right-click context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: FileItem;
  } | null>(null);

  // Clipboard context state
  const [clipboard, setClipboard] = useState<{
    action: "cut" | "copy";
    item: FileItem;
  } | null>(null);

  const currentPath = state.currentPath || ".";

  const handleCopyPath = (item: FileItem) => {
    navigator.clipboard.writeText(item.absolutePath);
  };

  const handleOpenInTerminal = (item: FileItem) => {
    const folderPath = item.isDirectory ? item.absolutePath : listing?.absoluteCurrentPath || ".";
    emitEvent("change-terminal-cwd", { path: folderPath });
  };

  const handleDuplicate = async (item: FileItem) => {
    const folder = listing?.absoluteCurrentPath || currentPath;
    const ext = item.name.includes(".") ? item.name.substring(item.name.lastIndexOf(".")) : "";
    const nameWithoutExt = item.name.includes(".") ? item.name.substring(0, item.name.lastIndexOf(".")) : item.name;
    const destName = `${nameWithoutExt}_copy${ext}`;
    const destPath = `${folder}/${destName}`;

    setLoading(true);
    try {
      if (item.isDirectory) {
        const cmd = process.platform === "win32"
          ? `xcopy "${item.absolutePath}" "${destPath}" /E /I /H /Y`
          : `cp -r "${item.absolutePath}" "${destPath}"`;
          
        const res = await fetch("/api/terminal/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: cmd, cwd: folder }),
        });
        if (!res.ok) throw new Error("Duplicate directory failed");
      } else {
        const readRes = await fetch(`/api/files/read?path=${encodeURIComponent(item.absolutePath)}`);
        if (!readRes.ok) throw new Error("Failed to read source file");
        const readData = await readRes.json();
        
        const writeRes = await fetch("/api/files/write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: destPath, content: readData.content || "" }),
        });
        if (!writeRes.ok) throw new Error("Failed to duplicate file");
      }
      fetchDirectory(folder, true);
    } catch (err: any) {
      setError(`Duplicate failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePaste = async () => {
    if (!clipboard) return;
    const destFolder = listing?.absoluteCurrentPath || currentPath;
    const destPath = `${destFolder}/${clipboard.item.name}`;

    setLoading(true);
    try {
      if (clipboard.action === "cut") {
        const res = await fetch("/api/files/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldPath: clipboard.item.absolutePath, newPath: destPath }),
        });
        if (!res.ok) throw new Error("Cut/Paste failed during rename");
        setClipboard(null);
      } else {
        // Copy action
        if (clipboard.item.isDirectory) {
          const cmd = process.platform === "win32"
            ? `xcopy "${clipboard.item.absolutePath}" "${destPath}" /E /I /H /Y`
            : `cp -r "${clipboard.item.absolutePath}" "${destPath}"`;
            
          const res = await fetch("/api/terminal/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command: cmd, cwd: destFolder }),
          });
          if (!res.ok) throw new Error("Copy/Paste for directory failed");
        } else {
          // File copy. Read then write!
          const readRes = await fetch(`/api/files/read?path=${encodeURIComponent(clipboard.item.absolutePath)}`);
          if (!readRes.ok) throw new Error("Failed to read source file");
          const readData = await readRes.json();
          
          const writeRes = await fetch("/api/files/write", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: destPath, content: readData.content || "" }),
          });
          if (!writeRes.ok) throw new Error("Failed to write copied file");
        }
      }
      fetchDirectory(destFolder, true);
    } catch (err: any) {
      setError(`Paste failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchDirectory = useCallback(async (pathQuery: string, force = false) => {
    // Prevent double fetch if already loaded
    if (!force && listing && (pathQuery === listing.absoluteCurrentPath || pathQuery === listing.currentPath)) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/list?path=${encodeURIComponent(pathQuery)}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to list directory: ${res.statusText}`);
      }
      const data: DirectoryListing = await res.json();
      setListing(data);
      setAddressInput(data.absoluteCurrentPath);
      updateState({ currentPath: data.absoluteCurrentPath });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [updateState, listing]);

  useEffect(() => {
    fetchDirectory(currentPath);
  }, [currentPath]);

  useEffect(() => {
    const handleRefresh = () => {
      fetchDirectory(currentPath, true);
    };
    const unsubscribe = subscribeEvent("refresh-explorer", handleRefresh);
    return unsubscribe;
  }, [currentPath, fetchDirectory, subscribeEvent]);

  // Close context menu on any outside click
  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  const handleNavigate = (path: string) => {
    fetchDirectory(path);
  };

  const handleGoBack = () => {
    if (!listing) return;
    // Simply fetch parent of absoluteCurrentPath using /..
    handleNavigate(`${listing.absoluteCurrentPath}/..`);
  };

  const handleAddressSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsEditingAddress(false);
    if (addressInput.trim()) {
      handleNavigate(addressInput.trim());
    }
  };

  const startEditingAddress = () => {
    if (listing) {
      setAddressInput(listing.absoluteCurrentPath);
    }
    setIsEditingAddress(true);
    setTimeout(() => {
      addressInputRef.current?.select();
    }, 50);
  };

  // Click opens folder or file on targeted workspace pane
  const handleItemClick = (item: FileItem) => {
    setSelectedItem(item);
    if (item.isDirectory) {
      handleNavigate(item.absolutePath);
    } else {
      emitEvent("open-file", { path: item.absolutePath, absolutePath: item.absolutePath, name: item.name, sourcePaneId: paneId });
    }
  };

  const handleItemDoubleClick = (item: FileItem) => {
    if (item.isDirectory) {
      handleNavigate(item.absolutePath);
    } else {
      emitEvent("open-file", { path: item.absolutePath, absolutePath: item.absolutePath, name: item.name, sourcePaneId: paneId });
    }
  };

  const handleCreate = async () => {
    if (!inputText.trim()) return;
    const activeFolder = listing?.absoluteCurrentPath || currentPath;
    try {
      const type = actionType === "create-dir" ? "dir" : "file";
      const targetPath = `${activeFolder}/${inputText.trim()}`;
        
      const res = await fetch("/api/files/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: targetPath, type }),
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Creation failed");
      }
      
      setInputText("");
      setActionType(null);
      fetchDirectory(activeFolder, true);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (item: FileItem) => {
    if (!confirm(`Are you sure you want to delete ${item.name}?`)) return;
    const activeFolder = listing?.absoluteCurrentPath || currentPath;
    try {
      const res = await fetch("/api/files/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.absolutePath }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Deletion failed");
      }
      fetchDirectory(activeFolder, true);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRename = async () => {
    if (!selectedItem || !inputText.trim()) return;
    const activeFolder = listing?.absoluteCurrentPath || currentPath;
    try {
      const oldPath = selectedItem.absolutePath;
      const newPath = `${activeFolder}/${inputText.trim()}`;

      const res = await fetch("/api/files/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPath, newPath }),
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Rename failed");
      }
      
      setInputText("");
      setSelectedItem(null);
      setActionType(null);
      fetchDirectory(activeFolder, true);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDownloadFile = async (item: FileItem) => {
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(item.absolutePath)}`);
      if (!res.ok) throw new Error("Failed to read file");
      const data = await res.json();
      const blob = new Blob([data.content || ""], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(`Download failed: ${err.message}`);
    }
  };

  // Long press for mobile support
  const touchTimerRef = useRef<any>(null);
  const touchStartedRef = useRef<boolean>(false);

  useEffect(() => {
    return () => {
      if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    };
  }, []);

  const handleTouchStart = (e: React.TouchEvent, item: FileItem) => {
    touchStartedRef.current = true;
    const touch = e.touches[0];
    const clientX = touch.clientX;
    const clientY = touch.clientY;
    
    if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    touchTimerRef.current = setTimeout(() => {
      if (touchStartedRef.current) {
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
        handleContextMenu(e, item, clientX, clientY);
      }
    }, 600); // 600ms for long-press
  };

  const handleTouchEnd = () => {
    touchStartedRef.current = false;
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  };

  const handleTouchMove = () => {
    touchStartedRef.current = false;
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  };

  const handleContextMenu = (e: React.MouseEvent | React.TouchEvent | MouseEvent, item: FileItem, clientX?: number, clientY?: number) => {
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    
    setSelectedItem(item);

    const xPos = clientX !== undefined ? clientX : (e as React.MouseEvent).clientX;
    const yPos = clientY !== undefined ? clientY : (e as React.MouseEvent).clientY;

    const menuWidth = 190; // Approx menu width
    const menuHeight = 280; // Approx menu height
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    let x = xPos;
    let y = yPos;

    if (x + menuWidth > windowWidth) {
      x = windowWidth - menuWidth;
    }
    if (y + menuHeight > windowHeight) {
      y = windowHeight - menuHeight;
    }
    if (x < 10) x = 10;
    if (y < 10) y = 10;

    setContextMenu({
      x,
      y,
      item,
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await uploadFiles(files);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await uploadFiles(e.target.files);
    }
  };

  const uploadFiles = async (files: FileList) => {
    setLoading(true);
    const activeFolder = listing?.absoluteCurrentPath || currentPath;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      
      const fileLoaded = () => {
        return new Promise<string | ArrayBuffer | null>((resolve) => {
          reader.onload = () => resolve(reader.result);
          reader.readAsText(file);
        });
      };

      try {
        const content = await fileLoaded();
        const relativePath = `${activeFolder}/${file.name}`;
          
        const res = await fetch("/api/files/write", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: relativePath, content: content as string }),
        });
        
        if (!res.ok) {
          throw new Error(`Failed to upload ${file.name}`);
        }
      } catch (err: any) {
        setError(err.message);
        break;
      }
    }
    fetchDirectory(activeFolder, true);
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "-";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // Filter items matching search and matching showHidden preferences
  const filteredItems = (listing?.items || []).filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesHidden = settings.showHidden || !item.name.startsWith(".");
    return matchesSearch && matchesHidden;
  });

  // Get other active panes in the layout tree (excluding the current file explorer)
  const otherNodes = (panesRegistry || []).filter(p => p.id !== paneId);

  return (
    <div 
      className="h-full flex flex-col bg-slate-900 text-slate-100 overflow-hidden relative"
    >
      {/* Sleek Action Toolbar */}
      <div className="px-3 py-2 border-b border-slate-800/60 flex items-center justify-between bg-slate-900/60">
        <div className="flex items-center gap-1">
          <button 
            onClick={handleGoBack}
            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition"
            title="Go Up"
          >
            <ArrowLeft size={14} />
          </button>
          <span className="text-xs font-semibold text-slate-300 ml-1">File Explorer</span>
        </div>
        
        <div className="flex items-center gap-1">
          <button 
            onClick={() => { setActionType("create-file"); setInputText(""); }}
            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition"
            title="New File"
          >
            <Plus size={14} />
          </button>
          <button 
            onClick={() => { setActionType("create-dir"); setInputText(""); }}
            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition"
            title="New Folder"
          >
            <FolderPlus size={14} />
          </button>
          <button 
            onClick={() => fetchDirectory(listing?.absoluteCurrentPath || currentPath, true)}
            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition"
            title="Refresh"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
          {clipboard && (
            <button 
              onClick={handlePaste}
              className="p-1 hover:bg-slate-800 rounded text-emerald-400 hover:text-emerald-300 transition animate-pulse flex items-center gap-1 text-[10px]"
              title={`Paste ${clipboard.item.name} into current directory`}
            >
              <Clipboard size={14} />
              <span className="hidden md:inline font-semibold">Paste</span>
            </button>
          )}
        </div>
      </div>

      {/* Interactive Path Address Bar */}
      <div className="px-2.5 py-2 border-b border-slate-800/60 bg-slate-950/40">
        <form onSubmit={handleAddressSubmit} className="flex items-center gap-1.5 w-full">
          <div className="flex items-center text-slate-500 pl-1">
            <FolderOpen size={13} className="text-blue-400" />
          </div>
          {isEditingAddress ? (
            <input
              ref={addressInputRef}
              type="text"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              onBlur={() => setTimeout(() => setIsEditingAddress(false), 200)}
              className="flex-1 bg-slate-950 text-slate-200 text-xs rounded px-2 py-1 border border-blue-500 outline-none font-mono"
            />
          ) : (
            <div 
              onClick={startEditingAddress}
              className="flex-1 bg-slate-950 text-slate-400 text-xs rounded px-2 py-1 border border-slate-850 hover:border-slate-800 cursor-text font-mono truncate select-none"
              title="Click to edit path address"
            >
              {listing?.absoluteCurrentPath || "Loading directory..."}
            </div>
          )}
          <button
            type="submit"
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 hover:text-white rounded text-[10px] font-mono text-slate-400 transition"
          >
            GO
          </button>
        </form>
      </div>

      {/* Search Filter */}
      <div className="p-2 border-b border-slate-800/60 bg-slate-900/30 flex items-center gap-2">
        <div className="relative w-full">
          <Search size={13} className="absolute left-2.5 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search items in folder..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 text-slate-200 text-xs rounded pl-8 pr-3 py-1.5 border border-slate-850 focus:outline-none focus:border-blue-500 placeholder-slate-500 font-sans"
          />
        </div>
      </div>

      {/* File Action Input Drawer */}
      {actionType && (
        <div className="p-2 bg-slate-850 border-b border-slate-800 animate-fadeIn">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            {actionType === "create-file" ? "Create New File" : actionType === "create-dir" ? "Create New Folder" : `Rename: ${selectedItem?.name}`}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              autoFocus
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={actionType === "rename" ? "New name..." : "Name..."}
              className="flex-1 bg-slate-950 text-slate-200 text-xs rounded px-2 py-1 border border-slate-700 focus:outline-none focus:border-blue-500"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  actionType === "rename" ? handleRename() : handleCreate();
                } else if (e.key === "Escape") {
                  setActionType(null);
                }
              }}
            />
            <button 
              onClick={actionType === "rename" ? handleRename : handleCreate}
              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold transition"
            >
              OK
            </button>
            <button 
              onClick={() => setActionType(null)}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-750 text-slate-400 rounded text-xs transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Directory items list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5" onContextMenu={(e) => e.preventDefault()}>
        {error && (
          <div className="p-2 bg-red-950/40 text-red-400 text-xs rounded border border-red-900/50 mb-2 font-sans">
            {error}
          </div>
        )}

        {loading && !listing ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs py-12 text-center font-sans">
            <RefreshCw size={20} className="text-blue-400 animate-spin mb-2" />
            <p>Loading directory...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs py-12 text-center font-sans">
            <p>No items found</p>
            <p className="text-[10px] opacity-70 mt-1">Use the toolbar to create items</p>
          </div>
        ) : (
          filteredItems.map((item) => {
            const isSelected = selectedItem?.absolutePath === item.absolutePath;
            return (
              <div
                key={item.absolutePath}
                onClick={(e) => {
                  e.stopPropagation();
                  handleItemClick(item);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleItemDoubleClick(item);
                }}
                onContextMenu={(e) => handleContextMenu(e, item)}
                onTouchStart={(e) => handleTouchStart(e, item)}
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchMove}
                className={`group flex items-center justify-between p-1.5 rounded cursor-pointer select-none transition text-xs ${
                  isSelected ? "bg-blue-600/30 text-blue-100 font-medium" : "hover:bg-slate-800/60 text-slate-300"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {item.isDirectory ? (
                    <Folder size={14} className="text-amber-400 fill-amber-400/10 flex-shrink-0" />
                  ) : (
                    <File size={14} className="text-slate-400 flex-shrink-0" />
                  )}
                  <span className="truncate">{item.name}</span>
                </div>
                
                <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                  <span className="text-[9px] text-slate-500 font-mono hidden sm:inline">
                    {formatSize(item.size)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedItem(item);
                      setActionType("rename");
                      setInputText(item.name);
                    }}
                    className="p-0.5 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded transition"
                    title="Rename"
                  >
                    <Edit3 size={11} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(item);
                    }}
                    className="p-0.5 hover:bg-slate-700 text-slate-400 hover:text-rose-400 rounded transition"
                    title="Delete"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Right-click Context Menu */}
      {contextMenu && (
        <div 
          className="fixed bg-slate-900 border border-slate-800 rounded-lg shadow-2xl py-1 z-50 min-w-[170px] font-sans text-xs animate-fadeIn divide-y divide-slate-800/45"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Section 1: Info / Header */}
          <div className="px-3 py-1 text-[9px] uppercase font-bold text-slate-500 max-w-[180px] truncate pb-1.5">
            {contextMenu.item.name}
          </div>

          {/* Section 2: Core Actions */}
          <div className="py-1">
            {contextMenu.item.isDirectory ? (
              <button
                onClick={() => {
                  handleNavigate(contextMenu.item.absolutePath);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white transition flex items-center gap-2"
              >
                <Folder size={12} className="text-amber-400" />
                <span>Enter Folder</span>
              </button>
            ) : (
              <>
                <button
                  onClick={() => {
                    emitEvent("open-file", { 
                      path: contextMenu.item.absolutePath, 
                      absolutePath: contextMenu.item.absolutePath, 
                      name: contextMenu.item.name 
                    });
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white transition flex items-center gap-2"
                >
                  <File size={12} className="text-blue-400" />
                  <span>Open File</span>
                </button>
                 <button
                  onClick={() => {
                    const editorPane = otherNodes.find(p => p.pluginType === "editor") || otherNodes[0];
                    const targetToSplit = editorPane ? editorPane.id : paneId;
                    splitPane(targetToSplit, "horizontal", "editor", { filePath: contextMenu.item.absolutePath });
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white transition flex items-center gap-2"
                >
                  <Plus size={12} className="text-emerald-400" />
                  <span>Open in New Node</span>
                </button>
                <div className="relative group/sub">
                  <button
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white transition flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <Layers size={12} className="text-blue-400" />
                      <span>Open in Node...</span>
                    </div>
                    <span className="text-[9px] opacity-60">▶</span>
                  </button>
                  {/* Hover Submenu */}
                  <div className={`absolute top-0 bg-slate-900 border border-slate-800 rounded-lg shadow-2xl py-1 hidden group-hover/sub:block min-w-[180px] z-50 divide-y divide-slate-800/40 ${
                    contextMenu.x + 355 > window.innerWidth ? "right-full mr-1" : "left-full ml-1"
                  }`}>
                    {otherNodes.length === 0 ? (
                      <div className="px-3 py-1.5 text-[10px] text-slate-500 italic">No other active nodes</div>
                    ) : (
                      otherNodes.map((p) => {
                        let displayName = "Pane";
                        if (p.pluginType === "editor") {
                          const file = p.state?.filePath ? p.state.filePath.split('/').pop() : "Empty";
                          displayName = `Editor (${file})`;
                        } else if (p.pluginType === "file-explorer") {
                          const folder = p.state?.currentPath ? p.state.currentPath.split('/').pop() || "." : ".";
                          displayName = `Explorer (${folder})`;
                        } else if (p.pluginType === "terminal") {
                          const folder = p.state?.terminalCwd ? p.state.terminalCwd.split('/').pop() || "Home" : "Home";
                          displayName = `Terminal (${folder})`;
                        } else if (p.pluginType === "settings") {
                          displayName = "Settings";
                        }
                        return (
                          <button
                            key={p.id}
                            onClick={() => {
                              emitEvent("open-file", {
                                path: contextMenu.item.absolutePath,
                                targetPaneId: p.id
                              });
                              setContextMenu(null);
                            }}
                            className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white transition truncate text-[11px]"
                          >
                            {displayName}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
                <button
                  onClick={async () => {
                    const path = contextMenu.item.absolutePath;
                    setContextMenu(null);
                    try {
                      const res = await fetch("/api/files/open-external", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ path }),
                      });
                      if (!res.ok) {
                        const data = await res.json();
                        alert(data.error || "Failed to open with default program");
                      }
                    } catch (err: any) {
                      alert(`Error: ${err.message}`);
                    }
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white transition flex items-center gap-2"
                >
                  <ExternalLink size={12} className="text-indigo-400" />
                  <span>Open with Default App</span>
                </button>
                <button
                  onClick={() => {
                    const path = contextMenu.item.absolutePath;
                    setContextMenu(null);
                    const app = prompt("Enter command to open this file with (e.g. nano, vlc, code, cat, gcc):");
                    if (app) {
                      fetch("/api/files/open-external", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ path, app }),
                      }).then(async (res) => {
                        if (!res.ok) {
                          const data = await res.json();
                          alert(data.error || "Failed to open file with that command");
                        }
                      }).catch((err) => {
                        alert(`Error: ${err.message}`);
                      });
                    }
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white transition flex items-center gap-2"
                >
                  <Terminal size={12} className="text-orange-400" />
                  <span>Open with...</span>
                </button>
              </>
            )}

            {!contextMenu.item.isDirectory && (
              <button
                onClick={() => {
                  handleDownloadFile(contextMenu.item);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white transition flex items-center gap-2"
              >
                <FileDown size={12} className="text-emerald-400" />
                <span>Download File</span>
              </button>
            )}

            <button
              onClick={() => {
                handleOpenInTerminal(contextMenu.item);
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white transition flex items-center gap-2"
              title="Change active terminal directory here"
            >
              <Terminal size={12} className="text-purple-400" />
              <span>Open in Terminal</span>
            </button>
          </div>

          {/* Section 3: Clipboard & Duplication */}
          <div className="py-1">
            <button
              onClick={() => {
                handleCopyPath(contextMenu.item);
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white transition flex items-center gap-2"
            >
              <ExternalLink size={12} className="text-cyan-400" />
              <span>Copy Full Path</span>
            </button>

            <button
              onClick={() => {
                handleDuplicate(contextMenu.item);
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white transition flex items-center gap-2"
            >
              <Copy size={12} className="text-amber-500" />
              <span>Duplicate</span>
            </button>

            <button
              onClick={() => {
                setClipboard({ action: "copy", item: contextMenu.item });
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white transition flex items-center gap-2"
            >
              <Copy size={12} className="text-blue-400" />
              <span>Copy</span>
            </button>

            <button
              onClick={() => {
                setClipboard({ action: "cut", item: contextMenu.item });
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white transition flex items-center gap-2"
            >
              <Scissors size={12} className="text-indigo-400" />
              <span>Cut</span>
            </button>

            <button
              onClick={() => {
                handlePaste();
                setContextMenu(null);
              }}
              disabled={!clipboard}
              className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent transition flex items-center gap-2"
            >
              <Clipboard size={12} className="text-emerald-400" />
              <span>Paste {clipboard ? `(${clipboard.item.name})` : ""}</span>
            </button>
          </div>

          {/* Section 4: Mutations */}
          <div className="py-1">
            <button
              onClick={() => {
                setSelectedItem(contextMenu.item);
                setActionType("rename");
                setInputText(contextMenu.item.name);
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white transition flex items-center gap-2"
            >
              <Edit3 size={12} className="text-blue-400" />
              <span>Rename</span>
            </button>

            <button
              onClick={() => {
                handleDelete(contextMenu.item);
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-rose-400 transition flex items-center gap-2"
            >
              <Trash2 size={12} className="text-rose-400" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
