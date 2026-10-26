// Tauri 2 shell for Vyre. The system webview (WKWebView on Mac, WebView2 on Windows) loads the Expo web
// build, which keeps its encrypted replica in OPFS exactly as on the web. Around it the shell does four things:
//   1. runs the vyred device daemon as a sidecar and tells the page where it listens (sidecar.rs),
//   2. registers the vyre:// scheme and passes links to the page (links.rs, commands.rs),
//   3. registers the global shortcut CommandOrControl+Shift+V to bring the window forward,
//   4. keeps one instance: a second launch (or a link on Windows and Linux) focuses the first,
//   5. native features for the page: tray icon, OS notifications whose click opens the thread, file and folder dialog, Needs you badge (native.rs).
// No keychain: the replica key is wrapped in IndexedDB by the page, so an ad-hoc signed Mac app works (ARCH 5.10).

mod commands;
mod links;
mod native;
mod sidecar;

use commands::AppState;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub const SHORTCUT: &str = "CommandOrControl+Shift+V";

/// Run in the page after every load: report script errors and how much text rendered, through our own command.
/// This is how a blank window shows up in the log (and in the desktop job) instead of staying a mystery.
const PAGE_PROBE: &str = r#"(function () {
  var inv = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
  if (!inv || window.__vyreProbe) return;
  window.__vyreProbe = true;
  function send(kind, text) { try { inv("page_report", { kind: kind, text: String(text) }); } catch (e) {} }
  window.addEventListener("error", function (e) { send("error", e.message); });
  window.addEventListener("unhandledrejection", function (e) { send("error", e.reason); });
  setTimeout(function () {
    var n = document.body ? document.body.innerText.length : 0;
    send("rendered", n + " chars at " + location.protocol + "//" + location.host + location.pathname);
  }, 2000);
})();"#;

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

/// CI only (VYRE_SHELL_BANNER=1): a corner label with what the shell knows, so a screenshot of the running window shows the sidecar connected.
const BANNER: &str = r#"(function () {
  var inv = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
  if (!inv || window.__vyreBanner) return;
  window.__vyreBanner = true;
  var box = document.createElement("div");
  box.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483647;padding:10px 14px;border-radius:10px;background:#161616;color:#f4f1ea;font:14px/1.4 -apple-system,Segoe UI,sans-serif;white-space:pre";
  box.textContent = "Vyre desktop shell\nsidecar: starting";
  // The page hydrates after load and can replace what we added, so keep the label attached.
  function attach() { if (document.body && !box.isConnected) document.body.appendChild(box); }
  attach();
  setInterval(attach, 300);
  function tick() {
    inv("desktop_info").then(function (i) {
      var s = i.sidecar;
      box.textContent = "Vyre desktop shell " + i.version + " (" + i.platform + " " + i.arch + ")\nsidecar: " + s.phase + (s.url ? " at " + s.url : "") + (s.version ? ", vyred " + s.version : "");
      if (s.phase !== "ready") setTimeout(tick, 400);
    }, function () { setTimeout(tick, 800); });
  }
  tick();
})();"#;

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
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_main(app);
                    }
                })
                .build(),
        )
        .on_page_load(|webview, payload| {
            if let tauri::webview::PageLoadEvent::Finished = payload.event() {
                let _ = webview.eval(PAGE_PROBE);
                if std::env::var("VYRE_SHELL_BANNER").is_ok() {
                    let _ = webview.eval(BANNER);
                }
            }
        })
        .on_window_event(|window, event| {
            // A banner was shown a moment ago and the window comes forward: open what the banner was about (native.rs).
            if let tauri::WindowEvent::Focused(true) = event {
                native::on_focus(window.app_handle());
            }
        })
        .manage(AppState { sidecar: shared.clone(), pending: Mutex::new(None), page_listening: AtomicBool::new(false), native: native::NativeState::default() })
        .invoke_handler(tauri::generate_handler![
            commands::desktop_info,
            commands::take_pending_link,
            commands::page_report,
            native::notify,
            native::discover_codex_sessions,
            native::discover_session_sources,
            native::pick_paths,
            native::set_badge
        ])
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
            if let Err(e) = native::setup_tray(&handle, &state.native) {
                eprintln!("tray not created: {e}");
            }
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
