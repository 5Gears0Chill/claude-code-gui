# Changelog

All notable changes to the Claude Code GUI project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-07-19

### Added

#### Phase 1: Foundation
- ✅ **Rust and Tauri CLI Setup**: Installed Rust toolchain and Tauri CLI via npm
- ✅ **Project Structure**: Created complete Tauri project with React/TypeScript frontend
- ✅ **Build System**: Configured Next.js with Tailwind CSS and TypeScript
- ✅ **Tauri Configuration**: Set up `tauri.conf.json` with proper permissions and plugins

#### Phase 2: Core Features Implementation
- ✅ **Project Management**: 
  - Created `ProjectList` component that parses `~/.claude/projects/` directory
  - Displays project name, path, and last modified date
  - Refresh functionality to reload projects
  - Visual project selection interface

- ✅ **Chat Interface**:
  - Built `ChatInterface` component with conversation history
  - Supports reading `.jsonl` conversation files from Claude Code projects
  - Real-time chat interface with Claude integration
  - Message formatting with user/assistant roles and timestamps
  - Error handling for failed Claude commands

- ✅ **File Operations**:
  - Implemented `FileExplorer` component with tree-view file browser
  - File/directory icons and expandable directory structure
  - File selection and content viewing interface
  - Project-specific file exploration

- ✅ **Todo Management**:
  - Created `TodoManager` component with full CRUD operations
  - Support for todo priority levels (high, medium, low)
  - Status tracking (pending, in_progress, completed)
  - Filtering by status and visual status indicators
  - Mock data integration (ready for Claude Code todo system integration)

- ✅ **UI/UX Implementation**:
  - Modern sidebar navigation with project context
  - Responsive design with Tailwind CSS
  - Dark/light theme support via CSS variables
  - Consistent component styling and interactions
  - Loading states and empty states for all views

#### Backend Integration (Rust)
- ✅ **Tauri Commands**: Implemented backend commands for:
  - `get_claude_projects()`: Parses and returns Claude Code projects
  - `execute_claude_command()`: Executes Claude CLI commands
  - `read_conversation_file()`: Reads and parses `.jsonl` conversation files

- ✅ **File System Integration**: 
  - Configured Tauri plugins for file system access
  - Proper permissions for Claude data directory (`~/.claude/`)
  - Shell command execution for Claude CLI integration

- ✅ **Data Models**: Defined Rust structs for:
  - `Project`: Project metadata and file paths
  - `ChatMessage`: Conversation message structure

### Technical Stack
- **Frontend**: Next.js 14.2.0, React 18, TypeScript, Tailwind CSS
- **Backend**: Rust with Tauri 2.0
- **UI Components**: Custom components with Lucide React icons
- **Build System**: Next.js static export, Tauri bundler

### Development Setup
- Development server configuration for Next.js frontend
- Tauri development integration with hot reload
- TypeScript configuration with strict typing
- ESLint and build optimization

### Known Limitations
- 🚧 **Image Drag & Drop**: Not yet implemented
- 🚧 **Settings Management**: GUI not yet implemented  
- 🚧 **Session Browser**: Advanced session management pending
- 🚧 **Icon Assets**: Placeholder icons, need proper application icons
- 🚧 **Production Build**: Minor configuration issues with Tauri bundling

#### Phase 3: Enhanced Features
- ✅ **Markdown Rendering**: Full markdown support with syntax highlighting
  - Integrated `react-markdown` with `remark-gfm` for GitHub-flavored markdown
  - Code syntax highlighting with `react-syntax-highlighter`
  - Support for tables, blockquotes, lists, and headers
  - Copy-to-clipboard functionality for code blocks

- ✅ **Enhanced Message Input**: Claude Code shortcuts and features
  - Autocomplete toggle (Shift+Tab) functionality  
  - Plan mode toggle and detection
  - File and media upload support with drag & drop
  - @ functionality for file/project references
  - Keyboard shortcuts and command palette

- ✅ **IDE Integration**: Cross-platform IDE detection and integration
  - Auto-detection of VS Code, Sublime Text, Atom, Vim/NeoVim
  - Platform-specific IDE command generation (macOS, Windows, Linux)
  - File opening with line number support
  - Project opening functionality

- ✅ **CLAUDE.md File Management**: 
  - CLAUDE.md file viewer and editor integration
  - Quick edit functionality for project instructions
  - Path resolution and encoding/decoding for Claude projects
  - Real-time file content display

- ✅ **Enhanced Project Management**:
  - Project creation functionality with directory picker
  - Git repository initialization option
  - Project template selection (React, Python, etc.)
  - Automatic CLAUDE.md template creation
  - Real project path display and navigation

- ✅ **Slash Command System**: Comprehensive command support
  - 40+ slash commands organized by category (/init, /plan, /compact, etc.)
  - Slash command autocomplete and suggestions
  - Real-time command detection and handling
  - Integration with Claude Code CLI execution

#### Phase 4: Real-time Claude Code Integration
- ✅ **Stream-JSON Integration**: Native Claude Code streaming format
  - Replaced custom text parsing with official stream-json format
  - Command format: `claude --print --output-format stream-json --verbose`
  - Proper JSON event parsing for system, assistant, and result events
  - Real-time session ID tracking and conversation continuity

- ✅ **Advanced Process Management**:
  - 30-second timeout protection to prevent hanging processes
  - Comprehensive error recovery for missing final result events
  - Process monitoring with stdout/stderr stream handling
  - Interactive permission prompt detection and handling

- ✅ **Session Management**:
  - Global session ID tracking for multi-turn conversations
  - Automatic session continuity using `--session-id` parameter
  - Support for conversation resumption and context preservation

- ✅ **Real-time Status Display**:
  - Live token usage display (input/output/total tokens)
  - Progress indicators for init, thinking, and completion states
  - Context status monitoring and display
  - Enhanced error handling with meaningful error messages

- ✅ **Permission System Integration**:
  - Real-time permission request detection from Claude Code
  - Interactive permission dialog with approve/deny actions
  - Bidirectional communication for permission responses
  - Support for file read permissions and tool access

- ✅ **XML Tag Processing**: Improved Claude Code output rendering
  - Processing of `<local-command-stdout>`, `<command-name>` tags
  - Better visualization of tool usage and command results
  - Enhanced markdown rendering for Claude's structured output

### Technical Improvements
- **Event System**: Tauri 2.0 event system with proper window-scoped listeners
- **Error Handling**: Comprehensive timeout and error recovery mechanisms
- **Type Safety**: Strong TypeScript typing for Claude events and messages
- **Performance**: Optimized stream processing and UI updates

### Bug Fixes - 2025-07-19
- ✅ **Fixed Session File Loading**: Enhanced error handling for missing session files with fallback to most recent session
- ✅ **Fixed Claude Process Timeout**: Resolved 30-second timeout issues by simplifying streaming approach and removing complex I/O handling
- ✅ **Fixed Working Directory Issue**: Claude now executes in selected project directory instead of GUI directory
- ✅ **Fixed JSON Parsing Error**: Removed unnecessary JSON parsing for `--print` mode text responses
- ✅ **Removed Test Stream Functionality**: Cleaned up development testing features from production interface
- ✅ **Verified New Chat Functionality**: Confirmed new conversations start in correct project directory context

### Major Streaming System Overhaul - 2025-07-19
- ✅ **Completely Restructured JSON Parsing**: Fixed `parse_claude_json_event` to properly handle Claude's stream-json format
  - Parse message content arrays containing text and tool_use blocks
  - Extract tool names, parameters, and execution details
  - Handle structured Claude Code output properly
- ✅ **Eliminated Duplicate Event Emissions**: Added deduplication logic to prevent the same event from being processed twice
  - Implemented `HashSet` to track processed lines
  - Eliminated console log spam and duplicate UI updates
- ✅ **Enhanced Tool Execution Visibility**: Users now see real-time tool usage information
  - Display when Claude uses Glob, Grep, Read, Task, and other tools
  - Show tool parameters (search patterns, file paths, task descriptions)
  - Present tool usage as "thinking" events with clear formatting
- ✅ **Fixed Permission Request Handling**: Permission dialogs now show readable prompts instead of JSON blobs
  - Detect permission requests from system events and message patterns
  - Generate human-readable permission prompts
  - Maintain proper permission options (Allow, Allow and remember, Deny)
- ✅ **Improved Token Usage Display**: Enhanced visual presentation of token consumption
  - Real-time token usage updates during operations
  - Styled token display with better visual hierarchy
  - Shows input, output, and total token counts
- ✅ **Reduced Event Noise**: Filtered out irrelevant JSON events to clean up console output
  - Only emit meaningful events (tool usage, responses, token usage, permissions)
  - Skip unknown or redundant events to improve performance
- ✅ **Enhanced Streaming Format**: Upgraded to `--output-format stream-json --verbose` for proper token usage and tool execution visibility
- ✅ **Fixed Duplicate Event Emissions**: Eliminated redundant status messages causing duplicate console logs
- ✅ **Code Cleanup**: Removed unused imports and functions from Rust backend

### Splash Screen Implementation - 2025-07-21
- ✅ **Added Beautiful Splash Screen**: Created animated loading screen with Claude Code GUI branding
  - Gradient background with floating decoration elements
  - Animated logo with floating icons (sparkles, code, zap)
  - Progressive loading steps with realistic simulation
  - Smooth progress bar with gradient animation
  - Background grid animation for visual appeal
- ✅ **Enhanced Loading States**: Improved app initialization flow
  - Delayed project loading until after splash screen
  - Custom LoadingSpinner component for terminal and other dynamic imports
  - Proper state management for app initialization
- ✅ **Branding Consistency**: Maintained Claude Code GUI identity throughout splash screen
  - Clear messaging that this is a GUI for Claude Code CLI
  - Professional loading messages that reflect app functionality
  - Consistent color scheme with rest of application

### Comprehensive Settings Panel Implementation - 2025-07-21
- ✅ **Complete Settings Panel Overhaul**: Replaced basic IDE settings with comprehensive system dashboard
  - Real Claude Code version detection and system status monitoring
  - Live authentication status and account information display
  - Node.js/npm version compatibility checking
  - Platform and architecture information display
  - Professional health indicators (green/yellow/red status icons)
  
- ✅ **Advanced Usage Analytics**: Implemented detailed token usage tracking and statistics
  - Parse local JSONL conversation files for comprehensive usage data
  - Track input tokens, output tokens, cache creation/read tokens across all sessions
  - Display usage by model type (Sonnet, Opus) with session counts
  - Daily usage breakdown with historical tracking
  - Cost estimation based on current Claude pricing structure
  - Project-specific usage filtering and aggregation
  
- ✅ **System Information Dashboard**: Added comprehensive system monitoring
  - Claude CLI installation path and method detection
  - Real-time version checking with `claude --version`
  - Configuration parsing via `claude config list`
  - System platform and architecture detection
  - Dependency verification (Node.js, npm versions)
  
- ✅ **New Tauri Backend Commands**: Implemented robust system information APIs
  - `get_claude_version()`: Execute Claude CLI version checking
  - `get_claude_config()`: Parse and return Claude configuration
  - `get_system_info()`: Gather Node.js, npm, platform information
  - `get_usage_statistics()`: Parse JSONL files for token usage analytics
  - `update_claude_config()`: Enable configuration management
  - `check_claude_updates()`: Future update checking capability
  
- ✅ **Professional UI Design**: Created tabbed interface with organized information architecture
  - Overview tab: System status and quick statistics
  - Usage Stats tab: Detailed analytics with visual charts
  - System Info tab: Technical system information
  - Responsive design with loading states and error handling
  - Color-coded status indicators and professional data visualization

### Next Steps
- Complete configuration management interface for editing Claude settings
- Implement update management functionality with one-click updates
- Add ccusage integration for advanced usage analytics
- Implement drag & drop image support for chat interface
- Create proper application icons and branding
- Implement comprehensive testing suite