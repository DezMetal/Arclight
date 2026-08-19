//! System tray.
//!
//! Closing the window hides it rather than quitting, so the shells, the
//! working directories and the whole layout stay live and reopening is
//! instant. Quitting is therefore an explicit choice: the tray menu, or
//! `Quit` from the tray icon.
//!
//! Hiding on close is a real deviation from what people expect a close button
//! to do, so the tray menu names the escape hatch plainly.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};

const MAIN: &str = "main";

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Arclight", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    TrayIconBuilder::with_id("arclight")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Arclight")
        .menu(&menu)
        // Left click is handled below; without this the menu pops on both
        // buttons and a single click cannot restore the window.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Intercept the close button so it hides instead of quitting.
pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == MAIN {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}
