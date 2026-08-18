use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter};

pub struct TermHandle {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
}

#[derive(Default)]
pub struct Terminals(pub Mutex<HashMap<String, TermHandle>>);

#[derive(Clone, serde::Serialize)]
pub struct TermData {
    pub data: String,
}

fn shell_cmd() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(p) = std::env::var("SystemRoot") {
            let ps = format!("{p}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
            if std::path::Path::new(&ps).exists() {
                return ps;
            }
        }
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| {
            if std::path::Path::new("/bin/bash").exists() {
                "/bin/bash".to_string()
            } else if std::path::Path::new("/bin/zsh").exists() {
                "/bin/zsh".to_string()
            } else {
                "/bin/sh".to_string()
            }
        })
    }
}


#[allow(dead_code)]
pub fn system_shell() -> String {
    shell_cmd()
}


pub fn spawn(
    app: &AppHandle,
    id: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    terminals: &Terminals,
) -> Result<(), String> {
    if terminals.0.lock().unwrap().contains_key(&id) {
        return Ok(());
    }
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new(shell_cmd());
    if let Some(target_dir) = cwd.filter(|s| !s.trim().is_empty()) {
        cmd.cwd(target_dir);
    } else if let Some(home) = dirs::home_dir() {
        cmd.cwd(home);
    } else if let Ok(dir) = std::env::current_dir() {
        cmd.cwd(dir);
    }
    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let app2 = app.clone();
    let rid = id.clone();
    std::thread::spawn(move || {
        let mut r = reader;
        let mut buf = [0u8; 8192];
        loop {
            match r.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app2.emit(&format!("term-data-{rid}"), TermData { data });
                }
            }
        }
        let _ = app2.emit(&format!("term-exit-{rid}"), ());
    });

    terminals
        .0
        .lock()
        .unwrap()
        .insert(id, TermHandle { master: pair.master, writer });
    Ok(())
}

pub fn write(terminals: &Terminals, id: &str, data: &str) -> Result<(), String> {
    let mut map = terminals.0.lock().unwrap();
    let h = map.get_mut(id).ok_or("terminal no encontrado")?;
    h.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    h.writer.flush().map_err(|e| e.to_string())
}

pub fn resize(terminals: &Terminals, id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let map = terminals.0.lock().unwrap();
    let h = map.get(id).ok_or("terminal no encontrado")?;
    h.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

pub fn kill(terminals: &Terminals, id: &str) {
    let mut map = terminals.0.lock().unwrap();
    map.remove(id);
}
