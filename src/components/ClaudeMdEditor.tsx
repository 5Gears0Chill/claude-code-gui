'use client'

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { 
  FileText, 
  Edit3, 
  Save, 
  X, 
  Eye, 
  Plus, 
  ExternalLink, 
  RefreshCw,
  AlertCircle,
  CheckCircle
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { tomorrow } from 'react-syntax-highlighter/dist/esm/styles/prism'
import remarkGfm from 'remark-gfm'

interface ClaudeMdEditorProps {
  selectedProject: any
}

export function ClaudeMdEditor({ selectedProject }: ClaudeMdEditorProps) {
  const [content, setContent] = useState<string>('')
  const [isEditing, setIsEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [exists, setExists] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [debugInfo, setDebugInfo] = useState<string>('')

  useEffect(() => {
    if (selectedProject) {
      loadClaudeMd()
    }
  }, [selectedProject])

  const loadClaudeMd = async () => {
    if (!selectedProject) return

    try {
      setLoading(true)
      
      // Debug: Get detailed path information
      const debug = await invoke<string>('debug_project_path', {
        projectPath: selectedProject.path
      })
      setDebugInfo(debug)
      console.log('Debug info:', debug)
      
      // Check if file exists
      const fileExists = await invoke<boolean>('check_claude_md_exists', {
        projectPath: selectedProject.path
      })
      
      setExists(fileExists)
      
      if (fileExists) {
        // Load content
        const fileContent = await invoke<string | null>('get_claude_md_content', {
          projectPath: selectedProject.path
        })
        setContent(fileContent || '')
      } else {
        setContent('')
      }
      
      setHasChanges(false)
    } catch (error) {
      console.error('Failed to load CLAUDE.md:', error)
      setDebugInfo(`Error: ${error}`)
    } finally {
      setLoading(false)
    }
  }

  const saveClaudeMd = async () => {
    if (!selectedProject || !hasChanges) return

    try {
      setSaveStatus('saving')
      
      await invoke('save_claude_md_content', {
        projectPath: selectedProject.path,
        content: content
      })
      
      setExists(true)
      setHasChanges(false)
      setSaveStatus('saved')
      
      // Reset save status after 2 seconds
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (error) {
      console.error('Failed to save CLAUDE.md:', error)
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 2000)
    }
  }

  const createTemplate = async () => {
    if (!selectedProject) return

    try {
      setLoading(true)
      
      await invoke('create_claude_md_template', {
        projectPath: selectedProject.path
      })
      
      // Reload to get the template content
      await loadClaudeMd()
      setIsEditing(true)
    } catch (error) {
      console.error('Failed to create CLAUDE.md template:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleContentChange = (newContent: string) => {
    setContent(newContent)
    setHasChanges(true)
  }

  const openInIDE = async () => {
    if (!selectedProject || !exists) return

    const selectedIDE = localStorage.getItem('selectedIDE')
    const claudeMdPath = `${selectedProject.path}/CLAUDE.md`
    
    if (selectedIDE) {
      try {
        await invoke('open_file_in_ide', {
          ideCommand: selectedIDE,
          filePath: claudeMdPath
        })
      } catch (error) {
        console.error('Failed to open CLAUDE.md in IDE:', error)
        // Fallback to system default
        invoke('open_file_in_system', { filePath: claudeMdPath })
          .catch(error => console.error('Failed to open file:', error))
      }
    } else {
      invoke('open_file_in_system', { filePath: claudeMdPath })
        .catch(error => console.error('Failed to open file:', error))
    }
  }

  const getSaveStatusIcon = () => {
    switch (saveStatus) {
      case 'saving':
        return <RefreshCw size={16} className="animate-spin text-primary" />
      case 'saved':
        return <CheckCircle size={16} className="text-green-500" />
      case 'error':
        return <AlertCircle size={16} className="text-red-500" />
      default:
        return null
    }
  }

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <FileText size={48} className="text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No Project Selected</h3>
          <p className="text-muted-foreground">
            Select a project to view and edit its CLAUDE.md file.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <FileText size={24} className="text-primary" />
            <div>
              <h2 className="text-2xl font-semibold text-foreground">CLAUDE.md</h2>
              <p className="text-muted-foreground mt-1">
                Project: {selectedProject.name}
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            {getSaveStatusIcon()}
            
            {exists && (
              <>
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className={`p-2 rounded-lg transition-colors ${
                    showPreview ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                  }`}
                  title={showPreview ? 'Hide Preview' : 'Show Preview'}
                >
                  <Eye size={16} />
                </button>
                
                <button
                  onClick={openInIDE}
                  className="p-2 hover:bg-accent rounded-lg transition-colors"
                  title="Open in IDE"
                >
                  <ExternalLink size={16} />
                </button>
              </>
            )}
            
            {exists && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
              >
                <Edit3 size={16} />
                <span>Edit</span>
              </button>
            )}
            
            {isEditing && (
              <>
                <button
                  onClick={() => {
                    setIsEditing(false)
                    setShowPreview(false)
                    loadClaudeMd() // Reload to discard changes
                  }}
                  className="flex items-center space-x-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90 transition-opacity"
                >
                  <X size={16} />
                  <span>Cancel</span>
                </button>
                
                <button
                  onClick={saveClaudeMd}
                  disabled={!hasChanges || saveStatus === 'saving'}
                  className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <Save size={16} />
                  <span>Save</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
          </div>
        ) : !exists ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md">
              <FileText size={64} className="text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-medium text-foreground mb-2">No CLAUDE.md File</h3>
              <p className="text-muted-foreground mb-6">
                This project doesn't have a CLAUDE.md file yet. Create one to provide context and instructions for Claude about your project.
              </p>
              
              {debugInfo && (
                <details className="mb-4 text-left">
                  <summary className="cursor-pointer text-sm text-muted-foreground mb-2">Debug Info</summary>
                  <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-32 text-left">
                    {debugInfo}
                  </pre>
                </details>
              )}
              
              <button
                onClick={createTemplate}
                className="flex items-center space-x-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity mx-auto"
              >
                <Plus size={18} />
                <span>Create CLAUDE.md</span>
              </button>
            </div>
          </div>
        ) : (
          <div className={`h-full ${showPreview && isEditing ? 'grid grid-cols-2 gap-4 p-4' : 'p-6'}`}>
            {isEditing && (
              <div className={showPreview ? '' : 'h-full'}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-foreground">Editor</h3>
                  {hasChanges && (
                    <span className="text-sm text-amber-600 dark:text-amber-400">
                      Unsaved changes
                    </span>
                  )}
                </div>
                <textarea
                  value={content}
                  onChange={(e) => handleContentChange(e.target.value)}
                  className="w-full h-full min-h-[500px] p-4 bg-card border border-border rounded-lg font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Write your project instructions here..."
                />
              </div>
            )}
            
            {(showPreview || !isEditing) && (
              <div className={isEditing ? '' : 'h-full'}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-foreground">
                    {isEditing ? 'Preview' : 'Content'}
                  </h3>
                </div>
                <div className="bg-card border border-border rounded-lg p-6 overflow-auto h-full">
                  <div className="prose prose-sm max-w-none prose-slate dark:prose-invert text-gray-900 dark:text-gray-100">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({ node, inline, className, children, ...props }: any) {
                          const match = /language-(\w+)/.exec(className || '')
                          const language = match ? match[1] : ''
                          
                          if (!inline && language) {
                            return (
                              <SyntaxHighlighter
                                style={tomorrow}
                                language={language}
                                PreTag="div"
                                className="!bg-muted !text-foreground"
                                {...props}
                              >
                                {String(children).replace(/\n$/, '')}
                              </SyntaxHighlighter>
                            )
                          }
                          
                          return (
                            <code className="bg-muted px-1 py-0.5 rounded text-sm" {...props}>
                              {children}
                            </code>
                          )
                        },
                        pre({ children }: any) {
                          return <pre className="overflow-x-auto bg-muted p-4 rounded">{children}</pre>
                        }
                      }}
                    >
                      {content || '*No content yet. Start editing to add project instructions.*'}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}