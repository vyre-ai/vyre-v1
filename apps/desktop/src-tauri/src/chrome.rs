// "Install Vyre for Chrome": there is no Web Store listing yet, so the app puts the extension in a folder of its own, tells Chrome where the native messaging host is, and shows the three clicks Chrome
// needs (Developer mode, Load unpacked, pick the folder). What the page can ask for is fixed: install, open Chrome's extensions page, show the folder. It supplies no path and no program.
//
//   <app data>/chrome-extension/        a copy of the extension from the app bundle (runtime/chrome-extension, versioned with the app by stage-runtime.ts), replaced on every install
//   <app data>/chrome-host/             run-vyre-bridge (.cmd on Windows): runs the bundled Node on the extension's native host, and run.vyre.bridge.json filled from the extension's template
//   each installed browser's NativeMessagingHosts folder (the registry on Windows) gets that manifest, naming this extension's id and no other origin
//   at every app start, for a person who installed before, the folder is refreshed when the bundled version differs and every installed browser is registered again (sync_on_start)
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// The id Chrome gives the extension: the manifest pins a public key, and this is derived from it (a test in apps/chrome/tests/ext-identity.test.ts holds the two together).
pub const EXTENSION_ID: &str = "agdepmcadbenjfbhekgifcijiabnpego";
pub const HOST_NAME: &str = "run.vyre.bridge";
/// The extension's own template; the two places to fill are __HOST_PATH__ and __EXTENSION_ID__.
const HOST_TEMPLATE: &str = include_str!("../../../chrome/src/worker/native/run.vyre.bridge.json");

/// The Team Spaces the person is signed in to, as the page handed them over: id and the JSON the daemons are given. In the shell's memory only, so a daemon that restarts can be given them again.
static LINKED: std::sync::Mutex<Vec<(String, String)>> = std::sync::Mutex::new(Vec::new());

fn space_id_ok(id: &str) -> bool {
    id.starts_with("spc_") && id.len() > 4 && id.len() <= 124 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// Give a daemon every Team Space session held. Each daemon of the app can be the one the extension's native host reaches, so each is given the list.
pub(crate) fn relink(shared: &crate::sidecar::Shared) {
    let held = LINKED.lock().map(|l| l.clone()).unwrap_or_default();
    for (_, body) in held {
        crate::sidecar::local_request(shared, "POST", "/local/chrome/spaces", &body);
    }
}

/// The page hands over the person's own session for a Team Space (src/shell/session/chrome-link.ts). The daemon checks the address and keeps it in memory only.
#[tauri::command]
/// `compute` false hands a session to Vyre for Chrome only (a Personal Space, a Team Space this computer hosts): the daemon keeps it so the extension acts as this person, and links no chats.
pub fn link_chrome_space(state: tauri::State<'_, crate::commands::AppState>, id: String, name: String, address: String, token: String, compute: Option<bool>) -> Result<(), String> {
    if !space_id_ok(&id) {
        return Err("That is not a Space id".to_string());
    }
    let body = serde_json::json!({ "id": id, "name": name, "address": address, "token": token, "compute": compute.unwrap_or(true) }).to_string();
    if let Ok(mut held) = LINKED.lock() {
        held.retain(|(k, _)| *k != id);
        held.push((id, body.clone()));
    }
    let mut any = false;
    for shared in [&state.sidecar, &state.personal] {
        any |= crate::sidecar::local_request(shared, "POST", "/local/chrome/spaces", &body);
    }
    if any { Ok(()) } else { Err("Vyre for Chrome is not running on this computer yet".to_string()) }
}

#[tauri::command]
pub fn unlink_chrome_space(state: tauri::State<'_, crate::commands::AppState>, id: String) -> Result<(), String> {
    if !space_id_ok(&id) {
        return Err("That is not a Space id".to_string());
    }
    if let Ok(mut held) = LINKED.lock() {
        held.retain(|(k, _)| *k != id);
    }
    for shared in [&state.sidecar, &state.personal] {
        crate::sidecar::local_request(shared, "DELETE", &format!("/local/chrome/spaces?id={id}"), "");
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChromeInstall {
    pub extension_dir: String,
    pub extension_id: String,
    pub version: String,
    /// The browsers the native host was registered for, by name.
    pub browsers: Vec<String>,
}

/// The host manifest with its two placeholders filled. The path is escaped for JSON (a Windows path has backslashes). Refuses to return text that still has a placeholder or is not JSON.
pub(crate) fn fill_host_manifest(template: &str, host_path: &str) -> Result<String, String> {
    let escaped = serde_json::to_string(host_path).map_err(|_| "The host path is not text".to_string())?;
    let filled = template.replace("\"__HOST_PATH__\"", &escaped).replace("__EXTENSION_ID__", EXTENSION_ID);
    if filled.contains("__HOST_PATH__") || filled.contains("__EXTENSION_ID__") {
        return Err("The native host manifest still has a placeholder".to_string());
    }
    let parsed: serde_json::Value = serde_json::from_str(&filled).map_err(|_| "The native host manifest is not valid".to_string())?;
    if parsed.get("path").and_then(|p| p.as_str()) != Some(host_path) {
        return Err("The native host manifest lost its path".to_string());
    }
    Ok(filled)
}

/// A shell script that runs the bundled Node on the host. The program and the script are quoted so a path with a space or an apostrophe still works.
pub(crate) fn unix_launcher(node: &Path, host_js: &Path) -> String {
    let q = |p: &Path| format!("'{}'", p.to_string_lossy().replace('\'', "'\\''"));
    format!("#!/bin/sh\n# Vyre for Chrome's native messaging host, written by the Vyre app.\nexec {} {} \"$@\"\n", q(node), q(host_js))
}

pub(crate) fn windows_launcher(node: &Path, host_js: &Path) -> String {
    format!("@echo off\r\nrem Vyre for Chrome's native messaging host, written by the Vyre app.\r\n\"{}\" \"{}\" %*\r\n", node.display(), host_js.display())
}

/// The Chromium browsers the native host is registered for on Windows, as (browser, registry key under HKCU). The key is where that browser looks for `NativeMessagingHosts\\<host>`.
/// Chrome, Edge, Brave and Chromium are the documented ones; Vivaldi and Opera follow the same pattern. Arc, Dia and Comet have no Windows build to check against, so they are not listed.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) const WINDOWS_BROWSERS: [(&str, &str); 6] = [
    ("Google Chrome", r"Software\Google\Chrome"),
    ("Chromium", r"Software\Chromium"),
    ("Microsoft Edge", r"Software\Microsoft\Edge"),
    ("Brave", r"Software\BraveSoftware\Brave-Browser"),
    ("Vivaldi", r"Software\Vivaldi"),
    ("Opera", r"Software\Opera Software"),
];

/// Where each browser keeps native messaging host manifests, as (browser, the folder that exists when it is installed, the folder to write into). Unix only; Windows uses the registry.
/// Arc, Dia and Comet exist on a Mac only. Each Chromium browser reads host manifests from its own data folder, so a browser that is not listed here says "Vyre is not on this computer".
#[cfg_attr(windows, allow(dead_code))]
pub(crate) fn browser_dirs(os: &str, home: &Path) -> Vec<(&'static str, PathBuf, PathBuf)> {
    let mac = os == "macos";
    // (name, folder under Application Support on a Mac, folder under ~/.config on Linux; None when the browser has no Linux build)
    let all: [(&'static str, &str, Option<&str>); 10] = [
        ("Google Chrome", "Google/Chrome", Some("google-chrome")),
        ("Chromium", "Chromium", Some("chromium")),
        ("Microsoft Edge", "Microsoft Edge", Some("microsoft-edge")),
        ("Brave", "BraveSoftware/Brave-Browser", Some("BraveSoftware/Brave-Browser")),
        ("Vivaldi", "Vivaldi", Some("vivaldi")),
        ("Opera", "com.operasoftware.Opera", Some("opera")),
        ("Arc", "Arc/User Data", None),
        ("Dia", "Dia/User Data", None),
        ("Comet", "Comet", None),
        ("Chrome Canary", "Google/Chrome Canary", None),
    ];
    all.into_iter()
        .filter_map(|(name, mac_path, linux_path)| {
            let dir = if mac { home.join("Library/Application Support").join(mac_path) } else { home.join(".config").join(linux_path?) };
            Some((name, dir.clone(), dir.join("NativeMessagingHosts")))
        })
        .collect()
}

/// An installed copy of the extension that is not the bundled version has to be replaced. Nothing is written for a person who never pressed Install (no folder yet).
pub(crate) fn needs_refresh(bundled: &str, installed: Option<&str>) -> bool {
    matches!(installed, Some(v) if v != bundled)
}

/// The "reload the extension" notice is shown once per extension version: when a refresh put in a version that has not been announced yet.
pub(crate) fn reload_notice_due(told: &str, version: &str) -> bool {
    !version.is_empty() && told.trim() != version
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

fn app_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|_| "Couldn’t find the Vyre folder".to_string())
}

/// The Node runtime the app carries for its daemon sits beside the app's own program.
fn bundled_node() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|_| "Couldn’t find the app’s program".to_string())?;
    let name = if cfg!(windows) { "vyred.exe" } else { "vyred" };
    let node = exe.parent().map(|d| d.join(name)).filter(|p| p.is_file());
    node.ok_or_else(|| "The app’s runtime is missing. Reinstall Vyre.".to_string())
}

fn manifest_version(dir: &Path) -> String {
    std::fs::read_to_string(dir.join("manifest.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get("version_name").or_else(|| v.get("version")).and_then(|x| x.as_str().map(str::to_string)))
        .unwrap_or_default()
}

#[cfg(windows)]
fn register_windows(manifest: &Path) -> Vec<String> {
    use std::process::Command;
    let mut done = Vec::new();
    for (name, key) in WINDOWS_BROWSERS {
        // only for a browser that has a key of its own, so a browser that is not installed gets nothing
        let present = Command::new("reg").args(["query", &format!(r"HKCU\{key}")]).output().map(|o| o.status.success()).unwrap_or(false);
        if !present {
            continue;
        }
        let target = format!(r"HKCU\{key}\NativeMessagingHosts\{HOST_NAME}");
        let ok = Command::new("reg").args(["add", &target, "/ve", "/t", "REG_SZ", "/d", &manifest.to_string_lossy(), "/f"]).output().map(|o| o.status.success()).unwrap_or(false);
        if ok {
            done.push(name.to_string());
        }
    }
    done
}

/// Copy the extension out of the bundle, write the host and its manifest, register it with each installed browser. Safe to run again: everything it writes is replaced.
pub fn install(app: &AppHandle) -> Result<ChromeInstall, String> {
    let bundled = crate::sidecar::runtime_dir(app)?.join("chrome-extension");
    if !bundled.join("manifest.json").is_file() {
        return Err("This copy of Vyre has no Chrome extension in it. Reinstall Vyre.".to_string());
    }
    let data = app_dir(app)?;
    let ext = data.join("chrome-extension");
    let staging = data.join("chrome-extension.new");
    let _ = std::fs::remove_dir_all(&staging);
    copy_dir(&bundled, &staging).map_err(|_| "Couldn’t copy the extension".to_string())?;
    let _ = std::fs::remove_dir_all(&ext);
    std::fs::rename(&staging, &ext).map_err(|_| "Couldn’t put the extension in place".to_string())?;

    let node = bundled_node()?;
    let host_dir = data.join("chrome-host");
    std::fs::create_dir_all(&host_dir).map_err(|_| "Couldn’t make the host folder".to_string())?;
    let host_js = ext.join("src/worker/native/host.js");
    let launcher = host_dir.join(if cfg!(windows) { "run-vyre-bridge.cmd" } else { "run-vyre-bridge" });
    let script = if cfg!(windows) { windows_launcher(&node, &host_js) } else { unix_launcher(&node, &host_js) };
    std::fs::write(&launcher, script).map_err(|_| "Couldn’t write the host".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&launcher, std::fs::Permissions::from_mode(0o755));
    }
    let manifest_text = fill_host_manifest(HOST_TEMPLATE, &launcher.to_string_lossy())?;
    let manifest_file = host_dir.join(format!("{HOST_NAME}.json"));
    std::fs::write(&manifest_file, &manifest_text).map_err(|_| "Couldn’t write the host manifest".to_string())?;

    #[cfg(windows)]
    let browsers: Vec<String> = register_windows(&manifest_file);
    #[cfg(not(windows))]
    let browsers: Vec<String> = {
        let home = std::env::var_os("HOME").map(PathBuf::from).ok_or_else(|| "Couldn’t find your home folder".to_string())?;
        let mut done = Vec::new();
        for (name, installed, hosts) in browser_dirs(std::env::consts::OS, &home) {
            if !installed.is_dir() {
                continue;
            }
            if std::fs::create_dir_all(&hosts).is_ok() && std::fs::write(hosts.join(format!("{HOST_NAME}.json")), &manifest_text).is_ok() {
                done.push(name.to_string());
            }
        }
        done
    };
    if browsers.is_empty() {
        return Err("Vyre did not find Chrome on this computer. Install Chrome, open it once, then try again.".to_string());
    }
    Ok(ChromeInstall { extension_dir: ext.to_string_lossy().to_string(), extension_id: EXTENSION_ID.to_string(), version: manifest_version(&ext), browsers })
}

/// At app start, for a person who has installed Vyre for Chrome before: register the host with every browser that is installed now (a browser added since the last install gets it too), rewrite the launcher
/// (the app may have moved), and when the bundled extension is not the version in the folder, replace the folder. A new extension version is announced once with a banner, because the browser keeps running
/// the old copy until the person presses reload on the extension card. Nothing is written for a person who never pressed Install.
pub fn sync_on_start(app: &AppHandle) {
    let Ok(data) = app_dir(app) else { return };
    let Ok(rt) = crate::sidecar::runtime_dir(app) else { return };
    let ext = data.join("chrome-extension");
    if !ext.join("manifest.json").is_file() {
        return;
    }
    let bundled_v = manifest_version(&rt.join("chrome-extension"));
    let installed_v = manifest_version(&ext);
    let refreshed = needs_refresh(&bundled_v, Some(&installed_v));
    if let Err(e) = install(app) {
        eprintln!("chrome extension sync: {e}");
        return;
    }
    if !refreshed {
        return;
    }
    let marker = data.join("chrome-reload-told");
    let told = std::fs::read_to_string(&marker).unwrap_or_default();
    if reload_notice_due(&told, &bundled_v) {
        use tauri_plugin_notification::NotificationExt;
        let shown = app.notification().builder().title("Vyre for Chrome was updated").body("Open your browser's extensions page and press reload on Vyre.").show().is_ok();
        if shown {
            let _ = std::fs::write(&marker, &bundled_v);
        }
    }
}

#[tauri::command]
pub async fn install_chrome_extension(app: AppHandle) -> Result<ChromeInstall, String> {
    tauri::async_runtime::spawn_blocking(move || install(&app)).await.map_err(|_| "The install stopped".to_string())?
}

/// Open Chrome's extensions page, where Load unpacked lives. A fixed address in a fixed browser; nothing from the page.
#[tauri::command]
pub fn open_chrome_extensions() -> Result<(), String> {
    use std::process::Command;
    let spawned = if cfg!(target_os = "macos") {
        Command::new("open").args(["-a", "Google Chrome", "chrome://extensions"]).spawn()
    } else if cfg!(windows) {
        Command::new("cmd").args(["/c", "start", "", "chrome", "chrome://extensions"]).spawn()
    } else {
        Command::new("google-chrome").arg("chrome://extensions").spawn()
    };
    spawned.map(|_| ()).map_err(|_| "Couldn’t open Chrome. Open it and go to chrome://extensions.".to_string())
}

/// Show the installed extension folder in the file manager, so it can be picked in Load unpacked.
#[tauri::command]
pub fn reveal_chrome_extension(app: AppHandle) -> Result<(), String> {
    use std::process::Command;
    let dir = app_dir(&app)?.join("chrome-extension");
    if !dir.is_dir() {
        return Err("Install Vyre for Chrome first.".to_string());
    }
    let opener = if cfg!(target_os = "macos") { "open" } else if cfg!(windows) { "explorer" } else { "xdg-open" };
    Command::new(opener).arg(&dir).spawn().map(|_| ()).map_err(|_| "Couldn’t open the folder".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_host_manifest_gets_its_path_and_this_extensions_id_and_nothing_is_left_to_fill() {
        let text = fill_host_manifest(HOST_TEMPLATE, "/Users/pat/Library/Application Support/ai.vyre.desktop/chrome-host/run-vyre-bridge").unwrap();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["name"], HOST_NAME);
        assert_eq!(v["type"], "stdio");
        assert_eq!(v["allowed_origins"], serde_json::json!([format!("chrome-extension://{EXTENSION_ID}/")]));
        assert!(!text.contains("__"));
    }

    #[test]
    fn a_windows_path_and_an_odd_one_survive_json_and_a_bad_template_is_refused() {
        for path in [r"C:\Users\Pat O'Neil\AppData\Roaming\ai.vyre.desktop\chrome-host\run-vyre-bridge.cmd", "/tmp/a \"quoted\" dir/run"] {
            let v: serde_json::Value = serde_json::from_str(&fill_host_manifest(HOST_TEMPLATE, path).unwrap()).unwrap();
            assert_eq!(v["path"], path);
        }
        assert!(fill_host_manifest("{\"path\":\"__HOST_PATH__\",\"x\":\"__EXTENSION_ID__\"", "/x").is_err(), "not JSON");
        assert!(fill_host_manifest("{\"path\":\"fixed\",\"y\":1}", "/x").is_err(), "the path did not land");
    }

    #[test]
    fn only_a_space_id_is_passed_on_to_a_daemon() {
        assert!(space_id_ok("spc_01a189d72bde4bc8"));
        for bad in ["", "spc_", "usr_abc", "spc_a/../b", "spc_a?x=1", "spc_a b", "spc_\u{e9}"] {
            assert!(!space_id_ok(bad), "{bad}");
        }
    }

    #[test]
    fn the_launchers_quote_their_paths() {
        let sh = unix_launcher(Path::new("/Applications/Vyre.app/Contents/MacOS/vyred"), Path::new("/Users/pat o'brien/ext/host.js"));
        assert!(sh.starts_with("#!/bin/sh\n"));
        assert!(sh.contains("exec '/Applications/Vyre.app/Contents/MacOS/vyred' '/Users/pat o'\\''brien/ext/host.js' \"$@\""));
        let cmd = windows_launcher(Path::new(r"C:\Program Files\Vyre\vyred.exe"), Path::new(r"C:\Users\Pat\ext\host.js"));
        assert!(cmd.contains(r#""C:\Program Files\Vyre\vyred.exe" "C:\Users\Pat\ext\host.js" %*"#));
    }

    #[test]
    fn each_browser_has_a_folder_of_its_own_on_a_mac_and_on_linux() {
        let mac = browser_dirs("macos", Path::new("/Users/pat"));
        assert_eq!(mac[0].0, "Google Chrome");
        assert_eq!(mac[0].2, Path::new("/Users/pat/Library/Application Support/Google/Chrome/NativeMessagingHosts"));
        let linux = browser_dirs("linux", Path::new("/home/pat"));
        assert_eq!(linux[0].2, Path::new("/home/pat/.config/google-chrome/NativeMessagingHosts"));
        assert_eq!(linux.len(), 6, "Arc, Dia, Comet and Canary have no Linux build");
        assert!(linux.iter().all(|b| !["Arc", "Dia", "Comet"].contains(&b.0)));
    }

    #[test]
    fn every_chromium_browser_the_owners_people_use_gets_the_host_on_a_mac() {
        let mac = browser_dirs("macos", Path::new("/Users/pat"));
        let hosts = |name: &str| mac.iter().find(|b| b.0 == name).unwrap_or_else(|| panic!("{name} is missing")).2.clone();
        let base = Path::new("/Users/pat/Library/Application Support");
        assert_eq!(hosts("Comet"), base.join("Comet/NativeMessagingHosts"));
        assert_eq!(hosts("Arc"), base.join("Arc/User Data/NativeMessagingHosts"));
        assert_eq!(hosts("Dia"), base.join("Dia/User Data/NativeMessagingHosts"));
        assert_eq!(hosts("Brave"), base.join("BraveSoftware/Brave-Browser/NativeMessagingHosts"));
        assert_eq!(hosts("Microsoft Edge"), base.join("Microsoft Edge/NativeMessagingHosts"));
        assert_eq!(hosts("Vivaldi"), base.join("Vivaldi/NativeMessagingHosts"));
        assert_eq!(hosts("Chromium"), base.join("Chromium/NativeMessagingHosts"));
        assert_eq!(hosts("Opera"), base.join("com.operasoftware.Opera/NativeMessagingHosts"));
        let names: std::collections::HashSet<_> = mac.iter().map(|b| b.0).collect();
        assert_eq!(names.len(), mac.len(), "no browser twice");
    }

    #[test]
    fn windows_registers_each_documented_browser_once() {
        let names: std::collections::HashSet<_> = WINDOWS_BROWSERS.iter().map(|b| b.0).collect();
        assert_eq!(names.len(), WINDOWS_BROWSERS.len());
        for want in ["Google Chrome", "Microsoft Edge", "Brave", "Vivaldi"] {
            assert!(names.contains(want), "{want}");
        }
        assert!(WINDOWS_BROWSERS.iter().all(|b| b.1.starts_with(r"Software\")));
    }

    #[test]
    fn the_extension_folder_is_replaced_only_when_it_exists_and_the_version_differs() {
        assert!(needs_refresh("1.0.0-rc.22", Some("1.0.0-rc.14")));
        assert!(needs_refresh("1.0.0-rc.22", Some("")), "a folder whose manifest cannot be read is replaced");
        assert!(!needs_refresh("1.0.0-rc.22", Some("1.0.0-rc.22")));
        assert!(!needs_refresh("1.0.0-rc.22", None), "never installed: nothing is written");
    }

    #[test]
    fn the_reload_notice_is_shown_once_per_version() {
        assert!(reload_notice_due("", "1.0.0-rc.22"));
        assert!(reload_notice_due("1.0.0-rc.14", "1.0.0-rc.22"));
        assert!(!reload_notice_due("1.0.0-rc.22\n", "1.0.0-rc.22"));
        assert!(!reload_notice_due("", ""), "no version, no notice");
    }

    #[test]
    fn copying_the_extension_keeps_its_folders_and_the_version_reads_back() {
        let root = std::env::temp_dir().join(format!("vyre-chrome-copy-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let from = root.join("from");
        std::fs::create_dir_all(from.join("src/worker/native")).unwrap();
        std::fs::write(from.join("manifest.json"), r#"{"version":"1.0.0.3","version_name":"1.0.0-rc.3"}"#).unwrap();
        std::fs::write(from.join("src/worker/native/host.js"), "x").unwrap();
        let to = root.join("to");
        copy_dir(&from, &to).unwrap();
        assert!(to.join("src/worker/native/host.js").is_file());
        assert_eq!(manifest_version(&to), "1.0.0-rc.3");
        std::fs::remove_dir_all(root).unwrap();
    }
}
