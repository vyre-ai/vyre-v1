// One managed Personal Space profile alongside the independent device daemon.
// The page cannot choose paths, executables, process arguments or remote endpoints.
use crate::sidecar::{self, Phase, Shared};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Url};

#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct PersonalSpace { pub address: String, pub space_id: String, pub claim_url: Option<String> }

fn profile(app:&AppHandle)->Result<PathBuf,String>{app.path().app_data_dir().map(|p|p.join("personal")).map_err(|_|"Couldn’t locate your Personal Space".to_string())}
pub fn profile_exists(app:&AppHandle)->bool{profile(app).map(|p|p.join("events.db").is_file()).unwrap_or(false)}

/// Stable non-secret Space identity, created before the daemon; never replace an existing profile.
pub(crate) fn profile_space_id(data:&Path)->Result<String,String>{
 let marker=data.join("personal-profile.json");
 let read=||->Result<String,String>{let value:serde_json::Value=serde_json::from_str(&std::fs::read_to_string(&marker).map_err(|_|"Couldn’t read Personal Space identity")?).map_err(|_|"Invalid Personal Space identity")?;value.get("spaceId").and_then(|s|s.as_str()).filter(|s|s.starts_with("spc_")&&s.len()<200&&s.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_')).map(str::to_string).ok_or("Invalid Personal Space identity".into())};
 if marker.exists(){return read();}
 let existing=std::fs::read_to_string(data.join("vyred.json")).ok().and_then(|s|serde_json::from_str::<serde_json::Value>(&s).ok()).and_then(|v|v.get("space").and_then(|s|s.as_str()).map(str::to_string));
 if existing.is_none()&&data.join("events.db").exists(){return Err("Existing Personal Space identity could not be read".into());}
 let id=existing.unwrap_or_else(||format!("spc_{}",uuid::Uuid::new_v4().simple()));
 let mut options=std::fs::OpenOptions::new();options.write(true).create_new(true);#[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}
 match options.open(&marker){Ok(mut file)=>{use std::io::Write;file.write_all(serde_json::json!({"spaceId":id}).to_string().as_bytes()).map_err(|_|"Couldn’t save Personal Space identity")?;file.sync_all().map_err(|_|"Couldn’t save Personal Space identity")?;},Err(error)if error.kind()==std::io::ErrorKind::AlreadyExists=>return read(),Err(_)=>return Err("Couldn’t save Personal Space identity".into())}read()
}

fn handoff(data:&Path,address:&str)->Result<PersonalSpace,String>{
 let base=Url::parse(address).map_err(|_|"Invalid local Space address")?;
 if base.scheme()!="http"||base.host_str()!=Some("127.0.0.1")||base.port().is_none()||base.path()!="/"||base.query().is_some()||base.fragment().is_some(){return Err("Invalid local Space address".into());}
 let info:serde_json::Value=serde_json::from_str(&std::fs::read_to_string(data.join("vyred.json")).map_err(|_|"Personal Space is not ready")?).map_err(|_|"Invalid Personal Space status")?;
 let space_id=info.get("space").and_then(|s|s.as_str()).filter(|s|s.starts_with("spc_")&&s.len()<200).ok_or("Missing Personal Space identity")?.to_string();
 let claim_url=match std::fs::read_to_string(data.join("logs/claim-link.txt")){
  Ok(text)=>{let raw=text.trim();let link=Url::parse(raw).map_err(|_|"Invalid Personal Space setup link")?;let token=link.path().strip_prefix("/claim/").ok_or("Invalid Personal Space setup link")?;let fields:std::collections::HashMap<_,_>=url_fields(link.fragment().unwrap_or(""));
   if link.origin()!=base.origin()||link.username()!=""||link.password().is_some()||link.query().is_some()||token.len()<16||token.len()>256||!token.bytes().all(|c|c.is_ascii_alphanumeric()||c==b'-'||c==b'_')||fields.get("s").map(String::as_str)!=Some(space_id.as_str())||raw.chars().any(char::is_control){return Err("Invalid Personal Space setup link".into());}Some(raw.to_string())},
  Err(error) if error.kind()==std::io::ErrorKind::NotFound=>None,
  Err(_)=>return Err("Couldn’t read Personal Space setup".into()),
 };
 Ok(PersonalSpace{address:address.to_string(),space_id,claim_url})
}
fn url_fields(fragment:&str)->std::collections::HashMap<String,String>{Url::parse(&format!("http://localhost/?{fragment}")).map(|u|u.query_pairs().map(|(k,v)|(k.into_owned(),v.into_owned())).collect()).unwrap_or_default()}

pub fn ensure(app:&AppHandle,shared:&Shared)->Result<PersonalSpace,String>{
 let data=profile(app)?;
 ensure_using(shared,&data,||sidecar::start(app,shared,0),sidecar::healthy,Duration::from_secs(25))
}
fn ensure_using(shared:&Shared,data:&Path,start:impl Fn(),healthy:impl Fn(&str)->bool,timeout:Duration)->Result<PersonalSpace,String>{
 let _flight=shared.ensure.lock().map_err(|_|"Personal Space startup is unavailable")?;
 let initial=sidecar::current(shared);
 if initial.phase==Phase::Ready {if let Some(ref address)=initial.url {if healthy(address){return handoff(data,address);}}}
 if matches!(initial.phase,Phase::Ready|Phase::Failed|Phase::Stopped)||!data.join("vyred.json").exists(){start();}
 let begun=Instant::now();
 while begun.elapsed()<timeout {let status=sidecar::current(shared);match status.phase{
  Phase::Ready=>{if let Some(address)=status.url{return handoff(data,&address);}},
  Phase::Failed=>return Err("Couldn’t start your Personal Space. Try again.".into()),
  Phase::Stopped=>return Err("Personal Space stopped. Try again.".into()),_=>{}
 }std::thread::sleep(Duration::from_millis(100));}
 Err("Personal Space did not start in time. Try again.".into())
}

#[cfg(test)]mod tests{
 use super::*;
 fn fixture()->PathBuf{let p=std::env::temp_dir().join(format!("vyre-personal-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));std::fs::create_dir_all(p.join("logs")).unwrap();std::fs::write(p.join("vyred.json"),r#"{"space":"spc_personal"}"#).unwrap();p}
 #[test]fn fresh_and_claimed_handoff_preserve_profile(){let p=fixture();let link="http://127.0.0.1:8421/claim/abcdefghijklmnop#s=spc_personal&fp=ab12cd34";std::fs::write(p.join("logs/claim-link.txt"),link).unwrap();let fresh=handoff(&p,"http://127.0.0.1:8421").unwrap();assert_eq!(fresh.claim_url.as_deref(),Some(link));assert_eq!(std::fs::read_to_string(p.join("logs/claim-link.txt")).unwrap(),link);std::fs::remove_file(p.join("logs/claim-link.txt")).unwrap();assert!(handoff(&p,"http://127.0.0.1:8421").unwrap().claim_url.is_none());assert!(p.join("vyred.json").exists());std::fs::remove_dir_all(p).unwrap();}
 #[test]fn rejects_nonlocal_or_mismatched_claims(){let p=fixture();for link in ["https://evil.example/claim/abcdefghijklmnop#s=spc_personal","http://127.0.0.1:9999/claim/abcdefghijklmnop#s=spc_personal","http://127.0.0.1:8421/claim/abcdefghijklmnop#s=spc_other"]{std::fs::write(p.join("logs/claim-link.txt"),link).unwrap();assert!(handoff(&p,"http://127.0.0.1:8421").is_err());}assert!(handoff(&p,"http://evil.example:8421").is_err());std::fs::remove_dir_all(p).unwrap();}
 #[test]fn missing_profile_is_not_created_by_handoff(){let p=fixture();std::fs::remove_file(p.join("vyred.json")).unwrap();assert!(handoff(&p,"http://127.0.0.1:8421").is_err());assert!(!p.join("vyred.json").exists());std::fs::remove_dir_all(p).unwrap();}
 #[test]fn concurrent_ensure_starts_once_then_reuses_identity(){use std::sync::{Arc,atomic::{AtomicUsize,Ordering}};let p=fixture();let shared=Arc::new(sidecar::Sidecar::personal());*shared.status.lock().unwrap()=Some(sidecar::Status{phase:Phase::Stopped,url:None,version:None,restarts:0,error:None});let starts=Arc::new(AtomicUsize::new(0));let mut workers=vec![];for _ in 0..8 {let(s,p,n)=(shared.clone(),p.clone(),starts.clone());workers.push(std::thread::spawn(move||ensure_using(&s,&p,||{n.fetch_add(1,Ordering::SeqCst);*s.status.lock().unwrap()=Some(sidecar::Status{phase:Phase::Ready,url:Some("http://127.0.0.1:8421".into()),version:None,restarts:0,error:None});},|_|true,Duration::from_millis(500)).unwrap().space_id));}for w in workers{assert_eq!(w.join().unwrap(),"spc_personal");}assert_eq!(starts.load(Ordering::SeqCst),1);std::fs::remove_dir_all(p).unwrap();}
 #[test]fn unavailable_runtime_leaves_existing_profile_untouched(){let p=fixture();let original=std::fs::read(p.join("vyred.json")).unwrap();let shared=std::sync::Arc::new(sidecar::Sidecar::personal());*shared.status.lock().unwrap()=Some(sidecar::Status{phase:Phase::Failed,url:None,version:None,restarts:0,error:None});let result=ensure_using(&shared,&p,||{},|_|false,Duration::from_millis(5));assert!(result.is_err());assert_eq!(std::fs::read(p.join("vyred.json")).unwrap(),original);std::fs::remove_dir_all(p).unwrap();}

 #[test]#[ignore="requires VYRE_TEST_NODE: real canonical daemon integration"]fn real_native_personal_profile_concurrency_and_restart(){
  use std::io::{BufRead,BufReader};use std::process::{Command,Stdio};use std::sync::{Arc,Mutex,atomic::{AtomicUsize,Ordering}};
  let node=std::env::var("VYRE_TEST_NODE").expect("set VYRE_TEST_NODE to the tested Node runtime");let repo=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");let p=fixture();std::fs::remove_file(p.join("vyred.json")).unwrap();let shared=Arc::new(sidecar::Sidecar::personal());let child=Arc::new(Mutex::new(None::<std::process::Child>));let starts=Arc::new(AtomicUsize::new(0));
  let boot=||{*shared.status.lock().unwrap()=Some(sidecar::Status{phase:Phase::Starting,url:None,version:None,restarts:0,error:None});starts.fetch_add(1,Ordering::SeqCst);let mut process=Command::new(&node).args(sidecar::launch_args(repo.join("host/src/daemon/main.ts"),&p,true).unwrap()).current_dir(&repo).env_remove("VYRE_ADMIN_TOKEN").stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();let output=process.stdout.take().unwrap();*child.lock().unwrap()=Some(process);let state=shared.clone();std::thread::spawn(move||{for line in BufReader::new(output).lines().map_while(Result::ok){if let Some(url)=sidecar::parse_listening(&line){*state.status.lock().unwrap()=Some(sidecar::Status{phase:Phase::Ready,url:Some(url),version:None,restarts:0,error:None});}}});};
  let first=ensure_using(&shared,&p,&boot,sidecar::healthy,Duration::from_secs(25)).unwrap();assert!(first.claim_url.is_some());assert_eq!(starts.load(Ordering::SeqCst),1);let again=ensure_using(&shared,&p,&boot,sidecar::healthy,Duration::from_secs(25)).unwrap();assert_eq!(again.space_id,first.space_id);assert_eq!(starts.load(Ordering::SeqCst),1);
  let db=rusqlite::Connection::open_with_flags(p.join("modules.db"),rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();let kind:String=db.query_row("SELECT kind FROM spaces_profile WHERE id=?1",[&first.space_id],|r|r.get(0)).unwrap();assert_eq!(kind,"personal");drop(db);std::fs::write(p.join("keep-user-file"),b"preserve").unwrap();
  let stop=|address:&str|{let token=std::fs::read_to_string(p.join("admin.token")).unwrap();assert!(sidecar::graceful_stop(address,token.trim()));let mut running=child.lock().unwrap().take().unwrap();assert!(running.wait().unwrap().success());*shared.status.lock().unwrap()=Some(sidecar::Status{phase:Phase::Stopped,url:None,version:None,restarts:0,error:None});};
  stop(&first.address);let restarted=ensure_using(&shared,&p,&boot,sidecar::healthy,Duration::from_secs(25)).unwrap();assert_eq!(restarted.space_id,first.space_id);assert_eq!(starts.load(Ordering::SeqCst),2);assert_eq!(std::fs::read(p.join("keep-user-file")).unwrap(),b"preserve");stop(&restarted.address);std::fs::remove_dir_all(p).unwrap();
 }

 #[test]fn generated_profile_identity_is_stable_unique_and_never_overwrites_unknown_data(){let first=fixture();let second=fixture();for p in [&first,&second]{std::fs::remove_file(p.join("vyred.json")).unwrap();}let id=profile_space_id(&first).unwrap();assert_eq!(profile_space_id(&first).unwrap(),id);assert_ne!(profile_space_id(&second).unwrap(),id);let original=std::fs::read(first.join("personal-profile.json")).unwrap();assert!(id.starts_with("spc_"));assert_eq!(std::fs::read(first.join("personal-profile.json")).unwrap(),original);let unknown=fixture();std::fs::remove_file(unknown.join("vyred.json")).unwrap();std::fs::write(unknown.join("events.db"),b"existing-user-data").unwrap();assert!(profile_space_id(&unknown).is_err());assert_eq!(std::fs::read(unknown.join("events.db")).unwrap(),b"existing-user-data");for p in [first,second,unknown]{std::fs::remove_dir_all(p).unwrap();}}

}
