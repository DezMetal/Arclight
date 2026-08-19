mod control;
mod fs_api;
mod pty;
mod store;
mod sysinfo;
mod tray;

use std::sync::Arc;

use control::ControlState;
use pty::PtyRegistry;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PtyRegistry::default())
        .manage(Arc::new(ControlState::default()))
        .invoke_handler(tauri::generate_handler![
            fs_api::fs_list,
            fs_api::fs_read,
            fs_api::fs_write,
            fs_api::fs_create,
            fs_api::fs_delete,
            fs_api::fs_rename,
            fs_api::fs_exists,
            fs_api::fs_home_dir,
            fs_api::fs_drives,
            fs_api::open_external,
            fs_api::reveal_in_explorer,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_detach,
            pty::pty_list,
            pty::pty_available_shells,
            sysinfo::system_info,
            store::state_load,
            store::state_save,
            store::state_location,
            control::control_status,
            control::control_start,
            control::control_stop,
            control::control_publish,
            control::control_respond,
            control::control_event,
            control::control_rotate_token,
        ])
        .setup(|app| {
            tray::build(app.handle())?;
            Ok(())
        })
        .on_window_event(tray::on_window_event)
        .run(tauri::generate_context!())
        .expect("error while running Arclight");
}
