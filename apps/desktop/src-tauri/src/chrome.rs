// "Install Vyre for Chrome": there is no Web Store listing yet, so the app puts the extension in a folder of its own, tells Chrome where the native messaging host is, and shows the three clicks Chrome
// needs (Developer mode, Load unpacked, pick the folder). What the page can ask for is fixed: install, open Chrome's extensions page, show the folder. It supplies no path and no program.
//
//   <app data>/chrome-extension/        a copy of the extension from the app bundle (runtime/chrome-extension, versioned with the app by stage-runtime.ts), replaced on every install
//   <app data>/chrome-host/             run-vyre-bridge (.cmd on Windows): runs the bundled Node on the extension's native host, and run.vyre.bridge.json filled from the extension's template
//   each installed browser's NativeMessagingHosts folder (the registry on Windows) gets that manifest, naming this extension's id and no other origin
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// The id Chrome gives the extension: the manifest pins a public key, and this is derived from it (a test in apps/chrome/tests/ext-identity.test.ts holds the two together).
pub const EXTENSION_ID: &str = "agdepmcadbenjfbhekgifcijiabnpego";
pub const HOST_NAME: &str = "run.vyre.bridge";
/// The extension's own template; the two places to fill are __HOST_PATH__ and __EXTENSION_ID__.
const HOST_TEMPLATE: &str = include_str!("../../../chrome/src/worker/native/run.vyre.bridge.json");

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

/// Where each browser keeps native messaging host manifests, as (browser, the folder that exists when it is installed, the folder to write into). Unix only; Windows uses the registry.
#[cfg_attr(windows, allow(dead_code))]
pub(crate) fn browser_dirs(os: &str, home: &Path) -> Vec<(&'static str, PathBuf, PathBuf)> {
    let mac = os == "macos";
    let base = |mac_path: &str, linux_path: &str| -> PathBuf {
        if mac { home.join("Library/Application Support").join(mac_path) } else { home.join(".config").join(linux_path) }
    };
    [
        ("Google Chrome", base("Google/Chrome", "google-chrome")),
        ("Chromium", base("Chromium", "chromium")),
        ("Microsoft Edge", base("Microsoft Edge", "microsoft-edge")),
        ("Brave", base("BraveSoftware/Brave-Browser", "BraveSoftware/Brave-Browser")),
    ]
    .into_iter()
    .map(|(name, dir)| (name, dir.clone(), dir.join("NativeMessagingHosts")))
    .collect()
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
    for (name, key) in [("Google Chrome", r"Software\Google\Chrome"), ("Chromium", r"Software\Chromium"), ("Microsoft Edge", r"Software\Microsoft\Edge"), ("Brave", r"Software\BraveSoftware\Brave-Browser")] {
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
        assert_eq!(linux.len(), 4);
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
