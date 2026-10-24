// Tauri 2 shell. Loads the web build from frontendDist, registers the vyre deep link
// and the global shortcut, and starts the vyred sidecar on loopback port 47211.
// macOS signingIdentity in tauri.conf.json is "-" (ad-hoc). Windows target is NSIS.
// Linux targets are deb and appimage (best effort).

use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            boot(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running vyre");
}

fn boot(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.global_shortcut().register("CommandOrControl+Shift+V")?;

    // macOS takes the scheme from the bundle (plugins.deep-link). Linux and Windows register at launch.
    #[cfg(any(target_os = "linux", windows))]
    {
        use tauri_plugin_deep_link::DeepLinkExt;
        app.deep_link().register_all()?;
    }

    let command = app
        .shell()
        .sidecar("vyred")?
        .env("VYRE_SIDECAR_PORT", "47211");
    let (_rx, child) = command.spawn()?;
    // Hold the child for the life of the process. Dropping it can kill vyred.
    app.manage(std::sync::Mutex::new(child));
    Ok(())
}
