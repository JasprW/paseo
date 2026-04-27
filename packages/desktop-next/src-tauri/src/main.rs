use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    env,
    ffi::CString,
    fs, io,
    os::raw::c_char,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
#[cfg(not(target_os = "macos"))]
use tauri::plugin::PermissionState;
use tauri::{AppHandle, Emitter, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window};
#[cfg(not(target_os = "macos"))]
use tauri_plugin_notification::NotificationExt;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use url::Url;

const BRIDGE_SCRIPT: &str = include_str!("bridge.js");
const DAEMON_LOG_FILENAME: &str = "daemon.log";
const ATTACHMENTS_DIRNAME: &str = "desktop-attachments";
const MACOS_TRAFFIC_LIGHT_X: f64 = 16.0;
const MACOS_TRAFFIC_LIGHT_TOP: f64 = 14.0;
const MACOS_TRAFFIC_LIGHT_WRY_Y_COMPENSATION: f64 = 6.0;
const SERVER_ID_FILENAME: &str = "server-id";
const PID_LOCK_FILENAME: &str = "paseo.pid";
const WS_ENDPOINT_PATH: &str = "/ws";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DaemonMode {
    Isolated,
    StableConnectOnly,
}

#[derive(Clone)]
struct AppState {
    repo_root: PathBuf,
    paseo_home: PathBuf,
    listen: String,
    npm_path: PathBuf,
    node_path: PathBuf,
    daemon_mode: DaemonMode,
}

#[derive(Default)]
struct LocalTransportState {
    next_session_id: AtomicU64,
    sessions: Arc<Mutex<HashMap<String, mpsc::UnboundedSender<Message>>>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopDaemonStatus {
    server_id: String,
    status: String,
    listen: Option<String>,
    hostname: Option<String>,
    pid: Option<u64>,
    home: String,
    version: Option<String>,
    desktop_managed: bool,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PidLockInfo {
    pid: u64,
    hostname: Option<String>,
    listen: Option<String>,
    sock_path: Option<String>,
    desktop_managed: Option<bool>,
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn paseo_notification_authorization_status() -> i32;
    fn paseo_notification_request_authorization() -> i32;
    fn paseo_notification_send(title: *const c_char, body: *const c_char) -> i32;
}

fn main() {
    run();
}

fn run() {
    let state = AppState::from_environment();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(state)
        .manage(LocalTransportState::default())
        .setup(|app| {
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Paseo Next")
                .inner_size(1200.0, 800.0)
                .min_inner_size(720.0, 560.0)
                .initialization_script(BRIDGE_SCRIPT);

            #[cfg(target_os = "macos")]
            let builder = builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                // Electron's trafficLightPosition y is a top inset. Wry treats
                // y as titlebar height minus button height, leaving the default
                // button origin in place, so compensate to match Electron.
                .traffic_light_position(tauri::LogicalPosition::new(
                    MACOS_TRAFFIC_LIGHT_X,
                    MACOS_TRAFFIC_LIGHT_TOP + MACOS_TRAFFIC_LIGHT_WRY_Y_COMPENSATION,
                ));

            let window = builder.build()?;

            #[cfg(target_os = "macos")]
            set_macos_window_background(&window, 0x18, 0x1b, 0x1a);

            let resize_window = window.clone();
            window.on_window_event(move |event| match event {
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. } => {
                    let _ = resize_window.emit("paseo:window:resized", json!({}));
                }
                _ => {}
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            paseo_invoke,
            get_pending_open_project,
            window_toggle_maximize,
            window_start_dragging,
            window_is_fullscreen,
            window_update_controls,
            window_set_badge_count,
            dialog_ask,
            dialog_open,
            notification_is_supported,
            notification_permission_state,
            notification_request_permission,
            notification_send,
            open_url,
            menu_show_context_menu
        ])
        .run(tauri::generate_context!())
        .expect("error while running Paseo Next");
}

#[cfg(target_os = "macos")]
fn set_macos_window_background(window: &WebviewWindow, red: u8, green: u8, blue: u8) {
    use cocoa::appkit::{NSColor, NSWindow};
    use cocoa::base::{id, nil};

    if let Ok(ns_window) = window.ns_window() {
        unsafe {
            let color = NSColor::colorWithRed_green_blue_alpha_(
                nil,
                red as f64 / 255.0,
                green as f64 / 255.0,
                blue as f64 / 255.0,
                1.0,
            );
            let ns_window = ns_window as id;
            ns_window.setBackgroundColor_(color);
        }
    }
}

impl AppState {
    fn from_environment() -> Self {
        let repo_root = env::var_os("PASEO_REPO_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(default_repo_root);
        let daemon_mode = resolve_daemon_mode();
        let paseo_home = resolve_paseo_home(daemon_mode);
        let listen = env::var("PASEO_NEXT_LISTEN").unwrap_or_else(|_| "127.0.0.1:0".to_string());
        let npm_path = resolve_npm_path();
        let node_path = resolve_node_path();

        Self {
            repo_root,
            paseo_home,
            listen,
            npm_path,
            node_path,
            daemon_mode,
        }
    }

    fn command_env(&self, command: &mut Command) {
        command
            .current_dir(&self.repo_root)
            .env("PASEO_HOME", &self.paseo_home)
            .env("PASEO_LISTEN", &self.listen)
            .env("PASEO_CORS_ORIGINS", "*");
        if self.can_manage_daemon() {
            command.env("PASEO_DESKTOP_MANAGED", "1");
        }
    }

    fn can_manage_daemon(&self) -> bool {
        self.daemon_mode == DaemonMode::Isolated
    }

    fn npm_cli_command(&self, args: &[&str]) -> Command {
        let mut command = Command::new(&self.npm_path);
        command.arg("run").arg("cli").arg("--").args(args);
        self.command_env(&mut command);
        command
    }

    fn daemon_runner_command(&self) -> Result<Command, String> {
        let dist_runner = self
            .repo_root
            .join("packages/server/dist/scripts/supervisor-entrypoint.js");
        let source_runner = self
            .repo_root
            .join("packages/server/scripts/supervisor-entrypoint.ts");

        let mut command = Command::new(&self.node_path);
        if dist_runner.exists() {
            command.arg(dist_runner);
        } else if source_runner.exists() {
            command.arg("--import").arg("tsx").arg(source_runner);
        } else {
            return Err(format!(
                "Daemon runner is missing. Expected {} or {}",
                dist_runner.display(),
                source_runner.display()
            ));
        }

        self.command_env(&mut command);
        Ok(command)
    }

    fn attachments_dir(&self) -> PathBuf {
        self.paseo_home.join(ATTACHMENTS_DIRNAME)
    }

    fn log_path(&self) -> PathBuf {
        self.paseo_home.join(DAEMON_LOG_FILENAME)
    }

    fn pid_lock_path(&self) -> PathBuf {
        self.paseo_home.join(PID_LOCK_FILENAME)
    }

    fn server_id_path(&self) -> PathBuf {
        self.paseo_home.join(SERVER_ID_FILENAME)
    }
}

fn default_repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .components()
        .collect()
}

fn default_paseo_next_home() -> PathBuf {
    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home).join(".paseo-next");
    }
    PathBuf::from(".paseo-next")
}

fn default_stable_paseo_home() -> PathBuf {
    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home).join(".paseo");
    }
    PathBuf::from(".paseo")
}

fn is_truthy_env(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn resolve_daemon_mode() -> DaemonMode {
    if env::var("PASEO_NEXT_CONNECT_STABLE")
        .map(|value| is_truthy_env(&value))
        .unwrap_or(false)
    {
        return DaemonMode::StableConnectOnly;
    }

    match env::var("PASEO_NEXT_DAEMON_MODE") {
        Ok(value) => match value.trim().to_ascii_lowercase().as_str() {
            "stable" | "production" | "external" | "connect-only" | "connect_only" => {
                DaemonMode::StableConnectOnly
            }
            _ => DaemonMode::Isolated,
        },
        Err(_) => DaemonMode::Isolated,
    }
}

fn resolve_paseo_home(daemon_mode: DaemonMode) -> PathBuf {
    match daemon_mode {
        DaemonMode::Isolated => env::var_os("PASEO_HOME")
            .or_else(|| env::var_os("PASEO_NEXT_HOME"))
            .map(PathBuf::from)
            .unwrap_or_else(default_paseo_next_home),
        DaemonMode::StableConnectOnly => env::var_os("PASEO_HOME")
            .or_else(|| env::var_os("PASEO_NEXT_STABLE_HOME"))
            .map(PathBuf::from)
            .unwrap_or_else(default_stable_paseo_home),
    }
}

fn resolve_npm_path() -> PathBuf {
    if let Some(path) = env::var_os("PASEO_NPM_PATH") {
        return PathBuf::from(path);
    }

    for candidate in [
        "/opt/homebrew/bin/npm",
        "/usr/local/bin/npm",
        "/usr/bin/npm",
    ] {
        let path = PathBuf::from(candidate);
        if path.exists() {
            return path;
        }
    }

    PathBuf::from("npm")
}

fn resolve_node_path() -> PathBuf {
    if let Some(path) = env::var_os("PASEO_NODE_PATH") {
        return PathBuf::from(path);
    }

    for candidate in [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ] {
        let path = PathBuf::from(candidate);
        if path.exists() {
            return path;
        }
    }

    PathBuf::from("node")
}

fn value_to_error(error: impl ToString) -> String {
    error.to_string()
}

fn value_to_trimmed_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn string_to_cstring(value: &str) -> Option<CString> {
    CString::new(value.replace('\0', "")).ok()
}

fn run_cli_text(state: &AppState, args: &[&str]) -> Result<String, String> {
    let output = state
        .npm_cli_command(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(value_to_error)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if stderr.is_empty() {
            format!(
                "CLI command failed with status {}{}",
                output.status,
                if stdout.is_empty() {
                    String::new()
                } else {
                    format!(": {stdout}")
                }
            )
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string())
}

fn extract_json(stdout: &str) -> Result<Value, String> {
    let Some(index) = stdout.find(['{', '[']) else {
        return Err("CLI output did not contain JSON.".to_string());
    };
    serde_json::from_str(&stdout[index..]).map_err(value_to_error)
}

fn run_cli_json(state: &AppState, args: &[&str]) -> Result<Value, String> {
    extract_json(&run_cli_text(state, args)?)
}

fn read_trimmed_file(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn read_pid_lock(path: &Path) -> Result<Option<PidLockInfo>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).map_err(value_to_error)?;
    serde_json::from_str::<PidLockInfo>(&content)
        .map(Some)
        .map_err(value_to_error)
}

#[cfg(unix)]
fn is_process_running(pid: u64) -> bool {
    if pid == 0 || pid > i32::MAX as u64 {
        return false;
    }

    let result = unsafe { libc::kill(pid as i32, 0) };
    if result == 0 {
        return true;
    }

    io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn is_process_running(pid: u64) -> bool {
    Command::new("tasklist")
        .arg("/FI")
        .arg(format!("PID eq {pid}"))
        .output()
        .map(|output| {
            output.status.success()
                && String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())
        })
        .unwrap_or(false)
}

fn status_from_pid_lock(state: &AppState, pid_info: &PidLockInfo) -> DesktopDaemonStatus {
    let running = is_process_running(pid_info.pid);
    DesktopDaemonStatus {
        server_id: read_trimmed_file(&state.server_id_path()).unwrap_or_default(),
        status: if running { "running" } else { "stopped" }.to_string(),
        listen: if running {
            pid_info
                .listen
                .clone()
                .or_else(|| pid_info.sock_path.clone())
                .filter(|value| !value.trim().is_empty())
        } else {
            None
        },
        hostname: if running {
            pid_info.hostname.clone()
        } else {
            None
        },
        pid: if running { Some(pid_info.pid) } else { None },
        home: state.paseo_home.to_string_lossy().to_string(),
        version: if running && state.can_manage_daemon() {
            Some(env!("CARGO_PKG_VERSION").to_string())
        } else {
            None
        },
        desktop_managed: running
            && state.can_manage_daemon()
            && pid_info.desktop_managed.unwrap_or(false),
        error: if running {
            None
        } else {
            Some(format!("Stale PID file found for PID {}", pid_info.pid))
        },
    }
}

fn desktop_daemon_status(state: &AppState) -> DesktopDaemonStatus {
    match read_pid_lock(&state.pid_lock_path()) {
        Ok(Some(pid_info)) => status_from_pid_lock(state, &pid_info),
        Ok(None) => DesktopDaemonStatus {
            server_id: read_trimmed_file(&state.server_id_path()).unwrap_or_default(),
            status: "stopped".to_string(),
            listen: None,
            hostname: None,
            pid: None,
            home: state.paseo_home.to_string_lossy().to_string(),
            version: None,
            desktop_managed: false,
            error: None,
        },
        Err(error) => DesktopDaemonStatus {
            server_id: String::new(),
            status: "stopped".to_string(),
            listen: None,
            hostname: None,
            pid: None,
            home: state.paseo_home.to_string_lossy().to_string(),
            version: None,
            desktop_managed: false,
            error: Some(error),
        },
    }
}

fn start_desktop_daemon(state: &AppState) -> Result<DesktopDaemonStatus, String> {
    let current = desktop_daemon_status(state);
    if current.status == "running" {
        return Ok(current);
    }
    if !state.can_manage_daemon() {
        return Err(format!(
            "Paseo Next is in stable daemon connect-only mode. Start the stable Paseo daemon first, then retry. Expected PID file at {}",
            state.pid_lock_path().display()
        ));
    }

    fs::create_dir_all(&state.paseo_home).map_err(value_to_error)?;
    if let Err(error) = spawn_desktop_daemon(state) {
        return Err(format!("Failed to spawn Paseo Next daemon: {error}"));
    }

    let deadline = Instant::now() + Duration::from_secs(30);
    let mut last = desktop_daemon_status(state);
    while Instant::now() < deadline {
        if last.status == "running" && last.listen.is_some() && !last.server_id.is_empty() {
            return Ok(last);
        }
        thread::sleep(Duration::from_millis(250));
        last = desktop_daemon_status(state);
    }

    Err(format!(
        "Timed out waiting for Paseo Next daemon to start. Last status: {:?}",
        last
    ))
}

fn spawn_desktop_daemon(state: &AppState) -> Result<(), String> {
    let mut command = state.daemon_runner_command()?;
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    command.spawn().map(|_| ()).map_err(value_to_error)
}

fn stop_desktop_daemon(state: &AppState) -> Result<DesktopDaemonStatus, String> {
    if !state.can_manage_daemon() {
        return Err(
            "Paseo Next is attached to the stable daemon in connect-only mode and will not stop it."
                .to_string(),
        );
    }
    let _ = run_cli_text(state, &["daemon", "stop"]);
    Ok(desktop_daemon_status(state))
}

fn restart_desktop_daemon(state: &AppState) -> Result<DesktopDaemonStatus, String> {
    if !state.can_manage_daemon() {
        return Err(
            "Paseo Next is attached to the stable daemon in connect-only mode and will not restart it."
                .to_string(),
        );
    }
    let restart_error = run_cli_text(
        state,
        &["daemon", "restart", "--listen", &state.listen, "--force"],
    )
    .err();
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut last = desktop_daemon_status(state);
    while Instant::now() < deadline {
        if last.status == "running" && last.listen.is_some() && !last.server_id.is_empty() {
            return Ok(last);
        }
        thread::sleep(Duration::from_millis(250));
        last = desktop_daemon_status(state);
    }
    let restart_error_suffix = restart_error
        .map(|error| format!(" Restart command error: {error}"))
        .unwrap_or_default();
    Err(format!(
        "Timed out waiting for Paseo Next daemon to restart.{restart_error_suffix}"
    ))
}

fn tail_file(path: &Path, lines: usize) -> String {
    fs::read_to_string(path)
        .map(|content| {
            let mut collected = content
                .lines()
                .filter(|line| !line.trim().is_empty())
                .rev()
                .take(lines)
                .collect::<Vec<_>>();
            collected.reverse();
            collected.join("\n")
        })
        .unwrap_or_default()
}

fn desktop_daemon_pairing(state: &AppState) -> Value {
    if desktop_daemon_status(state).status != "running" {
        return json!({ "relayEnabled": false, "url": null, "qr": null });
    }

    run_cli_json(state, &["daemon", "pair", "--json"])
        .unwrap_or_else(|_| json!({ "relayEnabled": false, "url": null, "qr": null }))
}

fn get_local_daemon_version(state: &AppState) -> Value {
    let status = desktop_daemon_status(state);
    if status.status != "running" {
        return json!({ "version": null, "error": "Daemon is not running." });
    }
    let version = status.version;
    let error = if version.is_some() {
        Value::Null
    } else {
        json!("Running daemon did not report a version.")
    };
    json!({
        "version": version,
        "error": error
    })
}

fn attachments_dir(state: &AppState) -> Result<PathBuf, String> {
    let dir = state.attachments_dir();
    fs::create_dir_all(&dir).map_err(value_to_error)?;
    Ok(dir)
}

fn normalize_attachment_id(value: Option<&Value>) -> Result<String, String> {
    let id = value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Attachment id is required.".to_string())?;
    if id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        Ok(id.to_string())
    } else {
        Err(format!("Invalid attachment id: {id}"))
    }
}

fn normalize_extension(value: Option<&Value>) -> Result<String, String> {
    let extension = value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(".bin")
        .to_lowercase();
    if extension.starts_with('.')
        && extension.len() >= 2
        && extension.len() <= 17
        && extension[1..].chars().all(|ch| ch.is_ascii_alphanumeric())
    {
        Ok(extension)
    } else {
        Err(format!("Invalid attachment extension: {extension}"))
    }
}

fn managed_attachment_path(state: &AppState, input: &Value) -> Result<PathBuf, String> {
    let dir = attachments_dir(state)?;
    let id = normalize_attachment_id(input.get("attachmentId"))?;
    let extension = normalize_extension(input.get("extension"))?;
    Ok(dir.join(format!("{id}{extension}")))
}

fn resolve_managed_attachment_path(state: &AppState, input: &Value) -> Result<PathBuf, String> {
    let path = input
        .get("path")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Attachment path is required.".to_string())?;
    let attachments_dir = state
        .attachments_dir()
        .canonicalize()
        .unwrap_or_else(|_| state.attachments_dir());
    let resolved = PathBuf::from(path);
    let parent = resolved
        .parent()
        .ok_or_else(|| "Invalid attachment path.".to_string())?
        .canonicalize()
        .map_err(value_to_error)?;
    if parent != attachments_dir {
        return Err("Attachment path must stay within desktop-managed storage.".to_string());
    }
    Ok(resolved)
}

fn attachment_result(path: &Path) -> Result<Value, String> {
    let byte_size = fs::metadata(path).map_err(value_to_error)?.len();
    Ok(json!({ "path": path.to_string_lossy(), "byteSize": byte_size }))
}

fn write_attachment_base64(state: &AppState, args: &Value) -> Result<Value, String> {
    let base64 = args
        .get("base64")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Attachment base64 payload is required.".to_string())?;
    let path = managed_attachment_path(state, args)?;
    let bytes = BASE64.decode(base64).map_err(value_to_error)?;
    fs::write(&path, bytes).map_err(value_to_error)?;
    attachment_result(&path)
}

fn copy_attachment_file(state: &AppState, args: &Value) -> Result<Value, String> {
    let source = args
        .get("sourcePath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Attachment source path is required.".to_string())?;
    let target = managed_attachment_path(state, args)?;
    if Path::new(source) != target {
        fs::copy(source, &target).map_err(value_to_error)?;
    }
    attachment_result(&target)
}

fn read_file_base64(state: &AppState, args: &Value) -> Result<Value, String> {
    let path = resolve_managed_attachment_path(state, args)?;
    let bytes = fs::read(path).map_err(value_to_error)?;
    Ok(json!(BASE64.encode(bytes)))
}

fn delete_attachment_file(state: &AppState, args: &Value) -> Result<Value, String> {
    let path = resolve_managed_attachment_path(state, args)?;
    let _ = fs::remove_file(path);
    Ok(json!(true))
}

fn garbage_collect_attachments(state: &AppState, args: &Value) -> Result<Value, String> {
    let dir = attachments_dir(state)?;
    let referenced = args
        .get("referencedIds")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| {
                    !value.is_empty()
                        && value
                            .chars()
                            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
                })
                .map(ToOwned::to_owned)
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();

    let mut deleted = 0u64;
    for entry in fs::read_dir(dir).map_err(value_to_error)? {
        let entry = entry.map_err(value_to_error)?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        if referenced.contains(stem) {
            continue;
        }
        if fs::remove_file(path).is_ok() {
            deleted += 1;
        }
    }
    Ok(json!(deleted))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalTransportTarget {
    transport_type: String,
    endpoint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalTransportSendInput {
    session_id: String,
    text: Option<String>,
    binary_base64: Option<String>,
}

fn emit_local_transport_event(window: &Window, payload: Value) {
    let _ = window.emit("paseo:event:local-daemon-transport-event", payload);
}

fn validate_loopback_endpoint(endpoint: &str) -> Result<String, String> {
    let endpoint = endpoint.trim();
    if endpoint.is_empty() {
        return Err("TCP local transport endpoint is required.".to_string());
    }

    let url = Url::parse(&format!("ws://{endpoint}{WS_ENDPOINT_PATH}")).map_err(value_to_error)?;
    let host = url
        .host_str()
        .ok_or_else(|| "TCP local transport endpoint must include a host.".to_string())?;
    if !matches!(host, "localhost" | "127.0.0.1" | "::1") {
        return Err(format!(
            "TCP local transport endpoint must be loopback, got {host}."
        ));
    }
    if url.port().is_none() {
        return Err("TCP local transport endpoint must include a port.".to_string());
    }

    Ok(endpoint.to_string())
}

fn parse_local_transport_target(args: &Value) -> Result<String, String> {
    let target =
        serde_json::from_value::<LocalTransportTarget>(args.clone()).map_err(value_to_error)?;
    if target.transport_type != "tcp" {
        return Err(
            "Paseo Next currently supports local transport only for TCP daemons.".to_string(),
        );
    }
    validate_loopback_endpoint(
        target
            .endpoint
            .as_deref()
            .ok_or_else(|| "TCP local transport endpoint is required.".to_string())?,
    )
}

async fn open_local_transport_session(
    window: Window,
    transport_state: &LocalTransportState,
    args: &Value,
) -> Result<Value, String> {
    let endpoint = parse_local_transport_target(args)?;
    let url = format!("ws://{endpoint}{WS_ENDPOINT_PATH}");
    let (ws, _) = tokio_tungstenite::connect_async(&url)
        .await
        .map_err(value_to_error)?;
    let session_id = format!(
        "local-session-{}",
        transport_state
            .next_session_id
            .fetch_add(1, Ordering::Relaxed)
            + 1
    );
    let (sender, mut receiver) = mpsc::unbounded_channel::<Message>();
    transport_state
        .sessions
        .lock()
        .map_err(value_to_error)?
        .insert(session_id.clone(), sender);

    let (mut writer, mut reader) = ws.split();

    let writer_session_id = session_id.clone();
    let writer_window = window.clone();
    let writer_sessions = transport_state.sessions.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(message) = receiver.recv().await {
            if let Err(error) = writer.send(message).await {
                emit_local_transport_event(
                    &writer_window,
                    json!({
                        "sessionId": &writer_session_id,
                        "kind": "error",
                        "error": error.to_string()
                    }),
                );
                if let Ok(mut sessions) = writer_sessions.lock() {
                    sessions.remove(&writer_session_id);
                }
                return;
            }
        }
        let _ = writer.send(Message::Close(None)).await;
    });

    let reader_session_id = session_id.clone();
    let reader_window = window.clone();
    let reader_sessions = transport_state.sessions.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match reader.next().await {
                Some(Ok(Message::Text(text))) => {
                    emit_local_transport_event(
                        &reader_window,
                        json!({
                            "sessionId": &reader_session_id,
                            "kind": "message",
                            "text": text.to_string()
                        }),
                    );
                }
                Some(Ok(Message::Binary(bytes))) => {
                    emit_local_transport_event(
                        &reader_window,
                        json!({
                            "sessionId": &reader_session_id,
                            "kind": "message",
                            "binaryBase64": BASE64.encode(bytes.as_ref())
                        }),
                    );
                }
                Some(Ok(Message::Close(frame))) => {
                    let (code, reason) = frame
                        .map(|value| (u16::from(value.code), value.reason.to_string()))
                        .unwrap_or((1000, String::new()));
                    emit_local_transport_event(
                        &reader_window,
                        json!({
                            "sessionId": &reader_session_id,
                            "kind": "close",
                            "code": code,
                            "reason": reason
                        }),
                    );
                    break;
                }
                Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Frame(_))) => {}
                Some(Err(error)) => {
                    emit_local_transport_event(
                        &reader_window,
                        json!({
                            "sessionId": &reader_session_id,
                            "kind": "error",
                            "error": error.to_string()
                        }),
                    );
                    break;
                }
                None => {
                    emit_local_transport_event(
                        &reader_window,
                        json!({
                            "sessionId": &reader_session_id,
                            "kind": "close",
                            "code": 1000,
                            "reason": ""
                        }),
                    );
                    break;
                }
            }
        }
        if let Ok(mut sessions) = reader_sessions.lock() {
            sessions.remove(&reader_session_id);
        }
    });

    Ok(json!(session_id))
}

fn send_local_transport_message(
    transport_state: &LocalTransportState,
    args: &Value,
) -> Result<Value, String> {
    let input =
        serde_json::from_value::<LocalTransportSendInput>(args.clone()).map_err(value_to_error)?;
    let message = if let Some(text) = input.text {
        Message::Text(text.into())
    } else if let Some(binary_base64) = input.binary_base64 {
        Message::Binary(BASE64.decode(binary_base64).map_err(value_to_error)?.into())
    } else {
        return Err("Local transport send requires text or binaryBase64.".to_string());
    };

    let sender = transport_state
        .sessions
        .lock()
        .map_err(value_to_error)?
        .get(&input.session_id)
        .cloned()
        .ok_or_else(|| format!("Local transport session not found: {}", input.session_id))?;
    sender.send(message).map_err(value_to_error)?;
    Ok(json!(true))
}

fn close_local_transport_session(
    transport_state: &LocalTransportState,
    args: &Value,
) -> Result<Value, String> {
    let session_id = args
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Local transport session id is required.".to_string())?;
    if let Some(sender) = transport_state
        .sessions
        .lock()
        .map_err(value_to_error)?
        .remove(session_id)
    {
        let _ = sender.send(Message::Close(None));
    }
    Ok(json!(true))
}

#[tauri::command]
async fn paseo_invoke(
    window: Window,
    state: tauri::State<'_, AppState>,
    transport_state: tauri::State<'_, LocalTransportState>,
    command: String,
    args: Option<Value>,
) -> Result<Value, String> {
    let args = args.unwrap_or(Value::Null);
    let state = state.inner();
    match command.as_str() {
        "desktop_daemon_status" => {
            serde_json::to_value(desktop_daemon_status(state)).map_err(value_to_error)
        }
        "start_desktop_daemon" => {
            serde_json::to_value(start_desktop_daemon(state)?).map_err(value_to_error)
        }
        "stop_desktop_daemon" => {
            serde_json::to_value(stop_desktop_daemon(state)?).map_err(value_to_error)
        }
        "restart_desktop_daemon" => {
            serde_json::to_value(restart_desktop_daemon(state)?).map_err(value_to_error)
        }
        "desktop_daemon_logs" => Ok(json!({
            "logPath": state.log_path().to_string_lossy(),
            "contents": tail_file(&state.log_path(), 100)
        })),
        "desktop_daemon_pairing" => Ok(desktop_daemon_pairing(state)),
        "desktop_get_system_idle_time" => Ok(json!(0)),
        "cli_daemon_status" => Ok(json!(run_cli_text(state, &["daemon", "status"])?)),
        "write_attachment_base64" => write_attachment_base64(state, &args),
        "copy_attachment_file" => copy_attachment_file(state, &args),
        "read_file_base64" => read_file_base64(state, &args),
        "delete_attachment_file" => delete_attachment_file(state, &args),
        "garbage_collect_attachment_files" => garbage_collect_attachments(state, &args),
        "check_app_update" => Ok(json!({
            "hasUpdate": false,
            "readyToInstall": false,
            "currentVersion": env!("CARGO_PKG_VERSION"),
            "latestVersion": env!("CARGO_PKG_VERSION"),
            "body": null,
            "date": null
        })),
        "install_app_update" => Ok(json!({
            "installed": false,
            "version": null,
            "message": "Paseo Next does not support in-app updates yet."
        })),
        "run_local_daemon_update" => Ok(json!({
            "exitCode": 1,
            "stdout": "",
            "stderr": "Paseo Next does not support daemon self-update yet."
        })),
        "get_local_daemon_version" => Ok(get_local_daemon_version(state)),
        "install_cli"
        | "get_cli_install_status"
        | "install_skills"
        | "get_skills_install_status" => Ok(json!({ "installed": false })),
        "open_local_daemon_transport" => {
            open_local_transport_session(window, transport_state.inner(), &args).await
        }
        "send_local_daemon_transport_message" => {
            send_local_transport_message(transport_state.inner(), &args)
        }
        "close_local_daemon_transport" => {
            close_local_transport_session(transport_state.inner(), &args)
        }
        _ => Err(format!("Unknown desktop command: {command}")),
    }
}

#[tauri::command]
fn get_pending_open_project() -> Option<String> {
    None
}

#[tauri::command]
fn window_toggle_maximize(window: Window) -> Result<(), String> {
    if window.is_maximized().map_err(value_to_error)? {
        window.unmaximize().map_err(value_to_error)
    } else {
        window.maximize().map_err(value_to_error)
    }
}

#[tauri::command]
fn window_start_dragging(window: Window) -> Result<(), String> {
    window.start_dragging().map_err(value_to_error)
}

#[tauri::command]
fn window_is_fullscreen(window: Window) -> Result<bool, String> {
    window.is_fullscreen().map_err(value_to_error)
}

#[tauri::command]
fn window_update_controls(_window: Window, _update: Option<Value>) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn window_set_badge_count(_window: Window, _count: Option<u64>) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn dialog_ask(message: String, options: Option<Value>) -> Result<bool, String> {
    let title = options
        .as_ref()
        .and_then(|value| value.get("title"))
        .and_then(Value::as_str)
        .unwrap_or("Confirm");

    let result = rfd::MessageDialog::new()
        .set_title(title)
        .set_description(&message)
        .set_buttons(rfd::MessageButtons::OkCancel)
        .show();

    Ok(matches!(result, rfd::MessageDialogResult::Ok))
}

#[tauri::command]
fn dialog_open(options: Option<Value>) -> Result<Value, String> {
    let options = options.unwrap_or(Value::Null);
    let mut dialog = rfd::FileDialog::new();

    if let Some(title) = options.get("title").and_then(Value::as_str) {
        dialog = dialog.set_title(title);
    }
    if let Some(default_path) = options.get("defaultPath").and_then(Value::as_str) {
        dialog = dialog.set_directory(default_path);
    }
    if let Some(filters) = options.get("filters").and_then(Value::as_array) {
        for filter in filters {
            let Some(name) = filter.get("name").and_then(Value::as_str) else {
                continue;
            };
            let extensions = filter
                .get("extensions")
                .and_then(Value::as_array)
                .map(|values| values.iter().filter_map(Value::as_str).collect::<Vec<_>>())
                .unwrap_or_default();
            if !extensions.is_empty() {
                dialog = dialog.add_filter(name, &extensions);
            }
        }
    }

    let directory = options
        .get("directory")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let multiple = options
        .get("multiple")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    if directory {
        if multiple {
            let paths = dialog
                .pick_folders()
                .unwrap_or_default()
                .into_iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect::<Vec<_>>();
            return if paths.is_empty() {
                Ok(Value::Null)
            } else {
                Ok(json!(paths))
            };
        }
        return Ok(dialog
            .pick_folder()
            .map(|path| json!(path.to_string_lossy().to_string()))
            .unwrap_or(Value::Null));
    }

    if multiple {
        let paths = dialog
            .pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        return if paths.is_empty() {
            Ok(Value::Null)
        } else {
            Ok(json!(paths))
        };
    }

    Ok(dialog
        .pick_file()
        .map(|path| json!(path.to_string_lossy().to_string()))
        .unwrap_or(Value::Null))
}

#[tauri::command]
fn notification_is_supported(app: AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        return true;
    }
    #[cfg(not(target_os = "macos"))]
    app.notification().permission_state().is_ok()
}

#[tauri::command]
fn notification_permission_state(app: AppHandle) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        return Ok(macos_notification_permission_state_to_string(unsafe {
            paseo_notification_authorization_status()
        })
        .to_string());
    }
    #[cfg(not(target_os = "macos"))]
    app.notification()
        .permission_state()
        .map(notification_permission_state_to_string)
        .map(ToString::to_string)
        .map_err(value_to_error)
}

#[tauri::command]
fn notification_request_permission(app: AppHandle) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        return Ok(macos_notification_permission_state_to_string(unsafe {
            paseo_notification_request_authorization()
        })
        .to_string());
    }
    #[cfg(not(target_os = "macos"))]
    app.notification()
        .request_permission()
        .map(notification_permission_state_to_string)
        .map(ToString::to_string)
        .map_err(value_to_error)
}

#[cfg(target_os = "macos")]
fn macos_notification_permission_state_to_string(permission: i32) -> &'static str {
    match permission {
        1 => "denied",
        2 => "granted",
        _ => "default",
    }
}

#[cfg(not(target_os = "macos"))]
fn notification_permission_state_to_string(permission: PermissionState) -> &'static str {
    match permission {
        PermissionState::Granted => "granted",
        PermissionState::Denied => "denied",
        PermissionState::Prompt | PermissionState::PromptWithRationale => "default",
    }
}

#[tauri::command]
fn notification_send(app: AppHandle, payload: Option<Value>) -> bool {
    #[cfg(target_os = "macos")]
    let _ = app;
    let payload = payload.unwrap_or(Value::Null);
    let title = match payload.as_str() {
        Some(title) => Some(title.trim().to_string()),
        None => value_to_trimmed_string(payload.get("title")),
    }
    .filter(|title| !title.is_empty());
    let Some(title) = title else {
        return false;
    };

    #[cfg(target_os = "macos")]
    {
        let Some(title) = string_to_cstring(&title) else {
            return false;
        };
        let body =
            value_to_trimmed_string(payload.get("body")).and_then(|body| string_to_cstring(&body));
        return unsafe {
            paseo_notification_send(
                title.as_ptr(),
                body.as_ref()
                    .map(|body| body.as_ptr())
                    .unwrap_or(std::ptr::null()),
            )
        } == 1;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let mut notification = app.notification().builder().title(title).silent();
        if let Some(body) = value_to_trimmed_string(payload.get("body")) {
            notification = notification.body(body);
        }

        notification.show().is_ok()
    }
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open::that(url).map_err(value_to_error)
}

#[tauri::command]
fn menu_show_context_menu(_input: Option<Value>) -> Result<(), String> {
    Ok(())
}
