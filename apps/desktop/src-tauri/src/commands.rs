// The shell's whole surface to the page (window.__TAURI__.core.invoke). Two commands, one event per kind:
//   notify, pick_paths, set_badge   the native features (native.rs)
//   desktop_info()        platform, app version and the sidecar status (address once it answers /healthz)
//   take_pending_link()   a Vyre link that arrived before the page was listening, once
//   page_report(kind, text)  what the shell's own load hook (lib.rs PAGE_PROBE) tells us: script errors and the rendered size, to the log only
// Events: "vyre://sidecar" (Status) and "vyre://deep-link" (DeepLink).

use crate::links::DeepLink;
use crate::sidecar::{self, Shared, Status};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub const LINK_EVENT: &str = "vyre://deep-link";

#[derive(Default)]
pub struct LinkHandoff {
    page_listening: bool,
    pending: Option<DeepLink>,
}

impl LinkHandoff {
    fn activate_and_take(&mut self) -> Option<DeepLink> {
        self.page_listening = true;
        self.pending.take()
    }

    /// Stores before delivery begins, or returns the link for emission afterwards.
    fn deliver(&mut self, link: DeepLink) -> Option<DeepLink> {
        if self.page_listening {
            Some(link)
        } else {
            self.pending = Some(link);
            None
        }
    }
}

pub struct AppState {
    pub sidecar: Shared,
    pub personal: Shared,
    pub links: Mutex<LinkHandoff>,
    pub native: crate::native::NativeState,
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

/// Fixed local Personal profile only. The page supplies no executable, path, endpoint or shell input.
#[tauri::command]
pub async fn ensure_personal_space(app: AppHandle, state: State<'_, AppState>) -> Result<crate::personal::PersonalSpace, String> {
    let shared=state.personal.clone();
    tauri::async_runtime::spawn_blocking(move || crate::personal::ensure(&app,&shared)).await.map_err(|_| "Personal Space startup stopped".to_string())?
}

#[tauri::command]
pub fn take_pending_link(state: State<'_, AppState>) -> Option<DeepLink> {
    state.links.lock().ok().and_then(|mut links| links.activate_and_take())
}

/// A link reached the shell: emit it when the page is listening, else keep the newest for take_pending_link.
pub fn deliver(app: &AppHandle, link: DeepLink) {
    // The action only. The parameters carry one-time codes and never go to a log.
    println!("vyre-desktop: deep link {} received", link.action);
    let state = app.state::<AppState>();
    let emit = state.links.lock().ok().and_then(|mut links| links.deliver(link));
    if let Some(link) = emit {
        let _ = app.emit(LINK_EVENT, link);
    }
}

/// Called by the shell's own probe script after a page load. Local log only, never the network; the text is cut short.
#[tauri::command]
pub fn page_report(kind: String, text: String) {
    let kind: String = kind.chars().filter(|c| c.is_ascii_alphanumeric()).take(16).collect();
    let text: String = text.chars().filter(|c| !c.is_control()).take(200).collect();
    println!("vyre-desktop: page {kind}: {text}");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::sync::Mutex;

    fn link(code: &str) -> DeepLink {
        DeepLink { action: "join".to_string(), params: BTreeMap::from([("code".to_string(), code.to_string())]) }
    }

    #[test]
    fn delivery_before_activation_is_drained_from_the_mutex_owned_pending_slot() {
        let handoff = Mutex::new(LinkHandoff::default());
        let expected = link("one-time-code");

        assert_eq!(handoff.lock().unwrap().deliver(expected.clone()), None);
        assert_eq!(handoff.lock().unwrap().activate_and_take(), Some(expected));
    }

    #[test]
    fn activation_before_delivery_emits_without_using_the_pending_slot() {
        let handoff = Mutex::new(LinkHandoff::default());
        let expected = link("one-time-code");

        assert_eq!(handoff.lock().unwrap().activate_and_take(), None);
        assert_eq!(handoff.lock().unwrap().deliver(expected.clone()), Some(expected));
    }
}
