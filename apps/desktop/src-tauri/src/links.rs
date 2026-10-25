// Deep links: vyre://<action>?<params>. The page decides what to do with one; the shell only checks
// that it is ours, bounded and well formed, and hands it over. Actions (spec 3.13): join (an invite),
// open (a Space by address), pair (a pairing code), signin.

use serde::Serialize;
use std::collections::BTreeMap;

pub const SCHEME: &str = "vyre";
pub const MAX_LEN: usize = 4096;
pub const ACTIONS: [&str; 4] = ["join", "open", "pair", "signin"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DeepLink {
    pub action: String,
    pub params: BTreeMap<String, String>,
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Percent decoding with `+` as a space. A broken escape or invalid UTF-8 refuses the whole value.
pub fn decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                let hi = hex(*bytes.get(i + 1)?)?;
                let lo = hex(*bytes.get(i + 2)?)?;
                out.push(hi * 16 + lo);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            other => {
                out.push(other);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// Parse one link. None when it is not `vyre://`, too long, names an unknown action or has a bad escape.
pub fn parse(url: &str) -> Option<DeepLink> {
    if url.len() > MAX_LEN || url.chars().any(|c| c.is_control()) {
        return None;
    }
    let rest = url.strip_prefix(SCHEME)?.strip_prefix("://")?;
    let (head, query) = match rest.split_once('?') {
        Some((h, q)) => (h, q),
        None => (rest, ""),
    };
    let query = query.split('#').next().unwrap_or("");
    let action = head.trim_end_matches('/').to_ascii_lowercase();
    if !ACTIONS.contains(&action.as_str()) {
        return None;
    }
    let mut params = BTreeMap::new();
    for pair in query.split('&').filter(|p| !p.is_empty()) {
        let (k, v) = match pair.split_once('=') {
            Some((k, v)) => (k, v),
            None => (pair, ""),
        };
        let key = decode(k)?;
        let value = decode(v)?;
        if key.is_empty() || params.len() >= 16 {
            return None;
        }
        params.insert(key, value);
    }
    Some(DeepLink { action, params })
}

/// The first argument that is a Vyre link; the second-instance and launch arguments carry it on Windows and Linux.
pub fn from_args<I: IntoIterator<Item = String>>(args: I) -> Option<DeepLink> {
    args.into_iter().find_map(|a| parse(&a))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_link_carries_address_code_and_fingerprint() {
        let l = parse("vyre://join?address=acme.vyre.run&code=ab12%2Bcd&fp=9f3c").unwrap();
        assert_eq!(l.action, "join");
        assert_eq!(l.params["address"], "acme.vyre.run");
        assert_eq!(l.params["code"], "ab12+cd");
        assert_eq!(l.params["fp"], "9f3c");
    }

    #[test]
    fn open_link_with_a_trailing_slash_and_no_query() {
        let l = parse("vyre://open/").unwrap();
        assert_eq!(l.action, "open");
        assert!(l.params.is_empty());
    }

    #[test]
    fn other_schemes_unknown_actions_and_junk_are_refused() {
        for bad in ["https://x", "vyre:join", "vyre://delete?x=1", "vyre://", "vyre://join?a=%zz", "vyre://join?a=%e2%28", "vyre://join?=x", "vyre://join\n?a=1"] {
            assert!(parse(bad).is_none(), "{bad}");
        }
        let long = format!("vyre://join?a={}", "x".repeat(MAX_LEN));
        assert!(parse(&long).is_none());
    }

    #[test]
    fn at_most_sixteen_params() {
        let many: Vec<String> = (0..17).map(|i| format!("k{i}=v")).collect();
        assert!(parse(&format!("vyre://join?{}", many.join("&"))).is_none());
    }

    #[test]
    fn arguments_yield_the_first_vyre_link() {
        let args = vec!["Vyre.exe".to_string(), "--flag".to_string(), "vyre://pair?code=1".to_string()];
        assert_eq!(from_args(args).unwrap().action, "pair");
    }
}
