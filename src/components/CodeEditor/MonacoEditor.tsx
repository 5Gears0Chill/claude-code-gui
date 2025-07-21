'use client'

import { useEffect, useRef, useState } from 'react'
import Editor, { Monaco } from '@monaco-editor/react'
import { invoke } from '@tauri-apps/api/core'
import { Save, RotateCcw, Type, Search, Settings, Maximize, Minimize } from 'lucide-react'
import { useHotkeys } from 'react-hotkeys-hook'

interface MonacoEditorProps {
  filePath: string
  language?: string
  theme?: 'light' | 'dark'
  readOnly?: boolean
  onContentChange?: (content: string) => void
  onSave?: (content: string) => void
}

export function MonacoEditor({ 
  filePath, 
  language, 
  theme = 'dark',
  readOnly = false,
  onContentChange,
  onSave
}: MonacoEditorProps) {
  const [content, setContent] = useState<string>('')
  const [originalContent, setOriginalContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [editorOptions, setEditorOptions] = useState({
    fontSize: 14,
    wordWrap: 'on' as 'on' | 'off',
    minimap: { enabled: true },
    lineNumbers: 'on' as const,
    folding: true,
    autoClosingBrackets: 'always' as const,
    autoClosingQuotes: 'always' as const,
    formatOnPaste: true,
    formatOnType: true
  })

  const editorRef = useRef<any>(null)
  const monacoRef = useRef<Monaco | null>(null)

  // Detect language from file extension
  const detectLanguage = (filePath: string): string => {
    const extension = filePath.split('.').pop()?.toLowerCase()
    const languageMap: { [key: string]: string } = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'rs': 'rust',
      'go': 'go',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'php': 'php',
      'rb': 'ruby',
      'swift': 'swift',
      'kt': 'kotlin',
      'dart': 'dart',
      'json': 'json',
      'xml': 'xml',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'sass': 'scss',
      'less': 'less',
      'md': 'markdown',
      'yml': 'yaml',
      'yaml': 'yaml',
      'toml': 'toml',
      'ini': 'ini',
      'sql': 'sql',
      'sh': 'shell',
      'bash': 'shell',
      'zsh': 'shell',
      'fish': 'shell',
      'ps1': 'powershell',
      'dockerfile': 'dockerfile',
      'vue': 'vue',
      'svelte': 'svelte'
    }
    return language || languageMap[extension || ''] || 'plaintext'
  }

  // Keyboard shortcuts
  useHotkeys('ctrl+s, cmd+s', (e) => {
    e.preventDefault()
    handleSave()
  }, { enableOnFormTags: true })

  useHotkeys('ctrl+z, cmd+z', () => {
    editorRef.current?.trigger('keyboard', 'undo', null)
  }, { enableOnFormTags: true })

  useHotkeys('ctrl+y, cmd+shift+z', () => {
    editorRef.current?.trigger('keyboard', 'redo', null)
  }, { enableOnFormTags: true })

  useHotkeys('ctrl+f, cmd+f', () => {
    editorRef.current?.trigger('keyboard', 'actions.find', null)
  }, { enableOnFormTags: true })

  useHotkeys('escape', () => {
    if (isFullscreen) {
      setIsFullscreen(false)
    }
  })

  useEffect(() => {
    loadFileContent()
  }, [filePath])

  useEffect(() => {
    setHasUnsavedChanges(content !== originalContent && !loading)
  }, [content, originalContent, loading])

  const loadFileContent = async () => {
    if (!filePath) return
    
    try {
      setLoading(true)
      setError(null)
      const fileContent = await invoke<string>('read_file_content', { filePath })
      setContent(fileContent)
      setOriginalContent(fileContent)
      setHasUnsavedChanges(false)
    } catch (err) {
      setError(err as string)
      console.error('Failed to load file:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!filePath || saving) return
    
    try {
      setSaving(true)
      await invoke('write_file_content', { filePath, content })
      setOriginalContent(content)
      setHasUnsavedChanges(false)
      onSave?.(content)
    } catch (err) {
      setError(err as string)
      console.error('Failed to save file:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleEditorChange = (value: string | undefined) => {
    const newContent = value || ''
    setContent(newContent)
    onContentChange?.(newContent)
  }

  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    // Configure editor theme for better integration
    monaco.editor.defineTheme('claude-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#0f172a',
        'editor.foreground': '#f8fafc',
        'editorCursor.foreground': '#06b6d4',
        'editor.lineHighlightBackground': '#1e293b',
        'editor.selectionBackground': '#374151',
        'editor.inactiveSelectionBackground': '#374151'
      }
    })

    monaco.editor.defineTheme('claude-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#1e293b',
        'editorCursor.foreground': '#0369a1',
        'editor.lineHighlightBackground': '#f8fafc',
        'editor.selectionBackground': '#dbeafe',
        'editor.inactiveSelectionBackground': '#f3f4f6'
      }
    })

    // Set initial theme
    monaco.editor.setTheme(theme === 'dark' ? 'claude-dark' : 'claude-light')

    // Add custom actions
    editor.addAction({
      id: 'save-file',
      label: 'Save File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => handleSave()
    })

    // Focus editor
    editor.focus()
  }

  const resetContent = () => {
    setContent(originalContent)
    setHasUnsavedChanges(false)
  }

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen)
  }

  const formatCode = () => {
    editorRef.current?.trigger('editor', 'editor.action.formatDocument', null)
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-card">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-card">
        <div className="text-center">
          <div className="text-red-500 text-lg mb-2">Failed to load file</div>
          <div className="text-muted-foreground text-sm mb-4">{error}</div>
          <button 
            onClick={loadFileContent}
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col h-full ${isFullscreen ? 'fixed inset-0 z-50 bg-background' : ''}`}>
      {/* Editor Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-2">
            <Type size={16} className="text-muted-foreground" />
            <span className="text-sm font-medium">{filePath.split('/').pop()}</span>
            {hasUnsavedChanges && (
              <div className="w-2 h-2 bg-yellow-500 rounded-full" title="Unsaved changes" />
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {detectLanguage(filePath)}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {hasUnsavedChanges && (
            <button
              onClick={resetContent}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
              title="Reset changes"
            >
              <RotateCcw size={16} />
            </button>
          )}
          
          <button
            onClick={formatCode}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
            title="Format code"
          >
            <Type size={16} />
          </button>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
            title="Editor settings"
          >
            <Settings size={16} />
          </button>

          <button
            onClick={toggleFullscreen}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
            title="Toggle fullscreen"
          >
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>

          <button
            onClick={handleSave}
            disabled={saving || !hasUnsavedChanges || readOnly}
            className="flex items-center space-x-2 px-3 py-1 bg-primary text-primary-foreground rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
            title="Save file (Ctrl+S)"
          >
            <Save size={16} />
            <span className="text-sm">
              {saving ? 'Saving...' : 'Save'}
            </span>
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <div className="grid grid-cols-4 gap-4 text-sm">
            <label className="flex items-center space-x-2">
              <span>Font Size:</span>
              <input
                type="number"
                min="10"
                max="24"
                value={editorOptions.fontSize}
                onChange={(e) => setEditorOptions(prev => ({ ...prev, fontSize: parseInt(e.target.value) }))}
                className="w-16 px-2 py-1 bg-background border border-border rounded"
              />
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={editorOptions.minimap.enabled}
                onChange={(e) => setEditorOptions(prev => ({ 
                  ...prev, 
                  minimap: { enabled: e.target.checked }
                }))}
              />
              <span>Minimap</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={editorOptions.wordWrap === 'on'}
                onChange={(e) => setEditorOptions(prev => ({ 
                  ...prev, 
                  wordWrap: e.target.checked ? 'on' : 'off' 
                }))}
              />
              <span>Word Wrap</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={editorOptions.folding}
                onChange={(e) => setEditorOptions(prev => ({ ...prev, folding: e.target.checked }))}
              />
              <span>Code Folding</span>
            </label>
          </div>
        </div>
      )}

      {/* Monaco Editor */}
      <div className="flex-1">
        <Editor
          value={content}
          language={detectLanguage(filePath)}
          theme={theme === 'dark' ? 'claude-dark' : 'claude-light'}
          onChange={handleEditorChange}
          onMount={handleEditorDidMount}
          options={{
            ...editorOptions,
            readOnly,
            automaticLayout: true,
            contextmenu: true,
            copyWithSyntaxHighlighting: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            find: {
              addExtraSpaceOnTop: false,
              autoFindInSelection: 'never',
              seedSearchStringFromSelection: 'always'
            },
            fontFamily: 'JetBrains Mono, Fira Code, Consolas, Monaco, "Courier New", monospace',
            fontLigatures: true,
            matchBrackets: 'always',
            mouseWheelZoom: true,
            multiCursorModifier: 'ctrlCmd',
            renderLineHighlight: 'line',
            renderWhitespace: 'selection',
            selectOnLineNumbers: true,
            smoothScrolling: true,
            suggest: {
              insertMode: 'replace',
              showKeywords: true,
              showSnippets: true
            },
            tabCompletion: 'on',
            unicodeHighlight: {
              ambiguousCharacters: true,
              invisibleCharacters: true
            },
            bracketPairColorization: {
              enabled: true
            }
          }}
        />
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between px-4 py-1 text-xs text-muted-foreground border-t border-border bg-card">
        <div className="flex items-center space-x-4">
          <span>
            {content.length} characters, {content.split('\n').length} lines
          </span>
          {hasUnsavedChanges && (
            <span className="text-yellow-600">• Unsaved changes</span>
          )}
        </div>
        <div className="flex items-center space-x-4">
          <span>{detectLanguage(filePath)}</span>
          <span>UTF-8</span>
        </div>
      </div>
    </div>
  )
}