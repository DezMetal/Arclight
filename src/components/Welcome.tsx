import { useWorkspace } from "../context/WorkspaceContext";

/**
 * First-run panel.
 *
 * Shown once, then never again — the flag lives in the workspace file, so it
 * survives restarts but resets if that file is deleted. Arclight's two least
 * discoverable ideas are frame targeting and the dnet suite, so those get the
 * space.
 */
export const Welcome: React.FC = () => {
  const { seenWelcome, dismissWelcome } = useWorkspace();

  if (seenWelcome) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center dss-grid-bg"
      style={{ zIndex: 1000, backgroundColor: "var(--dss-bg)" }}
    >
      <div
        className="dss-cut p-6 flex flex-col gap-4"
        style={{
          maxWidth: 520,
          backgroundColor: "var(--dss-surface-solid)",
          boxShadow: "0 0 0 1px var(--dss-rule)",
        }}
      >
        <div className="flex flex-col gap-1">
          <span
            className="dss-label"
            style={{ color: "var(--dss-accent)", fontSize: 12, letterSpacing: "0.14em" }}
          >
            Arclight
          </span>
          <span className="text-[11px]" style={{ color: "var(--dss-ink-faint)" }}>
            An explorer, editor and terminal in one window. From D-Net Lab.
          </span>
        </div>

        <div className="flex flex-col gap-3 text-[12px]" style={{ color: "var(--dss-ink-soft)" }}>
          <div>
            <div style={{ color: "var(--dss-ink)" }}>Frames</div>
            <p className="text-[11px] leading-relaxed">
              Every work area is a frame and can hold any tool. Split from the frame
              header, or drag one header onto another to swap them. Click a header to
              make that frame the <em>target</em> — files you open then land there.
            </p>
          </div>

          <div>
            <div style={{ color: "var(--dss-ink)" }}>Commands</div>
            <p className="text-[11px] leading-relaxed">
              Type <code style={{ color: "var(--dss-accent)" }}>dnet help</code> in any
              terminal to drive the workspace from the keyboard — open files, split
              frames, switch themes.
            </p>
          </div>

          <div>
            <div style={{ color: "var(--dss-ink)" }}>Control API</div>
            <p className="text-[11px] leading-relaxed">
              Settings can expose a local HTTP API so your own systems read and drive
              the workspace. Off by default, loopback only, token required.
            </p>
          </div>

          <div>
            <div style={{ color: "var(--dss-ink)" }}>Closing</div>
            <p className="text-[11px] leading-relaxed">
              The close button hides Arclight to the system tray so your shells keep
              running. Quit properly from the tray icon's menu.
            </p>
          </div>
        </div>

        <button className="dss-button" onClick={dismissWelcome}>
          Start
        </button>
      </div>
    </div>
  );
};
