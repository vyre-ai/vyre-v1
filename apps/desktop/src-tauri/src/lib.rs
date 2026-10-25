// Tauri 2 shell for Vyre. The system webview (WKWebView on Mac, WebView2 on Windows) loads the Expo web
// build, which keeps its encrypted replica in OPFS exactly as on the web. Around it the shell does four things:
//   1. runs the vyred device daemon as a sidecar and tells the page where it listens (sidecar.rs),
//   2. registers the vyre:// scheme and passes links to the page (links.rs, commands.rs),
//   3. registers the global shortcut CommandOrControl+Shift+V to bring the window forward,
//   4. keeps one instance: a second launch (or a link on Windows and Linux) focuses the first.
// No keychain: the replica key is wrapped in IndexedDB by the page, so an ad-hoc signed Mac app works (ARCH 5.10).

mod commands;
mod links;
mod sidecar;

use commands::AppState;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub const SHORTCUT: &str = "CommandOrControl+Shift+V";

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// The shortcut toggles: forward when hidden or behind, hidden when it is already the front window.
fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let front = w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false);
        if front {
            let _ = w.hide();
        } else {
            show_main(app);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared: sidecar::Shared = Arc::new(sidecar::Sidecar::default());
    let exit_handle = shared.clone();

    let app = tauri::Builder::default()
        // Must be first so a second launch is caught before anything else starts.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_main(app);
                    }
                })
                .build(),
        )
        .manage(AppState { sidecar: shared.clone(), pending: Mutex::new(None), page_listening: AtomicBool::new(false) })
        .invoke_handler(tauri::generate_handler![commands::desktop_info, commands::take_pending_link])
        .setup(move |app| {
            let handle = app.handle().clone();

            // A shortcut another program already holds must not stop the shell.
            if let Err(e) = app.global_shortcut().register(SHORTCUT) {
                eprintln!("shortcut {SHORTCUT} not registered: {e}");
            }

            // Windows and Linux register the scheme at launch; on Mac it comes from the bundle.
            #[cfg(any(target_os = "linux", windows))]
            {
                if let Err(e) = app.deep_link().register_all() {
                    eprintln!("deep link scheme not registered: {e}");
                }
            }

            // The link the app was started with (launch arguments), then every later one.
            if let Some(link) = links::from_args(std::env::args()) {
                commands::deliver(&handle, link);
            }
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    if let Some(link) = links::parse(url.as_str()) {
                        commands::deliver(&handle, link);
                    }
                }
            }
            let on_open = handle.clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if let Some(link) = links::parse(url.as_str()) {
                        show_main(&on_open);
                        commands::deliver(&on_open, link);
                    }
                }
            });

            let state = app.state::<AppState>();
            sidecar::start(&handle, &state.sidecar, 0);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building vyre");

    app.run(move |_app, event| {
        if let RunEvent::Exit = event {
            sidecar::stop(&exit_handle);
        }
    });
}
