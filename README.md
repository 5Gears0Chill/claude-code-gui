# Claude Code GUI

A modern desktop application that provides a beautiful, professional graphical interface for Claude Code CLI. Built with Tauri 2.0, React, and TypeScript to deliver a native desktop experience while maintaining the full power of Claude Code.

## Overview

Claude Code GUI transforms the command-line Claude Code experience into an intuitive desktop application. Rather than replacing Claude Code, it enhances it by providing visual project management, integrated terminal sessions, real-time usage analytics, and comprehensive system monitoring.

The application maintains full compatibility with existing Claude Code workflows while adding powerful features like session management, todo tracking, file exploration, and usage analytics that make working with Claude Code more efficient and insightful.

## Key Features

### Terminal Integration
- Built-in terminal emulator with xterm.js for native Claude Code sessions
- Picture-in-picture terminal mode with drag and drop positioning
- Session management with automatic resume functionality
- Real-time command execution with proper PTY handling
- Terminal history preservation and search capabilities

### Project Management
- Automatic discovery of Claude Code projects from `~/.claude/projects/`
- Visual project browser with metadata display
- Quick project switching and session management
- CLAUDE.md file editor with syntax highlighting
- Project creation wizard with templates and Git integration

### Usage Analytics
- Comprehensive token usage tracking from conversation history
- Cost estimation based on current Claude pricing
- Daily, weekly, and monthly usage breakdowns
- Model-specific analytics (Sonnet, Opus, etc.)
- Project-level usage filtering and analysis

### System Monitoring
- Real-time Claude Code version detection and system status
- Node.js and npm compatibility checking
- Installation verification and health monitoring
- Platform and architecture information display
- Professional status indicators with visual feedback

### Todo Management
- Integration with Claude's TodoWrite tool for real-time todo synchronization
- Session-specific todo filtering and display
- Read-only interface showing Claude-generated tasks
- Sidebar todo view during terminal sessions
- Automatic todo parsing from conversation streams

### File Operations
- Interactive file explorer with tree view navigation
- Syntax-highlighted file viewing and editing
- File operation support through Claude Code integration
- Project-specific file browsing and management

## Architecture

### Frontend Stack
- **Framework**: Next.js 14 with React 18 and TypeScript
- **Styling**: Tailwind CSS for responsive design
- **Terminal**: xterm.js with WebLinks, Search, and Fit addons
- **Icons**: Lucide React for consistent iconography
- **Build**: Next.js static export for Tauri integration

### Backend Stack
- **Runtime**: Tauri 2.0 with Rust backend
- **Process Management**: portable-pty for cross-platform PTY handling
- **File System**: Native Rust with serde for JSON parsing
- **IPC**: Tauri's invoke system for frontend-backend communication
- **Plugins**: fs, dialog, and shell plugins for system integration

### Data Flow
1. Frontend components invoke Tauri commands through the invoke API
2. Rust backend executes Claude CLI commands via PTY processes
3. Terminal output streams back to frontend through event emission
4. Usage data is parsed from local JSONL conversation files
5. System information is gathered from Claude CLI and system commands

## Installation Requirements

### System Dependencies
- **Node.js**: Version 18 or higher
- **npm**: Version 8 or higher  
- **Claude Code**: Installed globally via npm (`npm install -g @anthropic-ai/claude-code`)
- **Rust**: Latest stable version (for building from source)

### Platform Support
- **macOS**: 10.15 (Catalina) or later, both Intel and Apple Silicon
- **Windows**: Windows 10 version 1903 or later
- **Linux**: Ubuntu 18.04, Fedora 32, or equivalent with modern glibc

### Tested Environments
- macOS 14.x (Sonoma) with Apple M1/M2 processors
- macOS 13.x (Ventura) with Intel processors
- Node.js versions 18.x through 20.x
- Claude Code versions 1.0.50 through 1.0.56

## Getting Started

### Development Setup
1. Clone the repository and navigate to the project directory
2. Install frontend dependencies with `npm install`
3. Install Tauri CLI if not already available: `npm install -g @tauri-apps/cli`
4. Ensure Claude Code is installed and properly configured
5. Start development server with `npm run tauri dev`

### Building for Production
1. Build the frontend with `npm run build`
2. Create production bundle with `npm run tauri build`
3. The application bundle will be available in `src-tauri/target/release/bundle/`

### Configuration
The application automatically detects Claude Code configuration from:
- `~/.claude/settings.json` for user preferences
- `~/.claude/projects/` for project discovery
- System-wide npm installations for Claude Code detection

## Technical Implementation

### PTY Management
The application uses portable-pty to create pseudo-terminals for Claude Code sessions. Each session maintains its own PTY process with dedicated input/output streams. The backend handles process lifecycle management, including cleanup of orphaned processes and proper signal handling.

### Real-time Communication
Frontend and backend communicate through Tauri's event system. Terminal output streams are emitted as events and consumed by the React frontend in real-time. This architecture ensures responsive terminal interaction while maintaining proper separation of concerns.

### Usage Analytics Engine
The analytics system parses JSONL conversation files from `~/.claude/projects/` to extract detailed usage statistics. It handles nested JSON structures, tracks multiple models, and aggregates data across different time periods. Cost calculations are based on current Claude API pricing tiers.

### Session Management
Session state is maintained across application restarts through persistent storage. The application can resume interrupted sessions and maintains terminal history. Session metadata includes project context, model selection, and configuration state.

## Project Structure

```
claude-code-gui/
├── src/                          # Next.js frontend source
│   ├── app/                      # Next.js app router
│   └── components/               # React components
│       ├── TerminalInterface.tsx # Main terminal component
│       ├── SystemSettings.tsx    # Settings and analytics
│       ├── ProjectList.tsx       # Project management
│       ├── TodoManager.tsx       # Todo integration
│       └── ...
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   └── main.rs              # Main Tauri application
│   ├── Cargo.toml               # Rust dependencies
│   └── tauri.conf.json          # Tauri configuration
├── public/                       # Static assets
└── package.json                 # Node.js dependencies
```

## Contributing

The project follows standard Rust and TypeScript conventions. Frontend components are written in TypeScript with proper type definitions. Backend commands use Rust's type system for safe IPC communication. All code changes should maintain compatibility with the existing Claude Code ecosystem.

## Troubleshooting

### Common Issues
- **Empty usage statistics**: Ensure Claude Code has been used to create conversation files
- **Terminal not working**: Verify Claude Code is installed and accessible in PATH
- **Session resume failures**: Check that project directories exist and are accessible
- **Build failures**: Ensure all system dependencies are installed and up to date

### Debug Information
The application provides comprehensive logging in development mode. Terminal sessions, usage parsing, and system information gathering all include debug output to help diagnose issues.

## License

This project is licensed under the MIT License. See the LICENSE file for details.