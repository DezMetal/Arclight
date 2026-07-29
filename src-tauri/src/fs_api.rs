//! Filesystem commands.
//!
//! These replace the Express `/api/files/*` endpoints. Moving them here removes
//! the HTTP surface entirely — the old server bound 0.0.0.0 with no auth and a
//! shell-exec route, which handed full RCE to anyone on the same network.
//! Tauri IPC is in-process, so there is no port and nothing to authenticate.
//!
//! Paths are handled Windows-first: absolute paths with drive letters, UNC
//! shares, and `\\?\` verbatim prefixes stripped on the way out so the UI never
//! shows them.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: Option<u64>,
    pub readonly: bool,
    /// Set when metadata could not be read (locked file, broken link,
    /// permission denied). The entry is still listed rather than dropped.
    pub unreadable: bool,
}

#[derive(Serialize)]
pub struct DirListing {
    pub path: String,
    pub parent: Option<String>,
    pub entries: Vec<FileEntry>,
}

#[derive(Serialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub truncated: bool,
    pub size: u64,
}

#[derive(Serialize)]
pub struct DriveInfo {
    pub path: String,
    pub label: String,
}

/// Largest file we will load into the editor. Beyond this the UI should offer
/// to open externally instead of hanging on a multi-gigabyte file.
const MAX_EDITABLE_BYTES: u64 = 16 * 1024 * 1024;

/// Strip Windows verbatim prefixes so paths shown to the user look normal.
fn display_path(p: &Path) -> String {
    let s = p.to_string_lossy().to_string();
    if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{stripped}");
    }
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        return stripped.to_string();
    }
    s
}

fn resolve(input: &str) -> Result<PathBuf, String> {
    if input.trim().is_empty() {
        return home_path().ok_or_else(|| "cannot determine home directory".to_string());
    }

    let expanded = if let Some(rest) = input.strip_prefix('~') {
        let home = home_path().ok_or_else(|| "cannot determine home directory".to_string())?;
        if rest.is_empty() {
            home
        } else {
            home.join(rest.trim_start_matches(['/', '\\']))
        }
    } else {
        PathBuf::from(input)
    };

    if !expanded.is_absolute() {
        return Err(format!("path must be absolute: {input}"));
    }

    Ok(expanded)
}

fn home_path() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

fn modified_secs(meta: &std::fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

#[tauri::command]
pub fn fs_list(path: String) -> Result<DirListing, String> {
    let target = resolve(&path)?;

    let meta = std::fs::metadata(&target).map_err(|e| format!("{}: {e}", display_path(&target)))?;
    if !meta.is_dir() {
        return Err(format!("not a directory: {}", display_path(&target)));
    }

    let read_dir =
        std::fs::read_dir(&target).map_err(|e| format!("{}: {e}", display_path(&target)))?;

    let mut entries = Vec::new();
    for item in read_dir {
        let item = match item {
            Ok(i) => i,
            Err(_) => continue,
        };
        let entry_path = item.path();
        let name = item.file_name().to_string_lossy().to_string();

        // symlink_metadata does not follow links, so a broken link is still
        // described rather than erroring the whole listing.
        match std::fs::symlink_metadata(&entry_path) {
            Ok(md) => {
                let is_symlink = md.file_type().is_symlink();
                // For links, report the target's directory-ness when resolvable.
                let is_directory = if is_symlink {
                    std::fs::metadata(&entry_path)
                        .map(|m| m.is_dir())
                        .unwrap_or(false)
                } else {
                    md.is_dir()
                };
                entries.push(FileEntry {
                    name,
                    path: display_path(&entry_path),
                    is_directory,
                    is_symlink,
                    size: if md.is_dir() { 0 } else { md.len() },
                    modified: modified_secs(&md),
                    readonly: md.permissions().readonly(),
                    unreadable: false,
                });
            }
            Err(_) => entries.push(FileEntry {
                name,
                path: display_path(&entry_path),
                is_directory: false,
                is_symlink: false,
                size: 0,
                modified: None,
                readonly: true,
                unreadable: true,
            }),
        }
    }

    // Directories first, then case-insensitive by name — Explorer's ordering.
    entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(DirListing {
        path: display_path(&target),
        parent: target.parent().map(display_path),
        entries,
    })
}

#[tauri::command]
pub fn fs_read(path: String) -> Result<FileContent, String> {
    let target = resolve(&path)?;
    let meta = std::fs::metadata(&target).map_err(|e| format!("{}: {e}", display_path(&target)))?;

    if meta.is_dir() {
        return Err(format!("is a directory: {}", display_path(&target)));
    }

    let size = meta.len();
    if size > MAX_EDITABLE_BYTES {
        return Err(format!(
            "file is {:.1} MB, larger than the {} MB edit limit — open it externally instead",
            size as f64 / 1_048_576.0,
            MAX_EDITABLE_BYTES / 1_048_576
        ));
    }

    let bytes = std::fs::read(&target).map_err(|e| format!("{}: {e}", display_path(&target)))?;

    // Lossy decode keeps binary-ish files openable rather than failing outright.
    let content = String::from_utf8_lossy(&bytes).to_string();

    Ok(FileContent {
        path: display_path(&target),
        content,
        truncated: false,
        size,
    })
}

#[tauri::command]
pub fn fs_write(path: String, content: String) -> Result<(), String> {
    let target = resolve(&path)?;
    if let Some(parent) = target.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", display_path(parent)))?;
        }
    }
    std::fs::write(&target, content).map_err(|e| format!("{}: {e}", display_path(&target)))
}

#[tauri::command]
pub fn fs_create(path: String, kind: String) -> Result<String, String> {
    let target = resolve(&path)?;

    if target.exists() {
        return Err(format!("already exists: {}", display_path(&target)));
    }

    match kind.as_str() {
        "dir" | "directory" | "folder" => {
            std::fs::create_dir_all(&target).map_err(|e| format!("{}: {e}", display_path(&target)))?
        }
        _ => {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("{}: {e}", display_path(parent)))?;
            }
            std::fs::File::create(&target).map_err(|e| format!("{}: {e}", display_path(&target)))?;
        }
    }

    Ok(display_path(&target))
}

/// Delete a file or directory.
///
/// Deliberately not recursive-by-default: a directory delete must be opted into
/// explicitly so a mis-click cannot take a tree with it.
#[tauri::command]
pub fn fs_delete(path: String, recursive: bool) -> Result<(), String> {
    let target = resolve(&path)?;
    let meta = std::fs::symlink_metadata(&target)
        .map_err(|e| format!("{}: {e}", display_path(&target)))?;

    if meta.is_dir() {
        let non_empty = std::fs::read_dir(&target)
            .map(|mut d| d.next().is_some())
            .unwrap_or(false);
        if non_empty && !recursive {
            return Err(format!(
                "{} is not empty — pass recursive to delete its contents",
                display_path(&target)
            ));
        }
        if recursive {
            std::fs::remove_dir_all(&target)
                .map_err(|e| format!("{}: {e}", display_path(&target)))?;
        } else {
            std::fs::remove_dir(&target).map_err(|e| format!("{}: {e}", display_path(&target)))?;
        }
    } else {
        std::fs::remove_file(&target).map_err(|e| format!("{}: {e}", display_path(&target)))?;
    }

    Ok(())
}

#[tauri::command]
pub fn fs_rename(from: String, to: String) -> Result<String, String> {
    let src = resolve(&from)?;
    let dst = resolve(&to)?;

    if dst.exists() {
        return Err(format!("target already exists: {}", display_path(&dst)));
    }
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", display_path(parent)))?;
    }

    std::fs::rename(&src, &dst).map_err(|e| {
        format!(
            "rename {} -> {}: {e}",
            display_path(&src),
            display_path(&dst)
        )
    })?;

    Ok(display_path(&dst))
}

#[tauri::command]
pub fn fs_exists(path: String) -> bool {
    resolve(&path).map(|p| p.exists()).unwrap_or(false)
}

#[tauri::command]
pub fn fs_home_dir() -> Result<String, String> {
    home_path()
        .map(|p| display_path(&p))
        .ok_or_else(|| "cannot determine home directory".to_string())
}

/// Enumerate drive roots. On Windows this is what makes the explorer able to
/// leave the current volume at all; the old implementation was rooted at the
/// process cwd and could not reach another drive.
#[tauri::command]
pub fn fs_drives() -> Vec<DriveInfo> {
    #[cfg(windows)]
    {
        let mut out = Vec::new();
        for letter in b'A'..=b'Z' {
            let root = format!("{}:\\", letter as char);
            if Path::new(&root).exists() {
                out.push(DriveInfo {
                    path: root.clone(),
                    label: format!("{}:", letter as char),
                });
            }
        }
        out
    }
    #[cfg(not(windows))]
    {
        vec![DriveInfo {
            path: "/".to_string(),
            label: "/".to_string(),
        }]
    }
}

#[tauri::command]
pub fn open_external(path: String) -> Result<(), String> {
    let target = resolve(&path)?;
    if !target.exists() {
        return Err(format!("does not exist: {}", display_path(&target)));
    }
    opener_open(&target)
}

/// Show a path in the OS file manager with the item selected.
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    let target = resolve(&path)?;
    if !target.exists() {
        return Err(format!("does not exist: {}", display_path(&target)));
    }

    #[cfg(windows)]
    {
        // /select, highlights the item inside its parent folder.
        std::process::Command::new("explorer.exe")
            .arg("/select,")
            .arg(&target)
            .spawn()
            .map_err(|e| format!("explorer failed: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R"])
            .arg(&target)
            .spawn()
            .map_err(|e| format!("open failed: {e}"))?;
        return Ok(());
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let parent = target.parent().unwrap_or(&target);
        opener_open(parent)
    }
}

fn opener_open(target: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        // Going through cmd's `start` avoids quoting pitfalls with paths that
        // contain spaces or ampersands. The empty "" is start's title argument.
        std::process::Command::new("cmd")
            .args(["/C", "start", ""])
            .arg(target)
            .spawn()
            .map_err(|e| format!("start failed: {e}"))?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("open failed: {e}"))?;
        Ok(())
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("xdg-open failed: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_verbatim_prefix() {
        assert_eq!(display_path(Path::new(r"\\?\C:\Users\dev")), r"C:\Users\dev");
    }

    #[test]
    fn strips_verbatim_unc_prefix() {
        assert_eq!(
            display_path(Path::new(r"\\?\UNC\server\share")),
            r"\\server\share"
        );
    }

    #[test]
    fn rejects_relative_paths() {
        assert!(resolve("some/relative/path").is_err());
    }

    #[test]
    fn expands_bare_tilde_to_home() {
        let got = resolve("~").unwrap();
        assert_eq!(Some(got), home_path());
    }

    #[test]
    fn expands_tilde_with_subpath() {
        let got = resolve("~/projects").unwrap();
        let want = home_path().unwrap().join("projects");
        assert_eq!(got, want);
    }
}
