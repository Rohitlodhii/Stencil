use serde::Serialize;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, State};

struct ScannerProcess(Mutex<Option<Child>>);

#[derive(Serialize)]
struct ScannerLaunchResult {
    started: bool,
    already_running: bool,
    executable: Option<String>,
}

fn scanner_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("STENCIL_SCANNER_EXECUTABLE") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            candidates.push(parent.join(if cfg!(windows) { "StencilScanner.exe" } else { "stencil-scanner" }));
        }
    }
    #[cfg(target_os = "windows")]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local).join("Programs/Stencil Scanner/StencilScanner.exe"));
    }
    #[cfg(target_os = "macos")]
    candidates.push(PathBuf::from("/Applications/Stencil Scanner.app/Contents/MacOS/StencilScanner"));
    #[cfg(target_os = "linux")]
    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join(".local/bin/stencil-scanner"));
    }
    candidates
}

fn child_is_running(slot: &mut Option<Child>) -> bool {
    match slot.as_mut() {
        Some(child) => match child.try_wait() {
            Ok(None) => true,
            _ => {
                *slot = None;
                false
            }
        },
        None => false,
    }
}

#[tauri::command]
fn scanner_companion_status(state: State<'_, ScannerProcess>) -> bool {
    let mut child = state.0.lock().expect("scanner process lock poisoned");
    child_is_running(&mut child)
}

#[tauri::command]
fn start_scanner_companion(state: State<'_, ScannerProcess>) -> Result<ScannerLaunchResult, String> {
    let mut slot = state.0.lock().map_err(|_| "Scanner process state is unavailable.".to_string())?;
    if child_is_running(&mut slot) {
        return Ok(ScannerLaunchResult { started: false, already_running: true, executable: None });
    }

    let executable = scanner_candidates()
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| "Stencil Scanner Companion is not installed. Open Downloads to get an available installer.".to_string())?;

    let mut command = Command::new(&executable);
    command.env("STENCIL_SCANNER_OPEN_STATUS", "false").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let child = command.spawn().map_err(|error| format!("Could not start scanner companion: {error}"))?;
    let display_path = executable.to_string_lossy().to_string();
    *slot = Some(child);
    Ok(ScannerLaunchResult { started: true, already_running: false, executable: Some(display_path) })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ScannerProcess(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![scanner_companion_status, start_scanner_companion])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let state = window.state::<ScannerProcess>();
                if let Ok(mut slot) = state.0.lock() {
                    if let Some(child) = slot.as_mut() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                    *slot = None;
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
