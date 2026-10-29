// The desktop app updates itself (V1-SPEC 3.13): Tauri's updater reads a JSON feed from the GitHub release the app came from, downloads the bundle it names for this platform, checks its minisign
// signature against the release key pinned in tauri.conf.json and installs it. The feed and the signatures are made by scripts/release/updater.ts in the isolated sign job; the app adds no secret.
// A prerelease build (1.0.0-rc.3) reads the beta channel, a release build the stable one, the same split the servers use. The page asks with two fixed commands and passes nothing.
use serde::Serialize;
use tauri::{AppHandle, Url};
use tauri_plugin_updater::UpdaterExt;

const FEED_STABLE: &str = "https://github.com/vyre-ai/vyre-v1/releases/latest/download/desktop-stable.json";
const FEED_BETA: &str = "https://github.com/vyre-ai/vyre-v1/releases/download/channel-beta/desktop-beta.json";

/// `beta` for a prerelease version, `stable` for a release.
pub(crate) fn channel_of(version: &str) -> &'static str {
    if version.contains('-') { "beta" } else { "stable" }
}

pub(crate) fn feed_url(channel: &str) -> &'static str {
    if channel == "beta" { FEED_BETA } else { FEED_STABLE }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdate {
    pub current: String,
    pub channel: String,
    /// The newer version, when there is one.
    pub version: Option<String>,
    pub notes: Option<String>,
}

fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let channel = channel_of(&app.package_info().version.to_string());
    let url: Url = feed_url(channel).parse().map_err(|_| "The update address is not valid".to_string())?;
    app.updater_builder().endpoints(vec![url]).map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())
}

/// Is there a newer Vyre on this app's channel? A network or feed failure comes back as words, never as "up to date".
#[tauri::command]
pub async fn check_desktop_update(app: AppHandle) -> Result<DesktopUpdate, String> {
    let current = app.package_info().version.to_string();
    let channel = channel_of(&current).to_string();
    let found = updater(&app)?.check().await.map_err(|_| "Couldn’t reach the update server. Check your connection and try again.".to_string())?;
    Ok(DesktopUpdate { current, channel, version: found.as_ref().map(|u| u.version.clone()), notes: found.and_then(|u| u.body) })
}

/// Download the newer Vyre, check its signature, install it and restart. Returns only if something failed.
#[tauri::command]
pub async fn install_desktop_update(app: AppHandle) -> Result<(), String> {
    let found = updater(&app)?.check().await.map_err(|_| "Couldn’t reach the update server. Check your connection and try again.".to_string())?;
    let update = found.ok_or_else(|| "Vyre is already up to date.".to_string())?;
    update.download_and_install(|_chunk, _total| {}, || {}).await.map_err(|e| format!("The update did not install: {e}"))?;
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;
    use minisign_verify::{PublicKey, Signature};

    #[test]
    fn a_prerelease_reads_beta_and_a_release_reads_stable() {
        assert_eq!(channel_of("1.0.0-rc.3"), "beta");
        assert_eq!(channel_of("1.0.0"), "stable");
        assert!(feed_url("beta").ends_with("/channel-beta/desktop-beta.json"));
        assert!(feed_url("stable").ends_with("/releases/latest/download/desktop-stable.json"));
        assert_eq!(feed_url("stable"), serde_json::from_str::<serde_json::Value>(include_str!("../tauri.conf.json")).unwrap()["plugins"]["updater"]["endpoints"][0], "the configured address is the stable feed");
    }

    #[test]
    fn the_pinned_key_in_the_config_is_one_tauris_verifier_reads() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let b64 = conf["plugins"]["updater"]["pubkey"].as_str().unwrap();
        // the base64 of the minisign public key file, the way the updater plugin decodes it
        let bytes: Vec<u8> = {
            const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
            let mut out = Vec::new();
            let (mut acc, mut bits) = (0u32, 0u32);
            for c in b64.bytes().filter(|c| *c != b'=') {
                acc = (acc << 6) | T.iter().position(|t| *t == c).expect("base64") as u32;
                bits += 6;
                if bits >= 8 { bits -= 8; out.push((acc >> bits) as u8); acc &= (1 << bits) - 1; }
            }
            out
        };
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.starts_with("untrusted comment: minisign public key: "));
        PublicKey::decode(&text).expect("the pinned updater key parses");
    }

    #[test]
    fn a_signature_made_by_the_release_script_verifies_with_tauris_own_checker_and_only_for_its_file() {
        let key = PublicKey::decode(include_str!("../fixtures/updater/key.pub")).unwrap();
        let sig = Signature::decode(include_str!("../fixtures/updater/bundle.minisig")).unwrap();
        let data = include_bytes!("../fixtures/updater/bundle.bin");
        key.verify(data, &sig, false).expect("the signature is good for the file it was made from");
        let mut other = data.to_vec();
        other[0] ^= 1;
        assert!(key.verify(&other, &sig, false).is_err(), "and for no other file");
    }
}
