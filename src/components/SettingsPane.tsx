import React from "react";
import { Sliders, Type, RotateCcw, Eye, Cpu, Palette } from "lucide-react";
import { useWorkspace } from "../context/WorkspaceContext";

export const SettingsPane: React.FC<{
  paneId: string;
  state: any;
  updateState: (state: any) => void;
}> = () => {
  const { settings, updateSettings, resetLayout } = useWorkspace();
  const [sysInfo, setSysInfo] = React.useState<{
    platform: string;
    arch: string;
    nodeVersion: string;
    rootDir: string;
  } | null>(null);

  React.useEffect(() => {
    fetch("/api/system/info")
      .then((res) => res.json())
      .then((data) => setSysInfo(data))
      .catch((err) => console.error("Error fetching system info:", err));
  }, []);

  return (
    <div className="h-full flex flex-col bg-slate-900 overflow-hidden font-sans text-slate-300">
      {/* Pane Header */}
      <div className="px-3 py-2 border-b border-slate-800/60 flex items-center justify-between bg-slate-900/60 select-none">
        <div className="flex items-center gap-2">
          <Sliders size={14} className="text-blue-400" />
          <span className="font-semibold text-xs tracking-tight text-slate-200">Settings & Parameters</span>
        </div>
      </div>

      {/* Settings Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        
        {/* Editor Configurations */}
        <div className="bg-slate-950/40 p-3.5 rounded-lg border border-slate-800/80 space-y-3.5">
          <h4 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5 border-b border-slate-800/50 pb-1.5">
            <Type size={13} className="text-blue-400" /> Editor Configurations
          </h4>
          
          <div className="space-y-3">
            {/* Font Size Selector */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Editor Font Size</span>
              <div className="flex bg-slate-900 p-0.5 rounded border border-slate-800">
                {[12, 14, 16, 18].map((size) => (
                  <button
                    key={size}
                    onClick={() => updateSettings({ fontSize: size })}
                    className={`px-2 py-1 rounded text-[10px] font-semibold transition ${
                      settings.fontSize === size
                        ? "bg-blue-600 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {size}px
                  </button>
                ))}
              </div>
            </div>

            {/* Tab Spacing Selector */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Tab Spacing (Spaces)</span>
              <div className="flex bg-slate-900 p-0.5 rounded border border-slate-800">
                {[2, 4, 8].map((size) => (
                  <button
                    key={size}
                    onClick={() => updateSettings({ tabSize: size })}
                    className={`px-2.5 py-1 rounded text-[10px] font-semibold transition ${
                      settings.tabSize === size
                        ? "bg-blue-600 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            {/* Autosave Toggle */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">File Autosave</span>
              <button
                onClick={() => updateSettings({ autosave: !settings.autosave })}
                className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none ${
                  settings.autosave ? "bg-blue-600" : "bg-slate-800"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    settings.autosave ? "translate-x-5.5" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Workspace Appearance / Themes */}
        <div className="bg-slate-950/40 p-3.5 rounded-lg border border-slate-800/80 space-y-3.5 animate-fadeIn">
          <h4 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5 border-b border-slate-800/50 pb-1.5">
            <Palette size={13} className="text-indigo-400" /> Workspace Appearance
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: "slate", name: "Slate", desc: "Classic Dark Slate", preview: "bg-slate-800 border-slate-700 text-slate-100" },
              { id: "obsidian", name: "Obsidian", desc: "Pure Jet Black", preview: "bg-zinc-950 border-zinc-800 text-zinc-100" },
              { id: "cyberpunk", name: "Cyberpunk", desc: "Neon/Retro Tech", preview: "bg-zinc-950 border-cyan-500 text-emerald-400" },
              { id: "light", name: "Alabaster", desc: "Clean Cool Light", preview: "bg-slate-100 border-slate-300 text-slate-900" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => updateSettings({ theme: t.id as any })}
                className={`flex flex-col items-start p-2.5 rounded-lg border text-left transition select-none ${
                  settings.theme === t.id
                    ? "border-blue-500 bg-blue-600/10 text-white"
                    : "border-slate-800 hover:border-slate-750 bg-slate-900/40 text-slate-300 hover:text-white"
                }`}
              >
                <div className="flex items-center gap-1.5 w-full">
                  <span className={`w-3.5 h-3.5 rounded border ${t.preview.split(' ')[0]} ${t.preview.split(' ')[1]}`} />
                  <span className="text-xs font-bold">{t.name}</span>
                </div>
                <span className="text-[10px] text-slate-500 mt-1 leading-tight">{t.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* File Explorer Preference */}
        <div className="bg-slate-950/40 p-3.5 rounded-lg border border-slate-800/80 space-y-3.5">
          <h4 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5 border-b border-slate-800/50 pb-1.5">
            <Eye size={13} className="text-emerald-400" /> File System Preferences
          </h4>
          
          {/* Show Hidden Files */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Show Hidden Files (.*)</span>
            <button
              onClick={() => updateSettings({ showHidden: !settings.showHidden })}
              className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none ${
                settings.showHidden ? "bg-blue-600" : "bg-slate-800"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  settings.showHidden ? "translate-x-5.5" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Workspace Persistence & State */}
        <div className="bg-slate-950/40 p-3.5 rounded-lg border border-slate-800/80 space-y-3.5">
          <h4 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5 border-b border-slate-800/50 pb-1.5">
            <Sliders size={13} className="text-pink-400" /> Session Persistence
          </h4>
          
          {/* Remember Session State */}
          <div className="flex items-center justify-between text-xs">
            <div className="flex flex-col gap-0.5">
              <span className="text-slate-400">Remember Workspace State</span>
              <span className="text-[10px] text-slate-500 leading-tight">Preserves panel positions and active paths across reloads</span>
            </div>
            <button
              onClick={() => updateSettings({ rememberState: !settings.rememberState })}
              className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none ${
                settings.rememberState ? "bg-blue-600" : "bg-slate-800"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  settings.rememberState ? "translate-x-5.5" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Preset & Reset Management */}
        <div className="pt-2 space-y-2 select-none">
          <button
            onClick={resetLayout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-850 hover:bg-slate-800 hover:text-white border border-slate-800 text-xs font-medium rounded transition text-slate-300"
          >
            <RotateCcw size={12} />
            Reset Custom Pane Layout
          </button>
        </div>

        {/* Persistence Note */}
        <div className="text-[10px] text-center text-slate-600 border-t border-slate-800/50 pt-3">
          Parameter settings are persisted across reload cycles automatically.
        </div>
      </div>
    </div>
  );
};
