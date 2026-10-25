// The shell's whole surface to the page (window.__TAURI__.core.invoke). Two commands, one event per kind:
//   desktop_info()        platform, app version and the sidecar status (address once it answers /healthz)
//   take_pending_link()   a Vyre link that arrived before the page was listening, once
//   page_report(kind, text)  what the shell's own load hook (lib.rs PAGE_PROBE) tells us: script errors and the rendered size, to the log only
// Events: "vyre://sidecar" (Status) and "vyre://deep-link" (DeepLink).

use crate::links::DeepLink;
use crate::sidecar::{self, Shared, Status};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub const LINK_EVENT: &str = "vyre://deep-link";

pub struct AppState {
    pub sidecar: Shared,
    pub pending: Mutex<Option<DeepLink>>,
    pub page_listening: AtomicBool,
}

#[derive(Serialize)]
pub struct Info {
    pub app: String,
    pub version: String,
    pub platform: &'static str,
    pub arch: &'static str,
    pub sidecar: Status,
}

#[tauri::command]
pub fn desktop_info(app: AppHandle, state: State<'_, AppState>) -> Info {
    Info {
        app: "vyre-desktop".to_string(),
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        sidecar: sidecar::current(&state.sidecar),
    }
}

#[tauri::command]
pub fn take_pending_link(state: State<'_, AppState>) -> Option<DeepLink> {
    state.page_listening.store(true, Ordering::SeqCst);
    state.pending.lock().ok().and_then(|mut p| p.take())
}

/// A link reached the shell: emit it when the page is listening, else keep the newest for take_pending_link.
pub fn deliver(app: &AppHandle, link: DeepLink) {
    // The action only. The parameters carry one-time codes and never go to a log.
    println!("vyre-desktop: deep link {} received", link.action);
    let state = app.state::<AppState>();
    if state.page_listening.load(Ordering::SeqCst) {
        let _ = app.emit(LINK_EVENT, link);
    } else if let Ok(mut p) = state.pending.lock() {
        *p = Some(link);
    }
}

/// Called by the shell's own probe script after a page load. Local log only, never the network; the text is cut short.
#[tauri::command]
pub fn page_report(kind: String, text: String) {
    let kind: String = kind.chars().filter(|c| c.is_ascii_alphanumeric()).take(16).collect();
    let text: String = text.chars().filter(|c| !c.is_control()).take(200).collect();
    println!("vyre-desktop: page {kind}: {text}");
}
