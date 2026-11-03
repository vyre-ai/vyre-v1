// The Windows sandbox for team chats (RULINGS 15): a Team Space turn that runs on this computer runs in Vyre's own WSL2 Linux under bubblewrap (modules/engine/node-cli.ts). WSL is turned on
// once, with administrator rights and a restart; until then this computer offers no engine to a Team Space and Automatic runs those turns on the server.
//   windows_sandbox_state()   { supported, on }: Windows, and `wsl --status` answers
//   setup_windows_sandbox()   runs `wsl --install --no-distribution` elevated: Windows asks for consent (UAC). The page supplies no program, path or argument.
use serde::Serialize;

#[derive(Serialize)]
pub struct WinSandbox {
    pub supported: bool,
    pub on: bool,
}

#[cfg(windows)]
fn system32(file: &str) -> std::path::PathBuf {
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    std::path::Path::new(&root).join("System32").join(file)
}

#[cfg(windows)]
fn quiet(cmd: &mut std::process::Command) -> &mut std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW)
}

#[tauri::command]
pub fn windows_sandbox_state() -> WinSandbox {
    #[cfg(windows)]
    {
        let on = quiet(std::process::Command::new(system32("wsl.exe")).arg("--status").env("WSL_UTF8", "1"))
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        WinSandbox { supported: true, on }
    }
    #[cfg(not(windows))]
    {
        WinSandbox { supported: false, on: false }
    }
}

/// Turns WSL on. Windows shows its consent prompt; a "no" there, or a Windows that cannot, comes back as the reason. A restart finishes it.
#[tauri::command]
pub async fn setup_windows_sandbox() -> Result<String, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(|| {
            let wsl = system32("wsl.exe");
            let script = format!(
                "$p = Start-Process -FilePath '{}' -ArgumentList '--install','--no-distribution' -Verb RunAs -Wait -PassThru; exit $p.ExitCode",
                wsl.display().to_string().replace('\'', "''")
            );
            let out = quiet(std::process::Command::new(system32("WindowsPowerShell\\v1.0\\powershell.exe")).args(["-NoProfile", "-NonInteractive", "-Command", script.as_str()])).output();
            match out {
                Ok(o) if o.status.success() => Ok("restart".to_string()),
                Ok(_) => Err("Windows did not turn WSL on. If you said no to the prompt, try again and choose Yes.".to_string()),
                Err(_) => Err("Windows could not start the WSL setup.".to_string()),
            }
        })
        .await
        .map_err(|_| "The WSL setup stopped.".to_string())?
    }
    #[cfg(not(windows))]
    {
        Err("This is only for Windows.".to_string())
    }
}
