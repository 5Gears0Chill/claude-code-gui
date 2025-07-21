#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use std::collections::{HashMap, HashSet};
use serde::{Deserialize, Serialize};
use tokio::process::Command as AsyncCommand;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tauri::Emitter;
use lazy_static::lazy_static;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use uuid::Uuid;
use std::io::{Read, Write};
use chrono;

// Todo management structures
#[derive(Debug, Serialize, Deserialize, Clone)]
struct Todo {
    id: String,
    content: String,
    status: String, // "pending", "in_progress", "completed"
    priority: String, // "high", "medium", "low"
    created_at: String,
    session_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ProjectTodos {
    todos: Vec<Todo>,
    last_updated: String,
}

// Global session tracking for Claude Code
lazy_static! {
    static ref CURRENT_SESSION_ID: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    static ref TERMINAL_SESSIONS: Arc<RwLock<HashMap<String, TerminalSession>>> = Arc::new(RwLock::new(HashMap::new()));
    static ref ACTIVE_OUTPUT_HANDLERS: Arc<RwLock<HashSet<String>>> = Arc::new(RwLock::new(HashSet::new()));
}

// Terminal session management  
struct TerminalSession {
    id: String,
    pty_master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    pty_writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child_process: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    project_path: String,
    active: bool,
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
    is_directory: bool,
    modified_date: String,
    file_type: String,
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
    #[serde(default)]
    id: Option<String>,
    #[serde(rename = "type")]
    #[serde(default)]
    message_type: Option<String>,
    role: String,
    content: String, // This can be a JSON string containing an array of content blocks
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    stop_reason: Option<String>,
    #[serde(default)]
    usage: Option<ClaudeUsage>,
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

// System Information Commands
#[tauri::command]
async fn get_claude_version() -> Result<String, String> {
    let output = Command::new("claude")
        .arg("--version")
        .output()
        .map_err(|e| format!("Failed to get Claude version: {}", e))?;
    
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err("Claude CLI not found or not accessible".to_string())
    }
}

#[tauri::command]
async fn get_claude_config() -> Result<serde_json::Value, String> {
    let output = Command::new("claude")
        .args(&["config", "list"])
        .output()
        .map_err(|e| format!("Failed to get Claude config: {}", e))?;
    
    if output.status.success() {
        let config_str = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str(&config_str)
            .map_err(|e| format!("Failed to parse Claude config: {}", e))
    } else {
        Err("Failed to get Claude configuration".to_string())
    }
}

#[tauri::command]
async fn get_system_info() -> Result<serde_json::Value, String> {
    let node_version = Command::new("node")
        .arg("--version")
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_else(|_| "Not found".to_string());
    
    let npm_version = Command::new("npm")
        .arg("--version")
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_else(|_| "Not found".to_string());
    
    // Check if Claude is installed via npm
    let claude_npm_info = Command::new("npm")
        .args(&["list", "-g", "@anthropic-ai/claude-code", "--json"])
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                serde_json::from_slice::<serde_json::Value>(&output.stdout).ok()
            } else {
                None
            }
        });
    
    let system_info = serde_json::json!({
        "node_version": node_version,
        "npm_version": npm_version,
        "claude_npm_info": claude_npm_info,
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH
    });
    
    Ok(system_info)
}

#[derive(serde::Serialize)]
struct UsageStats {
    total_input_tokens: u64,
    total_output_tokens: u64,
    total_cache_creation_tokens: u64,
    total_cache_read_tokens: u64,
    session_count: u32,
    models_used: std::collections::HashMap<String, u32>,
    daily_usage: std::collections::HashMap<String, DailyUsage>,
}

#[derive(serde::Serialize)]
struct DailyUsage {
    input_tokens: u64,
    output_tokens: u64,
    sessions: u32,
}

#[tauri::command]
async fn get_usage_statistics(project_path: Option<String>) -> Result<UsageStats, String> {
    let mut stats = UsageStats {
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cache_creation_tokens: 0,
        total_cache_read_tokens: 0,
        session_count: 0,
        models_used: std::collections::HashMap::new(),
        daily_usage: std::collections::HashMap::new(),
    };
    
    let search_paths = if let Some(path) = project_path {
        vec![path]
    } else {
        // Default to all projects - search through each project directory
        let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
        let projects_dir = home_dir.join(".claude").join("projects");
        
        let mut paths = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&projects_dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    paths.push(entry.path().to_string_lossy().to_string());
                }
            }
        }
        
        if paths.is_empty() {
            vec![projects_dir.to_string_lossy().to_string()]
        } else {
            paths
        }
    };
    
    // Parse JSONL files for usage statistics
    for search_path in &search_paths {
        println!("[DEBUG] Searching for JSONL files in: {}", search_path);
        if let Ok(entries) = std::fs::read_dir(search_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
                    println!("[DEBUG] Processing JSONL file: {:?}", path);
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        stats.session_count += 1;
                        let line_count = content.lines().count();
                        println!("[DEBUG] File has {} lines", line_count);
                        
                        for line in content.lines() {
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                                // Check for usage data - it can be at root level or nested in message
                                let usage_data = json.get("usage")
                                    .or_else(|| json.get("message").and_then(|m| m.get("usage")));
                                
                                if let Some(usage) = usage_data {
                                    if let Some(input_tokens) = usage.get("input_tokens").and_then(|v| v.as_u64()) {
                                        println!("[DEBUG] Found input tokens: {}", input_tokens);
                                        stats.total_input_tokens += input_tokens;
                                    }
                                    if let Some(output_tokens) = usage.get("output_tokens").and_then(|v| v.as_u64()) {
                                        println!("[DEBUG] Found output tokens: {}", output_tokens);
                                        stats.total_output_tokens += output_tokens;
                                    }
                                    if let Some(cache_creation) = usage.get("cache_creation_input_tokens").and_then(|v| v.as_u64()) {
                                        stats.total_cache_creation_tokens += cache_creation;
                                    }
                                    if let Some(cache_read) = usage.get("cache_read_input_tokens").and_then(|v| v.as_u64()) {
                                        stats.total_cache_read_tokens += cache_read;
                                    }
                                }
                                
                                // Track models used - check both root level and in message
                                let model = json.get("model").and_then(|v| v.as_str())
                                    .or_else(|| json.get("message").and_then(|m| m.get("model")).and_then(|v| v.as_str()));
                                
                                if let Some(model_str) = model {
                                    *stats.models_used.entry(model_str.to_string()).or_insert(0) += 1;
                                }
                                
                                // Track daily usage
                                if let Some(timestamp) = json.get("timestamp").and_then(|v| v.as_str()) {
                                    if let Ok(date) = chrono::DateTime::parse_from_rfc3339(timestamp) {
                                        let day = date.format("%Y-%m-%d").to_string();
                                        let daily = stats.daily_usage.entry(day).or_insert(DailyUsage {
                                            input_tokens: 0,
                                            output_tokens: 0,
                                            sessions: 0,
                                        });
                                        
                                        // Add session count per day (only once per timestamp)
                                        daily.sessions += 1;
                                        
                                        if let Some(usage) = usage_data {
                                            if let Some(input_tokens) = usage.get("input_tokens").and_then(|v| v.as_u64()) {
                                                daily.input_tokens += input_tokens;
                                            }
                                            if let Some(output_tokens) = usage.get("output_tokens").and_then(|v| v.as_u64()) {
                                                daily.output_tokens += output_tokens;
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
    } // Close the search_paths loop
    
    println!("[DEBUG] Final stats - Sessions: {}, Input tokens: {}, Output tokens: {}", 
             stats.session_count, stats.total_input_tokens, stats.total_output_tokens);
    
    Ok(stats)
}

#[tauri::command]
async fn update_claude_config(key: String, value: serde_json::Value) -> Result<(), String> {
    let value_str = match value {
        serde_json::Value::String(s) => s,
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        _ => return Err("Unsupported config value type".to_string()),
    };
    
    let output = Command::new("claude")
        .args(&["config", "set", &key, &value_str])
        .output()
        .map_err(|e| format!("Failed to update Claude config: {}", e))?;
    
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
async fn check_claude_updates() -> Result<serde_json::Value, String> {
    // Note: `claude update --check` might have TTY issues, so we'll simulate for now
    // In a real implementation, this would check for updates
    Ok(serde_json::json!({
        "current_version": "1.0.56",
        "latest_version": "1.0.56", 
        "update_available": false,
        "message": "Claude Code is up to date"
    }))
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
    
    let is_directory = metadata.is_dir();
    let modified_date = metadata.modified()
        .map(|time| {
            let datetime: chrono::DateTime<chrono::Utc> = time.into();
            datetime.format("%Y-%m-%d %H:%M:%S").to_string()
        })
        .unwrap_or_else(|_| "Unknown".to_string());
    
    let file_type = if is_directory {
        "directory".to_string()
    } else {
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("txt")
            .to_string()
    };
    
    Ok(FileInfo {
        name,
        path: file_path,
        size: metadata.len(),
        mime_type,
        is_directory,
        modified_date,
        file_type,
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

// New comprehensive file system commands
#[tauri::command]
async fn read_file_content(file_path: String) -> Result<String, String> {
    let path = std::path::Path::new(&file_path);
    
    if !path.exists() {
        return Err("File does not exist".to_string());
    }
    
    if !path.is_file() {
        return Err("Path is not a file".to_string());
    }
    
    // Check file size (limit to 10MB for safety)
    if let Ok(metadata) = path.metadata() {
        if metadata.len() > 10 * 1024 * 1024 {
            return Err("File too large (max 10MB)".to_string());
        }
    }
    
    std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
async fn write_file_content(file_path: String, content: String) -> Result<(), String> {
    let path = std::path::Path::new(&file_path);
    
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }
    
    std::fs::write(path, content)
        .map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
async fn create_file(file_path: String, content: Option<String>) -> Result<(), String> {
    let path = std::path::Path::new(&file_path);
    
    if path.exists() {
        return Err("File already exists".to_string());
    }
    
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }
    
    let file_content = content.unwrap_or_default();
    std::fs::write(path, file_content)
        .map_err(|e| format!("Failed to create file: {}", e))
}

#[tauri::command]
async fn create_directory(dir_path: String) -> Result<(), String> {
    let path = std::path::Path::new(&dir_path);
    
    if path.exists() {
        return Err("Directory already exists".to_string());
    }
    
    std::fs::create_dir_all(path)
        .map_err(|e| format!("Failed to create directory: {}", e))
}

#[tauri::command]
async fn delete_file(file_path: String) -> Result<(), String> {
    let path = std::path::Path::new(&file_path);
    
    if !path.exists() {
        return Err("File does not exist".to_string());
    }
    
    if path.is_file() {
        std::fs::remove_file(path)
            .map_err(|e| format!("Failed to delete file: {}", e))
    } else if path.is_dir() {
        std::fs::remove_dir_all(path)
            .map_err(|e| format!("Failed to delete directory: {}", e))
    } else {
        Err("Path is neither file nor directory".to_string())
    }
}

#[tauri::command]
async fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    let old = std::path::Path::new(&old_path);
    let new = std::path::Path::new(&new_path);
    
    if !old.exists() {
        return Err("Source file does not exist".to_string());
    }
    
    if new.exists() {
        return Err("Destination already exists".to_string());
    }
    
    // Ensure parent directory of new path exists
    if let Some(parent) = new.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create destination directory: {}", e))?;
    }
    
    std::fs::rename(old, new)
        .map_err(|e| format!("Failed to rename file: {}", e))
}

#[tauri::command]
async fn get_directory_tree(dir_path: String) -> Result<serde_json::Value, String> {
    // Get the real project path
    let real_path = match get_real_project_path(dir_path).await? {
        Some(path) => path,
        None => return Err("Could not find real project path".to_string())
    };
    
    let path = std::path::Path::new(&real_path);
    
    if !path.exists() || !path.is_dir() {
        return Err("Directory does not exist".to_string());
    }
    
    fn build_tree(dir: &std::path::Path, max_depth: usize, current_depth: usize) -> Result<serde_json::Value, String> {
        if current_depth > max_depth {
            return Ok(serde_json::json!({
                "name": dir.file_name().and_then(|n| n.to_str()).unwrap_or(""),
                "path": dir.to_string_lossy(),
                "type": "directory",
                "children": []
            }));
        }
        
        let mut children = Vec::new();
        
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                
                // Skip hidden files and common ignore patterns
                if name.starts_with('.') || name == "node_modules" || name == "target" || 
                   name == "dist" || name == ".git" || name == "build" {
                    continue;
                }
                
                if path.is_dir() {
                    children.push(build_tree(&path, max_depth, current_depth + 1)?);
                } else {
                    let metadata = path.metadata().ok();
                    let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                    let modified = metadata.and_then(|m| m.modified().ok())
                        .map(|time| {
                            let datetime: chrono::DateTime<chrono::Utc> = time.into();
                            datetime.format("%Y-%m-%d %H:%M:%S").to_string()
                        })
                        .unwrap_or_else(|| "Unknown".to_string());
                    
                    children.push(serde_json::json!({
                        "name": name,
                        "path": path.to_string_lossy(),
                        "type": "file",
                        "size": size,
                        "modified": modified,
                        "extension": path.extension().and_then(|ext| ext.to_str()).unwrap_or("")
                    }));
                }
            }
        }
        
        // Sort children: directories first, then files, both alphabetically
        children.sort_by(|a, b| {
            let a_type = a["type"].as_str().unwrap_or("");
            let b_type = b["type"].as_str().unwrap_or("");
            let a_name = a["name"].as_str().unwrap_or("");
            let b_name = b["name"].as_str().unwrap_or("");
            
            match (a_type, b_type) {
                ("directory", "file") => std::cmp::Ordering::Less,
                ("file", "directory") => std::cmp::Ordering::Greater,
                _ => a_name.cmp(b_name)
            }
        });
        
        Ok(serde_json::json!({
            "name": dir.file_name().and_then(|n| n.to_str()).unwrap_or(""),
            "path": dir.to_string_lossy(),
            "type": "directory",
            "children": children
        }))
    }
    
    build_tree(path, 5, 0) // Limit depth to 5 levels
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
    
    let is_directory = metadata.is_dir();
    let modified_date = metadata.modified()
        .map(|time| {
            let datetime: chrono::DateTime<chrono::Utc> = time.into();
            datetime.format("%Y-%m-%d %H:%M:%S").to_string()
        })
        .unwrap_or_else(|_| "Unknown".to_string());
    
    let file_type = if is_directory {
        "directory".to_string()
    } else {
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("txt")
            .to_string()
    };
    
    Ok(FileInfo {
        name,
        path: path.to_string_lossy().to_string(),
        size: metadata.len(),
        mime_type,
        is_directory,
        modified_date,
        file_type,
    })
}


#[tauri::command]
async fn execute_claude_command_streaming(
    app: tauri::AppHandle,
    args: Vec<String>, 
    files: Vec<String>,
    _enable_autocomplete: bool,
    plan_mode: bool,
    project_path: Option<String>
) -> Result<String, String> {
    // Use stream-json format to get detailed tool information and token usage
    let mut command_args = vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string()
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

    // Determine working directory based on project path
    let working_dir = if let Some(proj_path) = project_path {
        // Get the real project directory
        match get_real_project_path(proj_path).await? {
            Some(real_path) => {
                let _ = app.emit("claude_stream", ClaudeStreamEvent::Status {
                    message: format!("Using project directory: {}", real_path),
                    timestamp: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_millis() as u64,
                });
                std::path::PathBuf::from(real_path)
            },
            None => {
                let _ = app.emit("claude_stream", ClaudeStreamEvent::Status {
                    message: "Could not find real project path, using current directory".to_string(),
                    timestamp: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_millis() as u64,
                });
                std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
            }
        }
    } else {
        std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
    };

    // Use simple output collection for debugging
    let output = AsyncCommand::new("claude")
        .args(&command_args)
        .current_dir(&working_dir)
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

    if !stderr.is_empty() {
        let _ = app.emit("claude_stream", ClaudeStreamEvent::Status {
            message: format!("Claude stderr: {}", stderr),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        });
    }

    // Parse stream-json format
    let mut assistant_response = String::new();
    let mut processed_lines = std::collections::HashSet::new();
    
    for line in stdout.lines() {
        let line_trimmed = line.trim();
        
        // Skip empty lines and prevent processing the same line twice
        if line_trimmed.is_empty() || processed_lines.contains(line_trimmed) {
            continue;
        }
        processed_lines.insert(line_trimmed.to_string());
        
        if let Some(event) = parse_claude_json_event(line_trimmed) {
            // Store assistant responses to return as final result
            if let ClaudeStreamEvent::Response { content, .. } = &event {
                if !assistant_response.is_empty() {
                    assistant_response.push('\n');
                }
                assistant_response.push_str(content);
            }
            
            let _ = app.emit("claude_stream", event);
        }
    }

    // Emit completion
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    let _ = app.emit("claude_stream", ClaudeStreamEvent::Complete { timestamp });

    if output.status.success() {
        // Return the assistant response content, or fall back to raw stdout if no structured response
        if !assistant_response.is_empty() {
            Ok(assistant_response)
        } else {
            Ok(stdout.to_string())
        }
    } else {
        Err(format!("Claude process exited with code: {:?}", output.status.code()))
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
    
    // Try to parse as Claude stream-json format
    if let Ok(claude_event) = serde_json::from_str::<ClaudeJsonEvent>(trimmed) {
        match claude_event.event_type.as_str() {
            "system" => {
                if let Some(subtype) = &claude_event.subtype {
                    match subtype.as_str() {
                        "init" => Some(ClaudeStreamEvent::Status {
                            message: "Claude Code initialized".to_string(),
                            timestamp,
                        }),
                        "permission_request" => {
                            // Handle permission requests
                            let prompt = if let Some(msg) = &claude_event.message {
                                // Try to extract a readable prompt from the message
                                format!("Claude is requesting permission: {}", msg.content)
                            } else {
                                "Claude is requesting permission to proceed".to_string()
                            };
                            
                            Some(ClaudeStreamEvent::PermissionRequest {
                                id: format!("perm_{}", timestamp),
                                prompt,
                                options: vec![
                                    "1: Allow".to_string(),
                                    "2: Allow and remember".to_string(),
                                    "3: Deny".to_string(),
                                ],
                                timestamp,
                            })
                        },
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
                    // Parse message content to extract text and tool usage
                    if let Ok(content_value) = serde_json::from_str::<serde_json::Value>(&message.content) {
                        if let Some(content_array) = content_value.as_array() {
                            let mut text_content = String::new();
                            let mut tool_usage = Vec::new();
                            
                            for item in content_array {
                                if let Some(item_type) = item.get("type").and_then(|t| t.as_str()) {
                                    match item_type {
                                        "text" => {
                                            if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                                if !text_content.is_empty() {
                                                    text_content.push('\n');
                                                }
                                                text_content.push_str(text);
                                            }
                                        },
                                        "tool_use" => {
                                            if let (Some(name), Some(input)) = (
                                                item.get("name").and_then(|n| n.as_str()),
                                                item.get("input")
                                            ) {
                                                tool_usage.push(format!("🔧 Using tool: {}", name));
                                                
                                                // Add tool parameters for common tools
                                                match name {
                                                    "Glob" => {
                                                        if let Some(pattern) = input.get("pattern").and_then(|p| p.as_str()) {
                                                            tool_usage.push(format!("   Searching for pattern: {}", pattern));
                                                        }
                                                    },
                                                    "Grep" => {
                                                        if let Some(pattern) = input.get("pattern").and_then(|p| p.as_str()) {
                                                            tool_usage.push(format!("   Searching for: {}", pattern));
                                                        }
                                                    },
                                                    "Read" => {
                                                        if let Some(path) = input.get("file_path").and_then(|p| p.as_str()) {
                                                            tool_usage.push(format!("   Reading file: {}", path.split('/').last().unwrap_or(path)));
                                                        }
                                                    },
                                                    "Task" => {
                                                        if let Some(desc) = input.get("description").and_then(|d| d.as_str()) {
                                                            tool_usage.push(format!("   Task: {}", desc));
                                                        }
                                                    },
                                                    "TodoWrite" => {
                                                        if let Some(todos_array) = input.get("todos").and_then(|t| t.as_array()) {
                                                            tool_usage.push(format!("📝 Updating todos ({} items)", todos_array.len()));
                                                            
                                                            // Extract and emit todo data for real-time sync
                                                            // This will be handled by a separate function
                                                            // to avoid blocking the stream parsing
                                                        }
                                                    },
                                                    _ => {
                                                        tool_usage.push(format!("   Executing {}", name));
                                                    }
                                                }
                                            }
                                        },
                                        _ => {}
                                    }
                                }
                            }
                            
                            // Emit tool usage as thinking events
                            if !tool_usage.is_empty() {
                                return Some(ClaudeStreamEvent::Thinking {
                                    message: tool_usage.join("\n"),
                                    timestamp,
                                });
                            }
                            
                            // Emit text content as response
                            if !text_content.is_empty() {
                                return Some(ClaudeStreamEvent::Response {
                                    content: text_content,
                                    timestamp,
                                });
                            }
                        }
                    }
                    
                    // Fallback to raw content if parsing fails
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
                // Don't emit unknown events as status to reduce noise
                None
            }
        }
    } else {
        // Check if this might be a permission-related message
        if trimmed.starts_with("Claude requested permissions") || 
           trimmed.contains("permission") && (trimmed.contains("Allow") || trimmed.contains("Deny")) {
            // This looks like a permission request
            Some(ClaudeStreamEvent::PermissionRequest {
                id: format!("perm_{}", timestamp),
                prompt: "Claude is requesting permission to access files or perform operations".to_string(),
                options: vec![
                    "1: Allow".to_string(),
                    "2: Allow and remember".to_string(), 
                    "3: Deny".to_string(),
                ],
                timestamp,
            })
        } else {
            // If it's not valid JSON, only process specific patterns to reduce noise
            let line_lower = trimmed.to_lowercase();
            
            if line_lower.contains("thinking") || line_lower.contains("processing") {
                Some(ClaudeStreamEvent::Thinking {
                    message: trimmed.to_string(),
                    timestamp,
                })
            } else if line_lower.contains("error") && line_lower.contains("failed") {
                Some(ClaudeStreamEvent::Error {
                    message: trimmed.to_string(),
                    timestamp,
                })
            } else {
                // Skip non-JSON content to reduce noise
                None
            }
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
                                            // Check if it looks like an absolute path and exists
                                            if str_val.starts_with("/") && std::path::Path::new(str_val).exists() {
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
    
    // Fallback: decode the directory name to get the real path
    // Claude projects encode paths by replacing '/' with '-' and adding a leading '-'
    // Example: /Users/username/repos/project-name -> -Users-username-repos-project-name
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
                                                        // Log any absolute paths found in the JSON for debugging
                                                        if str_val.starts_with("/") && std::path::Path::new(str_val).exists() {
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

async fn verify_claude_health(session_id: &str) -> bool {
    if let Ok(sessions) = TERMINAL_SESSIONS.try_read() {
        if let Some(session) = sessions.get(session_id) {
            // Check if child process is still alive
            if let Ok(mut child_guard) = session.child_process.try_lock() {
                match child_guard.try_wait() {
                    Ok(Some(_)) => {
                        println!("[HEALTH] Session {} process has exited", session_id);
                        return false;
                    }
                    Ok(None) => {
                        println!("[HEALTH] Session {} process is still running", session_id);
                        return true;
                    }
                    Err(e) => {
                        println!("[HEALTH] Session {} process check failed: {}", session_id, e);
                        return false;
                    }
                }
            }
        }
    }
    false
}

#[tauri::command]
async fn start_claude_session(app: tauri::AppHandle, project_path: String) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();
    println!("[INFO] Starting new Claude session: {}", session_id);
    
    // Get the real project path for the working directory
    let working_dir = match get_real_project_path(project_path.clone()).await? {
        Some(real_path) => real_path,
        None => {
            return Err("Could not find real project path".to_string());
        }
    };

    // Create PTY system
    let pty_system = native_pty_system();
    
    // Create PTY with appropriate size
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to create PTY: {}", e))?;

    // Set up Claude command
    let mut cmd = CommandBuilder::new("claude");
    cmd.cwd(&working_dir);
    println!("[DEBUG] Starting Claude in directory: {}", working_dir);
    
    // Start the child process
    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn Claude process: {}", e))?;

    // Get the writer ONCE and store it permanently
    println!("[DEBUG] Getting PTY writer for session: {}", session_id);
    let writer = pty_pair.master.take_writer()
        .map_err(|e| {
            let error_msg = format!("Failed to get PTY writer: {}", e);
            println!("[ERROR] {}", error_msg);
            error_msg
        })?;
    println!("[DEBUG] Successfully got PTY writer");
        
    // Create session with separate writer storage
    let session = TerminalSession {
        id: session_id.clone(),
        pty_master: Arc::new(Mutex::new(pty_pair.master)),
        pty_writer: Arc::new(Mutex::new(writer)),
        child_process: Arc::new(Mutex::new(child)),
        project_path: working_dir,
        active: true,
    };

    // Store session
    {
        let mut sessions = TERMINAL_SESSIONS.write().await;
        println!("[DEBUG] Storing session with ID: {}", session_id);
        sessions.insert(session_id.clone(), session);
        println!("[DEBUG] Session stored. Total sessions: {}", sessions.len());
    }

    // Start reading from PTY and sending output to frontend (only if not already running)
    {
        let mut handlers = ACTIVE_OUTPUT_HANDLERS.write().await;
        if !handlers.contains(&session_id) {
            // Reserve the handler slot immediately to prevent race conditions
            handlers.insert(session_id.clone());
            let session_id_clone = session_id.clone();
            let session_id_for_cleanup = session_id.clone();
            let app_clone = app.clone();
            tokio::spawn(async move {
                if let Err(e) = handle_pty_output_no_check(app_clone, session_id_clone).await {
                    eprintln!("PTY output handler error: {}", e);
                    // Remove from handlers on error
                    let mut handlers = ACTIVE_OUTPUT_HANDLERS.write().await;
                    handlers.remove(&session_id_for_cleanup);
                }
            });
            println!("[DEBUG] Spawned new PTY handler for session: {}", session_id);
        } else {
            println!("[DEBUG] PTY handler already exists for session: {}", session_id);
        }
    }

    Ok(session_id)
}

#[tauri::command]
async fn resume_claude_session(app: tauri::AppHandle, session_id: String, project_path: String) -> Result<String, String> {
    println!("[INFO] Resume request for session: {}", session_id);
    
    // Check if session already exists and is healthy
    {
        let sessions = TERMINAL_SESSIONS.read().await;
        if sessions.contains_key(&session_id) {
            println!("[DEBUG] Session {} already exists, verifying health", session_id);
            if verify_claude_health(&session_id).await {
                println!("[DEBUG] Session {} is healthy, returning existing session", session_id);
                return Ok(session_id);
            } else {
                println!("[DEBUG] Session {} is not healthy, will recreate", session_id);
                // Don't return early - let it recreate the session
            }
        }
    }
    
    // Clean up any existing unhealthy session
    {
        let mut sessions = TERMINAL_SESSIONS.write().await;
        if let Some(old_session) = sessions.remove(&session_id) {
            println!("[DEBUG] Removing unhealthy session and terminating process: {}", session_id);
            
            // Terminate the old Claude process
            if let Ok(mut child) = old_session.child_process.try_lock() {
                match child.kill() {
                    Ok(_) => println!("[DEBUG] Successfully killed old Claude process for session: {}", session_id),
                    Err(e) => println!("[WARN] Failed to kill old Claude process for session {}: {}", session_id, e)
                }
            } else {
                println!("[WARN] Could not acquire lock on old Claude process for session: {}", session_id);
            }
            
            // Remove from active handlers
            {
                let mut handlers = ACTIVE_OUTPUT_HANDLERS.write().await;
                handlers.remove(&session_id);
                println!("[DEBUG] Removed old session {} from active handlers during cleanup", session_id);
            }
        }
    }
    
    // Get the real project path for the working directory
    let working_dir = match get_real_project_path(project_path.clone()).await? {
        Some(real_path) => real_path,
        None => {
            return Err("Could not find real project path".to_string());
        }
    };

    // Create PTY system
    let pty_system = native_pty_system();
    
    // Create PTY with appropriate size
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to create PTY: {}", e))?;

    // Set up Claude command with resume flag
    let mut cmd = CommandBuilder::new("claude");
    cmd.cwd(&working_dir);
    cmd.arg("--resume");
    cmd.arg(&session_id);
    println!("[DEBUG] Starting Claude with resume for session {} in directory: {}", session_id, working_dir);
    
    // Start the child process
    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn Claude process: {}", e))?;

    // Get the writer ONCE and store it permanently
    println!("[DEBUG] Getting PTY writer for session: {}", session_id);
    let writer = pty_pair.master.take_writer()
        .map_err(|e| {
            let error_msg = format!("Failed to get PTY writer: {}", e);
            println!("[ERROR] {}", error_msg);
            error_msg
        })?;
    println!("[DEBUG] Successfully got PTY writer");
        
    // Create session with separate writer storage
    let session = TerminalSession {
        id: session_id.clone(),
        pty_master: Arc::new(Mutex::new(pty_pair.master)),
        pty_writer: Arc::new(Mutex::new(writer)),
        child_process: Arc::new(Mutex::new(child)),
        project_path: working_dir,
        active: true,
    };

    // Store session
    {
        let mut sessions = TERMINAL_SESSIONS.write().await;
        println!("[DEBUG] Storing session with ID: {}", session_id);
        sessions.insert(session_id.clone(), session);
        println!("[DEBUG] Session stored. Total sessions: {}", sessions.len());
    }

    // Start reading from PTY and sending output to frontend (only if not already running)
    {
        let mut handlers = ACTIVE_OUTPUT_HANDLERS.write().await;
        if !handlers.contains(&session_id) {
            // Reserve the handler slot immediately to prevent race conditions
            handlers.insert(session_id.clone());
            let session_id_clone = session_id.clone();
            let session_id_for_cleanup = session_id.clone();
            let app_clone = app.clone();
            tokio::spawn(async move {
                if let Err(e) = handle_pty_output_no_check(app_clone, session_id_clone).await {
                    eprintln!("PTY output handler error: {}", e);
                    // Remove from handlers on error
                    let mut handlers = ACTIVE_OUTPUT_HANDLERS.write().await;
                    handlers.remove(&session_id_for_cleanup);
                }
            });
            println!("[DEBUG] Spawned new PTY handler for session: {}", session_id);
        } else {
            println!("[DEBUG] PTY handler already exists for session: {}", session_id);
        }
    }

    Ok(session_id)
}

#[tauri::command]
async fn write_to_terminal(session_id: String, data: String) -> Result<(), String> {
    println!("[DEBUG] Writing to terminal session: {} (data length: {})", session_id, data.len());
    
    // First check if the session is healthy
    if !verify_claude_health(&session_id).await {
        let error_msg = format!("Session {} is not healthy or has exited", session_id);
        println!("[ERROR] {}", error_msg);
        return Err(error_msg);
    }
    
    let sessions = TERMINAL_SESSIONS.read().await;
    
    if let Some(session) = sessions.get(&session_id) {
        let mut writer_guard = session.pty_writer.lock().await;
        
        match writer_guard.write_all(data.as_bytes()) {
            Ok(_) => {
                match writer_guard.flush() {
                    Ok(_) => {
                        println!("[DEBUG] Successfully wrote and flushed data to session: {}", session_id);
                        Ok(())
                    }
                    Err(e) => {
                        let error_msg = format!("Failed to flush terminal {}: {}", session_id, e);
                        println!("[ERROR] {}", error_msg);
                        Err(error_msg)
                    }
                }
            }
            Err(e) => {
                let error_msg = format!("Failed to write to terminal {}: {}", session_id, e);
                println!("[ERROR] {}", error_msg);
                Err(error_msg)
            }
        }
    } else {
        let error_msg = format!("Session {} not found. Available sessions: {:?}", session_id, sessions.keys().collect::<Vec<_>>());
        println!("[ERROR] {}", error_msg);
        Err(error_msg)
    }
}

#[tauri::command]
async fn resize_terminal(session_id: String, rows: u16, cols: u16) -> Result<(), String> {
    let sessions = TERMINAL_SESSIONS.read().await;
    
    if let Some(session) = sessions.get(&session_id) {
        let pty_master = session.pty_master.lock().await;
        pty_master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize terminal: {}", e))?;
        Ok(())
    } else {
        Err("Session not found".to_string())
    }
}

#[tauri::command]
async fn close_terminal_session(session_id: String) -> Result<(), String> {
    println!("[INFO] Closing terminal session: {}", session_id);
    let mut sessions = TERMINAL_SESSIONS.write().await;
    
    if let Some(session) = sessions.remove(&session_id) {
        println!("[DEBUG] Found session to close: {}", session_id);
        
        // Gracefully terminate the child process
        if let Ok(mut child) = session.child_process.try_lock() {
            match child.kill() {
                Ok(_) => println!("[DEBUG] Successfully killed child process for session: {}", session_id),
                Err(e) => println!("[WARN] Failed to kill child process for session {}: {}", session_id, e)
            }
        } else {
            println!("[WARN] Could not acquire lock on child process for session: {}", session_id);
        }
        
        println!("[INFO] Session {} closed successfully. Remaining sessions: {}", session_id, sessions.len());
        Ok(())
    } else {
        let error_msg = format!("Session {} not found. Available sessions: {:?}", session_id, sessions.keys().collect::<Vec<_>>());
        println!("[ERROR] {}", error_msg);
        Err(error_msg)
    }
}

async fn handle_pty_output(app: tauri::AppHandle, session_id: String) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    println!("[DEBUG] Starting PTY output handler for session: {}", session_id);
    
    // Check if output handler is already running for this session
    {
        let mut handlers = ACTIVE_OUTPUT_HANDLERS.write().await;
        if handlers.contains(&session_id) {
            println!("[WARN] Output handler already running for session {}, skipping", session_id);
            return Ok(());
        }
        handlers.insert(session_id.clone());
    }
    
    let sessions = TERMINAL_SESSIONS.read().await;
    let session = sessions.get(&session_id).ok_or("Session not found")?;
    let pty_master = session.pty_master.clone();
    drop(sessions);

    let mut buffer = [0u8; 8192];
    
    loop {
        let pty = pty_master.lock().await;
        match pty.try_clone_reader() {
            Ok(mut reader) => {
                drop(pty); // Release the lock before blocking read
                
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        println!("[DEBUG] PTY EOF for session: {}", session_id);
                        break; // EOF
                    }
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buffer[..n]);
                        
                        // Parse for JSON events (including TodoWrite)
                        let lines: Vec<&str> = data.lines().collect();
                        for line in lines {
                            let line_trimmed = line.trim();
                            
                            // Debug: Log any line that mentions todos or TodoWrite
                            if line_trimmed.to_lowercase().contains("todo") {
                                println!("[DEBUG] Found todo-related line in session {}: {}", session_id, line_trimmed);
                            }
                            
                            // Check if this line contains TodoWrite JSON
                            if line_trimmed.contains("TodoWrite") && line_trimmed.contains("tool_use") {
                                println!("[DEBUG] Detected TodoWrite tool usage in session {}", session_id);
                                if let Err(e) = handle_todowrite_in_terminal(&app, &session_id, line_trimmed).await {
                                    println!("[ERROR] Failed to handle TodoWrite in terminal session {}: {}", session_id, e);
                                } else {
                                    println!("[SUCCESS] Successfully processed TodoWrite in terminal session {}", session_id);
                                }
                            }
                            
                            // Also check for human-readable todo format from Claude
                            if line_trimmed.contains("Update Todos") || line_trimmed.starts_with("     ☐ ") {
                                if let Err(e) = handle_human_readable_todos(&app, &session_id, &data).await {
                                    println!("[ERROR] Failed to handle human-readable todos in session {}: {}", session_id, e);
                                }
                            }
                        }
                        
                        let _ = app.emit("terminal_output", serde_json::json!({
                            "sessionId": session_id,
                            "data": data.to_string()
                        }));
                    }
                    Err(e) => {
                        println!("[ERROR] PTY read error for session {}: {}", session_id, e);
                        break;
                    }
                }
            }
            Err(e) => {
                println!("[ERROR] Failed to clone PTY reader for session {}: {}", session_id, e);
                break;
            }
        }
        
        // Small delay to prevent busy loop
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
    }
    
    // Remove from active handlers when done
    {
        let mut handlers = ACTIVE_OUTPUT_HANDLERS.write().await;
        handlers.remove(&session_id);
        println!("[DEBUG] Removed session {} from active handlers", session_id);
    }
    
    println!("[DEBUG] PTY output handler ended for session: {}", session_id);
    Ok(())
}

// PTY output handler without duplicate check (assumes caller already registered)
async fn handle_pty_output_no_check(app: tauri::AppHandle, session_id: String) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    println!("[DEBUG] Starting PTY output handler (no duplicate check) for session: {}", session_id);
    
    let sessions = TERMINAL_SESSIONS.read().await;
    let session = sessions.get(&session_id).ok_or("Session not found")?;
    let pty_master = session.pty_master.clone();
    drop(sessions);
    let mut buffer = [0u8; 8192];
    
    loop {
        let pty = pty_master.lock().await;
        match pty.try_clone_reader() {
            Ok(mut reader) => {
                drop(pty); // Release the lock before blocking read
                
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        println!("[DEBUG] PTY EOF for session: {}", session_id);
                        break; // EOF
                    }
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buffer[..n]);
                        
                        // Parse for JSON events (including TodoWrite)
                        let lines: Vec<&str> = data.lines().collect();
                        for line in lines {
                            let line_trimmed = line.trim();
                            
                            // Debug: Log any line that mentions todos or TodoWrite
                            if line_trimmed.to_lowercase().contains("todo") {
                                println!("[DEBUG] Found todo-related line in session {}: {}", session_id, line_trimmed);
                            }
                            
                            // Check if this line contains TodoWrite JSON
                            if line_trimmed.contains("TodoWrite") && line_trimmed.contains("tool_use") {
                                println!("[DEBUG] Detected TodoWrite tool usage in session {}", session_id);
                                if let Err(e) = handle_todowrite_in_terminal(&app, &session_id, line_trimmed).await {
                                    println!("[ERROR] Failed to handle TodoWrite in terminal session {}: {}", session_id, e);
                                } else {
                                    println!("[SUCCESS] Successfully processed TodoWrite in terminal session {}", session_id);
                                }
                            }
                            
                            // Also check for human-readable todo format from Claude
                            if line_trimmed.contains("Update Todos") || line_trimmed.starts_with("     ☐ ") {
                                if let Err(e) = handle_human_readable_todos(&app, &session_id, &data).await {
                                    println!("[ERROR] Failed to handle human-readable todos in session {}: {}", session_id, e);
                                }
                            }
                        }
                        
                        // Emit data to frontend
                        let _ = app.emit("terminal_output", serde_json::json!({
                            "sessionId": session_id,
                            "data": data.to_string()
                        }));
                    }
                    Err(e) => {
                        eprintln!("[ERROR] Failed to read from PTY for session {}: {}", session_id, e);
                        break;
                    }
                }
            }
            Err(e) => {
                eprintln!("[ERROR] Failed to clone PTY reader for session {}: {}", session_id, e);
                break;
            }
        }
        
        // Small delay to prevent busy loop
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
    }
    
    // Remove from active handlers when done
    {
        let mut handlers = ACTIVE_OUTPUT_HANDLERS.write().await;
        handlers.remove(&session_id);
        println!("[DEBUG] Removed session {} from active handlers", session_id);
    }
    
    println!("[DEBUG] PTY output handler (no check) ended for session: {}", session_id);
    Ok(())
}

// Human-readable todo parsing
async fn handle_human_readable_todos(
    app: &tauri::AppHandle,
    session_id: &str,
    terminal_data: &str
) -> Result<(), String> {
    static mut LAST_PROCESSED_CONTENT: Option<String> = None;
    
    // Prevent duplicate processing
    unsafe {
        if let Some(ref last_content) = LAST_PROCESSED_CONTENT {
            if last_content == terminal_data {
                return Ok(());
            }
        }
        LAST_PROCESSED_CONTENT = Some(terminal_data.to_string());
    }
    
    println!("[INFO] Processing human-readable todos from session: {}", session_id);
    
    // Check if this looks like a todo update section
    if !terminal_data.contains("Update Todos") {
        return Ok(());
    }
    
    let mut todos = Vec::new();
    let mut todo_counter = 1;
    
    // Parse todo items from the text
    for line in terminal_data.lines() {
        let line = line.trim();
        
        // Look for todo items starting with ☐ 
        if line.starts_with("☐ ") || line.contains("☐ ") {
            let content = line
                .replace("☐ ", "")
                .replace("     ", "")
                .trim()
                .to_string();
            
            if !content.is_empty() && content.len() > 10 { // Filter out very short items
                let todo = Todo {
                    id: format!("human-{}-{}", session_id, todo_counter),
                    content,
                    status: "pending".to_string(),
                    priority: "medium".to_string(),
                    created_at: chrono::Utc::now().to_rfc3339(),
                    session_id: Some(session_id.to_string()),
                };
                todos.push(todo);
                todo_counter += 1;
            }
        }
    }
    
    if !todos.is_empty() {
        println!("[INFO] Parsed {} human-readable todos", todos.len());
        
        // Get project path and save todos
        let project_path = get_session_project_path(session_id).await?;
        
        // Save the todos directly to the project directory (bypass get_real_project_path)
        if let Err(e) = save_todos_directly(&project_path, todos.clone()).await {
            println!("[ERROR] Failed to save human-readable todos: {}", e);
            return Err(e);
        }
        
        // Emit update event
        let _ = app.emit("todos_updated", serde_json::json!({
            "projectPath": project_path,
            "sessionId": session_id,
            "todos": todos
        }));
        
        println!("[SUCCESS] Successfully processed {} human-readable todos", todos.len());
    }
    
    Ok(())
}

// TodoWrite tool handling
async fn handle_todowrite_in_terminal(
    app: &tauri::AppHandle,
    session_id: &str,
    json_line: &str
) -> Result<(), String> {
    println!("[INFO] Processing TodoWrite from terminal session: {}", session_id);
    println!("[DEBUG] JSON line: {}", json_line);
    
    // Parse the JSON line to extract TodoWrite data
    if let Ok(claude_event) = serde_json::from_str::<ClaudeJsonEvent>(json_line) {
        println!("[DEBUG] Successfully parsed Claude event: {}", claude_event.event_type);
        if claude_event.event_type == "message_stream" {
            if let Some(message) = &claude_event.message {
                // Parse message content to extract tool usage
                if let Ok(content_value) = serde_json::from_str::<serde_json::Value>(&message.content) {
                    if let Some(content_array) = content_value.as_array() {
                        for item in content_array {
                            if let Some(item_type) = item.get("type").and_then(|t| t.as_str()) {
                                if item_type == "tool_use" {
                                    if let (Some(name), Some(input)) = (
                                        item.get("name").and_then(|n| n.as_str()),
                                        item.get("input")
                                    ) {
                                        if name == "TodoWrite" {
                                            if let Some(todos_data) = input.get("todos") {
                                                // Get project path from session
                                                let project_path = get_session_project_path(session_id).await?;
                                                
                                                // Process the todos
                                                return handle_todowrite_tool(app, &project_path, session_id, todos_data).await;
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
    } else {
        println!("[DEBUG] Failed to parse JSON line as ClaudeJsonEvent: {}", json_line);
    }
    
    Ok(())
}

async fn save_todos_directly(project_path: &str, todos: Vec<Todo>) -> Result<(), String> {
    // Create todos file path directly without resolving through get_real_project_path
    let todos_file_path = format!("{}/.claude-todos.json", project_path);
    
    println!("[DEBUG] Saving todos directly to: {}", todos_file_path);
    
    // Ensure directory exists
    let project_dir = std::path::Path::new(project_path);
    if !project_dir.exists() {
        return Err(format!("Project directory does not exist: {}", project_path));
    }
    
    // Load existing todos
    let mut all_todos = if std::path::Path::new(&todos_file_path).exists() {
        match std::fs::read_to_string(&todos_file_path) {
            Ok(content) => {
                serde_json::from_str::<Vec<Todo>>(&content).unwrap_or_else(|_| Vec::new())
            }
            Err(_) => Vec::new()
        }
    } else {
        Vec::new()
    };
    
    // Add new todos (replace any with matching IDs)
    for new_todo in todos {
        // Remove any existing todo with the same ID
        all_todos.retain(|existing| existing.id != new_todo.id);
        // Add the new todo
        all_todos.push(new_todo);
    }
    
    // Save back to file
    let json_content = serde_json::to_string_pretty(&all_todos)
        .map_err(|e| format!("Failed to serialize todos: {}", e))?;
    
    std::fs::write(&todos_file_path, json_content)
        .map_err(|e| format!("Failed to write todos file: {}", e))?;
    
    println!("[INFO] Successfully saved {} todos to {}", all_todos.len(), todos_file_path);
    Ok(())
}

async fn get_session_project_path(session_id: &str) -> Result<String, String> {
    let sessions = TERMINAL_SESSIONS.read().await;
    if let Some(session) = sessions.get(session_id) {
        println!("[DEBUG] Found session project path: {}", session.project_path);
        Ok(session.project_path.clone())
    } else {
        println!("[ERROR] Session {} not found in terminal sessions", session_id);
        Err(format!("Session {} not found", session_id))
    }
}

async fn handle_todowrite_tool(
    app: &tauri::AppHandle,
    project_path: &str,
    session_id: &str,
    todos_data: &serde_json::Value
) -> Result<(), String> {
    println!("[INFO] Processing TodoWrite tool for session: {}", session_id);
    
    if let Some(todos_array) = todos_data.as_array() {
        let mut parsed_todos = Vec::new();
        
        for todo_item in todos_array {
            if let (Some(content), Some(status), Some(priority), Some(id)) = (
                todo_item.get("content").and_then(|c| c.as_str()),
                todo_item.get("status").and_then(|s| s.as_str()),
                todo_item.get("priority").and_then(|p| p.as_str()),
                todo_item.get("id").and_then(|i| i.as_str())
            ) {
                let todo = Todo {
                    id: id.to_string(),
                    content: content.to_string(),
                    status: status.to_string(),
                    priority: priority.to_string(),
                    created_at: chrono::Utc::now().to_rfc3339(),
                    session_id: Some(session_id.to_string()),
                };
                parsed_todos.push(todo);
            }
        }
        
        // Save the todos
        if let Err(e) = save_project_todos(project_path.to_string(), parsed_todos.clone()).await {
            println!("[ERROR] Failed to save todos from TodoWrite: {}", e);
            return Err(e);
        }
        
        // Emit event for real-time UI update
        let _ = app.emit("todos_updated", serde_json::json!({
            "sessionId": session_id,
            "projectPath": project_path,
            "todos": parsed_todos
        }));
        
        println!("[INFO] Successfully processed {} todos from TodoWrite", parsed_todos.len());
    }
    
    Ok(())
}

// Todo management functions
async fn get_todos_file_path(project_path: String) -> Result<String, String> {
    let real_path = match get_real_project_path(project_path).await? {
        Some(path) => path,
        None => return Err("Could not find real project path".to_string())
    };
    
    Ok(format!("{}/.claude-todos.json", real_path))
}

#[tauri::command]
async fn load_project_todos(project_path: String) -> Result<Vec<Todo>, String> {
    println!("[DEBUG] load_project_todos called with path: {}", project_path);
    
    // Try multiple possible locations for the todos file
    let possible_paths = vec![
        format!("{}/.claude-todos.json", project_path),
        // If the project_path contains the transformed path, try to extract the real path
        if project_path.contains("/.claude/projects/") {
            // Extract real path from transformed path like: /home/user/.claude/projects/-home-user-repos-project
            let parts: Vec<&str> = project_path.split("/.claude/projects/").collect();
            if parts.len() == 2 {
                let encoded_path = parts[1];
                let real_path = encoded_path.replace("-", "/");
                format!("{}/.claude-todos.json", real_path)
            } else {
                project_path.clone()
            }
        } else {
            project_path.clone()
        }
    ];
    
    for todos_file in possible_paths {
        println!("[DEBUG] Trying to load todos from: {}", todos_file);
        
        if std::path::Path::new(&todos_file).exists() {
            println!("[DEBUG] Found todos file at: {}", todos_file);
            
            let content = std::fs::read_to_string(&todos_file)
                .map_err(|e| format!("Failed to read todos file: {}", e))?;
            
            // Try to parse as direct Vec<Todo> first (new format)
            if let Ok(todos) = serde_json::from_str::<Vec<Todo>>(&content) {
                println!("[DEBUG] Loaded {} todos directly", todos.len());
                return Ok(todos);
            }
            
            // Fallback to old ProjectTodos format
            if let Ok(project_todos) = serde_json::from_str::<ProjectTodos>(&content) {
                println!("[DEBUG] Loaded {} todos from ProjectTodos format", project_todos.todos.len());
                return Ok(project_todos.todos);
            }
            
            return Err("Failed to parse todos file in any known format".to_string());
        }
    }
    
    println!("[DEBUG] No todos file found in any of the attempted locations");
    Ok(vec![])
}

#[tauri::command]
async fn save_project_todos(project_path: String, todos: Vec<Todo>) -> Result<(), String> {
    let todos_file = get_todos_file_path(project_path).await?;
    
    let project_todos = ProjectTodos {
        todos,
        last_updated: chrono::Utc::now().to_rfc3339(),
    };
    
    let content = serde_json::to_string_pretty(&project_todos)
        .map_err(|e| format!("Failed to serialize todos: {}", e))?;
    
    std::fs::write(&todos_file, content)
        .map_err(|e| format!("Failed to write todos file: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn add_todo(
    project_path: String, 
    content: String, 
    priority: String,
    session_id: Option<String>
) -> Result<Todo, String> {
    let mut todos = load_project_todos(project_path.clone()).await?;
    
    let new_todo = Todo {
        id: Uuid::new_v4().to_string(),
        content,
        status: "pending".to_string(),
        priority,
        created_at: chrono::Utc::now().to_rfc3339(),
        session_id,
    };
    
    todos.push(new_todo.clone());
    save_project_todos(project_path, todos).await?;
    
    Ok(new_todo)
}

#[tauri::command]
async fn update_todo_status(
    project_path: String, 
    todo_id: String, 
    new_status: String
) -> Result<(), String> {
    let mut todos = load_project_todos(project_path.clone()).await?;
    
    if let Some(todo) = todos.iter_mut().find(|t| t.id == todo_id) {
        todo.status = new_status;
        save_project_todos(project_path, todos).await?;
        Ok(())
    } else {
        Err("Todo not found".to_string())
    }
}

#[tauri::command]
async fn delete_todo(project_path: String, todo_id: String) -> Result<(), String> {
    let mut todos = load_project_todos(project_path.clone()).await?;
    todos.retain(|t| t.id != todo_id);
    save_project_todos(project_path, todos).await?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_claude_projects,
            get_claude_version,
            get_claude_config,
            get_system_info,
            get_usage_statistics,
            update_claude_config,
            check_claude_updates,
            execute_claude_command,
            execute_claude_command_with_files,
            execute_claude_command_streaming,
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
            select_directory,
            start_claude_session,
            resume_claude_session,
            write_to_terminal,
            resize_terminal,
            close_terminal_session,
            load_project_todos,
            save_project_todos,
            add_todo,
            update_todo_status,
            delete_todo,
            read_file_content,
            write_file_content,
            create_file,
            create_directory,
            delete_file,
            rename_file,
            get_directory_tree
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}