// "Run this Mac as the Space server": a Team Space the desktop app hosts itself, beside the device daemon and the Personal Space.
// It is the app-side twin of scripts/install/macos/install.sh. The installer is for a Mac that stays on (a launchd agent, Docker, updates);
// this one runs while Vyre is open and needs nothing else. The page asks for it with one fixed command and chooses nothing: the folder,
// the loopback port and the relay are fixed in sidecar.rs, and the owner setup link comes back through the same checked handoff as the Personal Space.
use crate::personal::{self, PersonalSpace};
use crate::sidecar::{self, Shared};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

fn profile(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|p| p.join("server")).map_err(|_| "Couldn’t locate the server’s folder".to_string())
}

/// True once this Mac has been set up as a server, so the next launch starts it again.
pub fn profile_exists(app: &AppHandle) -> bool {
    profile(app).map(|p| p.join("events.db").is_file()).unwrap_or(false)
}

pub fn ensure(app: &AppHandle, shared: &Shared) -> Result<PersonalSpace, String> {
    if !cfg!(target_os = "macos") {
        return Err("Running a Space server from the app is available on a Mac.".to_string());
    }
    let data = profile(app)?;
    // the shared start-and-wait logic words its errors for the Personal Space; this is the same flow for the server
    personal::ensure_using(shared, &data, || sidecar::start(app, shared, 0), sidecar::healthy, Duration::from_secs(40))
        .map_err(|e| e.replace("Personal Space", "The server on this Mac"))
}
