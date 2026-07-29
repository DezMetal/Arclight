import React, { useEffect, useState } from "react";
import { useWorkspace, THEMES } from "../context/WorkspaceContext";
import { systemInfo, type SystemInfo } from "../lib/api";

export const SettingsPane: React.FC<{
  paneId: string;
  state: Record<string, unknown>;
  updateState: (state: Record<string, unknown>) => void;
}> = ({ paneId }) => {
  const { settings, updateSettings, setActivePaneId, resetLayout } = useWorkspace();
  const [info, setInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    systemInfo().then(setInfo).catch(() => setInfo(null));
  }, []);

  return (
    <div
      onMouseDown={() => setActivePaneId(paneId)}
      className="h-full flex flex-col overflow-y-auto"
      style={{ backgroundColor: "var(--dss-bg-panel)" }}
    >
      <header
        className="dss-chrome px-2 py-1 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--dss-border-soft)" }}
      >
        <span className="dss-label">Settings</span>
      </header>

      <div className="p-3 flex flex-col gap-4">
        {/* Theme */}
        <section className="flex flex-col gap-1.5">
          <span className="dss-label">Theme</span>
          <div className="flex flex-col gap-1">
            {THEMES.map((theme) => {
              const active = settings.theme === theme.id;
              return (
                <button
                  key={theme.id}
                  className="dss-cut-sm text-left px-2 py-1.5"
                  style={{
                    background: active ? "var(--dss-bg-surface)" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    boxShadow: active
                      ? "0 0 0 1px var(--dss-accent)"
                      : "0 0 0 1px var(--dss-border-soft)",
                  }}
                  onClick={() => updateSettings({ theme: theme.id })}
                >
                  <div
                    className="text-[12px]"
                    style={{ color: active ? "var(--dss-accent)" : "var(--dss-text)" }}
                  >
                    {theme.label}
                  </div>
                  <div className="text-[10px]" style={{ color: "var(--dss-text-faint)" }}>
                    {theme.description}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Typography */}
        <section className="flex flex-col gap-1.5">
          <span className="dss-label">Font size — {settings.fontSize}px</span>
          <input
            type="range"
            min={9}
            max={24}
            value={settings.fontSize}
            onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })}
            style={{ accentColor: "var(--dss-accent)" }}
          />
        </section>

        <section className="flex flex-col gap-1.5">
          <span className="dss-label">Tab size</span>
          <select
            className="dss-input"
            value={settings.tabSize}
            onChange={(e) => updateSettings({ tabSize: Number(e.target.value) })}
          >
            {[2, 4, 8].map((n) => (
              <option key={n} value={n}>
                {n} spaces
              </option>
            ))}
          </select>
        </section>

        {/* Toggles */}
        <section className="flex flex-col gap-2">
          {[
            { key: "autosave" as const, label: "Autosave", hint: "Write changes after a pause" },
            { key: "showHidden" as const, label: "Show hidden files", hint: "Names beginning . or $" },
            { key: "rememberState" as const, label: "Remember layout", hint: "Restore panes on launch" },
          ].map((toggle) => (
            <label
              key={toggle.key}
              className="flex items-start gap-2 cursor-pointer"
              onClick={() => updateSettings({ [toggle.key]: !settings[toggle.key] })}
            >
              <span
                className="mt-[2px] flex-shrink-0"
                style={{
                  width: 14,
                  height: 14,
                  backgroundColor: settings[toggle.key] ? "var(--dss-accent)" : "transparent",
                  boxShadow: `0 0 0 1px ${
                    settings[toggle.key] ? "var(--dss-accent)" : "var(--dss-border-soft)"
                  }`,
                }}
              />
              <span className="flex flex-col">
                <span className="text-[12px]">{toggle.label}</span>
                <span className="text-[10px]" style={{ color: "var(--dss-text-faint)" }}>
                  {toggle.hint}
                </span>
              </span>
            </label>
          ))}
        </section>

        <section className="flex flex-col gap-1.5">
          <span className="dss-label">Layout</span>
          <button className="dss-button dss-button--ghost" onClick={resetLayout}>
            Reset to default
          </button>
        </section>

        {info && (
          <section className="flex flex-col gap-1 pt-2" style={{ borderTop: "1px solid var(--dss-border-soft)" }}>
            <span className="dss-label">System</span>
            <div
              className="text-[10px] flex flex-col gap-0.5 dss-selectable"
              style={{ color: "var(--dss-text-faint)", fontFamily: "var(--dss-font-mono)" }}
            >
              <span>Arclight v{info.app_version}</span>
              <span>
                {info.os}/{info.arch}
              </span>
              <span>
                {info.username ?? "?"}@{info.hostname ?? "?"}
              </span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
