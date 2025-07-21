'use client'

import { useState, useRef, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { 
  Send, 
  Paperclip, 
  Image, 
  FileText, 
  X, 
  AtSign, 
  Brain, 
  Zap,
  Upload,
  Search,
  ChevronDown
} from 'lucide-react'

interface FileInfo {
  name: string
  path: string
  size: number
  mime_type: string
}

interface EnhancedMessageInputProps {
  onSendMessage: (message: string, files: string[], options: MessageOptions) => void
  loading: boolean
  selectedProject: any
}

interface MessageOptions {
  enableAutocomplete: boolean
  planMode: boolean
  attachedFiles: string[]
}

export function EnhancedMessageInput({ onSendMessage, loading, selectedProject }: EnhancedMessageInputProps) {
  const [message, setMessage] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<FileInfo[]>([])
  const [enableAutocomplete, setEnableAutocomplete] = useState(true)
  const [planMode, setPlanMode] = useState(false)
  const [showFilePicker, setShowFilePicker] = useState(false)
  const [showAtMention, setShowAtMention] = useState(false)
  const [showSlashCommands, setShowSlashCommands] = useState(false)
  const [projectFiles, setProjectFiles] = useState<FileInfo[]>([])
  const [fileSearchQuery, setFileSearchQuery] = useState('')
  const [atMentionQuery, setAtMentionQuery] = useState('')
  const [slashCommandQuery, setSlashCommandQuery] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const slashCommands = [
    // Session Management
    { command: '/init', description: 'Initialize a new conversation', category: 'Session' },
    { command: '/clear', description: 'Clear conversation history', category: 'Session' },
    { command: '/resume', description: 'Resume from a previous conversation', category: 'Session' },
    { command: '/reset', description: 'Reset conversation state', category: 'Session' },
    { command: '/save', description: 'Save current conversation', category: 'Session' },
    
    // Response Modes
    { command: '/plan', description: 'Switch to plan mode for strategic thinking', category: 'Mode' },
    { command: '/compact', description: 'Use compact response format', category: 'Format' },
    { command: '/verbose', description: 'Use detailed response format', category: 'Format' },
    { command: '/brief', description: 'Give brief, concise responses', category: 'Format' },
    { command: '/detailed', description: 'Provide comprehensive explanations', category: 'Format' },
    { command: '/step', description: 'Break down into step-by-step instructions', category: 'Format' },
    
    // Development Tools
    { command: '/debug', description: 'Help debug code or issues', category: 'Development' },
    { command: '/test', description: 'Generate or run tests', category: 'Development' },
    { command: '/refactor', description: 'Suggest code refactoring', category: 'Development' },
    { command: '/review', description: 'Code review and suggestions', category: 'Development' },
    { command: '/docs', description: 'Generate documentation', category: 'Development' },
    { command: '/analyze', description: 'Analyze code structure or performance', category: 'Development' },
    { command: '/optimize', description: 'Suggest optimizations', category: 'Development' },
    
    // Context & Focus
    { command: '/context', description: 'Add context about the current task', category: 'Context' },
    { command: '/focus', description: 'Focus on a specific aspect or file', category: 'Context' },
    { command: '/scope', description: 'Define the scope of work', category: 'Context' },
    { command: '/explain', description: 'Explain concepts or code', category: 'Context' },
    { command: '/summary', description: 'Summarize current state or progress', category: 'Context' },
    
    // File Operations
    { command: '/create', description: 'Create new files or components', category: 'Files' },
    { command: '/edit', description: 'Edit existing files', category: 'Files' },
    { command: '/search', description: 'Search through project files', category: 'Files' },
    { command: '/diff', description: 'Show differences between versions', category: 'Files' },
    { command: '/tree', description: 'Show project structure', category: 'Files' },
    
    // Information & Help
    { command: '/help', description: 'Show available commands and shortcuts', category: 'Info' },
    { command: '/status', description: 'Show current session status', category: 'Info' },
    { command: '/version', description: 'Show Claude Code version info', category: 'Info' },
    { command: '/config', description: 'Show or modify configuration', category: 'Info' },
    { command: '/shortcuts', description: 'List keyboard shortcuts', category: 'Info' },
    
    // Project Management
    { command: '/todo', description: 'Manage project todos', category: 'Project' },
    { command: '/goals', description: 'Set or review project goals', category: 'Project' },
    { command: '/progress', description: 'Track project progress', category: 'Project' },
    { command: '/milestone', description: 'Mark or review milestones', category: 'Project' },
    
    // Advanced Features
    { command: '/benchmark', description: 'Run performance benchmarks', category: 'Advanced' },
    { command: '/profile', description: 'Profile code performance', category: 'Advanced' },
    { command: '/security', description: 'Security analysis and suggestions', category: 'Advanced' },
    { command: '/deploy', description: 'Deployment assistance', category: 'Advanced' },
    { command: '/monitor', description: 'Set up monitoring or logging', category: 'Advanced' }
  ]

  useEffect(() => {
    if (selectedProject && showAtMention) {
      loadProjectFiles()
    }
  }, [selectedProject, showAtMention, fileSearchQuery])

  const loadProjectFiles = async () => {
    if (!selectedProject) return
    
    try {
      const files = await invoke<FileInfo[]>('get_project_files', {
        projectPath: selectedProject.path,
        pattern: fileSearchQuery || undefined
      })
      setProjectFiles(files.slice(0, 20)) // Limit to 20 for performance
    } catch (error) {
      console.error('Failed to load project files:', error)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Shift+Tab for autocomplete toggle
    if (e.shiftKey && e.key === 'Tab') {
      e.preventDefault()
      setEnableAutocomplete(!enableAutocomplete)
      return
    }

    // Ctrl/Cmd+P for plan mode
    if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
      e.preventDefault()
      setPlanMode(!planMode)
      return
    }

    // @ for file mentions
    if (e.key === '@' && !showAtMention) {
      setShowAtMention(true)
      setAtMentionQuery('')
      return
    }

    // / for slash commands
    if (e.key === '/' && message.length === 0 && !showSlashCommands) {
      setShowSlashCommands(true)
      setSlashCommandQuery('')
      return
    }

    // Escape to close modals
    if (e.key === 'Escape') {
      setShowFilePicker(false)
      setShowAtMention(false)
      setShowSlashCommands(false)
      return
    }

    // Enter to send (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
      return
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setMessage(value)
    
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }

    // Handle @ mentions
    if (showAtMention) {
      const lastAtIndex = value.lastIndexOf('@')
      if (lastAtIndex !== -1) {
        const query = value.slice(lastAtIndex + 1)
        setAtMentionQuery(query)
        setFileSearchQuery(query)
      } else {
        setShowAtMention(false)
      }
    }

    // Handle slash commands
    if (showSlashCommands) {
      if (value.startsWith('/')) {
        const spaceIndex = value.indexOf(' ')
        const query = spaceIndex === -1 ? value.slice(1) : value.slice(1, spaceIndex)
        setSlashCommandQuery(query)
        
        // If user added a space, complete the command and hide dropdown
        if (spaceIndex !== -1) {
          setShowSlashCommands(false)
        }
      } else {
        setShowSlashCommands(false)
      }
    }
  }

  const handleSend = () => {
    if (!message.trim() && attachedFiles.length === 0) return

    const options: MessageOptions = {
      enableAutocomplete,
      planMode,
      attachedFiles: attachedFiles.map(f => f.path)
    }

    onSendMessage(message, attachedFiles.map(f => f.path), options)
    setMessage('')
    setAttachedFiles([])
    setPlanMode(false)
    
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleFileUpload = async (files: FileList) => {
    const newFiles: FileInfo[] = []
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      try {
        // For now, create a basic FileInfo object from browser File
        // In a real implementation, you'd need to handle file upload differently
        const fileInfo: FileInfo = {
          name: file.name,
          path: file.name, // Use name as path for display
          size: file.size,
          mime_type: file.type || 'application/octet-stream'
        }
        newFiles.push(fileInfo)
      } catch (error) {
        console.error('Failed to get file info:', error)
      }
    }
    
    setAttachedFiles(prev => [...prev, ...newFiles])
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    
    if (e.dataTransfer.files) {
      handleFileUpload(e.dataTransfer.files)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const selectFile = (file: FileInfo) => {
    if (!attachedFiles.find(f => f.path === file.path)) {
      setAttachedFiles(prev => [...prev, file])
    }
    setShowFilePicker(false)
    setShowAtMention(false)
  }

  const selectAtMention = (file: FileInfo) => {
    const lastAtIndex = message.lastIndexOf('@')
    const newMessage = message.slice(0, lastAtIndex) + `${file.path} `
    setMessage(newMessage)
    setShowAtMention(false)
    
    // Don't add to attachedFiles since the path is now in the message
  }

  const selectSlashCommand = (command: string) => {
    setMessage(command + ' ')
    setShowSlashCommands(false)
    
    // Focus back on textarea
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }

  const removeFile = (filePath: string) => {
    setAttachedFiles(prev => prev.filter(f => f.path !== filePath))
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const filteredProjectFiles = projectFiles.filter(file => 
    file.name.toLowerCase().includes(atMentionQuery.toLowerCase())
  )

  const filteredSlashCommands = slashCommands.filter(cmd => 
    cmd.command.toLowerCase().includes(slashCommandQuery.toLowerCase()) ||
    cmd.description.toLowerCase().includes(slashCommandQuery.toLowerCase())
  )

  // Group commands by category
  const groupedCommands = filteredSlashCommands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) {
      acc[cmd.category] = []
    }
    acc[cmd.category].push(cmd)
    return acc
  }, {} as Record<string, typeof slashCommands>)

  return (
    <div className="relative">
      {/* File Picker Modal */}
      {showFilePicker && (
        <div className="absolute bottom-full left-0 w-full mb-2 bg-card border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto z-10">
          <div className="p-3 border-b border-border">
            <div className="flex items-center space-x-2">
              <Search size={16} className="text-muted-foreground" />
              <input
                type="text"
                placeholder="Search files..."
                value={fileSearchQuery}
                onChange={(e) => setFileSearchQuery(e.target.value)}
                className="flex-1 bg-transparent border-none outline-none text-sm"
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {projectFiles.map((file) => (
              <button
                key={file.path}
                onClick={() => selectFile(file)}
                className="w-full p-3 text-left hover:bg-accent transition-colors flex items-center space-x-3"
              >
                <FileText size={16} className="text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-foreground truncate">{file.name}</div>
                  <div className="text-xs text-muted-foreground">{formatFileSize(file.size)}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* @ Mention Dropdown */}
      {showAtMention && (
        <div className="absolute bottom-full left-0 w-full mb-2 bg-card border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto z-10">
          <div className="p-2 border-b border-border">
            <div className="text-xs text-muted-foreground">Reference files with @</div>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filteredProjectFiles.map((file) => (
              <button
                key={file.path}
                onClick={() => selectAtMention(file)}
                className="w-full p-2 text-left hover:bg-accent transition-colors flex items-center space-x-2"
              >
                <AtSign size={14} className="text-primary" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-foreground truncate">{file.name}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Slash Commands Dropdown */}
      {showSlashCommands && (
        <div className="absolute bottom-full left-0 w-full mb-2 bg-card border border-border rounded-lg shadow-lg max-h-80 overflow-y-auto z-10">
          <div className="p-3 border-b border-border">
            <div className="text-xs text-muted-foreground">Claude Code Commands</div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {Object.entries(groupedCommands).map(([category, commands]) => (
              <div key={category}>
                <div className="px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/30 border-b border-border">
                  {category}
                </div>
                {commands.map((cmd) => (
                  <button
                    key={cmd.command}
                    onClick={() => selectSlashCommand(cmd.command)}
                    className="w-full p-3 text-left hover:bg-accent transition-colors flex items-start space-x-3"
                  >
                    <div className="flex items-center justify-center w-6 h-6 bg-primary/10 rounded text-primary text-xs font-mono">
                      /
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground">{cmd.command}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{cmd.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            ))}
            {filteredSlashCommands.length === 0 && (
              <div className="p-3 text-center text-sm text-muted-foreground">
                No commands found matching "{slashCommandQuery}"
              </div>
            )}
          </div>
        </div>
      )}

      {/* Attached Files */}
      {attachedFiles.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachedFiles.map((file) => (
            <div
              key={file.path}
              className="flex items-center space-x-2 bg-secondary text-secondary-foreground px-3 py-1 rounded-full text-sm"
            >
              <FileText size={14} />
              <span className="truncate max-w-32">{file.name}</span>
              <button
                onClick={() => removeFile(file.path)}
                className="hover:bg-secondary-foreground/20 rounded-full p-1"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Mode Indicators */}
      <div className="flex items-center space-x-2 mb-2">
        <button
          onClick={() => setEnableAutocomplete(!enableAutocomplete)}
          className={`flex items-center space-x-1 px-2 py-1 rounded text-xs transition-colors ${
            enableAutocomplete 
              ? 'bg-primary text-primary-foreground' 
              : 'bg-secondary text-secondary-foreground'
          }`}
          title="Toggle Autocomplete (Shift+Tab)"
        >
          <Zap size={12} />
          <span>Autocomplete</span>
        </button>
        
        <button
          onClick={() => setPlanMode(!planMode)}
          className={`flex items-center space-x-1 px-2 py-1 rounded text-xs transition-colors ${
            planMode 
              ? 'bg-primary text-primary-foreground' 
              : 'bg-secondary text-secondary-foreground'
          }`}
          title="Toggle Plan Mode (Ctrl/Cmd+P)"
        >
          <Brain size={12} />
          <span>Plan Mode</span>
        </button>
      </div>

      {/* Main Input Area */}
      <div 
        className={`relative border border-border rounded-lg transition-colors ${
          isDragging ? 'border-primary bg-primary/5' : ''
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={`Type your message to Claude... ${planMode ? '(Plan Mode)' : ''}`}
          className="w-full p-4 bg-transparent border-none outline-none resize-none min-h-[80px] max-h-[200px]"
          disabled={loading}
        />
        
        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center">
            <div className="text-center">
              <Upload size={32} className="text-primary mx-auto mb-2" />
              <p className="text-primary font-medium">Drop files to attach</p>
            </div>
          </div>
        )}
        
        {/* Bottom toolbar */}
        <div className="flex items-center justify-between p-3 border-t border-border">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowFilePicker(!showFilePicker)}
              className="p-2 hover:bg-accent rounded-lg transition-colors"
              title="Attach files"
            >
              <Paperclip size={16} />
            </button>
            
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
            />
            
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 hover:bg-accent rounded-lg transition-colors"
              title="Upload from computer"
            >
              <Upload size={16} />
            </button>
          </div>
          
          <div className="flex items-center space-x-2">
            <div className="text-xs text-muted-foreground">
              /: Commands • @: Files • Shift+Tab: Autocomplete • Ctrl+P: Plan
            </div>
            
            <button
              onClick={handleSend}
              disabled={loading || (!message.trim() && attachedFiles.length === 0)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center space-x-2"
            >
              <Send size={16} />
              <span>Send</span>
            </button>
          </div>
        </div>
      </div>
      
      {/* Help text */}
      <div className="mt-2 text-xs text-muted-foreground">
        <span>💡 </span>
        <span>Type / for commands, @ for files, drag & drop to attach, Shift+Tab for autocomplete</span>
      </div>
    </div>
  )
}