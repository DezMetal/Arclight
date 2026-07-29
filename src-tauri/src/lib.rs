mod fs_api;
mod pty;
mod sysinfo;

use pty::PtyRegistry;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PtyRegistry::default())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arclight");
}
