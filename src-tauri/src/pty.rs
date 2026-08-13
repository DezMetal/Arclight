//! Real PTY sessions.
//!
//! On Windows this drives ConPTY through `portable-pty`, which is what makes
//! tab completion, cursor keys, readline, and every interactive program
//! (Python REPL, ssh, vim, git commit, progress bars, password prompts) work.
//! The previous implementation emulated a line editor in the server process
//! and could do none of that.
//!
//! Sessions are owned here, in the backend, not by the frontend. A pane can
//! unmount, the webview can hot-reload, the layout can be rearranged: the
//! shell keeps running and its output keeps accumulating in scrollback. When
//! a pane reattaches it is sent the scrollback first, so the terminal looks
//! exactly as it did before.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, State};

/// Per-session scrollback cap. Bounded so a runaway process cannot exhaust
/// memory — the old polling backend kept an unbounded Vec and leaked.
const SCROLLBACK_LIMIT: usize = 2 * 1024 * 1024;

/// Read chunk size. Large enough that heavy output (build logs, `cat` of a big
/// file) does not thrash the IPC boundary.
const READ_CHUNK: usize = 16 * 1024;

type DataSink = Arc<Mutex<Option<Channel<InvokeResponseBody>>>>;

pub struct PtySession {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    scrollback: Arc<Mutex<Vec<u8>>>,
    sink: DataSink,
    /// Identifies the current attachment.
    ///
    /// A frame that remounts calls detach and spawn from two separate async
    /// invokes, and they are not ordered. Without this, a stale detach could
    /// land after the new spawn had already attached and silently clear the
    /// sink -- leaving a live shell drawing into nothing, which is exactly
    /// what "the terminal breaks after splitting" looked like.
    attachment: Arc<AtomicU64>,
    alive: Arc<AtomicBool>,
    shell: String,
    cwd: Arc<Mutex<String>>,
}

type Sessions = Arc<Mutex<HashMap<String, Arc<PtySession>>>>;

#[derive(Default)]
pub struct PtyRegistry {
    /// Shared with each reader thread so a session can remove itself.
    sessions: Sessions,
    /// Source of attachment tokens, unique across every session.
    next_attachment: AtomicU64,
}

#[derive(Serialize)]
pub struct SessionInfo {
    pub id: String,
    pub alive: bool,
    pub shell: String,
    pub cwd: String,
    /// Pass back to `pty_detach` so only the current attachment is released.
    pub attachment: u64,
}

#[derive(Serialize, Clone)]
struct CwdEvent {
    id: String,
    cwd: String,
}

#[derive(Serialize, Clone)]
struct ExitEvent {
    id: String,
}

#[derive(Serialize)]
pub struct ShellOption {
    pub id: String,
    pub label: String,
    pub path: String,
}

#[derive(Deserialize)]
pub struct SpawnOptions {
    pub id: String,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    /// Shell id from `pty_available_shells`; defaults to cmd on Windows.
    pub shell: Option<String>,
}

/// Resolve a shell id to an executable path.
fn resolve_shell(id: Option<&str>) -> (String, String) {
    #[cfg(windows)]
    {
        let id = id.unwrap_or("cmd");
        match id {
            "powershell" => (
                "powershell".into(),
                "powershell.exe".into(),
            ),
            "pwsh" => ("pwsh".into(), "pwsh.exe".into()),
            "bash" => ("bash".into(), "bash.exe".into()),
            // cmd is the D-Net Lab default.
            _ => ("cmd".into(), "cmd.exe".into()),
        }
    }
    #[cfg(not(windows))]
    {
        let id = id.unwrap_or("bash");
        match id {
            "zsh" => ("zsh".into(), "/bin/zsh".into()),
            "fish" => ("fish".into(), "/usr/bin/fish".into()),
            "sh" => ("sh".into(), "/bin/sh".into()),
            _ => ("bash".into(), "/bin/bash".into()),
        }
    }
}

#[tauri::command]
pub fn pty_available_shells() -> Vec<ShellOption> {
    #[cfg(windows)]
    {
        let mut out = vec![ShellOption {
            id: "cmd".into(),
            label: "Command Prompt".into(),
            path: "cmd.exe".into(),
        }];
        for (id, label, exe) in [
            ("powershell", "Windows PowerShell", "powershell.exe"),
            ("pwsh", "PowerShell 7", "pwsh.exe"),
            ("bash", "Git Bash", "bash.exe"),
        ] {
            if which_exists(exe) {
                out.push(ShellOption {
                    id: id.into(),
                    label: label.into(),
                    path: exe.into(),
                });
            }
        }
        out
    }
    #[cfg(not(windows))]
    {
        let mut out = Vec::new();
        for (id, label, path) in [
            ("bash", "Bash", "/bin/bash"),
            ("zsh", "Zsh", "/bin/zsh"),
            ("fish", "Fish", "/usr/bin/fish"),
            ("sh", "sh", "/bin/sh"),
        ] {
            if std::path::Path::new(path).exists() {
                out.push(ShellOption {
                    id: id.into(),
                    label: label.into(),
                    path: path.into(),
                });
            }
        }
        out
    }
}

#[cfg(windows)]
fn which_exists(exe: &str) -> bool {
    std::env::var_os("PATH")
        .map(|paths| {
            std::env::split_paths(&paths).any(|dir| dir.join(exe).is_file())
        })
        .unwrap_or(false)
}

/// Spawn a session, or reattach to an existing one.
///
/// Reattaching replays scrollback into the new channel so a remounted pane
/// looks identical to the one that went away.
#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    registry: State<'_, PtyRegistry>,
    options: SpawnOptions,
    on_data: Channel<InvokeResponseBody>,
) -> Result<SessionInfo, String> {
    let SpawnOptions {
        id,
        cwd,
        cols,
        rows,
        shell,
    } = options;

    // Reattach path: session already exists and has not exited.
    //
    // The registry lock is released before touching the session, because the
    // reader thread can be inside `sink.send` at this moment. Holding
    // `sessions` while waiting on `sink` meant one blocked send froze every
    // other PTY command -- which is why opening a second terminal, or
    // switching a frame's tool, appeared to kill the first terminal.
    let existing = registry.sessions.lock().get(&id).cloned();

    if let Some(session) = existing {
        if session.alive.load(Ordering::SeqCst) {
            let token = registry.next_attachment.fetch_add(1, Ordering::SeqCst) + 1;

            let backlog = session.scrollback.lock().clone();
            if !backlog.is_empty() {
                let _ = on_data.send(InvokeResponseBody::Raw(backlog));
            }
            // Claim the attachment before installing the sink, so any detach
            // still in flight for the previous attachment is a no-op.
            session.attachment.store(token, Ordering::SeqCst);
            *session.sink.lock() = Some(on_data);

            let _ = session.master.lock().resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            });
            return Ok(SessionInfo {
                id: id.clone(),
                alive: true,
                shell: session.shell.clone(),
                cwd: session.cwd.lock().clone(),
                attachment: token,
            });
        }
    }

    let (shell_id, shell_path) = resolve_shell(shell.as_deref());

    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {e}"))?;

    let mut cmd = CommandBuilder::new(&shell_path);

    let start_dir = cwd
        .filter(|c| !c.is_empty() && std::path::Path::new(c).is_dir())
        .or_else(|| dirs_home().map(|p| p.to_string_lossy().to_string()));
    if let Some(dir) = &start_dir {
        cmd.cwd(dir);
    }

    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    // Shell integration for working-directory reporting.
    //
    // cmd.exe has no OSC 7 support, but it does expand $e (ESC) inside PROMPT,
    // and Windows defines OSC 9;9 as "report cwd". Setting PROMPT through the
    // environment rather than by typing a command keeps the first line clean.
    #[cfg(windows)]
    {
        if shell_id == "cmd" {
            cmd.env("PROMPT", "$e]9;9;$P$e\\$P$G");
        }
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to launch {shell_path}: {e}"))?;

    let killer = child.clone_killer();
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer failed: {e}"))?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("try_clone_reader failed: {e}"))?;

    let token = registry.next_attachment.fetch_add(1, Ordering::SeqCst) + 1;

    let scrollback = Arc::new(Mutex::new(Vec::<u8>::new()));
    let sink: DataSink = Arc::new(Mutex::new(Some(on_data)));
    let alive = Arc::new(AtomicBool::new(true));
    let attachment = Arc::new(AtomicU64::new(token));
    let session_cwd = Arc::new(Mutex::new(
        start_dir.clone().unwrap_or_else(|| ".".to_string()),
    ));

    let session = Arc::new(PtySession {
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
        killer: Mutex::new(killer),
        scrollback: scrollback.clone(),
        sink: sink.clone(),
        attachment,
        alive: alive.clone(),
        shell: shell_id.clone(),
        cwd: session_cwd.clone(),
    });

    registry.sessions.lock().insert(id.clone(), session.clone());

    // Reader thread. Owns the session's output for as long as the shell lives,
    // independent of whether any frame is currently attached.
    //
    // It also owns *removal*. Dropping the session closes the PTY, and this
    // thread is blocked reading that handle, so removing the session from the
    // registry anywhere else frees the handle out from under a live read --
    // which crashed the app on terminal restart. Only this thread knows when
    // reading has actually finished.
    {
        let id = id.clone();
        let app = app.clone();
        let sessions = registry.sessions.clone();
        // Moved into the thread so the session — and therefore the PTY handle
        // this thread is reading — cannot be dropped by a replacement being
        // inserted under the same id. There is no reference cycle: the session
        // does not hold the thread.
        let owned = session.clone();
        std::thread::spawn(move || {
            let mut buf = vec![0u8; READ_CHUNK];
            let mut osc_pending = Vec::<u8>::new();

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = &buf[..n];

                        {
                            let mut sb = scrollback.lock();
                            sb.extend_from_slice(chunk);
                            if sb.len() > SCROLLBACK_LIMIT {
                                let excess = sb.len() - SCROLLBACK_LIMIT;
                                sb.drain(..excess);
                            }
                        }

                        if let Some(new_cwd) = scan_for_cwd(&mut osc_pending, chunk) {
                            let changed = {
                                let mut current = session_cwd.lock();
                                if *current != new_cwd {
                                    *current = new_cwd.clone();
                                    true
                                } else {
                                    false
                                }
                            };
                            if changed {
                                let _ = app.emit(
                                    "pty:cwd",
                                    CwdEvent {
                                        id: id.clone(),
                                        cwd: new_cwd,
                                    },
                                );
                            }
                        }

                        // Clone the channel out before sending. Sending while
                        // holding the lock lets a slow IPC write block every
                        // command that needs this session.
                        let target = sink.lock().clone();
                        if let Some(channel) = target {
                            let _ = channel.send(InvokeResponseBody::Raw(chunk.to_vec()));
                        }
                    }
                    Err(_) => break,
                }
            }

            alive.store(false, Ordering::SeqCst);

            // Safe now: reading has stopped, so releasing the PTY handle cannot
            // pull the ground out from under a read. Only evict our own entry —
            // a restart may already have installed a replacement under this id.
            {
                let mut map = sessions.lock();
                let ours = map.get(&id).map(|s| Arc::ptr_eq(s, &owned)).unwrap_or(false);
                if ours {
                    map.remove(&id);
                }
            }
            drop(owned);

            let _ = app.emit("pty:exit", ExitEvent { id: id.clone() });
        });
    }

    Ok(SessionInfo {
        id,
        alive: true,
        shell: shell_id,
        cwd: start_dir.unwrap_or_else(|| ".".into()),
        attachment: token,
    })
}

/// Extract a working directory from an OSC 7 (`file://host/path`) or
/// OSC 9;9 (`<path>`) sequence.
///
/// `pending` carries bytes across read boundaries so a sequence split between
/// two chunks is still recognised — the old stdout-sentinel scanner had exactly
/// this bug and would miss or corrupt split markers.
fn scan_for_cwd(pending: &mut Vec<u8>, chunk: &[u8]) -> Option<String> {
    pending.extend_from_slice(chunk);

    // Never let a malformed stream grow the buffer without bound.
    if pending.len() > 8192 {
        let cut = pending.len() - 4096;
        pending.drain(..cut);
    }

    let mut found = None;

    loop {
        let start = match find_subslice(pending, b"\x1b]") {
            Some(i) => i,
            None => {
                pending.clear();
                break;
            }
        };

        // Terminator is either BEL or ESC backslash (ST).
        let rest = &pending[start..];
        let end_rel = rest
            .iter()
            .position(|&b| b == 0x07)
            .or_else(|| find_subslice(rest, b"\x1b\\"));

        let end_rel = match end_rel {
            Some(e) => e,
            None => {
                // Incomplete sequence: keep it for the next chunk.
                if start > 0 {
                    pending.drain(..start);
                }
                break;
            }
        };

        let body = &rest[2..end_rel];
        if let Ok(text) = std::str::from_utf8(body) {
            if let Some(path) = text.strip_prefix("9;9;") {
                found = Some(normalise_cwd(path));
            } else if let Some(rest) = text.strip_prefix("7;") {
                if let Some(p) = rest.strip_prefix("file://") {
                    // After the hostname the path begins *at* the next slash,
                    // not after it — dropping it turned /home/dev into home/dev.
                    let path = match p.find('/') {
                        Some(i) => &p[i..],
                        None => p,
                    };
                    found = Some(normalise_cwd(&percent_decode(path)));
                }
            }
        }

        let consumed = start + end_rel + 1;
        if consumed >= pending.len() {
            pending.clear();
            break;
        }
        pending.drain(..consumed);
    }

    found
}

fn normalise_cwd(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches(['\\', '/']);
    if trimmed.is_empty() {
        raw.trim().to_string()
    } else {
        trimmed.to_string()
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn dirs_home() -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(std::path::PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(std::path::PathBuf::from)
    }
}

#[tauri::command]
pub fn pty_write(registry: State<'_, PtyRegistry>, id: String, data: String) -> Result<(), String> {
    let session = {
        let sessions = registry.sessions.lock();
        sessions.get(&id).cloned()
    }
    .ok_or_else(|| format!("no session '{id}'"))?;

    if !session.alive.load(Ordering::SeqCst) {
        return Err(format!("session '{id}' has exited"));
    }

    let mut writer = session.writer.lock();
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("write failed: {e}"))?;
    writer.flush().map_err(|e| format!("flush failed: {e}"))
}

#[tauri::command]
pub fn pty_resize(
    registry: State<'_, PtyRegistry>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let session = {
        let sessions = registry.sessions.lock();
        sessions.get(&id).cloned()
    }
    .ok_or_else(|| format!("no session '{id}'"))?;

    let result = session.master.lock().resize(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    });
    result.map_err(|e| format!("resize failed: {e}"))
}

/// Detach a frame without killing the shell.
///
/// Called on unmount. The session keeps running and keeps filling scrollback;
/// the next `pty_spawn` with the same id reattaches.
///
/// `attachment` is the token that `pty_spawn` returned. A frame that remounts
/// issues detach and spawn as two independent async calls with no ordering
/// guarantee, so a detach can arrive *after* the replacement has attached.
/// Releasing only a matching token makes that late detach a no-op instead of
/// silently blanking a working terminal.
#[tauri::command]
pub fn pty_detach(registry: State<'_, PtyRegistry>, id: String, attachment: Option<u64>) {
    let session = registry.sessions.lock().get(&id).cloned();
    let Some(session) = session else { return };

    if let Some(token) = attachment {
        if session.attachment.load(Ordering::SeqCst) != token {
            return; // superseded by a newer attachment
        }
    }
    *session.sink.lock() = None;
}

/// Kill the shell.
///
/// Deliberately does *not* remove the session from the registry: the reader
/// thread is blocked on the PTY handle, and dropping the session here would
/// free that handle mid-read. The reader removes itself once reading stops.
#[tauri::command]
pub fn pty_kill(registry: State<'_, PtyRegistry>, id: String) -> Result<(), String> {
    let session = registry.sessions.lock().get(&id).cloned();
    match session {
        Some(session) => {
            *session.sink.lock() = None;
            session.alive.store(false, Ordering::SeqCst);
            let result = session.killer.lock().kill();
            result.map_err(|e| format!("kill failed: {e}"))
        }
        None => Ok(()),
    }
}

#[tauri::command]
pub fn pty_list(registry: State<'_, PtyRegistry>) -> Vec<SessionInfo> {
    registry
        .sessions
        .lock()
        .iter()
        .map(|(id, s)| SessionInfo {
            id: id.clone(),
            alive: s.alive.load(Ordering::SeqCst),
            shell: s.shell.clone(),
            cwd: s.cwd.lock().clone(),
            attachment: s.attachment.load(Ordering::SeqCst),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_osc_9_9_cwd() {
        let mut pending = Vec::new();
        let got = scan_for_cwd(&mut pending, b"\x1b]9;9;C:\\Users\\dev\x1b\\C:\\Users\\dev>");
        assert_eq!(got.as_deref(), Some("C:\\Users\\dev"));
    }

    #[test]
    fn reads_osc_7_file_url() {
        let mut pending = Vec::new();
        let got = scan_for_cwd(&mut pending, b"\x1b]7;file://host/home/dev\x07");
        assert_eq!(got.as_deref(), Some("/home/dev"));
    }

    #[test]
    fn survives_a_sequence_split_across_chunks() {
        let mut pending = Vec::new();
        assert_eq!(scan_for_cwd(&mut pending, b"\x1b]9;9;C:\\Us"), None);
        let got = scan_for_cwd(&mut pending, b"ers\\dev\x1b\\");
        assert_eq!(got.as_deref(), Some("C:\\Users\\dev"));
    }

    #[test]
    fn ignores_ordinary_output() {
        let mut pending = Vec::new();
        assert_eq!(scan_for_cwd(&mut pending, b"just some build output\n"), None);
        assert!(pending.is_empty());
    }

    #[test]
    fn percent_decodes_osc_7_paths() {
        let mut pending = Vec::new();
        let got = scan_for_cwd(&mut pending, b"\x1b]7;file://h/home/my%20dir\x07");
        assert_eq!(got.as_deref(), Some("/home/my dir"));
    }

    #[test]
    fn pending_buffer_stays_bounded() {
        let mut pending = Vec::new();
        let noise = vec![b'x'; 4096];
        for _ in 0..10 {
            scan_for_cwd(&mut pending, &noise);
        }
        assert!(pending.len() <= 8192);
    }
}
