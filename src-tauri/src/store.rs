//! Workspace persistence.
//!
//! State lives in a JSON file under the user's config directory, not in the
//! webview's localStorage. localStorage is scoped to the page origin, which
//! differs between `npm run dev` and the packaged app and is not guaranteed to
//! survive a webview data reset -- which is why the layout and every open
//! directory kept coming back empty after a restart.
//!
//! Writes are atomic: a temp file beside the target, then a rename. A crash
//! mid-write would otherwise leave a truncated file and lose the workspace,
//! which is the one thing this file exists to prevent.

use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const FILE_NAME: &str = "workspace.json";

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config directory: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir.join(FILE_NAME))
}

/// Read the saved workspace. Returns null when there is nothing saved yet.
#[tauri::command]
pub fn state_load(app: AppHandle) -> Result<Value, String> {
    let path = state_path(&app)?;
    if !path.exists() {
        return Ok(Value::Null);
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    // A corrupt file must not brick the app. Report it and start fresh; the
    // damaged copy is kept beside it so nothing is silently destroyed.
    match serde_json::from_str(&text) {
        Ok(value) => Ok(value),
        Err(err) => {
            let _ = fs::rename(&path, path.with_extension("json.corrupt"));
            Err(format!(
                "{} was unreadable ({err}); it has been set aside as workspace.json.corrupt",
                path.display()
            ))
        }
    }
}

/// Write the workspace atomically.
#[tauri::command]
pub fn state_save(app: AppHandle, state: Value) -> Result<(), String> {
    let path = state_path(&app)?;
    let temp = path.with_extension("json.tmp");

    let text = serde_json::to_string_pretty(&state).map_err(|e| format!("serialise: {e}"))?;
    fs::write(&temp, text).map_err(|e| format!("{}: {e}", temp.display()))?;
    fs::rename(&temp, &path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(())
}

/// Where the workspace file lives, for the settings pane and for support.
#[tauri::command]
pub fn state_location(app: AppHandle) -> Result<Value, String> {
    let path = state_path(&app)?;
    Ok(json!({
        "path": path.to_string_lossy(),
        "exists": path.exists(),
    }))
}
