#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Command, Stdio};
use serde::{Deserialize, Serialize};
use tokio::process::Command as AsyncCommand;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{Emitter, Listener};
use lazy_static::lazy_static;

// Global session tracking for Claude Code
lazy_static! {
    static ref CURRENT_SESSION_ID: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
}

#[derive(Debug, Serialize, Deserialize)]
struct Project {
    name: String,
    path: String,
    last_modified: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
    timestamp: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct IDE {
    name: String,
    command: String,
    args: Vec<String>,
    available: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct FileInfo {
    name: String,
    path: String,
    size: u64,
    mime_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
enum ClaudeStreamEvent {
    #[serde(rename = "status")]
    Status { message: String, timestamp: u64 },
    #[serde(rename = "thinking")]
    Thinking { message: String, timestamp: u64 },
    #[serde(rename = "token_usage")]
    TokenUsage { input: u32, output: u32, total: u32, timestamp: u64 },
    #[serde(rename = "context_status")]
    ContextStatus { percentage: f32, remaining: String, timestamp: u64 },
    #[serde(rename = "permission_request")]
    PermissionRequest { 
        id: String,
        prompt: String, 
        options: Vec<String>,
        timestamp: u64 
    },
    #[serde(rename = "response")]
    Response { content: String, timestamp: u64 },
    #[serde(rename = "error")]
    Error { message: String, timestamp: u64 },
    #[serde(rename = "complete")]
    Complete { timestamp: u64 },
}

// Claude's native stream-json event format
#[derive(Debug, Serialize, Deserialize, Clone)]
struct ClaudeJsonEvent {
    #[serde(rename = "type")]
    event_type: String,
    subtype: Option<String>,
    message: Option<ClaudeMessage>,
    result: Option<String>,
    session_id: Option<String>,
    usage: Option<ClaudeUsage>,
    total_cost_usd: Option<f64>,
    duration_ms: Option<u64>,
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ClaudeMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ClaudeUsage {
    input_tokens: u32,
    output_tokens: u32,
    total_tokens: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PermissionResponse {
    id: String,
    choice: u32, // 1, 2, or 3
    custom_action: Option<String>, // For choice 3
}

#[tauri::command]
async fn get_claude_projects() -> Result<Vec<Project>, String> {
    let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
    let claude_dir = home_dir.join(".claude").join("projects");
    
    if !claude_dir.exists() {
        return Ok(vec![]);
    }
    
    let mut projects = Vec::new();
    
    if let Ok(entries) = std::fs::read_dir(&claude_dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                let project_name = entry.file_name().to_string_lossy().to_string();
                let project_path = entry.path().to_string_lossy().to_string();
                
                // Get last modified time
                let modified = entry.metadata()
                    .and_then(|m| m.modified())
                    .map(|t| format!("{:?}", t))
                    .unwrap_or_else(|_| "Unknown".to_string());
                
                projects.push(Project {
                    name: project_name,
                    path: project_path,
                    last_modified: modified,
                });
            }
        }
    }
    
    Ok(projects)
}

#[tauri::command]
async fn execute_claude_command(args: Vec<String>) -> Result<String, String> {
    let output = Command::new("claude")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute claude command: {}", e))?;
    
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
async fn get_project_sessions(project_path: String) -> Result<Vec<serde_json::Value>, String> {
    let mut sessions = Vec::new();
    
    if let Ok(entries) = std::fs::read_dir(&project_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
                let file_name = path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string();
                
                // Read first and last few lines to get session info
                if let Ok(content) = std::fs::read_to_string(&path) {
                    let lines: Vec<&str> = content.lines().collect();
                    let message_count = lines.len();
                    
                    let mut last_message = "No messages".to_string();
                    let mut timestamp = "".to_string();
                    
                    // Get the last message
                    if let Some(last_line) = lines.last() {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(last_line) {
                            if let Some(msg) = json.get("message") {
                                if let Some(content) = msg.get("content") {
                                    if let Some(content_str) = content.as_str() {
                                        last_message = content_str.chars().take(100).collect::<String>();
                                        if content_str.len() > 100 {
                                            last_message.push_str("...");
                                        }
                                    }
                                }
                            }
                            if let Some(ts) = json.get("timestamp") {
                                if let Some(ts_str) = ts.as_str() {
                                    timestamp = ts_str.to_string();
                                }
                            }
                        }
                    }
                    
                    let session_info = serde_json::json!({
                        "id": file_name,
                        "name": file_name.replace("-", " ").replace("_", " "),
                        "lastMessage": last_message,
                        "timestamp": timestamp,
                        "messageCount": message_count,
                        "filePath": path.to_string_lossy()
                    });
                    
                    sessions.push(session_info);
                }
            }
        }
    }
    
    // Sort by timestamp (newest first)
    sessions.sort_by(|a, b| {
        let ts_a = a.get("timestamp").and_then(|t| t.as_str()).unwrap_or("");
        let ts_b = b.get("timestamp").and_then(|t| t.as_str()).unwrap_or("");
        ts_b.cmp(ts_a)
    });
    
    Ok(sessions)
}

#[tauri::command]
async fn detect_available_ides() -> Result<Vec<IDE>, String> {
    let mut ides = Vec::new();
    
    // Common IDEs to detect
    let ide_configs = vec![
        ("Visual Studio Code", "code", vec![]),
        ("VSCode Insiders", "code-insiders", vec![]),
        ("Sublime Text", "subl", vec![]),
        ("Atom", "atom", vec![]),
        ("WebStorm", "webstorm", vec![]),
        ("IntelliJ IDEA", "idea", vec![]),
        ("PhpStorm", "phpstorm", vec![]),
        ("PyCharm", "pycharm", vec![]),
        ("Vim", "vim", vec![]),
        ("Neovim", "nvim", vec![]),
        ("Emacs", "emacs", vec![]),
        ("Nano", "nano", vec![]),
    ];
    
    for (name, command, default_args) in ide_configs {
        let available = Command::new("which")
            .arg(command)
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false);
        
        ides.push(IDE {
            name: name.to_string(),
            command: command.to_string(),
            args: default_args,
            available,
        });
    }
    
    // On macOS, also check for apps in /Applications
    #[cfg(target_os = "macos")]
    {
        let app_configs = vec![
            ("Visual Studio Code", "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code", vec![]),
            ("Sublime Text", "/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl", vec![]),
            ("Xcode", "xed", vec![]),
        ];
        
        for (name, path, default_args) in app_configs {
            let available = std::path::Path::new(path).exists() || 
                Command::new("which")
                    .arg(path.split('/').last().unwrap_or(path))
                    .output()
                    .map(|output| output.status.success())
                    .unwrap_or(false);
            
            if available && !ides.iter().any(|ide| ide.name == name) {
                ides.push(IDE {
                    name: name.to_string(),
                    command: path.to_string(),
                    args: default_args,
                    available: true,
                });
            }
        }
    }
    
    Ok(ides)
}

#[tauri::command]
async fn open_file_in_ide(ide_command: String, file_path: String, line: Option<u32>) -> Result<(), String> {
    let mut cmd = Command::new(&ide_command);
    
    // Add line number support for common IDEs
    if let Some(line_num) = line {
        match ide_command.as_str() {
            "code" | "code-insiders" => {
                cmd.arg("--goto").arg(format!("{}:{}", file_path, line_num));
            },
            "subl" => {
                cmd.arg(format!("{}:{}", file_path, line_num));
            },
            "atom" => {
                cmd.arg(format!("{}:{}", file_path, line_num));
            },
            "vim" | "nvim" => {
                cmd.arg(format!("+{}", line_num)).arg(&file_path);
            },
            _ => {
                cmd.arg(&file_path);
            }
        }
    } else {
        cmd.arg(&file_path);
    }
    
    cmd.spawn()
        .map_err(|e| format!("Failed to open file in IDE: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn open_project_in_ide(ide_command: String, project_path: String) -> Result<(), String> {
    Command::new(&ide_command)
        .arg(&project_path)
        .spawn()
        .map_err(|e| format!("Failed to open project in IDE: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn get_file_info(file_path: String) -> Result<FileInfo, String> {
    let path = std::path::Path::new(&file_path);
    
    if !path.exists() {
        return Err("File does not exist".to_string());
    }
    
    let metadata = path.metadata()
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;
    
    let name = path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();
    
    // Simple MIME type detection based on extension
    let mime_type = match path.extension().and_then(|s| s.to_str()) {
        Some("txt") | Some("md") | Some("markdown") => "text/plain",
        Some("js") | Some("jsx") => "text/javascript",
        Some("ts") | Some("tsx") => "text/typescript", 
        Some("py") => "text/x-python",
        Some("rs") => "text/x-rust",
        Some("json") => "application/json",
        Some("html") | Some("htm") => "text/html",
        Some("css") => "text/css",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }.to_string();
    
    Ok(FileInfo {
        name,
        path: file_path,
        size: metadata.len(),
        mime_type,
    })
}

#[tauri::command]
async fn get_project_files(project_path: String, pattern: Option<String>) -> Result<Vec<FileInfo>, String> {
    let mut files = Vec::new();
    
    // First get the real project path (same as CLAUDE.md functionality)
    let real_path = match get_real_project_path(project_path).await? {
        Some(path) => path,
        None => return Err("Could not find real project path".to_string())
    };
    
    let path = std::path::Path::new(&real_path);
    
    if !path.exists() {
        return Err("Real project path does not exist".to_string());
    }
    
    fn scan_directory(dir: &std::path::Path, files: &mut Vec<FileInfo>, pattern: &Option<String>) -> Result<(), String> {
        let entries = std::fs::read_dir(dir)
            .map_err(|e| format!("Failed to read directory: {}", e))?;
        
        for entry in entries.flatten() {
            let path = entry.path();
            
            // Skip hidden files and common ignore patterns
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with('.') || name == "node_modules" || name == "target" || name == "dist" {
                    continue;
                }
            }
            
            if path.is_file() {
                if let Some(pattern_str) = pattern {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        if !name.contains(pattern_str) {
                            continue;
                        }
                    }
                }
                
                if let Ok(file_info) = get_file_info_sync(&path) {
                    files.push(file_info);
                }
            } else if path.is_dir() && files.len() < 1000 { // Limit to prevent overwhelming
                let _ = scan_directory(&path, files, pattern);
            }
        }
        
        Ok(())
    }
    
    scan_directory(path, &mut files, &pattern)?;
    files.sort_by(|a, b| a.name.cmp(&b.name));
    
    Ok(files)
}

fn get_file_info_sync(path: &std::path::Path) -> Result<FileInfo, String> {
    let metadata = path.metadata()
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;
    
    let name = path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();
    
    let mime_type = match path.extension().and_then(|s| s.to_str()) {
        Some("txt") | Some("md") | Some("markdown") => "text/plain",
        Some("js") | Some("jsx") => "text/javascript",
        Some("ts") | Some("tsx") => "text/typescript",
        Some("py") => "text/x-python",
        Some("rs") => "text/x-rust",
        Some("json") => "application/json",
        Some("html") | Some("htm") => "text/html",
        Some("css") => "text/css",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }.to_string();
    
    Ok(FileInfo {
        name,
        path: path.to_string_lossy().to_string(),
        size: metadata.len(),
        mime_type,
    })
}

#[tauri::command]
async fn test_streaming_events(app: tauri::AppHandle) -> Result<String, String> {
    // Test Claude command directly
    let _ = app.emit("claude_stream", ClaudeStreamEvent::Status {
        message: "Testing Claude command directly...".to_string(),
        timestamp: 1,
    });
    
    // Test a simple Claude command that should work
    let output = AsyncCommand::new("claude")
        .args(&["--print", "hello world"])
        .current_dir(std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")))
        .output()
        .await
        .map_err(|e| format!("Failed to execute Claude: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    
    let _ = app.emit("claude_stream", ClaudeStreamEvent::Status {
        message: format!("Claude stdout: {}", stdout.chars().take(100).collect::<String>()),
        timestamp: 2,
    });
    
    if !stderr.is_empty() {
        let _ = app.emit("claude_stream", ClaudeStreamEvent::Status {
            message: format!("Claude stderr: {}", stderr.chars().take(100).collect::<String>()),
            timestamp: 3,
        });
    }
    
    Ok(format!("Test completed. Exit code: {:?}", output.status.code()))
}

#[tauri::command]
async fn execute_claude_command_streaming(
    app: tauri::AppHandle,
    args: Vec<String>, 
    files: Vec<String>,
    enable_autocomplete: bool,
    plan_mode: bool
) -> Result<String, String> {
    // Start with simple text format to debug the core issue
    let mut command_args = vec![
        "--print".to_string()
    ];
    
    // Check if we have an existing session ID to continue
    if let Ok(session_guard) = CURRENT_SESSION_ID.try_lock() {
        if let Some(session_id) = session_guard.as_ref() {
            command_args.push("--session-id".to_string());
            command_args.push(session_id.clone());
        }
    }
    
    // Add plan mode flag if enabled
    if plan_mode {
        command_args.push("--permission-mode".to_string());
        command_args.push("plan".to_string());
    }
    
    // Add files as direct arguments before the prompt
    for file in files {
        command_args.push(file);
    }
    
    // Add the user message as the last argument
    if let Some(message) = args.first() {
        command_args.push(message.clone());
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    // Emit initial status
    let _ = app.emit("claude_stream", ClaudeStreamEvent::Status {
        message: "Starting Claude Code...".to_string(),
        timestamp,
    });

    // Emit command start info
    let _ = app.emit("claude_stream", ClaudeStreamEvent::Status {
        message: format!("Executing: claude {}", command_args.join(" ")),
        timestamp,
    });

    // Use simple output collection for debugging
    let output = AsyncCommand::new("claude")
        .args(&command_args)
        .current_dir(std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")))
        .output()
        .await
        .map_err(|e| {
            let error_msg = format!("Failed to execute claude process: {}", e);
            let _ = app.emit("claude_stream", ClaudeStreamEvent::Error {
                message: error_msg.clone(),
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs(),
            });
            error_msg
        })?;

    // Process the output
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // Emit the output as events
    let _ = app.emit("claude_stream", ClaudeStreamEvent::Status {
        message: format!("Claude stdout: {}", stdout),
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
    });

    if !stderr.is_empty() {
        let _ = app.emit("claude_stream", ClaudeStreamEvent::Status {
            message: format!("Claude stderr: {}", stderr),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        });
    }

    // Emit completion
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    let _ = app.emit("claude_stream", ClaudeStreamEvent::Complete { timestamp });

    if output.status.success() {
        Ok(stdout.to_string())
    } else {
        Err(format!("Claude process exited with code: {:?}", output.status.code()))
    }

    // Process stdout stream
    let app_stdout = app.clone();
    let stdout_task = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        
        let mut line_count = 0;
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    line_count += 1;
                    let timestamp = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_millis() as u64;

                    // Debug: emit every line we receive
                    let _ = app_stdout.emit("claude_stream", ClaudeStreamEvent::Status {
                        message: format!("STDOUT Line {}: {}", line_count, line),
                        timestamp,
                    });

                    // For debugging, just emit the raw line as status
                    let _ = app_stdout.emit("claude_stream", ClaudeStreamEvent::Status {
                        message: format!("Claude output: {}", line),
                        timestamp,
                    });
                }
                Ok(None) => {
                    // EOF - process stdout closed
                    let _ = app_stdout.emit("claude_stream", ClaudeStreamEvent::Status {
                        message: format!("STDOUT closed after {} lines", line_count),
                        timestamp: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_millis() as u64,
                    });
                    break;
                }
                Err(e) => {
                    let _ = app_stdout.emit("claude_stream", ClaudeStreamEvent::Error {
                        message: format!("STDOUT error: {}", e),
                        timestamp: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_secs(),
                    });
                    break;
                }
            }
        }
    });

    // Process stderr stream  
    let app_stderr = app.clone();
    let stderr_task = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        
        let mut stderr_count = 0;
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    stderr_count += 1;
                    let timestamp = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_millis() as u64;

                    // Debug: emit every stderr line
                    let _ = app_stderr.emit("claude_stream", ClaudeStreamEvent::Status {
                        message: format!("STDERR Line {}: {}", stderr_count, line),
                        timestamp,
                    });

                    // Parse stderr output too (Claude might output status info to stderr)
                    if let Some(event) = parse_claude_json_event(&line) {
                        let _ = app_stderr.emit("claude_stream", event);
                    }
                }
                Ok(None) => {
                    // EOF - process stderr closed
                    let _ = app_stderr.emit("claude_stream", ClaudeStreamEvent::Status {
                        message: format!("STDERR closed after {} lines", stderr_count),
                        timestamp: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_millis() as u64,
                    });
                    break;
                }
                Err(e) => {
                    let _ = app_stderr.emit("claude_stream", ClaudeStreamEvent::Error {
                        message: format!("STDERR error: {}", e),
                        timestamp: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_secs(),
                    });
                    break;
                }
            }
        }
    });

    // Wait for process to complete with timeout
    let _ = app.emit("claude_stream", ClaudeStreamEvent::Status {
        message: "Waiting for Claude process to complete...".to_string(),
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
    });

    // Add timeout to prevent hanging - reduced for testing
    let timeout_duration = tokio::time::Duration::from_secs(10);
    let output = tokio::time::timeout(timeout_duration, child.wait()).await
        .map_err(|_| {
            let error_msg = "Claude process timed out after 10 seconds".to_string();
            let _ = app.emit("claude_stream", ClaudeStreamEvent::Error {
                message: error_msg.clone(),
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs(),
            });
            error_msg
        })?
        .map_err(|e| {
            let error_msg = format!("Claude process failed: {}", e);
            let _ = app.emit("claude_stream", ClaudeStreamEvent::Error {
                message: error_msg.clone(),
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs(),
            });
            error_msg
        })?;

    // Report process completion
    let _ = app.emit("claude_stream", ClaudeStreamEvent::Status {
        message: format!("Claude process completed with status: {:?}", output),
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
    });

    // Clean up
    app.unlisten(permission_handler);
    let _ = tokio::join!(stdout_task, stderr_task);

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    // Always emit completion event as fallback (handles missing final result events from stream-json)
    let _ = app.emit("claude_stream", ClaudeStreamEvent::Complete { timestamp });

    if output.success() {
        Ok("Command completed successfully".to_string())
    } else {
        Err(format!("Claude process exited with code: {:?}", output.code()))
    }
}

fn parse_claude_json_event(line: &str) -> Option<ClaudeStreamEvent> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
        
    // Skip empty lines
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    
    // Try to parse as JSON first
    if let Ok(claude_event) = serde_json::from_str::<ClaudeJsonEvent>(trimmed) {
        match claude_event.event_type.as_str() {
            "system" => {
                if let Some(subtype) = &claude_event.subtype {
                    match subtype.as_str() {
                        "init" => Some(ClaudeStreamEvent::Status {
                            message: "Claude Code initialized".to_string(),
                            timestamp,
                        }),
                        _ => Some(ClaudeStreamEvent::Status {
                            message: format!("System: {}", subtype),
                            timestamp,
                        }),
                    }
                } else {
                    None
                }
            },
            "assistant" => {
                if let Some(message) = &claude_event.message {
                    Some(ClaudeStreamEvent::Response {
                        content: message.content.clone(),
                        timestamp,
                    })
                } else {
                    None
                }
            },
            "user" => {
                // Don't emit user messages as events (they're already in the UI)
                None
            },
            "result" => {
                // Store session ID if present
                if let Some(session_id) = &claude_event.session_id {
                    if let Ok(mut current_session) = CURRENT_SESSION_ID.try_lock() {
                        *current_session = Some(session_id.clone());
                    }
                }
                
                if let Some(subtype) = &claude_event.subtype {
                    match subtype.as_str() {
                        "success" => {
                            // Extract usage information if available
                            if let Some(usage) = &claude_event.usage {
                                // Emit token usage event
                                Some(ClaudeStreamEvent::TokenUsage {
                                    input: usage.input_tokens,
                                    output: usage.output_tokens,
                                    total: usage.input_tokens + usage.output_tokens,
                                    timestamp,
                                })
                            } else {
                                Some(ClaudeStreamEvent::Complete { timestamp })
                            }
                        },
                        "error" => Some(ClaudeStreamEvent::Error {
                            message: claude_event.error.unwrap_or_else(|| "Unknown error".to_string()),
                            timestamp,
                        }),
                        _ => Some(ClaudeStreamEvent::Complete { timestamp }),
                    }
                } else {
                    Some(ClaudeStreamEvent::Complete { timestamp })
                }
            },
            _ => {
                // Unknown event type, treat as status
                Some(ClaudeStreamEvent::Status {
                    message: format!("Unknown event: {}", claude_event.event_type),
                    timestamp,
                })
            }
        }
    } else {
        // Not valid JSON, check if it looks like a progress or debug message
        let line_lower = trimmed.to_lowercase();
        
        // Look for common Claude output patterns that aren't JSON
        if line_lower.contains("thinking") || line_lower.contains("processing") {
            Some(ClaudeStreamEvent::Thinking {
                message: trimmed.to_string(),
                timestamp,
            })
        } else if line_lower.contains("error") || line_lower.contains("failed") {
            Some(ClaudeStreamEvent::Error {
                message: trimmed.to_string(),
                timestamp,
            })
        } else if line_lower.contains("permission") || line_lower.contains("allow") {
            // Basic permission detection (for non-JSON permission prompts)
            Some(ClaudeStreamEvent::PermissionRequest {
                id: format!("perm_{}", timestamp),
                prompt: trimmed.to_string(),
                options: vec![
                    "1: Allow".to_string(),
                    "2: Allow and remember".to_string(),
                    "3: Deny".to_string(),
                ],
                timestamp,
            })
        } else if trimmed.len() > 10 {
            // Substantial non-JSON content, treat as status
            Some(ClaudeStreamEvent::Status {
                message: trimmed.to_string(),
                timestamp,
            })
        } else {
            None
        }
    }
}

#[tauri::command]
async fn execute_claude_command_with_files(
    args: Vec<String>, 
    files: Vec<String>,
    enable_autocomplete: bool,
    plan_mode: bool
) -> Result<String, String> {
    let mut command_args = args;
    
    // Add plan mode flag if enabled
    if plan_mode {
        command_args.insert(0, "--plan".to_string());
    }
    
    // Add autocomplete flag if disabled
    if !enable_autocomplete {
        command_args.insert(0, "--no-autocomplete".to_string());
    }
    
    // Add files as direct arguments (Claude Code accepts file paths as arguments)
    for file in files {
        command_args.push(file);
    }
    
    let output = Command::new("claude")
        .args(&command_args)
        .output()
        .map_err(|e| format!("Failed to execute claude command: {}", e))?;
    
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}


#[tauri::command]
async fn get_real_project_path(claude_project_path: String) -> Result<Option<String>, String> {
    let project_dir = std::path::Path::new(&claude_project_path);
    
    // Try to read various metadata files that might contain the real path
    let possible_files = vec![
        ".claude-project",
        "project.json",
        ".project",
        "config.json",
        ".claude",
    ];
    
    for file_name in possible_files {
        let file_path = project_dir.join(file_name);
        if file_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&file_path) {
                // Try to parse as JSON and look for path-like fields
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    // Check various field names that might contain the path
                    let path_fields = vec!["path", "projectPath", "directory", "root", "workingDirectory"];
                    for field in path_fields {
                        if let Some(path) = json.get(field).and_then(|p| p.as_str()) {
                            return Ok(Some(path.to_string()));
                        }
                    }
                }
                
                // If not JSON, maybe it's just a plain text file with the path
                let trimmed_content = content.trim();
                if trimmed_content.starts_with('/') && std::path::Path::new(trimmed_content).exists() {
                    return Ok(Some(trimmed_content.to_string()));
                }
            }
        }
    }
    
    // Check if there are any files that look like they contain path information
    if let Ok(entries) = std::fs::read_dir(&project_dir) {
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            if let Some(name_str) = file_name.to_str() {
                // Look for any JSON or JSONL files that might contain metadata
                if name_str.ends_with(".json") || name_str.ends_with(".jsonl") {
                    if let Ok(content) = std::fs::read_to_string(entry.path()) {
                        // For .jsonl files, check each line
                        let lines_to_check = if name_str.ends_with(".jsonl") {
                            content.lines().take(10).collect::<Vec<_>>()
                        } else {
                            vec![content.as_str()]
                        };
                        
                        for line in lines_to_check {
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                                let path_fields = vec!["path", "projectPath", "directory", "root", "workingDirectory", "cwd"];
                                for field in path_fields {
                                    if let Some(path) = json.get(field).and_then(|p| p.as_str()) {
                                        if std::path::Path::new(path).exists() {
                                            return Ok(Some(path.to_string()));
                                        }
                                    }
                                }
                                
                                // Also search for any path-like strings in the JSON
                                if let Some(obj) = json.as_object() {
                                    for (_, value) in obj {
                                        if let Some(str_val) = value.as_str() {
                                            if str_val.starts_with("/Users/") && str_val.contains("/repos/") {
                                                if std::path::Path::new(str_val).exists() {
                                                    return Ok(Some(str_val.to_string()));
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Fallback: decode the directory name to get the real path
    // Claude projects encode paths by replacing '/' with '-' and adding a leading '-'
    // Example: /Users/muaazjoosuf/repos/buy-together -> -Users-muaazjoosuf-repos-buy-together
    if let Some(dir_name) = std::path::Path::new(&claude_project_path).file_name() {
        if let Some(encoded_path) = dir_name.to_str() {
            if encoded_path.starts_with('-') {
                let path_part = &encoded_path[1..];
                
                // Strategy: Try to intelligently decode by looking for known path patterns
                // Common pattern: Users-username-repos-project-name
                if let Some(repos_pos) = path_part.find("-repos-") {
                    // Split at "repos" - everything before is directory structure
                    let before_repos = &path_part[..repos_pos];
                    let after_repos_with_dash = &path_part[repos_pos + 6..]; // +6 for "-repos-"
                    
                    // Before repos: replace dashes with slashes
                    let dir_structure = before_repos.replace('-', "/");
                    
                    // After repos: remove the leading dash if present, then keep remaining dashes
                    let after_repos = if after_repos_with_dash.starts_with('-') {
                        &after_repos_with_dash[1..]
                    } else {
                        after_repos_with_dash
                    };
                    
                    // Try both the original project name and with dashes converted to underscores
                    // since project names might use underscores but Claude encodes them as dashes
                    let project_with_dashes = format!("/{}/repos/{}", dir_structure, after_repos);
                    let project_with_underscores = format!("/{}/repos/{}", dir_structure, after_repos.replace('-', "_"));
                    
                    // Check which one actually exists
                    if std::path::Path::new(&project_with_underscores).exists() {
                        return Ok(Some(project_with_underscores));
                    } else if std::path::Path::new(&project_with_dashes).exists() {
                        return Ok(Some(project_with_dashes));
                    } else {
                        // Return the underscore version as it's more likely for project names
                        return Ok(Some(project_with_underscores));
                    }
                }
                
                // Fallback: look for other common patterns
                if path_part.starts_with("Users-") {
                    let parts: Vec<&str> = path_part.split('-').collect();
                    if parts.len() >= 3 {
                        // Assume first 3 parts are Users/username/something, rest is project name
                        let base_path = format!("/{}/{}/{}", parts[0], parts[1], parts[2]);
                        if parts.len() > 3 {
                            let project_name = parts[3..].join("-");
                            return Ok(Some(format!("{}/{}", base_path, project_name)));
                        } else {
                            return Ok(Some(base_path));
                        }
                    }
                }
                
                // Last resort: replace all dashes with slashes
                let decoded_path = format!("/{}", path_part.replace('-', "/"));
                return Ok(Some(decoded_path));
            }
        }
    }
    
    Ok(None)
}

#[tauri::command]
async fn get_claude_md_content(project_path: String) -> Result<Option<String>, String> {
    // First get the real project path
    let real_path = match get_real_project_path(project_path).await? {
        Some(path) => path,
        None => return Ok(None)
    };
    
    // Try multiple possible paths for CLAUDE.md in the real project directory
    let possible_paths = vec![
        std::path::Path::new(&real_path).join("CLAUDE.md"),
        std::path::Path::new(&real_path).join("claude.md"),
        std::path::Path::new(&real_path).join("Claude.md"),
    ];
    
    for claude_md_path in possible_paths {
        if claude_md_path.exists() {
            match std::fs::read_to_string(&claude_md_path) {
                Ok(content) => return Ok(Some(content)),
                Err(e) => return Err(format!("Failed to read CLAUDE.md at {}: {}", claude_md_path.display(), e))
            }
        }
    }
    
    Ok(None)
}

#[tauri::command]
async fn save_claude_md_content(project_path: String, content: String) -> Result<(), String> {
    // First get the real project path
    let real_path = match get_real_project_path(project_path).await? {
        Some(path) => path,
        None => return Err("Could not find real project path".to_string())
    };
    
    let claude_md_path = std::path::Path::new(&real_path).join("CLAUDE.md");
    
    std::fs::write(&claude_md_path, content)
        .map_err(|e| format!("Failed to save CLAUDE.md: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn check_claude_md_exists(project_path: String) -> Result<bool, String> {
    // First get the real project path
    let real_path = match get_real_project_path(project_path).await? {
        Some(path) => path,
        None => return Ok(false)
    };
    
    // Try multiple possible paths for CLAUDE.md in the real project directory
    let possible_paths = vec![
        std::path::Path::new(&real_path).join("CLAUDE.md"),
        std::path::Path::new(&real_path).join("claude.md"),
        std::path::Path::new(&real_path).join("Claude.md"),
    ];
    
    for claude_md_path in possible_paths {
        if claude_md_path.exists() {
            return Ok(true);
        }
    }
    
    Ok(false)
}

#[tauri::command]
async fn debug_project_path(project_path: String) -> Result<String, String> {
    let mut debug_info = format!("Claude project path: {}\n", project_path);
    
    // First, show what's in the Claude project directory
    let claude_path = std::path::Path::new(&project_path);
    debug_info.push_str(&format!("Claude project directory exists: {}\n", claude_path.exists()));
    
    if claude_path.exists() {
        debug_info.push_str("Files in Claude project directory:\n");
        if let Ok(entries) = std::fs::read_dir(claude_path) {
            for entry in entries.flatten() {
                let file_name = entry.file_name();
                let name = file_name.to_string_lossy();
                let is_file = entry.path().is_file();
                debug_info.push_str(&format!("  - {} ({})\n", name, if is_file { "file" } else { "dir" }));
                
                // If it's a small file, try to read its content
                if is_file {
                    let path = entry.path();
                    if let Ok(metadata) = path.metadata() {
                        if metadata.len() < 5120 { // Less than 5KB - check jsonl files too
                            if let Ok(content) = std::fs::read_to_string(&path) {
                                // For .jsonl files, try to find project path information
                                if name.ends_with(".jsonl") {
                                    // Read first few lines to look for project info
                                    let lines: Vec<&str> = content.lines().take(5).collect();
                                    for line in lines {
                                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                                            // Look for common fields that might contain the project path
                                            let search_fields = vec!["workingDirectory", "cwd", "projectPath", "path", "directory"];
                                            for field in search_fields {
                                                if let Some(value) = json.get(field) {
                                                    debug_info.push_str(&format!("    Found {}: {}\n", field, value));
                                                }
                                            }
                                            // Also check if there's any path-like string in the JSON
                                            if let Some(obj) = json.as_object() {
                                                for (key, value) in obj {
                                                    if let Some(str_val) = value.as_str() {
                                                        if str_val.starts_with("/Users/") || str_val.contains("/repos/") {
                                                            debug_info.push_str(&format!("    Found path in {}: {}\n", key, str_val));
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                } else {
                                    let preview = if content.len() > 200 { 
                                        format!("{}...", &content[..200])
                                    } else { 
                                        content 
                                    };
                                    debug_info.push_str(&format!("    Content: {}\n", preview.replace('\n', "\\n")));
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Try to get the real project path
    match get_real_project_path(project_path.clone()).await {
        Ok(Some(real_path)) => {
            debug_info.push_str(&format!("Real project path: {}\n", real_path));
            
            let path = std::path::Path::new(&real_path);
            debug_info.push_str(&format!("Real path exists: {}\n", path.exists()));
            debug_info.push_str(&format!("Real path is directory: {}\n", path.is_dir()));
            
            if path.exists() && path.is_dir() {
                debug_info.push_str("Real directory contents:\n");
                if let Ok(entries) = std::fs::read_dir(path) {
                    for entry in entries.flatten() {
                        let file_name = entry.file_name();
                        let name = file_name.to_string_lossy();
                        debug_info.push_str(&format!("  - {}\n", name));
                    }
                }
            }
            
            // Check specifically for CLAUDE.md variants in real path
            let possible_paths = vec![
                path.join("CLAUDE.md"),
                path.join("claude.md"),
                path.join("Claude.md"),
            ];
            
            debug_info.push_str("\nCLAUDE.md file checks in real path:\n");
            for claude_path in possible_paths {
                debug_info.push_str(&format!("  {} exists: {}\n", claude_path.display(), claude_path.exists()));
            }
        }
        Ok(None) => {
            debug_info.push_str("Could not find real project path (no .claude-project file)\n");
        }
        Err(e) => {
            debug_info.push_str(&format!("Error getting real project path: {}\n", e));
        }
    }
    
    Ok(debug_info)
}

#[tauri::command]
async fn create_claude_md_template(project_path: String) -> Result<(), String> {
    // First get the real project path
    let real_path = match get_real_project_path(project_path).await? {
        Some(path) => path,
        None => return Err("Could not find real project path".to_string())
    };
    
    let claude_md_path = std::path::Path::new(&real_path).join("CLAUDE.md");
    
    if claude_md_path.exists() {
        return Err("CLAUDE.md already exists".to_string());
    }
    
    let template = r#"# Project Instructions for Claude

## Project Overview
Brief description of what this project does and its main purpose.

## Development Guidelines
- Coding standards and conventions to follow
- Preferred libraries and frameworks
- Architecture patterns to maintain

## Key Files and Directories
- `src/` - Main source code
- `tests/` - Test files
- `docs/` - Documentation

## Important Notes
- Any specific requirements or constraints
- Known issues or gotchas
- Deployment considerations

## Testing
- How to run tests
- Test coverage expectations
- Any special testing requirements

## Build & Deployment
- Build commands
- Environment setup
- Deployment process
"#;
    
    std::fs::write(&claude_md_path, template)
        .map_err(|e| format!("Failed to create CLAUDE.md template: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn open_file_in_system(file_path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }
    
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &file_path])
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }
    
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
struct ProjectSetupOptions {
    path: String,
    project_name: String,
    init_git: bool,
    create_claude: bool,
    project_type: String,
    open_in_ide: bool,
    selected_ide: Option<String>,
}

#[tauri::command]
async fn select_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    use std::sync::{Arc, Mutex};
    use tokio::sync::oneshot;
    
    let (tx, rx) = oneshot::channel();
    let tx = Arc::new(Mutex::new(Some(tx)));
    
    app.dialog()
        .file()
        .set_directory(dirs::home_dir().unwrap_or_default())
        .pick_folder(move |result| {
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(result);
            }
        });
    
    match rx.await {
        Ok(Some(path)) => Ok(Some(path.to_string())),
        Ok(None) => Ok(None),
        Err(_) => Err("Dialog was cancelled or failed".to_string())
    }
}

#[tauri::command]
async fn create_enhanced_project(options: ProjectSetupOptions) -> Result<String, String> {
    let project_path = &options.path;
    
    // Create directory if it doesn't exist
    if !std::path::Path::new(project_path).exists() {
        std::fs::create_dir_all(project_path)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    // Initialize Git repository if requested
    if options.init_git {
        let git_output = Command::new("git")
            .args(["init"])
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Failed to initialize git: {}", e))?;
        
        if !git_output.status.success() {
            eprintln!("Warning: Failed to initialize git repository");
        }
    }
    
    // Create project based on type
    match options.project_type.as_str() {
        "react" => {
            // Create React app with Vite
            let output = Command::new("npm")
                .args(["create", "vite@latest", ".", "--template", "react-ts"])
                .current_dir(project_path)
                .output()
                .map_err(|e| format!("Failed to create React app: {}", e))?;
            
            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).to_string());
            }
        },
        "nextjs" => {
            // Create Next.js app
            let output = Command::new("npx")
                .args(["create-next-app@latest", ".", "--typescript", "--tailwind", "--eslint"])
                .current_dir(project_path)
                .output()
                .map_err(|e| format!("Failed to create Next.js app: {}", e))?;
            
            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).to_string());
            }
        },
        "python" => {
            // Create Python project structure
            let dirs = ["src", "tests", "docs"];
            for dir in &dirs {
                let dir_path = std::path::Path::new(project_path).join(dir);
                std::fs::create_dir_all(&dir_path)
                    .map_err(|e| format!("Failed to create directory {}: {}", dir, e))?;
            }
            
            // Create requirements.txt
            let requirements_path = std::path::Path::new(project_path).join("requirements.txt");
            std::fs::write(&requirements_path, "# Add your dependencies here\n")
                .map_err(|e| format!("Failed to create requirements.txt: {}", e))?;
        },
        "node" => {
            // Initialize npm project
            let output = Command::new("npm")
                .args(["init", "-y"])
                .current_dir(project_path)
                .output()
                .map_err(|e| format!("Failed to initialize npm project: {}", e))?;
            
            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).to_string());
            }
        },
        "rust" => {
            // Create Rust project with Cargo
            let output = Command::new("cargo")
                .args(["init", ".", "--name", &options.project_name])
                .current_dir(project_path)
                .output()
                .map_err(|e| format!("Failed to create Rust project: {}", e))?;
            
            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).to_string());
            }
        },
        _ => {
            // Empty project or custom - just create basic structure
        }
    }
    
    // Create CLAUDE.md template if requested
    if options.create_claude {
        let claude_md_path = std::path::Path::new(project_path).join("CLAUDE.md");
        let template = format!(r#"# {} - Claude Instructions

## Project Overview
Brief description of what this project does and its main purpose.

## Development Guidelines
- Coding standards and conventions to follow
- Preferred libraries and frameworks
- Architecture patterns to maintain

## Key Files and Directories
- `src/` - Main source code
- `tests/` - Test files
- `docs/` - Documentation

## Project Type
This is a {} project.

## Important Notes
- Any specific requirements or constraints
- Known issues or gotchas
- Deployment considerations

## Testing
- How to run tests
- Test coverage expectations
- Any special testing requirements

## Build & Deployment
- Build commands
- Environment setup
- Deployment process
"#, options.project_name, options.project_type);
        
        std::fs::write(&claude_md_path, template)
            .map_err(|e| format!("Failed to create CLAUDE.md: {}", e))?;
    }
    
    // Execute claude --project to register the project
    let claude_output = Command::new("claude")
        .args(["--project", project_path])
        .output()
        .map_err(|e| format!("Failed to execute claude command: {}", e))?;
    
    if !claude_output.status.success() {
        eprintln!("Warning: Failed to register project with Claude");
    }
    
    // Open in IDE if requested
    if options.open_in_ide {
        if let Some(ide_command) = options.selected_ide {
            let _ide_output = Command::new(&ide_command)
                .arg(project_path)
                .spawn();
            // Don't fail if IDE opening fails
        }
    }
    
    Ok(format!("Project '{}' created successfully at {}", options.project_name, project_path))
}

#[tauri::command]
async fn create_new_project(project_path: String) -> Result<String, String> {
    // Execute claude --project /path/to/project to create a new project
    let output = Command::new("claude")
        .args(["--project", &project_path])
        .output()
        .map_err(|e| format!("Failed to execute claude command: {}", e))?;
    
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
async fn read_conversation_file(file_path: String) -> Result<Vec<ChatMessage>, String> {
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read file {}: {}", file_path, e))?;
    
    let mut messages = Vec::new();
    
    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }
        
        match serde_json::from_str::<serde_json::Value>(line) {
            Ok(json) => {
                // Handle different Claude Code message formats
                let mut role = "unknown".to_string();
                let mut content = String::new();
                let timestamp = json.get("timestamp")
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .to_string();

                // Check if this is a user message
                if json.get("type").and_then(|t| t.as_str()) == Some("user") {
                    role = "user".to_string();
                    if let Some(message) = json.get("message") {
                        if let Some(content_str) = message.get("content").and_then(|c| c.as_str()) {
                            content = content_str.to_string();
                        }
                    }
                }
                // Check if this is an assistant message
                else if json.get("type").and_then(|t| t.as_str()) == Some("assistant") {
                    role = "assistant".to_string();
                    if let Some(message) = json.get("message") {
                        // Handle content array format
                        if let Some(content_array) = message.get("content").and_then(|c| c.as_array()) {
                            for content_item in content_array {
                                if let Some(text) = content_item.get("text").and_then(|t| t.as_str()) {
                                    if !content.is_empty() {
                                        content.push('\n');
                                    }
                                    content.push_str(text);
                                }
                            }
                        }
                        // Handle direct string content
                        else if let Some(content_str) = message.get("content").and_then(|c| c.as_str()) {
                            content = content_str.to_string();
                        }
                    }
                }
                // Fallback for other message formats
                else if let Some(message) = json.get("message") {
                    if let Some(role_str) = message.get("role").and_then(|r| r.as_str()) {
                        role = role_str.to_string();
                    }
                    
                    if let Some(content_str) = message.get("content").and_then(|c| c.as_str()) {
                        content = content_str.to_string();
                    }
                }

                // Only add messages that have actual content
                if !content.trim().is_empty() && role != "unknown" {
                    messages.push(ChatMessage {
                        role,
                        content,
                        timestamp,
                    });
                }
            }
            Err(_) => continue,
        }
    }
    
    Ok(messages)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_claude_projects,
            execute_claude_command,
            execute_claude_command_with_files,
            execute_claude_command_streaming,
            test_streaming_events,
            read_conversation_file,
            get_project_sessions,
            open_file_in_system,
            detect_available_ides,
            open_file_in_ide,
            open_project_in_ide,
            get_file_info,
            get_project_files,
            get_claude_md_content,
            save_claude_md_content,
            check_claude_md_exists,
            create_claude_md_template,
            debug_project_path,
            get_real_project_path,
            create_new_project,
            create_enhanced_project,
            select_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}