import React, { useEffect, useState } from "react";
import { useWorkspace, THEMES, PRESETS } from "../context/WorkspaceContext";
import type { ToolProps } from "../types";
import { systemInfo, errorText, type SystemInfo } from "../lib/api";
import { control, type ControlStatus } from "../lib/control";

export const SettingsPane: React.FC<ToolProps> = () => {
  const { settings, updateSettings, resetLayout } = useWorkspace();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [apiStatus, setApiStatus] = useState<ControlStatus | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    systemInfo().then(setInfo).catch(() => setInfo(null));
    control.status().then(setApiStatus).catch(() => setApiStatus(null));
  }, []);

  // Start or stop the server to match the settings. Keeping this in one effect
  // means the running server and the saved preference can never disagree.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setApiError(null);
      try {
        if (settings.apiEnabled) {
          const status = await control.start({
            enabled: true,
            port: settings.apiPort,
            token: settings.apiToken,
            allowRemote: settings.apiAllowRemote,
          });
          if (cancelled) return;
          setApiStatus(status);
          // Persist the generated token so it survives a restart.
          if (status.token && status.token !== settings.apiToken) {
            updateSettings({ apiToken: status.token });
          }
        } else {
          const status = await control.stop();
          if (!cancelled) setApiStatus(status);
        }
      } catch (err) {
        if (!cancelled) setApiError(errorText(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    settings.apiEnabled,
    settings.apiPort,
    settings.apiAllowRemote,
    settings.apiToken,
    updateSettings,
  ]);

  return (
    <div
      className="h-full flex flex-col overflow-y-auto"
      style={{ backgroundColor: "var(--dss-bg-panel)" }}
    >
      <header
        className="dss-chrome px-2 py-1 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--dss-rule-soft)" }}
      >
        <span className="dss-label">Settings</span>
      </header>

      <div className="p-3 flex flex-col gap-4">
        {/* Theme */}
        <section className="flex flex-col gap-1.5">
          <span className="dss-label">Theme</span>
          <div className="flex gap-1">
            {THEMES.map((theme) => {
              const active = settings.theme === theme.id;
              return (
                <button
                  key={theme.id}
                  className="dss-cut-sm text-left px-2 py-1.5 flex-1"
                  style={{
                    background: active ? "var(--dss-bg-surface)" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    boxShadow: active
                      ? "0 0 0 1px var(--dss-accent)"
                      : "0 0 0 1px var(--dss-rule-soft)",
                  }}
                  onClick={() => updateSettings({ theme: theme.id })}
                >
                  <div
                    className="text-[12px]"
                    style={{ color: active ? "var(--dss-accent)" : "var(--dss-ink)" }}
                  >
                    {theme.label}
                  </div>
                  <div className="text-[10px]" style={{ color: "var(--dss-ink-faint)" }}>
                    {theme.description}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Preset */}
        <section className="flex flex-col gap-1.5">
          <span className="dss-label">Preset</span>
          <div className="flex flex-col gap-1">
            {PRESETS.map((preset) => {
              const active = settings.preset === preset.id;
              return (
                <button
                  key={preset.id}
                  className="dss-cut-sm text-left px-2 py-1.5"
                  style={{
                    background: active ? "var(--dss-bg-surface)" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    boxShadow: active
                      ? "0 0 0 1px var(--dss-accent)"
                      : "0 0 0 1px var(--dss-rule-soft)",
                  }}
                  onClick={() => updateSettings({ preset: preset.id })}
                >
                  <div
                    className="text-[12px]"
                    style={{ color: active ? "var(--dss-accent)" : "var(--dss-ink)" }}
                  >
                    {preset.label}
                  </div>
                  <div className="text-[10px]" style={{ color: "var(--dss-ink-faint)" }}>
                    {preset.description}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] leading-relaxed" style={{ color: "var(--dss-ink-faint)" }}>
            Presets come from the shared D-Net Signature Stylesheet. Each works in
            either theme, and moves the whole app at once - chrome, editor syntax
            colours and the terminal palette.
          </p>
        </section>

        {/* Opening files */}
        <section className="flex flex-col gap-1.5">
          <span className="dss-label">When no frame is selected</span>
          <div className="flex flex-col gap-1">
            {(
              [
                {
                  id: "current" as const,
                  label: "Open in current frame",
                  hint: "The file replaces whatever that frame was showing",
                },
                {
                  id: "new" as const,
                  label: "Open in new frame",
                  hint: "Split a new frame off and open there",
                },
              ]
            ).map((option) => {
              const active = settings.defaultOpen === option.id;
              return (
                <button
                  key={option.id}
                  className="dss-cut-sm text-left px-2 py-1.5"
                  style={{
                    background: active ? "var(--dss-bg-surface)" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    boxShadow: active
                      ? "0 0 0 1px var(--dss-accent)"
                      : "0 0 0 1px var(--dss-rule-soft)",
                  }}
                  onClick={() => updateSettings({ defaultOpen: option.id })}
                >
                  <div
                    className="text-[12px]"
                    style={{ color: active ? "var(--dss-accent)" : "var(--dss-text)" }}
                  >
                    {option.label}
                  </div>
                  <div className="text-[10px]" style={{ color: "var(--dss-ink-faint)" }}>
                    {option.hint}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] leading-relaxed" style={{ color: "var(--dss-ink-faint)" }}>
            Selecting a frame — click its header — overrides this. Files then always
            open there until you release it.
          </p>
        </section>

        <section className="flex flex-col gap-1.5">
          <span className="dss-label">New frame direction</span>
          <select
            className="dss-input"
            value={settings.defaultSplit}
            onChange={(e) =>
              updateSettings({ defaultSplit: e.target.value as "horizontal" | "vertical" })
            }
          >
            <option value="vertical">Below</option>
            <option value="horizontal">Beside</option>
          </select>
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
                    settings[toggle.key] ? "var(--dss-accent)" : "var(--dss-rule-soft)"
                  }`,
                }}
              />
              <span className="flex flex-col">
                <span className="text-[12px]">{toggle.label}</span>
                <span className="text-[10px]" style={{ color: "var(--dss-ink-faint)" }}>
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

        {/* Control API */}
        <section
          className="flex flex-col gap-2 pt-3"
          style={{ borderTop: "1px solid var(--dss-rule-soft)" }}
        >
          <span className="dss-label">Control API</span>
          <p className="text-[10px] leading-relaxed" style={{ color: "var(--dss-ink-faint)" }}>
            Lets other systems drive this workspace over HTTP. Off by default —
            Arclight is fully usable with it disabled.
          </p>

          <label
            className="flex items-start gap-2 cursor-pointer"
            onClick={() => updateSettings({ apiEnabled: !settings.apiEnabled })}
          >
            <span
              className="mt-[2px] flex-shrink-0"
              style={{
                width: 14,
                height: 14,
                backgroundColor: settings.apiEnabled ? "var(--dss-accent)" : "transparent",
                boxShadow: `0 0 0 1px ${
                  settings.apiEnabled ? "var(--dss-accent)" : "var(--dss-rule-soft)"
                }`,
              }}
            />
            <span className="flex flex-col">
              <span className="text-[12px]">Enable</span>
              <span className="text-[10px]" style={{ color: "var(--dss-ink-faint)" }}>
                {apiStatus?.running
                  ? `listening on ${apiStatus.address}`
                  : "not listening"}
              </span>
            </span>
          </label>

          {settings.apiEnabled && (
            <>
              <div className="flex flex-col gap-1">
                <span className="dss-label">Port</span>
                <input
                  className="dss-input"
                  type="number"
                  min={1024}
                  max={65535}
                  value={settings.apiPort}
                  onChange={(e) => updateSettings({ apiPort: Number(e.target.value) })}
                />
              </div>

              <div className="flex flex-col gap-1">
                <span className="dss-label">Token</span>
                <div className="flex gap-1">
                  <input
                    className="dss-input dss-selectable"
                    readOnly
                    value={apiStatus?.token ?? settings.apiToken}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    className="dss-button dss-button--ghost"
                    style={{ flexShrink: 0 }}
                    onClick={async () => {
                      const token = await control.rotateToken();
                      updateSettings({ apiToken: token });
                      setApiStatus(await control.status());
                    }}
                  >
                    New
                  </button>
                </div>
                <span className="text-[10px]" style={{ color: "var(--dss-ink-faint)" }}>
                  Send as <code>Authorization: Bearer &lt;token&gt;</code>
                </span>
              </div>

              <label
                className="flex items-start gap-2 cursor-pointer"
                onClick={() => updateSettings({ apiAllowRemote: !settings.apiAllowRemote })}
              >
                <span
                  className="mt-[2px] flex-shrink-0"
                  style={{
                    width: 14,
                    height: 14,
                    backgroundColor: settings.apiAllowRemote
                      ? "var(--dss-destructive)"
                      : "transparent",
                    boxShadow: `0 0 0 1px ${
                      settings.apiAllowRemote
                        ? "var(--dss-destructive)"
                        : "var(--dss-rule-soft)"
                    }`,
                  }}
                />
                <span className="flex flex-col">
                  <span className="text-[12px]">Allow remote clients</span>
                  <span
                    className="text-[10px]"
                    style={{
                      color: settings.apiAllowRemote
                        ? "var(--dss-destructive)"
                        : "var(--dss-ink-faint)",
                    }}
                  >
                    {settings.apiAllowRemote
                      ? "Anyone who can reach this machine and holds the token can edit files and run shell commands."
                      : "Loopback only. Recommended."}
                  </span>
                </span>
              </label>

              {apiError && (
                <div className="text-[10px]" style={{ color: "var(--dss-destructive)" }}>
                  {apiError}
                </div>
              )}
            </>
          )}
        </section>

        {info && (
          <section className="flex flex-col gap-1 pt-2" style={{ borderTop: "1px solid var(--dss-rule-soft)" }}>
            <span className="dss-label">System</span>
            <div
              className="text-[10px] flex flex-col gap-0.5 dss-selectable"
              style={{ color: "var(--dss-ink-faint)", fontFamily: "var(--dss-font-mono)" }}
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
